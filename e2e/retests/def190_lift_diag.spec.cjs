// DEF-190 diagnostic: where does the lift attribute land, and does the
// editor's hit-test path depend on it? Read-only probe - files no defect.
const { test, expect } = require('@playwright/test');
const { launchDev, openSample, hardClose } = require('./../lib/helpers.cjs');

let electronApp = null;
let win = null;

test.beforeEach(async () => {
  ({ electronApp, window: win } = await launchDev());
  await openSample(win, electronApp, 'report.pdf');
  await win.waitForSelector('.page-slot[data-page="2"]', { timeout: 30000 });
  await win.waitForTimeout(1500);
});

test.afterEach(async () => {
  await hardClose(electronApp, 'diag190');
  electronApp = null;
  win = null;
});

test('DIAG: stamp editor lift wiring', async () => {
  test.setTimeout(240000);

  const scrolled = await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const canvas = document.querySelector('.pdf-page[data-page="1"] canvas');
    if (!sc || !canvas) return false;
    const c = canvas.getBoundingClientRect();
    sc.scrollTop += c.bottom - (window.innerHeight - 160);
    return true;
  });
  await win.waitForTimeout(1200);

  const geo = await win.evaluate(() => {
    const c = document.querySelector('.pdf-page[data-page="1"] canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height, vh: window.innerHeight };
  });
  const clickX = geo.x + geo.w * 0.6;
  const clickY = geo.y + geo.h - 100;

  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.click('[data-tool-id="stamp"]');
  await win.waitForSelector('[data-stamp-dialog]', { timeout: 8000 });
  await win.click('[data-stamp-confirm]');
  await win.waitForTimeout(500);
  await win.mouse.click(clickX, clickY);
  await win.waitForSelector('.stamp-annotation', { timeout: 8000 });
  await win.click('[data-tools-toggle]');
  await win.waitForTimeout(700);

  const afterSelect = await win.evaluate(() => {
    const pages = Array.from(document.querySelectorAll('.pdf-page[data-page="1"]')).map((p) => ({
      attr: p.getAttribute('data-stamp-editor-open'),
      z: getComputedStyle(p).zIndex,
      inSlot: !!p.closest('.page-slot'),
      hasStamp: !!p.querySelector('.stamp-annotation'),
    }));
    return { pages, stampCount: document.querySelectorAll('.stamp-annotation').length };
  });
  console.log('[DIAG] after stamp click: ' + JSON.stringify(afterSelect, null, 1));

  await win.locator('.stamp-annotation').first().click();
  await win.waitForTimeout(500);
  const afterSelect2 = await win.evaluate(() => {
    const pages = Array.from(document.querySelectorAll('.pdf-page[data-page="1"]')).map((p) => ({
      attr: p.getAttribute('data-stamp-editor-open'),
      z: getComputedStyle(p).zIndex,
      hasStamp: !!p.querySelector('.stamp-annotation'),
      hasActionBar: !!p.querySelector('[data-content-action="stamp-edit"]'),
    }));
    return { pages };
  });
  console.log('[DIAG] after selecting stamp: ' + JSON.stringify(afterSelect2, null, 1));

  await win.locator('[data-content-action="stamp-edit"]').first().click();
  await win.waitForSelector('[data-stamp-type-editor]', { timeout: 5000 });
  await win.waitForTimeout(500);
  const withEditor = await win.evaluate(() => {
    const pages = Array.from(document.querySelectorAll('.pdf-page')).map((p) => {
      const r = p.getBoundingClientRect();
      return {
        page: p.getAttribute('data-page'),
        attr: p.getAttribute('data-stamp-editor-open'),
        z: getComputedStyle(p).zIndex,
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        hostsEditor: !!p.querySelector('[data-stamp-type-editor]'),
      };
    });
    const editor = document.querySelector('[data-stamp-type-editor]');
    const host = editor ? editor.closest('.pdf-page') : null;
    const cancel = document.querySelector('[data-stamp-type-cancel]');
    const cr = cancel.getBoundingClientRect();
    const hit = document.elementFromPoint(cr.x + cr.width / 2, cr.y + cr.height / 2);
    return {
      pages,
      editorHostsPage: host ? host.getAttribute('data-page') : null,
      cancelHit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : 'none',
      cancelInsideEditor: !!(hit && hit.closest('[data-stamp-type-editor]')),
    };
  });
  console.log('[DIAG] with editor open: ' + JSON.stringify(withEditor, null, 1));
});