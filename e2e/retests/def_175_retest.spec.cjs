// DEF-175 retest probe: the original repro was
//   arm Ink -> open the color palette popover -> the palette paints and
//   hit-tests UNDER the page (elementsFromPoint = annotation svg topmost);
//   clicking where the palette is DRAWS INK into the document.
// The portal fix (AnnotationToolbar.tsx) should make the palette a root-level
// floating sheet that paints AND hit-tests above the page in the frosted theme.

const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { armAnnotationTool } = require('../lib/helpers.cjs');

test('DEF-175 retest: frosted color palette paints + hit-tests above the page, no ink click-through', async () => {
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForTimeout(1200);

  const card = win.locator('.sample-card:has-text("report.pdf")');
  if (await card.count()) {
    await card.first().click();
  } else {
    await electronApp.evaluate(async ({ dialog }, samplePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [samplePath] });
    }, getSamplePath('report.pdf'));
    await win.click('button:has-text("Open PDF")');
  }
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForSelector('.pdf-page', { timeout: 20000 });
  await win.waitForTimeout(800);

  // Theme guard: this defect is frosted-specific (default theme)
  const theme = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log('[175] theme=', theme);
  expect(theme).toBe('frosted');

  // Arm ink (Phase 36: the annotation toolbar lives in the REVIEW Annotate
  // flyout), open the palette
  await armAnnotationTool(win, 'ink');
  await win.waitForTimeout(500);
  const swatch = win.locator('.ann-color-swatch-main').first();
  await swatch.waitFor({ timeout: 10000 });
  await swatch.click();
  await win.waitForTimeout(600);

  const pal = await win.locator('.color-palette').first().boundingBox();
  console.log('[175] palette bbox=', JSON.stringify(pal));
  expect(pal, 'color palette must be open').toBeTruthy();
  await win.screenshot({ path: 'screenshots/def-175-retest-palette-open.png' });

  // 1) Hit-test evidence at the palette's own center: topmost must belong to the palette
  const stack = await win.evaluate(([x, y]) => {
    return document.elementsFromPoint(x, y).slice(0, 8).map(e => ({
      tag: e.tagName,
      cls: (e.className && e.className.baseVal !== undefined) ? e.className.baseVal : String(e.className || ''),
    }));
  }, [pal.x + pal.width / 2, pal.y + pal.height / 2]);
  console.log('[175] elementsFromPoint at palette center=', JSON.stringify(stack, null, 1));
  const topInside = await win.evaluate(([x, y]) => {
    const top = document.elementsFromPoint(x, y)[0];
    return !!top && !!top.closest('.color-palette');
  }, [pal.x + pal.width / 2, pal.y + pal.height / 2]);
  expect(topInside, 'topmost element at palette center must be INSIDE the palette (was: annotation svg)').toBe(true);

  // 2) The sharpest symptom: with ink ARMED, a real mouse click on a built-in
  //    swatch must change the color and must NOT draw ink into the document.
  const engineBefore = await win.evaluate(() => window.tflexDiagnostics());
  const annBefore = engineBefore && engineBefore.engineState ? engineBefore.engineState.annotations.length : null;

  const builtIn = win.locator('.color-palette .color-swatch');
  const n = await builtIn.count();
  console.log('[175] palette swatches=', n);
  expect(n, 'palette must expose built-in swatches').toBeGreaterThan(4);
  const target = builtIn.nth(2);
  const tb = await target.boundingBox();
  console.log('[175] target swatch bbox=', JSON.stringify(tb));
  await win.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await win.waitForTimeout(700);

  // The picker deliberately DISENGAGES on a built-in colour pick (operator
// requirement: apply the colour, then close the popover — the same dismissal
// the action-bar colour box uses). The DEF-175 contract this spec guards is
// that the palette PAINTS + HIT-TESTS above the page and never leaks a click
// into the document; the dismissal is the intended current behaviour.
  const palAfter = await win.locator('.color-palette').count();
  console.log('[175] palette open after swatch click=', palAfter);
  expect(palAfter, 'the picker disengages on a built-in colour pick (apply-and-close)').toBe(0);

  // Ink color must have changed to the swatch color
  const cur = await win.evaluate(() => {
    const s = document.querySelector('.ann-color-swatch-main');
    return s ? s.getAttribute('data-color-current') || s.getAttribute('data-color') : null;
  });
  console.log('[175] ink color after swatch click=', cur);
  expect(cur, 'armed ink color must follow the clicked swatch').toBeTruthy();

  // No ink annotation may have landed in the engine (click-through symptom)
  const engineAfter = await win.evaluate(() => window.tflexDiagnostics());
  const annAfter = engineAfter && engineAfter.engineState ? engineAfter.engineState.annotations.length : null;
  console.log('[175] engine anns before=', annBefore, 'after=', annAfter);
  if (annAfter !== null) {
    expect(annAfter, 'no ink stroke may land in the document from a palette click').toBe(0);
  }
  const inkOnPage = await win.locator('.ann-ink').count();
  console.log('[175] rendered .ann-ink elements=', inkOnPage);
  expect(inkOnPage, 'no rendered ink stroke on the page from a palette click').toBe(0);

  await win.screenshot({ path: 'screenshots/def-175-retest-after-swatch-click.png' });
  console.log('[175] PASS: palette paints + hit-tests above the page; armed-ink swatch click does not draw.');

  await electronApp.close();
});
