// DEF-256 retest — the Phase-25 floating text-properties card vs the
// right-anchored Tools palette. Measures the running Electron app
// (canonical launcher only) at 640/820/1440, the drag clamp, the
// palette-closed range, the Phase-25 no-reflow contract and the badge
// taper. Evidence: screenshots/def256-retest-640.png
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose, armAnnotationTool } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[DEF256] ${label} ${JSON.stringify(obj)}`);

const PANEL_CONTROLS = [
  '[data-txt-font]', '[data-txt-size]',
  '[data-txt-bold]', '[data-txt-italic]', '[data-txt-underline]',
  '[data-txt-super]', '[data-txt-sub]',
  '[data-txt-color]', '[data-txt-highlight]', '[data-txt-highlight-clear]',
  '[data-txt-clear]',
  '[data-txt-align-left]', '[data-txt-align-center]', '[data-txt-align-right]',
  '[data-txt-align-justify]',
  '[data-txt-line-height]',
  '[data-txt-list-none]', '[data-txt-list-bullet]', '[data-txt-list-number]',
  '[data-txt-indent-dec]', '[data-txt-indent-inc]',
  '[data-txt-character-spacing]', '[data-txt-horizontal-scaling]',
];

async function openReport(app, win) {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(500);
}

async function setSize(app, win, w, h) {
  await app.evaluate(async ({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.setSize(s[0], s[1]);
  }, [w, h]);
  await win.waitForTimeout(700);
}

async function ensurePalette(win) {
  if ((await win.locator('[data-tools-palette]').count()) === 0) {
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  }
  await win.waitForTimeout(400);
}

async function closePalette(win) {
  if ((await win.locator('[data-tools-palette]').count()) > 0) {
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { state: 'detached', timeout: 8000 }).catch(() => {});
  }
  await win.waitForTimeout(400);
}

async function measure(win) {
  return win.evaluate(() => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        left: +b.left.toFixed(1), top: +b.top.toFixed(1),
        right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1),
        width: +b.width.toFixed(1), height: +b.height.toFixed(1),
      };
    };
    const overlap = (a, b) => {
      if (!a || !b) return null;
      const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return +(w * h).toFixed(1);
    };
    const hit = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, missing: true };
      const b = el.getBoundingClientRect();
      const x = b.left + b.width / 2;
      const y = b.top + b.height / 2;
      const top = document.elementFromPoint(x, y);
      return {
        sel, x: +x.toFixed(1), y: +y.toFixed(1),
        hitTag: top ? top.tagName : null,
        hitCls: top ? String(top.className) : null,
        inside: !!(top && (top === el || el.contains(top))),
      };
    };
    const panel = document.querySelector('.text-props-panel');
    const palette = document.querySelector('[data-tools-palette]');
    const badge = document.querySelector('.tools-badge-tracker-open');
    const pr = r(panel);
    const ar = r(palette);
    const br = r(badge);
    const entry = document.querySelector('[data-tools-palette] button.tools-palette-entry:not([disabled])');
    const entrySel = entry ? `[data-tool-id="${entry.getAttribute('data-tool-id')}"]` : null;
    return {
      inner: { w: window.innerWidth, h: window.innerHeight },
      panel: pr, palette: ar, badge: br,
      overlapPanelPalette: overlap(pr, ar),
      overlapPanelBadge: overlap(pr, br),
      font: hit('[data-txt-font]'),
      color: hit('[data-txt-color]'),
      paletteEntry: entrySel ? hit(entrySel) : { missing: true },
    };
  });
}

async function probePanelControls(win) {
  return win.evaluate((sels) => {
    const panel = document.querySelector('.text-props-panel');
    if (!panel) return [{ missing: 'panel' }];
    const pb = panel.getBoundingClientRect();
    const out = [];
    for (const s of sels) {
      const el = panel.querySelector(s);
      if (!el) continue;
      const b = el.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) continue;
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      if (cx < pb.left || cx > pb.right || cy < pb.top || cy > pb.bottom) continue;
      const top = document.elementFromPoint(cx, cy);
      const inside = !!(top && (top === el || el.contains(top)));
      if (!inside) out.push({ sel: s, cx: +cx.toFixed(1), cy: +cy.toFixed(1), hitCls: top ? String(top.className) : null });
    }
    return out;
  }, PANEL_CONTROLS);
}

async function dragGrip(win, dx, dy) {
  const g = await win.locator('[data-text-panel-grip]').boundingBox();
  const x = g.x + g.width / 2;
  const y = g.y + g.height / 2;
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(300);
}

// rAF probe: page-1 canvas rect + document scroller scrollTop.
async function installPageProbe(win) {
  await win.evaluate(() => {
    window.__d256 = { rows: [], running: false };
    window.__d256Start = (ms) => {
      window.__d256 = { rows: [], running: true };
      const t0 = performance.now();
      const tick = () => {
        const pane = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
        const canvas = pane.querySelector('.pdf-page[data-page="1"] canvas');
        const sc = document.querySelector('.document-scroller');
        const cb = canvas ? canvas.getBoundingClientRect() : null;
        window.__d256.rows.push({
          t: Math.round(performance.now() - t0),
          cl: cb ? +cb.left.toFixed(2) : null,
          ct: cb ? +cb.top.toFixed(2) : null,
          cw: cb ? +cb.width.toFixed(2) : null,
          st: sc ? +sc.scrollTop.toFixed(2) : null,
        });
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__d256.running = false;
      };
      requestAnimationFrame(tick);
    };
  });
}

async function startPageProbe(win, ms) {
  await win.evaluate((m) => window.__d256Start(m), ms);
}

async function readPageProbe(win) {
  await win.waitForFunction(() => window.__d256.running === false, null, { timeout: 12000 }).catch(() => {});
  return win.evaluate(() => window.__d256.rows);
}

function span(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => v !== null);
  if (!vals.length) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return { min: +min.toFixed(2), max: +max.toFixed(2), span: +(max - min).toFixed(2) };
}

// ===========================================================================
// 1 — coexistence at 640/820/1440, drag clamp at 640, palette-closed range.
// ===========================================================================
test('DEF-256 coexistence + drag clamp + palette-closed range', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await armAnnotationTool(win, 'textbox');
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    await win.waitForTimeout(500);

    for (const [w, h] of [[640, 800], [820, 700], [1440, 900]]) {
      await setSize(app, win, w, h);
      await ensurePalette(win);
      const m = await measure(win);
      log('coexist', {
        w, h, inner: m.inner, panel: m.panel, palette: m.palette,
        overlap: m.overlapPanelPalette, font: m.font, color: m.color, entry: m.paletteEntry,
      });
      if (w === 640) {
        await win.screenshot({ path: path.join(SHOTS, 'def256-retest-640.png') }).catch(() => {});
      }
      expect(m.panel && m.panel.width > 0, `${w}: panel mounted`).toBe(true);
      expect(m.palette && m.palette.width > 0, `${w}: palette open`).toBe(true);
      expect(m.overlapPanelPalette, `${w}: panel/palette overlap`).toBe(0);
      expect(m.font.inside, `${w}: [data-txt-font] hittable`).toBe(true);
      expect(m.color.inside, `${w}: [data-txt-color] hittable`).toBe(true);
      expect(m.paletteEntry.inside, `${w}: palette entry hittable`).toBe(true);
    }

    // Drag toward the palette at 640.
    await setSize(app, win, 640, 800);
    await ensurePalette(win);
    const before = await measure(win);
    await dragGrip(win, 2000, 0);
    const after = await measure(win);
    const gap = +(after.palette.left - after.panel.right).toFixed(1);
    log('drag-640', {
      beforePanel: before.panel, afterPanel: after.panel, palette: after.palette, gap,
      font: after.font, color: after.color, entry: after.paletteEntry,
    });
    expect(gap, 'drag stops clear of the palette (gap >= 8)').toBeGreaterThanOrEqual(7.5);
    expect(after.panel.right, 'panel right edge does not cross the palette').toBeLessThanOrEqual(after.palette.left + 0.5);
    expect(after.font.inside && after.color.inside && after.paletteEntry.inside, 'controls still hittable after drag').toBe(true);

    // Palette closed: full page-view range, no jump.
    const preClose = await measure(win);
    await closePalette(win);
    const postClose = await measure(win);
    log('palette-closed', { prePanel: preClose.panel, postPanel: postClose.panel });
    expect(Math.abs(postClose.panel.left - preClose.panel.left), 'closing the palette does not move the panel').toBeLessThanOrEqual(0.5);
    await dragGrip(win, 2000, 0);
    const far = await measure(win);
    const main = await win.evaluate(() => {
      const b = document.querySelector('.workspace-main').getBoundingClientRect();
      return { left: +b.left.toFixed(1), right: +b.right.toFixed(1) };
    });
    log('palette-closed-far', { panel: far.panel, main });
    expect(far.panel.right, 'panel reaches the page-view right edge').toBeGreaterThanOrEqual(main.right - 20);
    expect(far.panel.right, 'panel stays inside the page view').toBeLessThanOrEqual(main.right + 2);
    const p1 = (await measure(win)).panel;
    await dragGrip(win, -60, 0);
    const p2 = (await measure(win)).panel;
    log('palette-closed-delta', { p1, p2, dx: +(p2.left - p1.left).toFixed(1) });
    expect(Math.abs((p2.left - p1.left) - (-60)), 'small drag moves by the mouse delta (no jump)').toBeLessThanOrEqual(2.5);
  } finally {
    await hardClose(app, 'def256-t1');
  }
});

// ===========================================================================
// 2 — Phase-25 no-reflow contract + badge taper over the panel.
// ===========================================================================
test('DEF-256 no-reflow + badge taper', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await armAnnotationTool(win, 'select');
    await win.waitForTimeout(300);
    await installPageProbe(win);
    await startPageProbe(win, 2600);
    await armAnnotationTool(win, 'textbox');
    await win.waitForTimeout(900);
    await armAnnotationTool(win, 'select');
    const rows = await readPageProbe(win);
    const spans = {
      canvasL: span(rows, 'cl'), canvasT: span(rows, 'ct'),
      canvasW: span(rows, 'cw'), scrollTop: span(rows, 'st'),
    };
    log('no-reflow', { frames: rows.length, ...spans });
    expect(rows.length, 'probe sampled frames').toBeGreaterThan(30);
    for (const [k, v] of Object.entries(spans)) {
      expect(v && v.span, `${k} span`).toBeLessThanOrEqual(0.5);
    }

    // Badge taper at 640 with both surfaces open.
    await setSize(app, win, 640, 800);
    await armAnnotationTool(win, 'textbox');
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    await ensurePalette(win);
    const geo = await win.evaluate(() => {
      const r = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return {
          left: +b.left.toFixed(1), top: +b.top.toFixed(1),
          right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1),
          width: +b.width.toFixed(1), height: +b.height.toFixed(1),
        };
      };
      return {
        badge: r(document.querySelector('.tools-badge-tracker-open')),
        panel: r(document.querySelector('.text-props-panel')),
      };
    });
    const covered = await probePanelControls(win);
    log('badge-taper', { ...geo, covered });
    expect(covered, 'no panel control hit point is covered by the badge').toEqual([]);
  } finally {
    await hardClose(app, 'def256-t2');
  }
});