import { randomUUID } from 'node:crypto';
import type {
  AnnKind,
  AnnModel,
  AnnPoint,
  AnnRect,
} from '../../shared/types';
import { colorToRgb, isValidColorValue, nearestAnnColor } from './annotations';

// ---------------------------------------------------------------------------
// Phase 12 — FDF (Forms Data Format) comments export/import
//
// FDF is a PDF subset used for comments/annotations interchange. An FDF file
// is structurally a minimal PDF whose root dict has a /FDF entry containing
// /Annots — an array of annotation dicts. Acrobat and most viewers export
// comments this way, so a TFlex FDF round-trips with external comment stores.
//
// This is a self-contained, dependency-light FDF reader/writer. The writer
// serializes the engine's in-memory annotation model (visible order) into an
// /Annots array; the reader parses that array back into AnnModel[] (mapped to
// visible pages via /Page). pdf-lib cannot load FDF directly (it rejects the
// `%FDF` header), so the reader is a small bracket-matching parser over the
// latin1 text. Only the fields the engine round-trips are handled; unknown
// fields are ignored (best-effort, matching the annotation parser).
// ---------------------------------------------------------------------------

const SUBTYPE_TO_KIND: Record<string, AnnKind> = {
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

/** Map an AnnKind back to the PDF /Subtype name (mirrors annotations.ts). */
function kindToSubtype(kind: AnnKind): string {
  switch (kind) {
    case 'text-box': return 'FreeText';
    case 'rect': return 'Square';
    case 'ellipse': return 'Circle';
    case 'note': return 'Text';
    case 'ink': return 'Ink';
    case 'arrow': return 'Line';
    case 'highlight': return 'Highlight';
    case 'underline': return 'Underline';
    case 'squiggly': return 'Squiggly';
    case 'strikeout': return 'StrikeOut';
    case 'callout': return 'FreeText'; // callout is a FreeText with /Intent
  }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/** Escape a string for a PDF literal string `( ... )`. */
function pdfEscape(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch === '\\' || ch === '(' || ch === ')') out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else out += ch;
  }
  return out;
}

/** Format a number for PDF (trim trailing zeros, avoid exponential). */
function pdfNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number(n.toFixed(4)).toString();
}

/**
 * Serialize the engine's per-original-page annotations into an FDF byte
 * buffer. Annotations are emitted in VISIBLE order with a 0-based /Page so
 * `parseFdf` can place them back onto the right visible page. /Rect uses the
 * bottom-left PDF convention (DEF-164): the model stores top-left rects, so
 * `pageHeights[origIdx]` is used to flip y to PDF bottom-left user space for
 * /Rect, /QuadPoints, /Callout, /L and /InkList.
 */
export function exportFdf(
  annotations: AnnModel[][],
  order: number[],
  pageHeights: number[],
): Uint8Array {
  const lines: string[] = [];
  lines.push('%FDF-1.2');
  lines.push('1 0 obj');
  lines.push('<<');
  lines.push('/FDF');
  lines.push('<<');
  lines.push('/Annots [');

  for (let vi = 0; vi < order.length; vi++) {
    const origIdx = order[vi];
    const pageAnns = annotations[origIdx];
    if (pageAnns === undefined || pageAnns.length === 0) continue;
    const pageHeight = pageHeights[origIdx] ?? 0;
    for (const ann of pageAnns) {
      lines.push(serializeFdfAnnot(ann, vi, pageHeight));
    }
  }

  lines.push(']');
  lines.push('>>');
  lines.push('>>');
  lines.push('endobj');
  lines.push('trailer');
  lines.push('<<');
  lines.push('/Root 1 0 R');
  lines.push('>>');
  lines.push('startxref');
  lines.push('0');
  lines.push('%%EOF');

  const text = lines.join('\n');
  return new TextEncoder().encode(text);
}

function serializeFdfAnnot(ann: AnnModel, visiblePage0: number, pageHeight: number): string {
  const rect = ann.rects[0] ?? { x: 0, y: 0, width: 0, height: 0 };
  const [r, g, b] = colorToRgb(ann.color);
  // DEF-164: flip top-left rect to PDF bottom-left /Rect.
  const lly = pageHeight > 0 ? pageHeight - rect.y - rect.height : rect.y;
  const ury = pageHeight > 0 ? pageHeight - rect.y : rect.y + rect.height;
  const parts: string[] = [];
  parts.push('<<');
  parts.push('/Type /Annot');
  parts.push(`/Subtype /${kindToSubtype(ann.kind)}`);
  parts.push(`/Rect [${pdfNum(rect.x)} ${pdfNum(lly)} ${pdfNum(rect.x + rect.width)} ${pdfNum(ury)}]`);
  parts.push(`/C [${pdfNum(r)} ${pdfNum(g)} ${pdfNum(b)}]`);
  // Carry the source color (named preset OR free-form hex) verbatim so a
  // custom hex round-trips exactly through FDF import (mirrors the PDF
  // /TFlexColor sidecar used by serializeAnnotations).
  parts.push(`/TFlexColor (${pdfEscape(ann.color)})`);
  parts.push(`/Page ${visiblePage0}`);
  if (ann.content !== undefined && ann.content.length > 0) {
    parts.push(`/Contents (${pdfEscape(ann.content)})`);
  }
  if (ann.kind === 'callout') {
    parts.push('/Intent /FreeTextCallout');
    // /Callout: [startX startY kneeX kneeY endX endY] (3 points) or a 2-point
    // form. Prefer an explicit `points` leader; otherwise — when the
    // renderer sent only `at` + `rect` — emit a straight leader from the
    // text-box center to the `at` anchor so the anchor round-trips (DEF-157).
    // y is flipped to PDF bottom-left space (DEF-164).
    const flipY = (yTop: number) => (pageHeight > 0 ? pageHeight - yTop : yTop);
    if (ann.points !== undefined && ann.points.length >= 2) {
      const p0 = ann.points[0];
      const pEnd = ann.points[ann.points.length - 1];
      if (ann.points.length >= 3) {
        const knee = ann.points[1];
        parts.push(`/Callout [${pdfNum(p0.x)} ${pdfNum(flipY(p0.y))} ${pdfNum(knee.x)} ${pdfNum(flipY(knee.y))} ${pdfNum(pEnd.x)} ${pdfNum(flipY(pEnd.y))}]`);
      } else {
        parts.push(`/Callout [${pdfNum(p0.x)} ${pdfNum(flipY(p0.y))} ${pdfNum(p0.x)} ${pdfNum(flipY(p0.y))} ${pdfNum(pEnd.x)} ${pdfNum(flipY(pEnd.y))}]`);
      }
    } else if (ann.at !== undefined) {
      const cx = rect.x + rect.width / 2;
      const cy = flipY(rect.y + rect.height / 2);
      parts.push(`/Callout [${pdfNum(cx)} ${pdfNum(cy)} ${pdfNum(cx)} ${pdfNum(cy)} ${pdfNum(ann.at.x)} ${pdfNum(flipY(ann.at.y))}]`);
    }
    parts.push(`/DA /Helv 12 Tf ${pdfNum(r)} ${pdfNum(g)} ${pdfNum(b)} rg`);
  }
  if ((ann.kind === 'highlight' || ann.kind === 'underline' || ann.kind === 'squiggly' || ann.kind === 'strikeout') && ann.rects.length > 0) {
    // QuadPoints [ul ur ll lr] in PDF bottom-left space (DEF-164).
    const quads: string[] = [];
    for (const rct of ann.rects) {
      const yUpper = pageHeight > 0 ? pageHeight - rct.y : rct.y + rct.height;
      const yLower = pageHeight > 0 ? pageHeight - rct.y - rct.height : rct.y;
      quads.push(
        `${pdfNum(rct.x)} ${pdfNum(yUpper)}`,
        `${pdfNum(rct.x + rct.width)} ${pdfNum(yUpper)}`,
        `${pdfNum(rct.x)} ${pdfNum(yLower)}`,
        `${pdfNum(rct.x + rct.width)} ${pdfNum(yLower)}`,
      );
    }
    parts.push(`/QuadPoints [${quads.join(' ')}]`);
  }
  if (ann.kind === 'arrow' && ann.points !== undefined && ann.points.length >= 2) {
    const flipY = (yTop: number) => (pageHeight > 0 ? pageHeight - yTop : yTop);
    parts.push(`/L [${pdfNum(ann.points[0].x)} ${pdfNum(flipY(ann.points[0].y))} ${pdfNum(ann.points[1].x)} ${pdfNum(flipY(ann.points[1].y))}]`);
    if (ann.lineEnds !== undefined && ann.lineEnds.length >= 2) {
      parts.push(`/LE [/${ann.lineEnds[0]} /${ann.lineEnds[1]}]`);
    } else {
      parts.push('/LE [/OpenArrow /None]');
    }
  }
  if (ann.kind === 'ink' && ann.points !== undefined && ann.points.length > 0) {
    const flipY = (yTop: number) => (pageHeight > 0 ? pageHeight - yTop : yTop);
    const flat = ann.points.map((p) => `${pdfNum(p.x)} ${pdfNum(flipY(p.y))}`).join(' ');
    parts.push(`/InkList [${flat}]`);
  }
  if (ann.width !== undefined && (ann.kind === 'ink' || ann.kind === 'arrow' || ann.kind === 'rect' || ann.kind === 'ellipse' || ann.kind === 'callout')) {
    parts.push(`/BS << /W ${pdfNum(ann.width)} /S /S >>`);
  }
  if (ann.opacity !== undefined) {
    parts.push(`/CA ${pdfNum(ann.opacity)}`);
  }
  if (ann.blendMode !== undefined) {
    parts.push(`/BM /${ann.blendMode}`);
  }
  parts.push('>>');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/**
 * Parse an FDF buffer and return the annotations as AnnModel[] (one entry per
 * /Annots item), with `page` set to the 1-based VISIBLE page from the /Page
 * field (defaulting to 1 when /Page is absent). Each entry gets a fresh id.
 *
 * `pageHeights` is indexed by 0-based VISIBLE page; it is used to flip the
 * parsed /Rect, /QuadPoints, /Callout, /L and /InkList geometry from PDF
 * bottom-left user space back into the renderer's top-left space (DEF-164).
 * A missing entry (or undefined pageHeights) leaves that annotation's
 * geometry un-flipped so a caller that does not know the page heights can
 * still parse the non-geometric fields.
 *
 * Best-effort: extracts /Subtype, /Rect, /Contents, /C, /Page, /Subj, /Callout,
 * /Intent, /QuadPoints, /L, /InkList, /LE, /BS./W, /CA, /BM. Unknown subtypes
 * are skipped (the engine does not model them).
 */
export function parseFdf(
  fdfBytes: Uint8Array,
  pageHeights?: number[],
): AnnModel[] {
  const text = new TextDecoder('latin1').decode(fdfBytes);
  if (!text.includes('%FDF')) {
    throw new Error('not an FDF file (missing %FDF header)');
  }
  const annotsArray = extractAnnotsArray(text);
  if (annotsArray === null) return [];
  const dictTexts = splitTopLevelDicts(annotsArray);
  const out: AnnModel[] = [];
  for (const dictText of dictTexts) {
    const model = parseFdfAnnot(dictText, pageHeights);
    if (model !== null) out.push(model);
  }
  return out;
}

/** Find the contents of the /Annots array (the text between its `[` and the
 *  matching `]`). Returns null if /Annots is absent or malformed. */
function extractAnnotsArray(text: string): string | null {
  return extractArrayContents(text, '/Annots');
}

/** Find the contents of the array named `key` (the text between its `[` and
 *  the matching `]`). Returns null if the key is absent or malformed. Shared
 *  by the annotation (/Annots) and form-value (/Fields) readers. */
function extractArrayContents(text: string, key: string): string | null {
  const idx = text.indexOf(key);
  if (idx < 0) return null;
  // Find the next '[' after the key.
  const bracketIdx = text.indexOf('[', idx + key.length);
  if (bracketIdx < 0) return null;
  // Match brackets (depth count, ignoring brackets inside strings).
  let depth = 0;
  let inString = false;
  for (let i = bracketIdx; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === ')') inString = false;
      continue;
    }
    if (ch === '(') inString = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return text.slice(bracketIdx + 1, i);
    }
  }
  return null;
}

/** Split the /Annots array contents into top-level `<< ... >>` dict texts. */
function splitTopLevelDicts(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    // Skip whitespace.
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    if (text[i] === '<' && text[i + 1] === '<') {
      // Match << ... >> with nesting.
      let depth = 0;
      let inString = false;
      let j = i;
      for (; j < text.length; j++) {
        const ch = text[j];
        if (inString) {
          if (ch === '\\') { j++; continue; }
          if (ch === ')') inString = false;
          continue;
        }
        if (ch === '(') inString = true;
        else if (ch === '<' && text[j + 1] === '<') { depth++; j++; }
        else if (ch === '>' && text[j + 1] === '>') { depth--; j++; if (depth === 0) break; }
      }
      out.push(text.slice(i, j + 1));
      i = j + 1;
    } else {
      i++;
    }
  }
  return out;
}

/** Decode a PDF literal string body (between the parens), handling escapes. */
function decodeStringLiteral(body: string): string {
  let out = '';
  let i = 0;
  while (i < body.length) {
    if (body[i] === '\\') {
      i++;
      if (i >= body.length) break;
      const c = body[i];
      if (c === 'n') out += '\n';
      else if (c === 'r') out += '\r';
      else if (c === 't') out += '\t';
      else if (c === 'b') out += '\b';
      else if (c === 'f') out += '\f';
      else if (c >= '0' && c <= '7') {
        let octal = '';
        let j = 0;
        while (j < 3 && i + j < body.length && body[i + j] >= '0' && body[i + j] <= '7') {
          octal += body[i + j];
          j++;
        }
        out += String.fromCharCode(parseInt(octal, 8));
        i += j - 1;
      } else {
        out += c;
      }
    } else {
      out += body[i];
    }
    i++;
  }
  return out;
}

/** Decode a PDF hex string body to a Latin-1 string. */
function decodeHexString(body: string): string {
  let hex = body.replace(/\s/g, '');
  if (hex.length % 2 !== 0) hex += '0';
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return new TextDecoder('windows-1252').decode(bytes);
}

/** Extract the value text for `key` (a `/Name`) from a dict text. */
function extractValueText(dictText: string, key: string): string | null {
  const k = key.startsWith('/') ? key : '/' + key;
  const idx = dictText.indexOf(k);
  if (idx < 0) return null;
  // Skip the key and any whitespace (but NOT a leading '/', which begins a
  // name value like /FreeText — eating it would make parseName reject it).
  let i = idx + k.length;
  while (i < dictText.length && /\s/.test(dictText[i])) i++;
  if (i >= dictText.length) return null;
  const ch = dictText[i];
  if (ch === '(') {
    // Literal string — match parens with escapes.
    let depth = 1;
    let j = i + 1;
    let inEsc = false;
    for (; j < dictText.length; j++) {
      const c = dictText[j];
      if (inEsc) { inEsc = false; continue; }
      if (c === '\\') { inEsc = true; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
    }
    return dictText.slice(i, j + 1);
  }
  if (ch === '<' && dictText[i + 1] !== '<') {
    // Hex string — match to '>'.
    const end = dictText.indexOf('>', i);
    if (end < 0) return null;
    return dictText.slice(i, end + 1);
  }
  if (ch === '[') {
    // Array — match brackets with nesting and string awareness.
    let depth = 0;
    let inString = false;
    let j = i;
    for (; j < dictText.length; j++) {
      const c = dictText[j];
      if (inString) {
        if (c === '\\') { j++; continue; }
        if (c === ')') inString = false;
        continue;
      }
      if (c === '(') inString = true;
      else if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) break; }
    }
    return dictText.slice(i, j + 1);
  }
  if (ch === '<' && dictText[i + 1] === '<') {
    // Nested dict — match << ... >>.
    let depth = 0;
    let j = i;
    for (; j < dictText.length; j++) {
      if (dictText[j] === '<' && dictText[j + 1] === '<') { depth++; j++; }
      else if (dictText[j] === '>' && dictText[j + 1] === '>') { depth--; j++; if (depth === 0) break; }
    }
    return dictText.slice(i, j + 1);
  }
  // Name (starts with '/') or number token — read until whitespace or a
  // delimiter, but do NOT stop at '/' (names are /Foo, read in full).
  let j = i;
  while (j < dictText.length && !/[\s<\[\]()>]/.test(dictText[j])) j++;
  return dictText.slice(i, j);
}

function parseString(valueText: string | null): string {
  if (valueText === null) return '';
  if (valueText.startsWith('(') && valueText.endsWith(')')) {
    return decodeStringLiteral(valueText.slice(1, -1));
  }
  if (valueText.startsWith('<') && valueText.endsWith('>') && !valueText.startsWith('<<')) {
    return decodeHexString(valueText.slice(1, -1));
  }
  return valueText;
}

function parseNumberArray(text: string | null): number[] {
  if (text === null) return [];
  const inner = text.replace(/^\[/, '').replace(/\]$/, '');
  const nums: number[] = [];
  for (const tok of inner.split(/\s+/)) {
    if (tok.length === 0) continue;
    const n = Number(tok);
    if (Number.isFinite(n)) nums.push(n);
  }
  return nums;
}

function parseName(valueText: string | null): string | null {
  if (valueText === null || !valueText.startsWith('/')) return null;
  return valueText.slice(1);
}

function parseFdfAnnot(dictText: string, pageHeights?: number[]): AnnModel | null {
  const subtype = parseName(extractValueText(dictText, '/Subtype'));
  if (subtype === null) return null;
  let kind: AnnKind | undefined = SUBTYPE_TO_KIND[subtype];
  if (kind === undefined) return null;

  // FreeText with /Intent /FreeTextCallout (or a /Callout entry) is a callout.
  if (kind === 'text-box') {
    const intent = parseName(extractValueText(dictText, '/Intent'));
    const hasCallout = extractValueText(dictText, '/Callout') !== null;
    if (intent === 'FreeTextCallout' || hasCallout) {
      kind = 'callout';
    }
  }

  const pageText = extractValueText(dictText, '/Page');
  const pageNum = pageText !== null ? Number(pageText) : 0;
  const page = (Number.isInteger(pageNum) && pageNum >= 0 ? pageNum + 1 : 1);

  const rectArr = parseNumberArray(extractValueText(dictText, '/Rect'));
  let rects: AnnRect[] = [];
  if (rectArr.length >= 4) {
    rects.push({
      x: rectArr[0],
      y: rectArr[1],
      width: rectArr[2] - rectArr[0],
      height: rectArr[3] - rectArr[1],
    });
  }

  const colorArr = parseNumberArray(extractValueText(dictText, '/C'));
  let color: string = 'yellow';
  const tflexColor = parseString(extractValueText(dictText, '/TFlexColor'));
  if (tflexColor.length > 0 && isValidColorValue(tflexColor)) {
    color = tflexColor;
  } else if (colorArr.length >= 3) {
    color = nearestAnnColor(colorArr[0], colorArr[1], colorArr[2]);
  }

  let content: string | undefined;
  const contents = parseString(extractValueText(dictText, '/Contents'));
  if (contents.length > 0) content = contents;
  else {
    const subj = parseString(extractValueText(dictText, '/Subj'));
    if (subj.length > 0) content = subj;
  }

  // Text markup: rebuild rects from QuadPoints if present (more accurate).
  const quadArr = parseNumberArray(extractValueText(dictText, '/QuadPoints'));
  if (quadArr.length >= 8) {
    rects = [];
    for (let i = 0; i + 7 < quadArr.length; i += 8) {
      const xs = [quadArr[i], quadArr[i + 2], quadArr[i + 4], quadArr[i + 6]];
      const ys = [quadArr[i + 1], quadArr[i + 3], quadArr[i + 5], quadArr[i + 7]];
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      rects.push({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    }
  }

  let points: AnnPoint[] | undefined;
  let at: AnnPoint | undefined;
  if (kind === 'arrow') {
    const lArr = parseNumberArray(extractValueText(dictText, '/L'));
    if (lArr.length >= 4) {
      points = [{ x: lArr[0], y: lArr[1] }, { x: lArr[2], y: lArr[3] }];
    }
  } else if (kind === 'ink') {
    const inkArr = parseNumberArray(extractValueText(dictText, '/InkList'));
    if (inkArr.length >= 2) {
      points = [];
      for (let i = 0; i + 1 < inkArr.length; i += 2) {
        points.push({ x: inkArr[i], y: inkArr[i + 1] });
      }
    }
  } else if (kind === 'callout') {
    const calloutArr = parseNumberArray(extractValueText(dictText, '/Callout'));
    if (calloutArr.length >= 6) {
      points = [
        { x: calloutArr[0], y: calloutArr[1] },
        { x: calloutArr[2], y: calloutArr[3] },
        { x: calloutArr[4], y: calloutArr[5] },
      ];
      at = { x: calloutArr[4], y: calloutArr[5] };
    } else if (calloutArr.length >= 4) {
      points = [
        { x: calloutArr[0], y: calloutArr[1] },
        { x: calloutArr[2], y: calloutArr[3] },
      ];
      at = { x: calloutArr[2], y: calloutArr[3] };
    }
  }

  let lineEnds: AnnModel['lineEnds'] | undefined;
  const leText = extractValueText(dictText, '/LE');
  if (leText !== null && leText.startsWith('[')) {
    const names = leText.replace(/^\[/, '').replace(/\]$/, '').split(/\s+/);
    const le: string[] = [];
    for (const n of names) if (n.startsWith('/')) le.push(n.slice(1));
    if (le.length >= 2) lineEnds = le as AnnModel['lineEnds'];
  }

  let width: number | undefined;
  const bsText = extractValueText(dictText, '/BS');
  if (bsText !== null) {
    const wText = extractValueText(bsText, '/W');
    if (wText !== null) {
      const w = Number(wText);
      if (Number.isFinite(w)) width = w;
    }
  }

  let opacity: number | undefined;
  const caText = extractValueText(dictText, '/CA');
  if (caText !== null) {
    const ca = Number(caText);
    if (Number.isFinite(ca)) opacity = ca;
  }

  let blendMode: string | undefined;
  const bmName = parseName(extractValueText(dictText, '/BM'));
  if (bmName !== null) blendMode = bmName;

  // DEF-164: flip the parsed geometry from PDF bottom-left user space back to
  // the renderer's top-left space using the destination page's height. FDF does
  // not carry page dimensions, so the caller supplies them (indexed by 0-based
  // visible page); when absent the geometry is returned as-is.
  const pageHeight = pageHeights !== undefined ? pageHeights[page - 1] : undefined;
  const canFlip = pageHeight !== undefined && pageHeight > 0;
  const flipRect = (rc: AnnRect): AnnRect =>
    canFlip
      ? { x: rc.x, y: pageHeight! - rc.y - rc.height, width: rc.width, height: rc.height }
      : rc;
  const flipY = (yPdf: number): number =>
    canFlip ? pageHeight! - yPdf : yPdf;
  const flippedRects = rects.map(flipRect);
  const flippedPoints =
    points !== undefined
      ? points.map((p) => ({ x: p.x, y: flipY(p.y) }))
      : undefined;
  const flippedAt =
    at !== undefined
      ? { x: at.x, y: flipY(at.y) }
      : undefined;

  return {
    id: randomUUID(),
    kind,
    page,
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

// ---------------------------------------------------------------------------
// Phase 57-B — form-VALUE FDF / XFDF interchange
//
// The helpers above interchange ANNOTATIONS (an /Annots array of annot dicts).
// Form values are a different payload: an FDF /Fields array of
// `<< /T (name) /V (value) >>` dicts, or the XFDF XML equivalent. Both codecs
// live here so the app keeps a single FDF engine (Phase 57 feature B), reusing
// splitTopLevelDicts / extractArrayContents / decodeHexString /
// decodeStringLiteral / pdfEscape below and hand-rolling the small XFDF scan
// (the app has no XML dependency by design).
//
// Bounds (documented ceiling, both writers and both parsers):
//   FORM_DATA_MAX_ENTRIES = 10,000 field entries per document.
//   FORM_DATA_MAX_BYTES   = 8 MiB (8,388,608). For FDF this is the encoded
//     buffer size; for XFDF it is the string length in UTF-16 code units.
// An input above either ceiling throws a descriptive Error and a writer whose
// payload would exceed FORM_DATA_MAX_BYTES throws before emitting; nothing
// scans or allocates unbounded.
//
// FDF string values are written ASCII-only: printable ASCII goes through the
// existing `pdfEscape`, every other code point is emitted as the octal escapes
// of its UTF-8 bytes, so a latin1 re-read (parseFdf's decoder) reconstructs
// the original Unicode. XFDF uses the five predefined XML entities.
// ---------------------------------------------------------------------------

const FORM_DATA_MAX_ENTRIES = 10_000;
const FORM_DATA_MAX_BYTES = 8 * 1024 * 1024; // 8,388,608

/** One form-field name/value pair (the interchange unit both codecs carry). */
export interface FormValueEntry {
  name: string;
  value: string;
}

function assertFormEntryCount(values: FormValueEntry[]): void {
  if (values.length > FORM_DATA_MAX_ENTRIES) {
    throw new Error(
      `form data exceeds the ${FORM_DATA_MAX_ENTRIES}-entry ceiling`,
    );
  }
}

/** Escape a form string for a PDF literal `( ... )`: reuse `pdfEscape` for
 *  printable ASCII, emit everything else as the octal escapes of its UTF-8
 *  bytes so the value survives a latin1 read-back as original Unicode. */
function formPdfEscape(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 32 && code <= 126) {
      out += pdfEscape(ch);
    } else if (ch === '\n') {
      out += '\\n';
    } else if (ch === '\r') {
      out += '\\r';
    } else if (ch === '\t') {
      out += '\\t';
    } else {
      for (const b of new TextEncoder().encode(ch)) {
        out += '\\' + b.toString(8).padStart(3, '0');
      }
    }
  }
  return out;
}

/** Decode a form string written by `formPdfEscape`: the existing
 *  decodeStringLiteral yields the bytes as a latin1 string, which we then
 *  UTF-8 decode back to the original text. */
function decodeFormString(body: string): string {
  const latin = decodeStringLiteral(body);
  const bytes = new Uint8Array(latin.length);
  for (let i = 0; i < latin.length; i++) bytes[i] = latin.charCodeAt(i) & 0xff;
  return new TextDecoder('utf-8').decode(bytes);
}

/** Decode a form value token (literal, hex or bare) — mirrors `parseString`
 *  but uses the UTF-8-aware form decoder for literal strings. */
function parseFormString(valueText: string | null): string {
  if (valueText === null) return '';
  if (valueText.startsWith('(') && valueText.endsWith(')')) {
    return decodeFormString(valueText.slice(1, -1));
  }
  if (valueText.startsWith('<') && valueText.endsWith('>') && !valueText.startsWith('<<')) {
    return decodeHexString(valueText.slice(1, -1));
  }
  return valueText;
}

/**
 * Serialize form values into an FDF byte buffer: `%FDF-1.2`, one indirect
 * object whose /FDF dict holds a /Fields array of `<< /T (name) /V (value) >>`
 * dicts, then a trailer and `%%EOF`. Names/values are PDF-escaped.
 */
export function exportFormFdf(values: FormValueEntry[]): Uint8Array {
  assertFormEntryCount(values);
  const lines: string[] = [];
  lines.push('%FDF-1.2');
  lines.push('1 0 obj');
  lines.push('<<');
  lines.push('/FDF');
  lines.push('<<');
  lines.push('/Fields [');
  let size = 40;
  for (const entry of values) {
    const line = `<< /T (${formPdfEscape(entry.name)}) /V (${formPdfEscape(entry.value)}) >>`;
    size += line.length + 1;
    if (size > FORM_DATA_MAX_BYTES) {
      throw new Error(`form data exceeds the ${FORM_DATA_MAX_BYTES}-byte ceiling`);
    }
    lines.push(line);
  }
  lines.push(']');
  lines.push('>>');
  lines.push('>>');
  lines.push('endobj');
  lines.push('trailer');
  lines.push('<<');
  lines.push('/Root 1 0 R');
  lines.push('>>');
  lines.push('startxref');
  lines.push('0');
  lines.push('%%EOF');
  return new TextEncoder().encode(lines.join('\n'));
}

/** Read the value token starting at `start`, returning its raw text and the
 *  index just past it. Understands literal strings, hex strings, arrays and
 *  nested dicts so a container value is consumed whole. */
function readToken(text: string, start: number): { text: string; end: number } {
  const ch = text[start];
  if (ch === '(') {
    let depth = 1;
    let i = start + 1;
    let esc = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) { i++; break; } }
    }
    return { text: text.slice(start, i), end: i };
  }
  if (ch === '<' && text[start + 1] === '<') {
    let depth = 0;
    let i = start;
    for (; i < text.length; i++) {
      if (text[i] === '<' && text[i + 1] === '<') { depth++; i++; }
      else if (text[i] === '>' && text[i + 1] === '>') { depth--; i++; if (depth === 0) { i++; break; } }
    }
    return { text: text.slice(start, i), end: i };
  }
  if (ch === '<') {
    const end = text.indexOf('>', start);
    if (end < 0) return { text: text.slice(start), end: text.length };
    return { text: text.slice(start, end + 1), end: end + 1 };
  }
  if (ch === '[') {
    let depth = 0;
    let inString = false;
    let i = start;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === '\\') { i++; continue; }
        if (c === ')') inString = false;
        continue;
      }
      if (c === '(') inString = true;
      else if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) { i++; break; } }
    }
    return { text: text.slice(start, i), end: i };
  }
  let i = start;
  if (ch !== '/') {
    while (i < text.length && !/[\s/<>\[\]()]/.test(text[i])) i++;
  } else {
    i++;
    while (i < text.length && !/[\s<>\[\]()]/.test(text[i])) i++;
  }
  return { text: text.slice(start, i), end: i };
}

/** Read the top-level `/Key value` pairs of a `<< ... >>` dict text. Nested
 *  containers are consumed whole so a key inside a /Kids dict is not mistaken
 *  for a top-level key. A key whose value is absent yields an empty value. */
function readFormDictEntries(dictText: string): Map<string, string> {
  const out = new Map<string, string>();
  const inner = dictText.startsWith('<<')
    ? dictText.slice(2, dictText.length - 2)
    : dictText;
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /\s/.test(inner[i])) i++;
    if (i >= inner.length) break;
    if (inner[i] !== '/') { i++; continue; }
    let j = i + 1;
    while (j < inner.length && !/[\s/<>\[\]()]/.test(inner[j])) j++;
    const key = inner.slice(i + 1, j);
    i = j;
    while (i < inner.length && /\s/.test(inner[i])) i++;
    if (i >= inner.length) { out.set(key, ''); break; }
    const token = readToken(inner, i);
    i = token.end > i ? token.end : i + 1;
    out.set(key, token.text);
  }
  return out;
}

/**
 * Parse an FDF buffer into form-name/value entries in document order. Throws
 * when the `%FDF` header is missing; a malformed /Fields array yields `[]`.
 * Extra keys and unknown key order are tolerated; a dict without /T is skipped
 * and a dict without /V yields an empty value.
 */
export function parseFormFdf(bytes: Uint8Array): FormValueEntry[] {
  if (bytes.length > FORM_DATA_MAX_BYTES) {
    throw new Error(`FDF input exceeds the ${FORM_DATA_MAX_BYTES}-byte ceiling`);
  }
  const text = new TextDecoder('latin1').decode(bytes);
  if (!text.includes('%FDF')) {
    throw new Error('not an FDF file (missing %FDF header)');
  }
  const fieldsArray = extractArrayContents(text, '/Fields');
  if (fieldsArray === null) return [];
  const dictTexts = splitTopLevelDicts(fieldsArray);
  const out: FormValueEntry[] = [];
  for (const dictText of dictTexts) {
    const entries = readFormDictEntries(dictText);
    const name = entries.get('T');
    if (name === undefined) continue;
    const value = entries.get('V');
    out.push({
      name: parseFormString(name),
      value: parseFormString(value === undefined ? null : value),
    });
    if (out.length > FORM_DATA_MAX_ENTRIES) {
      throw new Error(`FDF input exceeds the ${FORM_DATA_MAX_ENTRIES}-entry ceiling`);
    }
  }
  return out;
}

/** Escape XML text/attribute content for the five predefined entities. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Decode the five predefined XML entities plus numeric character refs. */
function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body === 'amp') return '&';
    if (body === 'lt') return '<';
    if (body === 'gt') return '>';
    if (body === 'quot') return '"';
    if (body === 'apos') return "'";
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const n = parseInt(body.slice(2), 16);
      return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    if (body.startsWith('#')) {
      const n = parseInt(body.slice(1), 10);
      return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return whole;
  });
}

/**
 * Serialize form values to XFDF XML. Names and values are XML-escaped; the
 * document declares the xfdf namespace.
 */
export function exportFormXfdf(values: FormValueEntry[]): string {
  assertFormEntryCount(values);
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<xfdf xmlns="http://ns.adobe.com/xfdf/">');
  parts.push('<fields>');
  let size = 80;
  for (const entry of values) {
    const line =
      `<field name="${xmlEscape(entry.name)}">` +
      `<value>${xmlEscape(entry.value)}</value>` +
      `</field>`;
    size += line.length + 1;
    if (size > FORM_DATA_MAX_BYTES) {
      throw new Error(`form data exceeds the ${FORM_DATA_MAX_BYTES}-byte ceiling`);
    }
    parts.push(line);
  }
  parts.push('</fields>');
  parts.push('</xfdf>');
  return parts.join('\n');
}

/** Read the value of the named attribute from a single tag's text. */
function readXmlAttr(tagText: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`);
  const m = re.exec(tagText);
  if (m === null) return null;
  return m[2] !== undefined ? m[2] : m[3];
}

/**
 * Parse XFDF XML into form-name/value entries in document order using a small
 * hand-rolled scanner (no XML library). Throws when the `<xfdf` root is
 * missing. Attribute order is free; a missing or self-closing `<value>` yields
 * an empty string; XML entities are decoded.
 */
export function parseFormXfdf(xml: string): FormValueEntry[] {
  if (xml.length > FORM_DATA_MAX_BYTES) {
    throw new Error(`XFDF input exceeds the ${FORM_DATA_MAX_BYTES}-byte ceiling`);
  }
  const rootIdx = xml.search(/<(?!\?|!)/);
  if (rootIdx < 0 || xml.slice(rootIdx, rootIdx + 5).toLowerCase() !== '<xfdf') {
    throw new Error('not an XFDF document (missing <xfdf> root)');
  }
  const out: FormValueEntry[] = [];
  let i = rootIdx + 5;
  while (i < xml.length) {
    const fi = xml.indexOf('<field', i);
    if (fi < 0) break;
    const after = xml[fi + 6];
    if (after !== undefined && !/[\s/>]/.test(after)) { i = fi + 6; continue; }
    const tagEnd = xml.indexOf('>', fi);
    if (tagEnd < 0) break;
    const tagText = xml.slice(fi, tagEnd + 1);
    const selfClosing = /\/\s*>$/.test(tagText);
    const name = readXmlAttr(tagText, 'name');
    let value = '';
    let next = tagEnd + 1;
    if (!selfClosing) {
      const closeField = xml.indexOf('</field', tagEnd + 1);
      const fieldEnd = closeField < 0 ? xml.length : closeField;
      const vi = xml.indexOf('<value', tagEnd + 1);
      const vafter = vi < 0 ? undefined : xml[vi + 6];
      if (vi >= 0 && vi < fieldEnd && (vafter === '>' || vafter === '/' || vafter === ' ' || vafter === '\t')) {
        const vTagEnd = xml.indexOf('>', vi);
        if (vTagEnd >= 0) {
          if (!/\/\s*>$/.test(xml.slice(vi, vTagEnd + 1))) {
            const vClose = xml.indexOf('</value', vTagEnd + 1);
            const vEnd = vClose < 0 ? fieldEnd : vClose;
            value = decodeXmlEntities(xml.slice(vTagEnd + 1, vEnd));
          }
        }
      }
      next = closeField < 0 ? xml.length : closeField + 7;
    }
    if (name !== null) out.push({ name: decodeXmlEntities(name), value });
    if (out.length > FORM_DATA_MAX_ENTRIES) {
      throw new Error(`XFDF input exceeds the ${FORM_DATA_MAX_ENTRIES}-entry ceiling`);
    }
    i = next;
  }
  return out;
}
