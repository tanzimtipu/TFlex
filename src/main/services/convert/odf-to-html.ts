/**
 * Phase 55 feature A — the pure OpenDocument (ODF) XML to HTML mapper.
 *
 * No XML parser ships with the app and this phase adds no dependency, so the
 * subset ODF needs — elements, attributes, comments, CDATA and character
 * entities — is tokenised here with a bounded, depth-capped scanner. Everything
 * is pure string work: no I/O, no Electron.
 *
 * Mapping (element -> HTML):
 *   text:h + text:outline-level   -> <h1>..<h6>
 *   text:p                        -> <p>
 *   text:span + a bold/italic
 *     style resolved from styles.xml -> <strong> / <em>
 *   text:list / text:list-item    -> <ul> / <ol> with <li>
 *   table:table / table-row /
 *     table-cell                  -> <table> / <tr> / <td>
 *   draw:image (href in Pictures/) -> <img src="data:..." />
 *   text:s / text:tab / text:line-break -> spaces / tab / <br>
 */

/** Caps that keep a hostile or pathological XML document bounded. */
export const ODF_PARSE_LIMITS = {
  maxNodes: 200_000,
  maxDepth: 256,
  maxTextChars: 16 * 1024 * 1024,
} as const;

export interface OdfParseLimits {
  maxNodes: number;
  maxDepth: number;
  maxTextChars: number;
}

/** Raised when the XML is malformed or exceeds a parse cap. */
export class OdfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OdfParseError';
  }
}

interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: Array<XmlElement | string>;
}

/** The resolved text formatting a named ODF style carries. */
export interface OdfTextStyle {
  bold: boolean;
  italic: boolean;
}

/** What `styles.xml` contributes to the mapping. */
export interface OdfStyleTable {
  /** style:name -> resolved bold/italic (parent styles folded in). */
  textStyles: Map<string, OdfTextStyle>;
  /** list-style names drawn with numbers (-> <ol>); the rest are bullets. */
  orderedLists: Set<string>;
}

/** Strip the namespace prefix; ODF uses `text:`, `table:`, `draw:` etc. */
export function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

function parseAttributes(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    attrs[match[1]] = match[2] !== undefined ? match[2] : (match[3] ?? '');
  }
  return attrs;
}

/** Tokenise ODF XML into a shallow tree. Bounded and defensive by design. */
export function parseOdfXml(
  xml: string,
  limits: OdfParseLimits = ODF_PARSE_LIMITS,
): XmlElement {
  const root: XmlElement = { name: '#root', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let nodes = 0;
  let textChars = 0;
  let i = 0;

  const pushText = (text: string): void => {
    if (text.length === 0) return;
    textChars += text.length;
    if (textChars > limits.maxTextChars) {
      throw new OdfParseError('ODF text exceeds the parse ceiling.');
    }
    stack[stack.length - 1].children.push(text);
  };

  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      pushText(xml.slice(i));
      break;
    }
    if (lt > i) pushText(xml.slice(i, lt));

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) throw new OdfParseError('Unterminated XML comment.');
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) throw new OdfParseError('Unterminated CDATA section.');
      pushText(xml.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt);
      if (end < 0) throw new OdfParseError('Unterminated XML declaration.');
      i = end + 1;
      continue;
    }

    const end = xml.indexOf('>', lt);
    if (end < 0) throw new OdfParseError('Unterminated XML tag.');
    let body = xml.slice(lt + 1, end);

    if (body.startsWith('/')) {
      const name = body.slice(1).trim();
      let depth = stack.length - 1;
      while (depth > 0 && stack[depth].name !== name) depth -= 1;
      if (depth === 0 && stack[0].name !== name) {
        throw new OdfParseError(`Unexpected closing tag </${name}>.`);
      }
      stack.length = depth;
      i = end + 1;
      continue;
    }

    let selfClosing = false;
    if (body.endsWith('/')) {
      selfClosing = true;
      body = body.slice(0, -1);
    }
    const space = body.search(/\s/);
    const name = space < 0 ? body : body.slice(0, space);
    if (name.length === 0) throw new OdfParseError('Empty XML tag name.');
    const node: XmlElement = {
      name,
      attrs: parseAttributes(space < 0 ? '' : body.slice(space)),
      children: [],
    };
    nodes += 1;
    if (nodes > limits.maxNodes) throw new OdfParseError('ODF node ceiling reached.');
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) {
      stack.push(node);
      if (stack.length > limits.maxDepth) throw new OdfParseError('ODF depth ceiling reached.');
    }
    i = end + 1;
  }

  return root;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (whole, entity: string) => {
    const named = ENTITIES[entity];
    if (named !== undefined) return named;
    if (entity.startsWith('#')) {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      if (Number.isFinite(code)) return String.fromCodePoint(code);
    }
    return whole;
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeOdfText(text: string): string {
  return escapeHtml(unescapeXml(text));
}

function forEachElement(
  node: XmlElement,
  visit: (element: XmlElement) => void,
): void {
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    visit(child);
    forEachElement(child, visit);
  }
}

function readTextProperties(element: XmlElement): { bold?: boolean; italic?: boolean } {
  const props = element.children.find(
    (child): child is XmlElement =>
      typeof child !== 'string' && localName(child.name) === 'text-properties',
  );
  if (props === undefined) return {};
  const out: { bold?: boolean; italic?: boolean } = {};
  const weight = props.attrs['fo:font-weight'];
  if (weight !== undefined) {
    if (weight === 'bold') out.bold = true;
    else if (Number.isFinite(Number(weight))) out.bold = Number(weight) >= 600;
    else out.bold = false;
  }
  const style = props.attrs['fo:font-style'];
  if (style !== undefined) out.italic = style === 'italic' || style === 'oblique';
  return out;
}

interface RawStyle {
  parent?: string;
  bold?: boolean;
  italic?: boolean;
}

/**
 * Read `styles.xml` into the two lookups the mapper needs: named text styles
 * with parent inheritance folded in, and the ordered-list set. Unknown shapes
 * are ignored; a malformed styles file throws `OdfParseError` and the adapter
 * surfaces it as `corrupt`.
 */
export function parseOfficeStyles(stylesXml: string): OdfStyleTable {
  const root = parseOdfXml(stylesXml);
  const raw = new Map<string, RawStyle>();
  const orderedLists = new Set<string>();

  forEachElement(root, (element) => {
    const name = localName(element.name);
    if (name === 'style') {
      const styleName = element.attrs['style:name'];
      const family = element.attrs['style:family'];
      if (
        styleName !== undefined &&
        (family === 'text' || family === 'paragraph' || family === 'table-cell')
      ) {
        raw.set(styleName, {
          parent: element.attrs['style:parent-style-name'],
          ...readTextProperties(element),
        });
      }
    } else if (name === 'default-style') {
      const family = element.attrs['style:family'];
      if (family === 'text' || family === 'paragraph') {
        const props = readTextProperties(element);
        if (props.bold !== undefined || props.italic !== undefined) {
          raw.set('#default', props);
        }
      }
    } else if (name === 'list-style') {
      const styleName = element.attrs['style:name'];
      if (styleName === undefined) return;
      let numbered = false;
      forEachElement(element, (child) => {
        if (localName(child.name) === 'list-level-style-number') numbered = true;
      });
      if (numbered) orderedLists.add(styleName);
    }
  });

  const textStyles = new Map<string, OdfTextStyle>();
  for (const styleName of raw.keys()) {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = styleName;
    while (current !== undefined && !seen.has(current) && chain.length < 64) {
      seen.add(current);
      chain.push(current);
      current = raw.get(current)?.parent;
    }
    let bold = false;
    let italic = false;
    // Parent-most first so a child's explicit value overrides its parent.
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const value = raw.get(chain[index]);
      if (value?.bold !== undefined) bold = value.bold;
      if (value?.italic !== undefined) italic = value.italic;
    }
    textStyles.set(styleName, { bold, italic });
  }

  return { textStyles, orderedLists };
}

/** Href -> data URI for every image the adapter base64-embedded. */
export type OdfImageMap = Map<string, string>;

interface RenderContext {
  styles: OdfStyleTable;
  images: OdfImageMap;
}

const LINE_SPACE = '&nbsp;';
const TAB_SPAN = '<span class="odf-tab">&#9;</span>';
const MAX_REPEATED_CELLS = 1000;

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function renderInline(nodes: Array<XmlElement | string>, ctx: RenderContext): string {
  let out = '';
  for (const child of nodes) {
    if (typeof child === 'string') {
      // Whitespace from XML pretty-printing is not significant in ODF.
      out += escapeHtml(unescapeXml(child).replace(/\s+/g, ' '));
      continue;
    }
    switch (localName(child.name)) {
      case 'span': {
        const inner = renderInline(child.children, ctx);
        const styleName = child.attrs['text:style-name'];
        const style = styleName === undefined ? undefined : ctx.styles.textStyles.get(styleName);
        let wrapped = inner;
        if (style?.bold === true) wrapped = `<strong>${wrapped}</strong>`;
        if (style?.italic === true) wrapped = `<em>${wrapped}</em>`;
        out += wrapped;
        break;
      }
      case 's':
        out += LINE_SPACE.repeat(clampInt(child.attrs['text:c'], 1, 1, 1000));
        break;
      case 'tab':
        out += TAB_SPAN;
        break;
      case 'line-break':
        out += '<br>';
        break;
      case 'a':
        // Links are printed as text (Chromium emits no link annotations).
        out += renderInline(child.children, ctx);
        break;
      case 'image': {
        const href = child.attrs['xlink:href'] ?? child.attrs['href'];
        const data = href === undefined ? undefined : ctx.images.get(href);
        if (data !== undefined) out += `<img src="${data}" alt="">`;
        break;
      }
      case 'frame':
      case 'g':
        out += renderInline(child.children, ctx);
        break;
      case 'note':
        break;
      default:
        out += renderInline(child.children, ctx);
        break;
    }
  }
  return out;
}

function renderList(node: XmlElement, ctx: RenderContext): string {
  const styleName = node.attrs['text:style-name'];
  const ordered = styleName !== undefined && ctx.styles.orderedLists.has(styleName);
  const tag = ordered ? 'ol' : 'ul';
  let out = `<${tag}>`;
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    if (localName(child.name) !== 'list-item') continue;
    out += `<li>${renderListItem(child, ctx)}</li>`;
  }
  return `${out}</${tag}>`;
}

function renderListItem(node: XmlElement, ctx: RenderContext): string {
  const parts: string[] = [];
  for (const child of node.children) {
    if (typeof child === 'string' || child.name === '') continue;
    const name = localName(child.name);
    if (name === 'p') {
      parts.push(renderInline(child.children, ctx));
    } else if (name === 'list') {
      parts.push(renderList(child, ctx));
    } else if (name === 'table') {
      parts.push(renderTable(child, ctx));
    } else if (name === 'h') {
      parts.push(renderInline(child.children, ctx));
    }
  }
  return parts.join('<br>');
}

function renderCell(node: XmlElement, ctx: RenderContext): string {
  const parts: string[] = [];
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    const name = localName(child.name);
    if (name === 'p') parts.push(renderInline(child.children, ctx));
    else if (name === 'list') parts.push(renderList(child, ctx));
    else if (name === 'table') parts.push(renderTable(child, ctx));
    else if (name === 'h') parts.push(renderInline(child.children, ctx));
  }
  return parts.join('<br>');
}

function renderRows(node: XmlElement, ctx: RenderContext): string {
  let out = '';
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    const name = localName(child.name);
    if (name === 'table-row') {
      out += '<tr>';
      for (const cell of child.children) {
        if (typeof cell === 'string') continue;
        const cellName = localName(cell.name);
        if (cellName !== 'table-cell' && cellName !== 'covered-table-cell') continue;
        const repeat =
          cellName === 'covered-table-cell'
            ? 1
            : clampInt(cell.attrs['table:number-columns-repeated'], 1, 1, MAX_REPEATED_CELLS);
        for (let n = 0; n < repeat; n += 1) {
          out += `<td>${renderCell(cell, ctx)}</td>`;
        }
      }
      out += '</tr>';
    } else if (
      name === 'table-rows' ||
      name === 'table-header-rows' ||
      name === 'table-row-group'
    ) {
      out += renderRows(child, ctx);
    }
  }
  return out;
}

function renderTable(node: XmlElement, ctx: RenderContext): string {
  return `<table>${renderRows(node, ctx)}</table>`;
}

function renderHeading(node: XmlElement, ctx: RenderContext): string {
  const level = clampInt(node.attrs['text:outline-level'], 1, 1, 6);
  return `<h${level}>${renderInline(node.children, ctx)}</h${level}>`;
}

function renderBlocks(nodes: Array<XmlElement | string>, ctx: RenderContext): string {
  let out = '';
  for (const child of nodes) {
    if (typeof child === 'string') continue;
    switch (localName(child.name)) {
      case 'h':
        out += renderHeading(child, ctx);
        break;
      case 'p':
        out += `<p>${renderInline(child.children, ctx)}</p>`;
        break;
      case 'list':
        out += renderList(child, ctx);
        break;
      case 'table':
        out += renderTable(child, ctx);
        break;
      case 'section':
        out += renderBlocks(child.children, ctx);
        break;
      case 'frame':
      case 'image':
        out += renderInline([child], ctx);
        break;
      default:
        break;
    }
  }
  return out;
}

function findFirst(node: XmlElement, wanted: string): XmlElement | null {
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    if (localName(child.name) === wanted) return child;
    const nested = findFirst(child, wanted);
    if (nested !== null) return nested;
  }
  return null;
}

/**
 * Render `content.xml`'s text body to an HTML fragment (no shell, no CSS).
 * `images` maps an ODF href (e.g. `Pictures/a.png`) to its `data:` URI.
 */
export function odfToHtml(
  contentXml: string,
  styles: OdfStyleTable,
  images: OdfImageMap,
): string {
  const root = parseOdfXml(contentXml);
  const body = findFirst(root, 'body');
  const text = body === null ? null : findFirst(body, 'text');
  const nodes = text === null ? root.children : text.children;
  return renderBlocks(nodes, { styles, images });
}
