import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  UploadPartCopyCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import {
  Account,
  CompletedPart,
  CopyRequest,
  Entry,
  GetOptions,
  isS3Settings,
  MULTIPART_THRESHOLD,
  PART_SIZE,
  PutOptions,
  StoreAdapter,
} from "../core/store";

export interface S3ClientFactory {
  (account: Account): S3Client;
}

function requireSettings(account: Account) {
  if (!isS3Settings(account.settings)) throw new Error("S3 account is missing access key, secret, region, or SSL.");
  return account.settings;
}

export function createS3Client(account: Account): S3Client {
  const settings = requireSettings(account);
  const endpoint = settings.endpoint?.trim();
  return new S3Client({
    region: settings.region,
    endpoint: endpoint || undefined,
    forcePathStyle: Boolean(endpoint),
    tls: settings.ssl,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });
}

function prefixOf(prefix: string): string {
  if (!prefix) return "";
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

async function readPart(stream: Readable, size: number, signal?: AbortSignal): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    if (signal?.aborted) throw new Error("aborted");
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buf);
    total += buf.length;
    if (total >= size) break;
  }
  if (total === 0) return null;
  return Buffer.concat(chunks, total);
}

export class S3Adapter implements StoreAdapter {
  id = "s3" as const;
  label = "Amazon S3";
  available = true;

  constructor(private factory: S3ClientFactory = createS3Client) {}

  private client(account: Account): S3Client {
    return this.factory(account);
  }

  async test(account: Account): Promise<void> {
    await this.client(account).send(new ListBucketsCommand({}));
  }

  async listContainers(account: Account): Promise<Entry[]> {
    const result = await this.client(account).send(new ListBucketsCommand({}));
    return (result.Buckets ?? []).map((bucket) => ({
      name: bucket.Name ?? "",
      key: bucket.Name ?? "",
      kind: "folder" as const,
      modified: bucket.CreationDate?.toISOString(),
    }));
  }

  async list(account: Account, container: string, prefix: string): Promise<Entry[]> {
    const client = this.client(account);
    const normalized = prefixOf(prefix);
    const entries: Entry[] = [];
    let token: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: container,
          Prefix: normalized,
          Delimiter: "/",
          ContinuationToken: token,
        }),
      );
      for (const common of page.CommonPrefixes ?? []) {
        const key = common.Prefix ?? "";
        const folderName = key.slice(normalized.length).replace(/\/$/, "");
        entries.push({
          name: folderName || key.replace(/\/$/, "").split("/").at(-1) || key,
          key,
          kind: "folder",
        });
      }
      for (const object of page.Contents ?? []) {
        const key = object.Key ?? "";
        if (key === normalized) continue;
        entries.push({
          name: key.slice(normalized.length),
          key,
          kind: "file",
          size: object.Size,
          modified: object.LastModified?.toISOString(),
        });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return entries.sort((a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || a.name.localeCompare(b.name));
  }

  async put(account: Account, container: string, key: string, stream: Readable, opts: PutOptions): Promise<void> {
    const client = this.client(account);
    const size = opts.size ?? 0;
    if (size > 0 && size < MULTIPART_THRESHOLD && !opts.resume) {
      const body = await readPart(stream, size, opts.signal);
      await client.send(
        new PutObjectCommand({
          Bucket: container,
          Key: key,
          Body: body ?? Buffer.alloc(0),
          ContentType: opts.contentType,
        }),
        { abortSignal: opts.signal },
      );
      opts.onProgress?.(size, size);
      return;
    }
    await this.multipart(client, container, key, stream, opts);
  }

  private async multipart(
    client: S3Client,
    container: string,
    key: string,
    stream: Readable,
    opts: PutOptions,
  ): Promise<void> {
    let uploadId = opts.resume?.uploadId;
    const parts: CompletedPart[] = [...(opts.resume?.parts ?? [])];
    let bytesDone = opts.resume?.bytesDone ?? 0;
    if (!uploadId) {
      const created = await client.send(
        new CreateMultipartUploadCommand({ Bucket: container, Key: key, ContentType: opts.contentType }),
        { abortSignal: opts.signal },
      );
      uploadId = created.UploadId;
      if (!uploadId) throw new Error("S3 did not return an upload id.");
      opts.onProgress?.(bytesDone, opts.size, { uploadId, parts, bytesDone });
    }
    let partNumber = parts.reduce((max, part) => Math.max(max, part.partNumber), 0);
    while (true) {
      if (opts.signal?.aborted) throw new Error("aborted");
      const body = await readPart(stream, PART_SIZE, opts.signal);
      if (!body) break;
      partNumber += 1;
      const uploaded = await client.send(
        new UploadPartCommand({
          Bucket: container,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body,
        }),
        { abortSignal: opts.signal },
      );
      parts.push({ partNumber, etag: uploaded.ETag ?? "" });
      bytesDone += body.length;
      opts.onProgress?.(bytesDone, opts.size, { uploadId, parts: [...parts], bytesDone });
    }
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: container,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) },
      }),
      { abortSignal: opts.signal },
    );
  }

  async abortMultipart(account: Account, container: string, key: string, uploadId: string): Promise<void> {
    await this.client(account).send(new AbortMultipartUploadCommand({ Bucket: container, Key: key, UploadId: uploadId }));
  }

  async get(account: Account, container: string, key: string, opts?: GetOptions): Promise<Readable> {
    const range = opts?.range
      ? `bytes=${opts.range.start}-${opts.range.end ?? ""}`
      : undefined;
    const result = await this.client(account).send(
      new GetObjectCommand({ Bucket: container, Key: key, Range: range }),
      { abortSignal: opts?.signal },
    );
    const body = result.Body;
    if (!body || typeof (body as Readable).pipe !== "function") {
      throw new Error("S3 returned an empty body.");
    }
    return body as Readable;
  }

  async remove(account: Account, container: string, keys: string[]): Promise<void> {
    if (!keys.length) return;
    const client = this.client(account);
    for (let i = 0; i < keys.length; i += 1000) {
      const slice = keys.slice(i, i + 1000);
      await client.send(
        new DeleteObjectsCommand({
          Bucket: container,
          Delete: { Objects: slice.map((key) => ({ Key: key })) },
        }),
      );
    }
  }

  async copy(account: Account, request: CopyRequest): Promise<void> {
    if (request.from.storeId !== account.id || request.to.storeId !== account.id) {
      throw new Error("Server-side copy requires the same S3 account.");
    }
    const client = this.client(account);
    const source = `${request.from.container}/${encodeURIComponent(request.from.key).replace(/%2F/g, "/")}`;
    const size = request.size ?? 0;
    if (size > 5 * 1024 * 1024 * 1024) {
      await this.multipartCopy(client, source, request);
      return;
    }
    await client.send(
      new CopyObjectCommand({
        Bucket: request.to.container,
        Key: request.to.key,
        CopySource: source,
      }),
      { abortSignal: request.signal },
    );
    request.onProgress?.(size, size);
  }

  private async multipartCopy(client: S3Client, source: string, request: CopyRequest): Promise<void> {
    const created = await client.send(
      new CreateMultipartUploadCommand({ Bucket: request.to.container, Key: request.to.key }),
    );
    const uploadId = created.UploadId;
    if (!uploadId) throw new Error("S3 did not return an upload id.");
    const size = request.size ?? 0;
    const parts: CompletedPart[] = [];
    let start = 0;
    let partNumber = 1;
    while (start < size) {
      const end = Math.min(start + PART_SIZE, size) - 1;
      const uploaded = await client.send(
        new UploadPartCopyCommand({
          Bucket: request.to.container,
          Key: request.to.key,
          UploadId: uploadId,
          PartNumber: partNumber,
          CopySource: source,
          CopySourceRange: `bytes=${start}-${end}`,
        }),
        { abortSignal: request.signal },
      );
      parts.push({ partNumber, etag: uploaded.CopyPartResult?.ETag ?? "" });
      start = end + 1;
      partNumber += 1;
      request.onProgress?.(start, size);
    }
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: request.to.container,
        Key: request.to.key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) },
      }),
    );
  }

  async mkdir(account: Account, container: string, prefix: string): Promise<void> {
    const key = prefixOf(prefix);
    await this.client(account).send(new PutObjectCommand({ Bucket: container, Key: key, Body: Buffer.alloc(0) }));
  }

  async ensureBucket(account: Account, container: string): Promise<void> {
    const client = this.client(account);
    try {
      await client.send(new HeadBucketCommand({ Bucket: container }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: container }));
    }
  }
}
