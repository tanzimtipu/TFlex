// TFL-1118 (TFL-1116 C1 / R01) focused QA verification: the compact Inspector
// drawer. R01 is an integration defect, so this drives the REAL Electron app
// (960x640 drawer width, 1280x800 wide regression). Launches ONLY through the
// canonical launchApp helper; qa-owned; read-only product checks.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

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
  if (app) await hardClose(app, 'tfl1118-r01');
  app = null;
  win = null;
});

test.setTimeout(240000);

const setSize = async (w, h) => {
  // The window launches MAXIMIZED on this host; setSize is ignored while
  // maximized, so unmaximize first (mirrors phase108_siderail.spec.cjs).
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

const readState = () =>
  win.evaluate(() => {
    const root = document.querySelector('[data-inspector]');
    const rect = root ? root.getBoundingClientRect() : null;
    const scroller = document.querySelector('.document-scroller');
    const workspace = document.querySelector('.workspace');
    const workspaceMain = document.querySelector('.workspace-main');
    const appMain = document.querySelector('.app-main');
    const opener = document.querySelector('[data-inspector-collapse]');
    const active = document.activeElement;
    return {
      exists: !!root,
      drawer: root ? root.getAttribute('data-inspector-drawer') : null,
      collapsed: root ? root.getAttribute('data-inspector-collapsed') : null,
      hasDrawerClass: root ? root.classList.contains('inspector-drawer') : false,
      closeCount: document.querySelectorAll('[data-inspector-close]').length,
      openers: document.querySelectorAll('[data-inspector-collapse]').length,
      collapseVisible: !!opener && opener.getBoundingClientRect().width > 0,
      activeIsCollapse: !!(active && active.hasAttribute && active.hasAttribute('data-inspector-collapse')),
      activeDesc: active ? `${active.tagName}${active.id ? '#' + active.id : ''}` : 'none',
      rect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null,
      scrollerW: scroller ? scroller.getBoundingClientRect().width : null,
      workspaceW: workspace ? workspace.getBoundingClientRect().width : null,
      workspaceMainW: workspaceMain ? workspaceMain.getBoundingClientRect().width : null,
      toolsInset: appMain ? getComputedStyle(appMain).getPropertyValue('--tf-tools-inset').trim() : null,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  });

test('TFL-1117 R01: compact drawer opens, overlays canvas unbounded, closes with focus return; wide unchanged', async () => {
  await win.click('.sample-card');
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(800);
  await setSize(960, 640);
  await win.waitForTimeout(500);

  // (1) Compact collapsed strip.
  await win.waitForSelector('[data-inspector]', { timeout: 8000 });
  let s = await readState();
  expect(s.exists, '(1) [data-inspector] exists').toBe(true);
  expect(s.drawer, '(1) data-inspector-drawer=false').toBe('false');
  expect(s.collapseVisible, '(1) [data-inspector-collapse] visible').toBe(true);
  await win.screenshot({ path: shotPath('tfl1117_r01_compact_collapsed.png') });
  const before = s;
  console.log(`[tfl1118] (1) compact inner=${s.innerWidth}x${s.innerHeight} drawer=${s.drawer} collapsed=${s.collapsed} scrollerW=${before.scrollerW} workspaceW=${before.workspaceW} workspaceMainW=${before.workspaceMainW} toolsInset=${before.toolsInset}`);

  // (2) Open the drawer with the Expand opener.
  const t0 = Date.now();
  await win.click('[data-inspector-collapse]');
  await win.waitForSelector('[data-inspector][data-inspector-drawer="true"]', { timeout: 500 });
  const openMs = Date.now() - t0;
  s = await readState();
  expect(s.drawer, '(2) data-inspector-drawer=true').toBe('true');
  expect(s.hasDrawerClass, '(2) root carries .inspector-drawer').toBe(true);
  expect(s.closeCount, '(2) [data-inspector-close] present in the drawer').toBeGreaterThan(0);
  console.log(`[tfl1118] (2) drawer open in ${openMs}ms (entrance animation may still run)`);

  // (3) The drawer overlays the canvas: it reserves NO grid column and never
  // narrows the page view, and it stays inside the 960x640 viewport. The
  // compact collapsed strip deliberately keeps a 44px launcher inset
  // (styles.css `.app-main[data-inspector-collapsed='true']`), so releasing it
  // when the overlay opens WIDENS the scroller; the decisive contracts are
  // (a) the drawer adds zero tools inset and (b) the canvas never narrows.
  // A 12px translateX ENTRANCE animation runs first, so measure the settled
  // rect (mid-animation rect is logged for the record).
  const mid = await readState();
  await win.waitForFunction(() => {
    const el = document.querySelector('[data-inspector][data-inspector-drawer="true"]');
    if (!el) return false;
    return el.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle');
  }, null, { timeout: 3000 });
  s = await readState();
  expect(s.scrollerW, '(3) scroller width measurable').not.toBeNull();
  expect(s.toolsInset, '(3) drawer reserves no grid column (--tf-tools-inset=0px)').toBe('0px');
  expect(s.scrollerW, '(3) canvas not narrowed by the drawer (>= collapsed width)').toBeGreaterThanOrEqual(before.scrollerW - 1);
  expect(s.rect.left, '(3) drawer left >= 0').toBeGreaterThanOrEqual(0);
  expect(s.rect.right, '(3) drawer right <= innerWidth').toBeLessThanOrEqual(s.innerWidth + 0.5);
  expect(s.rect.top, '(3) drawer top >= 0').toBeGreaterThanOrEqual(0);
  expect(s.rect.bottom, '(3) drawer bottom <= innerHeight').toBeLessThanOrEqual(s.innerHeight + 0.5);
  console.log(`[tfl1118] (3) rect(mid-anim)=${JSON.stringify(mid.rect)} rect(settled)=${JSON.stringify(s.rect)} inner=${s.innerWidth}x${s.innerHeight} scrollerBefore=${before.scrollerW} scrollerAfter=${s.scrollerW} workspaceBefore=${before.workspaceW} workspaceAfter=${s.workspaceW} toolsInset=${s.toolsInset}`);
  await win.screenshot({ path: shotPath('tfl1117_r01_compact_drawer_open.png') });

  // (4) Escape closes and returns focus to the Expand opener.
  await win.keyboard.press('Escape');
  await win.waitForFunction(() => document.querySelector('[data-inspector][data-inspector-drawer="true"]') === null, null, { timeout: 4000 });
  s = await readState();
  expect(s.drawer, '(4) drawer closed after Escape').toBe('false');
  expect(s.activeIsCollapse, '(4) focus returned to [data-inspector-collapse]').toBe(true);
  console.log(`[tfl1118] (4) activeElement=${s.activeDesc}`);

  // (5) Re-open, then close with the close control.
  await win.click('[data-inspector-collapse]');
  await win.waitForSelector('[data-inspector][data-inspector-drawer="true"]', { timeout: 4000 });
  await win.click('[data-inspector-close]');
  await win.waitForFunction(() => document.querySelector('[data-inspector][data-inspector-drawer="true"]') === null, null, { timeout: 4000 });
  s = await readState();
  expect(s.drawer, '(5) drawer closed by [data-inspector-close]').toBe('false');
  console.log('[tfl1118] (5) close control closed the drawer');

  // (6) Wide regression: the pre-existing expanded behaviour is unchanged.
  await setSize(1280, 800);
  await win.waitForTimeout(600);
  s = await readState();
  expect(s.drawer, '(6) wide: no drawer overlay').toBe('false');
  expect(s.hasDrawerClass, '(6) wide: no .inspector-drawer class').toBe(false);
  expect(s.collapsed, '(6) wide: Inspector renders expanded').toBe('false');
  console.log(`[tfl1118] (6) wide inner=${s.innerWidth} drawer=${s.drawer} collapsed=${s.collapsed} closeCount=${s.closeCount}`);
  await win.screenshot({ path: shotPath('tfl1117_r01_wide_1280.png') });
});
