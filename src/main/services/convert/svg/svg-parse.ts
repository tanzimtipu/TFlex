/**
 * Phase 54 feature C — a tiny, forgiving SVG XML scanner.
 *
 * Pure: no I/O, no pdf-lib, no Electron. It never throws on malformed input;
 * it returns whatever it could parse plus a diagnostics list. The tree carries
 * the raw attributes plus the resolved (inherited) presentation attributes, the
 * document's `viewBox` and its `width`/`height`, and the intrinsic size in PDF
 * points (`resolveSvgSize`).
 *
 * This is deliberately NOT a general XML parser: it understands the element /
 * attribute / comment / CDATA / processing-instruction shapes an SVG file can
 * contain, which is all the painter needs.
 */

/** The six inherited SVG presentation attributes this importer resolves. */
export interface SvgPresentation {
  fill?: string;
  stroke?: string;
  'stroke-width'?: string;
  opacity?: string;
  'fill-opacity'?: string;
  'stroke-opacity'?: string;
}

export interface SvgNode {
  /** Lower-case tag name. */
  tag: string;
  /** Lower-case attribute names to raw string values. */
  attrs: Record<string, string>;
  /** Raw `transform` attribute, or null. */
  transform: string | null;
  /** Nearest-value inherited presentation attributes. */
  presentation: SvgPresentation;
  /** Concatenated direct text content (used to spot `text`/`tspan`). */
  text: string;
  children: SvgNode[];
}

export interface SvgViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface SvgDocument {
  root: SvgNode | null;
  viewBox: SvgViewBox | null;
  width: string | null;
  height: string | null;
  diagnostics: string[];
}

const PRESENTATION_KEYS = [
  'fill',
  'stroke',
  'stroke-width',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
] as const;

/** Parse a `style="a:b;c:d"` string into a key/value map (lower-case keys). */
function parseStyle(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of style.split(';')) {
    const colon = decl.indexOf(':');
    if (colon <= 0) continue;
    const key = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (key.length > 0 && value.length > 0) out[key] = value;
  }
  return out;
}

/** The element's own presentation values (attributes, then `style` overriding). */
export function ownPresentation(attrs: Record<string, string>): SvgPresentation {
  const style =
    attrs.style === undefined ? {} : parseStyle(attrs.style);
  const out: SvgPresentation = {};
  for (const key of PRESENTATION_KEYS) {
    const value = style[key] ?? attrs[key];
    if (value !== undefined && value.length > 0) out[key] = value;
  }
  return out;
}

interface RawToken {
  kind: 'open' | 'close' | 'text';
  tag?: string;
  attrs?: Record<string, string>;
  selfClosing?: boolean;
  text?: string;
}

/** Read one `<tag attr="v" ...>` or `</tag>` token starting at `start`. */
function readTag(
  source: string,
  start: number,
  diagnostics: string[],
): { token: RawToken; end: number } | null {
  let i = start + 1;
  const closing = source[i] === '/';
  if (closing) i += 1;
  const nameStart = i;
  while (i < source.length && /[^\s/>]/.test(source[i])) i += 1;
  const tag = source.slice(nameStart, i).toLowerCase();
  if (tag.length === 0) {
    diagnostics.push(`Malformed tag near offset ${start}.`);
    const gt = source.indexOf('>', start);
    return gt === -1 ? null : { token: { kind: 'text', text: '' }, end: gt + 1 };
  }
  const attrs: Record<string, string> = {};
  let selfClosing = false;
  while (i < source.length) {
    while (i < source.length && /\s/.test(source[i])) i += 1;
    if (source.startsWith('/>', i)) {
      selfClosing = true;
      i += 2;
      break;
    }
    if (source[i] === '>') {
      i += 1;
      break;
    }
    const keyStart = i;
    while (i < source.length && !/[\s=/>]/.test(source[i])) i += 1;
    const key = source.slice(keyStart, i).toLowerCase();
    if (key.length === 0) {
      i += 1;
      continue;
    }
    while (i < source.length && /\s/.test(source[i])) i += 1;
    if (source[i] !== '=') {
      attrs[key] = '';
      continue;
    }
    i += 1;
    while (i < source.length && /\s/.test(source[i])) i += 1;
    const quote = source[i];
    let value: string;
    if (quote === '"' || quote === "'") {
      const valueStart = i + 1;
      const close = source.indexOf(quote, valueStart);
      if (close === -1) {
        value = source.slice(valueStart);
        i = source.length;
        diagnostics.push(`Unterminated attribute value for <${tag} ${key}>.`);
      } else {
        value = source.slice(valueStart, close);
        i = close + 1;
      }
    } else {
      const valueStart = i;
      while (i < source.length && !/[\s/>]/.test(source[i])) i += 1;
      value = source.slice(valueStart, i);
    }
    attrs[key] = value;
  }
  if (closing) return { token: { kind: 'close', tag }, end: i };
  return { token: { kind: 'open', tag, attrs, selfClosing }, end: i };
}

function appendText(stack: SvgNode[], text: string): void {
  if (text.length === 0) return;
  stack[stack.length - 1].text += text;
}

/** Parse an SVG source string into a forgiving tree (never throws). */
export function parseSvg(source: string): SvgDocument {
  const diagnostics: string[] = [];
  const document: SvgNode = {
    tag: '#document',
    attrs: {},
    transform: null,
    presentation: {},
    text: '',
    children: [],
  };
  const stack: SvgNode[] = [document];
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) {
      appendText(stack, source.slice(i));
      break;
    }
    if (lt > i) appendText(stack, source.slice(i, lt));
    try {
      if (source.startsWith('<!--', lt)) {
        const end = source.indexOf('-->', lt + 4);
        if (end === -1) {
          diagnostics.push('Unterminated comment.');
          break;
        }
        i = end + 3;
        continue;
      }
      if (source.startsWith('<![CDATA[', lt)) {
        const end = source.indexOf(']]>', lt + 9);
        appendText(stack, source.slice(lt + 9, end === -1 ? source.length : end));
        i = end === -1 ? source.length : end + 3;
        continue;
      }
      if (source.startsWith('<?', lt)) {
        const end = source.indexOf('?>', lt + 2);
        i = end === -1 ? source.length : end + 2;
        continue;
      }
      if (source.startsWith('<!', lt)) {
        const end = source.indexOf('>', lt + 2);
        i = end === -1 ? source.length : end + 1;
        continue;
      }
      const read = readTag(source, lt, diagnostics);
      if (read === null) break;
      const { token, end } = read;
      i = end;
      if (token.kind === 'text') continue;
      if (token.kind === 'close') {
        const tag = token.tag as string;
        let at = stack.length - 1;
        while (at > 0 && stack[at].tag !== tag) at -= 1;
        if (at > 0) {
          if (at !== stack.length - 1) {
            diagnostics.push(`Unclosed <${stack[stack.length - 1].tag}> before </${tag}>.`);
          }
          stack.length = at;
        } else {
          diagnostics.push(`Stray closing tag </${tag}>.`);
        }
        continue;
      }
      const parent = stack[stack.length - 1];
      const attrs = token.attrs ?? {};
      const node: SvgNode = {
        tag: token.tag as string,
        attrs,
        transform: attrs.transform ?? null,
        presentation: { ...parent.presentation, ...ownPresentation(attrs) },
        text: '',
        children: [],
      };
      parent.children.push(node);
      if (!token.selfClosing) stack.push(node);
    } catch {
      diagnostics.push(`Malformed markup near offset ${lt}.`);
      break;
    }
  }
  if (stack.length > 1) {
    for (let at = 1; at < stack.length; at += 1) {
      diagnostics.push(`Unclosed <${stack[at].tag}> element.`);
    }
  }
  const svg = document.children.find((child) => child.tag === 'svg') ?? null;
  if (svg === null) diagnostics.push('No <svg> root element was found.');
  const viewBoxRaw = svg?.attrs.viewbox ?? null;
  const viewBox = viewBoxRaw === null ? null : parseViewBox(viewBoxRaw, diagnostics);
  return {
    root: svg,
    viewBox,
    width: svg?.attrs.width ?? null,
    height: svg?.attrs.height ?? null,
    diagnostics,
  };
}

/** Parse a `viewBox` string; returns null (with a diagnostic) when malformed. */
export function parseViewBox(
  raw: string,
  diagnostics: string[],
): SvgViewBox | null {
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    diagnostics.push(`Malformed viewBox "${raw}".`);
    return null;
  }
  const [minX, minY, width, height] = parts;
  if (width <= 0 || height <= 0) {
    diagnostics.push(`viewBox has a non-positive size ("${raw}").`);
    return null;
  }
  return { minX, minY, width, height };
}

/** PDF points per unit. Unitless SVG length is a CSS px (96 DPI). */
const UNIT_TO_POINTS: Record<string, number> = {
  '': 72 / 96,
  px: 72 / 96,
  pt: 1,
  pc: 12,
  mm: 72 / 25.4,
  cm: 72 / 2.54,
  in: 72,
};

/** A parsed absolute length in points, or null for `%`/non-numeric values. */
export function parseLengthPoints(raw: string | null): number | null {
  if (raw === null) return null;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)$/i.exec(
    raw.trim(),
  );
  if (match === null) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || unit === '%') return null;
  const factor = UNIT_TO_POINTS[unit] ?? UNIT_TO_POINTS[''];
  return value * factor;
}

/**
 * The SVG's intrinsic page size in PDF points: its own `width`/`height` (units
 * honoured; unitless = CSS px at 96 DPI) or, when only a `viewBox` exists, the
 * viewBox at 96 DPI. A single dimension derives the other from the viewBox
 * aspect. Null when the document declares neither a size nor a viewBox.
 */
export function resolveSvgSize(
  doc: SvgDocument,
): { widthPt: number; heightPt: number } | null {
  let widthPt = parseLengthPoints(doc.width);
  let heightPt = parseLengthPoints(doc.height);
  const viewBox = doc.viewBox;
  if (widthPt !== null && widthPt <= 0) widthPt = null;
  if (heightPt !== null && heightPt <= 0) heightPt = null;

  if (widthPt !== null && heightPt !== null) return { widthPt, heightPt };
  if (viewBox === null) return null;

  const vbWidthPt = viewBox.width * (72 / 96);
  const vbHeightPt = viewBox.height * (72 / 96);
  if (widthPt === null && heightPt === null) {
    return { widthPt: vbWidthPt, heightPt: vbHeightPt };
  }
  if (widthPt === null) {
    return { widthPt: ((heightPt as number) * vbWidthPt) / vbHeightPt, heightPt: heightPt as number };
  }
  return { widthPt, heightPt: (widthPt * vbHeightPt) / vbWidthPt };
}
