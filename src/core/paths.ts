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
export function parentPrefix(provider: ProviderId, key: string): string {
  if (provider === "local") return key.slice(0, key.lastIndexOf("/")) || "/";
  const trimmed = key.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  if (slash < 0) return "";
  const parent = trimmed.slice(0, slash);
  return capabilities(provider).slashFolders ? `${parent}/` : parent;
}

/** A child key inside a pane prefix. */
export function joinKey(provider: ProviderId, prefix: string, name: string): string {
  if (provider === "local") {
    const base = prefix.replace(/\/$/, "");
    return base ? `${base}/${name}` : `/${name}`;
  }
  const base = prefix.replace(/\/+$/, "");
  return base ? `${base}/${name}` : name;
}

/** A renamed sibling of an existing key. */
export function renamedKey(provider: ProviderId, from: string, name: string): string {
  return joinKey(provider, parentPrefix(provider, from), name);
}

/** A new folder key for mkdir. */
export function folderKey(provider: ProviderId, prefix: string, name: string): string {
  const key = joinKey(provider, prefix, name);
  return capabilities(provider).slashFolders ? `${key.replace(/\/+$/, "")}/` : key;
}
