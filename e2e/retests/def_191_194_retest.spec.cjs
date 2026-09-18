// RETEST DEF-191 / DEF-192 / DEF-193 / DEF-194 (qa, Phase 14.2 fix round 2).
// Retests the four defects the Phase-14.2 verification round filed, on the dev
// build rebuilt after the developer's second fix pass:
//   DEF-191  frosted Open button ghost capsule (specificity loss vs the film)
//   DEF-192  Tools panel never pushes the page view (dead --tf-tools-inset)
//   DEF-193  panel + page do not animate together (same dead token)
//   DEF-194  command-bar icons laid out ~14.7px instead of 22px (UA padding)
// Same measurement shapes as e2e/phase14_2_verify.spec.cjs so the numbers are
// directly comparable with the filing runs. Screenshots -> screenshots/def-19*-retest*.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchDev, openSample, hardClose } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

let electronApp = null;
let win = null;
let rendererErrors = [];

async function openReport() {
  ({ electronApp, window: win } = await launchDev());
  rendererErrors = [];
  win.on('pageerror', (err) => rendererErrors.push(`pageerror: ${err.message}`));
  win.on('console', (msg) => {
    if (msg.type() === 'error') rendererErrors.push(`console.error: ${msg.text()}`);
  });
  await openSample(win, electronApp, 'report.pdf');
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(1800);
}

async function closeApp() {
  await hardClose(electronApp, 'def-191-194-retest');
  electronApp = null;
  win = null;
}

async function setTheme(value) {
  // Close the floating palette first so the theme popover can never be covered
  // (DEF-189 family).
  const paletteOpen = await win.evaluate(() => !!document.querySelector('[data-tools-palette]'));
  if (paletteOpen) {
    await win.click('button[data-tools-toggle]');
    await win.waitForFunction(() => !document.querySelector('[data-tools-palette]'), undefined, { timeout: 5000 });
  }
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${value}"]`);
  await win.waitForFunction(
    (v) => document.documentElement.getAttribute('data-theme') === v,
    value,
    { timeout: 5000 },
  );
  await win.waitForTimeout(500);
}

async function openTools() {
  await win.click('button[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(900); // palette tween + fit-width reflow settle
}

async function closeTools() {
  await win.click('button[data-tools-toggle]');
  await win.waitForFunction(() => !document.querySelector('[data-tools-palette]'), undefined, { timeout: 5000 });
  await win.waitForTimeout(450);
}

// Geometry snapshot of the page view + panel for one instant.
async function measureView() {
  return win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const wm = document.querySelector('.workspace-main');
    const pal = document.querySelector('[data-tools-palette]');
    const page = document.querySelector('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]');
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top),
        width: Math.round(b.width), height: Math.round(b.height),
      };
    };
    return {
      dataTheme: document.documentElement.getAttribute('data-theme'),
      toolsOpenAttr: document.querySelector('.app-main')?.getAttribute('data-tools-open') ?? null,
      scroller: r(sc),
      scrollerMarginRight: getComputedStyle(sc).marginRight,
      palette: r(pal),
      page: r(page),
      insetVar: getComputedStyle(wm).getPropertyValue('--tf-tools-inset').trim(),
    };
  });
}

// DEF-191 measurement: the File group capsule vs the Open button, plus any
// pseudo-element paint on the group.
async function openButtonMetrics() {
  return win.evaluate(() => {
    const g = document.querySelector('.toolbar-group.commandbar-group-open');
    const b = document.querySelector('.commandbar-open');
    if (!g || !b) return null;
    const gs = getComputedStyle(g);
    const bs = getComputedStyle(b);
    const bb = b.getBoundingClientRect();
    const gb = g.getBoundingClientRect();
    const alphaOf = (color) => (color.startsWith('rgba')
      ? Number(color.split(',')[3].replace(')', ''))
      : (color === 'transparent' ? 0 : 1));
    const pseudo = (el, p) => {
      const cs = getComputedStyle(el, p);
      return {
        content: cs.content,
        bg: cs.backgroundColor,
        bgAlpha: alphaOf(cs.backgroundColor),
        shadow: cs.boxShadow,
      };
    };
    return {
      dataTheme: document.documentElement.getAttribute('data-theme'),
      groupBg: gs.backgroundColor,
      groupBgAlpha: alphaOf(gs.backgroundColor),
      groupBorderColor: gs.borderColor,
      groupShadow: gs.boxShadow,
      btnBg: bs.backgroundColor,
      btnColor: bs.color,
      btnH: Math.round(bb.height * 100) / 100,
      groupH: Math.round(gb.height * 100) / 100,
      btnW: Math.round(bb.width * 100) / 100,
      groupW: Math.round(gb.width * 100) / 100,
      groupBefore: pseudo(g, '::before'),
      groupAfter: pseudo(g, '::after'),
    };
  });
}

test.describe('DEF-191..194 retest (phase 14.2 fix round 2)', () => {
  test.afterEach(async () => {
    expect(rendererErrors, 'no renderer errors during the retest').toEqual([]);
    await hardClose(electronApp, 'def-191-194-retest');
    electronApp = null;
    win = null;
  });

  // ------------------------------------------------------------------
  // DEF-191: frosted Open button must be a clean single layer.
  // ------------------------------------------------------------------
  test('DEF-191: frosted Open button has no ghost capsule behind it', async () => {
    test.setTimeout(240000);
    await openReport();
    const m = await openButtonMetrics();
    console.log('[DEF-191] frosted open button:', JSON.stringify(m));
    await win.screenshot({
      path: path.join(SHOTS, 'def-191-retest.png'),
      clip: { x: 0, y: 44, width: 420, height: 120 },
    });
    expect(m, 'Open button + File group mounted').not.toBeNull();
    expect(m.dataTheme, 'test runs in the frosted theme').toBe('frosted');
    expect(m.groupBgAlpha, 'DEF-191: File capsule paints nothing (no translucent ghost film)').toBe(0);
    expect(m.groupBorderColor, 'DEF-191: File capsule hairline is transparent').toBe('rgba(0, 0, 0, 0)');
    expect(m.groupShadow, 'DEF-191: File capsule casts no shadow').toBe('none');
    expect(m.btnBg, 'Open button keeps its solid blue accent').toBe('rgb(37, 99, 235)');
    expect(m.btnColor, 'Open button text/icon white').toBe('rgb(255, 255, 255)');
    for (const [name, p] of [['::before', m.groupBefore], ['::after', m.groupAfter]]) {
      const paints = p.content !== 'none' && (p.bgAlpha !== 0 || p.shadow !== 'none');
      expect(paints, `DEF-191: group ${name} paints nothing`).toBe(false);
    }
    // The group box keeps ~17px of layout padding beyond the button; that is
    // invisible under the paint contract above. The filing's width mismatch
    // mattered only because the film PAINTED there - log it, don't fail on it.
    console.log(`[DEF-191] box sizes (informational): btn ${m.btnW}x${m.btnH} vs group ${m.groupW}x${m.groupH}`);

    // The frosted film also had a hover variant (0-4-0); the fix's hover
    // override must hold there too - no ghost returning on hover.
    await win.hover('.commandbar-open');
    await win.waitForTimeout(250);
    const hov = await openButtonMetrics();
    console.log('[DEF-191] frosted open button (hover):', JSON.stringify({
      groupBg: hov.groupBg, groupBgAlpha: hov.groupBgAlpha, groupShadow: hov.groupShadow,
      btnBg: hov.btnBg, groupW: hov.groupW, btnW: hov.btnW,
    }));
    await win.screenshot({
      path: path.join(SHOTS, 'def-191-retest-hover.png'),
      clip: { x: 0, y: 44, width: 420, height: 120 },
    });
    expect(hov.groupBgAlpha, 'DEF-191 (hover): capsule still paints nothing on hover').toBe(0);
    expect(hov.groupShadow, 'DEF-191 (hover): capsule casts no shadow on hover').toBe('none');
  });

  // ------------------------------------------------------------------
  // DEF-192: opening the Tools panel pushes the page view in EVERY theme.
  // Primary screenshot: dark (checklist order), then light, then frosted.
  // ------------------------------------------------------------------
  test('DEF-192: dynamic page view in dark, light, frosted', async () => {
    test.setTimeout(300000);
    await openReport();
    const shotName = { dark: 'def-192-retest.png', light: 'def-192-retest-light.png', frosted: 'def-192-retest-frosted.png' };

    for (const theme of ['dark', 'light', 'frosted']) {
      await setTheme(theme);

      // closed baseline: full width, no inset
      const closed = await measureView();
      console.log(`[DEF-192] ${theme} closed:`, JSON.stringify(closed));
      await win.screenshot({ path: path.join(SHOTS, `def-192-retest-${theme}-closed.png`) });
      expect(closed.toolsOpenAttr, `${theme}: tools start closed`).toBe('false');
      expect(parseFloat(closed.scrollerMarginRight), `${theme}: page starts full width`).toBeLessThan(2);

      // while here: the DEF-191 clean-button contract must hold in this theme too
      const btn = await openButtonMetrics();
      expect(btn.groupBgAlpha, `DEF-191 hold-check (${theme}): capsule paints nothing`).toBe(0);
      expect(btn.groupShadow, `DEF-191 hold-check (${theme}): capsule casts no shadow`).toBe('none');

      await openTools();
      const open = await measureView();
      console.log(`[DEF-192] ${theme} open:`, JSON.stringify(open));
      await win.screenshot({ path: path.join(SHOTS, shotName[theme]) });
      expect(open.toolsOpenAttr, `${theme}: data-tools-open flips on`).toBe('true');
      const margin = parseFloat(open.scrollerMarginRight);
      expect(margin, `${theme}: page pushed beside the open panel (margin ${margin})`).toBeGreaterThan(330);
      expect(open.insetVar, `${theme}: the inherited token reaches the grid (${open.insetVar})`).not.toBe('0px');
      expect(open.scroller.width, `${theme}: scroller width shrank by the panel inset`)
        .toBeLessThan(closed.scroller.width - 300);
      expect(open.palette.left >= open.scroller.right - 2, `${theme}: panel never overlaps the scroller`).toBe(true);
      expect(open.page.right <= open.scroller.right + 2, `${theme}: page reflows inside the narrower scroller`).toBe(true);
      expect(open.palette.left >= open.page.right - 2,
        `${theme}: panel starts at/beside the page's right edge (palette ${open.palette.left} vs page ${open.page.right})`).toBe(true);
      expect(open.page.right, `${theme}: page right edge moved left by the inset`)
        .toBeLessThan(closed.page.right - 250);

      await closeTools();
      const restored = await measureView();
      console.log(`[DEF-192] ${theme} re-closed:`, JSON.stringify(restored));
      expect(parseFloat(restored.scrollerMarginRight), `${theme}: page returns to full width on close`).toBeLessThan(2);
    }
  });

  // ------------------------------------------------------------------
  // DEF-193: panel AND page animate together on the one --panel-slide-duration
  // curve (open + close curves, rAF sampled; frame sequence for the record).
  // ------------------------------------------------------------------
  test('DEF-193: panel and page animate together (open, close, dark)', async () => {
    test.setTimeout(300000);
    await openReport();

    const trans = await win.evaluate(() => {
      const wm = document.querySelector('.workspace-main');
      const t = getComputedStyle(wm).transition;
      return {
        t,
        hasInset: /--tf-tools-inset/.test(t),
        duration: getComputedStyle(wm).getPropertyValue('--panel-slide-duration').trim(),
      };
    });
    console.log('[DEF-193] workspace-main transition:', JSON.stringify(trans));
    expect(trans.hasInset, 'the inset custom property must be transitioned on .workspace-main').toBe(true);
    // The panel/page slide runs on the live --panel-slide-duration token (150ms
    // since the Phase-16 retime; the old 300ms curve is retired), so the curve
    // bounds below are token-driven and cannot rot to a stale literal again.
    const slideMatch = /^([\d.]+)(ms|s)$/.exec((trans.duration || '').trim());
    const slideMs = slideMatch ? parseFloat(slideMatch[1]) * (slideMatch[2] === 's' ? 1000 : 1) : NaN;
    console.log('[DEF-193] --panel-slide-duration:', slideMs, 'ms');
    expect(slideMs, '--panel-slide-duration token must resolve').toBeGreaterThan(0);

    // rAF sampler (same shape as the filing spec's fix5 sampler).
    await win.evaluate(() => {
      window.__qa193 = { samples: [], running: false, t0: 0 };
      window.__qa193_start = () => {
        const s = window.__qa193;
        s.samples = [];
        s.running = true;
        s.t0 = performance.now();
        const tick = () => {
          if (!s.running) return;
          const pal = document.querySelector('[data-tools-palette]');
          const pcs = pal ? getComputedStyle(pal) : null;
          s.samples.push({
            t: Math.round(performance.now() - s.t0),
            marginRight: parseFloat(getComputedStyle(document.querySelector('.document-scroller')).marginRight),
            paletteMounted: !!pal,
            paletteOpacity: pcs ? Number(pcs.opacity) : null,
            paletteTransform: pcs ? pcs.transform : null,
            paletteLeft: pal ? Math.round(pal.getBoundingClientRect().left) : null,
            scrollerRight: Math.round(document.querySelector('.document-scroller').getBoundingClientRect().right),
          });
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      };
      window.__qa193_stop = () => { window.__qa193.running = false; };
    });

    const runCurve = async (label) => {
      await win.evaluate(() => window.__qa193_start());
      await win.click('button[data-tools-toggle]');
      await win.waitForTimeout(700);
      await win.evaluate(() => window.__qa193_stop());
      const samples = await win.evaluate(() => window.__qa193.samples);
      console.log(`[DEF-193] ${label}: ${samples.length} rAF samples`);
      console.log(`[DEF-193] ${label} head:`, JSON.stringify(samples.slice(0, 4)));
      console.log(`[DEF-193] ${label} tail:`, JSON.stringify(samples.slice(-2)));
      return samples;
    };

    // OPEN curve (frosted)
    verifyCurve(await runCurve('OPEN-frosted'), 'OPEN-frosted', slideMs);
    await closeTools();

    // frame sequence for the visual record (open direction, frosted)
    const frameDelays = [0, 60, 120, 180, 240, 300, 420];
    await win.click('button[data-tools-toggle]');
    for (let i = 0; i < frameDelays.length; i += 1) {
      const shotT0 = Date.now();
      await win.screenshot({ path: path.join(SHOTS, `def-193-retest-frame-${String(i).padStart(2, '0')}.png`) });
      const captureCost = Date.now() - shotT0;
      console.log(`[DEF-193] frame ${i} target ${frameDelays[i]}ms (capture took ${captureCost}ms)`);
      if (i + 1 < frameDelays.length) {
        await win.waitForTimeout(Math.max(0, frameDelays[i + 1] - frameDelays[i] - captureCost));
      }
    }
    await closeTools();

    // CLOSE curve (frosted)
    await openTools();
    verifyCloseCurve(await runCurve('CLOSE-frosted'), 'CLOSE-frosted', slideMs);

    // DARK theme: same shared motion system
    await setTheme('dark');
    verifyCurve(await runCurve('OPEN-dark'), 'OPEN-dark', slideMs);
  });

  // ------------------------------------------------------------------
  // DEF-194: command-bar icons render at full 22px.
  // ------------------------------------------------------------------
  test('DEF-194: command bar icons are full 22px, not letterboxed', async () => {
    test.setTimeout(240000);
    await openReport();
    const icons = await win.evaluate(() => {
      const sizeOf = (svg) => {
        const cs = getComputedStyle(svg);
        return {
          w: Math.round(parseFloat(cs.width) * 100) / 100,
          h: Math.round(parseFloat(cs.height) * 100) / 100,
        };
      };
      const detail = (btn) => {
        const svg = btn.querySelector('svg');
        const r = svg.getBoundingClientRect();
        const s = sizeOf(svg);
        return {
          label: btn.getAttribute('aria-label') || btn.title || btn.getAttribute('data-icon') || '',
          attrW: svg.getAttribute('width'),
          rectW: Math.round(r.width * 100) / 100,
          rectH: Math.round(r.height * 100) / 100,
          cssW: s.w, cssH: s.h,
        };
      };
      const cmdBtns = Array.from(document.querySelectorAll('.toolbar .tool-btn'));
      const annBtns = Array.from(document.querySelectorAll('.ann-toolbar .ann-tool-btn'));
      const railBtns = Array.from(document.querySelectorAll('.side-rail button'));
      return {
        dataTheme: document.documentElement.getAttribute('data-theme'),
        cmdIcons: cmdBtns.map(detail),
        annSizes: Array.from(new Set(annBtns.map((b) => {
          const s = sizeOf(b.querySelector('svg'));
          return `${s.w}x${s.h}`;
        }))),
        annCount: annBtns.length,
        cmdBtnHeights: Array.from(new Set(cmdBtns.map((b) => Math.round(b.getBoundingClientRect().height)))),
        cmdBtnPaddings: Array.from(new Set(cmdBtns.map((b) => getComputedStyle(b).padding))),
        capsuleH: (() => {
          const c = document.querySelector('.toolbar .glass-control-group');
          return c ? Math.round(c.getBoundingClientRect().height) : null;
        })(),
        railIconMin: railBtns.length
          ? Math.min(...railBtns.map((b) => {
            const svg = b.querySelector('svg');
            return svg ? parseFloat(getComputedStyle(svg).width) : 999;
          }))
          : null,
      };
    });
    console.log(`[DEF-194] theme=${icons.dataTheme} cmd icons (${icons.cmdIcons.length}):`,
      JSON.stringify(icons.cmdIcons.map((i) => `${i.label}:${i.cssW}x${i.cssH}`)));
    console.log('[DEF-194] ann sizes:', JSON.stringify(icons.annSizes),
      'cmd btn heights:', JSON.stringify(icons.cmdBtnHeights),
      'cmd paddings:', JSON.stringify(icons.cmdBtnPaddings),
      'capsuleH:', icons.capsuleH, 'railIconMin:', icons.railIconMin);

    expect(icons.cmdIcons.length, 'command bar glyphs present').toBeGreaterThanOrEqual(15);
    for (const ic of icons.cmdIcons) {
      expect(ic.cssW, `command icon "${ic.label}" width ${ic.cssW} must be the full 22px band`).toBeGreaterThanOrEqual(20);
      expect(ic.cssW, `command icon "${ic.label}" width ${ic.cssW} must not exceed 22px`).toBeLessThanOrEqual(22);
      expect(ic.cssH, `command icon "${ic.label}" height ${ic.cssH}`).toBeGreaterThanOrEqual(20);
      expect(ic.cssH, `command icon "${ic.label}" height ${ic.cssH}`).toBeLessThanOrEqual(22);
      expect(ic.rectW, `command icon "${ic.label}" rect width ${ic.rectW} must match its css width (no letterbox)`).toBeGreaterThanOrEqual(ic.cssW - 0.5);
    }
    expect(icons.annCount, 'annotation toolbar glyphs present').toBeGreaterThan(0);
    // Phase 19 - the annotation tools are CommandBar tool-btns now, so they use
    // the bar's 22px glyph ladder (the separate 24px row is retired).
    expect(icons.annSizes, `annotation icons must use the CommandBar 22px ladder (got ${icons.annSizes})`).toEqual(['22x22']);
    for (const h of icons.cmdBtnHeights) expect(h, 'command tool hit box').toBeGreaterThanOrEqual(32);
    expect(icons.capsuleH, 'command capsule hit row >= 36px').toBeGreaterThanOrEqual(36);
    expect(icons.railIconMin, 'sidebar icons unaffected (>= 20px)').toBeGreaterThanOrEqual(20);
    await win.screenshot({
      path: path.join(SHOTS, 'def-194-retest.png'),
      clip: { x: 0, y: 0, width: 1100, height: 190 },
    });
  });
});

// OPEN-direction curve verifier (ported from the filing spec): the inset must
// interpolate through MANY distinct intermediate values, be monotonic, settle
// ~356px on the live --panel-slide-duration token, and move in the SAME window
// as the palette.
function verifyCurve(samples, label, slideMs) {
  const withMargin = samples.filter((s) => Number.isFinite(s.marginRight));
  const finalMargin = withMargin[withMargin.length - 1].marginRight;
  const firstMove = withMargin.find((s) => s.marginRight > 4);
  const settled = withMargin.find((s) => s.marginRight > finalMargin - 8);
  expect(finalMargin, `${label}: page inset reaches the panel width + gap`).toBeGreaterThan(330);
  expect(firstMove, `${label}: the page must actually move (intermediate frames exist)`).toBeTruthy();
  const movementMs = settled.t - firstMove.t;
  console.log(`[DEF-193] ${label}: margin ${withMargin[0].marginRight}px -> ${finalMargin}px, movement ${firstMove.t}ms -> ${settled.t}ms (${movementMs}ms)`);
  expect(movementMs, `${label}: slide must run on the --panel-slide-duration token (${slideMs}ms), measured ${movementMs}ms - not a snap`).toBeGreaterThanOrEqual(slideMs * 0.3);
  expect(movementMs, `${label}: slide must not drag past the token window (${slideMs}ms), measured ${movementMs}ms`).toBeLessThanOrEqual(slideMs * 1.6);
  const distinct = new Set(withMargin.filter((s) => s.t <= settled.t).map((s) => Math.round(s.marginRight)));
  console.log(`[DEF-193] ${label}: ${distinct.size} distinct intermediate margin values`);
  expect(distinct.size, `${label}: smooth interpolation needs many intermediate values`).toBeGreaterThanOrEqual(5);
  let last = -1;
  for (const s of withMargin.filter((x) => x.t <= settled.t)) {
    expect(s.marginRight >= last - 0.5, `${label}: margin must move monotonically (no jumps)`).toBe(true);
    last = s.marginRight;
  }
  const paletteSamples = samples.filter((s) => s.paletteMounted);
  expect(paletteSamples.length, `${label}: palette mounted while sampled`).toBeGreaterThan(0);
  const lastPalette = paletteSamples[paletteSamples.length - 1];
  const palEndOpacity = lastPalette.paletteOpacity;
  console.log(`[DEF-193] ${label}: palette first t=${paletteSamples[0].t}ms opacity=${paletteSamples[0].paletteOpacity}, settled t=${lastPalette.t}ms opacity=${palEndOpacity}`);
  const together = samples.filter((s) =>
    s.paletteMounted && s.paletteOpacity !== null &&
    s.marginRight > 10 && s.marginRight < finalMargin - 20 &&
    (s.paletteOpacity < palEndOpacity - 0.05 || (s.paletteTransform && s.paletteTransform !== 'none')));
  console.log(`[DEF-193] ${label}: ${together.length} samples show panel AND page moving in the same frame window`);
  expect(together.length > 0, `${label}: panel AND page must animate TOGETHER (overlapping motion windows)`).toBe(true);
  // TRUE settle times: the palette's own tween ends at the first frame whose
  // opacity is settled (~1.0), NOT at the sampler window end (the last sample
  // is just where sampling stopped). Compare like with like.
  const paletteSettled = paletteSamples.find((s) => s.paletteOpacity !== null && s.paletteOpacity >= 0.99);
  console.log(`[DEF-193] ${label}: settle order palette=${paletteSettled ? paletteSettled.t : '?'}ms margin=${settled.t}ms`);
  expect(paletteSettled, `${label}: palette opacity settles inside the sampling window`).toBeTruthy();
  expect(Math.abs(settled.t - paletteSettled.t) <= 150, `${label}: page and panel settle together, not sequentially (page ${settled.t}ms vs panel ${paletteSettled.t}ms)`).toBe(true);
}

// CLOSE-direction curve verifier (margin 356 -> 0) on the live token.
function verifyCloseCurve(samples, label, slideMs) {
  const withMargin = samples.filter((s) => Number.isFinite(s.marginRight));
  const startMargin = withMargin[0].marginRight;
  const finalMargin = withMargin[withMargin.length - 1].marginRight;
  const firstMove = withMargin.find((s) => s.marginRight < startMargin - 4);
  const settled = withMargin.find((s) => s.marginRight < 8);
  expect(startMargin, `${label}: close starts from the open inset`).toBeGreaterThan(330);
  expect(firstMove, `${label}: the page must move on close`).toBeTruthy();
  expect(settled, `${label}: the page returns to full width`).toBeTruthy();
  const movementMs = settled.t - firstMove.t;
  console.log(`[DEF-193] ${label}: margin ${startMargin}px -> ${finalMargin}px, movement ${firstMove.t}ms -> ${settled.t}ms (${movementMs}ms)`);
  expect(movementMs, `${label}: close slide must run on the --panel-slide-duration token (${slideMs}ms), measured ${movementMs}ms`).toBeGreaterThanOrEqual(slideMs * 0.3);
  expect(movementMs, `${label}: close slide must not drag past the token window (${slideMs}ms), measured ${movementMs}ms`).toBeLessThanOrEqual(slideMs * 1.6);
  const distinct = new Set(withMargin.filter((s) => s.t <= settled.t).map((s) => Math.round(s.marginRight)));
  expect(distinct.size, `${label}: close must interpolate smoothly`).toBeGreaterThanOrEqual(5);
  const paletteSamples = samples.filter((s) => s.paletteMounted);
  expect(paletteSamples.length, `${label}: palette visible during close sampling`).toBeGreaterThan(0);
  const together = samples.filter((s) =>
    s.paletteMounted && s.marginRight > 10 && s.marginRight < startMargin - 20);
  console.log(`[DEF-193] ${label}: ${together.length} samples show panel AND page moving together`);
  expect(together.length > 0, `${label}: panel AND page must animate TOGETHER on close`).toBe(true);
}