// TFL-1588 (QA for TFL-1585) - the PAGES navigator page-preview card (card
// mode, SideRail.tsx): the border rotates WITH the page and the footer
// controls sit transparent + horizontally centered on the preview.
//
// Launches only through the canonical launchApp helper. Opens report.pdf from
// Home, shows the PAGES ContextPanel, rotates page 1 90deg through the card's
// real More menu, then asserts, for light/dark/frosted:
//   1. the rotated `.thumb-canvas-wrap` visual bounding box is contained by the
//      card (`.thumb-frame` sizes the layout box to the rotated footprint), so
//      nothing spills outside the card;
//   2. the footer controls render, `.thumb-overlay` is transparent
//      (background rgba(0,0,0,0), backdrop-filter none) and the row is
//      horizontally centered over the preview.
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const {
  openSamplePath,
  hardClose,
  gotoStage,
  ensurePanelExpanded,
  setTheme,
  shot,
} = require('./lib/helpers.cjs');

const CARD = '.thumb-item[data-page="1"]';
const TOL = 1.5;

test.setTimeout(240000);

// Measure the real geometry + computed style of page 1's preview card.
async function measure(win) {
  return win.evaluate((cardSel) => {
    const card = document.querySelector(cardSel);
    if (!card) return null;
    const rect = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        left: b.left,
        top: b.top,
        right: b.right,
        bottom: b.bottom,
        width: b.width,
        height: b.height,
        cx: b.left + b.width / 2,
      };
    };
    const wrap = card.querySelector('.thumb-canvas-wrap');
    const frame = card.querySelector('.thumb-frame');
    const overlay = card.querySelector('.thumb-overlay');
    const preview = card.querySelector('.thumb-page');
    const cs = overlay ? getComputedStyle(overlay) : null;
    return {
      className: card.className,
      card: rect(card),
      wrap: rect(wrap),
      frame: rect(frame),
      overlay: rect(overlay),
      preview: rect(preview),
      overlayBackground: cs ? cs.backgroundColor : null,
      overlayBackdropFilter: cs ? cs.backdropFilter || cs.webkitBackdropFilter || 'none' : null,
      controls: {
        checkbox: !!card.querySelector('[data-thumb-checkbox]'),
        label: !!card.querySelector('.thumb-label'),
        viewing: !!card.querySelector('[data-thumb-viewing]'),
        more: !!card.querySelector('[data-thumb-more]'),
      },
    };
  }, CARD);
}

function contained(inner, outer, tol = TOL) {
  return (
    inner.left >= outer.left - tol &&
    inner.right <= outer.right + tol &&
    inner.top >= outer.top - tol &&
    inner.bottom <= outer.bottom + tol
  );
}

test('TFL-1588 rotated preview border + transparent centered controls (light/dark/frosted)', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 1);
    await ensurePanelExpanded(win);

    const card = win.locator(CARD);
    await card.waitFor({ state: 'visible', timeout: 30000 });
    // Card mode (thumbVerbs wired) is the only mode with the footer overlay.
    await expect(card).toHaveClass(/thumb-card/);
    await expect(card).toHaveClass(/thumb-current/);
    await expect(card.locator('[data-thumb-checkbox]')).toBeVisible();
    await expect(card.locator('.thumb-label')).toBeVisible();
    await expect(card.locator('[data-thumb-viewing]')).toBeVisible();
    await expect(card.locator('[data-thumb-more]')).toBeVisible();

    // Rotate page 1 90deg through the card's real More menu.
    await card.locator('[data-thumb-more]').click();
    const menu = win.locator('[data-page-menu="card"]');
    await menu.waitFor({ state: 'visible', timeout: 8000 });
    await menu.locator('[data-menu-item="rotate-cw"]').click();
    await expect(card).toHaveClass(/thumb-rot-90/, { timeout: 10000 });
    await win.waitForTimeout(900);

    for (const theme of ['light', 'dark', 'frosted']) {
      await setTheme(win, theme);
      await win.waitForTimeout(500);
      const m = await measure(win);
      console.log(`[TFL-1588 ${theme}] ${JSON.stringify(m)}`);
      expect(m, `${theme}: page 1 card measured`).not.toBeNull();
      expect(m.className, `${theme}: page 1 carries thumb-rot-90`).toContain('thumb-rot-90');

      // 1. The rotated visual bbox + the sizing frame stay inside the card.
      expect(contained(m.wrap, m.card), `${theme}: rotated page wrap spills outside the card`).toBe(true);
      expect(contained(m.frame, m.card), `${theme}: sizing frame spills outside the card`).toBe(true);
      expect(m.wrap.width, `${theme}: rotated wrap is not landscape`).toBeGreaterThan(m.wrap.height - TOL);

      // 2. Controls render; overlay transparent; row centered over the preview.
      expect(m.controls, `${theme}: footer controls missing`).toEqual({
        checkbox: true,
        label: true,
        viewing: true,
        more: true,
      });
      expect(m.overlayBackground, `${theme}: overlay has an opaque background`).toBe('rgba(0, 0, 0, 0)');
      expect(m.overlayBackdropFilter, `${theme}: overlay still blurs`).toBe('none');
      expect(contained(m.overlay, m.preview), `${theme}: control row overhangs the preview`).toBe(true);
      expect(
        Math.abs(m.overlay.cx - m.preview.cx),
        `${theme}: control row is not centered over the preview`,
      ).toBeLessThanOrEqual(2);

      await shot(win, `tfl1588-preview-rot90-${theme}.png`);
    }
  } finally {
    await hardClose(app, 'tfl1588-preview-border-rotation');
  }
});

// TFL-1631 — the card's More menu exposes only `rotate-cw`, so 180deg and
// 270deg are reached by repeating the real CW action 2x / 3x. These two extra
// tests assert the SAME containment + transparency + centeredness properties
// for the non-90 quarter/half turns.
const ROT = {
  90: { cls: /thumb-rot-90/, quarter: true },
  180: { cls: /thumb-rot-180/, quarter: false },
  270: { cls: /thumb-rot-270/, quarter: true },
};

async function rotatePage1Clocked(win, turns) {
  const card = win.locator(CARD);
  await card.waitFor({ state: 'visible', timeout: 30000 });
  await expect(card).toHaveClass(/thumb-card/);
  await expect(card).toHaveClass(/thumb-current/);
  await expect(card.locator('[data-thumb-checkbox]')).toBeVisible();
  await expect(card.locator('.thumb-label')).toBeVisible();
  await expect(card.locator('[data-thumb-viewing]')).toBeVisible();
  await expect(card.locator('[data-thumb-more]')).toBeVisible();
  for (let i = 0; i < turns; i += 1) {
    await card.locator('[data-thumb-more]').click();
    const menu = win.locator('[data-page-menu="card"]');
    await menu.waitFor({ state: 'visible', timeout: 8000 });
    await menu.locator('[data-menu-item="rotate-cw"]').click();
    await win.waitForTimeout(700);
  }
}

async function assertRotatedCard(win, deg) {
  const card = win.locator(CARD);
  await expect(card).toHaveClass(ROT[deg].cls, { timeout: 10000 });
  await win.waitForTimeout(900);

  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(win, theme);
    await win.waitForTimeout(500);
    const m = await measure(win);
    console.log(`[TFL-1631 rot${deg} ${theme}] ${JSON.stringify(m)}`);
    expect(m, `${theme}: page 1 card measured`).not.toBeNull();
    expect(m.className, `${theme}: page 1 carries thumb-rot-${deg}`).toContain(`thumb-rot-${deg}`);

    // 1. The rotated visual bbox + the sizing frame stay inside the card.
    expect(contained(m.wrap, m.card), `${theme}: rotated page wrap spills outside the card`).toBe(true);
    expect(contained(m.frame, m.card), `${theme}: sizing frame spills outside the card`).toBe(true);
    if (ROT[deg].quarter) {
      expect(m.wrap.width, `${theme}: quarter-turn wrap is not landscape`).toBeGreaterThan(m.wrap.height - TOL);
    } else {
      expect(m.wrap.height, `${theme}: half-turn wrap is not portrait`).toBeGreaterThan(m.wrap.width - TOL);
    }

    // 2. Controls render; overlay transparent; row centered over the preview.
    expect(m.controls, `${theme}: footer controls missing`).toEqual({
      checkbox: true,
      label: true,
      viewing: true,
      more: true,
    });
    expect(m.overlayBackground, `${theme}: overlay has an opaque background`).toBe('rgba(0, 0, 0, 0)');
    expect(m.overlayBackdropFilter, `${theme}: overlay still blurs`).toBe('none');
    expect(contained(m.overlay, m.preview), `${theme}: control row overhangs the preview`).toBe(true);
    expect(
      Math.abs(m.overlay.cx - m.preview.cx),
      `${theme}: control row is not centered over the preview`,
    ).toBeLessThanOrEqual(2);

    await shot(win, `tfl1588-preview-rot${deg}-${theme}.png`);
  }
}

test('TFL-1631 rotated preview 180deg keeps border contained + controls transparent centered', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 1);
    await ensurePanelExpanded(win);
    await rotatePage1Clocked(win, 2);
    await assertRotatedCard(win, 180);
  } finally {
    await hardClose(app, 'tfl1631-preview-rot180');
  }
});

test('TFL-1631 rotated preview 270deg keeps border contained + controls transparent centered', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 1);
    await ensurePanelExpanded(win);
    await rotatePage1Clocked(win, 3);
    await assertRotatedCard(win, 270);
  } finally {
    await hardClose(app, 'tfl1631-preview-rot270');
  }
});

// TFL-1631 — regression: the card footer controls still WORK, not just render.
// Checkbox toggles the page's selection class, the current-page eye indicator
// is present, and the More menu opens with its real actions.
test('TFL-1631 card controls regression: checkbox selects, eye present, More menu opens', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 1);
    await ensurePanelExpanded(win);

    const card = win.locator(CARD);
    await card.waitFor({ state: 'visible', timeout: 30000 });
    await expect(card).toHaveClass(/thumb-card/);

    // Unrotated base state (TFL-1566): page inside the flat card border,
    // overlay transparent + horizontally centered with no opaque bar.
    const m0 = await measure(win);
    expect(m0, 'unrotated: card measured').not.toBeNull();
    expect(m0.className, 'unrotated: no rotation class').not.toMatch(/thumb-rot-/);
    expect(contained(m0.wrap, m0.card), 'unrotated: page spills outside the card').toBe(true);
    expect(contained(m0.frame, m0.card), 'unrotated: frame spills outside the card').toBe(true);
    expect(m0.overlayBackground, 'unrotated: overlay has an opaque background').toBe('rgba(0, 0, 0, 0)');
    expect(m0.overlayBackdropFilter, 'unrotated: overlay has a backdrop blur').toBe('none');
    expect(contained(m0.overlay, m0.preview), 'unrotated: control row overhangs the preview').toBe(true);
    expect(Math.abs(m0.overlay.cx - m0.preview.cx), 'unrotated: control row not centered').toBeLessThanOrEqual(2);
    await shot(win, 'tfl1631-preview-unrotated.png');

    // Current-page eye indicator.
    await expect(card.locator('[data-thumb-viewing]')).toBeVisible();

    // Checkbox selects then clears the page.
    await expect(card).not.toHaveClass(/thumb-selected/);
    await card.locator('[data-thumb-checkbox]').check();
    await expect(card).toHaveClass(/thumb-selected/, { timeout: 5000 });
    await card.locator('[data-thumb-checkbox]').uncheck();
    await expect(card).not.toHaveClass(/thumb-selected/, { timeout: 5000 });

    // More menu opens with the real page actions.
    await card.locator('[data-thumb-more]').click();
    const menu = win.locator('[data-page-menu="card"]');
    await menu.waitFor({ state: 'visible', timeout: 8000 });
    await expect(menu.locator('[data-menu-item="rotate-cw"]')).toBeVisible();
    await expect(menu.locator('[data-menu-item="delete"]')).toBeVisible();
    await win.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  } finally {
    await hardClose(app, 'tfl1631-card-controls-regression');
  }
});
