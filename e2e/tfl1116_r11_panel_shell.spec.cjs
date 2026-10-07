// TFL-1155 (TFL-1116 C9 / R11) — the panel shell baseline + shared scrollbar.
// Launches ONLY through the canonical launchApp helper (mirrors
// phase108_siderail.spec.cjs). Read-only product checks; the R11 screenshot
// lands under screenshots/. Asserts the Navigator and Inspector scroll bodies
// stop at the shared workspace baseline above the canvas footer and that no
// panel body scrolls sideways (nested horizontal scroll), including at 960x640.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shotPath = (name) => path.join(SHOTS, name);

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1155-r11');
  app = null;
  win = null;
});

test.setTimeout(240000);

const setSize = async (w, h) => {
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
};

const readBodies = () =>
  win.evaluate(() => {
    const rect = (el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
    };
    const overflow = (el) =>
      el ? { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth } : null;
    const nav = document.querySelector('.context-panel-body');
    const insp = document.querySelector('.inspector-body');
    const footer = document.querySelector('.view-strip');
    return {
      nav: nav ? rect(nav) : null,
      navOverflow: overflow(nav),
      navScroll: nav ? getComputedStyle(nav).overflowX : null,
      insp: insp ? rect(insp) : null,
      inspOverflow: overflow(insp),
      inspScroll: insp ? getComputedStyle(insp).overflowX : null,
      footer: footer ? rect(footer) : null,
      collapse: (() => {
        const el = document.querySelector('[data-inspector]');
        return el ? el.getAttribute('data-inspector-collapsed') : 'absent';
      })(),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  });

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

function assertAligned(label, body, footerTop) {
  expect(body, `${label} body present`).not.toBeNull();
  expect(Math.abs(body.bottom - footerTop), `${label} body bottom vs canvas footer top`).toBeLessThanOrEqual(2);
}

test('R11: navigator + inspector bodies stop at the shared baseline; no nested horizontal scroll', async () => {
  await win.click('.sample-card');
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(800);
  await setSize(1440, 900);
  await ensureInspectorExpanded();

  await win.waitForSelector('.context-panel-body', { timeout: 8000 });
  await win.waitForSelector('.inspector-body', { timeout: 8000 });
  await win.waitForSelector('.view-strip', { timeout: 8000 });
  await win.waitForTimeout(300);
  const s = await readBodies();
  console.log(`[tfl1155 r11] 1440x900 ${JSON.stringify(s)}`);

  expect(s.footer, 'canvas footer (view strip) present').not.toBeNull();
  assertAligned('Navigator', s.nav, s.footer.top);
  assertAligned('Inspector', s.insp, s.footer.top);
  expect(Math.abs(s.nav.bottom - s.insp.bottom), 'navigator and inspector share one baseline').toBeLessThanOrEqual(2);
  expect(s.navOverflow.scrollWidth, 'navigator body has no nested horizontal scroll').toBeLessThanOrEqual(s.navOverflow.clientWidth + 1);
  expect(s.inspOverflow.scrollWidth, 'inspector body has no nested horizontal scroll').toBeLessThanOrEqual(s.inspOverflow.clientWidth + 1);
  expect(s.navScroll, 'navigator body clips horizontal overflow').toBe('hidden');
  expect(s.inspScroll, 'inspector body clips horizontal overflow').toBe('hidden');

  await win.screenshot({ path: shotPath('tfl1116_r11_panels.png') });

  // 960x640: the compact width must still clip both panel bodies (no nested
  // horizontal scroll); the Inspector may be the compact drawer/collapsed strip.
  await setSize(960, 640);
  await win.waitForTimeout(600);
  const compact = await readBodies();
  console.log(`[tfl1155 r11] 960x640 ${JSON.stringify(compact)}`);
  expect(compact.nav, 'navigator body present at 960').not.toBeNull();
  expect(compact.navOverflow.scrollWidth, 'navigator body no h-scroll at 960').toBeLessThanOrEqual(compact.navOverflow.clientWidth + 1);
  if (compact.insp !== null) {
    expect(compact.inspOverflow.scrollWidth, 'inspector body no h-scroll at 960').toBeLessThanOrEqual(compact.inspOverflow.clientWidth + 1);
  }
});
