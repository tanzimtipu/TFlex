import { randomUUID } from 'node:crypto';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFFont,
  type PDFOperator,
  type PDFPage,
  type PDFPageLeaf,
} from 'pdf-lib';
import { err, ok, type Result } from '../../shared/result';
import { ANN_COLOR_RGB, ANNOTATION_COLOR_NAMES } from '../../shared/annotationColors';
import { drawStyledTextLines } from './engine';
import { embedEditFont } from './fonts';
import {
  EDIT_FONTS,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  isBundledEditFont,
  isEditFont,
  validateTextStyleFields,
} from './text-style';
import type {
  AnnColor,
  AnnColorValue,
  AnnKind,
  AnnLineEnd,
  AnnModel,
  AnnPoint,
  AnnRect,
  AnnTextStyle,
  CreateAnnotationPayload,
  EditAnnotationPayload,
  EngineError,
  TextStyleFields,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Color constants (DEF-260 — canonical list lives in src/shared/)
//
// The name -> RGB map and the accepted-name list used to be local literals,
// and they had drifted from the renderer's palette: pink/teal/gray were offered
// by the renderer but unknown here, so those picks were silently dropped on the
// engine-backed paths. Both now come from the single shared module, so the
// engine and the renderer cannot disagree about which names are valid.
// ---------------------------------------------------------------------------

export { ANN_COLOR_RGB };

/** The canonical accepted colour names. Exported so the guard test can assert
 *  the engine's accepted set equals the shared canonical set. */
export const ANN_COLORS: readonly AnnColor[] = ANNOTATION_COLOR_NAMES;

/**
 * Map an RGB triple to the nearest named annotation color using Euclidean
 * distance in RGB space.
 */
export function nearestAnnColor(r: number, g: number, b: number): AnnColor {
  let best: AnnColor = 'yellow';
  let bestDist = Infinity;
  for (const c of ANN_COLORS) {
    const [cr, cg, cb] = ANN_COLOR_RGB[c];
    const dr = r - cr;
    const dg = g - cg;
    const db = b - cb;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

/** Check whether a string is a valid AnnColor. */
function isAnnColor(v: string): v is AnnColor {
  return (ANN_COLORS as readonly string[]).includes(v);
}

/**
 * A hex color string (#rgb or #rrggbb, any case). Detected by a leading '#'.
 * Free-form custom colors picked through the renderer's ColorPalette arrive
 * as this shape; the engine must preserve them verbatim instead of snapping
 * to the nearest named preset.
 */
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(v: string): boolean {
  return HEX_COLOR_RE.test(v);
}

/** True for any color value the engine accepts: a named preset or a hex. */
export function isValidColorValue(v: string): boolean {
  return isAnnColor(v) || isHexColor(v);
}

/** Parse a hex color (#rgb / #rrggbb) to a 0..1 RGB triple, or null. */
export function hexToRgb(hex: string): [number, number, number] | null {
  if (!isHexColor(hex)) return null;
  const raw = hex.slice(1);
  let r: string, g: string, b: string;
  if (raw.length === 3) {
    r = raw[0]!; g = raw[1]!; b = raw[2]!;
    r = r + r; g = g + g; b = b + b;
  } else {
    r = raw.slice(0, 2); g = raw.slice(2, 4); b = raw.slice(4, 6);
  }
  return [
    parseInt(r, 16) / 255,
    parseInt(g, 16) / 255,
    parseInt(b, 16) / 255,
  ];
}

/** Resolve any stored color (named preset OR hex) to a 0..1 RGB triple for
 *  the PDF /C array. Unknown values degrade to yellow's RGB. */
export function colorToRgb(color: string): [number, number, number] {
  if (isAnnColor(color)) return [...ANN_COLOR_RGB[color]];
  const hex = hexToRgb(color);
  if (hex !== null) return hex;
  return [...ANN_COLOR_RGB.yellow];
}

/** Normalize an incoming color string from the wire. A named preset or a hex
 *  is preserved verbatim; anything else (missing/empty/unknown) is rejected
 *  instead of silently defaulting to yellow (ADV-027/DEF-206: silent
 *  normalization hid bad input from callers). Throws a descriptive Error so
 *  the create path can surface it as an engine-error result. */
export function normalizeColorValue(color: string | undefined): string {
  if (typeof color === 'string' && isValidColorValue(color)) return color;
  throw new Error(`Invalid annotation color: ${color}`);
}

// ---------------------------------------------------------------------------
// Phase 28 (criterion 4) — stable annotation ids
//
// Every annotation gets a stable id so identity survives save/reopen and
// id-keyed state (comment threads' `annotationId`) still matches after a
// reload. The id is persisted in `/NM` — the standard PDF annotation "name"
// entry, a normal text string that other viewers ignore — and read back on
// load. A legacy file (no `/NM`) or a malformed/hostile value falls back to a
// fresh random id, so the load path never throws.
// ---------------------------------------------------------------------------

/** Ceiling on an id read back from `/NM`. UUIDs are 36 chars; 256 leaves room
 *  for renderer-generated ids while rejecting a hostile multi-KB name. */
const MAX_ANNOTATION_ID_LENGTH = 256;

/** Read the stable annotation id from the `/NM` entry. Accepts a plain
 *  `PDFString` (what `serializeAnnotation` writes) or a `PDFHexString` (a
 *  foreign viewer may encode a non-ASCII name that way — `PDFHexString` is NOT
 *  a `PDFString` subclass in pdf-lib). Returns undefined for an absent,
 *  non-string, empty or oversized value, so the caller falls back to a fresh
 *  random id. Never throws. */
function parseAnnotationNameId(val: unknown): string | undefined {
  if (!(val instanceof PDFString) && !(val instanceof PDFHexString)) return undefined;
  let id: string;
  try {
    id = val.decodeText();
  } catch {
    return undefined;
  }
  if (id.length === 0 || id.length > MAX_ANNOTATION_ID_LENGTH) return undefined;
  return id;
}

// ---------------------------------------------------------------------------
// Phase 24 — text-style round-trip sentinel
//
// pdf-lib has no round-trip-safe annotation metadata store, so a text-bearing
// annotation's `TextStyleFields` are persisted as the FIRST LINE of the
// annotation's /Contents string:
//
//   TFLEX-STYLE <base64url(JSON.stringify(TextStyleFields))>
//   <the user's text, unchanged>
//
// This mirrors the Phase-18 watermark content-stream marker (`%TFLEX-WATERMARK
// ...` in engine.ts) and survives save/reopen because /Contents is a normal
// PDF string. The baked /AP stream is what other viewers see; TFlex reads this
// sentinel on reopen to re-populate the text-properties panel. A sentinel is
// only written when the annotation actually carries a style, so a legacy
// annotation's /Contents is byte-for-byte unchanged.
// ---------------------------------------------------------------------------

const STYLE_MARKER_PREFIX = 'TFLEX-STYLE ';

type AnnStyleValidation =
  | { ok: true; value: AnnTextStyle }
  | { ok: false; reason: string };

/** Phase 24 follow-up — validate the annotation text style: the Phase-21
 *  `TextStyleFields` (via `validateTextStyleFields`) plus the `font`/`size`
 *  extension the font-family picker and size stepper send. Same contract as
 *  every other text payload: a supplied-but-invalid field rejects the whole
 *  payload; absent fields are simply not carried.
 *
 *  Phase 24 follow-up — `highlight: null` is an explicit REMOVAL on this
 *  path (the panel's "None" / clear-highlight button), mirroring
 *  `TextBoxStylePatch.highlight`. The shared `validateTextStyleFields`
 *  rejects `null`, so strip it before that call and carry the removal
 *  through as `null`; an ABSENT `highlight` still preserves the stored
 *  band. Every non-null highlight keeps the existing `EditColor`
 *  validation. */
function validateAnnTextStyle(raw: unknown): AnnStyleValidation {
  const rawObj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const removesHighlight = rawObj !== null && rawObj.highlight === null;
  const base = validateTextStyleFields(
    removesHighlight && rawObj !== null ? { ...rawObj, highlight: undefined } : raw,
  );
  if (!base.ok) return base;
  const out: AnnTextStyle = { ...base.value };
  if (removesHighlight) out.highlight = null;
  const r = raw as Record<string, unknown>;
  if (r.font !== undefined) {
    if (!isEditFont(r.font)) {
      return {
        ok: false,
        reason: `unsupported font ${JSON.stringify(r.font)}; supported families are ${EDIT_FONTS.join(', ')}`,
      };
    }
    out.font = r.font;
  }
  if (r.size !== undefined) {
    if (
      typeof r.size !== 'number' || !Number.isFinite(r.size) ||
      r.size < MIN_TEXT_SIZE || r.size > MAX_TEXT_SIZE
    ) {
      return {
        ok: false,
        reason: `size must be a finite number in ${MIN_TEXT_SIZE}..${MAX_TEXT_SIZE}`,
      };
    }
    out.size = r.size;
  }
  return { ok: true, value: out };
}

/** Encode `/Contents` for an annotation: prepend the style sentinel when the
 *  annotation carries a non-empty style. Returns the plain content otherwise. */
function encodeAnnotationContents(ann: AnnModel): string | undefined {
  const text = ann.content;
  if (ann.style === undefined || Object.keys(ann.style).length === 0) {
    return text;
  }
  const payload = Buffer.from(JSON.stringify(ann.style)).toString('base64url');
  const marker = STYLE_MARKER_PREFIX + payload;
  return text !== undefined && text.length > 0 ? `${marker}\n${text}` : marker;
}

/** Decode a `/Contents` string that may carry the style sentinel. Returns the
 *  user text (undefined when empty) and the validated style (undefined when
 *  absent or malformed — a hostile payload never throws out of the load path). */
function decodeAnnotationContents(value: string): { text: string | undefined; style?: AnnTextStyle } {
  if (!value.startsWith(STYLE_MARKER_PREFIX)) return { text: value };
  const rest = value.slice(STYLE_MARKER_PREFIX.length);
  const newline = rest.indexOf('\n');
  const payload = newline === -1 ? rest : rest.slice(0, newline);
  const text = newline === -1 ? '' : rest.slice(newline + 1);
  let style: AnnTextStyle | undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const v = validateAnnTextStyle(parsed);
    if (v.ok && Object.keys(v.value).length > 0) style = v.value;
  } catch {
    style = undefined;
  }
  return { text: text.length > 0 ? text : undefined, style };
}

// ---------------------------------------------------------------------------
// Renderer Annotation -> internal AnnModel conversion
// ---------------------------------------------------------------------------

/** True when `n` is a finite, non-negative number (ADV-026/DEF-205: NaN and
 *  Infinity must not reach the PDF object stream, where they would serialize
 *  as invalid tokens and corrupt the annotation dict). */
function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === 'number' && !Number.isNaN(n) && Number.isFinite(n) && n >= 0;
}

/** Validate a single rect object `{ x, y, width, height }` coming off the wire.
 *  All four fields must be finite non-negative numbers and the rect must have
 *  strictly positive width and height — a zero-size rect produces an invisible
 *  annotation at (0,0) (ADV-025/DEF-204) and is rejected rather than silently
 *  created. Returns a clean AnnRect copy. */
function validateRect(rect: unknown): AnnRect {
  if (typeof rect !== 'object' || rect === null) {
    throw new Error('Rect must be { x, y, width, height }');
  }
  const r = rect as Record<string, unknown>;
  const { x, y, width, height } = r;
  if (!isFiniteNonNegative(x) || !isFiniteNonNegative(y) ||
      !isFiniteNonNegative(width) || !isFiniteNonNegative(height)) {
    throw new Error('Rect coordinates must be finite non-negative numbers');
  }
  if (width <= 0 || height <= 0) {
    throw new Error('Rect must have positive width and height');
  }
  return { x, y, width, height };
}

/** Validate a single point `{ x, y }` coming off the wire (arrow endpoints,
 *  ink strokes, note/callout anchors). Both fields must be finite
 *  non-negative numbers. Returns a clean AnnPoint copy. */
function validatePoint(p: unknown): AnnPoint {
  if (typeof p !== 'object' || p === null) {
    throw new Error('Point must be { x, y }');
  }
  const pt = p as Record<string, unknown>;
  const { x, y } = pt;
  if (!isFiniteNonNegative(x) || !isFiniteNonNegative(y)) {
    throw new Error('Point coordinates must be finite non-negative numbers');
  }
  return { x, y };
}

/**
 * Normalize the renderer's Annotation shape (which uses different key names
 * per kind — `rect`, `from`/`to`, `at`, 'textbox' kind, etc.) into our
 * internal AnnModel.
 */
function normalizeAnnotationPayload(payload: CreateAnnotationPayload): AnnModel {
  const kind: AnnKind = normalizeKind(payload.kind);
  const color: AnnColorValue = normalizeColorValue(payload.color);

  // DEF-160/161/162: when an annotation is moved, the renderer updates the
  // kind's primary geometry key (`rect` for text-box/rect/ellipse/callout,
  // `at` for note) on a spread copy — but a stale `rects` array left over
  // from the IPC round-trip's `annotationFromWire` backfill can still be
  // attached at the OLD position. The primary key is authoritative for
  // single-rect kinds: regenerate rects[0] from it instead of preferring the
  // stale `rects` (which silently reverted moves and tore callout arrows).
  let rects: AnnRect[];
  if (payload.rect !== undefined) {
    // text-box/rect/ellipse/callout: `rect` is the box/shape geometry.
    // Overwrite rects[0] from it; preserve any extra rects beyond [0]
    // (multi-rect text markup should not be affected since it sends no `rect`).
    const primary = validateRect(payload.rect);
    // ADV-024/DEF-203: `!= null && Array.isArray` — a `null` rects value must
    // not pass the guard and crash on `.length` access.
    if (payload.rects != null && Array.isArray(payload.rects) && payload.rects.length > 1) {
      rects = [
        primary,
        ...payload.rects.slice(1).map((r) => validateRect(r)),
      ];
    } else {
      rects = [primary];
    }
  } else if (payload.at !== undefined) {
    // note: the icon is anchored at `at` — derive the icon rect from `at`
    // rather than backfilling from a stale `rects[0]` (which lost the move).
    // (callout reaches the `rect` branch above before this; its `at` anchor
    // is preserved separately via `at: payload.at` on the returned model.)
    const at = validatePoint(payload.at);
    rects = [{ x: at.x, y: at.y, width: 24, height: 24 }];
  } else if (payload.rects != null && Array.isArray(payload.rects) && payload.rects.length > 0) {
    // ADV-024: null/non-array rects no longer fall through to the zero-size
    // branch silently; they are rejected. ADV-026: every entry is validated.
    rects = payload.rects.map((r) => validateRect(r));
  } else if (payload.from !== undefined && payload.to !== undefined) {
    // Arrow: compute bbox from endpoints (validated points). The bbox may be
    // zero-area when from==to; that is acceptable for a Line annotation whose
    // real geometry lives in /L, so the computed bbox is NOT run through
    // validateRect's positive-size check.
    const from = validatePoint(payload.from);
    const to = validatePoint(payload.to);
    const minX = Math.min(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const maxX = Math.max(from.x, to.x);
    const maxY = Math.max(from.y, to.y);
    rects = [{ x: minX, y: minY, width: maxX - minX, height: maxY - minY }];
  } else if (payload.points !== undefined && Array.isArray(payload.points) && payload.points.length > 0) {
    // Ink (pen tool): the renderer commits a freehand stroke as `points`
    // only — no rect/rects/at/from/to (AnnotationOverlay's ink commit sends
    // { kind:'ink', page, color, points, width }). Derive the /Rect bbox
    // from the stroke extent, like the arrow branch does for from/to. A
    // zero-area bbox (single point, or a perfectly straight vertical/
    // horizontal stroke) is fine: the real geometry lives in /InkList, so
    // the computed bbox is NOT run through validateRect's positive-size
    // check. A stroke needs at least two points — the renderer enforces
    // the same minimum (MIN_INK_POINTS = 2) before committing.
    const pts = payload.points.map((p) => validatePoint(p));
    if (pts.length < 2) {
      throw new Error('Ink annotation requires at least two points');
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    rects = [{ x: minX, y: minY, width: maxX - minX, height: maxY - minY }];
  } else {
    // ADV-025/DEF-204: no geometry source at all. Previously this created a
    // zero-size annotation at (0,0); now it fails loud so bad input surfaces.
    throw new Error('Annotation requires at least one rect');
  }

  let points: AnnPoint[] | undefined;
  if (payload.from !== undefined && payload.to !== undefined) {
    points = [validatePoint(payload.from), validatePoint(payload.to)];
  } else if (payload.points !== undefined && Array.isArray(payload.points) && payload.points.length > 0) {
    points = payload.points.map((p) => validatePoint(p));
  }

  const content = payload.content ?? payload.text;

  // Phase 24 — validate the optional text style fields (including the
  // follow-up `font`/`size` extension). Absent means the legacy appearance (no
  // `style` on the model = Helvetica 12 / left / default line height). A
  // present-but-invalid field rejects the WHOLE create with a typed
  // engine-error (preserve-if-valid / reject-if-invalid, the Phase-21
  // contract); an empty validated object is omitted so a no-op patch never
  // stores `{}`.
  let style: AnnTextStyle | undefined;
  if (payload.style !== undefined) {
    const v = validateAnnTextStyle(payload.style);
    if (!v.ok) throw new Error(v.reason);
    if (Object.keys(v.value).length > 0) style = v.value;
  }

  return {
    id: payload.id,
    kind,
    page: payload.page,
    rects,
    points,
    at: payload.at,
    color,
    content,
    text: content,
    width: payload.width,
    opacity: payload.opacity,
    blendMode: payload.blendMode,
    lineEnds: payload.lineEnds?.slice(),
    style,
  };
}

/** The AnnKind values the engine accepts on the create path. Anything else
 *  (e.g. 'pen' — the renderer's pen tool sends kind 'ink') is rejected at
 *  create time: an unknown kind would survive normalizeAnnotationPayload's
 *  cast and only explode later in subtypeName, which has no case for it and
 *  returns undefined, corrupting the serialized annotation dict on save. */
const ANN_KINDS: ReadonlySet<string> = new Set<AnnKind>([
  'text-box',
  'rect',
  'ellipse',
  'note',
  'ink',
  'arrow',
  'highlight',
  'underline',
  'squiggly',
  'strikeout',
  'callout',
]);

function normalizeKind(k: string): AnnKind {
  if (k === 'textbox') {
    return 'text-box';
  }
  if (typeof k !== 'string' || !ANN_KINDS.has(k)) {
    throw new Error(`Unknown annotation kind: ${String(k)}`);
  }
  return k as AnnKind;
}

// ---------------------------------------------------------------------------
// Annotation storage helpers (engine-internal)
// ---------------------------------------------------------------------------

/** Clone the per-original-page annotations array. */
export function cloneAnnotations(anns: AnnModel[][]): AnnModel[][] {
  return anns.map((pageAnns) => pageAnns.map((a) => ({
    ...a,
    rects: a.rects.map((r) => ({ ...r })),
    points: a.points?.map((p) => ({ ...p })),
    at: a.at !== undefined ? { ...a.at } : undefined,
    lineEnds: a.lineEnds?.slice(),
    style: a.style !== undefined
      ? { ...a.style, highlight: a.style.highlight ? { ...a.style.highlight } : undefined }
      : undefined,
  })));
}

/**
 * Build the visible-1-based annotations map from internal per-original-page
 * storage and the current page order.
 */
export function buildVisibleAnnotations(
  annotations: AnnModel[][],
  order: number[],
): AnnModel[][] {
  const result: AnnModel[][] = [];
  for (let vi = 0; vi < order.length; vi++) {
    const origIdx = order[vi];
    const pageAnns = annotations[origIdx];
    result[vi + 1] = pageAnns !== undefined ? pageAnns : [];
  }
  return result;
}

/**
 * Find an annotation by ID across all pages. Returns [origPageIdx, indexInPage].
 */
export function findAnnotation(
  annotations: AnnModel[][],
  annId: string,
): [number, number] | null {
  for (let origIdx = 0; origIdx < annotations.length; origIdx++) {
    const pageAnns = annotations[origIdx];
    if (pageAnns === undefined) continue;
    for (let i = 0; i < pageAnns.length; i++) {
      if (pageAnns[i].id === annId) {
        return [origIdx, i];
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Create / edit / delete
// ---------------------------------------------------------------------------

export function createAnnotation(
  annotations: AnnModel[][],
  order: number[],
  payload: CreateAnnotationPayload,
): Result<AnnModel, EngineError> {
  const visiblePage = payload.page;
  if (visiblePage < 1 || visiblePage > order.length) {
    return err('out-of-range', `page ${visiblePage} out of range [1,${order.length}]`);
  }
  const origIdx = order[visiblePage - 1];

  // ADV-024/025/026/027: normalizeAnnotationPayload now throws on invalid
  // geometry/color instead of silently producing a degenerate annotation.
  // Surface the message as an engine-error result so the IPC layer returns a
  // typed failure rather than crashing the engine queue.
  let model: AnnModel;
  try {
    model = normalizeAnnotationPayload(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('engine-error', msg);
  }

  if (annotations[origIdx] === undefined) {
    annotations[origIdx] = [];
  }
  annotations[origIdx].push(model);
  return ok(model);
}

export function editAnnotation(
  annotations: AnnModel[][],
  annId: string,
  payload: EditAnnotationPayload,
): Result<AnnModel, EngineError> {
  const found = findAnnotation(annotations, annId);
  if (found === null) {
    return err('not-found', `annotation ${annId} not found`);
  }
  const [origIdx, i] = found;
  const ann = annotations[origIdx][i];

  // Phase 28 — geometry patch. Validated FIRST so a malformed rect rejects the
  // whole edit with nothing mutated (the create path does the same via
  // normalizeAnnotationPayload). Regenerate rects[0] from the supplied rect and
  // keep any extra rects beyond [0] for multi-rect kinds, mirroring the create
  // path exactly (DEF-160/161/162 semantics). This makes a move / auto-grow a
  // single op with one undo snapshot instead of delete + re-create, so a burst
  // of style clicks cannot race a fresh selection event.
  if (payload.rect !== undefined) {
    let primary: AnnRect;
    try {
      primary = validateRect(payload.rect);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err('engine-error', msg);
    }
    ann.rects = ann.rects.length > 1
      ? [primary, ...ann.rects.slice(1)]
      : [primary];
  }

  if (payload.color !== undefined) {
    ann.color = isValidColorValue(payload.color) ? payload.color : ann.color;
  }
  if (payload.content !== undefined) {
    ann.content = payload.content;
    ann.text = payload.content;
  }
  if (payload.text !== undefined) {
    ann.text = payload.text;
    ann.content = payload.text;
  }
  // Phase 24 — partial style patch. Every supplied field (including the
  // follow-up `font`/`size` extension) is validated; an invalid field rejects
  // the whole edit with a typed engine-error. Valid fields are merged onto the
  // stored style so an edit of one property keeps the others (same semantics as
  // the Phase-21 `updateTextBox` partial merge).
  if (payload.style !== undefined) {
    const v = validateAnnTextStyle(payload.style);
    if (!v.ok) return err('engine-error', v.reason);
    if (Object.keys(v.value).length > 0) {
      ann.style = { ...(ann.style ?? {}), ...v.value };
    }
  }

  return ok({
    ...ann,
    rects: ann.rects.map((r) => ({ ...r })),
    points: ann.points?.map((p) => ({ ...p })),
    lineEnds: ann.lineEnds?.slice(),
    style: ann.style !== undefined
      ? { ...ann.style, highlight: ann.style.highlight ? { ...ann.style.highlight } : undefined }
      : undefined,
  });
}

export function deleteAnnotation(
  annotations: AnnModel[][],
  annId: string,
): Result<null, EngineError> {
  const found = findAnnotation(annotations, annId);
  if (found === null) {
    return err('not-found', `annotation ${annId} not found`);
  }
  const [origIdx, i] = found;
  annotations[origIdx].splice(i, 1);
  return ok(null);
}

// ---------------------------------------------------------------------------
// Drop annotations for a deleted page
// ---------------------------------------------------------------------------

/** Remove annotations for original page index `origIdx`. */
export function dropPageAnnotations(annotations: AnnModel[][], origIdx: number): void {
  delete annotations[origIdx];
}

// ---------------------------------------------------------------------------
// Parse-on-load: best-effort parse of /Annots on each page
// ---------------------------------------------------------------------------

const SUBTYPE_MAP: Record<string, AnnKind> = {
  FreeText: 'text-box',
  Square: 'rect',
  Circle: 'ellipse',
  Text: 'note',
  Ink: 'ink',
  Line: 'arrow',
  Highlight: 'highlight',
  Underline: 'underline',
  Squiggly: 'squiggly',
  StrikeOut: 'strikeout',
};

/** The /Subtype names the load path models into AnnModel and the save path
 *  re-serializes from that model. `stripModeledAnnots` uses this to tell
 *  TFlex's own annotations apart from foreign annotations it does not model
 *  (Widget, Link, Stamp, ...), which must be carried through untouched. */
const MODELED_ANNOT_SUBTYPES: ReadonlySet<string> = new Set(Object.keys(SUBTYPE_MAP));

function parsePdfArray(arr: unknown): number[] | undefined {
  if (!(arr instanceof PDFArray)) return undefined;
  const result: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const el = arr.get(i);
    if (el instanceof PDFNumber) {
      result.push(el.asNumber());
    } else {
      return undefined;
    }
  }
  return result;
}

function parsePdfString(val: unknown): string | undefined {
  if (val instanceof PDFString) return val.decodeText();
  return undefined;
}

function parsePdfNumber(val: unknown): number | undefined {
  if (val instanceof PDFNumber) return val.asNumber();
  return undefined;
}

function parsePdfName(val: unknown): string | undefined {
  if (val instanceof PDFName) {
    const raw = val.asString();
    return raw.startsWith('/') ? raw.slice(1) : raw;
  }
  return undefined;
}

function parsePdfDict(val: unknown): Map<string, unknown> | undefined {
  if (val === undefined || val === null) return undefined;
  const dict = val as any;
  if (typeof dict.entries !== 'function') return undefined;
  const result = new Map<string, unknown>();
  for (const [key, value] of dict.entries()) {
    if (key instanceof PDFName) {
      const raw = key.asString();
      const clean = raw.startsWith('/') ? raw.slice(1) : raw;
      result.set(clean, value);
    }
  }
  return result.size > 0 ? result : undefined;
}

/**
 * Parse one annotation dictionary from a PDF page into an AnnModel.
 * Returns undefined for unsupported subtypes or unparseable annotations.
 *
 * `pageHeight` is the owning page's height in PDF points; /Rect, /QuadPoints,
 * /L, /InkList and /Callout are stored in PDF bottom-left user space, so the
 * parsed geometry is flipped back into the renderer's top-left space (DEF-164).
 */
function parseOneAnnotation(
  annotObj: unknown,
  visiblePage: number,
  pageHeight: number,
): AnnModel | undefined {
  const dict = parsePdfDict(annotObj);
  if (dict === undefined) return undefined;

  const subtype = parsePdfName(dict.get('Subtype'));
  if (subtype === undefined) return undefined;

  let kind = SUBTYPE_MAP[subtype];
  if (kind === undefined) return undefined;

  // Phase 12 — a FreeText with /Intent /FreeTextCallout (or a /Callout entry)
  // is a callout, not a plain text box.
  if (subtype === 'FreeText') {
    const intent = parsePdfName(dict.get('Intent'));
    const hasCallout = dict.get('Callout') !== undefined;
    if (intent === 'FreeTextCallout' || hasCallout) {
      kind = 'callout';
    }
  }

  // Rect
  const rectArr = parsePdfArray(dict.get('Rect'));
  let rects: AnnRect[] = [];
  if (rectArr !== undefined && rectArr.length >= 4) {
    rects.push({
      x: rectArr[0],
      y: rectArr[1],
      width: rectArr[2] - rectArr[0],
      height: rectArr[3] - rectArr[1],
    });
  }

  // Contents (may carry the Phase-24 style sentinel on its first line).
  const rawContents = parsePdfString(dict.get('Contents'));
  const decodedContents = rawContents !== undefined ? decodeAnnotationContents(rawContents) : undefined;
  const contents = decodedContents?.text;
  const style = decodedContents?.style;

  // Color: prefer the verbatim /TFlexColor sidecar (named preset OR free-form
  // hex) so a custom hex round-trips exactly instead of snapping to the
  // nearest named preset. Fall back to /C -> nearestAnnColor for annotations
  // authored by other tools (or older TFlex builds without /TFlexColor).
  const colorArr = parsePdfArray(dict.get('C'));
  let color: string = 'yellow';
  const tflexColor = parsePdfString(dict.get('TFlexColor'));
  if (tflexColor !== undefined && isValidColorValue(tflexColor)) {
    color = tflexColor;
  } else if (colorArr !== undefined && colorArr.length >= 3) {
    color = nearestAnnColor(colorArr[0], colorArr[1], colorArr[2]);
  }

  // Opacity from /CA
  const opacity = parsePdfNumber(dict.get('CA')) ?? undefined;

  // Blend mode from /BM
  const blendMode = parsePdfName(dict.get('BM')) ?? undefined;

  // Width from /BS << /W >>
  let width: number | undefined;
  const bs = parsePdfDict(dict.get('BS'));
  if (bs !== undefined) {
    width = parsePdfNumber(bs.get('W')) ?? undefined;
  }

  // InkList
  let points: AnnPoint[] | undefined;
  const inkListRaw = dict.get('InkList');
  if (inkListRaw instanceof PDFArray) {
    points = [];
    for (let s = 0; s < inkListRaw.size(); s++) {
      const stroke = inkListRaw.get(s);
      const strokeArr = parsePdfArray(stroke);
      if (strokeArr !== undefined) {
        for (let j = 0; j + 1 < strokeArr.length; j += 2) {
          points.push({ x: strokeArr[j], y: strokeArr[j + 1] });
        }
      }
    }
  }

  // Line (/L)
  const lineArr = parsePdfArray(dict.get('L'));
  if (lineArr !== undefined && lineArr.length >= 4) {
    points = [
      { x: lineArr[0], y: lineArr[1] },
      { x: lineArr[2], y: lineArr[3] },
    ];
    const minX = Math.min(lineArr[0], lineArr[2]);
    const minY = Math.min(lineArr[1], lineArr[3]);
    const maxX = Math.max(lineArr[0], lineArr[2]);
    const maxY = Math.max(lineArr[1], lineArr[3]);
    rects = [{ x: minX, y: minY, width: maxX - minX, height: maxY - minY }];
  }

  // Phase 12 — Callout (/Callout): [startX startY kneeX kneeY endX endY] or a
  // 4-number [startX startY endX endY] form. Sets the leader-line points and
  // the `at` anchor (the last point — the tip the arrow points at) so the
  // renderer's callout rendering sees a non-box-corner anchor after a
  // save/reparse round-trip (DEF-157).
  let at: AnnPoint | undefined;
  if (kind === 'callout') {
    const calloutArr = parsePdfArray(dict.get('Callout'));
    if (calloutArr !== undefined && calloutArr.length >= 6) {
      points = [
        { x: calloutArr[0], y: calloutArr[1] },
        { x: calloutArr[2], y: calloutArr[3] },
        { x: calloutArr[4], y: calloutArr[5] },
      ];
      at = { x: calloutArr[4], y: calloutArr[5] };
    } else if (calloutArr !== undefined && calloutArr.length >= 4) {
      points = [
        { x: calloutArr[0], y: calloutArr[1] },
        { x: calloutArr[2], y: calloutArr[3] },
      ];
      at = { x: calloutArr[2], y: calloutArr[3] };
    }
  }

  // LineEnds (/LE)
  let lineEnds: AnnLineEnd[] | undefined;
  const leRaw = dict.get('LE');
  if (leRaw instanceof PDFArray) {
    const leNames: AnnLineEnd[] = [];
    for (let i = 0; i < leRaw.size(); i++) {
      const name = parsePdfName(leRaw.get(i));
      if (name !== undefined) {
        leNames.push(name as AnnLineEnd);
      }
    }
    if (leNames.length > 0) {
      lineEnds = leNames;
    }
  }

  // QuadPoints for text markup annotations
  const quadArr = parsePdfArray(dict.get('QuadPoints'));
  if (quadArr !== undefined && quadArr.length >= 8) {
    rects = [];
    for (let i = 0; i + 7 < quadArr.length; i += 8) {
      const ulx = quadArr[i];
      const uly = quadArr[i + 1];
      const urx = quadArr[i + 2];
      const ury = quadArr[i + 3];
      const llx = quadArr[i + 4];
      const lly = quadArr[i + 5];
      const lrx = quadArr[i + 6];
      const lry = quadArr[i + 7];
      const minX = Math.min(ulx, urx, llx, lrx);
      const minY = Math.min(uly, ury, lly, lry);
      const maxX = Math.max(ulx, urx, llx, lrx);
      const maxY = Math.max(uly, ury, lly, lry);
      rects.push({
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      });
    }
  }

  const subject = parsePdfString(dict.get('Subj'));
  const content = contents ?? subject ?? undefined;

  // DEF-164: flip every parsed geometry from PDF bottom-left user space back
  // to the renderer's top-left space. The rects built above (from /Rect,
  // /QuadPoints or /L) and the points/at (from /L, /InkList, /Callout) are all
  // in bottom-left space at this point. Both serialize and parse use the same
  // page height, so a TFlex save/reopen round-trips exactly.
  const flippedRects = rects.map((r) => pdfRectToTopLeftRect(r, pageHeight));
  const flippedPoints =
    points !== undefined
      ? points.map((p) => ({ x: p.x, y: pdfYToTopLeftY(p.y, pageHeight) }))
      : undefined;
  const flippedAt =
    at !== undefined
      ? { x: at.x, y: pdfYToTopLeftY(at.y, pageHeight) }
      : undefined;

  // Phase 28 (criterion 4) — read the stable id back from /NM (written by
  // `serializeAnnotation`). A legacy file has no /NM, and a hostile value can
  // be a non-string, empty or oversized entry; both cases fall back to a fresh
  // random id so the load path never throws.
  const id = parseAnnotationNameId(dict.get('NM')) ?? randomUUID();

  return {
    id,
    kind,
    page: visiblePage,
    rects: flippedRects.length > 0 ? flippedRects : [{ x: 0, y: 0, width: 0, height: 0 }],
    points: flippedPoints,
    at: flippedAt,
    color,
    content,
    text: content,
    opacity,
    width,
    blendMode,
    lineEnds,
    style,
  };
}

/**
 * Parse all annotations from all pages of a PDFDocument. Returns per-original-
 * page-index arrays of AnnModel.
 */
export function parseAnnotationsFromDoc(pdfDoc: PDFDocument): AnnModel[][] {
  const pageCount = pdfDoc.getPageCount();
  const result: AnnModel[][] = Array.from({ length: pageCount }, () => []);

  for (let i = 0; i < pageCount; i++) {
    const page = pdfDoc.getPage(i);
    const pageHeight = page.getSize().height;
    const pageLeaf = (page as any).node as PDFPageLeaf;
    const annotsRef = pageLeaf.get(PDFName.of('Annots'));

    if (annotsRef === undefined) continue;

    let annotsArray: unknown = annotsRef;
    if (annotsRef instanceof PDFRef) {
      try {
        annotsArray = pdfDoc.context.lookup(annotsRef);
      } catch {
        continue;
      }
    }

    if (!(annotsArray instanceof PDFArray)) continue;

    const visiblePage = i + 1;
    for (let j = 0; j < annotsArray.size(); j++) {
      const annotRef = annotsArray.get(j);
      let annotObj: unknown = annotRef;
      if (annotRef instanceof PDFRef) {
        try {
          annotObj = pdfDoc.context.lookup(annotRef);
        } catch {
          continue;
        }
      }
      const model = parseOneAnnotation(annotObj, visiblePage, pageHeight);
      if (model !== undefined) {
        result[i].push(model);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Serialization: build real /Annots dicts on each page via doc.context.obj
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Coordinate convention flip (DEF-164)
//
// The annotation model stores geometry in the renderer's TOP-LEFT origin
// space (y grows downward, page points at scale 1 — see
// src/renderer/annotations/geometry.ts). PDF annotation dictionaries (/Rect,
// /QuadPoints, /Callout, /L, /InkList) are expressed in the page's BOTTOM-LEFT
// user space (y grows upward). The serialize path must flip top-left -> PDF
// bottom-left; the parse path must flip PDF bottom-left -> top-left. Both use
// the SAME page height so a TFlex round-trip is exact. A page height of 0
// (degenerate MediaBox) is treated as identity to avoid producing NaN.
// ---------------------------------------------------------------------------

/** Flip a top-left rect to a PDF bottom-left /Rect tuple [llx, lly, urx, ury]:
 *  lly = pageHeight - yTop - height, ury = pageHeight - yTop. */
function topLeftRectToPdfRect(
  rect: AnnRect,
  pageHeight: number,
): [number, number, number, number] {
  if (pageHeight <= 0) {
    return [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height];
  }
  return [
    rect.x,
    pageHeight - rect.y - rect.height,
    rect.x + rect.width,
    pageHeight - rect.y,
  ];
}

/** Flip a single top-left y to a PDF bottom-left y: yPdf = pageHeight - yTop. */
function topLeftYToPdfY(yTop: number, pageHeight: number): number {
  return pageHeight > 0 ? pageHeight - yTop : yTop;
}

/** Flip a PDF bottom-left y back to a top-left y: yTop = pageHeight - yPdf. */
function pdfYToTopLeftY(yPdf: number, pageHeight: number): number {
  return pageHeight > 0 ? pageHeight - yPdf : yPdf;
}

/** Flip a whole rect from PDF bottom-left space back to top-left space:
 *  yTop = pageHeight - lly - height. */
function pdfRectToTopLeftRect(rect: AnnRect, pageHeight: number): AnnRect {
  if (pageHeight <= 0) return rect;
  return {
    x: rect.x,
    y: pageHeight - rect.y - rect.height,
    width: rect.width,
    height: rect.height,
  };
}

function makeColorArray(doc: PDFDocument, color: string): PDFArray {
  const [r, g, b] = colorToRgb(color);
  return doc.context.obj([r, g, b]) as PDFArray;
}

function makeRectArray(
  doc: PDFDocument,
  rect: AnnRect,
  pageHeight: number,
): PDFArray {
  return doc.context.obj(topLeftRectToPdfRect(rect, pageHeight)) as PDFArray;
}

function makeLineEndsArray(
  doc: PDFDocument,
  lineEnds: AnnLineEnd[],
): PDFArray {
  return doc.context.obj(lineEnds.map((le) => PDFName.of(le))) as PDFArray;
}

/** Fill alpha for Square/Circle (rect/ellipse) annotation appearance streams.
 *  Matches the renderer's translucent overlay fill (hexWithAlpha(hex, 0.1) in
 *  AnnotationOverlay.tsx). The PDF /IC entry is a plain RGB array with NO
 *  alpha channel, so writing the fill color there paints an OPAQUE block over
 *  page content on reopen (DEF-165). Instead we OMIT /IC and emit an /AP Form
 *  XObject that fills the shape translucently.
 *
 *  DEF-165 (re-fix): `ca` / `CA` are graphics-state parameters, NOT
 *  content-stream operators. Emitting them inline (`0.1 ca`) as content tokens
 *  is invalid PDF syntax, so third-party viewers (pdf.js, Acrobat) ignore the
 *  inline token and paint the fill at full alpha — an opaque block hiding the
 *  page text. The alpha must live in an ExtGState resource and be invoked with
 *  the `gs` operator. We declare `/ExtGState << /G1 << /Type /ExtGState
 *  /ca 0.1 /CA 1 >> >>` under the /AP /N /Resources dict and emit `/G1 gs`
 *  before the fill path, so every viewer honours the 10% alpha. */
const SHAPE_FILL_ALPHA = 0.1;

/** Fill opacity for a Highlight annotation's baked native appearance.
 *  Matches the renderer overlay's committed fill-opacity 0.35 (DEF-173 set
 *  the .ann-highlight overlay to 0.35). pdf.js reads /CA as both the
 *  annotation opacity and the fillAlpha for its synthesized Multiply-blend
 *  appearance (pdf.worker.mjs HighlightAnnotation: `fillAlpha =
 *  dict.get("CA")`); without /CA it defaults to 1 and paints a FULL-opacity
 *  Multiply block over the page text (DEF-174). /CA 0.35 makes the Multiply
 *  fill 35% — on a white page Multiply at 0.35 == normal-blend 0.35, so the
 *  reopened highlight matches the in-session 0.35 wash. Only the Highlight
 *  kind gets this; underline/strikeout/squiggly are intentional solid
 *  strokes and stay opaque. */
const HIGHLIGHT_OPACITY = 0.35;

/** Build a content stream for an ink annotation's appearance. The stream is a
 *  Form XObject drawn in the page's bottom-left user space, so the stroke
 *  points and the /BBox must be flipped from the model's top-left space. */
function buildInkAPStream(
  doc: PDFDocument,
  ann: AnnModel,
  pageHeight: number,
): PDFRef {
  const [r, g, b] = colorToRgb(ann.color);
  const bbox = ann.rects[0];
  if (bbox === undefined) {
    const stream = doc.context.stream(new Uint8Array(0));
    return doc.context.register(stream);
  }

  const w = ann.width ?? 1;
  const lines: string[] = [];
  lines.push('q');
  lines.push(`${r} ${g} ${b} RG`);
  lines.push(`${w} w`);

  if (ann.points !== undefined && ann.points.length > 0) {
    const p0 = ann.points[0];
    lines.push(`${p0.x} ${topLeftYToPdfY(p0.y, pageHeight)} m`);
    for (let i = 1; i < ann.points.length; i++) {
      const p = ann.points[i];
      lines.push(`${p.x} ${topLeftYToPdfY(p.y, pageHeight)} l`);
    }
    lines.push('S');
  }

  lines.push('Q');
  const streamBytes = new TextEncoder().encode(lines.join('\n') + '\n');

  const [llx, lly, urx, ury] = topLeftRectToPdfRect(bbox, pageHeight);
  const stream = doc.context.stream(
    streamBytes,
    doc.context.obj({
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: [llx, lly, urx, ury],
      Resources: doc.context.obj({}),
    }) as any,
  );
  return doc.context.register(stream);
}

/** Build a Form XObject appearance stream for a Square (rect) or Circle
 *  (ellipse) annotation. The shape is filled with the annotation color at
 *  SHAPE_FILL_ALPHA (translucent, via an ExtGState `/ca` non-stroking-alpha
 *  parameter invoked with `/G1 gs`) and stroked with the same color at full
 *  opacity (`/CA 1` in the same ExtGState). This replaces the opaque /IC
 *  interior color, which has no alpha channel and would paint a solid block
 *  hiding the page text behind the shape (DEF-165). The stream is drawn in
 *  the page's bottom-left user space; /BBox is the flipped /Rect. */
function buildShapeAPStream(
  doc: PDFDocument,
  ann: AnnModel,
  pageHeight: number,
  shape: 'rect' | 'ellipse',
): PDFRef {
  const [r, g, b] = colorToRgb(ann.color);
  const bbox = ann.rects[0] ?? { x: 0, y: 0, width: 0, height: 0 };
  const w = ann.width ?? 1.5;
  const [llx, lly, urx, ury] = topLeftRectToPdfRect(bbox, pageHeight);
  const bw = urx - llx;
  const bh = ury - lly;

  // DEF-165 (re-fix): the fill/stroke alpha live in an ExtGState resource,
  // invoked with `/G1 gs`. Inline `ca`/`CA` tokens are not content-stream
  // operators and are ignored by compliant viewers (which then paint the
  // fill at full alpha, hiding page text).
  const gsDict = doc.context.obj({
    Type: 'ExtGState',
    ca: SHAPE_FILL_ALPHA,
    CA: 1,
  });
  const gsRef = doc.context.register(gsDict);

  const lines: string[] = ['q'];
  // Same hue for fill (rg) and stroke (RG); the alpha is applied via the
  // ExtGState below (ca 0.1 for fill, CA 1 for stroke).
  lines.push(`${r} ${g} ${b} rg`);
  lines.push(`${r} ${g} ${b} RG`);
  lines.push('/G1 gs');
  lines.push(`${w} w`);
  if (shape === 'rect') {
    // `re` takes the lower-left corner + width/height.
    lines.push(`${llx} ${lly} ${bw} ${bh} re`);
  } else {
    // 4-cubic-Bezier ellipse approximation (kappa = 0.5522847498).
    const cx = (llx + urx) / 2;
    const cy = (lly + ury) / 2;
    const rx = bw / 2;
    const ry = bh / 2;
    const k = 0.5522847498;
    lines.push(`${cx + rx} ${cy} m`);
    lines.push(`${cx + rx} ${cy + ry * k} ${cx + rx * k} ${cy + ry} ${cx} ${cy + ry} c`);
    lines.push(`${cx - rx * k} ${cy + ry} ${cx - rx} ${cy + ry} ${cx - rx} ${cy} c`);
    lines.push(`${cx - rx} ${cy - ry * k} ${cx - rx * k} ${cy - ry} ${cx} ${cy - ry} c`);
    lines.push(`${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry} ${cx + rx} ${cy} c`);
  }
  lines.push('B'); // fill (nonzero winding) then stroke
  lines.push('Q');
  const streamBytes = new TextEncoder().encode(lines.join('\n') + '\n');

  const stream = doc.context.stream(
    streamBytes,
    doc.context.obj({
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: [llx, lly, urx, ury],
      // Transparency group so the ExtGState `ca` fill alpha is honoured by
      // viewers.
      Group: doc.context.obj({ S: 'Transparency' }),
      Resources: doc.context.obj({ ExtGState: { G1: gsRef } }),
    }) as any,
  );
  return doc.context.register(stream);
}

// ---------------------------------------------------------------------------
// DEF-166: baked FreeText appearance stream (textbox / callout)
// ---------------------------------------------------------------------------

// These mirror the renderer's committed text-box / callout metrics
// (AnnotationOverlay.tsx): the default font is 12pt, the line-height 1.35,
// the inner padding 5pt, and the border 1pt (textbox) / 1.5pt (callout). The
// auto-fit wraps the text at the box's CONTENT width (box minus the inset on
// both sides) then shrinks the font so every wrapped line fits the content
// height, with a 4pt readable floor — the same fit the renderer's
// `fitAnnotationTextSizePx` applies. pdf.js paints THIS baked appearance
// instead of generating its own from /Contents + /DA, so there is exactly one
// authoritative copy of the glyphs on reopen (the renderer overlay suppresses
// its text for parsed annotations via `liveAnnTextIds`).
const FREETEXT_FONT_PT = 12;
const FREETEXT_LINE_HEIGHT = 1.35;
const FREETEXT_PAD_PT = 5;
const FREETEXT_BORDER_PT = 1;
const CALLOUT_BORDER_PT = 1.5;
const FREETEXT_MIN_SIZE_PT = 4;

/**
 * Strip characters that pdf-lib's StandardFonts (WinAnsiEncoding) cannot
 * encode — code points > 0xFF are dropped (non-Latin-1 text cannot be drawn
 * with the bundled standard fonts, the documented Phase 10/11 limitation).
 * Mirrors the engine's `sanitizeForStandardFont` so a non-Latin glyph never
 * throws inside `font.encodeText` while baking the appearance.
 */
function sanitizeForAnnotFont(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20) {
      if (ch === '\n' || ch === '\r' || ch === '\t') {
        out += ch;
      } else {
        out += ' ';
      }
      continue;
    }
    if (code > 0xFF) continue;
    out += ch;
  }
  return out;
}

/** Wrap `text` into lines that fit `maxWidth` at `size` pt using the font's
 *  real glyph widths (the same word-break wrap the renderer's auto-fit uses).
 *  Whitespace is collapsed on word boundaries (`\s+`), matching the renderer's
 *  `fitTextBoxFontSizePx`. */
function wrapTextForFreeText(
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number,
  charSpacing = 0,
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (line.length > 0 && freeTextStyledWidth(font, candidate, size, charSpacing) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** Phase 24 — an operator collector that stands in for a `PDFPage` when the
 *  shared `drawStyledTextLines` (engine.ts) renders a FreeText /AP stream.
 *  That renderer only calls `drawText` + `drawRectangle`; this object
 *  implements exactly those two methods and serialises them to PDF
 *  content-stream operators, so the annotation appearance reuses the Phase-21
 *  styled layout (alignment, highlight bands, underline, baseline shift, list
 *  prefixes, indent) instead of a hand-rolled text loop. */
class ApStreamOps {
  readonly ops: string[] = [];
  /** Phase 27 — the resource name the /AP Resources dict declares for the
   *  embedded font. `Helv` for a StandardFont (unchanged legacy bytes);
   *  the embedded font's own name for a bundled family. The shared renderer
   *  reads this when it hand-emits a `Tf` for a spaced run. */
  readonly fontKey: PDFName;

  constructor(fontKey: PDFName = PDFName.of('Helv')) {
    this.fontKey = fontKey;
  }

  /** Phase 27 — no-op: the /AP stream declares its single font in the Form
   *  XObject Resources. Present so the shared renderer can uniformly register
   *  a font before emitting a spaced run. */
  setFont(_font: PDFFont): void {
    // Intentionally empty — the AP resource dict is built by the caller.
  }

  /** Phase 27 — the shared renderer hand-emits a text object when a style
   *  carries character spacing. Serialise the operators to the stream. */
  pushOperators(...operators: PDFOperator[]): void {
    for (const op of operators) this.ops.push(op.toString());
  }

  drawText(
    text: string,
    options: {
      x: number;
      y: number;
      size: number;
      font: PDFFont;
      color: { red: number; green: number; blue: number };
    },
  ): void {
    const { x, y, size, font, color } = options;
    this.ops.push('BT');
    // `PDFName.asString()` carries the leading slash (`/Helv`), so it is the
    // full operator operand.
    this.ops.push(`${this.fontKey.asString()} ${round3(size)} Tf`);
    this.ops.push(`${round3(color.red)} ${round3(color.green)} ${round3(color.blue)} rg`);
    this.ops.push(`1 0 0 1 ${round3(x)} ${round3(y)} Tm`);
    this.ops.push(`${font.encodeText(text).toString()} Tj`);
    this.ops.push('ET');
  }

  drawRectangle(options: {
    x: number;
    y: number;
    width: number;
    height: number;
    color: { red: number; green: number; blue: number };
  }): void {
    const { x, y, width, height, color } = options;
    this.ops.push(`${round3(color.red)} ${round3(color.green)} ${round3(color.blue)} rg`);
    this.ops.push(`${round3(x)} ${round3(y)} ${round3(width)} ${round3(height)} re`);
    this.ops.push('f');
  }
}

/** Phase 27 — drawn width of `text` including character spacing. Mirrors
 *  engine.ts `styledTextWidth`: `Tc` adds `spacing` after each glyph, and
 *  layout counts the inter-glyph gaps (`glyphCount - 1`). Zero/absent
 *  spacing returns the plain glyph width exactly. */
function freeTextStyledWidth(font: PDFFont, text: string, size: number, charSpacing: number): number {
  const base = font.widthOfTextAtSize(text, size);
  if (charSpacing === 0) return base;
  return base + charSpacing * Math.max(0, Array.from(text).length - 1);
}

/** Phase 24 — width reserved for a per-line list prefix during wrapping.
 *  Mirrors engine.ts `listPrefixWidth` (bullet glyph + gap / widest `999. `).
 *  Phase 27 — character spacing is included. */
function freeTextListPrefixWidth(
  font: PDFFont,
  size: number,
  list: TextStyleFields['list'],
  charSpacing = 0,
): number {
  if (list === 'bullet') return freeTextStyledWidth(font, '\u2022 ', size, charSpacing);
  if (list === 'number') return freeTextStyledWidth(font, '999. ', size, charSpacing);
  return 0;
}

/** Build a Form XObject appearance stream for a FreeText (textbox or callout)
 *  annotation that draws the wrapped text with the annotation's font at the
 *  /DA size and color, applying the same auto-fit the renderer uses. The
 *  stream paints ONLY the text (no border, no background, no leader line): the
 *  renderer overlay keeps the box chrome + callout arrow, and pdf.js paints
 *  this /AP for the glyphs — so there is exactly one copy of the text on
 *  reopen instead of TFlex's draw plus pdf.js's generated appearance
 *  (DEF-166). The /BBox is the flipped /Rect; coordinates use the page's
 *  bottom-left user space.
 *
 *  Phase 24 — the styled layout is delegated to the shared
 *  `drawStyledTextLines` (the same renderer the Phase-21 text-box bake uses)
 *  via the `ApStreamOps` collector. The caller passes the font selected for
 *  the stored bold/italic variant; colour keeps its per-kind value (black for
 *  a plain text box, the annotation colour for a callout).
 *
 *  Phase 27 — `fontName` is the resource name the stream declares (no leading
 *  slash): `Helv` for a StandardFont, or the embedded font's own name for a
 *  bundled family, so the `Tf` operator and the Resources dict always agree. */
function buildFreeTextAPStream(
  doc: PDFDocument,
  ann: AnnModel,
  pageHeight: number,
  font: PDFFont,
  textColor: [number, number, number],
  borderPt: number,
  fontName: string,
): PDFRef {
  const bbox = ann.rects[0] ?? { x: 0, y: 0, width: 0, height: 0 };
  const [llx, lly, urx, ury] = topLeftRectToPdfRect(bbox, pageHeight);
  const bw = Math.max(0, urx - llx);
  const bh = Math.max(0, ury - lly);

  const [tr, tg, tb] = textColor;
  const inset = FREETEXT_PAD_PT + borderPt;
  const contentWidth = Math.max(1, bw - inset * 2);
  const contentHeight = Math.max(1, bh - inset * 2);

  const rawText = ann.content ?? ann.text ?? '';
  const safe = sanitizeForAnnotFont(rawText);

  // Phase 24 — style defaults reproduce the legacy appearance when the
  // annotation carries no style: Helvetica 12, left-aligned, line height 1.35.
  const style = ann.style ?? {};
  const lineHeight = style.lineHeight ?? FREETEXT_LINE_HEIGHT;
  const list = style.list ?? 'none';
  const indent = style.indent ?? 0;
  // Phase 27 — character spacing (tracking) is measured with the wrap/auto-fit
  // and emitted by the shared renderer as `Tc`.
  const charSpacing = style.charSpacing ?? 0;

  // Auto-fit: wrap at the base size (the stored style's `size` when one is
  // carried, otherwise the legacy 12pt), reserving the indent + list-prefix
  // width, then shrink so every wrapped line fits the content height (floor
  // 4pt, cap at the base size). Mirrors `fitTextBoxFontSizePx`.
  const baseSize = style.size ?? FREETEXT_FONT_PT;
  const wrapAt = (s: number): string[] =>
    wrapTextForFreeText(
      font,
      safe,
      s,
      Math.max(1, contentWidth - indent - freeTextListPrefixWidth(font, s, list, charSpacing)),
      charSpacing,
    );
  let size = baseSize;
  let lines = wrapAt(size);
  if (lines.length > 0) {
    const needed = lines.length * size * lineHeight;
    if (needed > contentHeight) {
      size = Math.max(FREETEXT_MIN_SIZE_PT, contentHeight / (lines.length * lineHeight));
      lines = wrapAt(size);
    }
  }
  size = Math.min(baseSize, Math.max(FREETEXT_MIN_SIZE_PT, size));

  // Render through the shared Phase-21 styled-line renderer. `rectTop` is the
  // content box's top in top-left space, so the renderer's
  // `pageHeight - cursorTop - size` baseline is identical to the old
  // first-baseline maths (`ury - inset - size`).
  const collector = new ApStreamOps(PDFName.of(fontName));
  drawStyledTextLines(
    collector as unknown as PDFPage,
    pageHeight,
    lines,
    llx + inset,
    bbox.y + inset,
    contentWidth,
    size,
    font,
    { r: tr, g: tg, b: tb },
    {
      align: style.align ?? 'left',
      lineHeight,
      underline: style.underline ?? false,
      baselineShift: style.baselineShift ?? 0,
      // Phase 24 follow-up — `null` means the stored band was REMOVED; draw
      // no band exactly like an absent highlight.
      highlight: style.highlight ?? undefined,
      list,
      indent,
      charSpacing,
    },
  );
  const ops: string[] = ['q', ...collector.ops, 'Q'];

  const streamBytes = new TextEncoder().encode(ops.join('\n') + '\n');
  const stream = doc.context.stream(
    streamBytes,
    doc.context.obj({
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: [llx, lly, urx, ury],
      Resources: doc.context.obj({ Font: { [fontName]: font.ref } }),
    }) as any,
  );
  return doc.context.register(stream);
}

function round3(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

/**
 * Drop from an output page's /Annots the entries whose /Subtype TFlex models
 * and re-serializes from its own annotation state.
 *
 * DEF-255: pdf-lib's `copyPages` carries the source page's whole /Annots array
 * onto the cloned leaf. `serializeAnnotation` then APPENDs TFlex's freshly
 * serialized dictionaries, so saving a file that was itself written by TFlex
 * (i.e. every save after a reopen) duplicated every modeled annotation — the
 * stale copy kept its old /Contents sentinel and /AP appearance, silently
 * reverting edits such as clearing a highlight. A deleted annotation was also
 * never persisted for the same reason. Stripping the modeled entries first
 * makes serializeAnnotations a replace, not an append.
 *
 * Foreign subtypes TFlex does not model (Widget, Link, Stamp, Popup, ...) are
 * left untouched; Widgets are recreated by the form-field migration.
 */
function stripModeledAnnots(doc: PDFDocument, pageLeaf: PDFPageLeaf): void {
  const annotsRef = pageLeaf.get(PDFName.of('Annots'));
  if (annotsRef === undefined) return;
  let arr: unknown = annotsRef;
  if (annotsRef instanceof PDFRef) {
    arr = doc.context.lookup(annotsRef);
  }
  if (!(arr instanceof PDFArray)) return;
  const kept: unknown[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const el = arr.get(i);
    let obj: unknown = el;
    if (el instanceof PDFRef) {
      try {
        obj = doc.context.lookup(el);
      } catch {
        obj = undefined;
      }
    }
    const subtype = obj instanceof PDFDict ? parsePdfName(obj.get(PDFName.of('Subtype'))) : undefined;
    if (subtype !== undefined && MODELED_ANNOT_SUBTYPES.has(subtype)) continue;
    kept.push(el);
  }
  pageLeaf.set(PDFName.of('Annots'), doc.context.obj(kept as any));
}

/**
 * Serialize one AnnModel into a PDF annotation dictionary and add it to the
 * page's /Annots array. `pageHeight` is the page's height in PDF points
 * (page.getSize().height); every y coordinate in /Rect, /QuadPoints, /Callout,
 * /L and /InkList is flipped from the model's top-left space to PDF bottom-left
 * user space (DEF-164).
 */
function serializeAnnotation(
  doc: PDFDocument,
  page: PDFPageLeaf,
  ann: AnnModel,
  pageHeight: number,
  font: PDFFont,
): void {
  const bbox = ann.rects[0] ?? { x: 0, y: 0, width: 0, height: 0 };
  const dictEntries: Array<[string, unknown]> = [
    ['Type', PDFName.of('Annot')],
    ['Subtype', subtypeName(ann.kind)],
    ['Rect', makeRectArray(doc, bbox, pageHeight)],
    ['C', makeColorArray(doc, ann.color)],
  ];

  // Carry the source color (named preset OR free-form hex) verbatim so the
  // exact value survives parse-on-load. The /C RGB array alone cannot
  // distinguish a custom hex from a named preset whose RGB happens to match
  // (e.g. #00ff00 and the 'green' preset both map to [0,1,0]), which would
  // collapse custom hexes to the nearest named preset on reparse. /TFlexColor
  // is a private, non-standard field ignored by other PDF viewers.
  dictEntries.push(['TFlexColor', PDFString.of(ann.color)]);

  // Phase 28 (criterion 4) — persist the annotation's stable id in /NM (the
  // standard PDF annotation "name" entry) so identity survives save/reopen and
  // the comment threads keyed by `annotationId` still match after a reload.
  // Only a non-empty, bounded string id is written; a malformed one is left
  // out and the read path assigns a fresh id.
  if (
    typeof ann.id === 'string' &&
    ann.id.length > 0 &&
    ann.id.length <= MAX_ANNOTATION_ID_LENGTH
  ) {
    dictEntries.push(['NM', PDFString.of(ann.id)]);
  }

  // Phase 24 — /Contents may carry the style sentinel as its first line so the
  // text-properties panel can be re-populated on reopen (see
  // `encodeAnnotationContents`). Legacy/absent styles leave the string as-is.
  const contents = encodeAnnotationContents(ann);
  if (contents !== undefined && contents.length > 0) {
    dictEntries.push(['Contents', PDFString.of(contents)]);
  }

  if (ann.opacity !== undefined) {
    dictEntries.push(['CA', PDFNumber.of(ann.opacity)]);
  }

  if (ann.blendMode !== undefined) {
    dictEntries.push(['BM', PDFName.of(ann.blendMode)]);
  }

  if (ann.width !== undefined && (ann.kind === 'ink' || ann.kind === 'arrow' || ann.kind === 'rect' || ann.kind === 'ellipse')) {
    dictEntries.push(['BS', doc.context.obj({ W: ann.width })]);
  }

  // Phase 27 — the /AP resource name for this annotation's font (no leading
  // slash): `Helv` for a StandardFont (legacy bytes unchanged), the embedded
  // font's own name for a bundled family. The /DA string and the appearance
  // stream's Resources dict must name the same resource, so both derive from
  // this one value.
  const apFontName = isBundledEditFont(ann.style?.font ?? 'Helvetica') ? font.name : 'Helv';

  switch (ann.kind) {
    case 'text-box': {
      // DEF-166: bake a real /AP /N appearance stream drawing the wrapped
      // text with a StandardFont at the /DA size (12pt) and color (black for
      // a plain text box). With /AP present, pdf.js paints this appearance
      // instead of generating its own from /Contents + /DA, so there is
      // exactly one copy of the glyphs on reopen — the renderer overlay
      // suppresses its text for parsed annotations via `liveAnnTextIds`.
      dictEntries.push(['DA', PDFString.of(`/${apFontName} 12 Tf 0 0 0 rg`)]);
      const apRef = buildFreeTextAPStream(
        doc, ann, pageHeight, font, [0, 0, 0], FREETEXT_BORDER_PT, apFontName,
      );
      dictEntries.push(['AP', doc.context.obj({ N: apRef })]);
      break;
    }
    case 'callout': {
      // A callout is a FreeText annotation with /Intent /FreeTextCallout and
      // a /Callout array describing the leader line (start, optional knee,
      // end). The cloud border the Phase 12 spec calls for is a proprietary
      // Acrobat appearance effect pdf-lib does not generate, so the border is
      // a solid line (/BS /S) — the dict carries the callout geometry so a
      // compliant viewer renders the leader line and the text box. This is
      // the documented Phase 12 callout limit.
      const [r, g, b] = colorToRgb(ann.color);
      dictEntries.push(['Intent', PDFName.of('FreeTextCallout')]);
      dictEntries.push(['IT', PDFName.of('FreeTextCallout')]);
      // /Callout encodes the leader line as [startX startY kneeX kneeY endX
      // endY] where end is the anchor tip. Prefer an explicit `points` leader
      // (start[/knee]/end); otherwise — when the renderer sent only `at` +
      // `rect` (the common callout shape, no explicit leader) — emit a straight
      // leader from the text-box center to the `at` anchor so the anchor
      // survives save/reparse and the arrow line is non-zero length (DEF-157).
      if (ann.points !== undefined && ann.points.length >= 2) {
        const p0 = ann.points[0];
        const pEnd = ann.points[ann.points.length - 1];
        let calloutArr: number[];
        if (ann.points.length >= 3) {
          const knee = ann.points[1];
          calloutArr = [
            p0.x, topLeftYToPdfY(p0.y, pageHeight),
            knee.x, topLeftYToPdfY(knee.y, pageHeight),
            pEnd.x, topLeftYToPdfY(pEnd.y, pageHeight),
          ];
        } else {
          calloutArr = [
            p0.x, topLeftYToPdfY(p0.y, pageHeight),
            p0.x, topLeftYToPdfY(p0.y, pageHeight),
            pEnd.x, topLeftYToPdfY(pEnd.y, pageHeight),
          ];
        }
        dictEntries.push(['Callout', doc.context.obj(calloutArr)]);
      } else if (ann.at !== undefined) {
        const box = ann.rects[0] ?? { x: 0, y: 0, width: 0, height: 0 };
        const cx = box.x + box.width / 2;
        const cyTop = box.y + box.height / 2;
        const cy = topLeftYToPdfY(cyTop, pageHeight);
        dictEntries.push(['Callout', doc.context.obj([
          cx, cy, cx, cy,
          ann.at.x, topLeftYToPdfY(ann.at.y, pageHeight),
        ])]);
      }
      const w = ann.width ?? 1;
      dictEntries.push(['BS', doc.context.obj({ W: w, S: 'S' })]);
      dictEntries.push(['DA', PDFString.of(`/${apFontName} 12 Tf ${r} ${g} ${b} rg`)]);
      // DEF-166: bake a real /AP /N appearance stream drawing the wrapped text
      // at the /DA size (12pt) and the annotation color. The leader line is
      // NOT drawn here — pdf.js uses the /AP for the whole callout
      // appearance, and the renderer overlay draws the leader arrow as an
      // SVG (never canvas-painted), so the text appears exactly once and the
      // arrow survives. /AP present means pdf.js will not generate its own
      // FreeText appearance from /Contents + /DA.
      const apRef = buildFreeTextAPStream(
        doc, ann, pageHeight, font, [r, g, b], CALLOUT_BORDER_PT, apFontName,
      );
      dictEntries.push(['AP', doc.context.obj({ N: apRef })]);
      break;
    }
    case 'note': {
      dictEntries.push(['Name', PDFName.of('Note')]);
      break;
    }
    case 'ink': {
      if (ann.points !== undefined && ann.points.length > 0) {
        const inkList = doc.context.obj([
          ann.points.flatMap((p) => [p.x, topLeftYToPdfY(p.y, pageHeight)]),
        ]);
        dictEntries.push(['InkList', inkList]);
        const apRef = buildInkAPStream(doc, ann, pageHeight);
        dictEntries.push(['AP', doc.context.obj({ N: apRef })]);
      }
      break;
    }
    case 'arrow': {
      if (ann.points !== undefined && ann.points.length >= 2) {
        dictEntries.push(['L', doc.context.obj([
          ann.points[0].x, topLeftYToPdfY(ann.points[0].y, pageHeight),
          ann.points[1].x, topLeftYToPdfY(ann.points[1].y, pageHeight),
        ])]);
      }
      if (ann.lineEnds !== undefined && ann.lineEnds.length >= 2) {
        dictEntries.push(['LE', makeLineEndsArray(doc, ann.lineEnds)]);
      } else {
        dictEntries.push(['LE', doc.context.obj([PDFName.of('OpenArrow'), PDFName.of('None')])]);
      }
      if (ann.content !== undefined) {
dictEntries.push(['Contents', PDFString.of(ann.content)]);
      }
      break;
    }
    case 'highlight':
    case 'underline':
    case 'squiggly':
    case 'strikeout': {
      const allQuads: number[] = [];
      for (const rect of ann.rects) {
        // QuadPoints are [P1(ul) P2(ur) P3(ll) P4(lr)] in PDF bottom-left user
        // space. ul/ur are the upper edge (yPdf = pageHeight - yTop); ll/lr are
        // the lower edge (yPdf = pageHeight - yTop - height).
        const yUpper = topLeftYToPdfY(rect.y, pageHeight);
        const yLower = topLeftYToPdfY(rect.y + rect.height, pageHeight);
        allQuads.push(
          rect.x,              yUpper,
          rect.x + rect.width, yUpper,
          rect.x,              yLower,
          rect.x + rect.width, yLower,
        );
      }
      dictEntries.push(['QuadPoints', doc.context.obj(allQuads)]);

      // DEF-174: bake a translucent native appearance on the Highlight dict so
      // a reopened highlight renders ~0.35 (matching the in-session fill-opacity
      // 0.35 the overlay uses per DEF-173). pdf.js reads /CA as the annotation
      // opacity AND as the fillAlpha for its synthesized Multiply-blend
      // appearance (pdf.worker.mjs HighlightAnnotation); without /CA it
      // defaults to 1 and paints a FULL-opacity opaque block hiding the text.
      // Underline/strikeout/squiggly are intentional solid strokes and do NOT
      // get this — only the highlight. This /CA push overrides the generic
      // /CA from `ann.opacity` above (Object.fromEntries keeps the last value
      // for duplicate keys), so a reparsed highlight whose /CA was a different
      // value re-bakes as 0.35 to match the overlay render.
      if (ann.kind === 'highlight') {
        dictEntries.push(['CA', PDFNumber.of(HIGHLIGHT_OPACITY)]);
      }
      break;
    }
    case 'rect': {
      // DEF-165: do NOT write /IC — it is a plain RGB array with no alpha and
      // would paint an opaque solid block over page text. The translucent
      // (10%) fill is expressed in the /AP appearance stream via `ca`.
      const apRef = buildShapeAPStream(doc, ann, pageHeight, 'rect');
      dictEntries.push(['AP', doc.context.obj({ N: apRef })]);
      break;
    }
    case 'ellipse': {
      // DEF-165: same as rect — omit /IC, emit a translucent /AP fill.
      const apRef = buildShapeAPStream(doc, ann, pageHeight, 'ellipse');
      dictEntries.push(['AP', doc.context.obj({ N: apRef })]);
      break;
    }
  }

  const dictObj = doc.context.obj(Object.fromEntries(dictEntries) as any);
  const annotRef = doc.context.register(dictObj);
  page.addAnnot(annotRef);
}

function subtypeName(kind: AnnKind): PDFName {
  switch (kind) {
    case 'text-box': return PDFName.of('FreeText');
    case 'callout': return PDFName.of('FreeText');
    case 'rect': return PDFName.of('Square');
    case 'ellipse': return PDFName.of('Circle');
    case 'note': return PDFName.of('Text');
    case 'ink': return PDFName.of('Ink');
    case 'arrow': return PDFName.of('Line');
    case 'highlight': return PDFName.of('Highlight');
    case 'underline': return PDFName.of('Underline');
    case 'squiggly': return PDFName.of('Squiggly');
    case 'strikeout': return PDFName.of('StrikeOut');
  }
}

/**
 * Serialize all annotations onto the pages of a freshly-built output PDF.
 *
 * Async because baking the FreeText (textbox/callout) /AP appearance streams
 * (DEF-166) requires embedding a StandardFont (Helvetica), which is an async
 * pdf-lib operation. The font is embedded ONCE per save and shared by every
 * textbox/callout appearance on every page. Embedding a second time would
 * register a duplicate font dict; reusing the single ref keeps the output
 * small.
 */
export async function serializeAnnotations(
  outDoc: PDFDocument,
  annotations: AnnModel[][],
  order: number[],
): Promise<void> {
  // Phase 24 / Phase 27 — the font is selected per annotation from its stored
  // family + bold/italic style (defaulting to Helvetica for a legacy
  // annotation). `embedEditFont` caches the result per (document, family,
  // bold, italic): a StandardFont for the three base-14 families, a subset of
  // the bundled TTF for a Phase-27 family. A missing/unreadable bundled font
  // file throws a FontEmbedError naming the family, which the save path maps
  // to a typed engine-error (never a silent substitution).
  const pageCount = outDoc.getPageCount();
  for (let vi = 0; vi < order.length && vi < pageCount; vi++) {
    const origIdx = order[vi];
    const pageAnns = annotations[origIdx];
    const outPage = outDoc.getPage(vi);
    const pageHeight = outPage.getSize().height;
    const pageLeaf = (outPage as any).node as PDFPageLeaf;
    // DEF-255: remove the modeled annotations `copyPages` carried over from the
    // source page so re-serializing below REPLACES them instead of duplicating.
    stripModeledAnnots(outDoc, pageLeaf);
    if (pageAnns === undefined || pageAnns.length === 0) continue;
    if (pageLeaf.get(PDFName.of('Annots')) === undefined) {
      pageLeaf.set(PDFName.of('Annots'), outDoc.context.obj([]));
    }
    for (const ann of pageAnns) {
      // Only the FreeText kinds bake a text /AP; the font is unused otherwise.
      const style = ann.style ?? {};
      const font = await embedEditFont(outDoc, style.font ?? 'Helvetica', style.bold ?? false, style.italic ?? false);
      serializeAnnotation(outDoc, pageLeaf, ann, pageHeight, font);
    }
  }
}