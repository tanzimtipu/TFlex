// Adversary probe - Phase 116 annotation /T (author) + /M (modified date).
// Exercises the SHIPPED @cantoo/pdf-lib predicates that the product code uses:
//   annotations.ts:796-799  parsePdfString  (read path)
//   annotations.ts:1714-1717 serializeAnnotation (write path, PDFString.of)
// This is a source-review + dependency-behaviour reproduction, not a build.
import { PDFDocument, PDFName, PDFString, PDFHexString } from '@cantoo/pdf-lib';
import { writeFileSync } from 'node:fs';

function parsePdfString(val) {
  if (val instanceof PDFString) return val.decodeText();
  return undefined;
}

async function annotWithAuthor(authorVal, modifiedVal) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const d = { Type: 'Annot', Subtype: 'Square', Rect: [72, 700, 172, 720], C: [1, 1, 0] };
  d.T = authorVal;
  d.M = modifiedVal;
  const annot = doc.context.obj(d);
  page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  const bytes = await doc.save();
  const reloaded = await PDFDocument.load(bytes);
  const pageDict = reloaded.getPages()[0].node;
  const arr = pageDict.lookup(PDFName.of('Annots'));
  const first = arr.get(0);
  const dict = reloaded.context.lookup(first);
  const t = dict.get(PDFName.of('T'));
  const m = dict.get(PDFName.of('M'));
  return { t, m };
}

console.log('=== A: foreign /T and /M encoded as PDFHexString (UTF-16BE) ===');
const hexT = PDFHexString.fromText('Jos\u00e9 Author');
const hexM = PDFHexString.fromText('D:20260101120000Z');
{
  const { t, m } = await annotWithAuthor(hexT, hexM);
  console.log('  on disk instanceof PDFString :', t instanceof PDFString);
  console.log('  on disk instanceof PDFHexString:', t instanceof PDFHexString);
  console.log('  disk raw decodeText           :', t.decodeText());
  console.log('  product parsePdfString(/T)    :', parsePdfString(t));
  console.log('  product parsePdfString(/M)    :', parsePdfString(m));
  console.log('  -> hasAuthor =', parsePdfString(t) !== undefined && parsePdfString(t).trim().length > 0);
}

console.log('=== B: write path PDFString.of() with non-Latin1 author ===');
for (const author of ['Ada Example', 'Jos\u00e9', '\u674e\u96f7', 'a\u0000b']) {
  try {
    const s = PDFString.of(author);
    const rt = s.decodeText();
    console.log(`  of(${JSON.stringify(author)}) -> decodeText=${JSON.stringify(rt)} ok=${rt === author}`);
  } catch (e) {
    console.log(`  of(${JSON.stringify(author)}) -> THREW ${e.constructor.name}: ${e.message}`);
  }
}

console.log('=== C: PDFString.of non-ASCII in an actual dict, saved+reloaded ===');
{
  try {
    const { t } = await annotWithAuthor(PDFString.of('Jos\u00e9'), PDFString.of('D:x'));
    console.log('  reloaded /T decodeText:', JSON.stringify(t.decodeText()), 'instanceof PDFString:', t instanceof PDFString);
  } catch (e) {
    console.log('  save/load THREW', e.constructor.name, e.message);
  }
}
{
  try {
    const { t } = await annotWithAuthor(PDFString.of('\u674e\u96f7'), PDFString.of('D:x'));
    console.log('  CJK reloaded /T decodeText:', JSON.stringify(t.decodeText()));
  } catch (e) {
    console.log('  CJK save/load THREW', e.constructor.name, e.message);
  }
}

console.log('=== D: end-to-end metadata loss for a hex-encoded foreign /T ===');
{
  // Load the hex fixture (as the product open path does), read via parsePdfString
  // (annotations.ts:796), then re-serialize the way serializeAnnotation does
  // (annotations.ts:1713-1714 write /T only when the model carries one).
  const src = await (async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const annot = doc.context.obj({
      Type: 'Annot', Subtype: 'Square', Rect: [72, 700, 172, 720], C: [1, 1, 0],
      T: PDFHexString.fromText('\u674e\u96f7'), M: PDFHexString.fromText('D:20260101120000Z'),
    });
    page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
    return doc.save();
  })();
  writeFileSync(new URL('./foreign-hex-author.pdf', import.meta.url), src);

  const inDoc = await PDFDocument.load(src);
  const arr = inDoc.getPages()[0].node.lookup(PDFName.of('Annots'));
  const dst = inDoc.context.lookup(arr.get(0));
  const author = parsePdfString(dst.get(PDFName.of('T')));
  console.log('  parsed author:', JSON.stringify(author));

  const out = await PDFDocument.create();
  const outPage = out.addPage([612, 792]);
  const entries = { Type: 'Annot', Subtype: 'Square', Rect: [72, 700, 172, 720], C: [1, 1, 0] };
  if (typeof author === 'string' && author.trim().length > 0) entries.T = PDFString.of(author);
  outPage.node.set(PDFName.of('Annots'), out.context.obj([out.context.register(out.context.obj(entries))]));
  const saved = await out.save();
  const re = await PDFDocument.load(saved);
  const reArr = re.getPages()[0].node.lookup(PDFName.of('Annots'));
  const reDst = re.context.lookup(reArr.get(0));
  console.log('  after save+reload: has /T ?', reDst.get(PDFName.of('T')) !== undefined);
  console.log('  after save+reload: has /M ?', reDst.get(PDFName.of('M')) !== undefined);
  console.log('  -> original CJK author + date LOST on save');
}
