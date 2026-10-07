# Live-app refinement — Panels

Inspected 5 October 2026 using the installed `C:\Program Files\Jovrel\Jovrel.exe` via native UI automation. This addendum takes precedence over illustrative layouts and generic implementation choices in the earlier handoff for the behaviors below. Shared Quiet Precision tokens and the user's colorful-tab requirement remain in force.

Review repeats whole document summaries on both sides. In Multi Mode the usual left panel is replaced by pane-owned thumbnails, while the shared right inspector remains. Find adds a strip above the document viewport.

Enforce contextual ownership across modes: navigator/list on the left in single mode, pane navigator in Multi Mode, selected-object properties on the right. Keep document summary collapsed but available when selection is empty. Reserve real viewport space for panels and Find rather than overlaying PDF fields. Compact pane headers need document name, A/B identity and active-target indication; a shared inspector must explicitly name the pane/document it edits. Existing 52 logical-px attached header and shared tokens remain the design contract.
