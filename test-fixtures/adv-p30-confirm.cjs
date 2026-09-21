// ADV P30 confirm: a single no-deviceName printJob, observed for 90 s.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  await win.evaluate(({ img }) => {
    window.__advSettled = null;
    window.__advStart = Date.now();
    window.tflex.printJob({ images: [img], settings: { deviceName: '' } })
      .then((r) => { window.__advSettled = { ok: r.ok, reason: r.reason, ms: Date.now() - window.__advStart }; })
      .catch((e) => { window.__advSettled = { threw: String(e && e.message || e), ms: Date.now() - window.__advStart }; });
  }, { img: IMG });

  for (const t of [10000, 30000, 60000, 90000]) {
    await new Promise((r) => setTimeout(r, t === 10000 ? 10000 : t === 30000 ? 20000 : t === 60000 ? 30000 : 30000));
    const settled = await win.evaluate(() => window.__advSettled);
    const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    console.log(`T+${t}ms settled=${JSON.stringify(settled)} windows=${wins}`);
  }
  await hardClose(app, 'adv-p30-confirm');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });