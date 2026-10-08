import type { Readable } from "node:stream";

export type ProviderId = "s3" | "azure" | "gcs" | "local";

export interface Account {
  id: string;
  provider: Exclude<ProviderId, "local">;
  displayName: string;
  settings: Record<string, string | boolean>;
}

export interface S3Settings {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  ssl: boolean;
  endpoint?: string;
}

export interface Entry {
  name: string;
  key: string;
  kind: "file" | "folder";
  size?: number;
  modified?: string;
}

export interface Locator {
  /** "local" or an account id. */
  storeId: string;
  provider: ProviderId;
  /** Bucket, or the filesystem root bookmark. Empty for local when path is absolute. */
  container: string;
  /** Object key or absolute filesystem path. */
  key: string;
}

export interface PutOptions {
  size?: number;
  contentType?: string;
  signal?: AbortSignal;
  onProgress?: (bytesDone: number, bytesTotal?: number, resume?: MultipartResume) => void;
  /** Resume an existing multipart upload. */
  resume?: MultipartResume;
}

export interface MultipartResume {
  uploadId: string;
  parts: CompletedPart[];
  bytesDone: number;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface GetOptions {
  range?: { start: number; end?: number };
  signal?: AbortSignal;
}

export interface CopyRequest {
  from: Locator;
  to: Locator;
  size?: number;
  signal?: AbortSignal;
  onProgress?: (bytesDone: number, bytesTotal?: number) => void;
}

export interface StoreAdapter {
  id: ProviderId;
  label: string;
  available: boolean;
  test(account: Account): Promise<void>;
  listContainers(account: Account): Promise<Entry[]>;
  list(account: Account, container: string, prefix: string): Promise<Entry[]>;
  put(
    account: Account,
    container: string,
    key: string,
    stream: Readable,
    opts: PutOptions,
  ): Promise<MultipartResume | void>;
  get(account: Account, container: string, key: string, opts?: GetOptions): Promise<Readable>;
  remove(account: Account, container: string, keys: string[]): Promise<void>;
  copy(account: Account, request: CopyRequest): Promise<void>;
  mkdir(account: Account, container: string, prefix: string): Promise<void>;
  abortMultipart?(account: Account, container: string, key: string, uploadId: string): Promise<void>;
}

export type JobKind = "upload" | "download" | "copy" | "move" | "delete";
export type JobStatus = "queued" | "running" | "paused" | "done" | "error" | "cancelled";

export interface TransferJob {
  id: string;
  kind: JobKind;
  source: Locator;
  dest: Locator;
  name: string;
  bytesTotal?: number;
  bytesDone: number;
  status: JobStatus;
  error?: string;
  createdAt: string;
  /** Present while a multipart upload can be resumed. */
  resume?: MultipartResume;
}

export function locatorKey(locator: Locator): string {
  return [locator.provider, locator.storeId, locator.container, locator.key].join("|");
}

export function dedupeKey(kind: JobKind, source: Locator, dest: Locator): string {
  return [kind, locatorKey(source), locatorKey(dest)].join("::");
}

export function isS3Settings(value: Record<string, string | boolean>): value is S3Settings & Record<string, string | boolean> {
  return (
    typeof value.accessKeyId === "string" &&
    typeof value.secretAccessKey === "string" &&
    typeof value.region === "string" &&
    typeof value.ssl === "boolean"
  );
}

export const DEFAULT_PRIMARY = "#2563eb";

export type ColorMode = "dark" | "light";

export interface AppConfig {
  version: 1;
  primaryColor: string;
  colorMode: ColorMode;
  concurrency: number;
  accounts: Account[];
  bookmarks: string[];
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

/** Session view of one pane. Stored with the tab so a reload restores it. */
export interface PaneView {
  filter: string;
  selected: string[];
  scroll: number;
}

export interface PaneState {
  storeId: string;
  provider: ProviderId;
  container: string;
  prefix: string;
  view?: PaneView;
}

export function paneView(pane: PaneState): PaneView {
  return {
    filter: pane.view?.filter ?? "",
    selected: Array.isArray(pane.view?.selected) ? pane.view.selected : [],
    scroll: typeof pane.view?.scroll === "number" && pane.view.scroll >= 0 ? pane.view.scroll : 0,
  };
}

export interface WorkspaceTab {
  id: string;
  left: PaneState;
  right: PaneState;
}

export const DEFAULT_CONCURRENCY = 3;
export const PART_SIZE = 8 * 1024 * 1024;
export const MULTIPART_THRESHOLD = 8 * 1024 * 1024;

export function emptyConfig(): AppConfig {
  const tab: WorkspaceTab = {
    id: "tab-1",
    left: { storeId: "local", provider: "local", container: "", prefix: "" },
    right: { storeId: "local", provider: "local", container: "", prefix: "" },
  };
  return {
    version: 1,
    primaryColor: DEFAULT_PRIMARY,
    colorMode: "dark",
    concurrency: DEFAULT_CONCURRENCY,
    accounts: [],
    bookmarks: [],
    tabs: [tab],
    activeTabId: tab.id,
  };
}

/** Public view of an account. The secret never crosses into the renderer. */
export interface PublicAccount {
  id: string;
  provider: Account["provider"];
  displayName: string;
  region?: string;
  ssl?: boolean;
  endpoint?: string;
  hasSecret: boolean;
}

export function toPublicAccount(account: Account): PublicAccount {
  const settings = account.settings;
  return {
    id: account.id,
    provider: account.provider,
    displayName: account.displayName,
    region: typeof settings.region === "string" ? settings.region : undefined,
    ssl: typeof settings.ssl === "boolean" ? settings.ssl : undefined,
    endpoint: typeof settings.endpoint === "string" && settings.endpoint ? settings.endpoint : undefined,
    hasSecret: typeof settings.secretAccessKey === "string" && settings.secretAccessKey.length > 0,
  };
}
