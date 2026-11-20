import type { ProviderId } from "./store";

/** What the UI is allowed to know about a source. Protocol details stay in the adapter. */
export interface StoreCapabilities {
  /** S3 lists buckets before objects. FTP and local do not. */
  containers: boolean;
  /** A copy or move inside one account can stay on the server. */
  serverCopy: boolean;
  /** Folder keys end with a slash. Local and FTP use real directories. */
  slashFolders: boolean;
}

export const CAPABILITIES: Record<ProviderId, StoreCapabilities> = {
  local: { containers: false, serverCopy: true, slashFolders: false },
  s3: { containers: true, serverCopy: true, slashFolders: true },
  ftp: { containers: false, serverCopy: true, slashFolders: false },
  azure: { containers: true, serverCopy: false, slashFolders: true },
  gcs: { containers: true, serverCopy: false, slashFolders: true },
};

export function capabilities(provider: ProviderId): StoreCapabilities {
  return CAPABILITIES[provider];
}

/** The folder a pane is listing, as the adapter expects it. */
export function normalizePrefix(provider: ProviderId, prefix: string): string {
  if (!prefix) return "";
  if (provider === "local") return prefix;
  const trimmed = prefix.replace(/\/+$/, "");
  if (!trimmed) return capabilities(provider).slashFolders ? "/" : "";
  return capabilities(provider).slashFolders ? `${trimmed}/` : trimmed;
}

/** The renderer has no `process`. A drive letter is enough to pick Windows path rules. */
export function isWindowsPath(value: string, platform?: string): boolean {
  if (platform === "win32") return true;
  if (platform) return false;
  return /^[A-Za-z]:[\\/]/.test(value) || /^[A-Za-z]:$/.test(value);
}

/** Parent folder of an object key, in the same shape as a pane prefix. */
export function parentPrefix(provider: ProviderId, key: string, platform?: string): string {
  if (provider === "local") return localDir(key, isWindowsPath(key, platform));
  const trimmed = key.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  if (slash < 0) return "";
  const parent = trimmed.slice(0, slash);
  return capabilities(provider).slashFolders ? `${parent}/` : parent;
}

function localSep(windows: boolean): "\\" | "/" {
  return windows ? "\\" : "/";
}

function localDir(key: string, windows: boolean): string {
  const normalized = windows ? key.replace(/\//g, "\\") : key;
  const trimmed = normalized.replace(/[\\/]+$/, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (slash < 0) return windows ? "" : trimmed.startsWith("/") ? "/" : "";
  const parent = trimmed.slice(0, slash);
  if (!parent) return windows ? "" : "/";
  if (windows && /^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return parent;
}

function localJoin(prefix: string, name: string, windows: boolean): string {
  if (!prefix) return windows ? name : `/${name}`;
  const base = (windows ? prefix.replace(/\//g, "\\") : prefix).replace(/[\\/]+$/, "");
  return `${base}${localSep(windows)}${name}`;
}

/** A child key inside a pane prefix. */
export function joinKey(provider: ProviderId, prefix: string, name: string, platform?: string): string {
  if (provider === "local") return localJoin(prefix, name, isWindowsPath(prefix, platform));
  const base = prefix.replace(/\/+$/, "");
  return base ? `${base}/${name}` : name;
}

/**
 * Join a relative path (`src/main.txt`) onto the folder a copy is writing.
 * `..` is dropped so a listing cannot escape the destination folder.
 */
export function destinationKey(provider: ProviderId, folder: string, relative: string): string {
  let key = folder;
  for (const part of relative.split("/")) {
    if (!part || part === "." || part === "..") continue;
    key = joinKey(provider, key, part);
  }
  return key;
}

/** Folder key in the shape `stat` and `mkdir` expect. S3 keeps the trailing slash. */
export function asFolderKey(provider: ProviderId, key: string): string {
  if (!key || !capabilities(provider).slashFolders) return key;
  return key.endsWith("/") ? key : `${key}/`;
}

/** A renamed sibling of an existing key. */
export function renamedKey(provider: ProviderId, from: string, name: string): string {
  return joinKey(provider, parentPrefix(provider, from), name);
}

export interface PathSegment {
  label: string;
  /** Prefix to list when this segment is chosen. */
  prefix: string;
  container?: string;
}

/**
 * Every parent the location bar can jump to, including the root.
 * Local Windows starts at the drive list; a drive letter is its own segment.
 */
export function pathSegments(provider: ProviderId, prefix: string, container = "", platform?: string): PathSegment[] {
  if (provider === "local") return localSegments(prefix, platform);
  if (!capabilities(provider).containers) {
    const parts = prefix.split("/").filter(Boolean);
    const segments: PathSegment[] = [{ label: "Root", prefix: "" }];
    let cursor = "";
    for (const part of parts) {
      cursor = cursor ? `${cursor}/${part}` : part;
      segments.push({ label: part, prefix: cursor });
    }
    return segments;
  }
  const segments: PathSegment[] = [{ label: "Buckets", prefix: "", container: "" }];
  if (container) segments.push({ label: container, prefix: "", container });
  let cursor = "";
  for (const part of prefix.split("/").filter(Boolean)) {
    cursor = `${cursor}${part}/`;
    segments.push({ label: part, prefix: cursor, container });
  }
  return segments;
}

/** The segment above the current folder. Null when the pane is already at the root. */
export function parentSegment(segments: PathSegment[]): PathSegment | null {
  if (segments.length < 2) return null;
  return segments[segments.length - 2] ?? null;
}

function localSegments(prefix: string, platform?: string): PathSegment[] {
  const windows = isWindowsPath(prefix, platform) || platform === "win32";
  if (!windows) {
    const root = prefix.startsWith("/") ? "/" : "";
    const parts = prefix.split("/").filter(Boolean);
    const segments: PathSegment[] = [{ label: root ? "/" : "Root", prefix: root }];
    let cursor = "";
    for (const part of parts) {
      cursor = cursor ? `${cursor}/${part}` : root ? `/${part}` : part;
      segments.push({ label: part, prefix: cursor });
    }
    return segments;
  }
  const normalized = prefix.replace(/\//g, "\\");
  const segments: PathSegment[] = [{ label: "This PC", prefix: "" }];
  const match = /^([A-Za-z]:)(\\.*)?$/.exec(normalized);
  if (!match) return segments;
  const drive = `${match[1]}\\`;
  segments.push({ label: match[1], prefix: drive });
  let cursor = drive.replace(/\\$/, "");
  for (const part of (match[2] ?? "").split("\\").filter(Boolean)) {
    cursor = `${cursor}\\${part}`;
    segments.push({ label: part, prefix: cursor });
  }
  return segments;
}

/** The text a location field shows, including a trailing separator for a folder. */
export function pathText(provider: ProviderId, prefix: string, container = "", platform?: string): string {
  if (provider === "local") {
    if (!prefix) return platform === "win32" ? "" : "/";
    return prefix;
  }
  if (capabilities(provider).containers) {
    if (!container) return "";
    return prefix ? `${container}/${prefix.replace(/^\/+/, "")}` : `${container}/`;
  }
  return prefix || "/";
}

export interface ParsedPath {
  container: string;
  prefix: string;
}

/** Turn an edited location back into the pane prefix the adapter lists. */
export function parsePathText(provider: ProviderId, text: string, platform?: string): ParsedPath {
  const trimmed = text.trim();
  if (provider === "local") {
    if (!trimmed) return { container: "", prefix: platform === "win32" ? "" : "/" };
    if (isWindowsPath(trimmed, platform) || /^[A-Za-z]:/.test(trimmed)) {
      const slash = trimmed.replace(/\//g, "\\");
      const stripped = slash.replace(/\\+$/, "");
      // `C:` and `C:\` are the drive root. A bare `C:` is not that folder.
      if (/^[A-Za-z]:$/.test(stripped)) return { container: "", prefix: `${stripped}\\` };
      return { container: "", prefix: stripped || slash };
    }
    return { container: "", prefix: trimmed === "/" ? "/" : trimmed.replace(/\/+$/, "") };
  }
  if (!capabilities(provider).containers) {
    return { container: "", prefix: trimmed === "/" ? "" : trimmed.replace(/\/+$/, "") };
  }
  const body = trimmed.replace(/^\/+|\/+$/g, "");
  if (!body) return { container: "", prefix: "" };
  const slash = body.indexOf("/");
  if (slash < 0) return { container: body, prefix: "" };
  return { container: body.slice(0, slash), prefix: `${body.slice(slash + 1)}/` };
}

/** True when edited text still names the folder the pane is listing. Trailing separators do not count as a change. */
export function sameParsedLocation(
  provider: ProviderId,
  current: { container: string; prefix: string },
  text: string,
  platform?: string,
): boolean {
  const parsed = parsePathText(provider, text, platform);
  if (parsed.container !== (current.container || "")) return false;
  return (
    pathText(provider, parsed.prefix, parsed.container, platform) ===
    pathText(provider, current.prefix, current.container, platform)
  );
}

/** A new folder key for mkdir. */
export function folderKey(provider: ProviderId, prefix: string, name: string): string {
  const key = joinKey(provider, prefix, name);
  return capabilities(provider).slashFolders ? `${key.replace(/\/+$/, "")}/` : key;
}
