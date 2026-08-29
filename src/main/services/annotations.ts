import { randomUUID } from 'node:crypto';
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFPageLeaf,
} from 'pdf-lib';
import { err, ok, type Result } from '../../shared/result';
import type {
  AnnColor,
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
  const color: AnnColor = isAnnColor(payload.color) ? payload.color : 'yellow';

  let rects: AnnRect[];
  if (payload.rects !== undefined && payload.rects.length > 0) {
    rects = payload.rects.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
  } else if (payload.rect !== undefined) {
    rects = [{ x: payload.rect.x, y: payload.rect.y, width: payload.rect.width, height: payload.rect.height }];
  } else if (payload.from !== undefined && payload.to !== undefined) {
    // Arrow: compute bbox from endpoints
    const minX = Math.min(payload.from.x, payload.to.x);
    const minY = Math.min(payload.from.y, payload.to.y);
    const maxX = Math.max(payload.from.x, payload.to.x);
    const maxY = Math.max(payload.from.y, payload.to.y);
    rects = [{ x: minX, y: minY, width: maxX - minX, height: maxY - minY }];
  } else if (payload.at !== undefined) {
    // Note: icon anchored at 'at'
    rects = [{ x: payload.at.x, y: payload.at.y, width: 24, height: 24 }];
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
  return anns.map((pageAnns) => pageAnns.map((a) => ({ ...a, rects: a.rects.map((r) => ({ ...r })), points: a.points?.map((p) => ({ ...p })), lineEnds: a.lineEnds?.slice() })));
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
    ann.color = isAnnColor(payload.color) ? payload.color : ann.color;
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
 */
function parseOneAnnotation(
  annotObj: unknown,
  visiblePage: number,
): AnnModel | undefined {
  const dict = parsePdfDict(annotObj);
  if (dict === undefined) return undefined;

  const subtype = parsePdfName(dict.get('Subtype'));
  if (subtype === undefined) return undefined;

  const kind = SUBTYPE_MAP[subtype];
  if (kind === undefined) return undefined;

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

  // Color from /C array
  const colorArr = parsePdfArray(dict.get('C'));
  let color: AnnColor = 'yellow';
  if (colorArr !== undefined && colorArr.length >= 3) {
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

  return {
    id: randomUUID(),
    kind,
    page: visiblePage,
    rects: rects.length > 0 ? rects : [{ x: 0, y: 0, width: 0, height: 0 }],
    points,
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
      const model = parseOneAnnotation(annotObj, visiblePage);
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

function makeColorArray(doc: PDFDocument, color: AnnColor): PDFArray {
  const [r, g, b] = ANN_COLOR_RGB[color];
  return doc.context.obj([r, g, b]) as PDFArray;
}

function makeRectArray(doc: PDFDocument, rect: AnnRect): PDFArray {
  return doc.context.obj([
    rect.x,
    rect.y,
    rect.x + rect.width,
    rect.y + rect.height,
  ]) as PDFArray;
}

function makeLineEndsArray(
  doc: PDFDocument,
  lineEnds: AnnLineEnd[],
): PDFArray {
  return doc.context.obj(lineEnds.map((le) => PDFName.of(le))) as PDFArray;
}

/** Build a content stream for an ink annotation's appearance. */
function buildInkAPStream(
  doc: PDFDocument,
  ann: AnnModel,
): PDFRef {
  const [r, g, b] = ANN_COLOR_RGB[ann.color];
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
    lines.push(`${ann.points[0].x} ${ann.points[0].y} m`);
    for (let i = 1; i < ann.points.length; i++) {
      lines.push(`${ann.points[i].x} ${ann.points[i].y} l`);
    }
    lines.push('S');
  }

  lines.push('Q');
  const streamBytes = new TextEncoder().encode(lines.join('\n') + '\n');

  const stream = doc.context.stream(
    streamBytes,
    doc.context.obj({
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: [
        bbox.x,
        bbox.y,
        bbox.x + bbox.width,
        bbox.y + bbox.height,
      ],
      Resources: doc.context.obj({}),
    }) as any,
  );
  return doc.context.register(stream);
}

/**
 * Serialize one AnnModel into a PDF annotation dictionary and add it to the
 * page's /Annots array.
 */
function serializeAnnotation(
  doc: PDFDocument,
  page: PDFPageLeaf,
  ann: AnnModel,
): void {
  const bbox = ann.rects[0] ?? { x: 0, y: 0, width: 0, height: 0 };
  const dictEntries: Array<[string, unknown]> = [
    ['Type', PDFName.of('Annot')],
    ['Subtype', subtypeName(ann.kind)],
    ['Rect', makeRectArray(doc, bbox)],
    ['C', makeColorArray(doc, ann.color)],
  ];

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
      dictEntries.push(['DA', PDFString.of('/Helv 12 Tf 0 0 0 rg')]);
      break;
    }
    case 'note': {
      dictEntries.push(['Name', PDFName.of('Note')]);
      break;
    }
    case 'ink': {
      if (ann.points !== undefined && ann.points.length > 0) {
        const inkList = doc.context.obj([
          ann.points.flatMap((p) => [p.x, p.y]),
        ]);
        dictEntries.push(['InkList', inkList]);
        const apRef = buildInkAPStream(doc, ann);
        dictEntries.push(['AP', doc.context.obj({ N: apRef })]);
      }
      break;
    }
    case 'arrow': {
      if (ann.points !== undefined && ann.points.length >= 2) {
        dictEntries.push(['L', doc.context.obj([
          ann.points[0].x, ann.points[0].y,
          ann.points[1].x, ann.points[1].y,
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
        allQuads.push(
          rect.x,              rect.y + rect.height,
          rect.x + rect.width, rect.y + rect.height,
          rect.x,              rect.y,
          rect.x + rect.width, rect.y,
        );
      }
      dictEntries.push(['QuadPoints', doc.context.obj(allQuads)]);
      break;
    }
    case 'rect': {
      dictEntries.push(['IC', makeColorArray(doc, ann.color)]);
      break;
    }
    case 'ellipse': {
      dictEntries.push(['IC', makeColorArray(doc, ann.color)]);
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
 */
export function serializeAnnotations(
  outDoc: PDFDocument,
  annotations: AnnModel[][],
  order: number[],
): void {
  const pageCount = outDoc.getPageCount();
  for (let vi = 0; vi < order.length && vi < pageCount; vi++) {
    const origIdx = order[vi];
    const pageAnns = annotations[origIdx];
    if (pageAnns === undefined || pageAnns.length === 0) continue;
    const outPage = outDoc.getPage(vi);
    const pageLeaf = (outPage as any).node as PDFPageLeaf;
    if (pageLeaf.get(PDFName.of('Annots')) === undefined) {
      pageLeaf.set(PDFName.of('Annots'), outDoc.context.obj([]));
    }
    for (const ann of pageAnns) {
      serializeAnnotation(outDoc, pageLeaf, ann);
    }
  }
}