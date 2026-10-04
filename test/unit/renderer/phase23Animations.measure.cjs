// Phase 23 measurement harness (frontend-dev evidence).
// Runs the built dev app twice: setting OFF (pre-seeded settings.json) and
// the default ON, samples each animated surface per rAF, prints frame counts
// and compares end geometry. Writes screenshots/phase23-animations-off-*.png.
// Not an e2e spec (qa owns e2e/): a standalone probe launched through the
// canonical e2e/lib/launch.cjs helper.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const { launchApp, getSamplePath } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose, armAnnotationTool } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const log = (label, obj) => process.stdout.write(`${label} ${JSON.stringify(obj)}\n`);

function parseMatrix(tr) {
  if (!tr || tr === 'none') return { a: 1, tx: 0, ty: 0 };
  const m = /matrix\(([^)]+)\)/.exec(tr);
  if (!m) return null;
  const p = m[1].split(',').map((s) => parseFloat(s.trim()));
  return { a: p[0], tx: p[4], ty: p[5] };
}

// A sampled row is an "intermediate" when the surface sits strictly between
// its resting identity (scale 1 / 0 travel / full opacity) and a hidden or
// offset pose. With motion removed, this count must be 0.
function analyse(rows, label) {
  if (!rows || rows.length === 0) return { label, frames: 0, intermediates: 0 };
  let intermediates = 0;
  const bad = [];
  for (const r of rows) {
    const m = parseMatrix(r.tr);
    const opMid = r.op > 0.02 && r.op < 0.98;
    const trMid = m !== null && (Math.abs(m.a - 1) > 0.01 || Math.abs(m.tx) > 0.5 || Math.abs(m.ty) > 0.5);
    if (opMid || trMid) {
      intermediates += 1;
      if (bad.length < 3) bad.push(`t=${r.t} op=${r.op} tr=${r.tr}`);
    }
  }
  const end = rows[rows.length - 1];
  // Rect-based surfaces (rail collapse / page reflow) animate layout, not
  // transform: count distinct rounded rects. Instant = 1-2 (pre-click +
  // settled); an animated path shows many intermediate rects.
  const rects = new Set(rows.map((r) => `${Math.round(r.left / 2) * 2},${Math.round(r.top / 2) * 2},${Math.round(r.w / 2) * 2},${Math.round(r.h / 2) * 2}`));
  return {
    label,
    frames: rows.length,
    intermediates,
    distinctRects: rects.size,
    sample: bad,
    end: { left: end.left, top: end.top, w: end.w, h: end.h, op: end.op },
  };
}

async function installSampler(win) {
  await win.evaluate(() => {
    window.__p23 = { rows: [], theme: [] };
    window.__p23Start = (sel, ms) => {
      const rows = [];
      window.__p23.rows = rows;
      const t0 = performance.now();
      const tick = () => {
        const el = document.querySelector(sel);
        if (el) {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          rows.push({
            t: Math.round(performance.now() - t0),
            tr: cs.transform,
            op: Number.parseFloat(cs.opacity),
            left: +r.left.toFixed(2),
            top: +r.top.toFixed(2),
            w: +r.width.toFixed(2),
            h: +r.height.toFixed(2),
          });
        }
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    window.__p23Theme = (ms) => {
      const rows = [];
      window.__p23.theme = rows;
      const t0 = performance.now();
      const tick = () => {
        rows.push({
          t: Math.round(performance.now() - t0),
          theme: document.documentElement.dataset.theme,
          cls: document.documentElement.classList.contains('tf-theme-transitioning'),
        });
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
  });
}

async function sample(win, sel, ms, action) {
  await win.evaluate(([s, d]) => window.__p23Start(s, d), [sel, ms]);
  await action();
  await win.waitForTimeout(ms + 60);
  return win.evaluate(() => window.__p23.rows || []);
}

async function openDoc(app, win) {
  const samplePath = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, samplePath);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1800);
}

// Drive every measured surface once; returns the per-surface sample report.
async function runSurfaces(app, win, tag, mode) {
  const report = {};
  const shot = (name) => win.screenshot({ path: path.join(SHOTS, `phase23-animations-${mode}-${name}.png`) });

  // (a) morphing menu open, then close.
  await win.keyboard.press('Escape').catch(() => undefined);
  await win.waitForTimeout(150);
  report.menuOpen = analyse(await sample(win, '.titlebar-menu-popover', 420, async () => {
    await win.click('.titlebar-menu-button');
  }), 'menuOpen');
  await shot('menu');
  report.menuClose = analyse(await sample(win, '.titlebar-menu-popover', 420, async () => {
    await win.keyboard.press('Escape');
  }), 'menuClose');
  await win.waitForTimeout(250);

  // (b) text-panel reflow: arming a text-bearing tool opens .text-props-panel.
  await armAnnotationTool(win, 'select');
  await win.waitForTimeout(250);
  report.panelOpen = analyse(await sample(win, '.text-props-panel', 520, async () => {
    await armAnnotationTool(win, 'textbox');
  }), 'panelOpen');
  await shot('panel');
  await armAnnotationTool(win, 'select');
  await win.waitForTimeout(250);

  // (e) theme switch: instrument View Transitions + sample the root class.
  await win.evaluate(() => {
    window.__p23VT = 0;
    if (typeof document.startViewTransition === 'function') {
      const orig = document.startViewTransition.bind(document);
      document.startViewTransition = (cb) => { window.__p23VT += 1; return orig(cb); };
    }
  });
  await win.evaluate((d) => window.__p23Theme(d), 420);
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click('[data-theme-option="light"]');
  await win.waitForTimeout(480);
  const themeRows = await win.evaluate(() => window.__p23.theme || []);
  const themeInfo = await win.evaluate(() => ({ vt: window.__p23VT || 0 }));
  report.theme = {
    frames: themeRows.length,
    crossfadeFrames: themeRows.filter((r) => r.cls).length,
    themes: [...new Set(themeRows.map((r) => r.theme))],
    viewTransitions: themeInfo.vt,
  };
  await shot('theme');

  // (f) rail collapse — the page view shifts, so sample the workspace inset.
  report.rail = analyse(await sample(win, '.workspace-main', 520, async () => {
    await win.click('[data-rail-collapse]');
  }), 'rail');
  await win.waitForTimeout(200);

  // (c) dialog open (insert pages) via the tools palette.
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(250);
  report.dialogOpen = analyse(await sample(win, '.modal-dialog', 520, async () => {
    await win.click('[data-tool-id="insertPages"]');
  }), 'dialogOpen');
  await shot('dialog');
  await win.click('[data-insert-pages-dialog] button[aria-label="Close dialog"]');
  await win.waitForSelector('[data-insert-pages-dialog]', { state: 'detached', timeout: 8000 });
  await win.waitForTimeout(300);

  // (d) toast: applying a watermark fires "Watermark applied.".
  report.toast = analyse(await sample(win, '.toast', 1800, async () => {
    if ((await win.locator('[data-tools-palette]').count()) === 0) {
      await win.click('[data-tools-toggle]');
      await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
      await win.waitForTimeout(200);
    }
    await win.click('[data-tool-id="watermark"]');
    await win.waitForSelector('[data-watermark-dialog]', { timeout: 8000 });
    await win.locator('[data-watermark-text]').fill('CONFIDENTIAL');
    await win.click('[data-watermark-confirm]');
  }), 'toast');
  await win.waitForTimeout(200);

  return report;
}

async function runMode(mode) {
  const ud = path.join(os.tmpdir(), `tflex-p23-${mode}-${Date.now()}`);
  fs.mkdirSync(ud, { recursive: true });
  if (mode === 'off') {
    fs.writeFileSync(
      path.join(ud, 'settings.json'),
      JSON.stringify({ theme: 'frosted', animationsEnabled: false }),
    );
  }
  const app = await launchApp([], ud);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await installSampler(win);
  const gate = await win.evaluate(() => document.documentElement.dataset.animations ?? '(absent)');
  await openDoc(app, win);
  const report = await runSurfaces(app, win, mode, mode);
  await hardClose(app);
  return { gate, report };
}

(async () => {
  const off = await runMode('off');
  log('[P23-OFF] root-hook', { dataAnimations: off.gate, report: off.report });
  const on = await runMode('on');
  log('[P23-ON] root-hook', { dataAnimations: on.gate, report: on.report });
  const geo = {};
  for (const key of ['menuOpen', 'panelOpen', 'dialogOpen', 'toast', 'rail']) {
    const a = off.report[key]?.end || null;
    const b = on.report[key]?.end || null;
    geo[key] = { equal: JSON.stringify(a) === JSON.stringify(b), off: a, on: b };
  }
  log('[P23-GEOMETRY]', geo);
})().catch((err) => {
  process.stdout.write(`[P23-FATAL] ${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
