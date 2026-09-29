import { describe, expect, it, vi } from 'vitest';
import {
  cmyk,
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObjectCopier,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  rgb,
  type PDFObject,
} from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';
import { DocumentValidationService } from '../../../src/main/services/validation';
import {
  conformingPdfA,
  PDFA1B_XMP,
  PDFX1A_XMP,
} from './validationFixtures';

/**
 * DEF-378 — serializeDoc must carry the source catalog's /Metadata (XMP) and
 * /OutputIntents (ICC) onto the re-serialized output. Fixtures are built
 * in-test with pdf-lib (mirroring test/unit/main/phase52Encryption.test.ts);
 * no committed binaries and no real-world documents.
 */

const ICC_BYTES = new Uint8Array([0, 0, 0, 2, 0x49, 0x43, 0x43]); // header + 'ICC'

/** Load bytes, serialize through the engine save path, return the output. */
async function serializeViaEngine(bytes: Uint8Array, docId = 'doc-1'): Promise<Uint8Array> {
  const engine = new EngineService();
  const loaded = await engine.loadDocumentBytes(docId, bytes);
  expect(loaded.ok).toBe(true);
  const out = await engine.getDocumentBytes(docId);
  expect(out.ok).toBe(true);
  if (!out.ok) throw new Error(`getDocumentBytes failed: ${out.error.message}`);
  return new Uint8Array(out.value);
}

function streamDecodedBytes(stream: PDFStream): Uint8Array {
  const raw = PDFRawStream.of(
    stream.dict,
    stream.getContents(),
    stream instanceof PDFRawStream ? stream.transform : undefined,
  );
  return decodePDFRawStream(raw).decode();
}

async function loadOut(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

async function readMetadataBytes(bytes: Uint8Array): Promise<Uint8Array | null> {
  const doc = await loadOut(bytes);
  const stream = doc.context.lookupMaybe(doc.catalog.get(PDFName.of('Metadata')), PDFStream);
  return stream === undefined ? null : streamDecodedBytes(stream);
}

async function readFirstIccBytes(bytes: Uint8Array): Promise<Uint8Array | null> {
  const doc = await loadOut(bytes);
  const arr = doc.context.lookupMaybe(doc.catalog.get(PDFName.of('OutputIntents')), PDFArray);
  if (arr === undefined) return null;
  const dict = doc.context.lookupMaybe(arr.get(0), PDFDict);
  if (dict === undefined) return null;
  const stream = doc.context.lookupMaybe(dict.get(PDFName.of('DestOutputProfile')), PDFStream);
  return stream === undefined ? null : streamDecodedBytes(stream);
}

async function buildSource(
  opts: { xmp?: boolean; outputIntent?: boolean; xmpPacket?: string } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 200]);
  if (opts.xmp === true) {
    const stream = doc.context.stream(Buffer.from(opts.xmpPacket ?? PDFA1B_XMP, 'utf8'), {
      Type: 'Metadata',
      Subtype: 'XML',
    });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
  }
  if (opts.outputIntent === true) {
    const dict = doc.context.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1' }) as PDFDict;
    dict.set(
      PDFName.of('DestOutputProfile'),
      doc.context.register(doc.context.stream(ICC_BYTES, { N: 3 })),
    );
    doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([dict]) as PDFArray);
  }
  return doc.save();
}

describe('DEF-378 — serializeDoc carries /Metadata and /OutputIntents', () => {
  it('round-trips the XMP packet and the ICC output intent bytes exactly', async () => {
    const src = await buildSource({ xmp: true, outputIntent: true });
    const out = await serializeViaEngine(src);

    const meta = await readMetadataBytes(out);
    expect(meta).not.toBeNull();
    expect(Buffer.from(meta as Uint8Array)).toEqual(Buffer.from(PDFA1B_XMP, 'utf8'));

    const icc = await readFirstIccBytes(out);
    expect(icc).not.toBeNull();
    expect(Buffer.from(icc as Uint8Array)).toEqual(Buffer.from(ICC_BYTES));
  });

  it('does not inject either entry when the source lacks them, and is stable across two calls', async () => {
    const src = await buildSource({});
    // Freeze Date so pdf-lib's /ModDate second boundary (DEF-350) cannot make
    // two serializations of the same input differ.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const first = await serializeViaEngine(src, 'doc-a');
      const second = await serializeViaEngine(src, 'doc-b');

      const doc = await loadOut(first);
      expect(doc.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
      expect(doc.catalog.get(PDFName.of('OutputIntents'))).toBeUndefined();
      // DEF-381 — the extended carry list must not inject either.
      for (const entry of [
        'MarkInfo',
        'Lang',
        'ViewerPreferences',
        'OCProperties',
        'Collection',
        'AF',
        'Names',
      ]) {
        expect(doc.catalog.get(PDFName.of(entry))).toBeUndefined();
      }

      expect(Buffer.from(first)).toEqual(Buffer.from(second));
    } finally {
      vi.useRealTimers();
    }
  });

  it('failure-isolated: a throwing clone is skipped and the save equals the page-only result', async () => {
    const withMeta = await buildSource({ xmp: true });
    const control = await buildSource({});

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    // Wrap the real copier so ONLY the helper's top-level clone of the
    // /Metadata indirect object throws; page copying (a PDFPageLeaf/Dict, not
    // a PDFRef) still runs through the real copier unchanged.
    const realFor = PDFObjectCopier.for.bind(PDFObjectCopier);
    const spy = vi.spyOn(PDFObjectCopier, 'for').mockImplementation((src, dest) => {
      const real = realFor(src, dest);
      return {
        copy: (obj: PDFObject): PDFObject => {
          if (obj instanceof PDFRef) throw new Error('forced clone failure');
          return real.copy(obj);
        },
      } as unknown as PDFObjectCopier;
    });
    try {
      const isolated = await serializeViaEngine(withMeta, 'doc-isolated');
      spy.mockRestore();
      const baseline = await serializeViaEngine(control, 'doc-control');

      // The save succeeded and is byte-identical to the page-only result.
      expect(Buffer.from(isolated)).toEqual(Buffer.from(baseline));
      const doc = await loadOut(isolated);
      expect(doc.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
      expect(doc.catalog.get(PDFName.of('OutputIntents'))).toBeUndefined();
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('memoises a shared ICC object referenced twice (copied once, both refs resolve)', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([200, 200]);
    const iccRef = doc.context.register(doc.context.stream(new Uint8Array([9, 9, 9]), { N: 3 }));
    const dictA = doc.context.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1' }) as PDFDict;
    dictA.set(PDFName.of('DestOutputProfile'), iccRef);
    const dictB = doc.context.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1' }) as PDFDict;
    dictB.set(PDFName.of('DestOutputProfile'), iccRef);
    doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([dictA, dictB]) as PDFArray);
    const src = await doc.save();

    const out = await serializeViaEngine(src);
    const parsed = await loadOut(out);
    const arr = parsed.context.lookupMaybe(
      parsed.catalog.get(PDFName.of('OutputIntents')),
      PDFArray,
    );
    expect(arr).toBeDefined();
    const outA = parsed.context.lookupMaybe(arr!.get(0), PDFDict)!;
    const outB = parsed.context.lookupMaybe(arr!.get(1), PDFDict)!;
    const refA = outA.get(PDFName.of('DestOutputProfile'));
    const refB = outB.get(PDFName.of('DestOutputProfile'));
    expect(refA).toBeInstanceOf(PDFRef);
    expect(refB).toBeInstanceOf(PDFRef);
    expect((refA as PDFRef).tag).toBe((refB as PDFRef).tag);

    const stream = parsed.context.lookupMaybe(refA, PDFStream)!;
    expect(Buffer.from(streamDecodedBytes(stream))).toEqual(Buffer.from([9, 9, 9]));
  });

  it('Phase 54 acceptance: a serialized PDF/A-1b fixture still declares its level and conforms', async () => {
    const src = await conformingPdfA();
    const out = await serializeViaEngine(src);

    const report = await new DocumentValidationService().validateBytes(out, 'pdfa-1b');
    expect(report.ok).toBe(true);
    if (!report.ok) throw new Error(report.error.message);
    expect(report.value.declared).toBe('PDF/A-1b');
    expect(report.value.conforms).toBe(true);
    expect(report.value.violations).toEqual([]);
  });

  it('Phase 54 acceptance: a serialized PDF/X-1a CMYK fixture still declares its version and conforms', async () => {
    const src = await buildPdfX1aCmyk();
    const out = await serializeViaEngine(src);

    const report = await new DocumentValidationService().validateBytes(out, 'pdfx-1a');
    expect(report.ok).toBe(true);
    if (!report.ok) throw new Error(report.error.message);
    expect(report.value.declared).toBe('PDF/X-1:2001');
    expect(report.value.conforms).toBe(true);
    expect(report.value.violations).toEqual([]);
  });

  it('branding observation: source XMP is carried verbatim while the Info Producer is Jovrel', async () => {
    const brandXmp = [
      '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
      '  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">',
      '   <xmp:CreatorTool>Ghostwriter 3.1</xmp:CreatorTool>',
      '   <pdf:Producer>Ghostwriter Producer 3.1</pdf:Producer>',
      '  </rdf:Description>',
      ' </rdf:RDF>',
      '</x:xmpmeta>',
      '<?xpacket end="w"?>',
    ].join('\n');

    const src = await buildSource({ xmp: true, xmpPacket: brandXmp });
    const out = await serializeViaEngine(src);

    const meta = await readMetadataBytes(out);
    expect(meta).not.toBeNull();
    const packet = Buffer.from(meta as Uint8Array).toString('utf8');
    // The XMP packet is carried verbatim: it still names the other tool.
    expect(packet).toContain('<pdf:Producer>Ghostwriter Producer 3.1</pdf:Producer>');
    expect(packet).toContain('<xmp:CreatorTool>Ghostwriter 3.1</xmp:CreatorTool>');

    // ...while the Info dictionary branding (Phase 49) says Jovrel.
    const parsed = await loadOut(out);
    expect(parsed.getProducer()).toBe('Jovrel');
  });

  it('encryption care: a decrypted /Metadata stream is cloned with its original bytes', async () => {
    // A neutral XMP packet (no pdfaid) so pdf-lib permits encryption; pdf-lib
    // refuses to encrypt a document it identifies as PDF/A.
    const neutralXmp = [
      '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
      '  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">',
      '   <xmp:CreatorTool>EncryptedFixture</xmp:CreatorTool>',
      '  </rdf:Description>',
      ' </rdf:RDF>',
      '</x:xmpmeta>',
      '<?xpacket end="w"?>',
    ].join('\n');
    const plain = await buildSource({ xmp: true, xmpPacket: neutralXmp });
    const doc = await PDFDocument.load(plain, { updateMetadata: false });
    doc.encrypt({ userPassword: 'def378', algorithm: 'AES-256' });
    const encrypted = await doc.save();

    const engine = new EngineService();
    const loaded = await engine.loadDocumentBytes('doc-enc', encrypted, 'def378');
    expect(loaded.ok).toBe(true);
    const out = await engine.getDocumentBytes('doc-enc');
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error(out.error.message);

    const bytes = new Uint8Array(out.value);
    const meta = await readMetadataBytes(bytes);
    expect(meta).not.toBeNull();
    expect(Buffer.from(meta as Uint8Array)).toEqual(Buffer.from(neutralXmp, 'utf8'));
  });
});

describe('DEF-381 — serializeDoc carries layers, JS and page-safe catalog entries', () => {
  it('round-trips /OCProperties with the OCG names intact (Phase 57 layers)', async () => {
    const src = await buildOcPropertiesSource();
    const out = await serializeViaEngine(src);

    const doc = await loadOut(out);
    const oc = doc.context.lookupMaybe(doc.catalog.get(PDFName.of('OCProperties')), PDFDict);
    expect(oc).toBeDefined();
    const ocgs = doc.context.lookupMaybe(oc!.get(PDFName.of('OCGs')), PDFArray);
    expect(ocgs).toBeDefined();
    const names: string[] = [];
    for (let i = 0; i < ocgs!.size(); i++) {
      const ocg = doc.context.lookupMaybe(ocgs!.get(i), PDFDict);
      const name = ocg?.get(PDFName.of('Name'));
      if (name !== undefined) names.push(name.toString().replace(/^\//, ''));
    }
    expect(names).toEqual(['LayerOne', 'LayerTwo']);

    // The default configuration order must survive too, so a viewer can lay
    // the panel out with the same grouping/order it had before the save.
    const d = doc.context.lookupMaybe(oc!.get(PDFName.of('D')), PDFDict);
    const order = doc.context.lookupMaybe(d!.get(PDFName.of('Order')), PDFArray);
    expect(order?.size()).toBe(2);
  });

  it('round-trips /MarkInfo and /Lang structure intact', async () => {
    const src = await buildOcPropertiesSource();
    const out = await serializeViaEngine(src);
    const doc = await loadOut(out);

    const markInfo = doc.context.lookupMaybe(doc.catalog.get(PDFName.of('MarkInfo')), PDFDict);
    expect(markInfo).toBeDefined();
    expect(markInfo!.get(PDFName.of('Marked'))).toBeDefined();
    expect(doc.catalog.get(PDFName.of('Lang'))).toBeDefined();
  });

  it('both sides: a /Names /JavaScript source reports pdfa.javascript on the SERIALIZED bytes', async () => {
    const src = await buildJavaScriptSource();
    const out = await serializeViaEngine(src);

    // The distinctive JS string survives the serialization (navigated
    // structurally — the saved bytes use object streams, so a raw byte scan
    // would not see it)...
    expect(await readJavaScriptText(out)).toBe(`app.alert('${JS_PROBE}')`);
    // ...so the existing PDF/A rule fires on the serialized bytes.
    const report = await new DocumentValidationService().validateBytes(out, 'pdfa-1b');
    expect(report.ok).toBe(true);
    if (!report.ok) throw new Error(report.error.message);
    expect(report.value.violations.some((v) => v.rule === 'pdfa.javascript')).toBe(true);
  });

  it('both sides: a document with no JavaScript reports no pdfa.javascript violation', async () => {
    const src = await buildSource({});
    const out = await serializeViaEngine(src);
    const report = await new DocumentValidationService().validateBytes(out, 'pdfa-1b');
    expect(report.ok).toBe(true);
    if (!report.ok) throw new Error(report.error.message);
    expect(report.value.violations.some((v) => v.rule === 'pdfa.javascript')).toBe(false);
  });

  it('page-tree safety: /Names /Dests referencing a page is REMAPPED, not cloned; page count/content unchanged', async () => {
    const src = await buildNamesWithDestsAndJsSource();
    const srcDoc = await loadOut(src);
    const srcContent = pageContentBytes(srcDoc, 0);

    const out = await serializeViaEngine(src);
    const outDoc = await loadOut(out);

    // The page tree is untouched: same page count, same page content bytes.
    expect(outDoc.getPageCount()).toBe(1);
    expect(pageContentBytes(outDoc, 0).length).toBeGreaterThan(0);
    expect(Buffer.from(pageContentBytes(outDoc, 0))).toEqual(Buffer.from(srcContent));

    // Phase 57-G: /Names /Dests IS now carried, with its page ref remapped to
    // the output page object (proving no source page object was cloned in).
    const outNames = outDoc.context.lookupMaybe(outDoc.catalog.get(PDFName.of('Names')), PDFDict);
    expect(outNames).toBeDefined();
    expect(outNames!.has(PDFName.of('JavaScript'))).toBe(true);
    expect(outNames!.has(PDFName.of('Dests'))).toBe(true);

    const tree = outDoc.context.lookupMaybe(outNames!.get(PDFName.of('Dests')), PDFDict);
    expect(tree).toBeDefined();
    const pairs = outDoc.context.lookupMaybe(tree!.get(PDFName.of('Names')), PDFArray);
    expect(pairs).toBeDefined();
    const dest = outDoc.context.lookupMaybe(pairs!.get(1), PDFArray);
    expect(dest).toBeDefined();
    expect((dest!.get(0) as PDFRef).tag).toBe(outDoc.getPage(0).ref.tag);
  });
});

describe('Phase 57-G — serializeDoc carries /Dests and /OpenAction with remapped page refs', () => {
  it('remaps a catalog /Dests entry and an /OpenAction GoTo to the OUTPUT page', async () => {
    const src = await buildDestsAndOpenActionSource();
    const out = await serializeViaEngine(src);
    const doc = await loadOut(out);

    expect(doc.getPageCount()).toBe(3);

    const dests = doc.context.lookupMaybe(doc.catalog.get(PDFName.of('Dests')), PDFDict);
    expect(dests).toBeDefined();
    // The named destination for source page 2 must point at the OUTPUT page
    // whose index is page 2's mapped index (1) — proving the remap.
    const dest = doc.context.lookupMaybe(dests!.get(PDFName.of('chapter2')), PDFArray);
    expect(dest).toBeDefined();
    expect((dest!.get(0) as PDFRef).tag).toBe(doc.getPage(1).ref.tag);
    // The tail (/XYZ 0 100 0) survived verbatim.
    expect(dest!.get(1).toString()).toBe('/XYZ');
    expect(dest!.size()).toBe(5);

    const action = doc.context.lookupMaybe(doc.catalog.get(PDFName.of('OpenAction')), PDFDict);
    expect(action).toBeDefined();
    expect(action!.get(PDFName.of('S'))?.toString()).toBe('/GoTo');
    const actionDest = doc.context.lookupMaybe(action!.get(PDFName.of('D')), PDFArray);
    expect(actionDest).toBeDefined();
    expect((actionDest!.get(0) as PDFRef).tag).toBe(doc.getPage(1).ref.tag);
    expect(actionDest!.get(1).toString()).toBe('/Fit');
  });

  it('a document with no destinations/OpenAction writes neither entry and is byte-stable', async () => {
    const src = await buildPlain3Page();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const first = await serializeViaEngine(src, 'g-a');
      const second = await serializeViaEngine(src, 'g-b');

      const doc = await loadOut(first);
      expect(doc.catalog.get(PDFName.of('Dests'))).toBeUndefined();
      expect(doc.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
      expect(Buffer.from(first)).toEqual(Buffer.from(second));
    } finally {
      vi.useRealTimers();
    }
  });

  it('an unresolvable page ref does not fail the save and yields no garbage destination', async () => {
    const src = await buildUnresolvableDestSource();
    const out = await serializeViaEngine(src);
    const doc = await loadOut(out);

    // The lone /Dests entry was dropped, not kept partially.
    const dests = doc.context.lookupMaybe(doc.catalog.get(PDFName.of('Dests')), PDFDict);
    expect(dests).toBeUndefined();
    // The unsupported-shape /OpenAction (a bare destination array) was not
    // carried either.
    expect(doc.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
    expect(doc.getPageCount()).toBe(1);
  });

  it('does NOT carry /StructTreeRoot (FEA-023 deferral)', async () => {
    const src = await buildStructTreeSource();
    const out = await serializeViaEngine(src);
    const doc = await loadOut(out);

    expect(doc.catalog.get(PDFName.of('StructTreeRoot'))).toBeUndefined();
    // A page-safe sibling entry is still carried, so the deferral is specific.
    expect(doc.catalog.get(PDFName.of('MarkInfo'))).toBeDefined();
  });
});

async function buildPlain3Page(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 200]);
  doc.addPage([200, 200]);
  doc.addPage([200, 200]);
  return doc.save();
}

async function buildDestsAndOpenActionSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 200]);
  const page2 = doc.addPage([200, 200]);
  doc.addPage([200, 200]);

  const dest2 = doc.context.obj([page2.ref, 'XYZ', 0, 100, 0]) as PDFArray;
  doc.catalog.set(
    PDFName.of('Dests'),
    doc.context.obj({ chapter2: doc.context.register(dest2) }) as PDFDict,
  );

  const openDest = doc.context.obj([page2.ref, 'Fit']) as PDFArray;
  doc.catalog.set(
    PDFName.of('OpenAction'),
    doc.context.obj({ S: 'GoTo', D: doc.context.register(openDest) }) as PDFDict,
  );
  return doc.save();
}

async function buildUnresolvableDestSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([200, 200]);

  // A destination whose first element is a ref to no page in this document.
  const ghostDest = doc.context.obj([PDFRef.of(9999, 0), 'Fit']) as PDFArray;
  doc.catalog.set(
    PDFName.of('Dests'),
    doc.context.obj({ ghost: doc.context.register(ghostDest) }) as PDFDict,
  );
  // An /OpenAction that is a bare destination array: an unsupported shape.
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj([page.ref, 'Fit']) as PDFArray);
  return doc.save();
}

async function buildStructTreeSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 200]);
  doc.catalog.set(
    PDFName.of('StructTreeRoot'),
    doc.context.obj({ Type: 'StructTreeRoot' }) as PDFDict,
  );
  doc.catalog.set(PDFName.of('MarkInfo'), doc.context.obj({ Marked: true }) as PDFDict);
  return doc.save();
}

async function buildOcPropertiesSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 200]);
  const ocg1 = doc.context.register(
    doc.context.obj({ Type: 'OCG', Name: 'LayerOne' }) as PDFDict,
  );
  const ocg2 = doc.context.register(
    doc.context.obj({ Type: 'OCG', Name: 'LayerTwo' }) as PDFDict,
  );
  doc.catalog.set(
    PDFName.of('OCProperties'),
    doc.context.obj({
      OCGs: [ocg1, ocg2],
      D: { Order: [ocg1, ocg2] },
    }) as PDFDict,
  );
  doc.catalog.set(PDFName.of('MarkInfo'), doc.context.obj({ Marked: true }) as PDFDict);
  doc.catalog.set(PDFName.of('Lang'), PDFString.of('en-US'));
  return doc.save();
}

const JS_PROBE = 'tflex-js-probe-9f3a';

async function buildJavaScriptSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 200]);
  const jsAction = doc.context.obj({
    S: 'JavaScript',
    JS: PDFString.of(`app.alert('${JS_PROBE}')`),
  }) as PDFDict;
  const jsTree = doc.context.obj({
    Names: [PDFString.of('tflex.js.entry'), doc.context.register(jsAction)],
  }) as PDFDict;
  const names = doc.context.obj({ JavaScript: doc.context.register(jsTree) }) as PDFDict;
  doc.catalog.set(PDFName.of('Names'), doc.context.register(names));
  return doc.save();
}

async function buildNamesWithDestsAndJsSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([200, 200]);
  // A drawn marker goes into the page content stream so we can prove the page
  // contents are byte-for-byte unchanged after serialization.
  page.drawRectangle({ x: 10, y: 10, width: 40, height: 40, color: rgb(1, 0, 0) });

  // A named destination that DOES reference the page — if /Names were cloned
  // wholesale, this page ref would be copied into the destination context.
  const dest = doc.context.obj([page.ref, 'Fit']) as PDFArray;
  const destsTree = doc.context.obj({
    Names: [PDFString.of('tflex.page.dest'), doc.context.register(dest)],
  }) as PDFDict;
  const jsAction = doc.context.obj({
    S: 'JavaScript',
    JS: PDFString.of(`app.alert('${JS_PROBE}')`),
  }) as PDFDict;
  const jsTree = doc.context.obj({
    Names: [PDFString.of('tflex.js.entry'), doc.context.register(jsAction)],
  }) as PDFDict;
  const names = doc.context.obj({
    Dests: doc.context.register(destsTree),
    JavaScript: doc.context.register(jsTree),
  }) as PDFDict;
  doc.catalog.set(PDFName.of('Names'), doc.context.register(names));
  return doc.save();
}

/** Navigate catalog /Names /JavaScript -> first entry's action /JS string. */
async function readJavaScriptText(bytes: Uint8Array): Promise<string | null> {
  const doc = await loadOut(bytes);
  const names = doc.context.lookupMaybe(doc.catalog.get(PDFName.of('Names')), PDFDict);
  if (names === undefined) return null;
  const tree = doc.context.lookupMaybe(names.get(PDFName.of('JavaScript')), PDFDict);
  if (tree === undefined) return null;
  const arr = doc.context.lookupMaybe(tree.get(PDFName.of('Names')), PDFArray);
  if (arr === undefined) return null;
  const entry = doc.context.lookupMaybe(arr.get(1), PDFDict);
  if (entry === undefined) return null;
  const js = entry.get(PDFName.of('JS'));
  if (js === undefined) return null;
  const text = js as { decodeText?: () => string };
  return typeof text.decodeText === 'function' ? text.decodeText() : null;
}

function pageContentBytes(doc: PDFDocument, index: number): Uint8Array {
  try {
    const contents = doc.getPage(index).node.normalizedEntries().Contents;
    if (contents === undefined) return new Uint8Array();
    const elements: PDFObject[] =
      contents instanceof PDFArray
        ? Array.from({ length: contents.size() }, (_, i) => contents.get(i))
        : [contents];
    const chunks: Uint8Array[] = [];
    for (const element of elements) {
      const stream = doc.context.lookupMaybe(element, PDFStream);
      if (stream !== undefined) chunks.push(streamDecodedBytes(stream));
    }
    return new Uint8Array(Buffer.concat(chunks.map((c) => Buffer.from(c))));
  } catch {
    return new Uint8Array();
  }
}

async function buildPdfX1aCmyk(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([200, 200]);
  const meta = doc.context.stream(Buffer.from(PDFX1A_XMP, 'utf8'), {
    Type: 'Metadata',
    Subtype: 'XML',
  });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(meta));
  const dict = doc.context.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1' }) as PDFDict;
  dict.set(
    PDFName.of('DestOutputProfile'),
    doc.context.register(doc.context.stream(ICC_BYTES, { N: 3 })),
  );
  doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([dict]) as PDFArray);

  const font = doc.context.obj({
    Type: 'Font',
    Subtype: 'TrueType',
    BaseFont: 'TFlexFixture',
  }) as PDFDict;
  const file = doc.context.stream(new Uint8Array([1, 2, 3, 4, 5]), { Length1: 5 });
  const descriptor = doc.context.obj({
    Type: 'FontDescriptor',
    FontName: 'TFlexFixture',
    Flags: 4,
    FontFile2: doc.context.register(file),
  }) as PDFDict;
  font.set(PDFName.of('FontDescriptor'), doc.context.register(descriptor));
  const resources = page.node.Resources() ?? (doc.context.obj({}) as PDFDict);
  page.node.set(PDFName.of('Resources'), resources);
  resources.set(PDFName.of('Font'), doc.context.obj({ F1: doc.context.register(font) }) as PDFDict);
  page.drawRectangle({ x: 20, y: 20, width: 80, height: 80, color: cmyk(0, 1, 1, 0) });
  return doc.save();
}
