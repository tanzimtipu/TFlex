// Attack group 2: TIFF containers. One case per process so a main-process hang
// cannot contaminate the others. Run: node a2-one.cjs <case> [timeoutMs]
'use strict';
const { execSync } = require('node:child_process');
const { launch, convertOne, pageSizes, usable, fix, out } = require('./lib-adv.cjs');

async function forceKill(app) {
  try {
    const proc = app.process();
    if (!proc || !proc.pid) return 'no pid';
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 });
    } else {
      proc.kill('SIGKILL');
    }
    return 'killed';
  } catch (e) {
    return 'kill-failed: ' + e.message;
  }
}

(async () => {
  const caseName = process.argv[2];
  const timeoutMs = Number(process.argv[3] || 120000);
  const { app, win } = await launch();
  let memBefore = null;
  try {
    memBefore = await app.evaluate(() => process.memoryUsage().rss);
  } catch {}
  let finished = false;
  try {
    const docId = `adv-a2-${caseName}`;
    const t0 = Date.now();
    const conv = await convertOne(win, docId, fix(caseName), { timeoutMs });
    const brief = {
      file: caseName,
      ms: conv.ms,
      timedOut: conv.__timedOut === true,
      throw: conv.throw,
      ok: conv.result ? conv.result.ok : undefined,
      error: conv.result && !conv.result.ok ? conv.result.error : undefined,
      pageCount: conv.result && conv.result.ok ? conv.result.value.pageCount : undefined,
      fidelity: conv.result && conv.result.ok ? conv.result.value.fidelity : undefined,
      warnings:
        conv.result && conv.result.ok
          ? (conv.result.value.warnings || []).map((w) => ({ code: w.code, message: w.message.slice(0, 120) }))
          : undefined,
      memBeforeMb: memBefore ? Math.round(memBefore / 1048576) : null,
    };
    if (conv.result && conv.result.ok && conv.result.value.pageCount <= 5) {
      const ps = await pageSizes(win, docId);
      brief.pages = ps.error ? { error: ps.error } : { count: ps.pageCount, sizes: ps.sizes };
    }
    const u = await usable(win);
    brief.usableAfter = u;
    out(brief);
    finished = true;
  } catch (e) {
    out({ file: caseName, phase: 'crash', error: String(e && e.stack ? e.stack : e) });
  } finally {
    if (finished) {
      await require('./lib-adv.cjs').close({ app }, 'a2-' + caseName);
    } else {
      const k = await forceKill(app);
      out({ file: caseName, phase: 'hung-force-killed', kill: k });
    }
  }
})();
