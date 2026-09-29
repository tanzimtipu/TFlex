// Probe: does a CONFORMING PDF carrying a bogus pdfaid declaration still report
// conforms=true under a mismatched target? Run: node a4c-bogusid.cjs
'use strict';
const fs = require('node:fs');
const { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } = require('@cantoo/pdf-lib');
const { launch, close, validateBytes, fix, out } = require('./lib-adv.cjs');

async function patchTheXmp() {
  const src = fs.readFileSync(fix('val-pdfa-conforming-bogusid.pdf'));
  const doc = await PDFDocument.load(src, { updateMetadata: false, ignoreEncryption: true });
  const meta = doc.context.lookupMaybe(doc.catalog.get(PDFName.of('Metadata')), require('@cantoo/pdf-lib').PDFStream);
  if (meta === undefined) throw new Error('no Metadata stream');
  const raw = PDFRawStream.of(meta.dict, meta.getContents(), meta instanceof PDFRawStream ? meta.transform : undefined);
  let text = Buffer.from(decodePDFRawStream(raw).decode()).toString('utf8');
  const before = text;
  text = text.replace(/(<pdfaid:part>)\s*1\s*(<\/pdfaid:part>)/, '$19$2');
  text = text.replace(/(<pdfaid:conformance>)\s*B\s*(<\/pdfaid:conformance>)/, '$1Z$2');
  if (text === before) throw new Error('XMP patch did not match');
  const newStream = doc.context.flateStream(text, { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(newStream));
  fs.writeFileSync(fix('val-pdfa-conforming-bogusid.pdf'), await doc.save());
  return { patched: true, xmpHead: text.slice(0, 80) };
}

(async () => {
  // Build the patched conforming fixture from the known-conforming one.
  fs.copyFileSync(fix('val-oi-null.pdf'), fix('val-pdfa-conforming-bogusid.pdf')); // placeholder overwritten below
  fs.copyFileSync(require('node:path').join(fix('.'), '..', 'phase54', 'pdfa-1b-ok.pdf'), fix('val-pdfa-conforming-bogusid.pdf'));
  try {
    out({ phase: 'patch', ...(await patchTheXmp()) });
  } catch (e) {
    out({ phase: 'patch-failed', error: e.message });
  }
  const { app, win } = await launch();
  try {
    for (const target of ['pdfa-1b', 'pdfa-2b']) {
      const v = await validateBytes(win, fix('val-pdfa-conforming-bogusid.pdf'), target, 60000);
      const r = v.result;
      out({
        file: 'val-pdfa-conforming-bogusid.pdf',
        target,
        ok: r ? r.ok : undefined,
        declared: r && r.ok ? r.value.declared : undefined,
        conforms: r && r.ok ? r.value.conforms : undefined,
        violations: r && r.ok ? r.value.violations.map((x) => x.rule) : undefined,
        error: r && !r.ok ? r.error : undefined,
      });
    }
    // Also confirm the unpatched fixture still conforms (control).
    const c = await validateBytes(win, fix('..') + '/phase54/pdfa-1b-ok.pdf', 'pdfa-1b', 60000);
    out({ file: 'phase54/pdfa-1b-ok.pdf', target: 'pdfa-1b', declared: c.result && c.result.ok ? c.result.value.declared : undefined, conforms: c.result && c.result.ok ? c.result.value.conforms : undefined });
  } catch (e) {
    out({ phase: 'a4c-crash', error: String(e && e.stack ? e.stack : e).slice(0, 300) });
  } finally {
    await close({ app }, 'a4c');
  }
})();
