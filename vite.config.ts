import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: "src/client",
  base: "./",
  plugins: [react({ jsxImportSource: "@emotion/react" })],
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "src/core"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
  },
});
