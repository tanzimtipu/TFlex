# Phase 112 (TFL-854) phase-close QA verdict - TFL-1003 (qa, 2026-10-06)

Overall: PASS over the whole Phase 112 diff.

## Per-item verdicts (command -> counts)

1. Shared panel primitives + scoped .tf-panel tokens + 52px shells
   `npx.cmd vitest run panelPrimitives` -> 1 file / 11 tests passed. PASS
2. Pages Context Pair + real inspector page size (TFL-966)
   `npx.cmd vitest run phase112_pages` -> 1 / 20 passed. PASS
3. Edit Context Pair
   `npx.cmd vitest run phase112_edit` -> 1 / 16 passed. PASS
4. Review Context Pair
   `npx.cmd vitest run phase112_review` -> 1 / 10 passed. PASS
5. Deliver Context Pair + export-config seed (TFL-985)
   `npx.cmd vitest run phase112_deliver` -> 1 / 17 passed. PASS
6. Home Recent + Samples + recent contract
   `npx.cmd vitest run phase112_home` -> 1 / 9 passed;
   `npx.cmd vitest run phase112Recents` -> 1 / 4 passed. PASS
7. Resizable panels + width/collapse persistence + dock geometry
   `npx.cmd vitest run phase112_panelLayout` -> 1 / 17 passed;
   `npx.cmd vitest run dockFit def330_dockDefaultSize def348_dockPresence dock`
   -> 24 files / 237 tests passed. PASS
8. Adversary fixes DEF-604/605/606
   `npx.cmd vitest run settingsEcho exportDialog officeExport docxExport textExport`
   -> 7 files / 143 tests passed. PASS
9. Gate
   `npm.cmd run typecheck` -> EXIT 0, clean.
   `npm.cmd run verify` -> EXIT 0, conventions clean (383 source files), typecheck clean.
   `npm.cmd run test:unit -- test/unit/renderer/foundationGuards.test.ts`
   -> 1 file / 30 tests passed (30/30). PASS
   Extra (G contract): `vitest run test/unit/main/settings.test.ts` -> 1 / 194 passed.
10. Defect ledger: 0 OPEN, 0 DISPUTED entries in DEFECTS.md (parsed all 537
    defect headers). Phase 112 defects DEF-597/598/604/605/606 all CLOSED. PASS.
11. CONTROL-INDEX sweep: every phase-reworked panel control present with a real
    handler and covered by a named test; no no-op found. PASS
    (see mapping below).
12. Success-criteria evidence: screenshots + timings captured and inspected
    (list below). PASS.

## Item 11 CONTROL-INDEX mapping (all reachable, real handlers, named test)

- Pages/Outline modes: `[data-outline-toggle]` -> outlineOpen + onRailTabChange
  (ContextPanel.tsx:588-604); rail tabs host-owned. paneldPrimitives/phase112_pages.
- Selection / multi-select: ThumbnailRail onPageSelectionChange + summary
  `[data-context-panel-selection]` (ContextPanel.tsx:546-585). phase112_pages.
- Insert / Page tools: `usePageThumbMenu` verbs onRotateCw/Ccw, onExtract,
  onInsertBlank, onReplace, onDeletePage; Combine/Merge header (ContextPanel.tsx:466-492, 976-979). phase112_pages.
- Edit nav + OCR/Add text: onSelectEditContent (ContextPanel.tsx:692),
  `[data-context-panel-action="recognize"|"suspects"]` (775-791). phase112_edit.
- Review annotation list + FMD/FDF: `[data-annotation-row]` + Export/Import FDF.
  phase112_review.
- Deliver checks + Export config: exportConfig model + named Export button. phase112_deliver.
- Recent Open/Pin/Show-in-folder/Locate/Remove: `[data-recent-action=...]`
  (HomeRecentRow.tsx:85-160). phase112_home.
- Sample Open: `.sample-card` (HomeSampleCard). phase112_home + live e2e.
- Panel resize/collapse: PanelResizeHandle (role=separator, pointer + keyboard)
  + `[data-rail-collapse]`. phase112_panelLayout + live e2e P112CLOSE-3.

## Item 12 evidence

Screenshots (screenshots/, all inspected): phase112-close-home-light.png,
-home-dark, -pages-light, -pages-dark, -edit-light, -edit-dark, -review-light,
-review-dark, -deliver-light, -deliver-dark, -pages-left-max, -pages-right-min,
-pages-collapsed, -pages-narrow. Plus the C2 spec shots
(phase112-c2-pages-panel.png, phase112-c2-pages-multiselect.png).

Timings (test-fixtures/phase112-qa/timings.json): open->workspace 500 ms,
first thumbnail 519 ms (34 thumbs), keyboard resize width applied 138 ms wall
(~18 ms net), review list 1297 ms wall (~97 ms net, empty state) - no Phase 112
numeric budget documented; resize is inside the 140 ms motion token.

Geometry (test-fixtures/phase112-qa/layout.json): persisted widths 240/280
default; left End/nudges -> 288 px; right 380 px; collapse -> rail 48 px;
780 px narrow -> rail 48 px, inspector 44 px. Focus Dock centre matches
(72 + rail + (vw - inset)) / 2 at every state: 737/761/711/591/428 px exact.

Live e2e: `npx playwright test e2e/phase112_c2_pages_visual.spec.cjs` -> 2/2;
`npx playwright test e2e/phase112_phaseclose_qa.spec.cjs` -> 4/4.

## Observations (not phase blockers)

- Home Recent missing-file state is populated lazily on an open attempt
  (`reason: "missing"`, App.tsx:2597); a seeded-but-unopened missing path renders
  as a normal row until opened. The missing row + Locate action is proven by
  phase112_home.test.tsx:212. Not a product failure.
- CONTROL-INDEX.md carries no Phase 112 panel rows (its working-tree diff is the
  sibling TFL-855 CommandMenu rows only); the phase CONTROL-INDEX appears to be
  issue-thread only. Documentation observation, LOW.
