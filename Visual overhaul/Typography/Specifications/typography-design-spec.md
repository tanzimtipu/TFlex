# Typography — Quiet Precision scale

Apply one application-wide type scale through semantic tokens. Use Segoe UI Variable where available, then Segoe UI and the platform/system sans-serif fallback. Reuse the application's actual bundled/native font configuration. No network font request is needed. This proposal improves hierarchy and consistency; it does not change product branding fonts or PDF content.

Role proposals in logical units:

| Role | Size / line height | Weight | Use |
|---|---|---|---|
| Home headline | 32 / 38 (28 / 34 constrained) | 500–600 if actual font supports it | One brief home introduction |
| Dialog/page title | 18 / 25 | 500–600 | Task titles and major headings |
| Panel heading | 15–16 / 22 | 500 | Workspace names |
| Body/editable fields | 14 / 22 | 400 | Explanations and forms |
| Document/tab row | 13 / 20 | 400–500 | Filenames and aligned metadata |
| Control/section label | 12 / 17 | 500 | Compact actions and group labels |
| Helper text | 12 / 18 | 400 | Reasons and field guidance |
| Compact rail/accelerator | 11 / 16 minimum | 400–500 | Only where space is genuinely constrained |

The preview uses regular and medium weights; production can map native supported semibold weights where useful. Don't simulate bold or aggressively track uppercase. Prefer sentence case headings and clear language. Use tighter tracking only for the large home title (about -0.5px), not controls/body text. Use tabular figures for page counts, zoom percentages, sizes and aligned changing values; ordinary prose and filenames stay proportional. Keep shortcuts distinct but quiet.

Strong text uses #232A38/#EEF1F7, ordinary text #485164/#B8C0D0 and supporting text #667085/#929BAC against their actual opaque surfaces. Helper text still needs readable contrast; don't lower opacity as the universal disabled/muted treatment. Respect Buttons and task-surface state tokens. Avoid using tiny uppercase text to compensate for weak hierarchy. Maintain whitespace and weight differences rather than inventing new font families for each category.

Apply tokens to top bar, tabs, siderail, dock, panels, home, menus, dialogs, viewing controls and notifications through shared components. Explicit compact exceptions: 11px rail labels and accelerators where existing designs require them; prefer enlargement under text scaling/localization. Filenames can truncate with complete accessible names and focus/hover details; field labels, validation and essential action verbs must wrap or expand. Don't reduce font size to fit translated labels. Inputs must support IME and platform text conventions.

Respect Windows text-size settings separately from DPI and browser/device scaling; use scalable logical units/rem/em or native framework equivalents. A comfortable base can increase body/controls while adjusting padding, minimum targets and available layout; do not add a new density setting unless supported or genuinely needed. Preserve selected/hover/focus geometries when text scale changes. Avoid fixed-height containers that clip ascenders, descenders, multiline labels or emoji. Test fallback fonts and languages using system shaping rather than hand-selected Latin-only glyphs.

Never apply this UI scale to rendered PDF content, embedded fonts, annotation appearance streams, export/print layout or actual document text editing font choices. The canvas mock's text is a schematic fixture. The app's font-family selector controls document content and remains independent from interface typography.

Implementation: audit scattered font declarations, map to semantic tokens, migrate shared primitives first, then feature-specific text. Preserve explicit PDF/document font contexts. Align previous proposed 12/14 labels/body with this scale and retain documented exceptions, rather than doing a global CSS/font replacement. Check 100–200% DPI, Windows text scaling, long translations, mixed scripts, helper contrast, keyboard focus and baseline alignment in all major surfaces. Use actual rendered app screenshots and check that PDF output remains unchanged.


Supporting text refinement: use #667085 in light mode instead of the earlier #70798A muted token for small body/helper text. This raises contrast on both white and #F5F6F8 surfaces. Apply this by semantic text role; do not indiscriminately recolor disabled icons or document content.
