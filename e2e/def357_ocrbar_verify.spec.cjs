// DEF-357 retest (qa) — the OCR suspects bar's close button was unclickable
// because the always-on Inspector (fixed right column, z-index 30) overlapped
// the bar's right edge. The fix reserves the Inspector's column on the bar via
// the shared `--tf-tools-inset` token, so the bar's right edge is flush with the
// panel's left edge and every bar control is hit-testable.
//
// This spec re-confirms the fix IN THE REAL APP on the current tree:
//   * `elementFromPoint` over the close button resolves to the button (or a
//     descendant), never the Inspector;
//   * a REAL Playwright pointer click closes the bar;
//   * the bar's body is not clipped/overlapped by the Inspector.
// Across all three themes, the Inspector collapsed/expanded, and 1440/900/640.
//
// Launches only through the canonical e2e/lib/launch.cjs launchApp.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
test.setTimeout(420000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def357');
  app = null;
  win = null;
});

async function setWindow(w, h) {
  await app.evaluate(({ BrowserWindow }, sz) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.setSize(sz[0], sz[1]);
  }, [w, h]);
  await win.waitForFunction((want) => Math.abs(window.innerWidth - want) <= 24, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(500);
}

async function openDoc(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  const openBtn = win.locator('[data-toolbar-open]').first();
  if ((await openBtn.count()) > 0) await openBtn.click();
  else await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

async function setTheme(theme) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, theme);
  await win.waitForTimeout(600);
}

async function runOcrCurrentPage() {
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.fill('[data-command-palette-input]', 'recognize');
  await win.waitForTimeout(300);
  await win.locator('[data-palette-tool-id="recognizeText"]').first().click();
  await win.waitForSelector('[data-ocr-confirm]', { timeout: 8000 });
  await win.click('[data-ocr-scope="currentPage"]');
  await win.waitForTimeout(150);
  await win.click('[data-ocr-confirm]');
  await win.waitForSelector('[data-ocr-suspects-panel]', { timeout: 240000 });
  await win.waitForTimeout(600);
}

async function ensurePanelOpen() {
  if ((await win.locator('[data-ocr-suspects-panel]').count()) > 0) return;
  if ((await win.locator('[data-command-palette]').count()) === 0) {
    await win.keyboard.press('Control+k');
    await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  }
  await win.fill('[data-command-palette-input]', 'suspects');
  await win.waitForTimeout(250);
  await win.locator('[data-palette-tool-id="ocrSuspects"]').first().click();
  await win.waitForSelector('[data-ocr-suspects-panel]', { timeout: 8000 });
  await win.waitForTimeout(400);
}

async function setInspectorCollapsed(desired) {
  const cur = await win.evaluate(() => document.querySelector('[data-inspector]')?.getAttribute('data-inspector-collapsed'));
  if (cur !== String(desired)) {
    await win.locator('[data-inspector-collapse]').first().click();
    await win.waitForTimeout(500);
  }
  return win.evaluate(() => document.querySelector('[data-inspector]')?.getAttribute('data-inspector-collapsed'));
}

const MEASURE = `(() => {
  const bar = document.querySelector('[data-ocr-suspects-panel]');
  const insp = document.querySelector('[data-inspector]');
  const btn = document.querySelector('.ocr-suspects-close');
  const body = document.querySelector('.ocr-suspects-body');
  if (!bar || !insp || !btn || !body) return null;
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
  const br = r(btn);
  const cx = Math.round(br.x + br.w / 2), cy = Math.round(br.y + br.h / 2);
  const top = document.elementFromPoint(cx, cy);
  const insideBtn = top !== null && (top === btn || btn.contains(top));
  const insideBar = top !== null && (top === bar || bar.contains(top));
  const bodyEl = body;
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    innerWidth: window.innerWidth,
    inspectorCollapsed: insp.getAttribute('data-inspector-collapsed'),
    bar: r(bar), inspector: r(insp), close: br, body: r(body),
    hit: { x: cx, y: cy, tag: top ? top.tagName : null, cls: top ? String(top.className) : null, insideBtn, insideBar },
    bodyScroll: { scrollWidth: bodyEl.scrollWidth, clientWidth: bodyEl.clientWidth, scrollHeight: bodyEl.scrollHeight, clientHeight: bodyEl.clientHeight },
    suspects: bar.querySelectorAll('[data-ocr-suspect-word]').length,
  };
})()`;

test('DEF-357 the OCR suspects bar close button is hit-testable and closes the bar; body not clipped', async () => {
  await openDoc(getSamplePath('report.pdf'));
  await setWindow(1440, 900);
  await runOcrCurrentPage();

  const rows = [];
  let shotTaken = false;
  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(theme);
    for (const [w, h] of [[1440, 900], [900, 700], [640, 700]]) {
      await setWindow(w, h);
      for (const desiredCollapsed of [false, true]) {
        await ensurePanelOpen();
        const effective = await setInspectorCollapsed(desiredCollapsed);
        await win.waitForTimeout(400);
        const m = await win.evaluate(MEASURE);
        const label = `${theme}/${w}x${h}/collapsed=${effective}`;
        console.log(`[DEF-357 ${label}] ${JSON.stringify(m)}`);
        expect(m, `${label}: bar + inspector + close + body present`).not.toBeNull();

        // 1. elementFromPoint over the close button resolves to the button.
        expect(m.hit.insideBtn, `${label}: elementFromPoint over the close button returns the button (or its child); got ${m.hit.tag}.${m.hit.cls}`).toBe(true);
        // 2. The close button is not under the Inspector.
        expect(m.close.right, `${label}: close button right edge (${m.close.right}) is at/left of the Inspector left edge (${m.inspector.x})`).toBeLessThanOrEqual(m.inspector.x + 1);
        // 3. The bar's right edge is at/left of the Inspector's left edge.
        expect(m.bar.right, `${label}: bar right edge (${m.bar.right}) is at/left of the Inspector left edge (${m.inspector.x})`).toBeLessThanOrEqual(m.inspector.x + 1);
        // 4. The body is visible and not clipped/overlapped by the Inspector.
        expect(m.body.h, `${label}: body has a visible height`).toBeGreaterThan(0);
        expect(m.body.right, `${label}: body right edge (${m.body.right}) is at/left of the Inspector left edge (${m.inspector.x})`).toBeLessThanOrEqual(m.inspector.x + 1);
        expect(m.bodyScroll.scrollWidth, `${label}: body content is not horizontally clipped (scrollWidth ${m.bodyScroll.scrollWidth} <= clientWidth ${m.bodyScroll.clientWidth})`).toBeLessThanOrEqual(m.bodyScroll.clientWidth + 1);

        if (!shotTaken) {
          await win.screenshot({ path: path.join(SHOTS, 'def357-ocrbar-inspector.png') });
          shotTaken = true;
          console.log(`[DEF-357] screenshot ${path.join(SHOTS, 'def357-ocrbar-inspector.png')}`);
        }

        // 5. A REAL pointer click closes the bar (Playwright actionability
        //    includes the hit-test, so an intercepted button times out).
        await win.locator('.ocr-suspects-close').click({ timeout: 6000 });
        await win.waitForFunction(() => document.querySelector('[data-ocr-suspects-panel]') === null, null, { timeout: 6000 });
        expect(await win.locator('[data-ocr-suspects-panel]').count(), `${label}: real click closed the bar`).toBe(0);

        rows.push({ theme, w, h, effective, closeRight: m.close.right, inspLeft: m.inspector.x, barRight: m.bar.right, bodyRight: m.body.right, hitTag: m.hit.tag, suspects: m.suspects });
      }
    }
  }
  console.log(`[DEF-357 matrix] ${JSON.stringify(rows)}`);
});
