# Orchestrator refinement prompt — Feedback and Progress

Read `Specifications/live-app-refinements.md` beside this category's original specification and implementation prompt. Apply this live-app addendum first wherever a schematic visual or generic instruction conflicts with actual behavior. Preserve the shared tokens, colorful document identities, accessible states and original acceptance criteria.

On launch the app automatically offered an update-available dialog and retained a top-bar update badge after dismissal. The available version was 1.50.0; installed version was not verified. Home correctly disables Find/Print when no document is active, and Save remained disabled with “Saved — no changes to save.”

Add update availability, download, ready-to-restart and failure states to the shared feedback inventory, using actual updater events. Keep update badge/action discoverable without taking tab title width unexpectedly; a compact icon+tooltip is suitable at narrow widths. Styling must preserve the updater's explicit download/install decisions. Success means the actual completed boundary, not a prototype timer. Do not infer cancel/retry support for OCR/export jobs; connect only real capabilities. No update, download, OCR, export, error recovery or cancellation job was executed.

First map these observed controls to their real renderer components, command IDs and engine/IPC handlers in source. Implement the visual migration without removing existing capabilities. Treat any proposed additional behavior as a separate capability-backed extension. Run the listed fixture checks, report what passed and what remains unverified, and provide screenshots of the actual revised app. Prototype interaction checks do not constitute engine/output tests.
