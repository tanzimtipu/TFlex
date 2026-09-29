import { ConvertFailure } from './errors';
import type { ZipArchive } from './convert-zip';
import { localName, parseOdfXml } from './odf-to-html';

/**
 * Phase 56 feature A — the pure EPUB 2/3 container parser.
 *
 * An EPUB is a ZIP: `META-INF/container.xml` names the OPF, the OPF's
 * `<manifest>` names every part and its `<spine>` fixes the reading order.
 * This module is pure string work over an ALREADY-OPENED archive (no I/O, no
 * Electron), so chunk 1b's reading view reuses it verbatim: the raw chapter
 * XHTML comes back on each spine item.
 *
 * No XML dependency is added: the container and OPF are tokenised with the
 * same bounded scanner the ODF mapper uses (`parseOdfXml`), and the ZIP
 * ceilings are enforced by `openZip` before this runs. A missing
 * `container.xml`, a missing rootfile, an OPF with no spine and a spine entry
 * with no manifest item are typed `corrupt` failures.
 */

/** One spine chapter: manifest id, OPF-relative href, raw XHTML source. */
export interface EpubSpineItem {
  id: string;
  href: string;
  xhtml: string;
}

export interface EpubDocument {
  /** `<dc:title>`, decoded; empty when the OPF has none. */
  title: string;
  spine: EpubSpineItem[];
  /** OPF-relative image href -> `data:` URI (the CSP allows `data:` only). */
  images: Map<string, string>;
  /** OPF-relative href of the cover image, when the package declares one. */
  coverHref?: string;
  /** True when a spine item was skipped because it is not renderable XHTML
   *  (e.g. a DTBook or SVG spine entry) or its part is absent. The adapter
   *  turns this into one `legacy-format-degraded` warning; a clean package
   *  never sets it. */
  degraded: boolean;
}

type XmlNode = ReturnType<typeof parseOdfXml>;

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  webp: 'image/webp',
};

function childElements(node: XmlNode): XmlNode[] {
  return node.children.filter((child) => typeof child !== 'string');
}

/** Every descendant element whose local name is `name`, in document order. */
function elementsNamed(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  for (const child of childElements(node)) {
    if (localName(child.name) === name) out.push(child);
    out.push(...elementsNamed(child, name));
  }
  return out;
}

function firstElement(node: XmlNode, name: string): XmlNode | null {
  for (const child of childElements(node)) {
    if (localName(child.name) === name) return child;
    const nested = firstElement(child, name);
    if (nested !== null) return nested;
  }
  return null;
}

function textContent(node: XmlNode): string {
  let out = '';
  for (const child of node.children) {
    out += typeof child === 'string' ? child : textContent(child);
  }
  return out;
}

/** Decode the five XML entities and numeric character references. */
function decodeXmlText(text: string): string {
  return text.replace(
    /&(#[0-9]+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g,
    (whole, entity: string) => {
      switch (entity) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default:
          break;
      }
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    },
  );
}

/** Collapse `.`/`..`/duplicate separators in an in-package path. */
function normalizePath(path: string): string {
  const parts = path.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

function dirOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

/** Percent-decode a manifest href without ever throwing on malformed input. */
function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/**
 * Resolve a manifest/chapter href against the directory of the part that
 * declared it. Returns `null` for an absolute-scheme URL (`http:`, `data:`,
 * ...): those are never in-package parts and must not be looked up.
 */
export function resolveEpubHref(baseDir: string, href: string): string | null {
  const raw = decodeHref(href.split('#')[0].split('?')[0]).trim();
  if (raw.length === 0) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return null;
  if (raw.startsWith('/')) return normalizePath(raw);
  return normalizePath(baseDir.length === 0 ? raw : `${baseDir}/${raw}`);
}

function parseXmlOrCorrupt(xml: string, what: string): XmlNode {
  try {
    return parseOdfXml(xml);
  } catch (thrown) {
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    throw new ConvertFailure(
      'corrupt',
      `The EPUB ${what} could not be parsed: ${detail}`,
    );
  }
}

/** Base64-embed every manifest image, keyed by its OPF-relative href. */
function collectEpubImages(
  archive: ZipArchive,
  items: Map<string, ManifestItem>,
): Map<string, string> {
  const images = new Map<string, string>();
  for (const item of items.values()) {
    const ext = item.href.slice(item.href.lastIndexOf('.') + 1).toLowerCase();
    const mime = item.mediaType.startsWith('image/')
      ? item.mediaType
      : IMAGE_MIME[ext];
    if (mime === undefined) continue;
    const bytes = archive.readBytes(item.href);
    if (bytes === null || bytes.length === 0) continue;
    images.set(
      item.href,
      `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
    );
  }
  return images;
}

/** The EPUB2 `<meta name="cover" content="ID">` fallback for the cover part. */
function metaCoverId(opfRoot: XmlNode): string | null {
  for (const meta of elementsNamed(opfRoot, 'meta')) {
    if ((meta.attrs['name'] ?? '').trim().toLowerCase() !== 'cover') continue;
    const content = (meta.attrs['content'] ?? '').trim();
    if (content.length > 0) return content;
  }
  return null;
}

function readTitle(opfRoot: XmlNode): string {
  for (const element of elementsNamed(opfRoot, 'title')) {
    const text = decodeXmlText(textContent(element)).trim();
    if (text.length > 0) return text;
  }
  return '';
}

/**
 * Parse an opened EPUB archive into its reading order and resources. Throws a
 * typed `ConvertFailure('corrupt', ...)` for a package that cannot be read;
 * never touches the filesystem or Electron.
 */
export function parseEpub(archive: ZipArchive): EpubDocument {
  const containerXml = archive.readText('META-INF/container.xml');
  if (containerXml === null) {
    throw new ConvertFailure(
      'corrupt',
      'The EPUB package has no META-INF/container.xml part.',
    );
  }
  const containerRoot = parseXmlOrCorrupt(containerXml, 'META-INF/container.xml');
  const fullPath = (firstElement(containerRoot, 'rootfile')?.attrs['full-path'] ?? '').trim();
  if (fullPath.length === 0) {
    throw new ConvertFailure(
      'corrupt',
      'The EPUB container.xml names no OPF rootfile.',
    );
  }

  const opfPath = normalizePath(decodeHref(fullPath));
  const opfXml = archive.readText(opfPath);
  if (opfXml === null) {
    throw new ConvertFailure(
      'corrupt',
      `The EPUB OPF part "${opfPath}" is missing from the container.`,
    );
  }
  const opfRoot = parseXmlOrCorrupt(opfXml, 'OPF');
  const opfDir = dirOf(opfPath);

  const items = new Map<string, ManifestItem>();
  const manifest = firstElement(opfRoot, 'manifest');
  if (manifest !== null) {
    for (const element of elementsNamed(manifest, 'item')) {
      const id = element.attrs['id'];
      const href = element.attrs['href'];
      if (id === undefined || href === undefined) continue;
      const resolved = resolveEpubHref(opfDir, href);
      if (resolved === null) continue;
      items.set(id, {
        id,
        href: resolved,
        mediaType: (element.attrs['media-type'] ?? '').trim().toLowerCase(),
        properties: (element.attrs['properties'] ?? '').trim(),
      });
    }
  }

  const spineElement = firstElement(opfRoot, 'spine');
  if (spineElement === null) {
    throw new ConvertFailure('corrupt', 'The EPUB OPF has no spine.');
  }
  const itemrefs = elementsNamed(spineElement, 'itemref');
  if (itemrefs.length === 0) {
    throw new ConvertFailure('corrupt', 'The EPUB OPF spine is empty.');
  }

  const spine: EpubSpineItem[] = [];
  let degraded = false;
  for (const ref of itemrefs) {
    const idref = ref.attrs['idref'];
    if (idref === undefined) continue;
    const item = items.get(idref);
    if (item === undefined) {
      throw new ConvertFailure(
        'corrupt',
        `The EPUB spine references a manifest item ("${idref}") that does not exist.`,
      );
    }
    const renderable =
      item.mediaType === 'application/xhtml+xml' || item.mediaType === 'text/html';
    if (!renderable) {
      degraded = true;
      continue;
    }
    const xhtml = archive.readText(item.href);
    if (xhtml === null) {
      degraded = true;
      continue;
    }
    spine.push({ id: item.id, href: item.href, xhtml });
  }

  const images = collectEpubImages(archive, items);

  let coverHref: string | undefined;
  for (const item of items.values()) {
    if (item.properties.split(/\s+/).includes('cover-image')) {
      coverHref = item.href;
      break;
    }
  }
  if (coverHref === undefined) {
    const id = metaCoverId(opfRoot);
    if (id !== null) coverHref = items.get(id)?.href;
  }
  if (coverHref !== undefined && !images.has(coverHref)) coverHref = undefined;

  return { title: readTitle(opfRoot), spine, images, coverHref, degraded };
}

/** The chapter's renderable fragment: XML prologue/DOCTYPE and the wrapping
 *  `html`/`head`/`body` shells are stripped so a chapter nests cleanly inside
 *  the composed print document. A fragment with no `body` is returned as-is. */
export function chapterFragment(xhtml: string): string {
  const withoutPrologue = xhtml.replace(/<\?[\s\S]*?\?>/g, '');
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(withoutPrologue);
  if (body !== null) return body[1];
  const withoutDoctype = withoutPrologue.replace(
    /<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/gi,
    '',
  );
  const html = /<html\b[^>]*>([\s\S]*?)<\/html\s*>/i.exec(withoutDoctype);
  if (html !== null) return html[1].replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, '');
  return withoutDoctype;
}

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SVG_IMAGE_TAG_RE = /<image\b[^>]*>/gi;
const SRC_ATTR_RE = /(?<![\w-])src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const HREF_ATTR_RE = /(?<![\w:-])(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

/** Replace every in-package image reference in a chapter with its `data:`
 *  URI. A reference the image map does not hold (remote, missing) is left
 *  untouched: the CSP and session rules block it and it surfaces as a
 *  `resource-blocked` warning. */
export function inlineEpubImages(
  xhtml: string,
  chapterHref: string,
  images: Map<string, string>,
): string {
  if (images.size === 0) return xhtml;
  const baseDir = dirOf(chapterHref);
  const dataFor = (value: string | undefined): string | undefined => {
    if (value === undefined) return undefined;
    const resolved = resolveEpubHref(baseDir, value);
    return resolved === null ? undefined : images.get(resolved);
  };
  const rewrite = (
    tag: string,
    attrRe: RegExp,
    name: string,
  ): string =>
    tag.replace(attrRe, (whole, double, single, bare) => {
      const data = dataFor(double ?? single ?? bare);
      return data === undefined ? whole : `${name}="${data}"`;
    });

  return xhtml
    .replace(IMG_TAG_RE, (tag) => rewrite(tag, SRC_ATTR_RE, 'src'))
    .replace(SVG_IMAGE_TAG_RE, (tag) => rewrite(tag, HREF_ATTR_RE, 'xlink:href'));
}

/**
 * Phase 56 feature A — the Reading-view whitelist scrubber.
 *
 * The reading payload is injected into the renderer DOM, so the raw chapter
 * fragment must not carry executable or embedding constructs. This keeps a
 * documented allowlist of structural/inline tags and only the attributes the
 * Reading view consumes (`src`/`alt`/`href`/`title`/`colspan`/`rowspan`/
 * `class`); every other tag is unwrapped (its text survives) and every other
 * attribute is dropped. `<script>`/`<style>` and the other content-bearing
 * embedder elements are removed WITH their content, and `javascript:` /
 * `vbscript:` URLs are never emitted. The print path does NOT use this
 * function: the offscreen engine is sandboxed with its own CSP.
 */
const READING_ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'img', 'a', 'em', 'strong', 'b', 'i', 'br', 'hr', 'blockquote',
  'figure', 'figcaption', 'sup', 'sub',
]);
const READING_ALLOWED_ATTRS = new Set([
  'src', 'alt', 'href', 'title', 'colspan', 'rowspan', 'class',
]);
const READING_VOID_TAGS = new Set(['img', 'br', 'hr']);
const READING_URL_ATTRS = new Set(['src', 'href']);

/** Decode the character references a URL scheme can hide behind and drop the
 *  whitespace/control characters a URL parser ignores, so both
 *  `java&#115;cript:` and `java\tscript:` are caught. */
function urlSchemeIsDangerous(value: string): boolean {
  const decoded = value
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex: string) =>
      codePoint(parseInt(hex, 16), whole),
    )
    .replace(/&#(\d+);/g, (whole, dec: string) => codePoint(Number(dec), whole))
    .replace(/&colon;/gi, ':')
    .replace(/&(?:tab|newline);/gi, '');
  return /^(?:javascript|vbscript):/i.test(
    decoded.replace(/[\s\u0000-\u001f]/g, ''),
  );
}

function codePoint(code: number, fallback: string): string {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback;
}
/** Paired elements whose CONTENT is dropped, not unwrapped. */
const READING_DROP_CONTENT_RE =
  /<(script|style|iframe|object|embed|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
/** Any leftover dangerous tag (unclosed start, stray end, or a void element). */
const READING_DROP_VOID_RE =
  /<\/?(?:link|base|meta|script|style|iframe|object|embed|head|title)\b[^>]*\/?>/gi;
const READING_ATTR_RE =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'<>`=]+)))?/g;

function localTagName(name: string): string {
  return name.slice(name.lastIndexOf(':') + 1).toLowerCase();
}

function readingAttributes(rest: string): string {
  let out = '';
  READING_ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = READING_ATTR_RE.exec(rest)) !== null) {
    const local = localTagName(match[1]);
    if (!READING_ALLOWED_ATTRS.has(local)) continue;
    const value = match[3] ?? match[4] ?? match[5];
    if (value === undefined) continue;
    if (READING_URL_ATTRS.has(local) && urlSchemeIsDangerous(value)) continue;
    out += ` ${local}="${value.replace(/"/g, '&quot;')}"`;
  }
  return out;
}

function readingTag(raw: string): string {
  const closing = raw.startsWith('/');
  const body = closing ? raw.slice(1) : raw;
  const selfClosing = /\/\s*$/.test(body);
  const content = (selfClosing ? body.replace(/\/\s*$/, '') : body).trimStart();
  const name = /^[a-zA-Z][a-zA-Z0-9:._-]*/.exec(content)?.[0];
  if (name === undefined) return closing ? '' : '<';
  const local = localTagName(name);
  if (!READING_ALLOWED_TAGS.has(local)) return '';
  if (closing) return `</${local}>`;
  const attrs = readingAttributes(content.slice(name.length));
  return READING_VOID_TAGS.has(local)
    ? `<${local}${attrs}/>`
    : `<${local}${attrs}>`;
}

/** Walk `<...>` spans, respecting quoted attribute values, and rebuild each
 *  whitelisted tag; everything between tags is preserved verbatim. */
function scrubReadingTags(input: string): string {
  let out = '';
  let index = 0;
  while (index < input.length) {
    const open = input.indexOf('<', index);
    if (open < 0) {
      out += input.slice(index);
      break;
    }
    out += input.slice(index, open);
    let cursor = open + 1;
    let quote: string | null = null;
    while (cursor < input.length) {
      const ch = input[cursor];
      if (quote !== null) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      cursor += 1;
    }
    if (cursor >= input.length) {
      out += input.slice(open);
      break;
    }
    const raw = input.slice(open + 1, cursor);
    out += /^[!?]/.test(raw.trimStart()) ? '' : readingTag(raw);
    index = cursor + 1;
  }
  return out;
}

/**
 * Sanitize one chapter fragment for the Reading view: drop comments, remove
 * dangerous elements with their content, then apply the tag/attribute
 * whitelist. Pure, synchronous and never throws.
 */
export function sanitizeEpubFragment(xhtml: string): string {
  const withoutComments = xhtml.replace(/<!--[\s\S]*?-->/g, '');
  const withoutPaired = withoutComments.replace(READING_DROP_CONTENT_RE, '');
  const withoutTags = withoutPaired.replace(READING_DROP_VOID_RE, '');
  return scrubReadingTags(withoutTags);
}
