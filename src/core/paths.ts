import path from "node:path";
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

/** Parent folder of an object key, in the same shape as a pane prefix. */
export function parentPrefix(provider: ProviderId, key: string, platform: NodeJS.Platform = process.platform): string {
  if (provider === "local") return localParent(key, platform);
  const trimmed = key.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  if (slash < 0) return "";
  const parent = trimmed.slice(0, slash);
  return capabilities(provider).slashFolders ? `${parent}/` : parent;
}

function localParent(key: string, platform: NodeJS.Platform): string {
  const parsed = path.win32;
  const posix = path.posix;
  const api = platform === "win32" || /^[A-Za-z]:[\\/]/.test(key) ? parsed : posix;
  const parent = api.dirname(key);
  if (parent === key) return platform === "win32" ? "" : parent;
  return parent;
}

/** A child key inside a pane prefix. */
export function joinKey(provider: ProviderId, prefix: string, name: string, platform: NodeJS.Platform = process.platform): string {
  if (provider === "local") {
    const api = platform === "win32" || /^[A-Za-z]:[\\/]/.test(prefix) ? path.win32 : path.posix;
    if (!prefix) return platform === "win32" ? name : api.join(api.parse(prefix || "/").root || "/", name);
    return api.join(prefix, name);
  }
  const base = prefix.replace(/\/+$/, "");
  return base ? `${base}/${name}` : name;
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
export function pathSegments(provider: ProviderId, prefix: string, container = "", platform: NodeJS.Platform = process.platform): PathSegment[] {
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

function localSegments(prefix: string, platform: NodeJS.Platform): PathSegment[] {
  const windows = platform === "win32" || /^[A-Za-z]:[\\/]/.test(prefix);
  if (!windows) {
    const root = prefix.startsWith("/") ? "/" : "";
    const parts = prefix.split("/").filter(Boolean);
    const segments: PathSegment[] = [{ label: root ? "/" : "Root", prefix: root }];
    let cursor = root.replace(/\/$/, "");
    for (const part of parts) {
      cursor = cursor ? `${cursor}/${part}` : part;
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
export function pathText(provider: ProviderId, prefix: string, container = "", platform: NodeJS.Platform = process.platform): string {
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
export function parsePathText(provider: ProviderId, text: string, platform: NodeJS.Platform = process.platform): ParsedPath {
  const trimmed = text.trim();
  if (provider === "local") {
    if (!trimmed) return { container: "", prefix: platform === "win32" ? "" : "/" };
    if (platform === "win32" || /^[A-Za-z]:/.test(trimmed)) {
      const slash = trimmed.replace(/\//g, "\\");
      if (/^[A-Za-z]:$/.test(slash)) return { container: "", prefix: `${slash}\\` };
      return { container: "", prefix: slash.replace(/\\+$/, "") || slash };
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

/** A new folder key for mkdir. */
export function folderKey(provider: ProviderId, prefix: string, name: string): string {
  const key = joinKey(provider, prefix, name);
  return capabilities(provider).slashFolders ? `${key.replace(/\/+$/, "")}/` : key;
}
