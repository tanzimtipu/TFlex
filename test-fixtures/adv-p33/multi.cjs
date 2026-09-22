// ADV phase-33: Multi Mode shared-toolbar fan-out, strips, opaque canvas.
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
const note = (s) => console.log(`[adv-multi] ${s}`);
const shotPath = (n) => path.join(SHOTS, `adv-p33-${n}.png`);

async function anns(win, pane) {
  return win.evaluate((p) => {
    const es = window.tflexDiagnostics().engineState || {};
    return { pane: p, tool: window.tflexDiagnostics().activeTool ?? null, anns: (es.annotations || []).map((a) => ({ kind: a.kind, page: a.page })) };
  }, pane);
}
async function inkPressed(win) {
  const btn = win.locator('[data-ann-tools-visible] button[data-tool="ink"]');
  if ((await btn.count()) === 0) return null;
  return (await btn.first().getAttribute('aria-pressed')) === 'true';
}
async function setInk(win, want) {
  const btn = win.locator('[data-ann-tools-visible] button[data-tool="ink"]').first();
  const pressed = (await btn.getAttribute('aria-pressed')) === 'true';
  if (pressed !== want) { await btn.click(); await win.waitForTimeout(250); }
}
async function drawOn(win, pane, dx = 120, dy = 60) {
  const page = win.locator(`.tab-pane[data-pane="${pane}"] .pdf-page`).first();
  await page.scrollIntoViewIfNeeded().catch(() => {});
  const box = await page.boundingBox();
  if (!box) throw new Error(`no page in ${pane}`);
  const vp = await win.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const x = Math.max(30, Math.min(box.x + box.width * 0.32, vp.w - 220));
  const y = Math.max(120, Math.min(box.y + box.height * 0.3, vp.h - 160));
  await win.mouse.move(x, y); await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 8 }); await win.mouse.up();
  await win.waitForTimeout(700);
}
async function paneRects(win) {
  return win.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) };
    };
    return {
      mainA: r('.tab-pane[data-pane="A"] .workspace-main'),
      stripA: r('.tab-pane[data-pane="A"] [data-pane-strip]'),
      stripB: r('.tab-pane[data-pane="B"] [data-pane-strip]'),
      mainB: r('.tab-pane[data-pane="B"] .workspace-main'),
      divider: r('[data-multi-divider]'),
      toolbar: r('[data-shared-toolbar]'),
      headerA: r('.tab-pane[data-pane="A"] [data-pane-header]'),
      headerB: r('.tab-pane[data-pane="B"] [data-pane-header]'),
      vp: { w: innerWidth, h: innerHeight },
    };
  });
}
async function bgStyles(win) {
  return win.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const alpha = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return null;
      const p = m[1].split(',').map((s) => Number.parseFloat(s.trim()));
      return p.length === 4 ? p[3] : 1;
    };
    const sel = (s) => document.querySelector(s);
    const bg = (s) => (sel(s) ? getComputedStyle(sel(s)).backgroundColor : null);
    return {
      token: root.getPropertyValue('--tf-canvas-opaque').trim(),
      theme: document.documentElement.getAttribute('data-theme'),
      paneA: bg('.tab-pane[data-pane="A"]'),
      scrollerA: bg('.tab-pane[data-pane="A"] .document-scroller'),
      mainA: bg('.tab-pane[data-pane="A"] .workspace-main'),
      paneB: bg('.tab-pane[data-pane="B"]'),
      scrollerB: bg('.tab-pane[data-pane="B"] .document-scroller'),
      appBg: getComputedStyle(document.body).backgroundColor,
      alphas: {
        paneA: bg('.tab-pane[data-pane="A"]') ? alpha(bg('.tab-pane[data-pane="A"]')) : null,
        scrollerA: bg('.tab-pane[data-pane="A"] .document-scroller') ? alpha(bg('.tab-pane[data-pane="A"] .document-scroller')) : null,
        paneB: bg('.tab-pane[data-pane="B"]') ? alpha(bg('.tab-pane[data-pane="B"]')) : null,
      },
    };
  });
}
// sample a gutter pixel inside pane A's scroller (left edge + 4px, vertical middle)
async function sampleGutter(win, buf, pane = 'A') {
  const box = await win.evaluate((p) => {
    const el = document.querySelector(`.tab-pane[data-pane="${p}"] .document-scroller`);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  }, pane);
  if (!box) return null;
  const png = PNG.sync.read(buf);
  const x = Math.min(png.width - 1, Math.max(0, Math.round(box.left + 4)));
  const y = Math.min(png.height - 1, Math.max(0, Math.round((box.top + box.bottom) / 2)));
  const idx = (png.width * y + x) << 2;
  return { x, y, r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2], a: png.data[idx + 3] };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const { alphaPath } = await C.twoPaneSetup(app, win);

    // ---------------- one toolbar, no per-pane rows ------------------------
    const counts = await win.evaluate(() => ({
      shared: document.querySelectorAll('[data-shared-toolbar]').length,
      multi: document.querySelectorAll('[data-multi-toolbar]').length,
      toolbars: document.querySelectorAll('.toolbar').length,
      ann: document.querySelectorAll('[data-annotation-toolbar]').length,
      paneToolbars: document.querySelectorAll('.tab-pane[data-pane] .toolbar').length,
    }));
    note(`counts=${JSON.stringify(counts)}`);
    if (counts.shared !== 1 || counts.toolbars !== 1 || counts.ann !== 1 || counts.paneToolbars !== 0) {
      findings.push(`shared toolbar counts wrong: ${JSON.stringify(counts)}`);
    }

    // ---------------- fan-out: exactly one annotation per draw --------------
    await C.focusPaneByPage(win, 'A');
    await setInk(win, true);
    if (!(await inkPressed(win))) findings.push('ink did not arm in the shared bar');
    await drawOn(win, 'A');
    let a = await anns(win, 'A');
    note(`after draw A: A anns=${JSON.stringify(a.anns)}`);
    if (a.anns.length !== 1) findings.push(`double/missing placement in A: expected 1 ink, got ${a.anns.length}`);

    await C.focusPaneByPage(win, 'B');
    const bBefore = await anns(win, 'B');
    if (bBefore.anns.length !== 0) findings.push(`drawing in A leaked into B: B has ${bBefore.anns.length}`);
    await setInk(win, true);
    await drawOn(win, 'B');
    const b = await anns(win, 'B');
    await C.focusPaneByPage(win, 'A');
    const a2 = await anns(win, 'A');
    note(`after draw B: B anns=${JSON.stringify(b.anns)} A still=${JSON.stringify(a2.anns)}`);
    if (b.anns.length !== 1) findings.push(`double/missing placement in B: expected 1 ink, got ${b.anns.length}`);
    if (a2.anns.length !== 1) findings.push(`B draw changed A's annotations: A now ${a2.anns.length}`);

    // ---------------- rapid arm -> click -> arm -> click -------------------
    await setInk(win, false);
    for (let i = 0; i < 10; i += 1) {
      await setInk(win, true);
      await win.waitForTimeout(30);
      await setInk(win, false);
      await win.waitForTimeout(30);
    }
    await setInk(win, true);
    await drawOn(win, 'A');
    const rapidA = await anns(win, 'A');
    note(`after rapid arm/disarm + one draw: A anns=${JSON.stringify(rapidA.anns)}`);
    if (rapidA.anns.length !== 2) findings.push(`rapid arm/disarm lost or doubled a placement: A has ${rapidA.anns.length}, expected 2`);

    // ---------------- disarm from pane-internal path (Escape) --------------
    await setInk(win, false);
    if (!(await inkPressed(win))) {
      await setInk(win, true);
    }
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    const pressedAfterEsc = await inkPressed(win);
    note(`after Escape: ink pressed=${pressedAfterEsc}`);
    const beforeDraw = (await anns(win, 'A')).anns.length;
    await drawOn(win, 'A');
    const afterDraw = (await anns(win, 'A')).anns.length;
    note(`after Escape + draw in A: anns ${beforeDraw} -> ${afterDraw}`);
    if (pressedAfterEsc === true) {
      // Escape did not disarm; drawing should still create one (not a bug per se)
      note('Escape did not disarm the shared tool');
      if (afterDraw !== beforeDraw + 1) findings.push(`with ink still armed, a draw added ${afterDraw - beforeDraw} annotations, expected 1`);
    } else if (afterDraw !== beforeDraw) {
      findings.push(`tool disarmed (Escape) but a draw still added ${afterDraw - beforeDraw} annotation(s)`);
    }

    // ---------------- strips geometry (centred, inner edges) ---------------
    await setInk(win, false);
    await C.focusPaneByPage(win, 'A');
    let g = await paneRects(win);
    note(`strips geometry=${JSON.stringify(g)}`);
    if (g.stripA && g.mainA && g.stripA.left < g.mainA.left) findings.push(`pane A strip is not at A's inner (right) edge: strip.left ${g.stripA.left} < main.left ${g.mainA.left}`);
    if (g.stripB && g.mainB && g.stripB.right > g.mainB.right) findings.push(`pane B strip is not at B's inner (left) edge: strip.right ${g.stripB.right} > main.right ${g.mainB.right}`);
    if (g.stripA && g.stripB) {
      const mid = g.vp.w / 2;
      // strips should flank the divider near the middle
      if (!(g.stripA.left < mid + 260 && g.stripA.left > mid - 700)) findings.push(`pane A strip not near the middle: left ${g.stripA.left} (vp ${g.vp.w})`);
      if (!(g.stripB.left < mid + 700 && g.stripB.left > mid - 260)) findings.push(`pane B strip not near the middle: left ${g.stripB.left} (vp ${g.vp.w})`);
    }
    await win.screenshot({ path: shotPath('strips') });

    // ---------------- opaque canvas across every theme ---------------------
    for (const theme of ['light', 'dark', 'frosted']) {
      await C.switchTheme(win, theme);
      await win.waitForTimeout(500);
      const bg = await bgStyles(win);
      const buf = await win.screenshot({ path: shotPath(`opaque-${theme}`) });
      const px = await sampleGutter(win, buf);
      note(`theme=${theme} token=${bg.token} alphas=${JSON.stringify(bg.alphas)} paneA=${bg.paneA} scrollerA=${bg.scrollerA} appBg=${bg.appBg} gutterPx=${JSON.stringify(px)}`);
      for (const [k, v] of Object.entries(bg.alphas)) {
        if (v !== null && v < 1) findings.push(`theme ${theme}: ${k} background is not opaque (alpha ${v}, computed ${bg[k]})`);
      }
      if (px && px.a < 255) findings.push(`theme ${theme}: sampled gutter pixel alpha ${px.a} < 255`);
      // app background showing through: gutter pixel should NOT equal the app backdrop
      if (px && bg.appBg && bg.appBg !== 'rgba(0, 0, 0, 0)') {
        const m = /rgba?\(([^)]+)\)/.exec(bg.appBg);
        if (m) {
          const p = m[1].split(',').map((s) => Number.parseFloat(s.trim()));
          if (Math.abs(px.r - p[0]) < 3 && Math.abs(px.g - p[1]) < 3 && Math.abs(px.b - p[2]) < 3) {
            findings.push(`theme ${theme}: gutter pixel ${JSON.stringify(px)} matches the app background ${bg.appBg} (see-through)`);
          }
        }
      }
    }
    await C.switchTheme(win, 'light');
    await win.waitForTimeout(400);

    // ---------------- narrow window (640) layout stress --------------------
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const b = w.getBounds();
      w.setBounds({ x: b.x, y: b.y, width: 640, height: 520 });
    });
    await win.waitForTimeout(900);
    g = await paneRects(win);
    note(`narrow(640) geometry=${JSON.stringify(g)}`);
    if (g.toolbar && g.headerA && g.toolbar.bottom > g.headerA.top + 1) findings.push(`at 640px the shared toolbar overlaps pane A header (toolbar.bottom ${g.toolbar.bottom} > header.top ${g.headerA.top})`);
    if (g.toolbar && g.headerB && g.toolbar.bottom > g.headerB.top + 1) findings.push(`at 640px the shared toolbar overlaps pane B header (toolbar.bottom ${g.toolbar.bottom} > header.top ${g.headerB.top})`);
    if (g.stripA && g.stripB) {
      if (g.stripA.right > g.stripB.left + 1) findings.push(`at 640px the two strips overlap (A.right ${g.stripA.right} > B.left ${g.stripB.left})`);
    }
    if (g.mainA && g.stripA && g.stripA.w < 40) findings.push(`at 640px pane A strip collapsed to ${g.stripA.w}px (unusable hit target)`);
    // thumb width inside each strip
    const thumbW = await win.evaluate(() => {
      const t = document.querySelector('.tab-pane[data-pane="A"] [data-pane-strip] .thumb-item') || document.querySelector('.tab-pane[data-pane="A"] [data-pane-strip] .thumb');
      if (!t) return null;
      const b = t.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    });
    note(`narrow thumb target=${JSON.stringify(thumbW)}`);
    if (thumbW && thumbW.w < 20) findings.push(`at 640px the thumbnail hit target is tiny: ${JSON.stringify(thumbW)}`);
    // strip header click focuses its pane
    await win.locator('.tab-pane[data-pane="B"] [data-pane-strip-header]').first().click().catch(() => {});
    await win.waitForTimeout(250);
    const focusB = await win.evaluate(() => document.querySelector('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused'));
    note(`after strip B header click: B focused=${focusB}`);
    if (focusB !== 'true') findings.push('clicking the pane B strip header did not focus pane B');
    // divider drag at narrow width
    const dbox = await win.locator('[data-multi-divider]').boundingBox();
    if (dbox) {
      await win.mouse.move(dbox.x + dbox.width / 2, dbox.y + 40);
      await win.mouse.down();
      await win.mouse.move(30, dbox.y + 40, { steps: 8 });
      await win.mouse.up();
      await win.waitForTimeout(300);
      const afterDrag = await paneRects(win);
      note(`after divider drag left at 640: ${JSON.stringify({ mainA: afterDrag.mainA, stripA: afterDrag.stripA, mainB: afterDrag.mainB })}`);
      if (afterDrag.mainA && afterDrag.mainA.w <= 0) findings.push('divider drag at 640px collapsed pane A to zero width');
      await win.screenshot({ path: shotPath('narrow-640') });
    }
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const b = w.getBounds();
      w.setBounds({ x: b.x, y: b.y, width: 1440, height: 900 });
    });
    await win.waitForTimeout(600);

    // ---------------- single mode unchanged (rail back, one toolbar) -------
    await win.locator('.tab[data-tab-id]').filter({ hasText: 'p33-alpha' }).first().click().catch(() => {});
    await win.waitForTimeout(200);
    // toggle multi off via the shared bar's multi control
    const multiBtn = win.locator('[data-toolbar-multi-mode]').first();
    if ((await multiBtn.count()) > 0) { await multiBtn.click(); await win.waitForTimeout(600); }
    const single = await win.evaluate(() => ({
      shared: document.querySelectorAll('[data-shared-toolbar]').length,
      panes: document.querySelectorAll('[data-pane]').length,
      rail: document.querySelectorAll('[data-rail]').length,
    }));
    note(`single mode after toggle off: ${JSON.stringify(single)}`);
    if (single.shared !== 0 || single.panes !== 0) findings.push(`leaving Multi Mode left shared chrome behind: ${JSON.stringify(single)}`);

    note(`FINDINGS=${findings.length}`);
    for (const f of findings) note(`  FINDING ${f}`);
    fs.writeFileSync(path.join(OUT, 'multi-result.json'), JSON.stringify(findings, null, 2));
  } catch (e) {
    note(`HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
    fs.writeFileSync(path.join(OUT, 'multi-result.json'), JSON.stringify({ error: String(e) }, null, 2));
  } finally {
    await hardClose(app, 'adv-multi');
  }
  note('DONE');
})().catch((e) => { console.error(e); process.exit(1); });