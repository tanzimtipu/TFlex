# TFL-492 / Phase 89 (FEA-033) phase-close QA evidence

Task type: PHASE VALIDATION. Independent verification; no product source touched.
Operator: qa (agent 2fdc7fcc). Date: 2026-10-03. Build mutex held around every npm run.

## Command verdicts (all under `.paperclip-build.lock`)

1. `npm.cmd run build` -> EXIT 0.
   typecheck `tsc --noEmit` clean; `vite build` 2677 modules, built in 875ms;
   `build:node` dist/main/index.js + dist/preload/preload.cjs. PASS.

2. `npm.cmd run test:e2e -- e2e/phase89_bates.spec.cjs` -> EXIT 0.
   `7 passed (48.0s)` / 0 failed. PASS (this spec IS the CONTROL-INDEX sweep).
   - P89-CORE: subset apply, labels on exactly selected pages (p2/p3 stamped, p1/p4 clean).
   - P89-REPORT: report keeps `2 pages stamped: BATES-00007, BATES-00008`; refusal text present.
   - P89-RELOAD: labels survive save+reopen on exactly their pages.
   - P89-REFUSAL: empty-range / out-of-range / duplicate refuse; U+6587 unencodable refuses.
   - P89-UNDO: one undo restores pre-stamp text.
   - P89-CONTROL-INDEX: every promised control performs its action; report
     `3 pages stamped: ABC-010-END, ABC-011-END, ABC-012-END`.
   - P89-OFFLINE: `[p89|offline-network-hits] []` (no network primitive).

3. `npm.cmd run test:unit -- test/unit/shared/bates.test.ts test/unit/main/phase89BatesSettings.test.ts test/unit/main/phase89BatesEngine.test.ts`
   -> EXIT 0. `Test Files 3 passed (3) / Tests 26 passed (26)`. PASS
   (24 original + 2 new DEF-513 DejaVu-Serif success cases).

4. `npm.cmd run test:unit -- test/unit/main/phase89BatesAdversary.test.ts`
   -> EXIT 0. `Test Files 1 passed (1) / Tests 13 passed (13)`. PASS.

5. `npm.cmd run test:unit -- test/unit/renderer/phase89BatesDialog.test.tsx`
   -> EXIT 0. `Test Files 1 passed (1) / Tests 9 passed (9)`. PASS
   (8 + the new DEF-512 `defaultFont: "Times"` assertion at `:144-150`).

6. `npm.cmd run test:unit -- test/unit/renderer/toolsRegistry.test.tsx test/unit/renderer/def311_314_dockCuration.test.tsx test/unit/renderer/phase36MultiChrome.test.tsx`
   -> EXIT 0. `Test Files 3 passed (3) / Tests 49 passed (49)`. PASS.

7. `npm.cmd run verify` -> EXIT 0. `conventions: clean (338 source file(s) scanned)` + tsc clean. PASS.

## DEF-512 targeted check (renderer, TFL-486)

Source confirmed: `BatesDialog` prop `defaultFont?: EditFont`
(`src/renderer/components/BatesDialog.tsx:57`); payload
`font: defaultFont ?? "Helvetica"` (`:234`); `App.tsx:11750` passes
`defaultFont={settings?.editDefaultFont ?? "Helvetica"}`.
Command 5 re-run: 9/9 passed including the assertion that mounts
`defaultFont: "Times"` and asserts payload `font === "Times"` (`:144-150`).
Verdict: PASS. `Status: OPEN` -> `CLOSED`.

## DEF-513 targeted check (main, TFL-487)

Source confirmed: `_addBatesImpl` resolves
`fontFamily = settings.font ?? DEFAULT_SETTINGS.editDefaultFont ?? 'Helvetica'`,
validates `isEditFont`, keeps the WinAnsi check for StandardFont families, and
for a bundled family probes a throwaway `PDFDocument.create()` for real glyph
coverage (`src/main/services/engine.ts:4370-4399`; helper
`bundledFontUnencodableChars` at `:5284`), refusing before any mutation.
Command 3 re-run: 26/26 passed, including `DejaVu Serif` + `\u03a9` (`:194`) and
`\u0101` (`:219`) accepting with the label baked/extractable and one undo entry,
and the default-font `\u6587` case (`:243`) refusing `engine-error` with bytes
byte-for-byte unchanged and no undo entry.
Verdict: PASS. `Status: OPEN` -> `CLOSED`.

## Phase 89 success criteria 1-5 (REQUIREMENTS.md:5353-5357)

1. Configure prefix/suffix/start/padding/position, choose pages, apply;
   sequential + zero-padded -> PASS (P89-CONTROL-INDEX report
   `ABC-010-END, ABC-011-END, ABC-012-END`; dialog unit preview).
2. Real content on save, survives reload, only selected pages, extraction
   returns labels -> PASS (P89-CORE / P89-RELOAD page extracts).
3. Fail-loud typed refusal shown in `[data-bates-report]`, changes nothing,
   no silent skip -> PASS (P89-REFUSAL; engine refusal unit cases).
4. Offline only, no network -> PASS (P89-OFFLINE `offline-network-hits []`).
5. No regression to watermark/stamp palette/zoom/save/export/undo/settings ->
   PASS (command 6 dock/registry audit 49/49; P89-UNDO; build+verify clean).

## Ledger update

`DEFECTS.md`: DEF-512 and DEF-513 `Status` set to `CLOSED`; one qa History line
each with the exact command + result. Left uncommitted for git-agent (criterion 7).
