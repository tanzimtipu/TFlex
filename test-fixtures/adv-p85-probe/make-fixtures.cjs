// TFL-420 adversary specimen generator (throwaway). Emits hostile outline PDFs.
//   node test-fixtures/adv-p85-probe/make-fixtures.cjs
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, PDFName, PDFString, PDFNumber, PDFNull } = require('@cantoo/pdf-lib');

const OUT = path.join(__dirname, '..', 'adv-p85');
fs.mkdirSync(OUT, { recursive: true });

const XYZ = (pageRef) => [pageRef, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull];

async function prevOutline(file, n) {
  const doc = await PDFDocument.create();
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(doc.addPage([612, 792]));
  const ctx = doc.context;
  const root = ctx.obj({ Type: 'Outlines' });
  const rootRef = ctx.register(root);
  let prev = null;
  let first = null;
  for (let i = 0; i < n; i++) {
    const item = ctx.obj({ Title: PDFString.of(`BM${i + 1}`), Parent: rootRef });
    if (prev) item.set(PDFName.of('Prev'), prev);
    const ref = ctx.register(item);
    item.set(PDFName.of('Dest'), ctx.obj(XYZ(ps[i].ref)));
    if (prev) ctx.lookup(prev).set(PDFName.of('Next'), ref);
    else first = ref;
    prev = ref;
  }
  root.set(PDFName.of('First'), first);
  root.set(PDFName.of('Last'), prev);
  root.set(PDFName.of('Count'), PDFNumber.of(n));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  fs.writeFileSync(file, await doc.save());
}

async function inlineOutline(file) {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([612, 792]);
  const p2 = doc.addPage([612, 792]);
  const ctx = doc.context;
  const root = ctx.obj({ Type: 'Outlines' });
  const rootRef = ctx.register(root);
  const a = ctx.obj({ Title: PDFString.of('InlineA') });
  a.set(PDFName.of('Dest'), ctx.obj(XYZ(p1.ref)));
  const b = ctx.obj({ Title: PDFString.of('InlineB') });
  b.set(PDFName.of('Dest'), ctx.obj(XYZ(p2.ref)));
  a.set(PDFName.of('Next'), b);
  root.set(PDFName.of('First'), a);
  root.set(PDFName.of('Last'), b);
  root.set(PDFName.of('Count'), PDFNumber.of(2));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  fs.writeFileSync(file, await doc.save());
}

async function seOutline(file) {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  const ctx = doc.context;
  const se = ctx.obj({ Type: 'StructElem', S: PDFName.of('P') });
  const seRef = ctx.register(se);
  const root = ctx.obj({ Type: 'Outlines' });
  const rootRef = ctx.register(root);
  const item = ctx.obj({ Title: PDFString.of('Tagged'), Parent: rootRef });
  item.set(PDFName.of('Dest'), ctx.obj(XYZ(p1.ref)));
  item.set(PDFName.of('SE'), seRef);
  const itemRef = ctx.register(item);
  root.set(PDFName.of('First'), itemRef);
  root.set(PDFName.of('Last'), itemRef);
  root.set(PDFName.of('Count'), PDFNumber.of(1));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  fs.writeFileSync(file, await doc.save());
}

(async () => {
  await prevOutline(path.join(OUT, 'adv-166-outline-prev.pdf'), 2);
  await prevOutline(path.join(OUT, 'adv-165-merge-a.pdf'), 3);
  await prevOutline(path.join(OUT, 'adv-165-merge-b.pdf'), 2);
  await inlineOutline(path.join(OUT, 'adv-167-outline-inline.pdf'));
  await seOutline(path.join(OUT, 'adv-166-outline-se.pdf'));
  console.log('specimens written to', OUT);
})();
