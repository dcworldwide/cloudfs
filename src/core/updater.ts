import type { UpdateLogger } from "./update-log";

export interface UpdateSnapshot {
  status: "idle" | "checking" | "available" | "downloading" | "ready" | "error";
  version?: string;
  percent?: number;
  message?: string;
}

export interface AutoUpdaterLike {
  autoDownload: boolean;
  on(event: "checking-for-update", listener: () => void): void;
  on(event: "update-available", listener: (info: { version: string }) => void): void;
  on(event: "update-not-available", listener: () => void): void;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): void;
  on(event: "update-downloaded", listener: (info: { version: string }) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface UpdateController {
  snapshot: () => UpdateSnapshot;
  check: () => Promise<void>;
  /** Restarts only when the queue is idle. Otherwise the prompt stays pending. */
  requestRestart: (activeTransfers: number) => "restarted" | "deferred";
  onChange: (listener: (snapshot: UpdateSnapshot) => void) => void;
}

const silentLog: UpdateLogger = {
  info() {},
  warn() {},
  error() {},
};

export const updateDeferredMessage = "Transfers are still running. The update will install when they finish.";

export function packagedUpdateSkipReason(input: { packaged: boolean; platform: string; macSigned: boolean }): string | null {
  if (!input.packaged) return "Update checks run only in an installed build.";
  if (input.platform === "darwin" && !input.macSigned) {
    return "macOS auto-update needs a signed and notarized build. Download the new release from GitHub until a Developer ID certificate is configured.";
  }
  return null;
}

/** Shown when auto-update cannot run. Check and restart stay safe no-ops. */
export function createStaticUpdateController(message: string): UpdateController {
  const snapshot: UpdateSnapshot = { status: "idle", message };
  return {
    snapshot: () => snapshot,
    check: async () => undefined,
    requestRestart: () => "deferred",
    onChange: () => undefined,
  };
}

export function updateStatusText(update: {
  status: string;
  version?: string;
  percent?: number;
  message?: string;
}): string {
  const version = update.version ? ` ${update.version}` : "";
  switch (update.status) {
    case "checking":
      return "Checking for updates...";
    case "available":
      return `Update${version} found. Downloading it now.`;
    case "downloading": {
      const percent = update.percent == null ? "" : ` ${Math.round(update.percent)}%`;
      return `Downloading update${version}${percent}.`;
    }
    case "ready":
      return `Update${version} is ready. It installs the next time Cloudfs restarts.`;
    case "error":
      return update.message?.trim() || "Couldn't check for updates.";
    case "idle":
    default:
      return update.message?.trim() || "You're up to date.";
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Update check failed.";
}

export function createUpdateController(updater: AutoUpdaterLike, log: UpdateLogger = silentLog): UpdateController {
  let snapshot: UpdateSnapshot = { status: "idle" };
  const listeners = new Set<(snapshot: UpdateSnapshot) => void>();
  let pendingRestart = false;

  const set = (next: UpdateSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };

  const recordError = (error: unknown) => {
    const message = messageOf(error);
    if (snapshot.status === "error" && snapshot.message === message) return;
    log.error(error instanceof Error ? error.stack || error.message : message);
    set({ status: "error", message });
  };

  updater.autoDownload = true;
  updater.on("checking-for-update", () => set({ status: "checking" }));
  updater.on("update-available", (info) => set({ status: "available", version: info.version }));
  updater.on("update-not-available", () => set({ status: "idle" }));
  updater.on("download-progress", (progress) =>
    set({ status: "downloading", percent: progress.percent, version: snapshot.version }),
  );
  updater.on("update-downloaded", (info) => set({ status: "ready", version: info.version, percent: 100 }));
  updater.on("error", (error) => recordError(error));

  return {
    snapshot: () => snapshot,
    check: async () => {
      try {
        await updater.checkForUpdates();
      } catch (error) {
        // electron-updater emits "error" and rejects. recordError keeps a single log line.
        recordError(error);
      }
    },
    requestRestart: (activeTransfers) => {
      if (snapshot.status !== "ready") return "deferred";
      if (activeTransfers > 0) {
        pendingRestart = true;
        log.info(updateDeferredMessage);
        return "deferred";
      }
      pendingRestart = false;
      try {
        updater.quitAndInstall();
      } catch (error) {
        recordError(error);
        return "deferred";
      }
      return "restarted";
    },
    onChange: (listener) => listeners.add(listener),
  };
}

export function restartIfPending(
  controller: UpdateController,
  activeTransfers: number,
  pending: boolean,
): boolean {
  if (!pending || activeTransfers > 0) return pending;
  return controller.requestRestart(0) === "deferred";
}
