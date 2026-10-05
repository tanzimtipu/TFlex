# Jovrel buttons — Quiet Precision / Quiet Actions

Proposed 5 October 2026. Based on the supplied screenshots and the preceding icon, dock and panel concepts. This is a design proposal, not a source-code or complete control inventory audit.

Resources: `C:\Users\tanzi\OneDrive\App Development\TFlex\Visual overhaul`.

## Diagnosis

The screenshots mix outlined white buttons, violet filled actions, permanently green actions, nearly invisible disabled controls, selected icon chips and small unlabeled utilities. There is a useful restrained foundation, but action importance and persistent state are not consistently expressed. Long toolbar commands truncate while small panel actions can be visually crowded.

The goal is one button system across Home, title-bar commands, panels, dock tools, page/view utilities and dialogs. Buttons should look like the same application, while their emphasis communicates what each one does. Do not achieve uniqueness by turning every action into a pill, gradient or glowing card.

## Recommended family: Quiet Actions

Use compact rounded rectangles with 9 px corners, clean labels, the original graphite outline icons and a carefully limited violet fill. One primary action per task/action group is a useful default, not a rule requiring a primary button in every section. Do not make every page/panel action filled merely because it is clickable.

Primary is a decision/next-step signal. Soft violet is a persistent selection signal. A thin neutral border identifies supporting actions; transparent utilities reduce chrome in already structured toolbars. Actual destructive operations retain red treatment and an explicit label.

The identity comes from coherent proportions, precise icon/label alignment, restrained tone and dependable states. Buttons remain flat; surface elevation belongs to the dock/popover containing them.

## Alternate composition: Command Groups

For tightly related secondary commands, use one shared outlined group with borderless internal buttons. This reduces repeated outlines in dense contexts. Keep primary actions separate. Do not group unrelated or oppositely scoped commands merely to reduce space.

This is an alternative arrangement of the same family, not a separate palette or component library. Use it where the command relationship is clear and responsive fitting supports it; the individual Quiet Actions treatment remains the recommended default. Segmented controls for mutually exclusive state are a different semantic case from a group of momentary actions.

## Intent and semantic mapping

| Intent | Treatment | Examples | Behavior |
| --- | --- | --- | --- |
| Primary | Solid violet, theme-appropriate contrasting label | Open files on Home; Export PDF in output settings | Momentary command; no persistent selected state |
| Secondary | Neutral surface, hairline border, graphite label | Create PDF, Merge PDFs, Add text box, Apply label | Supporting action |
| Tertiary/utility | Transparent, graphite; neutral hover fill | Tools, inspector overflow, Cancel in a subordinate action row | Low visual emphasis; clearly labeled or accessible name |
| Toggle/tool | Soft violet selected surface and violet icon/label | Text editing tool, bold, view mode | Selected state reflects actual application model |
| Destructive | Red label/icon; subtle red hover surface | Delete pages/annotation | Preserve existing command/confirmation/undo behavior |
| Destructive commit | Solid danger only where an existing flow has a destructive commit | Existing delete confirmation action | Do not introduce a confirmation flow just to use this style |

Do not use green for ordinary export, insert or merge actions. Green represents genuine success feedback, not a command family. Security/protection actions such as Encrypt are ordinary commands until their actual semantics warrant a different state. Navigation links should remain links where they navigate; do not convert them to commands only for appearance.

## Geometry and density

| Context | Height/target | Icon | Label |
| --- | --- | --- | --- |
| Compact title-bar utility | 32 px logical target where native chrome permits | 16 px | 12 px when present |
| Standard panel/toolbar button | 36 px preferred height | 16 px | 12 px medium |
| Prominent welcome/dialog action | 40 px preferred height if the surrounding layout benefits | 16–18 px | 13–14 px medium |
| Dock tool tile | Existing approximately 52 px tile / 68 px dock | Existing 20 px icon | Existing 12 px label |
| Coarse/touch input | At least 44 × 44 px effective target | Same visible glyph | Preserve readable text |

All dimensions are proposals in logical pixels, not measured from scaled screenshots. The 36 px baseline is content-driven under text scaling; never clip a taller label at a hard height.

Use 9 px outer control radius, 12 px horizontal padding for ordinary labeled buttons, 6 px icon-label gap and 8 px spacing between independent peers. Keep icon-only controls square. Center the **combined icon-label content**, not the label independently. Icons keep the prior 24-unit vector grid, rounded 1.65-unit strokes and `currentColor`/theme-bound color.

For segmented controls, use 9 px outer group radius and 3 px inset; an inner 6 px radius follows from the nested geometry. Preserve the 9 px default on independent buttons and the existing dock geometry. Avoid arbitrary pill radii and per-workspace size variants.

Use short complete labels and full accessible names. Let localized text determine minimum width. When space is insufficient, reflow/relocate actions into the established overflow policy rather than shrinking text or cropping an essential label. Do not hide specialist text labels behind icons solely to make everything fit.

## Color and state tokens

| Token | Light | Dark |
| --- | --- | --- |
| Primary resting surface | `#7050D6` | `#B9A4FF` |
| Primary label | `#FFFFFF` | `#171A21` |
| Primary hover | `#6341C5` | `#C5B4FF` |
| Primary pressed | `#5734B6` | `#AC94F5` |
| Neutral foreground | `#485164` | `#B8C0D0` |
| Strong foreground | `#232A38` | `#EEF1F7` |
| Supporting boundary | `#E1E4EB` | `#3B414E` |
| Selected tool surface | `#F0EBFC` | `#302740` |
| Selected foreground | `#7050D6` | `#B9A4FF` |
| Danger foreground | `#B82E43` | `#FF9AAD` |

Use the existing theme surfaces, muted text, danger-soft and focus colors. The new primary hover/pressed shades extend the shared accent rather than introducing another color identity. Borders are quiet framing; readable text/icons and selected/focus cues carry meaning. Measure essential indicators and text against their actual adjacent surfaces in production.

## Interaction states

Rest: clear intent, stable dimensions and label. Hover: modest background/foreground change; no scale, lift, ripple, bounce or icon motion. Pressed: a slightly deeper tone while activation is held; no persistent selection for a normal action.

Selected: soft violet state driven by the actual active tool/view/formatting model. Do not implement selection merely by remembering the most recently clicked button. Read actual current settings and mixed-selection states from the document engine.

Focus: distinct keyboard focus indicator, proposed 2 px ring with 2 px offset using the shared violet focus color; it must coexist with selection. High contrast uses system-compatible indicators. Do not remove platform focus styling until a verified replacement exists. The preview's Focus sample illustrates a ring; real keyboard focus retains its browser default in the resource.

Disabled: use legible muted content and a neutral unavailable surface. Do not reduce the whole control to nearly invisible opacity. Provide a reason next to a relevant disabled command or through an appropriately accessible description. Do not rely on hover on a native disabled button to explain availability. Hide genuinely irrelevant actions; disable relevant actions that cannot currently run.

Busy: preserve button footprint, prevent duplicate activations, expose a busy state and keep focus stable where the platform permits. A concise operation label such as Exporting… can replace the action text without layout shift. Reserve enough width for localized resting/busy labels; don't copy the preview's fixed English width into production. A spinner is optional; do not add one if text is enough. Honor reduced motion.

Completion/failure: use the existing operation status area or concise adjacent message. Return the button to an appropriate action state. Do not permanently paint it green, label Exported when no file was actually created, or make retry impossible. Cancellation must reflect the real operation's cancelability.

Transitions use the existing 140 ms easing; reduced motion changes state immediately. Do not animate initial render or loop decorative effects.

## Context-specific rules

### Welcome screen

Open files is the main entry action. Create PDF from images and Merge PDFs are supporting outlined actions. Keep their actual workflow clear in label/tooltip: the preview shortens Create PDF for composition, but production can retain From images if that is the only supported creation path. Check for updates is a low-emphasis utility and should not rival opening a document. Preserve the existing shortcut hint; verify actual Windows binding.

### Title bar and tabs

Use a compact density for Open, Save and utilities. Identify ambiguous Save/Save As/Save All commands from their handlers first. Keep tooltip labels and real shortcuts. Preserve the drag region, native system menu, minimize/maximize/close hit areas and native window-control behavior. A brand button, window caption control or tab close button is not automatically a generic 9 px application action. Do not overwrite native caption control geometry.

### Panels

The panel's main workflow action can be filled (e.g. a valid Export PDF); property-level actions such as Apply page label use supporting styling. Use full-width buttons only when the inspector's vertical action layout benefits, not for every action. Only activate controls when there is a real target and capability; disabled reasons follow the panel state model. Buttons commit through existing commands/undo behavior, not independent local property copies.

### Dock and utilities

Keep the established icon-over-label dock tiles and selected tool appearance. More and Tools stay stable, with accessible names and complete menu labels. View controls use an exclusive segmented selection; action groups such as Import/Export are not automatically exclusive toggles. Do not apply hover-only controls to touch users or obscure the current mode.

### Dialogs

Identify the actual primary commitment and supporting cancellation action; follow existing platform/order conventions. Enter/Space behavior and default action must respect context, especially text areas and destructive actions. Do not add new dialogs or confirmations as part of styling. Label actions concretely: Export PDF, Apply label, Delete pages, rather than generic OK where specificity helps.

## Overflow, menus and shortcuts

A disclosure button has a stable accessible name, expanded state and a real anchored menu/popup. Ensure its focus model, Escape/focus return, outside dismissal and screen-bound repositioning use existing accessible primitives. A split button, if already present, exposes separate main action and disclosure targets; do not invent one merely for visual novelty.

Shortcut badges are supplemental. Use the actual application's platform bindings, not decorative Command symbols on Windows. Include shortcuts in accessible descriptions where useful without duplicating screen-reader speech unnecessarily. Essential behavior must remain available without hover or shortcut knowledge.

## Component contract and migration

Build or adapt a single framework-native button primitive with explicit intent, density, content, action/disclosure/toggle semantics and states. Reuse specialized dock/segmented/native-caption components as consumers or scoped variants rather than forcing every control into identical markup.

Inventory all buttons across Home, title bar, tabs, panels, dock, inspector, menus, dialogs, context menus, notices and empty states, including unseen screenshots. Record command ID, actual behavior, semantic kind, intent, density, states, label/shortcut, accessibility and capability predicate. Map existing duplicates to one primitive; preserve handler identity, telemetry/hooks/test selectors and shortcut routing.

Do not assume a JavaScript framework or native Windows toolkit. Apply tokens through the actual technology stack. The saved HTML is a visual reference, not an instruction to replace native controls with a web layer. Contextual state must come from the actual app model, and pending actions must be guarded in the operation layer as well as visually.

## Acceptance

Check normal/hover/pressed/focus/selected/disabled/busy/error/completion states; text-only/icon+text/icon-only/dropdown combinations; long localized labels; touch targets; both themes and high contrast; Windows 100/125/150/200% scaling; keyboard-only operation; and layouts with collapsed/resized panels. Verify no busy-label layout shift, double execution, clipped text, lost focus or falsely selected one-shot commands.

Use production measurements for at least 4.5:1 normal text and 3:1 essential nontext indicators where applicable. The quiet border is not intended as the sole identifying/meaningful cue. Preserve all commands and existing document/undo/confirmation behavior. Validate actual build and relevant existing tests; don't add tests that only restate token values.

The interactive examples perform local state demonstrations only. The simulated export does not create a file, OCR does not run, and menu examples are not a complete native menu implementation. Inline icons illustrate geometry; the saved offline preview embeds the earlier original icon concepts.
