import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const repo = process.cwd();

export default defineConfig({
  root: resolve(repo, "src/renderer"),
  publicDir: resolve(repo, "assets"),
  base: "./",
  resolve: { preserveSymlinks: true },
  plugins: [react()],
  build: { outDir: process.env.PROBE_OUT, emptyOutDir: true },
});
