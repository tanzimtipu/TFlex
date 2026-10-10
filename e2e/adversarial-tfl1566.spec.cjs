// Adversarial testing for TFL-1566 - rotation geometry attacks
// Uses report.pdf which has standard A4 pages
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage, ensurePanelExpanded, setTheme, shot, openSamplePath } = require('./lib/helpers.cjs');

test.setTimeout(300000);

async function measureCard(win, pageSel) {
  return win.evaluate((sel) => {
    const card = document.querySelector(sel);
    if (!card) return null;
    const rect = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height, cx: b.left + b.width/2, cy: b.top + b.height/2 };
    };
    const wrap = card.querySelector('.thumb-canvas-wrap');
    const frame = card.querySelector('.thumb-frame');
    const overlay = card.querySelector('.thumb-overlay');
    const preview = card.querySelector('.thumb-page');
    const cs = overlay ? getComputedStyle(overlay) : null;
    return {
      card: rect(card),
      wrap: rect(wrap),
      frame: rect(frame),
      overlay: rect(overlay),
      preview: rect(preview),
      overlayBg: cs?.backgroundColor,
      overlayFilter: cs?.backdropFilter || cs?.webkitBackdropFilter || 'none',
      label: card.querySelector('.thumb-label')?.textContent,
    };
  }, pageSel);
}

function contained(inner, outer, tol = 2) {
  if (!inner || !outer) return false;
  return (
    inner.left >= outer.left - tol &&
    inner.right <= outer.right + tol &&
    inner.top >= outer.top - tol &&
    inner.bottom <= outer.bottom + tol
  );
}

// Attack 1: Rapid rotation spam - should not crash or lose containment
test('ADV-001: Rapid rotation spam - 10 clicks in 2 seconds', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 1);
    await ensurePanelExpanded(win);
    const CARD = '.thumb-item[data-page="1"]';
    for (let i = 0; i < 10; i++) {
      await win.locator(CARD).locator('[data-thumb-more]').click();
      const menu = win.locator('[data-page-menu="card"]');
      await menu.waitFor({ state: 'visible', timeout: 5000 });
      await menu.locator('[data-menu-item="rotate-cw"]').click();
      await win.waitForTimeout(150);
    }
    await win.waitForTimeout(2000);
    const m = await measureCard(win, CARD);
    console.log('[ADV-001 spam]', JSON.stringify(m));
    if (!m || !m.card) {
      await shot(win, 'adv-001-crash.png');
      throw new Error('Card disappeared after spam');
    }
    expect(contained(m.wrap, m.card)).toBe(true);
  } finally {
    await hardClose(app, 'adv-001-rotation-spam');
  }
});

// Attack 2: Drag-control guard - press on More should NOT start drag
test('ADV-002: Drag-control guard', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 1);
    await ensurePanelExpanded(win);
    const CARD = '.thumb-item[data-page="1"]';
    const moreBtn = win.locator(CARD).locator('[data-thumb-more]');
    const moreBox = await moreBtn.boundingBox();
    await win.mouse.move(moreBox.x + moreBox.width/2, moreBox.y + moreBox.height/2);
    await win.mouse.down();
    await win.mouse.move(moreBox.x + 50, moreBox.y + 50);
    await win.mouse.up();
    const dropLine = win.locator('[data-thumb-drop-line]');
    if (await dropLine.isVisible()) {
      await shot(win, 'adv-002-guard-fail.png');
      throw new Error('Drag started from More button');
    }
  } finally {
    await hardClose(app, 'adv-002-drag-guard');
  }
});

// Attack 3: Checkbox control should not trigger drag
test('ADV-003: Checkbox drag guard', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 1);
    await ensurePanelExpanded(win);
    const CARD = '.thumb-item[data-page="1"]';
    const checkbox = win.locator(CARD).locator('[data-thumb-checkbox]');
    const box = await checkbox.boundingBox();
    await win.mouse.move(box.x + box.width/2, box.y + box.height/2);
    await win.mouse.down();
    await win.mouse.move(box.x + 50, box.y + 50);
    await win.mouse.up();
    const dropLine = win.locator('[data-thumb-drop-line]');
    if (await dropLine.isVisible()) {
      await shot(win, 'adv-003-checkbox-guard-fail.png');
      throw new Error('Drag started from checkbox');
    }
  } finally {
    await hardClose(app, 'adv-003-checkbox-guard');
  }
});

// Attack 4: Overlay centering at all rotations
test('ADV-004: Overlay centering at 0/90/180/270', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 1);
    await ensurePanelExpanded(win);
    const CARD = '.thumb-item[data-page="1"]';
    for (const rot of [0, 90, 180, 270]) {
      if (rot > 0) {
        await win.locator(CARD).locator('[data-thumb-more]').click();
        await win.locator('[data-page-menu="card"]').locator('[data-menu-item="rotate-cw"]').click();
        await win.waitForTimeout(1200);
      }
      const m = await measureCard(win, CARD);
      console.log('[ADV-004 rot' + rot + ']', JSON.stringify(m));
      if (!m.overlay || !m.preview) {
        await shot(win, 'adv-004-missing-overlay.png');
        throw new Error('Overlay missing at rot' + rot);
      }
      const offset = Math.abs(m.overlay.cx - m.preview.cx);
      if (offset > 2) {
        await shot(win, 'adv-004-overlay-off-' + rot + '.png');
        throw new Error('Overlay not centered at rot' + rot + ' (offset=' + offset + ')');
      }
      expect(contained(m.overlay, m.preview)).toBe(true);
    }
  } finally {
    await hardClose(app, 'adv-004-overlay-centering');
  }
});

// Attack 5: Theme switching during rotation
test('ADV-005: Theme switch during rotation', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 1);
    await ensurePanelExpanded(win);
    const CARD = '.thumb-item[data-page="1"]';
    await win.locator(CARD).locator('[data-thumb-more]').click();
    await win.locator('[data-page-menu="card"]').locator('[data-menu-item="rotate-cw"]').click();
    await win.waitForTimeout(1000);
    // Switch themes mid-rotation
    for (const theme of ['light', 'dark', 'frosted', 'light', 'dark']) {
      await setTheme(win, theme);
      await win.waitForTimeout(300);
      const m = await measureCard(win, CARD);
      if (!m || !m.wrap) {
        await shot(win, 'adv-005-theme-fail.png');
        throw new Error('Card broken during theme switch');
      }
    }
  } finally {
    await hardClose(app, 'adv-005-theme-switch');
  }
});

// Attack 6: Multiple pages rotation
test('ADV-006: Multi-page rotation containment', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 1);
    await ensurePanelExpanded(win);
    // Rotate pages 1, 2, 3
    for (const page of [1, 2, 3]) {
      const CARD = '.thumb-item[data-page="' + page + '"]';
      await win.locator(CARD).locator('[data-thumb-more]').click();
      await win.locator('[data-page-menu="card"]').locator('[data-menu-item="rotate-cw"]').click();
      await win.waitForTimeout(800);
    }
    await win.waitForTimeout(1500);
    // Check all 3 pages
    for (const page of [1, 2, 3]) {
      const CARD = '.thumb-item[data-page="' + page + '"]';
      const m = await measureCard(win, CARD);
      console.log('[ADV-006 page' + page + ']', JSON.stringify(m));
      if (!contained(m.wrap, m.card)) {
        await shot(win, 'adv-006-page' + page + '-spill.png');
        throw new Error('Page ' + page + ' wrap spills');
      }
    }
  } finally {
    await hardClose(app, 'adv-006-multi-page');
  }
});

// Attack 7: Label text-shadow halo present
test('ADV-007: Label halo legibility', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 1);
    await ensurePanelExpanded(win);
    const CARD = '.thumb-item[data-page="1"]';
    const labelStyle = await win.evaluate((sel) => {
      const label = document.querySelector(sel + ' .thumb-label');
      if (!label) return null;
      const cs = getComputedStyle(label);
      return { textShadow: cs.textShadow, fontWeight: cs.fontWeight };
    }, CARD);
    console.log('[ADV-007 label]', labelStyle);
    // textShadow should have 2 layers
    expect(labelStyle.textShadow.split(',').length).toBeGreaterThanOrEqual(2);
    expect(labelStyle.fontWeight).toBe('500');
  } finally {
    await hardClose(app, 'adv-007-label-halo');
  }
});
