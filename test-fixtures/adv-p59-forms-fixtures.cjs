// Adversarial Phase-59 hostile-form fixture generator.
// Writes PDFs under test-fixtures/adv-p59/ used by adv-p59-forms.cjs.
// Run: node test-fixtures/adv-p59-forms-fixtures.cjs
const {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  PDFHexString,
  PDFArray,
  PDFDict,
  PDFRef,
  PDFStream,
  rgb,
} = require('@cantoo/pdf-lib');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'adv-p59');
fs.mkdirSync(OUT, { recursive: true });
const out = (n) => path.join(OUT, n);

async function newDoc(pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`Page ${i + 1}`, { x: 40, y: 740, size: 14 });
  }
  return doc;
}

// --- 1. multi-widget button group (3 options, no Radio flag) --------------
async function multiWidget() {
  const doc = await newDoc(1);
  const form = doc.getForm();
  const page = doc.getPage(0);
  const rg = form.createRadioGroup('shipping');
  rg.addOptionToPage('standard', page, { x: 60, y: 700, width: 16, height: 16 });
  rg.addOptionToPage('express', page, { x: 60, y: 670, width: 16, height: 16 });
  rg.addOptionToPage('overnight', page, { x: 60, y: 640, width: 16, height: 16 });
  // Clear the Radio flag so pdf-lib models this as a multi-widget checkbox
  // (the item-4 group path), while it stays a genuine multi-widget /Btn field.
  const acro = rg.acroField;
  acro.dict.set(PDFName.of('Ff'), PDFNumber.of(0));
  fs.writeFileSync(out('multiwidget.pdf'), await doc.save());
}

// --- 2. non-Latin value in a text field with a WinAnsi /DA font -----------
async function nonLatin() {
  const doc = await newDoc(1);
  const form = doc.getForm();
  const tf = form.createTextField('name_cyr');
  tf.setText('Cyrillic OK');
  tf.addToPage(doc.getPage(0), { x: 60, y: 700, width: 300, height: 20 });
  // Force a Helvetica /DA (WinAnsi) that cannot encode Cyrillic.
  const dict = tf.acroField.dict;
  dict.set(PDFName.of('DA'), PDFString.of('/Helv 12 Tf 0 g'));
  fs.writeFileSync(out('nonlatin.pdf'), await doc.save());
}

// --- 3. read-only field ---------------------------------------------------
async function readOnly() {
  const doc = await newDoc(1);
  const form = doc.getForm();
  const tf = form.createTextField('locked');
  tf.setText('cannot touch');
  tf.addToPage(doc.getPage(0), { x: 60, y: 700, width: 300, height: 20 });
  tf.acroField.dict.set(PDFName.of('Ff'), PDFNumber.of(1)); // ReadOnly bit 1
  fs.writeFileSync(out('readonly.pdf'), await doc.save());
}

// --- 4. signed document: /Sig field with a value --------------------------
async function signed() {
  const doc = await newDoc(1);
  const form = doc.getForm();
  const tf = form.createTextField('body');
  tf.setText('contract');
  tf.addToPage(doc.getPage(0), { x: 60, y: 700, width: 300, height: 20 });
  // Add a raw /Sig field merged with a widget, carrying a /V signature dict.
  const ctx = doc.context;
  const sigVal = ctx.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', Contents: PDFHexString.fromText('00') });
  const sigValRef = ctx.register(sigVal);
  const sig = ctx.obj({
    FT: 'Sig',
    T: PDFString.of('approval'),
    Ff: 0,
    Subtype: 'Widget',
    Rect: [60, 640, 260, 680],
    P: doc.getPage(0).ref,
    V: sigValRef,
  });
  const sigRef = ctx.register(sig);
  const acro = form.acroForm;
  const fields = acro.dict.get(PDFName.of('Fields'));
  fields.push(sigRef);
  const annots = doc.getPage(0).node.get(PDFName.of('Annots'));
  annots.push(sigRef);
  fs.writeFileSync(out('signed.pdf'), await doc.save());
}

// --- 5. XFA-only form (AcroForm with /XFA, no fields) ---------------------
async function xfaOnly() {
  const doc = await newDoc(1);
  const ctx = doc.context;
  const xfa = ctx.stream('<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"/>', {});
  const xfaRef = ctx.register(xfa);
  const acro = ctx.obj({ Fields: [], XFA: xfaRef, NeedAppearances: true });
  doc.catalog.set(PDFName.of('AcroForm'), ctx.register(acro));
  fs.writeFileSync(out('xfa-only.pdf'), await doc.save());
}

// --- 6. flat document (no form) -------------------------------------------
async function flat() {
  const doc = await newDoc(2);
  doc.getPage(0).drawText('Flat document, no fields', { x: 60, y: 600, size: 16 });
  fs.writeFileSync(out('flat.pdf'), await doc.save());
}

// --- 7. orphan widget (page widget not in /Fields) ------------------------
async function orphan() {
  const doc = await newDoc(1);
  const form = doc.getForm();
  const tf = form.createTextField('legit');
  tf.setText('real');
  tf.addToPage(doc.getPage(0), { x: 60, y: 700, width: 300, height: 20 });
  // Raw widget annotation on the page that /Fields never references.
  const ctx = doc.context;
  const orphanWidget = ctx.obj({
    FT: 'Tx',
    T: PDFString.of('ghost'),
    Subtype: 'Widget',
    Rect: [60, 640, 260, 660],
    P: doc.getPage(0).ref,
    V: PDFString.of('orphan value'),
  });
  const orphanRef = ctx.register(orphanWidget);
  doc.getPage(0).node.get(PDFName.of('Annots')).push(orphanRef);
  fs.writeFileSync(out('orphan.pdf'), await doc.save());
}

// --- 8. 500 text fields ---------------------------------------------------
async function manyFields() {
  const doc = await newDoc(5);
  const form = doc.getForm();
  for (let i = 0; i < 500; i++) {
    const page = doc.getPage(i % 5);
    const tf = form.createTextField(`f${i}`);
    tf.setText(`v${i}`);
    const col = i % 4;
    const row = Math.floor(i / 4) % 40;
    tf.addToPage(page, { x: 40 + col * 130, y: 740 - row * 18, width: 120, height: 15 });
  }
  fs.writeFileSync(out('manyfields.pdf'), await doc.save());
}

// --- 9. fields on pages 2 and 3 (for delete/rotate page-attachment) -------
async function paginated() {
  const doc = await newDoc(3);
  const form = doc.getForm();
  const t1 = form.createTextField('page2_field');
  t1.setText('second page value');
  t1.addToPage(doc.getPage(1), { x: 60, y: 700, width: 300, height: 20 });
  const t2 = form.createTextField('page3_field');
  t2.setText('third page value');
  t2.addToPage(doc.getPage(2), { x: 60, y: 700, width: 300, height: 20 });
  const cb = form.createCheckBox('page2_check');
  cb.check();
  cb.addToPage(doc.getPage(1), { x: 60, y: 660, width: 16, height: 16 });
  fs.writeFileSync(out('paginated.pdf'), await doc.save());
}

// --- 10. field value already non-encodable by WinAnsi ---------------------
async function preexistingNonLatin() {
  const doc = await newDoc(1);
  const form = doc.getForm();
  const tf = form.createTextField('preexisting');
  tf.setText('placeholder');
  tf.addToPage(doc.getPage(0), { x: 60, y: 700, width: 300, height: 20 });
  const dict = tf.acroField.dict;
  dict.set(PDFName.of('DA'), PDFString.of('/Helv 12 Tf 0 g'));
  // Write a raw /V hex string holding a Cyrillic value.
  dict.set(PDFName.of('V'), PDFHexString.fromText('Привет мир'));
  fs.writeFileSync(out('preexisting-nonlatin.pdf'), await doc.save());
}

// --- 11. encrypted form (AES-256, user password) --------------------------
async function encryptedForm() {
  const doc = await newDoc(1);
  const form = doc.getForm();
  const tf = form.createTextField('secret');
  tf.setText('classified');
  tf.addToPage(doc.getPage(0), { x: 60, y: 700, width: 300, height: 20 });
  doc.encrypt({
    userPassword: 'open-sesame',
    ownerPassword: 'owner-sesame',
    algorithm: 'AES-256',
    permissions: {
      printing: 'highResolution',
      modifying: true,
      copying: true,
      annotating: true,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: true,
    },
  });
  fs.writeFileSync(out('encrypted-form.pdf'), await doc.save());
}

// --- 12. owner-restricted encrypted doc (EMPTY user password) -------------
async function encryptedOwner() {
  const doc = await newDoc(2);
  const form = doc.getForm();
  const tf = form.createTextField('owner_field');
  tf.setText('owner restricted');
  tf.addToPage(doc.getPage(0), { x: 60, y: 700, width: 300, height: 20 });
  doc.encrypt({
    userPassword: '',
    ownerPassword: 'owner-sesame',
    algorithm: 'AES-256',
    permissions: {
      printing: false,
      modifying: false,
      copying: false,
      annotating: false,
      fillingForms: false,
      contentAccessibility: false,
      documentAssembly: false,
    },
  });
  fs.writeFileSync(out('encrypted-owner.pdf'), await doc.save());
}

async function main() {
  await encryptedForm();
  await encryptedOwner();
  await multiWidget();
  await nonLatin();
  await readOnly();
  await signed();
  await xfaOnly();
  await flat();
  await orphan();
  await manyFields();
  await paginated();
  await preexistingNonLatin();
  console.log('fixtures written to', OUT);
  for (const f of fs.readdirSync(OUT)) {
    console.log(' ', f, fs.statSync(path.join(OUT, f)).size);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
