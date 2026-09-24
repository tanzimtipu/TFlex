// RETEST DEF-200 (qa, Phase 15 press-token round).
// DEF-200: while the pointer is down on a .btn, .btn:hover:not([disabled])
// (0,3,0) outranked the unguarded .btn:active press rule (0,2,0), so the
// shared press group's transform (translateY(1px) scale(var(--motion-scale-press)))
// never applied to the .btn family — a pressed button stayed at the hover lift
// matrix(1, 0, 0, 1, 0, -1).
//
// Fix under test (frontend-dev FIX-READY, 2026-09-14): the shared press group's
// .btn:active now carries :not([disabled]) (styles.css ~8088) — same (0,3,0)
// specificity as the hover rule, later in source, so it wins — and the redundant
// standalone .btn:active rule (~1674) was dropped.
//
// Procedure (per the DEF-200 filing): open form.pdf, open the flatten dialog,
// hover + hold the Cancel (.btn) button, read getComputedStyle(button).transform
// while held. Expected: matrix(0.97, 0, 0, 0.97, 0, 1) — scale 0.97
// (--motion-scale-press) + the 1px press settle. Previously broken:
// matrix(1, 0, 0, 1, 0, -1) — hover lift only.
//
// Regression control on the same build: the command-bar .tool-btn press (the
// DEF-196 subject) must still measure 0.97 + ty 1.
// A CSSOM guard fails loud if the loaded stylesheet never picked up the guarded
// rule (i.e. the build under test is stale).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchDev, openSample, hardClose, openDockVerb } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

let electronApp = null;
let win = null;

async function boot() {
  ({ electronApp, window: win } = await launchDev());
  win.on('pageerror', (err) => process.stdout.write(`[def200 pageerror] ${err.message}\n`));
}

async function openDoc(name, waitMs = 1800) {
  await openSample(win, electronApp, name);
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(waitMs);
}

async function closeApp() {
  await hardClose(electronApp, 'def-200-retest');
  electronApp = null;
  win = null;
}

test.afterEach(async () => {
  if (electronApp) await closeApp();
});

function parseMatrix(tr) {
  if (!tr || tr === 'none') return null;
  const m = tr.match(/matrix\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((s) => parseFloat(s.trim()));
  return { a: p[0], d: p[3], tx: p[4], ty: p[5] };
}

test('DEF-200: pressed .btn applies the shared press transform (scale 0.97 + ty 1), not the hover lift', async () => {
  test.setTimeout(240000);
  await boot();
  await openDoc('form.pdf');

  // Artifact guard: the loaded stylesheet must actually contain the guarded
  // .btn:active press rule. A stale dist (still shipping the unguarded
  // (0,2,0) rule) would silently re-fail the measurement, so fail loud.
  const cssom = await win.evaluate(() => {
    const sels = [];
    const walk = (list) => {
      for (const r of list) {
        if (r.cssRules && r.cssRules.length) { walk(r.cssRules); continue; }
        if (r.selectorText) sels.push(r.selectorText);
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch (e) { /* cross-origin */ }
    }
    return {
      guarded: sels.some((s) => /\.btn:active:not\(\[disabled\]\)/.test(s)),
      unguarded: sels.some((s) => /\.btn:active(?!\:not)/.test(s)),
      scalePress: getComputedStyle(document.documentElement).getPropertyValue('--motion-scale-press').trim(),
    };
  });
  console.log('[200] CSSOM:', JSON.stringify(cssom));
  expect(cssom.guarded, 'loaded CSS must contain .btn:active:not([disabled]) (the DEF-200 fix)').toBe(true);
  expect(cssom.unguarded, 'the unguarded (0,2,0) .btn:active rule must be gone').toBe(false);
  // getComputedStyle returns the specified text verbatim (".97" — minified
  // leading-zero drop), so compare numerically, not by string.
  expect(parseFloat(cssom.scalePress), `--motion-scale-press must resolve to 0.97 on :root, got ${cssom.scalePress}`).toBeCloseTo(0.97, 6);

  // Open the flatten dialog (form.pdf carries form fields).
  // Phase 36 (chunk 3) — Flatten is the REVIEW dock's `flatten` verb.
  await openDockVerb(win, 3, 'flatten');
  await win.waitForSelector('[data-animated-dialog="flatten-confirm"]', { timeout: 8000 });
  await win.waitForTimeout(900); // let the bloom settle before pressing

  const cancelBtn = win.locator('.modal-dialog button:has-text("Cancel")').first();
  await expect(cancelBtn, 'flatten dialog Cancel button visible').toBeVisible();
  const cbx = await cancelBtn.boundingBox();
  expect(cbx, 'Cancel button has a bounding box').toBeTruthy();

  // Hover, let the hover lift settle, then press-hold.
  await win.mouse.move(cbx.x + cbx.width / 2, cbx.y + cbx.height / 2);
  await win.waitForTimeout(200);
  const hoverTr = await win.evaluate(() => {
    const b = [...document.querySelectorAll('.modal-dialog .btn')].find((x) => x.textContent.includes('Cancel'));
    return b ? getComputedStyle(b).transform : 'none';
  });
  const hm = parseMatrix(hoverTr);
  console.log('[200] .btn hover transform =', hoverTr, '| scale', hm && hm.a, 'ty', hm && hm.ty, '(expect lift: scale 1, ty -1)');

  // The measurement: hold the mouse down on Cancel for 200ms and read the
  // computed transform while the pointer is still down (the :active state).
  await win.mouse.down();
  await win.waitForTimeout(200);
  const pressedTr = await win.evaluate(() => {
    const b = [...document.querySelectorAll('.modal-dialog .btn')].find((x) => x.textContent.includes('Cancel'));
    return b ? getComputedStyle(b).transform : 'none';
  });
  const pm = parseMatrix(pressedTr);
  console.log('[200] .btn PRESSED transform =', pressedTr, '| scale', pm && pm.a, 'ty', pm && pm.ty,
    '| expected matrix(0.97, 0, 0, 0.97, 0, 1) [pre-fix: matrix(1, 0, 0, 1, 0, -1)]');
  await win.screenshot({ path: path.join(SHOTS, 'def-200-retest.png') }); // pressed state, pointer held

  await win.mouse.up();
  // The pointerdown+pointerup pair on the button fires a real click, so
  // Cancel has already dismissed the dialog - wait for it to be gone instead
  // of clicking it a second time.
  await win.waitForFunction(() => !document.querySelector('[data-animated-dialog="flatten-confirm"]'), null, { timeout: 5000 });

  // DEF-200 subject: the press transform must apply while pressed — scale
  // 0.97 (the token) + the 1px press settle, NOT the hover lift (scale 1,
  // ty -1) and not the dead 0.982 legacy value.
  expect(pm, 'a transform must be applied while the .btn is pressed').toBeTruthy();
  expect(Math.abs(pm.a - 0.97) < 0.005, `press scale must be 0.97 (--motion-scale-press), measured ${pm.a}`).toBe(true);
  expect(Math.abs(pm.d - 0.97) < 0.005, `press scale d must be 0.97, measured ${pm.d}`).toBe(true);
  expect(Math.abs(pm.ty - 1) < 0.5, `press settle ty must be 1px, measured ${pm.ty}`).toBe(true);

  // Regression control (DEF-196 subject): the command-bar .tool-btn press must
  // still measure 0.97 + ty 1 on the same build.
  const zoomBtn = win.locator('.tab-pane[aria-hidden="false"] [aria-label="Zoom in"]');
  const zbx = await zoomBtn.boundingBox();
  expect(zbx, 'Zoom in tool-btn has a bounding box').toBeTruthy();
  await win.mouse.move(zbx.x + zbx.width / 2, zbx.y + zbx.height / 2);
  await win.waitForTimeout(150);
  await win.mouse.down();
  await win.waitForTimeout(200);
  const toolTr = await win.evaluate(() => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const el = pane && [...pane.querySelectorAll('.tool-btn')].find((b) => b.getAttribute('aria-label') === 'Zoom in');
    return el ? getComputedStyle(el).transform : 'none';
  });
  await win.mouse.up();
  const tm = parseMatrix(toolTr);
  console.log('[200] control .tool-btn pressed transform =', toolTr, '| scale', tm && tm.a, 'ty', tm && tm.ty);
  expect(tm, 'a transform must be applied while the .tool-btn is pressed').toBeTruthy();
  expect(Math.abs(tm.a - 0.97) < 0.005, `tool-btn press scale must be 0.97, measured ${tm.a}`).toBe(true);
  expect(Math.abs(tm.ty - 1) < 0.5, `tool-btn press settle ty must be 1px, measured ${tm.ty}`).toBe(true);
});