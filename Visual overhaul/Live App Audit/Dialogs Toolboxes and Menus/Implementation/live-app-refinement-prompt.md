# Orchestrator refinement prompt — Dialogs Toolboxes and Menus

Read `Specifications/live-app-refinements.md` beside this category's original specification and implementation prompt. Apply this live-app addendum first wherever a schematic visual or generic instruction conflicts with actual behavior. Preserve the shared tokens, colorful document identities, accessible states and original acceptance criteria.

Preferences, image-to-PDF, command palette, update prompt and dedicated Print window were opened. Preferences has Close and per-setting application timing; image-to-PDF has Cancel/Create PDF; Print is a separate window. Dialogs do not all share the same commit lifecycle.

Share surface, typography, spacing, focus and control primitives while retaining each workflow's real lifecycle. Immediate preferences must not look like an uncommitted task form. Empty image creation should size to useful content and grow for previews. Print keeps its window and fixed action footer. Palette remains transient with pin shortcuts. Scope body scrolling so titles/help/footer never overlap. Do not force every overlay into one fixed-height modal or migrate dedicated windows without a deliberate product decision.

First map these observed controls to their real renderer components, command IDs and engine/IPC handlers in source. Implement the visual migration without removing existing capabilities. Treat any proposed additional behavior as a separate capability-backed extension. Run the listed fixture checks, report what passed and what remains unverified, and provide screenshots of the actual revised app. Prototype interaction checks do not constitute engine/output tests.
