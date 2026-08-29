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
  server: { port: 5173, strictPort: true },
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
});