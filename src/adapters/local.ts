import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Account, CopyRequest, Entry, GetOptions, PutOptions, StoreAdapter } from "../core/store";

export class LocalAdapter implements StoreAdapter {
  id = "local" as const;
  label = "This Computer";
  available = true;

  constructor(private home: string) {}

  test(): Promise<void> {
    return Promise.resolve();
  }

  listContainers(): Promise<Entry[]> {
    return Promise.resolve([]);
  }

  resolve(key: string): string {
    if (!key) return this.home;
    const resolved = path.resolve(key);
    return resolved;
  }

  async list(_account: Account, _container: string, prefix: string): Promise<Entry[]> {
    const dir = this.resolve(prefix);
    const names = await readdir(dir);
    const entries: Entry[] = [];
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const full = path.join(dir, name);
      try {
        const info = await stat(full);
        entries.push({
          name,
          key: full,
          kind: info.isDirectory() ? "folder" : "file",
          size: info.isDirectory() ? undefined : info.size,
          modified: info.mtime.toISOString(),
        });
      } catch {
        // A file can disappear between readdir and stat.
      }
    }
    return entries.sort((a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || a.name.localeCompare(b.name));
  }

  async put(_account: Account, _container: string, key: string, stream: Readable, opts: PutOptions): Promise<void> {
    await mkdir(path.dirname(key), { recursive: true });
    const flags = opts.resume && opts.resume.bytesDone > 0 ? "a" : "w";
    let bytesDone = opts.resume?.bytesDone ?? 0;
    await pipeline(stream, createWriteStream(key, { flags }));
    const info = await stat(key);
    bytesDone = info.size;
    opts.onProgress?.(bytesDone, opts.size);
  }

  get(_account: Account, _container: string, key: string, opts?: GetOptions): Promise<Readable> {
    const start = opts?.range?.start;
    const end = opts?.range?.end;
    return Promise.resolve(createReadStream(key, { start, end }));
  }

  async remove(_account: Account, _container: string, keys: string[]): Promise<void> {
    for (const key of keys) {
      await rm(key, { recursive: true, force: true });
    }
  }

  async copy(_account: Account, request: CopyRequest): Promise<void> {
    await mkdir(path.dirname(request.to.key), { recursive: true });
    await pipeline(createReadStream(request.from.key), createWriteStream(request.to.key));
    request.onProgress?.(request.size ?? 0, request.size);
  }

  async mkdir(_account: Account, _container: string, prefix: string): Promise<void> {
    await mkdir(prefix, { recursive: true });
  }

  async rename(from: string, to: string): Promise<void> {
    if (from !== to) {
      try {
        await access(to);
        throw new Error(`"${path.basename(to)}" already exists.`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await rename(from, to);
  }

  async touch(file: string): Promise<void> {
    await writeFile(file, "");
  }
}
