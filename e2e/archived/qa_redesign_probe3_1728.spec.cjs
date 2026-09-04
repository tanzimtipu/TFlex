// qa probe 3: engine-level truth for fill/signature modified flags, and About
// dialog with a document open (DEF-074 conditions).
const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');

test.describe('QA redesign probe 3', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('engine truth: fill + signature modified flags', async () => {
    test.setTimeout(120000);
    const formPath = getSamplePath('form.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, formPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    await window.waitForTimeout(1500);

    const eng = await window.evaluate(async () => {
      const diag = window.tflexDiagnostics();
      const id = diag.engineDocId;
      const fieldsRes = await window.tflex.engine.getFormFields(id);
      const fields = fieldsRes.value || fieldsRes;
      await window.tflex.engine.fillFormField(id, { id: fields[0].id, value: 'QA Value' });
      await new Promise(r => setTimeout(r, 500));
      const st = await window.tflex.engine.getState(id);
      const s = st.value || st;
      return {
        engineModified: s.modified,
        diagModified: window.tflexDiagnostics().modified,
        fieldsCount: fields.length,
        stateKeys: Object.keys(s).slice(0, 25),
        formValues: s.form ? (s.form.fields ? s.form.fields.slice(0, 3).map(f => `${f.id}=${f.value}`) : Object.keys(s.form)) : null,
      };
    });
    console.log('ENGINE-TRUTH-FILL:', JSON.stringify(eng, null, 1));

    // signature on a fresh report.pdf
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    await window.waitForTimeout(1500);

    const sig = await window.evaluate(async () => {
      const diag = window.tflexDiagnostics();
      const id = diag.engineDocId;
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xDE, 0, 0, 0, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F, 0, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0x44, 0x74, 0x8E, 0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
      let err = null;
      try {
        await window.tflex.engine.placeSignature(id, {
          id: `sig-${Date.now()}`,
          signatureId: 'default',
          page: 1,
          rect: { x: 100, y: 100, width: 100, height: 50 },
          pngBytes: pngBytes.buffer
        });
      } catch (e) { err = String(e); }
      await new Promise(r => setTimeout(r, 500));
      const st = await window.tflex.engine.getState(id);
      const s = st.value || st;
      return { err, engineModified: s.modified, sigs: (s.signatures || []).length, diagModified: window.tflexDiagnostics().modified, diagSigs: ((window.tflexDiagnostics().engineState || {}).signatures || []).length };
    });
    console.log('ENGINE-TRUTH-SIG:', JSON.stringify(sig, null, 1));
  });

  test('About dialog with document open', async () => {
    test.setTimeout(120000);
    await window.waitForSelector('.app', { timeout: 15000 });
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');
    await window.waitForTimeout(1000);

    await electronApp.evaluate(({ Menu }) => {
      const m = Menu.getApplicationMenu();
      const help = m.items.find(i => (i.label || '').replace('&', '').includes('Help'));
      const about = help.submenu.items.find(i => (i.label || '').replace('&', '').includes('About'));
      about.click();
    });
    await window.waitForTimeout(1500);
    const aboutOpen = await window.evaluate(() => ({
      dlg: !!document.querySelector('[data-about-dialog]'),
      visible: (() => { const el = document.querySelector('[data-about-dialog]'); return el ? !!el.offsetParent : false; })(),
      version: (() => { const el = document.querySelector('[data-about-version]'); return el ? el.textContent : null; })(),
    }));
    console.log('ABOUT-WITH-DOC:', JSON.stringify(aboutOpen));
  });
});