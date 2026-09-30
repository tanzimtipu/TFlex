// Phase 65 chunk 1 (TFL-89 / DEF-436) synthetic fixture generator.
//
// Reproduces the FIELD TOPOLOGY of the operator's
// `C:\Users\tanzi\OneDrive\Desktop\Parent visa\956.pdf` WITHOUT any of its
// content (Phase 59 ruling 2 / Phase 65 ruling 2): 6 pages, 105 fields,
// 129 widgets, fields distributed 34 / 34 / 27 / 10 across pages 3-6, and
// multi-widget button groups (a 6-widget group and a 4-widget group per
// form page, mirroring `mg.reason ex` and `mg.title`). Every widget also
// carries a visible light-grey /AP /N appearance so a pre-fix canvas that
// still painted widget appearances would be detectable by pixel sampling.
//
// Also embeds one non-form annotation (a red /Square with an explicit
// /AP /N stream) on page 3 for the blast-radius check, and prints a text
// line on every page so text-selection can be exercised outside form rects.
//
// Run: node test-fixtures/phase65/make-fixture.cjs
const {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
} = require('@cantoo/pdf-lib');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'form-956-anon.pdf');
const PAGE_W = 595.28;
const PAGE_H = 841.89;

// Per form page (1-based pages 3-6): text fields, single check boxes, and
// the widget counts of the multi-widget button groups on that page.
const PAGES = [
  { text: 27, cb: 5, groups: [6, 4] },
  { text: 27, cb: 5, groups: [6, 4] },
  { text: 21, cb: 4, groups: [6, 4] },
  { text: 9, cb: 1, groups: [] },
];

const GROUP_VALUES_6 = ['Yes', 'No', 'Not sure', 'Maybe', 'Other', 'Unknown'];
const GROUP_VALUES_4 = ['Mr', 'Mrs', 'Miss', 'Ms'];

/** 4-column grid slot on a page; `i` is the page-local widget index. */
function slot(i) {
  const col = i % 4;
  const row = Math.floor(i / 4);
  const x = 46 + col * 135;
  const top = 770 - row * 30;
  return { x, top };
}
// pdf-lib /Rect is bottom-left origin; place a widget whose TOP is `top`.
const rectFromTop = (s, w, h) => ({ x: s.x, y: s.top - h, width: w, height: h });

/** Give a widget a visible grey /AP /N appearance (would paint under the
 *  default pdf.js AnnotationMode.ENABLE, must NOT paint under ENABLE_FORMS). */
function setGreyAppearance(doc, widget, w, h) {
  const stream = doc.context.stream('q 0.82 0.82 0.82 rg 0 0 ' + w + ' ' + h + ' re f Q', {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [0, 0, w, h],
    Resources: {},
  });
  const ref = doc.context.register(stream);
  widget.dict.set(PDFName.of('AP'), doc.context.obj({ N: ref }));
}

/** A non-form /Square annotation with a solid red /AP /N stream. */
function addRedSquare(doc, page) {
  const w = 120;
  const h = 20;
  const stream = doc.context.stream('q 1 0 0 rg 0 0 ' + w + ' ' + h + ' re f Q', {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [0, 0, w, h],
    Resources: {},
  });
  const apRef = doc.context.register(stream);
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [46, 790, 46 + w, 790 + h],
    F: 4,
    AP: { N: apRef },
  });
  const ref = doc.context.register(annot);
  const annots = page.node.get(PDFName.of('Annots'));
  if (annots !== undefined) annots.push(ref);
  else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
}

async function build() {
  const doc = await PDFDocument.create();
  const form = doc.getForm();
  const pages = [];
  for (let i = 0; i < 6; i += 1) {
    const p = doc.addPage([PAGE_W, PAGE_H]);
    p.drawText('PRINTED FORM ARTWORK - TFLEX PHASE 65', { x: 46, y: 820, size: 11 });
    pages.push(p);
  }

  let textSeq = 0;
  let cbSeq = 0;
  let groupSeq = 0;
  let roAssigned = 0;

  for (let pi = 0; pi < PAGES.length; pi += 1) {
    const page = pages[pi + 2]; // 1-based page 3 -> index 2
    const spec = PAGES[pi];
    let widgetIndex = 0;

    // Text fields.
    for (let t = 0; t < spec.text; t += 1) {
      textSeq += 1;
      const r = rectFromTop(slot(widgetIndex), 120, 18);
      widgetIndex += 1;
      const tf = form.createTextField(`text_p${pi + 3}_${textSeq}`);
      tf.setText('');
      tf.addToPage(page, r);
      setGreyAppearance(doc, tf.acroField.getWidgets()[0], r.width, r.height);
      // Two read-only text fields for the blast-radius non-editable check.
      if (roAssigned < 2 && (pi === 0 && t === 0 || pi === 3 && t === 0)) {
        tf.enableReadOnly();
        roAssigned += 1;
      }
    }

    // Single check boxes.
    for (let c = 0; c < spec.cb; c += 1) {
      cbSeq += 1;
      const s = slot(widgetIndex);
      widgetIndex += 1;
      const box = form.createCheckBox(`cb_p${pi + 3}_${cbSeq}`);
      box.addToPage(page, rectFromTop(s, 16, 16));
    }

    // Multi-widget button groups (cleared Radio flag -> multi-widget /Btn).
    for (const n of spec.groups) {
      groupSeq += 1;
      const values = n === 6 ? GROUP_VALUES_6 : GROUP_VALUES_4;
      const name = n === 6
        ? (groupSeq === 1 ? 'mg.reason ex' : `mg.reason_${groupSeq}`)
        : (groupSeq === 2 ? 'mg.title' : `mg.option_${groupSeq}`);
      const rg = form.createRadioGroup(name);
      for (let k = 0; k < n; k += 1) {
        const s = slot(widgetIndex);
        widgetIndex += 1;
        rg.addOptionToPage(values[k], page, rectFromTop(s, 16, 16));
      }
      rg.acroField.dict.set(PDFName.of('Ff'), PDFNumber.of(0));
    }
  }

  addRedSquare(doc, pages[2]);

  // Unencrypted: this chunk's assignment is the field LAYER topology, not the
  // separate Phase 65 encrypted-parity criterion (D). (The generator can add
  // doc.encrypt({userPassword:'', ...}) to mirror the operator's file, but
  // keeping the layer probe free of the encryption flow avoids conflating the
  // two behaviours.)
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
