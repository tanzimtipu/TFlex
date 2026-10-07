# Live-app refinement — Feedback and Progress

Inspected 5 October 2026 using the installed `C:\Program Files\Jovrel\Jovrel.exe` via native UI automation. This addendum takes precedence over illustrative layouts and generic implementation choices in the earlier handoff for the behaviors below. Shared Quiet Precision tokens and the user's colorful-tab requirement remain in force.

On launch the app automatically offered an update-available dialog and retained a top-bar update badge after dismissal. The available version was 1.50.0; installed version was not verified. Home correctly disables Find/Print when no document is active, and Save remained disabled with “Saved — no changes to save.”

Add update availability, download, ready-to-restart and failure states to the shared feedback inventory, using actual updater events. Keep update badge/action discoverable without taking tab title width unexpectedly; a compact icon+tooltip is suitable at narrow widths. Styling must preserve the updater's explicit download/install decisions. Success means the actual completed boundary, not a prototype timer. Do not infer cancel/retry support for OCR/export jobs; connect only real capabilities. No update, download, OCR, export, error recovery or cancellation job was executed.
