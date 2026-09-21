// ADV P30 attack 5: payload-size extremes through the real IPC printJob.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const count = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  console.log('BASE_WINDOWS', await count());

  const cases = [
    { name: '500 images', build: "(() => { const IMG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; return { images: Array(500).fill(IMG), settings: { deviceName: '__adv_no_such_printer_92__' } }; })()" },
    { name: '5000 images', build: "(() => { const IMG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; return { images: Array(5000).fill(IMG), settings: { deviceName: '__adv_no_such_printer_92__' } }; })()" },
    { name: 'one 10MB image', build: "(() => ({ images: ['data:image/png;base64,' + 'A'.repeat(10*1024*1024)], settings: { deviceName: '__adv_no_such_printer_92__' } }))()" },
    { name: 'one 40MB image', build: "(() => ({ images: ['data:image/png;base64,' + 'A'.repeat(40*1024*1024)], settings: { deviceName: '__adv_no_such_printer_92__' } }))()" },
  ];

  for (const c of cases) {
    const t0 = Date.now();
    let r;
    try {
      r = await win.evaluate(async ({ src, ms }) => {
        // eslint-disable-next-line no-eval
        const payload = eval(src);
        return Promise.race([
          window.tflex.printJob(payload).then((res) => ({ settled: true, result: res })).catch((e) => ({ settled: true, threw: String((e && e.message) || e) })),
          new Promise((res) => setTimeout(() => res({ settled: false, result: 'TIMEOUT' }), ms)),
        ]);
      }, { src: c.build, ms: 30000 });
    } catch (e) {
      r = { settleError: String(e.message || e) };
    }
    console.log(`SIZE ${c.name}: ms=${Date.now() - t0} windows=${await count()} -> ${JSON.stringify(r)}`);
  }

  await win.waitForTimeout(1000);
  console.log('FINAL_WINDOWS', await count());
  await hardClose(app, 'adv-p30-size');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });