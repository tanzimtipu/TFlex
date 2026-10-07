# Orchestrator refinement prompt — Viewing Controls

Read `Specifications/live-app-refinements.md` beside this category's original specification and implementation prompt. Apply this live-app addendum first wherever a schematic visual or generic instruction conflicts with actual behavior. Preserve the shared tokens, colorful document identities, accessible states and original acceptance criteria.

Observed Book View, One/Two/Four-page layout controls, previous/current/next page, zoom out/in, fit width/page and Pan mode. Multi Mode provides pane-specific page navigation and zoom while the single-document layout controls are absent in the observed split state.

Preserve one authoritative controller per document/pane. Distinguish Two pages layout within one document from Multi Mode across documents. Footer controls must identify their target pane and reflect its real page/zoom/fit state. Never broadcast a pane's navigation to both documents without an existing explicit sync setting. The one-page sample correctly disables previous/next. Maintain footer/dock separation and reserve space for Find. Book View, zoom manipulation and multi-page layout switching were not exercised in this run.

First map these observed controls to their real renderer components, command IDs and engine/IPC handlers in source. Implement the visual migration without removing existing capabilities. Treat any proposed additional behavior as a separate capability-backed extension. Run the listed fixture checks, report what passed and what remains unverified, and provide screenshots of the actual revised app. Prototype interaction checks do not constitute engine/output tests.
