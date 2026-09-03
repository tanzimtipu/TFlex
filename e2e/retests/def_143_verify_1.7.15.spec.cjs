// QA verification (installed v1.7.15) — DEF-143.
//
// Add FOUR typed signatures "1","2","3","4". EXPECTED (the fix): the Saved tab
// shows four DISTINCT rows (each its own content, no duplicates). Delete the
// FIRST -> exactly 3 rows; delete the new first AGAIN -> exactly 2 rows.
// No duplicates anywhere; the badge count matches the rendered row count.
// Launch only via e2e/lib/launch.cjs against the packaged installed exe.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([], null, EXE_PATH);
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

// Read the Saved tab: badge text, row labels + thumbnail text (distinctness).
async function savedRows(label) {
  const out = await win.evaluate(() => {
    const tabEls = Array.from(document.querySelectorAll('.sig-tab'));
    const savedTab = tabEls.find((t) => (t.textContent || '').trim().startsWith('Saved'));
    const badge = savedTab ? savedTab.textContent.trim() : '';
    const rows = Array.from(document.querySelectorAll('.sig-saved-row'));
    return {
      badge,
      rows: rows.map((r) => {
        const lbl = r.querySelector('.sig-saved-label');
        const thumb = r.querySelector('.sig-thumb');
        const del = r.querySelector('.sig-saved-delete');
        const delLabel = del ? (del.getAttribute('aria-label') || '') : '';
        return {
          label: lbl ? lbl.textContent.trim() : '',
          thumbText: thumb ? (thumb.textContent || '').trim().slice(0, 20) : '',
          delLabel,
        };
      }),
    };
  });
  console.log(`[SAVED|${label}] badge="${out.badge}" rows=${JSON.stringify(out.rows)}`);
  return out;
}

async function openSignManager() {
  await win.click('button[aria-label="Sign tool"]');
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

test('DEF-143: Saved tab shows 4 distinct signatures; delete-first -> 3; delete-again -> 2', async () => {
  await openSampleFromCard('report.pdf');
  await openSignManager();

  // Add four typed signatures "1","2","3","4".
  for (const t of ['1', '2', '3', '4']) {
    await addTypedSignature(t);
  }

  await win.click('.sig-tab:has-text("Saved")');
  await win.waitForTimeout(700);
  const before = await savedRows('FOUR-SAVED');
  await shot('def-143-1715-saved-four.png');

  const labelsBefore = before.rows.map((r) => r.label);
  const distinctBefore = new Set(labelsBefore);
  console.log(`[143] labelsBefore=${JSON.stringify(labelsBefore)} distinct=${distinctBefore.size}`);
  expect(before.rows.length, 'there must be exactly 4 saved signatures').toBe(4);
  expect(distinctBefore.size, 'the 4 rows must be DISTINCT (no duplicate signatures)').toBe(4);
  expect([...distinctBefore].sort().join(','), 'the 4 distinct labels must be 1,2,3,4').toBe('1,2,3,4');
  expect(before.badge, 'badge must read Saved (4)').toMatch(/4/);

  // Delete the FIRST signature row.
  await win.locator('.sig-saved-row').first().locator('.sig-saved-delete').click();
  await win.waitForTimeout(700);
  const afterFirst = await savedRows('AFTER-DELETE-FIRST');
  await shot('def-143-1715-after-delete-first.png');
  const labelsAfter1 = afterFirst.rows.map((r) => r.label).sort();
  console.log(`[143] afterDeleteFirst labels=${JSON.stringify(labelsAfter1)} count=${afterFirst.rows.length}`);
  expect(afterFirst.rows.length, 'after deleting the first there must be exactly 3 rows').toBe(3);
  expect(labelsAfter1.join(','), 'remaining rows must be 2,3,4').toBe('2,3,4');
  expect(new Set(afterFirst.rows.map((r) => r.label)).size, 'no duplicates after delete').toBe(3);
  expect(afterFirst.badge, 'badge must read Saved (3) after one delete').toMatch(/3/);

  // Click delete on the (new) FIRST signature AGAIN.
  await win.locator('.sig-saved-row').first().locator('.sig-saved-delete').click();
  await win.waitForTimeout(700);
  const afterSecond = await savedRows('AFTER-DELETE-AGAIN');
  await shot('def-143-1715-after-delete-again.png');
  const labelsAfter2 = afterSecond.rows.map((r) => r.label).sort();
  console.log(`[143] afterDeleteAgain labels=${JSON.stringify(labelsAfter2)} count=${afterSecond.rows.length}`);
  expect(afterSecond.rows.length, 'after deleting again there must be exactly 2 rows').toBe(2);
  expect(labelsAfter2.join(','), 'remaining rows must be 3,4').toBe('3,4');
  expect(new Set(afterSecond.rows.map((r) => r.label)).size, 'no duplicates after second delete').toBe(2);
  expect(afterSecond.badge, 'badge must read Saved (2) after two deletes').toMatch(/2/);

  console.log('[143|VERDICT] RESULT=PASS');
  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  console.log(`[143] pageErrors=${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);
});
