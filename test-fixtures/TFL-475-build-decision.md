# TFL-475 — Decision: unblock TFL-471 (renderer build, DEF-504)

## Decision

`npm.cmd run build` (renderer stage) is RED because of DEF-504: Vite 8.2.2's
postcss-import + rolldown resolver cannot resolve the bare CSS import in
`src/renderer/styles.css:9` (`@import url("@fontsource-variable/inter/index.css");`)
on this Windows/OneDrive checkout, so it falls back to a project-root-relative
path and ENOENTs. The JS module graph resolves fine; only the CSS `@import`
path breaks.

Applying the fix is a **build-config** change (`vite.config.ts`), which is
outside QA's permitted edit scope. The fix is already in flight and verified:

- Fix issue: **TFL-476** (backend-dev, in_progress) — add
  `resolve: { preserveSymlinks: true }` to `vite.config.ts`. This is the same
  setting already used by `vitest.config.ts` for the identical resolver class.
- Duplicate: **TFL-474** (frontend-dev, todo) proposes the same fix for Phase 89.
  Only ONE should land it to avoid concurrent edits to `vite.config.ts`.

`TFL-471` is re-bound as blocked by **TFL-476** so it auto-resumes on the
completion wake; no new fix issue was created.

## QA verification of the proposed fix (no tracked config touched)

A throwaway probe config (`test-fixtures/TFL-475-probe-vite.config.mjs`) mirrored
the real `vite.config.ts` with only `resolve: { preserveSymlinks: true }` added,
and built to a scratch outDir.

- Command:
  `node node_modules/vite/bin/vite.js build --config test-fixtures/TFL-475-probe-vite.config.mjs`
- Result: **exit 0**, `✓ built in 752ms`, Inter woff2 assets emitted, bundle
  contains `data-sanitize-dialog` (Phase 88 UI present).
- Contrast (repo build, unmodified config): exit 1, same postcss ENOENT.

So the one-line config fix restores a green renderer build containing the
Phase 88 UI. It needs a build-config owner to land it.

## Next step (owner: TFL-476 assignee)

1. Land `resolve: { preserveSymlinks: true }` in `vite.config.ts`; run
   `npm.cmd run build` to confirm exit 0.
2. On TFL-476 completion, TFL-471 auto-wakes and runs:
   `npm.cmd run test:e2e -- e2e/phase88_sanitize.spec.cjs`.
3. The CTO should retire TFL-474 (or TFL-476) so both do not edit the same file.
