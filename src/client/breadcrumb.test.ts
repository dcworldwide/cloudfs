import { describe, expect, it } from "vitest";
import { abbreviateMiddle, CRUMB_LABEL_MAX, endScroll } from "./breadcrumb";

describe("abbreviateMiddle", () => {
  it("leaves a short label unchanged", () => {
    expect(abbreviateMiddle("file-transfer")).toBe("file-transfer");
    expect(abbreviateMiddle("a".repeat(CRUMB_LABEL_MAX))).toBe("a".repeat(CRUMB_LABEL_MAX));
  });

  it("keeps the start and the end of a very long segment", () => {
    const label = "dnrmmrrd-k8s-poc-dept-transfer-994770696818-ap-southeast-2-an";
    const shown = abbreviateMiddle(label);
    const mark = shown.indexOf("…");
    expect(shown.length).toBe(CRUMB_LABEL_MAX);
    expect(mark).toBeGreaterThan(0);
    expect(label.startsWith(shown.slice(0, mark))).toBe(true);
    expect(label.endsWith(shown.slice(mark + 1))).toBe(true);
    expect(shown).not.toBe(label);
  });

  it("does not split a surrogate pair", () => {
    expect(Array.from(abbreviateMiddle("🙂".repeat(10), 5))).toEqual(["🙂", "🙂", "…", "🙂", "🙂"]);
    expect(abbreviateMiddle("abcdef", 1)).toBe("…");
  });
});

describe("endScroll", () => {
  it("parks a long path on its last segment and leaves a short path alone", () => {
    expect(endScroll(640, 180)).toBe(460);
    expect(endScroll(120, 180)).toBe(0);
    expect(endScroll(Number.NaN, 10)).toBe(0);
  });
});
