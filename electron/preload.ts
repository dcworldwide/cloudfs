import { contextBridge, ipcRenderer } from "electron";
import type { ColorMode, PublicAccount, ProviderId, TransferJob } from "../src/core/store";

export interface CloudfsApi {
  getState(): Promise<AppState>;
  providers(): Promise<{ id: ProviderId; label: string; available: boolean }[]>;
  saveAccount(input: AccountInput): Promise<PublicAccount>;
  removeAccount(id: string): Promise<void>;
  testAccount(input: AccountInput): Promise<void>;
  setPrimaryColor(color: string): Promise<void>;
  setColorMode(mode: ColorMode): Promise<void>;
  setConcurrency(value: number): Promise<void>;
  revealConfig(): Promise<void>;
  exportConfig(): Promise<string | null>;
  importConfig(): Promise<void>;
  list(locator: PaneLocator): Promise<ListedEntry[]>;
  grant(dir: string): Promise<string | null>;
  watch(dir: string): Promise<void>;
  unwatch(dir: string): Promise<void>;
  mkdir(locator: PaneLocator, name: string): Promise<void>;
  rename(locator: PaneLocator, from: string, to: string): Promise<void>;
  remove(locator: PaneLocator, keys: string[]): Promise<void>;
  transfer(input: TransferInput): Promise<TransferJob>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  dismiss(id: string): Promise<void>;
  pickDirectory(): Promise<string | null>;
  saveTabs(tabs: unknown, activeTabId: string | null): Promise<void>;
  checkForUpdates(): Promise<void>;
  restartToUpdate(): Promise<"restarted" | "deferred">;
  onJobs(listener: (jobs: TransferJob[]) => void): () => void;
  onFsChange(listener: (dir: string) => void): () => void;
  onUpdate(listener: (snapshot: UpdateView) => void): () => void;
  onState(listener: () => void): () => void;
  onFlushTabs(listener: () => void): () => void;
}

export interface AppState {
  configPath: string;
  primaryColor: string;
  colorMode: ColorMode;
  concurrency: number;
  accounts: PublicAccount[];
  bookmarks: string[];
  home: string;
  tabs: unknown;
  activeTabId: string | null;
  version: string;
  update: UpdateView;
}

export interface UpdateView {
  status: string;
  version?: string;
  percent?: number;
  message?: string;
}

export interface AccountInput {
  id?: string;
  provider: "s3";
  displayName: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  ssl: boolean;
  endpoint?: string;
}

export interface PaneLocator {
  storeId: string;
  provider: ProviderId;
  container: string;
  prefix: string;
}

export interface ListedEntry {
  name: string;
  key: string;
  kind: "file" | "folder";
  size?: number;
  modified?: string;
}

export interface TransferInput {
  kind: "upload" | "download" | "copy" | "move" | "delete";
  source: PaneLocator & { key: string };
  dest: PaneLocator & { key: string };
  name: string;
  bytesTotal?: number;
}

const api: CloudfsApi = {
  getState: () => ipcRenderer.invoke("state:get"),
  providers: () => ipcRenderer.invoke("providers:list"),
  saveAccount: (input) => ipcRenderer.invoke("account:save", input),
  removeAccount: (id) => ipcRenderer.invoke("account:remove", id),
  testAccount: (input) => ipcRenderer.invoke("account:test", input),
  setPrimaryColor: (color) => ipcRenderer.invoke("settings:color", color),
  setColorMode: (mode) => ipcRenderer.invoke("settings:mode", mode),
  setConcurrency: (value) => ipcRenderer.invoke("settings:concurrency", value),
  revealConfig: () => ipcRenderer.invoke("settings:reveal"),
  exportConfig: () => ipcRenderer.invoke("settings:export"),
  importConfig: () => ipcRenderer.invoke("settings:import"),
  list: (locator) => ipcRenderer.invoke("fs:list", locator),
  grant: (dir) => ipcRenderer.invoke("fs:grant", dir),
  watch: (dir) => ipcRenderer.invoke("fs:watch", dir),
  unwatch: (dir) => ipcRenderer.invoke("fs:unwatch", dir),
  mkdir: (locator, name) => ipcRenderer.invoke("fs:mkdir", locator, name),
  rename: (locator, from, to) => ipcRenderer.invoke("fs:rename", locator, from, to),
  remove: (locator, keys) => ipcRenderer.invoke("fs:remove", locator, keys),
  transfer: (input) => ipcRenderer.invoke("transfer:enqueue", input),
  pause: (id) => ipcRenderer.invoke("transfer:pause", id),
  resume: (id) => ipcRenderer.invoke("transfer:resume", id),
  cancel: (id) => ipcRenderer.invoke("transfer:cancel", id),
  dismiss: (id) => ipcRenderer.invoke("transfer:dismiss", id),
  pickDirectory: () => ipcRenderer.invoke("dialog:directory"),
  saveTabs: (tabs, activeTabId) => ipcRenderer.invoke("tabs:save", tabs, activeTabId),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  restartToUpdate: () => ipcRenderer.invoke("update:restart"),
  onJobs: (listener) => {
    const wrapped = (_event: unknown, jobs: TransferJob[]) => listener(jobs);
    ipcRenderer.on("jobs:change", wrapped);
    return () => ipcRenderer.removeListener("jobs:change", wrapped);
  },
  onFsChange: (listener) => {
    const wrapped = (_event: unknown, dir: string) => listener(dir);
    ipcRenderer.on("fs:changed", wrapped);
    return () => ipcRenderer.removeListener("fs:changed", wrapped);
  },
  onUpdate: (listener) => {
    const wrapped = (_event: unknown, snapshot: UpdateView) => listener(snapshot);
    ipcRenderer.on("update:change", wrapped);
    return () => ipcRenderer.removeListener("update:change", wrapped);
  },
  onState: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on("state:replaced", wrapped);
    return () => ipcRenderer.removeListener("state:replaced", wrapped);
  },
  onFlushTabs: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on("tabs:flush", wrapped);
    return () => ipcRenderer.removeListener("tabs:flush", wrapped);
  },
};

contextBridge.exposeInMainWorld("cloudfs", api);
