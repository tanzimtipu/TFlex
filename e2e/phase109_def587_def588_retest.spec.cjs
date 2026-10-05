// TFL-925 (Phase 109 / Viewing Controls) - rendered FIX-READY retest for the
// two HIGH adversary findings from TFL-918:
//   DEF-587 (ADV-221): :root[data-theme="frosted"] .document-scroller must stop
//     at the View Strip footer's top edge, so every footer control stays
//     hit-testable in the frosted theme (was 11/12 covered).
//   DEF-588 (ADV-222): the @container single-view-strip (max-width: 419px)
//     reveal must win the cascade, so the More trigger actually displays and
//     re-homes the one/two/four layout + Book View at the overflow tier.
//
// Launches only through the canonical e2e/lib/launch.cjs launchApp helper.
// Evidence screenshots land in screenshots/ named phase109-qa-*.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
test.setTimeout(420000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p109-def587-588');
  app = null;
  win = null;
});

async function openSample(name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}
async function setWindow(w, h) {
  await app.evaluate(({ BrowserWindow }, sz) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) { try { bw.unmaximize(); } catch (_) { /* already normal */ } bw.setSize(sz[0], sz[1]); }
  }, [w, h]);
  await win.waitForFunction((want) => Math.abs(window.innerWidth - want) <= 40, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(600);
}
async function zoom(z) {
  await app.evaluate(({ BrowserWindow }, zf) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.webContents.setZoomFactor(zf);
  }, z);
  await win.waitForTimeout(900);
}
async function currentTheme() { return win.evaluate(() => document.documentElement.getAttribute('data-theme')); }
async function setTheme(theme) {
  for (let i = 0; i < 4; i += 1) {
    if ((await currentTheme()) === theme) return;
    await win.locator('[data-app-menu]').first().click();
    await win.waitForSelector('[data-app-menu-popover]', { state: 'visible', timeout: 8000 });
    await win.locator('[data-app-menu-popover] [data-menu-action="toggleTheme"]').first().click();
    await win.waitForTimeout(900);
  }
  const now = await currentTheme();
  if (now !== theme) throw new Error(`setTheme: could not reach '${theme}' (stuck at '${now}')`);
}

// Hit-test every visible footer control at its own centre; classify the top element.
async function hitAll() {
  return win.evaluate(() => {
    const out = [];
    document.querySelectorAll('[data-view-strip] button, [data-view-strip] input').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(x, y);
      out.push({
        label: el.getAttribute('aria-label') || el.className,
        hit: top === el || el.contains(top),
        topClass: top ? String(top.className || '') : null,
        topTag: top ? top.tagName.toLowerCase() : null,
      });
    });
    return out;
  });
}
const BLOCKERS = ['textLayer', 'document-content', 'document-scroller'];

// ---------------------------------------------------------------------------
// DEF-587: frosted scroller stops at the footer top; 12/12 controls hit-testable.
// ---------------------------------------------------------------------------
test('P109-13 DEF-587 retest: frosted scroller stops at the footer; 12/12 controls hit-testable in every theme', async () => {
  await openSample();
  await setWindow(1440, 900);

  for (const theme of ['light', 'frosted', 'dark']) {
    await setTheme(theme);
    await win.waitForTimeout(500);
    const hits = await hitAll();
    const covered = hits.filter((h) => !h.hit);
    const blockers = hits.filter((h) => BLOCKERS.some((b) => (h.topClass || '').includes(b)));
    console.log(`[P109-13] theme=${theme} controls=${hits.length} covered=${covered.length} blockerHits=${blockers.length}`);
    if (covered.length) console.log(`[P109-13] covered=${JSON.stringify(covered)}`);
    expect(hits.length, `${theme}: the wide footer exposes 12 controls`).toBe(12);
    expect(blockers, `${theme}: no control is under .textLayer/.document-content/.document-scroller`).toEqual([]);
    expect(covered, `${theme}: every footer control is the top element at its own centre`).toEqual([]);
  }

  await setTheme('frosted');
  await win.waitForTimeout(500);
  const geom = await win.evaluate(() => {
    const s = document.querySelector('.document-scroller').getBoundingClientRect();
    const f = document.querySelector('[data-view-strip]').getBoundingClientRect();
    return { scrollerBottom: Math.round(s.bottom), footerTop: Math.round(f.top) };
  });
  console.log(`[P109-13] frosted scrollerBottom=${geom.scrollerBottom} footerTop=${geom.footerTop}`);
  expect(Math.abs(geom.scrollerBottom - geom.footerTop), 'the frosted scroller stops at the footer top edge').toBeLessThanOrEqual(1);

  await win.screenshot({ path: path.join(SHOTS, 'phase109-qa-def587-frosted-footer.png') });
  console.log('[P109-13] screenshot: phase109-qa-def587-frosted-footer.png');
});

// ---------------------------------------------------------------------------
// DEF-588: <=419px overflow tier reveals the More trigger; the moved layout +
// Book View controls are reachable by pointer AND keyboard.
// ---------------------------------------------------------------------------
test('P109-14 DEF-588 retest: <=419px More reveals; layout + Book View reachable by pointer and keyboard', async () => {
  await openSample();
  await setWindow(640, 480);
  await zoom(1.5);

  const tier = await win.evaluate(() => {
    const cs = (sel) => { const el = document.querySelector(sel); return el === null ? 'missing' : getComputedStyle(el).display; };
    const strip = document.querySelector('[data-view-strip]');
    return {
      inlineSize: strip ? Math.round(strip.getBoundingClientRect().width) : null,
      more: cs('.view-strip-more'),
      layout: cs('.view-strip-layout'),
      book: cs('.view-strip-book'),
    };
  });
  console.log(`[P109-14] 640x480@150% tier=${JSON.stringify(tier)}`);
  expect(tier.inlineSize, 'the footer inline-size is <=419px at 640x480 @150%').toBeLessThanOrEqual(419);
  expect(tier.layout, 'overflow tier hides the inline layout group').toBe('none');
  expect(tier.book, 'overflow tier hides the inline Book View entry').toBe('none');
  // The reveal declares `display: inline-flex`, but `.view-strip` is a flex
  // container, so an inline-flex flex item BLOCKIFIES to `flex` in computed
  // style (what the pre-fix base `display: none` would otherwise leave as
  // `none`). The fix's contract is that the host is VISIBLE at this rung.
  expect(tier.more, 'overflow tier REVEALS the More host (visible, not none)').not.toBe('none');
  expect(['flex', 'inline-flex'], 'the More host computes as a visible flex box').toContain(tier.more);

  const toggle = win.locator('[data-view-strip-more-toggle]').first();

  // The trigger's own geometry + whether it is the top element at its centre.
  const moreToggle = await win.evaluate(() => {
    const el = document.querySelector('[data-view-strip-more-toggle]');
    const r = el.getBoundingClientRect();
    const strip = document.querySelector('[data-view-strip]').getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const t = document.elementFromPoint(x, y);
    return {
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      stripBox: [Math.round(strip.x), Math.round(strip.y), Math.round(strip.width), Math.round(strip.height)],
      hit: t === el || el.contains(t),
      top: t ? `${t.tagName.toLowerCase()}.${String(t.className).slice(0, 50)}` : null,
    };
  });
  console.log(`[P109-14] More toggle=${JSON.stringify(moreToggle)}`);
  expect(moreToggle.box[2] > 0 && moreToggle.box[3] > 0, 'the More trigger has a non-zero rendered box').toBe(true);

  // Reachability of the moved controls while the menu is open.
  async function reach() {
    return win.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
      const hit = (el) => {
        const r = el.getBoundingClientRect();
        const t = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        return { hit: t === el || el.contains(t), top: t ? t.tagName.toLowerCase() + '.' + String(t.className) : null };
      };
      const opts = [...document.querySelectorAll('[data-view-strip-more-menu] [data-page-layout-option]')];
      const book = document.querySelector('[data-view-strip-more-menu] [data-book-view-open]');
      return {
        menu: !!document.querySelector('[data-view-strip-more-menu]'),
        options: opts.map((o) => ({ mode: o.getAttribute('data-page-layout-option'), ...box(o), ...hit(o) })),
        book: book ? { ...box(book), ...hit(book) } : null,
      };
    });
  }

  // POINTER path: a real click on the More trigger must open the menu. Capture
  // the true outcome (bounded) so a covering element is recorded as evidence
  // rather than producing an opaque 30s actionability timeout.
  let pointerOpened = false;
  try {
    await toggle.click({ timeout: 6000 });
    pointerOpened = await win.evaluate(() => !!document.querySelector('[data-view-strip-more-menu]'));
  } catch (e) {
    console.log(`[P109-14] pointer click on More FAILED: ${(e.message || String(e)).split('\n')[0]}`);
  }
  console.log(`[P109-14] pointerOpened=${pointerOpened}`);

  if (pointerOpened) {
    const rp = await reach();
    console.log(`[P109-14] pointer reach=${JSON.stringify(rp)}`);
    expect(rp.options.map((o) => o.mode).sort(), 'all three layout options are present').toEqual(['four', 'one', 'two']);
    for (const o of rp.options) expect(o.w > 0 && o.h > 0, `layout option ${o.mode} has a non-zero box`).toBe(true);
    expect(rp.book, 'the Book View entry is present in the overflow menu').not.toBeNull();
    // Pointer-activate a layout option: the moved control still acts on the doc.
    await win.locator('[data-view-strip-more-menu] [data-page-layout-option="two"]').click();
    await win.waitForTimeout(800);
    expect(await win.locator('.document-content').first().getAttribute('data-page-layout'), 'pointer-selected layout two applied').toBe('two');
  }

  // KEYBOARD path (independent of pointer hit-testing): focus the trigger and
  // activate with Enter; roving focus starts on the first row, ArrowDown reaches
  // Book View and Enter activates it. The moved rows must have non-zero boxes.
  await toggle.focus();
  await win.keyboard.press('Enter');
  await win.waitForSelector('[data-view-strip-more-menu]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(400);
  const rk = await reach();
  console.log(`[P109-14] keyboard-open reach=${JSON.stringify(rk)}`);
  expect(rk.menu, 'keyboard Enter opens the More menu').toBe(true);
  expect(rk.options.length, 'the overflow menu exposes the three layout options').toBe(3);
  for (const o of rk.options) expect(o.w > 0 && o.h > 0, `layout option ${o.mode} has a non-zero box`).toBe(true);
  expect(rk.book && rk.book.w > 0 && rk.book.h > 0, 'the Book View entry has a non-zero box').toBe(true);
  await win.screenshot({ path: path.join(SHOTS, 'phase109-qa-def588-overflow-640x480.png') });
  const focusedRow = await win.evaluate(() => {
    const el = document.activeElement;
    return el ? { role: el.getAttribute('role'), label: el.getAttribute('aria-label') } : null;
  });
  console.log(`[P109-14] keyboard focus on open=${JSON.stringify(focusedRow)}`);
  expect(focusedRow && focusedRow.role, 'roving focus lands on a menu row').toBe('menuitem');
  for (let i = 0; i < 3; i += 1) { await win.keyboard.press('ArrowDown'); await win.waitForTimeout(120); }
  const nowFocused = await win.evaluate(() => { const el = document.activeElement; return el ? el.getAttribute('aria-label') : null; });
  console.log(`[P109-14] keyboard focus after ArrowDown x3=${nowFocused}`);
  expect(nowFocused, 'ArrowDown reaches the Book View row').toBe('Book View');
  await win.keyboard.press('Enter');
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 10000 });
  expect(await win.locator('[data-book-view]').count(), 'keyboard Enter on Book View opens it').toBeGreaterThanOrEqual(1);
  await win.locator('[data-book-view] [aria-label="Close book view"]').first().click();
  await win.waitForTimeout(800);
  const stillOpen = await win.locator('[data-book-view]').isVisible().catch(() => false);
  expect(stillOpen, 'Book View closes').toBe(false);

  // Wider rung: the host must be hidden again (the tier is width-driven).
  await zoom(1);
  await setWindow(1440, 900);
  const wide = await win.evaluate(() => getComputedStyle(document.querySelector('.view-strip-more')).display);
  console.log(`[P109-14] wide .view-strip-more display=${wide}`);
  expect(wide, 'the More host is hidden again at 1440x900').toBe('none');
  console.log('[P109-14] screenshot: phase109-qa-def588-overflow-640x480.png');

  // THE ACCEPTANCE: at this rung the More trigger must be reachable by POINTER -
  // a real click opens the menu, re-homing the layout + Book View controls.
  expect(
    pointerOpened,
    `the More trigger is pointer-reachable at 640x480@150% (box=${JSON.stringify(moreToggle.box)} strip=${JSON.stringify(moreToggle.stripBox)} topElement=${moreToggle.top})`,
  ).toBe(true);
});
