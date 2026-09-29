import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  rgb,
} from '@cantoo/pdf-lib';

/**
 * Phase 54 features D + E — in-test PDF fixtures. Every fixture is built with
 * pdf-lib at runtime; no committed binaries and no real-world documents. A
 * "conforming" fixture is conforming WITH RESPECT TO THE DOCUMENTED RULE SET
 * (an OutputIntent with an embedded ICC stream, an embedded font, an XMP packet
 * declaring `pdfaid`) and nothing more.
 */

export const PDFA1B_XMP = [
  '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
  ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
  '  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">',
  '   <pdfaid:part>1</pdfaid:part>',
  '   <pdfaid:conformance>B</pdfaid:conformance>',
  '  </rdf:Description>',
  ' </rdf:RDF>',
  '</x:xmpmeta>',
  '<?xpacket end="w"?>',
].join('\n');

export const PDFX1A_XMP = [
  '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
  ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
  '  <rdf:Description rdf:about="" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/" pdfxid:GTS_PDFXVersion="PDF/X-1:2001"/>',
  ' </rdf:RDF>',
  '</x:xmpmeta>',
  '<?xpacket end="w"?>',
].join('\n');

export interface FixtureOptions {
  /** XMP packet to store in catalog `/Metadata` (null = none). */
  xmp?: string | null;
  /** Add an OutputIntent with an embedded ICC destination profile. */
  outputIntent?: boolean;
  /** Add an OutputIntent WITHOUT an embedded ICC profile. */
  outputIntentNoProfile?: boolean;
  /** Add a font dictionary (embedded unless `fontEmbedded` is false). */
  addFont?: boolean;
  fontEmbedded?: boolean;
  /** Page `/Group << /S /Transparency >>`. */
  transparency?: boolean;
  /** Catalog `/Names /JavaScript`. */
  javascript?: boolean;
  /** Catalog `/Names /EmbeddedFiles`. */
  embeddedFile?: boolean;
  /** Catalog `/OpenAction << /S /URI ... >>`. */
  externalAction?: boolean;
  /** Paint a device-RGB rectangle so the content stream carries `rg`. */
  deviceRgb?: boolean;
  /** Encrypt the document (`/Encrypt` in the trailer). */
  encrypt?: boolean;
}

function ensureResources(doc: PDFDocument, page: ReturnType<PDFDocument['getPage']>): PDFDict {
  const existing = page.node.Resources();
  if (existing !== undefined) return existing;
  const dict = doc.context.obj({}) as PDFDict;
  page.node.set(PDFName.of('Resources'), dict);
  return dict;
}

function addMetadata(doc: PDFDocument, packet: string): void {
  const stream = doc.context.stream(Buffer.from(packet, 'utf8'), {
    Type: 'Metadata',
    Subtype: 'XML',
  });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
}

function addOutputIntent(doc: PDFDocument, withProfile: boolean): void {
  const dict = doc.context.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1' }) as PDFDict;
  if (withProfile) {
    const icc = doc.context.stream(new Uint8Array([0, 0, 0, 2, 0x49, 0x43, 0x43]), { N: 3 });
    dict.set(PDFName.of('DestOutputProfile'), doc.context.register(icc));
  }
  const array = doc.context.obj([dict]) as PDFArray;
  doc.catalog.set(PDFName.of('OutputIntents'), array);
}

function addFont(doc: PDFDocument, page: ReturnType<PDFDocument['getPage']>, embedded: boolean): void {
  const font = doc.context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'TFlexFixture' }) as PDFDict;
  if (embedded) {
    const file = doc.context.stream(new Uint8Array([1, 2, 3, 4, 5]), { Length1: 5 });
    const descriptor = doc.context.obj({
      Type: 'FontDescriptor',
      FontName: 'TFlexFixture',
      Flags: 4,
      FontFile2: doc.context.register(file),
    }) as PDFDict;
    font.set(PDFName.of('FontDescriptor'), doc.context.register(descriptor));
  }
  const resources = ensureResources(doc, page);
  resources.set(PDFName.of('Font'), doc.context.obj({ F1: doc.context.register(font) }) as PDFDict);
}

/** Build one fixture PDF. Defaults to a bare one-page document. */
export async function buildFixture(options: FixtureOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([200, 200]);

  if (options.xmp !== undefined && options.xmp !== null) addMetadata(doc, options.xmp);
  if (options.outputIntent === true) addOutputIntent(doc, true);
  if (options.outputIntentNoProfile === true) addOutputIntent(doc, false);
  if (options.addFont === true) addFont(doc, page, options.fontEmbedded !== false);
  if (options.transparency === true) {
    page.node.set(PDFName.of('Group'), doc.context.obj({ S: 'Transparency' }));
  }
  if (options.javascript === true) {
    doc.catalog.set(PDFName.of('Names'), doc.context.obj({ JavaScript: doc.context.obj({}) }));
  }
  if (options.embeddedFile === true) {
    doc.catalog.set(PDFName.of('Names'), doc.context.obj({ EmbeddedFiles: doc.context.obj({}) }));
  }
  if (options.externalAction === true) {
    doc.catalog.set(
      PDFName.of('OpenAction'),
      doc.context.obj({ S: 'URI', URI: 'https://example.invalid/' }),
    );
  }
  if (options.deviceRgb === true) {
    page.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(1, 0, 0) });
  }
  if (options.encrypt === true) {
    doc.encrypt({ userPassword: 'fixture-secret' });
  }
  return doc.save();
}

/** A fixture that conforms to the documented PDF/A rule set for part 1. */
export function conformingPdfA(): Promise<Uint8Array> {
  return buildFixture({
    xmp: PDFA1B_XMP,
    outputIntent: true,
    addFont: true,
    fontEmbedded: true,
  });
}
