# Resource validation

Completed 5 October 2026:

- Read back the literal inline fragment; checked output size and token JSON.
- Rendered Quiet Actions and Command Groups in light/dark themes; visually inspected the recommended light composition and grouped dark states.
- Verified exclusive tool and page-view selection.
- Verified simulated export busy state, stable button width, duplicate-activation guard and return to the action label with an explicit no-file-created message.
- Verified menu opening, Escape dismissal and screen-bound positioning at 736, 520, 360 and 320 px widths.
- Checked both compositions for horizontal document overflow at those widths; none found.
- No browser JavaScript errors were detected.
- Computed primary text contrast for resting/hover/pressed light and dark token pairs: all exceed 4.5:1. Exact values are in `primary-contrast-check.json`.

Production integration, all remaining state/color pairings, native focus/menu semantics, caption controls, high contrast, Windows DPI/localization and actual command execution still require application-level validation. The example uses native browser focus plus an illustrative focus-ring sample and does not implement a full production menu keyboard model.
