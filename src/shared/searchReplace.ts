// Phase 86 (FEA-038) chunk A — pure search-and-replace content-stream geometry.
//
// Pure: no `fs`, no Electron, no DOM. Mirrors the Phase-84 discipline in
// `src/shared/redaction.ts`: the main-process engine calls exactly this
// module, so a "replaced" run can never mean two different things.
//
// For each occurrence the module identifies the glyphs its page-space rect
// covers, verifies that those glyphs spell `find` case-insensitively and form a
// contiguous range in reading order (they may span show runs — a word split
// across a `TJ`'s show strings or a `Tf` switch — with runs that contribute no
// covered glyph skipped), and only then removes them from the DECODED content
// stream — delegating the rewrite to `removeRedactedGlyphs` so the removed
// glyphs genuinely leave the stream. An occurrence whose covered glyphs do not
// spell `find`, are not contiguous, or whose font advances cannot be measured
// is reported in `skipped` and removes nothing.
//
// COORDINATE CONVENTION: `occurrences[].rect` is supplied in the SAME user
// space as the content stream (PDF default user space, origin bottom-left,
// y up); the engine converts the renderer's top-left page rects before
// calling. The emitted `ReplaceAnchor.pageX/pageYBaseline` are in that same
// space and are directly usable by pdf-lib's `drawText`.

import {
  RedactionUnsupportedError,
  REDACTION_GLYPH_BAND,
  removeRedactedGlyphs,
  tokenizeContentStream,
  type ContentToken,
  type RedactionAdvanceResolver,
} from './redaction';
import type { AnnRect, ReplaceOccurrence, ReplaceSkip } from './types';

/** Phase 86 — where the replacement text is drawn for one replaced glyph
 *  run. `pageX`/`pageYBaseline` are the run's first covered glyph's baseline
 *  origin in content-stream user space (origin bottom-left, y up), which is
 *  the space pdf-lib's `drawText` consumes. `fontName`/`fontSize` are the
 *  SOURCE run's font resource name and size, echoed so the renderer can
 *  report a substitution. `substituted` is true because the source glyph
 *  font is never reused to draw the replacement (pdf-lib cannot re-emit an
 *  embedded subset); the engine collects `substitutedFonts` from these
 *  anchors. An empty replacement is a delete and emits no anchor. */
export interface ReplaceAnchor {
  pageX: number;
  pageYBaseline: number;
  fontName: string;
  fontSize: number;
  drawnText: string;
  substituted: boolean;
}

/** Phase 86 — one glyph-show run found in a decoded page content stream.
 *  `rect` is the run's page-space bounding box in stream user space
 *  (bottom-left origin). Runs whose font advances cannot be measured are
 *  omitted: the module refuses to guess a box. */
export interface TextRun {
  text: string;
  fontName: string;
  fontSize: number;
  rect: AnnRect;
}

/** Phase 86 — result of `planReplace` for one page. */
export interface ReplacePlan {
  /** The rewritten content stream (identical to the input when nothing was
   *  removed). */
  content: string;
  /** Glyphs dropped from the stream. */
  removedGlyphs: number;
  /** One anchor per replaced occurrence, in occurrence order. Empty for a
   *  delete (empty replacement). */
  anchors: ReplaceAnchor[];
  /** Occurrences left untouched, each with a readable reason. */
  skipped: ReplaceSkip[];
}

// ---------------------------------------------------------------------------
// Matrix + geometry helpers (same conventions as src/shared/redaction.ts)
// ---------------------------------------------------------------------------

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface Point {
  x: number;
  y: number;
}

type Quad = Point[];

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

function applyPoint(m: Matrix, x: number, y: number): Point {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

function num(token: ContentToken | undefined): number {
  if (!token || token.kind !== 'number') return 0;
  const value = parseFloat(token.value ?? token.raw);
  return Number.isFinite(value) ? value : 0;
}

/** True only when the axis-aligned `rect` and the convex `quad` actually
 *  overlap (touching edges do not count). Identical to redaction.ts's test so
 *  this module identifies exactly the glyphs `removeRedactedGlyphs` drops. */
function rectIntersectsQuad(rect: AnnRect, quad: readonly Point[]): boolean {
  if (quad.length < 3) return false;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const axes: Point[] = [
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

function pointInRect(x: number, y: number, rect: AnnRect): boolean {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

function unionQuadAabb(quads: readonly Quad[]): AnnRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const quad of quads) {
    for (const p of quad) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------
// Content-stream scan: state tracking mirrors redaction.ts's dispatch/plan
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

interface ScannedGlyph {
  char: string;
  quad: Quad;
  baselineX: number;
  baselineY: number;
}

interface ScannedRun {
  text: string;
  fontName: string;
  fontSize: number;
  baselineX: number;
  baselineY: number;
  /** One entry per character for a resolvable run, in pen order; empty when
   *  the font's advances could not be measured (no box is guessed). */
  glyphs: ScannedGlyph[];
}

/** Tokenize a decoded content stream and return every glyph-show run with
 *  its simulated page-space geometry. Unresolvable runs (Type0/Type3 fonts
 *  or a font whose metrics cannot be read) are returned with an empty
 *  `glyphs` array so callers can report them rather than guess. */
function scanContent(
  content: string,
  resolveAdvance: RedactionAdvanceResolver,
): ScannedRun[] {
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
  const runs: ScannedRun[] = [];

  function tparam(): Matrix {
    return {
      a: tstate.size * tstate.th,
      b: 0,
      c: 0,
      d: tstate.size,
      e: 0,
      f: tstate.ts,
    };
  }

  /** The four page-space corners of one glyph cell, in stream user space. */
  function glyphQuad(advanceThousandths: number): Quad {
    const w0 = advanceThousandths / 1000;
    const trm = matMul(matMul(tparam(), tm), ctm);
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

  function isShowString(token: ContentToken | undefined): boolean {
    if (!token) return false;
    return token.kind === 'string' || token.kind === 'hex';
  }

  function emitShowString(token: ContentToken | undefined): void {
    if (!isShowString(token)) return;
    const text = token!.value ?? '';
    if (text.length === 0) return;
    const origin = applyPoint(matMul(matMul(tparam(), tm), ctm), 0, 0);
    const run: ScannedRun = {
      text,
      fontName: tstate.font,
      fontSize: tstate.size,
      baselineX: origin.x,
      baselineY: origin.y,
      glyphs: [],
    };
    const advances = resolveAdvance(tstate.font, tstate.size, text);
    if (!advances || advances.length !== text.length) {
      runs.push(run);
      return;
    }
    for (let g = 0; g < text.length; g += 1) {
      const advance = advances[g] ?? 0;
      const quad = glyphQuad(advance);
      const baseline = applyPoint(matMul(matMul(tparam(), tm), ctm), 0, 0);
      run.glyphs.push({
        char: text[g],
        quad,
        baselineX: baseline.x,
        baselineY: baseline.y,
      });
      advanceGlyph(advance, text.charCodeAt(g) === 32);
    }
    runs.push(run);
  }

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
        emitShowString(ops[ops.length - 1]);
        break;
      case 'TJ': {
        const array = ops[ops.length - 1];
        if (!array || array.kind !== 'array' || !array.items) break;
        for (const item of array.items) {
          if (item.kind === 'number') {
            advanceNumber(num(item));
          } else if (isShowString(item)) {
            emitShowString(item);
          }
        }
        break;
      }
      case "'":
        newline();
        emitShowString(ops[ops.length - 1]);
        break;
      case '"':
        tstate.tw = num(ops[0]);
        tstate.tc = num(ops[1]);
        newline();
        emitShowString(ops[ops.length - 1]);
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
  return runs;
}

/** Phase 86 — every measurable glyph-show run in a decoded page content
 *  stream, in document order. `resolveAdvance` supplies per-glyph advances;
 *  a run whose advances cannot be supplied is omitted (no box is guessed). */
export function collectTextRuns(
  content: string,
  resolveAdvance: RedactionAdvanceResolver,
): TextRun[] {
  const out: TextRun[] = [];
  for (const run of scanContent(content, resolveAdvance)) {
    if (run.glyphs.length === 0) continue;
    out.push({
      text: run.text,
      fontName: run.fontName,
      fontSize: run.fontSize,
      rect: unionQuadAabb(run.glyphs.map((g) => g.quad)),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Occurrence resolution + plan
// ---------------------------------------------------------------------------

interface ResolvedMatch {
  occ: ReplaceOccurrence;
  baselineX: number;
  baselineY: number;
  fontName: string;
  fontSize: number;
}

type ResolveResult =
  | { ok: true; match: ResolvedMatch }
  | { ok: false; reason: string };

/** Resolve one occurrence against the scanned runs. A match requires the
 *  covered glyphs to be a contiguous character range in reading order and to
 *  spell `find` case-insensitively. The range MAY span more than one show run
 *  (a word split across a `TJ` array's show strings, or across a `Tf` font
 *  switch): runs that contribute no covered glyph are skipped, and within each
 *  contributing run the covered glyph indices must be contiguous. The mark
 *  rect is the tight AABB of those glyphs, so the subsequent removal can only
 *  drop them. */
function resolveOccurrence(
  runs: readonly ScannedRun[],
  occ: ReplaceOccurrence,
): ResolveResult {
  const covered: { run: ScannedRun; glyph: ScannedGlyph; index: number }[] = [];
  for (const run of runs) {
    for (let i = 0; i < run.glyphs.length; i += 1) {
      const glyph = run.glyphs[i];
      if (rectIntersectsQuad(occ.rect, glyph.quad)) {
        covered.push({ run, glyph, index: i });
      }
    }
  }

  if (covered.length === 0) {
    // A show run the resolver could not measure at the occurrence's baseline
    // is the honest cause; report it rather than a generic no-text reason.
    const unmeasured = runs.some(
      (run) =>
        run.glyphs.length === 0 &&
        run.text.length > 0 &&
        pointInRect(run.baselineX, run.baselineY, occ.rect),
    );
    return {
      ok: false,
      reason: unmeasured
        ? 'the covered run font advances could not be measured'
        : 'no glyphs are covered by the occurrence rect',
    };
  }

  // DEF-507 — group the covered glyphs by run. `covered` was built by scanning
  // runs in reading order and glyphs left-to-right, so the Map's insertion
  // order is reading order and runs that contribute no covered glyph are
  // simply absent.
  const byRun = new Map<ScannedRun, number[]>();
  for (const c of covered) {
    const list = byRun.get(c.run);
    if (list) list.push(c.index);
    else byRun.set(c.run, [c.index]);
  }

  let coveredText = '';
  let first: ScannedGlyph | undefined;
  let firstRun: ScannedRun | undefined;
  for (const [run, indices] of byRun) {
    indices.sort((a, b) => a - b);
    for (let i = 0; i < indices.length; i += 1) {
      if (i > 0 && indices[i] !== indices[i - 1] + 1) {
        return { ok: false, reason: 'the covered glyphs are not contiguous' };
      }
    }
    coveredText += indices.map((i) => run.glyphs[i].char).join('');
    if (first === undefined) {
      first = run.glyphs[indices[0]];
      firstRun = run;
    }
  }

  if (coveredText.toLowerCase() !== occ.find.toLowerCase()) {
    return {
      ok: false,
      reason: `the covered glyphs spell ${JSON.stringify(coveredText)}, not ${JSON.stringify(occ.find)}`,
    };
  }

  if (first === undefined || firstRun === undefined) {
    return { ok: false, reason: 'no glyphs are covered by the occurrence rect' };
  }

  // The replacement is drawn ONCE, at the FIRST covered glyph's baseline, using
  // the first covered run's font (cross-Tf substitutions already apply).
  return {
    ok: true,
    match: {
      occ,
      baselineX: first.baselineX,
      baselineY: first.baselineY,
      fontName: firstRun.fontName,
      fontSize: firstRun.fontSize,
    },
  };
}

/** Phase 86 — plan the rewrite of ONE page's decoded content stream for the
 *  given occurrences. `occurrences[].rect` is in stream user space (the
 *  engine converts before calling) and `replacement` is the drawn text; an
 *  empty replacement is a legal delete (glyphs removed, no anchor). Nothing
 *  is removed for a skipped occurrence. */
export function planReplace(
  content: string,
  occurrences: readonly ReplaceOccurrence[],
  replacement: string,
  resolveAdvance: RedactionAdvanceResolver,
): ReplacePlan {
  const runs = scanContent(content, resolveAdvance);
  const matches: ResolvedMatch[] = [];
  const skipped: ReplaceSkip[] = [];

  for (const occ of occurrences) {
    const resolved = resolveOccurrence(runs, occ);
    if (resolved.ok) {
      matches.push(resolved.match);
    } else {
      skipped.push({
        page: occ.page,
        rect: occ.rect,
        find: occ.find,
        reason: resolved.reason,
      });
    }
  }

  if (matches.length === 0) {
    return { content, removedGlyphs: 0, anchors: [], skipped };
  }

  let rewritten = content;
  let removedGlyphs = 0;
  try {
    const result = removeRedactedGlyphs(
      content,
      matches.map((m) => ({ rect: m.occ.rect })),
      resolveAdvance,
    );
    rewritten = result.content;
    removedGlyphs = result.removedGlyphs;
  } catch (e) {
    if (e instanceof RedactionUnsupportedError) {
      // An unmeasured run elsewhere on the page makes the global rewrite
      // refuse (Phase-84 fail-loud). Nothing is changed; report every matched
      // occurrence as skipped rather than guess or fail the whole op.
      for (const m of matches) {
        skipped.push({
          page: m.occ.page,
          rect: m.occ.rect,
          find: m.occ.find,
          reason: `the page has a text run whose font advances could not be measured (${e.reason})`,
        });
      }
      return { content, removedGlyphs: 0, anchors: [], skipped };
    }
    throw e;
  }

  const anchors: ReplaceAnchor[] =
    replacement.length === 0
      ? []
      : matches.map((m) => ({
          pageX: m.baselineX,
          pageYBaseline: m.baselineY,
          fontName: m.fontName,
          fontSize: m.fontSize,
          drawnText: replacement,
          // The source glyph font is never reused to draw the replacement
          // (pdf-lib cannot re-emit an embedded subset), so every drawn
          // anchor is a substitution. Ruling 8: name every source font the
          // replacement could not match.
          substituted: true,
        }));

  return { content: rewritten, removedGlyphs, anchors, skipped };
}


