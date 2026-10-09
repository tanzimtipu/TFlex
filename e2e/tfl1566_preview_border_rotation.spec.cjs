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
