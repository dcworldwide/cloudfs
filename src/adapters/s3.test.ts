import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { MULTIPART_THRESHOLD, PART_SIZE, S3_COPY_MAX_SINGLE, type Account } from "../core/store";
import { MemoryS3, s3Error } from "../testing/memory-s3";
import { bufferStream, readAll } from "../testing/streams";
import { S3Adapter } from "./s3";

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
});
