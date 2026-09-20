import type {
  EditColor,
  EditFont,
  TextAlign,
  TextBoxStylePatch,
  TextListStyle,
  TextStyleFields,
} from '../../shared/types';

/** Phase 21 — text style defaults and validation bounds. Mirrors the
 *  Phase-18 watermark contract: an ABSENT field gets its default (applied at
 *  draw time); a PRESENT-but-invalid field rejects the whole payload. */

export const DEFAULT_TEXT_LINE_HEIGHT = 1.2;
export const MIN_TEXT_LINE_HEIGHT = 0.5;
export const MAX_TEXT_LINE_HEIGHT = 5;

/** Phase 21 — baseline shift bounds (points). Positive = superscript,
 *  negative = subscript. */
export const MIN_TEXT_BASELINE_SHIFT = -200;
export const MAX_TEXT_BASELINE_SHIFT = 200;

export const MIN_TEXT_SIZE = 1;
export const MAX_TEXT_SIZE = 2000;

/** Phase 21 — paragraph left-inset bounds (points). */
export const MIN_TEXT_INDENT = 0;
export const MAX_TEXT_INDENT = 200;

/** Phase 27 — character-spacing (tracking) bounds, in points added between
 *  glyphs. Positive loosens, negative tightens; 0 = no extra tracking (the
 *  `Tc` operator is not emitted). */
export const MIN_TEXT_CHAR_SPACING = -5;
export const MAX_TEXT_CHAR_SPACING = 20;

export const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right', 'justify'];
export const TEXT_LIST_STYLES: readonly TextListStyle[] = ['none', 'bullet', 'number'];

/** Phase 21 — the three pdf-lib StandardFont families. Phase 27 keeps them
 *  working exactly as before (WinAnsiEncoding, no embedding). */
export const STANDARD_EDIT_FONTS = ['Helvetica', 'Times', 'Courier'] as const;

/** Phase 27 — the OFL families bundled under `assets/fonts/` and embedded as
 *  subsets on demand (see `fonts.ts` for the file map and licence texts). */
export const BUNDLED_EDIT_FONTS = [
  'Liberation Sans',
  'DejaVu Serif',
  'DejaVu Sans Mono',
] as const;

export type BundledEditFont = (typeof BUNDLED_EDIT_FONTS)[number];

/** Phase 27 — the full EditFont allowlist (standard + bundled). A font outside
 *  this list cannot be represented, so it is rejected loudly. */
export const EDIT_FONTS: readonly EditFont[] = [...STANDARD_EDIT_FONTS, ...BUNDLED_EDIT_FONTS];

/** True when `v` is a member of the EditFont allowlist. */
export function isEditFont(v: unknown): v is EditFont {
  return typeof v === 'string' && (EDIT_FONTS as readonly string[]).includes(v);
}

/** True when `v` is a bundled (embedded) family rather than a StandardFont. */
export function isBundledEditFont(v: unknown): v is BundledEditFont {
  return typeof v === 'string' && (BUNDLED_EDIT_FONTS as readonly string[]).includes(v);
}

export type TextStyleValidation =
  | { ok: true; value: TextStyleFields }
  | { ok: false; reason: string };

/** Validate the nine Phase-21 style fields on any text payload. Returns the
 *  supplied (valid) subset; unknown extra keys are ignored. */
export function validateTextStyleFields(raw: unknown): TextStyleValidation {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'text style fields must be an object' };
  }
  const r = raw as Record<string, unknown>;
  const out: TextStyleFields = {};
  if (r.align !== undefined) {
    if (typeof r.align !== 'string' || !(TEXT_ALIGNS as readonly string[]).includes(r.align)) {
      return { ok: false, reason: `unsupported align ${JSON.stringify(r.align)}` };
    }
    out.align = r.align as TextAlign;
  }
  if (r.lineHeight !== undefined) {
    if (
      typeof r.lineHeight !== 'number' || !Number.isFinite(r.lineHeight) ||
      r.lineHeight < MIN_TEXT_LINE_HEIGHT || r.lineHeight > MAX_TEXT_LINE_HEIGHT
    ) {
      return { ok: false, reason: `lineHeight must be a finite number in ${MIN_TEXT_LINE_HEIGHT}..${MAX_TEXT_LINE_HEIGHT}` };
    }
    out.lineHeight = r.lineHeight;
  }
  for (const key of ['bold', 'italic', 'underline'] as const) {
    if (r[key] !== undefined) {
      if (typeof r[key] !== 'boolean') return { ok: false, reason: `${key} must be a boolean` };
      out[key] = r[key] as boolean;
    }
  }
  if (r.baselineShift !== undefined) {
    if (
      typeof r.baselineShift !== 'number' || !Number.isFinite(r.baselineShift) ||
      r.baselineShift < MIN_TEXT_BASELINE_SHIFT || r.baselineShift > MAX_TEXT_BASELINE_SHIFT
    ) {
      return { ok: false, reason: `baselineShift must be a finite number in ${MIN_TEXT_BASELINE_SHIFT}..${MAX_TEXT_BASELINE_SHIFT}` };
    }
    out.baselineShift = r.baselineShift;
  }
  if (r.highlight !== undefined) {
    const c = unitColor(r.highlight);
    if (c === null) return { ok: false, reason: 'highlight must be an {r,g,b} object with components in 0..1' };
    out.highlight = c;
  }
  if (r.list !== undefined) {
    if (typeof r.list !== 'string' || !(TEXT_LIST_STYLES as readonly string[]).includes(r.list)) {
      return { ok: false, reason: `unsupported list style ${JSON.stringify(r.list)}` };
    }
    out.list = r.list as TextListStyle;
  }
  if (r.indent !== undefined) {
    if (
      typeof r.indent !== 'number' || !Number.isFinite(r.indent) ||
      r.indent < MIN_TEXT_INDENT || r.indent > MAX_TEXT_INDENT
    ) {
      return { ok: false, reason: `indent must be a finite number in ${MIN_TEXT_INDENT}..${MAX_TEXT_INDENT}` };
    }
    out.indent = r.indent;
  }
  if (r.charSpacing !== undefined) {
    if (
      typeof r.charSpacing !== 'number' || !Number.isFinite(r.charSpacing) ||
      r.charSpacing < MIN_TEXT_CHAR_SPACING || r.charSpacing > MAX_TEXT_CHAR_SPACING
    ) {
      return { ok: false, reason: `charSpacing must be a finite number in ${MIN_TEXT_CHAR_SPACING}..${MAX_TEXT_CHAR_SPACING}` };
    }
    out.charSpacing = r.charSpacing;
  }
  return { ok: true, value: out };
}

export type TextBoxPatchValidation =
  | { ok: true; value: TextBoxStylePatch }
  | { ok: false; reason: string };

/** The keys a `TextBoxStylePatch` may carry (mirrors the `TextBoxStylePatch`
 *  shape: the nine style fields including `highlight`, plus the five text/
 *  font/size/color/background fields). Used to fail loudly on a patch whose
 *  supplied keys are ALL unknown — a caller error, never a silent no-op. */
export const TEXT_BOX_PATCH_KEYS: readonly string[] = [
  'text',
  'font',
  'size',
  'color',
  'background',
  'highlight',
  'align',
  'lineHeight',
  'bold',
  'italic',
  'underline',
  'baselineShift',
  'list',
  'indent',
  'charSpacing',
];

/** Validate a full `updateTextBox` patch: the nine style fields plus
 *  `text`/`font`/`size`/`color`/`background`. Any supplied-but-invalid field
 *  rejects the whole patch (the caller maps this to a typed engine-error).
 *
 *  DEF-242 — supplied-key rule (consistent with the existing reject-if-invalid
 *  philosophy, and the way every other text payload ignores unknown extras):
 *    - no supplied keys (an empty object, or only keys whose value is
 *      `undefined`) validates to `{}` — the caller treats that as a no-op;
 *    - if EVERY supplied key is unknown (e.g. `{evil: 1}`) the patch is a
 *      caller error and fails loudly, naming the unknown key(s);
 *    - if at least one supplied key is known, unknown keys MIXED with it are
 *      ignored (the known fields apply, exactly as today).
 *
 *  Phase 21 follow-up — `highlight: null` is an explicit REMOVAL on this
 *  patch path only. The shared `validateTextStyleFields` rejects `null`
 *  (the add/edit payloads keep `EditColor`), so strip it before that call
 *  and carry the removal through as `null`; it is never coerced to a colour.
 *  An ABSENT `highlight` still preserves the box's current band. */
export function validateTextBoxStylePatch(raw: unknown): TextBoxPatchValidation {
  const rawObj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (rawObj !== null) {
    const supplied = Object.keys(rawObj).filter((k) => rawObj[k] !== undefined);
    const unknown = supplied.filter((k) => !TEXT_BOX_PATCH_KEYS.includes(k));
    if (supplied.length > 0 && unknown.length === supplied.length) {
      return {
        ok: false,
        reason: `unknown field(s): ${unknown.map((k) => JSON.stringify(k)).join(', ')}`,
      };
    }
  }
  const removesHighlight = rawObj !== null && rawObj.highlight === null;
  const style = validateTextStyleFields(
    removesHighlight && rawObj !== null ? { ...rawObj, highlight: undefined } : raw,
  );
  if (!style.ok) return style;
  const r = raw as Record<string, unknown>;
  const out: TextBoxStylePatch = { ...style.value };
  if (removesHighlight) out.highlight = null;
  if (r.text !== undefined) {
    if (typeof r.text !== 'string') return { ok: false, reason: 'text must be a string' };
    out.text = r.text;
  }
  if (r.font !== undefined) {
    if (!isEditFont(r.font)) {
      return { ok: false, reason: `unsupported font ${JSON.stringify(r.font)}; supported families are ${EDIT_FONTS.join(', ')}` };
    }
    out.font = r.font;
  }
  if (r.size !== undefined) {
    if (
      typeof r.size !== 'number' || !Number.isFinite(r.size) ||
      r.size < MIN_TEXT_SIZE || r.size > MAX_TEXT_SIZE
    ) {
      return { ok: false, reason: `size must be a finite number in ${MIN_TEXT_SIZE}..${MAX_TEXT_SIZE}` };
    }
    out.size = r.size;
  }
  if (r.color !== undefined) {
    const c = unitColor(r.color);
    if (c === null) return { ok: false, reason: 'color must be an {r,g,b} object with components in 0..1' };
    out.color = c;
  }
  if (r.background !== undefined) {
    if (r.background !== 'white' && r.background !== 'none') {
      return { ok: false, reason: `background must be 'white' or 'none'` };
    }
    out.background = r.background;
  }
  return { ok: true, value: out };
}

/** Parse an {r,g,b} object with finite components in [0,1]; null when invalid. */
function unitColor(v: unknown): EditColor | null {
  if (v === null || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const inUnit = (x: unknown): number | null =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1 ? x : null;
  const r = inUnit(c.r);
  const g = inUnit(c.g);
  const b = inUnit(c.b);
  if (r === null || g === null || b === null) return null;
  return { r, g, b };
}
