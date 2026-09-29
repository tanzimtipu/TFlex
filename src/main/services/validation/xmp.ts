/**
 * Phase 54 features D + E — XMP identification parsing (pure).
 *
 * Extracts the `pdfaid` (part/conformance) and PDF/X (`GTS_PDFXVersion`)
 * identifications from an XMP packet string. This module is deliberately
 * forgiving: XMP attribute order, namespace prefix and element-vs-attribute
 * form all vary in real files, so the local names `part`, `conformance` and
 * `GTS_PDFXVersion` are resolved against the namespace URI rather than a fixed
 * prefix (with a literal-prefix fallback when no namespace binding is found).
 *
 * It never treats the presence of an identification as a conformance claim —
 * it only reports what the file DECLARES.
 */

/** The pdfaid namespace URI used by PDF/A. */
const PDFA_NS = 'http://www.aiim.org/pdfa/ns/id/';
/** The PDF/X identification namespace URI. */
const PDFX_NS = 'http://www.npes.org/pdfx/ns/id/';

export interface PdfaIdentification {
  part: number;
  conformance: string;
}

export interface PdfxIdentification {
  version: string;
}

export interface XmpIdentification {
  pdfa: PdfaIdentification | null;
  pdfx: PdfxIdentification | null;
}

/** The XMP `xpacket`/`x:xmpmeta` envelope markers. An exact packet is not
 *  required; these delimit the region worth scanning. */
const XMP_START = /<x:xmpmeta|<\?xpacket/i;

/**
 * Extract the XMP packet from raw `/Metadata` stream bytes. Returns null when
 * no recognisable packet is present. The bytes are decoded as UTF-8 (XMP is
 * UTF-8 by specification); a binary preamble before the packet is ignored.
 */
export function extractXmpPacket(bytes: Uint8Array | null | undefined): string | null {
  if (bytes === null || bytes === undefined || bytes.length === 0) return null;
  const text = Buffer.from(bytes).toString('utf8');
  const start = text.search(XMP_START);
  if (start === -1) return null;
  const endMarker = text.lastIndexOf('<?xpacket end');
  if (endMarker > start) {
    const gt = text.indexOf('?>', endMarker);
    return gt === -1 ? text.slice(start) : text.slice(start, gt + 2);
  }
  const xmpmetaEnd = text.lastIndexOf('</x:xmpmeta>');
  if (xmpmetaEnd > start) return text.slice(start, xmpmetaEnd + '</x:xmpmeta>'.length);
  return text.slice(start);
}

/** Resolve the prefix bound to a namespace URI, or null. */
function prefixForNamespace(xmp: string, uri: string): string | null {
  const escaped = uri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `xmlns:([A-Za-z_][\\w.-]*)\\s*=\\s*["']${escaped}["']`,
    'i',
  );
  const match = re.exec(xmp);
  return match === null ? null : match[1];
}

/** Read an attribute or element value by qualified name (case-insensitive
 *  prefixes, either quote style, either XML form). */
function readQualified(xmp: string, qualified: string): string | null {
  const q = qualified.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attr = new RegExp(
    `(?:^|[\\s"'<])${q}\\s*=\\s*["']([^"']*)["']`,
    'i',
  );
  const attrMatch = attr.exec(xmp);
  if (attrMatch !== null) return attrMatch[1].trim();
  const elem = new RegExp(`<${q}[^>]*>\\s*([^<]*)\\s*</${q}>`, 'i');
  const elemMatch = elem.exec(xmp);
  return elemMatch === null ? null : elemMatch[1].trim();
}

/** Read a local name under the namespace bound to `uri`, with a literal-prefix
 *  fallback so a packet with an unbound/absent namespace declaration is still
 *  read from the conventional prefix. */
function readNamespaced(
  xmp: string,
  uri: string,
  local: string,
  fallbackPrefix: string,
): string | null {
  const prefix = prefixForNamespace(xmp, uri);
  if (prefix !== null) {
    const value = readQualified(xmp, `${prefix}:${local}`);
    if (value !== null && value.length > 0) return value;
  }
  const literal = readQualified(xmp, `${fallbackPrefix}:${local}`);
  return literal !== null && literal.length > 0 ? literal : null;
}

/** Parse the PDF/A `pdfaid` identification, or null when absent/incomplete. */
export function parsePdfaId(xmp: string | null): PdfaIdentification | null {
  if (xmp === null || xmp.length === 0) return null;
  const partRaw = readNamespaced(xmp, PDFA_NS, 'part', 'pdfaid');
  const confRaw = readNamespaced(xmp, PDFA_NS, 'conformance', 'pdfaid');
  if (partRaw === null || confRaw === null) return null;
  const part = Number.parseInt(partRaw, 10);
  if (!Number.isFinite(part)) return null;
  return { part, conformance: confRaw.toUpperCase() };
}

/** Parse the PDF/X `GTS_PDFXVersion` identification, or null when absent. */
export function parsePdfxId(xmp: string | null): PdfxIdentification | null {
  if (xmp === null || xmp.length === 0) return null;
  const version =
    readNamespaced(xmp, PDFX_NS, 'GTS_PDFXVersion', 'pdfxid') ??
    readNamespaced(xmp, PDFX_NS, 'GTS_PDFXVersion', 'pdfx');
  return version === null ? null : { version };
}

/** Parse both identifications from one packet. */
export function extractXmpInfo(xmp: string | null): XmpIdentification {
  return { pdfa: parsePdfaId(xmp), pdfx: parsePdfxId(xmp) };
}

/**
 * Phase 54 (DEF-386) — the KNOWN PDF/A part/conformance pairs. A file that
 * declares `pdfaid part 9 / conformance Z` must not be echoed as a real level
 * and paired with `conforms: true`; an unrecognised declaration is reported
 * and cannot be checked against.
 */
const KNOWN_PDFA_CONFORMANCE: Readonly<Record<number, readonly string[]>> = {
  1: ['A', 'B'],
  2: ['A', 'B', 'U'],
  3: ['A', 'B', 'U'],
  4: ['', 'E', 'F'],
};

/** The KNOWN PDF/X identification strings (the profiles this rule set names). */
const KNOWN_PDFX_VERSIONS = new Set([
  'PDF/X-1:2001',
  'PDF/X-1a:2001',
  'PDF/X-1a:2003',
  'PDF/X-3:2002',
  'PDF/X-3:2003',
  'PDF/X-4',
  'PDF/X-4p',
  'PDF/X-5g',
  'PDF/X-5n',
  'PDF/X-5pg',
  'PDF/X-5pn',
  'PDF/X-6',
  'PDF/X-6n',
  'PDF/X-6p',
]);

/** True when a `pdfaid` declaration names a real PDF/A part/conformance pair. */
export function isRecognisedPdfaId(id: PdfaIdentification): boolean {
  const known = KNOWN_PDFA_CONFORMANCE[id.part];
  return known !== undefined && known.includes(id.conformance);
}

/** True when a `GTS_PDFXVersion` declaration names a known PDF/X profile. */
export function isRecognisedPdfxId(id: PdfxIdentification): boolean {
  return KNOWN_PDFX_VERSIONS.has(id.version);
}

/** Human label for a pdfaid declaration, e.g. 'PDF/A-1b'. */
export function pdfaLabel(id: PdfaIdentification): string {
  return `PDF/A-${id.part}${id.conformance.toLowerCase()}`;
}

/** Human label for a PDF/X declaration, e.g. 'PDF/X-1:2001'. */
export function pdfxLabel(id: PdfxIdentification): string {
  return id.version;
}
