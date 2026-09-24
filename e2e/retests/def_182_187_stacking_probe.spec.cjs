// qa probe for DEF-182..DEF-187 retest: what exactly is stacked under the
// free-glass sample points, and what does the window composite look like.
// Launches via the canonical launcher, opens report.pdf, zooms to 400%,
// opens the Tools palette (list), then reports elementsFromPoint stacks at:
//   titlebar free glass (700, 17), toolbar free glass (560, 56),
//   rail left interior (30, 400), palette right interior (1390, 400),
//   left gutter (8, 400), bottom-right gutter (1432, 854)
// plus html/body/app computed backgrounds and the maximized state.
const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test('stacking probe under glass sample points', async () => {
  test.setTimeout(300000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  await electronApp.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const disp = screen.getPrimaryDisplay();
    const width = 1440, height = 860;
    w.setBounds({
      x: disp.workArea.x + Math.round((disp.workArea.width - width) / 2),
      y: disp.workArea.y + Math.round((disp.workArea.height - height) / 2),
      width, height,
    });
    w.focus();
  });
  await win.waitForTimeout(500);

  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  for (let i = 0; i < 45; i += 1) {
    const z = await win.evaluate(() => parseFloat(document.querySelector('.zoom-percent')?.textContent || '0'));
    if (z >= 370) break;
    await win.click('button[title="Zoom in"]');
    await win.waitForTimeout(80);
  }
  // Phase 36 migration: All-tools palette retired; the ContextPanel is present
  // with a document open, so just let the surfaces settle.
  await win.waitForSelector('[data-context-panel]', { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(600);

  const probe = await win.evaluate(() => {
    const describe = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60) || null,
        bg: cs.backgroundColor,
        bgImage: cs.backgroundImage === 'none' ? null : cs.backgroundImage.slice(0, 90),
        opacity: cs.opacity,
        backdropFilter: cs.backdropFilter !== 'none' ? cs.backdropFilter : (cs.webkitBackdropFilter !== 'none' ? cs.webkitBackdropFilter : null),
        radius: cs.borderRadius,
        z: cs.zIndex,
        pos: cs.position,
      };
    };
    const points = {
      titlebarFree: [700, 17],
      toolbarFree: [560, 56],
      railLeftInterior: [30, 400],
      paletteRightInterior: [1390, 400],
      leftGutter: [8, 400],
      bottomRightGutter: [1432, 854],
    };
    const stacks = {};
    for (const [name, [x, y]] of Object.entries(points)) {
      stacks[name] = document.elementsFromPoint(x, y).slice(0, 8).map(describe);
    }
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const app = document.querySelector('.app');
    const appCs = getComputedStyle(app);
    return {
      stacks,
      rootBg: root.backgroundColor,
      bodyBg: body.backgroundColor,
      appBg: appCs.backgroundColor,
      appRadius: appCs.borderRadius,
      appOverflow: appCs.overflow,
      maximized: app.className.includes('app-maximized'),
      innerSize: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
      titlebarRect: document.querySelector('.titlebar')?.getBoundingClientRect().toJSON(),
      tabStripRowBg: describe(document.querySelector('.titlebar-tabs, .tab-strip, .tabs-row')),
    };
  });
  fs.writeFileSync(path.join(SHOTS, 'def182-187-stacking-probe.json'), JSON.stringify(probe, null, 2));
  console.log(JSON.stringify(probe, null, 1).slice(0, 6000));
  await electronApp.close();
});
