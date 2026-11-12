import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { access, lstat, mkdir, readdir, rename, rm, stat as fsStat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Account, CopyRequest, Entry, EntryStat, GetOptions, PutOptions, StoreAdapter } from "../core/store";

const execFileAsync = promisify(execFile);

export interface DriveInfo {
  /** Filesystem root, such as `C:\` or `/`. */
  root: string;
  /** What the source menu shows. */
  label: string;
}

export interface LocalHost {
  platform: NodeJS.Platform;
  /** Mounted volumes. Windows is one source per drive letter. */
  drives(): Promise<DriveInfo[]>;
}

/** The empty prefix is the drive list on Windows and the filesystem root elsewhere. */
export function isDriveList(prefix: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" && prefix === "";
}

export function driveLabel(root: string, name?: string): string {
  const letter = root.replace(/[\\/]+$/, "");
  const title = name?.trim();
  if (title && title.toLowerCase() !== letter.toLowerCase()) return `${title} (${letter})`;
  return letter || root;
}

/** Parse `wmic logicaldisk` rows. A missing tool returns no drives rather than a thrown parse. */
export function parseWmicDrives(text: string): DriveInfo[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines[0]?.toLowerCase() ?? "";
  const deviceAt = header.split(/\s{2,}/).findIndex((column) => column === "deviceid");
  const nameAt = header.split(/\s{2,}/).findIndex((column) => column === "volumename");
  const drives: DriveInfo[] = [];
  for (const line of lines.slice(1)) {
    const columns = line.split(/\s{2,}/);
    const device = (deviceAt >= 0 ? columns[deviceAt] : columns[0])?.trim();
    if (!device || !/^[A-Za-z]:$/.test(device)) continue;
    const name = nameAt >= 0 ? columns[nameAt] : undefined;
    const root = `${device}\\`;
    drives.push({ root, label: driveLabel(root, name) });
  }
  return drives.sort((a, b) => a.root.localeCompare(b.root));
}

async function windowsDrives(): Promise<DriveInfo[]> {
  try {
    const { stdout } = await execFileAsync("wmic", ["logicaldisk", "get", "deviceid,volumename"], {
      windowsHide: true,
      timeout: 8000,
    });
    const parsed = parseWmicDrives(stdout);
    if (parsed.length) return parsed;
  } catch {
    // wmic is absent on newer Windows. The PowerShell fallback covers that.
  }
  try {
    const script = "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName | ConvertTo-Json -Compress";
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 8000 },
    );
    return parsePowerShellDrives(stdout);
  } catch {
    return [];
  }
}

export function parsePowerShellDrives(text: string): DriveInfo[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const rows = JSON.parse(trimmed) as { DeviceID?: string; VolumeName?: string } | { DeviceID?: string; VolumeName?: string }[];
  const list = Array.isArray(rows) ? rows : [rows];
  return list
    .flatMap((row) => {
      const device = row.DeviceID?.trim();
      if (!device || !/^[A-Za-z]:$/.test(device)) return [];
      const root = `${device}\\`;
      return [{ root, label: driveLabel(root, row.VolumeName) }];
    })
    .sort((a, b) => a.root.localeCompare(b.root));
}

export function hostFor(platform: NodeJS.Platform): LocalHost {
  return {
    platform,
    drives: async () => {
      if (platform === "win32") return windowsDrives();
      return [{ root: path.parse(path.resolve("/")).root || "/", label: "This Computer" }];
    },
  };
}

/**
 * Dirent type is enough for a normal file or folder. Junctions and some
 * Windows volumes report an unknown type, and stat can fail on them. They
 * still have to appear or the folder looks incomplete.
 */
export async function describeEntry(
  item: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean },
  full: string,
  stat: (file: string) => Promise<{ isDirectory(): boolean; size: number; mtime: Date }> = fsStat,
  linkStat: (file: string) => Promise<{ isDirectory(): boolean; size: number; mtime: Date }> = lstat,
): Promise<Entry | null> {
  try {
    const info = item.isSymbolicLink() ? await stat(full) : await linkStat(full);
    const folder = info.isDirectory();
    return {
      name: item.name,
      key: full,
      kind: folder ? "folder" : "file",
      size: folder ? undefined : info.size,
      modified: info.mtime.toISOString(),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    if (item.isDirectory() || item.isSymbolicLink()) return { name: item.name, key: full, kind: "folder" };
    try {
      const info = await stat(full);
      return {
        name: item.name,
        key: full,
        kind: info.isDirectory() ? "folder" : "file",
        size: info.isDirectory() ? undefined : info.size,
        modified: info.mtime.toISOString(),
      };
    } catch (again) {
      if ((again as NodeJS.ErrnoException).code === "ENOENT") return null;
      return { name: item.name, key: full, kind: "folder" };
    }
  }
}

export class LocalAdapter implements StoreAdapter {
  id = "local" as const;
  label = "This Computer";
  available = true;

  constructor(
    private home: string,
    private host: LocalHost = hostFor(process.platform),
  ) {}

  test(): Promise<void> {
    return Promise.resolve();
  }

  async listContainers(): Promise<Entry[]> {
    const drives = await this.host.drives();
    return drives.map((drive) => ({
      name: drive.label,
      key: drive.root,
      kind: "folder" as const,
    }));
  }

  resolve(key: string): string {
    if (!key) return this.home;
    return path.resolve(key);
  }

  async list(_account: Account, _container: string, prefix: string): Promise<Entry[]> {
    if (isDriveList(prefix, this.host.platform)) return this.listContainers();
    const dir = this.resolve(prefix);
    const names = await readdir(dir, { withFileTypes: true });
    const entries: Entry[] = [];
    for (const item of names) {
      if (item.name.startsWith(".")) continue;
      const full = path.join(dir, item.name);
      const listed = await describeEntry(item, full);
      if (listed) entries.push(listed);
    }
    return entries.sort((a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || a.name.localeCompare(b.name));
  }

  async put(_account: Account, _container: string, key: string, stream: Readable, opts: PutOptions): Promise<void> {
    await mkdir(path.dirname(key), { recursive: true });
    const flags = opts.resume && opts.resume.bytesDone > 0 ? "a" : "w";
    let bytesDone = opts.resume?.bytesDone ?? 0;
    const tap = new PassThrough();
    tap.on("data", (chunk: Buffer | string) => {
      bytesDone += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      opts.onProgress?.(bytesDone, opts.size);
    });
    await pipeline(stream, tap, createWriteStream(key, { flags }), { signal: opts.signal });
    const info = await fsStat(key);
    opts.onProgress?.(info.size, opts.size);
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

  async stat(_account: Account, _container: string, key: string): Promise<EntryStat> {
    try {
      const info = await fsStat(key);
      const folder = info.isDirectory();
      return { exists: true, kind: folder ? "folder" : "file", size: folder ? undefined : info.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
      throw error;
    }
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
