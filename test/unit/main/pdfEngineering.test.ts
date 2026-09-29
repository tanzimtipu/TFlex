import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString, type PDFObject } from '@cantoo/pdf-lib';
import { EngineService } from '../../../src/main/services/engine';

/**
 * Phase 57 feature A - PDF/E engineering documents.
 * Every fixture is built in-test with pdf-lib (no committed binary), the real
 * EngineService reads/writes it, and the saved bytes are re-parsed with a
 * fresh PDFDocument.load to prove the layer toggle survives serialization.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-pdfeng-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Build a 1-page PDF carrying /OCProperties with named and/or unnamed OCGs. */
async function buildLayersPdf(
  names: Array<string | undefined>,
  offIndexes: number[],
): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const ctx = doc.context;
  const refs = names.map((name) => {
    const ocg =
      name === undefined
        ? ctx.obj({ Type: 'OCG' })
        : ctx.obj({ Type: 'OCG', Name: PDFString.of(name) });
    return ctx.register(ocg);
  });
  const offEntries = offIndexes.map((i) => refs[i]);
  const d = ctx.obj({
    Type: 'OCConfig',
    Order: refs.slice(),
    OFF: offEntries,
    OCGs: refs.slice(),
  });
  const ocprops = ctx.obj({ OCGs: refs.slice(), D: d });
  doc.catalog.set(PDFName.of('OCProperties'), ctx.register(ocprops));
  const path = join(dir, 'layers.pdf');
  await writeFile(path, await doc.save());
  return path;
}

/** Build a plain 1-page PDF with no optional content. */
async function buildPlainPdf(): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const path = join(dir, 'plain.pdf');
  await writeFile(path, await doc.save());
  return path;
}

/**
 * DEF-400 repro fixture, equivalent to qa's hand-authored raw PDF: one page
 * whose /Resources /Properties maps /MC0 -> Walls and /MC1 -> Pipes, with each
 * coloured rectangle drawn inside its own `/OC /MCn BDC ... EMC` marked-content
 * block, plus a catalog /OCProperties config. The page-level OCG references are
 * what PDF.js matches against the config BY OBJECT IDENTITY.
 */
async function buildMarkedContentLayersPdf(): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const ctx = doc.context;
  const walls = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Walls') }));
  const pipes = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Pipes') }));
  const content =
    '/OC /MC0 BDC\n' +
    '1 0 0 rg\n' +
    '40 300 120 60 re f\n' +
    'EMC\n' +
    '/OC /MC1 BDC\n' +
    '0 0 1 rg\n' +
    '40 140 120 60 re f\n' +
    'EMC\n';
  page.node.set(
    PDFName.of('Contents'),
    ctx.register(ctx.stream(Buffer.from(content, 'latin1'), {})),
  );
  page.node.set(
    PDFName.of('Resources'),
    ctx.obj({
      ProcSet: ['/PDF'],
      Properties: { MC0: walls, MC1: pipes },
    }) as PDFDict,
  );
  doc.catalog.set(
    PDFName.of('OCProperties'),
    ctx.obj({
      OCGs: [walls, pipes],
      D: { Type: 'OCConfig', ON: [walls, pipes], OFF: [], Order: [walls, pipes] },
    }) as PDFDict,
  );
  const path = join(dir, 'marked-layers.pdf');
  await writeFile(path, await doc.save());
  return path;
}

/** Ref tag of a serialized value after a fresh load; 'inline' for a direct dict. */
function refTag(value: PDFObject | undefined): string {
  return value instanceof PDFRef ? value.tag : 'inline';
}

/** Read the page-0 /Resources /Properties ref tags keyed by /MC name. */
async function readPageOcgTags(
  bytes: ArrayBuffer | Uint8Array,
): Promise<Record<string, string>> {
  const doc = await PDFDocument.load(bytes);
  const resources = doc.getPage(0).node.Resources();
  expect(resources).toBeDefined();
  const props = doc.context.lookup(resources!.get(PDFName.of('Properties')), PDFDict);
  return {
    MC0: refTag(props.get(PDFName.of('MC0'))),
    MC1: refTag(props.get(PDFName.of('MC1'))),
  };
}

/** Read the config /OCGs and /D /ON, /OFF, /Order ref tags after a fresh load. */
async function readConfigOcgTags(
  bytes: ArrayBuffer | Uint8Array,
): Promise<{ ocgs: string[]; on: string[]; off: string[]; order: string[] }> {
  const doc = await PDFDocument.load(bytes);
  const oc = doc.context.lookup(doc.catalog.get(PDFName.of('OCProperties')), PDFDict);
  const ocgs = doc.context.lookup(oc.get(PDFName.of('OCGs')), PDFArray);
  const d = doc.context.lookup(oc.get(PDFName.of('D')), PDFDict);
  const read = (key: string): string[] => {
    const arr = doc.context.lookupMaybe(d.get(PDFName.of(key)), PDFArray);
    if (arr === undefined) return [];
    return Array.from({ length: arr.size() }, (_, i) => refTag(arr.get(i)));
  };
  return {
    ocgs: Array.from({ length: ocgs.size() }, (_, i) => refTag(ocgs.get(i))),
    on: read('ON'),
    off: read('OFF'),
    order: read('Order'),
  };
}

/** Re-parse saved bytes and return the /D /OFF ref tags (or 'inline'). */
async function readOffTags(bytes: ArrayBuffer | Uint8Array): Promise<string[]> {
  const reparsed = await PDFDocument.load(bytes);
  const raw = reparsed.catalog.get(PDFName.of('OCProperties'));
  expect(raw).toBeDefined();
  const props = reparsed.context.lookup(raw, PDFDict);
  const config = props.lookupMaybe(PDFName.of('D'), PDFDict) ?? props;
  const off = config.lookupMaybe(PDFName.of('OFF'), PDFArray);
  if (off === undefined) return [];
  const tags: string[] = [];
  for (let i = 0; i < off.size(); i++) {
    const el = off.get(i);
    tags.push(el instanceof PDFRef ? el.tag : 'inline');
  }
  return tags;
}

describe('phase57 feature A layers', () => {
  it('lists named layers in order with OFF-derived visibility', async () => {
    const path = await buildLayersPdf(['Walls', 'Pipes'], [1]);
    const engine = new EngineService();
    await engine.loadDocument('doc-layers', path);

    const result = await engine.getLayers('doc-layers');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { index: 0, name: 'Walls', visible: true },
      { index: 1, name: 'Pipes', visible: false },
    ]);
  });

  it('names an unnamed OCG Layer N', async () => {
    const path = await buildLayersPdf([undefined], []);
    const engine = new EngineService();
    await engine.loadDocument('doc-unnamed', path);

    const result = await engine.getLayers('doc-unnamed');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([{ index: 0, name: 'Layer 1', visible: true }]);
  });

  it('returns [] when the document declares no /OCProperties', async () => {
    const path = await buildPlainPdf();
    const engine = new EngineService();
    await engine.loadDocument('doc-nolayers', path);

    const result = await engine.getLayers('doc-nolayers');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it('serializes a document with no /OCProperties without writing an empty one', async () => {
    const path = await buildPlainPdf();
    const engine = new EngineService();
    await engine.loadDocument('doc-nooc-serialize', path);

    const bytes = await engine.getDocumentBytes('doc-nooc-serialize');
    expect(bytes.ok).toBe(true);
    if (!bytes.ok) return;
    const reparsed = await PDFDocument.load(bytes.value);
    expect(reparsed.catalog.get(PDFName.of('OCProperties'))).toBeUndefined();
  });
});

describe('DEF-400 - optional content identity survives serialization', () => {
  it('config /OCGs, /Order and /ON reference the SAME refs as the pages do', async () => {
    const path = await buildMarkedContentLayersPdf();
    const engine = new EngineService();
    const loaded = await engine.loadDocument('doc-oc-identity', path);
    expect(loaded.ok).toBe(true);

    const bytes = await engine.getDocumentBytes('doc-oc-identity');
    expect(bytes.ok).toBe(true);
    if (!bytes.ok) return;

    const page = await readPageOcgTags(bytes.value);
    const config = await readConfigOcgTags(bytes.value);
    // The page-level /MCn references are indirect objects...
    expect(page.MC0).not.toBe('inline');
    expect(page.MC1).not.toBe('inline');
    // ...and the config entries ARE those exact objects (same PDFRef tag). If a
    // second copy were minted, PDF.js could never match group to config.
    expect(config.ocgs).toEqual([page.MC0, page.MC1]);
    expect(config.on).toEqual([page.MC0, page.MC1]);
    expect(config.order).toEqual([page.MC0, page.MC1]);

    // The cloned OCGs still carry their names.
    const doc = await PDFDocument.load(bytes.value);
    const oc = doc.context.lookup(doc.catalog.get(PDFName.of('OCProperties')), PDFDict);
    const ocgs = doc.context.lookup(oc.get(PDFName.of('OCGs')), PDFArray);
    const ocg0 = doc.context.lookup(ocgs.get(0), PDFDict);
    const name0 = ocg0.get(PDFName.of('Name'));
    expect(name0 instanceof PDFString ? name0.decodeText() : name0?.toString()).toBe('Walls');
  });
});

describe('phase57 feature A layer toggle', () => {
  it('toggles visibility and the change survives serialization', async () => {
    const path = await buildLayersPdf(['Walls', 'Pipes'], [1]);
    const engine = new EngineService();
    await engine.loadDocument('doc-toggle', path);

    const hide = await engine.setLayerVisibility('doc-toggle', 0, false);
    expect(hide.ok).toBe(true);
    if (!hide.ok) return;
    expect(hide.value.modified).toBe(true);

    const afterHide = await engine.getLayers('doc-toggle');
    expect(afterHide.ok).toBe(true);
    if (afterHide.ok) {
      expect(afterHide.value).toEqual([
        { index: 0, name: 'Walls', visible: false },
        { index: 1, name: 'Pipes', visible: false },
      ]);
    }

    const bytes1 = await engine.getDocumentBytes('doc-toggle');
    expect(bytes1.ok).toBe(true);
    if (!bytes1.ok) return;
    const offAfterHide = await readOffTags(bytes1.value);
    expect(offAfterHide).toHaveLength(2);
    expect(new Set(offAfterHide).size).toBe(2);

    const show = await engine.setLayerVisibility('doc-toggle', 0, true);
    expect(show.ok).toBe(true);

    const bytes2 = await engine.getDocumentBytes('doc-toggle');
    expect(bytes2.ok).toBe(true);
    if (!bytes2.ok) return;
    const offAfterShow = await readOffTags(bytes2.value);
    expect(offAfterShow).toHaveLength(1);

    const afterShow = await engine.getLayers('doc-toggle');
    expect(afterShow.ok).toBe(true);
    if (afterShow.ok) {
      expect(afterShow.value).toEqual([
        { index: 0, name: 'Walls', visible: true },
        { index: 1, name: 'Pipes', visible: false },
      ]);
    }
  });

  it('undo fully reverts a layer toggle (pdfDoc-level snapshot)', async () => {
    // Phase 57 feature A remediation: /OCProperties is a pdfDoc-level
    // mutation, so the undo entry must capture serialized pdfDoc bytes
    // (snapshotDocWithPdf), not plain snapshotDoc.
    const path = await buildLayersPdf(['Walls', 'Pipes'], [1]);
    const engine = new EngineService();
    await engine.loadDocument('doc-undo', path);

    const before = await engine.getLayers('doc-undo');
    expect(before.ok).toBe(true);
    if (before.ok) {
      expect(before.value).toEqual([
        { index: 0, name: 'Walls', visible: true },
        { index: 1, name: 'Pipes', visible: false },
      ]);
    }

    const hide = await engine.setLayerVisibility('doc-undo', 0, false);
    expect(hide.ok).toBe(true);
    if (!hide.ok) return;

    const afterHide = await engine.getLayers('doc-undo');
    expect(afterHide.ok).toBe(true);
    if (afterHide.ok) {
      expect(afterHide.value[0]).toEqual({ index: 0, name: 'Walls', visible: false });
    }

    const undone = await engine.undo('doc-undo');
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;

    const afterUndo = await engine.getLayers('doc-undo');
    expect(afterUndo.ok).toBe(true);
    if (afterUndo.ok) {
      expect(afterUndo.value).toEqual([
        { index: 0, name: 'Walls', visible: true },
        { index: 1, name: 'Pipes', visible: false },
      ]);
    }

    const bytes = await engine.getDocumentBytes('doc-undo');
    expect(bytes.ok).toBe(true);
    if (!bytes.ok) return;
    const offAfterUndo = await readOffTags(bytes.value);
    expect(offAfterUndo).toHaveLength(1);
  });

  it('toggle on marked content maps /OFF to the page-used OCG refs (DEF-400)', async () => {
    const path = await buildMarkedContentLayersPdf();
    const engine = new EngineService();
    await engine.loadDocument('doc-oc-toggle', path);

    const hide = await engine.setLayerVisibility('doc-oc-toggle', 0, false);
    expect(hide.ok).toBe(true);
    if (!hide.ok) return;
    const hide2 = await engine.setLayerVisibility('doc-oc-toggle', 1, false);
    expect(hide2.ok).toBe(true);
    if (!hide2.ok) return;

    const bytes = await engine.getDocumentBytes('doc-oc-toggle');
    expect(bytes.ok).toBe(true);
    if (!bytes.ok) return;

    const page = await readPageOcgTags(bytes.value);
    const config = await readConfigOcgTags(bytes.value);
    expect(config.ocgs).toEqual([page.MC0, page.MC1]);
    expect(config.order).toEqual([page.MC0, page.MC1]);
    // Both layers hidden: /OFF holds the page-owned objects, not copies.
    expect([...config.off].sort()).toEqual([page.MC0, page.MC1].sort());
  });

  it('rejects an out-of-range index and mutates nothing', async () => {
    const path = await buildLayersPdf(['Walls', 'Pipes'], [1]);
    const engine = new EngineService();
    await engine.loadDocument('doc-oor', path);

    const before = await engine.getDocumentBytes('doc-oor');
    expect(before.ok).toBe(true);

    const result = await engine.setLayerVisibility('doc-oor', 5, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('out-of-range');

    const after = await engine.getDocumentBytes('doc-oor');
    expect(after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(await readOffTags(after.value)).toEqual(await readOffTags(before.value));
    }
  });
});

/** A minimal XMP packet with the three pdfe engineering blocks. */
function xmpPacket(prefix: string): string {
  return [
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    `<rdf:Description rdf:about="" xmlns:${prefix}="http://www.aiim.org/pdfe/ns/">`,
    `<${prefix}:Identification><rdf:Bag><rdf:li rdf:parseType="Resource">`,
    `<${prefix}:Part>1</${prefix}:Part>`,
    `<${prefix}:Conformance>E</${prefix}:Conformance>`,
    `</rdf:li></rdf:Bag></${prefix}:Identification>`,
    `<${prefix}:Measurement><rdf:Bag><rdf:li rdf:parseType="Resource">`,
    `<${prefix}:Type>Distance</${prefix}:Type>`,
    `<${prefix}:Value>10 mm</${prefix}:Value>`,
    `</rdf:li></rdf:Bag></${prefix}:Measurement>`,
    `<${prefix}:Geospatial><rdf:Bag><rdf:li rdf:parseType="Resource">`,
    `<${prefix}:GTS_Projection>EPSG:4326</${prefix}:GTS_Projection>`,
    `</rdf:li></rdf:Bag></${prefix}:Geospatial>`,
    '</rdf:Description></rdf:RDF></x:xmpmeta>',
  ].join('');
}

/** Embed an XMP packet as the catalog /Metadata stream (flate or plain). */
async function buildMetadataPdf(xmp: string, flate: boolean): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const stream = flate
    ? doc.context.flateStream(xmp, { Type: 'Metadata', Subtype: 'XML' })
    : doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
  const path = join(dir, flate ? 'meta-flate.pdf' : 'meta-plain.pdf');
  await writeFile(path, await doc.save());
  return path;
}

/** Build a 2-page PDF whose page 2 optionally carries a 3D annotation. */
async function build3dPdf(with3d: boolean): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const page2 = doc.addPage([612, 792]);
  if (with3d) {
    const annot = doc.context.obj({
      Type: 'Annot',
      Subtype: '3D',
      NM: PDFString.of('Turbine'),
      Rect: [0, 0, 10, 10],
    });
    const annotRef = doc.context.register(annot);
    page2.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]));
  }
  const path = join(dir, with3d ? 'three-d.pdf' : 'no-three-d.pdf');
  await writeFile(path, await doc.save());
  return path;
}

describe('phase57 feature A CAD metadata', () => {
  it.each([true, false])('reads the pdfe block (flate=%s)', async (flate) => {
    const path = await buildMetadataPdf(xmpPacket('pdfe'), flate);
    const engine = new EngineService();
    const docId = `doc-meta-${flate}`;
    await engine.loadDocument(docId, path);

    const result = await engine.getCadMetadata(docId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
    expect(result.value?.identification).toEqual([
      { key: 'Part', value: '1' },
      { key: 'Conformance', value: 'E' },
    ]);
    expect(result.value?.measurement).toEqual([
      { key: 'Type', value: 'Distance' },
      { key: 'Value', value: '10 mm' },
    ]);
    expect(result.value?.geospatial).toEqual([
      { key: 'GTS_Projection', value: 'EPSG:4326' },
    ]);
  });

  it('matches the pdfe namespace under a non-default prefix', async () => {
    const path = await buildMetadataPdf(xmpPacket('pe'), true);
    const engine = new EngineService();
    await engine.loadDocument('doc-meta-prefix', path);

    const result = await engine.getCadMetadata('doc-meta-prefix');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.identification).toEqual([
      { key: 'Part', value: '1' },
      { key: 'Conformance', value: 'E' },
    ]);
  });

  it('returns null with no /Metadata', async () => {
    const path = await buildPlainPdf();
    const engine = new EngineService();
    await engine.loadDocument('doc-nometa', path);

    const result = await engine.getCadMetadata('doc-nometa');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it('refuses a declared /Metadata stream over the 4 MiB ceiling', async () => {
    const big = 'x'.repeat(4 * 1024 * 1024 + 64);
    const path = await buildMetadataPdf(big, false);
    const engine = new EngineService();
    await engine.loadDocument('doc-bigmeta', path);

    const result = await engine.getCadMetadata('doc-bigmeta');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('engine-error');
  });
});

describe('phase57 feature A 3D content', () => {
  it('reports a 3D annotation with its visible page and name', async () => {
    const path = await build3dPdf(true);
    const engine = new EngineService();
    await engine.loadDocument('doc-3d', path);

    const result = await engine.get3dContent('doc-3d');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([{ page: 2, name: 'Turbine' }]);
  });

  it('returns [] when no 3D annotation exists', async () => {
    const path = await build3dPdf(false);
    const engine = new EngineService();
    await engine.loadDocument('doc-3d-none', path);

    const result = await engine.get3dContent('doc-3d-none');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});

