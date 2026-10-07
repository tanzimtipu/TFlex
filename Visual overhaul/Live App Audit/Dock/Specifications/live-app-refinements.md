# Live-app refinement — Dock

Inspected 5 October 2026 using the installed `C:\Program Files\Jovrel\Jovrel.exe` via native UI automation. This addendum takes precedence over illustrative layouts and generic implementation choices in the earlier handoff for the behaviors below. Shared Quiet Precision tokens and the user's colorful-tab requirement remain in force.

Review dock has many real commands and horizontal scroll arrows at narrow width. Palette supports Ctrl+Enter pin-to-dock, while workspace-stage commands cannot be pinned. Multi Mode switches to a Pages-oriented dock and exposes page-transfer affordance elsewhere.

Preserve the pin registry, per-stage tool membership and disabled/capability states. Focus Dock's primary-plus-More arrangement must keep every command reachable and searchable; moving a tool into More must not unpin it. Preserve keyboard pin/unpin and do not offer pinning for forbidden command types. Long form exchange/validation commands should use concise labels with accessible full names. Verify toolbar arrow focus and overflow with real window widths; keep dock separate from pane navigation/zoom.
