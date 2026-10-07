// Phase 108 adversary diff-pass (TFL-910 / TFL-862 chunk D) - the Workspace Rail.
//
// Launches ONLY through the canonical e2e/lib/launch.cjs helper. Never touches
// e2e/**. Attacks the delivered surface the focused phase tests do not:
//   A. 72px track flows through .app-main and is flush with the stage column;
//   B. no sibling surface (stage, panel, dock, canvas, header) overlaps the rail;
//   C. every rail control reachable at the 640x480 window floor (incl. short height);
//   D. labels stay visible and inside the rail at compact + narrow widths;
//   E. silence attack: each control actually acts (stage switch / prefs open);
//   F. keyboard: Ctrl+1..4 switches and is guarded while a text input is focused;
//   G. prefers-reduced-motion collapses the active-marker animation;
//   H. forced-colors: the active item stays distinguishable from inactive.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');

const OUT = path.resolve(__dirname, '..', '..', 'screenshots', 'phase108-adversary');
fs.mkdirSync(OUT, { recursive: true });
test.setTimeout(600000);

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p108-adv');
  app = null;
  win = null;
});

async function openSample(name) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.stage-rail', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas.pdf-page-canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

async function resize(width, height) {
  await app.evaluate(async ({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    if (w.isFullScreen()) w.setFullScreen(false);
    w.setSize(size.width, size.height);
  }, { width, height });
  await win.waitForTimeout(1200);
  const actual = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  console.log(`[p108-adv] resize -> requested ${width}x${height}, got ${actual.w}x${actual.h}`);
  return actual;
}

// Full rail/sibling geometry snapshot, in CSS px, relative to the viewport.
async function geom() {
  return win.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
      };
    };
    const rail = q('.stage-rail');
    const btns = Array.from(document.querySelectorAll('[data-stage]'));
    const labels = Array.from(document.querySelectorAll('.stage-rail-label'));
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      rail: rect(rail),
      railGridCol: rail ? getComputedStyle(rail.parentElement).gridTemplateColumns : null,
      railFlexDir: rail ? getComputedStyle(rail).flexDirection : null,
      buttonsBox: rect(q('.stage-rail-buttons')),
      buttonsOverflowY: q('.stage-rail-buttons') ? getComputedStyle(q('.stage-rail-buttons')).overflowY : null,
      foot: rect(q('.stage-rail-foot')),
      gear: rect(q('[data-stage-rail-gear]')),
      stage: rect(q('.tab-stage')),
      panel: rect(q('.context-panel')),
      dock: rect(q('[data-action-dock]')),
      scroller: rect(q('.document-scroller')),
      appMain: rect(q('.app-main')),
      header: rect(q('.app-header')),
      active: q('[data-stage-rail]') ? q('[data-stage-rail]').getAttribute('data-active-stage') : null,
      compact: q('[data-stage-rail]') ? q('[data-stage-rail]').getAttribute('data-stage-rail-compact') : null,
      btnRects: btns.map((b) => ({ stage: b.getAttribute('data-stage'), aria: b.getAttribute('aria-pressed'), ...rect(b) })),
      labels: labels.map((l) => {
        const r = l.getBoundingClientRect();
        const cs = getComputedStyle(l);
        return {
          text: l.textContent,
          display: cs.display,
          fontSize: cs.fontSize,
          x: Math.round(r.x),
          right: Math.round(r.right),
          w: Math.round(r.width),
        };
      }),
    };
  });
}

function intersects(a, b, tol = 0) {
  if (!a || !b) return false;
  return a.x < b.right - tol && a.right > b.x + tol && a.y < b.bottom - tol && a.bottom > b.y + tol;
}

const WIDTHS = [1440, 1100, 1000, 900, 760, 640];

test('ADV-108-A the 72px rail track flows through .app-main and is flush with the stage column', async () => {
  await openSample('report.pdf');
  for (const width of WIDTHS) {
    const actual = await resize(width, 820);
    expect(Math.abs(actual.w - width), `window actually resized to ~${width} (got ${actual.w})`).toBeLessThanOrEqual(40);
    const g = await geom();
    console.log(`[p108-adv] A w=${width} rail=${JSON.stringify(g.rail)} stage.x=${g.stage && g.stage.x} panel.x=${g.panel && g.panel.x} grid=${g.railGridCol}`);
    expect(g.rail.w, `rail width at ${width}`).toBe(72);
    // The rail's border box occupies the full 72px track; the stage column
    // starts at its right edge (rail.right == stage.x), never before it.
    expect(g.stage.x, `stage starts at rail right edge at ${width}`).toBeGreaterThanOrEqual(g.rail.right - 1);
    expect(g.stage.x, `no gap/stage overlap at ${width}`).toBeLessThanOrEqual(g.rail.right + 1);
    expect(g.panel.x, `panel starts at/after rail right at ${width}`).toBeGreaterThanOrEqual(g.rail.right - 1);
  }
});

test('ADV-108-B no sibling surface overlaps the rail across widths', async () => {
  await openSample('report.pdf');
  for (const width of WIDTHS) {
    const actual = await resize(width, 820);
    expect(Math.abs(actual.w - width), `window actually resized to ~${width} (got ${actual.w})`).toBeLessThanOrEqual(40);
    const g = await geom();
    for (const [name, box] of [['stage', g.stage], ['panel', g.panel], ['dock', g.dock], ['scroller', g.scroller]]) {
      expect(intersects(g.rail, box, 1), `rail overlaps ${name} at ${width}: rail=${JSON.stringify(g.rail)} ${name}=${JSON.stringify(box)}`).toBe(false);
    }
    if (g.appMain) {
      expect(g.rail.y, `rail top inside app-main at ${width}`).toBeGreaterThanOrEqual(g.appMain.y - 1);
      expect(g.rail.bottom, `rail bottom inside app-main at ${width}`).toBeLessThanOrEqual(g.appMain.bottom + 1);
    }
    if (width < 1100) expect(g.compact, `compact attr at ${width}`).toBe('true');
    if (width >= 1100) expect(g.compact, `compact attr at ${width}`).toBe('false');
  }
  await resize(1000, 820);
  await win.screenshot({ path: path.join(OUT, 'adv-b-1000.png') });
  await resize(640, 480);
  await win.screenshot({ path: path.join(OUT, 'adv-b-640x480.png') });
});

test('ADV-108-C every rail control is reachable at the 640x480 window floor', async () => {
  await openSample('report.pdf');
  const actual = await resize(640, 480);
  const g = await geom();
  expect(actual.h, `window actually short (got ${actual.h})`).toBeLessThanOrEqual(520);
  console.log(`[p108-adv] C geom ${JSON.stringify({ actual, rail: g.rail, buttons: g.buttonsBox, foot: g.foot, gear: g.gear, btnRects: g.btnRects, vh: g.vh })}`);

  const hit = async (sel) => {
    return win.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return { found: false };
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      const owner = top ? top.closest(s) : null;
      return {
        found: true,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) },
        inViewport: r.x >= 0 && r.y >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
        hitSelf: owner === el,
        topTag: top ? `${top.tagName}.${top.className}` : null,
      };
    }, sel);
  };

  for (const stage of ['pages', 'edit', 'review', 'deliver']) {
    const h = await hit(`[data-stage="${stage}"]`);
    expect(h.found, `stage button ${stage} present`).toBe(true);
    expect(h.inViewport, `stage button ${stage} fully inside 640x480: ${JSON.stringify(h.rect)}`).toBe(true);
    expect(h.hitSelf, `stage button ${stage} is the top element at its centre (got ${h.topTag})`).toBe(true);
  }
  const gear = await hit('[data-stage-rail-gear]');
  expect(gear.found, 'gear present').toBe(true);
  expect(gear.inViewport, `gear fully inside 640x480: ${JSON.stringify(gear.rect)}`).toBe(true);
  expect(gear.hitSelf, `gear is the top element at its centre (got ${gear.topTag})`).toBe(true);
});

test('ADV-108-D labels stay visible and inside the rail at compact/narrow widths', async () => {
  await openSample('report.pdf');
  for (const width of [1100, 1000, 900, 760, 640]) {
    const actual = await resize(width, 820);
    expect(Math.abs(actual.w - width), `window actually resized to ~${width} (got ${actual.w})`).toBeLessThanOrEqual(40);
    const g = await geom();
    for (const l of g.labels) {
      expect(l.display, `label "${l.text}" visible at ${width}`).not.toBe('none');
      expect(l.w, `label "${l.text}" has width at ${width}`).toBeGreaterThan(0);
      expect(l.right, `label "${l.text}" right (${l.right}) inside rail right (${g.rail.right}) at ${width}`).toBeLessThanOrEqual(g.rail.right + 1);
      expect(l.x, `label "${l.text}" left (${l.x}) inside rail left (${g.rail.x}) at ${width}`).toBeGreaterThanOrEqual(g.rail.x - 1);
    }
    console.log(`[p108-adv] D w=${width} labels=${JSON.stringify(g.labels)}`);
  }
});

test('ADV-108-E silence attack: every rail control acts', async () => {
  await openSample('report.pdf');

  // Each stage button switches the active stage and paints its own aria-pressed.
  for (const stage of ['edit', 'review', 'deliver', 'pages']) {
    await win.locator(`[data-stage="${stage}"]`).first().click();
    await win.waitForTimeout(500);
    const g = await geom();
    expect(g.active, `clicking ${stage} sets data-active-stage`).toBe(stage);
    const pressed = await win.locator(`[data-stage="${stage}"]`).first().getAttribute('aria-pressed');
    expect(pressed, `${stage} aria-pressed`).toBe('true');
  }

  // The gear opens Preferences and does NOT change the workspace.
  const before = (await geom()).active;
  await win.locator('[data-stage-rail-gear]').first().click();
  await win.waitForTimeout(600);
  await win.waitForSelector('[data-prefs-dialog]', { state: 'visible', timeout: 8000 });
  const after = (await geom()).active;
  expect(after, 'opening Preferences keeps the active stage').toBe(before);
  await win.screenshot({ path: path.join(OUT, 'adv-e-prefs-from-gear.png') });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);
});

test('ADV-108-F keyboard: Ctrl+1..4 switches stage and is guarded in a text input', async () => {
  await openSample('report.pdf');
  const blank = async () => win.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
  await blank();
  await win.keyboard.press('Control+3');
  await win.waitForTimeout(400);
  expect((await geom()).active, 'Ctrl+3 activates review').toBe('review');
  await blank();
  await win.keyboard.press('Control+1');
  await win.waitForTimeout(400);
  expect((await geom()).active, 'Ctrl+1 activates pages').toBe('pages');

  // With a text input focused the chord must not switch (guard contract).
  const ok = await win.evaluate(() => {
    const input = document.querySelector('.page-input') || document.querySelector('input[type="text"]') || document.querySelector('input');
    if (!input) return false;
    input.focus();
    return document.activeElement === input;
  });
  if (ok) {
    await win.keyboard.press('Control+2');
    await win.waitForTimeout(400);
    expect((await geom()).active, 'Ctrl+2 while a text input is focused does not switch stage').toBe('pages');
  } else {
    console.log('[p108-adv] F no text input available to focus; guard not exercised live');
  }
});

test('ADV-108-G prefers-reduced-motion collapses the active-marker animation', async () => {
  await openSample('report.pdf');
  await win.locator('[data-stage="review"]').first().click();
  await win.waitForTimeout(300);
  const read = async () => win.evaluate(() => {
    const el = document.querySelector('.stage-rail-btn-active');
    if (!el) return null;
    const cs = getComputedStyle(el, '::before');
    return { dur: cs.animationDuration, name: cs.animationName, content: cs.content };
  });
  await win.emulateMedia({ reducedMotion: 'no-preference' });
  const normal = await read();
  await win.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await read();
  console.log(`[p108-adv] G normal=${JSON.stringify(normal)} reduced=${JSON.stringify(reduced)}`);
  expect(reduced, 'active marker present').not.toBeNull();
  const d = parseFloat(reduced.dur);
  expect(d, `reduced-motion animation duration (${reduced.dur}) collapses`).toBeLessThanOrEqual(0.01);
  await win.emulateMedia({ reducedMotion: null });
});

test('ADV-108-H forced-colors keeps the active item distinguishable', async () => {
  await openSample('report.pdf');
  await win.locator('[data-stage="review"]').first().click();
  await win.waitForTimeout(400);
  const sample = () => win.evaluate(() => {
    const active = document.querySelector('.stage-rail-btn-active');
    const inactive = Array.from(document.querySelectorAll('.stage-rail-btn')).find((b) => !b.classList.contains('stage-rail-btn-active'));
    const marker = active ? getComputedStyle(active, '::before') : null;
    return {
      activeBg: active ? getComputedStyle(active).backgroundColor : null,
      inactiveBg: inactive ? getComputedStyle(inactive).backgroundColor : null,
      activeBorder: active ? getComputedStyle(active).borderTopWidth : null,
      markerContent: marker ? marker.content : null,
      markerBg: marker ? marker.backgroundColor : null,
      markerW: marker ? marker.width : null,
      aria: active ? active.getAttribute('aria-pressed') : null,
    };
  });
  await win.emulateMedia({ forcedColors: 'none' });
  const normal = await sample();
  await win.emulateMedia({ forcedColors: 'active' });
  await win.waitForTimeout(300);
  const forced = await sample();
  await win.screenshot({ path: path.join(OUT, 'adv-h-forced-colors.png') });
  console.log(`[p108-adv] H normal=${JSON.stringify(normal)} forced=${JSON.stringify(forced)}`);

  // Programmatic state must survive.
  expect(forced.aria, 'aria-pressed survives forced-colors').toBe('true');
  // Visual distinction: either the fill differs from inactive, or a marker/border
  // is painted. In forced-colors the soft fill is expected to be forced away, so
  // the marker is the remaining shape cue.
  const fillDiffers = forced.activeBg !== forced.inactiveBg;
  const markerPainted = forced.markerContent !== 'none' && forced.markerContent !== 'normal' && parseFloat(forced.markerW) > 0;
  console.log(`[p108-adv] H fillDiffers=${fillDiffers} markerPainted=${markerPainted} activeBorder=${forced.activeBorder}`);
  expect(fillDiffers || markerPainted, 'active item has a non-colour shape cue in forced-colors').toBe(true);
  await win.emulateMedia({ forcedColors: null });
});

test('ADV-108-I the active item keeps its selected fill while hovered', async () => {
  await openSample('report.pdf');
  await win.locator('[data-stage="review"]').first().click();
  await win.waitForTimeout(500);
  await win.mouse.move(600, 500);
  await win.waitForTimeout(400);
  const restBg = await win.evaluate(() => {
    const el = document.querySelector('.stage-rail-btn-active');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  await win.locator('[data-stage="review"]').first().hover();
  await win.waitForTimeout(400);
  const hoverBg = await win.evaluate(() => {
    const el = document.querySelector('.stage-rail-btn-active');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  console.log(`[p108-adv] I activeBg rest=${restBg} hover=${hoverBg}`);
  expect(restBg, 'resting active fill is the rail selected surface (light F0EBFC)').toBe('rgb(240, 235, 252)');
  expect(hoverBg, 'active fill must stay selected while hovered (not fall to the neutral hover wash)').toBe(restBg);
});
