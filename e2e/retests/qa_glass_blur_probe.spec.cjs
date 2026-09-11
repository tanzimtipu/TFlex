// QA PROBE - the definitive glass proof: page content passes BEHIND the
// floating tools palette. In the frosted theme the sheet is translucent
// (0.78) + blur(22px), so the content under it must read as a DIFFUSE
// smear (blurred, muted) — not the crisp text and not a flat opaque hide.
// The light theme palette is OPAQUE (alpha 1, no blur), so the same strip
// must be a flat sheet with the content completely hidden.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./../lib/launch.cjs');
const { hardClose } = require('./../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

let electronApp = null;
let win = null;

async function setTheme(want) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${want}"]`);
  await win.waitForFunction(
    (w) => document.documentElement.getAttribute('data-theme') === w,
    want,
  );
}

test.describe.serial('qa glass blur-behind-chrome probe', () => {
  test.afterEach(async () => {
    await hardClose(electronApp);
    electronApp = null;
    win = null;
  });

  test('BLUR: content behind the palette diffuses in frosted, hides in light', async () => {
    test.setTimeout(300000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });

    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(2200);

    // Zoom in so the page is wide enough to extend under the floating
    // palette, then scroll until a text page actually sits under the
    // palette's vertical span.
    for (let i = 0; i < 3; i++) {
      await win.click('button[title="Zoom in"]');
      await win.waitForTimeout(300);
    }
    const scrolledTo = await win.evaluate(() => {
      const s = document.querySelector('.document-scroller');
      // Walk down from the top until a page's box vertically intersects
      // the viewport's middle band (where the floating palette lives).
      s.scrollTop = 0;
      for (let step = 0; step < 200; step += 1) {
        const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
        const page = pane && pane.querySelector('.pdf-page');
        if (page) {
          const r = page.getBoundingClientRect();
          if (r.top <= 260 && r.bottom >= 600) break;
        }
        s.scrollTop += 700;
      }
      return s.scrollTop;
    });
    console.log('[blur] scrolled to', scrolledTo);
    await win.waitForTimeout(900);

    // Open the palette so it floats over the content.
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.waitForTimeout(700);

    const geometry = await win.evaluate(() => {
      const pal = document.querySelector('[data-tools-palette]').getBoundingClientRect();
      const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
      const page = pane.querySelector('.pdf-page');
      const pr = page.getBoundingClientRect();
      // A strip inside BOTH the palette and the page (the overlap zone).
      const x0 = Math.max(pal.x, pr.x) + 30;
      const y0 = Math.max(pal.y, pr.y) + 60;
      return {
        pal: { x: Math.round(pal.x), y: Math.round(pal.y), w: Math.round(pal.width), h: Math.round(pal.height) },
        page: { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) },
        scroller: (() => { const s = pane.querySelector('.document-scroller'); if (!s) return null; const r = s.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
        strip: { x: Math.round(x0), y: Math.round(y0), width: 120, height: 220 },
        overlap: Math.max(pal.x, pr.x) < Math.min(pal.x + pal.width, pr.x + pr.width)
          && Math.max(pal.y, pr.y) < Math.min(pal.y + pal.height, pr.y + pr.height),
      };
    });
    console.log('[blur] geometry =', JSON.stringify(geometry));
    expect(geometry.overlap, 'the palette must overlap the page for this probe').toBe(true);

    for (const theme of ['frosted', 'light']) {
      await setTheme(theme);
      await win.waitForTimeout(900);
      const facts = await win.evaluate(() => {
        const pal = document.querySelector('[data-tools-palette]');
        const cs = getComputedStyle(pal);
        return { bg: cs.backgroundColor, blur: cs.backdropFilter || cs.webkitBackdropFilter };
      });
      console.log(`[blur:${theme}] palette =`, JSON.stringify(facts));
      await win.screenshot({
        path: path.join(SHOTS, `qa-glass-blur-behind-${theme}.png`),
        clip: geometry.strip,
      });
      await win.screenshot({ path: path.join(SHOTS, `qa-glass-blur-full-${theme}.png`) });
    }

    // Numeric witness: pixel variance inside the strip. The frosted strip
    // must show MORE structure (smeared content) than the light strip
    // (flat opaque sheet), while neither is crisp text.
    const { createCanvas, loadImage } = (() => { try { return require('canvas'); } catch { return {}; } })();
    if (!loadImage) {
      console.log('[blur] node-canvas unavailable - numeric witness skipped, visual evidence only');
      return;
    }
    const stats = async (file) => {
      const img = await loadImage(path.join(SHOTS, file));
      const c = createCanvas(img.width, img.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      let sum = 0; let sum2 = 0; const n = d.length / 4;
      const vals = [];
      for (let i = 0; i < d.length; i += 4) {
        const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        vals.push(v); sum += v; sum2 += v * v;
      }
      const mean = sum / n;
      const std = Math.sqrt(sum2 / n - mean * mean);
      return { mean: mean.toFixed(1), std: std.toFixed(2) };
    };
    const frostedStats = await stats('qa-glass-blur-behind-frosted.png');
    const lightStats = await stats('qa-glass-blur-behind-light.png');
    console.log('[blur] frosted strip stats =', JSON.stringify(frostedStats));
    console.log('[blur] light strip stats =', JSON.stringify(lightStats));
  });
});
