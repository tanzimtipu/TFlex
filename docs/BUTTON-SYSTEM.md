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
| `.btn-primary` | Primary action (accent fill). |
| `.btn-secondary` | Default action (raised surface + border). |
| `.btn-ghost` | Tertiary / low-emphasis action (transparent at rest). |
| `.btn-danger` | Destructive action (error fill). |
| `.btn-icon` | Square icon-only modifier. Requires an accessible name. |
| `.btn-toolbar` | Compact square toolbar control. |
| `.btn-toggle` | Toggle; selected state driven by `[aria-pressed="true"]`. |
| `.btn-sm` | Size modifier (compact height). |
| `.btn-segmented` | Segmented-group container (`role="group"`). |
| `.btn-segmented-item` | An item inside `.btn-segmented`. |

## Tokens

Geometry and rhythm come from the Phase 91 button token block in `:root`;
colour comes only from the existing design tokens; motion comes only from the
Phase 15 `--motion-*` tokens in `styles/animations.css`.

| Token | Default / source | Consumed by |
| --- | --- | --- |
| `--btn-h` | `var(--control-height)` (36px) | `.btn` height, `.btn-icon` width |
| `--btn-h-sm` | 28px | `.btn-sm` height, `.btn-icon.btn-sm` width |
| `--btn-toolbar-size` | `var(--btn-h-sm)` (28px) | `.btn-toolbar` width + height |
| `--btn-icon-size` | `var(--tf-icon-size)` (18px) | The glyph inside an icon button |
| `--btn-radius` | `var(--radius-control)` (10px) | Base, segmented outer corners |
| `--btn-gap` | `var(--sp-2)` (8px) | Label/icon separation |
| `--error-hover` | `color-mix(in srgb, var(--error) 82%, black)` | `.btn-danger:hover` |

Colour tokens consumed (never re-declared here): `--accent`, `--accent-hover`,
`--accent-pressed`, `--accent-soft`, `--accent-pressed-soft`, `--bg-raised`,
`--bg-hover`, `--border`, `--fg-strong`, `--fg-on-accent`, `--error`,
`--error-hover`. Motion tokens consumed: `--motion-duration-fast`,
`--motion-ease-standard`, `--motion-scale-press`.

## State model

Every category defines the same five states. Nothing is left to chance:

- **Default** — the resting treatment declared on the category class.
- **Hover** — a `:hover:not([disabled]):not([aria-disabled="true"])` rule.
- **Active / pressed** — an `:active:not([disabled]):not([aria-disabled="true"])`
  rule; the shared press group adds `translateY(1px) scale(var(--motion-scale-press))`.
- **Focus** — `:focus-visible` paints `var(--focus-ring)` (the base rule plus the
  explicit per-variant list).
- **Disabled** — `[disabled]` (and `[aria-disabled="true"]` where a native
  attribute cannot be set): visible dim (opacity) and `cursor: not-allowed`,
  never colour alone. Hover/active rules are guarded so a disabled control
  stays inert.

All transitions ride `--motion-duration-fast` and `--motion-ease-standard`; no
duration, easing or press scale is hardcoded anywhere in the family.

## Categories

Each category shows its exact markup, when to use it, its visual treatment, its
sizing and radius, its internal spacing, its icon usage and its five states.

### Primary — `.btn-primary`

```html
<button class="btn btn-primary" type="button">Save</button>
<button class="btn btn-primary" type="button"><svg>...</svg>Save</button>
```

- **Purpose / when to use** — the single most important action on a surface:
  the dialog confirm, the command-bar Open, a save commits. One per view where
  possible.
- **Visual treatment** — solid `--accent` fill, `--fg-on-accent` text,
  `--accent` border (a seamless single layer).
- **Sizing** — height `--btn-h`, default horizontal padding `--space-control`.
- **Corner radius** — `--btn-radius`.
- **Internal spacing** — `--btn-gap` between icon and label.
- **Icon usage** — optional leading glyph; decorative, the text is the label.
- **States** — default `--accent`; hover `--accent-hover`; active/pressed
  `--accent-pressed` plus the shared press transform; focus `--focus-ring`;
  disabled dimmed with `cursor: not-allowed`.

### Secondary — `.btn-secondary`

```html
<button class="btn btn-secondary" type="button">Cancel</button>
```

- **Purpose / when to use** — the default, neutral action: Cancel, Close, a
  routine panel action. This is the default category of the `Button` component.
- **Visual treatment** — raised surface `--bg-raised`, `--fg-strong` text,
  `--border` hairline.
- **Sizing** — height `--btn-h`, default horizontal padding `--space-control`.
- **Corner radius** — `--btn-radius`.
- **Internal spacing** — `--btn-gap`.
- **Icon usage** — optional leading glyph.
- **States** — default raised surface; hover `--bg-hover`; active/pressed
  `--accent-pressed-soft` plus the shared press transform; focus `--focus-ring`;
  disabled dimmed with `cursor: not-allowed`.

### Tertiary / Ghost — `.btn-ghost`

```html
<button class="btn btn-ghost" type="button">More</button>
```

- **Purpose / when to use** — low-emphasis actions that should not compete with
  a primary or secondary control: "More", "Reset", a dismiss, a panel link.
- **Visual treatment** — transparent fill and border at rest, so it reads as
  text until focused; a neutral `--bg-hover` film on hover; the
  `--accent-pressed-soft` wash on press.
- **Sizing** — height `--btn-h`, default horizontal padding `--space-control`.
- **Corner radius** — `--btn-radius`.
- **Internal spacing** — `--btn-gap`.
- **Icon usage** — optional leading glyph; this is the default category of
  `IconButton`.
- **States** — default transparent; hover `--bg-hover`; active/pressed
  `--accent-pressed-soft`; focus `--focus-ring`; disabled dimmed with
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

### Destructive — `.btn-danger`

```html
<button class="btn btn-danger" type="button">Delete</button>
```

- **Purpose / when to use** — an action that destroys or discards data: Delete,
  Clear, Remove, Flatten. Never for a merely negative-sounding ordinary action.
- **Visual treatment** — solid `--error` fill, `--fg-on-accent` text,
  `--error` border, so it is visually distinct from the accent primary before
  the user commits.
- **Sizing** — height `--btn-h`, default horizontal padding `--space-control`.
- **Corner radius** — `--btn-radius`.
- **Internal spacing** — `--btn-gap`.
- **Icon usage** — optional leading glyph (a destructive icon reinforces it).
- **States** — default `--error`; hover `--error-hover` (the derived token, no
  fallback literal); active/pressed back to `--error` plus the shared press
  transform; focus `--focus-ring`; disabled dimmed with `cursor: not-allowed`.

### Toggle — `.btn-toggle`

```html
<button class="btn btn-toggle" aria-pressed="false" type="button">Bold</button>
<button class="btn btn-toggle btn-icon" aria-label="Grid" title="Grid" aria-pressed="true" type="button"><svg>...</svg></button>
```

- **Purpose / when to use** — a mode/state control that stays on or off:
  bold/italic, grid, a panel pin, a docked view.
- **Visual treatment** — neutral (transparent) at rest; the SELECTED state is
  driven ONLY by `[aria-pressed="true"]`: `--accent-soft` fill, `--accent`
  border and `--accent` ink. A per-surface `-active` class is forbidden.
- **Sizing** — height `--btn-h`; combine with `.btn-icon` or `.btn-toolbar`
  for a square toggle.
- **Corner radius** — `--btn-radius`.
- **Internal spacing** — `--btn-gap` for a labelled toggle; zero gap for an
  icon toggle.
- **Icon usage** — optional (labelled) or required (icon-only); icon toggles
  use `IconButton` with `pressed`.
- **States** — default transparent; hover `--bg-hover`; active/pressed
  `--accent-pressed-soft`; selected `[aria-pressed="true"]` accent-soft, whose
  hover deepens the border/ink to `--accent-hover`; focus `--focus-ring`;
  disabled dimmed with `cursor: not-allowed`. State is exposed through
  `aria-pressed`, never colour alone.

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

## Accessibility contract

- Icon-only controls always carry `aria-label` + `title`; the shared
  `IconButton` requires `label` and writes both.
- Keyboard focus is visible through `var(--focus-ring)` on `:focus-visible` for
  every category.
- Toggle state is exposed as `aria-pressed`; a segmented group is
  `role="group"` with an `aria-label`.
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
- Never hardcode a duration, easing or press scale; never add a new colour
  literal. Colour comes from the tokens above, motion from `--motion-*`.
