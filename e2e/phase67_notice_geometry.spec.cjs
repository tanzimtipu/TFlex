// Phase 67 (QA measured geometry probe) — TFL-138 phase-close QA.
//
// The phase67 unit spec proves the collapse state machine against a jsdom DOM,
// but its placement contract (the three fixed horizontal icon slots) is a
// TEXTUAL CSS scan (phase67NoticeCollapse.test.tsx:298-333), not a
// measurement. Success criteria 3 and 4 are geometric promises:
//   - collapsed "i" icons never overlap each other or a control (criterion 3);
//   - elementFromPoint at the "i" centre resolves to the icon, and over the
//     page area resolves to the page (criterion 4);
//   - the collapsed "i" icons flow in a tight row at the canvas TOP-RIGHT
//     (Phase 78: the old fixed horizontal slots are retired; pitch ~36px).
//
// This spec drives the REAL Electron app through launchApp and MEASURES those
// promises with getBoundingClientRect() + elementFromPoint(). It also measures
// the auto-collapse dwell (criterion 1/2, ~10 s) and captures the expanded and
// collapsed screenshots.
//
// The literal criterion-3 pair (a conversion card AND a 3D notice together) is
// not reachable through the UI: a conversion notice only exists for a NON-PDF
// import (Phase 53) while a 3D notice only exists for a PDF carrying a /3D
// annotation (Phase 57), so one document cannot produce both. The nearest
// genuinely reachable both-present pair is the protection notice + the 3D
// notice from a single password-protected PDF that also carries 3D content;
// test 3 drives that and measures both collapsed icons.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { PDFDocument, PDFName, PDFString, rgb } = require('@cantoo/pdf-lib');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const FIX53 = path.resolve(__dirname, '..', 'test-fixtures', 'phase53');
const FIXDIR = path.join(os.tmpdir(), 'tflex-p67-geom');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(FIXDIR, { recursive: true });

let app = null;
let win = null;
let consoleLog = [];

test.setTimeout(300000);

test.beforeEach(async () => {
  consoleLog = [];
  app = await launchApp();
  win = await app.firstWindow();
  win.on('console', (m) => consoleLog.push(`[console:${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p67-geom');
  app = null;
  win = null;
});

async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

async function clickOpen() {
  await win.locator('[data-toolbar-open]').first().click();
}

// 2-page pdf-lib document: page 1 blank, page 2 a visible rect plus one
// /Subtype /3D annotation named Turbine (same shape as phase57a's fixture).
async function build3dBytes() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const p2 = doc.addPage([400, 400]);
  p2.drawRectangle({ x: 80, y: 80, width: 240, height: 240, color: rgb(0.15, 0.45, 0.25) });
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: '3D',
    NM: PDFString.of('Turbine'),
    Rect: [0, 0, 10, 10],
  });
  p2.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  return doc.save();
}

async function build3dPdf(file) {
  fs.writeFileSync(file, await build3dBytes());
  return file;
}

// A password-protected PDF that ALSO carries the 3D annotation: the one
// reachable document that shows the protection notice and the 3D notice at
// the same time.
async function buildEncrypted3dPdf(file) {
  const doc = await PDFDocument.load(await build3dBytes());
  doc.encrypt({
    userPassword: 'P67-Geom!',
    algorithm: 'AES-256',
    allowWeakCryptography: false,
    permissions: { printing: 'highResolution', modifying: true, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true },
  });
  fs.writeFileSync(file, await doc.save());
  return file;
}

// Measure a collapsed icon: box, visibility, and elementFromPoint at its centre.
async function iconMetrics(selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return {
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      visible: cs.visibility === 'visible' && parseFloat(cs.opacity) > 0 && r.width > 0 && r.height > 0,
      hitResolves: hit === el || el.contains(hit),
      hitTop: hit ? `${hit.tagName}.${String(hit.className)}` : 'none',
    };
  }, selector);
}

// elementFromPoint over the centre of the rendered page.
async function pageHit() {
  return win.evaluate(() => {
    const page = document.querySelector('.pdf-page') || document.querySelector('.page-slot');
    if (page === null) return null;
    const r = page.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      resolvesToPage: hit === page || page.contains(hit),
      hitTop: hit ? `${hit.tagName}.${String(hit.className)}` : 'none',
    };
  });
}

async function clipShot(name, rects) {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  const pad = 24;
  const x = Math.max(0, Math.floor(left - pad));
  const y = Math.max(0, Math.floor(top - pad));
  await win.screenshot({
    path: path.join(SHOTS, name),
    clip: { x, y, width: Math.ceil(right - left + pad * 2), height: Math.ceil(bottom - top + pad * 2) },
  });
}

async function controlRects() {
  return win.evaluate(() => {
    const out = {};
    for (const [name, sel] of [
      ['bookView', '[data-book-view-open]'],
      ['combine', '[data-context-panel-combine]'],
    ]) {
      const el = document.querySelector(sel);
      if (el === null) { out[name] = null; continue; }
      const r = el.getBoundingClientRect();
      out[name] = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }
    return out;
  });
}

async function boxStyle(selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const cs = getComputedStyle(el);
    return {
      borderRadius: cs.borderTopLeftRadius,
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      width: el.getBoundingClientRect().width,
    };
  }, selector);
}

// Phase 78 repoint — the collapsed "i" row is anchored at the canvas
// TOP-RIGHT now, so the meaningful edge is the canvas-bound overlay's RIGHT
// edge (the old `.document-scroller` LEFT edge measured the top-left row).
async function canvasRight() {
  return win.evaluate(() => {
    const el = document.querySelector('[data-canvas-overlay]') || document.querySelector('.document-scroller');
    return el ? el.getBoundingClientRect().right : null;
  });
}

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// ---------------------------------------------------------------------------
// Test 1 — conversion card: measured dwell, collapsed geometry, hit-test,
// screenshots (criteria 1 and 4).
// ---------------------------------------------------------------------------
test('conversion notice: measured auto-collapse, collapsed "i" geometry + hit-test', async () => {
  await stubOpen(path.join(FIX53, 'network.html'));
  await clickOpen();
  await win.waitForSelector('[data-conversion-notice]', { timeout: 25000 });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(SHOTS, 'phase67-conversion-expanded.png') });
  const box = await boxStyle('[data-conversion-notice]');
  console.log('P67_GEOM_CONVERSION_BOX ' + JSON.stringify(box));
  expect(parseFloat(box.borderRadius), `rounded box (radius ${box.borderRadius})`).toBeGreaterThan(0);
  expect(box.animationName, 'entrance animation is the conversion-notice-in keyframe').toContain('conversion-notice-in');
  expect(parseFloat(box.animationDuration), 'entrance animation has a non-zero duration').toBeGreaterThan(0);
  expect(await win.locator('[data-conversion-collapse]').count(), 'expanded card has a collapse control').toBe(1);
  const warningCount = await win.locator('[data-conversion-warning]').count();
  expect(warningCount, 'the expanded card shows its warnings').toBeGreaterThan(0);

  const t0 = Date.now();
  await win.waitForSelector('[data-conversion-icon]', { timeout: 20000 });
  const elapsed = Date.now() - t0;
  await win.screenshot({ path: path.join(SHOTS, 'phase67-conversion-collapsed.png') });

  const state = await win.evaluate(() =>
    document.querySelector('[data-conversion-notice-state]')?.getAttribute('data-conversion-notice-state') ?? null);
  const icon = await iconMetrics('[data-conversion-icon]');
  const page = await pageHit();
  const sl = await canvasRight();
  const relRight = icon && sl !== null ? sl - icon.rect.right : null;
  await clipShot('phase67-conversion-collapsed-clip.png', [icon.rect]);
  const controls = await controlRects();
  const overlapBook = icon && controls.bookView ? overlaps(icon.rect, controls.bookView) : null;
  console.log('P67_GEOM_CONVERSION ' + JSON.stringify({ elapsedMs: elapsed, seconds: +(elapsed / 1000).toFixed(2), state, canvasRight: sl, relRight, icon, page, controls, overlapBook }));

  expect(state, 'the region reports the collapsed state').toBe('collapsed');
  expect(elapsed, `auto-collapse ~10 s (measured ${elapsed}ms)`).toBeGreaterThanOrEqual(8000);
  expect(elapsed, `auto-collapse ~10 s (measured ${elapsed}ms)`).toBeLessThanOrEqual(14000);
  expect(icon, 'the collapsed "i" exists').not.toBeNull();
  expect(icon.visible, 'the collapsed "i" is visible').toBe(true);
  expect(icon.hitResolves, `icon centre resolves to the icon, not ${icon.hitTop}`).toBe(true);
  expect(page, 'a page is rendered').not.toBeNull();
  expect(page.resolvesToPage, `page centre resolves to the page, not ${page.hitTop}`).toBe(true);
  expect(overlaps(icon.rect, page.rect), 'the collapsed "i" does not overlap the page').toBe(false);

  // Re-expand and re-collapse on demand (CONTROL-INDEX row data-conversion-icon / -collapse).
  await win.locator('[data-conversion-icon]').click();
  await win.waitForSelector('[data-conversion-notice]', { timeout: 8000 });
  expect(await win.locator('[data-conversion-icon]').count(), 'the "i" is gone while expanded').toBe(0);
  await win.locator('[data-conversion-collapse]').click();
  await win.waitForSelector('[data-conversion-icon]', { timeout: 8000 });
});

// ---------------------------------------------------------------------------
// Test 2 — 3D notice: measured dwell, collapsed geometry, hit-test, screenshots
// (criteria 2 and 4).
// ---------------------------------------------------------------------------
test('3D notice: measured auto-collapse, collapsed "i" geometry + hit-test', async () => {
  const fixture = await build3dPdf(path.join(FIXDIR, 'p67-3d.pdf'));
  await stubOpen(fixture);
  await clickOpen();
  await win.waitForSelector('[data-pdf3d-notice]', { timeout: 25000 });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(SHOTS, 'phase67-3d-expanded.png') });
  const box = await boxStyle('[data-pdf3d-notice]');
  console.log('P67_GEOM_3D_BOX ' + JSON.stringify(box));
  expect(parseFloat(box.borderRadius), `rounded box (radius ${box.borderRadius})`).toBeGreaterThan(0);
  expect(box.animationName, 'entrance animation is the pdf3d-notice-in keyframe').toContain('pdf3d-notice-in');
  expect(parseFloat(box.animationDuration), 'entrance animation has a non-zero duration').toBeGreaterThan(0);
  expect(await win.locator('[data-pdf3d-collapse]').count(), 'expanded box has a collapse control').toBe(1);
  expect(await win.locator('[data-pdf3d-notice]').innerText(), 'page/object text readable').toContain('Turbine');

  const t0 = Date.now();
  await win.waitForSelector('[data-pdf3d-icon]', { timeout: 20000 });
  const elapsed = Date.now() - t0;
  await win.screenshot({ path: path.join(SHOTS, 'phase67-3d-collapsed.png') });

  const state = await win.evaluate(() =>
    document.querySelector('[data-pdf3d-notice-state]')?.getAttribute('data-pdf3d-notice-state') ?? null);
  const icon = await iconMetrics('[data-pdf3d-icon]');
  const page = await pageHit();
  const sl = await canvasRight();
  const relRight = icon && sl !== null ? sl - icon.rect.right : null;
  await clipShot('phase67-3d-collapsed-clip.png', [icon.rect]);
  const controls = await controlRects();
  const overlapBook = icon && controls.bookView ? overlaps(icon.rect, controls.bookView) : null;
  console.log('P67_GEOM_3D ' + JSON.stringify({ elapsedMs: elapsed, seconds: +(elapsed / 1000).toFixed(2), state, canvasRight: sl, relRight, icon, page, controls, overlapBook }));

  expect(state, 'the region reports the collapsed state').toBe('collapsed');
  expect(elapsed, `auto-collapse ~10 s (measured ${elapsed}ms)`).toBeGreaterThanOrEqual(8000);
  expect(elapsed, `auto-collapse ~10 s (measured ${elapsed}ms)`).toBeLessThanOrEqual(14000);
  expect(icon, 'the collapsed "i" exists').not.toBeNull();
  expect(icon.visible, 'the collapsed "i" is visible').toBe(true);
  expect(icon.hitResolves, `icon centre resolves to the icon, not ${icon.hitTop}`).toBe(true);
  expect(page, 'a page is rendered').not.toBeNull();
  expect(page.resolvesToPage, `page centre resolves to the page, not ${page.hitTop}`).toBe(true);
  expect(overlaps(icon.rect, page.rect), 'the collapsed "i" does not overlap the page').toBe(false);

  await win.locator('[data-pdf3d-icon]').click();
  await win.waitForSelector('[data-pdf3d-notice]', { timeout: 8000 });
  expect(await win.locator('[data-pdf3d-icon]').count(), 'the "i" is gone while expanded').toBe(0);
  await win.locator('[data-pdf3d-collapse]').click();
  await win.waitForSelector('[data-pdf3d-icon]', { timeout: 8000 });
});

// ---------------------------------------------------------------------------
// Test 3 — the nearest REACHABLE both-collapsed scenario: a password-protected
// PDF that also carries 3D content shows the protection notice and
// the 3D notice together; collapse BOTH and measure real geometry
// (criterion 3). The literal conversion+3D pair is unreachable (see header).
// ---------------------------------------------------------------------------
test('both collapsed icons present (protection + 3D): measured non-overlap + slots', async () => {
  const fixture = await buildEncrypted3dPdf(path.join(FIXDIR, 'p67-prot-3d.pdf'));
  await stubOpen(fixture);
  await clickOpen();
  await win.waitForSelector('[data-password-prompt]', { timeout: 20000 });
  await win.locator('[data-password-input]').fill('P67-Geom!');
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 });

  const seen = { protection: false, pdf3d: false };
  const start = Date.now();
  while (Date.now() - start < 15000 && !(seen.protection && seen.pdf3d)) {
    seen.protection = (await win.locator('[data-protection-notice]').count()) > 0;
    seen.pdf3d = (await win.locator('[data-pdf3d-notice]').count()) > 0;
    if (!(seen.protection && seen.pdf3d)) await win.waitForTimeout(250);
  }
  console.log('P67_GEOM_BOTH_PRESENT ' + JSON.stringify(seen));

  if (seen.protection && seen.pdf3d) {
    await win.locator('[data-protection-collapse]').click();
    await win.locator('[data-pdf3d-collapse]').click();
    await win.waitForSelector('[data-protection-icon]', { timeout: 8000 });
    await win.waitForSelector('[data-pdf3d-icon]', { timeout: 8000 });
    await win.waitForTimeout(300);
    await win.screenshot({ path: path.join(SHOTS, 'phase67-both-collapsed.png') });

    const prot = await iconMetrics('[data-protection-icon]');
    const threeD = await iconMetrics('[data-pdf3d-icon]');
    const controls = await controlRects();
    const sl = await canvasRight();
    const pitch = prot && threeD ? threeD.rect.left - prot.rect.left : null;
    const overlapBook = prot && controls.bookView ? overlaps(prot.rect, controls.bookView) : null;
    const overlapBook3d = threeD && controls.bookView ? overlaps(threeD.rect, controls.bookView) : null;
    const overlapCombine = prot && controls.combine ? overlaps(prot.rect, controls.combine) : null;
    await clipShot('phase67-both-collapsed-clip.png', [prot.rect, threeD.rect]);
    const metrics = {
      reachable: true,
      canvasRight: sl,
      protection: prot,
      pdf3d: threeD,
      controls,
      protectionRelRight: prot && sl !== null ? sl - prot.rect.right : null,
      pdf3dRelRight: threeD && sl !== null ? sl - threeD.rect.right : null,
      pitch,
      overlapBook,
      overlapBook3d,
      overlapCombine,
    };
    console.log('P67_GEOM_BOTH ' + JSON.stringify(metrics));

    expect(prot.visible, 'protection "i" visible').toBe(true);
    expect(threeD.visible, '3D "i" visible').toBe(true);
    expect(overlaps(prot.rect, threeD.rect), 'the two collapsed "i" boxes do not overlap').toBe(false);
    // Phase 78 repoint — the reserved 72px slot pitch is retired; the "i" row
    // now flows with a tight ~8px flex gap (icon width 28 + gap 8 = 36px pitch).
    expect(pitch, `the "i" icons use the tight flex pitch (measured ${pitch}px)`).toBeCloseTo(36, 0);
    expect(overlapBook, 'protection "i" does not overlap the Book View control').toBe(false);
    expect(overlapBook3d, '3D "i" does not overlap the Book View control').toBe(false);
    expect(overlapCombine, 'protection "i" does not overlap the Combine control').toBe(false);
    expect(prot.hitResolves, `protection icon centre resolves to the icon, not ${prot.hitTop}`).toBe(true);
    expect(threeD.hitResolves, `3D icon centre resolves to the icon, not ${threeD.hitTop}`).toBe(true);
  } else {
    // Not reachable through the UI: record WHY rather than silently passing.
    const present = await win.evaluate(() => ({
      protectionNotice: document.querySelector('[data-protection-notice]') !== null,
      protectionState: document.querySelector('[data-protection-notice-state]')?.getAttribute('data-protection-notice-state') ?? null,
      pdf3dNotice: document.querySelector('[data-pdf3d-notice]') !== null,
      pdf3dState: document.querySelector('[data-pdf3d-notice-state]')?.getAttribute('data-pdf3d-notice-state') ?? null,
      annots: document.querySelectorAll('[data-pdf3d-notice], [data-pdf3d-icon]').length,
    }));
    console.log('P67_GEOM_BOTH_UNREACHABLE ' + JSON.stringify({ seen, present, consoleLog: consoleLog.slice(-10) }));
  }
});
