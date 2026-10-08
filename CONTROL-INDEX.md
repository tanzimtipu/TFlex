# TFlex Control Index — Phase 13/14 baseline

> This is the verified baseline for Phase 13/14 chrome and glass controls, not a blanket
> all-project test plan. QA sweeps only the controls named by its assigned task or current
> phase. Phase 15/16 controls must be indexed beside their implementation before that phase
> can close; do not infer their coverage from this historical baseline.

This index enumerates every Phase 13 control (frameless window chrome,
custom controls, menu popover, semantic colors). For each control it
pins the selector, the promised action, the unit test that locks the
behaviour at the source, and the e2e test that drives it through the
real running Electron app. The format mirrors AGENTS.md's "no-op sweep"
contract: a control shipped without a working action is a defect, and
every control here must demonstrably do something.

The four defects this index was opened against (DEF-081, DEF-082,
DEF-083, DEF-084) are noted inline so a regression to any of them is
caught at the source instead of in a retest pass.

## Window chrome (frameless)

| Control | Selector | Promised action | Unit test | E2e |
|---|---|---|---|---|
| TitleBar (drag region) | `.titlebar` (`data-titlebar`) | Treated as the window caption; drag-to-move + Aero Snap work | `test/unit/renderer/designTokensContract.test.ts` (pins `-webkit-app-region: drag` on `.titlebar` and `no-drag` on `> *`) | `e2e/phase13_gate_final.spec.cjs` SC1 |
| Window control — minimize | `.titlebar-control-min` (`data-window-minimize`) | Calls `tflex.minimizeWindow()` | `test/unit/renderer/titleBar.test.tsx` (wires `onMinimize` to `window.tflex.minimizeWindow`) | `e2e/phase13_gate_final.spec.cjs` SC1 |
| Window control — maximize / restore | `.titlebar-control-max` (`data-window-maximize`) | Calls `tflex.maximizeWindow()`; icon swaps based on `maximized` prop | `test/unit/renderer/titleBar.test.tsx` (asserts icon swap at `maximized={true}` and `maximized={false}`) | `e2e/phase13_gate_final.spec.cjs` SC1 |
| Window control — close | `.titlebar-control-close` (`data-window-close`) | Calls `tflex.closeWindow()`; hover state swaps to semantic `var(--error)` background | `test/unit/renderer/titleBar.test.tsx` | `e2e/phase13_gate_final.spec.cjs` SC1 |

### DEF-081 — grid collapse fix

| Control | Selector | Promised action | Unit test | E2e |
|---|---|---|---|---|
| `.app` grid template | `.app` (grid container) | Three rows (Phase 105 chunk C): the 48px title row (auto), the 40px document rail (auto) and app-main (1fr). The pre-Phase-105 two-row template (`.titlebar` + app-main) collapsed to two because the AppHeader sat inside the TitleBar; the rail is a real third grid item now. TFL-1141 (R07): that rail row is conditional — it mounts only with >= 1 document tab — so `.app-main` is pinned to the final track (`grid-row: 3`) and can no longer auto-flow into the empty `auto` row (which collapsed the welcome pane). DEF-579: the single column is pinned to `minmax(0, 1fr)`, so no grid item (the document rail included) can size the track to its content and push the shell past the viewport. | `test/unit/renderer/designTokensContract.test.ts` (grid contract pins `auto auto 1fr`) + `test/unit/renderer/phase105_titleRow.test.tsx` + `test/unit/renderer/tfl1116_homeChrome.test.ts` (R07 gate + R06 inset) | `e2e/phase13_gate_final.spec.cjs` SC1/SC5 (welcomescreen + workspace visible after gate) + `e2e/tfl1116_r06_r07_home_chrome.spec.cjs` (zero-doc Home welcome visible with no rail) |
| `.app-main` fills viewport | `.app-main` | Has non-zero height and contains the Welcome screen or Workspace after boot. Playwright's `toBeVisible()` on `.welcome` / `.workspace` proves the workspace is rendered, not hidden. | (CSS-level; new designTokensContract test pins the grid template) | `e2e/phase13_gate_final.spec.cjs` SC1 (`.titlebar` and `.welcome` both visible after launch) |

## Menu popover

| Control | Selector | Promised action | Unit test | E2e |
|---|---|---|---|---|
| Menu button | `.titlebar-menu-button` (`data-menu-button`) | Toggles the popover open/closed; `aria-haspopup="menu"` and `aria-expanded` flip together | `test/unit/renderer/titleBar.test.tsx` (click toggles popover visibility) | `e2e/phase13_gate_final.spec.cjs` SC2 |
| Popover | `.titlebar-menu-popover` (`data-menu-popover`) | Renders every entry from `menuGroups` with `role="menu"` + group heading + accelerator chip; closes on outside click, Escape, or entry click | `test/unit/renderer/titleBar.test.tsx` (menu structure + Escape close) + `test/unit/renderer/titleBarFileMenu.test.tsx` | `e2e/phase13_gate_final.spec.cjs` SC2 |
| Popover row | `.titlebar-menu-row` (`data-menu-action`) | Routes through `dispatchMenuAction(action, menuContext)` — the same dispatcher the native menu uses | `test/unit/renderer/titleBar.test.tsx` (click invokes dispatcher) + `test/unit/renderer/titleBarFileMenu.test.tsx` | `e2e/phase13_gate_final.spec.cjs` SC2 (menu items trigger handlers) |
| Page context menu | `[data-context-menu]` (`data-page`) | The six page verbs (Rotate CW / Rotate CCW / Extract… / Insert blank after / Replace… / Delete…, delete danger-styled); opens fixed at the pointer, closes on Escape / outside-click / scroll; every row keeps `data-menu-item` (TFL-998 chunk C8, on the shared `CommandMenu`). | `test/unit/renderer/pageThumbMenu.test.tsx` + `test/unit/renderer/phase36ContextPanel.test.tsx` | `e2e/phase36_chunk2_pages_parity.spec.cjs` |

TFL-975 (TFL-855 chunk C5): the File popover now renders through the shared
`CommandMenu` primitive (`src/renderer/components/CommandMenu.tsx`), which owns the
shipped `.titlebar-menu-*` DOM contract and the outside-click / Escape /
focus-return-to-opener behaviour. `TitleBar` keeps only the trigger and the
`dispatchMenuAction` routing (via `onMenuEntry`); the popover enters with the shared
`TfMenu` motion in place of the retired FLIP morph. Every File command and
accelerator is preserved verbatim.

TFL-993 (TFL-855 chunk C7): the AppHeader application menu (`[data-app-menu]`) now
renders through the same `CommandMenu` primitive, reusing C5's exported
`toCommandGroups` (`TitleBar.tsx`) and keeping the `app-menu-popover` class plus the
`data-app-menu-popover` hook (via `className` + the additive `popoverDataAttrs` prop)
so existing selectors keep resolving. The bespoke `TfMorph` / outside-click / Escape /
Tab / roving-focus plumbing is removed; CommandMenu owns dismiss, focus capture and
return-to-trigger. Every Edit / View / Tools / Help command and the relocated Multi
Mode / Find rows (with the Find row's `disabledReason`) are preserved verbatim. This
also adds Tab-close to `CommandMenu`, so both the File and application menus close on
Tab. The application menu enters with the shared `TfMenu` motion in place of the
retired FLIP morph. Test: `test/unit/renderer/appHeaderAppMenu.test.tsx`.

TFL-1116 (Visual overhaul R03, chunk C3): the application menu now fits the
viewport through ONE shared collision-aware placement, `placeOverlay`
(`src/renderer/components/overlayPlacement.ts`, bound by the
`useOverlayPlacement` / `useSubmenuPlacement` hooks in
`useOverlayPlacement.ts`, mirroring the pure-clamp philosophy of
`controlPlacement.ts`). `CommandMenu` gains an additive `collisionAware` prop
(default `false`, so no other adopter changes): when set, the root is portaled to
`document.body` and positioned `fixed` from the opener rect with the 8px viewport
gutter, a viewport-bounded `max-height` / `max-width` and vertical-scroll only,
and nested submenus are portaled and placed beside their row with a right-to-left
flip when the right edge would overflow. Long labels wrap and the `.kbd`
accelerator is a bounded non-shrinking column, so the popover is content-bounded
and can shrink to the viewport. The `data-app-menu` / `data-app-menu-popover` /
`.titlebar-menu-*` / `data-menu-action` / `.kbd` DOM contract is unchanged; the
AppHeader application menu opts in via `collisionAware`. Tests:
`test/unit/renderer/tfl1116_overlayPlacement.test.ts` (pure `placeOverlay` edge
cases) + `test/unit/renderer/appHeaderAppMenu.test.tsx` (portal-scoped lookups,
behaviour unchanged) + `test/unit/renderer/commandMenu.test.tsx`.

DEF-618 (TFL-1121 rework, same chunk C3): the collision-aware surface must also
be content-bounded, not merely clipped. The portaled/fixed root clears the legacy
`.app-menu-popover { right: 0 }` anchor (`right: auto`) and renders at
`width: max-content`, capped by the viewport-bounded `max-width`; the
`.app-menu-popover.command-menu` rule re-asserts `right: auto` for the first
render before the inline style lands, and the nested submenu clears `right` too.
`useOverlayPlacement` measures the layout box (`offsetWidth` / `offsetHeight`)
instead of `getBoundingClientRect`, because the `TfMenu` enter animation's
`scale(0.95)` made the client rect 5% small and under-shifted the horizontal
clamp. Guarded by the qa-owned e2e `e2e/tfl1116_r03_app_menu_fit.spec.cjs` (8px
gutter on both sides, no horizontal scroll, at 960x640 / 1024x768 / 1280x800 /
maximized).

TFL-1124 (TFL-1116 C4, R05): the ACTIVE SURFACE decides document-only command
availability through ONE renderer capability evaluator,
`src/renderer/state/commandCapability.ts` (pure, React-free). "Home" means no
document on the active tab, derived from the existing `activeTabHasDocument`
predicate in `App.tsx`; `deriveCommandSurface` maps it to `"home"` / `"document"`.
On Home the document-only commands — Save, Save As, Close Tab, Undo, Redo,
Recognize Text, Find and Print — are ABSENT (not merely disabled) from the File
popover, the application menu and the title-row toolbar, and their Ctrl/Cmd
keyboard routes are no-ops; on a document they behave exactly as before. The
File / application groups are derived from `filterMenuGroupsForSurface`
(document-only action ids: `save`, `saveAs`, `closeTab`, `undo`, `redo`,
`recognizeText`; an emptied group, e.g. Tools, is dropped). `AppHeader` gains an
additive `commandSurface` prop (default `"document"`, so existing callers/tests
are unchanged) that omits the Save / Save As / Print controls and the relocated
Find row on Home while keeping Open, the Command Palette icon, the application
menu trigger, the update indicator and the account slot. The `snapshotMenuEnabled`
snapshot now keys Save / Save As / Close Tab / Undo / Redo to the document
surface rather than a bare active-tab id. Tests:
`test/unit/renderer/tfl1116_commandCapability.test.ts`; e2e
`e2e/tfl1116_r05_home_command_gating.spec.cjs` (File / app menu / toolbar /
keyboard on Home, document and background-document Home).

DEF-626 (TFL-1176): the Command Palette is a FOURTH R05 surface and now obeys
the same algebra. Its flat corpus is filtered with `filterEntriesForSurface`
(the flat-shape sibling of `filterMenuGroupsForSurface`), so on Home the Save /
Save a copy / Close Tab rows are ABSENT from the palette — not listed-disabled —
even when an empty placeholder tab keeps `tabs.activeId` non-null; on a document
the registry is passed by reference and the rows return. The `save` / `saveAs` /
`closeTab` palette handlers key on `activeTabHasDocument` (a real engine session,
`App.tsx`), and `appActionGates` carries the same three gates so the live
availability can never disagree with the corpus. Tests:
`test/unit/renderer/tfl1116_commandCapability.test.ts` (flat corpus on home /
document); e2e `e2e/tfl1116_r05_home_command_gating.spec.cjs` Case D (Home behind
an active empty tab: palette rows absent; document tab: rows present).

TFL-1126 (TFL-1116 C5, R04): one document-scoped navigation model keeps the
thumbnail navigator, the canvas and the ViewStrip footer in step after a
COMMITTED page jump. `DocumentView` bumps a per-document `revealSeq` counter
inside its single `jumpToPage` funnel (the ViewStrip input, the Next/Previous
verbs, an external Multi Mode request, an outline/annotation jump and the
initial-page restore all pass through it) and threads it to the thumbnail
navigator through `ContextPanel` / `PaneThumbStrip`. `ThumbnailRail` recentres
the viewed page's ACTUAL thumb element when that counter changes (layout-truth
box, not the uniform slot estimate, so a far jump in a 520-page rail lands
correctly), while a scroll-driven `currentPage` change leaves the counter
untouched and preserves the Bug 3 gate. A commit that never lands releases the
DEF-058 jump lock only when the scroller moves AWAY from the target, so the
persisted reading page is the SETTLED canvas page rather than a mid-flight
optimistic value; page selection is never mutated by a jump. Unit:
`test/unit/renderer/tfl1116_navigationSync.test.tsx`; e2e
`e2e/tfl1116_r04_navigation_sync.spec.cjs` (520-page doc: 1 -> 260 -> 520
reveals the thumb, the footer agrees, Next is disabled at 520 and the
selection is unchanged; tab away-and-back agrees). DEF-619 (QA reopened C5): a
far committed jump across a 520-page document intermittently tripped React error
#185 (maximum update depth) and blanked the window. Root cause: during the jump's
smooth scroll the canvas mounts pages continuously and `DocumentView` published
the growing `pageSizes` map to the host synchronously on every change, so the
whole App re-rendered once per page; that render -> passive-effect -> setState
cascade exceeded React's update-depth limit. Fix: `DocumentView` coalesces the
page-size report to one `requestAnimationFrame` (the frame callback reads the
live map, so no size is lost), and `SideRail`'s `slotTops`-keyed seeding effect
bails out when the visible set is unchanged. Verified: dev e2e 10/10 and the QA
isolation probe 0 crashes over 10 executions; R04 behaviour unchanged.

TFL-1130 (TFL-1116 DEF-620): the Inspector's Page `Size` row no longer goes
stale after a tab away/back round trip in single mode. Root cause: the host's
`livePageSizes` map was keyed by pane (`reportPageSizesFor(pane, sizes)`), so in
single mode (pane `null`) every mounted tab published under the same `"single"`
key - the last tab to report overwrote it, and a re-activated tab whose measured
sizes had not changed never re-reported. Fix: `livePageSizeScopeKey`
(`src/renderer/state/pageSizeScope.ts`) keys the map by the PANE in Multi Mode
(`"A"` / `"B"`, preserving the two-pane behaviour) and by the ACTIVE TAB id in
single mode (mirroring the per-document keying of `exportDraft` /
`navigatorState`), so each tab's measured geometry is stored under its own key
and survives the round trip; the Inspector lookup reads
`livePageSizes[livePageSizeScopeKey(stagePane, tabs.activeId)]`. Unit:
`test/unit/renderer/tfl1116_pageSizeScope.test.ts`; e2e
`e2e/tfl1128_geometry_generic.qa.spec.cjs` +
`e2e/tfl1128_def619_geometry_probe.qa.spec.cjs` (both un-fixme'd; the generic
spec also gains its missing `expect` import).

TFL-1135 (TFL-1116 DEF-622): Multi Mode's shared Inspector Page `Size` row no
longer reads "Not available" for a normally-opened document. Root cause: Multi
Mode reuses the same `.tab-pane` (keyed by tab id, no remount) and only flips
`multiPane`, so entering the mode / binding a document to a pane left
`DocumentView`'s `pageSizes` (and its identity) untouched and the report effect,
keyed only on `[pageSizes]`, never re-published: the host's pane-keyed
`livePageSizes` maps stayed empty. Fix: the report effect also keys on
`multiPane` (the pane component of `livePageSizeScopeKey`; single mode is keyed
by this per-tab view's constant tab id), so entry to Multi Mode and every pane
reassignment re-publish that view's OWN measured map under `"A"`/`"B"` with no
remount. Unit: `test/unit/renderer/tfl1116_multimodePageSize.test.tsx`; e2e
`e2e/tfl1130_multimode_geometry.qa.spec.cjs` (un-fixme'd: pane A 612x792, pane B
595x842). The DEF-620 single-mode per-tab keying is unchanged.

TFL-1137 (TFL-1116 C6, R12): the settled Action Dock and View Strip footer no
longer fade their ENABLED label/icon content when idle. The 3s State 4 idle, its
hover/focus restore and the `data-dock-idle` / `data-view-strip-idle` hooks are
unchanged; only WHAT idle paints moved to chrome. `.action-dock[data-dock-idle='true']`
drops the floating elevation (`box-shadow: none`) instead of `opacity: 0.4`, and
`.view-strip[data-view-strip-idle='true']` calms the top separator
(`border-top-color: transparent`) instead of fading `.view-strip-page` /
`.view-strip-view`. Enabled content stays at full opacity (composited resting
contrast for `--tf-icon-rest` on `--bg-elevated` and `--fg` on `--bg-toolbar`
clears 4.5:1 in light/dark/frosted), while the canonical `.btn[disabled]`
`opacity: 0.55` keeps disabled controls visibly muted. Unit:
`test/unit/renderer/tfl1116_idleLegibility.test.ts`; e2e
`e2e/tfl1116_r12_idle_legibility.spec.cjs` (settled dock + footer probes +
screenshots `screenshots/tfl1116_r12_dock_idle.png` /
`screenshots/tfl1116_r12_footer_idle.png`).

TFL-1139 (TFL-1116 C6b, R21 + R26): the Deliver export primary action
(`.export-config-action`, `Button intent="primary"`) is now a real CTA — 40px
minimum height, a 13px semibold label and a `currentColor` glyph whose ink rides
the button rather than the Inspector's neutral `.inspector svg` rule
(`.export-config-action svg { color: currentColor }`). Disabled is an explicit
muted-violet pair (`--btn-primary-disabled-bg` / `--btn-primary-disabled-fg`,
new light + dark tokens) instead of a parent opacity fade; enabled and disabled
ink both clear 4.5:1 (5.52:1 / 4.73:1 light). R26 unifies the panel type roles on
the shared Quiet Precision tokens — `--tf-panel-heading-size` (16),
`--tf-panel-body-size` (14), `--tf-panel-control-size` (13),
`--tf-panel-helper-size` (12) — and shortens the Deliver output-checks legend,
tightens the fidelity-notes block so it does not bury the CTA, and keeps the
legacy `--tf-panel-secondary-label-size`. Unit:
`test/unit/renderer/tfl1116_exportCtaTokens.test.ts`; e2e
`e2e/tfl1116_r21_r26_export_cta.spec.cjs` (enabled/disabled contrast + compact
960x640 drawer reachability; screenshots `screenshots/tfl1116_r21_cta_enabled.png`
/ `screenshots/tfl1116_r21_cta_disabled.png` /
`screenshots/tfl1116_r26_cta_compact_drawer.png`).

TFL-1141 (TFL-1116 C7, R06 + R07): Home chrome. R06 — the title-bar brand
(`.titlebar > .brand`) keeps a 16px leading inset (`--space-standard`) at EVERY
width; the rule previously lived inside the `@media (max-width: 900px)` band, so
at the default wide window the brand had no leading padding and its mark touched
the native left edge. The rule is now global (the brand stays a drag surface, so
the inset opens no dead strip). R07 — the 40px document rail is mounted only when
at least one document session exists: `isDocumentRailVisible(tabCount)`
(`DocumentRail.tsx`, mirroring `isStageRailVisible`) gates the App mount, so Home
with zero tabs renders NO `.document-rail` / `.tab-area` row; one tab or more
(including the Multi Mode composite session, which App folds into `stripTabs`)
shows the colorful strip. `.app-main` is pinned to the final `1fr` grid track
(`grid-row: 3`) so removing the rail row cannot auto-flow the main area into the
`auto` row and collapse the welcome pane. Unit:
`test/unit/renderer/tfl1116_homeChrome.test.ts`; e2e
`e2e/tfl1116_r06_r07_home_chrome.spec.cjs` (zero-doc Home has no rail; brand inset
16px; one-doc Home shows the strip; screenshots
`screenshots/tfl1116_r06_brand_inset.png` /
`screenshots/tfl1116_r07_zero_tab_home.png`).

TFL-1153 (TFL-1116 C8, R10): Home Orbit arc contrast + motion scope. R10 — the
thin violet/amber arcs read too faint on the gray Home canvas. The motif is now
inked from the Jovrel Halo mark's violet/amber: the base light AND frosted
surfaces use the brand violet (`var(--tf-accent)`) with a deepened amber
(`#B45309`), and dark uses the lightened pair (`#B9A4FF` / `#FBB724`). Frosted
previously inherited the dark pastels even though it paints the same LIGHT
`--bg-sunken` (`#e8ebf0`), so its arcs washed out; it now shares the deep light
ink. The ring layer grew 320 -> 360px and the opacity moved to the top of the
sanctioned 0.18-0.28 band (0.28 base / 0.26 dark). A slow FILTER hue drift
(`tf-anim-orbit-hue`, hue-rotate +/-6deg over the shared 18s
`--motion-duration-orbit`) runs on the decorative rings only - never opacity,
never a moving gradient - so the copy stays on a stable background; the global
reduced-motion stop kills it and the `::after` ring keeps its authored static
pose. The four-gate effective motion scope is unchanged and pinned (Animations
ON AND reduced-motion OFF AND Home visible AND Home pause OFF; each gate
independently disables the drift). Unit:
`test/unit/renderer/tfl1116_orbitContrast.test.ts` +
`test/unit/renderer/tfl1116_orbitScope.test.ts`; e2e
`e2e/tfl1116_r10_orbit.spec.cjs` (rest / paused / reduced-motion screenshots
`screenshots/tfl1116_r10_orbit_rest.png` /
`screenshots/tfl1116_r10_orbit_paused.png` /
`screenshots/tfl1116_r10_orbit_reduced.png`).

TFL-1155 (TFL-1116 C9, R11): one panel shell + one shared scrollbar. R11 — panel
scroll ownership was inconsistent (the Navigator body ran to the column bottom, the
Inspector body had different bounds, and the native arrowed scrollbars looked dated).
`PanelShell` (`src/renderer/components/panels/PanelPrimitives.tsx`) now takes an optional
`footer` and renders it as a FIXED `.tf-panel-footer`; the shared `.tf-panel-shell`
geometry fixes the header, gives the body `flex: 1 1 auto; min-height: 0; overflow-y: auto`
and clips horizontal overflow, and the `.tf-panel-body` bottom margin is the new shared
`--tf-workspace-baseline` (declared on `.app-main`; `.workspace-main` resolves
`--view-strip-h` through it). Both docked panels adopt it
(`.context-panel-body` / `.inspector-body`, plus the navigator's `.thumb-scroller-inner` /
`.outline-panel` and the `.ann-panel-list`), so every panel scroll region ends level with
the canvas footer top instead of the column bottom. ONE theme-aware `.tf-panel-scroll`
rule replaces the native arrowed scrollbars: a thin rounded thumb on a transparent track
that widens (hit-area grows) on hover / keyboard focus, suppresses
`::-webkit-scrollbar-button`, and hands the scrollbar back to the platform under
`@media (forced-colors: active)`; keyboard/wheel scrolling and the document-scroller are
untouched. Unit: `test/unit/renderer/tfl1116_panelShell.test.tsx` +
`test/unit/renderer/tfl1116_scrollbar.test.ts`; e2e `e2e/tfl1116_r11_panel_shell.spec.cjs`
(screenshot `screenshots/tfl1116_r11_panels.png`).

TFL-1159 (TFL-1116 C10, R13 + R14): the Action Dock's More-vs-Tools intent and
one `dockEligible` capability predicate. R13 — More is the stage overflow plus
"Customize dock"; the ambiguous trailing "Tools" utility that opened the global
Command Palette is RELABELLED "All commands" (it stays because the canvas-level
global entry is still needed; the `data-dock-tools` hook and its palette routing
are unchanged). "Customize dock" reaches the DEDICATED Add-a-tool chooser
(`[data-dock-picker]`), never the global palette. R14 — ONE
`dockEligible(entry)` predicate (`src/renderer/state/toolsRegistry.ts`) now backs
the chooser rows (`dockEligibleIdsForStage`), the pin affordance
(`dockPinAffordance`) and pin execution (`addDockPin` and the Command Palette's
pin paths), so a tool is addable/pinnable exactly when the dock can execute it;
a build-level unsupported command (`DOCK_UNSUPPORTED_AVAILABILITY`, e.g. Validate
document) is never offered or pinned, while a TEMPORARILY unavailable persisted
pin is RETAINED and EXPLAINED (disabled with its refusal `title`,
`data-dock-pin-ineligible`) rather than reset, and customization (EDIT) mode
gains an explicit Done action (`[data-dock-done]`). Unit:
`test/unit/renderer/tfl1116_dockEligible.test.ts`; e2e
`e2e/tfl1116_r13_r14_dock_intent.spec.cjs` (screenshots
`screenshots/tfl1116_r13_more.png` / `screenshots/tfl1116_r14_customize_dock.png`).

TFL-1161 (TFL-1116 C11, R16 + R17): compact stage context + explicit Inspector
state. R16 — below the panel ladder threshold the collapsed Context Panel
rendered its page-number ruler in every stage, so Edit/Review/Deliver lost their
meaning. The compact strip is now stage-aware: Pages keeps the ruler, while
Edit/Review/Deliver render a LAUNCHER (`[data-context-panel-launcher]`,
`data-context-panel-launcher-stage`) whose open intent surfaces the ACTIVE
stage's context as an overlay drawer (`resolveContextPanelSurface` in
`src/renderer/state/dockResponsive.ts`; `.context-panel.context-panel-drawer`),
closing on Escape / the close control — the panel-scoped mirror of the R01
compact Inspector drawer. R17 — the Inspector now resolves ONE explicit state
(`resolveInspectorState`: none / page / text / signature / crop / ocr-review /
export) and the CropBox section renders ONLY during an active crop session
(`cropActive`); the default EDIT page state shows page facts + selection
guidance instead of an empty "CROPBOX / Box". Unit:
`test/unit/renderer/tfl1116_compactStage.test.tsx` +
`test/unit/renderer/tfl1116_inspectorState.test.ts`; e2e
`e2e/tfl1116_r16_r17_stage_inspector.spec.cjs` (screenshots
`screenshots/tfl1116_r16_compact_stage.png` /
`screenshots/tfl1116_r17_edit_no_cropbox.png`).

TFL-1163 (TFL-1116 C12, R18 + R19): OCR suspects review polish + bounded
rendering. R18 — the Inspector suspects section now names the suspect COUNT
(`[data-ocr-suspect-count]`) and the page grouping, renders explicit Word /
Confidence columns (`[data-ocr-suspects-columns]`), keeps the navigated-to row
VISIBLY selected (`[data-ocr-suspect-selected]`), hands the engine's REAL page
and word bounds to the host and exposes them on the row
(`data-ocr-suspect-page` / `data-ocr-suspect-bounds`), and labels the surface
navigation-only (`[data-ocr-suspects-navigation-only]`) because the engine ships
no correct / accept / skip operation. R19 — above
`OCR_SUSPECT_WINDOW_THRESHOLD` (200) the panel renders a bounded window of the
flattened page/row stream (`[data-ocr-suspects-window]`, listbox semantics,
stable keys, Up/Down roving navigation) instead of mounting every row; the pure
model is `src/renderer/components/ocrSuspectsModel.ts`. Unit:
`test/unit/renderer/tfl1116_ocrSuspects.test.tsx` +
`test/unit/renderer/tfl1116_ocrPerf.test.ts` (measured: 3708 entries -> group
0.47 ms / flatten 0.82 ms, 19 mounted; 10000 -> group 0.28 ms / flatten
0.43 ms, 19 mounted); e2e `e2e/tfl1116_r18_r19_ocr_review.spec.cjs` (dense
scanned.pdf: 21819 suspects, 20 mounted, selected row visible; screenshot
`screenshots/tfl1116_r18_ocr_review.png`).

TFL-1169 (TFL-1116 C13, R20 + R23): review summary de-duplication + outline
badge legibility. R20 — the REVIEW surface no longer repeats the document-wide
summaries on both sides. The LEFT ContextPanel review navigator is the ONE
authoritative inventory (the four categories with their select / edit / delete
actions); the RIGHT Inspector's review section renders only the SELECTED
annotation's scope. `ReviewElementsPanel` now takes `scope: 'document' |
'selection'` (default `'document'`) and exposes `data-review-elements-scope`;
the Inspector passes `scope="selection"`, so the Bates / watermark / signature
categories and rows have exactly one home. This supersedes the Phase-90
Ruling-6 clause that the Inspector renders the full category list. R23 — the
outline target badge `.outline-page` moves from the faint `--fg-faint` /
`--fs-xs` tier to readable secondary text (`--fg-muted`, `--fs-sm`,
`font-weight: 500`) on the fixed right-aligned 32px target column; the title's
two-line wrap/ellipsis (`.outline-link`) and the tree keyboard model are
unchanged. Unit: `test/unit/renderer/tfl1116_reviewSummary.test.tsx` +
`test/unit/renderer/tfl1116_outlineBadge.test.tsx`; e2e
`e2e/tfl1116_r20_r23_review_outline.spec.cjs` (screenshots
`screenshots/tfl1116_r20_review.png` / `screenshots/tfl1116_r23_outline.png`).

TFL-1116 CONTROL-INDEX backfill (from the C15 report): four shipped
Visual-overhaul controls had no index entry. Recorded here with their proving
tests.

R01 — compact Inspector drawer (TFL-1117). Below the dock ladder's Inspector
threshold the panel cannot reserve a grid column, so activating "Expand
inspector" opens the Inspector as an overlay DRAWER over the canvas rather than
a docked column. The pure surface resolver is `resolveInspectorSurface`
(`src/renderer/state/dockResponsive.ts`); the drawer root exposes its own hook,
a close control and Escape dismissal, and returns focus to the Expand opener on
close. Unit: `test/unit/renderer/tfl1116_compactInspectorDrawer.test.tsx`; e2e
`e2e/tfl1117_r01_compact_inspector.spec.cjs` (960x640 drawer overlays the canvas
unbounded, closes with focus return; 1280x800 wide layout unchanged).

R02 — Deliver export draft retention (TFL-1119). The export configuration used
to live in local `useState` inside `ExportConfigSection`, so the compact-width
Inspector collapse/remount reset format / scope / range / DPI to the persisted
default. It is now a document-scoped store
(`src/renderer/state/exportDraft.ts`: `defaultExportDraft`, `exportDraftFor`,
`withExportFormat`, `withExportScope`, `withExportCustomRange`, `withExportDpi`)
that backs the controlled Inspector surface, so the draft survives an
unmount/remount and a stage return, and a resize never runs an export. Unit:
`test/unit/renderer/tfl1116_exportDraftRetention.test.tsx`; e2e
`e2e/tfl1119_r02_export_draft_retention.spec.cjs`.

R15 — Action Dock width from the canvas viewport (TFL-1157). The Dock sizes
against the CANVAS VIEWPORT width (`dockReserveFor` / `DOCK_DEFAULT_RESERVE`,
`src/renderer/state/dockFit.ts`; `DOCK_RESERVED_ROW_WIDTH` in `ActionDock.tsx`),
measured from the `.document-scroller` client width — not the fitted-paper width
and not the retired floating-pill reserve — so it keeps its labelled row until
the row genuinely cannot fit and only then scrolls. Unit:
`test/unit/renderer/tfl1116_dockWidth.test.ts`; e2e
`e2e/tfl1116_r15_dock_width.spec.cjs` (962x620: canvas ~788px vs fitted paper
~394px, no chevrons; 640x620 scroll case).

R22 — range validation messages (TFL-1116 C14). Entering `0,521` on a 520-page
document disabled the action but the helper claimed the EMPTY reason. The range
field now classifies empty / malformed / out-of-bounds / valid
(`classifyPageRange` / `parsePageRange`, `src/renderer/engine/types.ts`;
`validateExportRange`, `src/renderer/components/exportConfig.ts`), keeps the
typed value, links the message to the field via `aria-describedby`, and never
runs the operation on an invalid range. AR-07 (TFL-1182) sharpens the
out-of-bounds message: it names the offending token(s) and the real 1..N bound
(e.g. `Page 999 is outside the document's 1-34 pages.`), not only the bound; the
empty / malformed wording and the Extract/Split disabled gating are unchanged.
Unit:
`test/unit/renderer/tfl1116_rangeValidation.test.tsx` (empty / malformed /
out-of-bounds / valid messages; no dedicated e2e — proven by the unit suite).

R25 — Book View reading location (TFL-1116 C5b; DEF-627 TFL-1176). Book View
opens at the tab's stored `persisted.currentPage` and carries the reached page
(the visible spread's first page) back so the DocumentView resumes there. The
host passes the seed as `initialPage` and persists the report through
`persistFor(meta.id)` (`App.tsx`). DEF-627: the report previously ran only on the
header Close button, so leaving Book View by any OTHER route — a tab switch in
particular — lost the reached page. `BookView` now also publishes the location
through an additive `onLocationChange` prop, reported whenever the committed
spread changes and once more on unmount, so the persisted viewer always tracks
what the reader saw; the header Close button keeps reporting through `onClose`.
Tests: `test/unit/renderer/tfl1116_bookViewLocation.test.tsx` (seed / turn /
unmount-only report / tab-switch exit-and-return); e2e
`e2e/tfl1116_r24_r25_location.spec.cjs` (R25 close path + the DEF-627 tab-switch
exit case; screenshots `screenshots/tfl1116_r25_bookview_tab_switch_return.png`).

TFL-998 (TFL-855 chunk C8): the thumbnail right-click menu (`[data-context-menu]`,
`src/renderer/components/pageThumbMenu.tsx`) now renders through the same
`CommandMenu` primitive. The hook keeps only the six page verbs and the clamped
pointer anchor and passes them through CommandMenu's additive props: `position`
(fixed at the clamped pointer coordinates), `dismissOnScroll`, and the per-row
`variant` / `rowClassName` / `rowDataAttrs`. Every legacy hook survives — the root
keeps `data-context-menu` + `data-page` (via `popoverDataAttrs`), and each row
keeps `data-menu-item` plus `.context-menu-item` / `.context-menu-item-danger` — so
existing CSS/e2e selectors resolve on both the single-mode Pages panel and the
Multi Mode strips. CommandMenu owns Escape / outside-pointerdown / scroll dismiss
and the row keyboard model; the bespoke `.context-menu` chrome and its
`anim-menu-pop` animation are retired in favour of the shared `.command-menu`
shell and `TfMenu` motion. Tests: `test/unit/renderer/pageThumbMenu.test.tsx` +
`test/unit/renderer/commandMenu.test.tsx`.

TFL-1004 (TFL-855 chunk C9): the Action Dock's Add-a-tool picker
(`[data-dock-picker]`) and its stable More overflow menu
(`[data-dock-overflow-menu]`) now render through the shared `CommandMenu`
primitive, in `src/renderer/components/ActionDock.tsx`. The dock keeps only the
picker / More data and the clamp-and-place math: `pickerEntries` and `menuVerbs`
become `CommandMenuItem`s, and each surface is placed by the additive `position`
prop (opened upward with a 6px gap; the dock's `transform` makes the fixed
coordinates relative to the dock box). Every legacy hook survives — the picker
root keeps `data-dock-picker` and each row keeps `data-dock-picker-item`; the
More root keeps `data-dock-overflow-menu` and each verb row keeps
`data-dock-overflow-item` plus `.action-dock-menu-item`, while the Customize
toggle keeps `data-dock-menu-item="customize"` and now exposes `aria-checked`
(rendered as a `menuitemcheckbox`). The bespoke `onOverflowMenuKeyDown`, the
Escape / outside-pointerdown plumbing and the `anim-menu-pop` utility are
retired in favour of CommandMenu's keyboard model and `TfMenu` motion. Tests:
`test/unit/renderer/phase104_dockMoreFocus.test.tsx` +
`test/unit/renderer/phase58DockEdit.test.tsx` +
`test/unit/renderer/commandMenu.test.tsx`.

TFL-1012 (TFL-855 chunk C10): the Action Dock's portaled Pin/Unpin menu (the
right-click context menu on a dock verb) now renders through the shared
`CommandMenu` primitive, completing the dock's migration. It keeps the SAME
`createPortal(..., document.body)` because the dock's `transform` makes the
fixed surface's containing block the dock box rather than the viewport
(DEF-312); the `position` prop still receives the viewport-clamped pointer
coordinates, and the new additive `popoverRef` prop surfaces the rendered root
to the dock's own outside-dismiss. Every legacy hook survives — the root keeps
`data-dock-menu` (via `popoverDataAttrs`) and each row keeps
`data-dock-menu-item="pin"` / `"unpin"` plus `.action-dock-menu-item` (via
`rowDataAttrs` / `rowClassName`) — so existing CSS/e2e selectors resolve. The
pin/unpin semantics and the dock-full rule (`menuPinned || !canPinMore(pins)`,
reason "Dock is full") are unchanged, and the retired `anim-menu-pop` class is
replaced by `TfMenu` motion. Tests:
`test/unit/renderer/phase36ActionDock.test.tsx` +
`test/unit/renderer/def311_314_dockCuration.test.tsx` +
`test/unit/renderer/commandMenu.test.tsx`.

TFL-1016 (TFL-855 chunk C11): the Welcome home-tools picker
(`[data-home-picker]`, `src/renderer/components/Welcome.tsx`) now renders through
the shared `CommandMenu` primitive. It keeps the SAME
`createPortal(..., document.body)` because the 36px home row's transform makes
it the containing block for fixed descendants, collapsing an in-row popover to a
sliver (DEF-410); the `position` prop receives the same clamped `pickerPos`
measured from the plus's `getBoundingClientRect()`. Every legacy hook survives —
the root keeps `data-home-picker` (via `popoverDataAttrs`) plus the
`home-tools-picker` class (via `className`) and each row keeps
`data-home-picker-item` and `.action-dock-menu-item` (via `rowDataAttrs` /
`rowClassName`) — so existing CSS/e2e selectors resolve. The add behavior
(`onSetHomeTools(addHomeTool(tools, id))`), the full/noCandidates gating on the
plus and the escape/edit-mode ladder are unchanged, and the retired
`anim-menu-pop` class is replaced by `TfMenu` motion. Tests:
`test/unit/renderer/phase58HomeTools.test.tsx` +
`test/unit/renderer/bugSweepWelcome.test.tsx` +
`test/unit/renderer/commandMenu.test.tsx`.

## Theme toggle + semantic colors

| Control | Selector | Promised action | Unit test | E2e |
|---|---|---|---|---|
| Theme toggle | `.theme-toggle` | Flips `data-theme` between `light` / `dark` on `<html>`; persists via `trackAndSave` | `test/unit/renderer/theme.test.ts` + `test/unit/renderer/settingsPersistImmediate.test.ts` | `e2e/phase13_gate_final.spec.cjs` SC5 |
| Light theme tokens | `:root` (no attribute) / `:root[data-theme="light"]` | `--bg-base: #ffffff` (white), `--bg-toolbar: #fafafa`, `--bg-rail: #f4f4f5`, `--bg-canvas: #ECEFF4`, `--fg-strong: #0f172a` | `test/unit/renderer/designTokensContract.test.ts` | `e2e/phase13_gate_final.spec.cjs` SC5 (asserts computed body bg is white in light) |

### DEF-083 — light theme must read light

The previous implementation painted the `.app` and `body` backgrounds
with `--bg-base` but did not give `<html>` a background of its own.
When the React tree was empty or transitioning between themes, the
Electron BrowserWindow's native background (which defaults to a dark
fill on Windows when no `backgroundColor` is set and `frame: false` is
on) showed through, making the UI read as black even in light mode.

The fix adds `html { background: var(--bg-base); }` so the native
background never bleeds through. The `.app-main` collapse fix
(DEF-081) is also required for this to be visible — without it, the
collapsed `app-main` reveals the same native background.

| Fix surface | Selector | Promise | Test |
|---|---|---|---|
| `<html>` carries `var(--bg-base)` background | `html` | Computed `background-color` equals `rgb(255, 255, 255)` in light mode | `test/unit/renderer/designTokensContract.test.ts` (new test pinning the `html { background: var(--bg-base) }` rule) |
| `<body>` carries `var(--bg-base)` background | `body` | Computed `background-color` equals `rgb(255, 255, 255)` in light mode | Same test (already covered for `body`) |

## Update indicator (DEF-077, expanded for DEF-082)

| Control | Selector | Promised action | Unit test | E2e |
|---|---|---|---|---|
| Indicator base | `.update-indicator` | Common chip shape with 28px height, theme-aware radius, 150-250ms transitions | `test/unit/renderer/updateIndicatorCss.test.ts` | (OTA E2E under `e2e/ota_verification.spec.cjs`) |
| 'checking' | `.update-indicator-checking` | Icon-only muted chip with spinning icon | `test/unit/renderer/updateIndicator.test.tsx` | (OTA E2E) |
| 'available' | `.update-indicator-available` | Accent-bordered pill; click triggers download | Same | (OTA E2E) |
| 'downloading' | `.update-indicator-downloading` | Muted progress chip with percentage | Same | (OTA E2E) |
| 'downloaded' | `.update-indicator-downloaded` | Primary-accent button; click triggers install | Same | (OTA E2E) |
| **'error' (DEF-082 fix)** | `.update-indicator-error` | **Semantic error color** — soft red background + error-token foreground + error-token border in both themes. Hover swaps to solid error background. Previously used transparent bg + muted fg + neutral border, making it indistinguishable from a regular muted button. | `test/unit/renderer/updateIndicatorCss.test.ts` (asserts `.update-indicator-error` body uses `var(--error)` + `var(--error-soft)` — new assertions) | (OTA E2E, plus the visual check pinned by `gate-p13-theme-light.png` after this fix landed) |

## AppHeader controls

| Control | Selector | Promised action | Unit test | E2e |
|---|---|---|---|---|
| Brand mark | `.brand .brand-mark` | Non-interactive logotype ("Jovrel" wordmark beside the halo mark). Phase 105 (chunk C): the brand leads the 48px title row inside TitleBar. | (CSS contract test) | (visible at launch) |
| Document rail | `.document-rail .tab-list` | The 40px rail below the title row: renders every open tab; click activates, close removes; reorder / tear-out gestures unchanged. TFL-1141 (R07): the rail is not mounted at all when zero document tabs exist (Home reserves no blank strip). | `test/unit/renderer/phase105_titleRow.test.tsx` + `test/unit/renderer/appHeader.test.tsx` + `test/unit/renderer/tfl1116_homeChrome.test.ts` | (covered by every workspace e2e) |
| '+ new tab' button | `[data-new-tab]` | Appends an empty placeholder tab; hidden when `tabs.length === 0`; disabled with a reason in Multi Mode. | `test/unit/renderer/phase105_titleRow.test.tsx` + `test/unit/renderer/phase34_chunk2.test.tsx` | (e2e in phase7 spec) |
| Application menu trigger | `.app-menu-trigger` (`data-app-menu`) | Opens the non-File menu groups (Edit / View / Tools / Help) plus the relocated Multi Mode / Find rows; Escape / Tab / outside-click close and refocus the trigger (TFL-993 chunk C7, on the shared `CommandMenu`). | `test/unit/renderer/phase105_titleRow.test.tsx` + `test/unit/renderer/appHeaderAppMenu.test.tsx` | (qa: menu opens) |
| Update indicator slot | `.update-indicator` | See "Update indicator" rows above. | (same) | (same) |
| Open button | `button.btn-primary` (AppHeader context) | Calls `onOpenClick` which opens the OS file dialog and routes the picked file through `openPdfFromPath`. | (covered by App integration tests) | (covered by every workspace e2e) |

## Notes for the QA gate

- **DEF-081**: SC1 (frameless + window controls) and SC5 (both themes)
  in `phase13_gate_final.spec.cjs` pass against the production
  build. The SC3 520-page performance test fails with a selector
  mismatch (`.welcome-screen` instead of `.welcome`) — that is an
  existing test bug, not a regression from this fix. The Welcome
  screen is visibly rendered in the post-fix screenshots
  (`gate-p13-theme-light.png`, `gate-p13-theme-null.png`).
- **DEF-082**: The error indicator's red border + red text is visible
  in `gate-p13-theme-light.png` (the dark variant of the same
  screenshot). Both themes now use the error semantic token via
  `var(--error)` / `var(--error-soft)`, so the chip reads as an
  error state in either direction.
- **DEF-083**: `gate-p13-theme-null.png` shows the light theme after
  the toggle: white body, light toolbar, light sample cards, light
  welcome title (slate, not black-on-black).
- **DEF-084**: This file is the deliverable. The new
  `designTokensContract.test.ts` assertions pin the grid template
  (DEF-081), the html/body background rules (DEF-083), and the
  error-indicator semantic tokens (DEF-082). The e2e proof lives in
  `e2e/phase13_gate_final.spec.cjs` SC5 + the visual screenshots
  referenced above.

## Phase 13 polish round — icon-only toolbar, gear, pan mode, blue accent

Second Phase-13 dispatch (borderless window + professional color polish).
The window/IPC work above (frame: false, window:* channels) was already
in place; this round converts the chrome to icon-only, adds the missing
title-bar affordances, and repoints the single accent to `#2563eb`.

| Control | Selector | Promised action | Unit test | E2e |
|---|---|---|---|---|
| Settings (Preferences) | `.app-menu-trigger` -> Edit > Preferences (`data-menu-action="preferences"`) | Phase 105 (chunk C): the gear moved into the application menu; choosing Preferences opens the same `prefsOpen` sheet the Ctrl+, accelerator uses. | `test/unit/renderer/phase13Controls.test.tsx` (menu opens, row fires `menuContext.preferences`) | (qa: menu -> Preferences dialog visible) |
| Caption glyphs (min/max/restore/close) | `[data-window-minimize]` / `[data-window-maximize]` | Standard Windows glyphs: Minus / Square / Copy(restore) / X — IPC actions unchanged from the rows above | `test/unit/renderer/titleBar.test.tsx` ("standard caption glyphs" test) | (qa: maximize/restore flips glyph) |
| Toolbar icon-only conversion | `.toolbar .tool-btn` | Every action renders as a 28px icon-only button; `aria-label` + `title` carry the promise (Save a copy, Merge, Split, Sign, Flatten, Optimize, Audit, Edit, Delete) | `test/unit/renderer/phase13Controls.test.tsx` (no `.tool-btn-label` spans; every button named) + `test/unit/renderer/toolbarCssOverflow.test.ts` (label rules pruned) | (qa: no-op sweep by `data-*` attributes) |
| Rotate counter-clockwise | `[data-toolbar-rotate-ccw]` | `engine.applyOp({kind:'rotate', page, dir:'ccw'})` on the toolbar's current page | `test/unit/renderer/phase13Controls.test.tsx` (fires callback) | (qa: page rotates counter-clockwise) |
| Hand (pan) mode | `[data-hand-toggle]` (`data-hand-active`) | Arms grab-and-drag panning on `.document-scroller` (`data-hand`, grab cursor); annotation tools go inert; Escape or re-click exits; Edit/Sign/Stamp disarm on rise | `test/unit/renderer/phase13HandPan.test.tsx` + `test/unit/renderer/handPan.test.ts` (bail-out + scroll math) | (qa: drag pans, page press works, link click still fires) |
| More (ellipsis) | `[data-tools-toggle]` | Opens/closes the Tools palette (the overflow surface); stable attribute from DEF-094 kept | `test/unit/renderer/bugDEF094_toolsToggleAttribute.test.tsx` ("More tools") | (qa: palette opens) |
| Edit toolbar icon-only | `.edit-toolbar [data-edit-tool]` | Off / Edit text / Add box / Image as icon-only buttons | `test/unit/renderer/phase13Controls.test.tsx` | (qa: edit tools switch) |
| Accent re-point | `--accent` (`#2563eb`), `--tf-accent*`, all soft washes | Single blue accent across all three themes; Open button, active tools, selection rings, focus rings, glows all follow; default annotation ink follows the accent | `test/unit/renderer/designTokensContract.test.ts` (frosted glow pins 37/99/235), `test/unit/renderer/annotationModel.test.ts` (default color #2563eb) | (qa: theme sweep screenshots `phase13-0*.png`) |
| Current page card | `.thumb-current` | Phase 111 (TFL-1074 / DEF-612): NEUTRAL, distinct from the batch selection — carries only the violet 2px leading marker (`[data-thumb-current-marker]`) + the "Viewing" label (`[data-thumb-viewing]`). The full 1.5px accent ring + `--accent-selected` wash it once shared with `.thumb-selected` are retired | `test/unit/renderer/phase111_pages.test.tsx` (static CSS guard) | (qa: thumbnails) |

### QA gate notes for this round

- Screenshots: `screenshots/phase13-01-welcome-frosted.png` …
  `phase13-06-workspace-light.png` (frosted welcome + workspace, armed
  pan mode, Preferences via gear, dark workspace, light workspace).
  Computed evidence logged by the harness: `--accent` resolves to
  `#2563eb`; `.titlebar` `webkit-app-region: drag`; armed scroller
  reports `data-hand="true"` + `cursor: grab`.
- `e2e/flicker-verification.spec.cjs` targets the Edit toolbar button
  via `button:has-text("Edit")` — with the labels removed that selector
  needs updating to `[data-toolbar-edit-toggle]` (qa-owned file).
- Performance: the round adds one toolbar button, one header button,
  and two pointer listeners; no render-path changes, so the Phase-13
  budget is unaffected.
## Phase 14.1 — Liquid Glass CORRECTION (glass material system)

Corrects the Phase-14 blue transparency into the coherent neutral
Liquid Glass material: standardized chrome heights, grouped command
bar, one shared glass-sidebar material for both floating panels, and
the Phase 14.1 token ladder (spacing / radii / control sizes / material
hierarchy) in `src/renderer/styles.css`.

| Control | Selector | Promised action | Unit test | E2e |
|---|---|---|---|---|
| Open (command bar, accent) | `.commandbar-open` (`data-toolbar-open`) | Opens the OS file dialog via the host `onOpenClick`; MOVED from the title bar to the command bar's File group per the reference | `test/unit/renderer/commandBar.test.tsx` (renders, a11y name, fires `onOpenFile`, primary treatment) | (qa: click Open -> dialog -> document opens) |
| File group | `.glass-control-group[aria-label='File']` | Capsule holding the accent Open button (blue = primary action only) | `test/unit/renderer/commandBar.test.tsx` (group order + a11y) | (qa: capsule present) |
| Navigation group | `.glass-control-group[aria-label='Navigation']` | `[<] [1/34 input] [>]` in one capsule; Enter on the input commits `onJump` | `test/unit/renderer/commandBar.test.tsx` (structure + Enter commit) | (qa: jump + prev/next) |
| Save group | `.glass-control-group[aria-label='Save']` | Save + Save a copy (states unchanged from Phase 13) | `test/unit/renderer/commandBar.test.tsx` | (qa: save states) |
| Zoom group | `.glass-control-group[aria-label='Zoom']` | `[-] [372% chip] [+]` + fit-width / fit-page | `test/unit/renderer/commandBar.test.tsx` | (qa: zoom in/out/fit) |
| Tools group | `.glass-control-group[aria-label='Tools']` | Search / rotate ccw+cw / hand / edit / delete / optimize / audit / flatten in ONE capsule | `test/unit/renderer/commandBar.test.tsx` (a11y sweep) | (qa: no-op sweep by data-*) |
| Actions group | `.glass-control-group[aria-label='Document actions']` | Merge / Split / Sign / More (ellipsis, `data-tools-toggle` kept), pinned to the trailing edge | `test/unit/renderer/commandBar.test.tsx` | (qa: capsule pinned right, palette opens) |
| GlassChrome title bar | `.titlebar.glass-chrome-title` | Standardized 48px title row (Phase 105 chunk C; was 44px), drag region + no-drag children unchanged | `test/unit/renderer/glassChrome.test.tsx` (variant class + height var + data passthrough), `test/unit/renderer/phase14Glass.test.ts` (48px token) | `e2e/phase13_gate_final.spec.cjs` SC1 (drag/controls unchanged) |
| Document rail | `.document-rail` | Standardized 40px rail below the title row holding the tab strip (Phase 105 chunk C); chunk D adds responsive capacity — the New-tab and All-tabs controls are reserved first, a tab is never narrower than 136px, overflowed sessions stay open and are hidden from the rail. The rail/tab-area/tab-list chain is viewport-constrained at FIRST layout (DEF-579), so the capacity planner measures the available width rather than the strip's own expanded content. TFL-1141 (R07): mounted only when at least one document session exists — `isDocumentRailVisible(tabCount)` gates the App mount, so Home with zero tabs renders no `.document-rail` / `.tab-area` row. | `test/unit/renderer/phase105_titleRow.test.tsx`, `test/unit/renderer/phase105_documentRail.test.tsx` (capacity planner + hidden-overflow DOM), `test/unit/renderer/tfl1116_homeChrome.test.ts` (R07 truth table + App wiring) | `e2e/tfl1116_r06_r07_home_chrome.spec.cjs` (zero-doc Home has no rail; one-doc Home shows the colorful strip) |
| All-tabs switcher | `[data-all-tabs]` / `.all-tabs-popover` | Phase 105 (chunk D) disclosure control after `[data-new-tab]`; opens an anchored, opaque, collision-aware popover listing every session in canonical order with the full filename, the total count, a dirty dot + "Unsaved changes" description and duplicate-basename folder context; arrow roving, Enter/Space activate, Escape closes and refocuses the trigger. | `test/unit/renderer/phase105_documentRail.test.tsx` | (qa: overflowed session reachable + activated from the switcher) |
| GlassSidebar header (Pages) | `.side-rail .glass-sidebar-header` | "Pages" title left + view tabs right in ONE 44px shared row | `test/unit/renderer/glassSidebar.test.tsx` | (qa: rail header) |
| GlassSidebar header (Tools) | `.tools-palette .glass-sidebar-header` | "Tools" title + layout toggle + close; SAME header component as Pages (material parity) | `test/unit/renderer/glassSidebar.test.tsx` | (qa: palette header) |
| Selected thumbnail | `.thumb-selected` | Thin accent outline + `0 0 0 4px` accent halo (2px outline drawn via box-shadow so the rail's 1px-border slot math never shifts); canvas stays opaque. Phase 111 (TFL-1074 / DEF-612): `.thumb-current` no longer shares this treatment — it is NEUTRAL | `test/unit/renderer/phase14Glass.test.ts` ("thin accent outline + halo") | (qa: thumbnails) |
| Measured band offset | `--tf-band-h` (published by DocumentView on `.app-main` + `.workspace`) | The floating cards drop below the command band even when it WRAPS on narrow windows (fallback `--chrome-commandbar-h` 52px) | `test/unit/renderer/phase14Glass.test.ts` (band var in rail/palette rules) | (qa: 900px window - no overlap) |

### QA gate notes for this round (Phase 14.1)

- Screenshots: `screenshots/phase141-01-welcome-frosted.png`,
  `phase141-02-workspace-frosted.png`, `phase141-03-palette-open-frosted.png`,
  `phase141-04-workspace-light.png`, `phase141-04-workspace-dark.png`,
  `phase141-06-commandbar-closeup.png`, `phase141-07-narrow-frosted.png`,
  `phase141-08-palette-light.png`. DOM facts logged by the harness:
  titlebar 44px (white 0.75 film, blur 20px saturate 1.2), command bar
  52px full-width band, rail x=16 y=112, palette right=1424 (16px
  insets), both headers 44px, capsules File/Navigation/Save/Zoom/Tools/
  Document actions, Open = rgb(37,99,235), page canvas backdrop none +
  paper white, zero renderer errors.
- E2E CONTRACTS THAT MUST BE RE-TIMED (qa-owned, pinned to the OLD
  blue material): `e2e/frost_verify.spec.cjs` (films
  rgba(126,178,250,.54-.65) + blur(22px) + saturate(1.3) checks),
  `e2e/phase14_qa.spec.cjs` P14-A/P14-B (`blur(22px)` /
  `saturate(1.3|130%)` assertions; blur is now 20px / saturate 1.2),
  `e2e/retests/def189_190_final.spec.cjs` (`blur(22px)` check),
  `e2e/retests/qa_frost_glass_visual_1103.spec.cjs` (blue-film band).
  The neutral films are white rgba(255,255,255,.68-.75) + blur(20px)
  saturate(1.2); DEF-182's "glass reads blue" now comes from the
  wallpaper behind the window, not a painted film.
- E2E SELECTOR CHANGES (qa-owned): the Open button left the title bar
  `.header-actions .btn-primary` (now `[data-toolbar-open]` in the
  command bar) - `e2e/phase13_qa_sweep.spec.cjs` and
  `e2e/phase13_visual_verification.spec.cjs` reference the old
  selector for opening files and in the no-drag list. The welcome
  screen's "Open PDF" button is unchanged (canonical opener).
- Unit tests: 2140 renderer tests pass (incl. new
  `glassChrome.test.tsx` / `commandBar.test.tsx` /
  `glassSidebar.test.tsx`; contract updates in `phase14Glass.test.ts`,
  `def183_188_frostedGlassFix.test.ts` (glass composites recomputed
  for the neutral films), `designTokensContract.test.ts` (token
  indirection). `appHeader.test.tsx` / `phase13Controls.test.tsx` /
  `updateIndicator.test.tsx` drop the removed `onOpen` prop.
- Performance: no render-path change; the measure effect adds two
  custom-property writes per re-measure (resize-gated). The Phase-13
  budget is unaffected.

## Phase 112 - Context Pair panels (TFL-854)

Appended 2026-10-06 from the TFL-1003 phase-close QA verdict (item 11). Every
reworked Context Pair panel control, its promised action and the named test that
locks it. The TFL-1003 CONTROL-INDEX sweep verified all of these present with a
real handler and no no-op.

| Control | Selector | Promised action | Unit test | E2e |
|---|---|---|---|---|
| Pages/Outline modes | `[data-context-panel-view-tabs]` with `[data-context-panel-view-tab="pages\|outline"]` | Phase 111 (chunk A) re-baseline: selects the full-height Pages / Outline navigator VIEW through `onRailTabChange` (`ContextPanel.tsx`); the retired `[data-outline-toggle]` disclosure is gone | `test/unit/renderer/phase111_navigatorChrome.test.tsx` + `test/unit/renderer/phase112_pages.test.tsx` | (qa: navigator views) |
| Page selection / multi-select | `[data-context-panel-selection]` (summary, with `-count` / `-range` children) | Reflects one / multi page selection; the summary reports the selection count and range (`ContextPanel.tsx:570-582`) | `test/unit/renderer/phase112_pages.test.tsx` | `e2e/phase112_c2_pages_visual.spec.cjs` (multi-select) |
| Insert / Page tools | page-thumb menu verbs `onRotateCw` / `onRotateCcw` / `onExtract` / `onInsertBlank` / `onReplace` / `onDeletePage`; Combine/Merge header | Each invokes its existing engine op; Combine/Merge confirmed against the real handlers (`ContextPanel.tsx:466-492`, `976-979`) | `test/unit/renderer/phase112_pages.test.tsx` | `e2e/phase112_c2_pages_visual.spec.cjs` |
| Edit navigate + OCR / Add text | `onSelectEditContent` (`ContextPanel.tsx:692`), `[data-context-panel-action="recognize"]` / `[data-context-panel-action="suspects"]` (`ContextPanel.tsx:775`, `785`) | Selects enumerated edit content; recognize / suspects route to their handlers | `test/unit/renderer/phase112_edit.test.tsx` | (qa: edit nav + OCR) |
| Review annotation list + FDF | `[data-annotation-row]` (`annotations/AnnotationsPanel.tsx`) + list-level `[data-ann-io="export"\|"import"]` | Thread Stream flat annotation list; list-level FDF export/import reusing the existing dialogs (the duplicate Inspector FDF quick-actions were removed by TFL-1228 chunk G) | `test/unit/renderer/phase116_filterDraft.test.tsx` + `test/unit/renderer/phase116_fdfActions.test.tsx` | (qa: review list + FDF) |
| Deliver checks + Export config | `exportConfigGate` (`components/exportConfig.ts:157`; `Inspector.tsx:608`) + named Export button | Factual output checks and a clearly named Export using the parse-validated range | `test/unit/renderer/phase112_deliver.test.tsx` | (qa: deliver + export) |
| Recent row actions | `[data-recent-action="open"]` / `="pin"` / `="show"` / `="locate"` / `="remove"` (`components/home/HomeRecentRow.tsx:85`, `124`, `137`, `149`, `160`) | Each row action routes to its real handler; Remove never deletes the file | `test/unit/renderer/phase112_home.test.tsx` | `e2e/phase112_phaseclose_qa.spec.cjs` |
| Recent missing detection (proactive) | App effect -> `window.tflex.checkMissing` (`App.tsx:9587-9591`) -> main `recent:checkMissing` (`src/shared/ipc.ts:137`, bridge `src/preload/preload.ts:764`) | A vanished recent file shows Missing + Locate on first paint with no click | `test/unit/renderer/phase112_home.test.tsx` (proactive-detection case, `323-436`) + `test/unit/main/phase112Recents.test.ts` | `e2e/phase112_phaseclose_qa.spec.cjs` |
| Sample card Open | `.sample-card` (`components/home/HomeSampleCard.tsx:23`; rendered by `Welcome.tsx` only when `showSamples`) | Opens the sample through the existing safe exploration flow. TFL-1143 (R09): the Explore grid is a DEVELOPMENT fixture — it renders only when `showSamples` resolves true (`isDevelopmentBuild()`), so PRODUCTION Home carries no sample cards | `test/unit/renderer/phase112_home.test.tsx` + `test/unit/renderer/tfl1116_homeSamples.test.tsx` | `e2e/phase112_phaseclose_qa.spec.cjs` (dev launch keeps fixtures) |
| Panel resize / collapse | `PanelResizeHandle` (role=separator, pointer + keyboard; `components/panels/PanelResizeHandle.tsx`; mounted `App.tsx:11353`, `11362`) + `[data-rail-collapse]` (`ContextPanel.tsx:508`) | Resizes within 240-420 (left, default 280; Phase 111 chunk D1) / 260-380 (right) and persists width + collapse state | `test/unit/renderer/phase112_panelLayout.test.tsx` | `e2e/phase112_phaseclose_qa.spec.cjs` (P112CLOSE-3) |

## TFL-1116 C7b - Home recent grid + production sample gate (TFL-1143)

Appended 2026-10-07. R08 re-bases the Home recent row onto ONE six-track CSS
grid; R09 gates the bundled-sample fixtures to development builds only.

| Control | Selector | Promised action | Unit test | E2e |
|---|---|---|---|---|
| Recent row grid | `.recent-row` (`components/home/HomeRecentRow.tsx`) | ONE shared track definition `icon / minmax(0,1fr) filename / 84px type / 92px status / 80px date / 116px actions` (`--recent-row-grid`). The open button (`grid-column 1/3`) and the meta cluster (`grid-column 3/6`) ride `subgrid`; the status cell is ALWAYS rendered so a Missing badge never moves the date/actions; dates use tabular numerals; the actions track is fixed and reveals by opacity only. Compact (`<=720px`) drops type/status/date to a designed secondary line | `test/unit/renderer/tfl1116_recentGrid.test.tsx` | `e2e/tfl1116_r08_r09_home_recent.spec.cjs` (date/actions x identical with and without Missing) |
| Development sample gate | `Welcome` prop `showSamples` = `isDevelopmentBuild()` (`utils/devEnvironment.ts`); `[data-home-samples]` on `.welcome-body` | TFL-1148/TFL-1150: the gate prefers the RUNTIME preload signal `window.tflex.app.isPackaged` — `false` (unpackaged dev/e2e run) keeps the fixtures, `true` (packaged app) hides them — and falls back to Vite's bundle mode only when the bridge is absent (jsdom/unit tests, older builds). Packaged PRODUCTION Home renders no `[data-home-explore]` section and no sample invite copy; the body collapses to one full-width column. Dev builds and test runs (including the standard unpackaged e2e suite, whose bundle is production-built but whose app is not packaged) keep the fixtures | `test/unit/renderer/tfl1116_homeSamples.test.tsx` + `test/unit/renderer/devEnvironment.test.ts` | `e2e/tfl1116_r08_r09_home_recent.spec.cjs` (packaged Home has no Explore/sample section) |
| Sample open MRU gate | `recordSampleRecent(name, window.tflex)` (`utils/sampleRecents.ts`; `App.tsx`) | A bundled-sample open writes a Recent entry ONLY in a development build; production opens leave no MRU entry | `test/unit/renderer/tfl1116_homeSamples.test.tsx` | (unit) |
| RESOLVED (TFL-1144 C1+C2) | The build-time dev gate hid sample cards in the standard e2e app because it keyed on the renderer BUNDLE mode (`import.meta.env.PROD` in a production-built `dist/renderer`). TFL-1148 (C1) exposes `window.tflex.app.isPackaged` from main's `app.isPackaged`; TFL-1150 (C2) makes `isDevelopmentBuild()` prefer that runtime signal, so the unpackaged e2e app reports dev and `.sample-card` fixtures render again. | `test/unit/main/appPackagedSignal.test.ts` + `test/unit/renderer/devEnvironment.test.ts` | (unit) | - |

## Phase 111 (chunk A) - Navigator view chrome (TFL-1060) addendum

Appended 2026-10-07. The PAGES ContextPanel's collapsible Outline section is
replaced by a 40px Pages/Outline view selector (`role="tablist"`,
`[data-context-panel-view-tabs]`) and two full-height views
(`[data-context-panel-view="pages"|"outline"]`, one mounted at a time).

- Retired hooks: `[data-outline-toggle]`, `data-outline-open` and the
  `.context-panel-section-toggle` rule. The Outline view keeps
  `[data-context-panel-outline]` / `[data-context-panel-outline-body]`.
- Navigator-scoped tokens `--tf-nav-view-tabs-surface` / `--tf-nav-view-tab-ink`
  / `--tf-nav-view-tab-active-surface` / `--tf-nav-view-tab-active-ink` are
  declared in light, dark and frosted.
- Unit coverage: `test/unit/renderer/phase111_navigatorChrome.test.tsx`.
- FOLLOW-UP (qa-owned): the e2e specs that still click `[data-outline-toggle]`
  and read `data-outline-open` must be migrated deliberately -
  `phase16_control_index.spec.cjs`, `phase36_chunk2_pages_parity.spec.cjs`,
  `phase38_gate.spec.cjs`, `phase40_design.spec.cjs`, `phase45_gate.spec.cjs`,
  `phase59_outline_flush.spec.cjs`, `phase59_palette_rows.spec.cjs`,
  `phase85_outline_edit.spec.cjs`, `phase94_iconEvidence.spec.cjs`,
  `tfl50_outline_corner.spec.cjs`.

## Phase 111 (chunk B) - Page cards + More menus (TFL-1065) addendum

Appended 2026-10-07. The PAGES navigator's thumbnails are page CARDS: the
over-preview hover verbs (`[data-thumb-verbs]`, `[data-thumb-verb]`) are
retired and replaced by a footer below the preview - a real
`[data-thumb-checkbox]` + `.thumb-label` on the left and a 32px
`[data-thumb-more]` button (44px under coarse pointers) on the right. The
current page keeps a violet 2px leading marker (`[data-thumb-current-marker]`)
plus a visible "Viewing" label (`[data-thumb-viewing]`), distinct from the
selected set (checkbox checked + `.thumb-selected` tint).

| Control | Selector | Promised action | Unit test |
|---|---|---|---|
| Card checkbox | `[data-thumb-checkbox]` | Toggles the host batch set via `onPageSelectionChange`; never navigates | `test/unit/renderer/phase111_pages.test.tsx` |
| Card More | `[data-thumb-more]` | `CommandMenu` with Rotate CW / Extract this page / Delete this page (Delete separated + danger); each runs the matching handler | `test/unit/renderer/phase111_pages.test.tsx` |
| Selection summary + Clear | `[data-context-panel-selection]` (`-count` / `-range` / `-clear`) | Renders for any selection `>= 1`; Clear routes to `onPageSelectionChange([])` and never navigates | `test/unit/renderer/phase111_pages.test.tsx` |
| Panel More | `[data-context-panel-more]` | `CommandMenu` with Combine (`[data-context-panel-combine]`) in the Document group and Remove blank pages (`[data-blank-scan-open]`) in a separated destructive group | `test/unit/renderer/phase111_pages.test.tsx` |
| Two-column grid | `.thumb-scroller-inner--two-col` / `[data-thumb-columns]` | Two columns at navigator content width `>= 360px` (min 152px card), one below | `test/unit/renderer/phase111_pages.test.tsx` |

- Migrated assertions (same chunk): `phase36ContextPanel.test.tsx`,
  `phase112_pages.test.tsx`, `phase59PanelButtons.test.tsx`,
  `phase113_panelsInspectors.test.tsx`, `phase37Chunk5.test.tsx`,
  `phase36SurfaceDiscipline.test.tsx` (collectPanel/More),
  `phase43IconUniqueness.test.ts` (MoreHorizontal allow-listed; Trash2 /
  RotateCw / Scissors / merge de-shared), `bugDEF098_thumbnailJumpVisiblePage`
  (`.thumb-item` is a card container, still the navigate target).
- FOLLOW-UP (qa-owned): the e2e spec `e2e/def327_331_retest.spec.cjs` still
  clicks `[data-thumb-verb="rotate-cw"]`; migrate it to `[data-thumb-more]` +
  the More menu.

## Phase 111 (chunk C) - Outline rows + More menu (TFL-1066) addendum

Appended 2026-10-07. The editable OUTLINE (`OutlinePanel`) now matches the
navigator design: rows are 44px (52px when the title wraps to two lines) with a
13px two-line title (`--fs-md` -> `--type-row-size`), 16px indent per depth, a
16px disclosure chevron on child rows only, and a fixed 32px right-aligned
destination column. The horizontal `renderVerbs` strip is retired; every row
carries an always-visible 32px `[data-outline-more]` (44px coarse) that opens a
`CommandMenu` with Rename / Set destination... / Add bookmark / Indent /
Outdent / separated danger Delete bookmark, with the real restrictions
preserved. A single header `[data-outline-add]` (`.outline-head-add`) appends a
root bookmark; the editable empty state reads "No bookmarks".

| Control | Selector | Promised action | Unit test |
|---|---|---|---|
| Row More | `[data-outline-more]` | `CommandMenu` with Rename / Set destination... / Add bookmark / Indent / Outdent / Delete bookmark (Indent off on a first child, Outdent off at root, Delete separated danger) | `test/unit/renderer/phase111_outline.test.tsx` |
| Retarget select | `[data-outline-retarget]` | Revealed by `Set destination...` (in `[data-outline-retarget-popover]`); routes to `editRetarget` | `test/unit/renderer/phase111_outline.test.tsx` |
| Header Add | `[data-outline-add]` / `.outline-head-add` | Appends a root bookmark (`editAdd(model, null)`) | `test/unit/renderer/phase111_outline.test.tsx` |
| Destination column | `.outline-page` / `[data-outline-page]` | Fixed 32px, right-aligned tabular page number or a dash | `test/unit/renderer/phase111_outline.test.tsx` |

- Retired: `[data-outline-toolbar]`, `.outline-verbs`, `.outline-verb` and the
  selected-row inline verb strip.
- Migrated assertions (same chunk): `phase85OutlineEditor.test.tsx` (verbs via
  the row More menu), `phase36ContextPanel.test.tsx` (DEF-494 header Add),
  `phase43IconUniqueness.test.ts` (IndentIncrease / IndentDecrease de-listed).
- Divergence from `docs/phase-specs/phase-111.md` D: the brief keeps the inline
  rename input and defers a rename dialog, so "title editing via the shared
  popover/dialog primitive" is deferred.

## Phase 111 (chunk D1) - Split Navigator layout + persistence (TFL-1068) addendum

Appended 2026-10-07. The navigator can now stack Pages above Outline with a
resizable horizontal separator and two independent scroll regions, or fall back
to the full-height tabbed view. The split is persisted (`navigatorLayout` /
`navigatorSplitRatio`) through the existing settings channel and echoed
preserve-if-valid.

- The left panel width band widens to 240-420 px, default 280
  (`PANEL_LEFT_WIDTH` in `components/panels/PanelResizeHandle.tsx:34`; right
  stays 260-380). The panel More menu gained a first `Layout` group.
- Fallback: `resolveNavigatorLayout` keeps `'split'` only when the measured
  panel body is `>= 2 * 180 + 12` px, else the tabbed view is unchanged.
- Pure helpers exported (DOM-free): `resolveNavigatorLayout`,
  `clampSplitRatio`, `splitRatioAfterKey`, `NAVIGATOR_MIN_SECTION_PX`.
- New `settingsEcho.ts` comparators for `navigatorLayout` / `navigatorSplitRatio`
  close the stale-echo class chunk E flagged (same class as DEF-604).

| Control | Selector | Promised action | Unit test |
|---|---|---|---|
| Layout menu | `[data-context-panel-layout-split]` (first group of `[data-context-panel-more]`) | Toggles stacked/split via `onNavigatorLayoutChange`; label flips with the current layout | `test/unit/renderer/phase111_splitLayout.test.tsx` |
| Split divider | `[data-context-panel-split-divider]` (`role="separator"`, `aria-orientation="horizontal"`, keyboard ArrowUp/Down/Home/End) | Edits `navigatorSplitRatio` (0.1-0.9); pointer commits on gesture settle, not per frame | `test/unit/renderer/phase111_splitLayout.test.tsx` |
| Split sections | `[data-context-panel-view="pages"]` + `[data-context-panel-view="outline"]` | Both mounted at once with independent scroll regions; compact `Pages · N` / `Outline · N` titles | `test/unit/renderer/phase111_splitLayout.test.tsx` |

## Phase 111 (chunk D2a) - Per-document navigator restore (TFL-1069) addendum

Appended 2026-10-07. The active navigator view, the outline expansion set and
the list scroll anchors are now remembered per document, keyed by the stable
engine doc id (`activeEngineDocId`). Session-only: nothing is persisted to
settings.

- New module `src/renderer/state/navigatorState.ts` with two pure helpers
  (DOM-free): `restoreRailTab(map, docId)` (the stored view, else `'thumbs'`)
  and `recordRailTab(map, docId, tab)` (a new map; a null id returns the same
  map unchanged).
- `App.tsx` keeps `railTabByDoc` beside `layersByDoc`; `selectRailTab` writes
  both the live `railTab` and this document's remembered view, and the rail-view
  effect records the OUTGOING document's view then restores the INCOMING one on
  each `activeEngineDocId` change.
- `OutlinePanel` (`components/SideRail.tsx`) keys its collapse set by document
  (`collapsedByDocRef`) and carries the `.outline-panel` `scrollTop` across a
  model swap (re-seed or a committed rename/edit) via a layout-effect restore.
- No visual or behaviour change for the stacked default beyond the above.

| Behaviour | Where | Promised action | Unit test |
|---|---|---|---|
| Rail view per document | `railTabByDoc` (App) | Restores the stored Pages/Outline view on a document switch; `'thumbs'` for a document never seen | `test/unit/renderer/phase111_restore.test.tsx` |
| Outline expansion per document | `OutlinePanel` | A collapse under one document does not leak into another and is restored when returning | `test/unit/renderer/phase111_restore.test.tsx` |
| Scroll anchors | `OutlinePanel` / `ThumbnailRail` | The outline scroller keeps `scrollTop` across a re-seed / rename; the Pages rail is not force-scrolled by a page-list mutation | `test/unit/renderer/phase111_restore.test.tsx` |

## Phase 111 (focused QA fixes) - neutral current card + navigator contrast (TFL-1074) addendum

Appended 2026-10-07. Two qa defects from the chunk-G focused QA (TFL-1073) are
fixed in source + CSS + tokens (left uncommitted for git-agent).

- DEF-612 — the current page card is NEUTRAL. `.thumb-current` no longer paints
  the shared `--accent-selected` wash or the 1.5px `--accent` ring (and the
  frosted `--glass-selected-bg` halo override is removed); the `thumb-select`
  swell is retired. Current keeps only the violet 2px leading marker
  (`[data-thumb-current-marker]`) + the "Viewing" label (`[data-thumb-viewing]`).
  Selected cards keep the select-fill tint + checkbox. Guard specs migrated to
  pin the absence: `phase51RingUndoPanelRows.test.tsx`,
  `designTokensContract.test.ts` (frosted glow must be null; `thumb-select`
  removed from the reduced-motion travel set), `foundationGuards.test.ts`
  (`.thumb-current|box-shadow` allow-list entry removed as no longer a
  violation).
- DEF-613 — navigator-scoped contrast tokens added for light, dark AND frosted
  (`--tf-nav-surface`, `--tf-nav-body-ink`, `--tf-nav-helper-ink`,
  `--tf-nav-selected-surface`, `--tf-nav-selected-ink`) from
  `Visual overhaul/Design System/navigator.tokens.json`. `.context-panel`
  scope-remaps `--fg-muted` / `--select-fill` / `--select-glyph` to them; the
  frozen shared tokens are untouched. The contract
  `Specifications/contrast-check.json` is NOT relaxed.

| Tier | Light | Dark |
|---|---|---|
| body (foreground on surface) | 7.96 (floor 7.96) | 8.59 (floor 8.59) |
| helper (secondary on surface) | 4.97 (floor 4.97) | 5.62 (floor 5.62) |
| selected (accent on selectedSurface) | 4.73 (floor 4.73) | 6.59 (floor 6.59) |

- New spec `test/unit/renderer/phase111_contrast.test.ts` computes all six
  ratios from the CSS token values and asserts the bundle palette + thresholds.
- `docs/phase-specs/phase-111.md` regenerated (`scripts/split-requirements.py`):
  the F spec now reads `phase111_splitLayout.test.tsx`; no
  `phase111_navigatorLayout.test.tsx` reference remains.

## TFL-1146 D - AR-02 navigator drawer a11y + AR-01 marker + AR-05 sample identity (TFL-1184)

Appended 2026-10-08. Three adversarial re-audit residues closed (correctness
around the visual overhaul); no styles or layout changed.

- AR-02 - the compact Navigator drawer's trigger `[data-rail-collapse]`
  (`components/ContextPanel.tsx`) now passes `expanded={!collapsed}` (a real
  `aria-expanded`) and remounts a `collapseOpenerRef`; the Inspector's R01
  focus-restore effect (`Inspector.tsx:963-977`) is mirrored inside
  `ContextPanel`, so Escape / the close control returns focus to the trigger
  once the collapsed strip remounts.
- AR-01 residue - the collapsed Navigator ruler's current-page item
  (`RulerStrip`, `components/SideRail.tsx`) carries `data-thumb-current-marker`
  in addition to the thumb card (`.thumb-item`), so the navigation-agreement
  assertion resolves on the compact surface too. Selectors:
  `[data-ruler-page="N"][data-thumb-current-marker]` and
  `.rail-ruler-current[data-thumb-current-marker]`.
- AR-05 - new predicate `isSampleRecentPath(path)` (`utils/sampleRecents.ts`)
  is true for virtual `samples/<name>` paths. `App.tsx` excludes them from the
  `checkMissing` probe and `Welcome.tsx` forces a sample-sourced row's `missing`
  to false, so a stale sample Recent is never labelled Missing. No user Recent
  data is deleted or migrated.

| Control | Selector | Contract | Unit test |
|---|---|---|---|
| Navigator drawer trigger | `[data-rail-collapse]` | `aria-expanded` reflects the collapse state; a drawer close returns focus to the trigger | `test/unit/renderer/phase111_navigatorChrome.test.tsx` (AR-02) |
| Compact navigator current page | `[data-ruler-page][data-thumb-current-marker]` | The collapsed ruler marks the current page machine-discoverably | `test/unit/renderer/phase111_navigatorChrome.test.tsx` (AR-01) |
| Sample recent identity | `isSampleRecentPath` (`utils/sampleRecents.ts`) | A `samples/<name>` recent is never sent to `checkMissing` and never renders Missing | `test/unit/renderer/tfl1116_homeSamples.test.tsx` + `test/unit/renderer/bugDEF429_recentSampleReopen.test.tsx` |

e2e is qa-owned: `e2e/tfl1179_ar_navigation.spec.cjs` aligns its AR-01 selector
to `[data-thumb-current-marker]` on the ruler item and its AR-02 focus-return
check to `[data-rail-collapse]`.

## Feedback and Progress (TFL-1216) - Activity Shelf

Appended 2026-10-08. Chunk C2 adds the Activity Shelf surface primitives
(`src/renderer/components/ActivityShelf.tsx`) and their scoped styles
(`.activity-shelf` in `src/renderer/styles.css`). Chunk C3 adds the pure store
and producer adapters (`src/renderer/state/activityShelf.ts`). Chunk C4b wires
them into the app: `App.tsx` holds the store in a reducer, mounts the surface
once for the whole window through the fixed `.activity-shelf-host` (anchored
bottom-right, clear of the View Strip footer and Focus Dock), and drives it from
real producers. C4b wires the OCR producer (`runOcrForActiveTab` /
`cancelOcrForActiveTab` / `subscribeOcrProgress`); C5 wires the conversion
producer (`openConvertedFromPath` -> `convertStartAction` /
`convertProgressAction`, cancel via `convertShelfOpRef` -> `convert:cancel`) and
removes the standalone `<ConversionProgress>` widget, so the shelf is the single
running affordance for an import. `runConvertOpen` now settles as a discriminated
`{ kind: 'opened'; tabId: string } | { kind: 'cancelled' } | { kind: 'failed' }`.
Progress text is always "N of M unit" or an
indeterminate phase, never a percentage or ETA; a cancel REQUEST reads
"Cancelling..." and never "Cancelled" before the engine confirms it.

| Control | Selector | Contract | Unit test | e2e |
|---|---|---|---|---|
| Open summary | `[data-activity-shelf-open]` | Invokes `onOpen`; the summary renders `null` (no `[data-activity-shelf-summary]`) when there are no operations | `test/unit/renderer/activityShelf.test.tsx` | `e2e/tfl1216_activityShelf.spec.cjs` |
| Close panel | `[data-activity-shelf-close]` and Escape | Escape on the open panel invokes `onClose`; the click control does the same | `test/unit/renderer/activityShelf.test.tsx` | `e2e/tfl1216_activityShelf.spec.cjs` |
| Per-row Cancel | `[data-activity-cancel]` | Renders only for a `running`/`cancellation-requested` state with `canCancel` true; label reads "Cancelling..." after the request and never "Cancelled" before confirmation | `test/unit/renderer/activityShelf.test.tsx` | `e2e/tfl1216_activityShelf.spec.cjs` |
| Open result | `[data-activity-action="open-result"]` | Rendered only when `availableCompletionActions` offers it; invokes `onAction` | `test/unit/renderer/activityShelf.test.tsx` | `e2e/tfl1216_activityShelf.spec.cjs` |
| Show in folder | `[data-activity-action="show-in-folder"]` | Rendered only when `availableCompletionActions` offers it; invokes `onAction` | `test/unit/renderer/activityShelf.test.tsx` | `e2e/tfl1216_activityShelf.spec.cjs` |
| View details | `[data-activity-action="view-details"]` | Rendered only when `availableCompletionActions` offers it (completed, partial-success and failed); invokes `onAction` | `test/unit/renderer/activityShelf.test.tsx` | `e2e/tfl1216_activityShelf.spec.cjs` |
| Undo | `[data-activity-action="undo"]` | Rendered only when the operation carries a reversible transaction id | `test/unit/renderer/activityShelf.test.tsx` | `e2e/tfl1216_activityShelf.spec.cjs` |
| Dismiss notice | `[data-activity-shelf-dismiss]` | Invokes `onDismiss`; shown only when a terminal notice exists | `test/unit/renderer/activityShelf.test.tsx` | `e2e/tfl1216_activityShelf.spec.cjs` |

e2e is qa-owned: `e2e/tfl1216_activityShelf.spec.cjs` will exercise the summary
open, the panel Escape/close, the per-row cancel and the completion actions.

Chunk C7 mirrors the live app-updater lifecycle onto the same shelf (no new
control and no new selector): one stable update operation is mapped from the
existing `updateState` through `updateStateAction`
(`src/renderer/state/activityShelf.ts`) in `App.tsx`, with no second
`onStatusChanged` subscription. `available` / `downloading` render a running
indeterminate row ("Update available" / "Downloading update"); `downloaded`
completes it with no completion actions; `error` fails it; `checking` /
`up-to-date` / `unsupported` / a cleared state removes it. No percentage is
rendered on the shelf - the Top Bar badge stays the Download / Install / Check
action surface (TFL-856/857/903 seam). Covered by
`test/unit/renderer/activityShelfStore.test.ts`.

Chunk C8 (TFL-1313) reconciles the feedback palette and hardens accessibility,
adding no new control or selector. General feedback tokens
`--feedback-success` / `--feedback-danger` are declared in all three theme
scopes (`src/renderer/styles.css`, `#25754A` / `#B82E43` light and frosted,
`#85D3A6` / `#FF9AAD` dark, mirroring `--tf-icon-success` / `--tf-icon-danger`)
and the shelf roles now resolve `.activity-shelf { --activity-success:
var(--feedback-success); --activity-danger: var(--feedback-danger) }`; the
shared `--success` / `--error` roles are unchanged. `failed` reasons and
`partial-success` failed-item lists carry `role="alert"`; the summary stays
`role="status" aria-live="polite"` with its determinate counter out of the
accessibility tree so progress points are not announced; opening the panel
moves focus into the non-modal `role="dialog"`, Escape / close restores focus to
the summary trigger (`openButtonRef`), and a row-removing action does not strand
focus. Pinned by `test/unit/renderer/foundationMirrors.test.ts` and
`test/unit/renderer/activityShelf.test.tsx`. The DEF-651 stale Toasts anchor in
`docs/ACTIVITY-SHELF-INVENTORY.md` was corrected to `Toasts.tsx:35`.

TFL-1320 (accepted adversary fixes DEF-652 / DEF-653 / DEF-654) corrects the
shelf action / reducer / App wiring with no new control or selector. A completed
conversion's `open-result` now activates the converted document's still-open tab
(resolved by the operation's captured `document.docId`, never the active tab) and
`view-details` also reveals its document-attached `ConversionNotice`; a closed
tab is a truthful no-op, and `convert.completionActions` stays unchanged. A new
update lifecycle after a terminal row now removes the stale row and starts a
fresh `begin` (`runningUpdateAction` returns `begin` when the current op is
terminal), so the row can no longer stay stuck. The per-row OCR Cancel now fires
`engine.ocrCancel` for the operation's captured document instead of
`cancelOcrForActiveTab()`. Pinned by `test/unit/renderer/activityShelfStore.test.ts`.



