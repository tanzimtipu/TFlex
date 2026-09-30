// Phase 65 chunk 2 (TFL-101 / DEF-436) — minimal signature-suppression fixture
// generator. Synthetic, no operator content (Phase 59 ruling 2 / Phase 65
// ruling 2).
//
// One page, three widgets, each with a visible light-grey /AP /N appearance:
//   1. a FILLABLE text widget  -> overlay control only; canvas paints no /AP
//   2. a READ-ONLY text widget -> canvas appearance only; zero overlay controls
//   3. a SIGNATURE widget      -> canvas appearance only; zero overlay controls
// This proves the ruling-6 oracle: read-only and signature widgets are
// represented exactly once, by their canvas paint.
//
// Run: node test-fixtures/phase65/make-locked-fixture.cjs
const {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
} = require('@cantoo/pdf-lib');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'form-locked-anon.pdf');
const PAGE_W = 595.28;
const PAGE_H = 841.89;

function greyAppearance(doc, w, h) {
  const stream = doc.context.stream('q 0.82 0.82 0.82 rg 0 0 ' + w + ' ' + h + ' re f Q', {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [0, 0, w, h],
    Resources: {},
  });
  return doc.context.register(stream);
}

async function build() {
  const doc = await PDFDocument.create();
  const form = doc.getForm();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawText('LOCKED FORM FIXTURE - TFLEX PHASE 65 CHUNK 2', { x: 46, y: 810, size: 11 });

  const RECTS = {
    fill: { x: 46, y: 740, width: 160, height: 20 },
    ro: { x: 46, y: 700, width: 160, height: 20 },
    sig: { x: 46, y: 650, width: 160, height: 40 },
  };

  // 1. Fillable text field.
  const tf = form.createTextField('locked_text_fill');
  tf.setText('');
  tf.addToPage(page, RECTS.fill);
  tf.acroField.getWidgets()[0].dict.set(
    PDFName.of('AP'),
    doc.context.obj({ N: greyAppearance(doc, RECTS.fill.width, RECTS.fill.height) }),
  );

  // 2. Read-only text field.
  const ro = form.createTextField('locked_text_ro');
  ro.setText('');
  ro.addToPage(page, RECTS.ro);
  ro.enableReadOnly();
  ro.acroField.getWidgets()[0].dict.set(
    PDFName.of('AP'),
    doc.context.obj({ N: greyAppearance(doc, RECTS.ro.width, RECTS.ro.height) }),
  );

  // 3. Signature widget (/FT /Sig), crafted low-level (pdf-lib has no
  //    createSignature). It is a widget annotation in the page /Annots and a
  //    terminal field in the AcroForm /Fields.
  const sigAp = greyAppearance(doc, RECTS.sig.width, RECTS.sig.height);
  const sigWidget = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFString.of('locked_sig'),
    Ff: PDFNumber.of(0),
    Rect: [RECTS.sig.x, RECTS.sig.y, RECTS.sig.x + RECTS.sig.width, RECTS.sig.y + RECTS.sig.height],
    F: 4,
    AP: { N: sigAp },
    P: page.ref,
  });
  const sigRef = doc.context.register(sigWidget);
  const annots = page.node.get(PDFName.of('Annots'));
  if (annots !== undefined) annots.push(sigRef);
  else page.node.set(PDFName.of('Annots'), doc.context.obj([sigRef]));
  const fields = form.acroForm.dict.get(PDFName.of('Fields'));
  fields.push(sigRef);

  fs.writeFileSync(OUT, await doc.save({ updateFieldAppearances: false }));
  return OUT;
}

build()
  .then((p) => {
    console.log('fixture written:', p, fs.statSync(p).size, 'bytes');
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
