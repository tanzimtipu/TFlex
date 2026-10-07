// TFL-1191 phase-close — light timing only (read-only, qa-owned).
// Times the two scenarios the TFL-1146 close names at 960x640 DIP:
//   1. the resize-anchor restore (restore from maximized to 960x640 while
//      reading page 10) — wall-clock from the resize dispatch to the first
//      frame whose page-10 top has been stable for three animation frames;
//   2. the compact Navigator drawer open — wall-clock from the
//      `[data-rail-collapse]` activation to the drawer element being present.
// No product source is modified; launches ONLY through launchApp.
delete process.env.ELECTRON_RUN_AS_NODE;

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

let app = null;
let win = null;
test.setTimeout(180000);

async function setSize(w, h) {
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw.isMaximized()) bw.unmaximize();
  });
  await win.waitForTimeout(400);
  await app.evaluate(({ BrowserWindow }, s) => {
    BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]);
  }, [w, h]);
  await win.waitForFunction((s) => Math.abs(window.innerWidth - s) < 60, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(600);
}

async function openReport() {
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1400);
}

async function goToPage10() {
  const input = win.locator('input.page-input[aria-label="Current page"]').first();
  await input.click();
  await input.fill('');
  await input.fill('10');
  await input.press('Enter');
  await win.waitForTimeout(1500);
  return input.inputValue();
}

// Install a per-frame sampler of page 10's top so a "settled" frame can be
// detected without a fixed delay.
async function armSampler() {
  await win.evaluate(() => {
    window.__topHist = [];
    const tick = () => {
      const slot = document.querySelector('.page-slot[data-page="10"]');
      window.__topHist.push(slot ? Math.round(slot.getBoundingClientRect().top) : null);
      if (window.__topHist.length > 12) window.__topHist.shift();
      window.__raf = requestAnimationFrame(tick);
    };
    window.__raf = requestAnimationFrame(tick);
  });
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1191-perf');
  app = null;
  win = null;
});

test('TFL-1146 phase-close light timing: resize-anchor restore and compact drawer open at 960x640', async () => {
  await openReport();
  await setSize(960, 640);
  await win.waitForTimeout(600);
  expect(await goToPage10(), 'reached page 10').toBe('10');

  const restoreMs = [];
  for (let i = 0; i < 3; i += 1) {
    await setSize(981, 641);
    await win.waitForTimeout(500);
    await armSampler();
    const t0 = Date.now();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(960, 640);
    });
    await win.waitForFunction(() => {
      const h = window.__topHist || [];
      if (h.length < 4) return false;
      const last = h[h.length - 1];
      if (last === null) return false;
      return h.slice(-4).every((x) => x === last);
    }, null, { polling: 'raf', timeout: 8000 });
    restoreMs.push(Date.now() - t0);
    await win.waitForTimeout(400);
  }
  const footer = await win.locator('input.page-input[aria-label="Current page"]').first().inputValue();
  console.log(`[tfl1191-perf] resize-anchor restore samples=${JSON.stringify(restoreMs)} median=${median(restoreMs)}ms settledFooter=${footer}`);
  expect(footer, 'AR-01 the anchor held across the timed resizes').toBe('10');
  expect(median(restoreMs), 'resize-anchor restore completed').toBeLessThan(2500);

  // Compact drawer open: normalize to collapsed, then time trigger -> drawer.
  const drawerOpen = win.locator('[data-context-panel][data-context-panel-drawer="true"]');
  if ((await drawerOpen.count()) > 0) {
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);
  }
  const openMs = [];
  for (let i = 0; i < 3; i += 1) {
    const t0 = Date.now();
    await win.locator('[data-rail-collapse]').first().click();
    await win.waitForSelector('[data-context-panel][data-context-panel-drawer="true"]', { timeout: 6000 });
    openMs.push(Date.now() - t0);
    await win.keyboard.press('Escape');
    await win.waitForFunction(
      () => document.querySelector('[data-context-panel][data-context-panel-drawer="true"]') === null,
      null,
      { timeout: 6000 },
    );
    await win.waitForTimeout(250);
  }
  console.log(`[tfl1191-perf] compact drawer open samples=${JSON.stringify(openMs)} median=${median(openMs)}ms`);
  expect(median(openMs), 'compact drawer opened').toBeLessThan(2500);
});
