// ADV phase-34: panel inset at uneven splits, the 640px minimum, divider
// tracking. Real dev build via launchApp.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p34');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const findings = [];
function note(s) { const l = `[adv34-geom] ${s}`; console.log(l); lines.push(l); }
function finding(t, sev, d) { findings.push({ title: t, severity: sev, detail: d }); note(`FINDING (${sev}): ${t} :: ${JSON.stringify(d)}`); }

async function geom(win) {
  return win.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
    const am = document.querySelector('.app-main');
    return {
      stage: r('.tab-stage'),
      divider: r('[data-multi-divider]'),
      panel: r('[data-tools-palette]'),
      A: r('.tab-pane[data-pane="A"] .workspace-main'),
      B: r('.tab-pane[data-pane="B"] .workspace-main'),
      scA: r('.tab-pane[data-pane="A"] .document-scroller'),
      scB: r('.tab-pane[data-pane="B"] .document-scroller'),
      hA: r('.tab-pane[data-pane="A"] [data-pane-header]'),
      hB: r('.tab-pane[data-pane="B"] [data-pane-header]'),
      inset: am ? getComputedStyle(am).getPropertyValue('--tf-tools-inset').trim() : null,
      frac: getComputedStyle(document.querySelector('.tab-stage')).getPropertyValue('--tf-split-frac').trim(),
    };
  });
}
async function openPanel(win) {
  await win.locator('[data-tools-badge]').first().click();
  await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  await win.waitForTimeout(800);
}
async function closePanel(win) {
  await win.locator('.tools-palette-close').first().click();
  await win.waitForSelector('[data-tools-palette]', { state: 'detached', timeout: 10000 });
  await win.waitForTimeout(800);
}
async function dragDividerTo(win, frac) {
  const box = await win.locator('[data-multi-divider]').boundingBox();
  const stage = await win.locator('.tab-stage').boundingBox();
  if (!box || !stage) return false;
  const usable = await win.evaluate(() => {
    const st = document.querySelector('.tab-stage');
    const am = document.querySelector('.app-main');
    const inset = parseFloat(getComputedStyle(am).getPropertyValue('--tf-tools-inset')) || 0;
    return st.getBoundingClientRect().width - inset;
  });
  const targetX = stage.x + usable * frac;
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(targetX, box.y + box.height / 2, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  return true;
}
async function setup(app, win, tag) {
  const alpha = C.tmpCopy(C.REPORT, `adv34-${tag}-alpha.pdf`);
  const beta = C.tmpCopy(C.LONG, `adv34-${tag}-beta.pdf`);
  await C.openFile(app, win, alpha); await win.waitForTimeout(700);
  await C.openFile(app, win, beta); await win.waitForTimeout(700);
  await win.locator('.tab[data-tab-id]').filter({ hasText: `adv34-${tag}-alpha` }).first().click();
  await win.waitForTimeout(300);
  await win.locator('[data-toolbar-multi-mode]:visible').first().click();
  await win.waitForTimeout(500);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: `adv34-${tag}-beta` }).first().click();
  await win.waitForTimeout(1600);
}
async function withApp(name, fn) {
  let app = null, win = null;
  try {
    app = await launchApp();
    win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(300);
    note(`=== ${name} ===`);
    await fn(app, win);
  } catch (e) { note(`${name} THREW: ${e.message}`); }
  finally { if (app) await hardClose(app, `p34-${name}`).catch(() => {}); }
}

(async () => {
  // ---- Uneven split: panel shrink deltas ----
  await withApp('B1-uneven', async (app, win) => {
    await setup(app, win, 'b1');
    for (const fracTarget of [0.5, 0.35, 0.65]) {
      await dragDividerTo(win, fracTarget);
      const before = await geom(win);
      await openPanel(win);
      const after = await geom(win);
      const dA = before.A.w - after.A.w;
      const dB = before.B.w - after.B.w;
      note(`frac req=${fracTarget} actual=${after.frac} inset=${after.inset}`);
      note(`  A ${before.A.w}->${after.A.w} (delta ${dA}); B ${before.B.w}->${after.B.w} (delta ${dB}); |dA-dB|=${Math.abs(dA - dB)}`);
      note(`  divider after=${JSON.stringify(after.divider)} A right=${after.A.right} B left=${after.B.left} panel left=${after.panel ? after.panel.left : null}`);
      // divider must sit between the panes
      if (after.A && after.B && after.divider) {
        if (!(after.divider.left >= after.A.right - 2 && after.divider.right <= after.B.left + 2)) {
          finding(`Divider not between the panes at frac ${after.frac}`, 'HIGH', { after });
        }
        // pane B must not run under the panel
        if (after.panel && after.B.right > after.panel.left + 2) {
          finding(`Pane B overlaps the All Tools panel at frac ${after.frac}`, 'HIGH', { after });
        }
      }
      if (Math.abs(dA - dB) > 1) {
        finding(`Panel shrink deltas are UNEQUAL at split ${after.frac}: A lost ${dA}px, B lost ${dB}px`, 'MEDIUM', { frac: after.frac, dA, dB, before, after });
      }
      await closePanel(win);
    }
  });

  // ---- 640px minimum window with the panel open ----
  await withApp('B2-minwidth', async (app, win) => {
    await setup(app, win, 'b2');
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) w.setSize(640, 520); });
    await win.waitForTimeout(1000);
    const before = await geom(win);
    await openPanel(win);
    const after = await geom(win);
    note(`minwidth before=${JSON.stringify(before)}`);
    note(`minwidth after=${JSON.stringify(after)}`);
    const dA = before.A.w - after.A.w, dB = before.B.w - after.B.w;
    note(`minwidth deltas A=${dA} B=${dB}`);
    if (after.A.w < 100 || after.B.w < 100) {
      finding(`At the 640px minimum with the panel open the panes collapse to ${after.A.w}/${after.B.w}px`, 'MEDIUM', { after });
    }
    if (after.panel && after.B.right > after.panel.left + 2) finding('At 640px pane B overlaps the panel', 'HIGH', { after });
    // clear buttons clickable at this width?
    for (const p of ['A', 'B']) {
      const btn = win.locator(`.tab-pane[data-pane="${p}"] [data-pane-clear]`);
      const cnt = await btn.count();
      let clickable = false;
      if (cnt > 0) clickable = await btn.first().click({ trial: true, timeout: 2000 }).then(() => true).catch(() => false);
      note(`minwidth pane ${p} clear button count=${cnt} trialClickable=${clickable}`);
      if (cnt > 0 && !clickable) finding(`Pane ${p} clear button not clickable at 640px with panel open`, 'MEDIUM', { after });
    }
    await win.screenshot({ path: path.join(C.SHOTS, 'adv-p34-minwidth-panel.png') });
    await closePanel(win);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) w.setSize(1280, 860); });
    await win.waitForTimeout(800);
  });

  // ---- Divider tracks the pointer 1:1 (panel closed) at several fractions ----
  await withApp('B3-track', async (app, win) => {
    await setup(app, win, 'b3');
    for (const f of [0.3, 0.5, 0.7]) {
      await dragDividerTo(win, f);
      const g = await geom(win);
      const expectedLeft = Math.round((g.stage.left) + (g.stage.w) * Number(g.frac) - (g.divider.w / 2));
      const off = Math.abs(g.divider.left - expectedLeft);
      note(`track f=${f} frac=${g.frac} divider.left=${g.divider.left} expected~${expectedLeft} off=${off}`);
      if (off > 3) finding(`Divider does not track the pointer at f=${f} (off ${off}px)`, 'LOW', { g, expectedLeft });
    }
  });

  fs.writeFileSync(path.join(OUT, 'geom.log'), lines.join('\n') + '\n', 'utf8');
  note(`TOTAL FINDINGS: ${findings.length}`);
  console.log(`\n=== SUMMARY ===\n${JSON.stringify(findings, null, 2)}`);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exitCode = 2; });