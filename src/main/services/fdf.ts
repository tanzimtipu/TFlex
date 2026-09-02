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
 * bottom-left PDF convention matching the annotation serializer (the engine
 * stores annotation rects in that convention — see annotations.ts).
 */
export function exportFdf(
  annotations: AnnModel[][],
  order: number[],
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
    for (const ann of pageAnns) {
      lines.push(serializeFdfAnnot(ann, vi));
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

function serializeFdfAnnot(ann: AnnModel, visiblePage0: number): string {
  const rect = ann.rects[0] ?? { x: 0, y: 0, width: 0, height: 0 };
  const [r, g, b] = colorToRgb(ann.color);
  const parts: string[] = [];
  parts.push('<<');
  parts.push('/Type /Annot');
  parts.push(`/Subtype /${kindToSubtype(ann.kind)}`);
  parts.push(`/Rect [${pdfNum(rect.x)} ${pdfNum(rect.y)} ${pdfNum(rect.x + rect.width)} ${pdfNum(rect.y + rect.height)}]`);
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
    if (ann.points !== undefined && ann.points.length >= 2) {
      // /Callout: [startX startY kneeX kneeY endX endY] (3 points) or a
      // 2-point form. We emit the start + end (and a knee if present).
      const p0 = ann.points[0];
      const pEnd = ann.points[ann.points.length - 1];
      if (ann.points.length >= 3) {
        const knee = ann.points[1];
        parts.push(`/Callout [${pdfNum(p0.x)} ${pdfNum(p0.y)} ${pdfNum(knee.x)} ${pdfNum(knee.y)} ${pdfNum(pEnd.x)} ${pdfNum(pEnd.y)}]`);
      } else {
        parts.push(`/Callout [${pdfNum(p0.x)} ${pdfNum(p0.y)} ${pdfNum(p0.x)} ${pdfNum(p0.y)} ${pdfNum(pEnd.x)} ${pdfNum(pEnd.y)}]`);
      }
    }
    parts.push(`/DA /Helv 12 Tf ${pdfNum(r)} ${pdfNum(g)} ${pdfNum(b)} rg`);
  }
  if ((ann.kind === 'highlight' || ann.kind === 'underline' || ann.kind === 'squiggly' || ann.kind === 'strikeout') && ann.rects.length > 0) {
    const quads: string[] = [];
    for (const rct of ann.rects) {
      quads.push(
        `${pdfNum(rct.x)} ${pdfNum(rct.y + rct.height)}`,
        `${pdfNum(rct.x + rct.width)} ${pdfNum(rct.y + rct.height)}`,
        `${pdfNum(rct.x)} ${pdfNum(rct.y)}`,
        `${pdfNum(rct.x + rct.width)} ${pdfNum(rct.y)}`,
      );
    }
    parts.push(`/QuadPoints [${quads.join(' ')}]`);
  }
  if (ann.kind === 'arrow' && ann.points !== undefined && ann.points.length >= 2) {
    parts.push(`/L [${pdfNum(ann.points[0].x)} ${pdfNum(ann.points[0].y)} ${pdfNum(ann.points[1].x)} ${pdfNum(ann.points[1].y)}]`);
    if (ann.lineEnds !== undefined && ann.lineEnds.length >= 2) {
      parts.push(`/LE [/${ann.lineEnds[0]} /${ann.lineEnds[1]}]`);
    } else {
      parts.push('/LE [/OpenArrow /None]');
    }
  }
  if (ann.kind === 'ink' && ann.points !== undefined && ann.points.length > 0) {
    const flat = ann.points.map((p) => `${pdfNum(p.x)} ${pdfNum(p.y)}`).join(' ');
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
 * Best-effort: extracts /Subtype, /Rect, /Contents, /C, /Page, /Subj, /Callout,
 * /Intent, /QuadPoints, /L, /InkList, /LE, /BS./W, /CA, /BM. Unknown subtypes
 * are skipped (the engine does not model them).
 */
export function parseFdf(fdfBytes: Uint8Array): AnnModel[] {
  const text = new TextDecoder('latin1').decode(fdfBytes);
  if (!text.includes('%FDF')) {
    throw new Error('not an FDF file (missing %FDF header)');
  }
  const annotsArray = extractAnnotsArray(text);
  if (annotsArray === null) return [];
  const dictTexts = splitTopLevelDicts(annotsArray);
  const out: AnnModel[] = [];
  for (const dictText of dictTexts) {
    const model = parseFdfAnnot(dictText);
    if (model !== null) out.push(model);
  }
  return out;
}

/** Find the contents of the /Annots array (the text between its `[` and the
 *  matching `]`). Returns null if /Annots is absent or malformed. */
function extractAnnotsArray(text: string): string | null {
  const key = '/Annots';
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

function parseFdfAnnot(dictText: string): AnnModel | null {
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
    } else if (calloutArr.length >= 4) {
      points = [
        { x: calloutArr[0], y: calloutArr[1] },
        { x: calloutArr[2], y: calloutArr[3] },
      ];
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

  return {
    id: randomUUID(),
    kind,
    page,
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
