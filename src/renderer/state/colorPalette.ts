// Phase 6 — annotation color palette state.
//
// The renderer's annotation tool reducer (see annotations/model.ts) still owns
// the *active* color and tool — the toolbar reads from it. This module owns
// the custom color preset list, one bucket per theme, plus the picker UI
// state. Custom presets live inside `AppSettings.annotationColors` (see
// `shared/types.ts`) so they survive a restart like every other preference.
//
// Why per-theme? The user picks a dark-mode highlight color in the docs and
// the same hex reads very differently against a light page — keeping separate
// buckets lets the picker offer one palette when dark and a different one when
// light. The Picker reads the active theme from the existing
// `applyTheme()` / `document.documentElement.dataset.theme` so the right
// bucket is always visible without an extra prop thread.
//
// The reducer is intentionally tiny: append, remove, replace. Picker UI state
// (open/closed, last-picked preset id) lives in the palette component, not in
// this module, because it doesn't need to round-trip through settings.json.

import type { AppSettings, AnnotationColors as SharedAnnotationColors } from '../../shared/types';

export type AnnotationTheme = 'light' | 'dark';

/** Per-bucket contents: always store as `AnnotationColorPreset[]` on the
 *  renderer. The backend normalises to `string[]` on persist, but the
 *  renderer never has to read its own normalised shape back — every
 *  write through `applyAnnotationPaletteChange` keeps the preset shape
 *  so decrement / remove-by-id keeps working across settings reloads.
 *  Both legacy `string[]` buckets (from a stale echo or an old
 *  settings.json) are accepted on read; the normaliser converts them
 *  to preset shape on the way through. */
type Bucket = AnnotationColorPreset[];

/** Coerce any bucket shape (preset array, legacy string array, or
 *  missing) into a `AnnotationColorPreset[]` with stable, content-
 *  unique ids. Idempotent: a preset-shape bucket passes through with
 *  its existing ids preserved. String entries become `{ id: 'legacy-<hex>',
 *  hex }` — the same legacy-id pattern the App.tsx projection uses
 *  for the picker view, so picker-side id tracking remains consistent
 *  across reads and writes.
 *
 *  Always returns a NEW array reference even when the input is
 *  already a preset array, so the caller can detect a fresh bucket
 *  by reference. Important for the per-bucket isolation invariant:
 *  the caller merges `light` and `dark` from independent calls, so
 *  even if both inputs are the SAME reference (a buggy caller
 *  aliased them), normalising into fresh arrays breaks the alias. */
function normalizeBucket(
  bucket: SharedAnnotationColors['light'],
): Bucket {
  if (bucket === undefined || bucket === null) return [];
  const out: Bucket = [];
  const seen = new Set<string>();
  for (const entry of bucket) {
    if (typeof entry === 'string') {
      if (entry.length === 0) continue;
      const key = entry.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: `legacy-${key}`, hex: key });
      continue;
    }
    const hex = entry.hex;
    if (hex.length === 0) continue;
    const key = hex.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: entry.id, hex: key });
  }
  return out;
}

/** Pure helper that produces the next AppSettings after a palette change.
 *  Lives next to `reducer` so App.tsx can call it from inside the
 *  `setSettings(prev => ...)` updater with React's latest pending state
 *  (instead of a render-scope `settings` capture that may be stale — see
 *  DEF-037). Returns the input settings unchanged when the new palette is
 *  content-equal to the existing one, so callers can short-circuit
 *  the downstream immediate `trackAndSave` write.
 *
 *  Four guarantees matter here (the fourth is the new one — DEF-037
 *  was reopened because the previous implementation only satisfied
 *  the first three):
 *
 *    1. **Idempotency guard.** When the incoming `next` palette is
 *       content-equal to the current palette (in either preset or
 *       string shape — the backend normalises to hex strings on
 *       persist, the renderer writes preset objects), the input
 *       settings object is returned unchanged. The previous
 *       reference-equality check was always false (the picker prop
 *       is a freshly-mapped array on every render), so the guard was
 *       dead code — replaced with a canonical hex comparison.
 *
 *    2. **Theme preservation.** The caller always passes React's
 *       latest `prev` (via `setSettings(prev => ...)`), so the
 *       returned settings keep whatever theme the user is currently
 *       looking at. The reducer does not touch `theme`.
 *
 *    3. **Per-bucket merge.** The incoming `next` may only carry the
 *       active-theme bucket — the inactive bucket comes from the
 *       picker's view of `presets`, which is a freshly-mapped view of
 *       `settings.annotationColors`. If a stale `settings.changed`
 *       echo arrived between the user's last click and this call
 *       (and was applied by the echo handler's `setSettings(s)`),
 *       `settings.annotationColors` may carry a partial palette
 *       (e.g., one bucket stripped). The merge replaces each bucket
 *       with `next[bucket]` if present, else `current[bucket]`, else
 *       `[]`. The fallback to `current` is the defensive path that
 *       prevents an inactive-bucket wipe when `next` is partial.
 *
 *    4. **Strict per-theme bucket isolation (DEF-043 / DEF-037
 *       reopen — in-session leakage).** Each bucket in the result is
 *       always a FRESH `AnnotationColorPreset[]` produced by
 *       `normalizeBucket` — never the same reference as the input
 *       bucket, never aliased between light and dark. The normaliser
 *       (a) de-aliases inputs by returning new arrays, (b) coerces
 *       legacy `string[]` shapes to preset shape so the persist
 *       carries the canonical form, and (c) deduplicates by lower-case
 *       hex within each bucket so an upstream cross-contamination
 *       (e.g. a stale echo carrying light content under the `dark`
 *       key) cannot grow a bucket past its expected size. The
 *       picker's per-theme read in `ColorPalette` (`presets[theme]`)
 *       is now provably key-locked — a light-bucket write cannot
 *       appear in the dark bucket, and vice versa. */
export function applyAnnotationPaletteChange(
  settings: AppSettings,
  next: SharedAnnotationColors,
): AppSettings {
  const current = settings.annotationColors;
  // Build canonical hex sets for the idempotency guard BEFORE
  // normalisation. The guard compares content, not shape — both
  // preset and string shapes are accepted.
  const nextLightHexes = bucketHexes(next.light);
  const nextDarkHexes = bucketHexes(next.dark);
  const currentLightHexes = current !== undefined ? bucketHexes(current.light) : null;
  const currentDarkHexes = current !== undefined ? bucketHexes(current.dark) : null;
  if (
    nextLightHexes === currentLightHexes
    && nextDarkHexes === currentDarkHexes
  ) {
    return settings;
  }
  // Per-bucket merge. Each bucket in the result prefers `next` (the
  // caller's intent), falls back to `current` (the existing state)
  // when `next` did not provide the bucket at all, and finally to an
  // empty array. The fallback to `current` is the defensive path that
  // prevents an inactive-bucket wipe when `next` is partial — see
  // the comment above. `next` carrying an empty array (`[]`) is
  // treated as an INTENTIONAL clear (the caller wanted to empty the
  // bucket), so we respect it; `next` carrying `undefined` (the key
  // was absent or stripped by the caller) is the partial case where
  // we fall back to `current` to avoid wiping preserved content.
  const mergedLightRaw = next.light !== undefined
    ? next.light
    : (current?.light ?? []);
  const mergedDarkRaw = next.dark !== undefined
    ? next.dark
    : (current?.dark ?? []);
  // Per-bucket isolation: normalise each bucket into a fresh,
  // canonical preset array. The normaliser dedupes by lower-case hex
  // so even if `next.dark` accidentally carried `next.light`'s
  // content, the dark bucket cannot grow with light content (the
  // light bucket is the source of truth for the active theme). For
  // a pure inactive-bucket preservation path (`next.dark === undefined`),
  // the merge falls back to `current.dark` and the normaliser turns
  // that into a fresh preset array.
  const mergedLight = normalizeBucket(mergedLightRaw);
  const mergedDark = normalizeBucket(mergedDarkRaw);
  return {
    ...settings,
    annotationColors: {
      light: mergedLight,
      dark: mergedDark,
    },
  };
}

/** Canonical hex-set representation of one bucket, sorted ascending.
 *  Treats both `AnnotationColorPreset[]` (renderer writes) and
 *  `string[]` (backend echoes after normalisation) as the same
 *  shape. Returns null when the bucket itself is null/undefined so
 *  the caller can distinguish "absent" from "empty array". Empty
 *  arrays canonicalise to the empty string `""`. */
function bucketHexes(
  bucket: ReadonlyArray<{ readonly hex: string } | string> | undefined | null,
): string | null {
  if (bucket === undefined || bucket === null) return null;
  const hexes: string[] = [];
  for (const entry of bucket) {
    if (typeof entry === 'string') {
      if (entry.length > 0) hexes.push(entry);
    } else if (entry.hex.length > 0) {
      hexes.push(entry.hex);
    }
  }
  hexes.sort();
  return hexes.join(',');
}

/** A custom preset the user added through the full-color picker. */
export interface AnnotationColorPreset {
  id: string;
  hex: string;
}

/** Per-theme custom preset list. The keys are the two themes we ship. */
export type AnnotationColors = {
  light: AnnotationColorPreset[];
  dark: AnnotationColorPreset[];
};

export const EMPTY_ANNOTATION_COLORS: AnnotationColors = {
  light: [],
  dark: [],
};

export interface ColorPaletteAction {
  type: 'add' | 'remove' | 'replace';
  theme: AnnotationTheme;
  hex?: string;
  id?: string;
  presets?: AnnotationColorPreset[];
}

/** Stable id for a preset. Uses crypto.randomUUID when available so the
 *  same preset survives a settings.json round-trip; falls back to a
 *  timestamp-based id in environments where crypto isn't loaded (tests). */
export function makePresetId(hex: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${hex}-${Date.now().toString(36)}`;
}

// Phase 7 — picker math.
//
// The visible color picker is a saturation/value pad + a hue slider
// (standard tool palette). The user drags / clicks on the pad and the
// slider; the pad's local (x, y) translates into (saturation, value)
// at the current hue, the slider's local (x) translates into the new
// hue. All helpers below are pure — same input always returns the
// same hex — so the picker stays testable in jsdom without a canvas.

/** HSL in degrees / 0..1 / 0..1. The picker stores its current selection
 *  in this shape; on Add we convert to the project-wide lowercase hex. */
export interface Hsl {
  /** Hue in degrees, 0..360. */
  h: number;
  /** Saturation, 0..1. */
  s: number;
  /** Value (lightness in HSV terms), 0..1. */
  v: number;
}

/** Parse a `#rrggbb` (or `#rgb`) hex into HSL. Returns null on garbage —
 *  the existing `normalizeHex` validates first, so this branch mostly
 *  exists for tests. */
export function hexToHsl(hex: string): Hsl | null {
  if (!/^#[0-9a-f]{6}$/.test(hex)) {
    if (!/^#[0-9a-f]{3}$/.test(hex)) return null;
    const r = parseInt(hex[1] + hex[1], 16);
    const g = parseInt(hex[2] + hex[2], 16);
    const b = parseInt(hex[3] + hex[3], 16);
    return rgbToHsl(r, g, b);
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return rgbToHsl(r, g, b);
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

/** HSL → lowercase `#rrggbb`. Saturates / desaturates values into the
 *  standard ranges so callers don't have to clamp beforehand. */
export function hslToHex({ h, s, v }: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = s < 0 ? 0 : s > 1 ? 1 : s;
  const val = v < 0 ? 0 : v > 1 ? 1 : v;
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) { r = c; g = x; b = 0; }
  else if (hue < 120) { r = x; g = c; b = 0; }
  else if (hue < 180) { r = 0; g = c; b = x; }
  else if (hue < 240) { r = 0; g = x; b = c; }
  else if (hue < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return `#${byteToHex(Math.round((r + m) * 255))}${byteToHex(Math.round((g + m) * 255))}${byteToHex(Math.round((b + m) * 255))}`;
}

/** Map a click / drag position inside the pad's content box to
 *  saturation / value. `x` and `y` are CSS pixels relative to the pad
 *  element; `width` and `height` are the pad's clientWidth /
 *  clientHeight. The returned saturation rises with x (left = 0,
 *  right = 1) and value FALLS with y (top = 1, bottom = 0) — that's
 *  how Photoshop, GIMP, Figma, and every other tool palette orient
 *  the pad. The hue is taken from the slider, not the pad. */
export function pickFromPad(
  x: number,
  y: number,
  width: number,
  height: number,
): { s: number; v: number } {
  if (width <= 0 || height <= 0) return { s: 0, v: 1 };
  const sx = x < 0 ? 0 : x > width ? width : x;
  const sy = y < 0 ? 0 : y > height ? height : y;
  return {
    s: sx / width,
    v: 1 - sy / height,
  };
}

/** Map a click / drag position on the hue strip to a hue in degrees.
 *  `x` is CSS pixels relative to the slider element, `width` is its
 *  clientWidth. The slider is left-to-right (0..360); values are
 *  wrapped so dragging past either edge is fine. */
export function pickFromHueSlider(
  x: number,
  width: number,
): number {
  if (width <= 0) return 0;
  const sx = x < 0 ? 0 : x > width ? width : x;
  return (sx / width) * 360;
}

/** Pure helper: build the full HSL pick (saturation + value at the
 *  current hue) from a pad-pointer event. Kept separate from
 *  `pickFromPad` so a future pad variant (e.g. a square with edges
 *  clipped to the visible content box) can swap implementations
 *  without changing the call site. */
export function pickAtPad(
  x: number,
  y: number,
  width: number,
  height: number,
): Hsl {
  const { s, v } = pickFromPad(x, y, width, height);
  return { h: 0, s, v };
}

/** Validate a hex color string. Accepts #rgb, #rrggbb, and the bare forms
 *  rgb / rrggbb (the latter is normalised to #-prefixed on the way out of
 *  the picker). Rejects everything else — the picker shouldn't let the user
 *  drop garbage into the preset list. */
export function normalizeHex(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return null;
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v);
  if (m === null) return null;
  const raw = m[1];
  if (raw === undefined) return null;
  if (raw.length === 3) {
    const r = raw[0];
    const g = raw[1];
    const b = raw[2];
    if (r === undefined || g === undefined || b === undefined) return null;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return `#${raw}`.toLowerCase();
}

/** Parse "rgb(r, g, b)" or "rgba(r, g, b, a)" into a normalised hex string.
 *  Returns null on malformed input. Accepts signed bytes too (the
 *  clamp helper bounds them into 0..255; the regex just needs to
 *  capture them). */
export function parseRgb(value: string): string | null {
  const m = /^rgba?\(\s*(-?[0-9]{1,3})\s*,\s*(-?[0-9]{1,3})\s*,\s*(-?[0-9]{1,3})(?:\s*,\s*(-?[0-9.]+)\s*)?\)$/i.exec(
    value.trim(),
  );
  if (m === null) return null;
  const r = clampByte(Number(m[1]));
  const g = clampByte(Number(m[2]));
  const b = clampByte(Number(m[3]));
  return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
}

function byteToHex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/** Idempotent: applying an already-present preset leaves the list
 *  unchanged. The picker uses this so clicking the currently-active
 *  swatch doesn't duplicate it. */
export function reducer(
  state: AnnotationColors,
  action: ColorPaletteAction,
): AnnotationColors {
  const bucket = state[action.theme];
  switch (action.type) {
    case 'add': {
      if (action.hex === undefined) return state;
      const hex = normalizeHex(action.hex);
      if (hex === null) return state;
      if (bucket.some((p) => p.hex === hex)) return state;
      const preset: AnnotationColorPreset = { id: makePresetId(hex), hex };
      return {
        ...state,
        [action.theme]: [...bucket, preset],
      };
    }
    case 'remove': {
      if (action.id === undefined) return state;
      const next = bucket.filter((p) => p.id !== action.id);
      if (next.length === bucket.length) return state;
      return { ...state, [action.theme]: next };
    }
    case 'replace': {
      if (action.presets === undefined) return state;
      // Idempotent: if the incoming list is structurally equal to
      // the existing one, return the same reference so callers can
      // use referential equality to skip downstream re-renders.
      const incoming = [...action.presets];
      const existing = bucket;
      if (incoming.length === existing.length) {
        let same = true;
        for (let i = 0; i < incoming.length; i += 1) {
          const a = incoming[i];
          const b = existing[i];
          if (a === undefined || b === undefined) { same = false; break; }
          if (a.id !== b.id || a.hex !== b.hex) { same = false; break; }
        }
        if (same) return state;
      }
      return { ...state, [action.theme]: incoming };
    }
  }
}