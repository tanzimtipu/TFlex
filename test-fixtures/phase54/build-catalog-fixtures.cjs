// QA fixture generator for the Phase 54 DEF-378 run-close pass.
// Builds catalog-entry fixtures used to verify:
//   - pdfa.javascript fires on an OPENED document that carries /Names /JavaScript
//     (with NO /OpenAction), and does not fire on a JavaScript-free document;
//   - /OCProperties survives a save;
//   - the catalog entries serializeDoc STILL drops (/StructTreeRoot, /Names
//     wholesale, /Dests, /OpenAction, /AcroForm) are genuinely absent after a
//     save, while the carried /MarkInfo is present (positive control).
// Run once:  node test-fixtures/phase54/build-catalog-fixtures.cjs
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  PDFDocument, PDFName, PDFString,
} = require('@cantoo/pdf-lib');

const OUT = __dirname;

function write(name, buf) {
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`wrote ${name} (${buf.length} bytes)`);
}

function jsAction(doc) {
  return doc.context.obj({
    S: PDFName.of('JavaScript'),
    JS: PDFString.of("app.alert('tflex-js-fixture');"),
  });
}

function jsNameTree(doc) {
  const action = doc.context.register(jsAction(doc));
  return doc.context.obj({ Names: doc.context.obj([PDFString.of('js1'), action]) });
}

// /Names /JavaScript action, deliberately NO /OpenAction.
async function buildJavaScript() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 200]);
  const tree = doc.context.register(jsNameTree(doc));
  const names = doc.context.obj({ JavaScript: tree });
  doc.catalog.set(PDFName.of('Names'), doc.context.register(names));
  return doc.save();
}

// Optional content groups with names, wired into /OCProperties.
async function buildOcg() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 200]);
  const r1 = doc.context.register(doc.context.obj({
    Type: PDFName.of('OCG'), Name: PDFString.of('Layer Alpha'),
  }));
  const r2 = doc.context.register(doc.context.obj({
    Type: PDFName.of('OCG'), Name: PDFString.of('Layer Beta'),
  }));
  doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({
    OCGs: doc.context.obj([r1, r2]),
    D: doc.context.obj({
      Order: doc.context.obj([r1, r2]),
      ON: doc.context.obj([r1]),
    }),
  }));
  return doc.save();
}

// Tagged structure + named destination + initial view + form + a carried
// /MarkInfo, so one save proves both the losses and the carries.
async function buildDrops() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 200]);
  const pageRef = doc.getPage(0).ref;

  const destsTree = doc.context.obj({
    Names: doc.context.obj([PDFString.of('Chapter1'), doc.context.obj([pageRef, PDFName.of('Fit')])]),
  });
  const destsRef = doc.context.register(destsTree);
  doc.catalog.set(PDFName.of('Dests'), destsRef);

  // /Names carries a page-referencing /Dests entry AND a JavaScript subtree.
  const names = doc.context.obj({
    Dests: destsRef,
    JavaScript: doc.context.register(jsNameTree(doc)),
  });
  doc.catalog.set(PDFName.of('Names'), doc.context.register(names));

  doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj([pageRef, PDFName.of('Fit')]));
  doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: doc.context.obj([]) }));

  const structElem = doc.context.obj({
    Type: PDFName.of('StructElem'), S: PDFName.of('P'), Pg: pageRef,
  });
  const structTree = doc.context.obj({
    Type: PDFName.of('StructTreeRoot'),
    K: doc.context.obj([doc.context.register(structElem)]),
    ParentTree: doc.context.obj({ Nums: doc.context.obj([]) }),
  });
  doc.catalog.set(PDFName.of('StructTreeRoot'), doc.context.register(structTree));

  doc.catalog.set(PDFName.of('MarkInfo'), doc.context.obj({ Marked: true }));
  return doc.save();
}

(async () => {
  write('js-names-action.pdf', Buffer.from(await buildJavaScript()));
  write('ocg-layers.pdf', Buffer.from(await buildOcg()));
  write('catalog-drops.pdf', Buffer.from(await buildDrops()));
  console.log('done');
})();
