// Read-only structural inspector for the operator's payslip (used IN PLACE).
// Temporary QA diagnostic; removed after the DEF-338 investigation.
const fs = require('fs');
const zlib = require('zlib');
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFStream } = require('pdf-lib');

const p = process.argv[2];
(async () => {
  const buf = fs.readFileSync(p);
  console.log('file', p, 'bytes', buf.length);
  console.log('header', JSON.stringify(buf.slice(0, 16).toString('latin1')));
  const doc = await PDFDocument.load(buf, { updateMetadata: false, ignoreEncryption: true });
  const pg = doc.getPages()[0];
  const node = pg.node;
  const res = node.Resources();
  const fonts = res.lookup(PDFName.of('Font'));
  if (fonts instanceof PDFDict) {
    for (const k of fonts.keys()) {
      const f = fonts.lookup(k);
      const sub = f.get(PDFName.of('Subtype'));
      const bf = f.get(PDFName.of('BaseFont'));
      const df = f.get(PDFName.of('DescendantFonts'));
      const fd = f.get(PDFName.of('FontDescriptor'));
      console.log('Font', k.asString(), 'sub', sub && sub.asString ? sub.asString() : String(sub),
        'base', bf && bf.asString ? bf.asString() : String(bf), 'descendant', !!df, 'descriptor', !!fd);
    }
  }
  const contents = node.Contents();
  const streams = [];
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) streams.push(contents.lookup(i));
  } else {
    streams.push(contents);
  }
  console.log('contentStreams', streams.length);
  let total = 0;
  let all = '';
  for (const s of streams) {
    if (s instanceof PDFRawStream || s instanceof PDFStream) {
      const raw = s.getContents ? s.getContents() : null;
      let bytes = raw;
      const filt = s.dict.get(PDFName.of('Filter'));
      const fstr = filt && filt.asString ? filt.asString() : String(filt);
      if (fstr && fstr.includes('FlateDecode')) {
        try { bytes = zlib.inflateSync(Buffer.from(raw)); } catch (e) { console.log('inflate fail', e.message); }
      }
      total += bytes.length;
      all += bytes.toString('latin1');
      console.log('  stream raw', raw.length, 'decoded', bytes.length, 'filter', fstr);
    }
  }
  console.log('total decoded content bytes', total);
  const count = (re) => (all.match(re) || []).length;
  console.log('inline image markers BI/ID/EI', count(/\bBI\b/g), count(/\bID\b/g), count(/\bEI\b/g));
  console.log('has sh', /\bsh\b/.test(all), 'has Do', /\bDo\b/.test(all), 'has gs', /\bgs\b/.test(all),
    'has BT', /\bBT\b/.test(all), 'has Tj', /\bTj\b/.test(all), 'has TJ', /\bTJ\b/.test(all));
  const ops = {};
  for (const m of all.matchAll(/(?:^|[\s])([A-Za-z'"*]{1,3})(?=[\s])/g)) {
    ops[m[1]] = (ops[m[1]] || 0) + 1;
  }
  const top = Object.entries(ops).sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log('top ops', JSON.stringify(top));
  console.log('head', JSON.stringify(all.slice(0, 400)));
  console.log('Annots', !!node.Annots(), 'AcroForm', !!doc.catalog.get(PDFName.of('AcroForm')));
})().catch((e) => { console.error('ERR', e.stack); process.exit(1); });
