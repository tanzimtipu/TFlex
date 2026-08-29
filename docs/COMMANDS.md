# TFlex command reference (docs/)

Draft command reference created at the Phase 1 gate; to be merged into README.md
at Phase 5 final polish. All commands run from the repository root on Windows.

## Development

```
npm.cmd run dev
```

Starts the Vite dev server (renderer on http://localhost:5173), bundles the main
and preload processes with esbuild, and launches the Electron app against the dev
server. Use `npm.cmd` (the `npm` PowerShell shim is blocked by execution policy on
the build machine).

## Production build

```
npm.cmd run build
```

Runs tsc typecheck, builds the renderer with Vite into `dist/renderer`, and bundles
main/preload into `dist/main/index.js` and `dist/preload/preload.cjs`.

## Windows installer + portable

```
npm.cmd run dist
```

Runs the production build, then electron-builder producing:
- `release/TFlex-Setup-<version>.exe` (NSIS installer)
- `release/TFlex-<version>-portable.exe` (portable build)

## Unit tests

```
npm.cmd run test:unit
```

Runs vitest over `test/unit/main/**` and `test/unit/renderer/**`.

## End-to-end

The Phase 1 e2e harness lives in `e2e/` (qa-owned). Run a production build first
(`npm.cmd run build`), then invoke the harness there (see `e2e/harness.js`).
