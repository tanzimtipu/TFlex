// QA ground-truth reproduction (installed v1.7.14) — item 5.
//
// Drawn signature: draw a signature, observe the GHOST preview + the placed
// result. Is it too big / too thick relative to the drawn stroke? Does the
// signature box expand to show the whole signature? Also confirm there is NO
// way to add a signature from an IMAGE file (only Draw / Type / Saved tabs).
//
// Launch only via e2e/lib/launch.cjs against the packaged installed exe.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
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
  if (electronApp) await electronApp.close().catch(() => {});
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

test('Item 5: drawn signature ghost + placed result; no image import available', async () => {
  await openSampleFromCard('report.pdf');

  // Open the Sign manager.
  await win.click('button[aria-label="Sign tool"]');
  await win.waitForSelector('.sig-manager', { timeout: 10000 });
  await win.waitForTimeout(600);

  // Confirm the tabs present: Draw / Type / Saved only -> no "image" import.
  const tabs = await win.evaluate(() => {
    const s = Array.from(document.querySelectorAll('.sig-tab'));
    return s.map((t) => (t.textContent || '').trim());
  });
  console.log(`[ITEM5] signature-manager tabs=${JSON.stringify(tabs)}`);
  const hasImageImport = /image|import|upload|from file/i.test(tabs.join(' '));
  console.log(`[ITEM5] hasImageImportInManager=${hasImageImport} (false = cannot add a signature from an image file)`);

  // Draw tab.
  await win.click('.sig-tab:has-text("Draw")');
  await win.waitForTimeout(500);
  const drawCanvas = win.locator('canvas[aria-label="Draw your signature"]');
  await drawCanvas.waitFor({ timeout: 10000 });
  const cbox = await drawCanvas.boundingBox();
  console.log(`[ITEM5] draw canvas box=${JSON.stringify(cbox)}`);
  // Draw a curvy stroke across the canvas.
  await win.mouse.move(cbox.x + 20, cbox.y + cbox.height * 0.7);
  await win.mouse.down();
  await win.mouse.move(cbox.x + cbox.width * 0.3, cbox.y + cbox.height * 0.4, { steps: 10 });
  await win.mouse.move(cbox.x + cbox.width * 0.55, cbox.y + cbox.height * 0.65, { steps: 10 });
  await win.mouse.move(cbox.x + cbox.width * 0.85, cbox.y + cbox.height * 0.35, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(500);
  await shot('gt-item5-drawn-canvas.png');

  // Save the drawn signature.
  await win.click('.sig-manager button:text-is("Save")');
  await win.waitForTimeout(700);

  // Arm it (pick the saved signature).
  await win.click('.sig-saved-pick').catch(() => {});
  await win.waitForTimeout(700);

  // Hover over the page so the ghost preview tracks the cursor inside the page.
  const page = win.locator('.pdf-page').first();
  const pbox = await page.boundingBox();
  const tx = pbox.x + 380;
  const ty = pbox.y + 300;
  await win.mouse.move(tx, ty);
  await win.waitForTimeout(500);

  // Observe the GHOST preview size on the page.
  const ghost = await win.evaluate(() => {
    const g = document.querySelector('.sig-ghost');
    if (!g) return { present: false };
    const r = g.getBoundingClientRect();
    const src = g.getAttribute('data-sig-ghost-source') || '';
    const inner = g.querySelector('svg');
    const ir = inner ? inner.getBoundingClientRect() : null;
    return {
      present: true,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      src,
      innerW: ir ? Math.round(ir.width) : null,
      innerH: ir ? Math.round(ir.height) : null,
    };
  });
  console.log(`[ITEM5] GHOST=${JSON.stringify(ghost)}`);
  await shot('gt-item5-ghost.png');

  // Place the signature on page 1 and confirm.
  await win.mouse.click(tx, ty);
  await win.waitForTimeout(500);
  const pending = await win.evaluate(() => {
    const p = document.querySelector('.sig-pending');
    if (!p) return { present: false };
    const r = p.getBoundingClientRect();
    return { present: true, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log(`[ITEM5] PENDING-PLACEMENT=${JSON.stringify(pending)}`);
  await shot('gt-item5-pending.png');

  // Confirm.
  const confirmBtn = win.locator('[data-sig-action="confirm"]').first();
  if (await confirmBtn.count()) {
    await confirmBtn.click({ force: true });
    await win.waitForTimeout(700);
  }
  const placed = await win.evaluate(() => {
    const p = document.querySelector('.sig-placement');
    if (!p) return { present: false };
    const r = p.getBoundingClientRect();
    return { present: true, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log(`[ITEM5] PLACED=${JSON.stringify(placed)}`);
  await shot('gt-item5-placed.png');

  // Compare ghost / pending / placed size against the draw canvas size (the
  // drawn source). The draw canvas is 300x100-ish; a placement much larger
  // than the source or with a huge aspect is "too big".
  console.log(`[ITEM5] canvas=${JSON.stringify({ w: Math.round(cbox.width), h: Math.round(cbox.height) })} ghost=${JSON.stringify(ghost)} placed=${JSON.stringify(placed)}`);
  console.log(`[ITEM5] ghostAspect=${ghost.w && ghost.h ? (ghost.w / ghost.h).toFixed(2) : 'n/a'} placedAspect=${placed.w && placed.h ? (placed.w / placed.h).toFixed(2) : 'n/a'}`);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  console.log(`[ITEM5] pageErrors=${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);
});
