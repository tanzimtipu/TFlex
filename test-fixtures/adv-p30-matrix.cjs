// ADV P30 attack 1: hostile IPC payload matrix through window.tflex.printJob.
// Every case that passes validation uses an explicitly NON-EXISTENT device so
// nothing reaches a real printer. deviceName:'' and omitted are the deliberate
// exception (they target the system default, which on this box is the virtual
// Microsoft Print to PDF - no paper).
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));

const TIMEOUT_MS = 20000;

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  console.log('WINDOWS_BEFORE', before);

  const results = await win.evaluate(async ({ timeoutMs }) => {
    const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const BAD = '__adv_no_such_printer_92__';
    const call = (payload) => {
      const started = Date.now();
      const promise = Promise.resolve()
        .then(() => window.tflex.printJob(payload))
        .then((r) => ({ settled: true, result: r }))
        .catch((e) => ({ settled: true, threw: String((e && e.message) || e) }));
      return Promise.race([
        promise,
        new Promise((res) => setTimeout(() => res({ settled: false, result: 'TIMEOUT' }), timeoutMs)),
      ]).then((out) => ({ ...out, ms: Date.now() - started }));
    };

    const cases = [];
    const add = (name, payload, deviceNote) => cases.push({ name, payload, deviceNote });

    // --- validation rejections ------------------------------------------
    add('images:[]', { images: [], settings: {} });
    add('images:"x" (not array)', { images: 'x', settings: {} });
    add('images:[null]', { images: [null], settings: {} });
    add('images:[""]', { images: [''], settings: {} });
    add('images:[42]', { images: [42], settings: {} });
    add('copies:0', { images: [IMG], settings: { copies: 0 } });
    add('copies:-1', { images: [IMG], settings: { copies: -1 } });
    add('copies:1e9', { images: [IMG], settings: { copies: 1e9 } });
    add('copies:NaN (in-page)', { images: [IMG], settings: { copies: Number.NaN } });
    add('copies:"3" string', { images: [IMG], settings: { copies: '3' } });
    add('copies:1.5', { images: [IMG], settings: { copies: 1.5 } });
    add('pagesPerSheet:0', { images: [IMG], settings: { pagesPerSheet: 0 } });
    add('pagesPerSheet:3', { images: [IMG], settings: { pagesPerSheet: 3 } });
    add('pagesPerSheet:5', { images: [IMG], settings: { pagesPerSheet: 5 } });
    add('pagesPerSheet:17', { images: [IMG], settings: { pagesPerSheet: 17 } });
    add('pagesPerSheet:"4" string', { images: [IMG], settings: { pagesPerSheet: '4' } });
    add('scalePercent:0', { images: [IMG], settings: { scalePercent: 0 } });
    add('scalePercent:9999', { images: [IMG], settings: { scalePercent: 9999 } });
    add('scalePercent:NaN', { images: [IMG], settings: { scalePercent: Number.NaN } });
    add('pageRanges:[-5..1e9]', { images: [IMG], settings: { pageRanges: [{ from: -5, to: 1e9 }] } });
    add('pageRanges:reversed', { images: [IMG], settings: { pageRanges: [{ from: 5, to: 2 }] } });
    add('pageRanges:"x"', { images: [IMG], settings: { pageRanges: 'x' } });
    add('pageRanges:[null]', { images: [IMG], settings: { pageRanges: [null] } });
    add('payload:null', null);
    add('payload:"str"', 'str');

    // --- pass-through / type-hostile, aimed at bogus device --------------
    add('image non-data-URL string', { images: ['not-a-data-url'], settings: { deviceName: BAD } }, BAD);
    add('valid IMG baseline -> bogus device', { images: [IMG], settings: { deviceName: BAD } }, BAD);
    add('deviceName control chars', { images: [IMG], settings: { deviceName: 'bad\u0000name\u0007' } }, 'control');
    add('deviceName unicode', { images: [IMG], settings: { deviceName: '\u6253\u5370\uD83D\uDE00' } }, 'unicode');
    add('deviceName number 12345', { images: [IMG], settings: { deviceName: 12345 } }, 'number');
    add('oddEven:"banana"', { images: [IMG], settings: { deviceName: BAD, oddEven: 'banana' } }, BAD);
    add('duplex:"diagonal"', { images: [IMG], settings: { deviceName: BAD, duplex: 'diagonal' } }, BAD);
    add('scaling:"wat"', { images: [IMG], settings: { deviceName: BAD, scaling: 'wat' } }, BAD);
    add('landscape:"yes" string', { images: [IMG], settings: { deviceName: BAD, landscape: 'yes' } }, BAD);
    add('pageOrder:"weird"', { images: [IMG], settings: { deviceName: BAD, pageOrder: 'weird' } }, BAD);
    add('settings:null', { images: [IMG], settings: null }, 'null-settings');
    add('settings omitted', { images: [IMG] }, 'omitted');
    add('deviceName:"" (silent default)', { images: [IMG], settings: { deviceName: '' } }, 'DEFAULT-VIRTUAL');

    const out = [];
    for (const c of cases) {
      const r = await call(c.payload);
      out.push({ name: c.name, deviceNote: c.deviceNote || '', ...r });
    }
    return out;
  }, { timeoutMs: TIMEOUT_MS });

  for (const r of results) {
    console.log('CASE', JSON.stringify(r));
  }

  await win.waitForTimeout(1500);
  const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  console.log('WINDOWS_AFTER', after);

  await hardClose(app, 'adv-p30-matrix');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });