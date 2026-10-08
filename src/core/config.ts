import { mkdir, readFile, writeFile, chmod, rename } from "node:fs/promises";
import path from "node:path";
import { AppConfig, emptyConfig } from "./store";

export function configPathFor(dir: string): string {
  return path.join(dir, "config.json");
}

export function transfersPathFor(dir: string): string {
  return path.join(dir, "transfers.json");
}

function isConfig(value: unknown): value is AppConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as AppConfig;
  return v.version === 1 && Array.isArray(v.accounts) && Array.isArray(v.bookmarks) && Array.isArray(v.tabs);
}

export async function loadConfig(dir: string): Promise<AppConfig> {
  const file = configPathFor(dir);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isConfig(parsed)) return emptyConfig();
    return {
      ...emptyConfig(),
      ...parsed,
      colorMode: parsed.colorMode === "light" ? "light" : "dark",
      version: 1,
      accounts: parsed.accounts,
      bookmarks: parsed.bookmarks,
      tabs: parsed.tabs.length ? parsed.tabs : emptyConfig().tabs,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyConfig();
    throw error;
  }
}

export async function saveConfig(dir: string, config: AppConfig): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await chmod(dir, 0o700);
  } catch {
    // Windows ignores Unix modes.
  }
  const file = configPathFor(dir);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    await chmod(tmp, 0o600);
  } catch {
    // Windows ignores Unix modes.
  }
  await rename(tmp, file);
  return file;
}

export async function loadJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    if (error instanceof SyntaxError) return fallback;
    throw error;
  }
}

export async function saveJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  try {
    await rename(tmp, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 });
  }
}
