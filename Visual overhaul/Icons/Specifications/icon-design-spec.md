# Jovrel — Quiet Precision icon direction

Status: proposed v0.1, 5 October 2026. This is an icon design proposal based on five supplied screenshots, not an audit of the application's source or full command inventory. The user has explicitly said more icons exist.

## Assessment of the screenshots

The current icons already have an outline foundation worth retaining. The larger problem is the visual language surrounding them: neutral, purple, green and red glyphs coexist across navigation and command docks, so color repeatedly competes with the document. Similar command icons also have intricate internal marks that become hard to distinguish at the displayed size.

These screenshots were scaled for chat. Apparent softness, stroke inconsistency and exact pixel sizes cannot be reliably diagnosed from them. Validate the original SVGs and the running application before concluding the icons are rasterized or misaligned.

Specific observations:

- Pages, Edit, Review and Deliver use different permanent colors. The selected surface is violet even when the icon is red or green, creating two competing signals on one control.
- Review's badge/check metaphor reads as approval or verification more readily than the full annotation workspace. A comment bubble with a check better represents review, if review is primarily annotations and comments as the visible interface suggests.
- Green appears on ordinary extraction, insertion, export and creation actions. This makes green a broad category treatment rather than a clear success signal.
- Several commands operate on documents but use small, similar paper silhouettes. Their labels remain essential, particularly export, import and specialist PDF operations.
- The crop and fit controls are inherently similar geometric glyphs; use a distinct outer-frame silhouette for fit-page and orthogonal overhanging corners for crop.
- The welcome screen's sample cards repeat a sparkle. A neutral page preview or document glyph communicates sample documents more clearly; reserve sparkles for an actual AI-assisted feature.
- A command symbol resembling macOS's Command key appears in the Windows title bar. Confirm its actual purpose. If it opens the command palette, use an appropriate palette/search glyph and the application's real Windows shortcut in the tooltip; do not infer or change the handler from appearance.
- The small pencil at the right of each dock appears to be a customization action. Confirm its handler. If it customizes tools, a sliders or customization glyph would distinguish it from document editing.
- Save-related toolbar controls appear similar. Identify their actual commands before choosing Save versus Save As versus Save All glyphs.

## Recommended visual direction

Use a precise rounded outline family with graphite resting icons, a single violet active state and stable silhouettes. The personality comes from a shared construction grammar and restrained state treatment. Each command should be recognizable at a glance and belong to the same visual family.

The supplied SVGs are original concept vectors, not a generated bitmap sheet. They are starting assets for evaluation. Treat them as a family to refine after the complete inventory, not final production artwork automatically approved by the user.

### Glyph construction

- Coordinate system: `viewBox="0 0 24 24"`; normal artwork sits within approximately 3–21 units. A few directional badges extend to 23 units and need size-specific optical review.
- Main stroke: 1.65 units. Candidate small-size variant: 1.8 units at a displayed 16 px. Verify both at actual display size; optical variants are separate deliberate decisions.
- Stroke caps and joins: round. Fill: none. Color: `currentColor`.
- Rounded rectangular shapes use restrained 1–2 unit radii. Avoid excessively rounded page silhouettes, which reduce their recognizability.
- Document-based actions share a folded upper-right corner. Arrows have a consistent three-unit head; plus marks use the same stroke as the parent glyph.
- Use one primary silhouette and at most one secondary action mark. Avoid stacking a file glyph, format letter, arrow and decorative badge together.
- Judge optical weight and center, rather than mathematical bounding boxes alone. A pencil, crop corners and page outline require different optical balancing.
- Keep directional glyphs static. Do not rotate, bounce or morph them on hover.

### Size and layout

| Context | Proposed glyph size | Minimum fine-pointer target |
| --- | --- | --- |
| Dense title-bar utility | 16 px | 32 × 32 px, where compatible with existing native chrome |
| Toolbar/dock command | 20 px | 36 × 36 px |
| Workspace navigation | 22 px | 40 × 40 px, excluding label space |
| Touch/coarse pointer | Same visible glyph | 44 × 44 px |

These are logical pixels, not values measured from the screenshots. Keep glyph size independent from the button hit area. Use 6 px between icons and labels, a 4 px spacing unit, a 9 px control radius and a 14 px dock radius as the proposed shared baseline. Native window controls follow platform constraints.

### States and color

| State | Light treatment | Dark treatment | Behavior |
| --- | --- | --- | --- |
| Rest | `#485164` | `#B8C0D0` | Neutral icon, clear silhouette |
| Hover | `#232A38` over subtle neutral fill | `#EEF1F7` over subtle neutral fill | No icon movement or size change |
| Active/selected | `#7050D6` on `#F0EBFC` | `#B9A4FF` on `#302740` | Pair with pressed/selected semantics and visible shape cue |
| Disabled | `#70798A` | `#929BAC` | Unavailable state; no hover reaction; do not imply loading |
| Destructive action | `#B82E43` | `#FF9AAD` | Use on genuinely destructive commands such as Delete pages |
| Completed/success | `#25754A` | `#85D3A6` | Reserve for an actual successful outcome |

Avoid applying green to every export command or red to the entire Review workspace. Sanitize can remove information, but its permanence must be verified before assigning a destructive treatment. Color must never be the only signal: labels, glyph shape, selection surface/rail and accessible states support it.

For transient feedback, transition color/background for 140 ms using `cubic-bezier(0.2, 0, 0, 1)`. Reduced-motion mode uses immediate changes. Keyboard focus gets a separate 2 px ring with a 2 px offset; it must remain distinguishable from selection.

### Two compatible selection treatments

Recommended: a soft violet selected button surface with a violet glyph. It gives small tools a clear active target without filling the icon itself.

Alternative: keep all glyphs graphite and show a slim violet rail beside selected workspace navigation. This is quieter and works well if future dock/panel redesigns already have a strong selection cue. Apply the chosen treatment consistently by control role; do not randomly mix alternatives within one group.

## Semantic rules for the whole library

- `plus`: create/insert; never use it for extraction or export.
- Outgoing arrow: export/extract. Incoming arrow: import. Direction describes data flow, not navigation history.
- Converging paths: merge. Separated page/frame shapes: split.
- Circular arrow: rotation. A back-turning arrow: undo.
- Check on page: validate document. Comment bubble: annotate/review. Shield: security/sanitization, with the actual action confirmed in text.
- Padlock: document encryption/protection. Never use the brand mark or an unexplained sparkle for encryption.
- Crop: overlapping extended corner arms. Fit-page: outside corner frame around a small whole page. Fit-width: horizontal arrows bounded by side guides.
- Text recognition: corner scan frame with a simple T. Batch OCR adds a second sheet; suspects use a warning triangle. Preserve explanatory text.
- Form commands: structured field shapes. Layers: stacked planes. Flatten: a down arrow and compressed stack, so it differs from Layers.
- Word, spreadsheet and presentation exports retain explicit labels. A tiny letter or grid is supplemental; do not imply a vendor logo or native-format guarantee.
- Reuse a glyph for the same command wherever it appears. A general Deliver workspace and Extract pages may share an outgoing-document metaphor but have distinct labels and context; if they coexist in one unlabeled cluster, create distinct silhouettes.
- Use labels for uncommon commands such as Bates numbering, FDF import/export, form data and engineering layers. Tooltips supplement labels; they do not replace essential discoverability.

## Unseen icons and migration

Before replacing anything, inventory icons in the app: navigation, title bar, tabs, docks, menus, inspectors, dialogs, empty states, notices, command palette, form controls and window chrome. Record semantic command ID, existing component/source, aliases, contexts, size, state and label. Record missing artwork instead of assuming screenshot coverage.

Group by meaning before naming files. Identify duplicated commands and visually identical glyphs with different meanings. Confirm ambiguous controls with handler/source inspection. The included asset manifest is an asset list, not the application inventory.

Prototype the most crowded dock and the smallest title-bar controls first. Refine noisy assets at 16 px and 20 px before replacing the library. Once validated, migrate through one shared icon component/registry so future icons inherit the same defaults.

## Validation

1. Inspect all vectors at 16, 20, 22 and 24 logical px in light and dark themes, at 100%, 125%, 150% and 200% Windows scaling.
2. Check that distinct actions remain distinguishable, especially save variants, extract/insert, import/export, crop/fit, flatten/layers and OCR variants.
3. Verify that icons carry accessible names through their parent controls and decorative SVGs are hidden from accessibility trees.
4. Check focus, hover, selected, disabled and destructive states, including keyboard navigation and touch targets.
5. Keep nontext control indicators at least 3:1 against adjacent backgrounds and normal labels at least 4.5:1 as implementation acceptance targets. Measure final tokens in the running app.
6. Verify no command handler, shortcut, PDF processing behavior, tab state or window control behavior changed.

## Scope

This proposal establishes icons and shared tokens. It does not redesign dock layout, panel architecture or navigation structure. Later categories should inherit these tokens and can evolve the design system explicitly rather than introducing unrelated palettes or geometry.
