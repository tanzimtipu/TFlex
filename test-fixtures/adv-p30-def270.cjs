// DEF-270 retest: the print payload validator must reject a non-data-URL
// string and an undecodable data URL with the typed reason `bad-image`
// BEFORE the engine is reached, while a real 1x1 PNG data URL still passes
// validation (it then fails at the deliberately bogus device - correct).
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const BAD = '__no_such__';
  const cases = [
    ['not-a-data-url', 'not-a-data-url'],
    ['undecodable png payload', 'data:image/png;base64,AAAA'],
    ['real 1x1 png (must pass validation)', IMG],
  ];

  for (const [name, img] of cases) {
    const t0 = Date.now();
    const r = await win.evaluate(async ({ i, d }) => {
      return Promise.race([
        window.tflex.printJob({ images: [i], settings: { deviceName: d } })
          .then((res) => ({ settled: true, result: res }))
          .catch((e) => ({ settled: true, threw: String((e && e.message) || e) })),
        new Promise((res) => setTimeout(() => res({ settled: false, result: 'TIMEOUT' }), 20000)),
      ]);
    }, { i: img, d: BAD });
    console.log(`DEF270 ${name} ms=${Date.now() - t0} -> ${JSON.stringify(r)}`);
  }

  await hardClose(app, 'adv-p30-def270');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });