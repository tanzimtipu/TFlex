# Ready-to-use implementation prompt — Jovrel dock

Redesign the command dock in my Windows PDF editor, Jovrel, using the recommended **Focus Dock** concept. It must complement the prior **Quiet Precision** icon proposal and give the app a distinctive, ultra-modern, simple and elegant appearance.

Read the reference files under `C:\Users\tanzi\OneDrive\Desktop\Visual overhaul\Dock`: `Specifications\dock-design-spec.md`, `Visuals\interactive-dock-preview.html` and `Visuals\dock-comparison-board.png`. Read the icon specification and SVG registry under `Icons`, plus the existing `Design System\quiet-precision.tokens.json` and new `Design System\dock.tokens.json`. Treat the preview as a visual reference rather than production source. Its illustrative workspace controls are not an extra switcher to add inside the real dock.

Inspect repository instructions, the framework, current dock component, full command registry, theme system, popover/menu primitives, customization state and viewport geometry. Work within the existing architecture. Inventory every workspace command and every dock configuration, including items absent from the screenshots. Confirm ambiguous handlers, especially Optimize/Reduce file size and the trailing pencil customization action. Preserve all commands, IDs, shortcuts, selectors and PDF behavior.

Build one reusable dock shell consuming workspace command metadata and shared icons. Use a compact near-opaque surface, 14 px outer radius, one-pixel neutral border, restrained theme-aware shadow, 8 px padding, approximately 68 px content-driven desktop height, 20 px icons, 12 px medium labels, 6 px icon-label gap and 9 px selected-tool radius. Maintain the established graphite/violet palette and original rounded SVG geometry. Use a few purposeful separators rather than boxing every button.

Keep approximately five primary commands visible at ordinary editor widths, followed by a stable More and Tools utility group. Start with these proposed defaults, but reconcile them against actual handlers and command availability:

- Pages: Rotate, Extract, Insert, Merge, Crop.
- Edit: Select, Text, Images, Text box, OCR.
- Review: Annotate, Sign, Stamp, Forms, Bates.
- Deliver: Optimize, Images, Text, Word, Encrypt.

Keep all other and unseen commands accessible in More and the existing command palette. Preserve full semantic labels, including format names, in overflow, tooltips and accessible names. Delete remains clearly labeled and red. Do not add green coloring to ordinary export commands. Distinguish persistent editing tools from one-shot actions: persistent tools use a soft violet selected tile; exports, OCR and dialogs get momentary pressed feedback rather than permanent selected styling.

Replace the detached Search all tools hint with a labeled Tools button that opens the existing command palette; confirm the current shortcut (the reference shows Ctrl+K). Put Customize dock in More after verifying the pencil's purpose. Reuse the existing customization flow if present; otherwise support explicit pin/unpin/reorder per workspace with accessible alternatives to dragging and restore defaults. Persist choices without automatically rearranging tools according to usage.

Center the dock within the document viewport rather than the application window. Compute available width after excluding side panels, page navigation, zoom/pan controls, scrollbars and safe clearances. Respond to actual measured labels and user text scaling. Remove the optional workspace cue first, then deterministically move lower-priority commands into More. Preserve a clear active-tool indication and keep More and Tools available. Do not shrink text/icons to fit. At very narrow widths, use a dedicated reserved row if necessary to prevent collisions.

Ensure bottom content can scroll clear of the floating dock by reserving appropriate scroll padding/inset. The last page's bottom edge must remain reachable. Use an anchored More popover that opens upward when space allows and otherwise repositions within screen bounds. Provide keyboard navigation, Escape/focus return, outside dismissal and correct accessible semantics. Use a constrained native menu/list when scrolling is needed; do not copy the preview's document reflow on menu open.

Use shared 140 ms color/surface transitions; honor reduced motion. Add a distinct keyboard focus ring, disabled reasons where helpful, relevant busy feedback, and high-contrast support. Maintain 44 px coarse-input targets. Avoid magnification, bounce, continuous animation, heavy glass blur and default auto-hide.

The alternative Command Shelf is provided for comparison. Implement Focus Dock first. Add an attached shelf preference only if existing architecture makes it appropriate; both must share the same commands and state rather than becoming separate implementations.

Validate every workspace, including custom layouts and commands unseen in the screenshots; light/dark/high-contrast themes; narrow and wide document viewports; panels open/closed/resized; text scaling/localization; Windows 100/125/150/200% DPI; keyboard navigation; selected/disabled/loading states; and command reachability through More and Tools. Verify no collisions with page navigation, zoom/pan, scrollbar or unrecoverably covered page content.

Run the repository's relevant build/checks and existing tests. Verify document operations, undo/redo and shortcuts remain unchanged. Capture representative before/after screenshots for all four workspaces, overflow, keyboard focus and a narrow viewport. Deliver the command inventory/mapping, implementation and token changes, screenshots, validation results and any remaining exceptions. Do not claim completion while commands are missing or responsive overlays still collide.
