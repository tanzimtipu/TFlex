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

export type AnnotationTheme = 'light' | 'dark';

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