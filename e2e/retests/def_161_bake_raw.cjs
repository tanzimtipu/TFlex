// One-off diagnostic: dump the RAW /Annots dicts of page 4 of a saved PDF
// (pdf-lib low-level objects), so we can see exactly what the engine wrote
// for the callout (AP stream, DA, contents, rect, etc).
const fs = require('node:fs');
const { PDFDocument, PDFName, PDFRawStream, PDFStream } = require('@cantoo/pdf-lib');

async function main() {
  const file = process.argv[2];
  const bytes = fs.readFileSync(file);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const ctx = doc.context;
  const page = doc.getPages()[3]; // page 4, 0-based
  const annotsRef = page.node.get(PDFName.of('Annots'));
  if (!annotsRef) { process.stdout.write('no /Annots on page 4\n'); return; }
  const annots = ctx.lookup(annotsRef);
  process.stdout.write(`annots=${annots.size()}\n`);
  for (let i = 0; i < annots.size(); i++) {
    const a = ctx.lookup(annots.get(i));
    const out = {};
    for (const [k, v] of a.entries()) {
      let s;
      try {
        if (v instanceof PDFName) s = v.asString();
        else if (typeof v.asString === 'function') s = v.asString();
        else if (typeof v.asNumber === 'function') s = v.asNumber();
        else if (v.constructor && v.constructor.name === 'PDFRef') s = `ref->${v.objectNumber}`;
        else if (v instanceof PDFRawStream || v instanceof PDFStream) s = `<stream ${v.contents ? v.contents.length : '?'} bytes>`;
        else if (typeof v.asArray === 'function') s = `[${v.asArray().map((x) => (typeof x.asNumber === 'function' ? x.asNumber() : (typeof x.asString === 'function' ? x.asString() : String(x)))).join(', ')}]`;
        else s = String(v);
      } catch (e) { s = `<err ${e.message}>`; }
      out[k.asString ? k.asString() : String(k)] = String(s).slice(0, 300);
    }
    process.stdout.write(`ann[${i}] ${JSON.stringify(out)}\n`);
    // dump the normal appearance stream's decoded content
    try {
      const apRef = a.get(PDFName.of('AP'));
      if (apRef) {
        const ap = ctx.lookup(apRef);
        const nRef = ap && ap.get ? ap.get(PDFName.of('N')) : null;
        if (nRef) {
          const n = ctx.lookup(nRef);
          if (n && n.contents) {
            const txt = Buffer.from(n.contents).toString('latin1');
            process.stdout.write(`ann[${i}] AP.N (${txt.length} bytes) >>> ${txt.replace(/\s+/g, ' ').slice(0, 800)}\n`);
          } else {
            process.stdout.write(`ann[${i}] AP.N present but no contents (${n && n.constructor.name})\n`);
          }
        }
      }
    } catch (e) { process.stdout.write(`ann[${i}] AP dump err ${e.message}\n`); }
  }
}
main().catch((e) => { process.stderr.write(`${e && e.stack || e}\n`); process.exit(1); });