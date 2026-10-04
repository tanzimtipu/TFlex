'use strict';
// TFL-524 adversary — focused probe: does the colorful tab change make the
// "+" control unclickable (occluded by the active tab's close button) at the
// 640px minimum with many tabs, and is that caused by TFL-524 vs a pre-existing
// horizontal squeeze?
//
// Tabs are added at the default (wide) window, THEN the window is resized to
// 640px — mirroring a real user who opens many tabs and then narrows the
// window. Run: node test-fixtures/tfl524-adversary/probe-plus-occlusion.cjs

const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');

const PREFIX_CSS = `
  .tab-area[data-tab-style="colorful"] .tab-list { align-items: center !important; }
  .tab-area[data-tab-style="colorful"] .tab-list > li[data-tab-active="true"] { align-self: flex-end !important; }
  .tab-area[data-tab-style="colorful"] .tab-active { height: 30px !important; }
`;

async function setSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (!bw) return;
    bw.unmaximize();
    bw.setSize(s.w, s.h);
  }, { w, h });
  await new Promise((r) => setTimeout(r, 500));
}

function sample(win) {
  return win.evaluate(() => {
    const plus = document.querySelector('[data-new-tab]');
    const active = document.querySelector('[data-tab-id][aria-selected="true"]');
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2), left: +b.left.toFixed(2), right: +b.right.toFixed(2), height: +b.height.toFixed(2), width: +b.width.toFixed(2) }; };
    const classify = (el) => {
      if (!el) return 'none';
      if (el.closest('[data-new-tab]')) return 'plus';
      if (el.closest('.tab-close')) return 'close';
      if (el.closest('[data-tab-id]')) return 'tab';
      return el.tagName ? el.tagName.toLowerCase() : 'none';
    };
    const plusRect = plus ? r(plus) : null;
    let grid = [];
    if (plusRect) {
      for (let iy = 1; iy <= 4; iy += 1) {
        for (let ix = 1; ix <= 4; ix += 1) {
          const x = plusRect.left + (plusRect.width * ix) / 5;
          const y = plusRect.top + (plusRect.height * iy) / 5;
          grid.push(classify(document.elementFromPoint(x, y)));
        }
      }
    }
    const activeClose = active ? active.querySelector('.tab-close') : null;
    return {
      count: document.querySelectorAll('[data-tab-id]').length,
      tabWidth: active ? +active.getBoundingClientRect().width.toFixed(2) : null,
      plus: plusRect,
      activeTab: active ? r(active) : null,
      activeClose: activeClose ? r(activeClose) : null,
      centerHit: plusRect ? classify(document.elementFromPoint(plusRect.left + plusRect.width / 2, plusRect.top + plusRect.height / 2)) : 'none',
      plusHitCount: grid.filter((g) => g === 'plus').length,
      grid,
    };
  });
}

async function runCount(target) {
  const app = await launchApp([], path.join(os.tmpdir(), `tfl524-occl${target}-${Date.now()}`));
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(300);
    await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForTimeout(1000);
    // Add tabs at the WIDE window (where "+" is reachable).
    let guard = 0;
    while ((await win.locator('[data-tab-id]').count()) < target && guard < 30) {
      guard += 1;
      const plus = win.locator('[data-new-tab]');
      if ((await plus.count()) === 0) break;
      await plus.first().click({ timeout: 4000 }).catch(() => {});
      await win.waitForTimeout(250);
    }
    await setSize(app, 640, 800);
    await win.waitForTimeout(300);

    const fixed = await sample(win);
    const injected = await win.addStyleTag({ content: PREFIX_CSS });
    await win.waitForTimeout(300);
    const pre = await sample(win);
    await injected.evaluate((el) => el.remove()).catch(() => {});
    await win.waitForTimeout(200);

    console.log(`\n[occl n=${target}] fixed: count=${fixed.count} tabW=${fixed.tabWidth} centerHit=${fixed.centerHit} plusHits=${fixed.plusHitCount}/16`);
    console.log(`[occl n=${target}] fixed plus=${JSON.stringify(fixed.plus)} activeTab=${JSON.stringify(fixed.activeTab)} activeClose=${JSON.stringify(fixed.activeClose)}`);
    console.log(`[occl n=${target}] fixed grid=${JSON.stringify(fixed.grid)}`);
    console.log(`[occl n=${target}] PRE-FIX: centerHit=${pre.centerHit} plusHits=${pre.plusHitCount}/16 activeTop=${pre.activeTab && pre.activeTab.top} activeClose=${JSON.stringify(pre.activeClose)}`);

    // Hostile raw-coordinate click at the "+" centre (bypasses Playwright
    // actionability, exactly what a user's pointer hits).
    const cx = fixed.plus.left + fixed.plus.width / 2;
    const cy = fixed.plus.top + fixed.plus.height / 2;
    const before = await win.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
      return { count: tabs.length, active: (tabs.find((t) => t.getAttribute('aria-selected') === 'true') || {}).getAttribute ? tabs.find((t) => t.getAttribute('aria-selected') === 'true').getAttribute('data-tab-id') : null };
    });
    await win.mouse.click(cx, cy);
    await win.waitForTimeout(600);
    const after = await win.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
      return { count: tabs.length, active: (tabs.find((t) => t.getAttribute('aria-selected') === 'true') || {}).getAttribute ? tabs.find((t) => t.getAttribute('aria-selected') === 'true').getAttribute('data-tab-id') : null };
    });
    const verdict = after.count === before.count + 1 ? 'opened a tab (OK)'
      : after.count === before.count - 1 ? 'CLOSED a tab (WRONG TARGET)'
        : after.count === before.count ? 'no count change' : `unexpected ${before.count}->${after.count}`;
    console.log(`[click n=${target}] raw click at + centre (${cx.toFixed(1)},${cy.toFixed(1)}): before=${JSON.stringify(before)} after=${JSON.stringify(after)} -> ${verdict}`);

    await win.screenshot({ path: path.join(__dirname, `occlusion-${target}.png`) }).catch(() => {});
  } finally {
    await hardClose(app, `occl${target}`);
  }
}

(async () => {
  for (const n of [11, 14]) {
    try { await runCount(n); } catch (e) { console.log(`[occl n=${n}] threw: ${e.message}`); }
  }
})();
