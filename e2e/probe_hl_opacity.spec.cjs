// PROBE: committed highlight opacity - after a highlight drag + disarm,
// dump the annotation record and screenshot the page. If the orange block
// persists with the tool disarmed, the COMMITTED highlight renders opaque.
const { test } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, scrollToPage, armAnnotationTool } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

test('PROBE: committed highlight renders translucent', async () => {
  test.setTimeout(180000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await win.locator('[data-home-tool="open"]').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(2200);
    await scrollToPage(win, 1);

    // Phase 36 — the annotation toolbar is in the REVIEW Annotate flyout.
    await armAnnotationTool(win, 'highlight');
    await win.waitForTimeout(350);
    const hlSpan = await win.evaluate(() => {
      const spans = Array.from(
        document.querySelectorAll('.tab-pane[aria-hidden="false"] .pdf-page .textLayer span'),
      )
        .map((s) => { const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })
        .filter((r) => r.w > 30 && r.h > 6 && r.y > 120 && r.y < window.innerHeight - 120);
      return spans[0] || null;
    });
    await win.mouse.move(hlSpan.x + 2, hlSpan.y + hlSpan.h / 2);
    await win.mouse.down();
    await win.mouse.move(hlSpan.x + hlSpan.w - 2, hlSpan.y + hlSpan.h / 2 + 2, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(1200);

    const before = await win.evaluate(() => {
      const d = window.tflexDiagnostics();
      return { annCount: (d.engineState.annotations || []).length, ann: (d.engineState.annotations || [])[0] || null };
    });
    console.log(`[hl] while armed: ${JSON.stringify(before)}`);
    await win.screenshot({ path: path.join(SHOTS, 'probe-hl-armed.png') });

    // Disarm the tool (Escape) and re-check: committed annotation must persist
    await win.keyboard.press('Escape');
    await win.waitForTimeout(800);
    const after = await win.evaluate(() => {
      const d = window.tflexDiagnostics();
      const overlay = document.querySelector('.tab-pane[aria-hidden="false"]');
      const hlEls = overlay ? Array.from(overlay.querySelectorAll('.ann-highlight, [class*="highlight"]')) : [];
      const samples = hlEls.slice(0, 4).map((el) => {
        const cs = getComputedStyle(el);
        return { cls: el.className, bg: cs.backgroundColor, opacity: cs.opacity, mixBlend: cs.mixBlendMode };
      });
      return { annCount: (d.engineState.annotations || []).length, activeTool: d.activeTool, samples };
    });
    console.log(`[hl] after disarm: ${JSON.stringify(after, null, 1)}`);
    await win.screenshot({ path: path.join(SHOTS, 'probe-hl-disarmed.png') });
  } finally {
    await hardClose(electronApp);
  }
});
