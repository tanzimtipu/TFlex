# Orchestrator refinement prompt — Dock

Read `Specifications/live-app-refinements.md` beside this category's original specification and implementation prompt. Apply this live-app addendum first wherever a schematic visual or generic instruction conflicts with actual behavior. Preserve the shared tokens, colorful document identities, accessible states and original acceptance criteria.

Review dock has many real commands and horizontal scroll arrows at narrow width. Palette supports Ctrl+Enter pin-to-dock, while workspace-stage commands cannot be pinned. Multi Mode switches to a Pages-oriented dock and exposes page-transfer affordance elsewhere.

Preserve the pin registry, per-stage tool membership and disabled/capability states. Focus Dock's primary-plus-More arrangement must keep every command reachable and searchable; moving a tool into More must not unpin it. Preserve keyboard pin/unpin and do not offer pinning for forbidden command types. Long form exchange/validation commands should use concise labels with accessible full names. Verify toolbar arrow focus and overflow with real window widths; keep dock separate from pane navigation/zoom.

First map these observed controls to their real renderer components, command IDs and engine/IPC handlers in source. Implement the visual migration without removing existing capabilities. Treat any proposed additional behavior as a separate capability-backed extension. Run the listed fixture checks, report what passed and what remains unverified, and provide screenshots of the actual revised app. Prototype interaction checks do not constitute engine/output tests.
