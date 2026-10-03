import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const assetsDir = resolve(__dirname, "assets");

export default defineConfig({
  root: "src/renderer",
  publicDir: assetsDir,
  // Use relative asset URLs in the production build so the built index.html
  // works under Electron's `loadFile()`, which resolves relative paths
  // against the HTML file's directory rather than the file-system root.
  // (Absolute `/assets/...` URLs resolve against the drive root in
  // file:// contexts and 404.)
  base: "./",
  plugins: [react()],
  // Vite 8's resolver returns null for bare specifiers on this Windows/OneDrive
  // checkout unless symlinks are preserved; without it the CSS @import
  // "@fontsource-variable/inter/index.css" resolves project-root-relative and
  // postcss-import ENOENTs, failing the renderer build (mirrors vitest.config.ts).
  resolve: { preserveSymlinks: true },
  server: { port: 5173, strictPort: true },
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
});