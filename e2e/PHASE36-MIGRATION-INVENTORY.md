# Phase 36 spec migration — inventory and triage (qa session 2)

Built from `rg` over every live spec (`e2e/**/*.spec.*`, excluding `e2e/archived/**`
and `e2e/installed/**`) on the rebuilt app (`npm.cmd run build`, exit 0).
**89 files** reference at least one genuinely retired surface (the dispatch's "87").

## 1. Live vs retired — corrects the dispatch's selector list

**RETIRED (not rendered by `App.tsx`; the modules are dead code):**
`data-tools-badge`, `data-tools-toggle`, `data-tools-palette`, `data-tools-layout`,
`.tools-badge-tracker` (ToolsPalette/CommandBar badge — retired in chunks 4-6);
`data-ruler-page`, `.side-rail`, `.rail-title`, `.rail-thumb` (SideRail, module not
rendered); `data-shared-toolbar`, `data-unified-toolbar`;
`data-toolbar-rotate-cw`, `-rotate-ccw`, `-edit-toggle`, `-delete-pages`, `-optimize`,
`-audit`, `-multi-mode` (CommandBar — `<Toolbar>` is rendered nowhere);
`tfStagePanel` (dev flag, comment only); `[data-tool-id="<id>"]` (palette rows).

**STILL LIVE — do NOT migrate/retire these; the dispatch list is stale on them:**
- `data-rail-collapse` — the live ContextPanel collapse/expand control
  (`ContextPanel.tsx:423`; validated by DEF-320's retest).
- `data-ann-dropdown-toggle` — live in the REVIEW flyout
  (`AnnotationToolbar.tsx:632`; validated by DEF-317's retest).
- `data-toolbar-open` / `-save` / `-save-as` — live in the AppHeader
  (`AppHeader.tsx:377/390/407`).
- `data-rail-collapsed` — a live state attribute (`App.tsx:8029`).

## 2. Retired surface -> current home

| Retired | Behaviour now lives at |
| --- | --- |
| All-tools badge/toggle/palette + `[data-tool-id]` rows | stage Action Dock verb `[data-dock-verb="<id>"]`, or `[data-dock-overflow-item="<id>"]` in the "More" lane (`helpers.clickDockVerb`); global commands in `[data-command-palette]` |
| per-view toolbar row (`data-toolbar-*`) | dock verbs; view controls in the CanvasPills `[data-page-pill]`/`[data-zoom-pill]`; Multi Mode in the title bar `[data-header-multi-mode]` |
| rail-in-single-mode (`.side-rail`, `data-ruler-page`, rail thumbs) | ContextPanel `[data-context-panel]` (open by default), header control `[data-rail-collapse]` |
| shared Multi Mode toolbar (`data-shared-toolbar`/`unified-toolbar`) | per-pane pills + the one shared Action Dock; mode toggle `[data-header-multi-mode]` |
| palette readiness wait (`waitForSelector('[data-tools-palette]')`) | the Inspector `[data-inspector]` (mounted whenever a document is open) |

## 3. Triage rules applied

- **(a) RETIRE** — the spec asserts the retired surface's own shape AND the behaviour is
  covered by a Phase 30-36 spec. Retire with a one-line replacement comment.
- **(b) MIGRATE** — the behaviour still exists but is reached via a moved control; keep
  the same outcome asserted, repoint the drive path.
- **(c) LEAVE** — ambiguous, or a behaviour with no current home: reported, not touched.

**Caveat proved this session:** a grep hit is not proof of red. `phase16_focused` and
`retests/def286_290_retest` both contain retired tokens yet PASS (batch 1, 14 passed) —
their hits are comments/negative assertions. The authoritative red worklist needs a suite run.

## 4. Per-file triage (89 files)

Format: `file` — retired tokens — subject — action.

### (a) RETIRE (subject is a retired surface; behaviour covered elsewhere)

- `anim_probe.spec.cjs` — palette, .side-rail — "P1 modal covers the tools palette" — RETIRE: palette gone; modal/backdrop z-order covered by `phase20_verify` + `anim_audit`.
- `def233_234_retest.spec.cjs` — palette, layout — "DEF-233 palette resize lockstep" — RETIRE: covered by `phase34_panel_inset` + `phase36_chunk456_gate`.
- `probe_backdrop.spec.cjs` — badge — "backdrop-filter probe" — RETIRE: waits for `[data-tools-badge]`; glass surface covered by `phase20_baseline`/`frost_verify`.
- `qa_reference_compare.spec.cjs` — palette, layout, .side-rail — reference capture — RETIRE: captures the retired palette + rail chrome.
- `toolbar_tab_highlight_probe.spec.cjs` — unified-toolbar — "Toolbar tab highlight" — RETIRE: surface gone; stage highlight covered by `phase36_chunk1_rail_gate`.
- `retests/def_180_181_retest.spec.cjs` — palette, layout, .side-rail — "tool titles bold in list AND grid" — RETIRE: list/grid is the retired palette; no current home (route if the operator wants it).
- `retests/def_195_196_197_retest.spec.cjs` — palette — palette open/close motion — RETIRE the palette section: motion covered by `phase20_verify`/`phase23_animations_switch`.
- `retests/def189_190_final.spec.cjs` — palette, .side-rail — "theme dropdown paints above the open Tools palette" — RETIRE: subject surface gone; theme-over-dialog covered by `theme_preferences`.
- `retests/def189_evidence.spec.cjs` — palette — "evidence shot" — RETIRE: diagnostic of the retired palette.
- `retests/def190_lift_diag.spec.cjs` — palette — "stamp editor lift wiring" — RETIRE: diagnostic; stamp lift covered by `phase24_annotation_styles`.
- `retests/gt_repro3_ocr.spec.cjs` — palette — "OCR suspects behind tools panel" — RETIRE/remap: the tools panel is gone; suspects vs ContextPanel is covered by `phase36_chunk456_gate`.
- `retests/operator_repros.spec.cjs` — palette, layout — "close tab leaves Tools panel open" — RETIRE: subject surface gone.
- `retests/phase34_runclose_reconfirm.spec.cjs` — badge, palette — "panel shrinks both panes equally" — RETIRE: covered by `phase34_panel_inset` C1.
- `retests/probe_crop_boxes_1.7.14.spec.cjs` — palette — "dump rendered page boxes" — RETIRE: diagnostic gauntlet.
- `retests/qa_diag_resize_pending.spec.cjs` — palette — "diag: stamp resize pending" — RETIRE: diagnostic.
- `retests/qa_themes_tools_verify_1.10.2.spec.cjs` — palette — "tools palette groups" — RETIRE the palette group section; themes covered by `theme_preferences`.
- `phase33_multi_toolbar.spec.cjs` — shared-toolbar, rotate-cw — "C3 one shared toolbar" — RETIRE or merge: the one-shared-toolbar subject is retired; per-pane behaviour covered by `phase36_chunk3_dock_gate`.

### (c) LEAVE / ROUTE (installed-only or deliberate retirement proofs)

- `retests/release_1250_headline_installed.spec.cjs` — shared-toolbar, badge — installed headline.
- `retests/release_1260_headline_installed.spec.cjs` — badge, palette — installed headline.
  (Both launch the packaged exe / are release-gate specs; the dispatch excludes the installed suite.)
- `phase36_chunk3_dock_gate.spec.cjs`, `phase36_chunk456_gate.spec.cjs`, `phase36_chunk2_pages_parity.spec.cjs`, `verify/theme_ui_fixes.spec.cjs` — KEEP: these intentionally assert the retired selectors are ABSENT (the chunk retirement proofs). The `e2e/` grep for retired selectors can never be clean while they exist; that is by design.

### (b) MIGRATE (behaviour live, control moved)

- `retests/def_106_file.spec.cjs` — palette — DOCX export — **DONE** (dock verb `exportDocx`).
- `retests/gt_docx_ocr_pages.spec.cjs` — palette — DOCX range / OCR / insert blank — **DONE** (dock verbs `exportDocx`/`recognizeText`/`insertPages`).
- `anim_audit.spec.cjs` — palette — motion tokens — repoint the palette open/close sample; keep token assertions.
- `class_sweep_def221_222.spec.cjs` — palette — text-run move — repoint palette drive to EDIT dock.
- `crop_thumbs_port.spec.cjs` — palette — crop page thumbs — repoint to ContextPanel thumbnails.
- `def214_reverify_v1170.spec.cjs` — toolbar-edit-toggle — "CommandBar Edit toggle" — repoint to dock `editMode`.
- `def217_219_retest.spec.cjs` — palette — DEF-217 tile/size error — repoint palette availability.
- `frost_verify.spec.cjs` — palette, .side-rail — frosted surfaces — `.side-rail`->`[data-context-panel]`; palette refs remapped.
- `full_retest.spec.js` — palette — full retest — repoint palette probe.
- `motion_verify.spec.cjs` — palette — motion tokens — repoint palette motion section.
- `panel_speed_verify.spec.cjs` — palette — panel speed — repoint palette sections (`data-rail-collapsed` is LIVE, no action).
- `phase_radius_audit.spec.cjs` — palette, .side-rail — rounded surfaces — remap surfaces.
- `phase13_qa_sweep.spec.cjs` — palette, tfStagePanel — frameless/gear — drop palette screenshot (`tfStagePanel` is a comment).
- `phase13_visual_verification.spec.cjs` — palette — design screenshots — drop palette shot.
- `phase141_control_sweep.spec.cjs` — palette — title-bar file group — drop palette open.
- `phase16_control_index.spec.cjs` — ruler, .side-rail — "icon-only header" — `.side-rail`->`[data-context-panel]`; ruler -> ContextPanel ruler.
- `phase16_focused.spec.cjs` — ruler — ContextPanel collapse — **already green** (batch 1); reconcile the stale comment.
- `phase18_watermark.spec.cjs` / `_part2` / `_part3` — palette — watermark flows — repoint to the `watermark` dock verb.
- `phase20_baseline.spec.cjs` — palette — family mount probes — repoint palette burst to ContextPanel.
- `phase21_text_panel.spec.cjs` — .side-rail — floating text card — `.side-rail`->`[data-context-panel]`.
- `phase28_29_verify.spec.cjs` — palette, ruler — arrow leader — repoint palette drive.
- `phase32_control_index.spec.cjs` — toolbar-multi-mode — Multi Mode controls — repoint to title-bar toggle/dock verbs.
- `phase32_flicker.spec.cjs` — shared-toolbar, multi-mode, rotate-cw — Multi Mode flicker — repoint toolbar to dock/pills.
- `phase32_multi_mode.spec.cjs` — shared-toolbar, multi-mode — mode round-trip — repoint.
- `phase32_routing.spec.cjs` — shared-toolbar, rotate-cw, delete-pages — page ops on focused pane — repoint to dock verbs.
- `phase34_headers.spec.cjs` — shared-toolbar — pane headers — repoint.
- `phase34_tab.spec.cjs` — shared-toolbar, multi-mode, rotate-cw — composite tab — repoint.
- `phase35_operator_repro.spec.cjs` / `phase35_retest.spec.cjs` — .side-rail — headerless strip — `.side-rail`->`[data-context-panel]`.
- `probe_190_triage.spec.cjs` / `_r2` — palette — edit-text triage — repoint palette.
- `probe_frost_surfaces.spec.cjs` — palette — frosted dialog/menu facts — remap surface.
- `regression_b_port.spec.cjs` — palette — Sign cancel — repoint palette availability.
- `retests/b14_overlap.spec.cjs` — palette — OCR suspects overlap — remap to ContextPanel.
- `retests/def_098_verification.spec.cjs` — .side-rail — thumbnail jump — `.side-rail`->`[data-context-panel]`.
- `retests/def_141_verify_1.7.15.spec.cjs` — palette — crop pages stay full — repoint to `cropPages` verb/ContextPanel.
- `retests/def_167_168_169_verify_devbuild.spec.cjs` — palette — dev-build retests — repoint palette.
- `retests/def_171_escape_retest_190.spec.cjs` — palette — Escape closes sig manager — repoint palette availability.
- `retests/def_182_187_stacking_probe.spec.cjs` — palette — glass stacking — remap surface.
- `retests/def_191_194_retest.spec.cjs` — palette — phase-14.2 fixes — repoint palette.
- `retests/def_201_209_retest.spec.cjs` — palette — ghost/tool retests — repoint palette.
- `retests/def_211_ghost_dialog_retest.spec.cjs` — palette — "Insert Pages disarms ghost" — repoint to `insertPages` verb.
- `retests/def_247_249_retest.spec.cjs` — palette, .side-rail — docked panel radii — remap surfaces.
- `retests/def_p33_print_order_multi_bg.spec.cjs` — shared-toolbar — print order — repoint.
- `retests/def170_verify_devbuild.spec.cjs` — palette — two extracts two tabs — repoint palette.
- `retests/def183_188_final_probe.spec.cjs` — palette, layout, .side-rail — text rects/inks — remap.
- `retests/def282_retest.spec.cjs` — shared-toolbar — DEF-282 geometry — repoint.
- `retests/def286_290_retest.spec.cjs` — shared-toolbar, multi-mode — inset reserved once — **already green** (batch 1); reconcile stale token.
- `retests/dialog_repros.spec.cjs` — palette — "BUG-11 palette Delete page" — repoint to the `delete` dock verb.
- `retests/frosted_docked_verify.spec.cjs` — palette, .side-rail — frosted docked panels — remap.
- `retests/gt_crop_stack_1.7.14.spec.cjs` — palette — crop stacking — repoint.
- `retests/gt_crop_update.spec.cjs` — palette — crop drag no flash — repoint.
- `retests/gt_repro2_dialogs.spec.cjs` — palette — DOCX drag-highlight — repoint to `exportDocx` verb.
- `retests/gt_repro_1710.spec.cjs` — palette — insert blank page order — repoint to `insertPages` verb.
- `retests/ocr_crop_repros.spec.cjs` — palette — OCR + crop — repoint to dock verbs.
- `retests/phase14_final_visual.spec.cjs` — palette — aurora through glass — remap surface.
- `retests/qa_glass_blur_probe.spec.cjs` — palette — glass blur diffuses — remap to ContextPanel/Inspector.
- `retests/tab_ocr_extra.spec.cjs` — palette — new tab inherits armed tool — arm via REVIEW flyout.
- `sweep_annotations_sign.spec.cjs` — palette — annotation/sign sweep — repoint palette drive.
- `sweep_edit_forms_export.spec.cjs` — palette — edit/forms/export sweep — repoint.
- `sweep_pageops.spec.cjs` — palette — page-ops sweep — repoint.
- `sweep_visual.spec.cjs` / `sweep_visual_dev.spec.cjs` — palette — visual sweeps — drop palette screen, keep others.
- `verify/def216_watermark_deadpath.spec.cjs` — palette — watermark dead path — repoint palette availability.

## 5. Progress this session

- **Batch 0 (STEP 0):** `phase36_def322_323_retest.spec.cjs` -> **2 passed**; DEF-322 + DEF-323 CLOSED.
- **Batch 1b (migrate):** `retests/def_106_file.spec.cjs`, `retests/gt_docx_ocr_pages.spec.cjs` -> **4 passed** (`DEF-106 dock verb lane: inline`).
- New helper: `helpers.clickDockVerb(window, stage, id)` (inline or "More" overflow lane).
- **Not yet run:** the full e2e suite (required closure evidence) and the remaining migrate/retire edits.

## 6. Batch 2 (bounded migrate pass) — 16 files touched

Per-file counts from `e2e/p36_mig_batch2.log` + `e2e/p36_mig_batch2b.log` (21 passed / 15 failed, then 14 passed / 9 failed after a helper fix). The failures split into three classes:

**(i) Migrated and fully GREEN**
- `retests/def_171_escape_retest_190.spec.cjs` — 1/1
- `retests/b14_overlap.spec.cjs` — 1/1
- `retests/def170_verify_devbuild.spec.cjs` — 1/1
- `retests/tab_ocr_extra.spec.cjs` — 2/2
- (session 1) `retests/def_106_file.spec.cjs`, `retests/gt_docx_ocr_pages.spec.cjs` — 4/4

**(ii) Migrated; residual failures are PRODUCT bugs, not the palette drive**
- `retests/gt_repro2_dialogs.spec.cjs` — Bug 8 crop flicker (product)
- `retests/def_167_168_169_verify_devbuild.spec.cjs` — DEF-167 green; DEF-168 accent-colour product failure; DEF-169 is an (a) palette-z-order subject (left for the retire pass)
- `retests/gt_repro_1710.spec.cjs` — BUG2/BUG3dup green; BUG4/BUG5 textbox move product failures
- `probe_190_triage_r2.spec.cjs` — R1 callout editor product failure

**(iii) BLOCKED — target verb is not rendered on the stage dock (needs the Command Palette route)**
The PAGES-stage dock at 1440px renders only six inline verbs with NO overflow button:
`["rotate","extract","insertPages","replacePages","split","delete"]`.
`cropPages`, `merge`, `renumberPages`, `rotateCounterClockwise`, `pageThumbnails`, `outlinePanel` are absent, so `clickDockVerb` cannot reach them. Affected: `retests/def_141_verify_1.7.15`, `retests/gt_crop_stack_1.7.14`, `retests/gt_crop_update` (GT-08), `retests/ocr_crop_repros` (BUG-20), `retests/gt_repro_1710` (BUG3), `retests/gt_repro2_dialogs` (Bug 8), `probe_190_triage` (T7 merge). Fix for the next batch: reach these via the Command Palette (`Ctrl+K` -> `[data-command-palette-input]` -> the verb's label), which is the documented global command home; the label map is in `src/renderer/state/toolsRegistry.ts`.

**Totals after batch 2**
- (b) migrate list: 66 -> **50 remaining** (16 touched; 4 fully green, 11 migrated-with-residual-product-failures, 7 blocked on the palette route — overlapping sets).
- (a) retire list: **17 remaining** (untouched, per instruction).
- (c) leave: 6 unchanged.
- `helpers.clickDockVerb` now: inline -> overflow -> Escape-and-retry -> throws with the present-verb list (diagnostic).
- Full suite still NOT run (later batch).

## 7. Batch 3 — the "run this tool by registry id" helper

`helpers.runTool(window, id)` resolves a tool's CORRECT current home, in order:
1. `merge` -> the PAGES ContextPanel header Combine control `[data-context-panel-combine]`.
2. Action Dock verb on the tool's registry stage, then every other stage (inline `[data-dock-verb]`, then the `[data-dock-overflow]` -> `[data-dock-overflow-item]` lane).
3. Command Palette fallback: `Ctrl+K` -> `[data-command-palette-input]` -> fill the registry label -> click `.command-palette-row` matching the label (Enter if absent).
Label/stage maps mirror `src/renderer/state/toolsRegistry.ts`. Returns the home it used (`combine` / `dock:N` / `palette`).

**Result: `e2e/p36_mig_batch3.log` — 34 passed / 5 failed (13 files).** The batch-2 blocker is fixed: `cropPages`/`merge` now resolve (the dock's six inline verbs were the cause). Fully green: `retests/def_141_verify_1.7.15`, `retests/gt_crop_stack_1.7.14`, `retests/gt_crop_update`, `retests/ocr_crop_repros`, `retests/gt_repro2_dialogs`, `probe_190_triage` (T7 merge now ok), `probe_frost_surfaces`, `retests/dialog_repros` (6/6), `sweep_edit_forms_export` (3/3).

**Remaining (b): 50 -> 45. Remaining (a): 17 (untouched).** Full suite still NOT run.

### Non-migration reds for the orchestrator (NOT palette; do not attribute to this migration)
- `crop_thumbs_port.spec.cjs` PORT BUG1 — thumbnail aspect after crop: "pages 2/3/4 thumbnail wrap must keep the FULL page aspect (~0.773)" (product/DOM).
- `probe_190_triage_r2.spec.cjs` R1 — "Phase 26: the panel Text field is the callout editor" (Phase 26 panel editor).
- `retests/gt_repro_1710.spec.cjs` BUG4/BUG5 — wait for the retired `.edit-inline-textarea` (editor moved to the panel in Phase 26).
- `sweep_pageops.spec.cjs` P3 — waits for `[aria-label="Undo last change"]` (Undo moved to the PAGES stage).

## 8. Batch 4 — runTool applied (7 files this batch)

`runTool` extended with the `undo`/`redo` labels+stages (Undo's home is `palette` per `toolsRegistry.ts:1348`).

| file | count | note |
| --- | --- | --- |
| `sweep_pageops.spec.cjs` | 3/3 | P3 now green — Undo via `runTool(win,'undo')` |
| `sweep_visual.spec.cjs` | 1/1 | palette screen -> ContextPanel |
| `sweep_visual_dev.spec.cjs` | 0/1 | non-migration red (below) |
| `class_sweep_def221_222.spec.cjs` | 6/7 | A1b non-migration red |
| `retests/def_182_187_stacking_probe.spec.cjs` | 1/1 | |
| `retests/def_201_209_retest.spec.cjs` | 6/6 | |
| `verify/def216_watermark_deadpath.spec.cjs` | 1/1 | watermark via runTool |

Logs: `e2e/p36_mig_batch4.log` (17 passed / 3 failed), `e2e/p36_mig_batch4b.log` (def216 fix, 1 passed). **Batch net: 18 passed / 2 failed.**

**Remaining (b): 45 -> 38. Remaining (a): 17 (untouched).** Full suite still NOT run.

Still to migrate next batch (started, not finished): `regression_b_port`, `phase_radius_audit`, `phase13_qa_sweep`, `phase13_visual_verification`, `phase28_29_verify`, `def217_219_retest`, `def214_reverify_v1170`, `phase21_text_panel`, `sweep_annotations_sign`, `phase18_watermark`(+2/+3), `motion_verify`, `anim_audit`, `panel_speed_verify`, `phase16_control_index`, `phase20_baseline`, `phase32_*`, `phase34_*`, `phase35_*`, and the remaining `retests/*`.

### Non-migration reds for the orchestrator (NOT palette/runTool)
- `sweep_visual_dev.spec.cjs` — waits for `button[aria-label="Highlight"]` (annotation tool now in the REVIEW flyout).
- `class_sweep_def221_222.spec.cjs` A1b — text-box move (Phase 26 panel editor), same class as the gt_repro_1710 BUG4/BUG5 reds.

## 9. Batch 5 — runTool + flyout support (8 files)

`runTool` now resolves annotation tool ids (`annHighlight`, `annInk`, `annTextbox`, ...) through the REVIEW Annotate flyout via `armAnnotationTool`.

| file | count |
| --- | --- |
| `sweep_visual_dev.spec.cjs` | 1/1 |
| `def217_219_retest.spec.cjs` | 5/5 |
| `phase13_qa_sweep.spec.cjs` | 3/4 |
| `phase13_visual_verification.spec.cjs` | 1/1 |
| `phase28_29_verify.spec.cjs` | 8/10 |
| `phase_radius_audit.spec.cjs` | 2/2 |
| `regression_b_port.spec.cjs` | 10/11 |
| `sweep_annotations_sign.spec.cjs` | 5/5 |

Log `e2e/p36_mig_batch5.log`: **35 passed / 4 failed — all 4 non-migration** (below).

**Remaining (b): 38 -> 30. Remaining (a): 17 (untouched).** Full suite still NOT run.

### Non-migration reds (batch 5)
- `phase13_qa_sweep` "icon-only toolbar … rotate" — waits for `.thumb-item` (thumbnail class moved to the ContextPanel).
- `phase28_29_verify` P29 C1 — `.document-scroller mr is 0` (Inspector is default-open now: the flush premise is superseded).
- `phase28_29_verify` P29 C3 — text-editor drag path (`[data-txt-text]`); Phase 26 panel editor.
- `regression_b_port` B20 — the retired Tools-palette close button (subject gone; belongs to the (a) retire pass).

## 10. Batch 6 — (b) migrate + first (a) retirement pass

### Migrated (b), 22 passed / 3 failed (`e2e/p36_mig_batch6.log`)
| file | count |
| --- | --- |
| `phase21_text_panel.spec.cjs` | 5/6 |
| `retests/def_098_verification.spec.cjs` | 1/1 |
| `phase16_control_index.spec.cjs` | 6/8 |
| `regression_b_port.spec.cjs` | 10/10 (B20 test removed, others renumbered) |

### RETIRED (a) — 11 files deleted (behaviour covered elsewhere)
| deleted file | retired subject | covering spec |
| --- | --- | --- |
| `e2e/anim_probe.spec.cjs` | modal-over-palette z-order | `phase20_verify`, `anim_audit` |
| `e2e/probe_backdrop.spec.cjs` | backdrop-filter over the badge | `phase20_baseline` |
| `e2e/qa_reference_compare.spec.cjs` | palette/rail reference capture | `phase34_panel_inset`, `phase36_chunk456_gate` |
| `e2e/toolbar_tab_highlight_probe.spec.cjs` | `[data-unified-toolbar]` tab highlight | `phase36_chunk1_rail_gate` |
| `e2e/def233_234_retest.spec.cjs` | palette resize lockstep | `phase34_panel_inset` |
| `e2e/phase33_multi_toolbar.spec.cjs` | the one shared Multi Mode toolbar | `phase36_chunk3_dock_gate` |
| `e2e/retests/def189_evidence.spec.cjs` | palette evidence shot | `theme_preferences` |
| `e2e/retests/def190_lift_diag.spec.cjs` | palette lift diagnostic | `phase24_annotation_styles` |
| `e2e/retests/qa_diag_resize_pending.spec.cjs` | palette-driven stamp diag | `phase24_annotation_styles` |
| `e2e/retests/def_247_249_retest.spec.cjs` | `.side-rail` + palette radii | `phase_radius_audit`, `phase34_panel_inset` |
| `e2e/retests/frosted_docked_verify.spec.cjs` | palette + rail frosted measure | `phase20_baseline`, `phase36_chunk456_gate` |
| (inside `regression_b_port`) B20 test | retired palette close control | `phase36_chunk456_gate`, `phase34_panel_inset` |

**Remaining (b): 30 -> 27. Remaining (a): 17 -> 6.** Full suite still NOT run.

### Non-migration reds (batch 6)
- `phase16_control_index` P16C-1 — waits for `.rail-header` (retired rail chrome).
- `phase16_control_index` P16C-6 — waits for `.rail-tab[title="Page thumbnails"]` (retired rail tab).
- `phase21_text_panel` C3 — `[data-txt-text]` floating-toolbox absence check (Phase 26 panel editor).

## 11. Batch 7 — remaining (a) retirement pass

### RETIRED (a) — 8 more files deleted
| deleted file | retired subject | covering spec |
| --- | --- | --- |
| `retests/def_180_181_retest.spec.cjs` | palette list/grid tool titles | `phase_radius_audit` |
| `retests/def_195_196_197_retest.spec.cjs` | palette open/close motion timing | `phase20_verify`, `phase23_animations_switch` |
| `retests/def189_190_final.spec.cjs` | theme dropdown over the Tools palette | `theme_preferences` |
| `retests/operator_repros.spec.cjs` | "close tab leaves Tools panel open" | `phase36_chunk456_gate`, `phase34_panel_inset` |
| `retests/gt_repro3_ocr.spec.cjs` | OCR suspects behind the tools panel | `phase36_chunk456_gate` |
| `retests/probe_crop_boxes_1.7.14.spec.cjs` | palette-driven crop diagnostic | `retests/def_141_verify_1.7.15`, `retests/gt_crop_update` |
| `retests/qa_themes_tools_verify_1.10.2.spec.cjs` | palette groups per theme | `theme_preferences` |
| `retests/phase34_runclose_reconfirm.spec.cjs` | badge/palette pane-shrink check | `phase34_panel_inset` |

**Remaining (b): 27 (unchanged this batch). Remaining (a): 6 -> 0 (all retired). Remaining (c): 6 (2 installed/release + 4 deliberate retirement proofs).** Full suite still NOT run.

### (b) stale-selector leftovers NOT migrated this batch (need behavioural work, not a selector swap)
- `phase16_control_index` P16C-1/P16C-6 — `.rail-header` / `.rail-tab` retired; the panel's header + section tabs need the ContextPanel structure, not a literal swap.
- `phase21_text_panel` C3 — floating-toolbox absence check; the Phase 26 panel is the editor.
- `phase28_29_verify` P29 C1/C3 — `.document-scroller mr is 0` (Inspector default-open supersedes the flush premise) and the text-editor path.
- `phase13_qa_sweep` test 3 — `.thumb-item` rail selection + `[data-rail-action-bar]` rotate-ccw now in the ContextPanel selection action bar.

## 12. Batch 8 — re-scope attempt (2 files, partial)

Applied the confirmed anchors: `.thumb-item` re-scoped to `[data-context-panel-thumbs] .thumb-item`; `phase16_control_index` header -> `.context-panel-header`, tabs -> `[data-context-panel-section=...]`/`[data-context-panel-outline]`.

`e2e/p36_mig_batch8.log` — 8 passed / 4 failed.
- `phase13_qa_sweep` 3/4; test 3 still red (30s click timeout — the `[data-rail-action-bar]`/selection path; needs the panel's selection action bar).
- `phase16_control_index` 5/7; P16C-1 red (header/section assertion still mismatched), P16C-5 red (`rail column restored to 220px`), P16C-6 red.

**Neither file is fully migrated; (b) stays 27. (c) 6. (a) 0.** Full suite NOT run.








