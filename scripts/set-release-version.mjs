import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Release versions are `{major}.{minor}.{workflow run number}`.
 * The run number increases for every run of .github/workflows/release.yml,
 * so each published build is a newer semver than the last. package.json only
 * supplies major.minor; the patch in git is not the version users install.
 */
export function releaseVersion(baseVersion, runNumber) {
  const match = /^(\d+)\.(\d+)\.\d+$/.exec(String(baseVersion).trim());
  if (!match) {
    throw new Error(`package.json version must be major.minor.patch, got "${baseVersion}".`);
  }
  const run = String(runNumber).trim();
  if (!/^[1-9]\d*$/.test(run)) {
    throw new Error(`Run number must be a positive integer, got "${runNumber}".`);
  }
  return `${match[1]}.${match[2]}.${run}`;
}

export function writeReleaseVersion(packageJsonPath, runNumber) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (!pkg || typeof pkg.version !== "string") {
    throw new Error(`package.json at ${packageJsonPath} has no version string.`);
  }
  const version = releaseVersion(pkg.version, runNumber);
  pkg.version = version;
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return version;
}

function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(entry) && path.basename(entry) === "set-release-version.mjs";
}

if (isDirectRun()) {
  try {
    const args = process.argv.slice(2);
    const printOnly = args[0] === "--print";
    const runNumber = printOnly ? args[1] : args[0];
    if (!runNumber) throw new Error("Usage: node scripts/set-release-version.mjs [--print] <run-number>");
    const packageJson = fileURLToPath(new URL("../package.json", import.meta.url));
    const version = printOnly ? releaseVersion(JSON.parse(readFileSync(packageJson, "utf8")).version, runNumber) : writeReleaseVersion(packageJson, runNumber);
    process.stdout.write(`${version}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
