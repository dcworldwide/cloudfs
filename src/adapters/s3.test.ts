import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { Account } from "../core/store";
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
});
