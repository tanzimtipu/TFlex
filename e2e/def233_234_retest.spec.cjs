// QA focused retest for DEF-233 (frosted tools-palette width jump) and
// DEF-234 (reduced-motion first-frame travel leaks: edit inline editor +
// tooltip member of the class).
//
// Drives the real Electron app through the canonical launchApp helper.
// Evidence (distinct value series, first-frame transforms) is printed as
// [DEF233 ...] / [DEF234 ...] lines and mirrored to screenshots/*.json.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const THEMES = ['light', 'dark', 'frosted'];
const log = (label, obj) => console.log(`[${label}] ${JSON.stringify(obj)}`);

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
    want, { timeout: 5000 },
  );
  await win.waitForTimeout(350);
}

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
            w: +r.width.toFixed(1), right: +r.right.toFixed(1),
            tr: cs.transform, an: cs.animationName, pe: cs.pointerEvents,
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

// ---------------------------------------------------------------------------
// DEF-233 â€” frosted tools-palette list<->grid width must interpolate in
// lockstep with the page inset and the Tools badge, matching light/dark.
// ---------------------------------------------------------------------------
test('DEF-233 palette resize lockstep, all three themes', async () => {
  test.setTimeout(240000);
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
        const cs = getComputedStyle(document.querySelector('[data-tools-palette]'));
        return { tp: cs.transitionProperty, td: cs.transitionDuration };
      });
      log('DEF233 pre', { label, ...pre });
      await mpStart(win, ['[data-tools-palette]', '.document-scroller', '.tools-badge-tracker'], 900);
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
        transitionProperty: pre.tp,
      };
      log('DEF233', { label, ...r });
      return r;
    };

    const results = [];
    for (const theme of THEMES) {
      await setTheme(win, theme);
      if (await win.locator('[data-tools-palette]').count() === 0) {
        await win.click('[data-tools-toggle]');
        await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
        await win.waitForTimeout(400);
      }
      await win.waitForTimeout(250);
      const toGrid = await sample(`${theme}-to-grid`);
      await win.waitForTimeout(450);
      const toList = await sample(`${theme}-to-list`);
      results.push({ theme, toGrid, toList });
    }
    await win.screenshot({ path: path.join(SHOTS, 'def233-234-retest-palette.png') });

    const summary = results.map(({ theme, toGrid, toList }) => ({
      theme,
      grid: toGrid.paletteWidths, gridScrollerCount: toGrid.scrollerRights.length,
      gridBadgeCount: toGrid.badgeRights.length, gridTransition: toGrid.transitionProperty,
      list: toList.paletteWidths, listScrollerCount: toList.scrollerRights.length,
      listBadgeCount: toList.badgeRights.length,
    }));
    log('DEF233 SUMMARY', summary);
    fs.writeFileSync(path.join(SHOTS, 'def233-palette-numbers.json'), JSON.stringify(summary, null, 2));

    for (const { theme, toGrid, toList } of results) {
      for (const [name, r] of [['grid', toGrid], ['list', toList]]) {
        expect(r.paletteWidths.length, `${theme} ${name}: palette width interpolates`).toBeGreaterThanOrEqual(3);
        expect(r.scrollerRights.length, `${theme} ${name}: page inset interpolates`).toBeGreaterThanOrEqual(3);
        expect(r.badgeRights.length, `${theme} ${name}: badge interpolates`).toBeGreaterThanOrEqual(3);
      }
    }
  } finally {
    await hardClose(app, 'def233');
  }
});

// ---------------------------------------------------------------------------
// DEF-234 — reduced motion: the edit inline editor's first painted frame must
// carry transform `none` (no 2px y travel), and it must still mount/unmount.
// ---------------------------------------------------------------------------
test('DEF-234 reduced-motion inline editor first-frame transform', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const cdp = await win.context().newCDPSession(win);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const rm = await win.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    log('DEF234 EDITOR media', { reduce: rm });
    expect(rm, 'reduced motion emulated').toBe(true);

    await openReport(app, win);
    await installMultiProbe(win);
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.click('[data-edit-tool="box"]');
    await mpStart(win, ['[data-edit-editor]'], 1200);
    await win.mouse.move(pg.x + pg.width * 0.3, pg.y + pg.height * 0.3);
    await win.mouse.down();
    await win.mouse.move(pg.x + pg.width * 0.3 + 160, pg.y + pg.height * 0.3 + 50, { steps: 5 });
    await win.mouse.up();
    const rows = await mpRead(win);
    const mounted = rows.map((f) => f.states[0]).filter((s) => s && s.n > 0);
    const transforms = mounted.map((s) => s.tr);
    const distinct = [...new Set(transforms)];
    log('DEF234 EDITOR', {
      mountedFrames: mounted.length,
      firstTransform: transforms[0],
      distinctTransforms: distinct,
      animationNames: [...new Set(mounted.map((s) => s.an))],
    });
    expect(mounted.length, 'reduced: inline editor still mounts').toBeGreaterThan(0);
    expect(transforms[0], 'reduced: first mounted frame transform is none').toBe('none');
    expect(distinct, 'reduced: no frame travels').toEqual(['none']);

    await win.click('button[aria-label="Cancel edit"]');
    await win.waitForFunction(() => document.querySelectorAll('[data-edit-editor]').length === 0, null, { timeout: 5000 });
    log('DEF234 EDITOR unmount', { remaining: await win.locator('[data-edit-editor]').count() });
    expect(await win.locator('[data-edit-editor]').count(), 'reduced: inline editor unmounts').toBe(0);
  } finally {
    await hardClose(app, 'def234-editor');
  }
});

// ---------------------------------------------------------------------------
// DEF-234 — tooltip member of the class: under reduced motion the first frame
// must be the constant centring translateX(-50%) only (no scale, no translateY
// travel) and the tooltip must still become VISIBLE. The no-preference entrance
// must be unchanged.
//
// The shipped CSS tooltip system (.tooltip-anchor [data-tooltip]::after) is not
// attached to any live control in the current bundle (0 refs in the JS bundle,
// 5 in CSS), so the real cascade is exercised through a probe anchor injected
// into the real renderer DOM - the built stylesheet, the real CDP media
// emulation and the real hover path all apply.
// ---------------------------------------------------------------------------
function parseMatrix(tr) {
  const m = /^matrix\(([^)]+)\)$/.exec(tr || '');
  if (!m) return null;
  const [a, b, c, d, e, f] = m[1].split(',').map((n) => Number(n.trim()));
  return { a, b, c, d, e, f };
}

test('DEF-234 reduced-motion tooltip first-frame transform + visibility', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const cdp = await win.context().newCDPSession(win);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    expect(await win.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

    await win.evaluate(() => {
      const d = document.createElement('div');
      d.className = 'tooltip-anchor';
      d.style.cssText = 'position:fixed;top:140px;left:240px;z-index:99999;';
      const b = document.createElement('button');
      b.id = '__tt';
      b.setAttribute('data-tooltip', 'Tooltip text');
      b.textContent = 'Hover me';
      d.appendChild(b);
      document.body.appendChild(d);
      window.__ttProbe = { rows: [], running: false };
      window.__ttStart = (ms) => {
        window.__ttProbe = { rows: [], running: true };
        const t0 = performance.now();
        const tick = () => {
          const el = document.getElementById('__tt');
          const cs = getComputedStyle(el, '::after');
          window.__ttProbe.rows.push({
            t: Math.round(performance.now() - t0),
            tr: cs.transform, op: +cs.opacity, vis: cs.visibility, an: cs.animationName,
          });
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else window.__ttProbe.running = false;
        };
        requestAnimationFrame(tick);
      };
    });

    const box = await win.locator('#__tt').boundingBox();

    // (a) reduced motion
    await win.evaluate(() => window.__ttStart(700));
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.waitForFunction(() => window.__ttProbe.running === false, null, { timeout: 6000 }).catch(() => {});
    const rows = await win.evaluate(() => window.__ttProbe.rows);
    const firstAnim = rows.find((r) => r.an === 'tooltip-enter-reduced') || rows[0];
    const settled = rows[rows.length - 1];
    log('DEF234 TOOLTIP reduce', { firstFrame: rows[0], firstAnimFrame: firstAnim, settled });
    expect(firstAnim.an, 'reduced: reduced keyframe applied').toBe('tooltip-enter-reduced');
    const m = parseMatrix(firstAnim.tr);
    expect(m, `reduced: first frame transform is a matrix (${firstAnim.tr})`).not.toBeNull();
    expect(m.a, 'reduced: no scaleX').toBe(1);
    expect(m.d, 'reduced: no scaleY').toBe(1);
    expect(m.b, 'reduced: no skew').toBe(0);
    expect(m.c, 'reduced: no skew').toBe(0);
    expect(m.f, 'reduced: no translateY travel').toBe(0);
    expect(m.e, 'reduced: centring translateX present').toBeLessThan(0);
    expect(settled.vis, 'reduced: tooltip visible after animation').toBe('visible');
    expect(settled.op, 'reduced: tooltip opacity settled').toBeGreaterThan(0.9);

    // (b) no-preference — normal entrance unchanged
    await win.mouse.move(5, 5);
    await win.waitForTimeout(700);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    expect(await win.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
    await win.evaluate(() => window.__ttStart(1400));
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.waitForFunction(() => window.__ttProbe.running === false, null, { timeout: 6000 }).catch(() => {});
    const nrows = await win.evaluate(() => window.__ttProbe.rows);
    const nFirstAnim = nrows.find((r) => r.an === 'tooltip-enter') || nrows[0];
    const nSettled = nrows[nrows.length - 1];
    log('DEF234 TOOLTIP nopref', { firstFrame: nrows[0], firstAnimFrame: nFirstAnim, settled: nSettled });
    expect(nFirstAnim.an, 'no-pref: designed keyframe applied').toBe('tooltip-enter');
    const nm = parseMatrix(nFirstAnim.tr);
    expect(nm, `no-pref: first frame transform is a matrix (${nFirstAnim.tr})`).not.toBeNull();
    expect(nm.d, 'no-pref: designed start scale 0.98 retained').toBeCloseTo(0.98, 2);
    expect(nm.f, 'no-pref: designed start translateY 3 retained').toBeCloseTo(3, 1);
    const ns = parseMatrix(nSettled.tr);
    expect(ns.f, 'no-pref: settled translateY 0').toBeCloseTo(0, 1);
    expect(nSettled.vis, 'no-pref: tooltip visible after animation').toBe('visible');
    expect(nSettled.op, 'no-pref: tooltip opacity settled').toBeGreaterThan(0.9);

    await win.evaluate(() => { const e = document.getElementById('__tt'); if (e) e.parentElement.remove(); });
  } finally {
    await hardClose(app, 'def234-tooltip');
  }
});
