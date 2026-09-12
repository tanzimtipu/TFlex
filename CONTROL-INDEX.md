# TFlex Phase 13 — Control Index

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
| `.app` grid template | `.app` (grid container) | Two rows: TitleBar (auto) + app-main (1fr). The previous three-row layout (`auto auto 1fr`) left the third row empty because the AppHeader moved inside the TitleBar, collapsing `app-main` to 0px. | `test/unit/renderer/designTokensContract.test.ts` (grid contract pinned through manual CSS inspection) + new assertion in same file covering the 2-row grid | `e2e/phase13_gate_final.spec.cjs` SC1/SC5 (welcomescreen + workspace visible after gate) |
| `.app-main` fills viewport | `.app-main` | Has non-zero height and contains the Welcome screen or Workspace after boot. Playwright's `toBeVisible()` on `.welcome` / `.workspace` proves the workspace is rendered, not hidden. | (CSS-level; new designTokensContract test pins the grid template) | `e2e/phase13_gate_final.spec.cjs` SC1 (`.titlebar` and `.welcome` both visible after launch) |

## Menu popover

| Control | Selector | Promised action | Unit test | E2e |
|---|---|---|---|---|
| Menu button | `.titlebar-menu-button` (`data-menu-button`) | Toggles the popover open/closed; `aria-haspopup="menu"` and `aria-expanded` flip together | `test/unit/renderer/titleBar.test.tsx` (click toggles popover visibility) | `e2e/phase13_gate_final.spec.cjs` SC2 |
| Popover | `.titlebar-menu-popover` (`data-menu-popover`) | Renders every entry from `menuGroups` with `role="menu"` + group heading + accelerator chip; closes on outside click, Escape, or entry click | `test/unit/renderer/titleBar.test.tsx` (menu structure + Escape close) | `e2e/phase13_gate_final.spec.cjs` SC2 |
| Popover row | `.titlebar-menu-row` (`data-menu-action`) | Routes through `dispatchMenuAction(action, menuContext)` — the same dispatcher the native menu uses | `test/unit/renderer/titleBar.test.tsx` (click invokes dispatcher) | `e2e/phase13_gate_final.spec.cjs` SC2 (menu items trigger handlers) |

## Theme toggle + semantic colors

| Control | Selector | Promised action | Unit test | E2e |
|---|---|---|---|---|
| Theme toggle | `.theme-toggle` | Flips `data-theme` between `light` / `dark` on `<html>`; persists via `trackAndSave` | `test/unit/renderer/theme.test.ts` + `test/unit/renderer/settingsPersistImmediate.test.ts` | `e2e/phase13_gate_final.spec.cjs` SC5 |
| Light theme tokens | `:root` (no attribute) / `:root[data-theme="light"]` | `--bg-base: #ffffff` (white), `--bg-toolbar: #fafafa`, `--bg-rail: #f4f4f5`, `--bg-canvas: #f1f5f9`, `--fg-strong: #0f172a` | `test/unit/renderer/designTokensContract.test.ts` | `e2e/phase13_gate_final.spec.cjs` SC5 (asserts computed body bg is white in light) |

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
| Brand mark | `.brand .brand-mark` | Non-interactive logotype ("TF" in a 4x4 rounded square). | (CSS contract test) | (visible at launch) |
| Tab strip | `.tab-list` | Renders every open tab; click activates the clicked tab; close button removes the tab. | `test/unit/renderer/appHeader.test.tsx` + `test/unit/renderer/tabMouseDown.test.ts` | (covered by every workspace e2e) |
| '+ new tab' button | `[data-new-tab]` | Appends an empty placeholder tab; hidden when `tabs.length === 0`. | `test/unit/renderer/appHeader.test.tsx` | (e2e in phase7 spec) |
| Theme toggle slot | `.theme-toggle` | See "Theme toggle" row above. | (same) | (same) |
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
| Settings gear | `.header-gear` (`data-open-preferences`) | Opens the Preferences sheet (same `prefsOpen` state the Edit-menu row and Ctrl+, use) | `test/unit/renderer/phase13Controls.test.tsx` (renders, a11y name, click fires `onOpenPreferences`) | (qa: click gear -> Preferences dialog visible) |
| Caption glyphs (min/max/restore/close) | `[data-window-minimize]` / `[data-window-maximize]` | Standard Windows glyphs: Minus / Square / Copy(restore) / X — IPC actions unchanged from the rows above | `test/unit/renderer/titleBar.test.tsx` ("standard caption glyphs" test) | (qa: maximize/restore flips glyph) |
| Toolbar icon-only conversion | `.toolbar .tool-btn` | Every action renders as a 28px icon-only button; `aria-label` + `title` carry the promise (Save a copy, Merge, Split, Sign, Flatten, Optimize, Audit, Edit, Delete) | `test/unit/renderer/phase13Controls.test.tsx` (no `.tool-btn-label` spans; every button named) + `test/unit/renderer/toolbarCssOverflow.test.ts` (label rules pruned) | (qa: no-op sweep by `data-*` attributes) |
| Rotate counter-clockwise | `[data-toolbar-rotate-ccw]` | `engine.applyOp({kind:'rotate', page, dir:'ccw'})` on the toolbar's current page | `test/unit/renderer/phase13Controls.test.tsx` (fires callback) | (qa: page rotates counter-clockwise) |
| Hand (pan) mode | `[data-hand-toggle]` (`data-hand-active`) | Arms grab-and-drag panning on `.document-scroller` (`data-hand`, grab cursor); annotation tools go inert; Escape or re-click exits; Edit/Sign/Stamp disarm on rise | `test/unit/renderer/phase13HandPan.test.tsx` + `test/unit/renderer/handPan.test.ts` (bail-out + scroll math) | (qa: drag pans, page press works, link click still fires) |
| More (ellipsis) | `[data-tools-toggle]` | Opens/closes the Tools palette (the overflow surface); stable attribute from DEF-094 kept | `test/unit/renderer/bugDEF094_toolsToggleAttribute.test.tsx` ("More tools") | (qa: palette opens) |
| Edit toolbar icon-only | `.edit-toolbar [data-edit-tool]` | Off / Edit text / Add box / Image as icon-only buttons | `test/unit/renderer/phase13Controls.test.tsx` | (qa: edit tools switch) |
| Accent re-point | `--accent` (`#2563eb`), `--tf-accent*`, all soft washes | Single blue accent across all three themes; Open button, active tools, selection rings, focus rings, glows all follow; default annotation ink follows the accent | `test/unit/renderer/designTokensContract.test.ts` (frosted glow pins 37/99/235), `test/unit/renderer/annotationModel.test.ts` (default color #2563eb) | (qa: theme sweep screenshots `phase13-0*.png`) |
| Thumbnail selection ring | `.thumb-current` | Full 1.5px accent ring (the one-sided 2px leading-edge bar was removed per the design rules) | (visual; no test pinned the inset bar) | (qa: thumbnails) |

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
| GlassChrome title bar | `.titlebar.glass-chrome-title` | Standardized 44px caption strip (drag region + no-drag children unchanged) | `test/unit/renderer/glassChrome.test.tsx` (variant class + height var + data passthrough), `test/unit/renderer/phase14Glass.test.ts` (44px token) | `e2e/phase13_gate_final.spec.cjs` SC1 (drag/controls unchanged) |
| GlassSidebar header (Pages) | `.side-rail .glass-sidebar-header` | "Pages" title left + view tabs right in ONE 44px shared row | `test/unit/renderer/glassSidebar.test.tsx` | (qa: rail header) |
| GlassSidebar header (Tools) | `.tools-palette .glass-sidebar-header` | "Tools" title + layout toggle + close; SAME header component as Pages (material parity) | `test/unit/renderer/glassSidebar.test.tsx` | (qa: palette header) |
| Selected thumbnail | `.thumb-current` / `.thumb-selected` | Thin accent outline + `0 0 0 4px` accent halo (2px outline drawn via box-shadow so the rail's 1px-border slot math never shifts); canvas stays opaque | `test/unit/renderer/phase14Glass.test.ts` ("thin accent outline + halo") | (qa: thumbnails) |
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
