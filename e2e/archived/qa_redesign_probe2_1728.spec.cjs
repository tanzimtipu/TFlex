// qa probe 2: mirror DEF-069 (forms), DEF-075 (signature), and the native-menu
// question behind DEF-074, reading live diagnostics at each step.
const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');

test.describe('QA redesign probe 2', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('DEF-069 forms flow', async () => {
    test.setTimeout(120000);
    const formPath = getSamplePath('form.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, formPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');

    for (let i = 0; i < 10; i++) {
      const d = await window.evaluate(() => window.tflexDiagnostics());
      console.log(`FORMS t+${i}s:`, JSON.stringify({ formFieldsLoaded: d.formFieldsLoaded, modified: d.modified, pageCount: d.pageCount, keys: Object.keys(d).sort().join(',') }));
      if (d.formFieldsLoaded) break;
      await window.waitForTimeout(1000);
    }

    // fill via engine and watch modified
    const fillRes = await window.evaluate(async () => {
      const diag = window.tflexDiagnostics();
      const id = diag.engineDocId;
      const res = await window.tflex.engine.getFormFields(id);
      const fields = res.value || res;
      if (fields && fields.length > 0) {
        await window.tflex.engine.fillFormField(id, { id: fields[0].id, value: 'QA Value' });
        return 'filled ' + fields[0].id;
      }
      return 'no fields; res=' + JSON.stringify(res).slice(0, 120);
    });
    console.log('FILL:', fillRes);
    for (let i = 0; i < 8; i++) {
      const d = await window.evaluate(() => window.tflexDiagnostics());
      if (d.modified === true) { console.log(`MODIFIED t+${i}s: true`); break; }
      await window.waitForTimeout(1000);
    }
    const dFinal = await window.evaluate(() => window.tflexDiagnostics());
    console.log('MODIFIED-FINAL:', dFinal.modified);
  });

  test('DEF-075 signature flow', async () => {
    test.setTimeout(120000);
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    await window.waitForTimeout(1000);

    const sigRes = await window.evaluate(async () => {
      const diag = window.tflexDiagnostics();
      const id = diag.engineDocId;
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xDE, 0, 0, 0, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F, 0, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0x44, 0x74, 0x8E, 0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
      await window.tflex.engine.placeSignature(id, {
        id: `sig-${Date.now()}`,
        signatureId: 'default',
        page: 1,
        rect: { x: 100, y: 100, width: 100, height: 50 },
        pngBytes: pngBytes.buffer
      });
      return diag.engineDocId;
    });
    console.log('SIG-PLACED, docId:', sigRes);
    for (let i = 0; i < 8; i++) {
      const d = await window.evaluate(() => window.tflexDiagnostics());
      console.log(`SIGMOD t+${i}s: modified=${d.modified} sigs=${(d.engineState && d.engineState.signatures || []).length}`);
      if (d.modified === true) break;
      await window.waitForTimeout(1000);
    }
  });

  test('native menu + about surface', async () => {
    test.setTimeout(120000);
    await window.waitForSelector('.app', { timeout: 15000 });
    const menuInfo = await electronApp.evaluate(({ Menu }) => {
      const m = Menu.getApplicationMenu();
      if (!m) return { exists: false };
      const help = m.items.find(i => (i.label || '').replace('&', '').includes('Help'));
      const about = help && help.submenu ? help.submenu.items.find(i => (i.label || '').replace('&', '').includes('About')) : null;
      return { exists: true, helpFound: !!help, aboutFound: !!about, items: m.items.map(i => i.label) };
    });
    console.log('NATIVE-MENU:', JSON.stringify(menuInfo));

    // Open About via the custom Application menu button, walk the popup DOM
    await window.click('button:has-text("Application menu")');
    await window.waitForTimeout(600);
    const popup = await window.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('[role=menu], [class*=menu], [class*=popover], [class*=dropdown]'));
      return candidates.slice(0, 8).map(el => ({ cls: el.className, text: el.textContent.replace(/\s+/g, ' ').slice(0, 120) }));
    });
    console.log('APP-MENU-POPUP:', JSON.stringify(popup, null, 1));
  });
});
