// qa diagnostic: stamp resize via se handle â€” does the drag park a pending resize?
const { test } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

test('diag: stamp resize pending', async () => {
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForTimeout(1200);
  const card = win.locator('.sample-card:has-text("report.pdf")');
  await card.first().click();
  await win.waitForSelector('.pdf-page[data-page="1"]', { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  await win.click('[data-tool-id="stamp"]');
  await win.waitForSelector('[data-stamp-dialog]', { timeout: 10000 });
  await win.click('[data-stamp-confirm]');
  await win.waitForTimeout(500);
  await win.click('[data-tools-toggle]');
  await win.waitForTimeout(300);
  const page = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vh = await win.evaluate(() => window.innerHeight);
  const visTop = Math.max(page.y, 80);
  const visBot = Math.min(page.y + page.height, vh - 40);
  await win.mouse.click(page.x + page.width * 0.45, visTop + (visBot - visTop) * 0.5);
  await win.waitForSelector('.stamp-annotation', { timeout: 10000 });
  await win.waitForTimeout(1200);

  const b0 = await win.locator('.stamp-annotation').first().boundingBox();
  console.log('[diag] stamp bbox before =', JSON.stringify(b0));

  // select
  await win.locator('.stamp-annotation').first().click();
  await win.waitForTimeout(400);
  const handle = win.locator('[data-stamp-resize-handle="se"]');
  console.log('[diag] handle count =', await handle.count());
  const hb = await handle.boundingBox();
  console.log('[diag] se handle bbox =', JSON.stringify(hb));

  // drag the handle +40/+30 with fine steps
  await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await win.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await win.mouse.move(hb.x + hb.width / 2 + (40 * i) / 12, hb.y + hb.height / 2 + (30 * i) / 12);
    await win.waitForTimeout(30);
  }
  await win.mouse.up();
  await win.waitForTimeout(400);

  const midState = await win.evaluate(() => {
    const s = document.querySelector('.stamp-annotation');
    const btn = document.querySelector('[data-content-action="stamp-confirm"]');
    const toasts = [...document.querySelectorAll('.toast')].map((t) => (t.textContent || '').slice(0, 80));
    return {
      stampCls: s?.className,
      stampW: s ? s.getBoundingClientRect().width : null,
      confirmTitle: btn?.getAttribute('title'),
      toasts,
      barPresent: !!document.querySelector('[data-content-action-bar="stamp"]'),
    };
  });
  console.log('[diag] mid state after drag =', JSON.stringify(midState, null, 1));
  await win.screenshot({ path: 'screenshots/qa-diag-resize-pending.png' });

  // confirm
  const btn = win.locator('[data-content-action="stamp-confirm"]');
  if (await btn.count()) {
    await btn.click();
    await win.waitForTimeout(2500);
  }
  const b1 = await win.locator('.stamp-annotation').first().boundingBox();
  console.log('[diag] stamp bbox after confirm =', JSON.stringify(b1));
  const endToasts = await win.evaluate(() =>
    [...document.querySelectorAll('.toast')].map((t) => (t.textContent || '').slice(0, 100)),
  );
  console.log('[diag] toasts after confirm =', JSON.stringify(endToasts));
  await win.screenshot({ path: 'screenshots/qa-diag-resize-confirmed.png' });
  // --- RETYPE via Edit (Bug 6, resize excluded — filed separately) ---
  await win.locator('.stamp-annotation').first().click();
  await win.waitForTimeout(400);
  await win.click('[data-content-action="stamp-edit"]');
  await win.waitForSelector('[data-stamp-type-editor]', { timeout: 10000 });
  await win.click('[data-stamp-type-btn="DRAFT"]');
  await win.waitForTimeout(2000);
  const draftCount = await win.locator('.stamp-annotation[data-stamp-id="DRAFT"]').count();
  console.log('[diag] retype -> DRAFT count =', draftCount);

  // --- DELETE ---
  await win.locator('.stamp-annotation').first().click();
  await win.waitForTimeout(400);
  await win.click('[data-content-action="stamp-delete"]');
  await win.waitForTimeout(2000);
  const afterDelete = await win.locator('.stamp-annotation').count();
  console.log('[diag] after delete .stamp-annotation count =', afterDelete);
  await hardClose(electronApp, 'diag');
});
