# Orchestrator refinement prompt — Panels

Read `Specifications/live-app-refinements.md` beside this category's original specification and implementation prompt. Apply this live-app addendum first wherever a schematic visual or generic instruction conflicts with actual behavior. Preserve the shared tokens, colorful document identities, accessible states and original acceptance criteria.

Review repeats whole document summaries on both sides. In Multi Mode the usual left panel is replaced by pane-owned thumbnails, while the shared right inspector remains. Find adds a strip above the document viewport.

Enforce contextual ownership across modes: navigator/list on the left in single mode, pane navigator in Multi Mode, selected-object properties on the right. Keep document summary collapsed but available when selection is empty. Reserve real viewport space for panels and Find rather than overlaying PDF fields. Compact pane headers need document name, A/B identity and active-target indication; a shared inspector must explicitly name the pane/document it edits. Existing 52 logical-px attached header and shared tokens remain the design contract.

First map these observed controls to their real renderer components, command IDs and engine/IPC handlers in source. Implement the visual migration without removing existing capabilities. Treat any proposed additional behavior as a separate capability-backed extension. Run the listed fixture checks, report what passed and what remains unverified, and provide screenshots of the actual revised app. Prototype interaction checks do not constitute engine/output tests.
