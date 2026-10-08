import { describe, expect, it } from "vitest";
import { dedupeKey } from "./store";
import { TransferQueue } from "./queue";
import type { Locator, TransferJob } from "./store";

function locator(key: string): Locator {
  return { storeId: "local", provider: "local", container: "", key };
}

function job(id: string, key = "/a"): TransferJob {
  return {
    id,
    kind: "upload",
    source: locator(key),
    dest: locator(`/dest/${key}`),
    name: key,
    bytesDone: 0,
    status: "queued",
    createdAt: new Date().toISOString(),
  };
}

describe("dedupeKey", () => {
  it("matches identical kind and locators", () => {
    expect(dedupeKey("upload", locator("/a"), locator("/b"))).toBe(dedupeKey("upload", locator("/a"), locator("/b")));
    expect(dedupeKey("upload", locator("/a"), locator("/b"))).not.toBe(dedupeKey("download", locator("/a"), locator("/b")));
  });
});

describe("TransferQueue", () => {
  it("joins a second identical request to the in-flight job", async () => {
    let started = 0;
    const queue = new TransferQueue({
      concurrency: 2,
      run: () => new Promise(() => undefined),
    });
    const first = queue.enqueue(job("1"));
    await Promise.resolve();
    started = queue.activeCount();
    const second = queue.enqueue(job("2"));
    expect(second.id).toBe(first.id);
    expect(queue.list()).toHaveLength(1);
    expect(started).toBe(1);
  });

  it("steps the cap down after repeated timeouts", async () => {
    const queue = new TransferQueue({
      concurrency: 3,
      run: async () => {
        throw new Error("connection timed out");
      },
    });
    queue.enqueue(job("1", "/a"));
    queue.enqueue(job("2", "/b"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(queue.getCap()).toBe(2);
  });

  it("removes a finished job when dismissed", async () => {
    const queue = new TransferQueue({
      concurrency: 1,
      run: async () => {
        throw new Error("EISDIR");
      },
    });
    const failed = queue.enqueue(job("1", "/a"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(failed.status).toBe("error");
    queue.dismiss(failed.id);
    expect(queue.list()).toHaveLength(0);
  });

  it("does not start a paused job", async () => {
    let ran = false;
    const queue = new TransferQueue({
      concurrency: 1,
      run: async () => {
        ran = true;
      },
    });
    const first = queue.enqueue(job("1"));
    queue.pause(first.id);
    queue.pause(first.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queue.list()[0]?.status).toBe("paused");
    expect(ran).toBe(false);
  });
});
