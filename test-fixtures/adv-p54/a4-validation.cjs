// Attack group 4: XMP / PDF-A + PDF-X rule set. Run: node a4-validation.cjs
'use strict';
const { launch, close, validateBytes, usable, fix, out } = require('./lib-adv.cjs');

(async () => {
  const { app, win } = await launch();
  try {
    const cases = [
      ['val-pdfa-part9.pdf', 'pdfa-1b'],
      ['val-pdfa-part9.pdf', 'pdfa-3b'],
      ['val-pdfa-unknown-conf.pdf', 'pdfa-1b'],
      ['val-pdfa-1b-no-oi.pdf', 'pdfa-1b'],
      ['val-pdfa-truncated-xmp.pdf', 'pdfa-1b'],
      ['val-encrypt-pdfaid.pdf', 'pdfa-1b'],
      ['val-pdfx-part9.pdf', 'pdfx-1a'],
      ['val-oi-number.pdf', 'pdfa-1b'],
      ['val-oi-null.pdf', 'pdfa-1b'],
      ['val-oi-nested.pdf', 'pdfa-1b'],
      ['val-oi-array-of-numbers.pdf', 'pdfa-1b'],
    ];
    let n = 0;
    for (const [file, target] of cases) {
      n += 1;
      const v = await validateBytes(win, fix(file), target, 60000);
      const r = v.result;
      out({
        file,
        target,
        ms: v.ms,
        timedOut: v.__timedOut === true,
        throw: v.throw ? v.throw.slice(0, 160) : undefined,
        ok: r ? r.ok : undefined,
        error: r && !r.ok ? r.error : undefined,
        declared: r && r.ok ? r.value.declared : undefined,
        conforms: r && r.ok ? r.value.conforms : undefined,
        violations:
          r && r.ok
            ? r.value.violations.map((x) => ({ rule: x.rule, severity: x.severity, detail: x.detail.slice(0, 130) }))
            : undefined,
      });
    }
    out({ phase: 'usable', u: await usable(win) });
  } catch (e) {
    out({ phase: 'a4-crash', error: String(e && e.stack ? e.stack : e).slice(0, 300) });
  } finally {
    await close({ app }, 'a4-validation');
  }
})();
