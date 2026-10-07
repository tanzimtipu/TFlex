# Live-app refinement — Viewing Controls

Inspected 5 October 2026 using the installed `C:\Program Files\Jovrel\Jovrel.exe` via native UI automation. This addendum takes precedence over illustrative layouts and generic implementation choices in the earlier handoff for the behaviors below. Shared Quiet Precision tokens and the user's colorful-tab requirement remain in force.

Observed Book View, One/Two/Four-page layout controls, previous/current/next page, zoom out/in, fit width/page and Pan mode. Multi Mode provides pane-specific page navigation and zoom while the single-document layout controls are absent in the observed split state.

Preserve one authoritative controller per document/pane. Distinguish Two pages layout within one document from Multi Mode across documents. Footer controls must identify their target pane and reflect its real page/zoom/fit state. Never broadcast a pane's navigation to both documents without an existing explicit sync setting. The one-page sample correctly disables previous/next. Maintain footer/dock separation and reserve space for Find. Book View, zoom manipulation and multi-page layout switching were not exercised in this run.
