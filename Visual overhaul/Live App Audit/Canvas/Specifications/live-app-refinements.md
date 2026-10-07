# Live-app refinement — Canvas

Inspected 5 October 2026 using the installed `C:\Program Files\Jovrel\Jovrel.exe` via native UI automation. This addendum takes precedence over illustrative layouts and generic implementation choices in the earlier handoff for the behaviors below. Shared Quiet Precision tokens and the user's colorful-tab requirement remain in force.

The form renders interactive widgets over the PDF page. Multi Mode with one document presents pane A, an empty pane B with Open PDF, a resizable divider, pane-A thumbnails, per-pane navigation/zoom, and “Drag page 1 to another document (Ctrl to copy).” Entering it from Review presents Pages-oriented controls; returning restores the single-document Review view.

Extend Paper Stage to both panes, preserving independent viewport/selection state and a visible active pane. Reserve pane-thumbnail width and ensure widgets retain correct PDF transforms; UI resizing must not truncate widget contents incorrectly. Empty-pane artwork uses the same brand vocabulary with a real Open action. Preserve explicit move versus Ctrl-copy transfer semantics and undo behavior; new-tab creation restrictions remain visible. Divider needs a keyboard alternative and minimum pane widths. Page transfer, two-populated-pane behavior and undo were not tested, so they are required regression fixtures.
