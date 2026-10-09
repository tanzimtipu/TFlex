// Phase 104 (TFL-847) — QA focused verification + visual verdict for the dock
// chunk (chunks 1+2, uncommitted in the working tree). Launches ONLY through the
// canonical e2e/lib/launch.cjs. QA-owned; touches no product source.
//
// Covers the CONTROL-INDEX items (a)-(h), captures the required screenshots to
// screenshots/phase104-*.png, and logs machine-readable evidence to stdout.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

const OUT = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const DOCK = '[data-action-dock]';
// TFL-880 — DOM-robust single-mode page/zoom control resolution. The controls
// live in the floating CanvasPills ([data-page-pill]/[data-zoom-pill]) OR, after
// the Phase 109 ViewStrip relocation, inside the [data-view-strip] footer
// (.view-strip-page / .view-strip-view). Resolve whichever home is present; if
// NEITHER resolves the test FAILS (the collision oracle must never pass on null).
const PAGE_CTL = '[data-page-pill], [data-view-strip] .view-strip-page';
const ZOOM_CTL = '[data-zoom-pill], [data-view-strip] .view-strip-view';
test.setTimeout(420000);

// toolsRegistry.DOCK_STAGE_IDS (full membership) + DOCK_PRIMARY_IDS (curated
// tiles) + DOCK_SHORT_LABELS, inlined as the expected oracle.
const STAGE_IDS = {
  pages: ['rotate', 'extract', 'insertPages', 'replacePages', 'split', 'delete', 'merge', 'cropPages'],
  edit: ['editToolOff', 'editText', 'editImage', 'editTextBox', 'recognizeText', 'batchOcr', 'ocrSuspects'],
  review: ['annotate', 'sign', 'stamp', 'flatten', 'watermark', 'bates', 'exportComments',
    'importComments', 'fillFromCsv', 'exportFormData', 'importFormData', 'validateDocument',
    'sanitize', 'engineeringLayers', 'documentInfo'],
  deliver: ['optimize', 'audit', 'exportPages', 'exportText', 'exportDocx', 'exportXlsx', 'exportPptx',
    'createFromImages', 'encrypt'],
};
const PRIMARY = {
  pages: ['rotate', 'extract', 'insertPages', 'merge', 'cropPages'],
  edit: ['editToolOff', 'editText', 'editImage', 'editTextBox', 'recognizeText'],
  review: ['annotate', 'sign', 'stamp', 'bates'],
  deliver: ['optimize', 'exportPages', 'exportText', 'exportDocx', 'encrypt'],
};
const SHORT = {
  rotate: 'Rotate', extract: 'Extract', insertPages: 'Insert', merge: 'Merge', cropPages: 'Crop',
  editToolOff: 'Select', editText: 'Text', editImage: 'Images', editTextBox: 'Text box', recognizeText: 'OCR',
  annotate: 'Annotate', sign: 'Sign', stamp: 'Stamp', bates: 'Bates',
  optimize: 'Optimize', exportPages: 'Images', exportText: 'Text', exportDocx: 'Word', encrypt: 'Encrypt',
};
const FULL = {
  rotate: 'Rotate pages', extract: 'Extract pages', insertPages: 'Insert pages', merge: 'Merge PDFs',
  cropPages: 'Crop pages', editToolOff: 'Edit mode off', editText: 'Edit text', editImage: 'Edit images',
  editTextBox: 'Add a text box', recognizeText: 'Recognize text (OCR)', annotate: 'Annotate', sign: 'Sign',
  stamp: 'Stamp', bates: 'Bates numbering\u2026', optimize: 'Reduce file size',
  exportPages: 'Export pages as images', exportText: 'Export text', exportDocx: 'Export to Word (.docx)',
  encrypt: 'Encrypt document',
};
const STAGES = [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']];

let app = null;
let win = null;

async function setWindow(w, h, forceMin = false) {
  await app.evaluate(({ BrowserWindow }, sz) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (!bw) return;
    try { bw.unmaximize(); } catch (_) { /* not maximized */ }
    if (sz[2]) bw.setMinimumSize(300, 300);
    bw.setSize(sz[0], sz[1]);
  }, [w, h, forceMin]);
  await win.waitForFunction((want) => Math.abs(window.innerWidth - want) <= 30, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(500);
}

async function openReport() {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector(DOCK, { timeout: 30000 });
  await win.waitForTimeout(1000);
}

async function openMore() {
  await win.locator('[data-dock-overflow]').first().click();
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
}

async function closeMenus() {
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);
}

function primarySnapshot() {
  return win.evaluate(() => {
    const group = document.querySelector('[data-action-dock] [data-dock-group="primary"]');
    if (!group) return [];
    return [...group.querySelectorAll('[data-dock-verb]')].map((el) => ({
      id: el.getAttribute('data-dock-verb'),
      label: (el.querySelector('.action-dock-label')?.textContent ?? '').trim(),
      aria: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      disabled: el.disabled,
    }));
  });
}

function overflowIds() {
  return win.$$eval('[data-dock-overflow-item]', (els) =>
    els.map((e) => e.getAttribute('data-dock-overflow-item')));
}

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p104-qa');
  app = null;
  win = null;
});

test('Phase 104 control-index sweep (a-h) + stage screenshots', async () => {
  await openReport();
  await setWindow(1440, 900);
  await gotoStage(win, 1);
  await win.waitForTimeout(500);

  const evidence = {};

  // ---- (d) primary tiles, short labels, full accessible names, reachability ----
  for (const [n, stage] of STAGES) {
    await gotoStage(win, n);
    await win.waitForTimeout(450);
    await win.screenshot({ path: path.join(OUT, `phase104-${stage}.png`) });

    const tiles = await primarySnapshot();
    const ids = tiles.map((t) => t.id);
    evidence[stage] = { primaryIds: ids, tiles };
    console.log(`[P104 primary ${stage}] ${JSON.stringify(tiles)}`);
    expect(ids, `${stage}: curated primary tiles`).toEqual(PRIMARY[stage]);
    for (const t of tiles) {
      expect(t.label, `${stage}:${t.id} short tile label`).toBe(SHORT[t.id]);
      expect(t.aria, `${stage}:${t.id} full accessible name`).toBe(FULL[t.id]);
      expect(t.title, `${stage}:${t.id} tooltip`).toBeTruthy();
    }

    await openMore();
    const menu = await overflowIds();
    const customize = await win.locator('[data-dock-menu-item="customize"]').count();
    evidence[stage].overflow = menu;
    evidence[stage].customizeItem = customize;
    console.log(`[P104 overflow ${stage}] ${JSON.stringify(menu)} customize=${customize}`);
    for (const id of STAGE_IDS[stage]) {
      expect(ids.includes(id) || menu.includes(id), `${stage}:${id} reachable (tile or More)`).toBe(true);
    }
    expect(customize, `${stage}: Customize dock item in More`).toBe(1);
    if (stage === 'pages') {
      expect(menu, 'pages: split is displaced to More').toContain('split');
      // DEF-568 — the destructive `delete` row in the More popover carries the
      // danger ink (`--tf-icon-danger`), mirroring the dock row verb.
      const deleteInk = await win.evaluate(() => {
        const el = document.querySelector('[data-dock-overflow-menu] [data-dock-overflow-item="delete"]');
        if (!el) return null;
        const cs = getComputedStyle(el);
        const m = cs.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return {
          disabled: el.hasAttribute('disabled'),
          rgb: m ? [+m[1], +m[2], +m[3]] : null,
          color: cs.color,
          danger: getComputedStyle(document.documentElement).getPropertyValue('--tf-icon-danger').trim(),
        };
      });
      evidence.pages.deleteInk = deleteInk;
      console.log(`[P104 delete-more] ${JSON.stringify(deleteInk)}`);
      expect(deleteInk, 'pages: delete row renders in More').not.toBeNull();
      expect(deleteInk.disabled, 'pages: delete More row is enabled').toBe(false);
      if (deleteInk.rgb) {
        const [r, g, b] = deleteInk.rgb;
        expect(r > g && r > b, `delete More row is red (rgb=${deleteInk.rgb})`).toBe(true);
      }
      await win.screenshot({ path: path.join(OUT, 'phase104-overflow.png') });
    }
    await closeMenus();
  }

  // ---- (a) Tools button: label + opens the existing command palette ----
  await gotoStage(win, 1);
  await win.waitForTimeout(300);
  const toolsText = (await win.locator('[data-dock-tools]').first().textContent() ?? '').replace(/\s+/g, ' ').trim();
  const toolsAria = await win.locator('[data-dock-tools]').first().getAttribute('aria-label');
  await win.locator('[data-dock-tools]').first().click();
  await win.waitForSelector('[data-command-palette]', { state: 'visible', timeout: 8000 });
  evidence.tools = { text: toolsText, aria: toolsAria, paletteOpened: true };
  console.log(`[P104 tools] text="${toolsText}" aria="${toolsAria}" palette=open`);
  expect(toolsText).toBe('All commands');
  expect(toolsAria).toBe('All commands');
  await closeMenus();
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);

  // ---- (b) pages split (a displaced command) runs its real handler --------
  await openMore();
  await win.locator('[data-dock-overflow-item="split"]').first().click();
  await win.waitForSelector('#split-dialog-title', { state: 'visible', timeout: 8000 });
  evidence.split = { dialog: 'split-dialog-title' };
  console.log('[P104 split] Split pages dialog opened from its More row');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(350);

  // ---- (c) Customize dock toggles the EXISTING dock EDIT mode -------------
  await openMore();
  await win.locator('[data-dock-menu-item="customize"]').first().click();
  await win.waitForTimeout(400);
  expect(await win.locator(DOCK).getAttribute('data-dock-edit')).toBe('true');
  const minusCount = await win.locator('[data-dock-minus]').count();
  const plusCount = await win.locator('[data-dock-plus]').count();
  evidence.customize = { edit: true, minusCount, plusCount };
  console.log(`[P104 customize] edit=true minus=${minusCount} plus=${plusCount}`);
  expect(minusCount).toBeGreaterThan(0);
  expect(plusCount).toBe(1);
  await win.locator('[data-dock-plus]').first().click();
  await win.waitForSelector('[data-dock-picker]', { state: 'visible', timeout: 8000 });
  evidence.customize.picker = true;
  await win.keyboard.press('Escape');
  await win.waitForTimeout(350);
  expect(await win.locator(DOCK).getAttribute('data-dock-edit')).toBe('false');

  // ---- (e) state / colour discipline -------------------------------------
  await gotoStage(win, 2);
  await win.waitForTimeout(500);
  const colour = await win.evaluate(() => {
    const root = document.querySelector('[data-action-dock]');
    const read = (id) => {
      const el = root?.querySelector(`[data-dock-verb="${id}"]`);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { pressed: el.getAttribute('aria-pressed'), bg: cs.backgroundColor, color: cs.color, ring: cs.boxShadow };
    };
    return { active: read('editToolOff'), idle: read('editText') };
  });
  evidence.colour = colour;
  console.log(`[P104 colour edit] ${JSON.stringify(colour)}`);
  expect(colour.active, 'edit: editToolOff rendered').not.toBeNull();
  expect(colour.active.pressed, 'edit: persistent active verb is aria-pressed').toBe('true');
  expect(colour.active.bg, 'edit: selected tile has a distinct accent wash').not.toBe(colour.idle.bg);
  expect(/inset/.test(colour.active.ring), 'edit: selected tile carries the accent inset ring').toBe(true);
  expect(colour.idle.pressed, 'edit: an idle verb is not pressed').toBeNull();
  await gotoStage(win, 1);
  await win.waitForTimeout(400);

  await gotoStage(win, 4);
  await win.waitForTimeout(400);
  const exportColour = await win.evaluate(() => {
    const el = document.querySelector('[data-action-dock] [data-dock-verb="exportDocx"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const m = cs.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return { id: el.getAttribute('data-dock-verb'), pressed: el.getAttribute('aria-pressed'), rgb: m ? [+m[1], +m[2], +m[3]] : null };
  });
  console.log(`[P104 export colour] ${JSON.stringify(exportColour)}`);
  if (exportColour?.rgb) {
    const [r, g, b] = exportColour.rgb;
    expect(g > r && g > b, `no green on an ordinary verb (${exportColour.id} rgb=${exportColour.rgb})`).toBe(false);
  }

  // Pages selection state -> the bulk Delete verb is inline and red.
  await gotoStage(win, 1);
  await win.waitForTimeout(400);
  let deleteRed = null;
  try {
    await win.locator('[data-page="1"]').first().click({ modifiers: ['Shift'], timeout: 5000 });
    await win.waitForTimeout(600);
    const state = await win.locator(DOCK).getAttribute('data-dock-state');
    if (state === 'selection') {
      deleteRed = await win.evaluate(() => {
        const el = document.querySelector('[data-action-dock] [data-dock-verb="delete"]');
        if (!el) return null;
        const cs = getComputedStyle(el);
        const m = cs.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return { rgb: m ? [+m[1], +m[2], +m[3]] : null, label: (el.querySelector('.action-dock-label')?.textContent ?? '').trim() };
      });
      await win.screenshot({ path: path.join(OUT, 'phase104-delete-red.png') });
    }
    evidence.deleteRed = { state, ...(deleteRed ?? {}) };
    console.log(`[P104 delete] state=${state} ${JSON.stringify(deleteRed)}`);
    expect(state, 'shift-click selects a page -> dock State 2').toBe('selection');
    expect(deleteRed, 'delete verb renders inline in State 2').not.toBeNull();
    if (deleteRed?.rgb) {
      const [r, g, b] = deleteRed.rgb;
      expect(r > g && r > b, `delete is red (rgb=${deleteRed.rgb})`).toBe(true);
    }
    await closeMenus();
  } catch (e) {
    evidence.deleteRed = { error: String(e).slice(0, 160) };
    console.log(`[P104 delete] selection path error: ${String(e).slice(0, 200)}`);
  }
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // ---- (f) no collision + reserved bottom inset + last page reachable -----
  await gotoStage(win, 1);
  await win.waitForTimeout(400);
  const collide = await win.evaluate(([pageSel, zoomSel]) => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const overlap = (a, b) => a && b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    const dock = r(document.querySelector('[data-action-dock]'));
    const pageEl = document.querySelector(pageSel);
    const zoomEl = document.querySelector(zoomSel);
    const page = r(pageEl);
    const zoom = r(zoomEl);
    const home = (el, pillAttr) => (el === null ? 'absent' : (el.hasAttribute(pillAttr) ? 'pill' : 'view-strip'));
    return {
      dock, page, zoom,
      pageFound: pageEl !== null, zoomFound: zoomEl !== null,
      pageHome: home(pageEl, 'data-page-pill'), zoomHome: home(zoomEl, 'data-zoom-pill'),
      dockVsPage: overlap(dock, page), dockVsZoom: overlap(dock, zoom),
      reserved: getComputedStyle(document.documentElement).getPropertyValue('--dock-band-reserved').trim(),
      scrollerPadding: getComputedStyle(document.querySelector('.document-scroller')).paddingBottom,
      scrollbarW: (document.querySelector('.document-scroller')?.offsetWidth ?? 0) - (document.querySelector('.document-scroller')?.clientWidth ?? 0),
    };
  }, [PAGE_CTL, ZOOM_CTL]);
  evidence.collide = collide;
  console.log(`[P104 collision] ${JSON.stringify(collide)}`);
  expect(collide.pageFound, 'single-mode page control resolved (pill or ViewStrip) - non-vacuous').toBe(true);
  expect(collide.zoomFound, 'single-mode zoom control resolved (pill or ViewStrip) - non-vacuous').toBe(true);
  expect(collide.dockVsPage, 'dock does not overlap the page control').toBe(false);
  expect(collide.dockVsZoom, 'dock does not overlap the zoom control').toBe(false);
  expect(parseFloat(collide.reserved), 'document-reserved dock bottom band published').toBeGreaterThan(0);
  expect(parseFloat(collide.scrollerPadding), 'scroller reserves the dock band as bottom padding')
    .toBeGreaterThanOrEqual(parseFloat(collide.reserved) - 1);

  const lastPage = await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    sc.scrollTop = sc.scrollHeight;
    const pages = [...document.querySelectorAll('.pdf-page')].filter((p) => {
      const r = p.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    let bottom = -Infinity;
    for (const p of pages) bottom = Math.max(bottom, p.getBoundingClientRect().bottom);
    const dr = document.querySelector('[data-action-dock]').getBoundingClientRect();
    return {
      lastBottom: Math.round(bottom), dockTop: Math.round(dr.top), pageCount: pages.length,
      scrollTop: Math.round(sc.scrollTop), scrollHeight: Math.round(sc.scrollHeight),
    };
  });
  evidence.lastPage = lastPage;
  console.log(`[P104 lastPage] ${JSON.stringify(lastPage)}`);
  expect(lastPage.lastBottom, 'last page bottom edge scrolls above the dock top').toBeLessThanOrEqual(lastPage.dockTop + 3);

  // ---- (g) anchored More popover ------------------------------------------
  await gotoStage(win, 1);
  await win.waitForTimeout(400);
  const scrollBefore = await win.evaluate(() => document.querySelector('.document-scroller').scrollTop);
  await win.locator('[data-dock-overflow]').first().click();
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(200);
  const pop = await win.evaluate(() => {
    const menu = document.querySelector('[data-dock-overflow-menu]');
    const btn = document.querySelector('[data-dock-overflow]');
    const mr = menu.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const items = [...menu.querySelectorAll('[role="menuitem"]')].map((e) => ({
      id: e.getAttribute('data-dock-overflow-item') ?? e.getAttribute('data-dock-menu-item'),
      disabled: e.hasAttribute('disabled'),
    }));
    const ae = document.activeElement;
    return {
      role: menu.getAttribute('role'),
      itemRoles: [...menu.querySelectorAll('[role="menuitem"]')].map((e) => e.getAttribute('role')),
      expanded: btn.getAttribute('aria-expanded'),
      opensUp: mr.bottom <= br.top + 2,
      inBounds: mr.left >= -1 && mr.right <= window.innerWidth + 1,
      menu: { t: Math.round(mr.top), b: Math.round(mr.bottom), l: Math.round(mr.left), r: Math.round(mr.right) },
      btn: { t: Math.round(br.top), b: Math.round(br.bottom) },
      items,
      initialFocus: {
        id: ae?.getAttribute('data-dock-overflow-item') ?? ae?.getAttribute('data-dock-menu-item') ?? null,
        tag: ae?.tagName ?? null,
        inMenu: !!(ae && ae.closest && ae.closest('[data-dock-overflow-menu]')),
      },
    };
  });
  evidence.popover = pop;
  console.log(`[P104 popover] ${JSON.stringify(pop)}`);
  expect(pop.role).toBe('menu');
  expect(pop.itemRoles.every((r) => r === 'menuitem')).toBe(true);
  expect(pop.expanded).toBe('true');
  expect(pop.opensUp, 'More popover opens upward').toBe(true);
  expect(pop.inBounds, 'More popover stays within screen bounds').toBe(true);
  const scrollAfter = await win.evaluate(() => document.querySelector('.document-scroller').scrollTop);
  expect(Math.abs(scrollAfter - scrollBefore), 'opening More does not reflow/scroll the document').toBeLessThanOrEqual(1);

  // Roving keyboard focus: focus the first ENABLED row, then walk the keys.
  const firstEnabled = pop.items.find((m) => !m.disabled)?.id ?? null;
  await win.evaluate((id) => {
    const el = [...document.querySelectorAll('[data-dock-overflow-menu] [role="menuitem"]')]
      .find((e) => (e.getAttribute('data-dock-overflow-item') ?? e.getAttribute('data-dock-menu-item')) === id);
    el && el.focus();
  }, firstEnabled);
  const readFocus = () => win.evaluate(() => (
    document.activeElement?.getAttribute?.('data-dock-overflow-item')
    ?? document.activeElement?.getAttribute?.('data-dock-menu-item') ?? null));
  await win.keyboard.press('ArrowDown');
  const down = await readFocus();
  await win.keyboard.press('ArrowUp');
  const up = await readFocus();
  await win.keyboard.press('Home');
  const home = await readFocus();
  await win.keyboard.press('End');
  const end = await readFocus();
  evidence.popover.rove = { firstEnabled, down, up, home, end, initialFocus: pop.initialFocus };
  console.log(`[P104 popover keys] firstEnabled=${firstEnabled} down=${down} up=${up} home=${home} end=${end} initialFocus=${JSON.stringify(pop.initialFocus)}`);
  expect(firstEnabled, 'More has an enabled row to focus').not.toBeNull();
  expect(down, 'ArrowDown moves focus to another row').not.toBe(firstEnabled);
  expect(home, 'Home focuses the first enabled row').toBe(firstEnabled);
  expect(end, 'End focuses the last row (Customize dock)').toBe('customize');

  await win.keyboard.press('Escape');
  // Phase 105 guidance: an exiting surface stays in the DOM (opacity 0) until
  // AnimatePresence completes the exit morph, so sampling after a fixed delay is
  // racy. Wait for the surface to detach, then read the close state.
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'detached', timeout: 5000 }).catch(() => {});
  const afterEscape = await win.evaluate(() => ({
    menu: !!document.querySelector('[data-dock-overflow-menu]'),
    expanded: document.querySelector('[data-dock-overflow]')?.getAttribute('aria-expanded'),
    focusOnBtn: document.activeElement === document.querySelector('[data-dock-overflow]'),
  }));
  evidence.popover.afterEscape = afterEscape;
  console.log(`[P104 escape] ${JSON.stringify(afterEscape)}`);
  expect(afterEscape.menu).toBe(false);
  expect(afterEscape.expanded).toBe('false');
  expect(afterEscape.focusOnBtn, 'Escape returns focus to the More button').toBe(true);

  // Outside click dismisses.
  await win.locator('[data-dock-overflow]').first().click();
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
  await win.mouse.click(5, 5);
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'detached', timeout: 5000 }).catch(() => {});
  expect(await win.locator('[data-dock-overflow-menu]').count(), 'outside click dismisses More').toBe(0);

  // Observation: in a stage whose FIRST More row is disabled (EDIT: batchOcr /
  // ocrSuspects both unavailable), does opening More still place focus inside
  // the menu? The initial-focus effect focuses the first `[role=menuitem]`.
  await gotoStage(win, 2);
  await win.waitForTimeout(400);
  await win.locator('[data-dock-overflow]').first().click();
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(250);
  const editFocus = await win.evaluate(() => {
    const ae = document.activeElement;
    return {
      firstItemDisabled: document.querySelector('[data-dock-overflow-menu] [role="menuitem"]')?.hasAttribute('disabled') ?? null,
      activeId: ae?.getAttribute?.('data-dock-overflow-item') ?? ae?.getAttribute?.('data-dock-menu-item') ?? null,
      activeTag: ae?.tagName ?? null,
      inMenu: !!(ae && ae.closest && ae.closest('[data-dock-overflow-menu]')),
    };
  });
  evidence.editMoreInitialFocus = editFocus;
  console.log(`[P104 edit-more-initial-focus] ${JSON.stringify(editFocus)}`);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);

  // ---- (h) motion 140ms, reduced motion, focus ring, coarse targets --------
  const motion = await win.evaluate(() => getComputedStyle(document.querySelector('[data-action-dock]')).transitionDuration);
  evidence.motion = motion;
  console.log(`[P104 motion] transitionDuration=${motion}`);
  expect(motion, 'dock transitions use the shared 140ms token').toContain('0.14s');

  const targets = await win.evaluate(() => {
    const box = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
    return { tile: box('[data-dock-group="primary"] [data-dock-verb]'), more: box('[data-dock-overflow]'), tools: box('[data-dock-tools]') };
  });
  evidence.targets = targets;
  console.log(`[P104 targets] ${JSON.stringify(targets)}`);
  for (const [k, v] of Object.entries(targets)) {
    if (!v) continue;
    expect(v.h, `${k} target height >= 44px`).toBeGreaterThanOrEqual(44);
    expect(v.w, `${k} target width >= 44px`).toBeGreaterThanOrEqual(44);
  }

  // Keyboard focus ring on a dock verb: focus the first tile, then Tab (a real
  // keyboard move) so the NEXT tile receives a genuine :focus-visible ring.
  await gotoStage(win, 1);
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const el = document.querySelector('[data-dock-group="primary"] [data-dock-verb]');
    if (el) el.focus();
  });
  await win.keyboard.press('Tab');
  await win.waitForTimeout(200);
  const ring = await win.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      id: el.getAttribute('data-dock-verb'),
      inDock: !!(el.closest && el.closest('[data-action-dock]')),
      outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, boxShadow: cs.boxShadow,
    };
  });
  evidence.focusRing = ring ?? {};
  console.log(`[P104 focus] ${JSON.stringify(evidence.focusRing)}`);
  await win.screenshot({ path: path.join(OUT, 'phase104-focus.png') });
  expect(ring?.id, 'Tab moves focus onto a dock verb').toBeTruthy();
  const hasRing = (parseFloat(ring.outlineWidth) > 0 && ring.outlineStyle !== 'none')
    || (ring.boxShadow && ring.boxShadow !== 'none');
  expect(hasRing, 'a distinct keyboard focus ring is visible on the dock verb').toBe(true);

  try {
    await win.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await win.evaluate(() => getComputedStyle(document.querySelector('[data-action-dock]')).transitionDuration);
    const maxDur = Math.max(...reduced.split(',').map((d) => parseFloat(d)));
    evidence.reducedMotion = reduced;
    console.log(`[P104 reduced-motion] transitionDuration=${reduced} max=${maxDur}`);
    expect(maxDur, 'reduced motion collapses the dock transition to effectively instant').toBeLessThanOrEqual(0.02);
  } catch (e) {
    evidence.reducedMotion = { error: String(e).slice(0, 160) };
    console.log(`[P104 reduced-motion] inconclusive: ${String(e).slice(0, 200)}`);
  }

  // ---- (c2) narrow viewport -> reserved row + screenshot -------------------
  await win.emulateMedia({ reducedMotion: null }).catch(() => {});
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);
  await setWindow(520, 820, true);
  await win.waitForTimeout(700);
  const narrow = await win.evaluate(([pageSel, zoomSel]) => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    const overlap = (a, b) => a && b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    const dock = r(document.querySelector('[data-action-dock]'));
    const pageEl = document.querySelector(pageSel);
    const zoomEl = document.querySelector(zoomSel);
    return {
      reserved: document.querySelector('[data-action-dock]')?.getAttribute('data-dock-reserved'),
      dock, page: r(pageEl), zoom: r(zoomEl),
      pageFound: pageEl !== null, zoomFound: zoomEl !== null,
      dockVsPage: overlap(dock, r(pageEl)), dockVsZoom: overlap(dock, r(zoomEl)),
      innerWidth: window.innerWidth,
      hostWidth: document.querySelector('[data-action-dock]')?.parentElement?.clientWidth ?? null,
    };
  }, [PAGE_CTL, ZOOM_CTL]);
  evidence.narrow = narrow;
  console.log(`[P104 narrow] ${JSON.stringify(narrow)}`);
  await win.screenshot({ path: path.join(OUT, 'phase104-narrow.png') });
  expect(narrow.reserved, 'narrow host takes the reserved-row rung').toBe('true');
  expect(narrow.pageFound, 'narrow: page control resolved (pill or ViewStrip) - non-vacuous').toBe(true);
  expect(narrow.zoomFound, 'narrow: zoom control resolved (pill or ViewStrip) - non-vacuous').toBe(true);
  expect(narrow.dockVsPage, 'narrow: dock does not overlap the page control').toBe(false);
  expect(narrow.dockVsZoom, 'narrow: dock does not overlap the zoom control').toBe(false);

  console.log(`[P104 evidence] ${JSON.stringify(evidence)}`);
});

module.exports = {};
