// ADV phase-33: isolate rapid shared-toolbar arm/disarm vs actual armed tool,
// plus a real gutter-pixel sample (zoomed out so gutters exist).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PNG } = require('pngjs');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const SHOTS = 'C:/Users/tanzi/OneDrive/App Development/TFlex/screenshots';
const OUT = path.join(os.tmpdir(), 'adv-p33');
const findings = [];
const note = (s) => console.log(`[adv-fanout] ${s}`);
const shotPath = (n) => path.join(SHOTS, `adv-p33-${n}.png`);

async function state(win) {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics();
    const btn = document.querySelector('[data-ann-tools-visible] button[data-tool="ink"]');
    return {
      activeTool: d.activeTool ?? null,
      pressed: btn ? btn.getAttribute('aria-pressed') === 'true' : null,
    };
  });
}
async function clickInk(win) {
  await win.locator('[data-ann-tools-visible] button[data-tool="ink"]').first().click();
  await win.waitForTimeout(200);
}
async function anns(win) {
  return win.evaluate(() => (window.tflexDiagnostics().engineState || {}).annotations?.length ?? 0);
}
async function draw(win, pane) {
  const page = win.locator(`.tab-pane[data-pane="${pane}"] .pdf-page`).first();
  await page.scrollIntoViewIfNeeded().catch(() => {});
  const box = await page.boundingBox();
  const vp = await win.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const x = Math.max(30, Math.min(box.x + box.width * 0.32, vp.w - 220));
  const y = Math.max(120, Math.min(box.y + box.height * 0.3, vp.h - 160));
  await win.mouse.move(x, y); await win.mouse.down();
  await win.mouse.move(x + 110, y + 60, { steps: 8 }); await win.mouse.up();
  await win.waitForTimeout(700);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await C.twoPaneSetup(app, win);
    await C.focusPaneByPage(win, 'A');

    // ---- baseline: arm -> draw -> 1 ----
    let s = await state(win);
    note(`baseline state=${JSON.stringify(s)}`);
    if (!s.pressed) { await clickInk(win); }
    s = await state(win);
    note(`after first arm: ${JSON.stringify(s)}`);
    await draw(win, 'A');
    note(`baseline anns=${await anns(win)}`);

    // slim down: disarm
    s = await state(win);
    if (s.pressed) { await clickInk(win); }

    // ---- rapid oracle: 12 clicks with tiny waits, ending disarmed ----
    for (let i = 0; i < 12; i += 1) {
      await win.locator('[data-ann-tools-visible] button[data-tool="ink"]').first().click();
      await win.waitForTimeout(25);
    }
    await win.waitForTimeout(400);
    s = await state(win);
    note(`after 12 rapid clicks: ${JSON.stringify(s)}`);

    // Arm deliberately (generous wait), read actual armed tool, then draw.
    if (!s.pressed) { await clickInk(win); }
    await win.waitForTimeout(500);
    s = await state(win);
    note(`after deliberate arm: ${JSON.stringify(s)}`);
    const before = await anns(win);
    await draw(win, 'A');
    const after = await anns(win);
    note(`draw after rapid+arm: anns ${before} -> ${after}`);
    if (s.pressed === true && s.activeTool === 'ink' && after !== before + 1) {
      findings.push(`rapid toggling left the shared ink control showing armed (pressed=${s.pressed}, activeTool=${s.activeTool}) but a subsequent draw added ${after - before} annotations (expected 1)`);
    }
    if (s.pressed === true && s.activeTool !== 'ink') {
      findings.push(`shared bar shows ink armed (pressed=true) but the actual armed tool is ${JSON.stringify(s.activeTool)}`);
    }
    if (s.pressed === false && s.activeTool === 'ink') {
      findings.push(`shared bar shows ink DISARMED (pressed=false) but the actual armed tool is 'ink'`);
    }

    // ---- arm in shared bar while the OTHER pane has a raster in flight ----
    // (raster = preview/zoom churn in B). Zoom B hard, then arm and draw in A.
    const pageB = win.locator('.tab-pane[data-pane="B"] .pdf-page').first();
    await pageB.scrollIntoViewIfNeeded().catch(() => {});
    const bb = await pageB.boundingBox();
    if (bb) {
      const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
      await win.mouse.move(cx, cy);
      for (let i = 0; i < 6; i += 1) { await win.mouse.wheel(0, -600); await win.waitForTimeout(40); }
    }
    await C.focusPaneByPage(win, 'A');
    s = await state(win);
    if (!s.pressed) { await clickInk(win); }
    await draw(win, 'A');
    const afterChurn = await anns(win);
    note(`draw in A while B churned: ${afterChurn}`);
    if (afterChurn !== after + 1) findings.push(`arming during raster churn in the other pane lost a placement: ${after} -> ${afterChurn} (expected +1)`);

    // ---- real gutter pixel sample (zoom out so page gutters exist) ----
    // ensure A focused, zoom out a lot
    await C.focusPaneByPage(win, 'A');
    for (let i = 0; i < 10; i += 1) {
      await win.keyboard.press('Control+Minus').catch(() => {});
      await win.waitForTimeout(120);
    }
    await win.waitForTimeout(700);
    for (const theme of ['light', 'dark', 'frosted']) {
      await C.switchTheme(win, theme);
      await win.waitForTimeout(500);
      const info = await win.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const sc = document.querySelector('.tab-pane[data-pane="A"] .document-scroller');
        const b = sc.getBoundingClientRect();
        const pg = sc.querySelector('.pdf-page');
        const pb = pg ? pg.getBoundingClientRect() : null;
        return {
          theme: document.documentElement.getAttribute('data-theme'),
          token: root.getPropertyValue('--tf-canvas-opaque').trim(),
          scrollerBg: getComputedStyle(sc).backgroundColor,
          rect: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
          pageRect: pb ? { left: pb.left, top: pb.top, right: pb.right, bottom: pb.bottom } : null,
        };
      });
      const buf = await win.screenshot({ path: shotPath(`gutter-${theme}`) });
      const png = PNG.sync.read(buf);
      // sample to the LEFT of the page (a real gutter), vertically centred
      let sx = null, sy = null;
      if (info.pageRect && info.pageRect.left > info.rect.left + 12) {
        sx = Math.round((info.rect.left + info.pageRect.left) / 2);
        sy = Math.round((info.rect.top + info.rect.bottom) / 2);
      } else {
        // no left gutter; sample just above the page (top gutter)
        sx = Math.round((info.rect.left + info.rect.right) / 2);
        sy = Math.round((info.rect.top + (info.pageRect ? info.pageRect.top : info.rect.top + 20)) / 2);
      }
      const idx = (png.width * sy + sx) << 2;
      const px = { x: sx, y: sy, r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2], a: png.data[idx + 3] };
      note(`gutter ${theme}: token=${info.token} scrollerBg=${info.scrollerBg} sample=${JSON.stringify(px)} pageRect=${JSON.stringify(info.pageRect)}`);
      if (px.a < 255) findings.push(`theme ${theme}: gutter pixel alpha ${px.a} < 255 at ${JSON.stringify(px)}`);
    }

    note(`FINDINGS=${findings.length}`);
    for (const f of findings) note(`  FINDING ${f}`);
    fs.writeFileSync(path.join(OUT, 'fanout-result.json'), JSON.stringify(findings, null, 2));
  } catch (e) {
    note(`HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
    fs.writeFileSync(path.join(OUT, 'fanout-result.json'), JSON.stringify({ error: String(e) }, null, 2));
  } finally {
    await hardClose(app, 'adv-fanout');
  }
  note('DONE');
})().catch((e) => { console.error(e); process.exit(1); });