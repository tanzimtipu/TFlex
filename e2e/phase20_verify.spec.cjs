// Phase 20 QA verification — "Animation standard: morphing surfaces, animated
// resizes, no un-animated appearances".
//
// Measures the running Electron app (canonical launcher only) against the
// phase's seven success criteria:
//   C1 morphing menus (rect per frame, flush seam, origin, reverse exit)
//   C2 animated context-window resize (Sign tabs) + tools palette width swap
//   C3 window-to-window swaps (no both-absent / both-at-rest frame)
//   C4 surface inventory sweep (runtime probe of every family)
//   C6 reduced motion collapses to the reduced path, structure unchanged
//   C7 (unit contract) + ghost-node interactivity after opacity 0
//
// Screenshots: screenshots/phase20-verify-*.png
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const THEMES = ['light', 'dark', 'frosted'];

async function openReport(app, win) {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(400);
}

async function setTheme(win, want) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${want}"]`);
  await win.waitForFunction(
    (w) => document.documentElement.getAttribute('data-theme') === w,
    want,
    { timeout: 5000 },
  );
  await win.waitForTimeout(350);
}

async function rectOf(win, sel) {
  return win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: +r.left.toFixed(2), y: +r.top.toFixed(2),
      w: +r.width.toFixed(2), h: +r.height.toFixed(2),
      right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2),
      to: cs.transformOrigin, pe: cs.pointerEvents,
    };
  }, sel);
}

// ---------------------------------------------------------------------------
// In-page rAF probe. startProbe(sel, ms) samples one selector every frame:
// its rect, transform, opacity, pointer-events, transform-origin, the
// data-tf-morph phase and whether it is inside an inert subtree.
// ---------------------------------------------------------------------------
async function installProbe(win) {
  await win.evaluate(() => {
    window.__p20 = { rows: [], running: false };
    window.__p20Start = (sel, ms) => {
      window.__p20 = { rows: [], running: true };
      const t0 = performance.now();
      const tick = () => {
        const t = Math.round(performance.now() - t0);
        const el = document.querySelector(sel);
        if (el) {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          window.__p20.rows.push({
            t,
            x: +r.left.toFixed(2), y: +r.top.toFixed(2),
            w: +r.width.toFixed(2), h: +r.height.toFixed(2),
            right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2),
            tr: cs.transform, op: +cs.opacity,
            pe: cs.pointerEvents, to: cs.transformOrigin,
            morph: el.getAttribute('data-tf-morph'),
            inert: el.hasAttribute('inert') || el.closest('[inert]') !== null,
          });
        } else {
          window.__p20.rows.push({ t, gone: true });
        }
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__p20.running = false;
      };
      requestAnimationFrame(tick);
    };
  });
}

async function startProbe(win, sel, ms) {
  await win.evaluate(([s, m]) => window.__p20Start(s, m), [sel, ms]);
}
async function readProbe(win) {
  await win.waitForFunction(() => window.__p20.running === false, null, { timeout: 8000 }).catch(() => {});
  return win.evaluate(() => window.__p20.rows);
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const visible = (rows) => rows.filter((r) => !r.gone);
const log = (label, obj) => console.log(`[P20] ${label}: ${JSON.stringify(obj)}`);

// ---------------------------------------------------------------------------
// C1 — morphing menus: open + close, all three themes.
// ---------------------------------------------------------------------------
const MENUS = [
  { name: 'theme', trigger: '[data-theme-toggle]', surface: '.theme-toggle-popover', anchor: 'top right', anchorSide: 'right' },
  { name: 'titlebar', trigger: '[data-menu-button]', surface: '.titlebar-menu-popover', anchor: 'top left', anchorSide: 'left' },
  { name: 'ann', trigger: '[data-ann-dropdown-toggle]', surface: '.ann-tool-menu', anchor: 'top right', anchorSide: 'right' },
];

for (const theme of THEMES) {
  test(`C1 morph menus open+close — ${theme}`, async () => {
    test.setTimeout(180000);
    const app = await launchApp();
    const win = await app.firstWindow();
    try {
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await openReport(app, win);
      await setTheme(win, theme);
      await installProbe(win);

      for (const m of MENUS) {
        await win.waitForTimeout(250);
        const trig = await rectOf(win, m.trigger);
        expect(trig, `${m.name} trigger present`).not.toBeNull();

        // ---- open ----
        await startProbe(win, m.surface, 700);
        await win.click(m.trigger);
        await win.waitForSelector(m.surface, { timeout: 5000 });
        // mid-flight evidence (morph runs ~200ms)
        await win.waitForTimeout(50);
        await win.screenshot({ path: path.join(SHOTS, `phase20-verify-morph-${theme}-${m.name}-mid.png`) });
        const openRows = await readProbe(win);
        const open = visible(openRows);
        expect(open.length, `${m.name} open frames`).toBeGreaterThan(3);

        const first = open[0];
        const rest = open[open.length - 1];
        const widths = [...new Set(open.map((r) => Math.round(r.w)))];
        const opacities = [...new Set(open.map((r) => r.op))];

        log(`C1 ${theme} ${m.name} open`, {
          trigger: [trig.x, trig.y, trig.w, trig.h],
          firstFrame: [first.x, first.y, first.w, first.h, first.op],
          rest: [rest.x, rest.y, rest.w, rest.h, rest.op],
          gapBelow: +(rest.y - trig.bottom).toFixed(2),
          anchorGap: +(m.anchorSide === 'right' ? rest.right - trig.right : rest.x - trig.x).toFixed(2),
          transformOrigin: first.to,
          distinctWidths: widths.length,
          opacityStart: first.op,
          frames: open.length,
        });

        // First painted frame IS the trigger's box (FLIP start).
        expect(near(first.x, trig.x, 2.5), `${m.name} first frame x == trigger x`).toBe(true);
        expect(near(first.y, trig.y, 2.5), `${m.name} first frame y == trigger y`).toBe(true);
        expect(near(first.w, trig.w, 2.5), `${m.name} first frame w == trigger w`).toBe(true);
        expect(near(first.h, trig.h, 2.5), `${m.name} first frame h == trigger h`).toBe(true);
        // origin pinned at the seam corner (computed resolves to px:
        // "top right" on a 176px box reads "176px 0px")
        const [ox, oy] = first.to.split(' ').map((v) => parseFloat(v));
        const wantOx = m.anchorSide === 'right' ? rest.w : 0;
        expect(near(ox, wantOx, 2), `${m.name} transform-origin x at seam corner (${first.to})`).toBe(true);
        expect(near(oy, 0, 1), `${m.name} transform-origin y at top seam (${first.to})`).toBe(true);
        // real interpolation, not a jump
        expect(widths.length, `${m.name} width interpolates`).toBeGreaterThanOrEqual(4);
        expect(opacities.some((o) => o > 0.8 && o < 1), `${m.name} surface opacity ramps`).toBe(true);
        // flush (gap 0) at the anchored edge
        expect(near(rest.y - trig.bottom, 0, 1.5), `${m.name} flush below trigger (gap 0)`).toBe(true);
        const anchorGap = m.anchorSide === 'right' ? rest.right - trig.right : rest.x - trig.x;
        // Right-anchored menus are exactly flush; the title-bar menu keeps a
        // deliberate 4px left inset (--sp-1) — record it, bound it small.
        expect(near(anchorGap, 0, m.anchorSide === 'right' ? 1.5 : 6), `${m.name} flush on anchored side`).toBe(true);
        expect(rest.op, `${m.name} settles opaque`).toBe(1);

        await win.screenshot({ path: path.join(SHOTS, `phase20-verify-morph-${theme}-${m.name}.png`) });

        // ---- close (reverse morph into the trigger) ----
        await startProbe(win, m.surface, 700);
        await win.keyboard.press('Escape');
        const closeRows = await readProbe(win);
        const closing = visible(closeRows);
        const goneFrame = closeRows.find((r) => r.gone);
        const lastVisible = closing[closing.length - 1];
        const minW = Math.min(...closing.map((r) => r.w));
        log(`C1 ${theme} ${m.name} close`, {
          frames: closing.length,
          lastVisible: [lastVisible.x, lastVisible.y, lastVisible.w, lastVisible.h, lastVisible.op],
          minWidth: minW,
          triggerW: trig.w,
          lastMorphPhase: lastVisible.morph,
          unmounted: goneFrame !== undefined,
        });
        expect(goneFrame, `${m.name} unmounts after exit`).toBeDefined();
        // exit reverses toward the trigger box and fades. The sampler's last
        // frame lands a few ms before AnimatePresence unmounts (motion drops
        // the node at the exit's final value), so require the exit to cover
        // at least 85% of the rest->trigger travel rather than the exact
        // target. The trigger width itself varies by theme (the frosted pill
        // is labelled and much wider).
        const travel = rest.w - trig.w;
        expect(minW, `${m.name} exit shrinks from rest`).toBeLessThan(rest.w - 1);
        expect(minW, `${m.name} exit reverses into trigger (>=85% of travel)`).toBeLessThanOrEqual(trig.w + travel * 0.15);
        expect(lastVisible.op, `${m.name} exit ends faded`).toBeLessThan(0.2);
        expect(lastVisible.morph, `${m.name} exit carries data-tf-morph=out`).toBe('out');
      }
    } finally {
      await hardClose(app, `p20-c1-${theme}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Multi-selector rAF probe: per frame, for each selector records the element
// count and each element's opacity + first element's rect. Used for the
// resize/swap/inventory measurements.
// ---------------------------------------------------------------------------
async function installMultiProbe(win) {
  await win.evaluate(() => {
    window.__mp = { rows: [], running: false };
    window.__mpStart = (sels, ms) => {
      window.__mp = { rows: [], running: true };
      const t0 = performance.now();
      const tick = () => {
        const t = Math.round(performance.now() - t0);
        const states = sels.map((s) => {
          const els = [...document.querySelectorAll(s)];
          if (els.length === 0) return { s, n: 0, ops: [] };
          const first = els[0];
          const cs = getComputedStyle(first);
          const r = first.getBoundingClientRect();
          return {
            s, n: els.length,
            ops: els.map((e) => +getComputedStyle(e).opacity),
            x: +r.left.toFixed(1), y: +r.top.toFixed(1),
            w: +r.width.toFixed(1), h: +r.height.toFixed(1),
            right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1),
            pe: cs.pointerEvents, an: cs.animationName, tr: cs.transform,
          };
        });
        window.__mp.rows.push({ t, states });
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__mp.running = false;
      };
      requestAnimationFrame(tick);
    };
  });
}
async function mpStart(win, sels, ms) {
  await win.evaluate(([s, m]) => window.__mpStart(s, m), [sels, ms]);
}
async function mpRead(win) {
  await win.waitForFunction(() => window.__mp.running === false, null, { timeout: 8000 }).catch(() => {});
  return win.evaluate(() => window.__mp.rows);
}

// The two-negative swap test: over the sampled window, never zero surfaces
// present and never both surfaces fully painted at rest (op >= 0.99).
function swapVerdict(rows, a, b) {
  const bothAbsent = rows.filter((f) => {
    const sa = f.states.find((s) => s.s === a);
    const sb = f.states.find((s) => s.s === b);
    return (sa?.n ?? 0) === 0 && (sb?.n ?? 0) === 0;
  }).length;
  const bothRest = rows.filter((f) => {
    const sa = f.states.find((s) => s.s === a);
    const sb = f.states.find((s) => s.s === b);
    const aRest = (sa?.n ?? 0) > 0 && (sa.ops[0] ?? 0) >= 0.99;
    const bRest = (sb?.n ?? 0) > 0 && (sb.ops[0] ?? 0) >= 0.99;
    return aRest && bRest;
  }).length;
  const overlap = rows.filter((f) => {
    const sa = f.states.find((s) => s.s === a);
    const sb = f.states.find((s) => s.s === b);
    return (sa?.n ?? 0) > 0 && (sb?.n ?? 0) > 0;
  }).length;
  return { frames: rows.length, bothAbsent, bothRest, overlap };
}

// ---------------------------------------------------------------------------
// C2a — Sign modal three tab switches: frame height interpolates.
// C3 (partial) — the tab panes cross-fade (never both absent / both at rest).
// ---------------------------------------------------------------------------
test('C2a sign modal tab-switch resize + pane cross-fade', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await win.click('button[data-icon="sign"]');
    await win.waitForSelector('.sig-manager', { timeout: 8000 });
    await win.waitForTimeout(600);
    await installMultiProbe(win);

    await win.locator('.sig-tab', { hasText: 'Draw' }).first().click();
    await win.waitForTimeout(500);

    const order = [
      { name: 'draw->type', label: 'Type' },
      { name: 'type->saved', label: 'Saved' },
      { name: 'saved->draw', label: 'Draw' },
    ];
    const results = [];
    for (const t of order) {
      const before = await rectOf(win, '[data-tf-resize]');
      await mpStart(win, ['[data-tf-resize]', '.sig-tab-pane'], 800);
      await win.locator('.sig-tab', { hasText: t.label }).first().click();
      const rows = await mpRead(win);
      const after = await rectOf(win, '[data-tf-resize]');
      const heights = rows
        .map((f) => f.states.find((s) => s.s === '[data-tf-resize]'))
        .filter((s) => s && s.n > 0)
        .map((s) => Math.round(s.h));
      const uniq = [...new Set(heights)];
      // time from first height change to settle
      const firstIdx = heights.findIndex((h) => h !== Math.round(before.h));
      const settleIdx = heights.findIndex((h, i) => i > firstIdx && h === Math.round(after.h));
      const startT = firstIdx >= 0 ? rows[firstIdx].t : null;
      const endT = settleIdx >= 0 ? rows[settleIdx].t : null;
      const swap = swapVerdict(rows, '.sig-tab-pane', '.sig-tab-pane');
      // both panes are the same selector; recompute a true pair from ops[0]/ops[1]
      const paneRows = rows.map((f) => {
        const s = f.states.find((x) => x.s === '.sig-tab-pane');
        return { n: s?.n ?? 0, ops: s?.ops ?? [] };
      });
      const zeroPane = paneRows.filter((p) => p.n === 0).length;
      const twoRest = paneRows.filter((p) => p.ops.length >= 2 && p.ops.every((o) => o >= 0.99)).length;
      const overlap = paneRows.filter((p) => p.n >= 2).length;
      const r = {
        tab: t.name,
        fromH: Math.round(before.h), toH: Math.round(after.h),
        distinctHeights: uniq.length,
        heightsSample: uniq.slice(0, 12),
        firstChangeT: startT, settleT: endT,
        durationMs: startT !== null && endT !== null ? endT - startT : null,
        zeroPaneFrames: zeroPane, bothPaneAtRestFrames: twoRest, paneOverlapFrames: overlap,
        frames: rows.length,
      };
      results.push(r);
      log(`C2a ${t.name}`, r);
      await win.waitForTimeout(450);
    }

    for (const r of results) {
      if (r.fromH !== r.toH) {
        expect(r.distinctHeights, `${r.tab}: height interpolates (not a jump)`).toBeGreaterThanOrEqual(3);
        expect(r.durationMs, `${r.tab}: resize runs for the layout token (~250ms)`).toBeGreaterThanOrEqual(120);
        expect(r.durationMs, `${r.tab}: resize does not drag`).toBeLessThanOrEqual(450);
      }
      expect(r.zeroPaneFrames, `${r.tab}: no frame with both panes absent`).toBe(0);
      expect(r.bothPaneAtRestFrames, `${r.tab}: no frame with both panes fully at rest`).toBe(0);
      expect(r.paneOverlapFrames, `${r.tab}: panes overlap (cross-fade)`).toBeGreaterThan(0);
    }
    await win.screenshot({ path: path.join(SHOTS, 'phase20-verify-sign-tabs.png') });
  } finally {
    await hardClose(app, 'p20-c2a');
  }
});

// ---------------------------------------------------------------------------
// C2b — tools palette list<->grid width swap in lockstep with page inset+badge.
// ---------------------------------------------------------------------------
test('C2b tools palette resize lockstep with page inset + badge', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.waitForTimeout(500);
    await installMultiProbe(win);

    const sample = async (label) => {
      const pre = await win.evaluate(() => {
        const el = document.querySelector('[data-tools-palette]');
        const cs = getComputedStyle(el);
        return { tp: cs.transitionProperty, td: cs.transitionDuration, w: cs.width, cls: el.className, inline: el.style.transition };
      });
      log(`C2b ${label} pre`, pre);
      await mpStart(win, ['[data-tools-palette]', '.document-scroller', '.tools-badge-tracker'], 800);
      await win.click(`[data-tools-layout="${label.endsWith('grid') ? 'grid' : 'list'}"]`);
      const rows = await mpRead(win);
      const series = (sel, key) => [...new Set(rows.map((f) => {
        const s = f.states.find((x) => x.s === sel);
        return s && s.n > 0 ? Math.round(s[key]) : null;
      }).filter((v) => v !== null))];
      const r = {
        paletteWidths: series('[data-tools-palette]', 'w'),
        scrollerRights: series('.document-scroller', 'right'),
        badgeRights: series('.tools-badge-tracker', 'right'),
        frames: rows.length,
      };
      log(`C2b ${label}`, r);
      return r;
    };

    const results = [];
    for (const theme of ['light', 'dark', 'frosted']) {
      await setTheme(win, theme);
      if (await win.locator('[data-tools-palette]').count() === 0) {
        await win.click('[data-tools-toggle]');
        await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
        await win.waitForTimeout(400);
      }
      await win.waitForTimeout(250);
      const toGrid = await sample(`${theme}-to-grid`);
      await win.waitForTimeout(400);
      const toList = await sample(`${theme}-to-list`);
      results.push({ theme, toGrid, toList });
    }
    await win.screenshot({ path: path.join(SHOTS, 'phase20-verify-palette-resize.png') });

    for (const { theme, toGrid, toList } of results) {
      for (const [name, r] of [['grid', toGrid], ['list', toList]]) {
        expect(r.paletteWidths.length, `${theme} ${name}: palette width interpolates`).toBeGreaterThanOrEqual(3);
        expect(r.scrollerRights.length, `${theme} ${name}: page inset interpolates`).toBeGreaterThanOrEqual(3);
        expect(r.badgeRights.length, `${theme} ${name}: badge interpolates`).toBeGreaterThanOrEqual(3);
      }
    }
  } finally {
    await hardClose(app, 'p20-c2b');
  }
});

// ---------------------------------------------------------------------------
// C3 — window-to-window swaps (no both-absent / both-at-rest frame).
//   (a) stamp action bar -> stamp type editor
//   (b) edit box toolbar -> inline editor
//   (c) signature pending bar -> committed action bar
// ---------------------------------------------------------------------------
test('C3a stamp action bar <-> stamp type editor swap', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.click('[data-tool-id="stamp"]');
    await win.waitForSelector('[data-stamp-dialog]', { timeout: 8000 });
    await win.click('[data-stamp-confirm]');
    await win.waitForTimeout(500);
    if (await win.locator('[data-tools-palette]').count()) {
      await win.click('[data-tools-toggle]');
      await win.waitForTimeout(350);
    }
    const page = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(page.x + page.width * 0.5, page.y + page.height * 0.5);
    await win.waitForSelector('.stamp-annotation', { timeout: 10000 });
    await win.waitForTimeout(1200);
    await win.locator('.stamp-annotation').first().click();
    await win.waitForSelector('[data-content-action-bar="stamp"]', { timeout: 8000 });
    await installMultiProbe(win);

    await mpStart(win, ['[data-content-action-bar="stamp"]', '[data-stamp-type-editor]'], 800);
    await win.click('[data-content-action="stamp-edit"]');
    const rows = await mpRead(win);
    const v = swapVerdict(rows, '[data-content-action-bar="stamp"]', '[data-stamp-type-editor]');
    log('C3a stamp->editor', v);
    expect(v.bothAbsent, 'stamp swap: no both-absent frame').toBe(0);
    expect(v.bothRest, 'stamp swap: no both-at-rest frame').toBe(0);
    expect(v.overlap, 'stamp swap: surfaces overlap (cross-fade)').toBeGreaterThan(0);
    await win.waitForSelector('[data-stamp-type-editor]', { timeout: 5000 });

    await mpStart(win, ['[data-content-action-bar="stamp"]', '[data-stamp-type-editor]'], 800);
    await win.click('[data-stamp-type-cancel]');
    const back = await mpRead(win);
    const v2 = swapVerdict(back, '[data-content-action-bar="stamp"]', '[data-stamp-type-editor]');
    log('C3a editor->stamp', v2);
    expect(v2.bothAbsent, 'stamp swap back: no both-absent frame').toBe(0);
    expect(v2.bothRest, 'stamp swap back: no both-at-rest frame').toBe(0);
    await win.screenshot({ path: path.join(SHOTS, 'phase20-verify-swap-stamp.png') });
  } finally {
    await hardClose(app, 'p20-c3a');
  }
});

test('C3b edit box toolbar -> panel Text field (inline editor retired)', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    await win.click('[data-edit-tool="box"]');
    const page = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    const x = page.x + page.width * 0.3;
    const y = page.y + page.height * 0.3;
    await win.mouse.move(x, y);
    await win.mouse.down();
    await win.mouse.move(x + 180, y + 60, { steps: 6 });
    await win.mouse.up();
    // Phase 26 — panel Text field is the editor; the inline editor is retired.
    await win.waitForSelector('[data-txt-text]', { timeout: 8000 });
    await win.waitForFunction(() => {
      const ta = document.querySelector('[data-txt-text]');
      return ta !== null && ta.disabled === false;
    }, null, { timeout: 8000 });
    await win.locator('[data-txt-text]').fill('QA SWAP');
    await win.locator('[data-txt-text]').blur();
    await win.waitForTimeout(900);
    // select the committed box -> box toolbar
    if (await win.locator('[data-edit-box-toolbar]').count() === 0) {
      await win.locator('.edit-box').first().click();
    }
    await win.waitForSelector('[data-edit-box-toolbar]', { timeout: 8000 });

    await win.click('[data-edit-box-action="edit"]');
    await win.waitForTimeout(600);
    const state = await win.evaluate(() => ({
      editor: document.querySelectorAll('.edit-inline-editor, [data-edit-editor]').length,
      toolbar: !!document.querySelector('[data-edit-box-toolbar]'),
      panelField: !!document.querySelector('[data-txt-text]'),
      panelEnabled: document.querySelector('[data-txt-text]')?.disabled === false,
      panelValue: document.querySelector('[data-txt-text]')?.value ?? null,
    }));
    log('C3b toolbar->panel field (Phase 26)', state);
    await win.screenshot({ path: path.join(SHOTS, 'phase20-verify-swap-edit.png') });
    expect(state.editor, 'Phase 26: Edit opens NO in-canvas editor').toBe(0);
    expect(state.panelField, 'Phase 26: the panel Text field is the editor').toBe(true);
    expect(state.panelEnabled, 'Phase 26: the panel Text field is the target').toBe(true);
    expect(state.panelValue, 'Phase 26: the field shows the box text').toBe('QA SWAP');
  } finally {
    await hardClose(app, 'p20-c3b');
  }
});

test('C3c signature pending view enters/exits animated (no sibling committed swap exists)', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await win.click('button[data-icon="sign"]');
    await win.waitForSelector('.sig-manager', { timeout: 8000 });
    await win.locator('.sig-tab', { hasText: 'Type' }).first().click();
    await win.waitForTimeout(450);
    await win.locator('.sig-type-input').fill('QA Sign');
    await win.locator('.sig-tab-pane[data-tf-pane="in"] .sig-tab-actions .btn-primary').click();
    await win.waitForSelector('.sig-saved-pick', { timeout: 8000 });
    await win.locator('.sig-saved-pick').first().click();
    await win.waitForFunction(() => document.querySelector('.sig-manager') === null, null, { timeout: 5000 });
    await win.waitForTimeout(300);
    const page = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await installMultiProbe(win);

    // enter: sample across the page click that spawns the pending view
    await mpStart(win, ['[data-sig-pending]'], 700);
    await win.mouse.click(page.x + page.width * 0.4, page.y + page.height * 0.4);
    const enter = await mpRead(win);
    const enterFrames = enter.map((f) => f.states[0]).filter((s) => s && s.n > 0);
    const enterFirst = enterFrames[0];
    log('C3c pending enter', { frames: enterFrames.length, firstOp: enterFirst?.op, ops: [...new Set(enterFrames.map((s) => s.ops[0]))].slice(0, 6) });
    expect(enterFrames.length, 'pending view mounts').toBeGreaterThan(2);
    expect(enterFrames.some((s) => (s.ops[0] ?? 1) < 1), 'pending enter is mid-flight (fades in)').toBe(true);

    await win.waitForSelector('[data-sig-pending]', { timeout: 8000 });
    await win.waitForTimeout(300);

    // exit: confirm commits the placement; the pending bar must animate out
    await mpStart(win, ['[data-sig-pending]'], 700);
    await win.click('[data-sig-pending] [data-sig-action="confirm"]');
    const exit = await mpRead(win);
    const exitFrames = exit.map((f) => f.states[0]).filter((s) => s && s.n > 0);
    const gone = exit.find((f) => f.states[0].n === 0);
    log('C3c pending exit', {
      frames: exitFrames.length,
      ops: [...new Set(exitFrames.map((s) => s.ops[0]))].slice(0, 8),
      lastOp: exitFrames[exitFrames.length - 1]?.ops[0],
      unmounted: gone !== undefined,
      committedSiblingBars: await win.locator('[data-sig-action-bar]').count(),
    });
    expect(gone, 'pending view unmounts after confirm').toBeDefined();
    expect(exitFrames.some((s) => (s.ops[0] ?? 1) < 1), 'pending exit is mid-flight (fades out)').toBe(true);
    await win.screenshot({ path: path.join(SHOTS, 'phase20-verify-swap-sign.png') });
  } finally {
    await hardClose(app, 'p20-c3c');
  }
});

// ---------------------------------------------------------------------------
// C4 — surface inventory sweep: every family that appears is token-animated.
// Records, per family: the first painted frame's opacity/transform, whether
// the frame is mid-flight, and whether any CSS keyframe runs on the root.
// ---------------------------------------------------------------------------
async function appearanceProbe(win, sel, action, ms = 700) {
  await mpStart(win, [sel], ms);
  await action();
  const rows = await mpRead(win);
  const frames = rows.map((f) => f.states[0]).filter((s) => s && s.n > 0);
  if (frames.length === 0) return { sel, frames: 0, animated: false, keyframes: [] };
  const first = frames[0];
  const midFlight = frames.some((s) => (s.ops[0] ?? 1) < 0.999 || (s.tr && s.tr !== 'none'));
  const keyframes = [...new Set(frames.map((s) => s.an).filter((a) => a && a !== 'none'))];
  return {
    sel, frames: frames.length,
    firstOp: first.ops[0], firstTransform: first.tr,
    animated: midFlight, keyframes,
  };
}

test('C4 surface inventory sweep (runtime appearance probe)', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  const table = [];
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await installMultiProbe(win);

    const add = (family, r) => {
      table.push({ family, ...r });
      log(`C4 ${family}`, r);
      if (r.frames > 0) {
        expect(r.animated, `${family}: appearance is animated (mid-flight frame)`).toBe(true);
        expect(r.keyframes, `${family}: no CSS keyframe on the surface root`).toEqual([]);
      }
    };

    // color popover (TfPopover) — arm a markup tool so the swatch renders
    await win.click('[data-ann-dropdown-toggle]');
    await win.waitForSelector('[data-ann-dropdown-menu]', { timeout: 6000 });
    await win.click('[data-ann-dropdown-menu] [data-tool="highlight"]');
    await win.waitForTimeout(450);
    add('annotation color popover', await appearanceProbe(win, '.color-popover', async () => {
      await win.locator('.ann-color-swatch-main').click();
    }));
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);

    // tools palette (TfPanel)
    add('tools palette', await appearanceProbe(win, '[data-tools-palette]', async () => {
      await win.click('[data-tools-toggle]');
    }, 900));
    await win.waitForTimeout(400);

    // insert dialog (TfDialog) + backdrop
    add('insert pages dialog', await appearanceProbe(win, '.modal-dialog', async () => {
      await win.click('[data-tool-id="insertPages"]');
    }, 900));
    await win.keyboard.press('Escape');
    await win.waitForFunction(() => document.querySelector('.modal-dialog') === null, null, { timeout: 5000 }).catch(() => {});
    if (await win.locator('[data-tools-palette]').count()) {
      await win.click('[data-tools-toggle]');
      await win.waitForTimeout(350);
    }

    // edit toolbar (TfBar)
    add('edit toolbar', await appearanceProbe(win, '[data-edit-toolbar]', async () => {
      await win.click('button[aria-label="Edit content"]');
    }));
    await win.waitForTimeout(400);
    await win.click('button[aria-label="Edit content"]').catch(() => {});
    await win.waitForTimeout(400);

    // search bar (TfBar)
    add('search bar', await appearanceProbe(win, '.search-bar', async () => {
      await win.keyboard.press('Control+f');
    }));
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);

    // Phase 26 — the in-canvas annotation textbox toolbox is retired. The
    // surface-inventory row is retired to the Phase-26 contract: placing a
    // textbox mounts NO editor and the panel's Text field is the editor.
    await win.click('[data-ann-dropdown-toggle]');
    await win.waitForSelector('[data-ann-dropdown-menu]', { timeout: 6000 });
    await win.click('[data-ann-dropdown-menu] [data-tool="textbox"]');
    await win.waitForTimeout(500);
    const armed = await win.evaluate(() => document.querySelector('.annotation-layer')?.getAttribute('data-tool'));
    log('C4 textbox armed', { armed });
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const ax = Math.max(40, Math.min(pg.x + pg.width * 0.3, vp.w - 240));
    const ay = Math.max(40, Math.min(pg.y + pg.height * 0.3, vp.h - 110));
    await win.mouse.move(ax, ay);
    await win.mouse.down();
    await win.mouse.move(ax + 160, ay + 50, { steps: 5 });
    await win.mouse.up();
    await win.waitForSelector('[data-txt-text]', { timeout: 8000 });
    await win.waitForFunction(() => {
      const ta = document.querySelector('[data-txt-text]');
      return ta !== null && ta.disabled === false;
    }, null, { timeout: 8000 });
    const phase26 = await win.evaluate(() => ({
      inCanvasEditors: document.querySelectorAll('[data-annotation-editor], .edit-inline-editor').length,
      panelField: !!document.querySelector('[data-txt-text]'),
      panelEnabled: document.querySelector('[data-txt-text]')?.disabled === false,
    }));
    table.push({ family: 'annotation textbox (Phase 26: panel field, no editor)', ...phase26 });
    log('C4 annotation textbox (Phase 26)', phase26);
    expect(phase26.inCanvasEditors, 'Phase 26: placing a textbox mounts no in-canvas editor').toBe(0);
    expect(phase26.panelEnabled, 'Phase 26: the panel Text field is the textbox editor').toBe(true);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);

    // document tab (AnimatedTab — opacity-only materialize on the NEW tab)
    await mpStart(win, ['[data-animated-tab]'], 900);
    await win.click('button.tab-new');
    const tabRows = await mpRead(win);
    const tabFrames = tabRows.map((f) => f.states[0]).filter((s) => s && s.n > 0);
    const tabMid = tabRows.some((f) => (f.states[0]?.ops ?? []).some((o) => o < 0.999));
    const tabKeyframes = [...new Set(tabFrames.map((s) => s.an).filter((a) => a && a !== 'none'))];
    add('document tab', {
      sel: '[data-animated-tab]', frames: tabFrames.length,
      animated: tabMid, keyframes: tabKeyframes,
    });
    const tabCount = await win.locator('[data-animated-tab]').count();
    if (tabCount > 1) {
      await win.locator('[data-animated-tab]').last().locator('.tab-close').click().catch(() => {});
    }
    await win.waitForTimeout(400);

    // toast (TfToast) via the watermark apply action
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.click('[data-tool-id="watermark"]');
    await win.waitForSelector('[data-watermark-dialog]', { timeout: 8000 });
    await win.waitForTimeout(400);
    add('toast', await appearanceProbe(win, '.toast', async () => {
      await win.click('[data-watermark-confirm]');
    }, 1200));
    await win.screenshot({ path: path.join(SHOTS, 'phase20-verify-inventory.png') });

    fs.writeFileSync(
      path.join(SHOTS, 'phase20-verify-inventory.json'),
      JSON.stringify(table, null, 2),
    );
  } finally {
    await hardClose(app, 'p20-c4');
  }
});

// ---------------------------------------------------------------------------
// C4b — OCR suspects bar, with a real runtime trigger.
//
// The suspects surface only exists after a completed OCR run: the palette's
// `recognizeText` action merely opens the OCR dialog, and it is the dialog's
// confirm (`onOcrConfirm` -> setOcrRunByTab + setOcrSuspectsOpen) that both
// enables `[data-tool-id="ocrSuspects"]` and auto-mounts the panel. The old
// probe clicked `recognizeText` and never confirmed, so it always bailed at
// the disabled gate and passed without ever asserting the surface.
//
// Now: confirm the OCR dialog (current-page scope, cheap), wait for the panel
// the host auto-opens, prove a run happened, close it, then re-open it via the
// palette button and probe the entrance animation. Removing the TfBarTop
// animation makes `r.animated` false -> FAIL; a broken OCR trigger makes the
// panel wait time out -> FAIL. It can no longer pass silently.
// ---------------------------------------------------------------------------
test('C4b OCR suspects bar appearance probe', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.waitForTimeout(300);

    // Real trigger: recognizeText -> OCR dialog -> confirm.
    await win.click('[data-tool-id="recognizeText"]');
    await win.waitForSelector('[data-ocr-confirm]', { timeout: 8000 });
    await win.click('[data-ocr-scope="currentPage"]');
    await win.waitForTimeout(150);
    await win.click('[data-ocr-confirm]');
    // The host auto-opens the suspects panel once the run succeeds.
    await win.waitForSelector('[data-ocr-suspects-panel]', { timeout: 240000 });

    const yieldInfo = await win.evaluate(() => {
      const panel = document.querySelector('[data-ocr-suspects-panel]');
      return {
        suspects: panel?.querySelectorAll('[data-ocr-suspect-word]').length ?? 0,
        summary: panel?.querySelector('.ocr-suspects-summary')?.textContent?.trim() ?? null,
        emptyState: !!panel?.querySelector('[data-ocr-suspects-empty]'),
      };
    });
    log('C4b OCR yield on report.pdf', yieldInfo);
    // A completed run must not show the pre-run empty state.
    expect(yieldInfo.summary, 'OCR suspects panel reports a completed run')
      .not.toMatch(/Run OCR on this document/);

    // Close, then re-open through the palette button to probe the entrance.
    await win.click('.ocr-suspects-close');
    await win.waitForFunction(
      () => document.querySelector('[data-ocr-suspects-panel]') === null,
      null, { timeout: 5000 },
    );
    if (await win.locator('[data-tools-palette]').count() === 0) {
      await win.click('[data-tools-toggle]');
      await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    }
    await win.waitForTimeout(200);
    expect(
      await win.locator('[data-tool-id="ocrSuspects"]').isEnabled(),
      'ocrSuspects enabled after a successful OCR run',
    ).toBe(true);

    await installMultiProbe(win);
    const r = await appearanceProbe(win, '.ocr-suspects-panel', async () => {
      await win.click('[data-tool-id="ocrSuspects"]');
    }, 1200);
    log('C4b OCR suspects bar', r);
    expect(r.frames, 'OCR suspects bar mounts').toBeGreaterThan(0);
    expect(r.animated, 'OCR suspects bar appearance is animated').toBe(true);
    expect(r.keyframes, 'OCR suspects bar has no CSS keyframe on the root').toEqual([]);
    await win.screenshot({ path: path.join(SHOTS, 'phase20-verify-ocr-bar.png') });
  } finally {
    await hardClose(app, 'p20-c4b');
  }
});

// ---------------------------------------------------------------------------
// C6 — reduced motion: CDP prefers-reduced-motion: reduce collapses the
// morph / tabs / swap / palette resize to the reduced path with NO structural
// change (elements still mount/unmount, positions correct).
// ---------------------------------------------------------------------------
test('C6 reduced motion collapses morph/tabs/swap/resize, structure intact', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const cdp = await win.context().newCDPSession(win);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const rmState = await win.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    log('C6 media', { reduce: rmState });
    expect(rmState, 'reduced motion emulated').toBe(true);

    await openReport(app, win);
    await installMultiProbe(win);

    // morph: theme popover still mounts/unmounts, no travel
    await mpStart(win, ['.theme-toggle-popover'], 700);
    await win.click('[data-theme-toggle]');
    const morphRows = await mpRead(win);
    const mFrames = morphRows.map((f) => f.states[0]).filter((s) => s && s.n > 0);
    const mTravel = mFrames.filter((s) => s.tr && s.tr !== 'none').length;
    log('C6 morph reduced', {
      mounted: mFrames.length, travelFrames: mTravel,
      ops: [...new Set(mFrames.map((s) => s.ops[0]))].slice(0, 6),
    });
    expect(mFrames.length, 'reduced: popover still mounts (structure unchanged)').toBeGreaterThan(0);
    expect(mTravel, 'reduced: popover never travels (opacity-only)').toBe(0);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    // Sign tabs: switch still changes panes, size snaps (no tween)
    await win.click('button[data-icon="sign"]');
    await win.waitForSelector('.sig-manager', { timeout: 8000 });
    await win.waitForTimeout(500);
    await win.locator('.sig-tab', { hasText: 'Draw' }).first().click();
    await win.waitForTimeout(400);
    await mpStart(win, ['[data-tf-resize]', '.sig-tab-pane'], 700);
    await win.locator('.sig-tab', { hasText: 'Type' }).first().click();
    const tabRows = await mpRead(win);
    const heights = [...new Set(tabRows.map((f) => f.states[0]).filter((s) => s && s.n > 0).map((s) => Math.round(s.h)))];
    const panePresent = tabRows.some((f) => (f.states[1]?.n ?? 0) > 0);
    log('C6 tabs reduced', { distinctHeights: heights, panePresent });
    expect(panePresent, 'reduced: tab pane still mounts').toBe(true);
    expect(heights.length, 'reduced: size change is instant (no tween)').toBeLessThanOrEqual(2);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);

    // palette resize: structure changes, width snaps
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.waitForTimeout(400);
    await mpStart(win, ['[data-tools-palette]'], 700);
    await win.click('[data-tools-layout="grid"]');
    const palRows = await mpRead(win);
    const widths = [...new Set(palRows.map((f) => f.states[0]).filter((s) => s && s.n > 0).map((s) => Math.round(s.w)))];
    log('C6 palette reduced', { distinctWidths: widths });
    expect(widths, 'reduced: palette reaches the new width').toContain(380);
    expect(widths.length, 'reduced: palette width change is instant').toBeLessThanOrEqual(2);

    // Phase 26 — the inline editor is retired. Reduced motion: placing a box
    // targets the panel Text field with no in-canvas editor and no animation.
    await win.click('[data-tools-toggle]');
    await win.waitForTimeout(300);
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.click('[data-edit-tool="box"]');
    await win.mouse.move(pg.x + pg.width * 0.3, pg.y + pg.height * 0.3);
    await win.mouse.down();
    await win.mouse.move(pg.x + pg.width * 0.3 + 160, pg.y + pg.height * 0.3 + 50, { steps: 5 });
    await win.mouse.up();
    await win.waitForSelector('[data-txt-text]', { timeout: 8000 });
    await win.waitForFunction(() => {
      const ta = document.querySelector('[data-txt-text]');
      return ta !== null && ta.disabled === false;
    }, null, { timeout: 8000 });
    const reducedPlace = await win.evaluate(() => ({
      editor: document.querySelectorAll('.edit-inline-editor, [data-edit-editor]').length,
      panelField: !!document.querySelector('[data-txt-text]'),
      panelEnabled: document.querySelector('[data-txt-text]')?.disabled === false,
    }));
    log('C6 placement reduced (Phase 26)', reducedPlace);
    expect(reducedPlace.editor, 'reduced: no in-canvas editor mounts').toBe(0);
    expect(reducedPlace.panelEnabled, 'reduced: the panel Text field is the editor').toBe(true);
  } finally {
    await hardClose(app, 'p20-c6');
  }
});

// ---------------------------------------------------------------------------
// Ghost-node question: an exiting surface stays in the DOM briefly after
// opacity 0 with pointer-events:none (+ inert where added). Confirm it cannot
// receive clicks/keyboard and cannot break a strict locator in a real flow.
// ---------------------------------------------------------------------------
test('C-ghost exiting surface is non-interactive and locator-safe', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await installProbe(win);

    // Close the search bar and inspect the exiting node's interactivity.
    await win.keyboard.press('Control+f');
    await win.waitForSelector('.search-bar', { timeout: 6000 });
    await win.waitForTimeout(300);
    await startProbe(win, '.search-bar', 800);
    await win.keyboard.press('Escape');
    const rows = await readProbe(win);
    const exiting = rows.filter((r) => !r.gone && r.op < 0.99);
    const ghost = exiting.filter((r) => r.op <= 0.001);
    log('ghost search-bar', {
      totalFrames: rows.length,
      exitingFrames: exiting.length,
      ghostFrames: ghost.length,
      ghostWindowMs: ghost.length ? ghost[ghost.length - 1].t - ghost[0].t : 0,
      pointerEvents: [...new Set(exiting.map((r) => r.pe))],
      inert: [...new Set(exiting.map((r) => r.inert))],
      unmounted: rows.some((r) => r.gone),
    });
    expect(rows.some((r) => r.gone), 'search bar eventually unmounts').toBe(true);
    expect(exiting.length, 'search bar has an exit animation').toBeGreaterThan(0);
    expect([...new Set(exiting.map((r) => r.pe))], 'exit frames pin pointer-events:none').toEqual(['none']);

    // While the ghost is present, a click at its old location must NOT be
    // swallowed: the element must be hit-test-free.
    await win.keyboard.press('Control+f');
    await win.waitForSelector('.search-bar', { timeout: 6000 });
    await win.waitForTimeout(300);
    const barBox = await win.locator('.search-bar').boundingBox();
    await win.keyboard.press('Escape');
    await win.waitForTimeout(320); // inside the exit window, after opacity ~0
    const ghostHit = await win.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return { tag: el?.tagName, cls: el?.className, inSearch: !!el?.closest('.search-bar') };
    }, [barBox.x + barBox.width / 2, barBox.y + barBox.height / 2]);
    log('ghost hit-test', ghostHit);
    expect(ghostHit.inSearch, 'a click during the exit does not hit the ghost bar').toBe(false);

    // Strict locator in a realistic flow: exactly one search bar on reopen.
    await win.keyboard.press('Control+f');
    await win.waitForSelector('.search-bar', { timeout: 6000 });
    const count = await win.locator('.search-bar').count();
    log('ghost locator', { searchBars: count });
    expect(count, 'strict locator sees exactly one search bar after a ghost cycle').toBe(1);

    // Keyboard: after Escape the bar is exiting; keys typed during the ghost
    // window must not reach the app (the input value is unchanged), and once
    // the exit completes focus is not left inside the bar.
    await win.locator('.search-bar input').first().focus();
    await win.keyboard.type('QA');
    const valueBefore = await win.locator('.search-bar input').first().inputValue();
    await win.keyboard.press('Escape');
    const focusState = await win.evaluate(() => {
      const active = document.activeElement;
      return { tag: active?.tagName, inSearch: !!active?.closest('.search-bar') };
    });
    await win.keyboard.type('ZZ');
    const afterKeys = await win.evaluate(() => {
      const input = document.querySelector('.search-bar input');
      return input ? input.value : null;
    });
    await win.waitForTimeout(500);
    const settled = await win.evaluate(() => {
      const active = document.activeElement;
      return {
        searchBars: document.querySelectorAll('.search-bar').length,
        activeInSearch: !!active?.closest('.search-bar'),
      };
    });
    log('ghost keyboard', { valueBefore, focusState, afterKeys, settled });
    expect(afterKeys, 'keys typed during the ghost window do not reach the exiting input').toBe(valueBefore);
    expect(settled.searchBars, 'search bar is gone after the exit').toBe(0);
    expect(settled.activeInSearch, 'focus is not left inside the removed bar').toBe(false);

    // Phase 26 — the annotation toolbox is retired. The stamp-type editor is
    // the remaining inert-bearing in-canvas family: confirm its exit frames
    // are pointer-events:none AND inert, and hit-test-free.
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.click('[data-tool-id="stamp"]');
    await win.waitForSelector('[data-stamp-dialog]', { timeout: 8000 });
    await win.click('[data-stamp-confirm]');
    await win.waitForTimeout(500);
    if (await win.locator('[data-tools-palette]').count()) {
      await win.click('[data-tools-toggle]');
      await win.waitForTimeout(350);
    }
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(pg.x + pg.width * 0.5, pg.y + pg.height * 0.5);
    await win.waitForSelector('.stamp-annotation', { timeout: 10000 });
    await win.waitForTimeout(1000);
    await win.locator('.stamp-annotation').first().click();
    await win.waitForSelector('[data-content-action-bar="stamp"]', { timeout: 8000 });
    await win.click('[data-content-action="stamp-edit"]');
    await win.waitForSelector('[data-stamp-type-editor]', { timeout: 8000 });
    await win.waitForTimeout(300);
    const editorBox = await win.locator('[data-stamp-type-editor]').boundingBox();
    await startProbe(win, '[data-stamp-type-editor]', 800);
    await win.click('[data-stamp-type-cancel]');
    const edRows = await readProbe(win);
    const edExiting = edRows.filter((r) => !r.gone && r.op < 0.99);
    log('ghost stamp-type editor', {
      exitingFrames: edExiting.length,
      pointerEvents: [...new Set(edExiting.map((r) => r.pe))],
      inert: [...new Set(edExiting.map((r) => r.inert))],
      unmounted: edRows.some((r) => r.gone),
    });
    expect(edRows.some((r) => r.gone), 'stamp-type editor unmounts after exit').toBe(true);
    expect([...new Set(edExiting.map((r) => r.pe))], 'editor exit frames pin pointer-events:none').toEqual(['none']);
    expect([...new Set(edExiting.map((r) => r.inert))], 'editor exit frames are inert (keyboard-safe)').toEqual([true]);
    const edHit = await win.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return { tag: el?.tagName, inEditor: !!el?.closest('[data-stamp-type-editor]') };
    }, [editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2]);
    log('ghost stamp-type hit-test', edHit);
    expect(edHit.inEditor, 'a click during the editor exit does not hit the ghost').toBe(false);
  } finally {
    await hardClose(app, 'p20-ghost');
  }
});

