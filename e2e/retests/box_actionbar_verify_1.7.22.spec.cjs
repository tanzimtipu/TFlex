// QA reproduction probe — operator report on installed v1.7.22:
//   "Add-box: place a text box, drag to move, release mouse. Which action bar
//    appears? The operator says only 'Edit'+'Delete', missing 'Confirm'."
//
// This spec drives the DEV build (historically the INSTALLED v1.7.22 binary), places a committed text box,
// then DRAGS the box BODY to move it and releases. It captures exactly which
// action bar is present and which buttons it carries, and screenshots the
// before/after states.
//
// Launch only via e2e/lib/launch.cjs (launchApp) against the packaged exe.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const BOX_TEXT = 'MOVE TEST 88';

test.setTimeout(300000);

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  pageErrors = [];
  win.on('pageerror', (err) => {
    const m = err && err.message ? err.message : String(err);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  await hardClose(electronApp);
  electronApp = null;
  win = null;
  pageErrors = [];
});

async function shot(name) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  console.log(`[SHOT] ${name}`);
  return p;
}

async function openSampleFromCard(name) {
  await win.locator(`.sample-card:has-text("${name}")`).first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
}

async function scrollToPage1() {
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="1"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1000);
}

async function boxSurface(label) {
  const out = await win.evaluate(() => {
    const b = document.querySelector('.edit-box[data-edit-box-id]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      text: b.getAttribute('data-edit-box-text'),
      id: b.getAttribute('data-edit-box-id'),
      selected: b.classList.contains('edit-box-selected'),
    };
  });
  console.log(`[BOX|${label}] ${JSON.stringify(out)}`);
  return out;
}

// Enumerate EVERY action-bar / toolbox button visible in the edit layer:
// its text, aria-label, data-* action attr, and which container it belongs to.
async function actionBars(label) {
  const out = await win.evaluate(() => {
    const results = [];
    const containers = [
      '.edit-box-toolbar',
      '.edit-inline-editor',
      '.edit-image-toolbar',
      '.sig-action-bar',
      '.ann-editor',
      '[data-annotation-action-bar]',
    ];
    for (const sel of containers) {
      const c = document.querySelector(sel);
      if (!c) continue;
      const buttons = Array.from(c.querySelectorAll('button')).map((b) => {
        const r = b.getBoundingClientRect();
        return {
          text: (b.textContent || '').trim(),
          aria: b.getAttribute('aria-label'),
          dataAction: b.getAttribute('data-edit-box-action') || b.getAttribute('data-edit-action') || null,
          dataConfirm: b.getAttribute('data-edit-confirm'),
          classes: Array.from(b.classList),
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        };
      });
      if (buttons.length > 0) {
        results.push({ container: sel, buttons });
      }
    }
    return results;
  });
  console.log(`[ACTIONBARS|${label}] ${JSON.stringify(out)}`);
  return out;
}

test('repro: place box -> drag BODY to move -> release -> inspect action bar', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage1();

  // Enter Edit mode + Add box tool.
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  // Place a text box on page 1.
  const slot1 = win.locator('.page-slot[data-page="1"]').first();
  await slot1.waitFor({ timeout: 15000 });
  const slotRect = await slot1.boundingBox();
  const px = slotRect.x + slotRect.width * 0.28;
  const py = slotRect.y + 250;
  await win.mouse.move(px, py);
  await win.mouse.down();
  await win.mouse.move(px + 150, py + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(800);

  // Phase 26 — the inline editor is retired; the panel Text field is the
  // editor and the session commits on blur.
  const ta = win.locator('[data-txt-text]').first();
  await ta.waitFor({ timeout: 10000 });
  await ta.fill(BOX_TEXT);
  await win.waitForTimeout(300);
  await ta.blur();
  await win.waitForTimeout(1600);

  const R0 = await boxSurface('COMMITTED-R0');
  expect(R0, 'a committed box surface must exist').toBeTruthy();
  expect(R0.text, 'committed box must carry the typed text').toBe(BOX_TEXT);
  await shot('box-actionbar-1722-committed.png');

  // Inspect the action bar immediately after commit (box not yet clicked).
  const afterCommit = await actionBars('AFTER-COMMIT');
  console.log(`[AFTER-COMMIT] containers=${afterCommit.map((c) => c.container).join(',')}`);
  await shot('box-actionbar-1722-after-commit.png');

  // Now DRAG the box BODY to move it (drag from the box center +200/+120).
  const dragStart = { x: R0.x + R0.w / 2, y: R0.y + R0.h / 2 };
  await win.mouse.move(dragStart.x, dragStart.y);
  await win.mouse.down();
  await win.mouse.move(dragStart.x + 200, dragStart.y + 120, { steps: 12 });
  // Capture the action bar MID-DRAG.
  const midDrag = await actionBars('MID-DRAG');
  console.log(`[MID-DRAG] containers=${midDrag.map((c) => c.container).join(',')}`);
  await shot('box-actionbar-1722-mid-drag.png');
  await win.mouse.up();
  await win.waitForTimeout(1200);

  const R1 = await boxSurface('AFTER-DRAG-RELEASE');
  console.log(`[DRAG-RELEASE] box ${JSON.stringify(R0)} -> ${JSON.stringify(R1)}`);
  const dx = R1 ? Math.round(R1.x - R0.x) : null;
  const dy = R1 ? Math.round(R1.y - R0.y) : null;
  console.log(`[DRAG-RELEASE] dx=${dx} dy=${dy}`);

  // THE key observation: which action bar appears after release, and what buttons?
  const afterRelease = await actionBars('AFTER-RELEASE');
  console.log(`[AFTER-RELEASE] containers=${afterRelease.map((c) => c.container).join(',')}`);
  const allButtons = afterRelease.flatMap((c) =>
    c.buttons.map((b) => ({ container: c.container, text: b.text, aria: b.aria, dataConfirm: b.dataConfirm }))
  );
  console.log(`[AFTER-RELEASE|BUTTONS] ${JSON.stringify(allButtons)}`);
  await shot('box-actionbar-1722-after-release.png');

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  console.log(`[PAGEERRORS] ${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);

  // --- DOCUMENT SAFETY: the auto-committed move must persist as ONE visible
  // --- copy after Save-As -> re-open (no duplicate / lost content).
  const savePath = path.join(os.tmpdir(), `tflex-boxactionbar-1722-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(1800);
  console.log(`[SAVED] ${savePath} (exists=${fs.existsSync(savePath)})`);
  expect(fs.existsSync(savePath), 'the saved file must exist on disk').toBe(true);

  // Count VISIBLE box surfaces + text runs in the reopened saved file.
  // Phase 22+ — Open lives on the welcome screen; close the tab first.
  await win.locator('.tab-active .tab-close').click();
  await win.waitForTimeout(1500);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForTimeout(2400);
  await scrollToPage1();
  await win.waitForTimeout(1500);

  const boxReopen = await win.evaluate(() => {
    const b = document.querySelector('.edit-box[data-edit-box-id]');
    if (!b) return { surfaceCount: 0 };
    const r = b.getBoundingClientRect();
    const spans = document.querySelectorAll('.page-slot[data-page="1"] .textLayer span');
    let runCount = 0;
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (t.includes('MOVE TEST 88')) runCount += 1;
    }
    return {
      surfaceCount: document.querySelectorAll('.edit-box[data-edit-box-id]').length,
      runCount,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  });
  console.log(`[DOCSAFETY|REOPEN] ${JSON.stringify(boxReopen)}`);
  await shot('box-actionbar-1722-saved-reopened.png');

  console.log(`[REPRO|SUMMARY] after drag-release: containers=${afterRelease.map((c) => c.container).join(',')} buttons=${JSON.stringify(allButtons)} boxDelta=${dx},${dy} savedReopen=${JSON.stringify(boxReopen)}`);
});
