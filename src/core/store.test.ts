import { describe, expect, it } from "vitest";
import { locationKey, paneView, type PaneState } from "./store";

function pane(prefix: string, view?: PaneState["view"]): PaneState {
  return { storeId: "local", provider: "local", container: "", prefix, view };
}

describe("paneView filters", () => {
  it("keeps a filter on the path it was typed in", () => {
    const here = locationKey(pane("/a/b"));
    const saved = pane("/a/b", { filter: "notes", filters: { [here]: "notes" }, selected: [], scroll: 0 });
    expect(paneView(saved).filter).toBe("notes");
    expect(paneView({ ...saved, prefix: "/a/b/c" }).filter).toBe("");
    expect(paneView({ ...saved, prefix: "/a" }).filter).toBe("");
  });

  it("restores the filter when the pane returns to that path", () => {
    const parent = locationKey(pane("/a/b"));
    const child = locationKey(pane("/a/b/c"));
    const saved = pane("/a/b/c", {
      filter: "",
      filters: { [parent]: "notes", [child]: "draft" },
      selected: [],
      scroll: 0,
    });
    expect(paneView(saved).filter).toBe("draft");
    expect(paneView({ ...saved, prefix: "/a/b" }).filter).toBe("notes");
  });

  it("ignores a filter saved before per-path memory until it is attached to a path", () => {
    const saved = pane("/a/b", { filter: "notes", selected: [], scroll: 12 });
    expect(paneView(saved).filter).toBe("");
    expect(paneView(saved).filters).toEqual({});
  });
});
