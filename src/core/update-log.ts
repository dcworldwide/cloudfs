import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/** electron-updater calls these with one value, usually a string or Error. */
export interface UpdateLogger {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
  debug?(message?: unknown): void;
}

export function formatUpdateLog(message?: unknown): string {
  if (message instanceof Error) return message.stack || message.message;
  if (typeof message === "string") return message;
  if (message == null) return "";
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

/**
 * Append updater messages to logs/updater.log and mirror them to the console.
 * A logging failure must not take the app down.
 */
export function createUpdateLogger(directory: string, sink: Pick<Console, "info" | "warn" | "error"> = console): UpdateLogger {
  const file = path.join(directory, "updater.log");
  try {
    mkdirSync(directory, { recursive: true });
  } catch {
    // Console output still works when the logs directory cannot be created.
  }
  const write = (level: "info" | "warn" | "error", message?: unknown) => {
    const text = formatUpdateLog(message);
    try {
      appendFileSync(file, `${new Date().toISOString()} ${level} ${text}\n`);
    } catch {
      // Ignore disk errors. The console line below is the fallback.
    }
    sink[level](`[updater] ${text}`);
  };
  return {
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
    debug: (message) => write("info", message),
  };
}
