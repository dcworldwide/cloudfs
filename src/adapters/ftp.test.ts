import { FileType, type FileInfo } from "basic-ftp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import type { Account } from "../core/store";
import { TestFtpServer } from "../testing/ftp-server";
import { bufferStream, readAll } from "../testing/streams";
import { FtpAdapter, ftpPath, type FtpSession } from "./ftp";

const account: Account = {
  id: "ftp-1",
  provider: "ftp",
  displayName: "Tele2",
  settings: { host: "speedtest.tele2.net", port: 21, user: "anonymous", password: "", secure: false, startDir: "" },
};

function fake(partial: Partial<FtpSession> & { files?: FileInfo[] }): FtpSession {
  return {
    list: async () => partial.files ?? [],
    pwd: async () => "/",
    rename: async () => undefined,
    remove: async () => undefined,
    uploadFrom: async () => undefined,
    downloadTo: async () => undefined,
    ensureDir: async () => undefined,
    cd: async () => undefined,
    close: () => undefined,
    ...partial,
  };
}

describe("ftpPath", () => {
  it("joins the login directory and the pane prefix", () => {
    expect(ftpPath("", "")).toBe("/");
    expect(ftpPath("/pub", "upload")).toBe("/pub/upload");
    expect(ftpPath("/pub/", "/upload/")).toBe("/pub/upload");
  });
});

describe("FtpAdapter", () => {
  it("lists a directory and marks folders", async () => {
    const adapter = new FtpAdapter(async () =>
      fake({
        files: [
          { name: "upload", type: FileType.Directory, size: 0 } as FileInfo,
          { name: "1KB.zip", type: FileType.File, size: 1024 } as FileInfo,
        ],
      }),
    );
    const entries = await adapter.list(account, "", "");
    expect(entries.map((entry) => entry.kind)).toEqual(["folder", "file"]);
    expect(entries[1]?.key).toBe("/1KB.zip");
  });

  it("renames on a same-server move and does not download", async () => {
    let renamed: string[] = [];
    let downloaded = false;
    const adapter = new FtpAdapter(async () =>
      fake({
        rename: async (from, to) => {
          renamed = [from, to];
        },
        downloadTo: async () => {
          downloaded = true;
        },
      }),
    );
    await adapter.copy(account, {
      from: { storeId: account.id, provider: "ftp", container: "", key: "a.txt" },
      to: { storeId: account.id, provider: "ftp", container: "", key: "incoming/a.txt" },
      move: true,
    });
    expect(renamed).toEqual(["/a.txt", "/incoming/a.txt"]);
    expect(downloaded).toBe(false);
  });

  it("rejects FTPS in this pass", async () => {
    const adapter = new FtpAdapter(async () => fake({}));
    await expect(
      adapter.test({ ...account, settings: { ...account.settings, secure: true } }),
    ).rejects.toThrow(/FTPS/);
  });

  it("uploads a stream to the remote path", async () => {
    let target = "";
    const adapter = new FtpAdapter(async () =>
      fake({
        uploadFrom: async (_source, to) => {
          target = to;
        },
      }),
    );
    await adapter.put(account, "", "incoming/a.txt", Readable.from(["hi"]), {});
    expect(target).toBe("/incoming/a.txt");
  });
});

describe("FtpAdapter against a loopback server", () => {
  const server = new TestFtpServer();
  const adapter = new FtpAdapter();
  let live: Account = account;

  beforeAll(async () => {
    const port = await server.start();
    live = { ...account, settings: { ...account.settings, host: "127.0.0.1", port, password: "secret" } };
  });

  afterAll(async () => {
    await server.stop();
  });

  it("lists, writes, reads, mkdirs, renames, stats, and deletes", async () => {
    const body = Buffer.alloc(64 * 1024, 3);
    await adapter.mkdir(live, "", "incoming");
    await adapter.put(live, "", "incoming/notes.txt", bufferStream(body, 4096), { size: body.length });
    const entries = await adapter.list(live, "", "incoming");
    expect(entries.map((entry) => entry.name)).toEqual(["notes.txt"]);
    expect(entries[0]).toMatchObject({ kind: "file", size: body.length });
    expect(await readAll(await adapter.get(live, "", "incoming/notes.txt"))).toEqual(body);
    expect(await adapter.stat(live, "", "incoming/notes.txt")).toMatchObject({ exists: true, kind: "file", size: body.length });
    server.commands.length = 0;
    await adapter.copy(live, {
      from: { storeId: live.id, provider: "ftp", container: "", key: "incoming/notes.txt" },
      to: { storeId: live.id, provider: "ftp", container: "", key: "incoming/moved.txt" },
      move: true,
      size: body.length,
    });
    expect(server.commands).toContain("RNFR");
    expect(server.commands).not.toContain("RETR");
    expect(server.read("/incoming/moved.txt")).toEqual(body);
    expect(server.exists("/incoming/notes.txt")).toBe(false);
    await adapter.remove(live, "", ["incoming/moved.txt"]);
    expect(await adapter.stat(live, "", "incoming/moved.txt")).toEqual({ exists: false });
    expect(await adapter.stat(live, "", "incoming")).toMatchObject({ exists: true, kind: "folder" });
  });

  it("reports a missing file, a permission failure, and a dropped connection", async () => {
    expect(await adapter.stat(live, "", "missing.txt")).toEqual({ exists: false });
    await expect(readAll(await adapter.get(live, "", "missing.txt"))).rejects.toThrow(/550|No such file/);
    server.write("/secret.txt", "nope");
    server.deny("/secret.txt");
    await expect(readAll(await adapter.get(live, "", "secret.txt"))).rejects.toThrow(/Permission denied/);
    server.allow("/secret.txt");
    server.write("/drop.txt", "abcdef");
    server.dropNext = true;
    await expect(readAll(await adapter.get(live, "", "drop.txt"))).rejects.toThrow(/426|ECONNRESET|aborted|closed/i);
    expect(server.read("/drop.txt")).toEqual(Buffer.from("abcdef"));
  });
});
