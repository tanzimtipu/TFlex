// DEF-166 browser witness: render the saved round-trip file with plain pdf.js
// in a REAL Chromium (OffscreenCanvas available - FreeText appearances paint),
// then crop the textbox/callout regions. If the text doubles HERE, the doubling
// comes from the file + pdf.js generation (third-party visible); if single,
// TFlex's own reopened tab adds a second paint.
const { chromium } = require('playwright');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const PROJ = path.resolve(__dirname, '..', '..');
const PDF = path.resolve(PROJ, 'test-fixtures', 'annot-text-roundtrip-1727.pdf');
const PDFJS = path.resolve(PROJ, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
const WORKER = path.resolve(PROJ, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');
const FONTS = path.resolve(PROJ, 'node_modules', 'pdfjs-dist', 'standard_fonts');
const OUT = path.resolve(PROJ, 'screenshots');

const MIME = { '.pdf': 'application/pdf', '.mjs': 'text/javascript', '.pfb': 'application/octet-stream', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http_create((req, resp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      let file = p.startsWith('/fonts/') ? path.join(FONTS, p.slice(7)) : p === '/doc.pdf' ? PDF : p === '/pdf.mjs' ? PDFJS : p === '/pdf.worker.mjs' ? WORKER : null;
      if (!file || !fs.existsSync(file)) { resp.statusCode = 404; resp.end('nf'); return; }
      resp.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
      fs.createReadStream(file).pipe(resp);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
function http_create(handler) { return require('node:http').createServer(handler); }

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('console', (m) => { const t = m.text(); if (!t.includes('Warning: FreeText')) process.stdout.write(`[PAGE] ${t}\n`); });
  page.on('pageerror', (e) => process.stdout.write(`[PAGEERROR] ${e.message}\n`));
  await page.goto(`http://127.0.0.1:${port}/`);
  const res = await page.evaluate(async () => {
    const pdfjs = await import('/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
    const data = new Uint8Array(await (await fetch('/doc.pdf')).arrayBuffer());
    const doc = await pdfjs.getDocument({ data, standardFontDataUrl: '/fonts/' }).promise;
    const p = await doc.getPage(4);
    const vp = p.getViewport({ scale: 2 });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d');
    await p.render({ canvasContext: ctx, viewport: vp }).promise;
    const dataUrl = c.toDataURL('image/png');
    const anns = await p.getAnnotations();
    return { dataUrl, anns: anns.map((a) => ({ subtype: a.subtype, rect: a.rect, it: a.intent || null })) };
  });
  process.stdout.write(`[ANN] ${JSON.stringify(res.anns)}\n`);
  const buf = Buffer.from(res.dataUrl.split(',')[1], 'base64');
  fs.writeFileSync(path.join(OUT, 'def-166-chromium-saved-p4.png'), buf);
  await browser.close();
  srv.close();
  console.log('[OK] chromium render written');
})().catch((e) => { console.error(e); process.exit(1); });
