# Live-app refinement — Dialogs Toolboxes and Menus

Inspected 5 October 2026 using the installed `C:\Program Files\Jovrel\Jovrel.exe` via native UI automation. This addendum takes precedence over illustrative layouts and generic implementation choices in the earlier handoff for the behaviors below. Shared Quiet Precision tokens and the user's colorful-tab requirement remain in force.

Preferences, image-to-PDF, command palette, update prompt and dedicated Print window were opened. Preferences has Close and per-setting application timing; image-to-PDF has Cancel/Create PDF; Print is a separate window. Dialogs do not all share the same commit lifecycle.

Share surface, typography, spacing, focus and control primitives while retaining each workflow's real lifecycle. Immediate preferences must not look like an uncommitted task form. Empty image creation should size to useful content and grow for previews. Print keeps its window and fixed action footer. Palette remains transient with pin shortcuts. Scope body scrolling so titles/help/footer never overlap. Do not force every overlay into one fixed-height modal or migrate dedicated windows without a deliberate product decision.
