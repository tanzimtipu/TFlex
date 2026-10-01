// Phase 65 (TFL-153 / DEF-445) — minimal push-button fixture generator.
// Synthetic, no operator content (Phase 59 ruling 2 / Phase 65 ruling 2).
//
// One page with a visible light-grey /AP /N appearance on every widget:
//   1. a FILLABLE text widget  -> overlay control only (known baseline)
//   2. a PUSH BUTTON (/FT /Btn with the Pushbutton bit; pdf-lib PDFButton)
//      -> pdf.js canvas-paints it; TFlex must render ZERO overlay surfaces
//         so it is represented exactly once, by its canvas paint.
//
// Run: node test-fixtures/phase65/make-pushbutton-fixture.cjs
const {
  PDFDocument,
  PDFName,
} = require('@cantoo/pdf-lib');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'form-pushbutton-anon.pdf');
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
  page.drawText('PUSH BUTTON FIXTURE - TFLEX PHASE 65 DEF-445', { x: 46, y: 810, size: 11 });

  const TEXT_RECT = { x: 46, y: 740, width: 160, height: 20 };
  const BTN_RECT = { x: 60, y: 700, width: 120, height: 28 };

  // 1. Fillable text field control (baseline: one overlay editor).
  const tf = form.createTextField('push_text_fill');
  tf.setText('');
  tf.addToPage(page, TEXT_RECT);
  tf.acroField.getWidgets()[0].dict.set(
    PDFName.of('AP'),
    doc.context.obj({ N: greyAppearance(doc, TEXT_RECT.width, TEXT_RECT.height) }),
  );

  // 2. Push button. pdf-lib's PDFButton sets the /Ff Pushbutton bit; the engine
  //    reports it with `pushButton: true`, so the renderer suppresses its
  //    overlay editor and pdf.js paints the /AP on the canvas.
  const btn = form.createButton('push_button');
  btn.addToPage('Go', page, BTN_RECT);
  btn.acroField.getWidgets()[0].dict.set(
    PDFName.of('AP'),
    doc.context.obj({ N: greyAppearance(doc, BTN_RECT.width, BTN_RECT.height) }),
  );

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
