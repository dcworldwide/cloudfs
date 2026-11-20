import { describe, expect, it } from "vitest";
import type { Entry, Locator } from "./store";
import { folderContains, walkFolder } from "./folder-walk";

function at(key: string, provider: Locator["provider"] = "s3"): Locator {
  return { storeId: provider === "local" ? "local" : "store", provider, container: provider === "s3" ? "box" : "", key };
}

describe("walkFolder", () => {
  const tree: Record<string, Entry[]> = {
    "docs/": [
      { name: "readme.txt", key: "docs/readme.txt", kind: "file", size: 5 },
      { name: "sub", key: "docs/sub/", kind: "folder" },
      { name: "empty", key: "docs/empty/", kind: "folder" },
      { name: "..", key: "docs/..", kind: "folder" },
      { name: ".", key: "docs/.", kind: "folder" },
    ],
    "docs/sub/": [
      { name: "main.txt", key: "docs/sub/main.txt", kind: "file", size: 4 },
      { name: "again", key: "docs/", kind: "folder" },
    ],
    "docs/empty/": [],
  };

  it("lists nested files, empty folders, and does not follow . or a cycle", async () => {
    const nodes = await walkFolder(at("docs/"), async (locator) => tree[locator.key] ?? []);
    expect(nodes.map((node) => `${node.kind}:${node.relative}`)).toEqual([
      "file:readme.txt",
      "folder:sub",
      "file:sub/main.txt",
      "folder:empty",
    ]);
    expect(nodes.find((node) => node.relative === "sub/main.txt")?.size).toBe(4);
    expect(nodes.find((node) => node.relative === "empty")?.locator.key).toBe("docs/empty/");
  });

  it("returns nothing for an empty folder", async () => {
    expect(await walkFolder(at("docs/empty/"), async () => [])).toEqual([]);
  });
});

describe("folderContains", () => {
  it("treats a descendant on the same store as inside the folder", () => {
    expect(folderContains(at("docs/"), at("docs/sub/"))).toBe(true);
    expect(folderContains(at("docs"), at("docs"))).toBe(true);
    expect(folderContains(at("docs/"), at("docs-other/"))).toBe(false);
    expect(folderContains(at("docs/", "s3"), at("docs/sub", "local"))).toBe(false);
    expect(folderContains(at(""), at("backup"))).toBe(true);
  });

  it("uses the filesystem prefix for a local folder", () => {
    const parent = at("/tmp/cloudfs/docs", "local");
    expect(folderContains(parent, at("/tmp/cloudfs/docs/inner", "local"))).toBe(true);
    expect(folderContains(parent, at("/tmp/cloudfs/docs2", "local"))).toBe(false);
  });
});
