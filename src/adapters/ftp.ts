import { Client, FileType, type FileInfo } from "basic-ftp";
import { PassThrough, Readable, Transform, Writable } from "node:stream";
import type { Account, CopyRequest, Entry, EntryStat, GetOptions, PutOptions, StoreAdapter } from "../core/store";
import { isFtpSettings } from "../core/store";

/** The slice of basic-ftp this adapter uses. Tests pass a fake. */
export interface FtpSession {
  list(path?: string): Promise<FileInfo[]>;
  pwd(): Promise<string>;
  rename(srcPath: string, destPath: string): Promise<unknown>;
  remove(path: string): Promise<unknown>;
  uploadFrom(source: Readable | string, toRemotePath: string): Promise<unknown>;
  downloadTo(destination: Writable | string, fromRemotePath: string): Promise<unknown>;
  ensureDir(remoteDirPath: string): Promise<void>;
  cd(path: string): Promise<unknown>;
  close(): void;
}

export interface FtpSessionFactory {
  (account: Account): Promise<FtpSession>;
}

function requireSettings(account: Account) {
  if (!isFtpSettings(account.settings)) throw new Error("FTP account is missing host, port, user, or password.");
  if (account.settings.secure) throw new Error("FTPS is not available yet. Leave secure off.");
  return account.settings;
}

export function ftpPath(startDir: string, prefix: string): string {
  const root = startDir.replace(/\/+$/, "");
  const rel = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!root && !rel) return "/";
  if (!rel) return root || "/";
  return `${root}/${rel}`.replace(/\/{2,}/g, "/");
}

export async function openFtpSession(account: Account): Promise<FtpSession> {
  const settings = requireSettings(account);
  const client = new Client(20_000);
  await client.access({
    host: settings.host,
    port: settings.port,
    user: settings.user || "anonymous",
    password: settings.password,
    secure: false,
  });
  return client;
}

function toEntry(startDir: string, info: FileInfo): Entry | null {
  if (info.name === "." || info.name === "..") return null;
  const key = ftpPath(startDir, info.name);
  const folder = info.type === FileType.Directory || info.type === FileType.SymbolicLink && info.name.endsWith("/");
  return {
    name: info.name,
    key,
    kind: info.type === FileType.Directory ? "folder" : folder ? "folder" : "file",
    size: info.type === FileType.Directory ? undefined : info.size,
    modified: info.modifiedAt?.toISOString(),
  };
}

export class FtpAdapter implements StoreAdapter {
  id = "ftp" as const;
  label = "FTP";
  available = true;

  constructor(private factory: FtpSessionFactory = openFtpSession) {}

  private async session<T>(account: Account, run: (client: FtpSession, startDir: string) => Promise<T>): Promise<T> {
    const settings = requireSettings(account);
    const client = await this.factory(account);
    try {
      return await run(client, settings.startDir);
    } finally {
      client.close();
    }
  }

  async test(account: Account): Promise<void> {
    await this.session(account, async (client) => {
      await client.pwd();
    });
  }

  listContainers(): Promise<Entry[]> {
    return Promise.resolve([]);
  }

  async list(account: Account, _container: string, prefix: string): Promise<Entry[]> {
    return this.session(account, async (client, startDir) => {
      const dir = ftpPath(startDir, prefix);
      const rows = await client.list(dir);
      return rows
        .map((row) => {
          const entry = toEntry(dir, row);
          return entry;
        })
        .filter((entry): entry is Entry => entry !== null)
        .sort((a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || a.name.localeCompare(b.name));
    });
  }

  async put(account: Account, _container: string, key: string, stream: Readable, opts: PutOptions): Promise<void> {
    await this.session(account, async (client, startDir) => {
      if (opts.signal?.aborted) throw new Error("aborted");
      // Count bytes in a transform. A "data" listener would drain the source
      // before uploadFrom starts reading it, and the upload would be empty.
      let done = 0;
      const tap = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          done += chunk.length;
          opts.onProgress?.(done, opts.size);
          callback(null, chunk);
        },
      });
      const abort = () => {
        const error = new Error("aborted");
        stream.destroy(error);
        tap.destroy(error);
      };
      opts.signal?.addEventListener("abort", abort, { once: true });
      // uploadFrom is the only reader. Piping (not a second pipeline into `tap`)
      // keeps the source from being drained before STOR starts.
      let streamError: Error | undefined;
      const note = (error: Error) => {
        streamError ??= error;
      };
      stream.once("error", note);
      tap.once("error", note);
      stream.pipe(tap);
      try {
        await client.uploadFrom(tap, ftpPath(startDir, key));
      } catch (error) {
        throw streamError ?? error;
      } finally {
        opts.signal?.removeEventListener("abort", abort);
        stream.unpipe(tap);
      }
      if (streamError) throw streamError;
      opts.onProgress?.(done, opts.size);
    });
  }

  async get(account: Account, _container: string, key: string, opts?: GetOptions): Promise<Readable> {
    const settings = requireSettings(account);
    const client = await this.factory(account);
    const out = new PassThrough();
    const remote = ftpPath(settings.startDir, key);
    // basic-ftp ends the destination in a finally block even when RETR fails.
    // Forward bytes here, and end the caller's stream only after downloadTo settles,
    // so a dropped connection is an error rather than an empty file.
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        if (out.write(chunk)) callback();
        else out.once("drain", callback);
      },
    });
    sink.on("error", () => undefined);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) out.destroy(error);
      else out.end();
      client.close();
    };
    void client.downloadTo(sink, remote).then(
      () => finish(),
      (error: unknown) => finish(error instanceof Error ? error : new Error("FTP download failed.")),
    );
    if (opts?.signal) {
      const abort = () => {
        sink.destroy(new Error("aborted"));
        finish(new Error("aborted"));
      };
      if (opts.signal.aborted) abort();
      else opts.signal.addEventListener("abort", abort, { once: true });
    }
    return out;
  }

  async remove(account: Account, _container: string, keys: string[]): Promise<void> {
    await this.session(account, async (client, startDir) => {
      for (const key of keys) {
        await client.remove(ftpPath(startDir, key));
      }
    });
  }

  /** Same-server move uses rename. A copy has no FTP command, so the bytes stream inside this adapter. */
  async copy(account: Account, request: CopyRequest): Promise<void> {
    if (request.move) {
      await this.session(account, async (client, startDir) => {
        await client.rename(ftpPath(startDir, request.from.key), ftpPath(startDir, request.to.key));
        request.onProgress?.(request.size ?? 0, request.size);
      });
      return;
    }
    const source = await this.get(account, request.from.container, request.from.key, { signal: request.signal });
    await this.put(account, request.to.container, request.to.key, source, {
      size: request.size,
      signal: request.signal,
      onProgress: request.onProgress,
    });
  }

  async mkdir(account: Account, _container: string, prefix: string): Promise<void> {
    await this.session(account, async (client, startDir) => {
      await client.ensureDir(ftpPath(startDir, prefix));
    });
  }

  async stat(account: Account, _container: string, key: string): Promise<EntryStat> {
    return this.session(account, async (client, startDir) => {
      const full = ftpPath(startDir, key);
      const slash = full.lastIndexOf("/");
      const parent = slash <= 0 ? "/" : full.slice(0, slash);
      const name = full.slice(slash + 1);
      let rows: FileInfo[];
      try {
        rows = await client.list(parent);
      } catch (error) {
        if (isFtpMissing(error)) return { exists: false };
        throw error;
      }
      const match = rows.find((row) => row.name === name);
      if (!match) return { exists: false };
      const folder = match.type === FileType.Directory;
      return {
        exists: true,
        kind: folder ? "folder" : "file",
        size: folder || !Number.isFinite(match.size) ? undefined : match.size,
      };
    });
  }
}

function isFtpMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = error instanceof Error ? error.message : "";
  if (/permission denied/i.test(message)) return false;
  const code = (error as { code?: number }).code;
  return code === 450 || code === 550;
}
