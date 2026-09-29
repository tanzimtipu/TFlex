import { describe, expect, it } from 'vitest';
import {
  extractXmpInfo,
  extractXmpPacket,
  parsePdfaId,
  parsePdfxId,
} from '../../../src/main/services/validation/xmp';
import { DocumentValidationService } from '../../../src/main/services/validation';
import { buildFixture } from './validationFixtures';

/**
 * Phase 54 feature D/E — XMP identification parsing (pure) plus the service's
 * declared-level read from a document with no `/Metadata`.
 */

const MINIMAL_ATTR =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="r">' +
  '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" ' +
  'pdfaid:conformance="B" pdfaid:part="2"/></rdf:RDF></x:xmpmeta>';

const MINIMAL_ELEMENT =
  '<x:xmpmeta><rdf:RDF><rdf:Description>' +
  '<pdfaid:part>3</pdfaid:part><pdfaid:conformance>U</pdfaid:conformance>' +
  '</rdf:Description></rdf:RDF></x:xmpmeta>';

describe('phase54 xmp: pdfaid parsing', () => {
  it('extracts part and conformance from an attribute packet', () => {
    expect(parsePdfaId(MINIMAL_ATTR)).toEqual({ part: 2, conformance: 'B' });
  });

  it('extracts part and conformance from an element packet', () => {
    expect(parsePdfaId(MINIMAL_ELEMENT)).toEqual({ part: 3, conformance: 'U' });
  });

  it('returns null when the packet has no pdfaid identification', () => {
    expect(parsePdfaId('<x:xmpmeta><rdf:RDF></rdf:RDF></x:xmpmeta>')).toBeNull();
    expect(parsePdfaId(null)).toBeNull();
    expect(parsePdfaId('')).toBeNull();
  });

  it('tolerates an unusual namespace prefix bound to the pdfaid URI', () => {
    const unusual =
      '<x:xmpmeta><rdf:RDF><rdf:Description xmlns:z="http://www.aiim.org/pdfa/ns/id/">' +
      '<z:part>1</z:part><z:conformance>a</z:conformance>' +
      '</rdf:Description></rdf:RDF></x:xmpmeta>';
    expect(parsePdfaId(unusual)).toEqual({ part: 1, conformance: 'A' });
  });
});

describe('phase54 xmp: PDF/X parsing', () => {
  it('reads GTS_PDFXVersion when present', () => {
    const packet =
      '<x:xmpmeta><rdf:RDF><rdf:Description ' +
      'xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/" ' +
      'pdfxid:GTS_PDFXVersion="PDF/X-1:2001"/></rdf:RDF></x:xmpmeta>';
    expect(parsePdfxId(packet)).toEqual({ version: 'PDF/X-1:2001' });
  });

  it('returns null when absent', () => {
    expect(parsePdfxId(MINIMAL_ATTR)).toBeNull();
    expect(extractXmpInfo(MINIMAL_ATTR).pdfx).toBeNull();
  });
});

describe('phase54 xmp: packet extraction', () => {
  it('extracts the xpacket region from raw bytes', () => {
    const packet = extractXmpPacket(
      Buffer.from(`junk before\n<?xpacket begin=""?><x:xmpmeta/>\n<?xpacket end="w"?>tail`, 'utf8'),
    );
    expect(packet).not.toBeNull();
    expect(packet).toContain('<x:xmpmeta/>');
    expect(packet).not.toContain('junk before');
  });

  it('returns null for bytes with no packet', () => {
    expect(extractXmpPacket(Buffer.from('not xmp at all', 'utf8'))).toBeNull();
    expect(extractXmpPacket(null)).toBeNull();
  });
});

describe('phase54 xmp: service declared level', () => {
  it('reports null declared for a document with no /Metadata', async () => {
    const service = new DocumentValidationService();
    const bytes = await buildFixture({ outputIntent: true, addFont: true });
    const result = await service.validateBytes(bytes, 'pdfa-1b');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.declared).toBeNull();
  });

  it('reports the declared level read from the XMP', async () => {
    const service = new DocumentValidationService();
    const bytes = await buildFixture({ xmp: MINIMAL_ATTR });
    const result = await service.validateBytes(bytes, 'pdfa-2b');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.declared).toBe('PDF/A-2b');
  });
});
