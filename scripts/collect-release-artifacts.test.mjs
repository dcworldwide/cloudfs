import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectReleaseArtifacts, isPublishableArtifact, validateReleaseArtifacts } from "./collect-release-artifacts.mjs";

describe("release artifacts", () => {
  it("keeps installers and updater metadata", () => {
    expect(isPublishableArtifact("latest-linux.yml")).toBe(true);
    expect(isPublishableArtifact("cloudfs-0.1.4-linux-x64.AppImage")).toBe(true);
    expect(isPublishableArtifact("cloudfs-0.1.4-win-x64.exe.blockmap")).toBe(true);
    expect(isPublishableArtifact("builder-debug.yml")).toBe(false);
    expect(isPublishableArtifact("builder-effective-config.yaml")).toBe(false);
  });

  it("copies only publishable files and checks that the yml points at them", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cloudfs-rel-"));
    const source = path.join(root, "release");
    const dest = path.join(root, "upload");
    mkdirSync(path.join(source, "linux-unpacked"), { recursive: true });
    writeFileSync(path.join(source, "linux-unpacked", "ignore.txt"), "no");
    writeFileSync(path.join(source, "builder-debug.yml"), "debug: true\n");
    writeFileSync(path.join(source, "cloudfs-0.1.4-linux-x64.AppImage"), "binary");
    writeFileSync(
      path.join(source, "latest-linux.yml"),
      "version: 0.1.4\nfiles:\n  - url: cloudfs-0.1.4-linux-x64.AppImage\n    sha512: abc\npath: cloudfs-0.1.4-linux-x64.AppImage\nsha512: abc\n",
    );
    const copied = collectReleaseArtifacts(source, dest);
    expect(copied).toEqual(["cloudfs-0.1.4-linux-x64.AppImage", "latest-linux.yml"]);
    expect(validateReleaseArtifacts("linux", copied, dest, "0.1.4")).toEqual([]);
    expect(validateReleaseArtifacts("linux", copied, dest, "0.1.5")).toEqual([
      'latest-linux.yml version is "0.1.4", expected 0.1.5.',
    ]);
    writeFileSync(path.join(dest, "latest-linux.yml"), "version: 0.1.4\npath: missing-file.AppImage\n");
    expect(validateReleaseArtifacts("linux", copied, dest, "0.1.4")).toEqual([
      "latest-linux.yml references missing-file.AppImage, which is not in the upload set.",
    ]);
    rmSync(root, { recursive: true, force: true });
  });
});
