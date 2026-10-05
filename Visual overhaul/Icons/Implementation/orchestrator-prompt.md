# Implementation prompt — Jovrel icon overhaul

Implement the proposed **Quiet Precision** icon system in my in-development Windows PDF editor, Jovrel. The goal is a distinctive, ultra-modern, simple and elegant interface with a consistent icon language that future dock, panel and toolbar redesigns can share.

Reference package: `C:\Users\tanzi\OneDrive\Desktop\Visual overhaul\Icons` and `C:\Users\tanzi\OneDrive\Desktop\Visual overhaul\Design System`.

Read `Icons\Specifications\icon-design-spec.md`, inspect `Icons\Visuals\icon-system-board.png` and `Icons\Visuals\interactive-icon-preview.html`, and use `Design System\quiet-precision.tokens.json` as the proposed baseline. The SVGs under `Icons\Assets` are original concept assets. Refine them where small-size inspection exposes problems; the screenshot-derived set is incomplete.

First inspect the actual technology stack, repository instructions, existing icon components, theme tokens and command handlers. Stay within the current framework and rendering pipeline. Do not assume React, a webview, WPF, WinUI or any particular package. Use SVG directly where supported; otherwise convert the exact geometry to the platform's vector representation. Do not replace vector icons with raster screenshots.

Before changes, build a complete inventory across navigation, title bar, document tabs, all workspace docks, inspectors, menus, dialogs, command palette, empty states, notices and window chrome. Include icons not visible in the supplied screenshots. Record each semantic command ID, current source, contexts, size, label, shortcut, states and intended metaphor. Confirm ambiguous title-bar save controls, the command-symbol action, the dock's trailing pencil and sanitization behavior by inspecting handlers. Do not guess new command meanings or remove capabilities.

Adopt a shared registry keyed by semantic command IDs, plus the project's equivalent of a shared icon component. It must centralize a 24 × 24 view box, 1.65-unit rounded stroke, no fill, `currentColor`/theme-bound color, and small-size optical variants when needed. Support the existing size, theme, selected, disabled and accessibility conventions. Keep existing click handlers, command IDs, shortcuts, automation hooks and test selectors intact.

Recommended glyph sizes are 16 px for compact title-bar utilities, 20 px for dock commands and 22 px for workspace navigation. These are logical px, with distinct hit targets: at least 32 px for fine pointers where native chrome permits, 36 px for dock buttons and 44 px for coarse pointers. Use the token file's spacing, radii, icon-label gap and 140 ms state transition. Do not animate glyph position or geometry; respect reduced motion.

Make ordinary resting icons graphite in all workspaces. Use violet for active/selected tools, paired with a soft selected surface and visible selected semantics. Remove permanent purple/green/red coloring by workspace category. Reserve green for completed/success states and red for commands verified to be destructive. Keep red available on Delete pages even at rest. Preserve explicit labels on specialist and format-related commands. Provide tooltips and the application's real shortcuts for compact controls.

Use the shared semantic grammar: plus for insert/create, outgoing arrow for export/extract, incoming arrow for import, converging paths for merge, separated page/frame shapes for split, circular arrow for rotation, comment bubble for annotation/review, page-check for validation, shield for sanitization/security, padlock for encryption and scan frame with T for OCR. Distinguish Flatten from Layers and Crop from Fit-page. Treat format badges as secondary to labels.

Use original concept SVGs where their semantics fit. Extend the same geometry to missing icons. If existing library icons are retained, normalize their weight, view box, caps, joins and optical size to this family; do not mix visibly different families. Reuse the same glyph for the same semantic command in every context. Preserve the Jovrel brand mark; a brand redesign is outside this task.

Keep this implementation focused on icons and their state presentation. Preserve dock organization, panel structure, command availability and document behavior. Future component redesigns will use the shared design tokens. If existing theme definitions conflict, make a scoped icon-token mapping rather than replacing the app's entire theme.

Validate the smallest controls and busiest dock first, then migrate the full inventory. Check 16/20/22/24 px rendering, both themes, and 100/125/150/200% Windows display scaling. Verify optical centering, no clipping, clear arrowheads, distinct command silhouettes, hover/active/disabled/danger states, keyboard focus and accessible labels. Use at least 3:1 contrast for nontext control indicators and 4.5:1 for normal labels against their final backgrounds. Ensure disabled icons do not react as available controls.

Run the repository's relevant build/checks and meaningful existing tests. Verify unchanged command behavior, shortcuts, PDF processing and window controls. Capture representative before/after screens in Pages, Edit, Review, Deliver, the welcome screen and at least one menu/dialog containing icons not shown in the references.

Deliver the completed inventory and final command-to-icon mapping, the registry/component changes, theme token mappings, all added/modified vectors, screenshots, validation results and any exceptions requiring a design decision. Clearly distinguish implemented items from proposed or unresolved items. Do not claim a complete migration while icons outside the initial screenshots remain unaudited.
