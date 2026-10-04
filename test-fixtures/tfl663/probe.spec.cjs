// TFL-663 — adversary diff-pass probes for TFL-520 chunk C.
// Focus hypotheses H1-H7. Report-only; never edits product code.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const tmpDir = (label) => {
  const d = path.join(os.tmpdir(), `tfl663-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

async function openSample(win, name = 'report.pdf') {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

const loadSettings = (win) => win.evaluate(() => window.tflex.loadSettings());

// ---------------------------------------------------------------------------
// H4 + H1 — the EDIT-mode plus picker offers only dock-runnable ids.
// ---------------------------------------------------------------------------
test('H4/H1 picker curation: openSample/windowMaximize not offered; curated globals are', async () => {
  const dir = tmpDir('h4');
  const app = await launchApp([], dir);
  const win = await app.firstWindow();
  try {
    await openSample(win);
    await win.locator('[data-dock-edit-toggle]').click();
    await win.waitForTimeout(300);
    expect(await win.locator('[data-action-dock]').getAttribute('data-dock-edit')).toBe('true');
    await win.locator('[data-dock-plus]').click();
    await win.waitForSelector('[data-dock-picker]', { state: 'visible', timeout: 8000 });
    const ids = await win.$$eval('[data-dock-picker-item]', (els) =>
      els.map((e) => e.getAttribute('data-dock-picker-item')));
    console.log(`[TFL663-H4] PAGES picker ids=${JSON.stringify(ids)}`);
    for (const id of ['undo', 'redo', 'openReadingView', 'openComicView']) {
      expect(ids, `curated global ${id} offered`).toContain(id);
    }
    for (const id of ['openSample', 'windowMaximize', 'windowMinimize', 'windowClose',
      'toggleTheme', 'preferences', 'save', 'saveAs', 'open', 'zoomIn', 'fitWidth', 'print']) {
      expect(ids, `non-dock global ${id} NOT offered`).not.toContain(id);
    }
    await win.screenshot({ path: path.join(SHOTS, 'adv-tfl663-picker.png') });
  } finally {
    await hardClose(app, 'tfl663-h4');
  }
});

// ---------------------------------------------------------------------------
// H2 — a LEGAL-BUT-DISABLED row is removable in the real browser.
// ---------------------------------------------------------------------------
test('H2 disabled stage-default verb (REVIEW forms) removed via edit minus', async () => {
  const dir = tmpDir('h2a');
  const app = await launchApp([], dir);
  const win = await app.firstWindow();
  try {
    await openSample(win);
    await win.keyboard.press('Control+3');
    await win.waitForTimeout(600);
    await win.locator('[data-dock-edit-toggle]').click();
    await win.waitForTimeout(400);

    const forms = win.locator('[data-dock-verb="forms"]');
    expect(await forms.count(), 'REVIEW forms verb rendered').toBeGreaterThan(0);
    const disabled = await forms.first().isDisabled();
    console.log(`[TFL663-H2a] forms disabled=${disabled}`);
    expect(disabled, 'forms is disabled on a PDF with no form fields').toBe(true);

    const minus = win.locator('[data-dock-minus="forms"]');
    expect(await minus.count(), 'minus rendered for disabled forms').toBe(1);
    await minus.first().click();
    await win.waitForTimeout(900);

    const after = await win.locator('[data-dock-verb="forms"]').count();
    console.log(`[TFL663-H2a] forms after minus=${after}`);
    expect(after, 'disabled forms removed by the edit-mode minus').toBe(0);
    // Persistence write is debounced; poll like the shipped P36-C3-C spec does.
    let unpinned = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      const s = await loadSettings(win);
      if (s && Array.isArray(s.dockUnpinned) && s.dockUnpinned.includes('forms')) { unpinned = s.dockUnpinned; break; }
      await win.waitForTimeout(250);
    }
    console.log(`[TFL663-H2a] dockUnpinned=${JSON.stringify(unpinned)}`);
    expect(unpinned, 'removal recorded in dockUnpinned').toContain('forms');
  } finally {
    await hardClose(app, 'tfl663-h2a');
  }
});

test('H2 pinned DISABLED global (openReadingView on a plain PDF) removed via edit minus', async () => {
  const dir = tmpDir('h2b');
  const app = await launchApp([], dir);
  const win = await app.firstWindow();
  try {
    await openSample(win);
    await win.locator('[data-dock-edit-toggle]').click();
    await win.waitForTimeout(300);
    await win.locator('[data-dock-plus]').click();
    await win.waitForSelector('[data-dock-picker]', { state: 'visible', timeout: 8000 });
    await win.locator('[data-dock-picker-item="openReadingView"]').click();
    await win.waitForTimeout(800);

    const verb = win.locator('[data-dock-verb="openReadingView"]');
    expect(await verb.count(), 'openReadingView pin rendered').toBe(1);
    const disabled = await verb.first().isDisabled();
    console.log(`[TFL663-H2b] openReadingView disabled=${disabled}`);
    expect(disabled, 'openReadingView disabled on a plain PDF').toBe(true);

    await win.locator('[data-dock-minus="openReadingView"]').first().click();
    await win.waitForTimeout(900);
    const after = await win.locator('[data-dock-verb="openReadingView"]').count();
    console.log(`[TFL663-H2b] openReadingView after minus=${after}`);
    expect(after, 'disabled pinned global removed by the edit-mode minus').toBe(0);
  } finally {
    await hardClose(app, 'tfl663-h2b');
  }
});

test('H2 right-click Unpin on a DISABLED stage-default verb (REVIEW forms)', async () => {
  const dir = tmpDir('h2c');
  const app = await launchApp([], dir);
  const win = await app.firstWindow();
  try {
    await openSample(win);
    await win.keyboard.press('Control+3');
    await win.waitForTimeout(600);
    const forms = win.locator('[data-dock-verb="forms"]').first();
    expect(await forms.isDisabled(), 'forms disabled').toBe(true);
    // force:true bypasses Playwright's enabled-actionability check so the raw
    // right-click reaches the disabled control, which is what a user's mouse
    // does. If Chromium suppresses contextmenu on disabled buttons the menu
    // never opens and this probe reports it.
    await forms.click({ button: 'right', force: true });
    let menuOpened = true;
    try {
      await win.waitForSelector('[data-dock-menu]', { state: 'visible', timeout: 4000 });
    } catch {
      menuOpened = false;
    }
    console.log(`[TFL663-H2c] right-click menu opened on disabled forms=${menuOpened}`);
    expect(menuOpened, 'right-click opens the pin/unpin menu on a disabled verb').toBe(true);
    const unpin = win.locator('[data-dock-menu-item="unpin"]');
    expect(await unpin.count(), 'unpin item present').toBe(1);
    await unpin.click();
    await win.waitForTimeout(800);
    const after = await win.locator('[data-dock-verb="forms"]').count();
    console.log(`[TFL663-H2c] forms after right-click unpin=${after}`);
    expect(after, 'forms removed via the right-click Unpin').toBe(0);
  } finally {
    await hardClose(app, 'tfl663-h2c');
  }
});

// ---------------------------------------------------------------------------
// H3 — the palette cannot pin a non-pinnable tool by any route.
// ---------------------------------------------------------------------------
test('H3 palette refuses to pin non-pinnable ids (toggle disabled, Ctrl+Enter notice, no write)', async () => {
  const dir = tmpDir('h3');
  const app = await launchApp([], dir);
  const win = await app.firstWindow();
  try {
    await openSample(win);
    const before = await loadSettings(win);
    const beforePins = JSON.stringify((before && before.dockPins) || []);

    await win.keyboard.press('Control+k');
    await win.waitForSelector('[data-command-palette]', { state: 'visible', timeout: 8000 });
    // `multi-mode` is a palette row that is NOT dock-pinnable (global, not in
    // the curated DOCK_GLOBAL_IDS).
    await win.fill('[data-command-palette-input]', 'multi mode');
    await win.waitForTimeout(300);
    const row = win.locator('[data-palette-tool-id="multi-mode"]').first();
    await expect(row).toBeVisible();
    const toggle = row.locator('[data-palette-pin-toggle]');
    const disabled = await toggle.isDisabled();
    console.log(`[TFL663-H3] multi-mode pin toggle disabled=${disabled}`);
    expect(disabled, 'pin toggle disabled for non-pinnable multi-mode').toBe(true);
    await row.hover();
    await win.keyboard.press('Control+Enter');
    await win.waitForTimeout(500);
    const notice = await win.locator('[data-command-palette-notice]').count() > 0
      ? await win.locator('[data-command-palette-notice]').innerText()
      : null;
    console.log(`[TFL663-H3] notice after Ctrl+Enter="${notice}"`);
    expect(notice || '', 'no false "Pinned" report for a refused id').not.toContain('Pinned');
    const after = await loadSettings(win);
    const afterPins = JSON.stringify((after && after.dockPins) || []);
    console.log(`[TFL663-H3] dockPins before=${beforePins} after=${afterPins}`);
    expect(afterPins, 'Ctrl+Enter did not write dockPins').toBe(beforePins);
    await win.screenshot({ path: path.join(SHOTS, 'adv-tfl663-palette-refuse.png') });
  } finally {
    await hardClose(app, 'tfl663-h3');
  }
});

// ---------------------------------------------------------------------------
// H7 — legacy persisted pins are dropped cleanly and do not resurrect.
// ---------------------------------------------------------------------------
test('H7 legacy pins (zoomIn/openSample/fitWidth) dropped; dock state preserved; no resurrect', async () => {
  const dir = tmpDir('h7');
  // Seed a legacy settings file BEFORE launch.
  const settings = {
    dockPins: ['zoomIn', 'openSample', 'fitWidth', 'rotate'],
    dockUnpinned: [],
  };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2));

  const app = await launchApp([], dir);
  const win = await app.firstWindow();
  try {
    await openSample(win);
    await win.keyboard.press('Control+1');
    await win.waitForTimeout(600);
    const pins = await win.$$eval('[data-action-dock] [data-dock-pin]', (els) =>
      els.map((e) => e.getAttribute('data-dock-pin')));
    const verbs = await win.$$eval('[data-action-dock] [data-dock-verb]', (els) =>
      els.map((e) => e.getAttribute('data-dock-verb')));
    console.log(`[TFL663-H7] pins=${JSON.stringify(pins)} verbs=${JSON.stringify(verbs)}`);
    // `rotate` was seeded too but it is already a PAGES stage default, so the
    // dock dedupes it (no pinned row); the three ILLEGAL legacy pins must be gone.
    expect(pins, 'no illegal legacy pin renders after the divider').toEqual([]);
    for (const dead of ['zoomIn', 'openSample', 'fitWidth']) {
      expect(verbs, `${dead} renders no dead row`).not.toContain(dead);
    }
    // Store URL absent here; the dock must be a single row and inside viewport.
    const dock = await win.locator('[data-action-dock]').boundingBox();
    const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    expect(dock.x >= -1 && dock.x + dock.width <= vp.w + 1, 'dock inside viewport').toBe(true);

    // Trigger a curation write through the UI (unpin rotate via right-click),
    // then confirm the legacy ids are gone from the persisted file too.
    await win.locator('[data-dock-verb="rotate"]').first().click({ button: 'right' });
    await win.waitForSelector('[data-dock-menu]', { state: 'visible', timeout: 8000 });
    await win.locator('[data-dock-menu-item="unpin"]').click();
    await win.waitForTimeout(1200);
    const after = await loadSettings(win);
    console.log(`[TFL663-H7] persisted after unpin: dockPins=${JSON.stringify(after && after.dockPins)} dockUnpinned=${JSON.stringify(after && after.dockUnpinned)}`);
    expect((after && after.dockPins) || [], 'legacy pins cleared from persistence').not.toContain('zoomIn');
    expect((after && after.dockPins) || []).not.toContain('openSample');
    expect((after && after.dockPins) || []).not.toContain('fitWidth');
    // No resurrect: the dropped legacy pins must not reappear.
    const verbs2 = await win.$$eval('[data-action-dock] [data-dock-verb]', (els) =>
      els.map((e) => e.getAttribute('data-dock-verb')));
    for (const dead of ['zoomIn', 'openSample', 'fitWidth']) {
      expect(verbs2, `${dead} did not resurrect`).not.toContain(dead);
    }
  } finally {
    await hardClose(app, 'tfl663-h7');
  }
});

// ---------------------------------------------------------------------------
// H6 — the slot wrapper must not change fit/overflow or badge containment.
// ---------------------------------------------------------------------------
test('H6 slot geometry: slot == button box, single row, no pill overlap, badge contained', async () => {
  const dir = tmpDir('h6');
  const app = await launchApp([], dir);
  const win = await app.firstWindow();
  try {
    await openSample(win);
    const setSize = (w, h) => app.evaluate(({ BrowserWindow }, s) => {
      const bw = BrowserWindow.getAllWindows()[0];
      if (!bw) return;
      if (bw.isMaximized()) bw.unmaximize();
      bw.setSize(s[0], s[1]);
    }, [w, h]);
    for (const w of [1600, 1328, 1100, 900, 820, 620, 480]) {
      await setSize(w, 900);
      await win.waitForTimeout(700);
      const m = await win.evaluate(() => {
        const dock = document.querySelector('[data-action-dock]');
        const dr = dock.getBoundingClientRect();
        const slots = [...dock.querySelectorAll('.action-dock-verb-slot')];
        const btns = [...dock.querySelectorAll('[data-dock-verb]')];
        const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
        const mismatch = [];
        for (const s of slots) {
          const b = s.querySelector('[data-dock-verb]');
          if (!b) continue;
          const sb = box(s); const bb = box(b);
          if (Math.abs(sb.l - bb.l) > 1 || Math.abs(sb.r - bb.r) > 1 || Math.abs(sb.w - bb.w) > 1) {
            mismatch.push({ id: b.getAttribute('data-dock-verb'), slot: sb, btn: bb });
          }
        }
        const tops = btns.map((b) => Math.round(b.getBoundingClientRect().top));
        const uniqueTops = [...new Set(tops)];
        const pillRects = [...document.querySelectorAll('[data-canvas-pills] button')].filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }).map((b) => { const r = b.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, a: b.getAttribute('aria-label') }; });
        const overlap = [];
        const sc = document.querySelector('[data-dock-scroll]');
        const scr = sc.getBoundingClientRect();
        const clipOn = sc.scrollWidth > sc.clientWidth + 1;
        for (const v of btns) {
          const vr = v.getBoundingClientRect();
          const cx = vr.left + vr.width / 2;
          const cy = vr.top + vr.height / 2;
          // Only judge a verb whose centre is inside the scroller's VISIBLE box:
          // a horizontally clipped (scrolled-out) verb's layout rect can sit
          // under a pill without painting there.
          if (clipOn && (cx < scr.left || cx > scr.right)) continue;
          const top = document.elementFromPoint(Math.round(cx), Math.round(cy));
          if (top === null) continue;
          const pillEl = top.closest('[data-canvas-pills] button');
          if (pillEl) overlap.push({ verb: v.getAttribute('data-dock-verb'), pill: pillEl.getAttribute('aria-label') });
        }
        return {
          iconOnly: dock.getAttribute('data-dock-icon-only'),
          compact: dock.getAttribute('data-dock-compact'),
          slotCount: slots.length,
          verbCount: btns.length,
          rowCount: uniqueTops.length,
          mismatch,
          overlap,
          dockW: Math.round(dr.width),
          dockInVp: dr.left >= -1 && dr.right <= window.innerWidth + 1,
          scrollW: document.querySelector('[data-dock-scroll]')?.scrollWidth ?? 0,
          scrollC: document.querySelector('[data-dock-scroll]')?.clientWidth ?? 0,
        };
      });
      console.log(`[TFL663-H6] w=${w} ${JSON.stringify(m)}`);
      expect(m.mismatch, `slot box == verb box at ${w}`).toEqual([]);
      expect(m.rowCount, `single row (one top) at ${w}`).toBeLessThanOrEqual(1);
      expect(m.overlap, `no verb overlaps a pill at ${w}`).toEqual([]);
      expect(m.dockInVp, `dock inside viewport at ${w}`).toBe(true);
    }

    // Badge containment (DEF-518) in the arrows lane with edit mode ON.
    await setSize(900, 900);
    await win.waitForTimeout(600);
    await win.locator('[data-dock-edit-toggle]').click();
    await win.waitForTimeout(500);
    const badge = await win.evaluate(() => {
      const sc = document.querySelector('[data-dock-scroll]');
      const scr = sc.getBoundingClientRect();
      const badges = [...document.querySelectorAll('[data-dock-minus]')].map((m) => {
        const r = m.getBoundingClientRect();
        return { id: m.getAttribute('data-dock-minus'), top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      });
      return { scroll: { t: scr.top, b: scr.bottom, l: scr.left, r: scr.right }, badgeCount: badges.length, badges };
    });
    console.log(`[TFL663-H6] badge containment ${JSON.stringify(badge)}`);
    expect(badge.badgeCount, 'badges render in edit mode').toBeGreaterThan(0);
    const outside = badge.badges.filter((b) => b.top < badge.scroll.t - 0.6 || b.left < badge.scroll.l - 0.6);
    expect(outside, 'no badge paints above/left of the clip box').toEqual([]);
    await win.screenshot({ path: path.join(SHOTS, 'adv-tfl663-badges.png') });
  } finally {
    await hardClose(app, 'tfl663-h6');
  }
});