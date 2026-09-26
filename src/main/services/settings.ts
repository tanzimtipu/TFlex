import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { err, ok } from '../../shared/result';
import type {
  AnnotationColorPreset,
  AppSettings,
  AppTheme,
  EditColor,
  LoadSettingsResult,
  RecentFile,
  WatermarkPosition,
  WatermarkSettings,
  WatermarkType,
  WindowGeometry,
} from '../../shared/types';
import { isEditFont } from './text-style';

const RECENT_FILES_CAP = 10;
const MIN_WINDOW_WIDTH = 640;
const MIN_WINDOW_HEIGHT = 480;

/** Phase 11 — OCR language allowlist. ISO-639 codes for which traineddata
 *  can be bundled offline in `assets/tessdata/`. The renderer uses this
 *  to populate the language picker; settings uses it for preserve-if-valid
 *  validation. Only `eng` ships by default (size budget). */
export const OCR_LANGUAGES = [
  'eng',
  'deu',
  'fra',
  'spa',
  'ita',
  'por',
  'rus',
  'chi_sim',
  'jpn',
] as const;

/** Phase 11 — default OCR downsample DPI. */
export const DEFAULT_OCR_DOWNSAMPLE = 300;

/** Phase 12 — built-in stamp id allowlist. The renderer draws each id as a
 *  raster and sends the PNG to the engine (pdf-lib has no rasteriser).
 *  `defaultStampId` is validated against this list (preserve-if-valid);
 *  the default 'APPROVED' is applied by the consumer when the field is
 *  absent (same pattern as editDefaultFont/ocrLanguage). */
export const STAMP_IDS = ['APPROVED', 'DRAFT', 'CONFIDENTIAL', 'FINAL'] as const;

/** Phase 12 — default stamp id applied by the consumer when `defaultStampId`
 *  is absent. Mirrors the editDefaultFont/ocrLanguage default convention. */
export const DEFAULT_STAMP_ID: (typeof STAMP_IDS)[number] = 'APPROVED';

/** Phase 19 — annotation tool id allowlist. Mirrors `AnnotationTool` in the
 *  renderer's annotations model (main cannot import renderer code). The
 *  persisted `annotationRecentTools` order is validated against this list;
 *  ids outside it are dropped. */
export const ANNOTATION_TOOL_IDS: readonly string[] = [
  'select',
  'highlight',
  'underline',
  'strikeout',
  'ink',
  'textbox',
  'rect',
  'ellipse',
  'arrow',
  'note',
  'callout',
];

/** Phase 19 — maximum persisted length of the annotation MRU list. */
export const ANNOTATION_RECENT_TOOLS_CAP = 6;

/** Phase 36 — maximum number of Action Dock pins persisted. The dock
 *  overflows beyond this into a "..." chip; the validator truncates an
 *  over-long array rather than rejecting it (a persisted preference is
 *  better truncated than lost — stated rule). */
export const DOCK_PINS_CAP = 4;

/** Phase 36 — maximum number of `toolUsage` entries persisted, so the
 *  settings file cannot grow unbounded as tool ids accumulate counts. The
 *  highest-count entries win; ties keep their incoming key order. */
export const TOOL_USAGE_CAP = 200;

/** Phase 37 — maximum number of Action Dock un-pins persisted, so the ids
 *  the user removed from the dock cannot grow the settings file unbounded.
 *  The validator truncates an over-long array rather than rejecting it
 *  (same preserve-a-persisted-preference rule as `DOCK_PINS_CAP`). */
export const DOCK_UNPINNED_CAP = 200;

/** Phase 18 — watermark type allowlist. 'text' draws the watermark string
 *  with bundled standard fonts; 'image' embeds a renderer-provided PNG/JPEG
 *  raster (pdf-lib has no rasteriser — same pattern as stamps). */
export const WATERMARK_TYPES: readonly WatermarkType[] = ['text', 'image'];

/** Phase 18 — predefined watermark position grid (3x3). The engine centers
 *  the watermark on the given slot (10% page-margin inset); explicit x/y
 *  in the payload override the slot. */
export const WATERMARK_POSITIONS: readonly WatermarkPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

/** Phase 18 — default watermark opacity used by the engine when the
 *  payload omits it. Half-strength keeps the page content legible under
 *  the overlay (the 0%–100% slider covers the full range). */
export const DEFAULT_WATERMARK_OPACITY = 0.5;

/** Phase 18 — default watermark glyph color (light gray) used by the
 *  engine for text watermarks when the payload omits `color`. */
export const DEFAULT_WATERMARK_COLOR: EditColor = { r: 0.5, g: 0.5, b: 0.5 };

/** Phase 18 — default font size (points) for text watermarks when the
 *  payload omits `size`. */
export const DEFAULT_WATERMARK_TEXT_SIZE = 48;

/** Phase 18 / DEF-217 — watermark size bounds (points). `size` is the text
 *  font size or the image's drawn height. A present-but-out-of-bounds size
 *  rejects the payload (see `normalizeWatermarkSettings`); the lower bound
 *  is what stops a tiled `size: 0.25` from emitting millions of
 *  placements (DEF-217). */
export const MIN_WATERMARK_SIZE = 1;
export const MAX_WATERMARK_SIZE = 2000;

/** Phase 18 / DEF-220 — per-page placement bound. The engine computes a
 *  tiled pattern's row*column count arithmetically from the same bounds the
 *  draw loop uses and rejects the payload before mutating the document; a
 *  tiled 0.25 pt watermark would otherwise place ~4.3 million copies. */
export const MAX_WATERMARK_PLACEMENTS_PER_PAGE = 5000;

/** Phase 18 / DEF-220 — per-document watermark cap. Counted from the baked
 *  content-stream markers (the same scan `getWatermarks` uses), so the
 *  bound survives undo/restore and save/reopen. */
export const MAX_WATERMARKS_PER_DOC = 10;

/**
 * Phase 18 — normalise a raw watermark settings value, reject-if-invalid.
 * Returns `null` when the payload must be rejected. A field that is ABSENT
 * gets its default (applied by the engine); a field that is PRESENT but
 * invalid rejects the whole payload, so a mistyped range can never silently
 * become an all-pages stamp (DEF-218).
 *
 * Core fields: unknown `type`, missing/empty `text` for a text watermark,
 * or missing/empty `imageBytes` for an image watermark reject.
 *
 * Optional fields, present-but-invalid -> reject:
 *   - `size`: finite, MIN_WATERMARK_SIZE..MAX_WATERMARK_SIZE (DEF-217)
 *   - `range`: array of exactly 2 integers, start >= 1, start <= end
 *   - `x`/`y`: either present -> both required, finite (any sign)
 *   - `color`: object with finite r/g/b each in 0..1
 *   - `font`/`position`/`type`: allowlist members
 *   - `bold`/`italic`/`underline`/`tile`: booleans
 *
 * `opacity` is unchanged: absent -> default, present -> clamped into 0..1
 * (documented behaviour, not a defect). `text`/`imageBytes` are unchanged.
 * The engine uses this to validate the `addWatermark` payload before
 * touching the document (reject -> 'engine-error').
 */
export function normalizeWatermarkSettings(raw: unknown): WatermarkSettings | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.type !== 'string' || !(WATERMARK_TYPES as readonly string[]).includes(r.type)) {
    return null;
  }
  const type = r.type as WatermarkType;
  const out: WatermarkSettings = { type };
  if (type === 'text') {
    if (typeof r.text !== 'string' || r.text.length === 0) return null;
    out.text = r.text;
  } else {
    const bytes =
      r.imageBytes instanceof Uint8Array
        ? r.imageBytes
        : r.imageBytes instanceof ArrayBuffer
          ? new Uint8Array(r.imageBytes)
          : null;
    if (bytes === null || bytes.length === 0) return null;
    out.imageBytes = bytes;
  }
  if (r.font !== undefined) {
    if (!isEditFont(r.font)) return null;
    out.font = r.font;
  }
  if (r.bold !== undefined) {
    if (typeof r.bold !== 'boolean') return null;
    out.bold = r.bold;
  }
  if (r.italic !== undefined) {
    if (typeof r.italic !== 'boolean') return null;
    out.italic = r.italic;
  }
  if (r.underline !== undefined) {
    if (typeof r.underline !== 'boolean') return null;
    out.underline = r.underline;
  }
  if (r.size !== undefined) {
    if (
      typeof r.size !== 'number' || !Number.isFinite(r.size) ||
      r.size < MIN_WATERMARK_SIZE || r.size > MAX_WATERMARK_SIZE
    ) {
      return null;
    }
    out.size = r.size;
  }
  if (r.color !== undefined) {
    if (r.color === null || typeof r.color !== 'object') return null;
    const c = r.color as Record<string, unknown>;
    const inUnit = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
    const cr = inUnit(c.r);
    const cg = inUnit(c.g);
    const cb = inUnit(c.b);
    if (cr === null || cg === null || cb === null) return null;
    out.color = { r: cr, g: cg, b: cb };
  }
  // Unchanged: absent -> default (engine), present numeric -> clamped.
  if (typeof r.opacity === 'number' && Number.isFinite(r.opacity)) {
    out.opacity = Math.max(0, Math.min(1, r.opacity));
  }
  if (r.position !== undefined) {
    if (
      typeof r.position !== 'string' ||
      !(WATERMARK_POSITIONS as readonly string[]).includes(r.position)
    ) {
      return null;
    }
    out.position = r.position as WatermarkPosition;
  }
  if (r.x !== undefined || r.y !== undefined) {
    if (
      typeof r.x !== 'number' || !Number.isFinite(r.x) ||
      typeof r.y !== 'number' || !Number.isFinite(r.y)
    ) {
      return null;
    }
    out.x = r.x;
    out.y = r.y;
  }
  if (r.tile !== undefined) {
    if (typeof r.tile !== 'boolean') return null;
    out.tile = r.tile;
  }
  if (r.range !== undefined) {
    if (!Array.isArray(r.range) || r.range.length !== 2) return null;
    const [a, b] = r.range;
    if (
      typeof a !== 'number' || typeof b !== 'number' ||
      !Number.isInteger(a) || !Number.isInteger(b) || a < 1 || a > b
    ) {
      return null;
    }
    out.range = [a, b];
  }
  return out;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'frosted',
  geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
  recentFiles: [],
};

/** Phase 44 — maximum persisted length of `syncDeviceId` (an install id). */
export const SYNC_DEVICE_ID_MAX = 64;

/** Phase 44 — maximum persisted length of `lastSyncedAt` (ISO-8601). */
export const LAST_SYNCED_AT_MAX = 32;

/** Phase-15 frosted-acrylic migration — the set of accepted `AppTheme`
 *  values. `theme` is validated preserve-if-valid against this list in
 *  `normalizeSettings`; any other value is rejected (falls back to
 *  `DEFAULT_SETTINGS.theme`, which is `'frosted'` — operator-set default). */
const THEMES: readonly AppTheme[] = ['light', 'dark', 'frosted'];

function normalizeGeometry(raw: unknown): WindowGeometry {
  const d = DEFAULT_SETTINGS.geometry;
  if (raw === null || typeof raw !== 'object') {
    return { ...d };
  }
  const g = raw as Partial<Record<keyof WindowGeometry, unknown>>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    x: num(g.x, d.x),
    y: num(g.y, d.y),
    width: Math.max(MIN_WINDOW_WIDTH, num(g.width, d.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, num(g.height, d.height)),
    maximized: typeof g.maximized === 'boolean' ? g.maximized : d.maximized,
  };
}

function normalizeRecentFiles(raw: unknown, cap: number = RECENT_FILES_CAP): RecentFile[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const files: RecentFile[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const r = entry as Partial<Record<keyof RecentFile, unknown>>;
    if (
      typeof r.path === 'string' &&
      typeof r.name === 'string' &&
      typeof r.openedAt === 'string'
    ) {
      files.push({ path: r.path, name: r.name, openedAt: r.openedAt });
    }
  }
  const effectiveCap = Math.max(1, Math.min(50, cap));
  return files.slice(0, effectiveCap);
}

/** Phase 19 — normalise a raw `annotationRecentTools` value,
 *  preserve-if-valid / reject-if-invalid. Returns `null` when the value must
 *  be rejected (not an array, or no known ids survive filtering) so the field
 *  stays absent and the consumer applies the default `[]`. Known ids are
 *  kept, duplicates deduped (first occurrence wins), the order preserved, and
 *  the list capped at `ANNOTATION_RECENT_TOOLS_CAP`.
 */
export function normalizeAnnotationRecentTools(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    if (!(ANNOTATION_TOOL_IDS as readonly string[]).includes(entry)) continue;
    if (out.includes(entry)) continue;
    out.push(entry);
    if (out.length >= ANNOTATION_RECENT_TOOLS_CAP) break;
  }
  return out.length > 0 ? out : null;
}

/** Phase 36 — normalise a raw `dockPins` value, preserve-if-valid /
 *  reject-if-invalid. Returns `null` when the value must be rejected (not
 *  an array), so the field stays absent and the consumer applies the
 *  default `[]`. A valid array keeps non-empty strings only (non-strings
 *  and '' are dropped), de-duplicates (first occurrence wins), preserves
 *  order, and truncates to `DOCK_PINS_CAP` — an over-long array is
 *  truncated, never rejected. The result may be empty when every entry
 *  was dropped (the consumer default is `[]` either way). Unknown tool ids
 *  are dropped by the consumer, which owns the tools registry; main has no
 *  registry to validate ids against, so this function checks shape only.
 */
export function normalizeDockPins(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.length === 0) continue;
    if (out.includes(entry)) continue;
    out.push(entry);
    if (out.length >= DOCK_PINS_CAP) break;
  }
  return out;
}

/** Phase 37 — normalise a raw `dockUnpinned` value, preserve-if-valid /
 *  reject-if-invalid. Returns `null` when the value must be rejected (not
 *  an array), so the field stays absent and the consumer applies the
 *  default `[]`. A valid array keeps non-empty strings only (non-strings
 *  and '' are dropped), de-duplicates (first occurrence wins), preserves
 *  order, and truncates to `DOCK_UNPINNED_CAP` — an over-long array is
 *  truncated, never rejected. The result may be empty when every entry
 *  was dropped (the consumer default is `[]` either way). Unknown tool ids
 *  are dropped by the consumer, which owns the tools registry; main has no
 *  registry to validate ids against, so this function checks shape only.
 */
export function normalizeDockUnpinned(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.length === 0) continue;
    if (out.includes(entry)) continue;
    out.push(entry);
    if (out.length >= DOCK_UNPINNED_CAP) break;
  }
  return out;
}

/** Phase 36 — normalise a raw `toolUsage` value, preserve-if-valid /
 *  reject-if-invalid. Returns `null` when the value must be rejected (not
 *  a plain object — arrays, null and primitives all reject), so the field
 *  stays absent and the consumer applies the default `{}`. A valid object
 *  keeps entries whose key is a non-empty string and whose value is a
 *  finite, non-negative integer; every other entry is dropped, including
 *  NaN/Infinity, negatives, non-integers and string-valued counts. The map
 *  is capped at `TOOL_USAGE_CAP`: the highest counts win, ties keep their
 *  incoming key order. The result may be empty when every entry was
 *  dropped (the consumer default is `{}` either way).
 */
export function normalizeToolUsage(raw: unknown): Record<string, number> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries: Array<[string, number]> = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.length === 0) continue;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) continue;
    entries.push([key, value]);
  }
  if (entries.length > TOOL_USAGE_CAP) {
    // Stable sort: ties keep their incoming key order.
    entries.sort((a, b) => b[1] - a[1]);
    entries.length = TOOL_USAGE_CAP;
  }
  const out: Record<string, number> = {};
  for (const [key, value] of entries) {
    out[key] = value;
  }
  return out;
}

function normalizeAnnotationColorEntry(raw: unknown): AnnotationColorPreset | null {
  if (typeof raw === 'string' && raw.length > 0) {
    return { id: raw, hex: raw };
  }
  if (raw !== null && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.id === 'string' && obj.id.length > 0 &&
        typeof obj.hex === 'string' && obj.hex.length > 0) {
      return { id: obj.id, hex: obj.hex };
    }
  }
  return null;
}

export function normalizeSettings(raw: unknown): AppSettings {
  const rawObj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const recentsCap = typeof rawObj.recentsCap === 'number' && Number.isFinite(rawObj.recentsCap) && rawObj.recentsCap >= 1 && rawObj.recentsCap <= 50
    ? rawObj.recentsCap
    : RECENT_FILES_CAP;
  const settings: AppSettings = {
    theme: typeof rawObj.theme === 'string' && (THEMES as readonly string[]).includes(rawObj.theme)
      ? (rawObj.theme as AppTheme)
      : DEFAULT_SETTINGS.theme,
    geometry: normalizeGeometry(rawObj.geometry),
    recentFiles: normalizeRecentFiles(rawObj.recentFiles, recentsCap),
  };

  // Phase 6: preserve optional settings fields if they are valid.
  // Phase 36: toolsPaletteLayout is a TOLERATED LEGACY key — no UI writes
  // it once the All-tools palette is retired, but it must keep validating
  // for one release so an existing settings.json does not fail.
  if (typeof rawObj.toolsPaletteLayout === 'string' && (rawObj.toolsPaletteLayout === 'list' || rawObj.toolsPaletteLayout === 'grid')) {
    settings.toolsPaletteLayout = rawObj.toolsPaletteLayout;
  }
  if (typeof rawObj.themeDefault === 'string' && (rawObj.themeDefault === 'light' || rawObj.themeDefault === 'dark' || rawObj.themeDefault === 'system' || rawObj.themeDefault === 'frosted')) {
    settings.themeDefault = rawObj.themeDefault;
  }
  if (typeof rawObj.recentsCap === 'number' && Number.isFinite(rawObj.recentsCap) && rawObj.recentsCap >= 1 && rawObj.recentsCap <= 50) {
    settings.recentsCap = rawObj.recentsCap;
  }
  if (rawObj.annotationColors !== null && typeof rawObj.annotationColors === 'object') {
    const ac = rawObj.annotationColors as Record<string, unknown>;
    const colors: { light?: AnnotationColorPreset[]; dark?: AnnotationColorPreset[] } = {};
    if (Array.isArray(ac.light)) {
      const lightEntries = ac.light
        .map((c) => normalizeAnnotationColorEntry(c))
        .filter((c): c is AnnotationColorPreset => c !== null);
      if (lightEntries.length > 0) {
        colors.light = lightEntries;
      }
    }
    if (Array.isArray(ac.dark)) {
      const darkEntries = ac.dark
        .map((c) => normalizeAnnotationColorEntry(c))
        .filter((c): c is AnnotationColorPreset => c !== null);
      if (darkEntries.length > 0) {
        colors.dark = darkEntries;
      }
    }
    if (colors.light || colors.dark) {
      settings.annotationColors = colors;
    }
  }

  // Phase 8: preserve optimizePreset if it is a valid enum value
  if (typeof rawObj.optimizePreset === 'string' && (rawObj.optimizePreset === 'none' || rawObj.optimizePreset === 'compact' || rawObj.optimizePreset === 'max')) {
    settings.optimizePreset = rawObj.optimizePreset;
  }

  // Phase 9: preserve exportImageFormat if it is a valid enum value
  if (typeof rawObj.exportImageFormat === 'string' && (rawObj.exportImageFormat === 'png' || rawObj.exportImageFormat === 'jpeg' || rawObj.exportImageFormat === 'tiff')) {
    settings.exportImageFormat = rawObj.exportImageFormat;
  }

  // Phase 9: preserve exportImageDpi if it is a number in 72..600
  if (typeof rawObj.exportImageDpi === 'number' && Number.isFinite(rawObj.exportImageDpi) && rawObj.exportImageDpi >= 72 && rawObj.exportImageDpi <= 600) {
    settings.exportImageDpi = rawObj.exportImageDpi;
  }

  // Phase 9: preserve createImageQuality if it is a number in 0..1
  if (typeof rawObj.createImageQuality === 'number' && Number.isFinite(rawObj.createImageQuality) && rawObj.createImageQuality >= 0 && rawObj.createImageQuality <= 1) {
    settings.createImageQuality = rawObj.createImageQuality;
  }

  // Phase 10 / Phase 27: preserve editDefaultFont if it is a valid EditFont
  // allowlist value (the three StandardFont families plus the bundled ones).
  if (isEditFont(rawObj.editDefaultFont)) {
    settings.editDefaultFont = rawObj.editDefaultFont;
  }

  // Phase 11: preserve ocrLanguage if it is a valid ISO-639 allowlist value
  if (typeof rawObj.ocrLanguage === 'string' && (OCR_LANGUAGES as readonly string[]).includes(rawObj.ocrLanguage)) {
    settings.ocrLanguage = rawObj.ocrLanguage as AppSettings['ocrLanguage'];
  }

  // Phase 11: preserve ocrDownsample if it is a number in 72..600
  if (typeof rawObj.ocrDownsample === 'number' && Number.isFinite(rawObj.ocrDownsample) && rawObj.ocrDownsample >= 72 && rawObj.ocrDownsample <= 600) {
    settings.ocrDownsample = rawObj.ocrDownsample;
  }

  // Phase 12: preserve defaultStampId if it is a valid STAMP_IDS allowlist value
  if (typeof rawObj.defaultStampId === 'string' && (STAMP_IDS as readonly string[]).includes(rawObj.defaultStampId)) {
    settings.defaultStampId = rawObj.defaultStampId as AppSettings['defaultStampId'];
  }

  // Phase 13 / DEF-073: preserve saveAsLinearize if it is a real boolean.
  // Independent of optimizePreset (see AppSettings.saveAsLinearize doc).
  // Non-boolean values are rejected (left unset); the consumer applies the
  // documented default `false` when the field is absent.
  if (typeof rawObj.saveAsLinearize === 'boolean') {
    settings.saveAsLinearize = rawObj.saveAsLinearize;
  }

  // Phase 16: preserve pagesPanelCollapsed if it is a real boolean.
  // Non-boolean values are rejected; the consumer applies default `false`
  // when the field is absent.
  if (typeof rawObj.pagesPanelCollapsed === 'boolean') {
    settings.pagesPanelCollapsed = rawObj.pagesPanelCollapsed;
  }

  // Phase 19: preserve annotationRecentTools only when the value survives
  // allowlist filtering + dedupe + cap. Absent is the default ([]); an
  // invalid value leaves the field absent, exactly like themeDefault.
  const annotationRecentTools = normalizeAnnotationRecentTools(rawObj.annotationRecentTools);
  if (annotationRecentTools !== null) {
    settings.annotationRecentTools = annotationRecentTools;
  }

  // Phase 23: preserve animationsEnabled if it is a real boolean.
  // Non-boolean values are rejected; the consumer applies the documented
  // default `true` (animations ON) when the field is absent. Same convention
  // as saveAsLinearize / pagesPanelCollapsed.
  if (typeof rawObj.animationsEnabled === 'boolean') {
    settings.animationsEnabled = rawObj.animationsEnabled;
  }

  // Phase 36: Action Dock pins. Reject-if-invalid: a non-array leaves the
  // field absent (consumer default []). A valid array is filtered
  // (non-empty strings only), deduped and truncated to DOCK_PINS_CAP.
  const dockPins = normalizeDockPins(rawObj.dockPins);
  if (dockPins !== null) {
    settings.dockPins = dockPins;
  }

  // Phase 36: per-tool usage counts for palette frequency ranking.
  // Reject-if-invalid: a non-object leaves the field absent (consumer
  // default {}). A valid map is filtered (finite non-negative integers
  // only) and capped at its TOOL_USAGE_CAP highest counts.
  const toolUsage = normalizeToolUsage(rawObj.toolUsage);
  if (toolUsage !== null) {
    settings.toolUsage = toolUsage;
  }

  // Phase 37: Action Dock un-pins (tool ids the user removed). Reject-if-
  // invalid: a non-array leaves the field absent (consumer default []). A
  // valid array is filtered (non-empty strings only), deduped and truncated
  // to DOCK_UNPINNED_CAP.
  const dockUnpinned = normalizeDockUnpinned(rawObj.dockUnpinned);
  if (dockUnpinned !== null) {
    settings.dockUnpinned = dockUnpinned;
  }

  // Phase 44: accounts feature flag. Strict boolean; any non-boolean
  // rejects the field (consumer default `false`). Stands alone so a bad
  // value never disturbs the sync fields.
  if (typeof rawObj.accountsEnabled === 'boolean') {
    settings.accountsEnabled = rawObj.accountsEnabled;
  }

  // Phase 44: sync install id. Reject-if-invalid: a present value must be a
  // non-empty string of at most SYNC_DEVICE_ID_MAX chars, else the field
  // stays absent (consumer generates a fresh id).
  if (
    typeof rawObj.syncDeviceId === 'string' &&
    rawObj.syncDeviceId.length > 0 &&
    rawObj.syncDeviceId.length <= SYNC_DEVICE_ID_MAX
  ) {
    settings.syncDeviceId = rawObj.syncDeviceId;
  }

  // Phase 44: last-sync timestamp. Reject-if-invalid: a present value must
  // be an ISO-8601-parseable string of at most LAST_SYNCED_AT_MAX chars,
  // else the field stays absent. Display-only.
  if (
    typeof rawObj.lastSyncedAt === 'string' &&
    rawObj.lastSyncedAt.length > 0 &&
    rawObj.lastSyncedAt.length <= LAST_SYNCED_AT_MAX &&
    !Number.isNaN(Date.parse(rawObj.lastSyncedAt))
  ) {
    settings.lastSyncedAt = rawObj.lastSyncedAt;
  }

  return settings;
}

export class SettingsService {
  private current: AppSettings = structuredClone(DEFAULT_SETTINGS);
  /** Last settings snapshot that actually reached disk. `current` is restored
   *  to this on a failed write so memory and disk never diverge (DEF-230). */
  private persisted: AppSettings = structuredClone(DEFAULT_SETTINGS);
  private _saveQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly onChange?: (settings: AppSettings) => void,
    private readonly onWriteError?: (message: string) => void,
  ) {}

  getCurrent(): AppSettings {
    return structuredClone(this.current);
  }

  async load(): Promise<LoadSettingsResult> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.current = structuredClone(DEFAULT_SETTINGS);
        this.persisted = structuredClone(DEFAULT_SETTINGS);
        return ok(structuredClone(DEFAULT_SETTINGS));
      }
      return err('io', message(e));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return err('corrupt-settings', 'settings.json is not valid JSON');
    }
    if (parsed === null || typeof parsed !== 'object') {
      return err('corrupt-settings', 'settings.json does not contain an object');
    }
    this.current = normalizeSettings(parsed);
    this.persisted = structuredClone(this.current);
    return ok(structuredClone(this.current));
  }

  save(settings: AppSettings): Promise<void> {
    this.current = normalizeSettings(settings);
    const task = this._saveQueue.then(() => this._doSave(this.current));
    this._saveQueue = task.catch(() => {});
    return task;
  }

  /** Save the current in-memory settings at execution time (not enqueue time).
   *  This avoids the race where a caller snapshots `getCurrent()` before a
   *  pending renderer save has updated `this.current`.  The state is read when
   *  the queued task actually runs, after all prior saves have completed. */
  saveCurrent(): Promise<void> {
    const task = this._saveQueue.then(() => this._doSave(structuredClone(this.current)));
    this._saveQueue = task.catch(() => {});
    return task;
  }

  /** DEF-303 — persist ONLY the OS window geometry (bounds + `maximized`)
   *  without echoing `settings:changed` back to the renderer.
   *
   *  Main owns the geometry: `src/main/window.ts` pushes every state
   *  transition immediately through its `onWindowStateChanged` callback, so
   *  by the time this debounced write lands the renderer already shows the
   *  correct caption. The renderer never reads geometry.x/y/width/height
   *  (only `geometry.maximized`, see App.tsx DEF-202), so an echo for a
   *  geometry-only write buys nothing and costs a full settings re-render
   *  ~300 ms after the maximize — exactly the lag DEF-303 measured. Chosen
   *  fix: emit nothing for a geometry-only write. Every other write
   *  (`save` / `saveCurrent` / `addRecentFile`) keeps the normal echo. */
  saveGeometryOnly(geometry: WindowGeometry): Promise<void> {
    this.current = normalizeSettings({ ...this.current, geometry });
    const snapshot = structuredClone(this.current);
    const task = this._saveQueue.then(() => this._doSave(snapshot, false));
    this._saveQueue = task.catch(() => {});
    return task;
  }

  private async _doSave(settings: AppSettings, notify = true): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    try {
      const normalized = normalizeSettings(settings);
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(tmp, JSON.stringify(normalized, null, 2), 'utf8');
      await rename(tmp, this.filePath);
      this.current = normalized;
      this.persisted = structuredClone(normalized);
      if (notify) {
        this.onChange?.(structuredClone(normalized));
      }
    } catch (e) {
      try {
        await unlink(tmp);
      } catch {
        // Best-effort tmp cleanup — ignore secondary errors
      }
      const msg = message(e);
      console.warn(`[settings] could not write settings.json: ${msg}`);
      // Never let memory claim a value the disk never got (DEF-230).
      this.current = structuredClone(this.persisted);
      this.onWriteError?.(msg);
    }
  }

  async addRecentFile(file: RecentFile): Promise<void> {
    const rest = this.current.recentFiles.filter((f) => f.path !== file.path);
    await this.save({ ...this.current, recentFiles: [file, ...rest] });
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
