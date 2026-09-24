// QA ground-truth reproduction (installed v1.7.14) — item 4.
//
// Signature Saved tab: add FOUR signatures with text "1","2","3","4" (typed).
// Then open the Saved tab VISUALLY — does each new signature show its own
// content, or does it duplicate the previous one? Then delete the FIRST
// signature and inspect visually, then click delete on the first AGAIN and
// inspect (flakiness / wrong-row / error).
//
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

const { test, expect } = require('@playwright/test');
const { hardClose, armSignTool } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

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
  if (electronApp) await hardClose(electronApp);
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

// Read the Saved tab's saved-signature rows (labels + thumbnail svg presence).
async function savedRows(label) {
  const out = await win.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.sig-saved-row'));
    return rows.map((r) => {
      const pick = r.querySelector('.sig-saved-pick');
      const lbl = r.querySelector('.sig-saved-label');
      const thumb = r.querySelector('.sig-thumb');
      const del = r.querySelector('.sig-saved-delete');
      // For a typed thumb, the text content; for drawn, path d.
      const thumbText = thumb ? (thumb.textContent || '').trim().slice(0, 20) : '';
      const hasPaths = thumb ? thumb.querySelectorAll('path').length : 0;
      const delLabel = del ? del.getAttribute('aria-label') : '';
      return {
        label: lbl ? lbl.textContent.trim() : '',
        thumbText,
        hasPaths,
        delLabel,
      };
    });
  });
  console.log(`[SAVED|${label}] ${JSON.stringify(out)}`);
  return out;
}

async function openSignManager() {
  await armSignTool(win);
  await win.waitForSelector('.sig-manager', { timeout: 10000 });
  await win.waitForTimeout(600);
}

async function addTypedSignature(text) {
  await win.click('.sig-tab:has-text("Type")').catch(() => {});
  await win.waitForTimeout(300);
  const input = win.locator('input[aria-label="Type your signature"]');
  await input.waitFor({ timeout: 10000 });
  await input.click();
  await input.fill(text);
  await win.waitForTimeout(300);
  await win.click('.sig-manager button:text-is("Save")');
  await win.waitForTimeout(500);
}

test('Item 4: Saved tab shows 4 distinct signatures; delete-first then delete-again', async () => {
  await openSampleFromCard('report.pdf');

  await openSignManager();

  // Add four typed signatures "1","2","3","4".
  for (const t of ['1', '2', '3', '4']) {
    await addTypedSignature(t);
  }

  // Switch to the Saved tab and inspect what renders.
  await win.click('.sig-tab:has-text("Saved")');
  await win.waitForTimeout(700);
  const before = await savedRows('FOUR-SAVED');
  await shot('gt-item4-saved-four.png');

  expect(before.length, 'there must be 4 saved signatures').toBe(4);
  console.log(`[ITEM4] labels=${JSON.stringify(before.map((r) => r.label))}`);
  const dupes = before.map((r) => r.label).filter((v, i, a) => a.indexOf(v) !== i);
  console.log(`[ITEM4] DUPLICATE-LABELS=${JSON.stringify([...new Set(dupes)])} (non-empty = a duplicate signature rendered)`);
  // Check the rendered thumbnails for the typed text.
  console.log(`[ITEM4] thumbTexts=${JSON.stringify(before.map((r) => r.thumbText))}`);

  // Delete the FIRST signature row.
  const firstDelete = win.locator('.sig-saved-row').first().locator('.sig-saved-delete');
  await firstDelete.click();
  await win.waitForTimeout(700);
  const afterFirst = await savedRows('AFTER-DELETE-FIRST');
  await shot('gt-item4-after-delete-first.png');
  console.log(`[ITEM4] after deleting first: labels=${JSON.stringify(afterFirst.map((r) => r.label))} count=${afterFirst.length}`);

  // Click delete on the (new) FIRST signature AGAIN.
  const firstDelete2 = win.locator('.sig-saved-row').first().locator('.sig-saved-delete');
  await firstDelete2.click();
  await win.waitForTimeout(700);
  const afterSecond = await savedRows('AFTER-DELETE-AGAIN');
  await shot('gt-item4-after-delete-again.png');
  console.log(`[ITEM4] after deleting again: labels=${JSON.stringify(afterSecond.map((r) => r.label))} count=${afterSecond.length}`);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  console.log(`[ITEM4] pageErrors=${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);
});
