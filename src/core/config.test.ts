import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, saveConfig } from "./config";
import { emptyConfig } from "./store";

describe("config", () => {
  it("round-trips accounts and writes a private file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cloudfs-"));
    const config = emptyConfig();
    config.accounts.push({
      id: "acc-1",
      provider: "s3",
      displayName: "Photos",
      settings: { accessKeyId: "AKIATEST", secretAccessKey: "secret", region: "us-east-1", ssl: true },
    });
    config.primaryColor = "#aa33cc";
    config.colorMode = "light";
    const file = await saveConfig(dir, config);
    const loaded = await loadConfig(dir);
    expect(loaded.accounts[0]?.settings.secretAccessKey).toBe("secret");
    expect(loaded.primaryColor).toBe("#aa33cc");
    expect(loaded.colorMode).toBe("light");
    const raw = await readFile(file, "utf8");
    expect(raw).toContain("Photos");
    if (process.platform !== "win32") {
      const info = await stat(file);
      expect(info.mode & 0o777).toBe(0o600);
    }
  });
});
