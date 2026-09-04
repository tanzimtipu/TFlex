const { test } = require('@playwright/test');
const { launchDev, openSample, diag , hardClose } = require('./lib/helpers.cjs');

let electronApp = null;
let win = null;
test.beforeEach(async () => {
  ({ electronApp, window: win } = await launchDev());
});
test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null; win = null;
});
test.setTimeout(120000);

test('PROBE: does fillFormField change the value and mark modified?', async () => {
  await openSample(win, electronApp, 'form.pdf');
  const d0 = await diag(win);
  const fid = d0.formFields.find((f) => f.id.includes('address')) || d0.formFields[0];
  console.log(`[FF] target=${fid.id} before=${JSON.stringify(fid.value)}`);

  const res = await win.evaluate(({ engineDocId, fid }) => {
    const r = window.tflex.engine.fillFormField(engineDocId, fid, 'AUTOFILL VALUE');
    return { result: r, hasEngine: !!window.tflex.engine };
  }, { engineDocId: d0.engineDocId, fid: fid.id });
  console.log(`[FF] engine.fillFormField returned=${JSON.stringify(res)}`);
  await win.waitForTimeout(800);

  const d1 = await diag(win);
  const f = (d1.formFields || []).find((x) => x.id === fid.id);
  const d2 = await diag(win);
  console.log(`[FF] after fill modified=${d2.modified} fieldValue=${JSON.stringify(f && f.value)}`);
  // Try the renderer form overlay path too.
  const overlayFields = await win.evaluate(() => {
    const els = document.querySelectorAll('[data-form-field]');
    return Array.from(els).map((e) => ({ attr: e.getAttribute('data-form-field'), tag: e.tagName }));
  });
  console.log(`[FF] rendered form field overlay elements=${JSON.stringify(overlayFields)}`);
});
