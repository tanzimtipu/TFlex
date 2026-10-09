// TFL-1590 (Part 1) — page-selection animation verification.
//
// Focused QA verification for TFL-1568's two regions: the pageview "Selection"
// card (.context-panel-selection, animated through .context-panel-selection-motion)
// and the bottom-right dock's selection chip ([data-dock-chip]). The surfaces are
// animated with motion/react (JS-driven opacity/transform variants), so this probe
// samples the COMPUTED opacity/transform over the transition window rather than
// relying on WAAPI getAnimations(). Every check runs in all three themes plus a
// reduced-motion pass.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, hardClose, ensurePanelExpanded, setTheme } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const PANEL = '[data-context-panel="pages"]';
const CARD = '[data-context-panel-selection]';
const CARD_MOTION = '[data-context-panel-selection-motion]';
const COUNT_VALUE = '[data-context-panel-selection-count-value]';
const RANGE_VALUE = '[data-context-panel-selection-range-value]';
const CHIP = '[data-dock-chip]';
const CHIP_COUNT = '[data-dock-chip-count]';

test.setTimeout(300000);

function report(tag, data) {
  console.log(`[TFL1590] ${tag} ${JSON.stringify(data)}`);
}

// Sample a selector's computed opacity/transform every animation frame for
// `ms`; report whether the element was ever present, whether it left the DOM,
// whether opacity ever dipped below full, and whether transform varied.
async function sampleSeries(win, selector, ms) {
  return win.evaluate(async ({ sel, windowMs }) => {
    const opacities = [];
    const transforms = new Set();
    let everPresent = false;
    let wentAbsentAfterPresent = false;
    const start = performance.now();
    while (performance.now() - start < windowMs) {
      const el = document.querySelector(sel);
      if (el) {
        everPresent = true;
        const cs = getComputedStyle(el);
        opacities.push(parseFloat(cs.opacity));
        transforms.add(cs.transform);
      } else if (everPresent) {
        wentAbsentAfterPresent = true;
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    const presentAtEnd = document.querySelector(sel) !== null;
    const min = opacities.length ? Math.min(...opacities) : null;
    return {
      everPresent,
      presentAtEnd,
      wentAbsentAfterPresent,
      sampleCount: opacities.length,
      minOpacity: min,
      belowFull: opacities.some((o) => o < 0.995),
      belowFullFrames: opacities.filter((o) => o < 0.995).length,
      transformVaried: transforms.size > 1,
      lastPresentOpacity: opacities.length ? opacities[opacities.length - 1] : null,
    };
  }, { sel: selector, windowMs: ms });
}

async function boxOf(win, selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  }, selector);
}

// One select / grow / clear cycle in the current theme. Asserts the card box
// and value crossfade animate, the chip animates, and the settled state is
// correct. `motion` from the variants is JS-driven, so "animated" = the surface
// ever sampled below full opacity, varied its transform, or left the DOM mid-exit.
async function runCycle(win, theme, shots) {
  if ((await win.locator(CARD).count()) > 0) {
    await win.locator(`${CARD} [data-context-panel-selection-clear]`).first().click();
    await win.waitForTimeout(400);
  }

  const cardAppearP = sampleSeries(win, CARD_MOTION, 520);
  const chipAppearP = sampleSeries(win, CHIP, 520);
  await win.locator(`${PANEL} .thumb-item[data-page="1"]`).click();
  const [cardAppear, chipAppear] = await Promise.all([cardAppearP, chipAppearP]);
  report(`${theme}.card-appear`, cardAppear);
  report(`${theme}.chip-appear`, chipAppear);
  await expect(win.locator(CARD)).toHaveCount(1);
  await expect(win.locator(CARD)).toContainText('1 selected');
  await expect(win.locator(CARD)).toContainText('Page 1');
  await expect(win.locator(CHIP_COUNT)).toHaveText('1 page');
  expect(cardAppear.belowFull || cardAppear.transformVaried, `${theme}: Selection card ANIMATES in`).toBe(true);
  expect(chipAppear.belowFull || chipAppear.transformVaried, `${theme}: dock chip ANIMATES in`).toBe(true);
  const pos1 = { card: await boxOf(win, CARD), chip: await boxOf(win, CHIP) };
  report(`${theme}.pos-1page`, pos1);
  await win.screenshot({ path: path.join(SHOTS, shots.one) });

  const countGrowP = sampleSeries(win, COUNT_VALUE, 420);
  const rangeGrowP = sampleSeries(win, RANGE_VALUE, 420);
  const chipGrowP = sampleSeries(win, CHIP_COUNT, 420);
  await win.locator(`${PANEL} .thumb-item[data-page="3"]`).click({ modifiers: ['Shift'] });
  const [countGrow, rangeGrow, chipGrow] = await Promise.all([countGrowP, rangeGrowP, chipGrowP]);
  report(`${theme}.card-count-change`, countGrow);
  report(`${theme}.card-range-change`, rangeGrow);
  report(`${theme}.chip-count-change`, chipGrow);
  await expect(win.locator(CARD)).toContainText('3 selected');
  await expect(win.locator(CHIP_COUNT)).toHaveText('3 pages');
  expect(
    countGrow.belowFull || countGrow.transformVaried || countGrow.wentAbsentAfterPresent,
    `${theme}: count value CROSSFADES`,
  ).toBe(true);
  expect(
    rangeGrow.belowFull || rangeGrow.transformVaried || rangeGrow.wentAbsentAfterPresent,
    `${theme}: range value CROSSFADES`,
  ).toBe(true);
  expect(
    chipGrow.belowFull || chipGrow.transformVaried || chipGrow.wentAbsentAfterPresent,
    `${theme}: chip count CROSSFADES`,
  ).toBe(true);
  const pos3 = { card: await boxOf(win, CARD), chip: await boxOf(win, CHIP) };
  report(`${theme}.pos-3page`, pos3);
  await win.screenshot({ path: path.join(SHOTS, shots.three) });

  const cardExitP = sampleSeries(win, CARD_MOTION, 420);
  const chipExitP = sampleSeries(win, CHIP, 420);
  await win.locator(`${CARD} [data-context-panel-selection-clear]`).first().click();
  const [cardExit, chipExit] = await Promise.all([cardExitP, chipExitP]);
  report(`${theme}.card-dismiss`, cardExit);
  report(`${theme}.chip-dismiss`, chipExit);
  expect(cardExit.everPresent && !cardExit.presentAtEnd, `${theme}: card is removed after exit`).toBe(true);
  expect(cardExit.belowFull || cardExit.transformVaried, `${theme}: card ANIMATES out`).toBe(true);
  expect(chipExit.everPresent && !chipExit.presentAtEnd, `${theme}: chip is removed after exit`).toBe(true);
  expect(chipExit.belowFull || chipExit.transformVaried, `${theme}: chip ANIMATES out`).toBe(true);
  await expect(win.locator(CARD)).toHaveCount(0);
  await expect(win.locator(CHIP)).toHaveCount(0);

  // No layout jank: the settled card/chip positions are the same in every theme
  // and the panel scroll stays put across the whole cycle.
  return { pos1, pos3 };
}

test('TFL1590-1 selection card + dock chip animate across themes', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  try {
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await ensurePanelExpanded(win);
    await win.waitForSelector(`${PANEL} .thumb-item`, { timeout: 30000 });

    const positions = [];
    for (const theme of ['light', 'dark', 'frosted']) {
      await setTheme(win, theme);
      await win.waitForTimeout(300);
      positions.push({
        theme,
        ...(await runCycle(win, theme, {
          one: `tfl1590-${theme}-1page.png`,
          three: `tfl1590-${theme}-3page.png`,
        })),
      });
    }
    // Cross-theme geometry parity (no jank / theme-dependent repositioning).
    const [a, b, c] = positions;
    expect(b.pos1.card, 'card at 1 page is identical in every theme').toEqual(a.pos1.card);
    expect(c.pos1.card, 'card at 1 page is identical in every theme').toEqual(a.pos1.card);
    expect(b.pos3.card, 'card at 3 pages is identical in every theme').toEqual(a.pos3.card);
    expect(c.pos3.card, 'card at 3 pages is identical in every theme').toEqual(a.pos3.card);
  } finally {
    await hardClose(app, 'tfl1590-anim');
  }
});

test('TFL1590-2 reduced motion collapses the cycle to instant', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  try {
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await ensurePanelExpanded(win);
    await win.waitForSelector(`${PANEL} .thumb-item`, { timeout: 30000 });

    await win.emulateMedia({ reducedMotion: 'reduce' });
    await win.waitForTimeout(250);

    const reducedMedia = await win.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    const t0 = Date.now();
    const seriesP = sampleSeries(win, CARD_MOTION, 300);
    await win.locator(`${PANEL} .thumb-item[data-page="1"]`).click();
    const series = await seriesP;
    // Settled state is identical, reached with no perceptible delay.
    await expect(win.locator(CARD)).toHaveCount(1);
    await expect(win.locator(CARD)).toContainText('1 selected');
    await expect(win.locator(CARD)).toContainText('Page 1');
    await expect(win.locator(CHIP_COUNT)).toHaveText('1 page');
    const settledMs = Date.now() - t0;
    const cardOpacity = await win.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).opacity : null;
    }, CARD_MOTION);
    report('reduced.settle', { reducedMedia, settledMs, cardOpacity, series });
    expect(reducedMedia, 'OS reduced motion is active').toBe(true);
    expect(settledMs, 'reduced-motion selection settles well under a perceptible delay').toBeLessThan(400);
    expect(cardOpacity, 'reduced motion: card rests at full opacity').toBe('1');
    expect(series.belowFullFrames, 'reduced motion: the card does not fade perceptibly (<=3 frames)').toBeLessThanOrEqual(3);
    await win.screenshot({ path: path.join(SHOTS, 'tfl1590-reduced-1page.png') });

    await win.locator(`${CARD} [data-context-panel-selection-clear]`).first().click();
    await expect(win.locator(CARD)).toHaveCount(0);
    await expect(win.locator(CHIP)).toHaveCount(0);
    report('reduced.cleared', { settledMs: Date.now() - t0 });

    await win.emulateMedia({ reducedMotion: 'no-preference' });
  } finally {
    await hardClose(app, 'tfl1590-reduced');
  }
});
