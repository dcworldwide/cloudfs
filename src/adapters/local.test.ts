import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Account } from "../core/store";
import { bufferStream, readAll } from "../testing/streams";
import { describeEntry, LocalAdapter, parsePowerShellDrives, parseWmicDrives, type LocalHost } from "./local";

const account: Account = { id: "local", provider: "s3", displayName: "This Computer", settings: {} };
const root = typeof process.getuid === "function" && process.getuid() === 0;

describe("LocalAdapter", () => {
  let dir = "";
  const adapter = new LocalAdapter(os.tmpdir());

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  async function scratch(): Promise<string> {
    dir = await mkdtemp(path.join(os.tmpdir(), "cloudfs-local-"));
    return dir;
  }

  it("lists files and folders and skips dotfiles", async () => {
    const rootDir = await scratch();
    await mkdir(path.join(rootDir, "docs"));
    await writeFile(path.join(rootDir, "notes.txt"), "hello");
    await writeFile(path.join(rootDir, ".hidden"), "secret");
    const entries = await adapter.list(account, "", rootDir);
    expect(entries.map((entry) => entry.name)).toEqual(["docs", "notes.txt"]);
    expect(entries[0]?.kind).toBe("folder");
    expect(entries[1]).toMatchObject({ kind: "file", size: 5 });
  });

  it("writes, reads, copies, renames, and deletes a streamed file", async () => {
    const rootDir = await scratch();
    const source = path.join(rootDir, "notes.txt");
    const copied = path.join(rootDir, "copy.txt");
    const renamed = path.join(rootDir, "renamed.txt");
    const body = Buffer.alloc(128 * 1024, 7);
    await adapter.put(account, "", source, bufferStream(body, 4096), { size: body.length });
    expect(await readAll(await adapter.get(account, "", source))).toEqual(body);
    await adapter.copy(account, {
      from: { storeId: "local", provider: "local", container: "", key: source },
      to: { storeId: "local", provider: "local", container: "", key: copied },
      size: body.length,
    });
    expect(await readFile(copied)).toEqual(body);
    await adapter.rename(source, renamed);
    expect(await adapter.stat(account, "", source)).toEqual({ exists: false });
    expect(await adapter.stat(account, "", renamed)).toMatchObject({ exists: true, kind: "file", size: body.length });
    await adapter.remove(account, "", [renamed, copied]);
    expect(await adapter.stat(account, "", renamed)).toEqual({ exists: false });
  });

  it("creates a directory and refuses to rename over an existing file", async () => {
    const rootDir = await scratch();
    const folder = path.join(rootDir, "nested", "docs");
    await adapter.mkdir(account, "", folder);
    expect(await adapter.stat(account, "", folder)).toMatchObject({ exists: true, kind: "folder" });
    const left = path.join(rootDir, "a.txt");
    const right = path.join(rootDir, "b.txt");
    await writeFile(left, "a");
    await writeFile(right, "b");
    await expect(adapter.rename(left, right)).rejects.toThrow(/already exists/);
    expect(await readFile(left, "utf8")).toBe("a");
  });

  it("reports a missing file", async () => {
    const rootDir = await scratch();
    const missing = path.join(rootDir, "missing.txt");
    expect(await adapter.stat(account, "", missing)).toEqual({ exists: false });
    const stream = await adapter.get(account, "", missing);
    await expect(readAll(stream)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps a folder when stat fails, the way a Windows junction does", async () => {
    const rootDir = await scratch();
    const junction = path.join(rootDir, "ProgramData");
    await mkdir(junction);
    const denied = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    const described = await describeEntry(
      { name: "ProgramData", isDirectory: () => true, isSymbolicLink: () => false },
      junction,
      async () => {
        throw denied;
      },
      async () => {
        throw denied;
      },
    );
    expect(described).toMatchObject({ name: "ProgramData", kind: "folder" });
  });

  it("lists every mounted Windows drive instead of one home folder", async () => {
    const host: LocalHost = {
      platform: "win32",
      drives: async () => [
        { root: "C:\\", label: "Windows (C:)" },
        { root: "D:\\", label: "Data (D:)" },
      ],
    };
    const listing = new LocalAdapter("C:\\Users\\someone", host);
    const drives = await listing.list(account, "", "");
    expect(drives.map((entry) => entry.key)).toEqual(["C:\\", "D:\\"]);
    expect(drives.every((entry) => entry.kind === "folder")).toBe(true);
  });

  it("reads drive letters from wmic and PowerShell", () => {
    const wmic = ["DeviceID  VolumeName", "C:        Windows", "D:        ", "E:        Backup"].join("\r\n");
    expect(parseWmicDrives(wmic).map((drive) => drive.label)).toEqual(["Windows (C:)", "D:", "Backup (E:)"]);
    const powershell = JSON.stringify([
      { DeviceID: "C:", VolumeName: "OS" },
      { DeviceID: "Z:", VolumeName: "" },
    ]);
    expect(parsePowerShellDrives(powershell).map((drive) => drive.root)).toEqual(["C:\\", "Z:\\"]);
  });

  it.skipIf(root)("reports a permission failure", async () => {
    const rootDir = await scratch();
    const locked = path.join(rootDir, "locked");
    await mkdir(locked);
    await writeFile(path.join(locked, "secret.txt"), "nope");
    await chmod(locked, 0o000);
    try {
      await expect(adapter.list(account, "", locked)).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      await chmod(locked, 0o700);
    }
  });
});
