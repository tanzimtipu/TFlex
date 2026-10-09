// DEF-664 (TFL-1406 chunk B) — focused FIX-READY verification for the dock's
// EDIT-mode red minus badge. The Phase 113 wave-D re-pin restored the badge BOX
// but not its hover/active PAINT, so the canonical `.btn-ghost:hover` film
// (0,4,0) replaced the attention red exactly when the user hovered the remove
// control (an on-accent glyph on a light film -> the badge reads as gone). The
// frozen fix adds `.action-dock-minus.btn:hover/active:not(...):not(...)` at
// (0,5,0), overriding the canonical family. src/ is NOT edited by this spec.
//
// Proves, against the real built app:
//   1. while HOVERED the badge keeps the attention fill (NOT the --bg-hover
//      film) and its --fg-on-accent ink, and is hit-testable at its centre;
//   2. clicking it removes the verb from the dock;
//   3. blast radius: a neighbouring dock surface (the verb button sharing the
//      same dock/edit-mode path) does NOT inherit the badge's attention fill.
// Mirrors the enterEditMode/hover choreography of
// e2e/phase95_dock_edit_overflow.spec.cjs (:119-126, :325-350).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, hardClose } = require('./lib/helpers.cjs');

// The harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads process.env, so
// Electron would exit as Node. Clear it before any launch.
delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const USER_DATA = path.join(os.tmpdir(), `tflex-def664-${Date.now()}`);
const DOCK = '[data-action-dock]';
test.setTimeout(180000);

async function enterEditMode(win) {
  expect(await win.locator('[data-dock-overflow]').count()).toBe(1);
  await win.locator('[data-dock-overflow]').click();
  await win.waitForSelector('[data-dock-menu-item="customize"]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-dock-menu-item="customize"]').click();
  await win.waitForTimeout(400);
  expect(await win.locator(DOCK).getAttribute('data-dock-edit')).toBe('true');
}

// Resolve the CSS custom properties to concrete rgb() strings via a probe box,
// so the computed styles can be compared without hard-coding theme values.
async function resolveTokens(win) {
  return win.evaluate(() => {
    const probe = (expr) => {
      const el = document.createElement('div');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      el.style.background = expr;
      document.body.appendChild(el);
      const c = getComputedStyle(el).backgroundColor;
      el.remove();
      return c;
    };
    return {
      attention: probe('var(--sem-attention, var(--accent))'),
      film: probe('var(--bg-hover)'),
      ink: probe('var(--fg-on-accent)'),
    };
  });
}

// First visible, non-pinned, enabled EDIT-mode badge: its verb can be removed.
async function pickBadgeId(win) {
  return win.evaluate(() => {
    const badges = Array.from(document.querySelectorAll('[data-dock-minus]'));
    const vis = badges.find((b) => {
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      if (!(r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none')) return false;
      const verb = b.parentElement && b.parentElement.querySelector('[data-dock-verb]');
      if (!verb || verb.hasAttribute('data-dock-pin') || verb.disabled) return false;
      return !verb.getAttribute('aria-disabled') || verb.getAttribute('aria-disabled') !== 'true';
    });
    return vis ? vis.getAttribute('data-dock-minus') : null;
  });
}

test('DEF-664: the EDIT-mode minus badge keeps the attention paint while hovered and stays click-removable', async () => {
  const app = await launchApp([], USER_DATA);
  const win = await app.firstWindow();
  try {
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await win.waitForSelector(DOCK, { timeout: 30000 });
    await enterEditMode(win);

    const id = await pickBadgeId(win);
    expect(id, 'a visible, non-pinned, enabled [data-dock-minus] badge exists in EDIT mode').not.toBeNull();
    const badge = win.locator(`[data-dock-minus="${id}"]`).first();
    const verb = win.locator(`[data-dock-verb="${id}"]`).first();
    await badge.waitFor({ state: 'visible', timeout: 8000 });

    const tok = await resolveTokens(win);
    expect(badge, 'attention and film resolve to distinct colours').toBeTruthy();
    expect(tok.attention, 'attention fill resolves').toMatch(/^rgba?\(/);
    expect(tok.attention).not.toBe(tok.film);
    console.log(`[DEF-664] id=${id} tokens=${JSON.stringify(tok)}`);

    const restBg = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(restBg, 'badge keeps the attention fill at rest').toBe(tok.attention);
    expect(restBg, 'badge rest fill is NOT the canonical hover film').not.toBe(tok.film);

    // Blast radius: hover the sibling verb (same dock/edit-mode path). It must
    // NOT take the badge's attention fill, and the badge paint must be
    // undisturbed by that neighbouring hover.
    await verb.hover();
    await win.waitForTimeout(250);
    const verbBg = await verb.evaluate((el) => getComputedStyle(el).backgroundColor);
    const badgeWhileVerbHover = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
    console.log(`[DEF-664] verbBg=${verbBg} badgeWhileVerbHover=${badgeWhileVerbHover}`);
    expect(verbBg, 'verb button must not inherit the badge attention fill').not.toBe(tok.attention);
    expect(badgeWhileVerbHover, 'badge paint unaffected by the verb hover').toBe(tok.attention);

    // Outcome 2: hover the badge itself.
    await badge.hover();
    await win.waitForTimeout(250);
    const hovered = await win.evaluate((badgeId) => {
      const b = document.querySelector(`[data-dock-minus="${badgeId}"]`);
      if (!b) return null;
      const cs = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return {
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        transform: cs.transform,
        hitTestable: hit !== null && (hit === b || b.contains(hit)),
        hitTarget: hit === null ? '(none)' : `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0] || ''}`,
      };
    }, id);
    console.log(`[DEF-664] hovered=${JSON.stringify(hovered)}`);
    expect(hovered, 'badge still present while hovered').not.toBeNull();
    expect(hovered.backgroundColor, 'hovered fill is the attention fill (not the light film)').toBe(tok.attention);
    expect(hovered.backgroundColor, 'hovered fill is NOT the canonical --bg-hover film').not.toBe(tok.film);
    expect(hovered.color, 'hovered ink is --fg-on-accent').toBe(tok.ink);
    expect(hovered.hitTestable, `badge centre hit-testable (elementFromPoint -> ${hovered.hitTarget})`).toBe(true);

    await win.screenshot({ path: path.join(SHOTS, 'def664_dock_minus_hover.png') });

    // Outcome 3: click the badge and confirm the verb is removed from the dock.
    const beforeCount = await win.locator(`${DOCK} [data-dock-verb]`).count();
    await badge.click();
    await expect.poll(() => win.locator(`[data-dock-verb="${id}"]`).count(), {
      timeout: 8000,
      message: `clicking the minus badge removes verb "${id}" from the dock`,
    }).toBe(0);
    const afterCount = await win.locator(`${DOCK} [data-dock-verb]`).count();
    console.log(`[DEF-664] verbCount before=${beforeCount} after=${afterCount} (removed id=${id})`);
    expect(afterCount, 'the dock verb count decremented after remove').toBeLessThan(beforeCount);
  } finally {
    await hardClose(app, 'def664-minus-hover');
  }
});
