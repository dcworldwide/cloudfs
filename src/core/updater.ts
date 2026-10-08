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

export function createUpdateController(updater: AutoUpdaterLike): UpdateController {
  let snapshot: UpdateSnapshot = { status: "idle" };
  const listeners = new Set<(snapshot: UpdateSnapshot) => void>();
  let pendingRestart = false;

  const set = (next: UpdateSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };

  updater.autoDownload = true;
  updater.on("checking-for-update", () => set({ status: "checking" }));
  updater.on("update-available", (info) => set({ status: "available", version: info.version }));
  updater.on("update-not-available", () => set({ status: "idle" }));
  updater.on("download-progress", (progress) =>
    set({ status: "downloading", percent: progress.percent, version: snapshot.version }),
  );
  updater.on("update-downloaded", (info) => set({ status: "ready", version: info.version, percent: 100 }));
  updater.on("error", (error) => set({ status: "error", message: error.message }));

  return {
    snapshot: () => snapshot,
    check: async () => {
      await updater.checkForUpdates();
    },
    requestRestart: (activeTransfers) => {
      if (snapshot.status !== "ready") return "deferred";
      if (activeTransfers > 0) {
        pendingRestart = true;
        return "deferred";
      }
      pendingRestart = false;
      updater.quitAndInstall();
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
