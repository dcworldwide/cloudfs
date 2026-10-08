import { describe, expect, it } from "vitest";
import type { PaneState } from "../core/store";
import { folderDest, transferItems, transferTouches } from "./screens/Explorer";

const local: PaneState = { storeId: "local", provider: "local", container: "", prefix: "/home" };
const cloud: PaneState = { storeId: "acc", provider: "s3", container: "photos", prefix: "" };
const items = [{ key: "/home/a.txt", name: "a.txt" }];

describe("transferItems", () => {
  it("copies a local file to a cloud store as an upload", () => {
    const [job] = transferItems(local, cloud, items, false);
    expect(job.kind).toBe("upload");
    expect(job.dest.key).toBe("a.txt");
  });

  it("moves when asked, regardless of the source", () => {
    expect(transferItems(local, cloud, items, true)[0].kind).toBe("move");
    expect(transferItems(cloud, local, [{ key: "a.txt", name: "a.txt" }], true)[0].kind).toBe("move");
  });

  it("downloads a cloud file onto the computer", () => {
    const [job] = transferItems(cloud, local, [{ key: "a.txt", name: "a.txt" }], false);
    expect(job.kind).toBe("download");
    expect(job.dest.key).toBe("/home/a.txt");
  });

  it("skips a drop onto the same folder", () => {
    expect(transferItems(local, local, items, false)).toHaveLength(0);
  });

  it("moves a cloud object into a folder in the same bucket", () => {
    const dest = folderDest(cloud, { key: "production/", name: "production" });
    const [job] = transferItems(cloud, dest, [{ key: "_test.txt", name: "_test.txt" }], true);
    expect(job.kind).toBe("move");
    expect(job.dest.container).toBe("photos");
    expect(job.dest.key).toBe("production/_test.txt");
    expect(job.source.storeId).toBe(job.dest.storeId);
  });

  it("refreshes the source list and the destination folder after a same-bucket move", () => {
    const job = {
      source: { ...cloud, key: "_test.txt" },
      dest: { ...cloud, prefix: "production/", key: "production/_test.txt" },
    };
    expect(transferTouches(cloud, job)).toBe(true);
    expect(transferTouches({ ...cloud, prefix: "production/" }, job)).toBe(true);
    expect(transferTouches({ ...cloud, prefix: "uat/" }, job)).toBe(false);
  });

  it("does not move a folder into itself", () => {
    const dest = folderDest(cloud, { key: "production/", name: "production" });
    expect(transferItems(cloud, dest, [{ key: "production/", name: "production" }], true)).toHaveLength(0);
  });
});
