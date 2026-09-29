// Attack group 4b: ~200MB decoded content stream validated against PDF/X-1a.
// Isolated. Run: node a4b-big.cjs
'use strict';
const { launch, close, validateBytes, fix, out } = require('./lib-adv.cjs');

(async () => {
  const { app, win } = await launch();
  try {
    const before = await app.evaluate(() => process.memoryUsage().rss).catch(() => null);
    out({ phase: 'before', rssMb: before ? Math.round(before / 1048576) : null });
    const v = await validateBytes(win, fix('val-bigcontent.pdf'), 'pdfx-1a', 240000);
    const r = v.result;
    // The main process is blocked while collectDocumentFacts runs the synchronous
    // scan; try to read RSS once it settles.
    let after = null;
    try {
      after = await app.evaluate(() => process.memoryUsage().rss);
    } catch (e) {
      after = 'unavailable: ' + e.message.slice(0, 80);
    }
    out({
      file: 'val-bigcontent.pdf',
      target: 'pdfx-1a',
      ms: v.ms,
      timedOut: v.__timedOut === true,
      throw: v.throw ? v.throw.slice(0, 200) : undefined,
      ok: r ? r.ok : undefined,
      error: r && !r.ok ? r.error : undefined,
      conforms: r && r.ok ? r.value.conforms : undefined,
      violations: r && r.ok ? r.value.violations.map((x) => x.rule) : undefined,
      rssAfterMb: typeof after === 'number' ? Math.round(after / 1048576) : after,
    });
  } catch (e) {
    out({ phase: 'a4b-crash', error: String(e && e.stack ? e.stack : e).slice(0, 400) });
  } finally {
    await close({ app }, 'a4b-big');
  }
})();
