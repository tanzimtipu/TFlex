// Phase 65 chunk 2 (TFL-101 / DEF-436) — minimal signature-suppression fixture
// generator. Synthetic, no operator content (Phase 59 ruling 2 / Phase 65
// ruling 2).
//
// One page, each widget with a visible light-grey /AP /N appearance:
//   1. a FILLABLE text widget  -> overlay control only; canvas paints no /AP
//   2. a READ-ONLY text widget -> canvas appearance only; zero overlay controls
//   3. a SIGNATURE widget      -> canvas appearance only; zero overlay controls
// This proves the ruling-6 oracle: read-only and signature widgets are
// represented exactly once, by their canvas paint.
//
// DEF-444 (TFL-139) — read-only NON-TEXT widgets are NOT canvas-painted by
// pdf.js under ENABLE_FORMS, so their disabled overlay control is the only
// surface. Added, each with field-level /Ff ReadOnly:
//   4. a READ-ONLY CHECK BOX     -> one disabled .form-checkbox overlay control
//   5. a READ-ONLY RADIO GROUP   -> one disabled .form-radio per widget
//   6. a READ-ONLY DROPDOWN      -> one disabled select.form-select
//   7. a READ-ONLY LIST BOX      -> one disabled .form-listbox
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
    cb: { x: 46, y: 590, width: 18, height: 18 },
    dd: { x: 46, y: 500, width: 160, height: 20 },
    lb: { x: 46, y: 430, width: 160, height: 60 },
  };
  // Three widgets for the read-only radio group, in a row.
  const RADIO_RECTS = [0, 1, 2].map((i) => ({ x: 46 + i * 140, y: 550, width: 18, height: 18 }));

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

  // 4. Read-only check box. pdf.js does NOT canvas-paint checkboxes under
  //    ENABLE_FORMS, so its disabled overlay control is the only surface.
  const cb = form.createCheckBox('locked_cb_ro');
  cb.addToPage(page, RECTS.cb);
  cb.enableReadOnly();
  cb.acroField.getWidgets()[0].dict.set(
    PDFName.of('AP'),
    doc.context.obj({ N: greyAppearance(doc, RECTS.cb.width, RECTS.cb.height) }),
  );

  // 5. Read-only radio group with three widgets (one control per widget).
  const rg = form.createRadioGroup('locked_radio_ro');
  const RADIO_VALUES = ['One', 'Two', 'Three'];
  for (let i = 0; i < RADIO_VALUES.length; i += 1) {
    rg.addOptionToPage(RADIO_VALUES[i], page, RADIO_RECTS[i]);
  }
  rg.enableReadOnly();
  rg.acroField.getWidgets().forEach((widget, i) => {
    widget.dict.set(
      PDFName.of('AP'),
      doc.context.obj({ N: greyAppearance(doc, RADIO_RECTS[i].width, RADIO_RECTS[i].height) }),
    );
  });

  // 6. Read-only dropdown.
  const dd = form.createDropdown('locked_dd_ro');
  dd.addOptions(['Alpha', 'Beta', 'Gamma']);
  dd.addToPage(page, RECTS.dd);
  dd.enableReadOnly();
  dd.acroField.getWidgets()[0].dict.set(
    PDFName.of('AP'),
    doc.context.obj({ N: greyAppearance(doc, RECTS.dd.width, RECTS.dd.height) }),
  );

  // 7. Read-only list box.
  const lb = form.createOptionList('locked_lb_ro');
  lb.addOptions(['Red', 'Green', 'Blue']);
  lb.addToPage(page, RECTS.lb);
  lb.enableReadOnly();
  lb.acroField.getWidgets()[0].dict.set(
    PDFName.of('AP'),
    doc.context.obj({ N: greyAppearance(doc, RECTS.lb.width, RECTS.lb.height) }),
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
