import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const METADATA = {
  linux: "latest-linux.yml",
  mac: "latest-mac.yml",
  windows: "latest.yml",
};

/** Files electron-updater and a person installing the app actually need. */
export function isPublishableArtifact(name) {
  if (name === "latest.yml" || name === "latest-mac.yml" || name === "latest-linux.yml") return true;
  const lower = name.toLowerCase();
  return [".exe", ".dmg", ".zip", ".appimage", ".blockmap"].some((ext) => lower.endsWith(ext));
}

export function collectReleaseArtifacts(sourceDir, destDir) {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  const copied = [];
  for (const name of readdirSync(sourceDir)) {
    const from = path.join(sourceDir, name);
    if (!statSync(from).isFile()) continue;
    if (!isPublishableArtifact(name)) continue;
    copyFileSync(from, path.join(destDir, name));
    copied.push(name);
  }
  copied.sort();
  return copied;
}

function referencedFiles(metadata) {
  const names = [];
  for (const match of metadata.matchAll(/^\s*(?:-\s*)?(?:url|path):\s*['"]?([^'"\s#]+)['"]?\s*$/gm)) {
    names.push(path.basename(match[1]));
  }
  return names;
}

/**
 * The yml file is what the updater downloads. Every file it names has to be
 * uploaded under that exact name, or the installed app 404s.
 */
export function validateReleaseArtifacts(platform, names, destDir, expectedVersion) {
  const errors = [];
  const metadataName = METADATA[platform];
  if (!metadataName) {
    return [`Unknown platform "${platform}". Expected linux, mac, or windows.`];
  }
  if (!names.includes(metadataName)) errors.push(`Missing ${metadataName}.`);
  const has = (ext) => names.some((name) => name.toLowerCase().endsWith(ext));
  if (platform === "linux" && !has(".appimage")) errors.push("Linux build did not produce an AppImage.");
  if (platform === "windows" && !has(".exe")) errors.push("Windows build did not produce an NSIS installer.");
  if (platform === "mac") {
    if (!has(".zip")) errors.push("macOS build did not produce a zip. The updater installs the zip.");
    if (!has(".dmg")) errors.push("macOS build did not produce a dmg.");
  }
  if (names.includes(metadataName)) {
    const raw = readFileSync(path.join(destDir, metadataName), "utf8");
    const version = raw.match(/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m);
    if (!version || version[1] !== expectedVersion) {
      errors.push(`${metadataName} version is "${version?.[1] ?? ""}", expected ${expectedVersion}.`);
    }
    for (const file of referencedFiles(raw)) {
      if (!names.includes(file)) errors.push(`${metadataName} references ${file}, which is not in the upload set.`);
    }
  }
  return errors;
}

function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(entry) && path.basename(entry) === "collect-release-artifacts.mjs";
}

if (isDirectRun()) {
  try {
    const platform = process.argv[2];
    if (!platform) throw new Error("Usage: node scripts/collect-release-artifacts.mjs <linux|mac|windows>");
    const root = fileURLToPath(new URL("..", import.meta.url));
    const source = path.join(root, "release");
    const dest = path.join(root, "release-upload");
    const expectedVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
    const copied = collectReleaseArtifacts(source, dest);
    const errors = validateReleaseArtifacts(platform, copied, dest, expectedVersion);
    process.stdout.write(`${copied.join("\n")}\n`);
    if (errors.length > 0) {
      console.error(errors.join("\n"));
      process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
