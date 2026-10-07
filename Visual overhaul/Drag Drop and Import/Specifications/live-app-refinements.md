# Live-app refinement — Drag Drop and Import

Inspected 5 October 2026 using the installed `C:\Program Files\Jovrel\Jovrel.exe` via native UI automation. This addendum takes precedence over illustrative layouts and generic implementation choices in the earlier handoff for the behaviors below. Shared Quiet Precision tokens and the user's colorful-tab requirement remain in force.

Opened Create PDF from images in an empty tab. The dialog offers Add images, Create from clipboard, ordered images, JPEG quality 10–100 (current 100) and disabled Create PDF when empty. Copy says JPEG/PNG, one image per page, result opens as a new tab, disk images keep original quality/DPI, and quality affects re-encoded inputs such as clipboard images. Closed with Cancel.

Replace the oversized blank body with a concise empty intake state that grows into an ordered preview queue. Keep picker and clipboard actions, actual supported types, order and disabled completion. Place recompression quality under image settings with concise, accurate help; do not imply it recompresses every disk input. Preserve new-tab creation semantics. Conversion defaults from Preferences are a separate policy; expose page size/margins here only if this pipeline supports them. Real drops, clipboard reading, picker selection, import/reorder and generated output were not exercised.
