// QA verification (installed v1.7.15) — DEF-144.
//
// Draw a THIN signature. EXPECTED (the fix): the ghost preview AND the placed
// result render as a THIN pen stroke (proportional), NOT a thick black filled
// blob. The box aspect must be preserved and the whole signature visible.
// Also confirm there is still no image-import tab (out of scope, verified-absent).
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
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

// Read the signature raster (ghost/placed) svg path geometry + the box rect.
async function rasterOf(selector) {
  return win.evaluate((sel) => {
    const box = document.querySelector(sel);
    if (!box) return { present: false };
    const r = box.getBoundingClientRect();
    const svg = box.querySelector('svg.sig-raster');
    const path = svg ? svg.querySelector('path') : null;
    return {
      present: true,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      svg: svg ? {
        viewBox: svg.getAttribute('viewBox'),
        width: svg.getAttribute('width'),
        height: svg.getAttribute('height'),
        pathCount: svg.querySelectorAll('path').length,
        strokeWidth: path ? parseFloat(path.getAttribute('stroke-width') || '0') : null,
        fill: path ? path.getAttribute('fill') : null,
        hasBigPathD: path ? (path.getAttribute('d') || '').length : 0,
      } : null,
    };
  }, selector);
}

test('DEF-144: thin drawn signature -> ghost + placed render thin (not a thick blob)', async () => {
  await openSampleFromCard('report.pdf');

  await win.click('button[aria-label="Sign tool"]');
  await win.waitForSelector('.sig-manager', { timeout: 10000 });
  await win.waitForTimeout(600);

  // Confirm the tabs present: Draw / Type / Saved only -> no image import.
  const tabs = await win.evaluate(() => Array.from(document.querySelectorAll('.sig-tab')).map((t) => (t.textContent || '').trim()));
  console.log(`[144] signature-manager tabs=${JSON.stringify(tabs)}`);
  const hasImageImport = /image|import|upload|from file/i.test(tabs.join(' '));
  console.log(`[144] hasImageImportInManager=${hasImageImport} (false = cannot add a signature from an image file)`);

  // Draw tab — draw a thin stroke.
  await win.click('.sig-tab:has-text("Draw")');
  await win.waitForTimeout(500);
  const drawCanvas = win.locator('canvas[aria-label="Draw your signature"]');
  await drawCanvas.waitFor({ timeout: 10000 });
  const cbox = await drawCanvas.boundingBox();
  console.log(`[144] draw canvas box=${JSON.stringify(cbox)}`);
  await win.mouse.move(cbox.x + 20, cbox.y + cbox.height * 0.7);
  await win.mouse.down();
  await win.mouse.move(cbox.x + cbox.width * 0.3, cbox.y + cbox.height * 0.4, { steps: 10 });
  await win.mouse.move(cbox.x + cbox.width * 0.55, cbox.y + cbox.height * 0.65, { steps: 10 });
  await win.mouse.move(cbox.x + cbox.width * 0.85, cbox.y + cbox.height * 0.35, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(500);
  await shot('def-144-1715-drawn-canvas.png');

  await win.click('.sig-manager button:text-is("Save")');
  await win.waitForTimeout(700);
  await win.click('.sig-saved-pick').catch(() => {});
  await win.waitForTimeout(700);

  // Hover over the page so the ghost preview shows.
  const page = win.locator('.pdf-page').first();
  const pbox = await page.boundingBox();
  const tx = pbox.x + 380;
  const ty = pbox.y + 300;
  await win.mouse.move(tx, ty);
  await win.waitForTimeout(600);

  const ghost = await rasterOf('.sig-ghost');
  console.log(`[144] GHOST=${JSON.stringify(ghost)}`);
  await shot('def-144-1715-ghost.png');

  // Place the signature.
  await win.mouse.click(tx, ty);
  await win.waitForTimeout(600);
  const confirmBtn = win.locator('[data-sig-action="confirm"]').first();
  if (await confirmBtn.count()) {
    await confirmBtn.click({ force: true });
    await win.waitForTimeout(700);
  }
  const placed = await rasterOf('.sig-placement');
  console.log(`[144] PLACED=${JSON.stringify(placed)}`);
  await shot('def-144-1715-placed.png');

  // ---- Verdict ----
  const aspect = (r) => (r && r.h > 0 ? r.w / r.h : 0);
  const ghostAspect = aspect(ghost && ghost.rect);
  const placedAspect = aspect(placed && placed.rect);
  console.log(`[144] ghostAspect=${ghostAspect.toFixed(2)} placedAspect=${placedAspect.toFixed(2)} (source ~3.0)`);
  expect(ghost.present, 'ghost preview must be present').toBe(true);
  expect(placed.present, 'placed signature must be present').toBe(true);

  const strokeThin = (r) => r && r.svg && r.svg.strokeWidth !== null && r.svg.strokeWidth < 4;
  const notFilled = (r) => r && r.svg && r.svg.fill === 'none';
  const aspectPreserved = (a) => a > 1.5 && a < 4.5;

  const thinOk = strokeThin(ghost) && strokeThin(placed);
  const fillOk = notFilled(ghost) && notFilled(placed);
  const aspectOk = aspectPreserved(ghostAspect) && aspectPreserved(placedAspect);
  const pass = thinOk && fillOk && aspectOk;
  console.log(`[144] strokeThin=${thinOk} fillNone=${fillOk} aspectPreserved=${aspectOk}`);
  console.log(`[144|VERDICT] ghostStrokeWidth=${ghost.svg && ghost.svg.strokeWidth} placedStrokeWidth=${placed.svg && placed.svg.strokeWidth}`);
  console.log(`[144|VERDICT] RESULT=${pass ? 'PASS' : 'FAIL'}`);
  expect(pass, `DEF-144 ${pass ? 'PASS' : 'FAIL'} — drawn signature must render thin, not a thick blob`).toBe(true);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  console.log(`[144] pageErrors=${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);
});
