// ADV phase-33: minimal, reproducible print-dialog resize probe.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose, openSamplePath } = require('../../e2e/lib/helpers.cjs');
const { REPORT } = require('../../e2e/lib/p33_common.cjs');
const P = require('../../e2e/lib/p33_print.cjs');

const SHOTS = 'C:/Users/tanzi/OneDrive/App Development/TFlex/screenshots';
const OUT = path.join(os.tmpdir(), 'adv-p33');
const note = (s) => console.log(`[adv-resize] ${s}`);
const findings = [];

async function setSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.unmaximize();
    win.setSize(size.w, size.h);
  }, { w, h });
}
async function shell(win) {
  return win.evaluate(() => {
    const dlg = document.querySelector('.print-dialog');
    const b = dlg.getBoundingClientRect();
    const footer = document.querySelector('.print-dialog .modal-footer');
    const fb = footer ? footer.getBoundingClientRect() : null;
    const confirm = document.querySelector('[data-print-confirm]');
    const cb = confirm ? confirm.getBoundingClientRect() : null;
    return {
      vw: innerWidth, vh: innerHeight,
      rect: { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) },
      footer: fb ? { left: Math.round(fb.left), top: Math.round(fb.top), right: Math.round(fb.right), bottom: Math.round(fb.bottom) } : null,
      confirm: cb ? { left: Math.round(cb.left), top: Math.round(cb.top), right: Math.round(cb.right), bottom: Math.round(cb.bottom) } : null,
      offRight: Math.round(b.right - innerWidth),
      offBottom: Math.round(b.bottom - innerHeight),
    };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, REPORT);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(500);

    for (const [w, h] of [[1440, 900], [1100, 760], [900, 620], [700, 560]]) {
      await P.openDialog(win);
      await win.waitForTimeout(500);
      // move to bottom-right (clamped)
      const hb = await win.locator('[data-print-drag-handle]').boundingBox();
      await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await win.mouse.down();
      await win.mouse.move(hb.x + 6000, hb.y + 6000, { steps: 10 });
      await win.mouse.up();
      await win.waitForTimeout(200);
      const before = await shell(win);
      await setSize(app, w, h);
      await win.waitForTimeout(800);
      const after = await shell(win);
      note(`target ${w}x${h}: beforeMove rect=${JSON.stringify(before.rect)} vp=${before.vw}x${before.vh}; afterResize vp=${after.vw}x${after.vh} rect=${JSON.stringify(after.rect)} footer=${JSON.stringify(after.footer)} offRight=${after.offRight} offBottom=${after.offBottom}`);
      const clipped = after.rect.right > after.vw + 1 || after.rect.bottom > after.vh + 1;
      if (clipped) {
        findings.push(`at ${w}x${h}: dialog outside the viewport after resize (rect=${JSON.stringify(after.rect)} vp=${after.vw}x${after.vh}, offRight=${after.offRight}, offBottom=${after.offBottom})`);
        // Is the Print button clickable?
        let clickable = true;
        try {
          await win.click('[data-print-confirm]', { timeout: 4000, trial: true });
        } catch (e) {
          clickable = false;
        }
        note(`  Print button actionable=${clickable} confirmRect=${JSON.stringify(after.confirm)}`);
        if (!clickable) findings.push(`at ${w}x${h}: the Print button is not actionable after resize (confirmRect=${JSON.stringify(after.confirm)})`);
        await win.screenshot({ path: path.join(SHOTS, `adv-p33-dialog-clipped-${w}x${h}.png`) });
        // recover by dragging the header back into view
        const hb2 = await win.locator('[data-print-drag-handle]').boundingBox();
        if (hb2) {
          await win.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
          await win.mouse.down();
          await win.mouse.move(hb2.x - 800, hb2.y - 400, { steps: 10 });
          await win.mouse.up();
          await win.waitForTimeout(200);
          const recovered = await shell(win);
          note(`  after header drag-back: rect=${JSON.stringify(recovered.rect)} offRight=${recovered.offRight} offBottom=${recovered.offBottom}`);
        }
      }
      await P.closeDialog(win).catch(async () => {
        // footer may be unreachable; close via Escape
        await win.keyboard.press('Escape');
        await win.waitForTimeout(400);
      });
    }
    note(`FINDINGS=${findings.length}`);
    for (const f of findings) note(`  FINDING ${f}`);
    fs.writeFileSync(path.join(OUT, 'resize-result.json'), JSON.stringify(findings, null, 2));
  } catch (e) {
    note(`HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
    fs.writeFileSync(path.join(OUT, 'resize-result.json'), JSON.stringify({ error: String(e) }, null, 2));
  } finally {
    await hardClose(app, 'adv-resize');
  }
  note('DONE');
})().catch((e) => { console.error(e); process.exit(1); });