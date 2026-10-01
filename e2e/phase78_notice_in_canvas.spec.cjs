// Phase 78 (features A/B/C) — focused QA geometry pass, TFL-258.
//
// The change under test (frontend-dev TFL-252, working tree): the
// open-triggered notice family (ProtectionNotice / ConversionNotice /
// Pdf3dNotice) is RE-PARENTED out of the `.document-column` flow and into
// DocumentView's `.canvas-overlay` (`.canvas-top-right` cluster at the canvas
// top-right, immediately LEFT of Book View, which is immediately LEFT of the
// page-layout control). The expanded box is a rounded translucent surface
// inside the canvas; the enter keeps the Phase 59/67 keyframe NAMES redefined
// to `scale(--motion-scale-enter) -> scale(1)` with `transform-origin: top
// right`.
//
// This spec launches the real Electron app ONCE at the geometry window
// 2048x1392 and MEASURES the phase-78 success criteria with
// getBoundingClientRect() + elementFromPoint(), plus a rAF enter-timeline that
// records whether the collapsed "i" glyph is ever rendered at the start of the
// entry (criterion 3's crux). It launches only through the canonical
// launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { PDFDocument, PDFName, PDFString, rgb } = require('@cantoo/pdf-lib');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const FIX53 = path.resolve(__dirname, '..', 'test-fixtures', 'phase53');
const FIXDIR = path.join(os.tmpdir(), 'tflex-p78-geom');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(FIXDIR, { recursive: true });

let app = null;
let win = null;

test.setTimeout(360000);

test.beforeAll(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  // Geometry window from the phase brief.
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw.isMaximized()) bw.unmaximize();
    bw.setSize(2048, 1392);
  });
  await win.waitForTimeout(500);
});

test.afterAll(async () => {
  if (app) await hardClose(app, 'p78-geom');
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

// 2-page pdf-lib doc: page 2 carries one synthetic /Subtype /3D annotation
// named Turbine (same shape as the phase57a / phase67 fixtures).
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

// A password-protected PDF that ALSO carries the 3D annotation: the one
// reachable document that shows the protection notice and the 3D notice
// together (Phase 67 header note).
async function buildEncrypted3dPdf(file) {
  const doc = await PDFDocument.load(await build3dBytes());
  doc.encrypt({
    userPassword: 'P78-Geom!',
    algorithm: 'AES-256',
    allowWeakCryptography: false,
    permissions: { printing: 'highResolution', modifying: true, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true },
  });
  fs.writeFileSync(file, await doc.save());
  return file;
}

async function openEncrypted3d() {
  const fixture = await buildEncrypted3dPdf(path.join(FIXDIR, 'p78-prot-3d.pdf'));
  await stubOpen(fixture);
  await clickOpen();
  await win.waitForSelector('[data-password-prompt]', { timeout: 20000 });
  await win.locator('[data-password-input]').fill('P78-Geom!');
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 });
}

// Scoped query helper: the active pane only (a second tab's hidden pane keeps
// its own copy of the notice DOM).
const ACTIVE = '.tab-pane[aria-hidden="false"] ';
function act(sel) { return ACTIVE + sel; }

async function rectOf(selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector('.tab-pane[aria-hidden="false"] ' + sel) || document.querySelector(sel);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }, selector);
}

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// Install a non-blocking rAF recorder that, from install time, samples the
// first notice appearance and the ~700ms that follow it: whether the collapsed
// "i" glyph is present at each frame, and the expanded box's computed
// transform/opacity/animation. Read back with readEnterRecorder().
async function installEnterRecorder(boxSel, iconSel) {
  const iconSels = Array.isArray(iconSel) ? iconSel : [iconSel];
  await win.evaluate(({ boxSel, iconSels }) => {
    const rec = { samples: [], t0: null, done: false, firstSeen: null };
    window.__p78rec = rec;
    const q = (sel) => document.querySelector('.tab-pane[aria-hidden="false"] ' + sel) || document.querySelector(sel);
    const sample = () => {
      const box = q(boxSel);
      const icons = {};
      for (const sel of iconSels) icons[sel] = q(sel) !== null;
      const icon = iconSels.some((sel) => icons[sel]);
      if (box || icon) {
        if (rec.t0 === null) { rec.t0 = performance.now(); rec.firstSeen = performance.now(); }
      }
      const cs = box ? getComputedStyle(box) : null;
      rec.samples.push({
        dt: rec.t0 === null ? null : Math.round(performance.now() - rec.t0),
        icon,
        icons,
        box: box !== null,
        transform: cs ? cs.transform : null,
        opacity: cs ? cs.opacity : null,
        animName: cs ? cs.animationName : null,
        animDur: cs ? cs.animationDuration : null,
      });
    };
    const begin = performance.now();
    const tick = () => {
      sample();
      if (rec.done) return;
      const sinceSeen = rec.firstSeen === null ? 0 : performance.now() - rec.firstSeen;
      if (rec.firstSeen !== null && sinceSeen > 700) { rec.done = true; return; }
      if (performance.now() - begin > 25000) { rec.done = true; return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { boxSel, iconSels });
}

async function readEnterRecorder() {
  const rec = await win.evaluate(() => JSON.parse(JSON.stringify(window.__p78rec || null)));
  return rec;
}

// Measure an expanded box: its rect, the overlay rect, containment, and the
// elementFromPoint at the box centre.
async function measureExpandedBox(boxSel) {
  return win.evaluate(({ boxSel }) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
    const box = pane.querySelector(boxSel) || document.querySelector(boxSel);
    const overlay = pane.querySelector('[data-canvas-overlay]') || document.querySelector('[data-canvas-overlay]');
    if (box === null || overlay === null) return { box: null, overlay: null };
    const br = box.getBoundingClientRect();
    const or = overlay.getBoundingClientRect();
    const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
    const cs = getComputedStyle(box);
    // getComputedStyle resolves transform-origin to pixels: `top right`
    // becomes `<width>px 0px` (y measured from the top).
    const [originX, originY] = cs.transformOrigin.split(' ').map((v) => parseFloat(v));
    return {
      box: { left: br.left, top: br.top, right: br.right, bottom: br.bottom, width: br.width, height: br.height },
      overlay: { left: or.left, top: or.top, right: or.right, bottom: or.bottom, width: or.width, height: or.height },
      insideCanvas: br.left >= or.left - 0.5 && br.top >= or.top - 0.5 && br.right <= or.right + 0.5 && br.bottom <= or.bottom + 0.5,
      hitInBox: hit === box || box.contains(hit),
      hitTop: hit ? `${hit.tagName}.${String(hit.className)}` : 'none',
      borderRadius: cs.borderTopLeftRadius,
      background: cs.backgroundColor,
      backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
      transformOrigin: cs.transformOrigin,
      // top-right origin == x at the right edge, y at the top edge.
      originIsTopRight: Math.abs(originX - br.width) <= 1 && Math.abs(originY) <= 1,
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
    };
  }, { boxSel });
}

test('phase 78 — notices render inside the canvas at the top-right; enter morph + 10s collapse', async () => {
  // ------------------------------------------------------------------
  // Criterion 3 (protection) — record the entry from mount.
  // ------------------------------------------------------------------
  await installEnterRecorder('[data-protection-notice]', ['[data-protection-icon]', '[data-pdf3d-icon]']);
  await openEncrypted3d();
  await win.waitForSelector(act('[data-protection-notice]'), { timeout: 20000 });
  await win.waitForSelector(act('[data-pdf3d-notice]'), { timeout: 20000 });
  await win.waitForTimeout(900); // let the recorder finish its 700ms tail

  const rec = await readEnterRecorder();
  const seenFrames = rec.samples.filter((s) => s.box || s.icon);
  const iconFrames = seenFrames.filter((s) => s.icon);
  const protIconFrames = seenFrames.filter((s) => s.icons['[data-protection-icon]']).length;
  const pdf3dIconFrames = seenFrames.filter((s) => s.icons['[data-pdf3d-icon]']).length;
  const firstBox = seenFrames.find((s) => s.box) || null;
  const transforms = [...new Set(seenFrames.map((s) => s.transform))];
  console.log('P78_ENTER_REC ' + JSON.stringify({
    sampleCount: rec.samples.length,
    seenFrames: seenFrames.length,
    iconFrames: iconFrames.length,
    protIconFrames,
    pdf3dIconFrames,
    firstBox,
    transforms,
  }));
  // DEF-465 retest — the collapsed "i" must be rendered for at least one
  // frame of the entry, BEFORE the box fully expands. Soft so the independent
  // DEF-464 overlap check below still runs when the enter leg fails.
  expect.soft(protIconFrames, `protection "i" rendered at least one frame of the enter (protIconFrames=${protIconFrames})`).toBeGreaterThan(0);
  expect.soft(pdf3dIconFrames, `3D "i" rendered at least one frame of the enter (pdf3dIconFrames=${pdf3dIconFrames})`).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(SHOTS, 'phase78-protection-expanded.png') });
  await win.screenshot({
    path: path.join(SHOTS, 'phase78-enter-early.png'),
    clip: { x: 1200, y: 60, width: 840, height: 260 },
  });

  // ------------------------------------------------------------------
  // Criterion 1 — each expanded box inside [data-canvas-overlay].
  // ------------------------------------------------------------------
  const protBox = await measureExpandedBox('[data-protection-notice]');
  const threeDBox = await measureExpandedBox('[data-pdf3d-notice]');
  console.log('P78_CRIT1_PROT ' + JSON.stringify(protBox));
  console.log('P78_CRIT1_3D ' + JSON.stringify(threeDBox));

  expect(protBox.box, 'protection expanded box exists').not.toBeNull();
  expect(protBox.insideCanvas, `protection box inside canvas (box=${JSON.stringify(protBox.box)} overlay=${JSON.stringify(protBox.overlay)})`).toBe(true);
  expect(protBox.hitInBox, `protection box centre hit resolves into the box, not ${protBox.hitTop}`).toBe(true);
  expect(parseFloat(protBox.borderRadius), 'protection box is rounded').toBeGreaterThan(0);
  expect(protBox.originIsTopRight, `protection box morph origin is top right (got ${protBox.transformOrigin})`).toBe(true);
  expect(threeDBox.box, '3D expanded box exists').not.toBeNull();
  expect(threeDBox.insideCanvas, `3D box inside canvas (box=${JSON.stringify(threeDBox.box)} overlay=${JSON.stringify(threeDBox.overlay)})`).toBe(true);
  expect(threeDBox.hitInBox, `3D box centre hit resolves into the box, not ${threeDBox.hitTop}`).toBe(true);

  // ------------------------------------------------------------------
  // DEF-464 retest — protection AND 3D expanded together must not
  // intersect, and the protection collapse control must stay hit-testable
  // (not covered by the 3D box).
  // ------------------------------------------------------------------
  const def464Overlap = overlaps(protBox.box, threeDBox.box);
  const protCollapseHit = await win.evaluate(() => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
    const btn = pane.querySelector('[data-protection-collapse]') || document.querySelector('[data-protection-collapse]');
    if (btn === null) return null;
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      resolves: hit === btn || btn.contains(hit) || (hit !== null && btn.contains(hit)),
      top: hit ? `${hit.tagName}.${String(hit.className)}` : 'none',
    };
  });
  console.log('P78_DEF464 ' + JSON.stringify({ protBox: protBox.box, threeDBox: threeDBox.box, overlap: def464Overlap, protCollapseHit }));
  await win.screenshot({ path: path.join(SHOTS, 'phase78-def464-both-expanded.png') });
  expect(def464Overlap, `expanded protection and 3D boxes overlap (prot=${JSON.stringify(protBox.box)} 3d=${JSON.stringify(threeDBox.box)})`).toBe(false);
  expect(protCollapseHit, 'protection collapse control exists while the 3D box is expanded').not.toBeNull();
  expect(protCollapseHit.resolves, `protection collapse control is hit-testable, not ${protCollapseHit && protCollapseHit.top}`).toBe(true);

  // ------------------------------------------------------------------
  // Criterion 4 (first leg) — auto-collapse after ~10s, box unmounted.
  // ------------------------------------------------------------------
  const t0 = Date.now();
  await win.waitForSelector(act('[data-protection-icon]'), { timeout: 20000 });
  const elapsed = Date.now() - t0;
  await win.waitForSelector(act('[data-pdf3d-icon]'), { timeout: 20000 });
  const collapsed = await win.evaluate(() => ({
    protNotice: (document.querySelector('.tab-pane[aria-hidden="false"] [data-protection-notice]') || document.querySelector('[data-protection-notice]')) !== null,
    protState: (document.querySelector('.tab-pane[aria-hidden="false"] [data-protection-notice-state]') || document.querySelector('[data-protection-notice-state]'))?.getAttribute('data-protection-notice-state') ?? null,
  }));
  console.log('P78_CRIT4 ' + JSON.stringify({ elapsedMs: elapsed, seconds: +(elapsed / 1000).toFixed(2), collapsed }));
  expect(collapsed.protNotice, 'the box is unmounted once collapsed').toBe(false);
  expect(collapsed.protState, 'the region reports collapsed').toBe('collapsed');
  expect(elapsed, `auto-collapse dwell ~10s (measured ${elapsed}ms)`).toBeGreaterThanOrEqual(8000);
  expect(elapsed, `auto-collapse dwell ~10s (measured ${elapsed}ms)`).toBeLessThanOrEqual(14000);
  await win.screenshot({ path: path.join(SHOTS, 'phase78-protection-collapsed-icons.png') });

  // ------------------------------------------------------------------
  // Criterion 2 — top-right cluster + tight gaps (collapsed icon state).
  // ------------------------------------------------------------------
  const overlayRect = await rectOf('[data-canvas-overlay]');
  const bookRect = await rectOf('[data-book-view-open]');
  const layoutRect = await rectOf('[data-page-layout-control]');
  const protIcon = await rectOf('[data-protection-icon]');
  const threeDIcon = await rectOf('[data-pdf3d-icon]');
  // The "i" immediately LEFT of Book View is the RIGHTMOST collapsed icon.
  const icons = [protIcon, threeDIcon].filter((r) => r !== null);
  const nearestIcon = icons.length > 0 ? icons.reduce((a, b) => (a.right > b.right ? a : b)) : null;
  const gapBookIcon = bookRect && nearestIcon ? bookRect.left - nearestIcon.right : null;
  const gapBookLayout = bookRect && layoutRect ? layoutRect.left - bookRect.right : null;
  const layoutRightInset = layoutRect && overlayRect ? overlayRect.right - layoutRect.right : null;
  const iconPitch = protIcon && threeDIcon ? threeDIcon.left - protIcon.left : null;
  console.log('P78_CRIT2 ' + JSON.stringify({ overlayRect, bookRect, layoutRect, protIcon, threeDIcon, nearestIcon, gapBookIcon, gapBookLayout, layoutRightInset, iconPitch }));

  expect(overlayRect, 'canvas overlay exists').not.toBeNull();
  expect(bookRect, 'Book View control exists').not.toBeNull();
  expect(layoutRect, 'page-layout control exists').not.toBeNull();
  expect(bookRect.cx, 'Book View sits in the right half of the canvas').toBeGreaterThan(overlayRect.left + overlayRect.width / 2);
  expect(bookRect.top, 'Book View sits at the canvas top').toBeLessThan(overlayRect.top + 160);
  expect(layoutRightInset, 'page-layout control keeps the canvas right edge (12px inset)').toBeLessThanOrEqual(14);
  expect(gapBookLayout, `page-layout is immediately right of Book View (gap ${gapBookLayout}px)`).toBeGreaterThanOrEqual(0);
  expect(gapBookLayout, `page-layout is immediately right of Book View (gap ${gapBookLayout}px)`).toBeLessThanOrEqual(12);
  expect(gapBookIcon, `the notice "i" is immediately left of Book View (gap ${gapBookIcon}px)`).toBeGreaterThanOrEqual(0);
  expect(gapBookIcon, `the notice "i" is immediately left of Book View (gap ${gapBookIcon}px)`).toBeLessThanOrEqual(16);
  expect(iconPitch, `the two collapsed icons use a tight pitch, not the old 72px slot (pitch ${iconPitch}px)`).toBeLessThan(72);
  expect(iconPitch, `the two collapsed icons use a tight pitch (pitch ${iconPitch}px)`).toBeGreaterThan(0);
  expect(overlaps(protIcon, layoutRect), 'the protection "i" does not overlap the page-layout control').toBe(false);
  expect(overlaps(protIcon, bookRect), 'the protection "i" does not overlap Book View').toBe(false);
  expect(overlaps(threeDIcon, layoutRect), 'the 3D "i" does not overlap the page-layout control').toBe(false);
  expect(overlaps(threeDIcon, bookRect), 'the 3D "i" does not overlap Book View').toBe(false);

  // Multiple collapsed icons — Phase 67 ruling 6, now at the top-right.
  const protHit = await win.evaluate(() => {
    const el = document.querySelector('.tab-pane[aria-hidden="false"] [data-protection-icon]') || document.querySelector('[data-protection-icon]');
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { resolves: hit === el || el.contains(hit), top: hit ? `${hit.tagName}.${String(hit.className)}` : 'none' };
  });
  const threeDHit = await win.evaluate(() => {
    const el = document.querySelector('.tab-pane[aria-hidden="false"] [data-pdf3d-icon]') || document.querySelector('[data-pdf3d-icon]');
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { resolves: hit === el || el.contains(hit), top: hit ? `${hit.tagName}.${String(hit.className)}` : 'none' };
  });
  console.log('P78_MULTI_ICON ' + JSON.stringify({ protHit, threeDHit, pitch: threeDIcon.left - protIcon.left }));
  expect(overlaps(protIcon, threeDIcon), 'the two collapsed "i" boxes do not overlap').toBe(false);
  expect(protHit.resolves, `protection "i" centre resolves to the icon, not ${protHit.top}`).toBe(true);
  expect(threeDHit.resolves, `3D "i" centre resolves to the icon, not ${threeDHit.top}`).toBe(true);
  expect(overlaps(threeDIcon, bookRect), '3D "i" does not overlap Book View').toBe(false);
  expect(overlaps(threeDIcon, layoutRect), '3D "i" does not overlap the page-layout control').toBe(false);
  const pageHit = await win.evaluate(() => {
    const page = document.querySelector('.tab-pane[aria-hidden="false"] .pdf-page') || document.querySelector('.pdf-page');
    if (page === null) return null;
    const r = page.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { resolves: hit === page || page.contains(hit), top: hit ? `${hit.tagName}.${String(hit.className)}` : 'none' };
  });
  expect(pageHit && pageHit.resolves, `page centre resolves to the page, not ${pageHit && pageHit.top}`).toBe(true);

  // ------------------------------------------------------------------
  // Criterion 4 (instant leg) — reduced motion: both legs instant.
  // ------------------------------------------------------------------
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.waitForTimeout(150);
  await win.locator(act('[data-protection-icon]')).click();
  await win.waitForSelector(act('[data-protection-notice]'), { timeout: 5000 });
  const reducedExpand = await win.evaluate(() => {
    const el = document.querySelector('.tab-pane[aria-hidden="false"] [data-protection-notice]') || document.querySelector('[data-protection-notice]');
    const cs = getComputedStyle(el);
    return {
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      transitionDuration: cs.transitionDuration,
      iconPresent: (document.querySelector('.tab-pane[aria-hidden="false"] [data-protection-icon]') || document.querySelector('[data-protection-icon]')) !== null,
    };
  });
  console.log('P78_REDUCED_EXPAND ' + JSON.stringify(reducedExpand));
  expect(parseFloat(reducedExpand.animationDuration), `reduced-motion enter is instant (anim ${reducedExpand.animationDuration})`).toBeLessThanOrEqual(0.05);
  await win.locator(act('[data-protection-collapse]')).click();
  await win.waitForSelector(act('[data-protection-icon]'), { timeout: 5000 });
  const reducedCollapse = await win.evaluate(() => ({
    noticePresent: (document.querySelector('.tab-pane[aria-hidden="false"] [data-protection-notice]') || document.querySelector('[data-protection-notice]')) !== null,
  }));
  console.log('P78_REDUCED_COLLAPSE ' + JSON.stringify(reducedCollapse));
  expect(reducedCollapse.noticePresent, 'reduced-motion collapse is instant (box unmounted)').toBe(false);
  await win.emulateMedia({ reducedMotion: 'no-preference' });
});

test('phase 78 — conversion notice: inside canvas + enter sequence', async () => {
  await installEnterRecorder('[data-conversion-notice]', '[data-conversion-icon]');
  await stubOpen(path.join(FIX53, 'network.html'));
  await clickOpen();
  await win.waitForSelector(act('[data-conversion-notice]'), { timeout: 25000 });
  await win.waitForTimeout(900);

  const rec = await readEnterRecorder();
  const seenFrames = rec.samples.filter((s) => s.box || s.icon);
  const iconFrames = seenFrames.filter((s) => s.icon);
  const convIconFrames = seenFrames.filter((s) => s.icons['[data-conversion-icon]']).length;
  const transforms = [...new Set(seenFrames.map((s) => s.transform))];
  console.log('P78_CONV_ENTER_REC ' + JSON.stringify({ seenFrames: seenFrames.length, iconFrames: iconFrames.length, convIconFrames, transforms }));
  // DEF-465 retest — the conversion "i" must be rendered for at least one
  // frame of the entry, BEFORE the box fully expands.
  expect.soft(convIconFrames, `conversion "i" rendered at least one frame of the enter (convIconFrames=${convIconFrames})`).toBeGreaterThan(0);

  const convBox = await measureExpandedBox('[data-conversion-notice]');
  console.log('P78_CRIT1_CONV ' + JSON.stringify(convBox));
  await win.screenshot({ path: path.join(SHOTS, 'phase78-conversion-expanded.png') });

  expect(convBox.box, 'conversion expanded box exists').not.toBeNull();
  expect(convBox.insideCanvas, `conversion box inside canvas (box=${JSON.stringify(convBox.box)} overlay=${JSON.stringify(convBox.overlay)})`).toBe(true);
  expect(convBox.hitInBox, `conversion box centre hit resolves into the box, not ${convBox.hitTop}`).toBe(true);
  expect(parseFloat(convBox.borderRadius), 'conversion box is rounded').toBeGreaterThan(0);
  expect(convBox.originIsTopRight, `conversion box morph origin is top right (got ${convBox.transformOrigin})`).toBe(true);

  // Single collapsed "i": it must sit immediately LEFT of Book View at the
  // top-right (the criterion-2 single-icon case), and not overlap the
  // page-layout control.
  await win.waitForSelector(act('[data-conversion-icon]'), { timeout: 20000 });
  const convIcon = await rectOf('[data-conversion-icon]');
  const bookRect2 = await rectOf('[data-book-view-open]');
  const layoutRect2 = await rectOf('[data-page-layout-control]');
  const gap = convIcon && bookRect2 ? bookRect2.left - convIcon.right : null;
  console.log('P78_CONV_SINGLE ' + JSON.stringify({ convIcon, bookRect2, layoutRect2, gap }));
  expect(convIcon, 'conversion "i" exists after collapse').not.toBeNull();
  expect(gap, `single conversion "i" is immediately left of Book View (gap ${gap}px)`).toBeLessThanOrEqual(16);
  expect(overlaps(convIcon, layoutRect2), 'conversion "i" does not overlap the page-layout control').toBe(false);
  expect(overlaps(convIcon, bookRect2), 'conversion "i" does not overlap Book View').toBe(false);
});
