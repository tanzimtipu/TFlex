# TFlex Button System

The single source of truth for every button and icon-only control in TFlex.
The stylesheet (`.btn` family in `src/renderer/styles.css`) and the shared
components (`Button` / `IconButton` in `src/renderer/components/Button.tsx`)
are the implementation of this document.

The taxonomy is pinned by `test/unit/renderer/buttonTaxonomyContract.test.ts`:
if this document names a class or a token, that class or token exists in the
shipped CSS, and a change that breaks the pairing fails `npm run test:unit`.

## Canonical class contract

`.btn` is the one base namespace. Every control is `.btn` plus exactly one
category class, plus optional size/layout modifiers:

| Class | Role |
| --- | --- |
| `.btn` | Base: layout, height, radius, gap, motion, cursor. Never used alone. |
| `.btn-primary` | Primary action (Quiet Actions violet fill). |
| `.btn-secondary` | Default action (raised surface + border). |
| `.btn-ghost` | Tertiary / low-emphasis action (transparent at rest). |
| `.btn-danger` | Destructive action, SUBTLE (transparent + red ink hairline). |
| `.btn-danger-commit` | Destructive COMMIT (solid error fill). Opt-in per call site. |
| `.btn-icon` | Square icon-only modifier. Requires an accessible name. |
| `.btn-toolbar` | Compact square toolbar control. |
| `.btn-toggle` | Toggle; selected state driven by `[aria-pressed="true"]`. |
| `.btn-disclosure` | Disclosure trigger; open state driven by `[aria-expanded="true"]`. |
| `.btn-sm` | Size modifier (compact height). |
| `.btn-compact` | Density modifier: `--btn-h-compact` (32px) target. |
| `.btn-prominent` | Density modifier: `--btn-h-prominent` (40px) target. |
| `.btn-coarse` | Density modifier: `--btn-target-coarse` (44px) min target. |
| `.btn-busy` | Busy-state modifier: progress cursor, width-preserving label swap. |
| `.btn-segmented` | Segmented-group container (`role="group"`). |
| `.btn-segmented-item` | An item inside `.btn-segmented`. |

## Axes

Phase 113 expresses the taxonomy as three explicit axes on the shared
components, layered additively over the Phase 91 `variant`/`size` surface:

- **`intent`** — task emphasis: `primary` | `secondary` | `tertiary` |
  `destructive`. Maps to `.btn-primary` / `.btn-secondary` / `.btn-ghost` /
  `.btn-danger`. The legacy `variant` values normalize onto the SAME classes
  (`variant="ghost"` and `intent="tertiary"` render identically); when both are
  supplied, `intent` wins.
- **`kind`** — semantic role: `action` (no class) | `toggle` (`.btn-toggle`) |
  `exclusive-selection` (`.btn-segmented-item`) | `disclosure`
  (`.btn-disclosure`).
- **`density`** — target size: `compact` (`.btn-compact`) | `standard` (no
  class) | `prominent` (`.btn-prominent`) | `coarse` (`.btn-coarse`).

`busy?` and `busyLabel?` are state props: while `busy` the control sets
`aria-busy="true"`, adds `.btn-busy`, shows `busyLabel ?? children` and does
NOT invoke `onClick`; the resting label stays in the DOM (visually hidden) so
the control width cannot jump. `IconButton` also keeps its required `label`
(written to `aria-label` + `title`), its `pressed` toggle state and gains
`expanded` for a disclosure (`aria-expanded`).

## Tokens

Geometry and rhythm come from the Phase 91 button token block in `:root`;
colour comes only from the existing design tokens; motion comes only from the
Phase 15 `--motion-*` tokens in `styles/animations.css`.

| Token | Default / source | Consumed by |
| --- | --- | --- |
| `--btn-h` | `var(--control-height)` (36px) | `.btn` height, `.btn-icon` width |
| `--btn-h-sm` | 28px | `.btn-sm` height, `.btn-icon.btn-sm` width |
| `--btn-toolbar-size` | `var(--btn-h-sm)` (28px) | `.btn-toolbar` width + height |
| `--btn-icon-size` | 16px | The glyph inside an icon button |
| `--btn-radius` | 9px | Base, segmented outer corners |
| `--btn-gap` | 6px | Label/icon separation |
| `--btn-pad-x` | 12px | Base horizontal padding |
| `--btn-label-size` | 12px | Base font-size |
| `--btn-label-weight` | 500 | Base font-weight |
| `--btn-h-compact` | 32px | `.btn-compact` height |
| `--btn-h-prominent` | 40px | `.btn-prominent` height |
| `--btn-target-coarse` | 44px | `.btn-coarse` min width + height |
| `--btn-primary-bg` | `#7050D6` (dark `#B9A4FF`) | `.btn-primary` fill/border |
| `--btn-primary-fg` | `#FFFFFF` (dark `#171A21`) | `.btn-primary` ink |
| `--btn-primary-hover` | `#6341C5` (dark `#C5B4FF`) | `.btn-primary:hover` |
| `--btn-primary-pressed` | `#5734B6` (dark `#AC94F5`) | `.btn-primary:active` |
| `--btn-primary-disabled-bg` | `#F0EBFC` (dark `#302740`) | primary CTA disabled fill (muted violet) |
| `--btn-primary-disabled-fg` | `#7050D6` (dark `#B9A4FF`) | primary CTA disabled ink (clears 4.5:1) |
| `--btn-neutral-pressed` | `#EAEDF2` (dark `#303641`) | ghost/secondary/toggle/disclosure press |
| `--btn-selected-bg` | `#F0EBFC` (dark `#302740`) | `.btn-toggle[aria-pressed="true"]` |
| `--btn-selected-fg` | `#7050D6` (dark `#B9A4FF`) | selected ink |
| `--btn-selected-border` | `#7050D6` (dark `#B9A4FF`) | selected border |
| `--btn-danger-fg` | `#B82E43` (dark `#FF9AAD`) | `.btn-danger` ink + hairline |
| `--error-hover` | `color-mix(in srgb, var(--error) 82%, black)` | `.btn-danger-commit:hover` |

The `--btn-*` colour tokens are declared in the same `:root` block as the
geometry (light defaults) and remapped in `:root[data-theme="dark"]`; the
frosted theme declares none of them, so it inherits the light defaults.
Themes elsewise supply `--accent`, `--accent-hover`, `--accent-pressed`,
`--accent-soft`, `--accent-pressed-soft`, `--bg-raised`, `--bg-hover`,
`--border`, `--fg-strong`, `--fg-on-accent`, `--error`. Motion tokens consumed:
`--motion-duration-fast`, `--motion-ease-standard`, `--motion-scale-press`.

## State model

Every category defines the same states. Nothing is left to chance:

- **Default** — the resting treatment declared on the category class.
- **Hover** — a `:hover:not([disabled]):not([aria-disabled="true"])` rule.
- **Active / pressed** — an `:active:not([disabled]):not([aria-disabled="true"])`
  rule; the shared press group adds `translateY(1px) scale(var(--motion-scale-press))`.
- **Focus** — `:focus-visible` paints `var(--focus-ring)` (the base rule plus the
  explicit per-variant list).
- **Selected** — `[aria-pressed="true"]` (toggle/segmented) or
  `[aria-expanded="true"]` (disclosure), painted from the `--btn-selected-*`
  tokens.
- **Disabled** — `[disabled]` (and `[aria-disabled="true"]` where a native
  attribute cannot be set): visible dim (opacity) and `cursor: not-allowed`,
  never colour alone. Hover/active rules are guarded so a disabled control
  stays inert.
- **Busy** — `aria-busy="true"` + `.btn-busy`: the resting label stays in the
  DOM (visually hidden) as the width anchor, the busy label overlays it and the
  component suppresses `onClick` as a duplicate-activation guard.

All transitions ride `--motion-duration-fast` and `--motion-ease-standard`; no
duration, easing or press scale is hardcoded anywhere in the family.

## Categories

Each category shows its exact markup, when to use it, its visual treatment, its
sizing and radius, its internal spacing, its icon usage and its states.

### Primary — `.btn-primary`

```html
<button class="btn btn-primary" type="button">Save</button>
<button class="btn btn-primary" type="button"><svg>...</svg>Save</button>
```

- **Purpose / when to use** — the single most important action on a surface:
  the dialog confirm, the command-bar Open, a save commits. One per view where
  possible.
- **Visual treatment** — solid `--btn-primary-bg` fill, `--btn-primary-fg` text,
  `--btn-primary-bg` border (a seamless single layer). Light is `#7050D6`; dark
  remaps to `#B9A4FF`.
- **Sizing** — height `--btn-h`, default horizontal padding `--btn-pad-x`.
- **Corner radius** — `--btn-radius`.
- **Internal spacing** — `--btn-gap` between icon and label.
- **Icon usage** — optional leading glyph; decorative, the text is the label.
- **States** — default `--btn-primary-bg`; hover `--btn-primary-hover`;
  active/pressed `--btn-primary-pressed` plus the shared press transform; focus
  `--focus-ring`; disabled dimmed with `cursor: not-allowed`. A primary CTA on a
  fixed footer (e.g. the Deliver export action) may instead opt into the explicit
  `--btn-primary-disabled-*` pair so the disabled look is distinguishable by
  colour, not opacity alone.

### Secondary — `.btn-secondary`

```html
<button class="btn btn-secondary" type="button">Cancel</button>
```

- **Purpose / when to use** — the default, neutral action: Cancel, Close, a
  routine panel action. This is the default category of the `Button` component.
- **Visual treatment** — raised surface `--bg-raised`, `--fg-strong` text,
  `--border` hairline.
- **Sizing** — height `--btn-h`, default horizontal padding `--btn-pad-x`.
- **Corner radius** — `--btn-radius`.
- **Internal spacing** — `--btn-gap`.
- **Icon usage** — optional leading glyph.
- **States** — default raised surface; hover `--bg-hover`; active/pressed
  `--btn-neutral-pressed` plus the shared press transform; focus `--focus-ring`;
  disabled dimmed with `cursor: not-allowed`.

### Tertiary / Ghost — `.btn-ghost`

```html
<button class="btn btn-ghost" type="button">More</button>
```

- **Purpose / when to use** — low-emphasis actions that should not compete with
  a primary or secondary control: "More", "Reset", a dismiss, a panel link.
- **Visual treatment** — transparent fill and border at rest, so it reads as
  text until focused; a neutral `--bg-hover` film on hover; the
  `--btn-neutral-pressed` wash on press.
- **Sizing** — height `--btn-h`, default horizontal padding `--btn-pad-x`.
- **Corner radius** — `--btn-radius`.
- **Internal spacing** — `--btn-gap`.
- **Icon usage** — optional leading glyph; this is the default category of
  `IconButton`.
- **States** — default transparent; hover `--bg-hover`; active/pressed
  `--btn-neutral-pressed`; focus `--focus-ring`; disabled dimmed with
  `cursor: not-allowed`.

### Icon-only — `.btn-icon`

```html
<button class="btn btn-ghost btn-icon" aria-label="Zoom in" title="Zoom in" type="button"><svg>...</svg></button>
<button class="btn btn-secondary btn-icon" aria-label="Close" title="Close" type="button"><svg>...</svg></button>
```

- **Purpose / when to use** — a single-glyph control where the icon is
  unambiguous and space is tight: close, zoom, navigation arrows. Reach for it
  only when a tooltip is genuinely enough.
- **Visual treatment** — the host category (ghost, secondary, danger or toggle)
  supplies the colour; `.btn-icon` only makes it square.
- **Sizing** — square: width and height both `--btn-h`; `.btn-sm` squares to
  `--btn-h-sm`.
- **Corner radius** — `--btn-radius`.
- **Internal spacing** — zero gap; the glyph is centred.
- **Icon usage** — REQUIRED, and the control MUST carry an accessible name.
  Use `IconButton`, whose required `label` sets both `aria-label` and `title`;
  the glyph is decorative. Glyph size `--btn-icon-size`.
- **States** — identical to the host category; focus `--focus-ring`; disabled
  dimmed with `cursor: not-allowed`.

### Toolbar — `.btn-toolbar`

```html
<button class="btn btn-toolbar" aria-label="Bold" title="Bold" type="button"><svg>...</svg></button>
<button class="btn btn-toolbar btn-toggle" aria-label="Grid" title="Grid" aria-pressed="true" type="button"><svg>...</svg></button>
```

- **Purpose / when to use** — compact, square controls packed into the command
  bar, the annotation toolbar and in-canvas overlay toolbars, where each pixel
  of chrome height counts.
- **Visual treatment** — a toolbar control is a compact square; it takes its
  colour from the host category (`ghost`, or `toggle` when it is a mode).
- **Sizing** — square: width and height both `--btn-toolbar-size` (default
  `--btn-h-sm`).
- **Corner radius** — `--btn-radius`.
- **Internal spacing** — zero gap; the glyph is centred.
- **Icon usage** — REQUIRED; always an `IconButton` with a `label`, so
  `aria-label` and `title` are present. Glyph size `--btn-icon-size`.
- **States** — as the host category; focus `--focus-ring`; disabled dimmed with
  `cursor: not-allowed`.

### Destructive — `.btn-danger` (subtle) / `.btn-danger-commit` (solid)

```html
<button class="btn btn-danger" type="button">Remove</button>
<button class="btn btn-danger-commit" type="button">Delete page</button>
```

- **Purpose / when to use** — an action that destroys or discards data: Delete,
  Clear, Remove, Flatten. Never for a merely negative-sounding ordinary action.
  `.btn-danger-commit` is the destructive COMMIT (a delete/clear/flatten that
  the user is confirming); migration waves choose it explicitly.
- **Visual treatment** — `.btn-danger` is SUBTLE: transparent fill,
  `--btn-danger-fg` ink, and a hairline red edge derived from `--btn-danger-fg`
  via `color-mix`. `.btn-danger-commit` is the solid treatment: `--error` fill,
  `--fg-on-accent` text, `--error` border.
- **Sizing** — height `--btn-h`, default horizontal padding `--btn-pad-x`.
- **Corner radius** — `--btn-radius`.
- **Internal spacing** — `--btn-gap`.
- **Icon usage** — optional leading glyph (a destructive icon reinforces it).
- **States** — subtle: default transparent + `--btn-danger-fg` ink; hover a
  faint red wash + stronger hairline (both `color-mix` from `--btn-danger-fg`);
  active/pressed a deeper wash plus the shared press transform; focus
  `--focus-ring`; disabled dimmed with `cursor: not-allowed`. Solid commit:
  default `--error`; hover `--error-hover` (the derived token, no fallback
  literal); active/pressed back to `--error`.

### Toggle — `.btn-toggle`

```html
<button class="btn btn-toggle" aria-pressed="false" type="button">Bold</button>
<button class="btn btn-toggle btn-icon" aria-label="Grid" title="Grid" aria-pressed="true" type="button"><svg>...</svg></button>
```

- **Purpose / when to use** — a mode/state control that stays on or off:
  bold/italic, grid, a panel pin, a docked view.
- **Visual treatment** — neutral (transparent) at rest; the SELECTED state is
  driven ONLY by `[aria-pressed="true"]`: `--btn-selected-bg` fill,
  `--btn-selected-border` border and `--btn-selected-fg` ink. A per-surface
  `-active` class is forbidden.
- **Sizing** — height `--btn-h`; combine with `.btn-icon` or `.btn-toolbar`
  for a square toggle.
- **Corner radius** — `--btn-radius`.
- **Internal spacing** — `--btn-gap` for a labelled toggle; zero gap for an
  icon toggle.
- **Icon usage** — optional (labelled) or required (icon-only); icon toggles
  use `IconButton` with `pressed`.
- **States** — default transparent; hover `--bg-hover`; active/pressed
  `--btn-neutral-pressed`; selected `[aria-pressed="true"]` painted from the
  `--btn-selected-*` tokens; focus `--focus-ring`; disabled dimmed with
  `cursor: not-allowed`. State is exposed through `aria-pressed`, never colour
  alone.

### Segmented — `.btn-segmented` + `.btn-segmented-item`

```html
<div class="btn-segmented" role="group" aria-label="Alignment">
  <button class="btn btn-toggle btn-segmented-item" aria-pressed="true" type="button">Left</button>
  <button class="btn btn-toggle btn-segmented-item" aria-pressed="false" type="button">Center</button>
  <button class="btn btn-toggle btn-segmented-item" aria-pressed="false" type="button">Right</button>
</div>
```

- **Purpose / when to use** — a small set of mutually exclusive options shown
  as one control: alignment, view mode, zoom preset.
- **Visual treatment** — the container paints the single border and the raised
  surface; items are flat and share the selected treatment with `.btn-toggle`.
- **Sizing** — container wraps its items; item height `--btn-h`, horizontal
  padding `--space-control`.
- **Corner radius** — only the OUTER group corners take `--btn-radius`; items
  are square (`border-radius: 0`) and the group clips them.
- **Internal spacing** — items sit flush; a labelled item uses `--btn-gap`
  between its icon and label.
- **Icon usage** — optional per item; icon-only items use `IconButton` with
  `pressed` and a `label`.
- **States** — each item carries the full `.btn-toggle` state ladder; the group
  container is not interactive. Focus `--focus-ring` on the item. The group is
  `role="group"` with an `aria-label`; selected items expose
  `aria-pressed="true"`.

### Disclosure — `.btn-disclosure`

```html
<button class="btn btn-disclosure" aria-expanded="false" type="button">Advanced</button>
<button class="btn btn-disclosure" aria-expanded="true" type="button">Advanced</button>
```

- **Purpose / when to use** — a control that reveals or hides a region (an
  advanced section, a nested menu, a details panel).
- **Visual treatment** — chrome-neutral like ghost (transparent at rest,
  `--fg-strong` ink); the open state `[aria-expanded="true"]` reuses the
  `--btn-selected-bg` / `--btn-selected-fg` tokens so it reads like a selected
  toggle.
- **Sizing** — height `--btn-h`, default horizontal padding `--btn-pad-x`.
- **Corner radius** — `--btn-radius`.
- **Internal spacing** — `--btn-gap`.
- **Icon usage** — a trailing chevron is common and optional.
- **States** — default transparent; hover `--bg-hover`; active/pressed
  `--btn-neutral-pressed`; expanded `[aria-expanded="true"]` selected tokens;
  focus `--focus-ring`; disabled dimmed with `cursor: not-allowed`. Open state
  is exposed through `aria-expanded`, never colour alone.

### Density — `.btn-compact` / `.btn-prominent` / `.btn-coarse`

The `density` prop selects a target size by token; `standard` adds no class and
the base `.btn` height applies.

- **`.btn-compact`** — height `--btn-h-compact` (32px), the compact target.
- **`.btn-prominent`** — height `--btn-h-prominent` (40px), the prominent
  target.
- **`.btn-coarse`** — `min-height` and `min-width` both `--btn-target-coarse`
  (44px), the coarse pointer/touch target; the control stays content-driven and
  never clips a taller label.

### Busy — `.btn-busy`

- **Purpose / when to use** — a control whose action is in flight and must not
  be activated again.
- **Behaviour** — `aria-busy="true"` and `.btn-busy` are set; the visible label
  becomes `busyLabel ?? children`; the component suppresses `onClick` so a
  double-click cannot fire the action twice.
- **Width stability** — the resting label stays in the DOM (`.btn-label-resting`,
  `visibility: hidden`) as the width anchor while `.btn-label-busy` overlays the
  swapped label, so the control cannot change width when it enters busy.
- **States** — `.btn-busy` paints a `progress` cursor; all other states keep
  their normal rules.

## Accessibility contract

- Icon-only controls always carry `aria-label` + `title`; the shared
  `IconButton` requires `label` and writes both.
- Keyboard focus is visible through `var(--focus-ring)` on `:focus-visible` for
  every category.
- Toggle state is exposed as `aria-pressed`; a segmented group is
  `role="group"` with an `aria-label`.
- Disclosure state is exposed as `aria-expanded`; busy state as `aria-busy`.
- Disabled controls are non-interactive and visibly dimmed.
- Colour is never the only signal; label, glyph and state attributes carry the
  meaning.

## Rules for surfaces

- Consume a canonical category; do not fork a parallel button class.
- A surface may vary only SIZE (`btn-sm`) and layout (alignment, min-width).
  It must not override a canonical variant's colour or state styling.
  Exception: the retired Action Dock edit pen (`.btn.action-dock-edit`) was an
  icon and followed the shared icon rest/active ladder (`--tf-icon-rest` at
  rest, `--tf-icon-active` while `aria-pressed='true'`, `--fg-strong` on hover).
  Phase 103 criterion 3 supersedes the Phase 63 EDIT-stage ink
  (`--tf-stage-edit`). Phase 104 (chunk 1) retires the standalone pen: docking
  customization now lives in the More menu's "Customize dock" item
  (`data-dock-menu-item="customize"`) over the same dock EDIT-mode flow, so the
  scoped `.action-dock-edit` rules remain only as the dormant hook the unit
  guard `test/unit/renderer/tfl47_dockEditIconColor.test.ts` still pins.
  Second exception: a pre-existing surface that cannot become a plain `<button>`
  (`.tab` is a `div[role="tab"]`; `.home-tool-minus` is a span inside the tile
  button) may adopt the canonical axes while its long-standing alias keeps
  owning geometry and colour. A scoped `.alias.btn` rule re-pins that layout/ink
  over the base family (Phase 113 wave C: `.tab.btn`, `.tab-close.btn`,
  `.home-tool-minus.btn`), mirroring the `.btn.action-dock-verb` alias.
  Third exception: the annotation colour swatch
  (`.ann-color-swatch-main` in `AnnotationToolbar.tsx`) paints a LIVE colour
  fill from the active tool, which the generic icon/text primitive cannot
  express, so it keeps its native markup and is deliberately NOT migrated
  (Phase 113 wave D; pinned by `phase113_dockToolbars.test.tsx`).
  Fourth exception (Phase 113 wave E1): the annotation-panel colour swatch
  (`.ann-panel-swatch` in `AnnotationsPanel.tsx`) carries the same live
  `background` fill per `data-color`, so it too keeps its native markup; its
  selected state is driven only by `[aria-pressed="true"]` (the legacy
  `.ann-panel-swatch-active` class is retired), pinned by
  `phase113_panelsInspectors.test.tsx`. Fifth exception: the resizable panel
  separator (`.panel-resize-handle` in `panels/PanelResizeHandle.tsx`) is a
  genuine `role="separator"` with keyboard resize semantics and
  `aria-valuenow/min/max`, not a button, so it stays native and is NOT migrated.
  Sixth exception (Phase 113 wave E2): the top-bar account avatar
  (`.account-avatar` in `AccountMenu.tsx`) is a `motion.button` whose press
  feedback is the framer-motion `useScaleAnimation` gesture — a contract
  `phase44_avatarIdentity.test.ts` pins by scanning the source for
  `useScaleAnimation` and scanning the stylesheet for the `.account-avatar`
  accent/ink block. Substituting the plain primitive would drop that gesture (or
  require wrapping the primitive in a motion component it does not support), so
  it keeps its native markup and is NOT migrated.
  Seventh exception (Phase 113 wave F1): the crop editor's drag surface and
  corner handles (`.crop-editor-mask`, a `<div role="button">`, and the four
  `.crop-editor-handle` `<div>`s in `CropPagesDialog.tsx`) are pointer-drag
  targets, not command buttons, so they keep their native markup and are NOT
  migrated. The Command Palette's result rows (`CommandPalette.tsx`) are
  `role="option"` listbox items that each host a nested pin toggle, so they
  cannot become a plain `<button>`; like `.tab`, they adopt the canonical axes
  (`btn btn-secondary`) on the `<li>` while `.command-palette-row` keeps owning
  geometry. The rest of wave F1 — accounts mode tabs, the preferences rail and
  storage rows, the signature manager tabs and saved rows, the watermark / Bates
  position slots, the About storage rows and the colour-palette swatches — ride
  the canonical axes with a scoped `.btn.<alias>` layout pin, so colour, hover,
  focus, selected and disabled states resolve from the family.
  Eighth exception (Phase 113 wave F2): the committed sticky-note icon
  (`AnnotationOverlay.tsx`'s `.ann-note`) is a `div[role="button"]` that is ALSO
  a pointer-drag surface (its press starts a move drag), so it keeps its native
  `<div>` markup and adopts the canonical axes directly (`btn btn-secondary
  btn-compact`) with `.ann-note` retaining position, the `grab` cursor, the
  inline ink and transparent chrome. The Home remove badge
  (`.home-tool-minus`) is a `<span role="button">` nested inside the Home tile
  `<button>`, so it likewise stays native and rides the canonical axes
  (`btn btn-danger btn-compact`). The ConversionProgress /
  ReadingView progress tracks, the `.multi-divider` `role="separator"` and the
  FormFillReport rows keep their native structural markup. Every other wave-F2
  control — the notice collapse / collapsed "i" toggles, the ConversionProgress
  Cancel, the empty-state pick / open rows, the Reading and Book View close /
  layout / nav controls, the stamp-type chips and cancel, the redaction mark
  swatches and the form checkbox / radio / listbox editors — renders through the
  `Button` / `IconButton` primitive with a scoped `.btn.<alias>` re-pin that
  fixes the box, the live swatch fill and the `[aria-pressed="true"]` selected
  ink, so colour, hover, focus, selected and disabled states resolve from the
  canonical family.
  Ninth exception (Phase 113 wave F3): the ruler page number
  (`.rail-ruler-page` in `SideRail.tsx`) is a framer-motion `motion.button`
  bound to the `useLiftAnimation` gesture, so it keeps its native markup and
  adopts the canonical axes directly (`btn btn-ghost btn-compact`); the scoped
  `.rail-ruler-page` block neutralises the `.btn` control box (height/gap) so
  the dense numbers ladder keeps its micro height, and `.rail-ruler-current`
  keeps the selected treatment. The thumbnail hover verbs (`.thumb-verb` in
  `SideRail.tsx`) are `role="button"` spans nested inside the thumbnail's own
  button — a real `<button>` there would be invalid HTML — so they too keep
  their native markup and adopt the axes directly (`btn btn-ghost btn-compact`,
  the destructive row `btn btn-danger btn-compact`); their element, `tabIndex`,
  `data-thumb-verb` hook and stop-propagation click are unchanged. The
  thumbnail button itself (`.thumb-item`, `draggable` + the drag/select
  gesture), the `role="separator"` `.multi-divider`, the HTML5-draggable
  `.page-drag-handle` (`DocumentView.tsx`) and the panel `role="separator"`
  resize handle keep their native markup and are NOT migrated. The migrated
  wave-F3 controls — the update indicator's available / downloaded / error pills
  (`UpdateIndicator.tsx`) and the multi-pane clear control
  (`MultiPane.tsx`) — render through the `Button` / `IconButton` primitive,
  with the `update-indicator*` / `multi-pane-clear` alias owning only the
  layout box, so colour, hover, focus and pressed states resolve from the
  canonical family.
- **Menu rows.** Every command-menu row renders through the shared `CommandMenu`
  primitive, whose row is a `Button` on the canonical axes: the quiet default is
  `intent="tertiary"` (`btn-ghost`), a stronger list passes `intent="secondary"`,
  and a destructive row passes `intent="destructive"`; `density` defaults to
  `compact`. A surface's long-standing row alias (`titlebar-menu-row`,
  `context-menu-item`, `action-dock-menu-item`, `ann-tool-menu-row`) rides on the
  primitive's `className`/`rowClassName` and owns layout only; colour, hover,
  focus, disabled and selected states resolve from the canonical family.
- Never hardcode a duration, easing or press scale; never add a new colour
  literal. Colour comes from the tokens above, motion from `--motion-*`.
