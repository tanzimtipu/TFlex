'use strict';
// TFL-524 adversary — is the "+"-centre wrong-target click pre-existing or
// introduced by TFL-524? Inject the pre-fix CSS BEFORE the raw click and
// observe the result. Run:
//   node test-fixtures/tfl524-adversary/probe-plus-prefix-click.cjs

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

function snapshot(win) {
  return win.evaluate(() => {
    const plus = document.querySelector('[data-new-tab]');
    const b = plus.getBoundingClientRect();
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return {
      count: tabs.length,
      active: (tabs.find((t) => t.getAttribute('aria-selected') === 'true') || { getAttribute: () => null }).getAttribute('data-tab-id'),
      cx: +(b.left + b.width / 2).toFixed(2), cy: +(b.top + b.height / 2).toFixed(2),
      hit: hit && hit.closest ? (hit.closest('[data-new-tab]') ? 'plus' : hit.closest('.tab-close') ? 'close' : hit.closest('[data-tab-id]') ? 'tab' : hit.tagName) : 'none',
    };
  });
}

(async () => {
  const app = await launchApp([], path.join(os.tmpdir(), `tfl524-prefixclick-${Date.now()}`));
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(300);
    await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForTimeout(1000);
    let guard = 0;
    while ((await win.locator('[data-tab-id]').count()) < 14 && guard < 30) {
      guard += 1;
      const plus = win.locator('[data-new-tab]');
      if ((await plus.count()) === 0) break;
      await plus.first().click({ timeout: 4000 }).catch(() => {});
      await win.waitForTimeout(250);
    }
    await setSize(app, 640, 800);
    await win.waitForTimeout(300);

    const injected = await win.addStyleTag({ content: PREFIX_CSS });
    await win.waitForTimeout(300);
    const before = await snapshot(win);
    await win.mouse.click(before.cx, before.cy);
    await win.waitForTimeout(600);
    const after = await snapshot(win);
    console.log(`[prefix-click] hitAtCentre=${before.hit} before=${JSON.stringify({ count: before.count, active: before.active })} after=${JSON.stringify({ count: after.count, active: after.active })}`);
    console.log(`[prefix-click] verdict=${after.count === before.count + 1 ? 'opened a tab (OK)' : after.count === before.count - 1 ? 'CLOSED a tab (WRONG TARGET)' : 'no change'}`);
    await injected.evaluate((el) => el.remove()).catch(() => {});
  } finally {
    await hardClose(app, 'prefixclick');
  }
})();
