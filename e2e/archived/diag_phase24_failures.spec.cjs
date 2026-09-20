// Diagnostic for the two Phase-24 spec failures observed after the DEF-253
// fix: C3 (legacy annotation on page 4 -> panel opens then closes) and C4
// (highlight clear on a reopened annotation does not survive save/reopen).
// Not an acceptance test - evidence gathering only.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchDev, openSample, openSamplePath, hardClose, scrollToPage } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const log = (l, o) => console.log(`[DIAG] ${l} ${JSON.stringify(o)}`);

async function openReport(win, app) {
  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(500);
}

async function sample(win) {
  return win.evaluate(() => {
    const layers = [...document.querySelectorAll('.annotation-layer')].map((l) => ({
      page: l.getAttribute('data-annotation-layer'),
      active: l.className.includes('annotation-layer-active'),
      tool: l.getAttribute('data-tool'),
    }));
    return {
      panel: !!document.querySelector('.text-props-panel'),
      panelOpenAttr: document.querySelector('.workspace')?.getAttribute('data-text-panel-open') ?? null,
      activeLayers: layers.filter((l) => l.active),
      layers,
      p4box: !!document.querySelector('.pdf-page[data-page="4"] .ann-textbox[data-kind="textbox"]'),
      frame: !!document.querySelector('[data-content-selection-frame]'),
    };
  });
}

test('diag C3 page-4 legacy selection timeline', async () => {
  test.setTimeout(120000);
  const legacySrc = path.resolve(__dirname, '..', '..', 'test-fixtures', 'annot-text-roundtrip-1727.pdf');
  const legacyPath = path.join(os.tmpdir(), `diag-legacy-${Date.now()}.pdf`);
  fs.copyFileSync(legacySrc, legacyPath);
  const { electronApp, window: win } = await launchDev();
  try {
    await openSamplePath(win, electronApp, legacyPath);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1500);
    await scrollToPage(win, 4);
    await win.waitForSelector('.pdf-page[data-page="4"]', { timeout: 15000 });
    await win.waitForTimeout(800);

    const before = await sample(win);
    const box = await win.locator('.pdf-page[data-page="4"] .ann-textbox[data-kind="textbox"]').first().boundingBox();
    const timeline = await win.evaluate(async ({ x, y }) => {
      const rows = [];
      const t0 = performance.now();
      const snap = () => ({
        t: Math.round(performance.now() - t0),
        panel: !!document.querySelector('.text-props-panel'),
        open: document.querySelector('.workspace')?.getAttribute('data-text-panel-open') ?? null,
        activePages: [...document.querySelectorAll('.annotation-layer-active')].map((l) => l.getAttribute('data-annotation-layer')),
        layerPages: [...document.querySelectorAll('.annotation-layer')].map((l) => l.getAttribute('data-annotation-layer')),
        frame: !!document.querySelector('[data-content-selection-frame]'),
      });
      const target = document.elementFromPoint(x, y);
      const hit = { tag: target && target.tagName, cls: target && String(target.className).slice(0, 50) };
      const down = new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1 });
      const up = new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, button: 0, buttons: 0, pointerId: 1 });
      target.dispatchEvent(down);
      target.dispatchEvent(up);
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => requestAnimationFrame(r));
        rows.push(snap());
      }
      return { hit, rows };
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    const transitions = timeline.rows.filter((r, i, a) => i === 0 || r.panel !== a[i - 1].panel || r.open !== a[i - 1].open);
    log('C3-before', before);
    log('C3-hit', timeline.hit);
    log('C3-transitions', transitions);
    log('C3-final', timeline.rows[timeline.rows.length - 1]);
    await win.screenshot({ path: path.join(SHOTS, 'diag-c3-page4.png') }).catch(() => {});
    // DEF-254 reproduction guard: the panel opens then closes. Invert when fixed.
    expect(transitions.some((r) => r.panel === true), 'DEF-254: the panel opens on the page-4 click').toBe(true);
    expect(transitions.some((r) => r.panel === false), 'DEF-254: the panel then closes (bug present)').toBe(true);
  } finally {
    await hardClose(electronApp, 'diag-c3');
  }
});

test('diag C4 highlight clear on reopened annotation', async () => {
  test.setTimeout(180000);
  const { electronApp, window: win } = await launchDev();
  try {
    await openReport(win, electronApp);
    // place a textbox with a red highlight
    const { armAnnotationTool } = require('../lib/helpers.cjs');
    await armAnnotationTool(win, 'textbox');
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.move(pg.x + pg.width * 0.3, pg.y + pg.height * 0.25);
    await win.mouse.down();
    await win.mouse.move(pg.x + pg.width * 0.3 + 190, pg.y + pg.height * 0.25 + 60, { steps: 6 });
    await win.mouse.up();
    await win.waitForSelector('[data-annotation-editor="textbox"]', { timeout: 8000 });
    await win.locator('[data-annotation-editor="textbox"] textarea').fill('DIAG-HL');
    await win.click('[data-annotation-action="textbox-confirm"]');
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    await win.waitForTimeout(300);
    await win.locator('[data-txt-highlight]').fill('#ff0000');
    await win.waitForTimeout(600);
    const styleAfterSet = await win.evaluate(() => (window.tflexDiagnostics().engineState.annotations || []).find((a) => a.text === 'DIAG-HL')?.style ?? null);
    log('C4-style-after-set', styleAfterSet);

    const p1 = path.join(os.tmpdir(), `diag-hl-set-${Date.now()}.pdf`);
    await electronApp.evaluate(async ({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, p1);
    await win.click('[data-toolbar-save-as]');
    await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
    await win.click('[data-save-as-confirm]');
    await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, electronApp, p1);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(2000);
    const afterReopen = await win.evaluate(() => (window.tflexDiagnostics().engineState.annotations || []).find((a) => a.text === 'DIAG-HL')?.style ?? null);
    log('C4-style-after-reopen', afterReopen);

    // select it and clear
    const box = await win.locator('.ann-textbox[data-kind="textbox"]').first().boundingBox();
    await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await win.waitForTimeout(800);
    const panelOpen = await win.evaluate(() => !!document.querySelector('.text-props-panel'));
    const clearBtn = await win.evaluate(() => {
      const b = document.querySelector('[data-txt-highlight-clear]');
      return b ? { disabled: b.disabled, exists: true } : { exists: false };
    });
    log('C4-panel', { panelOpen, clearBtn });
    await win.click('[data-txt-highlight-clear]');
    await win.waitForTimeout(1200);
    const styleAfterClear = await win.evaluate(() => (window.tflexDiagnostics().engineState.annotations || []).find((a) => a.text === 'DIAG-HL')?.style ?? null);
    const panelAfterClear = await win.evaluate(() => {
      const p = document.querySelector('.text-props-panel');
      return { open: !!p, highlight: p && p.querySelector('[data-txt-highlight]') ? p.querySelector('[data-txt-highlight]').value : null };
    });
    log('C4-after-clear', { styleAfterClear, panelAfterClear });

    const p2 = path.join(os.tmpdir(), `diag-hl-clear-${Date.now()}.pdf`);
    await electronApp.evaluate(async ({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, p2);
    await win.click('[data-toolbar-save-as]');
    await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
    await win.click('[data-save-as-confirm]');
    await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, electronApp, p2);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(2000);
    const finalStyle = await win.evaluate(() => (window.tflexDiagnostics().engineState.annotations || []).find((a) => a.text === 'DIAG-HL')?.style ?? null);
    log('C4-style-after-clear-reopen', finalStyle);
    await win.screenshot({ path: path.join(SHOTS, 'diag-c4-clear.png') }).catch(() => {});
    // DEF-255 reproduction guard: the clear applies in-memory but is lost on
    // save + reopen. Invert the last assertion when fixed.
    expect(styleAfterClear, 'DEF-255: the clear reaches the engine model').toEqual({ highlight: null });
    expect(finalStyle && finalStyle.highlight, 'DEF-255: the cleared highlight returns after save + reopen (bug present)').not.toBeNull();
  } finally {
    await hardClose(electronApp, 'diag-c4');
  }
});