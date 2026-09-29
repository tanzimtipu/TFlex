// Attack group 4d: sweep decoded content-stream size to find where the
// synchronous validation scan blocks vs dies. Run: node a4d-bigsteps.cjs
'use strict';
const fs = require('node:fs');
const { PDFDocument, PDFName } = require('@cantoo/pdf-lib');
const { launch, close, validateBytes, fix, out } = require('./lib-adv.cjs');

async function makeBig(decodedMb) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const pattern = '0 0 0 0 k\n';
  const reps = Math.ceil((decodedMb * 1024 * 1024) / pattern.length);
  const stream = doc.context.flateStream(pattern.repeat(reps));
  page.node.set(PDFName.of('Contents'), doc.context.register(stream));
  const bytes = Buffer.from(await doc.save());
  const p = fix(`val-bigcontent-${decodedMb}mb.pdf`);
  fs.writeFileSync(p, bytes);
  return { p, fileBytes: bytes.length, decodedBytes: reps * pattern.length };
}

(async () => {
  const sizes = [25, 50, 100];
  for (const mb of sizes) {
    const m = await makeBig(mb);
    out({ phase: 'generated', mb, fileBytes: m.fileBytes, decodedBytes: m.decodedBytes });
  }
  const { app, win } = await launch();
  try {
    for (const mb of sizes) {
      const v = await validateBytes(win, fix(`val-bigcontent-${mb}mb.pdf`), 'pdfx-1a', 200000);
      const r = v.result;
      out({
        mb,
        ms: v.ms,
        timedOut: v.__timedOut === true,
        throw: v.throw ? v.throw.slice(0, 120) : undefined,
        ok: r ? r.ok : undefined,
        error: r && !r.ok ? r.error : undefined,
        conforms: r && r.ok ? r.value.conforms : undefined,
      });
      if (v.throw || v.__timedOut) break; // app gone
    }
  } catch (e) {
    out({ phase: 'a4d-crash', error: String(e && e.message ? e.message : e).slice(0, 300) });
  } finally {
    await close({ app }, 'a4d');
  }
})();
