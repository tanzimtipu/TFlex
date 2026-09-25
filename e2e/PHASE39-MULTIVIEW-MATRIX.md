# Phase 39 — Single vs Multi Mode Action Dock comparison matrix (qa)

Method: built the dev app (`npm.cmd run build`, exit 0), launched through the canonical
`e2e/lib/launch.cjs` `launchApp` helper, and measured the live DOM in the running Electron app.
Harness: `e2e/phase39_matrix.spec.cjs` (raw `[P39-MATRIX ...]` lines in `e2e/phase39-matrix.log`
and `e2e/phase39-states.log`). Modes compared: SINGLE, MULTI-1 (one document, pane A, focus A),
MULTI-2 (report.pdf + long.pdf). Default window = 1442x903; narrow = 700x720 (all four ladder
rungs engaged). The ladder sweep stepped every rung boundary (1250/1200/1199, 1050/1000/999,
900/880/879, 760/720/719, 700).

**Refresh (2026-09-25, post-fix):** re-measured on the current tree after the D1 (DEF-348) and D3
(pill-basis) fixes. `npm.cmd run test:e2e -- e2e/phase39_matrix.spec.cjs` -> **5 passed**; raw
`[P39-MATRIX ...]` lines in `e2e/phase39-matrix-rerun.log`. D1 re-verified with
`e2e/phase39_def348_verify.spec.cjs` -> **3 passed**, `[P39-DEF348b summary] []` (raw lines in
`e2e/phase39-def348-rerun.log`). Sections 1-3 and 5-11 are unchanged by the fixes; section 4 and
section 12 carry the refreshed values.

## 1. Default verb set per stage (ids, in order)

| Stage | SINGLE | MULTI-1 | MULTI-2 | Verdict |
|---|---|---|---|---|
| PAGES | rotate, extract, insertPages, replacePages, split, delete, merge, cropPages | identical | identical | PASS |
| EDIT | editText, editImage, editTextBox, recognizeText, batchOcr, ocrSuspects | identical | identical | PASS |
| REVIEW | annotate, sign, stamp, flatten, forms, watermark, exportComments, importComments | identical | identical | PASS |
| DELIVER | optimize, audit, exportPages, exportText, exportDocx, createFromImages | identical | identical | PASS |

No overflow `...` chip rendered in any config (all verbs fit the arrows/scroll lane).
The dock is the focused pane's stage in Multi Mode: switching the stage via the Stage Rail or
Ctrl+1..4 changes the shared dock's verb set exactly as single mode does.

## 2. Availability gates (enabled/disabled + reason)

| State | Disabled verbs (reason) | SINGLE | MULTI-1 | MULTI-2 |
|---|---|---|---|---|
| report.pdf only, PAGES | none | yes | yes | n/a |
| report.pdf only, EDIT | batchOcr ("Open a second document first"), ocrSuspects ("Run Recognize text first") | yes | yes | n/a |
| two docs, EDIT | ocrSuspects ("Run Recognize text first") only; batchOcr ENABLED ("Run OCR on every open document, sequentially.") | n/a | n/a | yes |
| REVIEW (no form fields) | flatten, forms ("This document has no form fields") | yes | yes | yes |
| DELIVER | none | yes | yes | yes |

Verdict: PASS — the gate set and the tooltip reason are identical in both modes for the same
live state (the batchOcr flip is the documented "Open a second document first" precondition,
not a mode difference).

## 3. Responsive ladder rungs — do they fire at the same widths?

Flag flipped on the FIRST width strictly below the threshold (`resolveDockLadder` uses `width <`).

| Rung (threshold) | SINGLE | MULTI-1 | MULTI-2 | Verdict |
|---|---|---|---|---|
| Inspector collapse @1200 | off at 1200, ON at 1199 | off at 1200, ON at 1199 | off at 1200, ON at 1199 | PASS (same width) |
| Panel collapse @1000 | off at 1000, ON at 999 | no panel surface (no shared ContextPanel; per-pane strips always shown) | same | DIVERGENCE (structural, see D2) |
| Labels hidden @880 (`icon-only`) | off at 880, ON at 879 | off at 880, ON at 879 | off at 880, ON at 879 | PASS (same width) |
| Arrows lane @720 | off at 720, ON at 719 | off at 720, ON at 719 | off at 720, ON at 719 | PASS (same width) |

The ladder keys on `window.innerWidth` in both modes, so the rung SIGNALS are identical. The
rendered ARROWS now agree too: the D3 pill-basis fix gives the shared dock the same band single
mode reserves at the same host width (section 4).

## 4. Measured-overflow lane / rendered arrows (same width, same result)

`data-dock-arrows-lane` (the lane) and `data-dock-arrows` (the rendered controls):

| innerWidth | SINGLE lane/arrows | MULTI-1 lane/arrows | MULTI-2 lane/arrows | Divergence |
|---|---|---|---|---|
| 1250 | true / true | true / true | true / true | no |
| 1200 | true / true | true / true | true / true | no |
| 1199 | true / true | true / true | true / true | no |
| 1050 | true / true | true / true | true / true | no |
| 1000 / 999 / 900 / 880 | true / true | true / true | true / true | no |
| 879 / 760 / 720 | false / false (icon-only) | false / false (icon-only) | false / false (icon-only) | no |
| 719 | true / false | true / false | true / false | no |
| 700 | true / false | true / false | true / false | no |

Cause (measured): the D3 fix. `pillBasisFromWidths` rebuilds the dock's reserve, pill-free band and
pill band height from the FOCUSED pane's pill WIDTHS at the single-mode 12px insets, instead of
feeding the outboard pane-relative pill POSITIONS to `pillReserve`. The shared dock therefore
reserves the identical band single mode does at the same host width, so the measured-overflow lane
and the vertical lift agree in all three configs at every width. The 1250/1199/1050 divergence is
gone; 719/700 now agree too (both modes lift and report the same lane).

Note on 719/700: `data-dock-arrows-lane` is `true` (the ladder's last rung fires) while
`data-dock-arrows` is `false` — the icon-only row fits its lifted band, so no arrows render. This
internal lane attribute is a signal only; it is not user-observable, and it is identical in SINGLE,
MULTI-1 and MULTI-2.

Verdict: PASS — no lane/arrows divergence remains at any measured width. One-row guarantee holds in
both modes.

## 5. One-row guarantee

Dock height 59.5px (labelled) / 43.3px (icon-only) in every stage at every width and mode; the
verbs render in a single `[data-dock-group]` row with no wrap in all 24 stage/config rows.
Verdict: PASS.

## 6. Interaction states (normal / hover / pressed / disabled / selected)

| State | SINGLE | MULTI-1 | Verdict |
|---|---|---|---|
| normal (rotate, primary) | bg rgba(37,99,235,0.12), color rgb(29,78,216) | identical | PASS |
| hover | bg rgba(37,99,235,0.08), color rgb(29,78,216) | identical | PASS |
| pressed (:active) | bg rgba(37,99,235,0.08), color rgb(29,78,216) | identical | PASS |
| disabled (batchOcr) | color rgb(182,188,198), cursor not-allowed | identical | PASS |
| selected (`aria-pressed`) | no toggle verb exists (`editMode` retired); no selected state to compare | same | n/a |

## 7. Right-click menu contents

Right-click any rendered dock verb: `["Pin to dock", "Unpin from dock"]` (`[data-dock-menu]`),
both enabled. Identical in SINGLE, MULTI-1 and MULTI-2. Verdict: PASS.

## 8. Pins / unpins and persistence

| Behaviour | SINGLE | MULTI-1 | Verdict |
|---|---|---|---|
| Unpin a default PAGES verb (`merge`) | removed from the dock | removed | PASS |
| Unpin persists across an app restart (fixed user-data dir) | yes | yes | PASS |
| Unpinned set applies in both modes after restart | yes (single and multi both show 7 verbs, no merge) | yes | PASS |
| "Pin to dock" on a rendered default verb | restores it to its own stage; adds no cross-stage pin | same | PASS parity (note D4) |

## 9. Secondary row / annotations flyout

REVIEW `annotate` opens `[data-annotation-flyout]` with `.ann-toolbar` present and 5 visible
`[data-ann-tools-visible] button[data-tool]` entries. Identical in SINGLE, MULTI-1, MULTI-2.
Verdict: PASS.

## 10. Ctrl+K palette reach

`Ctrl+K` opens `[data-command-palette]`; query "Rotate pages" yields
`[data-palette-tool-id="rotate"]` present and enabled in SINGLE, MULTI-1 and MULTI-2.
Verdict: PASS.

## 11. Inspector text panel

| Config | text run selected | `data-inspector-selection` | panels | field disabled |
|---|---|---|---|---|
| SINGLE | yes | text | 1 | false |
| MULTI-1 | yes | text | 1 | false |
| MULTI-2 | no (harness did not land a text run) | page | 0 | n/a |

Verdict: PASS for SINGLE vs MULTI-1 (byte-identical); MULTI-2 INCONCLUSIVE (text run not
selected in this harness, so no panel could be compared).

## 12. Divergences (every one, with its measurement)

- **D1 — Dock placement/overlap (DEF-348). FIXED and verified.** Current default dock rect
  x=433.5 w=495.4 y=831.8..891.3; pane A's thumb strip y=78..819.3 and its page-action bar
  y=767.9..819.3 -> 0 intersection (the dock's top 831.8 is below the strip's bottom 819.3). At the
  700px window the dock y=615.3..658.7 vs strip/action-bar bottom 484.7 -> 0. `e2e/phase39_def348_verify.spec.cjs`
  -> 3 passed, `[P39-DEF348b summary] []` (zero non-containment intersections across default/narrow,
  1/2 docs). DEF-348 CLOSED.
- **D2 — Panel-collapse rung has no surface in Multi Mode. AWAITING OPERATOR SIGN-OFF.** There is no
  shared `[data-context-panel]` in Multi Mode (`panelPresent=false` at every width in MULTI-1/MULTI-2;
  `true` in SINGLE); each pane owns an always-on strip with no collapse. Rung 2 therefore changes
  nothing in Multi Mode. Structural; the Phase 32-34 ruling keeps per-pane strips, so the <1000 rung
  has no shared surface to collapse. Needs the operator's sign-off (or a per-pane collapse).
- **D3 — Measured-overflow lane / rendered arrows. FIXED by the pill-basis change.** Re-measured:
  SINGLE, MULTI-1 and MULTI-2 now report identical lane/arrows at every width (table 4); the
  1250/1199/1050 divergence is gone, and 719/700 now agree too (lane=true, arrows=false in all
  three). No DIVERGE row remains.
- **D4 — Cross-stage pin unreachable via the UI in BOTH modes. AWAITING OPERATOR SIGN-OFF (parity,
  not a divergence).** The pin menu only opens on a rendered verb, and a rendered verb is always in
  the current stage's default set, so `pinDockTool` treats "Pin to dock" as a restore and never
  records a cross-stage pin. Re-measured: pinning `optimize` in DELIVER then reading PAGES leaves
  `pinnedIds=[]` in SINGLE, MULTI-1 and MULTI-2. Parity holds; recorded for the operator.

## Verdict

Default verb sets, availability gates, pins/unpins persistence, the one-row guarantee, the
interaction states, the right-click menu, the annotations flyout, the Ctrl+K palette reach and
the Inspector text panel (single vs multi-1) are IDENTICAL. Of the four recorded divergences, D1
(DEF-348) and D3 are FIXED and verified; D2 and D4 are explained (structural / parity) and await
the operator's sign-off. No unexplained divergence remains.
