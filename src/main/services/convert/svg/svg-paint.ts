import { rgb, type PDFPage } from '@cantoo/pdf-lib';
import type { SvgDocument, SvgNode } from './svg-parse';
import { ownPresentation } from './svg-parse';

/**
 * Phase 54 feature C — the SVG paint translator.
 *
 * `generatePaintOps` is pure and is the test surface: it turns the parse tree
 * into a flat list of `PaintOp`s in SVG user space, a list of construct tag
 * names it could not translate natively, and a gradient count. `applyPaintOps`
 * is the thin executor (pdf-lib's vector API only — no hand-rolled operators).
 *
 * The op `transform` is a single composed SVG affine matrix (row-vector
 * semantics, `x' = a*x + c*y + e`), mapping the element's local coordinates into
 * the SVG user (viewBox) space. Nested `g`/`transform` attributes are composed
 * down to that one matrix.
 */

export type Matrix = [number, number, number, number, number, number];

export interface PaintOpBase {
  /** Resolved fill as `#rrggbb`, or null for `none`. */
  fill: string | null;
  /** Resolved stroke as `#rrggbb`, or null for `none`. */
  stroke: string | null;
  strokeWidth: number;
  /** Element/group opacity, inherited multiplicatively. */
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
  transform: Matrix;
}

export interface PathOp extends PaintOpBase {
  kind: 'path';
  d: string;
}

export interface RectOp extends PaintOpBase {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
}

export interface EllipseOp extends PaintOpBase {
  kind: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface CircleOp extends PaintOpBase {
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
}

export interface LineOp extends PaintOpBase {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type PaintOp = PathOp | RectOp | EllipseOp | CircleOp | LineOp;

/** The geometry half of a `PaintOp` (everything but the shared paint fields). */
export type PaintGeometry =
  | { kind: 'path'; d: string }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number; ry: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number };

export interface PaintResult {
  ops: PaintOp[];
  /** Tag names not translated natively, in first-seen document order. */
  untranslated: string[];
  gradientCount: number;
  diagnostics: string[];
  /** Phase 54 (DEF-384) — shape elements whose geometry could not be
   *  translated (non-finite or non-positive values) and were dropped. */
  droppedGeometry: number;
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Compose two SVG affine matrices: the result applies `m2`, then `m1`. */
export function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
  const [a, b, c, d, e, f] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

export function translationMatrix(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

export function scaleMatrix(sx: number, sy: number): Matrix {
  return [sx, 0, 0, sy, 0, 0];
}

/** SVG `rotate(deg)` (positive = clockwise in a y-down space). */
export function rotationMatrix(deg: number): Matrix {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [cos, sin, -sin, cos, 0, 0];
}

export function skewXMatrix(deg: number): Matrix {
  return [1, 0, Math.tan((deg * Math.PI) / 180), 1, 0, 0];
}

export function skewYMatrix(deg: number): Matrix {
  return [1, Math.tan((deg * Math.PI) / 180), 0, 1, 0, 0];
}

/** Parse an SVG `transform` attribute into one composed matrix. Unknown
 *  functions are reported and skipped; malformed input degrades to identity. */
export function parseTransform(raw: string | null): Matrix {
  if (raw === null || raw.trim().length === 0) return IDENTITY;
  const fnRe = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let combined: Matrix | null = null;
  let match = fnRe.exec(raw);
  while (match !== null) {
    const name = match[1].toLowerCase();
    const args = match[2]
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    let m: Matrix | null = null;
    if (name === 'matrix' && args.length === 6) {
      m = [args[0], args[1], args[2], args[3], args[4], args[5]];
    } else if (name === 'translate' && args.length >= 1) {
      m = translationMatrix(args[0], args.length >= 2 ? args[1] : 0);
    } else if (name === 'scale' && args.length >= 1) {
      m = scaleMatrix(args[0], args.length >= 2 ? args[1] : args[0]);
    } else if (name === 'rotate' && args.length >= 1) {
      const r = rotationMatrix(args[0]);
      m =
        args.length >= 3
          ? multiplyMatrix(
              multiplyMatrix(translationMatrix(args[1], args[2]), r),
              translationMatrix(-args[1], -args[2]),
            )
          : r;
    } else if (name === 'skewx' && args.length >= 1) {
      m = skewXMatrix(args[0]);
    } else if (name === 'skewy' && args.length >= 1) {
      m = skewYMatrix(args[0]);
    }
    if (m !== null) combined = combined === null ? m : multiplyMatrix(combined, m);
    match = fnRe.exec(raw);
  }
  return combined ?? IDENTITY;
}

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  lime: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  olive: '#808000',
  navy: '#000080',
  teal: '#008080',
  purple: '#800080',
  orange: '#ffa500',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  gold: '#ffd700',
  indigo: '#4b0082',
  violet: '#ee82ee',
  transparent: 'none',
};

function toHex(r: number, g: number, b: number): string {
  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Normalise a CSS colour to `#rrggbb` or null (`none`/unrecognised). */
export function parseColorToHex(
  raw: string,
  diagnostics: string[],
): { hex: string | null; gradientId: string | null } {
  const value = raw.trim().toLowerCase();
  if (value.length === 0 || value === 'none' || value === 'transparent') {
    return { hex: null, gradientId: null };
  }
  const url = /^url\(\s*['"]?#([^)'"]+)['"]?\s*\)$/.exec(value);
  if (url !== null) return { hex: null, gradientId: url[1] };
  if (value === 'currentcolor') return { hex: '#000000', gradientId: null };
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return {
      hex: `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`,
      gradientId: null,
    };
  }
  if (/^#[0-9a-f]{6}$/.test(value)) return { hex: value, gradientId: null };
  if (/^#[0-9a-f]{8}$/.test(value)) return { hex: value.slice(0, 7), gradientId: null };
  const fn = /^rgba?\(([^)]+)\)$/.exec(value);
  if (fn !== null) {
    const parts = fn[1].split(/[\s,/]+/).filter((p) => p.length > 0);
    const channels = parts.slice(0, 3).map((p) =>
      p.endsWith('%') ? (Number(p.slice(0, -1)) * 255) / 100 : Number(p),
    );
    if (channels.length === 3 && channels.every((n) => Number.isFinite(n))) {
      return { hex: toHex(channels[0], channels[1], channels[2]), gradientId: null };
    }
  }
  const named = NAMED_COLORS[value];
  if (named !== undefined) {
    return { hex: named === 'none' ? null : named, gradientId: null };
  }
  diagnostics.push(`Unrecognised colour "${raw}"; treated as none.`);
  return { hex: null, gradientId: null };
}

/** The explicit untranslated set; these hand the whole page to the engine. */
export const UNTRANSLATED_TAGS = new Set([
  'filter',
  'mask',
  'clippath',
  'foreignobject',
  'image',
  'text',
  'tspan',
  'textpath',
  'animate',
  'animatetransform',
  'animatemotion',
  'set',
]);

const DISPLAY_NAMES: Record<string, string> = {
  clippath: 'clipPath',
  foreignobject: 'foreignObject',
  textpath: 'textPath',
  animatetransform: 'animateTransform',
  animatemotion: 'animateMotion',
};

/** Elements that paint or contain painters. */
const SAFE_TAGS = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'use',
]);

/** Non-rendering elements that are neither painted nor a fallback trigger. */
const IGNORED_TAGS = new Set([
  'defs',
  'title',
  'desc',
  'metadata',
  'style',
  'lineargradient',
  'radialgradient',
  'stop',
  'symbol',
  'marker',
  'pattern',
]);

function displayName(tag: string): string {
  return DISPLAY_NAMES[tag] ?? tag;
}

function readNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function collectGradients(root: SvgNode, out: Map<string, SvgNode>): void {
  if (
    (root.tag === 'lineargradient' || root.tag === 'radialgradient') &&
    root.attrs.id !== undefined
  ) {
    out.set(root.attrs.id, root);
  }
  for (const child of root.children) collectGradients(child, out);
}

/** The gradient's dominant solid colour: the stop nearest offset 0.5. */
function gradientDominantColor(node: SvgNode, diagnostics: string[]): string {
  const stops = node.children.filter((child) => child.tag === 'stop');
  let best: { offset: number; color: string } | null = null;
  for (const stop of stops) {
    const offset = readNumber(stop.attrs.offset, 0);
    const raw = stop.attrs['stop-color'] ?? '#808080';
    const parsed = parseColorToHex(raw, diagnostics);
    const color = parsed.hex ?? '#808080';
    if (best === null || Math.abs(offset - 0.5) < Math.abs(best.offset - 0.5)) {
      best = { offset, color };
    }
  }
  return best?.color ?? '#808080';
}

interface PaintState {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
}

interface WalkContext {
  root: SvgNode;
  ops: PaintOp[];
  untranslated: string[];
  gradients: Map<string, SvgNode>;
  diagnostics: string[];
  gradientCount: number;
  droppedGeometry: number;
}

function resolveGradient(
  id: string,
  ctx: WalkContext,
  fallback: string | null,
): string | null {
  const gradient = ctx.gradients.get(id);
  if (gradient === undefined) {
    ctx.diagnostics.push(`Gradient reference "#${id}" could not be resolved.`);
    return fallback;
  }
  ctx.gradientCount += 1;
  return gradientDominantColor(gradient, ctx.diagnostics);
}

function resolvePaint(
  raw: string | null,
  ctx: WalkContext,
): string | null {
  if (raw === null) return null;
  const parsed = parseColorToHex(raw, ctx.diagnostics);
  if (parsed.gradientId !== null) {
    return resolveGradient(parsed.gradientId, ctx, '#808080');
  }
  return parsed.hex;
}

function childState(node: SvgNode, parent: PaintState): PaintState {
  const own = ownPresentation(node.attrs);
  const p = node.presentation;
  const ownOpacity = (key: string, fallback: number): number =>
    own[key as keyof typeof own] === undefined
      ? fallback
      : readNumber(own[key as keyof typeof own], fallback);
  return {
    fill: p.fill ?? parent.fill,
    stroke: p.stroke ?? parent.stroke,
    strokeWidth:
      p['stroke-width'] === undefined
        ? parent.strokeWidth
        : readNumber(p['stroke-width'], parent.strokeWidth),
    opacity: parent.opacity * ownOpacity('opacity', 1),
    fillOpacity: parent.fillOpacity * ownOpacity('fill-opacity', 1),
    strokeOpacity: parent.strokeOpacity * ownOpacity('stroke-opacity', 1),
  };
}

function pushUntranslated(ctx: WalkContext, tag: string): void {
  const name = displayName(tag);
  if (!ctx.untranslated.includes(name)) ctx.untranslated.push(name);
}

/** Phase 54 (DEF-384) — record a shape whose geometry was dropped, so the
 *  adapter can warn instead of importing a silently blank page. The
 *  diagnostics list is capped; the counter is not. */
const MAX_DROPPED_GEOMETRY_DIAGNOSTICS = 20;

function dropGeometry(ctx: WalkContext, node: SvgNode, reason: string): void {
  ctx.droppedGeometry += 1;
  if (ctx.diagnostics.length < MAX_DROPPED_GEOMETRY_DIAGNOSTICS) {
    ctx.diagnostics.push(`Geometry <${node.tag}> was not translated: ${reason}.`);
  }
}

function pushOp(
  ctx: WalkContext,
  state: PaintState,
  transform: Matrix,
  geometry: PaintGeometry,
): void {
  const fill = resolvePaint(state.fill, ctx);
  const stroke = resolvePaint(state.stroke, ctx);
  ctx.ops.push({
    ...geometry,
    fill,
    stroke,
    strokeWidth: state.strokeWidth,
    opacity: state.opacity,
    fillOpacity: state.fillOpacity,
    strokeOpacity: state.strokeOpacity,
    transform,
  } as PaintOp);
}

function polylinePath(points: string, close: boolean): string {
  const numbers = points
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const parts: string[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    parts.push(`${i === 0 ? 'M' : 'L'} ${numbers[i]},${numbers[i + 1]}`);
  }
  if (parts.length === 0) return '';
  return close ? `${parts.join(' ')} Z` : parts.join(' ');
}

function findById(node: SvgNode, id: string): SvgNode | null {
  if (node.attrs.id === id) return node;
  for (const child of node.children) {
    const found = findById(child, id);
    if (found !== null) return found;
  }
  return null;
}

function handleUse(
  node: SvgNode,
  state: PaintState,
  local: Matrix,
  useDepth: number,
  ctx: WalkContext,
): void {
  const href = node.attrs.href ?? node.attrs['xlink:href'] ?? '';
  const id = href.startsWith('#') ? href.slice(1) : '';
  if (id.length === 0 || useDepth >= 1) {
    pushUntranslated(ctx, 'use');
    return;
  }
  const target = findById(ctx.root, id);
  if (target === null) {
    pushUntranslated(ctx, 'use');
    return;
  }
  const translate = translationMatrix(
    readNumber(node.attrs.x, 0),
    readNumber(node.attrs.y, 0),
  );
  walk(target, state, multiplyMatrix(local, translate), useDepth + 1, ctx);
}

function emitShape(
  node: SvgNode,
  state: PaintState,
  local: Matrix,
  ctx: WalkContext,
): void {
  switch (node.tag) {
    case 'path': {
      const d = node.attrs.d ?? '';
      if (d.trim().length > 0) pushOp(ctx, state, local, { kind: 'path', d });
      else dropGeometry(ctx, node, 'the d attribute is empty');
      return;
    }
    case 'rect': {
      const width = readNumber(node.attrs.width, 0);
      const height = readNumber(node.attrs.height, 0);
      if (width <= 0 || height <= 0) {
        dropGeometry(ctx, node, `width/height is non-finite or non-positive (${node.attrs.width ?? '0'} x ${node.attrs.height ?? '0'})`);
        return;
      }
      pushOp(ctx, state, local, {
        kind: 'rect',
        x: readNumber(node.attrs.x, 0),
        y: readNumber(node.attrs.y, 0),
        width,
        height,
        rx: Math.max(0, readNumber(node.attrs.rx, 0)),
        ry: Math.max(0, readNumber(node.attrs.ry, 0)),
      });
      return;
    }
    case 'circle': {
      const r = readNumber(node.attrs.r, 0);
      if (r <= 0) {
        dropGeometry(ctx, node, `r is non-finite or non-positive (${node.attrs.r ?? '0'})`);
        return;
      }
      pushOp(ctx, state, local, {
        kind: 'circle',
        cx: readNumber(node.attrs.cx, 0),
        cy: readNumber(node.attrs.cy, 0),
        r,
      });
      return;
    }
    case 'ellipse': {
      const rx = readNumber(node.attrs.rx, 0);
      const ry = readNumber(node.attrs.ry, 0);
      if (rx <= 0 || ry <= 0) {
        dropGeometry(ctx, node, `rx/ry is non-finite or non-positive (${node.attrs.rx ?? '0'} x ${node.attrs.ry ?? '0'})`);
        return;
      }
      pushOp(ctx, state, local, {
        kind: 'ellipse',
        cx: readNumber(node.attrs.cx, 0),
        cy: readNumber(node.attrs.cy, 0),
        rx,
        ry,
      });
      return;
    }
    case 'line': {
      pushOp(ctx, { ...state, fill: null }, local, {
        kind: 'line',
        x1: readNumber(node.attrs.x1, 0),
        y1: readNumber(node.attrs.y1, 0),
        x2: readNumber(node.attrs.x2, 0),
        y2: readNumber(node.attrs.y2, 0),
      });
      return;
    }
    case 'polyline':
    case 'polygon': {
      const d = polylinePath(node.attrs.points ?? '', node.tag === 'polygon');
      if (d.length > 0) pushOp(ctx, state, local, { kind: 'path', d });
      else dropGeometry(ctx, node, 'no finite point pairs');
      return;
    }
    default:
      return;
  }
}

function walk(
  node: SvgNode,
  state: PaintState,
  matrix: Matrix,
  useDepth: number,
  ctx: WalkContext,
): void {
  const local = multiplyMatrix(matrix, parseTransform(node.transform));
  const next = childState(node, state);
  if (node.tag === 'svg' || node.tag === 'g') {
    for (const child of node.children) walk(child, next, local, useDepth, ctx);
    return;
  }
  if (node.tag === 'use') {
    handleUse(node, next, local, useDepth, ctx);
    return;
  }
  if (SAFE_TAGS.has(node.tag)) emitShape(node, next, local, ctx);
}

function scanUntranslated(
  node: SvgNode,
  untranslated: string[],
  diagnostics: string[],
): void {
  const isTrigger = node.tag !== 'svg' && UNTRANSLATED_TAGS.has(node.tag);
  if (isTrigger) {
    const name = displayName(node.tag);
    if (!untranslated.includes(name)) untranslated.push(name);
  } else if (!SAFE_TAGS.has(node.tag) && !IGNORED_TAGS.has(node.tag)) {
    const name = displayName(node.tag);
    diagnostics.push(`Unknown element <${node.tag}> was not translated.`);
    if (!untranslated.includes(name)) untranslated.push(name);
  }
  for (const child of node.children) scanUntranslated(child, untranslated, diagnostics);
}

/**
 * Turn a parse tree into paint operations. Pure: the returned `ops` are in SVG
 * user space and carry a single composed transform each.
 */
export function generatePaintOps(doc: SvgDocument): PaintResult {
  const diagnostics = [...doc.diagnostics];
  const untranslated: string[] = [];
  const root = doc.root;
  if (root === null) {
    return { ops: [], untranslated, gradientCount: 0, diagnostics, droppedGeometry: 0 };
  }
  scanUntranslated(root, untranslated, diagnostics);
  const gradients = new Map<string, SvgNode>();
  collectGradients(root, gradients);
  const ctx: WalkContext = {
    root,
    ops: [],
    untranslated,
    gradients,
    diagnostics,
    gradientCount: 0,
    droppedGeometry: 0,
  };
  const initial: PaintState = {
    fill: '#000000',
    stroke: null,
    strokeWidth: 1,
    opacity: 1,
    fillOpacity: 1,
    strokeOpacity: 1,
  };
  walk(root, initial, IDENTITY, 0, ctx);
  return {
    ops: ctx.ops,
    untranslated: ctx.untranslated,
    gradientCount: ctx.gradientCount,
    diagnostics: ctx.diagnostics,
    droppedGeometry: ctx.droppedGeometry,
  };
}

const KAPPA = (4 * (Math.SQRT2 - 1)) / 3;

function roundedRectPath(w: number, h: number, rx: number, ry: number): string {
  const cx = Math.max(0, Math.min(rx, w / 2));
  const cy = Math.max(0, Math.min(ry, h / 2));
  if (cx === 0 && cy === 0) return `M 0,0 H ${w} V ${h} H 0 Z`;
  return [
    `M ${cx},0`,
    `H ${w - cx}`,
    `C ${w - cx * (1 - KAPPA)},0 ${w},${cy * (1 - KAPPA)} ${w},${cy}`,
    `V ${h - cy}`,
    `C ${w},${h - cy * (1 - KAPPA)} ${w - cx * (1 - KAPPA)},${h} ${w - cx},${h}`,
    `H ${cx}`,
    `C ${cx * (1 - KAPPA)},${h} 0,${h - cy * (1 - KAPPA)} 0,${h - cy}`,
    `V ${cy}`,
    `C 0,${cy * (1 - KAPPA)} ${cx * (1 - KAPPA)},0 ${cx},0`,
    'Z',
  ].join(' ');
}

/** A non-`path` op as an equivalent SVG path `d` string. */
function geometryToPath(op: PaintOp): string {
  switch (op.kind) {
    case 'path':
      return op.d;
    case 'rect':
      return roundedRectPath(op.width, op.height, op.rx, op.ry);
    case 'circle':
      return `M ${op.cx - op.r},${op.cy} a ${op.r},${op.r} 0 1,0 ${2 * op.r},0 a ${op.r},${op.r} 0 1,0 ${-2 * op.r},0 Z`;
    case 'ellipse':
      return `M ${op.cx - op.rx},${op.cy} a ${op.rx},${op.ry} 0 1,0 ${2 * op.rx},0 a ${op.rx},${op.ry} 0 1,0 ${-2 * op.rx},0 Z`;
    case 'line':
      return `M ${op.x1},${op.y1} L ${op.x2},${op.y2}`;
    default:
      return '';
  }
}

function hexToRgb(hex: string): ReturnType<typeof rgb> {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

/**
 * Execute paint ops on a page. `root` maps SVG user coordinates (y-down) to PDF
 * page coordinates (y-up); each op's own transform is applied first. pdf-lib's
 * `drawSvgPath` internally flips the y axis, so its `matrix` option receives the
 * composed map pre-multiplied by that flip. Everything goes through pdf-lib's
 * vector API � no content-stream operators are written here.
 */
export function applyPaintOps(page: PDFPage, ops: PaintOp[], root: Matrix = IDENTITY): void {
  const flip: Matrix = [1, 0, 0, -1, 0, 0];
  for (const op of ops) {
    const device = multiplyMatrix(multiplyMatrix(root, op.transform), flip);
    const isLine = op.kind === 'line';
    const hasFill = op.fill !== null && !isLine;
    const hasStroke = op.stroke !== null;
    const d = geometryToPath(op);
    if (d.length === 0) continue;
    if (!hasFill && !hasStroke) continue;
    page.drawSvgPath(d, {
      matrix: device,
      color: hasFill ? hexToRgb(op.fill as string) : undefined,
      opacity: hasFill ? op.opacity * op.fillOpacity : undefined,
      borderColor: hasStroke ? hexToRgb(op.stroke as string) : undefined,
      borderWidth: hasStroke ? op.strokeWidth : undefined,
      borderOpacity: hasStroke ? op.opacity * op.strokeOpacity : undefined,
    });
  }
}
