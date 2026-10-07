# Orchestrator implementation prompt

Audit and repair the completed Jovrel visual overhaul through Thumbnails/Outline using this review package. The installed build reviewed was 1.51.0, dated 7 October 2026. Read `../Specifications/findings.md`, `user-issue-disposition.md`, `window-size-and-layout.md`, the inspection log and the live evidence before changing code. Inspect the current repository implementation and applicable AGENTS.md instructions; UI observations do not establish source-level causes.

Implement the repairs, run meaningful regression checks, and produce a reviewable change. Preserve the existing document engine and successful bookmark/fit behavior. Do not start the entire pending redesign as a substitute for repairing completed work. Pending areas are Search/Command Palette, Feedback/Progress, Preferences/Themes, Forms/Validation, Comments/Review, Selection/Manipulation, Drag Drop/Import, Responsive/Accessibility, and Print/Output. Make only the shared primitives, capability guards and adaptive access needed now; record remaining enhancements explicitly.

## 1. Fix access and state first

Repair R01–R05 and R12 before cosmetic polish. Compact Expand inspector must open an actual drawer, including Deliver at 960×640. Preserve document-scoped export choices across resize and panel remounting: Word must remain Word, with the same range/name/options. Keep focused page, canvas scroll anchor, navigator viewed marker and inspector synchronized on committed navigation and tab reactivation. Page 520 must render page 520 and reveal its thumbnail; do not accidentally replace selected pages with the viewed page. Reproduce the captured inspector/input520 versus canvas150 restoration state, then verify it no longer occurs.

Centralize command capability evaluation using active surface, active document, stage, selection, read-only restrictions and backend support. Home has Open, Create PDF from images, Merge and application settings/help actions. Hide document Save/Save copy/Search document/Print/Crop/OCR commands from Home menu and toolbar. Guard keyboard routes as well; background documents must not leak capabilities into an active Home tab. Keep tabs visible when other documents are open, and eliminate the blank tab row when none exist.

Fix overlay layout at the shared primitive: portal positioning, viewport collision flip/shift, safe 8px gutter, available-height limit, vertical-only scroll, bounded shortcut column and wrapping labels. Do not conceal clipped content with overflow-x:hidden alone. Validate right-edge menus, nested submenus and dialogs at compact and maximized sizes.

## 2. Repair Home as a production surface

Give titlebar brand 16px left inset. Keep a logo-derived Orbit Desk hero, a calm headline and three meaningful entry actions. Remove Explore Jovrel cards and sample invitation copy from production. Avoid a replacement decorative panel merely to fill the removed column. Expand Continue working naturally within the content grid, with restrained width and generous outer margins.

Use one recent-row grid shared across all rows: 20px icon, flexible minmax filename, fixed type/status/date/action tracks. Empty optional values keep their tracks; dates use tabular numerals; filename truncates before controls. Keep Missing, Locate, Pin, Show in folder and Remove from recents intelligible. Reserve action slots to avoid hover shifts. At compact width move status/date to a designed secondary line and keep essential recovery/actions reachable. Preserve accurate MD/XLSX/etc. badges. Prevent development fixtures from producing broken production recents.

Increase the logo arcs' visible contrast and scale modestly. Use slow violet/amber color drift and small angular motion; no flashing or broad moving gradients under content. Keep text on a stable background. Use separate Home motion pause state. Effective background motion requires global animations enabled, OS reduced motion off, Home visible and Home pause off. The already visible Pause background motion / Resume background motion label should remain. Validate the scope in code; the audit did not prove the current global-setting behavior.

## 3. Make panels, dock and viewing controls consistent

Use one panel shell with fixed header, bounded scroll body and optional fixed footer. Navigator and inspector scroll bodies share the workspace baseline; canvas footer occupies its own row. Replace arrowed scrollbars with the same theme-aware thin rounded thumb, expanding hit area on hover/focus while retaining keyboard/wheel access and system fallback in forced colors.

Never fade enabled labels/icons through parent opacity. Dock/footer may reduce their background or shadow at rest; controls remain readable and keyboard focus remains conspicuous. Use canvas viewport width to size the dock independently of fitted PDF width. Keep core stage tools, then More. More contains stage overflow and Customize dock. Replace ambiguous Tools with an explicit All commands entry only if needed; do not route Add tool to the global command palette.

One command registry supplies dock eligibility. Apply it to picker rows, pin affordances and pin execution. Dedicated Add is already partially correct; repair other entry points without resetting user pins. Unsupported commands must not appear as addable tools. Temporarily unavailable saved pins need a clear contextual policy. Add Done to customize mode. Stage-specific compact context must open the current stage drawer, including Deliver, rather than always showing page numbers.

Use explicit inspector state precedence. Default Edit with no selection must not show empty CropBox. Crop session shows Crop bounds, units and applicable controls; OCR review shows suspects; selected text/image/annotation shows its properties. Preserve existing correct left review inventory/right selection distinction. Remove duplicated document-wide Bates/watermark/signature summaries; put each in one authoritative location.

OCR review uses a readable header with count and page grouping, stable word/confidence columns and visible selected row. A large list must have bounded rendering and be profiled before claiming a performance improvement. Bind word navigation/highlight to actual backend coordinates. Do not create fake accept/correct controls if the backend does not support them. Improve existing buttons and rows now; fuller review/filter/validation workflows can remain in their pending categories.

Pin the export primary action to a footer. Use at least 40px height, 13–14px semibold label and white currentColor icon on the violet primary surface, with accessible contrast. Keep filename/range/format state persistent. Document warnings explain actual fidelity limits concisely; they should not bury the CTA. No export is triggered by changing format or resizing.

## 4. Navigation and visual finishing

Keep colorful modern tabs with stable color identity per tab. Active uses saturated curated color with readable text and a clear selected shape/keyline; inactive uses a lighter related tint. Do not revert to random dull colors or neutralize every tab. Add overflow behavior without shrinking titles into unrecognizable strips.

Make outline page badges readable. Define focused page versus visible spread range: a four-page group7–10 must not misleadingly identify the entire group as7–8. Prefer a single Page jump field for the focused page and a separate Visible7–10 summary. State page-action targets explicitly. Enter Book View at the current reading location and carry the reading location back when leaving.

Repair page-range validation: empty, malformed and out-of-bounds errors differ. `0,521` on520 pages should explain allowed bounds. Preserve typed values and field association. Apply this narrowly to existing completed dialogs; the broader Forms/Validation redesign remains pending.

Use shared Quiet Precision tokens: white surface, neutral canvas, ink #232A38, body #485164, helper #667085, border #E1E4EB, violet #7050D6, soft selection #F0EBFC. Match existing supported dark theme through semantic tokens rather than literal per-component colors. Type scale: panel title16, body14, control13, helper12 DIP; do not use opacity to simulate disabled controls indiscriminately. Rounded button9px and floating surface12–14px, 4px spacing rhythm, restrained140ms feedback; reduced motion is immediate. Maintain uniform icon geometry and currentColor inheritance.

## 5. Native minimum and adaptive policy

Recommended native BrowserWindow minimum:960×640 DIP, preferred initial1280×800, clamped to work area. This policy is not sufficient without working drawers. Derive panel breakpoints from available canvas geometry. Expanded defaults280 DIP per panel, clamp240–420; preserve a meaningful canvas viewport. At compact width use stage/context and inspector drawers, one at a time, with accessible close/focus return. At wide width restore automatic collapses without overriding a user's explicit collapse intent.

## Acceptance gates

1. Home with zero documents: no blank tab row, save/search/print/doc-only menu items; brand inset correct; no sample section in production. Home with background documents: colorful tabs remain and commands still reflect Home.
2. Recent rows align with/without Missing badges and actions; filename truncation cannot shift other columns.
3. Every menu fits the viewport at960×640,1024×768,1280×800 and maximized; no menu has horizontal scroll. Keyboard opening/closing and submenu edges pass.
4. At960×640, Edit, Review and Deliver context/inspector content are reachable; drawers open, scroll and close; focus returns; export CTA remains reachable.
5. Word export choices survive shrink/restore, panel collapse, tab switch and stage return. A resize cannot trigger export.
6. In520-page fixture jump1→260→520; visible page, inspector, footer and navigator agree; selection stays independent. Switch tabs and return. Bookmark navigation and Book View preserve location.
7. One/two/four layouts display truthful page/range summaries and explicit page action targets.
8. Dock/footer enabled controls remain legible at rest, hover, focus and during resize. Dedicated Add and every pin entry exclude unsupported commands; customization has Done.
9. Panel headers/footers align; no nested horizontal panel/menu scroll; OCR3708-entry navigation and rendering are measured and usable.
10. Default Edit does not show empty CropBox; closing OCR review returns to a meaningful inspector. Review summaries are not duplicated. Export icon/label pass contrast and short-height testing.
11. Invalid page range0,521 explains1–520 bounds; Escape dismisses eligible dialogs and restores focus without accidental commit.
12. Repeat relevant gates at100/125/150/200% display scaling, large text, keyboard-only, existing light/dark themes, reduced motion and forced colors. These are future verification requirements, not tests claimed by this review.

Add focused regression tests for command context, responsive state persistence, overlay containment and navigation synchronization. Use real integration checks for the blocked drawer and state loss, rather than tests mirroring style implementation. Capture before/after evidence at wide and compact sizes. Report fixes by R-ID, any remaining pending-category work, and measured verification results. Do not mark an item fixed merely because the mockup or CSS looks correct.
