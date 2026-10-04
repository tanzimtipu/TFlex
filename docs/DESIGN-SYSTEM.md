# TFlex Design System

The single source of truth for the app's colour, elevation and empty-state
system. The implementation is the token layer in `src/renderer/styles.css`; this
document and that file must agree, and the pairing is pinned by
`test/unit/renderer/designSystem.test.ts`, which reads the stylesheet and fails if
a documented token disappears from a theme scope or the elevation ladder drifts
from its mapping.

Scope of Phase 96: the app-wide colour + depth + empty-state layer. It does not
restyle buttons (Phase 91), dialog structure (Phase 92), Book View motion
(Phase 93), icon artwork (Phase 94) or dock geometry (Phase 95).

## 1. One accent, three equally designed themes

There is exactly ONE brand hue: the TFlex violet. `--accent` is `#7C3AED` in
every theme (the base fill / border / glyph value). On the dark surfaces the
accent INK brightens to its counterpart `#A78BFA` (`--accent-text` /
`--sem-primary`) so accent text keeps the WCAG floor on near-black; on the light
frosted glass the accent INK deepens to `#6D28D9` for the same reason. No second
brand hue exists.

Three theme scopes are declared in `src/renderer/styles.css`:

| Scope | Selector | Role |
| --- | --- | --- |
| light | `:root` | default flat light theme |
| dark | `:root[data-theme="dark"]` | near-black flat theme |
| frosted | `:root[data-theme="frosted"]` | light neutral acrylic (the default material) |

Every colour token below is declared explicitly in all three scopes. Structural
tokens (`--glass-blur`, radii, motion) are theme-independent and live in `:root`
only.

## 2. Brand / accent family

| Token | Light | Dark | Frosted | Purpose | Measured contrast |
| --- | --- | --- | --- | --- | --- |
| `--accent` | `#7C3AED` | `#7C3AED` | `#7C3AED` | Base brand fill, border, glyph. | `--fg-on-accent` on it: 5.70:1 (all themes) |
| `--accent-text` | `#7C3AED` | `#A78BFA` | `#6D28D9` | Accent INK on chrome surfaces. | on `--bg-base`: 5.70 / 7.15 / 6.27 |
| `--accent-hover` | `#8B5CF6` | `#8B5CF6` | `#8B5CF6` | Hover lift of the base accent. | fill, see `--accent` |
| `--accent-pressed` | `#6D28D9` | `#6D28D9` | `#6D28D9` | Press deepen of the base accent. | fill, see `--accent` |
| `--accent-soft` | `rgba(124,58,237,0.12)` | same | same | Tinted wash for armed/selected chrome. | `--dock-primary-fg` on it over `--bg-elevated`: 5.80 / 5.65 / 5.90 |
| `--accent-selected` | `rgba(124,58,237,0.10)` | same | same | Selected-row / control wash. | non-text state wash |
| `--accent-pressed-soft` | `rgba(124,58,237,0.20)` | same | same | Pressed wash for neutral controls. | non-text state wash |
| `--accent-hover-bg` | `rgba(124,58,237,0.08)` | same | same | Hover wash for neutral controls. | non-text state wash |
| `--sem-primary` | `#7C3AED` | `#A78BFA` | `#6D28D9` | PRIMARY semantic role (selection, active, primary actions). | on `--bg-raised`: 5.70 / 6.78 / 7.04 |

## 3. Surfaces

Surface tokens paint the chrome and workspace. Chrome / toolbar / rail are FLAT
(no shadow); elevated content rides the ladder in section 10.

| Token | Light | Dark | Frosted | Purpose | Measured `--fg` contrast (L / D / F) |
| --- | --- | --- | --- | --- | --- |
| `--bg-base` | `#ffffff` | `#0b0d0f` | `#eef1f5` | Window base behind everything. | 14.63 / 8.71 / 14.29 |
| `--bg-sunken` | `#f8fafc` | `#090b0d` | `#e8ebf0` | Recessed wells. | 13.98 / 8.82 / 13.54 |
| `--bg-raised` | `#ffffff` | `#111419` | `rgba(255,255,255,0.93)` | Raised cards/controls (secondary buttons, palettes). | 14.63 / 8.26 / 16.05 |
| `--bg-toolbar` | `#fafafa` | `#101318` | `rgba(255,255,255,0.68)` | Command / annotation toolbars, search. | 14.02 / 8.33 / 15.56 |
| `--bg-rail` | `#f4f4f5` | `#101419` | `rgba(255,255,255,0.68)` | Left pages rail / right tools panel. | 13.31 / 8.27 / 15.56 |
| `--bg-canvas` | `#f1f5f9` | `#0b0d0f` | `#eef1f5` | Document workspace behind the page. | 13.35 / 8.71 / 14.29 |
| `--bg-input` | `#ffffff` | `#111419` | `rgba(255,255,255,0.92)` | Text inputs and form fields. | 14.63 / 8.26 / 16.03 |
| `--bg-secondary` | `#f4f6f8` | `#15191e` | `rgba(255,255,255,0.68)` | Secondary panel surface. | 13.50 / 7.90 / 15.56 |
| `--bg-elevated` | `#fbfcfd` | `#191e24` | `rgba(255,255,255,0.93)` | Elevated panel / menu body surface. | 14.24 / 7.50 / 16.05 |
| `--bg-panel` | `#f8fafc` | `#14181d` | `rgba(255,255,255,0.68)` | Docked panel body. | 13.98 / 7.97 / 15.56 |
| `--bg-hover` | `rgba(15,23,42,0.04)` | `rgba(255,255,255,0.04)` | `rgba(15,23,42,0.05)` | Shared hover film on rows/cards. | 13.50 / 8.06 / 12.94 (with `--fg`) |
| `--bg-active` | `rgba(15,23,42,0.08)` | `rgba(255,255,255,0.08)` | `rgba(15,23,42,0.09)` | Shared active/pressed film. | 12.43 / 7.28 / 11.92 (with `--fg`) |
| `--bg-tab-active` | `#ffffff` | `#15191e` | `rgba(255,255,255,0.76)` | Active tab surface. | 14.63 / 7.90 / 15.72 |
| `--menu-bg` | `#ffffff` | `#171b20` | `rgba(255,255,255,0.86)` | Menu / popover surface. | 14.63 / 7.74 / 15.91 |
| `--panel-bg` | `var(--bg-rail)` | `var(--bg-rail)` | `rgba(255,255,255,0.68)` | Canonical docked-panel surface. | 13.31 / 8.27 / 15.56 |
## 4. Glass material (`--glass-*`)

The neutral acrylic material. `--glass-blur` is theme-independent (declared once
in `:root`); the rest are per-theme. The frosted theme is the one theme that
renders the glass; light/dark carry their own neutral mappings.

| Token | Light | Dark | Frosted | Purpose | Measured `--fg-strong` contrast over the composite |
| --- | --- | --- | --- | --- | --- |
| `--glass-blur` | `blur(20px) saturate(1.2)` | (same) | (same) | The one acrylic filter (theme-independent). | n/a (filter) |
| `--glass-bg` | `rgba(255,255,255,0.72)` | `rgba(20,24,29,0.72)` | `rgba(255,255,255,0.72)` | Base glass film. | 17.85 / 15.07 / 17.02 |
| `--glass-border` | `rgba(15,23,42,0.1)` | `rgba(255,255,255,0.14)` | `rgba(255,255,255,0.35)` | Glass hairline. | 14.54 / 11.06 / 16.26 |
| `--glass-highlight` | `rgba(255,255,255,0.55)` | `rgba(255,255,255,0.18)` | `rgba(255,255,255,0.55)` | Luminous edge inset. | 17.85 / 9.59 / 16.67 |
| `--glass-shadow` | `0 8px 32px rgba(15,23,42,0.12)` | `0 8px 32px rgba(0,0,0,0.5)` | `0 8px 32px rgba(0,0,0,0.12)` | Glass drop shadow. | n/a (shadow) |
| `--glass-chrome-bg` | `rgba(255,255,255,0.75)` | `rgba(21,25,31,0.75)` | `rgba(255,255,255,0.75)` | Title/command chrome film. | 17.85 / 14.92 / 17.09 |
| `--glass-chrome-border` | `rgba(15,23,42,0.08)` | `rgba(255,255,255,0.16)` | `rgba(255,255,255,0.4)` | Chrome film hairline. | 15.17 / 10.31 / 16.36 |
| `--glass-sidebar-bg` | `rgba(255,255,255,0.68)` | `rgba(19,23,28,0.68)` | `rgba(255,255,255,0.68)` | Rail / panel film. | 17.85 / 15.22 / 16.94 |
| `--glass-sidebar-border` | `rgba(15,23,42,0.08)` | `rgba(255,255,255,0.12)` | `rgba(255,255,255,0.32)` | Rail / panel hairline. | 15.17 / 11.83 / 16.19 |
| `--glass-group-bg` | `rgba(15,23,42,0.045)` | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.55)` | Control-group capsule fill. | 16.31 / 14.12 / 16.67 |
| `--glass-group-border` | `rgba(15,23,42,0.08)` | `rgba(255,255,255,0.1)` | `rgba(255,255,255,0.25)` | Control-group capsule edge. | 15.17 / 12.61 / 16.05 |
| `--glass-hover-bg` | `rgba(15,23,42,0.05)` | `rgba(255,255,255,0.1)` | `rgba(255,255,255,0.85)` | Glass hover film. | 16.14 / 12.61 / 17.30 |
| `--glass-selected-bg` | `rgba(124,58,237,0.12)` | `rgba(124,58,237,0.12)` | `rgba(124,58,237,0.12)` | Glass selected wash. | 14.93 / 14.85 / 13.11 |
| `--glass-selected-border` | `rgba(124,58,237,0.35)` | `rgba(124,58,237,0.35)` | `rgba(124,58,237,0.35)` | Glass selected ring. | 10.29 / 11.75 / 9.21 |

## 5. Text ladder

`--fg-strong` > `--fg` > `--fg-soft` > `--fg-muted` > `--fg-faint`. Interactive
labels use the first four; `--fg-faint` is non-interactive metadata and
`--fg-disabled` is the disabled state (both intentionally below the text floor).

| Token | Light | Dark | Frosted | Purpose | Measured contrast on `--bg-base` |
| --- | --- | --- | --- | --- | --- |
| `--fg-strong` | `#0f172a` | `#e7e9ec` | `#0e1830` | Headings, primary ink. | 17.85 / 16.01 / 15.55 |
| `--fg` | `#1e293b` | `#a8aeb6` | `#14203a` | Body ink. | 14.63 / 8.71 / 14.29 |
| `--fg-soft` | `#475569` | `#98a0aa` | `#192640` | Secondary body ink. | 7.58 / 7.36 / 13.31 |
| `--fg-muted` | `#556070` | `#828a97` | `#1f2a4a` | Muted metadata (interactive floor). | 6.38 / 5.59 / 12.45 |
| `--fg-faint` | `#94a3b8` | `#5b626b` | `#24325a` | Non-interactive placeholder ink. | 2.56 / 3.16 / 11.04 (metadata only) |
| `--fg-disabled` | `#b6bcc6` | `#505761` | `#b6bcc6` | Disabled ink. | 1.91 / 2.67 / 1.69 (disabled only) |
| `--fg-on-accent` | `#ffffff` | `#ffffff` | `#ffffff` | Ink on an accent fill. | on `--accent`: 5.70 (all themes) |
| `--fg-on-page` | `#0f172a` | `#0f172a` | `#0f172a` | Ink painted OVER the paper-white page (theme-independent, DEF-158/159). | on `#ffffff` page: 17.85 (all themes) |

## 6. Borders and dividers

Hairlines separate surfaces; they are non-text and never carry meaning alone.

| Token | Light | Dark | Frosted | Purpose | Measured contrast vs `--bg-base` |
| --- | --- | --- | --- | --- | --- |
| `--border` | `#e2e8f0` | `#242a31` | `rgba(15,23,42,0.12)` | Standard control / card hairline. | 1.23 / 1.34 / 1.05 |
| `--border-strong` | `#cbd5e1` | `#2e353d` | `rgba(15,23,42,0.18)` | Emphasised edge (focus-adjacent). | 1.48 / 1.57 / 1.46 |
| `--border-subtle` | `#eef2f6` | `#1e242b` | `rgba(15,23,42,0.06)` | Faint internal hairline. | 1.12 / 1.24 / 1.13 |
| `--divider` | `#e6eaef` | `#1c2228` | `rgba(15,23,42,0.06)` | Section divider. | 1.21 / 1.21 / 1.13 |

## 7. Semantic state

Status tokens only; they never claim a primary-action slot. Each pairs with a
`-soft` wash for a chip. As a solid swatch/border they are state accents; when
used as ink they ride their `-soft` chip with `--fg-strong`.

| Token | Light | Dark | Frosted | Purpose | Measured contrast vs `--bg-base` |
| --- | --- | --- | --- | --- | --- |
| `--info` | `#5b7bb5` | `#6e8fbf` | `#5b7bb5` | Informational state. | 4.25 / 5.88 / 3.75 |
| `--info-soft` | `rgba(91,123,181,0.12)` | `rgba(110,143,191,0.16)` | `rgba(91,123,181,0.12)` | Info chip wash. | chip tint |
| `--success` | `#76a66a` | `#76a66a` | `#76a66a` | Success state. | 2.83 / 6.89 / 2.49 |
| `--success-soft` | `rgba(118,166,106,0.12)` | `rgba(118,166,106,0.16)` | `rgba(118,166,106,0.12)` | Success chip wash. | chip tint |
| `--warning` | `#d9a441` | `#d9a441` | `#d9a441` | Caution state. | 2.25 / 8.66 / 1.99 |
| `--warning-soft` | `rgba(217,164,65,0.14)` | `rgba(217,164,65,0.18)` | `rgba(217,164,65,0.14)` | Warning chip wash. | chip tint |
| `--error` | `#d96c63` | `#d96c63` | `#d96c63` | Error / destructive state. | 3.35 / 5.82 / 2.95 |
| `--error-soft` | `rgba(217,108,99,0.12)` | `rgba(217,108,99,0.16)` | `rgba(217,108,99,0.12)` | Error chip wash. | chip tint |
## 8. Four-role palette

Four named roles assigned by tool CATEGORY, never per-tool whim. The icon shape
and the label carry the meaning; colour is never the only differentiator.

| Token | Light | Dark | Frosted | Purpose | Measured contrast on `--bg-raised` |
| --- | --- | --- | --- | --- | --- |
| `--sem-primary` | `#7C3AED` | `#A78BFA` | `#6D28D9` | PRIMARY: selection, active state, primary actions. | 5.70 / 6.78 / 7.04 |
| `--sem-neutral` | `#3d4c69` | `#9aa7bd` | `#3a4862` | NEUTRAL: the bulk of tools, navigation, editing. | 8.62 / 7.59 / 9.12 |
| `--sem-affirmative` | `#166534` | `#7fbd8f` | `#12682f` | AFFIRMATIVE: insert, add, sign, export, save. | 7.13 / 8.42 / 6.83 |
| `--sem-attention` | `#be123c` | `#e07a74` | `#9f1239` | ATTENTION: delete, clear, replace, flatten, close. | 6.29 / 6.33 / 7.95 |

## 9. Interaction and selection

Shared state tokens for non-button surfaces (rows, cards, tabs, menu rows, panel
headers, on-canvas overlays). Button variants stay Phase 91's and are NOT driven
by these directly.

| Token | Light | Dark | Frosted | Purpose | Measured contrast |
| --- | --- | --- | --- | --- | --- |
| `--select-fill` | `rgba(15,23,42,0.07)` | `rgba(255,255,255,0.09)` | `rgba(15,23,42,0.06)` | Neutral selected fill. | see `--select-glyph` |
| `--select-edge` | `rgba(124,58,237,0.45)` | `rgba(167,139,250,0.5)` | `rgba(109,40,217,0.55)` | Selected hairline / ring. | non-text edge |
| `--select-glyph` | `var(--sem-primary)` | `var(--sem-primary)` | `var(--sem-primary)` | Accent glyph on the fill. | on fill over `--panel-bg`: 4.51 / 5.36 / 6.05 |
| `--focus-ring` | `0 0 0 2px rgba(124,58,237,0.35)` | same | same | Keyboard focus ring. | non-text indicator |
| `--hit` | `rgba(124,58,237,0.28)` | `rgba(167,139,250,0.32)` | `rgba(124,58,237,0.28)` | Hit-target overlay at rest. | non-text indicator |
| `--hit-active` | `rgba(124,58,237,0.55)` | `rgba(167,139,250,0.6)` | `rgba(124,58,237,0.55)` | Hit-target overlay while active. | non-text indicator |

## 10. Elevation ladder

One depth scale for the whole app. Chrome / toolbar / rail are flat; every
elevated named surface consumes a ladder step, and the named `--shadow-*` tokens
re-point onto the ladder instead of carrying parallel literals.

| Depth | Surfaces | Token |
| --- | --- | --- |
| flat | chrome / toolbar / rail | none (`--panel-shadow: none`) |
| level 1 | panel / card / selected-group | `--elevation-1` |
| level 2 | popover / menu / flyout | `--elevation-2` |
| level 3 | dialog / sheet | `--elevation-3` |
| level 4 | toast / floating chip | `--elevation-4` |

Ladder values (light / dark / frosted):

| Token | Light | Dark | Frosted |
| --- | --- | --- | --- |
| `--elevation-1` | `0 4px 18px rgba(15,23,42,0.14)` | `0 4px 18px rgba(0,0,0,0.28)` | `0 2px 10px rgba(15,23,42,0.10), 0 10px 28px rgba(15,23,42,0.10)` |
| `--elevation-2` | `0 2px 8px rgba(15,23,42,0.10), 0 8px 24px rgba(15,23,42,0.12)` | `0 2px 8px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.55)` | `0 2px 8px rgba(15,23,42,0.10), 0 10px 26px rgba(15,23,42,0.12)` |
| `--elevation-3` | `0 4px 16px rgba(15,23,42,0.14), 0 12px 40px rgba(15,23,42,0.18)` | `0 4px 16px rgba(0,0,0,0.55), 0 12px 40px rgba(0,0,0,0.6)` | `0 4px 14px rgba(15,23,42,0.12), 0 14px 42px rgba(15,23,42,0.16)` |
| `--elevation-4` | `0 4px 12px rgba(15,23,42,0.14), 0 2px 4px rgba(15,23,42,0.08)` | `0 4px 12px rgba(0,0,0,0.6), 0 2px 4px rgba(0,0,0,0.4)` | `0 4px 12px rgba(15,23,42,0.12), 0 2px 4px rgba(15,23,42,0.06)` |

Named-surface mapping (pinned by `designSystem.test.ts`):

| Named shadow | Ladder step | Depth |
| --- | --- | --- |
| `--shadow-page` | `var(--elevation-1)` | level 1 |
| `--shadow-menu` | `var(--elevation-2)` | level 2 |
| `--shadow-popover` | `var(--elevation-2)` | level 2 |
| `--shadow-dialog` | `var(--elevation-3)` | level 3 |
| `--shadow-toast` | `var(--elevation-4)` | level 4 |

## 11. Empty-state pattern

Every surface that can be empty renders one designed empty state instead of bare
text. The pattern is fixed so chunk D implements it identically everywhere:

- a single `Icon` hero mark at `--tf-icon-size-hero` (32px) in a token-driven
  tint (`--fg-faint`, or `--sem-primary` where the surface is action-oriented);
- one headline line in `--fg-strong` at `--fs-lg`;
- one help line in `--fg-muted` at `--fs-sm`;
- centred on the token surface with level-1 elevation (`--elevation-1`) and the
  standard `--space-section` gap between mark, headline and help.

Copy is English, one short sentence per line, no emoji. Named surfaces: Welcome
recent files, Welcome samples, Inspector/ContextPanel no-selection, search
no-results, and the zero-page thumbnail rail. A single shared `EmptyState`
component is used where two or more surfaces share the pattern.

## 12. Contrast contract

Contrast is contract, not aspiration. Interactive text clears >= 4.5:1 and
icons/graphics clear >= 3:1 in light, dark AND frosted. The one documented
exemption is the decorative `aria-hidden` empty-state hero mark
(`.empty-state-mark`, tinted `--fg-faint`), which is exempt from the 3:1
graphic floor per WCAG 1.4.11 (the floor applies to graphics required to
understand content; this mark is decorative and carries no meaning). The
figures above are
computed from the shipped tokens (translucent surfaces composited over
`--bg-base`). The machine-checked oracles
`phase38LegibilityContrast.test.ts`, `phase40SemanticPalette.test.ts` and
`designTokensContract.test.ts` must stay green; `designSystem.test.ts` pins this
document to the token layer so it cannot drift.

## 13. Phase 96-B — chrome / navigation surface retune (applied)

Phase 96-B APPLIES the token layer to the chrome and navigation surfaces. It
moves VALUES only: every family name, the `--elevation-1..4` definitions and the
`--shadow-*` -> ladder mapping stay exactly as frozen in sections 2-10. The
surface values below SUPERSEDE the section 3 table (which recorded the
pre-application values); they are recorded here rather than rewritten in place so
the Phase-96-A families remain the single historical reference.

### 13.1 Surface ramp (L* in parentheses)

Light, lightest band to deepest:

| Band | Token | Value | L* |
| --- | --- | --- | --- |
| window base / raised | `--bg-base` / `--bg-raised` | `#ffffff` | 100.0 |
| elevated card | `--bg-elevated` | `#fcfdfe` | 99.3 |
| chrome bar (titlebar / toolbar / search) | `--bg-toolbar` | `#fafbfd` | 98.6 |
| document canvas | `--bg-canvas` (= `--tf-canvas-opaque`) | `#f1f5f9` | 96.3 |
| secondary panel | `--bg-secondary` | `#eef1f5` | 95.0 |
| docked panel body | `--bg-panel` | `#f1f4f8` | 96.1 |
| side rail / tools panel | `--bg-rail` (= `--panel-bg`) | `#e8ecf1` | 93.2 |

Adjacent bands step by ~1.4-3.1 L* (chrome bar -> canvas ~2.3, canvas -> rail
~3.1). The light canvas value is PINNED at `#f1f5f9` by the DEF-285
opaque-canvas contract (`--tf-canvas-opaque`), so the ramp is built around it:
the rail/panel is the deepest band, the chrome bar sits just under white.

Dark, deepest band to lightest:

| Band | Token | Value | L* |
| --- | --- | --- | --- |
| window base / canvas | `--bg-base` / `--bg-canvas` / `--tf-canvas-opaque` | `#0b0d0f` | 3.6 |
| chrome bar | `--bg-toolbar` | `#12161b` | 7.1 |
| raised | `--bg-raised` | `#13171d` | 7.6 |
| side rail / tools panel | `--bg-rail` (= `--panel-bg`) | `#161b21` | 9.5 |
| docked panel body | `--bg-panel` | `#181d24` | 10.6 |
| secondary panel | `--bg-secondary` | `#1a1f26` | 11.5 |
| elevated card | `--bg-elevated` | `#1d232b` | 13.5 |

Frosted (neutral white films over the `#eef1f5` base): the chrome bar drops to
`rgba(255,255,255,0.60)` (`--tf-surface-toolbar`), the rail / tools panel lift to
`rgba(255,255,255,0.74)` (`--glass-sidebar-bg`, consumed by `--tf-surface-rail`,
`--tf-surface-panel` and `--panel-bg`), the menu film is `rgba(255,255,255,0.88)`
and the dialog / elevated sheet is `rgba(255,255,255,0.94)`. The rail/panel
tokens keep resolving through `var(--glass-sidebar-bg)` (Phase-14 contract).

### 13.2 Hairlines

| Scope | `--border` | `--border-strong` | `--border-subtle` | `--divider` |
| --- | --- | --- | --- | --- |
| light | `#d7dee8` | `#c0cad8` | `#e4e9f0` | `#dde3ea` |
| dark | `#2a313a` | `#39424d` | `#222932` | `#232a33` |
| frosted | `rgba(15,23,42,0.14)` | `rgba(15,23,42,0.24)` | `rgba(15,23,42,0.08)` | `rgba(15,23,42,0.10)` |

Each hairline is one deliberate step stronger than the surface it borders so the
1px separator is visible in every theme.

### 13.3 Elevation application

- `.command-palette` consumes `--shadow-popover` (level 2).
- `.titlebar-menu-popover` consumes `--shadow-popover`; the frosted menu-family
  override (titlebar popover / theme popover / ann tool menu / color popover) now
  consumes `--shadow-popover` instead of its literal drop shadow.
- `.text-props-panel` consumes `--shadow-popover` (level 2).
- Docked chrome stays FLAT: `.side-rail` / `.tools-palette` keep
  `--panel-shadow: none` (the Phase-14 docked-panel contract pins
  `box-shadow: var(--panel-shadow)` on the palette), and `.app-header` /
  `.titlebar` / `.toolbar` / `.search-bar` carry no elevation shadow.

### 13.4 Interaction states

`.command-palette-row` gained explicit hover (`--bg-hover`) and press
(`--bg-active`) films, distinct from the active row's `--accent-selected` and the
disabled row's `--fg-disabled`. Tabs keep the Phase-51 full-strength hue system;
rail buttons, menu rows and header controls continue to resolve hover / press /
selected / focus / disabled from the Phase-91 button variants, which already
consume `--bg-hover`, `--bg-active`, `--accent-selected`, `--focus-ring` and
`--fg-disabled`.

### 13.5 Contrast after the retune

The retune keeps every oracle green. Binding measurements: light
`--sem-primary` on `--bg-rail` / `--panel-bg` 4.80:1; light `--select-glyph` on
`--select-fill` over `--panel-bg` 4.53:1 (the light `--select-fill` was eased
`0.07 -> 0.03` so the glyph holds the 4.5:1 floor on the deeper rail); DEF-340
dock-primary on the accent-soft wash 5.84 / 5.34 / 5.90 (light / dark / frosted);
DEF-355 pressed Open 5.09 / 5.71 / 5.02.

## 14. Phase 96-C — panel / dock / overlay surface retune (applied)

Phase 96-C APPLIES the token layer to the docked panels and the floating canvas
overlays. It moves no family value and does NOT touch the `--elevation-1..4`
definitions or the `--shadow-*` -> ladder mapping; only which token each named
surface consumes. Dock GEOMETRY stays Phase 95's.

### 14.1 Panels (docked, flat)

- `.context-panel`, `.inspector` and `.tools-palette` keep the shared
  `--panel-bg` / `--panel-border` / `--panel-radius` surface and stay FLAT:
  docked panels resolve `box-shadow: var(--panel-shadow)`, which is `none`, and
  the Inspector pins `box-shadow: none`. No docked panel gains elevation.
- Panel headers (`.glass-sidebar-header`, shared by rail, palette, Inspector and
  ContextPanel) carry a visible 1px `--border` bottom hairline in every theme;
  the frosted override re-points its border colour to the same `--border` step.
- Section dividers consume `--divider`: `.context-panel-section`,
  `.review-elements-category` and `.context-panel-outline`, plus the inner
  `.context-panel-section > * + *` and `.inspector-section-body > * + *` rules.

### 14.2 Docks / overlays (floating = level 2, docked = flat)

- `.action-dock`, `.action-dock-edit:not(.btn)`, `.canvas-pill`,
  `.canvas-page-layout` and `.annotation-flyout` consume `--elevation-2`
  directly (the level-2 popover / menu / flyout band) and keep the
  `--bg-elevated` surface plus the `--glass-border` hairline.
- Docked / anchored chrome stays flat: the panels, rail and toolbar carry no
  elevation shadow.

### 14.3 Interaction states (non-button surfaces)

Hover `--bg-hover`; press `--bg-active`; selection the Phase-41 trio
`--select-fill` / `--select-edge` / `--select-glyph`; keyboard focus
`--focus-ring`; disabled ink `--fg-disabled`. Applied to `.inspector-menu-item`,
`.context-panel-item` (the selected state uses the trio), `.context-panel-select`,
`.review-elements-row-select`, `.review-elements-row-edit` / `-delete` and
`.thumb-verb`. Button variants (dock verbs, palette entries, flyout arrows,
toggles) stay Phase 91's and continue to resolve these tokens through the
canonical `.btn-*` variants.

## 15. Phase 96-D — home/viewer retune + designed empty states (applied)

Phase 96-D APPLIES the section 11 empty-state pattern through ONE shared
component, `src/renderer/components/EmptyState.tsx`, and retunes the home /
viewer chrome onto the section 2-10 tokens. It moves no family value and does
NOT touch the `--elevation-1..4` definitions or the `--shadow-*` -> ladder
mapping.

### 15.1 The `EmptyState` contract

```ts
interface EmptyStateProps {
  icon?: LucideIcon;   // rendered through the Phase-94 Icon wrapper at size "hero"
  headline: string;    // one line, --fg-strong
  help?: string;       // one line, --fg-muted
  className?: string;  // appended to the root's `empty-state`
  [dataAttr: `data-${string}`]: unknown; // forwarded to the root unchanged
}
```

The root is `<div class="empty-state [className]">`. `.empty-state` is the
centred column (`gap: var(--sp-3)`, `padding: var(--sp-5) var(--sp-4)`,
`border-radius: var(--radius-group)`); `.empty-state-mark` tints from
`--fg-faint`; `.empty-state-headline` is `--fs-lg` / `--fg-strong`;
`.empty-state-help` wraps at `36ch` in `--fs-sm` / `--fg-muted`. A card-surface
empty rides the level-1 step (`.samples-empty.empty-state` uses
`--elevation-1`).

### 15.2 Applied surfaces (class + `data-*` hooks preserved)

- Welcome recent files — `.recent-empty` (the class stays on the EmptyState root).
- Welcome samples empty branch — `.samples-empty` + `--elevation-1`; the
  `.samples-empty` loading branch is unchanged.
- Command palette no-results — `.command-palette-empty` +
  `data-command-palette-empty`.
- ContextPanel edit content — `.context-panel-empty` + `data-edit-content-empty`.
- Thumbnail rail zero pages — `data-context-panel-thumbs-empty` inside
  `.context-panel-thumbs`.
- Inspector no-selection / no document — `data-inspector-empty` (rendered only
  when nothing is selected and no document is open; the document facts are
  unchanged otherwise).

### 15.3 Home / viewer retune

`Welcome.tsx` surfaces (`.welcome-*`, `.home-*`, `.recent-*`, `.sample-*`,
`.doc-*`) and the thumbnail-rail / page-navigator chrome resolve their
colour/state from tokens: the recent-row whisper hover consumes `--bg-hover`
(was a per-theme literal), the thumb focus outline consumes `--tf-accent-focus`,
and the thumb drop-line glow consumes `--select-edge`. No layout or geometry
moved.

### 15.4 Hero-mark override and the unreachable-state carve-out (DEF-528)

The EmptyState hero mark must render at `--tf-icon-size-hero` (32px) on every
applied surface. The Phase-94 surface svg-size group (`.command-palette svg`,
`.context-panel svg`, ...) pins normal chrome glyphs to `--tf-icon-size` (18px);
because it also pins `min-width`/`min-height`, it beat the `Icon size="hero"`
presentation attribute and shrank the mark inside `.command-palette-empty` and
`.context-panel-empty` to 17-18px. The Phase-94 `Icon` wrapper renders lucide's
SVG root directly and forwards `className` to it, so `.empty-state-mark` **is**
the `<svg>` element. The higher-specificity rule `.empty-state .empty-state-mark`
(two classes, 0-2-0) sets all four of `width` / `height` / `min-width` /
`min-height` to `var(--tf-icon-size-hero)`, winning by cascade over the one-class
surface selectors (0-1-1) without weakening the 18px floor for normal icons. The
pairing is pinned by `designSystem.test.ts`, which mounts the real `EmptyState`
and asserts the hero selector matches the rendered `<svg class="empty-state-mark">`
root (and that the retired descendant-`svg` selector matches nothing), then reads
`styles.css` to assert the rule exists, consumes the hero token on all four
dimensions, and outranks the chrome surface selectors.

Two empty states are **defensive/unreachable in shipped flows** and are an
explicit carve-out from the "reachable surface" oracle: the zero-page
thumbnail-rail state (`data-context-panel-thumbs-empty`) and the no-document
Inspector state (`data-inspector-empty`). No shipped flow can produce a 0-page
document, and the app always has a document open or shows the Welcome screen, so
neither state is user-reachable. They remain covered by the `EmptyState` unit
contract in `test/unit/renderer/emptyState.test.tsx`; they are not part of the
reachable-surface rendering oracle.


