// ADV P30 attack 2: hidden-window lifecycle. Reproduce the printJob hang when
// deviceName is absent / empty / non-string, and count windows + window events.
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));

(async () => {
  const app = await launchApp();
  let windowEvents = 0;
  app.on('window', () => { windowEvents += 1; });
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  const count = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const titles = () => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({ destroyed: w.isDestroyed(), visible: w.isVisible(), url: w.webContents.getURL().slice(0, 40) })));

  console.log('BASE_WINDOWS', await count(), 'windowEvents', windowEvents);

  const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  async function tryCall(label, payload, timeoutMs) {
    const t0 = Date.now();
    const r = await win.evaluate(async ({ p, ms }) => {
      return Promise.race([
        window.tflex.printJob(p).then((res) => ({ settled: true, result: res })).catch((e) => ({ settled: true, threw: String((e && e.message) || e) })),
        new Promise((res) => setTimeout(() => res({ settled: false, result: 'TIMEOUT' }), ms)),
      ]);
    }, { p: payload, ms: timeoutMs });
    const c = await count();
    console.log(`CALL ${label} ms=${Date.now() - t0} windows=${c} events=${windowEvents} -> ${JSON.stringify(r)}`);
    return r;
  }

  // 1. omitted settings -> default device, silent; documented as the virtual path.
  await tryCall('settings:{deviceName:""}', { images: [IMG], settings: { deviceName: '' } }, 8000);
  await win.waitForTimeout(3000);
  console.log('AFTER_3s windows', await count(), 'events', windowEvents);

  // 2. omitted entirely
  await tryCall('no settings key', { images: [IMG] }, 8000);
  // 3. non-string deviceName
  await tryCall('deviceName:12345', { images: [IMG], settings: { deviceName: 12345 } }, 8000);
  // 4. repeat to show unbounded growth
  await tryCall('deviceName:"" again', { images: [IMG], settings: { deviceName: '' } }, 6000);
  await tryCall('no settings again', { images: [IMG] }, 6000);

  await win.waitForTimeout(3000);
  console.log('FINAL windows', await count(), 'events', windowEvents);
  console.log('WINDOW_STATES', JSON.stringify(await titles()));

  await hardClose(app, 'adv-p30-leak');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });