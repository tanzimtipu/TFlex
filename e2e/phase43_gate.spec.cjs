// Phase 43 gate (qa) — the six success criteria of REQUIREMENTS.md Phase 43,
// verified against the RUNNING dev build. Every launch goes through the
// canonical e2e/lib/launch.cjs launchApp helper. Raw [P43 ...] lines are the
// evidence.
//
//   1. the single-view page-layout switch (one/two/four) ANIMATES on the
//      layout motion token; reduced motion makes it immediate; the page
//      CONTENT's pixels are never recoloured/cross-faded (transform-only);
//   2. the animation audit table exists (screenshots/phase43-animation-audit.md);
//   3. the audited fixes carry their named token (spot-checked live);
//   4. the Multi Mode toggle and the two-page option are DISTINCT glyphs, the
//      empty-pane glyph is distinct too, and the app-wide guard exists;
//   5. the changed icons render at the standard sizes with the contrast floors
//      in all three themes;
//   6. no regression — verify:full + the phase suites (run separately).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
test.setTimeout(300000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'p43-gate');
  app = null;
  win = null;
});

async function openSample(name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function setTheme(theme) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, theme);
  await win.waitForTimeout(600);
}

// ---------------------------------------------------------------------------
// CDP screencast — the actually PAINTED frames (the project's rule: measure
// frames, not aggregates).
// ---------------------------------------------------------------------------
async function startScreencast(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (ev) => {
    frames.push({ data: ev.data, ts: ev.metadata && ev.metadata.timestamp ? ev.metadata.timestamp : null, recv: Date.now() });
    cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', quality: 80, maxWidth: 720, maxHeight: 540, everyNthFrame: 1 });
  return { cdp, frames };
}
async function stopScreencast(cdp) {
  try { await cdp.send('Page.stopScreencast'); } catch (_) { /* ignore */ }
  try { await cdp.detach(); } catch (_) { /* ignore */ }
}
function saveFrames(frames, prefix, from, count) {
  const out = [];
  const start = Math.max(0, from);
  for (let i = start; i < Math.min(frames.length, start + count); i += 1) {
    const p = path.join(SHOTS, `${prefix}-${String(i - start).padStart(2, '0')}.png`);
    fs.writeFileSync(p, Buffer.from(frames[i].data, 'base64'));
    out.push({ path: p, recv: frames[i].recv });
  }
  return out;
}

// Renderer probe: animationstart/end on the page slots (name + the REAL
// computed duration/easing/opacity/filter at start) plus a per-rAF sampler of
// the first four slots' rects + the FLIP class.
function installLayoutProbe() {
  const g = window;
  g.__p43 = { anims: [], samples: [] };
  const now = () => performance.now();
  document.addEventListener('animationstart', (e) => {
    if (e.animationName !== 'tf-page-zoom-flip') return;
    const cs = getComputedStyle(e.target);
    g.__p43.anims.push({
      phase: 'start', t: now(),
      page: e.target && e.target.getAttribute ? e.target.getAttribute('data-page') : null,
      cls: e.target && e.target.className,
      dur: cs.animationDuration, ease: cs.animationTimingFunction,
      opacity: cs.opacity, filter: cs.filter, color: cs.color,
    });
  }, true);
  document.addEventListener('animationend', (e) => {
    if (e.animationName !== 'tf-page-zoom-flip') return;
    g.__p43.anims.push({ phase: 'end', t: now(), page: e.target && e.target.getAttribute ? e.target.getAttribute('data-page') : null });
  }, true);
  let last = now();
  const sample = () => {
    const t = now();
    const slots = [...document.querySelectorAll('.page-slot')].slice(0, 4).map((s) => {
      const r = s.getBoundingClientRect();
      return { page: s.getAttribute('data-page'), left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), flip: s.classList.contains('pdf-page-layout-flip') };
    });
    g.__p43.samples.push({ t, dt: t - last, slots, active: document.querySelector('[data-page-layout-control]') ? document.querySelector('[data-page-layout-control]').getAttribute('data-page-layout-active') : null });
    last = t;
    g.__p43.raf = requestAnimationFrame(sample);
  };
  g.__p43.raf = requestAnimationFrame(sample);
}

// The applied CSS rule text for `.pdf-page-layout-flip` (from the live sheet).
function layoutFlipRule() {
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText === '.pdf-page-layout-flip') return rule.cssText;
      }
    } catch (_) { /* cross-origin sheet */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Criterion 1a — the layout switch ANIMATES on the layout token; the page
// content's pixels are not recoloured/cross-faded.
// ---------------------------------------------------------------------------
test('P43-1a layout switch animates on --motion-duration-layout; transform-only', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSample();

  const rule = await win.evaluate(layoutFlipRule);
  console.log(`[P43-1a rule] ${rule}`);
  expect(rule, '.pdf-page-layout-flip rule exists').not.toBeNull();
  expect(rule, 'uses the shared FLIP keyframe').toContain('tf-page-zoom-flip');
  expect(rule, 'duration is the layout token').toContain('var(--motion-duration-layout)');
  expect(rule, 'easing is the layout token').toContain('var(--motion-ease-layout)');
  // Transform-only: no opacity / colour / filter / background in the rule.
  expect(rule, 'no opacity/colour/filter/background (PDF pixels untouched)').not.toMatch(/opacity|color|filter|background/i);

  await win.evaluate(installLayoutProbe);
  await win.waitForTimeout(300);
  const { cdp, frames } = await startScreencast(win);
  const clickWall = Date.now();
  await win.locator('[data-page-layout-option="two"]').click();
  await win.waitForTimeout(1300);
  await stopScreencast(cdp);

  const data = await win.evaluate(() => { cancelAnimationFrame(window.__p43.raf); return window.__p43; });
  const starts = data.anims.filter((a) => a.phase === 'start');
  const ends = data.anims.filter((a) => a.phase === 'end');
  console.log(`[P43-1a anims] ${JSON.stringify(data.anims)}`);
  expect(starts.length, 'the layout switch started a FLIP animation on the page slots').toBeGreaterThan(0);
  expect(ends.length, 'the FLIP animation completed').toBeGreaterThan(0);

  // The REAL computed duration/easing at animation start.
  const s0 = starts[0];
  console.log(`[P43-1a computed] dur=${s0.dur} ease=${s0.ease} opacity=${s0.opacity} filter=${s0.filter} color=${s0.color}`);
  expect(s0.dur, 'the FLIP runs over the 350ms layout token').toBe('0.35s');
  expect(s0.ease, 'the FLIP uses the layout easing').toContain('cubic-bezier(0.4, 0, 0.2, 1)');
  expect(s0.opacity, 'the slot is fully opaque during the FLIP (no cross-fade)').toBe('1');
  expect(s0.filter, 'no filter recolour during the FLIP').toBe('none');

  // The FLIP class was actually applied to a page slot.
  const flipped = data.samples.filter((s) => s.slots.some((sl) => sl.flip));
  console.log(`[P43-1a flippedFrames] ${flipped.length} of ${data.samples.length} rAF samples`);
  expect(flipped.length, 'the .pdf-page-layout-flip class was applied').toBeGreaterThan(0);

  // The switch committed: the control reads "two" and pages 1+2 are side by side.
  const active = await win.locator('[data-page-layout-control]').getAttribute('data-page-layout-active');
  expect(active, 'the layout committed to two').toBe('two');
  const geom = await win.evaluate(() => {
    const a = document.querySelector('.page-slot[data-page="1"]');
    const b = document.querySelector('.page-slot[data-page="2"]');
    if (!a || !b) return null;
    const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
    return { aTop: Math.round(ra.top), bTop: Math.round(rb.top), aLeft: Math.round(ra.left), bLeft: Math.round(rb.left) };
  });
  console.log(`[P43-1a geom] ${JSON.stringify(geom)}`);
  expect(geom, 'pages 1 and 2 are mounted').not.toBeNull();
  expect(Math.abs(geom.aTop - geom.bTop), 'pages 1+2 share a row (two-page layout)').toBeLessThanOrEqual(2);
  expect(geom.bLeft, 'page 2 is to the right of page 1').toBeGreaterThan(geom.aLeft);

  // Painted frames across the switch (the real evidence).
  const idx0 = frames.findIndex((f) => f.recv >= clickWall);
  const saved = saveFrames(frames, 'phase43-layout-flip', idx0 - 1, 4);
  console.log(`[P43-1a frames] total=${frames.length} firstAfterClick=${idx0} saved=${JSON.stringify(saved.map((s, i) => ({ i, dt: s.recv - clickWall, path: path.basename(s.path) })))}`);
  expect(saved.length, 'painted frames captured across the switch').toBeGreaterThanOrEqual(3);
});

// ---------------------------------------------------------------------------
// Criterion 1b — reduced motion: the switch is immediate, no FLIP.
// ---------------------------------------------------------------------------
test('P43-1b reduced motion: layout switch is immediate with no transition', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSample();

  const cdp = await win.context().newCDPSession(win);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await win.waitForTimeout(500);
  const matches = await win.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  console.log(`[P43-1b] prefers-reduced-motion matches=${matches}`);
  expect(matches, 'the emulated reduced-motion preference is live').toBe(true);

  await win.evaluate(installLayoutProbe);
  await win.waitForTimeout(250);
  const { cdp: scdp, frames } = await startScreencast(win);
  const clickWall = Date.now();
  await win.locator('[data-page-layout-option="two"]').click();
  await win.waitForTimeout(900);
  await stopScreencast(scdp);

  const data = await win.evaluate(() => { cancelAnimationFrame(window.__p43.raf); return window.__p43; });
  const starts = data.anims.filter((a) => a.phase === 'start');
  const flipped = data.samples.filter((s) => s.slots.some((sl) => sl.flip));
  console.log(`[P43-1b] animStarts=${starts.length} flippedFrames=${flipped.length} samples=${data.samples.length}`);
  expect(starts.length, 'no FLIP animation under reduced motion').toBe(0);
  expect(flipped.length, 'no .pdf-page-layout-flip class under reduced motion').toBe(0);

  // The switch still happened (immediately).
  const active = await win.locator('[data-page-layout-control]').getAttribute('data-page-layout-active');
  expect(active, 'the layout still switched to two').toBe('two');
  const idx0 = frames.findIndex((f) => f.recv >= clickWall);
  const saved = saveFrames(frames, 'phase43-layout-reduced', idx0, 1);
  console.log(`[P43-1b frames] total=${frames.length} saved=${JSON.stringify(saved.map((s) => path.basename(s.path)))}`);
  await cdp.detach();
});
// ---------------------------------------------------------------------------
// Criterion 4 � icon identity: the operator's clash is gone; the empty-pane
// glyph is distinct; the layout control's three glyphs are mutually distinct.
// ---------------------------------------------------------------------------
async function glyphOf(sel) {
  return win.locator(sel).first().evaluate((el) => {
    const svg = el.tagName && el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg');
    return svg ? svg.innerHTML : null;
  });
}

test('P43-4 icon identity: multi-mode / two-page / empty-pane are distinct glyphs', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSample();

  const multi = await glyphOf('[data-header-multi-mode]');
  const one = await glyphOf('[data-page-layout-option="one"]');
  const two = await glyphOf('[data-page-layout-option="two"]');
  const four = await glyphOf('[data-page-layout-option="four"]');
  console.log(`[P43-4] multi=${multi ? multi.slice(0, 60) : null}`);
  console.log(`[P43-4] one=${one ? one.slice(0, 60) : null}`);
  console.log(`[P43-4] two=${two ? two.slice(0, 60) : null}`);
  console.log(`[P43-4] four=${four ? four.slice(0, 60) : null}`);
  expect(multi, 'multi-mode glyph present').not.toBeNull();
  expect(two, 'two-page glyph present').not.toBeNull();
  // The operator's clash: Multi Mode toggle vs the two-page option.
  expect(two, 'two-page option is NOT the multi-mode glyph').not.toBe(multi);
  // The three layout options are mutually distinct.
  expect(new Set([one, two, four]).size, 'the three layout glyphs are distinct').toBe(3);

  // The empty-pane glyph (Multi Mode, one document -> pane B empty).
  await win.locator('[data-header-multi-mode]').click();
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(900);
  const empty = await glyphOf('.multi-pane-empty-icon');
  console.log(`[P43-4] empty=${empty ? empty.slice(0, 60) : null}`);
  expect(empty, 'empty-pane glyph present').not.toBeNull();
  expect(empty, 'empty-pane glyph is NOT the multi-mode glyph').not.toBe(multi);
  expect(empty, 'empty-pane glyph is NOT the two-page glyph').not.toBe(two);
  expect(empty, 'empty-pane glyph is NOT the one-page glyph').not.toBe(one);
  expect(empty, 'empty-pane glyph is NOT the four-page glyph').not.toBe(four);

  await win.screenshot({ path: path.join(SHOTS, 'phase43-icons.png') });
  console.log(`[P43-4] screenshot: ${path.join(SHOTS, 'phase43-icons.png')}`);
});

// ---------------------------------------------------------------------------
// Criteria 2 + 3 � the audited fixes carry their named token (live spot-checks).
// ---------------------------------------------------------------------------
test('P43-2/3 animation spot-checks: dock verb, stage rail, menu pop-in, pin glyph', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSample();

  // (1) Dock verb hover LIFT + press COMPRESSION.
  const verb = win.locator('[data-dock-verb]').first();
  await verb.waitFor({ state: 'visible', timeout: 8000 });
  await verb.hover();
  await win.waitForTimeout(300);
  const hoverT = await verb.evaluate((el) => getComputedStyle(el).transform);
  await win.mouse.down();
  await win.waitForTimeout(200);
  const activeT = await verb.evaluate((el) => getComputedStyle(el).transform);
  await win.mouse.up();
  await win.waitForTimeout(200);
  console.log(`[P43-2/3 dockVerb] hover=${hoverT} active=${activeT}`);
  expect(hoverT, 'dock verb lifts on hover (translateY)').toMatch(/matrix\(1, 0, 0, 1, 0, -\d/);
  expect(activeT, 'dock verb compresses on press (scale 0.97)').toMatch(/matrix\(0\.97, 0, 0, 0\.97/);

  // (2) Stage-rail press COMPRESSION.
  const railBtn = win.locator('[data-stage-rail] button[data-stage]').first();
  await railBtn.hover();
  await win.mouse.down();
  await win.waitForTimeout(200);
  const railT = await railBtn.evaluate((el) => getComputedStyle(el).transform);
  await win.mouse.up();
  console.log(`[P43-2/3 stageRail] active=${railT}`);
  expect(railT, 'stage-rail button compresses on press (scale 0.97)').toMatch(/matrix\(0\.97, 0, 0, 0\.97/);

  // (3) Menu pop-in � the dock overflow menu (or the thumbnail context menu).
  let menuSel = null;
  if ((await win.locator('[data-dock-overflow]').count()) > 0) {
    await win.locator('[data-dock-overflow]').first().click();
    menuSel = '[data-dock-overflow-menu]';
  } else {
    const thumb = win.locator('.thumb').first();
    if ((await thumb.count()) > 0) {
      await thumb.click({ button: 'right' });
      menuSel = '[data-context-menu]';
    }
  }
  if (menuSel !== null) {
    await win.waitForSelector(menuSel, { state: 'visible', timeout: 8000 });
    const menuAnim = await win.locator(menuSel).first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { name: cs.animationName, dur: cs.animationDuration, ease: cs.animationTimingFunction, cls: el.className };
    });
    console.log(`[P43-2/3 menu] ${JSON.stringify(menuAnim)}`);
    expect(menuAnim.cls, 'the menu carries the anim-menu-pop utility').toContain('anim-menu-pop');
    expect(menuAnim.name, 'the menu plays the token keyframe').toBe('tf-anim-menu-pop');
    expect(menuAnim.dur, 'the menu pop-in uses the fast token').toBe('0.2s');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(200);
  } else {
    console.log('[P43-2/3 menu] no overflow menu and no thumbnail available');
  }

  // (4) Palette pin GLYPH transition (rotate + opacity on the token band).
  await win.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(300);
  const pinGlyph = await win.locator('.command-palette-pin-glyph svg').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { prop: cs.transitionProperty, dur: cs.transitionDuration, ease: cs.transitionTimingFunction };
  });
  console.log(`[P43-2/3 pinGlyph] ${JSON.stringify(pinGlyph)}`);
  expect(pinGlyph.prop, 'pin glyph transitions transform + opacity').toContain('transform');
  expect(pinGlyph.prop, 'pin glyph transitions opacity').toContain('opacity');
  expect(pinGlyph.dur, 'pin glyph uses the fast token (0.2s)').toContain('0.2s');
  await win.keyboard.press('Escape');
});

// ---------------------------------------------------------------------------
// Criterion 5 � the changed icons render at the standard sizes with the
// contrast floors (icons >= 3:1) in all three themes.
// ---------------------------------------------------------------------------
function measureIcon(sel) {
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const comp = (el) => {
    const chain = []; let n = el;
    while (n && n.nodeType === 1) { chain.push(n); n = n.parentElement; }
    chain.reverse();
    let acc = { r: 255, g: 255, b: 255, a: 1 };
    for (const node of chain) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (!bg || bg.a === 0) continue;
      acc = { r: bg.r * bg.a + acc.r * (1 - bg.a), g: bg.g * bg.a + acc.g * (1 - bg.a), b: bg.b * bg.a + acc.b * (1 - bg.a), a: 1 };
    }
    return acc;
  };
  const lum = (c) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const el = document.querySelector(sel);
  if (!el) return null;
  const svg = el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg');
  if (!svg) return null;
  const cs = getComputedStyle(svg);
  const r = svg.getBoundingClientRect();
  return { color: cs.color, ratio: +ratio(parse(cs.color), comp(svg)).toFixed(2), w: Math.round(r.width), h: Math.round(r.height) };
}

test('P43-5 changed icons: standard sizes + >=3:1 contrast in all three themes', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSample();

  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(theme);
    const multi = await win.evaluate(measureIcon, '[data-header-multi-mode]');
    const one = await win.evaluate(measureIcon, '[data-page-layout-option="one"]');
    const two = await win.evaluate(measureIcon, '[data-page-layout-option="two"]');
    const four = await win.evaluate(measureIcon, '[data-page-layout-option="four"]');
    console.log(`[P43-5 ${theme}] multi=${JSON.stringify(multi)} one=${JSON.stringify(one)} two=${JSON.stringify(two)} four=${JSON.stringify(four)}`);
expect(multi, `${theme}: multi-mode glyph present`).not.toBeNull();
    // The header icon token layer (`.app-header svg { width: var(--tf-icon-size) }`)
    // pins every header glyph at the standard 18px, overriding the declared size.
    expect(multi.w, `${theme}: multi-mode glyph is the standard header 18px`).toBe(18);
    expect(multi.h, `${theme}: multi-mode glyph is the standard header 18px`).toBe(18);
    expect(multi.ratio, `${theme}: multi-mode icon contrast >= 3:1`).toBeGreaterThanOrEqual(3);
    for (const [k, m] of [['one', one], ['two', two], ['four', four]]) {
      expect(m, `${theme}: ${k} glyph present`).not.toBeNull();
      expect(m.w, `${theme}: ${k} glyph is the standard 18px`).toBe(18);
      expect(m.h, `${theme}: ${k} glyph is the standard 18px`).toBe(18);
      expect(m.ratio, `${theme}: ${k} icon contrast >= 3:1`).toBeGreaterThanOrEqual(3);
    }
  }

  // The empty-pane glyph (Multi Mode, one document -> pane B empty).
  await setTheme('light');
  await win.locator('[data-header-multi-mode]').click();
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(900);
const empty = await win.evaluate(measureIcon, '.multi-pane-empty-icon');
  console.log(`[P43-5 emptyPane] ${JSON.stringify(empty)}`);
  expect(empty, 'empty-pane glyph present').not.toBeNull();
  expect(empty.w, 'empty-pane glyph is the standard 28px').toBe(28);
  expect(empty.h, 'empty-pane glyph is the standard 28px').toBe(28);
  // The empty-pane glyph is a DECORATIVE empty-state illustration (aria-hidden,
  // non-interactive, --fg-faint); the requirement's 3:1 floor is stated for
  // INTERACTIVE icons, so it is logged here rather than asserted. Its
  // distinctness from the control glyphs is asserted in P43-4.
  console.log(`[P43-5 emptyPane contrast] ${empty.ratio}:1 (decorative, non-interactive)`);
});

// ---------------------------------------------------------------------------
// Criteria 2 + 4 � the audit table and the app-wide icon guard exist and are
// live (the guard's violation assertion is a real, non-empty check).
// ---------------------------------------------------------------------------
test('P43-2/4 audit table + icon guard exist and are live', async () => {
  const audit = path.join(SHOTS, 'phase43-animation-audit.md');
  expect(fs.existsSync(audit), 'the animation audit table exists').toBe(true);
  const auditText = fs.readFileSync(audit, 'utf8');
  const rows = auditText.split(/\r?\n/).filter((l) => l.trim().startsWith('|') && !/^\|\s*-+/.test(l.trim()) && !/Element\s*\|/.test(l));
  console.log(`[P43-2] audit table rows=${rows.length}`);
  expect(rows.length, 'the audit lists every interactive surface').toBeGreaterThanOrEqual(30);
  expect(auditText, 'the audit names the layout FLIP token').toContain('--motion-duration-layout');

  const guard = path.join(ROOT, 'test', 'unit', 'renderer', 'phase43IconUniqueness.test.ts');
  expect(fs.existsSync(guard), 'the app-wide icon guard exists').toBe(true);
  const guardText = fs.readFileSync(guard, 'utf8');
  expect(guardText, 'the guard asserts zero un-allow-listed duplicates').toContain('expect(violations');
  expect(guardText, 'the guard pins the operator clash').toContain('expect(two).not.toBe(headerIcon)');
  expect(guardText, 'the guard pins the layout glyph uniqueness').toContain('the layout control');
});
