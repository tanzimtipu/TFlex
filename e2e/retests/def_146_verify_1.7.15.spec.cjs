// QA verification (installed v1.7.15) — DEF-146.
//
// Commit an Add-box with LONG text. EXPECTED (the fix): the committed box
// renders its FULL text legibly ("ARTIFACT CHECK 88"), NOT truncated to the
// first couple of characters (the v1.7.14 "AR" artifact from an oversized
// default box font clipped by overflow:hidden). The mirror font auto-fits the
// box so the whole string is visible.
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose, toggleEditMode } = require('../lib/helpers.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const FULL_TEXT = 'ARTIFACT CHECK 88';

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

async function boxSnapshot(label) {
  const out = await win.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('[data-edit-box-id]'));
    const mirrors = Array.from(document.querySelectorAll('[data-edit-box-text-mirror]'));
    const rect = (b) => { const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      boxCount: boxes.length,
      boxRects: boxes.map(rect),
      mirrorTexts: mirrors.map((m) => (m.textContent || '').trim()),
      // The raw committed text (the mirror's own attribute) — textContent
      // concatenates wrapped line divs without spaces, so it is not a
      // faithful read of the box's content.
      mirrorAttrs: mirrors.map((m) => m.getAttribute('data-edit-box-text-mirror') || ''),
      // Computed font size of the mirror (px) — a fitted size should be
      // proportionate to the box, not the ~71.8px oversized default.
      mirrorFonts: mirrors.map((m) => {
        const fs = getComputedStyle(m).fontSize;
        return parseFloat(fs) || 0;
      }),
      mirrorRects: mirrors.map(rect),
    };
  });
  console.log(`[BOX|${label}] ${JSON.stringify(out)}`);
  return out;
}

// Page-1 textLayer text (the mirror's committed content may also register here).
async function page1Text() {
  return win.evaluate(() => {
    const p = document.querySelector('.page-slot[data-page="1"]');
    if (!p) return { present: false, text: '' };
    const layer = p.querySelector('.textLayer');
    let joined = '';
    if (layer) layer.querySelectorAll('span').forEach((s) => { joined += s.textContent || ''; });
    return { present: true, text: (joined || '').replace(/[ \t\r\n]+/g, ' ').trim() };
  });
}

test('DEF-146: committing a textbox with long text -> full text visible, not truncated', async () => {
  await openSampleFromCard('report.pdf');

  await toggleEditMode(win);
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  const slot1 = win.locator('.page-slot[data-page="1"]').first();
  await slot1.waitFor({ timeout: 15000 });
  const slotRect = await slot1.boundingBox();
  const px = slotRect.x + slotRect.width * 0.28;
  const py = slotRect.y + 230;
  await win.mouse.move(px, py);
  await win.mouse.down();
  await win.mouse.move(px + 150, py + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(800);

  // Phase 26 — the inline editor is retired; the panel Text field is the
  // editor and the session commits on blur.
  const ta = win.locator('[data-txt-text]').first();
  await ta.waitFor({ timeout: 10000 });
  await ta.fill(FULL_TEXT);
  await win.waitForTimeout(300);
  await ta.blur();
  await win.waitForTimeout(900);

  const committed = await boxSnapshot('COMMITTED');
  await shot('def-146-1715-after-commit.png');

  const mirrorText = committed.mirrorTexts.join('|');
  const mirrorAttr = committed.mirrorAttrs.join('|');
  const mirrorFont = committed.mirrorFonts[0] || 0;
  const boxRect = committed.boxRects[0];
  console.log(`[146] mirrorText="${mirrorText}" mirrorAttr="${mirrorAttr}" font=${mirrorFont.toFixed(2)} box=${JSON.stringify(boxRect)}`);
  const p1 = await page1Text();
  console.log(`[146] page1 textLayer has full text? ${/ARTIFACT CHECK 88/i.test(p1.text)}`);

  // Re-arm and move the box + confirm, then re-inspect (the artifact surfaced
  // after move+confirm in the original report).
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);
  if (boxRect) {
    const grabX = boxRect.x + boxRect.w / 2;
    const grabY = boxRect.y + boxRect.h / 2;
    await win.mouse.move(grabX, grabY);
    await win.mouse.down();
    await win.mouse.move(grabX + 170, grabY + 110, { steps: 12 });
    await win.mouse.up();
    await win.waitForTimeout(500);
    await win.keyboard.press('Control+Enter');
    await win.waitForTimeout(900);
  }
  const moved = await boxSnapshot('AFTER-MOVE-CONFIRM');
  await shot('def-146-1715-after-confirm.png');

  // --- Verdict ---
  // The committed box must carry the FULL text in its mirror (not "AR")...
  // Read the raw mirror attribute, not textContent: a wrapped box renders one
  // div per line, so textContent drops the spaces between lines.
  const fullTextOk = committed.mirrorAttrs.some((t) => t === FULL_TEXT) || /ARTIFACT CHECK 88/.test(mirrorAttr);
  // ...and the mirror font must be fitted to the box (not the oversized ~71.8px default).
  const fontFits = mirrorFont > 4 && mirrorFont < 60;
  // After move+confirm the box still holds the full string.
  const fullTextAfterMove = moved.mirrorAttrs.some((t) => t === FULL_TEXT) || /ARTIFACT CHECK 88/.test(moved.mirrorAttrs.join('|'));
  const pass = fullTextOk && fontFits && fullTextAfterMove;
  console.log(`[146|VERDICT] fullTextInMirror=${fullTextOk} fontFitsBox=${fontFits} (font=${mirrorFont.toFixed(2)}px) fullTextAfterMove=${fullTextAfterMove}`);
  console.log(`[146|VERDICT] RESULT=${pass ? 'PASS' : 'FAIL'}`);
  expect(fullTextOk, 'committed box must render the FULL text (not AR)').toBe(true);
  expect(fontFits, `mirror font must fit the box (got ${mirrorFont.toFixed(2)}px, must be < 60)`).toBe(true);
  expect(fullTextAfterMove, 'full text must survive move+confirm').toBe(true);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  console.log(`[146] pageErrors=${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);
});
