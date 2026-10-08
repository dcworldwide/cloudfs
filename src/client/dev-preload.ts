/**
 * Browser stand-in for the Electron preload. Loaded only when index.html
 * includes ?preview=1, so the packaged app never uses it.
 */
import type { AppState, CloudfsApi, ListedEntry, PaneLocator, TransferInput } from "../../electron/preload";
import type { TransferJob } from "../core/store";

const home = "/Users/preview";
const saved = sessionStorage.getItem("cloudfs-preview-tabs");
const restored = saved ? (JSON.parse(saved) as { tabs: AppState["tabs"]; activeTabId: string | null }) : null;
const state: AppState = {
  configPath: `${home}/Library/Application Support/Cloudfs/config.json`,
  primaryColor: "#2563eb",
  colorMode: "dark",
  concurrency: 3,
  accounts: [
    {
      id: "acc-photos",
      provider: "s3",
      displayName: "Photos",
      region: "us-east-1",
      ssl: true,
      hasSecret: true,
    },
  ],
  bookmarks: [],
  home,
  tabs: restored?.tabs ?? [
    {
      id: "tab-1",
      left: { storeId: "local", provider: "local", container: "", prefix: home },
      right: { storeId: "acc-photos", provider: "s3", container: "photos", prefix: "" },
    },
  ],
  activeTabId: restored?.activeTabId ?? "tab-1",
  version: "0.1.0",
  update: { status: "idle" },
};

const local: ListedEntry[] = [
  { name: "Documents", key: `${home}/Documents`, kind: "folder" },
  { name: "notes.txt", key: `${home}/notes.txt`, kind: "file", size: 1280, modified: "2026-10-01T12:00:00Z" },
  ...Array.from({ length: 40 }, (_, index) => ({
    name: `file-${String(index).padStart(2, "0")}.txt`,
    key: `${home}/file-${index}.txt`,
    kind: "file" as const,
    size: 100 + index,
    modified: "2026-10-01T12:00:00Z",
  })),
];

const buckets: ListedEntry[] = [{ name: "photos", key: "photos", kind: "folder" }];
const objects: ListedEntry[] = [
  { name: "2024", key: "2024/", kind: "folder" },
  { name: "cover.jpg", key: "cover.jpg", kind: "file", size: 240_000, modified: "2026-09-12T08:30:00Z" },
];

const jobs: TransferJob[] = [];
const jobListeners = new Set<(jobs: TransferJob[]) => void>();

const api: CloudfsApi = {
  getState: async () => ({ ...state, accounts: [...state.accounts] }),
  providers: async () => [
    { id: "s3", label: "Amazon S3", available: true },
    { id: "azure", label: "Microsoft Azure", available: false },
    { id: "gcs", label: "Google Cloud Storage", available: false },
  ],
  saveAccount: async (input) => {
    const account = {
      id: "acc-new",
      provider: "s3" as const,
      displayName: input.displayName,
      region: input.region,
      ssl: input.ssl,
      endpoint: input.endpoint,
      hasSecret: true,
    };
    state.accounts.push(account);
    return account;
  },
  removeAccount: async (id) => {
    state.accounts = state.accounts.filter((account) => account.id !== id);
  },
  testAccount: async () => undefined,
  setPrimaryColor: async (color) => {
    state.primaryColor = color;
  },
  setColorMode: async (mode) => {
    state.colorMode = mode;
  },
  setConcurrency: async (value) => {
    state.concurrency = value;
  },
  revealConfig: async () => undefined,
  exportConfig: async () => state.configPath,
  importConfig: async () => undefined,
  grant: async () => null,
  watch: async () => undefined,
  unwatch: async () => undefined,
  list: async (locator: PaneLocator) => {
    if (locator.provider === "local") return local;
    if (!locator.container) return buckets;
    return objects;
  },
  mkdir: async () => undefined,
  rename: async () => undefined,
  remove: async () => undefined,
  transfer: async (input: TransferInput) => {
    const job: TransferJob = {
      id: `job-${jobs.length + 1}`,
      kind: input.kind,
      source: input.source,
      dest: input.dest,
      name: input.name,
      bytesTotal: input.bytesTotal ?? 240_000,
      bytesDone: 80_000,
      status: "running",
      createdAt: new Date().toISOString(),
    };
    jobs.push(job);
    for (const listener of jobListeners) listener([...jobs]);
    return job;
  },
  pause: async (id) => {
    const job = jobs.find((item) => item.id === id);
    if (job) job.status = "paused";
    for (const listener of jobListeners) listener([...jobs]);
  },
  resume: async (id) => {
    const job = jobs.find((item) => item.id === id);
    if (job) job.status = "running";
    for (const listener of jobListeners) listener([...jobs]);
  },
  cancel: async (id) => {
    const job = jobs.find((item) => item.id === id);
    if (!job) return;
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
      const index = jobs.indexOf(job);
      jobs.splice(index, 1);
    } else job.status = "cancelled";
    for (const listener of jobListeners) listener([...jobs]);
  },
  dismiss: async (id) => {
    const index = jobs.findIndex((item) => item.id === id);
    if (index >= 0) jobs.splice(index, 1);
    for (const listener of jobListeners) listener([...jobs]);
  },
  pickDirectory: async () => home,
  saveTabs: async (tabs, activeTabId) => {
    state.tabs = tabs as typeof state.tabs;
    state.activeTabId = activeTabId;
    sessionStorage.setItem("cloudfs-preview-tabs", JSON.stringify({ tabs, activeTabId }));
  },
  checkForUpdates: async () => undefined,
  restartToUpdate: async () => "deferred",
  onFsChange: () => () => undefined,
  onJobs: (listener) => {
    jobListeners.add(listener);
    return () => jobListeners.delete(listener);
  },
  onUpdate: () => () => undefined,
  onState: () => () => undefined,
  onFlushTabs: () => () => undefined,
};

(window as unknown as { cloudfs: CloudfsApi }).cloudfs = api;
