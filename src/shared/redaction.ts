// Phase 84 (True redaction) chunk A — pure content-stream removal geometry.
//
// Pure: no `fs`, no Electron, no DOM. Mirrors the
// src/shared/printLayout.ts / printImposition.ts single-source-of-truth
// discipline: the main-process engine calls the SAME geometry this module
// unit-tests, so a "redacted" page can never mean two different things.
//
// `removeRedactedGlyphs(content, marks, resolveAdvance)` tokenizes a DECODED
// page content stream, tracks graphics + text state (q/Q, cm, BT/ET,
// Td/TD/Tm/T*/TL, Tf, Tc/Tw/Tz, Ts), simulates the text matrix for every
// glyph-show operator (Tj, TJ, ', ") and drops exactly the glyphs whose
// page-space boxes intersect a mark. Text outside every mark is preserved.
// A removed glyph's pen advance is reproduced with TJ kerning so surrounding
// text does not shift; the removed glyph itself is gone from the stream.
//
// COORDINATE CONVENTION: `marks` are supplied in the SAME user space as the
// content stream (PDF default user space, origin bottom-left, y up). The
// engine is responsible for converting the renderer's top-left page rects
// (and any page rotation) before calling. This module has no page dimensions
// and never guesses them.
//
// FAIL-LOUD (Phase 84 Ruling 4): if `resolveAdvance` cannot supply advances
// for a show operator and the page carries any mark, removal refuses with
// `RedactionUnsupportedError` rather than guessing positions. The check is
// deliberately conservative — an unresolvable run that *might* reach a mark
// must not be silently skipped, or recoverable text could survive a
// "redaction".

import type { AnnRect, RedactionMark } from './types';

/**
 * Resolves per-glyph advance widths for a show operator's decoded text.
 *
 * Returns one advance per UTF-16 code unit of `showText` (simple/WinAnsi
 * fonts), expressed in thousandths of an em (the raw PDF `Widths`/`W` value).
 * Returns `null` when the font's metrics cannot be read, or when the font is
 * multi-byte/Type0 and cannot be treated as one advance per code unit. The
 * module refuses loudly rather than guessing when a marked run returns `null`.
 */
export type RedactionAdvanceResolver = (
  fontName: string,
  fontSize: number,
  showText: string,
) => number[] | null;

/** Rewritten content plus the removal statistics reported to the engine. */
export interface RemoveRedactedGlyphsResult {
  /** The rewritten content stream (identical to the input when nothing was
   *  removed). Only the spans of removed glyphs change. */
  content: string;
  /** Number of glyphs dropped from the content stream. */
  removedGlyphs: number;
  /** Number of glyph-show operators (Tj, TJ, ', ") encountered. */
  textRuns: number;
}

/** Typed refusal thrown when a marked run's geometry cannot be bounded. The
 *  engine maps this to its `redaction-unsupported` `EngineError`. */
export class RedactionUnsupportedError extends Error {
  readonly reason: string;
  readonly fontName?: string;

  constructor(reason: string, fontName?: string) {
    super(
      fontName
        ? `redaction-unsupported: ${reason} (font ${fontName})`
        : `redaction-unsupported: ${reason}`,
    );
    this.name = 'RedactionUnsupportedError';
    this.reason = reason;
    this.fontName = fontName;
  }
}

/**
 * The vertical band of a glyph cell in em fractions (thousandths of an em
 * divided by 1000). `resolveAdvance` carries only horizontal metrics, so the
 * shared module uses a generic ascender/descender band. Kept exported so the
 * engine can document the same approximation.
 */
export const REDACTION_GLYPH_BAND = { descent: -0.25, ascent: 0.85 } as const;

// ---------------------------------------------------------------------------
// Content-stream tokenizer
// ---------------------------------------------------------------------------

export type ContentTokenKind =
  | 'number'
  | 'name'
  | 'string'
  | 'hex'
  | 'array'
  | 'dict'
  | 'operator'
  | 'inlineImage';

export interface ContentToken {
  kind: ContentTokenKind;
  /** Exact source slice, used to preserve untouched content byte-for-byte. */
  raw: string;
  start: number;
  end: number;
  /** Decoded value for names/strings/hex/operators/numbers. */
  value?: string;
  /** Element tokens for arrays (strings and numbers for TJ). */
  items?: ContentToken[];
}

function isWs(ch: string): boolean {
  return (
    ch === ' ' ||
    ch === '\t' ||
    ch === '\n' ||
    ch === '\f' ||
    ch === '\r' ||
    ch === '\0'
  );
}

function isDelimiter(ch: string): boolean {
  return (
    ch === '(' ||
    ch === ')' ||
    ch === '<' ||
    ch === '>' ||
    ch === '[' ||
    ch === ']' ||
    ch === '{' ||
    ch === '}' ||
    ch === '/' ||
    ch === '%'
  );
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isHexDigit(ch: string): boolean {
  return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

function skipWsComments(content: string, start: number): number {
  const n = content.length;
  let i = start;
  while (i < n) {
    const ch = content[i];
    if (isWs(ch)) {
      i += 1;
      continue;
    }
    if (ch === '%') {
      while (i < n && content[i] !== '\n' && content[i] !== '\r') i += 1;
      continue;
    }
    break;
  }
  return i;
}

interface TokenRead {
  token: ContentToken | null;
  next: number;
}

function readNumber(content: string, start: number): TokenRead {
  const n = content.length;
  let i = start;
  if (content[i] === '+' || content[i] === '-') i += 1;
  while (i < n && (isDigit(content[i]) || content[i] === '.')) i += 1;
  const raw = content.slice(start, i);
  return { token: { kind: 'number', raw, start, end: i, value: raw }, next: i };
}

function readName(content: string, start: number): TokenRead {
  const n = content.length;
  let i = start + 1;
  let value = '';
  while (i < n && !isWs(content[i]) && !isDelimiter(content[i])) {
    if (
      content[i] === '#' &&
      i + 2 < n &&
      isHexDigit(content[i + 1]) &&
      isHexDigit(content[i + 2])
    ) {
      value += String.fromCharCode(parseInt(content.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      value += content[i];
      i += 1;
    }
  }
  return {
    token: { kind: 'name', raw: content.slice(start, i), start, end: i, value },
    next: i,
  };
}

function readLiteralString(content: string, start: number): TokenRead {
  const n = content.length;
  let i = start + 1;
  let value = '';
  let depth = 1;
  while (i < n && depth > 0) {
    const ch = content[i];
    if (ch === '\\') {
      const next = content[i + 1];
      if (next === undefined) {
        i += 1;
        break;
      }
      if (next === 'n') {
        value += '\n';
        i += 2;
      } else if (next === 'r') {
        value += '\r';
        i += 2;
      } else if (next === 't') {
        value += '\t';
        i += 2;
      } else if (next === 'b') {
        value += '\b';
        i += 2;
      } else if (next === 'f') {
        value += '\f';
        i += 2;
      } else if (next === '(' || next === ')' || next === '\\') {
        value += next;
        i += 2;
      } else if (next >= '0' && next <= '7') {
        let oct = '';
        let k = i + 1;
        while (k < n && oct.length < 3 && content[k] >= '0' && content[k] <= '7') {
          oct += content[k];
          k += 1;
        }
        value += String.fromCharCode(parseInt(oct, 8) & 0xff);
        i = k;
      } else if (next === '\n') {
        i += 2;
      } else if (next === '\r') {
        i += 2;
        if (content[i] === '\n') i += 1;
      } else {
        value += next;
        i += 2;
      }
    } else if (ch === '(') {
      depth += 1;
      value += ch;
      i += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth > 0) value += ch;
      i += 1;
    } else {
      value += ch;
      i += 1;
    }
  }
  return {
    token: {
      kind: 'string',
      raw: content.slice(start, i),
      start,
      end: i,
      value,
    },
    next: i,
  };
}

function readHexString(content: string, start: number): TokenRead {
  const n = content.length;
  let i = start + 1;
  let hex = '';
  while (i < n && content[i] !== '>') {
    if (isHexDigit(content[i])) hex += content[i];
    i += 1;
  }
  if (i < n) i += 1;
  let value = '';
  for (let k = 0; k < hex.length; k += 2) {
    const pair = hex.length - k >= 2 ? hex.slice(k, k + 2) : hex[k] + '0';
    value += String.fromCharCode(parseInt(pair, 16));
  }
  return {
    token: { kind: 'hex', raw: content.slice(start, i), start, end: i, value },
    next: i,
  };
}

function readDict(content: string, start: number): TokenRead {
  const n = content.length;
  let i = start;
  let depth = 0;
  while (i < n) {
    const ch = content[i];
    if (ch === '<' && content[i + 1] === '<') {
      depth += 1;
      i += 2;
      continue;
    }
    if (ch === '>' && content[i + 1] === '>') {
      depth -= 1;
      i += 2;
      if (depth === 0) break;
      continue;
    }
    if (ch === '(') {
      i += 1;
      let d = 1;
      while (i < n && d > 0) {
        if (content[i] === '\\') {
          i += 2;
          continue;
        }
        if (content[i] === '(') d += 1;
        else if (content[i] === ')') d -= 1;
        i += 1;
      }
      continue;
    }
    if (ch === '<') {
      i += 1;
      while (i < n && content[i] !== '>') i += 1;
      i += 1;
      continue;
    }
    i += 1;
  }
  return {
    token: { kind: 'dict', raw: content.slice(start, i), start, end: i, value: '' },
    next: i,
  };
}

function readArray(content: string, start: number): TokenRead {
  const n = content.length;
  let i = start + 1;
  const items: ContentToken[] = [];
  for (;;) {
    const j = skipWsComments(content, i);
    if (j < n && content[j] === ']') {
      i = j + 1;
      break;
    }
    const read = nextToken(content, i);
    if (!read.token) {
      i = read.next;
      break;
    }
    items.push(read.token);
    i = read.next;
  }
  return {
    token: { kind: 'array', raw: content.slice(start, i), start, end: i, items },
    next: i,
  };
}

function nextToken(content: string, from: number): TokenRead {
  const n = content.length;
  const i = skipWsComments(content, from);
  if (i >= n) return { token: null, next: i };
  const ch = content[i];
  if (ch === '[') return readArray(content, i);
  if (ch === ']')
    return {
      token: { kind: 'operator', raw: ']', start: i, end: i + 1, value: ']' },
      next: i + 1,
    };
  if (ch === '<') {
    if (content[i + 1] === '<') return readDict(content, i);
    return readHexString(content, i);
  }
  if (ch === '>') {
    if (content[i + 1] === '>')
      return {
        token: { kind: 'operator', raw: '>>', start: i, end: i + 2, value: '>>' },
        next: i + 2,
      };
    return {
      token: { kind: 'operator', raw: '>', start: i, end: i + 1, value: '>' },
      next: i + 1,
    };
  }
  if (ch === '(') return readLiteralString(content, i);
  if (ch === '/') return readName(content, i);
  if (ch === '{' || ch === '}') {
    return {
      token: { kind: 'operator', raw: ch, start: i, end: i + 1, value: ch },
      next: i + 1,
    };
  }
  if (ch === '+' || ch === '-' || ch === '.' || isDigit(ch)) {
    return readNumber(content, i);
  }
  let j = i;
  while (j < n && !isWs(content[j]) && !isDelimiter(content[j])) j += 1;
  if (j === i) j += 1;
  const raw = content.slice(i, j);
  if (raw === 'BI') {
    let k = j;
    let end = n;
    while (k < n - 1) {
      if (content[k] === 'E' && content[k + 1] === 'I') {
        const before =
          k === 0 || isWs(content[k - 1]) || isDelimiter(content[k - 1]);
        const after =
          k + 2 >= n || isWs(content[k + 2]) || isDelimiter(content[k + 2]);
        if (before && after) {
          end = k + 2;
          break;
        }
      }
      k += 1;
    }
    return {
      token: {
        kind: 'inlineImage',
        raw: content.slice(i, end),
        start: i,
        end,
        value: 'BI',
      },
      next: end,
    };
  }
  return {
    token: { kind: 'operator', raw, start: i, end: j, value: raw },
    next: j,
  };
}

/** Tokenize a decoded content stream into top-level tokens. Arrays are
 *  nested (their `items` hold the element tokens); inline images are kept as
 *  a single opaque token so binary payloads are never mis-parsed. */
export function tokenizeContentStream(content: string): ContentToken[] {
  const tokens: ContentToken[] = [];
  const n = content.length;
  let i = 0;
  while (i < n) {
    const read = nextToken(content, i);
    if (!read.token) {
      if (read.next <= i) break;
      i = read.next;
      continue;
    }
    tokens.push(read.token);
    if (read.next <= read.token.start) break;
    i = read.next;
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Matrix + geometry helpers
// ---------------------------------------------------------------------------

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Row-vector composition: `p x matMul(A, B) === (p x A) x B`. */
function matMul(A: Matrix, B: Matrix): Matrix {
  return {
    a: A.a * B.a + A.b * B.c,
    b: A.a * B.b + A.b * B.d,
    c: A.c * B.a + A.d * B.c,
    d: A.c * B.b + A.d * B.d,
    e: A.e * B.a + A.f * B.c + B.e,
    f: A.e * B.b + A.f * B.d + B.f,
  };
}

function translate(tx: number, ty: number): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

function applyPoint(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** True only when the axis-aligned `rect` and the convex `quad` actually
 *  overlap. Separating-axis test on the rect's two axes plus each quad edge
 *  normal; touching edges do not count. */
function rectIntersectsQuad(
  rect: AnnRect,
  quad: readonly { x: number; y: number }[],
): boolean {
  if (quad.length < 3) return false;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const axes: { x: number; y: number }[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  for (let i = 0; i < quad.length; i += 1) {
    const p1 = quad[i];
    const p2 = quad[(i + 1) % quad.length];
    axes.push({ x: -(p2.y - p1.y), y: p2.x - p1.x });
  }
  for (const axis of axes) {
    const len = Math.hypot(axis.x, axis.y);
    if (len === 0) continue;
    const ax = axis.x / len;
    const ay = axis.y / len;
    const rectRadius = hw * Math.abs(ax) + hh * Math.abs(ay);
    const rectCenter = cx * ax + cy * ay;
    let qMin = Infinity;
    let qMax = -Infinity;
    for (const p of quad) {
      const proj = p.x * ax + p.y * ay;
      if (proj < qMin) qMin = proj;
      if (proj > qMax) qMax = proj;
    }
    if (rectCenter + rectRadius <= qMin || rectCenter - rectRadius >= qMax) {
      return false;
    }
  }
  return true;
}

function fmtNum(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10000) / 10000;
  if (Object.is(rounded, -0)) return '0';
  return String(rounded);
}

function num(token: ContentToken | undefined): number {
  if (!token || token.kind !== 'number') return 0;
  const value = parseFloat(token.value ?? token.raw);
  return Number.isFinite(value) ? value : 0;
}

function encodeHexString(text: string): string {
  let hex = '';
  for (let i = 0; i < text.length; i += 1) {
    const byte = text.charCodeAt(i) & 0xff;
    hex += byte.toString(16).padStart(2, '0').toUpperCase();
  }
  return `<${hex}>`;
}

// ---------------------------------------------------------------------------
// Removal geometry
// ---------------------------------------------------------------------------

interface TextState {
  font: string;
  size: number;
  /** Character spacing (Tc) text-space units. */
  tc: number;
  /** Word spacing (Tw) text-space units, applied to code 32. */
  tw: number;
  /** Horizontal scaling (Tz / 100); 1 = 100%. */
  th: number;
  /** Leading (TL) text-space units. */
  tl: number;
  /** Rise (Ts) text-space units. */
  ts: number;
}

interface Edit {
  start: number;
  end: number;
  replacement: string;
}

/**
 * Remove the glyphs covered by `marks` from a decoded page content stream.
 *
 * `content` is the DECOMPRESSED page content (operators and operands as
 * text); `marks` are in the content stream's user space (see the module
 * header for the coordinate contract); `resolveAdvance` supplies per-glyph
 * advances or `null` when a font cannot be measured.
 *
 * Returns the rewritten content plus `removedGlyphs` (glyphs dropped) and
 * `textRuns` (show operators encountered). Throws `RedactionUnsupportedError`
 * when a marked run's advances cannot be resolved. When no mark covers any
 * glyph the original string is returned unchanged and `removedGlyphs` is 0.
 */
export function removeRedactedGlyphs(
  content: string,
  marks: ReadonlyArray<RedactionMark>,
  resolveAdvance: RedactionAdvanceResolver,
): RemoveRedactedGlyphsResult {
  const markRects: AnnRect[] = marks.map((mark) => mark.rect);
  if (markRects.length === 0) {
    return { content, removedGlyphs: 0, textRuns: 0 };
  }

  let ctm: Matrix = IDENTITY;
  let tstate: TextState = {
    font: '',
    size: 0,
    tc: 0,
    tw: 0,
    th: 1,
    tl: 0,
    ts: 0,
  };
  const gstack: { ctm: Matrix; tstate: TextState }[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let operands: ContentToken[] = [];
  const edits: Edit[] = [];
  let removedGlyphs = 0;
  let textRuns = 0;

  function matrixFromOperands(ops: ContentToken[]): Matrix | null {
    if (ops.length < 6) return null;
    const o = ops.slice(ops.length - 6);
    return {
      a: num(o[0]),
      b: num(o[1]),
      c: num(o[2]),
      d: num(o[3]),
      e: num(o[4]),
      f: num(o[5]),
    };
  }

  /** The four page-space corners of one glyph cell, in stream user space. The
   *  corners stay a quad (not reduced to an AABB) so hit tests against rotated
   *  glyphs do not over-remove on the axis-aligned hull. Order is
   *  (0,descent) -> (w0,descent) -> (w0,ascent) -> (0,ascent); convex. */
  function glyphQuad(advanceThousandths: number): { x: number; y: number }[] {
    const w0 = advanceThousandths / 1000;
    const tparam: Matrix = {
      a: tstate.size * tstate.th,
      b: 0,
      c: 0,
      d: tstate.size,
      e: 0,
      f: tstate.ts,
    };
    const trm = matMul(matMul(tparam, tm), ctm);
    return [
      applyPoint(trm, 0, REDACTION_GLYPH_BAND.descent),
      applyPoint(trm, w0, REDACTION_GLYPH_BAND.descent),
      applyPoint(trm, w0, REDACTION_GLYPH_BAND.ascent),
      applyPoint(trm, 0, REDACTION_GLYPH_BAND.ascent),
    ];
  }

  function advanceGlyph(advanceThousandths: number, isSpace: boolean): void {
    const w0 = advanceThousandths / 1000;
    const tx =
      (w0 * tstate.size + tstate.tc + (isSpace ? tstate.tw : 0)) * tstate.th;
    tm = matMul(translate(tx, 0), tm);
  }

  function advanceNumber(value: number): void {
    const tx = (-value / 1000) * tstate.size * tstate.th;
    tm = matMul(translate(tx, 0), tm);
  }

  function newline(): void {
    tlm = matMul(translate(0, -tstate.tl), tlm);
    tm = tlm;
  }

  interface StringPlan {
    kept: boolean[];
    advances: number[];
    removed: number;
  }

  /** Simulate one shown string: mark hits per glyph and the pen advance. */
  function planString(showText: string): StringPlan {
    if (showText.length === 0) {
      return { kept: [], advances: [], removed: 0 };
    }
    const advances = resolveAdvance(tstate.font, tstate.size, showText);
    if (!advances || advances.length !== showText.length) {
      throw new RedactionUnsupportedError(
        'font-advance-unresolved',
        tstate.font || undefined,
      );
    }
    const kept: boolean[] = [];
    let removed = 0;
    for (let g = 0; g < showText.length; g += 1) {
      const advance = advances[g] ?? 0;
      const quad = glyphQuad(advance);
      const hit = markRects.some((rect) => rectIntersectsQuad(rect, quad));
      kept.push(!hit);
      if (hit) removed += 1;
      advanceGlyph(advance, showText.charCodeAt(g) === 32);
    }
    return { kept, advances, removed };
  }

  /** Rebuild a shown string as hex segments separated by kerning numbers so
   *  the pen advance over removed glyphs (and thus surrounding layout) is
   *  preserved. */
  function buildShowParts(
    showText: string,
    kept: boolean[],
    advances: number[],
  ): string[] {
    const parts: string[] = [];
    let i = 0;
    while (i < showText.length) {
      if (kept[i]) {
        let j = i;
        while (j < showText.length && kept[j]) j += 1;
        parts.push(encodeHexString(showText.slice(i, j)));
        i = j;
      } else {
        let j = i;
        let removedTextAdvance = 0;
        while (j < showText.length && !kept[j]) {
          const w0 = (advances[j] ?? 0) / 1000;
          const isSpace = showText.charCodeAt(j) === 32;
          removedTextAdvance +=
            (w0 * tstate.size + tstate.tc + (isSpace ? tstate.tw : 0)) *
            tstate.th;
          j += 1;
        }
        const denom = tstate.size * tstate.th;
        if (denom !== 0) {
          parts.push(fmtNum((removedTextAdvance * 1000) / -denom));
        }
        i = j;
      }
    }
    return parts;
  }

  function isShowString(token: ContentToken | undefined): boolean {
    if (!token) return false;
    return token.kind === 'string' || token.kind === 'hex';
  }

  function handleTj(stringToken: ContentToken | undefined, op: ContentToken): void {
    if (!isShowString(stringToken)) return;
    const text = stringToken!.value ?? '';
    const plan = planString(text);
    if (plan.removed === 0) return;
    removedGlyphs += plan.removed;
    const parts = buildShowParts(text, plan.kept, plan.advances);
    edits.push({
      start: stringToken!.start,
      end: op.end,
      replacement: `[${parts.join(' ')}] TJ`,
    });
  }

  function handleTjArray(arrayToken: ContentToken | undefined): void {
    if (!arrayToken || arrayToken.kind !== 'array' || !arrayToken.items) return;
    const outParts: string[] = [];
    let changed = false;
    for (const item of arrayToken.items) {
      if (item.kind === 'number') {
        advanceNumber(num(item));
        outParts.push(item.raw);
        continue;
      }
      if (isShowString(item)) {
        const text = item.value ?? '';
        const plan = planString(text);
        if (plan.removed === 0) {
          outParts.push(item.raw);
          continue;
        }
        changed = true;
        removedGlyphs += plan.removed;
        outParts.push(...buildShowParts(text, plan.kept, plan.advances));
        continue;
      }
      outParts.push(item.raw);
    }
    if (changed) {
      edits.push({
        start: arrayToken.start,
        end: arrayToken.end,
        replacement: `[${outParts.join(' ')}]`,
      });
    }
  }

  function handleQuote(
    ops: ContentToken[],
    op: ContentToken,
    isDouble: boolean,
  ): void {
    const stringToken = ops[ops.length - 1];
    if (!isShowString(stringToken)) return;
    let prefix = '';
    if (isDouble) {
      tstate.tw = num(ops[0]);
      tstate.tc = num(ops[1]);
      prefix = `${ops[0]?.raw ?? '0'} Tw ${ops[1]?.raw ?? '0'} Tc `;
    }
    newline();
    const text = stringToken!.value ?? '';
    const plan = planString(text);
    if (plan.removed === 0) return;
    removedGlyphs += plan.removed;
    const parts = buildShowParts(text, plan.kept, plan.advances);
    edits.push({
      start: stringToken!.start,
      end: op.end,
      replacement: `${prefix}T* [${parts.join(' ')}] TJ`,
    });
  }

  function dispatch(op: ContentToken, ops: ContentToken[]): void {
    switch (op.value) {
      case 'q':
        gstack.push({ ctm, tstate: { ...tstate } });
        break;
      case 'Q': {
        const saved = gstack.pop();
        if (saved) {
          ctm = saved.ctm;
          tstate = saved.tstate;
        }
        break;
      }
      case 'cm': {
        const m = matrixFromOperands(ops);
        if (m) ctm = matMul(m, ctm);
        break;
      }
      case 'BT':
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case 'ET':
        break;
      case 'Td': {
        const m = translate(num(ops[0]), num(ops[1]));
        tlm = matMul(m, tlm);
        tm = tlm;
        break;
      }
      case 'TD': {
        const ty = num(ops[1]);
        tlm = matMul(translate(num(ops[0]), ty), tlm);
        tm = tlm;
        tstate.tl = -ty;
        break;
      }
      case 'Tm': {
        const m = matrixFromOperands(ops);
        if (m) {
          tm = m;
          tlm = m;
        }
        break;
      }
      case 'T*':
        newline();
        break;
      case 'TL':
        tstate.tl = num(ops[0]);
        break;
      case 'Tf': {
        const fontToken = ops.find((token) => token.kind === 'name');
        if (fontToken) tstate.font = fontToken.value ?? '';
        tstate.size = num(ops[ops.length - 1]);
        break;
      }
      case 'Tc':
        tstate.tc = num(ops[0]);
        break;
      case 'Tw':
        tstate.tw = num(ops[0]);
        break;
      case 'Tz':
        tstate.th = num(ops[0]) / 100;
        break;
      case 'Ts':
        tstate.ts = num(ops[0]);
        break;
      case 'Tj':
        textRuns += 1;
        handleTj(ops[ops.length - 1], op);
        break;
      case 'TJ':
        textRuns += 1;
        handleTjArray(ops[ops.length - 1]);
        break;
      case "'":
        textRuns += 1;
        handleQuote(ops, op, false);
        break;
      case '"':
        textRuns += 1;
        handleQuote(ops, op, true);
        break;
      default:
        break;
    }
  }

  for (const token of tokenizeContentStream(content)) {
    if (token.kind === 'operator' || token.kind === 'inlineImage') {
      if (token.kind === 'operator') dispatch(token, operands);
      operands = [];
    } else {
      operands.push(token);
    }
  }

  if (edits.length === 0) {
    return { content, removedGlyphs: 0, textRuns };
  }

  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const edit of edits) {
    out += content.slice(cursor, edit.start);
    out += edit.replacement;
    cursor = edit.end;
  }
  out += content.slice(cursor);
  return { content: out, removedGlyphs, textRuns };
}

