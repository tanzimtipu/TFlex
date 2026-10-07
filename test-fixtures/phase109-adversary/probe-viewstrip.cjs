// Phase 109 adversary diff-pass probe (TFL-918).
// Standalone driver: launches the real app through the canonical launcher and
// attacks the View Strip footer surfaces the phase e2e never exercises
// (the <=419px overflow / More menu, idle dim, focus behaviour, Book View
// footer lifecycle, stale state, pan hit-testing).
//
// Run: node test-fixtures/phase109-adversary/probe-viewstrip.cjs
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../e2e/lib/launch.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const OUT = { checks: [], notes: [] };
function log(...a) { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); OUT.checks.push(s); console.log(s); }
function note(...a) { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); OUT.notes.push(s); console.log(s); }

async function setWindow(app, win, w, h) {
  await app.evaluate(({ BrowserWindow }, sz) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) { try { bw.unmaximize(); } catch (_) {} bw.setSize(sz[0], sz[1]); }
  }, [w, h]);
  await win.waitForFunction((want) => Math.abs(window.innerWidth - want) <= 60, w, { timeout: 6000 }).catch(() => {});
  await win.waitForTimeout(500);
}

async function openSample(win, name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function stripTier(win) {
  return win.evaluate(() => {
    const strip = document.querySelector('[data-view-strip]');
    const vis = (sel) => { const el = document.querySelector(sel); return el === null ? 'missing' : getComputedStyle(el).display; };
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      stripWidth: strip ? Math.round(strip.getBoundingClientRect().width) : null,
      stripIdle: strip ? strip.getAttribute('data-view-strip-idle') : null,
      more: vis('.view-strip-more'),
      layout: vis('.view-strip-layout'),
      book: vis('.view-strip-book'),
    };
  });
}

async function findOverflowWidth(app, win) {
  // Walk the window narrower until the single-mode footer drops to the
  // <=419px overflow rung (.view-strip-more becomes inline-flex).
  for (const w of [620, 580, 540, 500, 470, 440]) {
    await setWindow(app, win, w, 480);
    const t = await stripTier(win);
    log(`  [width-scan] req=${w} actualInner=${t.innerWidth} stripWidth=${t.stripWidth} more=${t.more}`);
    if (t.stripWidth !== null && t.stripWidth <= 419 && t.more !== 'none') return t;
  }
  return await stripTier(win);
}

async function menuState(win) {
  return win.evaluate(() => {
    const toggle = document.querySelector('[data-view-strip-more-toggle]');
    const menu = document.querySelector('[data-view-strip-more-menu]');
    const host = document.querySelector('[data-view-strip-more]');
    const active = document.activeElement;
    const view = document.querySelector('.view-strip-view');
    const menuRect = menu ? menu.getBoundingClientRect() : null;
    let topAtMenuCenter = null;
    if (menuRect && menuRect.width > 0) {
      const x = Math.round(menuRect.left + menuRect.width / 2);
      const y = Math.round(menuRect.top + menuRect.height / 2);
      const top = document.elementFromPoint(x, y);
      topAtMenuCenter = top ? `${top.tagName.toLowerCase()}.${String(top.className)}` : null;
    }
    return {
      hasMenu: menu !== null,
      toggleAriaExpanded: toggle ? toggle.getAttribute('aria-expanded') : null,
      hostDisplay: host ? getComputedStyle(host).display : 'missing',
      activeTag: active ? active.tagName.toLowerCase() : null,
      activeLabel: active ? active.getAttribute('aria-label') : null,
      activeRole: active ? active.getAttribute('role') : null,
      activeInMenu: active && menu ? menu.contains(active) : false,
      viewOpacity: view ? getComputedStyle(view).opacity : null,
      menuOpacity: menu ? getComputedStyle(menu).opacity : null,
      menuRect: menuRect ? { x: Math.round(menuRect.x), y: Math.round(menuRect.y), w: Math.round(menuRect.width), h: Math.round(menuRect.height) } : null,
      topAtMenuCenter,
    };
  });
}

async function dockRect(win) {
  return win.evaluate(() => {
    const d = document.querySelector('[data-action-dock]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
}

async function main() {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);

  await openSample(win);

  // ---- Part 1: reach the overflow tier -----------------------------------
  log('== Part 1: overflow tier discovery ==');
  const tier = await findOverflowWidth(app, win);
  log('  tier:', tier);
  if (tier.stripWidth === null || tier.stripWidth > 419 || tier.more === 'none') {
    log('  ABORT-PART-1: could not reach the <=419px overflow tier; more=', tier.more, 'stripWidth=', tier.stripWidth);
  } else {
    await win.screenshot({ path: path.join(SHOTS, 'phase109-adv-overflow-tier.png') });

    // ---- Part 2: open the More menu, focus + aria ------------------------
    log('== Part 2: More menu open / focus / aria ==');
    await win.locator('[data-view-strip-more-toggle]').click();
    await win.waitForTimeout(300);
    let st = await menuState(win);
    log('  after open:', st);
    log('  F#2a menu present? ', st.hasMenu, '| aria-expanded=', st.toggleAriaExpanded, '| focusInMenu=', st.activeInMenu, '| active=', st.activeTag, st.activeLabel, st.activeRole);
    await win.screenshot({ path: path.join(SHOTS, 'phase109-adv-more-open.png') });

    // ---- Part 3: Escape returns focus to trigger ------------------------
    log('== Part 3: Escape closes and returns focus ==');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(200);
    st = await menuState(win);
    log('  after Escape: hasMenu=', st.hasMenu, 'aria-expanded=', st.toggleAriaExpanded, 'active=', st.activeTag, st.activeLabel);

    // ---- Part 4: outside pointerdown closes -----------------------------
    log('== Part 4: outside pointerdown closes ==');
    await win.locator('[data-view-strip-more-toggle]').click();
    await win.waitForTimeout(200);
    await win.mouse.click(win.viewportSize().width ? 200 : 200, 200);
    await win.waitForTimeout(200);
    st = await menuState(win);
    log('  after outside click: hasMenu=', st.hasMenu, 'aria-expanded=', st.toggleAriaExpanded);

    // ---- Part 5: TAB behaviour (is the menu a trap?) --------------------
    log('== Part 5: Tab behaviour inside the menu ==');
    await win.locator('[data-view-strip-more-toggle]').click();
    await win.waitForTimeout(250);
    const beforeTab = await menuState(win);
    log('  before Tab:', { hasMenu: beforeTab.hasMenu, active: beforeTab.activeLabel, inMenu: beforeTab.activeInMenu });
    for (let i = 0; i < 6; i += 1) {
      await win.keyboard.press('Tab');
      await win.waitForTimeout(120);
      const s = await menuState(win);
      log(`  Tab#${i + 1}: menuStillOpen=${s.hasMenu} aria-expanded=${s.toggleAriaExpanded} active=${s.activeTag}/${s.activeLabel} inMenu=${s.activeInMenu}`);
    }
    // Close if still open.
    await win.keyboard.press('Escape').catch(() => {});
    await win.waitForTimeout(150);

    // ---- Part 6: moved layout / Book View controls work from the menu ---
    log('== Part 6: moved layout + Book View controls function from the menu ==');
    await win.locator('[data-view-strip-more-toggle]').click();
    await win.waitForTimeout(250);
    await win.locator('[data-view-strip-more-menu] [data-page-layout-option="two"]').click();
    await win.waitForTimeout(700);
    let layoutNow = await win.locator('.document-content').first().getAttribute('data-page-layout');
    log('  menu layout->two applied:', layoutNow);

    await win.locator('[data-view-strip-more-toggle]').click();
    await win.waitForTimeout(250);
    const bookInMenu = await win.locator('[data-view-strip-more-menu] [data-book-view-open]').count();
    log('  menu Book View entry count:', bookInMenu);
    if (bookInMenu > 0) {
      await win.locator('[data-view-strip-more-menu] [data-book-view-open]').click();
      await win.waitForTimeout(900);
      const bv = await win.locator('[data-book-view]').count();
      log('  Book View opened from menu:', bv);
      const footerWhileBook = await win.locator('[data-view-strip]').count();
      log('  footer count while Book View open (ghost footer?):', footerWhileBook);
      // close
      await win.locator('[data-book-view] [aria-label="Close book view"]').first().click().catch(() => {});
      await win.waitForTimeout(900);
      const bvAfter = await win.locator('[data-book-view]').count();
      const footerAfter = await win.locator('[data-view-strip]').count();
      log('  after Book View close: bookView=', bvAfter, 'footer=', footerAfter);
    }

    // ---- Part 7: idle dim while the menu is open ------------------------
    log('== Part 7: idle dim with the More menu open ==');
    // Ensure the menu is open.
    const pre = await menuState(win);
    if (!pre.hasMenu) { await win.locator('[data-view-strip-more-toggle]').click(); await win.waitForTimeout(250); }
    // Move the pointer away from the dock and stop; wait past DOCK_IDLE_MS.
    await win.mouse.move(20, 20);
    await win.waitForTimeout(3600);
    st = await menuState(win);
    const dock = await dockRect(win);
    log('  after 3.6s idle: stripIdle=', (await stripTier(win)).stripIdle, 'viewOpacity=', st.viewOpacity, 'menuOpacity=', st.menuOpacity);
    log('  menuRect=', st.menuRect, 'dockRect=', dock, 'topAtMenuCenter=', st.topAtMenuCenter);
    await win.screenshot({ path: path.join(SHOTS, 'phase109-adv-more-idle.png') });
    // Is the menu visually covered? compare hit at each item centre.
    const coverage = await win.evaluate((d) => {
      const menu = document.querySelector('[data-view-strip-more-menu]');
      if (!menu) return { menu: false };
      const items = [...menu.querySelectorAll('[role="menuitem"]')];
      const hits = items.map((el) => {
        const r = el.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + r.height / 2);
        const top = document.elementFromPoint(x, y);
        return {
          label: el.getAttribute('aria-label'),
          top: top ? `${top.tagName.toLowerCase()}.${String(top.className)}` : null,
          self: top === el || el.contains(top),
          coveredByDock: top ? !!top.closest('[data-action-dock]') : false,
          coveredByOverlay: top ? !!top.closest('[data-canvas-overlay]') : false,
        };
      });
      const menuR = menu.getBoundingClientRect();
      const dockR = d ? { l: d.x, t: d.y, r: d.x + d.w, b: d.y + d.h } : null;
      const overlap = dockR ? !(menuR.right < dockR.l || menuR.left > dockR.r || menuR.bottom < dockR.t || menuR.top > dockR.b) : null;
      return { menu: true, hits, overlapWithDock: overlap };
    }, dock);
    log('  menu item hit-test:', coverage.hits);
    log('  menu overlaps dock box:', coverage.overlapWithDock);
  }

  // ---- Part 8: Book View footer lifecycle (wide, single) ---------------
  log('== Part 8: Book View footer lifecycle at 1440x900 ==');
  await setWindow(app, win, 1440, 900);
  await win.waitForTimeout(400);
  const footerBeforeBook = await win.locator('[data-view-strip]').count();
  await win.locator('[data-view-strip] [data-book-view-open]').first().click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(500);
  const footerDuringBook = await win.locator('[data-view-strip]').count();
  await win.screenshot({ path: path.join(SHOTS, 'phase109-adv-bookview.png') });
  await win.locator('[data-book-view] [aria-label="Close book view"]').first().click();
  await win.waitForTimeout(900);
  const footerAfterBook = await win.locator('[data-view-strip]').count();
  log('  footer count before/during/after Book View:', footerBeforeBook, footerDuringBook, footerAfterBook);

  // ---- Part 9: stale state on rapid tab switch ------------------------
  log('== Part 9: stale state after rapid tab switch ==');
  // Reopen a second sample in a new tab, then jump page in tab 1 and switch.
  await win.waitForTimeout(300);
  // Open a second document via the home/sample flow is not trivial; instead use
  // the footer page input then immediately toggle a theme (cheap re-render).
  const input = win.locator('.view-strip-page .page-input').first();
  await input.click();
  await input.fill('5');
  // Switch theme immediately (re-render) without pressing Enter, then blur.
  await win.locator('[data-app-menu]').first().click();
  await win.waitForSelector('[data-app-menu-popover]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-app-menu-popover] [data-menu-action="toggleTheme"]').first().click();
  await win.waitForTimeout(700);
  const inputVal = await win.locator('.view-strip-page .page-input').first().inputValue();
  log('  page input value after switch-away (typed 5, not committed):', inputVal);

  // ---- Part 10: pan mode + footer hit-test ----------------------------
  log('== Part 10: pan mode + footer hit-test ==');
  await win.locator('.view-strip-view [aria-label="Pan mode"]').first().click();
  await win.waitForTimeout(400);
  const panHit = await win.evaluate(() => {
    const strip = document.querySelector('[data-view-strip]');
    const r = strip.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(x, y);
    return { top: top ? `${top.tagName.toLowerCase()}.${String(top.className)}` : null, inStrip: top ? !!top.closest('[data-view-strip]') : false };
  });
  log('  footer centre hit while Pan armed:', panHit);

  // ---- Part 11: both themes + reduced motion --------------------------
  log('== Part 11: reduced motion on the footer/menu ==');
  await win.emulateMedia({ reducedMotion: 'reduce' }).catch(() => {});
  // Reopen overflow tier and the menu, then read transition durations.
  await findOverflowWidth(app, win);
  await win.locator('[data-view-strip-more-toggle]').click().catch(() => {});
  await win.waitForTimeout(250);
  const motion = await win.evaluate(() => {
    const menu = document.querySelector('[data-view-strip-more-menu]');
    const view = document.querySelector('.view-strip-view');
    return {
      menuAnim: menu ? getComputedStyle(menu).animationDuration : null,
      menuTransition: menu ? getComputedStyle(menu).transitionDuration : null,
      viewTransition: view ? getComputedStyle(view).transitionDuration : null,
    };
  });
  log('  reduced-motion durations:', motion);
  await win.emulateMedia({ reducedMotion: 'no-preference' }).catch(() => {});

  // Write JSON summary.
  fs.writeFileSync(path.join(__dirname, 'probe-viewstrip.output.json'), JSON.stringify(OUT, null, 2));

  await app.close();
}

main().then(() => { console.log('PROBE-DONE'); process.exit(0); }).catch((e) => {
  console.error('PROBE-ERROR', e && e.stack ? e.stack : e);
  try { fs.writeFileSync(path.join(__dirname, 'probe-viewstrip.output.json'), JSON.stringify(OUT, null, 2)); } catch (_) {}
  process.exit(1);
});
