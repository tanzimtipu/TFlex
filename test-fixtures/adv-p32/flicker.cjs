// ADV P32 flicker v3: per-frame 32x32 downscale of each visible page canvas
// -> darkest pixel + signature. Whole-page coverage; blank frame = darkest
// >= 250. Signature churn on the UNFOCUSED pane = re-raster.
const H = require('./harness.cjs');

const START = () => {
  window.__advFrames = [];
  window.__advStop = false;
  const off = document.createElement('canvas');
  off.width = 32; off.height = 32;
  const octx = off.getContext('2d', { willReadFrequently: true });
  function sample() {
    if (window.__advStop) return;
    const rec = { t: Math.round(performance.now()) };
    for (const p of ['A', 'B']) {
      const pane = document.querySelector(`.tab-pane[data-pane="${p}"]`);
      if (!pane) { rec[p] = { noPane: true }; continue; }
      const vis = getComputedStyle(pane).visibility !== 'hidden' && pane.getAttribute('aria-hidden') !== 'true';
      const c = pane.querySelector('canvas.pdf-page-canvas');
      if (!c) { rec[p] = { vis, noCanvas: true }; continue; }
      let darkest = null, sig = null;
      try {
        if (c.width > 0 && c.height > 0) {
          octx.fillStyle = '#ffffff';
          octx.fillRect(0, 0, 32, 32);
          octx.drawImage(c, 0, 0, 32, 32);
          const d = octx.getImageData(0, 0, 32, 32).data;
          let mn = 255; const arr = new Array(1024);
          for (let i = 0, j = 0; i < d.length; i += 4, j += 1) {
            const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
            arr[j] = Math.round(v);
            if (v < mn) mn = v;
          }
          darkest = Math.round(mn);
          // coarse signature: mean of 4 quadrants
          let q = [0, 0, 0, 0];
          for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
            const idx = y * 32 + x;
            q[(y < 16 ? 0 : 2) + (x < 16 ? 0 : 1)] += arr[idx];
          }
          sig = q.map((s) => Math.round(s / 256));
        }
      } catch (e) { darkest = 'err'; }
      rec[p] = { vis, w: c.width, h: c.height, darkest, sig };
    }
    window.__advFrames.push(rec);
    if (window.__advFrames.length < 6000) requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
};
const STOP = () => { window.__advStop = true; return window.__advFrames; };

function sigDiff(a, b) {
  if (!a || !b) return null;
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]);
  return Math.round(s / a.length);
}

function analyze(label, frames) {
  console.log(`\n--- ${label}: ${frames.length} frames ---`);
  for (const p of ['A', 'B']) {
    const seq = frames.filter((f) => f[p] && f[p].vis && !f[p].noCanvas && typeof f[p].darkest === 'number');
    if (seq.length === 0) { console.log(`${p}: no visible raster samples`); continue; }
    const darks = seq.map((f) => f[p].darkest);
    const blank = seq.filter((f) => f[p].darkest >= 250);
    const sizes = new Set(seq.map((f) => `${f[p].w}x${f[p].h}`));
    // max consecutive-frame signature change
    let maxChurn = 0, churnAt = null;
    for (let i = 1; i < seq.length; i += 1) {
      const dd = sigDiff(seq[i - 1][p].sig, seq[i][p].sig);
      if (dd !== null && dd > maxChurn) { maxChurn = dd; churnAt = seq[i].t; }
    }
    console.log(`${p}: samples=${seq.length} darkest[min=${Math.min(...darks)} max=${Math.max(...darks)}] blankFrames=${blank.length} rasterSizes=${[...sizes].join(',')} maxFrameChurn=${maxChurn}@${churnAt}`);
    if (blank.length) console.log(`   blank ts=${blank.slice(0, 10).map((f) => f.t).join(',')}`);
  }
}

H.run(async () => {
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(1500);

    // Baseline settled signature (sanity: pages are not actually white).
    await win.evaluate(START);
    await win.waitForTimeout(700);
    analyze('settled baseline', await win.evaluate(STOP));

    await win.evaluate(START);
    for (let i = 0; i < 6; i += 1) {
      await win.locator(`.multi-pane-header[data-pane="${i % 2 === 0 ? 'A' : 'B'}"]`).click();
      await win.waitForTimeout(200);
    }
    analyze('focus switches', await win.evaluate(STOP));

    await win.evaluate(START);
    for (let i = 0; i < 4; i += 1) {
      const div = await win.locator('[data-multi-divider]').boundingBox();
      const cy = div.y + div.height / 2;
      await win.mouse.move(div.x + div.width / 2, cy);
      await win.mouse.down();
      await win.mouse.move(350 + (i % 2) * 700, cy, { steps: 8 });
      await win.mouse.up();
      await win.waitForTimeout(220);
    }
    analyze('divider drag', await win.evaluate(STOP));

    await win.evaluate(START);
    await win.locator('[data-rail-section-pane="A"] .thumb-item[data-page="1"]').first().scrollIntoViewIfNeeded();
    const d = await H.railCrossDrag(win, 'A', 1, 'B', 2, {});
    await win.waitForTimeout(1400);
    console.log('drag method=', d.method, 'after=', JSON.stringify(d.after));
    analyze('cross-doc drag', await win.evaluate(STOP));

    await H.snapshot(win, 'after-flicker');
    await H.shot(win, 'adv-p32-flicker.png');
  } finally { await H.close(app, 'adv-p32-flicker'); }
});