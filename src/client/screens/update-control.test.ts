import { describe, expect, it } from "vitest";
import { updateDeferredMessage } from "../../core/updater";
import { headerUpdateModel } from "./UpdateControl";

describe("header update control", () => {
  it("shows a download, with progress when the updater has it", () => {
    expect(headerUpdateModel({ status: "available", version: "0.1.27" })).toEqual({
      kind: "download",
      label: "Downloading 0.1.27",
      title: "Update 0.1.27 found. Downloading it now.",
    });
    expect(headerUpdateModel({ status: "downloading", version: "0.1.27", percent: 41.2 })).toMatchObject({
      kind: "download",
      label: "Downloading 0.1.27 41%",
    });
    expect(headerUpdateModel({ status: "downloading" })?.label).toBe("Downloading update");
  });

  it("offers restart once the download is ready, including a deferred note", () => {
    expect(headerUpdateModel({ status: "ready", version: "0.1.27" })).toEqual({
      kind: "restart",
      label: "Restart to update",
      title: "Update 0.1.27 is ready. It installs the next time Cloudfs restarts.",
    });
    expect(headerUpdateModel({ status: "ready", version: "0.1.27" }, updateDeferredMessage)?.title).toContain(
      "Transfers are still running",
    );
  });

  it("surfaces an error as a check button and hides idle and checking", () => {
    expect(headerUpdateModel({ status: "error", message: "offline" })).toEqual({
      kind: "retry",
      label: "Check for updates",
      title: "offline",
    });
    expect(headerUpdateModel({ status: "idle" })).toBeNull();
    expect(headerUpdateModel({ status: "checking" })).toBeNull();
  });
});
