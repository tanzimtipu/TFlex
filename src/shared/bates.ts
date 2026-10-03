// Phase 89 (FEA-033) — pure Bates-numbering label / series / validation model.
//
// No fs, no Electron, no DOM, no pdf-lib: this module is the single source of
// truth for the composed label string, the per-page series, the remembered
// defaults and the payload validation the main-process engine consumes. The
// renderer dialog uses the same functions for its live label preview.

import type {
  BatesDefaults,
  BatesSettings,
  EditColor,
  EditFont,
  WatermarkPosition,
} from './types';

/** Phase 89 — font-size bounds (points) for the Bates stamp. */
export const MIN_BATES_SIZE = 4;
export const MAX_BATES_SIZE = 144;
export const DEFAULT_BATES_SIZE = 10;

/** Phase 89 — padding (minimum digit width) bounds. */
const MIN_BATES_PADDING = 1;
const MAX_BATES_PADDING = 64;

/** The nine shared 3x3 page slots (mirrors the Phase 18 watermark grid). */
const BATES_POSITIONS: readonly WatermarkPosition[] = [
  'top-left', 'top-center', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

/** The EditFont allowlist (mirrors EDIT_FONTS in src/main/services/text-style.ts). */
const BATES_FONTS: readonly EditFont[] = [
  'Helvetica', 'Times', 'Courier',
  'Liberation Sans', 'DejaVu Serif', 'DejaVu Sans Mono',
];

/** Phase 89 — the remembered defaults persisted in `AppSettings.batesDefaults`. */
export const DEFAULT_BATES_DEFAULTS: BatesDefaults = {
  prefix: '',
  suffix: '',
  startNumber: 1,
  padding: 6,
  position: 'bottom-right',
};

/** `prefix` + the number zero-padded to `padding` digits + `suffix`. */
export function buildBatesLabel(
  prefix: string,
  number: number,
  padding: number,
  suffix: string,
): string {
  return `${prefix}${String(number).padStart(padding, '0')}${suffix}`;
}

/** One label per `settings.pages` entry, in list order; the k-th page gets
 *  number `settings.startNumber + k`. */
export function formatBatesSeries(settings: BatesSettings): string[] {
  return settings.pages.map((_page, k) =>
    buildBatesLabel(settings.prefix, settings.startNumber + k, settings.padding, settings.suffix),
  );
}

function validStartNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

function validPadding(v: unknown): v is number {
  return (
    typeof v === 'number' && Number.isInteger(v) &&
    v >= MIN_BATES_PADDING && v <= MAX_BATES_PADDING
  );
}

function validPosition(v: unknown): v is WatermarkPosition {
  return typeof v === 'string' && (BATES_POSITIONS as readonly string[]).includes(v);
}

function validFont(v: unknown): v is EditFont {
  return typeof v === 'string' && (BATES_FONTS as readonly string[]).includes(v);
}

function validColor(v: unknown): v is EditColor {
  if (v === null || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  const inUnit = (x: unknown): boolean =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
  return inUnit(c.r) && inUnit(c.g) && inUnit(c.b);
}

/** Preserve-if-valid per key; a missing or invalid key resolves to its default. */
export function normalizeBatesDefaults(raw: unknown): BatesDefaults {
  const out: BatesDefaults = { ...DEFAULT_BATES_DEFAULTS };
  if (raw !== null && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (typeof r.prefix === 'string') out.prefix = r.prefix;
    if (typeof r.suffix === 'string') out.suffix = r.suffix;
    if (validStartNumber(r.startNumber)) out.startNumber = r.startNumber;
    if (validPadding(r.padding)) out.padding = r.padding;
    if (validPosition(r.position)) out.position = r.position;
  }
  return out;
}

/** Validate a raw `engine.addBates` payload; `null` rejects the whole op.
 *  Pages are checked for a positive-integer shape here only — the engine
 *  additionally enforces the document bound and de-duplication, which need the
 *  open document (`empty-range` / `out-of-range`). */
export function validateBatesSettings(raw: unknown): BatesSettings | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.pages)) return null;
  const pages: number[] = [];
  for (const p of r.pages) {
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 1) return null;
    pages.push(p);
  }
  if (r.prefix !== undefined && typeof r.prefix !== 'string') return null;
  if (r.suffix !== undefined && typeof r.suffix !== 'string') return null;
  const out: BatesSettings = {
    pages,
    prefix: typeof r.prefix === 'string' ? r.prefix : '',
    suffix: typeof r.suffix === 'string' ? r.suffix : '',
    startNumber: 1,
    padding: DEFAULT_BATES_DEFAULTS.padding,
    position: DEFAULT_BATES_DEFAULTS.position,
  };
  if (r.startNumber !== undefined) {
    if (!validStartNumber(r.startNumber)) return null;
    out.startNumber = r.startNumber;
  }
  if (r.padding !== undefined) {
    if (!validPadding(r.padding)) return null;
    out.padding = r.padding;
  }
  if (r.position !== undefined) {
    if (!validPosition(r.position)) return null;
    out.position = r.position;
  }
  if (r.font !== undefined) {
    if (!validFont(r.font)) return null;
    out.font = r.font;
  }
  if (r.size !== undefined) {
    if (
      typeof r.size !== 'number' || !Number.isFinite(r.size) ||
      r.size < MIN_BATES_SIZE || r.size > MAX_BATES_SIZE
    ) {
      return null;
    }
    out.size = r.size;
  }
  if (r.color !== undefined) {
    const c = r.color;
    if (!validColor(c)) return null;
    out.color = { r: c.r, g: c.g, b: c.b };
  }
  return out;
}
