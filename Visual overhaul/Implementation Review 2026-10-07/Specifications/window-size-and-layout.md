# Window size, layout and state policy

## Recommendation

Enforce a native minimum of **960×640 DIP**, with a preferred first-run window near **1280×800 DIP**, clamped to the display work area. Set the Electron BrowserWindow minimum and verify renderer dimensions independently; outer frame/caption differences can shift captures by a few pixels. Do not treat physical screenshot pixels at high DPI as CSS pixels. If a display work area cannot fit the requested minimum, provide the compact mode and clamp safely rather than placing controls off-screen.

The current native floor was approximately 640×480 (captures 642×481). It permits a document view but not reliable access to all tools. Raising the minimum alone does not fix blocked inspector access at 962×620 or state resets. The proposed 960×640 policy must pass the tests below before release.

## Observed matrix

| Surface | Captured sizes | Result |
|---|---|---|
| Home | 2560×1440; 1317×864; 1114×864; 1114×715; 997×715; 642×715; 642×481 | Actions wrap and list stacks; blank tab space and document-only shell remain. Right application menu overflows even maximized. |
| Document | 2560×1440; 962×620; 962×481; 866×481; 642×481 | Compact panel rails appear. Fit page works. Inspector expansion fails at 962×620. Compact context loses stage actions. Dock is cramped. |
| Restore cycle | Word export at full width → restore/shrink → maximize | Export format reset to PNG. |
| Navigation | 520-page fixture; report bookmarks; 1/2/4-page modes; Book View | Page jump works after direct commit, but navigator reveal fails; tab/view restoration can disagree with page state; Book View begins at page 1. |

These are measured UI captures, not a full test of every workflow at every size.

## Layout model

Use the available canvas width after the siderail, gutters and panel allocation. Target a meaningful canvas viewport of at least 480 DIP where possible. Typical expanded allocation is siderail 72 + context 280 + inspector 280 + canvas 480 + gutters ≈1140–1160 DIP; actual thresholds should be derived from container geometry, not just the desktop width.

- Wide: both panels may be expanded, each 240–420 DIP; default 280. Canvas footer 48 high; dock 16 above it.
- Intermediate: keep one expanded panel based on workflow intent; the other opens as a 280–360 DIP drawer. Deliver should favor output controls rather than a page-number rail.
- Compact (including proposed minimum): use stage/context launcher and inspector launcher; allow one drawer at a time. Drawer overlays the canvas rather than refusing to open. It has a bounded body, visible close action and focus return. Page view remains usable underneath.
- Home: one responsive column at narrow width, a content grid at wide width; no artificial sample column. Recent rows retain shared column tracks until secondary metadata moves to a defined second line.
- Dock width is derived from canvas viewport, not PDF paper width or zoom. Preserve core actions, then overflow. Full labels where practical; icon-only state has tooltips and accessible names.

Panel shells use `display:grid; grid-template-rows:auto minmax(0,1fr) auto`, with `min-width:0; min-height:0` on nested flex/grid children. Scroll only the middle body. Header/footer stay inside shell boundaries. All menus/popovers are collision-aware; no horizontal scrollbar is acceptable in a menu.

## State retention contract

Persist transient workflow state by document ID outside responsive component instances: export draft, active tool, crop session, current page/scroll anchor, selected pages/objects, OCR filter/current item, and panel-open intent. Resize changes presentation, never document selection or export intent. Keep Home state separate from document state. Distinguish user-collapsed panels from automatically collapsed panels so expansion at wide sizes is predictable.

Test 960×640, 1024×768, 1280×800, 1440×900 and maximized, and boundary widths ±1px. Repeat at 100%, 125%, 150% and 200% display scale, large text, keyboard-only navigation and reduced motion. DPI/large-text tests are required future validation and were not completed during this installed-app audit.
