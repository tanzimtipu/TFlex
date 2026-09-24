// Phase 28 (annotation interaction + comment threads) and Phase 29 (flush
// canvas) QA validation. Measures the running Electron app through the
// canonical launcher only.
//
//   P28 C1 arrow leader ends at the head's base in all 3 themes + hit target
//   P28 C2 live move (no Confirm) + colour-after-move + Cancel revert + Confirm
//   P28 C3 action-bar colour box (single click) + dropdown ignored for selection
//   P28 C4 comment box / icon / reply + save -> reopen persistence
//   P28 C5 regression: Phase-26 panel field, Phase-25 floating panel, create/delete
//   P29 C1 flush padding/gutter 0 in all 3 themes (screenshots)
//   P29 C2 page jumps (thumb + ruler) land with correct readout + scroll
//   P29 C3 annotation coords on the flush page + text panel + tools palette
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, armAnnotationTool, openSamplePath } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[P28/29] ${label} ${JSON.stringify(obj)}`);
const shot = (win, name) => win.screenshot({ path: path.join(SHOTS, name) }).catch(() => {});

function pngSize(p) {
  const b = fs.readFileSync(p);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
// qa helper: crop+upscale a PNG for visual inspection of the arrow join.
function upscale(src, out, scale) {
  const s = pngSize(src);
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'lib', 'crop_png.ps1'),
    '-Src', src, '-X', '0', '-Y', '0', '-W', String(s.w), '-H', String(s.h),
    '-Scale', String(scale), '-Out', out], { encoding: 'utf8' });
  if (r.status !== 0) log('upscale-failed', { src, err: (r.stderr || '').slice(0, 200) });
  return out;
}

async function openSample(app, win, name) {
  const p = getSamplePath(name);
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(500);
}

async function setTheme(win, theme) {
  const cur = await win.evaluate(() => document.documentElement.dataset.theme);
  if (cur === theme) return;
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction((t) => document.documentElement.dataset.theme === t, theme, { timeout: 6000 });
  await win.waitForTimeout(500);
}

async function dragOnPage(win, fx, fy, dxPx, dyPx, page = 1) {
  const pg = await win.locator(`.pdf-page[data-page="${page}"]`).boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 240));
  const y = Math.max(40, Math.min(pg.y + pg.height * fy, vp.h - 110));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dxPx, y + dyPx, { steps: 6 });
  await win.mouse.up();
  return { x, y };
}

const annModels = (win) => win.evaluate(() => {
  const es = window.tflexDiagnostics().engineState || {};
  return (es.annotations || []).map((a) => ({
    id: a.id, kind: a.kind, page: a.page, color: a.color ?? null,
    rect: a.rect ?? null, text: a.text ?? null,
  }));
});
const commentThreads = (win) => win.evaluate(() =>
  (window.tflexDiagnostics().engineState || {}).comments || []);

async function waitForAnn(win, kind, pred, timeout = 12000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const a = (await annModels(win)).find((x) => x.kind === kind);
    last = a;
    if (a && (pred ? pred(a) : true)) return a;
    await win.waitForTimeout(150);
  }
  return last;
}

/** Wait for the scroller to stop moving (smooth jump settle). */
async function settleScroll(win) {
  let prev = null;
  for (let i = 0; i < 40; i += 1) {
    const top = await win.evaluate(() => {
      const sc = document.querySelector('.document-scroller');
      return sc ? sc.scrollTop : null;
    });
    if (top !== null && prev !== null && Math.abs(top - prev) < 0.5) return top;
    prev = top;
    await win.waitForTimeout(150);
  }
  return prev;
}

/** Thumbnail jump: scroll the virtualized thumb rail until page n mounts. */
async function thumbJump(win, n) {
  for (let i = 0; i < 40; i += 1) {
    const ok = await win.evaluate((want) => {
      const sc = document.querySelector('.thumb-scroller');
      if (!sc) return false;
      const btn = sc.querySelector(`button[data-page="${want}"]`);
      if (btn) { btn.scrollIntoView({ block: 'center' }); return true; }
      sc.scrollTop += 600;
      return false;
    }, n);
    await win.waitForTimeout(200);
    if (ok) break;
  }
  await win.click(`.thumb-scroller button[data-page="${n}"]`);
}

// ===========================================================================
// P28 C1 - arrow leader ends at the head's BASE in all three themes; the
// invisible hit line still spans the full tip; shaft + head both select.
// ===========================================================================
async function arrowGeom(win) {
  return win.evaluate(() => {
    const g = document.querySelector('.ann-arrow[data-annotation-id]');
    if (g === null) return null;
    const vis = g.querySelector('line:not(.ann-arrow-hit)');
    const hit = g.querySelector('.ann-arrow-hit');
    const poly = g.querySelector('polygon:not(.ann-arrow-head-hit)');
    const pts = poly ? poly.getAttribute('points').split(' ').map((s) => s.split(',').map(Number)) : null;
    const n = (el, a) => Number(el.getAttribute(a));
    return {
      from: { x: n(vis, 'x1'), y: n(vis, 'y1') },
      visEnd: { x: n(vis, 'x2'), y: n(vis, 'y2') },
      hitEnd: { x: n(hit, 'x2'), y: n(hit, 'y2') },
      tip: pts ? { x: pts[0][0], y: pts[0][1] } : null,
      headPts: pts,
    };
  });
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('P28 C1 arrow leader ends at head base (3 themes) + hit target', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(app, win, 'report.pdf');
    await armAnnotationTool(win, 'arrow');
    await dragOnPage(win, 0.25, 0.25, 230, 120);
    await win.waitForSelector('.ann-arrow[data-annotation-id]', { timeout: 10000 });
    await win.waitForTimeout(600);

    const rows = [];
    for (const theme of ['light', 'dark', 'frosted']) {
      await setTheme(win, theme);
      await win.waitForTimeout(300);
      const g = await arrowGeom(win);
      const shaftLen = dist(g.from, g.visEnd);
      const fullLen = dist(g.from, g.tip);
      const baseGap = dist(g.visEnd, g.tip);
      const hitGap = dist(g.hitEnd, g.tip);
      rows.push({ theme, shaftLen: +shaftLen.toFixed(3), fullLen: +fullLen.toFixed(3),
        baseGap: +baseGap.toFixed(3), hitGap: +hitGap.toFixed(3),
        expectedBaseGap: +(9 * Math.cos((28 * Math.PI) / 180)).toFixed(3) });
      // Zoom the arrow for visual inspection of the head/shaft join.
      const bb = await win.locator('.ann-arrow[data-annotation-id]').boundingBox();
      const raw = path.join(SHOTS, `phase28-arrow-${theme}.png`);
      await win.screenshot({ path: raw, clip: {
        x: Math.max(0, bb.x - 12), y: Math.max(0, bb.y - 12),
        width: Math.min(bb.width + 24, 900), height: Math.min(bb.height + 24, 700),
      } });
      upscale(raw, path.join(SHOTS, `phase28-arrow-${theme}-zoom.png`), 6);
    }
    log('C1-arrow-geom', rows);
    for (const r of rows) {
      expect(r.baseGap, `${r.theme}: visible shaft stops at the head base (gap > 0)`).toBeGreaterThan(0.5);
      expect(Math.abs(r.baseGap - r.expectedBaseGap), `${r.theme}: gap equals head axial length`).toBeLessThan(0.6);
      expect(r.shaftLen, `${r.theme}: shaft shorter than the full leader`).toBeLessThan(r.fullLen - 0.5);
      expect(r.hitGap, `${r.theme}: invisible hit line still reaches the tip`).toBeLessThan(0.01);
    }

    // Hit target: click the shaft midpoint, then the head, both must select.
    await setTheme(win, 'light');
    const g = await arrowGeom(win);
    const mid = { x: (g.from.x + g.visEnd.x) / 2, y: (g.from.y + g.visEnd.y) / 2 };
    const headPt = { x: (g.visEnd.x + g.tip.x) / 2, y: (g.visEnd.y + g.tip.y) / 2 };
    const toScreen = await win.evaluate(({ a, b, c }) => {
      const layer = document.querySelector('.annotation-layer');
      const svg = layer.querySelector('svg');
      const m = svg.getScreenCTM();
      const p = (q) => ({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f });
      return { shaft: p(a), head: p(b), tip: p(c) };
    }, { a: mid, b: headPt, c: g.tip });
    const pgBox = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    const selCheck = [];
    for (const [label, pt] of [['shaft', toScreen.shaft], ['head', toScreen.head]]) {
      // deselect first: Escape, then a blank page press (select mode clears).
      await win.keyboard.press('Escape');
      await win.mouse.click(pgBox.x + pgBox.width - 25, pgBox.y + pgBox.height - 25);
      await win.waitForTimeout(300);
      await win.mouse.click(pt.x, pt.y);
      await win.waitForTimeout(500);
      const bar = await win.locator('[data-content-action-bar="ann-arrow"]').count();
      selCheck.push({ label, bar });
      await win.keyboard.press('Escape');
      await win.waitForTimeout(300);
    }
    log('C1-hit', selCheck);
    for (const s of selCheck) expect(s.bar, `click on the arrow ${s.label} selects the arrow`).toBeGreaterThan(0);
  } finally {
    await hardClose(app, 'p28-c1');
  }
});

// ===========================================================================
// P28 C2 - live move (no Confirm), colour-after-move keeps the move, Cancel
// reverts both, Confirm is a plain dismiss.
// ===========================================================================
const cssScale = (win) => win.evaluate(() => {
  const page = document.querySelector('.pdf-page[data-page="1"]');
  const m = page.querySelector('.annotation-layer svg').getScreenCTM();
  return m.a; // css px per page pt
});

test('P28 C2 live move + colour-after-move + Cancel revert + Confirm dismiss', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(app, win, 'report.pdf');
    await armAnnotationTool(win, 'rect');
    await dragOnPage(win, 0.3, 0.3, 180, 80);
    await win.waitForSelector('.ann-shape[data-kind="rect"]', { timeout: 10000 });
    await win.waitForTimeout(600);
    const scale = await cssScale(win);

    const selectShape = async () => {
      const bb = await win.locator('.ann-shape[data-kind="rect"]').first().boundingBox();
      await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 8000 });
      await win.waitForTimeout(400);
      return bb;
    };
    const pickColor = async (color) => {
      await win.click('[data-ann-color-box]');
      await win.waitForSelector('[data-color-popover]', { timeout: 6000 });
      await win.click(`[data-palette-built-in="${color}"]`);
      await win.waitForTimeout(1200);
    };

    let bb = await selectShape();
    const original = await waitForAnn(win, 'rect', null);
    log('C2-original', { rect: original.rect, color: original.color, scale });

    // Drag the shape: pointerup must COMMIT immediately (no Confirm).
    const before = await annModels(win);
    await win.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.mouse.down();
    await win.mouse.move(bb.x + bb.width / 2 + 80, bb.y + bb.height / 2 + 50, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(1500);
    const moved = await waitForAnn(win, 'rect', null);
    const expDx = 80 / scale, expDy = 50 / scale;
    const gotDx = moved.rect.x - original.rect.x, gotDy = moved.rect.y - original.rect.y;
    log('C2-moved', { rect: moved.rect, gotDx: +gotDx.toFixed(2), gotDy: +gotDy.toFixed(2),
      expDx: +expDx.toFixed(2), expDy: +expDy.toFixed(2), barStill: await win.locator('[data-content-action-bar="ann-rect"]').count() });
    expect(Math.abs(gotDx - expDx), 'move applied live with no Confirm click (x)').toBeLessThan(3);
    expect(Math.abs(gotDy - expDy), 'move applied live with no Confirm click (y)').toBeLessThan(3);
    expect(await win.locator('[data-content-action-bar="ann-rect"]').count(), 'bar stays after the commit').toBeGreaterThan(0);

    // Colour right after the move: both the move and the colour must stick.
    const target = original.color === 'blue' ? 'green' : 'blue';
    await pickColor(target);
    const colored = await waitForAnn(win, 'rect', (a) => a.color === target, 8000);
    log('C2-colored', { rect: colored.rect, color: colored.color, target });
    expect(colored.color, 'colour picked from the action bar applies live').toBe(target);
    expect(Math.abs(colored.rect.x - moved.rect.x), 'colour-after-move retains the move (x)').toBeLessThan(1.5);
    expect(Math.abs(colored.rect.y - moved.rect.y), 'colour-after-move retains the move (y)').toBeLessThan(1.5);

    // Cancel: reverts BOTH the move and the colour.
    await win.click('[data-content-action="ann-rect-cancel"]');
    await win.waitForTimeout(1800);
    const reverted = await waitForAnn(win, 'rect', (a) => a.color === original.color, 8000);
    log('C2-cancel', { rect: reverted.rect, color: reverted.color, original: original.rect });
    expect(Math.abs(reverted.rect.x - original.rect.x), 'Cancel reverts the move (x)').toBeLessThan(1.5);
    expect(Math.abs(reverted.rect.y - original.rect.y), 'Cancel reverts the move (y)').toBeLessThan(1.5);
    expect(reverted.color, 'Cancel reverts the colour').toBe(original.color);

    // Second session: move + colour, then Confirm (plain dismiss) keeps both.
    bb = await selectShape();
    await win.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.mouse.down();
    await win.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2 + 40, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(1500);
    await pickColor(target);
    const kept = await waitForAnn(win, 'rect', (a) => a.color === target, 8000);
    await win.click('[data-content-action="ann-rect-confirm"]');
    await win.waitForTimeout(1500);
    const afterConfirm = await waitForAnn(win, 'rect', null);
    log('C2-confirm', { rect: afterConfirm.rect, color: afterConfirm.color,
      bar: await win.locator('[data-content-action-bar="ann-rect"]').count() });
    expect(afterConfirm.color, 'Confirm keeps the colour').toBe(target);
    expect(Math.abs(afterConfirm.rect.x - kept.rect.x), 'Confirm keeps the move (x)').toBeLessThan(1.5);
    expect(afterConfirm.rect.x, 'Confirm did not revert to the original').not.toBe(original.rect.x);
    expect(await win.locator('[data-content-action-bar="ann-rect"]').count(), 'Confirm dismisses the bar').toBe(0);
  } finally {
    await hardClose(app, 'p28-c2');
  }
});

// ===========================================================================
// P28 C3 - colour box replaces Edit (between Confirm and Delete), single
// click opens the picker, picking applies; the toolbar dropdown is ignored
// for a selected annotation but still sets the armed tool colour.
// ===========================================================================
test('P28 C3 action-bar colour box + dropdown ignored for selection', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(app, win, 'report.pdf');
    await armAnnotationTool(win, 'rect');
    await dragOnPage(win, 0.3, 0.3, 170, 90);
    await win.waitForSelector('.ann-shape[data-kind="rect"]', { timeout: 10000 });
    await win.waitForTimeout(500);
    const bb = await win.locator('.ann-shape[data-kind="rect"]').first().boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 8000 });
    await win.waitForTimeout(400);

    const bar = await win.evaluate(() => {
      const el = document.querySelector('[data-content-action-bar="ann-rect"]');
      const kids = [...el.querySelectorAll('button')].map((b) => ({
        action: b.getAttribute('data-content-action'),
        colorBox: b.hasAttribute('data-ann-color-box'),
        left: +b.getBoundingClientRect().left.toFixed(1),
      }));
      return { kids, editText: el.textContent.includes('Edit'),
        editBtn: el.querySelectorAll('[data-content-action$="-edit"]').length };
    });
    log('C3-bar', bar);
    expect(bar.editBtn, 'no Edit text button in the action bar').toBe(0);
    expect(bar.editText, 'no "Edit" label in the bar').toBe(false);
    expect(bar.kids.filter((k) => k.colorBox).length, 'exactly one colour box in the bar').toBe(1);
    const confirm = bar.kids.find((k) => (k.action || '').endsWith('-confirm'));
    const colorBox = bar.kids.find((k) => k.colorBox);
    const cancel = bar.kids.find((k) => (k.action || '').endsWith('-cancel'));
    const del = bar.kids.find((k) => (k.action || '').endsWith('-delete'));
    expect(confirm && colorBox && cancel && del, 'Confirm/colour/Cancel/Delete all present').toBeTruthy();
    expect(confirm.left < colorBox.left && colorBox.left < cancel.left && cancel.left < del.left,
      'order is Confirm | colour box | Cancel | Delete').toBe(true);

    // A SINGLE click opens the picker.
    await win.click('[data-ann-color-box]');
    await win.waitForSelector('[data-color-popover]', { timeout: 6000 });
    const openAfterOne = await win.locator('[data-color-popover]').count();
    log('C3-single-click', { openAfterOne });
    expect(openAfterOne, 'a single click opens the colour picker').toBeGreaterThan(0);
    const beforeColor = (await waitForAnn(win, 'rect', null)).color;
    // Operator requirement: picking a colour applies it AND disengages the
    // picker; the action bar itself stays mounted.
    await win.click('[data-palette-built-in="blue"]');
    await win.waitForTimeout(1300);
    const closedAfterPick = await win.locator('[data-color-popover]').count();
    const barAfterPick = await win.locator('[data-content-action-bar="ann-rect"]').count();
    log('C3-pick-dismiss', { closedAfterPick, barAfterPick });
    expect(closedAfterPick, 'picking a colour detaches the popover').toBe(0);
    expect(barAfterPick, 'the action bar stays mounted after the pick').toBeGreaterThan(0);
    const firstClickColor = (await waitForAnn(win, 'rect', null)).color;
    if (firstClickColor === beforeColor) {
      // Retry once: the picker closed on the first pick, so re-open it.
      await win.click('[data-ann-color-box]');
      await win.waitForSelector('[data-color-popover]', { timeout: 6000 });
      await win.click('[data-palette-built-in="blue"]');
      await win.waitForTimeout(1300);
    }
    const afterColor = await waitForAnn(win, 'rect', (a) => a.color === 'blue', 8000);
    log('C3-picked', { beforeColor, firstClickColor, after: afterColor.color });
    expect(afterColor.color, 'picking from the box changes the selected annotation colour').toBe('blue');

    // The annotation dropdown must NOT patch a SELECTED annotation, but it
    // must still set the ARMED tool colour. The rect tool is still armed
    // (placement is not one-shot) and the rect is still selected.
    const firstRect = (await annModels(win)).find((a) => a.kind === 'rect');
    expect(firstRect.color, 'precondition: the selected rect is blue').toBe('blue');
    await win.waitForSelector('[data-ann-color]', { timeout: 8000 });
    const swatchBefore = await win.getAttribute('[data-ann-color]', 'data-color-current');
    await win.click('[data-ann-color]');
    await win.waitForSelector('[data-color-popover]', { timeout: 6000 });
    await win.waitForTimeout(500);
    await win.click('[data-palette-built-in="purple"]');
    await win.waitForTimeout(1200);
    const swatchAfter = await win.getAttribute('[data-ann-color]', 'data-color-current');
    const stillSelected = await win.locator('[data-content-action-bar="ann-rect"]').count();
    const afterDropdown = (await annModels(win)).find((a) => a.id === firstRect.id);
    log('C3-dropdown', { swatchBefore, swatchAfter, stillSelected, selectedColor: afterDropdown.color });
    expect(swatchAfter, 'dropdown picking updates the armed tool swatch').not.toBe(swatchBefore);
    expect(afterDropdown.color, 'the SELECTED annotation was NOT patched by the dropdown').toBe('blue');

    // A newly placed shape carries the armed tool colour.
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    await armAnnotationTool(win, 'rect');
    await dragOnPage(win, 0.55, 0.6, 150, 70);
    await win.waitForTimeout(1200);
    const all = await annModels(win);
    const secondRect = all.filter((a) => a.kind === 'rect').find((a) => a.id !== firstRect.id);
    log('C3-armed-colour', { secondRectColor: secondRect && secondRect.color });
    expect(secondRect && secondRect.color, 'armed tool colour is used by the next shape').toBe('purple');
    const firstAfter = (await annModels(win)).find((a) => a.id === firstRect.id);
    expect(firstAfter.color, 'the earlier selected annotation stays blue').toBe('blue');
  } finally {
    await hardClose(app, 'p28-c3');
  }
});

// DEF-260 - the renderer palette offers pink / teal / gray, but the engine's
// named-colour set is yellow/green/blue/red/orange/purple/cyan/magenta/white,
// so picking one of those three silently keeps the previous colour. This test
// pins the defect: a single click on the pink swatch must apply.
test('P28 C3b DEF-260 pink/teal/gray picks are silently dropped', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(app, win, 'report.pdf');
    await armAnnotationTool(win, 'rect');
    await dragOnPage(win, 0.3, 0.3, 170, 90);
    await win.waitForSelector('.ann-shape[data-kind="rect"]', { timeout: 10000 });
    const bb = await win.locator('.ann-shape[data-kind="rect"]').first().boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 8000 });
    await win.waitForTimeout(500);
    const before = (await annModels(win)).find((a) => a.kind === 'rect').color;
    const colorOf = async () => (await annModels(win)).find((a) => a.kind === 'rect').color;

    const results = {};
    for (const c of ['pink', 'teal', 'gray', 'blue']) {
      // The picker disengages after each pick, so re-open it every time.
      await win.click('[data-ann-color-box]');
      await win.waitForSelector('[data-color-popover]', { timeout: 6000 });
      await win.waitForTimeout(300);
      await win.locator(`[data-palette-built-in="${c}"]`).click();
      await win.waitForTimeout(1300);
      results[c] = { engine: await colorOf(),
        box: await win.getAttribute('[data-ann-color-box]', 'data-color-current'),
        closed: await win.locator('[data-color-popover]').count(),
        bar: await win.locator('[data-content-action-bar="ann-rect"]').count() };
    }
    log('C3b-picks', { before, results });
    for (const c of ['pink', 'teal', 'gray', 'blue']) {
      expect(results[c].closed, `picking ${c} detaches the popover`).toBe(0);
      expect(results[c].bar, `the action bar stays mounted after picking ${c}`).toBeGreaterThan(0);
    }
    // Same divergence on the CREATE path: arm a renderer-only colour and place.
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    await armAnnotationTool(win, 'rect');
    await win.waitForSelector('[data-ann-color]', { timeout: 8000 });
    await win.click('[data-ann-color]');
    await win.waitForSelector('[data-color-popover]', { timeout: 6000 });
    await win.waitForTimeout(500);
    await win.click('[data-palette-built-in="pink"]');
    await win.waitForTimeout(800);
    const nBefore = (await annModels(win)).filter((a) => a.kind === 'rect').length;
    await dragOnPage(win, 0.55, 0.65, 120, 60);
    await win.waitForTimeout(1500);
    const nAfter = (await annModels(win)).filter((a) => a.kind === 'rect').length;
    log('C3b-create-pink', { nBefore, nAfter,
      tool: await win.evaluate(() => window.tflexDiagnostics().activeTool) });
    // Every offered colour must apply to the selected annotation.
    for (const c of ['pink', 'teal', 'gray']) {
      expect(results[c].engine, `picking ${c} applies to the selected annotation (DEF-260)`).toBe(c);
    }
    expect(results.blue.engine, 'blue applies (engine-shared name)').toBe('blue');
  } finally {
    await hardClose(app, 'p28-c3b');
  }
});

// ===========================================================================
// P28 C3c - colour picker dismissal contract (operator requirement): a pick
// detaches the popover while the action bar stays mounted; an outside click
// and Escape close it; an inside interaction (hue slider) does NOT.
// ===========================================================================
test('P28 C3c colour picker dismissal contract', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(app, win, 'report.pdf');
    await armAnnotationTool(win, 'rect');
    await dragOnPage(win, 0.3, 0.3, 170, 90);
    await win.waitForSelector('.ann-shape[data-kind="rect"]', { timeout: 10000 });
    const selectRect = async () => {
      const bb = await win.locator('.ann-shape[data-kind="rect"]').first().boundingBox();
      await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 8000 });
      await win.waitForTimeout(400);
    };
    await selectRect();

    const openPicker = async () => {
      await win.click('[data-ann-color-box]');
      await win.waitForSelector('[data-color-popover]', { timeout: 6000 });
      await win.waitForTimeout(300);
    };
    const popoverCount = () => win.locator('[data-color-popover]').count();
    const barCount = () => win.locator('[data-content-action-bar="ann-rect"]').count();

    // (a) An inside interaction (hue slider) does NOT close the picker.
    await openPicker();
    const hue = await win.locator('.color-hue-slider').boundingBox();
    await win.mouse.click(hue.x + hue.width * 0.7, hue.y + hue.height / 2);
    await win.waitForTimeout(500);
    const afterHue = await popoverCount();
    log('C3c-hue', { afterHue });
    expect(afterHue, 'an inside interaction (hue slider) keeps the picker open').toBeGreaterThan(0);

    // (b) Escape closes it.
    await win.keyboard.press('Escape');
    await win.waitForTimeout(600);
    const afterEsc = await popoverCount();
    log('C3c-escape', { afterEsc });
    expect(afterEsc, 'Escape detaches the picker').toBe(0);

    // (c) An outside click closes it. Escape disarmed the tool and cleared
    // the selection, so re-select the rect first.
    await selectRect();
    await openPicker();
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(pg.x + pg.width - 20, pg.y + pg.height - 20);
    await win.waitForTimeout(600);
    const afterOutside = await popoverCount();
    log('C3c-outside', { afterOutside });
    expect(afterOutside, 'an outside click detaches the picker').toBe(0);

    // (d) A built-in pick applies, detaches the popover, keeps the bar.
    await selectRect();
    await openPicker();
    await win.click('[data-palette-built-in="green"]');
    await win.waitForTimeout(1300);
    const afterBuiltIn = { popover: await popoverCount(), bar: await barCount(),
      color: (await waitForAnn(win, 'rect', null)).color };
    log('C3c-built-in', afterBuiltIn);
    expect(afterBuiltIn.popover, 'a built-in pick detaches the popover').toBe(0);
    expect(afterBuiltIn.bar, 'the action bar stays mounted after a built-in pick').toBeGreaterThan(0);
    expect(afterBuiltIn.color, 'the built-in pick applied').toBe('green');

    // (e) A custom hex pick applies, detaches the popover, keeps the bar.
    await openPicker();
    await win.locator('[data-palette-hex-input]').fill('#0000ff');
    await win.locator('[data-palette-hex-input]').press('Enter');
    await win.waitForTimeout(1300);
    const afterCustom = { popover: await popoverCount(), bar: await barCount(),
      color: (await waitForAnn(win, 'rect', null)).color };
    log('C3c-custom', afterCustom);
    expect(afterCustom.popover, 'a custom hex pick detaches the popover').toBe(0);
    expect(afterCustom.bar, 'the action bar stays mounted after a custom pick').toBeGreaterThan(0);
    expect(afterCustom.color, 'the custom hex pick applied').toBe('#0000ff');
  } finally {
    await hardClose(app, 'p28-c3c');
  }
});

// ===========================================================================
// P28 C4 - selecting an annotation shows the comment box; a comment + reply
// persist through save/reopen; the icon shows only with a thread.
// ===========================================================================
test('P28 C4 comment box, icon, reply, save/reopen persistence', async () => {
  test.setTimeout(360000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(app, win, 'report.pdf');
    await armAnnotationTool(win, 'rect');
    await dragOnPage(win, 0.3, 0.3, 170, 90);
    await win.waitForSelector('.ann-shape[data-kind="rect"]', { timeout: 10000 });
    // A second, comment-free annotation for the "no icon" leg. The rect tool
    // is still armed after the first placement, so do not re-arm (that would
    // toggle it back to select).
    await win.waitForTimeout(600);
    await dragOnPage(win, 0.62, 0.3, 140, 80);
    await win.waitForTimeout(800);
    const rects = (await annModels(win)).filter((a) => a.kind === 'rect');
    expect(rects.length, 'two rects placed').toBe(2);
    const [commented, plain] = rects;

    // Select the first: the comment box mounts with an empty state.
    let bb = await win.locator(`.ann-shape[data-annotation-id="${commented.id}"]`).boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForSelector(`[data-ann-comment-box="${commented.id}"]`, { timeout: 8000 });
    const empty = await win.locator('[data-comment-empty]').count();
    await shot(win, 'phase28-verify-comment-box.png');
    log('C4-box', { empty, icons: await win.locator('[data-ann-comment-icon]').count() });
    expect(empty, 'comment box shows the empty state').toBe(1);
    expect(await win.locator('[data-ann-comment-icon]').count(), 'no icon before any comment').toBe(0);

    // Add a comment -> the icon appears on the element.
    await win.fill('[data-comment-input]', 'First comment');
    await win.click('[data-comment-submit]');
    await win.waitForTimeout(1200);
    const entries1 = await win.locator('[data-comment-entry]').count();
    const iconCount = await win.locator(`[data-ann-comment-icon="${commented.id}"]`).count();
    await shot(win, 'phase28-verify-comment-icon.png');
    log('C4-comment', { entries1, iconCount, threads: await commentThreads(win) });
    expect(entries1, 'comment appended').toBe(1);
    expect(iconCount, 'icon appears on the commented element').toBe(1);
    expect(await win.locator(`[data-ann-comment-icon="${plain.id}"]`).count(),
      'the comment-free annotation shows NO icon').toBe(0);

    // Add a reply -> it appends.
    await win.fill('[data-comment-input]', 'A reply');
    await win.click('[data-comment-submit]');
    await win.waitForTimeout(1200);
    const roles = await win.evaluate(() =>
      [...document.querySelectorAll('[data-comment-entry]')].map((e) => e.getAttribute('data-comment-role')));
    log('C4-reply', { roles });
    expect(roles, 'reply appends after the original').toEqual(['original', 'reply']);

    // Save As -> close -> reopen: the thread AND the icon must survive.
    const savePath = path.join(os.tmpdir(), `p28-c4-${Date.now()}.pdf`);
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savePath);
    await win.click('[data-toolbar-save-as]');
    await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
    await win.click('[data-save-as-confirm]');
    await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 40000 });
    expect(fs.existsSync(savePath), 'saved PDF exists').toBe(true);
    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, app, savePath);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(2500);

    const reopenedRects = (await annModels(win)).filter((a) => a.kind === 'rect');
    const threads = await commentThreads(win);
    const iconAfter = await win.locator('[data-ann-comment-icon]').count();
    await shot(win, 'phase28-verify-comment-reopen.png');
    log('C4-reopen', { rects: reopenedRects.map((r) => r.id), threads, iconAfter });
    expect(reopenedRects.length, 'both annotations survived save/reopen').toBe(2);
    expect(threads.length, 'comment thread persisted in the saved PDF').toBe(1);
    expect(threads[0].entries.length, 'both entries persisted').toBe(2);
    expect(iconAfter, 'the comment icon is still shown after reopen').toBe(1);

    // Selecting the reopened annotation shows the thread.
    const rid = threads[0].annotationId;
    const rbb = await win.locator(`.ann-shape[data-annotation-id="${rid}"]`).boundingBox();
    await win.mouse.click(rbb.x + rbb.width / 2, rbb.y + rbb.height / 2);
    await win.waitForSelector(`[data-ann-comment-box="${rid}"]`, { timeout: 8000 });
    await win.waitForTimeout(400);
    const reopenedEntries = await win.locator('[data-comment-entry]').count();
    log('C4-reopen-select', { reopenedEntries });
    expect(reopenedEntries, 'reopened comment box shows the persisted thread').toBe(2);
  } finally {
    await hardClose(app, 'p28-c4');
  }
});

// ===========================================================================
// P28 C5 - regression: Phase-26 panel text field, Phase-25 floating panel,
// annotation create + delete.
// ===========================================================================
test('P28 C5 regression: panel text live, floating panel, create/delete', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(app, win, 'report.pdf');

    // Phase 26 - place a textbox, the panel field is the live editor.
    await armAnnotationTool(win, 'textbox');
    await dragOnPage(win, 0.3, 0.25, 170, 60);
    await win.waitForSelector('[data-txt-text]', { timeout: 10000 });
    await win.waitForFunction(() => {
      const ta = document.querySelector('[data-txt-text]');
      return ta !== null && ta.disabled === false;
    }, null, { timeout: 8000 });
    await win.locator('[data-txt-text]').fill('P28C5');
    await win.locator('[data-txt-text]').blur();
    await win.waitForTimeout(1200);
    const liveText = await win.evaluate(() => {
      const el = document.querySelector('.ann-textbox .ann-text-content');
      return el ? el.textContent : null;
    });
    const tbx = await waitForAnn(win, 'textbox', (a) => a.text === 'P28C5', 10000);
    log('C5-panel-text', { liveText, engine: tbx && tbx.text });
    expect(liveText, 'Phase-26 panel field still edits text live on the page').toBe('P28C5');
    expect(tbx && tbx.text, 'engine holds the edited text').toBe('P28C5');

    // Phase 25 - the panel floats and drags without reflowing the page.
    const slotBefore = await win.locator('.page-slot[data-page="1"]').boundingBox();
    const panelBefore = await win.locator('[data-text-panel-float]').boundingBox();
    const grip = await win.locator('[data-text-panel-grip]').boundingBox();
    await win.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await win.mouse.down();
    await win.mouse.move(grip.x + grip.width / 2 - 60, grip.y + grip.height / 2 + 40, { steps: 6 });
    await win.mouse.up();
    await win.waitForTimeout(700);
    const panelAfter = await win.locator('[data-text-panel-float]').boundingBox();
    const slotAfter = await win.locator('.page-slot[data-page="1"]').boundingBox();
    const panelPos = await win.evaluate(() => {
      const el = document.querySelector('[data-text-panel-float]');
      return getComputedStyle(el).position;
    });
    log('C5-panel-float', { panelPos, movedX: +(panelAfter.x - panelBefore.x).toFixed(1),
      movedY: +(panelAfter.y - panelBefore.y).toFixed(1),
      pageDx: +(slotAfter.x - slotBefore.x).toFixed(1), pageDy: +(slotAfter.y - slotBefore.y).toFixed(1) });
    expect(panelPos, 'panel is a floating (not in-flow) card').toMatch(/absolute|fixed/);
    expect(Math.abs(panelAfter.x - panelBefore.x) > 20 || Math.abs(panelAfter.y - panelBefore.y) > 15,
      'panel drag moves the card').toBe(true);
    expect(Math.abs(slotAfter.x - slotBefore.x), 'page does not reflow on panel drag (x)').toBeLessThan(1.5);
    expect(Math.abs(slotAfter.y - slotBefore.y), 'page does not reflow on panel drag (y)').toBeLessThan(1.5);

    // Create + delete an annotation.
    await win.keyboard.press('Escape');
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    // Clear the textbox selection (closes the floating panel) before arming.
    await win.mouse.click(pg.x + 25, pg.y + 25);
    await win.waitForTimeout(400);
    await armAnnotationTool(win, 'note');
    await win.waitForTimeout(300);
    log('C5-note-armed', await win.evaluate(() => window.tflexDiagnostics().activeTool));
    const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const nx = Math.min(pg.x + pg.width * 0.35, vp.w - 40);
    const ny = Math.min(pg.y + pg.height * 0.8, vp.h - 110);
    await win.mouse.click(nx, ny);
    await win.waitForTimeout(1200);
    const noteBefore = (await annModels(win)).filter((a) => a.kind === 'note');
    expect(noteBefore.length, 'note created').toBe(1);
    await win.keyboard.press('Escape');
    const nbb = await win.locator('.ann-note').first().boundingBox();
    await win.mouse.click(nbb.x + nbb.width / 2, nbb.y + nbb.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-note"]', { timeout: 8000 });
    await win.click('[data-content-action="ann-note-delete"]');
    await win.waitForTimeout(1200);
    const noteAfter = (await annModels(win)).filter((a) => a.kind === 'note');
    log('C5-create-delete', { before: noteBefore.length, after: noteAfter.length });
    expect(noteAfter.length, 'Delete removes the annotation').toBe(0);
  } finally {
    await hardClose(app, 'p28-c5');
  }
});

// ===========================================================================
// P29 C1 - flush canvas: 0 padding/gutter around .document-content and
// .document-scroller in all three themes; page slot flush with the top.
// ===========================================================================
test('P29 C1 flush padding 0 in all three themes', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(app, win, 'report.pdf');
    await win.evaluate(() => { const sc = document.querySelector('.document-scroller'); if (sc) sc.scrollTop = 0; });
    await win.waitForTimeout(600);
    const rows = [];
    for (const theme of ['light', 'dark', 'frosted']) {
      await setTheme(win, theme);
      await win.evaluate(() => { const sc = document.querySelector('.document-scroller'); if (sc) sc.scrollTop = 0; });
      await win.waitForTimeout(500);
      const m = await win.evaluate(() => {
        const sc = document.querySelector('.document-scroller');
        const ct = document.querySelector('.document-content');
        const slot = document.querySelector('.page-slot[data-page="1"]');
        const cs = (el) => {
          const s = getComputedStyle(el);
          return { pt: s.paddingTop, pb: s.paddingBottom, pl: s.paddingLeft, pr: s.paddingRight,
            mt: s.marginTop, mb: s.marginBottom, ml: s.marginLeft, mr: s.marginRight };
        };
        const scR = sc.getBoundingClientRect();
        const ctR = ct.getBoundingClientRect();
        const slR = slot.getBoundingClientRect();
        return { theme: document.documentElement.dataset.theme, scroller: cs(sc), content: cs(ct),
          slotTopGap: +(slR.top - scR.top).toFixed(2),
          contentTopGap: +(ctR.top - scR.top).toFixed(2),
          contentLeftGap: +(ctR.left - scR.left).toFixed(2) };
      });
      rows.push(m);
      await shot(win, `phase29-verify-${theme}.png`);
    }
    log('P29C1', rows);
    for (const r of rows) {
      for (const [k, v] of Object.entries(r.scroller)) {
        expect(v, `${r.theme}: .document-scroller ${k} is 0`).toMatch(/^0(px)?$/);
      }
      for (const [k, v] of Object.entries(r.content)) {
        expect(v, `${r.theme}: .document-content ${k} is 0`).toMatch(/^0(px)?$/);
      }
      expect(Math.abs(r.slotTopGap), `${r.theme}: page slot flush with the scroller top`).toBeLessThanOrEqual(1);
    }
  } finally {
    await hardClose(app, 'p29-c1');
  }
});

// ===========================================================================
// P29 C2 - page jumps (thumbnail + ruler nav) land with the correct readout
// and scroll position after the padding removal.
// ===========================================================================
test('P29 C2 page jumps land correctly (thumb + nav)', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(app, win, 'long.pdf');
    const pageCount = await win.evaluate(() => window.tflexDiagnostics().engineState.pageCount);
    log('P29C2-doc', { pageCount });
    expect(pageCount, 'long.pdf has enough pages').toBeGreaterThan(20);

    const land = async (label, expectPage) => {
      await settleScroll(win);
      await win.waitForTimeout(400);
      const d = await win.evaluate(() => {
        const sc = document.querySelector('.document-scroller');
        const cur = window.tflexDiagnostics().currentPage;
        const slot = document.querySelector(`.page-slot[data-page="${cur}"]`);
        return { cur, drift: slot ? +(slot.getBoundingClientRect().top - sc.getBoundingClientRect().top).toFixed(2) : null };
      });
      log('P29C2-land', { label, expectPage, ...d });
      return d;
    };

    // Thumbnail jump to page 5.
    await thumbJump(win, 5);
    let d = await land('thumb-5', 5);
    expect(d.cur, 'thumbnail jump readout = 5').toBe(5);
    expect(Math.abs(d.drift), 'thumbnail jump scroll drift (px)').toBeLessThanOrEqual(2);

    // Ruler nav jumps: 20 and the last page.
    await win.click('[data-rail-collapse]');
    await win.waitForSelector('[data-rail-ruler]', { timeout: 8000 });
    await win.waitForTimeout(400);
    await win.click('[data-ruler-page="20"]');
    d = await land('nav-20', 20);
    expect(d.cur, 'nav jump readout = 20').toBe(20);
    expect(Math.abs(d.drift), 'nav-20 scroll drift (px)').toBeLessThanOrEqual(2);

    await win.click(`[data-ruler-page="${pageCount}"]`);
    d = await land('nav-last', pageCount);
    expect(d.cur, `nav jump readout = ${pageCount}`).toBe(pageCount);
    expect(Math.abs(d.drift), 'last-page scroll drift (px)').toBeLessThanOrEqual(2);
  } finally {
    await hardClose(app, 'p29-c2');
  }
});

// ===========================================================================
// P29 C3 - annotation coordinates on the flush page + floating text panel +
// tools palette still work.
// ===========================================================================
test('P29 C3 flush-page annotation coords + panel + tools palette', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(app, win, 'report.pdf');
    const scale = await cssScale(win);
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();

    // Place a rect from a known client point; compare to page-point coords.
    const px = pg.x + 120, py = pg.y + 140, dw = 130, dh = 80;
    await armAnnotationTool(win, 'rect');
    await win.mouse.move(px, py);
    await win.mouse.down();
    await win.mouse.move(px + dw, py + dh, { steps: 6 });
    await win.mouse.up();
    await win.waitForSelector('.ann-shape[data-kind="rect"]', { timeout: 10000 });
    await win.waitForTimeout(900);
    const rect = (await annModels(win)).find((a) => a.kind === 'rect');
    const expX = (px - pg.x) / scale, expY = (py - pg.y) / scale;
    const expW = dw / scale, expH = dh / scale;
    const placeDelta = {
      dx: +(rect.rect.x - expX).toFixed(2), dy: +(rect.rect.y - expY).toFixed(2),
      dw: +(rect.rect.width - expW).toFixed(2), dh: +(rect.rect.height - expH).toFixed(2),
    };
    log('P29C3-place', { scale: +scale.toFixed(3), rect: rect.rect,
      exp: { x: +expX.toFixed(1), y: +expY.toFixed(1), w: +expW.toFixed(1), h: +expH.toFixed(1) }, placeDelta });
    expect(Math.abs(placeDelta.dx), 'placement x maps to page coords (pt)').toBeLessThan(3);
    expect(Math.abs(placeDelta.dy), 'placement y maps to page coords (pt)').toBeLessThan(3);
    expect(Math.abs(placeDelta.dw), 'placement width maps to page coords (pt)').toBeLessThan(3);
    expect(Math.abs(placeDelta.dh), 'placement height maps to page coords (pt)').toBeLessThan(3);

    // Move it: the engine rect delta must match the client delta / scale.
    const bb = await win.locator('.ann-shape[data-kind="rect"]').first().boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 8000 });
    await win.waitForTimeout(400);
    await win.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.mouse.down();
    await win.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2 + 40, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(1500);
    const moved = (await annModels(win)).find((a) => a.kind === 'rect');
    const moveDelta = { dx: +(moved.rect.x - rect.rect.x).toFixed(2), dy: +(moved.rect.y - rect.rect.y).toFixed(2) };
    log('P29C3-move', { moveDelta, expDx: +(60 / scale).toFixed(2), expDy: +(40 / scale).toFixed(2) });
    expect(Math.abs(moveDelta.dx - 60 / scale), 'move x maps to page coords (pt)').toBeLessThan(3);
    expect(Math.abs(moveDelta.dy - 40 / scale), 'move y maps to page coords (pt)').toBeLessThan(3);

    // Floating text panel still works on the flush page.
    await win.keyboard.press('Escape');
    await armAnnotationTool(win, 'textbox');
    await dragOnPage(win, 0.4, 0.7, 170, 60);
    await win.waitForSelector('[data-txt-text]', { timeout: 10000 });
    await win.waitForFunction(() => {
      const ta = document.querySelector('[data-txt-text]');
      return ta !== null && ta.disabled === false;
    }, null, { timeout: 8000 });
    await win.locator('[data-txt-text]').fill('FLUSH');
    await win.locator('[data-txt-text]').blur();
    await win.waitForTimeout(1200);
    const tbx = await waitForAnn(win, 'textbox', (a) => a.text === 'FLUSH', 10000);
    log('P29C3-textpanel', { text: tbx && tbx.text });
    expect(tbx && tbx.text, 'floating text panel edits live on the flush page').toBe('FLUSH');

    // Tools palette still opens.
    // Phase 36 migration: the All-tools palette is retired; the ContextPanel is
    // the tools panel and is always present with a document open.
    await win.waitForSelector('[data-context-panel]', { timeout: 8000 });
    const tools = await win.evaluate(() => ({
      contextPanel: document.querySelectorAll('[data-context-panel]').length,
    }));
    log('P29C3-tools', tools);
    expect(tools.contextPanel, 'tools ContextPanel mounted').toBe(1);
  } finally {
    await hardClose(app, 'p29-c3');
  }
});
