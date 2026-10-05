# Jovrel dock — Quiet Precision / Focus Dock

Date: 5 October 2026. Status: proposed design, not user approval or a source-code audit.

## What the screenshots reveal

The dock already has a useful floating form and labels. Its main weakness is hierarchy. Pages and Edit have manageable rows; Review expands to an extremely wide ribbon with truncated labels, while Deliver exposes many different export formats as peers. Dock width and visual rhythm change substantially between workspaces. A tiny customization pencil competes with Edit's pencil metaphor, and the search hint floats separately above the dock.

The rows mix ordinary commands, persistent editing tools, destructive operations and advanced utilities. Colored icons add further visual weight. Page navigation and zoom controls occupy the same bottom area as the central dock, so responsive behavior needs explicit collision handling.

The screenshots are scaled. All numerical dimensions below are proposed logical-pixel specifications, not measurements of the current application.

## Recommendation: Focus Dock

Keep the dock floating, but make it a compact, stable instrument positioned within the document viewport. Use a single near-opaque surface with a precise one-pixel edge, restrained shadow, 14 px radius and neatly aligned icon/label tiles. Group by command purpose and move specialist operations into an anchored More surface. Give search a real Tools button rather than a detached permanent hint.

The dock's identity comes from a disciplined silhouette, generous but compact internal rhythm, and an unmistakable selected tool. Retain the icon system's graphite/violet colors and rounded strokes. Do not add magnification, neon borders, continuous animated effects, glass gradients or a different accent palette.

Keep More and Tools in a stable trailing utility group. Remove the standalone customization pencil after confirming its purpose; put Customize dock in More. The workspace label at the leading edge is an optional small context cue, not another workspace switcher. The existing application navigation remains authoritative.

## Alternate direction: Command Shelf

Attach a quiet command strip to the bottom edge of the document viewport. Use horizontal icon/label pairs, a top hairline and no floating shadow. It consumes a reserved layout row instead of overlaying document content, and gives predictable placement for users who prefer a traditional editor.

This differs structurally from Focus Dock; it is not just another color treatment. It is useful if window size or accessibility settings make a floating dock difficult. Recommend Focus Dock as the default. Offer an attached layout only if the existing preference architecture supports it cleanly; avoid building a second command implementation. Both must consume the same registry, state and theme tokens.

## Composition and geometry

| Property | Proposed value |
| --- | --- |
| Dock radius | 14 px, inherited from the icon proposal |
| Tool-button radius | 9 px |
| Desktop dock height | Approximately 68 px, including 8 px top/bottom padding |
| Fine-pointer tool tile | 58–72 px wide, at least 52 px tall; measure actual labels |
| Icon | 20 px, original 24-unit geometry and 1.65-unit stroke |
| Label | 12 px / weight 500; Segoe UI Variable with system fallback |
| Icon-to-label gap | 6 px |
| Internal spacing | 4 px unit; 8 px outer padding |
| Separators | 1 px neutral stroke, 24–28 px high; use only between real groups |
| Bottom viewport inset | 16 px baseline |
| Minimum edge clearance | 16 px from panels, viewport edges and other overlay controls |
| Light shadow | `0 8px 28px rgba(35,42,56,0.08)` |
| Dark shadow | `0 8px 28px rgba(0,0,0,0.21)` |

Treat height as content-derived under text scaling; 68 px is not a hard clip. Do not hard-code one viewport-wide Review dock. Stable size and spacing matter more than making all workspaces exactly the same width. Reserve about five primary tiles plus a trailing utility group at normal editor widths.

In the recommended design, labels sit under glyphs for reliable scanning. Use complete short labels such as Rotate, Extract, Text box and Encrypt. Full semantic labels appear in tooltips, accessible names and the More surface. Avoid ellipsizing primary labels; measure localization and user text-size settings.

## Proposed primary commands

These are editorial defaults inferred from visible commands, not measured usage rankings. Confirm actual handlers and command availability before implementation. Allow deliberate user customization instead of changing order automatically by usage.

| Workspace | Suggested primary row | More / all tools |
| --- | --- | --- |
| Pages | Rotate, Extract, Insert, Merge, Crop | Replace, Split, Delete; all existing and unseen page commands |
| Edit | Select, Text, Images, Text box, OCR | Batch OCR, OCR suspects; all existing edit commands |
| Review | Annotate, Sign, Stamp, Forms, Bates | Flatten, FDF import/export, form data, Validate, Sanitize, Engineering layers; all existing review commands |
| Deliver | Optimize, Images, Text, Word, Encrypt | Space audit, Spreadsheet, Presentation, Create PDF from images; all existing delivery commands |

The trailing action may form a second small purpose group (e.g. OCR for recognition or Encrypt for protection). Do not create separators around every command. Delete is always clearly labeled and red wherever exposed; moving it into More changes prominence, not availability. Retain the existing application's destructive-action behavior.

Short labels must map to the same existing commands: for example, Images in Edit means Edit images, while Images in Deliver means Export pages as images. The workspace context, tooltip, accessible name and overflow label disambiguate them. Consider retaining Export images if user testing finds the shorter label unclear. Optimize must be confirmed against Reduce file size and any existing optimization flow; do not silently conflate distinct handlers.

## Tools and overflow

Tools opens the existing Search all tools / command palette with its actual shortcut. The screenshots show Ctrl+K, so the mockup uses that hint. Confirm the binding in source. Keep a search icon and a visible Tools label; the shortcut belongs in the tooltip or overflow row, not in a permanently detached banner.

More opens above the dock where space permits, anchored to its button. The surface contains complete labels and recognizable icons. It can expose all workspace tools so commands displaced by responsive fitting remain discoverable. Group specialist commands as needed, but do not invent features or discard commands omitted from the screenshots.

Production popover rules: fit to available screen bounds, flip/reposition when necessary, and use a constrained native menu/list with accessible scrolling only if the available height requires it. Keyboard focus enters the surface, Escape dismisses it and returns focus to More, outside click dismisses it, and opening a command closes the surface. Never create an off-screen menu.

Customize dock supports pinning, unpinning and explicit ordering per workspace, plus restore defaults. Use the existing customization flow if one exists. Persist choices per user/workspace. Keep More and Tools available, and prevent configurations that make every primary action unreachable. Dragging needs keyboard-accessible alternatives.

The demonstration reflows the document preview when its menu expands so the conversation can show the complete surface without clipping. The actual app should keep document layout steady while an anchored popover opens. The offline demonstration also uses a simple full list rather than reproducing native menu focus mechanics.

## Responsive behavior and collision avoidance

Center within the **document viewport**, not the whole application window; left/right panels change its center. Compute the remaining width after excluding the page-navigation cluster on the left and zoom/pan cluster on the right, plus clearance. Recalculate when panels resize, DPI/text size changes or tool labels change.

As space decreases, first remove the optional workspace cue, then move lower-priority primary commands into More in a deterministic order. Keep the currently active editing tool visible if possible. If it must move into More, retain its accessible selected indication there and provide a compact active-tool label. Do not shrink glyphs or labels to fit.

At unusually narrow widths, offer one or two primary commands plus More and Tools. If these still cannot fit without colliding with navigation/zoom, place the dock on its own reserved row. Do not arbitrarily hide page or zoom controls. Avoid wrapping the app dock into an unpredictable second row during ordinary workspace switches.

Reserve bottom scroll padding/inset so the last page's lowest content can be brought fully above the dock. Maintain room for horizontal scrollbars and input/focus overlays. For an attached shelf, its row contributes directly to viewport layout. For the floating dock, reserve scroll-safe space independently of its visual overlay.

The conceptual preview collapses three tiles at a narrow breakpoint and leaves them in the full More list. Production code must fit actual measured widths rather than copying the preview's breakpoint.

## Interaction and accessibility

- Rest: neutral surface, graphite icon and readable label.
- Hover: subtle neutral fill; no translation, scale or magnification.
- Active persistent tool: violet icon/label on a soft violet tile. It stays visibly active after the pointer leaves.
- Momentary action: hover/pressed feedback only; it does not become selected after execution. OCR, export and dialogs are not automatically toggle tools.
- Keyboard focus: separate visible 2 px ring, offset 2 px; distinguish focus from selection.
- Disabled: readable unavailable appearance, correct disabled semantics and a concise reason where useful. If an active tool becomes unavailable, resolve its state explicitly rather than leaving an apparently usable tile.
- Loading: busy state for the relevant command without changing dock width; progress belongs in an appropriate existing status area.
- Danger: red Delete label and glyph in the overflow list. Confirm sanitization permanence before marking it destructive.
- Motion: 140 ms color/surface transitions using the shared easing; immediate changes with reduced motion.

Use the platform's accessible toolbar/menu conventions. In a web implementation, apply toolbar roles and arrow-key navigation only with a correctly implemented focus model; do not add ARIA roles that imply absent behavior. Give every icon-only control an accessible name. Preserve labels for all specialist commands and expose active tools with selected/pressed semantics. Maintain at least 44 px targets for coarse input, meaningful screen-reader announcements, and high-contrast mode support.

Do not auto-hide the dock by default. Optional distraction-free behavior must retain a reliable keyboard/mouse/touch reveal path and must not hide while focus, a menu, a drag or an active text operation depends on it.

## Verification and boundaries

Inspect the full dock registry across every workspace, not just the commands shown. Check saved custom layouts, localization, long labels, empty/no-document state, disabled states, active tools, loading, theme and window-size changes. Verify that More and Tools retain every command and original shortcut.

Check normal and narrow document viewports with both side panels open, both themes, high contrast, Windows 100/125/150/200% scaling, keyboard-only use and 44 px touch targets. Verify the last page's bottom edge remains reachable and the dock/menu never overlaps page navigation, zoom, scrollbars or editable content that cannot be scrolled clear.

Keep command IDs, document operations, undo/redo behavior, shortcut routing and authorization/confirmation behavior intact. This task redesigns the dock and its command presentation; it does not redesign title-bar chrome, inspectors, navigation or the document engine.

## Resource status

The inline concept uses the host's available outline icons to show layout. The saved offline preview embeds the previous proposal's original SVGs. Production must use the shared Quiet Precision registry and complete the icon audit. All tokens remain proposed until the user accepts a direction.
