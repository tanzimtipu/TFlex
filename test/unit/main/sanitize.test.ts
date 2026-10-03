// Phase 88 (FEA-037) chunk B — main-service stripActiveContent.
//
// Builds real pdf-lib fixtures and asserts the per-class removal from the
// catalog / page / annotation object graph, that a benign /GoTo /OpenAction
// survives, that a partial selection removes only the selected class, and that
// a wrong-typed /Names is reported as a warning while the rest still sanitizes.

import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { stripActiveContent } from '../../../src/main/services/sanitize';
import { collectExternalContent, collectJavaScript } from '../../../src/main/services/validation/pdfa';
import type { SanitizeOptions } from '../../../src/shared/sanitize';

const ALL: SanitizeOptions = {
  javascript: true,
  launchActions: true,
  embeddedFiles: true,
  metadata: true,
};
const NONE: SanitizeOptions = {
  javascript: false,
  launchActions: false,
  embeddedFiles: false,
  metadata: false,
};

/** A one-page doc carrying every class: JS + EmbeddedFiles name tree, a
 *  /Launch /OpenAction, an XMP /Metadata packet and a /FileAttachment annot. */
async function richFixture(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.catalog.set(
    PDFName.of('Names'),
    doc.context.obj({ JavaScript: { Names: [] }, EmbeddedFiles: { Names: [] } }),
  );
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'Launch', FS: {} }));
  doc.catalog.set(PDFName.of('Metadata'), doc.context.obj({ Type: 'Metadata' }));
  doc.getPage(0).node.set(
    PDFName.of('Annots'),
    doc.context.obj([{ Subtype: 'FileAttachment', FS: {} }]),
  );
  return doc;
}

describe('phase88: stripActiveContent', () => {
  it('all-four strips each class from the working doc and the reloaded bytes', async () => {
    const doc = await richFixture();
    expect(collectJavaScript(doc)).toBe(true);

    const { report, warnings } = stripActiveContent(doc, ALL);
    expect(report.selected).toEqual(['javascript', 'launchActions', 'embeddedFiles', 'metadata']);
    expect(report.removedByClass.javascript).toBeGreaterThanOrEqual(1);
    expect(report.removedByClass.launchActions).toBeGreaterThanOrEqual(1);
    expect(report.removedByClass.embeddedFiles).toBeGreaterThanOrEqual(1);
    expect(report.removedByClass.metadata).toBe(1);
    expect(warnings).toEqual([]);

    // Working document: carriers gone, empty /Names pruned.
    expect(doc.catalog.has(PDFName.of('Names'))).toBe(false);
    expect(doc.catalog.has(PDFName.of('OpenAction'))).toBe(false);
    expect(doc.catalog.has(PDFName.of('Metadata'))).toBe(false);
    expect(collectJavaScript(doc)).toBe(false);

    // Persisted bytes: a real save + reparse reports no active content.
    const reloaded = await PDFDocument.load(await doc.save());
    expect(collectJavaScript(reloaded)).toBe(false);
    expect(collectExternalContent(reloaded)).toEqual({ externalActions: false, fileSpecs: false });
  });

  it('leaves a benign /GoTo /OpenAction intact', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'GoTo', D: [] }));

    const { report, warnings } = stripActiveContent(doc, ALL);
    expect(doc.catalog.has(PDFName.of('OpenAction'))).toBe(true);
    expect(report.removedByClass.launchActions).toBe(0);
    expect(report.removedByClass.javascript).toBe(0);
    expect(warnings).toEqual([]);
  });

  it('a partial selection removes only the selected class', async () => {
    const doc = await richFixture();
    const { report } = stripActiveContent(doc, { ...NONE, metadata: true });

    expect(report.selected).toEqual(['metadata']);
    expect(report.removedByClass).toEqual({
      javascript: 0,
      launchActions: 0,
      embeddedFiles: 0,
      metadata: 1,
    });
    expect(doc.catalog.has(PDFName.of('Metadata'))).toBe(false);
    expect(doc.catalog.has(PDFName.of('Names'))).toBe(true);
    expect(doc.catalog.has(PDFName.of('OpenAction'))).toBe(true);
    const annots = doc.getPage(0).node.Annots() as PDFArray;
    expect(annots.size()).toBe(1);
  });

  it('reports a wrong-typed /Names as a warning while the rest sanitizes', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.catalog.set(PDFName.of('Names'), doc.context.obj('Broken'));
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'Launch', FS: {} }));
    doc.catalog.set(PDFName.of('Metadata'), doc.context.obj({ Type: 'Metadata' }));

    const { report, warnings } = stripActiveContent(doc, ALL);
    expect(warnings.some((w) => w.includes('/Names'))).toBe(true);
    expect(report.removedByClass.launchActions).toBe(1);
    expect(report.removedByClass.metadata).toBe(1);
    expect(doc.catalog.has(PDFName.of('OpenAction'))).toBe(false);
    expect(doc.catalog.has(PDFName.of('Metadata'))).toBe(false);
  });

  it('removes a page JavaScript /AA and an external annotation /A, keeping a benign annot', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const page = doc.getPage(0);
    page.node.set(PDFName.of('AA'), doc.context.obj({ O: { S: 'JavaScript', JS: 'app.alert(1)' } }));
    page.node.set(
      PDFName.of('Annots'),
      doc.context.obj([
        { Subtype: 'Link', A: { S: 'URI', URI: 'http://example.test' } },
        { Subtype: 'Link', A: { S: 'GoTo', D: [] } },
      ]),
    );

    const { report } = stripActiveContent(doc, ALL);
    expect(report.removedByClass.javascript).toBe(1);
    expect(report.removedByClass.launchActions).toBe(1);
    expect(page.node.has(PDFName.of('AA'))).toBe(false);

    const annots = page.node.Annots() as PDFArray;
    const first = doc.context.lookup(annots.get(0)) as PDFDict;
    const second = doc.context.lookup(annots.get(1)) as PDFDict;
    expect(first.has(PDFName.of('A'))).toBe(false);
    expect(second.has(PDFName.of('A'))).toBe(true);
  });

  it('removes a /Launch action /FS when only embeddedFiles is selected', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'Launch', FS: {} }));

    const { report } = stripActiveContent(doc, { ...NONE, embeddedFiles: true });
    const open = doc.context.lookup(doc.catalog.get(PDFName.of('OpenAction'))) as PDFDict;
    expect(open.has(PDFName.of('FS'))).toBe(false);
    expect(report.removedByClass.embeddedFiles).toBe(1);
  });

  it('removes a page /AA JavaScript whose /S is an indirect name (DEF-509)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const page = doc.getPage(0);
    // Hostile: the action type is written indirectly (/S 12 0 R).
    const jsName = doc.context.register(PDFName.of('JavaScript'));
    page.node.set(
      PDFName.of('AA'),
      doc.context.obj({ O: { S: jsName, JS: 'app.alert("indirect")' } }),
    );

    const { report, warnings } = stripActiveContent(doc, ALL);
    expect(report.removedByClass.javascript).toBeGreaterThanOrEqual(1);
    expect(page.node.has(PDFName.of('AA'))).toBe(false);
    expect(warnings).toEqual([]);

    // Round-trip: the serialized bytes carry no page /AA.
    const reloaded = await PDFDocument.load(await doc.save());
    expect(collectJavaScript(reloaded)).toBe(false);
    expect(reloaded.getPage(0).node.has(PDFName.of('AA'))).toBe(false);
  });

  it('warns for an unreadable /S on /OpenAction, page /AA and annotation /A (DEF-510)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const page = doc.getPage(0);
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 42, JS: 'app.alert(1)' }));
    page.node.set(PDFName.of('AA'), doc.context.obj({ O: { S: 99, JS: 'app.alert(2)' } }));
    page.node.set(
      PDFName.of('Annots'),
      doc.context.obj([{ Type: 'Annot', Subtype: 'Link', A: 'broken' }]),
    );

    const { warnings } = stripActiveContent(doc, ALL);
    expect(warnings.some((w) => w.includes('/OpenAction'))).toBe(true);
    expect(warnings.some((w) => w.includes('/AA'))).toBe(true);
    expect(warnings.some((w) => w.includes('annotation 1') && w.includes('/A'))).toBe(true);
  });

  it('warns for an action object with no /S at all (DEF-510)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ JS: 'app.alert(1)' }));

    const { warnings } = stripActiveContent(doc, { ...NONE, javascript: true });
    expect(warnings.some((w) => w.includes('/OpenAction') && w.includes('/S'))).toBe(true);
  });

  it('apply=false reports the same findings without mutating the document (DEF-511)', async () => {
    const doc = await richFixture();
    const { report } = stripActiveContent(doc, ALL, false);

    expect(report.removedByClass.javascript).toBeGreaterThanOrEqual(1);
    expect(report.removedByClass.launchActions).toBeGreaterThanOrEqual(1);
    expect(report.removedByClass.embeddedFiles).toBeGreaterThanOrEqual(1);
    expect(report.removedByClass.metadata).toBe(1);
    // Nothing was deleted: the probe is a pure read.
    expect(doc.catalog.has(PDFName.of('Names'))).toBe(true);
    expect(doc.catalog.has(PDFName.of('OpenAction'))).toBe(true);
    expect(doc.catalog.has(PDFName.of('Metadata'))).toBe(true);
    expect(collectJavaScript(doc)).toBe(true);
  });
});
