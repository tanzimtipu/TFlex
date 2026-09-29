// Attack group 1: page-size/DPI arithmetic + container sniffing via the real
// conversion bridge. Run: node test-fixtures/adv-p54/a1-images.cjs
'use strict';
const path = require('node:path');
const { launch, close, convertOne, pageSizes, usable, fix, out } = require('./lib-adv.cjs');

const PDF_MAX_PT = 14400; // ISO 32000 / Acrobat page limit (200 in)

(async () => {
  const { app, win } = await launch();
  try {
    const cases = [
      ['png-phys-zero.png'],
      ['png-phys-max.png'],
      ['png-1x1-100000dpi.png'],
      ['png-2000-1dpi.png'],
      ['jpg-jfif-unit0.jpg'],
      ['jpg-jfif-density0.jpg'],
      ['pdf-as-png.png'],
      ['tiff-as-png.png'],
      ['png-as-tiff.tiff'],
      ['text-as-png.png'],
      ['random-bin-as-jpg.jpg'],
      ['does-not-exist.png'],
      ['.'],
    ];
    let n = 0;
    for (const [name] of cases) {
      n += 1;
      const docId = `adv-a1-${n}`;
      const conv = await convertOne(win, docId, fix(name), { timeoutMs: 90000 });
      const brief = {
        file: name,
        ms: conv.ms,
        timedOut: conv.__timedOut === true,
        throw: conv.throw,
        ok: conv.result ? conv.result.ok : undefined,
        error: conv.result && !conv.result.ok ? conv.result.error : undefined,
        warnings:
          conv.result && conv.result.ok
            ? (conv.result.value.warnings || []).map((w) => ({ code: w.code, message: w.message }))
            : undefined,
      };
      if (conv.result && conv.result.ok) {
        const ps = await pageSizes(win, docId);
        brief.pages = ps.error ? { error: ps.error } : { count: ps.pageCount, sizes: ps.sizes };
        if (!ps.error && ps.sizes && ps.sizes.length > 0) {
          brief.exceedsPdfLimit = ps.sizes.some((s) => s.width > PDF_MAX_PT || s.height > PDF_MAX_PT);
          brief.degenerate = ps.sizes.some((s) => s.width < 1 || s.height < 1);
        }
      }
      out(brief);
    }
    const u = await usable(win);
    out({ phase: 'usability-after-a1', usable: u });
  } catch (e) {
    out({ phase: 'a1-crash', error: String(e && e.stack ? e.stack : e) });
  } finally {
    await close({ app }, 'a1-images');
  }
})();
