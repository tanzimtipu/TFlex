// Attack group 3: SVG. Runs the listed fixtures in one fresh app.
// Run: node a3-svg.cjs <timeoutMs> <file> [file...]
'use strict';
const { launch, close, convertOne, pageSizes, usable, fix, out, withDeadline } = require('./lib-adv.cjs');

(async () => {
  const timeoutMs = Number(process.argv[2] || 90000);
  const files = process.argv.slice(3);
  const { app, win } = await launch();
  try {
    let n = 0;
    for (const name of files) {
      n += 1;
      const docId = `adv-a3-${n}`;
      const conv = await convertOne(win, docId, fix(name), { timeoutMs });
      const brief = {
        file: name,
        ms: conv.ms,
        timedOut: conv.__timedOut === true,
        throw: conv.throw ? conv.throw.slice(0, 200) : undefined,
        ok: conv.result ? conv.result.ok : undefined,
        error: conv.result && !conv.result.ok ? conv.result.error : undefined,
        fidelity: conv.result && conv.result.ok ? conv.result.value.fidelity : undefined,
        warnings:
          conv.result && conv.result.ok
            ? (conv.result.value.warnings || []).map((w) => ({ code: w.code, message: w.message.slice(0, 160) }))
            : undefined,
      };
      if (conv.result && conv.result.ok && conv.result.value.pageCount <= 3) {
        const ps = await pageSizes(win, docId);
        brief.pages = ps.error ? { error: ps.error } : { count: ps.pageCount, sizes: ps.sizes };
      } else if (conv.result && conv.result.ok) {
        brief.pageCount = conv.result.value.pageCount;
      }
      out(brief);
      // Recover if a case left the window wedged.
      const u = await usable(win);
      if (u !== true) out({ file: name, phase: 'not-usable-after', u });
    }
  } catch (e) {
    out({ phase: 'a3-crash', error: String(e && e.stack ? e.stack : e).slice(0, 400) });
  } finally {
    await close({ app }, 'a3-svg');
  }
})();
