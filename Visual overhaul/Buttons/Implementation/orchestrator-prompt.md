# Implementation prompt — Jovrel buttons

Create one cohesive button system for my Windows PDF editor, Jovrel, using the recommended **Quiet Actions** family. It must match the prior Quiet Precision icons, Focus Dock and Context Pair panels and make the app ultra-modern, simple and elegant.

Resources are under `C:\Users\tanzi\OneDrive\App Development\TFlex\Visual overhaul`. Read `Buttons\Specifications\button-design-spec.md`, inspect `Buttons\Visuals\interactive-button-preview.html` and the light/dark/state images, and use `Design System\buttons.tokens.json` with the existing icon/dock/panel tokens. The preview demonstrates local states only; no real export or PDF action is executed. Its English dimensions and simulated timeouts are not production behavior to copy.

Inspect repository instructions, framework/native toolkit, current button primitives, theme system, command registry, operation state, capability rules, menu primitives and accessibility patterns. Inventory buttons in Home, title bar, tabs, dock, panels, inspectors, dialogs, menus/context menus, empty states and notices, including controls unseen in screenshots. Record command IDs, action/disclosure/toggle semantics, emphasis, density, states, labels, actual shortcuts and handlers. Preserve behavior, selectors/hooks, keyboard bindings, document operations and undo/redo.

Adapt or create one framework-native button primitive with explicit semantic kind, intent, density, icon/text content and states. Specialized dock tiles, view segments, menu actions and native caption controls remain appropriate specialized consumers. Do not force native window controls into generic rounded rectangles or replace native controls with a web layer.

Use these treatments consistently:

- Primary: solid shared violet with contrasting label for the main task action, such as Open files or Export PDF. One primary per task/action group is a default; not every section needs one.
- Secondary: neutral surface, subtle boundary and graphite content for supporting actions such as Create PDF from images, Merge PDFs, Add text box and Apply page label.
- Tertiary/utility: transparent graphite controls with neutral hover for Tools, More, subordinate Cancel and contextual utilities.
- Persistent tools/views: soft violet selected tile with correct actual pressed/selected state. Text, Images and exclusive page views read from app state.
- Destructive: red label/icon with subtle red hover for actual delete commands. Use a solid danger commit only where an existing destructive flow needs it; do not create confirmations merely for styling.

Do not color ordinary merge/export/insert buttons green. Reserve green for actual success feedback. Normal one-shot commands must not stay selected after clicking. Identify ambiguous title-bar save variants and mode controls from handlers before renaming or restyling their semantics.

Geometry: inherit 9 px control radius, 6 px icon-label gap, 4 px spacing unit and existing icon grammar. Standard buttons use approximately 36 px content-driven height and 12 px medium labels with 12 px horizontal padding. Compact utilities use 32 px targets where native chrome permits; prominent actions may use 40 px height with appropriately scaled labels. Maintain at least 44 px effective coarse-input targets. Dock tiles retain their existing 20 px icons/12 px labels and layout. Icons are theme-bound vector glyphs; center the combined icon-label content. A 9 px segmented group with 3 px inset uses a derived 6 px inner radius.

Add primary hover/pressed shades from the new tokens and preserve readable foregrounds in both themes. Keep buttons flat, with elevation on containing dock/popover surfaces. Use 140 ms color/background/border transitions and reduced-motion support. No magnification, bounce, ripples, gradients or decorative icon animation. Keep a distinct focus ring that works with selected states and high contrast.

Disabled controls remain legible and have an accessible reason where useful; don't make them nearly invisible or depend on hover over native disabled buttons. Hide irrelevant actions and disable relevant unavailable actions according to the real capability model. Busy actions expose operation state, prevent duplicate activation in both UI and handler, preserve focus where possible and reserve enough width for localized resting/busy labels. Actual completion/failure goes to an appropriate existing status area; don't permanently turn commands green or claim completion before the backend succeeds.

Keep concrete labels and actual shortcuts. Preserve specialist text labels, tooltip/accessibility names, native title-bar drag/system/caption behavior and tab-close semantics. Full-width buttons are for purposeful vertical action layouts, not every property. Long/localized labels reflow or use established overflow rather than shrinking into illegibility. Disclosures use real menu primitives with expanded state, focus navigation, Escape/focus return, outside dismissal and screen-bound positioning. Action groups are not exclusive toggles unless the underlying model actually is exclusive.

The Command Groups preview is an alternative composition for related secondary actions, not a second visual theme. Use the recommended independent treatment by default and grouping where it clarifies relationships. Preserve existing dialog ordering/default-action conventions and destructive-action safeguards; no extra approval steps are part of this visual task.

Validate all intents and semantic kinds in light/dark/high contrast, Windows 100/125/150/200% DPI, keyboard and touch input, localization/text scaling, narrow/resized-panel layouts and busy/error/success conditions. Check contrast of normal text and essential indicators, no label/width jumps, no double execution or focus loss, and correct persistent selection from application state. Run relevant build/checks and meaningful existing tests. Deliver the complete button inventory/mapping, primitive/token changes, representative before/after screenshots and validation results, clearly identifying any unresolved controls outside the screenshot set.
