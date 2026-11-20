import { randomUUID } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat as fsStat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FtpAdapter } from "../adapters/ftp";
import { LocalAdapter } from "../adapters/local";
import { S3Adapter } from "../adapters/s3";
import { MemoryS3, s3Error } from "../testing/memory-s3";
import { TestFtpServer } from "../testing/ftp-server";
import { renameEntry } from "./rename-entry";
import { AdapterRegistry } from "./registry";
import type { Account, JobKind, Locator, TransferJob } from "./store";
import { TransferCoordinator } from "./transfers";

class GuardLocal extends LocalAdapter {
  constructor(private rootDir: string) {
    super(rootDir);
  }

  private allow(key: string): void {
    const resolved = path.resolve(key);
    if (resolved !== this.rootDir && !resolved.startsWith(this.rootDir + path.sep)) {
      throw new Error(`transfer touched local disk outside the workspace: ${key}`);
    }
  }

  override stat(account: Account, container: string, key: string) {
    this.allow(key);
    return super.stat(account, container, key);
  }

  override get(account: Account, container: string, key: string, opts?: Parameters<LocalAdapter["get"]>[3]) {
    this.allow(key);
    return super.get(account, container, key, opts);
  }

  override async put(account: Account, container: string, key: string, stream: Parameters<LocalAdapter["put"]>[3], opts: Parameters<LocalAdapter["put"]>[4]) {
    this.allow(key);
    return super.put(account, container, key, stream, opts);
  }

  override async remove(account: Account, container: string, keys: string[]) {
    keys.forEach((key) => this.allow(key));
    return super.remove(account, container, keys);
  }

  override async rename(from: string, to: string) {
    this.allow(from);
    this.allow(to);
    return super.rename(from, to);
  }

  override async copy(account: Account, request: Parameters<LocalAdapter["copy"]>[1]) {
    this.allow(request.from.key);
    this.allow(request.to.key);
    return super.copy(account, request);
  }

  override async mkdir(account: Account, container: string, prefix: string) {
    this.allow(prefix);
    return super.mkdir(account, container, prefix);
  }
}

type Side = "local" | "s3" | "ftp";

describe("cross-provider transfers", () => {
  let root = "";
  let localRoot = "";
  let tempDir = "";
  const tempFiles: string[] = [];
  const progress: number[] = [];
  const s3 = new MemoryS3();
  const s3b = new MemoryS3();
  const ftpA = new TestFtpServer();
  const ftpB = new TestFtpServer();
  let coordinator: TransferCoordinator;
  let local: GuardLocal;
  let registry: AdapterRegistry;
  let accounts: Account[] = [];

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "cloudfs-transfer-"));
    localRoot = path.join(root, "local");
    tempDir = path.join(root, "temp");
    await mkdir(localRoot);
    await mkdir(tempDir);
    s3.createBucket("box");
    s3.createBucket("other");
    s3b.createBucket("box");
    const portA = await ftpA.start();
    const portB = await ftpB.start();
    accounts = [
      s3Account("s3-a"),
      s3Account("s3-b"),
      ftpAccount("ftp-a", portA),
      ftpAccount("ftp-b", portB),
    ];
    registry = new AdapterRegistry();
    registry.register(new S3Adapter((account) => (account.id === "s3-b" ? s3b : s3).client()));
    registry.register(new FtpAdapter());
    local = new GuardLocal(localRoot);
    coordinator = new TransferCoordinator({
      dir: root,
      registry,
      local,
      accounts: () => accounts,
      concurrency: 1,
      tempDir,
      onTempFile: (file) => tempFiles.push(file),
    });
    coordinator.queue.on("progress", (job) => progress.push(job.bytesDone));
  }, 20_000);

  afterAll(async () => {
    await ftpA.stop();
    await ftpB.stop();
    if (root) await rm(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    tempFiles.length = 0;
    progress.length = 0;
    s3.calls.length = 0;
    s3b.calls.length = 0;
    s3.pageSize = 1000;
    s3b.pageSize = 1000;
    s3.failNext = null;
    s3b.failNext = null;
    s3.denied.clear();
    s3b.denied.clear();
    ftpA.commands.length = 0;
    ftpB.commands.length = 0;
    ftpA.dropNext = false;
    ftpB.dropNext = false;
    ftpA.failNext = null;
    ftpB.failNext = null;
  });

  function locator(side: Side, name: string, store: "a" | "b" = "a", container = "box"): Locator {
    if (side === "local") return { storeId: "local", provider: "local", container: "", key: path.join(localRoot, name) };
    if (side === "s3") return { storeId: store === "b" ? "s3-b" : "s3-a", provider: "s3", container, key: name };
    return { storeId: store === "b" ? "ftp-b" : "ftp-a", provider: "ftp", container: "", key: name };
  }

  function seed(side: Side, name: string, body: Buffer, store: "a" | "b" = "a", container = "box"): void {
    if (side === "local") {
      writeFileSync(path.join(localRoot, name), body);
      return;
    }
    if (side === "s3") {
      (store === "b" ? s3b : s3).putObject(container, name, body);
      return;
    }
    (store === "b" ? ftpB : ftpA).write(`/${name}`, body);
  }

  function stored(side: Side, name: string, store: "a" | "b" = "a", container = "box"): Buffer | undefined {
    if (side === "local") {
      try {
        return readFileSync(path.join(localRoot, name));
      } catch {
        return undefined;
      }
    }
    if (side === "s3") return (store === "b" ? s3b : s3).getObject(container, name);
    return (store === "b" ? ftpB : ftpA).read(`/${name}`);
  }

  async function run(kind: JobKind, source: Locator, dest: Locator, name: string): Promise<TransferJob> {
    const job = coordinator.enqueue({
      id: randomUUID(),
      kind,
      source,
      dest,
      name,
      bytesDone: 0,
      status: "queued",
      createdAt: new Date().toISOString(),
    });
    const started = Date.now();
    while (job.status === "queued" || job.status === "running" || job.status === "paused") {
      if (Date.now() - started > 15_000) throw new Error(`transfer stuck at ${job.status}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return job;
  }

  const providers: Side[] = ["local", "s3", "ftp"];
  for (const from of providers) {
    for (const to of providers) {
      for (const mode of ["copy", "move"] as const) {
        it(`${mode}s ${from} to ${to} without a local spool`, async () => {
          const name = `${from}-${to}-${mode}.bin`;
          const destName = `${from}-${to}-${mode}.out.bin`;
          const body = Buffer.from(`payload ${from} ${to} ${mode}`);
          if (from === "local") writeFileSync(path.join(localRoot, name), body);
          else seed(from, name, body);
          const sourceIno = from === "local" && to === "local" && mode === "move" ? (await fsStat(path.join(localRoot, name))).ino : undefined;
          const kind: JobKind = mode === "move" ? "move" : from === "local" && to !== "local" ? "upload" : from !== "local" && to === "local" ? "download" : "copy";
          const job = await run(kind, locator(from, name), locator(to, destName), name);
          expect(job.status, job.error).toBe("done");
          expect(stored(to, destName)).toEqual(body);
          if (mode === "move") expect(stored(from, name)).toBeUndefined();
          else expect(stored(from, name)).toEqual(body);
          expect(tempFiles).toEqual([]);
          if (sourceIno != null) expect((await fsStat(path.join(localRoot, destName))).ino).toBe(sourceIno);
          expectOptimal(from, to, mode);
        }, 20_000);
      }
    }
  }

  function expectOptimal(from: Side, to: Side, mode: "copy" | "move"): void {
    if (from === "s3" && to === "s3") {
      expect(s3.calls).toContain("CopyObjectCommand");
      expect(s3.calls).not.toContain("GetObjectCommand");
      expect(s3.calls).not.toContain("PutObjectCommand");
      expect(s3b.calls).toEqual([]);
      if (mode === "move") expect(s3.calls).toContain("DeleteObjectsCommand");
      else expect(s3.calls).not.toContain("DeleteObjectsCommand");
    } else if (from === "s3") {
      expect(s3.calls).toContain("GetObjectCommand");
      expect(s3.calls).not.toContain("CopyObjectCommand");
    }
    if (to === "s3" && from !== "s3") expect(s3.calls).toContain("PutObjectCommand");
    if (from === "ftp" && to === "ftp" && mode === "move") {
      expect(ftpA.commands).toContain("RNFR");
      expect(ftpA.commands).not.toContain("RETR");
      expect(ftpA.commands).not.toContain("STOR");
      expect(ftpA.commands).not.toContain("DELE");
    } else {
      if (from === "ftp") expect(ftpA.commands).toContain("RETR");
      if (to === "ftp") expect(ftpA.commands).toContain("STOR");
      if (from === "ftp" || to === "ftp") expect(ftpA.commands).not.toContain("RNFR");
    }
    expect(ftpB.commands).toEqual([]);
  }

  it("copies between buckets in one S3 account without downloading", async () => {
    const body = Buffer.from("other-bucket");
    seed("s3", "bucket.txt", body);
    s3.calls.length = 0;
    const job = await run("copy", locator("s3", "bucket.txt"), locator("s3", "bucket-out.txt", "a", "other"), "bucket.txt");
    expect(job.status, job.error).toBe("done");
    expect(stored("s3", "bucket-out.txt", "a", "other")).toEqual(body);
    expect(stored("s3", "bucket.txt")).toEqual(body);
    expect(s3.calls).toContain("CopyObjectCommand");
    expect(s3.calls).not.toContain("GetObjectCommand");
    expect(tempFiles).toEqual([]);
  });

  it("streams between two S3 accounts instead of CopyObject", async () => {
    const body = Buffer.from("account-b");
    seed("s3", "account.txt", body);
    s3.calls.length = 0;
    const job = await run("move", locator("s3", "account.txt"), locator("s3", "account-out.txt", "b"), "account.txt");
    expect(job.status, job.error).toBe("done");
    expect(stored("s3", "account.txt")).toBeUndefined();
    expect(stored("s3", "account-out.txt", "b")).toEqual(body);
    expect(s3.calls).toContain("GetObjectCommand");
    expect(s3.calls).not.toContain("CopyObjectCommand");
    expect(s3b.calls).toContain("PutObjectCommand");
    expect(s3b.calls).not.toContain("CopyObjectCommand");
    expect(tempFiles).toEqual([]);
  });

  it("streams between two FTP servers instead of renaming", async () => {
    const body = Buffer.from("other-server");
    seed("ftp", "server.txt", body);
    ftpA.commands.length = 0;
    const job = await run("move", locator("ftp", "server.txt"), locator("ftp", "server-out.txt", "b"), "server.txt");
    expect(job.status, job.error).toBe("done");
    expect(ftpA.read("/server.txt")).toBeUndefined();
    expect(ftpB.read("/server-out.txt")).toEqual(body);
    expect(ftpA.commands).toContain("RETR");
    expect(ftpA.commands).toContain("DELE");
    expect(ftpA.commands).not.toContain("RNFR");
    expect(ftpB.commands).toContain("STOR");
    expect(tempFiles).toEqual([]);
  });

  it("streams a larger file from S3 to FTP without a temp file", async () => {
    const body = Buffer.alloc(128 * 1024, 11);
    seed("s3", "streamed.bin", body);
    const job = await run("copy", locator("s3", "streamed.bin"), locator("ftp", "streamed.bin"), "streamed.bin");
    expect(job.status, job.error).toBe("done");
    expect(ftpA.read("/streamed.bin")).toEqual(body);
    expect(tempFiles).toEqual([]);
    expect(s3.calls).not.toContain("CopyObjectCommand");
  });

  it("reports progress for a local copy", async () => {
    const body = Buffer.alloc(32 * 1024, 4);
    seed("local", "progress.bin", body);
    const job = await run("copy", locator("local", "progress.bin"), locator("local", "progress-out.bin"), "progress.bin");
    expect(job.status, job.error).toBe("done");
    expect(progress.some((bytes) => bytes > 0)).toBe(true);
    expect(job.bytesDone).toBe(body.length);
  });

  it("keeps the S3 source when the FTP connection drops", async () => {
    const body = Buffer.from("do-not-lose");
    seed("s3", "keep.txt", body);
    ftpA.dropNext = true;
    const job = await run("move", locator("s3", "keep.txt"), locator("ftp", "keep-out.txt"), "keep.txt");
    expect(job.status).toBe("error");
    expect(stored("s3", "keep.txt")).toEqual(body);
    expect(ftpA.exists("/keep-out.txt")).toBe(false);
    expect(tempFiles).toEqual([]);
  });

  it("keeps the local source when S3 refuses the upload", async () => {
    const body = Buffer.from("local-stays");
    seed("local", "stays.txt", body);
    s3.failNext = { command: "PutObjectCommand", error: s3Error("ECONNRESET", "read ECONNRESET", 500) };
    const job = await run("upload", locator("local", "stays.txt"), locator("s3", "stays-out.txt"), "stays.txt");
    expect(job.status).toBe("error");
    expect(await readFile(path.join(localRoot, "stays.txt"), "utf8")).toBe("local-stays");
    expect(stored("s3", "stays-out.txt")).toBeUndefined();
  });

  it("keeps the S3 source when server-side copy fails", async () => {
    const body = Buffer.from("copy-fails");
    seed("s3", "copy-fails.txt", body);
    s3.failNext = { command: "CopyObjectCommand", error: s3Error("InternalError", "copy failed", 500) };
    const job = await run("move", locator("s3", "copy-fails.txt"), locator("s3", "copy-fails-out.txt"), "copy-fails.txt");
    expect(job.status).toBe("error");
    expect(stored("s3", "copy-fails.txt")).toEqual(body);
    expect(stored("s3", "copy-fails-out.txt")).toBeUndefined();
    expect(tempFiles).toEqual([]);
  });

  it("keeps the FTP source when rename is rejected", async () => {
    const body = Buffer.from("rename-fails");
    seed("ftp", "rename-fails.txt", body);
    ftpA.failNext = { verb: "RNFR", code: 550, message: "Permission denied" };
    const job = await run("move", locator("ftp", "rename-fails.txt"), locator("ftp", "rename-fails-out.txt"), "rename-fails.txt");
    expect(job.status).toBe("error");
    expect(ftpA.read("/rename-fails.txt")).toEqual(body);
    expect(ftpA.exists("/rename-fails-out.txt")).toBe(false);
  });

  it("does not create a destination when the source is missing", async () => {
    const job = await run("move", locator("s3", "missing-source.txt"), locator("local", "missing-out.txt"), "missing-source.txt");
    expect(job.status).toBe("error");
    expect(stored("local", "missing-out.txt")).toBeUndefined();
  });

  it("falls back to copy and delete when a local rename crosses devices", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "cloudfs-exdev-"));
    try {
      const body = Buffer.from("cross-device");
      const source = path.join(dir, "source.txt");
      const dest = path.join(dir, "dest.txt");
      await writeFile(source, body);
      let renames = 0;
      const crossed = new LocalAdapter(dir);
      crossed.rename = async () => {
        renames += 1;
        const error = new Error("cross device") as NodeJS.ErrnoException;
        error.code = "EXDEV";
        throw error;
      };
      const queue = new TransferCoordinator({
        dir,
        registry: new AdapterRegistry(),
        local: crossed,
        accounts: () => [],
        concurrency: 1,
        tempDir: path.join(dir, "temp"),
        onTempFile: () => {
          throw new Error("cross-device move should stream, not spool");
        },
      });
      const job = queue.enqueue(makeJob("move", source, dest));
      await settle(job);
      expect(job.status, job.error).toBe("done");
      expect(renames).toBe(1);
      expect(await readFile(dest, "utf8")).toBe("cross-device");
      await expect(readFile(source)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await removeTree(dir);
    }
  });

  it("leaves the local source in place when the cross-device copy fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "cloudfs-exdev-fail-"));
    try {
      const source = path.join(dir, "source.txt");
      const dest = path.join(dir, "dest.txt");
      await writeFile(source, "still-here");
      const crossed = new LocalAdapter(dir);
      crossed.rename = async () => {
        const error = new Error("cross device") as NodeJS.ErrnoException;
        error.code = "EXDEV";
        throw error;
      };
      crossed.put = async () => {
        throw new Error("no space");
      };
      const queue = new TransferCoordinator({
        dir,
        registry: new AdapterRegistry(),
        local: crossed,
        accounts: () => [],
        concurrency: 1,
      });
      const job = queue.enqueue(makeJob("move", source, dest));
      await settle(job);
      expect(job.status).toBe("error");
      expect(await readFile(source, "utf8")).toBe("still-here");
      expect(storedMissing(dest)).toBe(true);
    } finally {
      await removeTree(dir);
    }
  });

  it("spools through a temp file when the destination cannot stream, then removes it", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "cloudfs-spool-"));
    const spool = path.join(dir, "spool");
    const seen: string[] = [];
    try {
      const memory = new MemoryS3();
      memory.createBucket("box");
      const cold = new S3Adapter(() => memory.client());
      cold.streaming = false;
      const source = path.join(dir, "source.txt");
      await writeFile(source, "spooled");
      const reg = new AdapterRegistry();
      reg.register(cold);
      const queue = new TransferCoordinator({
        dir,
        registry: reg,
        local: new LocalAdapter(dir),
        accounts: () => [s3Account("s3-a")],
        concurrency: 1,
        tempDir: spool,
        onTempFile: (file) => seen.push(file),
      });
      const job = queue.enqueue({
        ...makeJob("copy", source, "remote.txt"),
        source: { storeId: "local", provider: "local", container: "", key: source },
        dest: { storeId: "s3-a", provider: "s3", container: "box", key: "remote.txt" },
      });
      await settle(job);
      expect(job.status, job.error).toBe("done");
      expect(memory.getObject("box", "remote.txt")).toEqual(Buffer.from("spooled"));
      expect(seen).toHaveLength(1);
      expect(seen[0]?.startsWith(spool)).toBe(true);
      expect(await readdirOrEmpty(spool)).toEqual([]);
      expect(await readFile(source, "utf8")).toBe("spooled");
    } finally {
      await removeTree(dir);
    }
  });

  it("removes the spool and keeps the source when a non-streaming upload fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "cloudfs-spool-fail-"));
    const spool = path.join(dir, "spool");
    const seen: string[] = [];
    try {
      const cold = new S3Adapter(() => s3.client());
      cold.streaming = false;
      cold.put = async () => {
        throw new Error("upload refused");
      };
      const source = path.join(dir, "source.txt");
      await writeFile(source, "kept");
      const reg = new AdapterRegistry();
      reg.register(cold);
      const queue = new TransferCoordinator({
        dir,
        registry: reg,
        local: new LocalAdapter(dir),
        accounts: () => [s3Account("s3-a")],
        concurrency: 1,
        tempDir: spool,
        onTempFile: (file) => seen.push(file),
      });
      const job = queue.enqueue({
        ...makeJob("move", source, "remote.txt"),
        source: { storeId: "local", provider: "local", container: "", key: source },
        dest: { storeId: "s3-a", provider: "s3", container: "box", key: "refused.txt" },
      });
      await settle(job);
      expect(job.status).toBe("error");
      expect(await readFile(source, "utf8")).toBe("kept");
      expect(seen).toHaveLength(1);
      expect(await readdirOrEmpty(spool)).toEqual([]);
    } finally {
      await removeTree(dir);
    }
  });

  it("cancels a transfer before deleting the source and removes a spool", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "cloudfs-cancel-"));
    const spool = path.join(dir, "spool");
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const waiting = new S3Adapter(() => s3.client());
      waiting.streaming = false;
      waiting.put = (_account, _container, _key, stream, opts) =>
        new Promise((_resolve, reject) => {
          release?.();
          const fail = () => {
            stream.destroy();
            reject(new Error("aborted"));
          };
          if (opts.signal?.aborted) fail();
          else opts.signal?.addEventListener("abort", fail, { once: true });
        });
      const source = path.join(dir, "source.txt");
      await writeFile(source, "cancel-me");
      const reg = new AdapterRegistry();
      reg.register(waiting);
      const queue = new TransferCoordinator({
        dir,
        registry: reg,
        local: new LocalAdapter(dir),
        accounts: () => [s3Account("s3-a")],
        concurrency: 1,
        tempDir: spool,
      });
      const job = queue.enqueue({
        ...makeJob("move", source, "remote.txt"),
        source: { storeId: "local", provider: "local", container: "", key: source },
        dest: { storeId: "s3-a", provider: "s3", container: "box", key: "cancelled.txt" },
      });
      await started;
      queue.queue.cancel(job.id);
      await settle(job);
      const deadline = Date.now() + 5_000;
      while ((await readdirOrEmpty(spool)).length > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(job.status).toBe("cancelled");
      expect(await readFile(source, "utf8")).toBe("cancel-me");
      expect(await readdirOrEmpty(spool)).toEqual([]);
    } finally {
      await removeTree(dir);
    }
  });

  it("renames inside each provider and leaves the source when the new name exists", async () => {
    seed("local", "plain.txt", Buffer.from("local-name"));
    await renameEntry({
      local,
      registry,
      account: null,
      provider: "local",
      container: "",
      from: path.join(localRoot, "plain.txt"),
      toName: "plain-renamed.txt",
    });
    expect(stored("local", "plain-renamed.txt")).toEqual(Buffer.from("local-name"));
    expect(stored("local", "plain.txt")).toBeUndefined();

    seed("s3", "object.txt", Buffer.from("s3-name"));
    s3.calls.length = 0;
    await renameEntry({
      local,
      registry,
      account: accounts[0] ?? null,
      provider: "s3",
      container: "box",
      from: "object.txt",
      toName: "object-renamed.txt",
    });
    expect(s3.calls).toContain("CopyObjectCommand");
    expect(s3.calls).not.toContain("GetObjectCommand");
    expect(stored("s3", "object-renamed.txt")).toEqual(Buffer.from("s3-name"));
    expect(stored("s3", "object.txt")).toBeUndefined();

    seed("ftp", "remote.txt", Buffer.from("ftp-name"));
    ftpA.commands.length = 0;
    await renameEntry({
      local,
      registry,
      account: accounts[2] ?? null,
      provider: "ftp",
      container: "",
      from: "remote.txt",
      toName: "remote-renamed.txt",
    });
    expect(ftpA.commands).toContain("RNFR");
    expect(ftpA.commands).not.toContain("RETR");
    expect(ftpA.commands).not.toContain("DELE");
    expect(ftpA.read("/remote-renamed.txt")).toEqual(Buffer.from("ftp-name"));
    expect(ftpA.exists("/remote.txt")).toBe(false);

    seed("s3", "taken-a.txt", Buffer.from("a"));
    seed("s3", "taken-b.txt", Buffer.from("b"));
    await expect(
      renameEntry({
        local,
        registry,
        account: accounts[0] ?? null,
        provider: "s3",
        container: "box",
        from: "taken-a.txt",
        toName: "taken-b.txt",
      }),
    ).rejects.toThrow(/already exists/);
    expect(stored("s3", "taken-a.txt")).toEqual(Buffer.from("a"));
    expect(stored("s3", "taken-b.txt")).toEqual(Buffer.from("b"));
  });

  const treeFiles: Record<string, string> = {
    "readme.txt": "hello",
    "src/main.txt": "main",
    "blank.txt": "",
    ".keep": "secret",
  };
  const treeDirs = ["notes", "src/empty"];

  async function seedTree(side: Side, root: string, store: "a" | "b" = "a", container = "box"): Promise<void> {
    if (side === "local") {
      await mkdir(path.join(localRoot, root, "src", "empty"), { recursive: true });
      await mkdir(path.join(localRoot, root, "notes"), { recursive: true });
      for (const [relative, body] of Object.entries(treeFiles)) {
        await writeFile(path.join(localRoot, root, relative), body);
      }
      return;
    }
    if (side === "s3") {
      const memory = store === "b" ? s3b : s3;
      memory.putObject(container, `${root}/`, Buffer.alloc(0));
      memory.putObject(container, `${root}/src/`, Buffer.alloc(0));
      for (const dir of treeDirs) memory.putObject(container, `${root}/${dir}/`, Buffer.alloc(0));
      for (const [relative, body] of Object.entries(treeFiles)) {
        memory.putObject(container, `${root}/${relative}`, Buffer.from(body));
      }
      return;
    }
    const server = store === "b" ? ftpB : ftpA;
    server.makeDir(`/${root}/src/empty`);
    server.makeDir(`/${root}/notes`);
    for (const [relative, body] of Object.entries(treeFiles)) server.write(`/${root}/${relative}`, body);
  }

  function folderLocator(side: Side, root: string, store: "a" | "b" = "a", container = "box", slash = true): Locator {
    if (side === "local") return { storeId: "local", provider: "local", container: "", key: path.join(localRoot, root) };
    if (side === "s3") {
      return {
        storeId: store === "b" ? "s3-b" : "s3-a",
        provider: "s3",
        container,
        key: slash ? `${root}/` : root,
      };
    }
    return { storeId: store === "b" ? "ftp-b" : "ftp-a", provider: "ftp", container: "", key: root };
  }

  function treeBytes(side: Side, root: string, relative: string, store: "a" | "b" = "a", container = "box"): Buffer | undefined {
    if (side === "local") {
      try {
        return readFileSync(path.join(localRoot, root, relative));
      } catch {
        return undefined;
      }
    }
    if (side === "s3") return (store === "b" ? s3b : s3).getObject(container, `${root}/${relative}`);
    return (store === "b" ? ftpB : ftpA).read(`/${root}/${relative}`);
  }

  function treeDir(side: Side, root: string, relative: string, store: "a" | "b" = "a", container = "box"): boolean {
    if (side === "local") {
      try {
        return statSync(path.join(localRoot, root, relative)).isDirectory();
      } catch {
        return false;
      }
    }
    if (side === "s3") return (store === "b" ? s3b : s3).getObject(container, `${root}/${relative}/`) != null;
    const server = store === "b" ? ftpB : ftpA;
    const full = `/${root}/${relative}`;
    return server.exists(full) && server.read(full) === undefined;
  }

  function expectTree(side: Side, root: string, store: "a" | "b" = "a", container = "box"): void {
    for (const [relative, body] of Object.entries(treeFiles)) {
      expect(treeBytes(side, root, relative, store, container)?.toString(), relative).toBe(body);
    }
    for (const dir of treeDirs) expect(treeDir(side, root, dir, store, container), dir).toBe(true);
  }

  function expectTreeGone(side: Side, root: string, store: "a" | "b" = "a", container = "box"): void {
    expect(treeBytes(side, root, "readme.txt", store, container)).toBeUndefined();
    if (side === "local") {
      expect(() => statSync(path.join(localRoot, root))).toThrow();
      return;
    }
    if (side === "s3") {
      expect((store === "b" ? s3b : s3).getObject(container, `${root}/`)).toBeUndefined();
      return;
    }
    expect((store === "b" ? ftpB : ftpA).exists(`/${root}`)).toBe(false);
  }

  async function runFolder(
    mode: "copy" | "move",
    from: Side,
    to: Side,
    label: string,
    extra: { fromStore?: "a" | "b"; toStore?: "a" | "b"; fromContainer?: string; toContainer?: string; sourceKind?: boolean } = {},
  ): Promise<TransferJob> {
    const fromStore = extra.fromStore ?? "a";
    const toStore = extra.toStore ?? "a";
    const fromContainer = extra.fromContainer ?? "box";
    const toContainer = extra.toContainer ?? "box";
    await seedTree(from, `${label}-src`, fromStore, fromContainer);
    const source = folderLocator(from, `${label}-src`, fromStore, fromContainer);
    const dest = folderLocator(to, `${label}-dst`, toStore, toContainer, false);
    const kind: JobKind =
      mode === "move" ? "move" : from === "local" && to !== "local" ? "upload" : from !== "local" && to === "local" ? "download" : "copy";
    const job = coordinator.enqueue({
      id: randomUUID(),
      kind,
      source,
      dest,
      name: `${label}-src`,
      bytesDone: 0,
      status: "queued",
      createdAt: new Date().toISOString(),
      ...(extra.sourceKind === false ? {} : { sourceKind: "folder" as const }),
    });
    const started = Date.now();
    while (job.status === "queued" || job.status === "running" || job.status === "paused") {
      if (Date.now() - started > 20_000) throw new Error(`folder transfer stuck at ${job.status}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return job;
  }

  for (const from of providers) {
    for (const to of providers) {
      for (const mode of ["copy", "move"] as const) {
        it(`${mode}s a nested folder from ${from} to ${to}`, async () => {
          const label = `folder-${from}-${to}-${mode}`;
          const job = await runFolder(mode, from, to, label);
          expect(job.status, job.error).toBe("done");
          expectTree(to, `${label}-dst`);
          if (mode === "move") expectTreeGone(from, `${label}-src`);
          else expectTree(from, `${label}-src`);
          expect(tempFiles).toEqual([]);
          if (from === "s3" && to === "s3") {
            expect(s3.calls).toContain("CopyObjectCommand");
            expect(s3.calls).not.toContain("GetObjectCommand");
            if (mode === "move") expect(s3.calls).toContain("DeleteObjectsCommand");
          }
          if (from === "ftp" && to === "ftp" && mode === "move") {
            expect(ftpA.commands).toContain("RNFR");
            expect(ftpA.commands).not.toContain("RETR");
            expect(ftpA.commands).not.toContain("STOR");
          } else if (from === "ftp" || to === "ftp") {
            if (from === "ftp") expect(ftpA.commands).toContain("RETR");
            if (to === "ftp") expect(ftpA.commands).toContain("STOR");
            expect(ftpA.commands).not.toContain("RNFR");
          }
        }, 30_000);
      }
    }
  }

  it("copies a folder between buckets on one S3 account without downloading", async () => {
    const job = await runFolder("copy", "s3", "s3", "folder-buckets", { toContainer: "other" });
    expect(job.status, job.error).toBe("done");
    expectTree("s3", "folder-buckets-dst", "a", "other");
    expectTree("s3", "folder-buckets-src");
    expect(s3.calls).toContain("CopyObjectCommand");
    expect(s3.calls).not.toContain("GetObjectCommand");
    expect(tempFiles).toEqual([]);
  });

  it("streams a folder between two S3 accounts", async () => {
    const job = await runFolder("move", "s3", "s3", "folder-accounts", { toStore: "b" });
    expect(job.status, job.error).toBe("done");
    expectTree("s3", "folder-accounts-dst", "b");
    expectTreeGone("s3", "folder-accounts-src");
    expect(s3.calls).toContain("GetObjectCommand");
    expect(s3.calls).not.toContain("CopyObjectCommand");
    expect(s3b.calls).toContain("PutObjectCommand");
    expect(s3b.calls).not.toContain("CopyObjectCommand");
    expect(tempFiles).toEqual([]);
  });

  it("copies an S3 prefix that has no folder marker", async () => {
    s3.putObject("box", "implicit/readme.txt", Buffer.from("hello"));
    s3.putObject("box", "implicit/src/main.txt", Buffer.from("main"));
    const job = coordinator.enqueue({
      id: randomUUID(),
      kind: "download",
      source: folderLocator("s3", "implicit"),
      dest: folderLocator("local", "implicit-dst", "a", "box", false),
      name: "implicit",
      bytesDone: 0,
      status: "queued",
      createdAt: new Date().toISOString(),
    });
    const started = Date.now();
    while (job.status === "queued" || job.status === "running") {
      if (Date.now() - started > 15_000) throw new Error(`folder transfer stuck at ${job.status}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(job.status, job.error).toBe("done");
    expect(treeBytes("local", "implicit-dst", "readme.txt")?.toString()).toBe("hello");
    expect(treeBytes("local", "implicit-dst", "src/main.txt")?.toString()).toBe("main");
  });

  it("detects a local folder when the job does not say it is one", async () => {
    const job = await runFolder("copy", "local", "s3", "folder-detect", { sourceKind: false });
    expect(job.status, job.error).toBe("done");
    expectTree("s3", "folder-detect-dst");
    expectTree("local", "folder-detect-src");
  });

  it("reports one folder job's progress as the sum of its files", async () => {
    const root = "folder-progress-src";
    await mkdir(path.join(localRoot, root), { recursive: true });
    const body = Buffer.alloc(32 * 1024, 4);
    await writeFile(path.join(localRoot, root, "big.bin"), body);
    await writeFile(path.join(localRoot, root, "small.txt"), "ok");
    const job = coordinator.enqueue({
      id: randomUUID(),
      kind: "copy",
      sourceKind: "folder",
      source: folderLocator("local", root),
      dest: folderLocator("local", "folder-progress-dst", "a", "box", false),
      name: root,
      bytesDone: 0,
      status: "queued",
      createdAt: new Date().toISOString(),
    });
    const started = Date.now();
    while (job.status === "queued" || job.status === "running") {
      if (Date.now() - started > 15_000) throw new Error(`folder transfer stuck at ${job.status}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(job.status, job.error).toBe("done");
    expect(job.bytesTotal).toBe(body.length + 2);
    expect(job.bytesDone).toBe(body.length + 2);
    expect(progress.some((bytes) => bytes > 0 && bytes < body.length + 2)).toBe(true);
    expect(readFileSync(path.join(localRoot, "folder-progress-dst", "big.bin"))).toEqual(body);
  });

  it("keeps the source folder when a nested upload fails", async () => {
    ftpA.dropNext = true;
    const job = await runFolder("move", "local", "ftp", "folder-drop");
    expect(job.status).toBe("error");
    expect(job.error).toMatch(/src\/main\.txt/);
    expectTree("local", "folder-drop-src");
    expect(tempFiles).toEqual([]);
  });

  it("does not create a destination when the source folder is missing", async () => {
    const job = coordinator.enqueue({
      id: randomUUID(),
      kind: "upload",
      sourceKind: "folder",
      source: folderLocator("local", "missing-folder"),
      dest: folderLocator("s3", "missing-folder-dst", "a", "box", false),
      name: "missing-folder",
      bytesDone: 0,
      status: "queued",
      createdAt: new Date().toISOString(),
    });
    const started = Date.now();
    while (job.status === "queued" || job.status === "running") {
      if (Date.now() - started > 15_000) throw new Error(`folder transfer stuck at ${job.status}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(job.status).toBe("error");
    expect(job.error).toMatch(/not found/);
    expect(s3.getObject("box", "missing-folder-dst/")).toBeUndefined();
  });

  it("refuses to copy a folder into itself", async () => {
    await seedTree("local", "loop");
    const job = coordinator.enqueue({
      id: randomUUID(),
      kind: "copy",
      sourceKind: "folder",
      source: folderLocator("local", "loop"),
      dest: folderLocator("local", path.join("loop", "inner"), "a", "box", false),
      name: "loop",
      bytesDone: 0,
      status: "queued",
      createdAt: new Date().toISOString(),
    });
    const started = Date.now();
    while (job.status === "queued" || job.status === "running") {
      if (Date.now() - started > 15_000) throw new Error(`folder transfer stuck at ${job.status}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(job.status).toBe("error");
    expect(job.error).toMatch(/itself/);
    expectTree("local", "loop");
    expect(treeDir("local", "loop", "inner")).toBe(false);
  });

  it("falls back to a recursive copy when a local folder rename crosses devices", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "cloudfs-folder-exdev-"));
    try {
      const source = path.join(dir, "docs");
      const dest = path.join(dir, "out");
      await mkdir(path.join(source, "empty"), { recursive: true });
      await writeFile(path.join(source, "a.txt"), "cross");
      const crossed = new LocalAdapter(dir);
      crossed.rename = async () => {
        const error = new Error("cross device") as NodeJS.ErrnoException;
        error.code = "EXDEV";
        throw error;
      };
      const queue = new TransferCoordinator({
        dir,
        registry: new AdapterRegistry(),
        local: crossed,
        accounts: () => [],
        concurrency: 1,
        tempDir: path.join(dir, "temp"),
        onTempFile: () => {
          throw new Error("folder move should stream, not spool");
        },
      });
      const job = queue.enqueue({
        ...makeJob("move", source, dest),
        sourceKind: "folder",
        name: "docs",
      });
      await settle(job);
      expect(job.status, job.error).toBe("done");
      expect(await readFile(path.join(dest, "a.txt"), "utf8")).toBe("cross");
      expect(statSync(path.join(dest, "empty")).isDirectory()).toBe(true);
      expect(() => statSync(source)).toThrow();
    } finally {
      await removeTree(dir);
    }
  });

  async function runDelete(source: Locator, name: string, sourceKind?: "file" | "folder"): Promise<TransferJob> {
    const job = coordinator.enqueue({
      id: randomUUID(),
      kind: "delete",
      source,
      dest: source,
      name,
      bytesDone: 0,
      status: "queued",
      createdAt: new Date().toISOString(),
      ...(sourceKind ? { sourceKind } : {}),
    });
    const started = Date.now();
    while (job.status === "queued" || job.status === "running" || job.status === "paused") {
      if (Date.now() - started > 20_000) throw new Error(`delete stuck at ${job.status}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return job;
  }

  function expectRemoved(side: Side, root: string): void {
    expect(treeBytes(side, root, "readme.txt"), "readme").toBeUndefined();
    expect(treeBytes(side, root, "src/main.txt"), "nested file").toBeUndefined();
    expect(treeBytes(side, root, ".keep"), "hidden file").toBeUndefined();
    expect(treeBytes(side, root, "blank.txt"), "empty file").toBeUndefined();
    expect(treeDir(side, root, "notes"), "empty notes").toBe(false);
    expect(treeDir(side, root, "src/empty"), "nested empty dir").toBe(false);
    if (side === "local") {
      expect(() => statSync(path.join(localRoot, root))).toThrow();
      return;
    }
    if (side === "s3") {
      expect(s3.getObject("box", `${root}/`), "folder marker").toBeUndefined();
      expect(s3.getObject("box", `${root}/src/`), "nested marker").toBeUndefined();
      return;
    }
    expect(ftpA.exists(`/${root}`)).toBe(false);
  }

  for (const side of providers) {
    it(`deletes a nested folder on ${side} and leaves a sibling`, async () => {
      const root = `del-nested-${side}`;
      const keep = `del-nested-${side}-keep.txt`;
      await seedTree(side, root);
      seed(side, keep, Buffer.from("keep"));
      if (side === "s3") s3.pageSize = 1;
      try {
        const job = await runDelete(folderLocator(side, root), root, "folder");
        expect(job.status, job.error).toBe("done");
        expectRemoved(side, root);
        expect(stored(side, keep)?.toString()).toBe("keep");
      } finally {
        if (side === "s3") s3.pageSize = 1000;
      }
    }, 30_000);

    it(`deletes an empty folder on ${side}`, async () => {
      const root = `del-empty-${side}`;
      if (side === "local") await mkdir(path.join(localRoot, root));
      else if (side === "s3") s3.putObject("box", `${root}/`, Buffer.alloc(0));
      else ftpA.makeDir(`/${root}`);
      const job = await runDelete(folderLocator(side, root), root, "folder");
      expect(job.status, job.error).toBe("done");
      if (side === "local") expect(() => statSync(path.join(localRoot, root))).toThrow();
      else if (side === "s3") expect(s3.getObject("box", `${root}/`)).toBeUndefined();
      else expect(ftpA.exists(`/${root}`)).toBe(false);
    });

    it(`deletes one file on ${side} and leaves the rest of the folder`, async () => {
      const root = `del-file-${side}`;
      await seedTree(side, root);
      const relative = side === "local" ? path.join(root, "readme.txt") : `${root}/readme.txt`;
      const job = await runDelete(locator(side, relative), "readme.txt", "file");
      expect(job.status, job.error).toBe("done");
      expect(treeBytes(side, root, "readme.txt")).toBeUndefined();
      expect(treeBytes(side, root, "src/main.txt")?.toString()).toBe("main");
      expect(treeDir(side, root, "notes")).toBe(true);
      if (side === "local") expect(statSync(path.join(localRoot, root)).isDirectory()).toBe(true);
      else if (side === "s3") expect(s3.getObject("box", `${root}/`)).toBeDefined();
      else expect(ftpA.exists(`/${root}`)).toBe(true);
    });
  }

  it("deletes an S3 prefix that has no folder marker", async () => {
    s3.putObject("box", "implicit-del/readme.txt", Buffer.from("hello"));
    s3.putObject("box", "implicit-del/src/main.txt", Buffer.from("main"));
    s3.putObject("box", "implicit-del-extra/keep.txt", Buffer.from("keep"));
    s3.pageSize = 1;
    try {
      const job = await runDelete(folderLocator("s3", "implicit-del"), "implicit-del");
      expect(job.status, job.error).toBe("done");
      expect(s3.getObject("box", "implicit-del/readme.txt")).toBeUndefined();
      expect(s3.getObject("box", "implicit-del/src/main.txt")).toBeUndefined();
      expect(s3.getObject("box", "implicit-del/")).toBeUndefined();
      expect(s3.getObject("box", "implicit-del-extra/keep.txt")?.toString()).toBe("keep");
    } finally {
      s3.pageSize = 1000;
    }
  });

  it("deletes an S3 file without deleting a prefix that shares its name", async () => {
    s3.putObject("box", "samename", Buffer.from("file"));
    s3.putObject("box", "samename/child.txt", Buffer.from("child"));
    const job = await runDelete(locator("s3", "samename"), "samename", "file");
    expect(job.status, job.error).toBe("done");
    expect(s3.getObject("box", "samename")).toBeUndefined();
    expect(s3.getObject("box", "samename/child.txt")?.toString()).toBe("child");
  });
});

function s3Account(id: string): Account {
  return {
    id,
    provider: "s3",
    displayName: id,
    settings: { accessKeyId: "key", secretAccessKey: "secret", region: "us-east-1", ssl: false, endpoint: "http://127.0.0.1" },
  };
}

function ftpAccount(id: string, port: number): Account {
  return {
    id,
    provider: "ftp",
    displayName: id,
    settings: { host: "127.0.0.1", port, user: "user", password: "secret", secure: false, startDir: "" },
  };
}

function makeJob(kind: JobKind, source: string, dest: string): TransferJob {
  const from: Locator = { storeId: "local", provider: "local", container: "", key: source };
  const to: Locator = { storeId: "local", provider: "local", container: "", key: dest };
  return {
    id: randomUUID(),
    kind,
    source: from,
    dest: to,
    name: path.basename(source),
    bytesDone: 0,
    status: "queued",
    createdAt: new Date().toISOString(),
  };
}

async function settle(job: TransferJob): Promise<void> {
  const started = Date.now();
  while (job.status === "queued" || job.status === "running" || job.status === "paused") {
    if (Date.now() - started > 15_000) throw new Error(`transfer stuck at ${job.status}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function storedMissing(file: string): boolean {
  try {
    statSync(file);
    return false;
  } catch {
    return true;
  }
}

async function readdirOrEmpty(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** persist() can recreate a file while the directory is being removed. */
async function removeTree(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    await rm(dir, { recursive: true, force: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOTEMPTY") throw error;
    });
    try {
      await fsStat(dir);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await rm(dir, { recursive: true, force: true });
}
