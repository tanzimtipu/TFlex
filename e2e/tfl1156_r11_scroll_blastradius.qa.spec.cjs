// TFL-1156 (TFL-1116 C9 / R11) — blast-radius check for the shared panel shell
// and the shared panel scrollbar. C9 touched the shared panel body / scrollbar
// CSS and the SideRail, Inspector and ContextPanel adoption, so this spec proves
// the neighbouring scroll behaviour did NOT regress: the Navigator and Inspector
// bodies still scroll by wheel and by keyboard, the document scroller still
// scrolls by wheel and keyboard, and no panel body gained a nested horizontal
// scroll. Launches ONLY through the canonical launchApp helper. qa-owned.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1156-r11-blast');
  app = null;
  win = null;
});

test.setTimeout(240000);

async function setSize(w, h) {
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw.isMaximized()) bw.unmaximize();
  });
  await win.waitForTimeout(350);
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]);
  }, [w, h]);
  await win.waitForFunction((s) => Math.abs(window.innerWidth - s) < 60, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(300);
}

const metrics = (sel) =>
  win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
    };
  }, sel);

async function ensureInspectorExpanded() {
  const collapsed = await win.locator('[data-inspector][data-inspector-collapsed="true"]').count();
  if (collapsed > 0) {
    await win.click('[data-inspector-collapse]');
    await win.waitForFunction(
      () => document.querySelector('[data-inspector]')?.getAttribute('data-inspector-collapsed') === 'false',
      null,
      { timeout: 5000 },
    );
    await win.waitForTimeout(400);
  }
}

// Wheel-scroll a scroll container: hover its centre, wheel down, then assert the
// scroll position advanced. Fails loudly if the container does not overflow.
async function wheelScroll(sel, label) {
  await win.evaluate((s) => { const el = document.querySelector(s); if (el) el.scrollTop = 0; }, sel);
  const m = await metrics(sel);
  expect(m, `${label} present`).not.toBeNull();
  expect(m.scrollHeight, `${label} overflows vertically`).toBeGreaterThan(m.clientHeight + 1);
  const box = await win.locator(sel).boundingBox();
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.wheel(0, 400);
  await win.waitForTimeout(300);
  const after = await metrics(sel);
  expect(after.scrollTop, `${label} wheel-scroll advances`).toBeGreaterThan(0);
}

// Keyboard-scroll a scroll container: focus a point inside it, PageDown, assert.
async function keyScroll(sel, label) {
  await win.evaluate((s) => { const el = document.querySelector(s); if (el) el.scrollTop = 0; }, sel);
  const box = await win.locator(sel).boundingBox();
  await win.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
  await win.waitForTimeout(150);
  await win.keyboard.press('PageDown');
  await win.waitForTimeout(300);
  const after = await metrics(sel);
  expect(after.scrollTop, `${label} keyboard PageDown advances`).toBeGreaterThan(0);
}

test('R11 blast radius: panel bodies + document scroller still scroll (wheel + keyboard)', async () => {
  // Open the multi-page sample so the Navigator page list (and the canvas) both
  // have real vertical overflow to scroll.
  await win.locator('.sample-card').filter({ hasText: 'long.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(800);
  await setSize(1440, 440);
  await ensureInspectorExpanded();
  await win.waitForSelector('.context-panel-body', { timeout: 8000 });
  await win.waitForSelector('.inspector-body', { timeout: 8000 });
  await win.waitForTimeout(400);

  const navBody = await metrics('.context-panel-body');
  const insp0 = await metrics('.inspector-body');
  const pages = await win.evaluate(() => document.querySelectorAll('.thumb').length);
  console.log(`[tfl1156 blast] pages=${pages} navBody=${JSON.stringify(navBody)} insp=${JSON.stringify(insp0)}`);

  // The shared panel body clips horizontal overflow — no nested horizontal scroll.
  expect(navBody.overflowX, 'navigator body clips horizontal overflow').toBe('hidden');
  expect(insp0.overflowX, 'inspector body clips horizontal overflow').toBe('hidden');
  expect(navBody.scrollWidth, 'navigator body no h-scroll').toBeLessThanOrEqual(navBody.clientWidth + 1);
  expect(insp0.scrollWidth, 'inspector body no h-scroll').toBeLessThanOrEqual(insp0.clientWidth + 1);

  // Navigator (SideRail thumb list) + Inspector bodies still scroll by wheel and keyboard.
  await wheelScroll('.thumb-scroller-inner', 'Navigator');
  await keyScroll('.thumb-scroller-inner', 'Navigator');
  await wheelScroll('.inspector-body', 'Inspector');
  await keyScroll('.inspector-body', 'Inspector');

  // The document scroller is a neighbour of the shared scrollbar block: force a
  // vertical overflow by zooming in, then confirm wheel + keyboard still scroll.
  for (let i = 0; i < 6; i += 1) {
    await win.locator('.view-strip-view [aria-label="Zoom in"]').first().click();
  }
  await win.waitForTimeout(600);
  await wheelScroll('.document-scroller', 'Document');
  await keyScroll('.document-scroller', 'Document');
  console.log('[tfl1156 blast] all scroll neighbours verified');
});
