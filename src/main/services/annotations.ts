import { randomUUID } from 'node:crypto';
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
  type PDFFont,
  type PDFPageLeaf,
} from 'pdf-lib';
import { err, ok, type Result } from '../../shared/result';
import type {
  AnnColor,
  AnnColorValue,
  AnnKind,
  AnnLineEnd,
  AnnModel,
  AnnPoint,
  AnnRect,
  CreateAnnotationPayload,
  EditAnnotationPayload,
  EngineError,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Color constants
// ---------------------------------------------------------------------------

export const ANN_COLOR_RGB: Record<AnnColor, [number, number, number]> = {
  yellow:  [1, 1, 0],
  green:   [0, 1, 0],
  blue:    [0, 0, 1],
  red:     [1, 0, 0],
  orange:  [1, 0.5, 0],
  purple:  [0.5, 0, 0.5],
  cyan:    [0, 1, 1],
  magenta: [1, 0, 1],
  white:   [1, 1, 1],
};

const ANN_COLORS: AnnColor[] = [
  'yellow', 'green', 'blue', 'red', 'orange', 'purple', 'cyan', 'magenta', 'white',
];

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
  if (isAnnColor(color)) return ANN_COLOR_RGB[color];
  const hex = hexToRgb(color);
  if (hex !== null) return hex;
  return ANN_COLOR_RGB.yellow;
}

/** Normalize an incoming color string from the wire. A named preset or a hex
 *  is preserved verbatim; anything else (missing/empty/unknown) falls back to
 *  'yellow' so the annotation is still created with a usable color. */
export function normalizeColorValue(color: string | undefined): string {
  if (color !== undefined && isValidColorValue(color)) return color;
  return 'yellow';
}

// ---------------------------------------------------------------------------
// Renderer Annotation -> internal AnnModel conversion
// ---------------------------------------------------------------------------

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
    const primary: AnnRect = {
      x: payload.rect.x,
      y: payload.rect.y,
      width: payload.rect.width,
      height: payload.rect.height,
    };
    if (payload.rects !== undefined && payload.rects.length > 1) {
      rects = [
        primary,
        ...payload.rects.slice(1).map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
      ];
    } else {
      rects = [primary];
    }
  } else if (payload.at !== undefined) {
    // note: the icon is anchored at `at` — derive the icon rect from `at`
    // rather than backfilling from a stale `rects[0]` (which lost the move).
    // (callout reaches the `rect` branch above before this; its `at` anchor
    // is preserved separately via `at: payload.at` on the returned model.)
    rects = [{ x: payload.at.x, y: payload.at.y, width: 24, height: 24 }];
  } else if (payload.rects !== undefined && payload.rects.length > 0) {
    rects = payload.rects.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
  } else if (payload.from !== undefined && payload.to !== undefined) {
    // Arrow: compute bbox from endpoints
    const minX = Math.min(payload.from.x, payload.to.x);
    const minY = Math.min(payload.from.y, payload.to.y);
    const maxX = Math.max(payload.from.x, payload.to.x);
    const maxY = Math.max(payload.from.y, payload.to.y);
    rects = [{ x: minX, y: minY, width: maxX - minX, height: maxY - minY }];
  } else {
    rects = [{ x: 0, y: 0, width: 0, height: 0 }];
  }

  let points: AnnPoint[] | undefined;
  if (payload.from !== undefined && payload.to !== undefined) {
    points = [{ x: payload.from.x, y: payload.from.y }, { x: payload.to.x, y: payload.to.y }];
  } else if (payload.points !== undefined && payload.points.length > 0) {
    points = payload.points.map((p) => ({ x: p.x, y: p.y }));
  }

  const content = payload.content ?? payload.text;

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
  };
}

function normalizeKind(k: string): AnnKind {
  switch (k) {
    case 'textbox':
      return 'text-box';
    default:
      // The AnnKind union covers text-box/rect/ellipse/note/ink/arrow/highlight/underline/squiggly/strikeout
      // Check if k is a valid AnnKind after the above remapping
      return k as AnnKind;
  }
}

// ---------------------------------------------------------------------------
// Annotation storage helpers (engine-internal)
// ---------------------------------------------------------------------------

/** Clone the per-original-page annotations array. */
export function cloneAnnotations(anns: AnnModel[][]): AnnModel[][] {
  return anns.map((pageAnns) => pageAnns.map((a) => ({ ...a, rects: a.rects.map((r) => ({ ...r })), points: a.points?.map((p) => ({ ...p })), at: a.at !== undefined ? { ...a.at } : undefined, lineEnds: a.lineEnds?.slice() })));
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

  const model = normalizeAnnotationPayload(payload);

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

  return ok({ ...ann, rects: ann.rects.map((r) => ({ ...r })), points: ann.points?.map((p) => ({ ...p })), lineEnds: ann.lineEnds?.slice() });
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

  // Contents
  const contents = parsePdfString(dict.get('Contents'));

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

  return {
    id: randomUUID(),
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
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (line.length > 0 && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** Build a Form XObject appearance stream for a FreeText (textbox or callout)
 *  annotation that draws the wrapped text with a StandardFont (Helvetica) at
 *  the /DA size and color, applying the same auto-fit the renderer uses. The
 *  stream paints ONLY the text (no border, no background, no leader line): the
 *  renderer overlay keeps the box chrome + callout arrow, and pdf.js paints
 *  this /AP for the glyphs — so there is exactly one copy of the text on
 *  reopen instead of TFlex's draw plus pdf.js's generated appearance
 *  (DEF-166). The /BBox is the flipped /Rect; coordinates use the page's
 *  bottom-left user space. */
function buildFreeTextAPStream(
  doc: PDFDocument,
  ann: AnnModel,
  pageHeight: number,
  font: PDFFont,
  textColor: [number, number, number],
  borderPt: number,
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

  // Auto-fit: wrap at the user size, then shrink so every line fits the
  // content height (floor 4pt, cap at the user size). Mirrors
  // `fitTextBoxFontSizePx`.
  const lines = wrapTextForFreeText(font, safe, FREETEXT_FONT_PT, contentWidth);
  let size = FREETEXT_FONT_PT;
  if (lines.length > 0) {
    const needed = lines.length * size * FREETEXT_LINE_HEIGHT;
    if (needed > contentHeight) {
      size = Math.max(FREETEXT_MIN_SIZE_PT, contentHeight / (lines.length * FREETEXT_LINE_HEIGHT));
    }
  }
  size = Math.min(FREETEXT_FONT_PT, Math.max(FREETEXT_MIN_SIZE_PT, size));
  const lineStep = size * FREETEXT_LINE_HEIGHT;

  const ops: string[] = ['q', 'BT'];
  ops.push(`/Helv ${round3(size)} Tf`);
  ops.push(`${tr} ${tg} ${tb} rg`);
  // First baseline: top of the content box (ury - inset) minus the font size.
  let y = ury - inset - size;
  const x = llx + inset;
  for (const ln of lines) {
    ops.push(`1 0 0 1 ${round3(x)} ${round3(y)} Tm`);
    ops.push(`${font.encodeText(ln).toString()} Tj`);
    y -= lineStep;
  }
  ops.push('ET', 'Q');

  const streamBytes = new TextEncoder().encode(ops.join('\n') + '\n');
  const stream = doc.context.stream(
    streamBytes,
    doc.context.obj({
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: [llx, lly, urx, ury],
      Resources: doc.context.obj({ Font: { Helv: font.ref } }),
    }) as any,
  );
  return doc.context.register(stream);
}

function round3(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
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

  if (ann.content !== undefined && ann.content.length > 0) {
    dictEntries.push(['Contents', PDFString.of(ann.content)]);
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

  switch (ann.kind) {
    case 'text-box': {
      // DEF-166: bake a real /AP /N appearance stream drawing the wrapped
      // text with a StandardFont at the /DA size (12pt) and color (black for
      // a plain text box). With /AP present, pdf.js paints this appearance
      // instead of generating its own from /Contents + /DA, so there is
      // exactly one copy of the glyphs on reopen — the renderer overlay
      // suppresses its text for parsed annotations via `liveAnnTextIds`.
      dictEntries.push(['DA', PDFString.of('/Helv 12 Tf 0 0 0 rg')]);
      const apRef = buildFreeTextAPStream(
        doc, ann, pageHeight, font, [0, 0, 0], FREETEXT_BORDER_PT,
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
      dictEntries.push(['DA', PDFString.of(`/Helv 12 Tf ${r} ${g} ${b} rg`)]);
      // DEF-166: bake a real /AP /N appearance stream drawing the wrapped text
      // at the /DA size (12pt) and the annotation color. The leader line is
      // NOT drawn here — pdf.js uses the /AP for the whole callout
      // appearance, and the renderer overlay draws the leader arrow as an
      // SVG (never canvas-painted), so the text appears exactly once and the
      // arrow survives. /AP present means pdf.js will not generate its own
      // FreeText appearance from /Contents + /DA.
      const apRef = buildFreeTextAPStream(
        doc, ann, pageHeight, font, [r, g, b], CALLOUT_BORDER_PT,
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
  // Embed the standard font once for all FreeText appearance streams. Only
  // needed when at least one textbox/callout exists; embed unconditionally —
  // it is cheap and keeps the call sites simple.
  const font = await outDoc.embedFont(StandardFonts.Helvetica);

  const pageCount = outDoc.getPageCount();
  for (let vi = 0; vi < order.length && vi < pageCount; vi++) {
    const origIdx = order[vi];
    const pageAnns = annotations[origIdx];
    if (pageAnns === undefined || pageAnns.length === 0) continue;
    const outPage = outDoc.getPage(vi);
    const pageHeight = outPage.getSize().height;
    const pageLeaf = (outPage as any).node as PDFPageLeaf;
    if (pageLeaf.get(PDFName.of('Annots')) === undefined) {
      pageLeaf.set(PDFName.of('Annots'), outDoc.context.obj([]));
    }
    for (const ann of pageAnns) {
      serializeAnnotation(outDoc, pageLeaf, ann, pageHeight, font);
    }
  }
}