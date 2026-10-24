import { FileType, type FileInfo } from "basic-ftp";
import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { FtpAdapter, ftpPath, type FtpSession } from "./ftp";
import type { Account } from "../core/store";

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
