// ADV phase-34: capture the uneven-split panel screenshot.
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');
(async () => {
  let app;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(300);
    const a = C.tmpCopy(C.REPORT, 'adv34-shot-alpha.pdf');
    const b = C.tmpCopy(C.LONG, 'adv34-shot-beta.pdf');
    await C.openFile(app, win, a); await win.waitForTimeout(700);
    await C.openFile(app, win, b); await win.waitForTimeout(700);
    await win.locator('.tab[data-tab-id]').filter({ hasText: 'adv34-shot-alpha' }).first().click(); await win.waitForTimeout(300);
    await win.locator('[data-toolbar-multi-mode]:visible').first().click(); await win.waitForTimeout(500);
    await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'adv34-shot-beta' }).first().click(); await win.waitForTimeout(1600);
    const box = await win.locator('[data-multi-divider]').boundingBox();
    const st = await win.locator('.tab-stage').boundingBox();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await win.mouse.down();
    await win.mouse.move(st.x + st.width * 0.35, box.y + box.height / 2, { steps: 12 }); await win.mouse.up(); await win.waitForTimeout(400);
    await win.locator('[data-tools-badge]').first().click();
    await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
    await win.waitForTimeout(900);
    await win.screenshot({ path: 'screenshots/adv-p34-uneven-panel.png' });
    console.log('shot taken');
  } catch (e) { console.error('ERR', e.message); }
  finally { if (app) await hardClose(app, 'p34-shot').catch(() => {}); }
})();