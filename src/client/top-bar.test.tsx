/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, UpdateView } from "../../electron/preload";
import { updateDeferredMessage } from "../core/updater";
import { App } from "./App";

afterEach(() => {
  cleanup();
  delete (window as unknown as { cloudfs?: unknown }).cloudfs;
});

function stateOf(update: UpdateView): AppState {
  return {
    configPath: "/tmp/config.json",
    primaryColor: "#2563eb",
    colorMode: "dark",
    concurrency: 2,
    accounts: [],
    bookmarks: [],
    home: "/home",
    platform: "linux",
    tabs: [
      {
        id: "tab-1",
        left: { storeId: "local", provider: "local", container: "", prefix: "" },
        right: { storeId: "local", provider: "local", container: "", prefix: "" },
      },
    ],
    activeTabId: "tab-1",
    version: "0.1.25",
    update,
  };
}

function install(update: UpdateView) {
  const restart = vi.fn(async () => "deferred" as const);
  const check = vi.fn(async () => undefined);
  const api = {
    getState: async () => stateOf(update),
    list: async () => [],
    saveTabs: async () => undefined,
    watch: async () => undefined,
    unwatch: async () => undefined,
    onJobs: () => () => undefined,
    onFsChange: () => () => undefined,
    onUpdate: () => () => undefined,
    onState: () => () => undefined,
    onFlushTabs: () => () => undefined,
    checkForUpdates: check,
    restartToUpdate: restart,
  };
  (window as unknown as { cloudfs: typeof api }).cloudfs = api;
  return { restart, check };
}

function actionLabels(): string[] {
  const row = screen.getByTestId("top-actions");
  return [...row.children].map((node) => {
    const el = node as HTMLElement;
    return el.getAttribute("aria-label") || el.textContent || "";
  });
}

async function open(update: UpdateView) {
  install(update);
  render(<App />);
  expect(await screen.findByTestId("top-actions")).toBeTruthy();
}

describe("top bar", () => {
  it("puts the version, then the update control, immediately before transfers, Sources, and settings", async () => {
    await open({ status: "downloading", version: "0.1.27", percent: 42 });
    expect(actionLabels()).toEqual(["0.1.25", "Downloading 0.1.27 42%", "Show transfers", "Sources", "Settings"]);
    const header = document.querySelector("header");
    expect(header?.textContent).not.toContain("Cloudfs");
    expect(document.body.textContent).not.toContain("Downloading it now");
    expect(document.body.textContent).not.toContain("is ready. It installs");
  });

  it("drops the update control when nothing is pending and still keeps the version in front of transfers", async () => {
    await open({ status: "idle", message: "You're up to date." });
    expect(actionLabels()).toEqual(["0.1.25", "Show transfers", "Sources", "Settings"]);
    expect(screen.queryByRole("button", { name: "Restart to update" })).toBeNull();
    expect(screen.queryByText(/Downloading/)).toBeNull();
  });

  it("uses one restart button once the download is ready, and keeps a deferred restart on that button", async () => {
    const { restart } = install({ status: "ready", version: "0.1.27" });
    render(<App />);
    const button = await screen.findByRole("button", { name: "Restart to update" });
    expect(actionLabels()[0]).toBe("0.1.25");
    expect(actionLabels()[1]).toBe("Restart to update");
    expect(actionLabels()[2]).toBe("Show transfers");
    expect(document.body.textContent).not.toContain("is ready. It installs");
    fireEvent.click(button);
    expect(restart).toHaveBeenCalledOnce();
    expect((await screen.findByRole("button", { name: "Restart to update" })).getAttribute("title")).toContain(
      updateDeferredMessage,
    );
  });

  it("surfaces a failed check as the same compact control", async () => {
    await open({ status: "error", message: "Could not reach GitHub Releases." });
    const button = screen.getByRole("button", { name: "Check for updates" });
    expect(button.getAttribute("title")).toBe("Could not reach GitHub Releases.");
    expect(actionLabels().slice(0, 3)).toEqual(["0.1.25", "Check for updates", "Show transfers"]);
  });
});
