import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { releaseVersion, writeReleaseVersion } from "./set-release-version.mjs";

describe("releaseVersion", () => {
  it("uses the workflow run number as the patch", () => {
    expect(releaseVersion("0.1.0", "12")).toBe("0.1.12");
    expect(releaseVersion("2.4.9", 3)).toBe("2.4.3");
  });

  it("keeps later run numbers ahead in semver order, including 9 then 10", () => {
    const versions = [1, 2, 9, 10, 11].map((run) => releaseVersion("0.1.0", run));
    const parsed = (version) => version.split(".").map(Number);
    const ordered = [...versions].sort((left, right) => {
      const a = parsed(left);
      const b = parsed(right);
      return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    });
    expect(ordered).toEqual(versions);
    const newerLine = parsed(releaseVersion("0.2.0", 1));
    const olderLine = parsed(releaseVersion("0.1.0", 99));
    expect(newerLine[0] - olderLine[0] || newerLine[1] - olderLine[1] || newerLine[2] - olderLine[2]).toBeGreaterThan(0);
  });

  it("rejects versions that cannot grow strictly", () => {
    expect(() => releaseVersion("0.1.0", "0")).toThrow(/positive integer/);
    expect(() => releaseVersion("0.1.0", "-3")).toThrow(/positive integer/);
    expect(() => releaseVersion("1.0", "4")).toThrow(/major.minor.patch/);
  });

  it("writes the computed version into package.json", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cloudfs-ver-"));
    const file = path.join(dir, "package.json");
    writeFileSync(file, `${JSON.stringify({ name: "cloudfs", version: "0.1.0" }, null, 2)}\n`);
    expect(writeReleaseVersion(file, "8")).toBe("0.1.8");
    expect(JSON.parse(readFileSync(file, "utf8")).version).toBe("0.1.8");
    rmSync(dir, { recursive: true, force: true });
  });
});
