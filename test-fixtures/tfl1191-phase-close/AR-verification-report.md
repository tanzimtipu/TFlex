# TFL-1191 / TFL-1146 phase-close QA — AR-01..AR-09 verification report

Phase: Additional Live Review 2026-10-07 correction pass (TFL-1146).
Task type: Phase validation (closing focused pass). No product source modified.

## Environment

- Build version: `1.51.0` (`package.json`).
- Base commit: `2a69e54e` ("Repair the completed visual overhaul..." TFL-1116). The
  phase changes are uncommitted in the working tree; git-agent supplies the final
  phase-close SHA.
- Host: Windows. OS scale factor 150% (AppliedDPI 144; primary display 3840x2160
  physical -> 2560x1440 DIP, primary work area 2560x1392 DIP).
- Window sizes: e2e ran at 981x641 and 960x640 DIP restored, and maximized for the
  anchor cycles (all sizes in DIP).
- Fixture: `assets/samples/report.pdf` (34 pages) unless noted.
- Launcher: canonical `e2e/lib/launch.cjs` against the dev build in `dist/`.

## Gates

- `npm.cmd run verify` -> exit 0. `conventions: clean (395 source file(s) scanned)`;
  `tsc --noEmit -p tsconfig.json` clean.
- `npm.cmd run build` -> exit 0 (typecheck + vite renderer + esbuild main/preload).
- Full unit suite NOT run (task scope: named specs only).

## Per-spec results

Units — `npx vitest run <13 named files>`: 13 files / 183 tests, 0 failed (2.7s).

| Unit file | Tests | Verdict |
|---|---|---|
| main/phase35WindowFit.test.ts | 11 | PASS |
| main/window.test.ts | 39 | PASS |
| renderer/tfl1146_anchorPreservation.test.ts | 7 | PASS |
| renderer/def302_zoomFlip.test.tsx | 20 | PASS |
| renderer/phase43LayoutFlip.test.ts | 5 | PASS |
| renderer/tfl1116_rangeValidation.test.tsx | 14 | PASS |
| renderer/engineTypes.test.ts | 30 | PASS |
| renderer/splitDialog.test.tsx | 4 | PASS |
| renderer/prefsThemeImmediate.test.tsx | 13 | PASS |
| renderer/prefsDialogRedesign.test.tsx | 16 | PASS |
| renderer/phase111_navigatorChrome.test.tsx | 10 | PASS |
| renderer/tfl1116_homeSamples.test.tsx | 9 | PASS |
| renderer/bugDEF429_recentSampleReopen.test.tsx | 5 | PASS |

e2e — `npx playwright test <14 named files>` (serial, 3 batches): 14 files /
30 tests, 0 failed.

| e2e spec | Tests | Verdict |
|---|---|---|
| tfl1179_ar_navigation.spec.cjs | 3 | PASS |
| tfl1181_ar01_ar04_repro.spec.cjs | 1 | PASS |
| phase59_fit_page.spec.cjs (repaired) | 1 | PASS |
| tfl1116_r04_navigation_sync.spec.cjs | 1 | PASS |
| tfl1116_r24_r25_location.spec.cjs | 3 | PASS |
| phase107_canvas_stage.spec.cjs | 4 | PASS |
| tfl1116_r16_r17_stage_inspector.spec.cjs | 2 | PASS |
| tfl1183_ar07_08_09_live.spec.cjs | 3 | PASS |
| tfl1185_ar05_sample_identity.spec.cjs | 1 | PASS |
| tfl1187_window_min.spec.cjs | 3 | PASS |
| tfl1190_def628_629_630_retest.spec.cjs | 4 | PASS |
| prefs_theme_immediate.spec.cjs (repaired) | 1 | PASS |
| probe_theme_persist.spec.cjs (repaired) | 1 | PASS |
| theme_frosted_persist.spec.cjs (repaired) | 2 | PASS |

Additional (AR-06 evidence only): `e2e/tfl1179_ar_surfaces.spec.cjs` -> 2 passed /
2 test-implementation failures. That spec is superseded by the named set above;
its two failures are test bugs, not product failures: (1) its `openSample` waits
for `.workspace`, which resolves to 2 elements at Home and times out; (2) it
asserts a relaunch has 0 seeded recents while the run had 10. Its substantive
AR-06/07/08/09 checks passed (details in the AR mapping).

## Verdict per phase change

- Chunk B (AR-01/AR-04), `zoomFlip.ts` + `DocumentView.tsx`: PASS. Normalized
  in-page anchor (`normalizedAnchorFraction`, `anchorOffsetAfter`), layout
  generation (`zoomFlipIsStale`, `layoutGenerationRef`), fit-mode-only capture in
  the ResizeObserver/pane effects, and the `layoutApplyEpoch` forced recenter all
  behave; anchor holds across repeated maximize/restore and Fit Page recenters.
- Chunk C (AR-08/AR-09/AR-07), `theme.ts` `applyThemeDefault`, `App.tsx` theme
  wiring, `PreferencesDialog.tsx` label/hint, `engine/types.ts` `invalidTokens`:
  PASS.
- Chunk D (AR-02 / AR-01 indicator / AR-05), `ContextPanel.tsx` `expanded` +
  focus return, `SideRail.tsx` `data-thumb-current-marker`,
  `sampleRecents.ts` `isSampleRecentPath` + App/Welcome exclusion: PASS.
- Chunk F, `src/main/window.ts` 960x640 DIP min clamped to work area: PASS.
- H1 (DEF-628/629/630), `theme.ts` `applyToggleTheme`; `engine/types.ts` strict
  `/^\d+$/` + both-endpoint span capture: PASS.
- Ledgers: PASS. ADV-243/244/245 dispositions are `ACCEPTED -> DEF-628/629/630`
  (no `PENDING`); DEF-628/629/630 are `CLOSED` (qa TFL-1190, 2026-10-08).

## Control-index / no-op sweep

PASS — every phase-touched control performed its promised action (no no-op
control found):

| Control | Selector | Observed action | Evidence |
|---|---|---|---|
| Compact Navigator trigger | `[data-rail-collapse]` | opens the overlay drawer (outline present, `aria-expanded=true`), Escape/close closes and returns focus | tfl1179 AR-02 (2 sizes) PASS |
| Navigator current-page marker | `[data-thumb-current-marker]` | collapsed ruler marks page 10 | tfl1179 AR-01; unit phase111_navigatorChrome |
| View > Toggle Theme | menu `[data-menu-action="toggleTheme"]` | cycles theme and writes `theme`+`themeDefault` together | tfl1190 DEF-628 PASS |
| Preferences dropdown | `[data-prefs-theme-default]` | applies immediately and persists `theme=themeDefault` | tfl1190 DEF-628; tfl1183 AR-08 PASS |
| Extract/Split range field | `#split-page-range` | classifies malformed/out-of-bounds, names token+bound, gates confirm | tfl1183 AR-07; tfl1190 DEF-629/630 PASS |

## AR-01..AR-09 mapping

- **AR-01** — resize loses the reading anchor while navigation still says page 10.
  Files: `zoomFlip.ts`, `DocumentView.tsx`. Reproduced cause: the post-resize
  recompute restored the old absolute `scrollTop`; a changed page height made the
  same offset land on a different in-page point, while the committed current page
  stayed 10. Correction: a normalized 0..1 in-page anchor and a layout generation;
  a resize captures only in a fit mode and a stale generation is discarded.
  Evidence: tfl1181 restore #1-3 page 10 intersects (slotTop 88, viewTop 88) and
  page 8 does not; tfl1179 AR-01 restored ruler marker for page 10; unit
  tfl1146_anchorPreservation (7) + def302_zoomFlip (20).
- **AR-02** — compact navigator expansion exposes no Outline. Files:
  `ContextPanel.tsx`. Cause: no exposed expanded state / no focus return around
  the responsive collapse. Correction: `expanded={!collapsed}` (real
  `aria-expanded`) and a `collapseOpenerRef` focus-restore effect.
  Evidence: tfl1179 AR-02 at 981x641 and 960x640 — `drawer=true`, `outlineRows=8`,
  `aria-expanded` false->true, focus returns to `[data-rail-collapse]` after both
  Escape and the close control.
- **AR-03** — compact inspector expansion exposes no content. File:
  `Inspector.tsx` (`data-inspector-collapse`). Corrected by the earlier TFL-1117
  (R01) drawer pattern; re-verified here. Evidence: tfl1179 AR-03 — `sections=3`,
  `closeControls=1`, Escape returns focus to `[data-inspector-collapse]` at both
  981x641 and 960x640.
- **AR-04** — Fit Page does not recover the current page. Files: `zoomFlip.ts`,
  `DocumentView.tsx`. Cause: pressing the active Fit Page pill no-op'd on a stale
  offset. Correction: `setMode` fit-page capture forces the current page to the
  viewport top and `layoutApplyEpoch` re-runs the apply even when the scale is
  unchanged. Evidence: tfl1181 AR-04 `fitPressed=true`, footer 10, `leftGap 220 /
  rightGap 220`, `fitsWidth`; tfl1179 AR-04.
- **AR-05** — bundled samples pollute Recents as Missing. Files:
  `sampleRecents.ts` (`isSampleRecentPath`), `App.tsx` (`checkMissing`
  exclusion), `Welcome.tsx` (missing suppression). Cause: the virtual
  `samples/<name>` path was probed as a disk file. Evidence: tfl1185 AR-05 (not
  Missing, reopens 34 pages, real missing stays Missing, saved copy ordinary) +
  unit tfl1116_homeSamples (9) + bugDEF429 (5).
- **AR-06** — enabled idle dock controls extremely faint. Files:
  `ActionDock.tsx` / `styles.css` (TFL-1116 R12, earlier overhaul); re-verified.
  Evidence: tfl1179_ar_surfaces AR-06 — idle `rootOpacity=1`, 5 enabled verbs all
  `effectiveOpacity=1` with composited ratios 17.53 and 7.82 (>=4.5:1). Limitation:
  no disabled dock verb was present in that frame, so the enabled-vs-disabled
  distinction was not exercised in this run.
- **AR-07** — out-of-range error describes an empty selection. File:
  `engine/types.ts` (`invalidTokens`, `pageRangeMessage`, strict `/^\d+$/`).
  Cause: the message named only the 1..N bound. Evidence: tfl1183 AR-07 — `999`
  -> "Page 999 is outside the document's 1-34 pages."; tfl1190 DEF-629 (`1abc`,
  `2-3x`, `1.9`, `12px` malformed, gate disabled) and DEF-630 (`50-60` ->
  "Pages 50, 60 are outside..."; `1-999` names only 999); unit engineTypes (30)
  + tfl1116_rangeValidation (14).
- **AR-08** — theme preference and visible appearance disagree. Files:
  `theme.ts` (`applyThemeDefault`, `applyToggleTheme`), `App.tsx` wiring. Cause:
  View > Toggle Theme wrote `theme` only, leaving `themeDefault` stale.
  Evidence: tfl1183 AR-08 (disk `theme=themeDefault`; relaunch dark), tfl1190
  DEF-628 (Toggle Theme x3 coherent; dropdown pick atomic), prefs_theme_immediate,
  probe_theme_persist, theme_frosted_persist.
- **AR-09** — Animations helper ambiguous. File: `PreferencesDialog.tsx`. Label
  is "Enable animations"; hint is "When off, menus, panels, dialogs and page
  changes appear without transition animations." Evidence: tfl1183 AR-09 PASS;
  unit prefsDialogRedesign (16).
- **AR-06 note:** not present in the phase's change list — the correction pass did
  not modify idle-legibility code; it re-verified the TFL-1116 R12 fix.

## Tests that could NOT be performed (explicit)

- 125% / 200% display scaling: not reproducible on this host; only the native
  **150%** was exercised. No multi-scale sweep.
- Windows large-text, forced-colors / high-contrast themes: not exercised.
- Screen-reader (Narrator/NVDA) announcements: not performed.
- macOS / Linux: not applicable to this host.
- The enabled-vs-disabled dock contrast check (AR-06) was skipped because no
  disabled dock verb was present in the sampled state.

## Performance (light timing only)

`e2e/tfl1191_phase_close_perf.spec.cjs` at 960x640 DIP, page 10 of report.pdf:

- resize-anchor restore (dispatch -> page-10 top stable for 3 frames):
  samples [90, 32, 33] ms, **median 33 ms** (settled footer 10).
- compact Navigator drawer open (trigger click -> drawer present):
  samples [102, 64, 63] ms, **median 64 ms**.

No new performance budget item is introduced by this correction pass; these are
informational readings, not a budget.

## Defects / adversarial dispositions

- No `OPEN`, `DISPUTED` or `FIX-READY` defect remains in `DEFECTS.md`.
- No `Disposition: PENDING` ADV entry remains. ADV-243/244/245 are
  `ACCEPTED -> DEF-628/629/630`.
- DEF-628, DEF-629, DEF-630: `CLOSED` (qa TFL-1190, 2026-10-08). Verified closed.
- Adversary classes that HELD for the TFL-1146 diff-pass: AR-05 sample identity,
  Chunk F window bounds, AR-01/AR-04 anchor maths, AR-02 drawer a11y.

## Verdict

PASS. Both gates pass; all 13 named unit files (183 tests) and all 14 named e2e
specs (30 tests) pass; no open defect; no ADV pending.

