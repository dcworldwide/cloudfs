import { describe, expect, it } from "vitest";
import type { PaneState } from "../core/store";
import { transferItems } from "./screens/Explorer";

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
});
