import { describe, expect, it } from "vitest";
import { AutoUpdaterLike, createUpdateController } from "./updater";

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

  checkForUpdates(): Promise<unknown> {
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
});
