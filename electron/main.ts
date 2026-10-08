import { watch, type FSWatcher } from "node:fs";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { LocalAdapter } from "../src/adapters/local";
import { S3Adapter } from "../src/adapters/s3";
import { UnavailableAdapter } from "../src/adapters/stub";
import { configPathFor, loadConfig, saveConfig, saveJson } from "../src/core/config";
import { AdapterRegistry } from "../src/core/registry";
import { TransferCoordinator } from "../src/core/transfers";
import { createUpdateController, UpdateController } from "../src/core/updater";
import {
  Account,
  AppConfig,
  isS3Settings,
  PaneState,
  toPublicAccount,
  TransferJob,
  WorkspaceTab,
} from "../src/core/store";
import { isColorMode, isHexColor } from "../src/core/theme";

const isDev = !app.isPackaged;

let config: AppConfig;
let registry: AdapterRegistry;
let local: LocalAdapter;
let coordinator: TransferCoordinator;
let updates: UpdateController | null = null;
let windowRef: BrowserWindow | null = null;
let pendingRestart = false;
const directoryWatches = new Map<string, { watcher: FSWatcher; refs: number; timer: ReturnType<typeof setTimeout> | null }>();

function userDir(): string {
  return app.getPath("userData");
}

function send(channel: string, payload: unknown): void {
  windowRef?.webContents.send(channel, payload);
}

function publicState() {
  return {
    configPath: configPathFor(userDir()),
    primaryColor: config.primaryColor,
    colorMode: config.colorMode,
    concurrency: config.concurrency,
    accounts: config.accounts.map(toPublicAccount),
    bookmarks: config.bookmarks,
    home: app.getPath("home"),
    tabs: config.tabs,
    activeTabId: config.activeTabId,
    version: app.getVersion(),
    update: updates?.snapshot() ?? { status: "idle" },
  };
}

async function persist(): Promise<void> {
  await saveConfig(userDir(), config);
}

function accountFromInput(input: {
  id?: string;
  displayName: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  ssl: boolean;
  endpoint?: string;
}): Account {
  const existing = input.id ? config.accounts.find((item) => item.id === input.id) : undefined;
  const secret =
    input.secretAccessKey ||
    (existing && typeof existing.settings.secretAccessKey === "string" ? existing.settings.secretAccessKey : "");
  return {
    id: input.id ?? randomUUID(),
    provider: "s3",
    displayName: input.displayName.trim(),
    settings: {
      accessKeyId: input.accessKeyId.trim(),
      secretAccessKey: secret,
      region: input.region.trim(),
      ssl: input.ssl,
      endpoint: (input.endpoint ?? "").trim(),
    },
  };
}

function registerIpc(): void {
  ipcMain.handle("state:get", () => publicState());
  ipcMain.handle("providers:list", () => registry.providers());

  ipcMain.handle("account:test", async (_event, input) => {
    const account = accountFromInput(input);
    if (!isS3Settings(account.settings)) throw new Error("S3 settings are incomplete.");
    await registry.get("s3").test(account);
  });

  ipcMain.handle("account:save", async (_event, input) => {
    const account = accountFromInput(input);
    if (!account.displayName) throw new Error("Display name is required.");
    if (!isS3Settings(account.settings) || !account.settings.secretAccessKey) {
      throw new Error("Access key, secret, and region are required.");
    }
    const index = config.accounts.findIndex((item) => item.id === account.id);
    if (index >= 0) config.accounts[index] = account;
    else config.accounts.push(account);
    await persist();
    return toPublicAccount(account);
  });

  ipcMain.handle("account:remove", async (_event, id: string) => {
    config.accounts = config.accounts.filter((item) => item.id !== id);
    await persist();
  });

  ipcMain.handle("settings:color", async (_event, color: string) => {
    if (!isHexColor(color)) throw new Error("Primary color must be a #rrggbb value.");
    config.primaryColor = color;
    await persist();
  });

  ipcMain.handle("settings:mode", async (_event, mode: string) => {
    if (!isColorMode(mode)) throw new Error("Appearance must be dark or light.");
    config.colorMode = mode;
    await persist();
  });

  ipcMain.handle("settings:concurrency", async (_event, value: number) => {
    const next = Math.max(1, Math.min(8, Math.round(value)));
    config.concurrency = next;
    coordinator.queue.setConcurrency(next);
    await persist();
  });

  ipcMain.handle("settings:reveal", () => {
    shell.showItemInFolder(configPathFor(userDir()));
  });

  ipcMain.handle("settings:export", async () => {
    const result = await dialog.showSaveDialog({
      defaultPath: "cloudfs-config.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await saveJson(result.filePath, config);
    return result.filePath;
  });

  ipcMain.handle("settings:import", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    const file = result.filePaths[0];
    if (result.canceled || !file) return;
    const { readFile } = await import("node:fs/promises");
    const imported = JSON.parse(await readFile(file, "utf8")) as AppConfig;
    if (!imported || imported.version !== 1 || !Array.isArray(imported.accounts)) {
      throw new Error("That file is not a Cloudfs config.");
    }
    config = { ...imported, tabs: config.tabs, activeTabId: config.activeTabId };
    await persist();
    send("state:replaced", publicState());
  });

  ipcMain.handle("fs:watch", (_event, dir: string) => {
    if (!dir) return;
    const existing = directoryWatches.get(dir);
    if (existing) {
      existing.refs += 1;
      return;
    }
    try {
      const watcher = watch(dir, { persistent: true }, () => {
        const current = directoryWatches.get(dir);
        if (!current) return;
        if (current.timer) clearTimeout(current.timer);
        current.timer = setTimeout(() => send("fs:changed", dir), 150);
      });
      watcher.on("error", () => undefined);
      directoryWatches.set(dir, { watcher, refs: 1, timer: null });
    } catch {
      // A protected folder can refuse a watch. Listing still works where it is allowed.
    }
  });

  ipcMain.handle("fs:unwatch", (_event, dir: string) => {
    const current = directoryWatches.get(dir);
    if (!current) return;
    current.refs -= 1;
    if (current.refs > 0) return;
    if (current.timer) clearTimeout(current.timer);
    current.watcher.close();
    directoryWatches.delete(dir);
  });

  ipcMain.handle("fs:grant", async (_event, dir: string) => {
    const result = await dialog.showOpenDialog({
      title: "Allow Cloudfs to read this folder",
      defaultPath: dir || app.getPath("home"),
      properties: ["openDirectory"],
      buttonLabel: "Allow",
    });
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("fs:list", async (_event, locator: PaneState) => {
    if (locator.provider === "local") {
      const prefix = locator.prefix || app.getPath("home");
      return local.list(config.accounts[0] ?? dummy(), "", prefix);
    }
    const account = coordinator.account(locator.storeId);
    const adapter = registry.get(locator.provider);
    if (!locator.container) return adapter.listContainers(account);
    return adapter.list(account, locator.container, locator.prefix);
  });

  ipcMain.handle("fs:mkdir", async (_event, locator: PaneState, name: string) => {
    const safe = name.replace(/[\\/]/g, "").trim();
    if (!safe) throw new Error("Folder name is required.");
    if (locator.provider === "local") {
      const dir = path.join(locator.prefix || app.getPath("home"), safe);
      await local.mkdir(dummy(), "", dir);
      return;
    }
    const account = coordinator.account(locator.storeId);
    const key = locator.prefix ? `${locator.prefix.replace(/\/$/, "")}/${safe}/` : `${safe}/`;
    await registry.get(locator.provider).mkdir(account, locator.container, key);
  });

  ipcMain.handle("fs:rename", async (_event, locator: PaneState, from: string, to: string) => {
    const name = to.replace(/[\\/]/g, "").trim();
    if (!name) throw new Error("A name is required.");
    if (locator.provider === "local") {
      await local.rename(from, path.join(path.dirname(from), name));
      return;
    }
    const account = coordinator.account(locator.storeId);
    const parent = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
    const dest = `${parent}${name}`;
    const adapter = registry.get(locator.provider);
    const existing = await adapter.list(account, locator.container, parent);
    if (existing.some((entry) => entry.name === name && entry.key !== from)) {
      throw new Error(`"${name}" already exists.`);
    }
    await adapter.copy(account, {
      from: { storeId: account.id, provider: locator.provider, container: locator.container, key: from },
      to: { storeId: account.id, provider: locator.provider, container: locator.container, key: dest },
    });
    await adapter.remove(account, locator.container, [from]);
  });

  ipcMain.handle("fs:remove", async (_event, locator: PaneState, keys: string[]) => {
    if (locator.provider === "local") {
      await local.remove(dummy(), "", keys);
      return;
    }
    await registry.get(locator.provider).remove(coordinator.account(locator.storeId), locator.container, keys);
  });

  ipcMain.handle("transfer:enqueue", (_event, input: Omit<TransferJob, "id" | "status" | "bytesDone" | "createdAt">) => {
    const job: TransferJob = {
      ...input,
      id: randomUUID(),
      status: "queued",
      bytesDone: 0,
      createdAt: new Date().toISOString(),
    };
    return coordinator.enqueue(job);
  });

  ipcMain.handle("transfer:pause", (_event, id: string) => coordinator.queue.pause(id));
  ipcMain.handle("transfer:resume", (_event, id: string) => coordinator.queue.resume(id));
  ipcMain.handle("transfer:dismiss", (_event, id: string) => coordinator.queue.dismiss(id));

  ipcMain.handle("transfer:cancel", async (_event, id: string) => {
    const job = coordinator.queue.list().find((item) => item.id === id);
    coordinator.queue.cancel(id);
    if (job?.resume?.uploadId && job.dest.provider !== "local") {
      const adapter = registry.get(job.dest.provider);
      await adapter.abortMultipart?.(
        coordinator.account(job.dest.storeId),
        job.dest.container,
        job.dest.key,
        job.resume.uploadId,
      );
    }
  });

  ipcMain.handle("dialog:directory", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("tabs:save", async (_event, tabs: WorkspaceTab[], activeTabId: string | null) => {
    config.tabs = tabs;
    config.activeTabId = activeTabId;
    await persist();
  });

  ipcMain.handle("update:check", async () => {
    await updates?.check();
  });

  ipcMain.handle("update:restart", () => {
    if (!updates) return "deferred";
    const result = updates.requestRestart(coordinator.queue.activeCount());
    if (result === "deferred" && updates.snapshot().status === "ready") pendingRestart = true;
    return result;
  });
}

function dummy(): Account {
  return { id: "local", provider: "s3", displayName: "local", settings: {} };
}

function rememberTabs(): void {
  if (!windowRef || windowRef.isDestroyed()) return;
  windowRef.webContents.send("tabs:flush");
}

async function createWindow(): Promise<void> {
  windowRef = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    title: "Cloudfs",
    backgroundColor: config.colorMode === "light" ? "#f4f7fb" : "#0b1220",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windowRef.on("close", rememberTabs);
  if (isDev) {
    await windowRef.loadURL("http://127.0.0.1:5173");
  } else {
    await windowRef.loadURL(pathToFileURL(path.join(__dirname, "../renderer/index.html")).toString());
  }
}

function wireUpdates(): void {
  if (isDev) return;
  // Loaded only in a packaged app so dev does not require a published release.
  const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
  updates = createUpdateController(autoUpdater);
  updates.onChange((snapshot) => send("update:change", snapshot));
  void updates.check();
}

app.whenReady().then(async () => {
  config = await loadConfig(userDir());
  registry = new AdapterRegistry();
  registry.register(new S3Adapter());
  registry.register(new UnavailableAdapter("azure", "Microsoft Azure"));
  registry.register(new UnavailableAdapter("gcs", "Google Cloud Storage"));
  local = new LocalAdapter(app.getPath("home"));
  coordinator = new TransferCoordinator({
    dir: userDir(),
    registry,
    local,
    accounts: () => config.accounts,
    concurrency: config.concurrency,
  });
  coordinator.queue.on("change", (jobs) => {
    send("jobs:change", jobs);
    if (pendingRestart && coordinator.queue.activeCount() === 0 && updates) {
      pendingRestart = false;
      updates.requestRestart(0);
    }
  });
  registerIpc();
  await coordinator.restore();
  await createWindow();
  wireUpdates();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
