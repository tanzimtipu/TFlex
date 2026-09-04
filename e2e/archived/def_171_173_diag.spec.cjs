// Focused diagnostics for DEF filings from the standard sweep failures:
//   D1: Signature manager does not close on Escape (blocks theme toggle).
//   D2: Annotations rail panel lists 0 rows after annotations are placed.
//   D3: P3 crop - does page 3 render (virtualization) after crops of 1+2?
// Canonical launcher, dev build.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose, scrollToPage } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
let electronApp = null;
let win = null;

async function eng() {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return d && d.engineState ? d.engineState : d;
  });
}

test('DIAG: sig Escape / annotations panel rows / crop page 3', async () => {
  test.setTimeout(300000);
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForTimeout(2000);

    // ---- D1: Signature manager vs Escape ----
    await win.click('button[aria-label="Sign tool"]');
    await win.waitForSelector('.sig-manager', { timeout: 10000 });
    await win.waitForTimeout(600);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(800);
    const afterEsc = await win.evaluate(() => ({
      sigVisible: !!document.querySelector('.sig-manager'),
      backdrop: !!document.querySelector('.modal-backdrop'),
      sheetBackdrop: !!document.querySelector('.sheet-backdrop'),
    }));
    console.log('[D1] after Escape:', JSON.stringify(afterEsc));
    await win.screenshot({ path: path.join(SHOTS, 'diag-sign-escape.png') });
    // Does the Close button work?
    const closeBtn = win.locator('.sig-manager .sheet-close, .sig-manager [aria-label="Close dialog"]').first();
    if (await closeBtn.count()) {
      await closeBtn.click();
      await win.waitForTimeout(700);
      const afterClose = await win.evaluate(() => ({
        sigVisible: !!document.querySelector('.sig-manager'),
        backdrop: !!document.querySelector('.modal-backdrop'),
      }));
      console.log('[D1] after Close btn:', JSON.stringify(afterClose));
    }

    // ---- D2: annotations panel rows ----
    const box = await win.evaluate(() => {
      const s = document.querySelector('.page-slot[data-page="1"]');
      const r = s.getBoundingClientRect();
      return { x: r.x, y: r.y };
    });
    await win.locator('.ann-toolbar button[data-tool="note"]').click();
    await win.waitForTimeout(400);
    await win.mouse.click(box.x + 260, box.y + 300);
    await win.waitForTimeout(700);
    const ed = win.locator('[data-annotation-editor] textarea').first();
    if (await ed.count()) {
      await ed.fill('DIAG NOTE');
      const confirm = win.locator('[data-annotation-action="note-confirm"]').first();
      if (await confirm.count()) await confirm.click({ force: true });
      else await win.keyboard.press('Control+Enter');
      await win.waitForTimeout(700);
    }
    const st1 = await eng();
    if (!st1 || !st1.annotations) {
      console.log('[D2] diagnostics keys:', st1 ? Object.keys(st1).join(',') : 'tflexDiagnostics() returned undefined');
    } else {
      console.log('[D2] annotations in engine:', JSON.stringify(st1.annotations.map((a) => ({ kind: a.kind, page: a.page }))));
    }
    // Rail tabs are icon-only (aria-label, no text) - match by aria-label.
    const tabInfo = await win.evaluate(() => {
      const tabs = [...document.querySelectorAll('.rail-tab')];
      return tabs.map((t) => ({ title: t.getAttribute('title'), aria: t.getAttribute('aria-label'), text: (t.textContent || '').trim().slice(0, 20) }));
    });
    console.log('[D2] rail tabs:', JSON.stringify(tabInfo));
    await win.locator('.rail-tab[title="Annotations"]').click();
    await win.waitForTimeout(900);
    const panelDump = await win.evaluate(() => {
      const candidates = ['.ann-panel-row', '.annotation-item', '[data-ann-item]', '.ann-item', '[data-annotation-list] > *'];
      const counts = {};
      for (const c of candidates) counts[c] = document.querySelectorAll(c).length;
      const panel = document.querySelector('.ann-panel, [data-annotation-panel]');
      return { counts, panelHtml: panel ? panel.innerHTML.slice(0, 900) : 'NO PANEL' };
    });
    console.log('[D2] panel row counts:', JSON.stringify(panelDump.counts));
    console.log('[D2] panel html:', panelDump.panelHtml.slice(0, 700));
    // Real behavior check: the row exists and its delete control removes the note.
    const realRows = await win.locator('.ann-panel-row').count();
    console.log('[D2] real panel rows (.ann-panel-row):', realRows);
    const del = win.locator('.ann-panel-row-delete').first();
    if (await del.count()) {
      const beforeN = (await eng()).annotations.length;
      await del.click();
      await win.waitForTimeout(900);
      const afterN = (await eng()).annotations.length;
      console.log('[D2] delete via panel: before=', beforeN, 'after=', afterN);
    }
    await win.screenshot({ path: path.join(SHOTS, 'diag-annotations-panel.png') });
    await win.screenshot({ path: path.join(SHOTS, 'diag-annotations-panel.png') });

    // ---- D3: crop pages 1+2, then scroll page 3 into view and measure ----
    const openTools = async () => {
      const open = await win.evaluate(() => !!document.querySelector('[data-tools-palette]'));
      if (!open) {
        await win.click('[data-tools-toggle]');
        await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
      }
      await win.waitForTimeout(400);
    };
    const cropOne = async (pageNum, drag) => {
      await openTools();
      await win.click('[data-tool-id="cropPages"]');
      await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
      await win.waitForTimeout(600);
      await win.click('[data-crop-mode="perPage"]');
      await win.waitForTimeout(500);
      await win.locator('[data-crop-page-select]').selectOption(String(pageNum));
      await win.waitForTimeout(500);
      const se = win.locator('[data-crop-handle="se"]');
      await se.waitFor({ timeout: 10000 });
      const sb = await se.boundingBox();
      await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
      await win.mouse.down();
      await win.mouse.move(sb.x + sb.width / 2 - drag, sb.y + sb.height / 2 - drag, { steps: 6 });
      await win.mouse.up();
      await win.waitForTimeout(400);
      await win.click('[data-crop-confirm]');
      await win.waitForTimeout(2200);
    };
    await cropOne(1, 45);
    await cropOne(2, 90);
    await scrollToPage(win, 3);
    await win.waitForTimeout(2000);
    const p3 = await win.evaluate(() => {
      const slot = document.querySelector('.page-slot[data-page="3"]');
      if (!slot) return { slot: 'MISSING' };
      const c = slot.querySelector('canvas');
      if (!c) return { slot: 'present', canvas: 'UNMOUNTED' };
      const r = c.getBoundingClientRect();
      return { slot: 'present', w: Math.round(r.width), h: Math.round(r.height), aspect: r.width / r.height };
    });
    console.log('[D3] page 3 after scroll-to-3:', JSON.stringify(p3));
    await win.screenshot({ path: path.join(SHOTS, 'diag-crop-page3.png') });
    await hardClose(electronApp);
  } catch (err) {
    console.log('[DIAG] FAILED:', err.message);
    await win.screenshot({ path: path.join(SHOTS, 'diag-FAILURE.png') }).catch(() => {});
    await hardClose(electronApp);
    throw err;
  }
});
