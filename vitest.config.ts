import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "src/core"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "electron/**/*.test.ts"],
    environment: "node",
  },
});
