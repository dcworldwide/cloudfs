import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createUpdateLogger } from "./update-log";
import {
  AutoUpdaterLike,
  createStaticUpdateController,
  createUpdateController,
  packagedUpdateSkipReason,
  updateCheckIntervalMs,
  updateDeferredMessage,
  updateFocusCheckGapMs,
  updateStatusText,
} from "./updater";

class FakeUpdater implements AutoUpdaterLike {
  autoDownload = false;
  installed = false;
  private listeners = new Map<string, (...args: never[]) => void>();

  on(event: string, listener: (...args: never[]) => void): void {
    this.listeners.set(event, listener);
  }

  emit(event: string, payload?: unknown): void {
    this.listeners.get(event)?.(payload as never);
  }

  fail: Error | null = null;

  checkForUpdates(): Promise<unknown> {
    if (this.fail) {
      this.emit("error", this.fail);
      return Promise.reject(this.fail);
    }
    this.emit("checking-for-update");
    this.emit("update-available", { version: "0.2.0" });
    this.emit("download-progress", { percent: 40 });
    this.emit("update-downloaded", { version: "0.2.0" });
    return Promise.resolve();
  }

  quitAndInstall(): void {
    this.installed = true;
  }
}

describe("update controller", () => {
  it("tracks check and download progress", async () => {
    const updater = new FakeUpdater();
    const controller = createUpdateController(updater);
    const seen: string[] = [];
    controller.onChange((snapshot) => seen.push(snapshot.status));
    await controller.check();
    expect(seen).toEqual(["checking", "available", "downloading", "ready"]);
    expect(controller.snapshot().percent).toBe(100);
  });

  it("defers restart while a transfer is active", async () => {
    const updater = new FakeUpdater();
    const controller = createUpdateController(updater);
    await controller.check();
    expect(controller.requestRestart(2)).toBe("deferred");
    expect(updater.installed).toBe(false);
    expect(controller.requestRestart(0)).toBe("restarted");
    expect(updater.installed).toBe(true);
  });

  it("records a failed check and does not throw", async () => {
    const lines: string[] = [];
    const updater = new FakeUpdater();
    updater.fail = new Error("offline");
    const controller = createUpdateController(updater, {
      info() {},
      warn() {},
      error(message) {
        lines.push(String(message));
      },
    });
    await controller.check();
    expect(controller.snapshot()).toEqual({ status: "error", message: "offline" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("offline");
    expect(updateStatusText(controller.snapshot())).toBe("offline");
  });

  it("records an error emitted while downloading", () => {
    const updater = new FakeUpdater();
    const controller = createUpdateController(updater);
    updater.emit("error", new Error("signature rejected"));
    expect(controller.snapshot().status).toBe("error");
    expect(controller.requestRestart(0)).toBe("deferred");
    expect(updater.installed).toBe(false);
  });

  it("describes progress in plain language", () => {
    expect(updateStatusText({ status: "idle" })).toBe("You're up to date.");
    expect(updateStatusText({ status: "downloading", version: "0.1.4", percent: 41.2 })).toBe("Downloading update 0.1.4 41%.");
    expect(updateStatusText({ status: "ready", version: "0.1.4" })).toBe(
      "Update 0.1.4 is ready. It installs the next time Cloudfs restarts.",
    );
  });

  it("rechecks often enough to notice a release published while the app is open", () => {
    expect(updateCheckIntervalMs).toBe(4 * 60 * 60 * 1000);
    expect(updateFocusCheckGapMs).toBeLessThan(updateCheckIntervalMs);
  });

  it("skips unpackaged builds and unsigned macOS builds", () => {
    expect(packagedUpdateSkipReason({ packaged: false, platform: "win32", macSigned: false })).toMatch(/installed build/);
    expect(packagedUpdateSkipReason({ packaged: true, platform: "darwin", macSigned: false })).toMatch(/signed and notarized/);
    expect(packagedUpdateSkipReason({ packaged: true, platform: "linux", macSigned: false })).toBeNull();
    expect(packagedUpdateSkipReason({ packaged: true, platform: "win32", macSigned: false })).toBeNull();
    expect(packagedUpdateSkipReason({ packaged: true, platform: "darwin", macSigned: true })).toBeNull();
    const disabled = createStaticUpdateController("held");
    expect(disabled.snapshot().message).toBe("held");
    expect(disabled.requestRestart(0)).toBe("deferred");
  });

  it("logs a deferred restart", async () => {
    const lines: string[] = [];
    const updater = new FakeUpdater();
    const controller = createUpdateController(updater, {
      info(message) {
        lines.push(String(message));
      },
      warn() {},
      error() {},
    });
    await controller.check();
    expect(controller.requestRestart(1)).toBe("deferred");
    expect(lines).toEqual([updateDeferredMessage]);
  });
});

describe("update log", () => {
  it("writes updater.log and mirrors the line to the console", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cloudfs-log-"));
    const seen: string[] = [];
    const log = createUpdateLogger(dir, {
      info: (message) => seen.push(String(message)),
      warn: () => undefined,
      error: () => undefined,
    });
    log.info("checking");
    log.error(new Error("offline"));
    const text = readFileSync(path.join(dir, "updater.log"), "utf8");
    expect(text).toContain("info checking");
    expect(text).toContain("error Error: offline");
    expect(seen.some((line) => line.includes("checking"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
