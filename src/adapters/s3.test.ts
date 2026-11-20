import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { MULTIPART_THRESHOLD, PART_SIZE, S3_COPY_MAX_SINGLE, type Account } from "../core/store";
import { MemoryS3, s3Error } from "../testing/memory-s3";
import { bufferStream, readAll } from "../testing/streams";
import { createS3Client, S3_DELETE_BATCH, S3Adapter } from "./s3";

function account(): Account {
  return {
    id: "s3-1",
    provider: "s3",
    displayName: "Test",
    settings: { accessKeyId: "key", secretAccessKey: "secret", region: "us-east-1", ssl: true },
  };
}

function client(sent: { name: string; input: Record<string, unknown> }[]) {
  return {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: command.constructor.name, input: command.input });
      if (command.constructor.name === "ListBucketsCommand") {
        return { Buckets: [{ Name: "photos", CreationDate: new Date("2024-01-01T00:00:00Z") }] };
      }
      if (command.constructor.name === "ListObjectsV2Command") {
        return {
          CommonPrefixes: [{ Prefix: "2024/" }],
          Contents: [{ Key: "2024/a.jpg", Size: 12, LastModified: new Date("2024-02-01T00:00:00Z") }],
          IsTruncated: false,
        };
      }
      if (command.constructor.name === "CreateMultipartUploadCommand") return { UploadId: "up-1" };
      if (command.constructor.name === "UploadPartCommand") return { ETag: '"etag-1"' };
      if (command.constructor.name === "GetObjectCommand") return { Body: Readable.from(["hello"]) };
      if (command.constructor.name === "CopyObjectCommand") return {};
      return {};
    },
  };
}

describe("createS3Client", () => {
  it("omits the session token for a long-lived key and sends it for temporary credentials", async () => {
    const permanent = await createS3Client(account()).config.credentials();
    expect(permanent).toMatchObject({ accessKeyId: "key", secretAccessKey: "secret" });
    expect(permanent.sessionToken).toBeUndefined();

    const temporary = await createS3Client({
      ...account(),
      settings: { ...account().settings, sessionToken: "session" },
    }).config.credentials();
    expect(temporary.sessionToken).toBe("session");
  });
});

describe("S3Adapter", () => {
  it("lists buckets and prefixes", async () => {
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    const adapter = new S3Adapter(() => client(sent) as never);
    const buckets = await adapter.listContainers(account());
    expect(buckets[0]?.name).toBe("photos");
    const entries = await adapter.list(account(), "photos", "2024/");
    expect(entries.map((entry) => entry.name)).toEqual(["2024", "a.jpg"]);
  });

  it("uploads large objects as multipart and reports the upload id", async () => {
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    const adapter = new S3Adapter(() => client(sent) as never);
    const resumes: string[] = [];
    await adapter.put(account(), "photos", "big.bin", Readable.from([Buffer.alloc(8)]), {
      size: 9 * 1024 * 1024,
      onProgress: (_done, _total, resume) => {
        if (resume) resumes.push(resume.uploadId);
      },
    });
    expect(sent.map((item) => item.name)).toContain("CreateMultipartUploadCommand");
    expect(sent.map((item) => item.name)).toContain("CompleteMultipartUploadCommand");
    expect(resumes[0]).toBe("up-1");
  });

  it("keeps bytes a file stream returns past the end of a part", async () => {
    const memory = new MemoryS3();
    memory.createBucket("photos");
    const adapter = new S3Adapter(() => memory.client());
    const body = Buffer.alloc(64 * 1024 + 100, 7);
    body[64 * 1024] = 9;
    body[body.length - 1] = 3;
    const stream = new Readable({
      read() {
        this.push(body);
        this.push(null);
      },
    });
    await adapter.put(account(), "photos", "setup.exe", stream, { size: body.length, partSize: 64 * 1024 });
    expect(memory.getObject("photos", "setup.exe")).toEqual(body);
  });

  it("requests a ranged get", async () => {
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    const adapter = new S3Adapter(() => client(sent) as never);
    const body = await adapter.get(account(), "photos", "a.jpg", { range: { start: 4 } });
    expect(sent[0]?.input.Range).toBe("bytes=4-");
    expect(body.read()?.toString()).toBe("hello");
  });

  it("copies with CopyObject on the same account", async () => {
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    const adapter = new S3Adapter(() => client(sent) as never);
    await adapter.copy(account(), {
      from: { storeId: "s3-1", provider: "s3", container: "photos", key: "a.jpg" },
      to: { storeId: "s3-1", provider: "s3", container: "backup", key: "a.jpg" },
      size: 12,
    });
    expect(sent[0]?.name).toBe("CopyObjectCommand");
    expect(sent[0]?.input.CopySource).toBe("photos/a.jpg");
  });

  it("copies objects larger than 5 GiB with upload-part-copy", async () => {
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    const adapter = new S3Adapter(() => client(sent) as never);
    await adapter.copy(account(), {
      from: { storeId: "s3-1", provider: "s3", container: "photos", key: "huge.bin" },
      to: { storeId: "s3-1", provider: "s3", container: "photos", key: "huge-copy.bin" },
      size: S3_COPY_MAX_SINGLE + 1,
    });
    const copies = sent.filter((item) => item.name === "UploadPartCopyCommand");
    expect(sent.map((item) => item.name)).toContain("CreateMultipartUploadCommand");
    expect(sent.map((item) => item.name)).toContain("CompleteMultipartUploadCommand");
    expect(copies).toHaveLength(Math.ceil((S3_COPY_MAX_SINGLE + 1) / PART_SIZE));
    expect(copies[0]?.input.CopySourceRange).toBe(`bytes=0-${PART_SIZE - 1}`);
    expect(sent.some((item) => item.name === "GetObjectCommand")).toBe(false);
  });
});

describe("S3Adapter against in-memory S3", () => {
  const memory = new MemoryS3();
  const adapter = new S3Adapter(() => memory.client());

  it("lists, writes, reads, stats, copies, and deletes", async () => {
    memory.createBucket("photos");
    const body = Buffer.from("picture");
    await adapter.put(account(), "photos", "2024/a.jpg", Readable.from([body]), { size: body.length });
    await adapter.mkdir(account(), "photos", "album/");
    memory.pageSize = 1;
    const entries = await adapter.list(account(), "photos", "");
    memory.pageSize = 1000;
    expect(entries.map((entry) => entry.name).sort()).toEqual(["2024", "album"]);
    const nested = await adapter.list(account(), "photos", "2024/");
    expect(nested.map((entry) => entry.name)).toEqual(["a.jpg"]);
    expect(await readAll(await adapter.get(account(), "photos", "2024/a.jpg"))).toEqual(body);
    expect(await adapter.stat(account(), "photos", "2024/a.jpg")).toMatchObject({ exists: true, kind: "file", size: body.length });
    memory.calls.length = 0;
    await adapter.copy(account(), {
      from: { storeId: "s3-1", provider: "s3", container: "photos", key: "2024/a.jpg" },
      to: { storeId: "s3-1", provider: "s3", container: "photos", key: "2024/b.jpg" },
      size: body.length,
    });
    expect(memory.getObject("photos", "2024/b.jpg")).toEqual(body);
    expect(memory.calls).toContain("CopyObjectCommand");
    expect(memory.calls).not.toContain("GetObjectCommand");
    await adapter.remove(account(), "photos", ["2024/a.jpg"]);
    expect(await adapter.stat(account(), "photos", "2024/a.jpg")).toEqual({ exists: false });
    expect(memory.getObject("photos", "2024/b.jpg")).toEqual(body);
  });

  it("stores a streamed multipart upload", async () => {
    memory.createBucket("photos");
    memory.calls.length = 0;
    const body = Buffer.alloc(64 * 1024, 9);
    await adapter.put(account(), "photos", "big.bin", bufferStream(body, 8 * 1024), { size: MULTIPART_THRESHOLD });
    expect(memory.calls).toContain("CreateMultipartUploadCommand");
    expect(memory.calls).toContain("CompleteMultipartUploadCommand");
    expect(await readAll(await adapter.get(account(), "photos", "big.bin"))).toEqual(body);
  });

  it("stores an empty file with one PutObject", async () => {
    memory.createBucket("photos");
    memory.calls.length = 0;
    await adapter.put(account(), "photos", "empty.txt", Readable.from([]), { size: 0 });
    expect(memory.calls).toContain("PutObjectCommand");
    expect(memory.calls).not.toContain("CreateMultipartUploadCommand");
    expect(await adapter.stat(account(), "photos", "empty.txt")).toMatchObject({ exists: true, size: 0 });
  });

  it("reports a missing key, a permission failure, and a dropped connection", async () => {
    memory.createBucket("photos");
    expect(await adapter.stat(account(), "photos", "missing.txt")).toEqual({ exists: false });
    await expect(adapter.get(account(), "photos", "missing.txt")).rejects.toMatchObject({ name: "NoSuchKey" });
    memory.denied.add("photos/secret.txt");
    memory.putObject("photos", "secret.txt", "nope");
    await expect(adapter.get(account(), "photos", "secret.txt")).rejects.toMatchObject({ name: "AccessDenied" });
    memory.denied.delete("photos/secret.txt");
    memory.failNext = { command: "GetObjectCommand", error: s3Error("ECONNRESET", "read ECONNRESET", 500) };
    await expect(adapter.get(account(), "photos", "secret.txt")).rejects.toThrow(/ECONNRESET/);
  });

  it("deletes a folder prefix, including nested keys and the marker, without the sibling prefix", async () => {
    memory.createBucket("photos");
    memory.pageSize = 1;
    memory.putObject("photos", "album/", Buffer.alloc(0));
    memory.putObject("photos", "album/a.txt", "a");
    memory.putObject("photos", "album/nested/", Buffer.alloc(0));
    memory.putObject("photos", "album/nested/b.txt", "b");
    memory.putObject("photos", "album/empty/", Buffer.alloc(0));
    memory.putObject("photos", "album-extra/keep.txt", "keep");
    memory.calls.length = 0;
    try {
      await adapter.remove(account(), "photos", ["album/"]);
      expect(memory.getObject("photos", "album/")).toBeUndefined();
      expect(memory.getObject("photos", "album/a.txt")).toBeUndefined();
      expect(memory.getObject("photos", "album/nested/")).toBeUndefined();
      expect(memory.getObject("photos", "album/nested/b.txt")).toBeUndefined();
      expect(memory.getObject("photos", "album/empty/")).toBeUndefined();
      expect(memory.getObject("photos", "album-extra/keep.txt")?.toString()).toBe("keep");
      const lists = memory.calls.filter((name) => name === "ListObjectsV2Command");
      expect(lists.length).toBeGreaterThan(1);
    } finally {
      memory.pageSize = 1000;
    }
  });

  it("deletes object keys in batches and does not list a plain file", async () => {
    memory.createBucket("photos");
    const keys = Array.from({ length: S3_DELETE_BATCH + 1 }, (_, index) => `bulk/${index}.txt`);
    for (const key of keys) memory.putObject("photos", key, "x");
    memory.calls.length = 0;
    await adapter.remove(account(), "photos", keys);
    expect(memory.calls.filter((name) => name === "DeleteObjectsCommand")).toHaveLength(2);
    expect(memory.calls).not.toContain("ListObjectsV2Command");
    expect(memory.getObject("photos", "bulk/0.txt")).toBeUndefined();
    expect(memory.getObject("photos", `bulk/${S3_DELETE_BATCH}.txt`)).toBeUndefined();
  });

  it("pages through a wide prefix and deletes it in batches", async () => {
    memory.createBucket("photos");
    memory.pageSize = 2;
    for (let index = 0; index < S3_DELETE_BATCH + 1; index += 1) {
      memory.putObject("photos", `wide/${index}.txt`, "x");
    }
    memory.putObject("photos", "wide/", Buffer.alloc(0));
    memory.putObject("photos", "keep.txt", "k");
    memory.calls.length = 0;
    try {
      await adapter.remove(account(), "photos", ["wide/", "wide/nested/"]);
      expect(memory.calls.filter((name) => name === "ListObjectsV2Command").length).toBeGreaterThan(1);
      expect(memory.calls.filter((name) => name === "DeleteObjectsCommand")).toHaveLength(2);
      expect(memory.getObject("photos", "wide/")).toBeUndefined();
      expect(memory.getObject("photos", "wide/0.txt")).toBeUndefined();
      expect(memory.getObject("photos", `wide/${S3_DELETE_BATCH}.txt`)).toBeUndefined();
      expect(memory.getObject("photos", "keep.txt")?.toString()).toBe("k");
    } finally {
      memory.pageSize = 1000;
    }
  });
});
