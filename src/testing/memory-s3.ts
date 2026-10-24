import { Readable } from "node:stream";
import type { S3Client } from "@aws-sdk/client-s3";

interface StoredObject {
  body: Buffer;
  modified: Date;
}

interface Upload {
  bucket: string;
  key: string;
  parts: Map<number, Buffer>;
}

interface Command {
  readonly input?: Record<string, unknown>;
}

export interface MemoryFault {
  command: string;
  error: Error;
}

/** In-process S3 used by tests. It stores bytes in memory and speaks the commands the adapter sends. */
export class MemoryS3 {
  readonly calls: string[] = [];
  readonly denied = new Set<string>();
  failNext: MemoryFault | null = null;
  pageSize = 1000;
  private buckets = new Map<string, Map<string, StoredObject>>();
  private uploads = new Map<string, Upload>();
  private uploadSeq = 0;

  client(): S3Client {
    return {
      send: (command: Command, options?: { abortSignal?: AbortSignal }) => this.send(command, options),
    } as unknown as S3Client;
  }

  createBucket(name: string): void {
    if (!this.buckets.has(name)) this.buckets.set(name, new Map());
  }

  putObject(bucket: string, key: string, body: Buffer | string): void {
    this.createBucket(bucket);
    this.buckets.get(bucket)?.set(key, { body: Buffer.from(body), modified: new Date() });
  }

  getObject(bucket: string, key: string): Buffer | undefined {
    return this.buckets.get(bucket)?.get(key)?.body;
  }

  private async send(command: Command, options?: { abortSignal?: AbortSignal }): Promise<Record<string, unknown>> {
    if (options?.abortSignal?.aborted) throw new Error("aborted");
    const name = command.constructor.name;
    this.calls.push(name);
    if (this.failNext?.command === name) {
      const error = this.failNext.error;
      this.failNext = null;
      throw error;
    }
    const input = command.input ?? {};
    switch (name) {
      case "ListBucketsCommand":
        return {
          Buckets: [...this.buckets.keys()].map((Name) => ({ Name, CreationDate: new Date("2024-01-01T00:00:00Z") })),
        };
      case "HeadBucketCommand": {
        const bucket = String(input.Bucket ?? "");
        if (!this.buckets.has(bucket)) throw s3Error("NotFound", "Not Found", 404);
        return {};
      }
      case "CreateBucketCommand":
        this.createBucket(String(input.Bucket ?? ""));
        return {};
      case "ListObjectsV2Command":
        return this.list(input);
      case "HeadObjectCommand":
        return this.head(input);
      case "GetObjectCommand":
        return this.get(input);
      case "PutObjectCommand":
        await this.put(input);
        return {};
      case "DeleteObjectsCommand":
        this.deleteObjects(input);
        return {};
      case "CopyObjectCommand":
        this.copyObject(input);
        return {};
      case "CreateMultipartUploadCommand":
        return this.createUpload(input);
      case "UploadPartCommand":
        return this.uploadPart(input);
      case "UploadPartCopyCommand":
        return this.uploadPartCopy(input);
      case "CompleteMultipartUploadCommand":
        this.completeUpload(input);
        return {};
      case "AbortMultipartUploadCommand":
        this.uploads.delete(String(input.UploadId ?? ""));
        return {};
      default:
        throw new Error(`MemoryS3 has no ${name}`);
    }
  }

  private list(input: Record<string, unknown>): Record<string, unknown> {
    const bucket = String(input.Bucket ?? "");
    const prefix = String(input.Prefix ?? "");
    const delimiter = typeof input.Delimiter === "string" ? input.Delimiter : undefined;
    const objects = this.bucket(bucket);
    const prefixes = new Set<string>();
    const files: { key: string; size: number; modified: Date }[] = [];
    for (const [key, object] of objects) {
      if (!key.startsWith(prefix) || key === prefix) continue;
      const rest = key.slice(prefix.length);
      if (delimiter) {
        const index = rest.indexOf(delimiter);
        if (index >= 0) {
          prefixes.add(prefix + rest.slice(0, index + delimiter.length));
          continue;
        }
      }
      files.push({ key, size: object.body.length, modified: object.modified });
    }
    const entries: Array<{ kind: "prefix"; prefix: string } | { kind: "object"; key: string; size: number; modified: Date }> = [
      ...[...prefixes].sort().map((item) => ({ kind: "prefix" as const, prefix: item })),
      ...files
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((item) => ({ kind: "object" as const, key: item.key, size: item.size, modified: item.modified })),
    ];
    const start = input.ContinuationToken ? Number(input.ContinuationToken) : 0;
    const page = entries.slice(start, start + this.pageSize);
    const next = start + this.pageSize;
    return {
      CommonPrefixes: page.filter((entry) => entry.kind === "prefix").map((entry) => ({ Prefix: entry.prefix })),
      Contents: page
        .filter((entry) => entry.kind === "object")
        .map((entry) => ({ Key: entry.key, Size: entry.size, LastModified: entry.modified })),
      IsTruncated: next < entries.length,
      NextContinuationToken: next < entries.length ? String(next) : undefined,
    };
  }

  private head(input: Record<string, unknown>): Record<string, unknown> {
    const object = this.read(input);
    return { ContentLength: object.body.length };
  }

  private get(input: Record<string, unknown>): Record<string, unknown> {
    const object = this.read(input);
    const body = sliceRange(object.body, typeof input.Range === "string" ? input.Range : undefined);
    // Readable.from(buffer) iterates bytes. One-element array keeps the chunk intact.
    return { Body: Readable.from([body]), ContentLength: body.length };
  }

  private async put(input: Record<string, unknown>): Promise<void> {
    const bucket = String(input.Bucket ?? "");
    const key = String(input.Key ?? "");
    this.assertAllowed(bucket, key);
    const body = await readBody(input.Body);
    this.bucket(bucket).set(key, { body, modified: new Date() });
  }

  private deleteObjects(input: Record<string, unknown>): void {
    const bucket = String(input.Bucket ?? "");
    const objects = this.bucket(bucket);
    const listed = (input.Delete as { Objects?: { Key?: string }[] } | undefined)?.Objects ?? [];
    for (const item of listed) {
      const key = item.Key ?? "";
      this.assertAllowed(bucket, key);
      objects.delete(key);
    }
  }

  private copyObject(input: Record<string, unknown>): void {
    const destBucket = String(input.Bucket ?? "");
    const destKey = String(input.Key ?? "");
    this.assertAllowed(destBucket, destKey);
    const source = parseCopySource(String(input.CopySource ?? ""));
    this.assertAllowed(source.bucket, source.key);
    const body = Buffer.from(this.read({ Bucket: source.bucket, Key: source.key }).body);
    this.bucket(destBucket).set(destKey, { body, modified: new Date() });
  }

  private createUpload(input: Record<string, unknown>): Record<string, unknown> {
    this.uploadSeq += 1;
    const uploadId = `up-${this.uploadSeq}`;
    this.uploads.set(uploadId, {
      bucket: String(input.Bucket ?? ""),
      key: String(input.Key ?? ""),
      parts: new Map(),
    });
    return { UploadId: uploadId };
  }

  private async uploadPart(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const upload = this.upload(input);
    const partNumber = Number(input.PartNumber ?? 0);
    upload.parts.set(partNumber, await readBody(input.Body));
    return { ETag: `"part-${partNumber}"` };
  }

  private uploadPartCopy(input: Record<string, unknown>): Record<string, unknown> {
    const upload = this.upload(input);
    const source = parseCopySource(String(input.CopySource ?? ""));
    const body = this.read({ Bucket: source.bucket, Key: source.key }).body;
    const part = sliceRange(body, typeof input.CopySourceRange === "string" ? input.CopySourceRange : undefined);
    const partNumber = Number(input.PartNumber ?? 0);
    upload.parts.set(partNumber, part);
    return { CopyPartResult: { ETag: `"part-${partNumber}"` } };
  }

  private completeUpload(input: Record<string, unknown>): void {
    const upload = this.upload(input);
    const parts = [...upload.parts.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
    this.assertAllowed(upload.bucket, upload.key);
    this.bucket(upload.bucket).set(upload.key, { body: Buffer.concat(parts), modified: new Date() });
    this.uploads.delete(String(input.UploadId ?? ""));
  }

  private upload(input: Record<string, unknown>): Upload {
    const upload = this.uploads.get(String(input.UploadId ?? ""));
    if (!upload) throw s3Error("NoSuchUpload", "upload not found", 404);
    return upload;
  }

  private read(input: Record<string, unknown>): StoredObject {
    const bucket = String(input.Bucket ?? "");
    const key = String(input.Key ?? "");
    this.assertAllowed(bucket, key);
    const object = this.bucket(bucket).get(key);
    if (!object) throw s3Error("NoSuchKey", "The specified key does not exist.", 404);
    return object;
  }

  private bucket(name: string): Map<string, StoredObject> {
    const found = this.buckets.get(name);
    if (!found) throw s3Error("NoSuchBucket", `bucket ${name}`, 404);
    return found;
  }

  private assertAllowed(bucket: string, key: string): void {
    if (this.denied.has(`${bucket}/${key}`)) throw s3Error("AccessDenied", "Access Denied", 403);
  }
}

export function s3Error(name: string, message: string, status: number): Error {
  const error = new Error(message);
  error.name = name;
  return Object.assign(error, { $metadata: { httpStatusCode: status } });
}

function parseCopySource(value: string): { bucket: string; key: string } {
  const raw = decodeURIComponent(value.replace(/\+/g, "%20"));
  const slash = raw.indexOf("/");
  if (slash < 0) throw s3Error("InvalidArgument", "CopySource", 400);
  return { bucket: raw.slice(0, slash), key: raw.slice(slash + 1) };
}

function sliceRange(body: Buffer, range?: string): Buffer {
  if (!range) return body;
  const match = /bytes=(\d+)-(\d*)/.exec(range);
  if (!match) return body;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) + 1 : body.length;
  return body.subarray(start, end);
}

async function readBody(body: unknown): Promise<Buffer> {
  if (body == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  if (typeof body === "object" && Symbol.asyncIterator in body) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("Unsupported S3 body");
}
