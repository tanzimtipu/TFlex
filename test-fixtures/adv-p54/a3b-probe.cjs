// SVG engine-fallback probes: entity expansion, external-entity file read,
// remote fetch, and the 20000x20000 filter+mask fallback. Isolated.
// Run: node a3b-probe.cjs
'use strict';
const { launch, close, convertOne, pageSizes, usable, fix, out } = require('./lib-adv.cjs');

async function rawBytes(win, docId) {
  const res = await win.evaluate(async (id) => {
    const r = await window.tflex.engine.getDocumentBytes(id);
    if (!r || !r.ok) return { error: r ? r.error : 'no result' };
    const bytes = new Uint8Array(r.value);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return { b64: btoa(bin) };
  }, docId);
  if (res.error) throw new Error(res.error);
  return Buffer.from(res.b64, 'base64');
}

(async () => {
  const { app, win } = await launch();
  try {
    // External entity: does the produced PDF contain win.ini content?
    {
      const conv = await convertOne(win, 'adv-xxe', fix('svg-external-entity.svg'), { timeoutMs: 150000 });
      let verdict = 'no-pdf';
      if (conv.result && conv.result.ok) {
        const bytes = await rawBytes(win, 'adv-xxe');
        const text = bytes.toString('latin1');
        verdict = {
          pdfBytes: bytes.length,
          containsWinIniContent: /\[fonts\]|for 16-bit app support|MAPI=1/i.test(text),
          containsInvalidDomain: text.includes('example.invalid'),
        };
      }
      out({ file: 'svg-external-entity.svg', ok: conv.result && conv.result.ok, ms: conv.ms, warnings: conv.result && conv.result.ok ? (conv.result.value.warnings || []).map((w) => w.code) : undefined, verdict });
    }
    // Billion laughs: expanded text would be astronomically large.
    {
      const conv = await convertOne(win, 'adv-blaugh', fix('svg-billion-laughs.svg'), { timeoutMs: 150000 });
      let verdict = 'no-pdf';
      if (conv.result && conv.result.ok) {
        const bytes = await rawBytes(win, 'adv-blaugh');
        verdict = { pdfBytes: bytes.length, containsLolRun: /lol(lol){20,}/.test(bytes.toString('latin1')) };
      }
      out({ file: 'svg-billion-laughs.svg', ok: conv.result && conv.result.ok, ms: conv.ms, warnings: conv.result && conv.result.ok ? (conv.result.value.warnings || []).map((w) => w.code) : undefined, verdict });
    }
    // 20000x20000 filter+mask engine fallback.
    {
      const conv = await convertOne(win, 'adv-fm20k', fix('svg-filter-mask-20000.svg'), { timeoutMs: 180000 });
      const brief = {
        file: 'svg-filter-mask-20000.svg',
        ms: conv.ms,
        timedOut: conv.__timedOut === true,
        throw: conv.throw ? conv.throw.slice(0, 200) : undefined,
        ok: conv.result && conv.result.ok,
        error: conv.result && !conv.result.ok ? conv.result.error : undefined,
        warnings: conv.result && conv.result.ok ? (conv.result.value.warnings || []).map((w) => w.code) : undefined,
      };
      if (conv.result && conv.result.ok) {
        const ps = await pageSizes(win, 'adv-fm20k');
        brief.pages = ps.error ? { error: ps.error } : { count: ps.pageCount, sizes: ps.sizes };
      }
      out(brief);
    }
    out({ phase: 'usable', u: await usable(win) });
  } catch (e) {
    out({ phase: 'a3b-crash', error: String(e && e.stack ? e.stack : e).slice(0, 300) });
  } finally {
    await close({ app }, 'a3b');
  }
})();
