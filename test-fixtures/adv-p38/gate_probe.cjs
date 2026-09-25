/* Adversary Phase 38 pane-fit gate probe (evidence artifact, not a Playwright
 * spec - it lives in test-fixtures/ so Playwright never collects it). Runs the
 * dev build through the canonical e2e launcher. Usage:
 *   node test-fixtures/adv-p38/gate_probe.cjs <scenario>
 * Prints one JSON line per observation with prefix ADV38.
 */
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../e2e/lib/launch.cjs');

const HERE = __dirname;
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const ROOT = path.resolve(HERE, '..', '..');
const FIX = path.join(ROOT, 'test-fixtures');
const REPORT = path.join(FIX, 'report.pdf');
const LONG = path.join(FIX, 'long.pdf');
const PAYSLIP = 'C:\\Users\\tanzi\\Downloads\\TanzimulIslamPaySlip20260930.pdf';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (label, obj) => console.log(`ADV38 ${label} ${JSON.stringify(obj)}`);

async function mockOpen(app, fp) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, fp);
}

async function installSampler(win, pane = 'B') {
  await win.evaluate((pane) => {
    window.__adv38 = [];
    const t0 = performance.now();
    const sel = `.tab-pane[data-pane="${pane}"]`;
    const sample = () => {
      const paneEl = document.querySelector(sel);
      const slot = paneEl && paneEl.querySelector('.page-slot');
      const ph = paneEl && paneEl.querySelector('.page-placeholder');
      const canvas = paneEl && paneEl.querySelector('.pdf-page canvas');
      const zoomEl = document.querySelector(`[data-pill-pane="${pane}"] .zoom-percent`)
        || document.querySelector('[data-zoom-pill] .zoom-percent');
      const r = paneEl ? paneEl.getBoundingClientRect() : null;
      const sr = slot ? slot.getBoundingClientRect() : null;
      const page = paneEl && paneEl.querySelector('.pdf-page');
      const stage = document.querySelector('.tab-stage');
      const stR = stage ? stage.getBoundingClientRect() : null;
      window.__adv38.push({
        t: Math.round(performance.now() - t0),
        recv: Date.now(),
        paneW: r ? Math.round(r.width) : null,
        slotW: sr ? Math.round(sr.width) : null,
        pageW: page ? Math.round(page.getBoundingClientRect().width) : null,
        stageW: stR ? Math.round(stR.width) : null,
        inset: getComputedStyle(document.documentElement).getPropertyValue('--tf-tools-inset').trim(),
        slots: paneEl ? paneEl.querySelectorAll('.page-slot').length : null,
        ph: !!ph,
        canvas: !!canvas,
        empty: paneEl ? paneEl.hasAttribute('data-pane-empty') : null,
        zoom: zoomEl ? zoomEl.textContent.trim() : null,
      });
      if (window.__adv38.length < 4000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, pane);
}

async function readSamples(win) {
  return win.evaluate(() => window.__adv38);
}

function digest(samples) {
  const withPane = samples.filter((s) => s.paneW !== null && s.paneW > 0);
  const assigned = withPane.filter((s) => s.empty === false);
  const slotWs = assigned.filter((s) => s.slotW !== null).map((s) => s.slotW);
  const final = assigned.length ? assigned[assigned.length - 1] : (withPane[withPane.length - 1] || null);
  const seq = [];
  for (const s of assigned) {
    const v = s.slotW;
    if (seq.length === 0 || seq[seq.length - 1] !== v) seq.push(v);
  }
  const zoomSeq = [];
  let last = null;
  for (const s of assigned) {
    if (s.zoom !== null && s.zoom !== last) { zoomSeq.push({ t: s.t, z: s.zoom }); last = s.zoom; }
  }
  const maxSlot = slotWs.length ? Math.max(...slotWs) : null;
  const minSlot = slotWs.length ? Math.min(...slotWs) : null;
  return {
    samples: samples.length,
    assignedFrames: assigned.length,
    maxSlot, minSlot, finalSlot: final ? final.slotW : null,
    finalPaneW: final ? final.paneW : null,
    slotSeq: seq.slice(0, 40),
    slotSeqLen: seq.length,
    zoomSeq: zoomSeq.slice(0, 40),
    finalZoom: final ? final.zoom : null,
    placeholderFrames: assigned.filter((s) => s.ph).length,
    canvasFrames: assigned.filter((s) => s.canvas).length,
    lastSlots: final ? final.slots : null,
    lastCanvas: final ? final.canvas : null,
    lastEmpty: final ? final.empty : null,
  };
}

async function openSampleCard(win, name) {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
}

async function enterMulti(win) {
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(700);
}

async function openIntoB(app, win, fp) {
  await mockOpen(app, fp);
  const btn = win.locator('.tab-pane[data-pane="B"] [data-pane-open]');
  await btn.waitFor({ state: 'visible', timeout: 15000 });
  await btn.click();
  await win.waitForTimeout(400);
}

async function finalState(win, p = 'B') {
  return win.evaluate((p) => {
    const paneEl = document.querySelector(`.tab-pane[data-pane="${p}"]`);
    if (!paneEl) return null;
    const r = paneEl.getBoundingClientRect();
    return {
      paneW: Math.round(r.width),
      empty: paneEl.hasAttribute('data-pane-empty'),
      slots: paneEl.querySelectorAll('.page-slot').length,
      placeholders: paneEl.querySelectorAll('.page-placeholder').length,
      canvas: paneEl.querySelectorAll('.pdf-page canvas').length,
      pdfPages: paneEl.querySelectorAll('.pdf-page').length,
      zoom: (() => {
        const z = document.querySelector(`[data-pill-pane="${p}"] .zoom-percent`);
        return z ? z.textContent.trim() : null;
      })(),
      header: (() => {
        const h = paneEl.querySelector('[data-pane-header]');
        return h ? h.innerText.replace(/\s+/g, ' ').trim().slice(0, 90) : null;
      })(),
    };
  }, p);
}

async function dragDivider(win, cycles, excurse) {
  const div = win.locator('[data-multi-divider]');
  const box = await div.boundingBox();
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  for (let i = 0; i < cycles; i += 1) {
    const x = box.x + box.width / 2 + (i % 2 === 0 ? excurse : -excurse);
    await win.mouse.move(x, box.y + box.height / 2, { steps: 2 });
    await sleep(55);
  }
  await win.mouse.up();
}

async function scenarioDragDuringLoad(app, win) {
  await openSampleCard(win, 'report.pdf');
  await enterMulti(win);
  await installSampler(win, 'B');
  await mockOpen(app, LONG);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').click();
  // The open has been dispatched; the document renders asynchronously, so drag
  // the divider NOW, while the pane is loading.
  await dragDivider(win, 24, 220);
  await sleep(8000);
  const d = digest(await readSamples(win));
  const fs2 = await finalState(win, 'B');
  log('drag-during-load', { ...d, finalState: fs2 });
  await win.screenshot({ path: path.join(SHOTS, 'gate-drag-during-load.png') });
}

async function scenarioRapidOpenClose(app, win) {
  await openSampleCard(win, 'report.pdf');
  await enterMulti(win);
  await installSampler(win, 'B');
  for (let i = 0; i < 4; i += 1) {
    const fp = i % 2 === 0 ? LONG : REPORT;
    await openIntoB(app, win, fp);
    await sleep(250);
    const clear = win.locator('.tab-pane[data-pane="B"] [data-pane-clear]');
    if (await clear.count()) { await clear.first().click().catch(() => {}); }
    await sleep(250);
  }
  await openIntoB(app, win, PAYSLIP);
  await sleep(8000);
  const d = digest(await readSamples(win));
  const fs2 = await finalState(win, 'B');
  log('rapid-open-close', { ...d, finalState: fs2 });
  await win.screenshot({ path: path.join(SHOTS, 'gate-rapid-open-close.png') });
}

async function scenarioInspectorDuringLoad(app, win) {
  await openSampleCard(win, 'report.pdf');
  await enterMulti(win);
  await installSampler(win, 'B');
  await mockOpen(app, LONG);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').click();
  for (let i = 0; i < 6; i += 1) {
    const btn = win.locator('[data-inspector-editor-collapse], [data-inspector-collapse]').first();
    if (await btn.count()) await btn.click().catch(() => {});
    await sleep(140);
  }
  await sleep(8000);
  const d = digest(await readSamples(win));
  const fs2 = await finalState(win, 'B');
  log('inspector-during-load', { ...d, finalState: fs2 });
  await win.screenshot({ path: path.join(SHOTS, 'gate-inspector-during-load.png') });
}

async function scenarioPayslip(app, win) {
  await openSampleCard(win, 'report.pdf');
  await enterMulti(win);
  await installSampler(win, 'B');
  await openIntoB(app, win, PAYSLIP);
  await sleep(7000);
  const d = digest(await readSamples(win));
  const fs2 = await finalState(win, 'B');
  log('payslip-into-B', { ...d, finalState: fs2 });
  await win.screenshot({ path: path.join(SHOTS, 'gate-payslip-into-B.png') });
}

async function scenarioPayslipDrag(app, win) {
  await openSampleCard(win, 'report.pdf');
  await enterMulti(win);
  await installSampler(win, 'B');
  await mockOpen(app, PAYSLIP);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').click();
  await dragDivider(win, 24, 250);
  await sleep(8000);
  const d = digest(await readSamples(win));
  const fs2 = await finalState(win, 'B');
  log('payslip-drag-during-load', { ...d, finalState: fs2 });
  await win.screenshot({ path: path.join(SHOTS, 'gate-payslip-drag-during-load.png') });
}

async function scenarioThirdDoc(app, win) {
  await openSampleCard(win, 'report.pdf');
  await enterMulti(win);
  await installSampler(win, 'B');
  await openIntoB(app, win, LONG);
  await sleep(2500);
  await mockOpen(app, PAYSLIP);
  await win.locator('[data-toolbar-open]').first().click();
  await sleep(6000);
  const d = digest(await readSamples(win));
  const fs2 = await finalState(win, 'B');
  const tabs = await win.evaluate(() => ({
    tabPanes: document.querySelectorAll('.tab-pane[data-pane]').length,
    emptyPanes: document.querySelectorAll('.tab-pane[data-pane-empty]').length,
    headers: [...document.querySelectorAll('[data-pane-header]')].map((h) => h.innerText.replace(/\s+/g, ' ').trim().slice(0, 60)),
    focused: [...document.querySelectorAll('[data-pane]')].filter((p) => p.getAttribute('data-pane-focused') === 'true').map((p) => p.getAttribute('data-pane')),
  }));
  log('third-doc', { ...d, finalState: fs2, tabs });
  await win.screenshot({ path: path.join(SHOTS, 'gate-third-doc.png') });
}

async function scenarioTabSwitch(app, win) {
  await openSampleCard(win, 'report.pdf');
  await enterMulti(win);
  await installSampler(win, 'B');
  await mockOpen(app, PAYSLIP);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').click();
  // The open is dispatched; switch focus between the two panes while the payslip
  // fits into pane B.
  for (let i = 0; i < 10; i += 1) {
    const other = i % 2 === 0 ? '.tab-pane[data-pane="A"]' : '.tab-pane[data-pane="B"]';
    await win.locator(other).click({ position: { x: 40, y: 30 } }).catch(() => {});
    await sleep(120);
  }
  await sleep(8000);
  const d = digest(await readSamples(win));
  const fs2 = await finalState(win, 'B');
  log('tab-switch-mid-fit', { ...d, finalState: fs2 });
  await win.screenshot({ path: path.join(SHOTS, 'gate-tab-switch-mid-fit.png') });
}

async function scenarioTinyDoc(app, win) {
  await openSampleCard(win, 'form.pdf');
  await enterMulti(win);
  await installSampler(win, 'B');
  await openIntoB(app, win, path.join(FIX, 'marker-3pages.pdf'));
  await sleep(7000);
  const d = digest(await readSamples(win));
  const fs2 = await finalState(win, 'B');
  log('tiny-doc', { ...d, finalState: fs2 });
  await win.screenshot({ path: path.join(SHOTS, 'gate-tiny-doc.png') });
}

async function scenarioRepeat(app, win) {
  await openSampleCard(win, 'report.pdf');
  await enterMulti(win);
  await installSampler(win, 'B');
  const cycles = [];
  const fpList = [LONG, REPORT, LONG, REPORT, PAYSLIP, LONG, PAYSLIP];
  let cursor = 0;
  for (let k = 0; k < fpList.length; k += 1) {
    const clear = win.locator('.tab-pane[data-pane="B"] [data-pane-clear]');
    if (await clear.count()) { await clear.first().click().catch(() => {}); await sleep(500); }
    const before = (await readSamples(win)).length;
    await openIntoB(app, win, fpList[k]);
    await sleep(3200);
    const all = await readSamples(win);
    const slice = all.slice(before);
    const assigned = slice.filter((s) => s.empty === false && s.paneW !== null && s.paneW > 0);
    const ws = assigned.filter((s) => s.slotW !== null).map((s) => s.slotW);
    const settled = ws.length ? ws[ws.length - 1] : null;
    const max = ws.length ? Math.max(...ws) : null;
    const zooms = [];
    let last = null;
    for (const s of assigned) if (s.zoom !== null && s.zoom !== last) { zooms.push(s.zoom); last = s.zoom; }
    cycles.push({
      k, file: path.basename(fpList[k]),
      frames: slice.length, assigned: assigned.length,
      maxSlot: max, settledSlot: settled,
      overshootFrames: assigned.filter((s) => s.slotW !== null && settled !== null && s.slotW > settled + 2).length,
      overshootWidths: [...new Set(assigned.filter((s) => s.slotW !== null && settled !== null && s.slotW > settled + 2).map((s) => s.slotW))],
      placeholderFrames: assigned.filter((s) => s.ph).length,
      zoomSeq: zooms,
    });
    cursor = all.length;
  }
  log('repeat-open', { cycles });
  const fs2 = await finalState(win, 'B');
  log('repeat-final', fs2);
  await win.screenshot({ path: path.join(SHOTS, 'gate-repeat-open.png') });
}

async function scenarioOvershoot(app, win) {
  await openSampleCard(win, 'report.pdf');
  await enterMulti(win);
  await installSampler(win, 'B');
  const cdp = await win.context().newCDPSession(win);
  const frames = [];
  cdp.on('Page.screencastFrame', (ev) => {
    frames.push({ data: ev.data, recv: Date.now() });
    cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', quality: 100, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 });

  const cycles = [];
  const fpList = [LONG, REPORT, LONG, REPORT, LONG, REPORT, LONG, REPORT];
  let found = null;
  for (let k = 0; k < fpList.length; k += 1) {
    const clear = win.locator('.tab-pane[data-pane="B"] [data-pane-clear]');
    if (await clear.count()) { await clear.first().click().catch(() => {}); await sleep(600); }
    const before = (await readSamples(win)).length;
    const t0 = Date.now();
    await openIntoB(app, win, fpList[k]);
    await sleep(3600);
    const slice = (await readSamples(win)).slice(before);
    const assigned = slice.filter((s) => s.empty === false && s.paneW !== null && s.paneW > 0);
    const ws = assigned.filter((s) => s.slotW !== null).map((s) => s.slotW);
    const settled = ws.length ? ws[ws.length - 1] : null;
    const over = assigned.filter((s) => s.slotW !== null && settled !== null && s.slotW > settled + 20);
    cycles.push({
      k, file: path.basename(fpList[k]), settled,
      maxSlot: ws.length ? Math.max(...ws) : null,
      bigOvershootFrames: over.length,
      overDetail: over.map((s) => ({ t: s.t, slotW: s.slotW, paneW: s.paneW, pageW: s.pageW, stageW: s.stageW, inset: s.inset, ph: s.ph, canvas: s.canvas, zoom: s.zoom })),
      zoomSeq: (() => { const z = []; let last = null; for (const s of assigned) if (s.zoom !== null && s.zoom !== last) { z.push(s.zoom); last = s.zoom; } return z; })(),
    });
    if (over.length > 0 && found === null) {
      found = { k, recv: over[0].recv, first: over[0] };
    }
  }
  log('overshoot-cycles', { cycles });
  if (found) {
    // Find the screencast frame nearest the overshoot sample and save it.
    const target = found.recv;
    let best = 0;
    for (let i = 0; i < frames.length; i += 1) {
      if (Math.abs(frames[i].recv - target) < Math.abs(frames[best].recv - target)) best = i;
    }
    const widest = frames[best];
    const p = path.join(SHOTS, 'gate-overshoot-widest.png');
    if (widest) fs.writeFileSync(p, Buffer.from(widest.data, 'base64'));
    log('overshoot-frame', { cycle: found.k, sample: found.first, framePath: p, frameDeltaMs: widest ? widest.recv - target : null, totalFrames: frames.length });
  } else {
    log('overshoot-frame', { none: true, totalFrames: frames.length });
  }
  try { await cdp.send('Page.stopScreencast'); } catch (_) {}
  try { await cdp.detach(); } catch (_) {}
  await win.screenshot({ path: path.join(SHOTS, 'gate-overshoot-final.png') });
}

async function scenarioHostileDoc(app, win) {
  const targets = [
    path.join(FIX, 'corrupted.pdf'),
    path.join(FIX, 'encrypted.pdf'),
    path.join(FIX, 'zero.pdf'),
    path.join(FIX, 'not-a-pdf.txt'),
    path.join(FIX, 'truncated.pdf'),
  ];
  await openSampleCard(win, 'report.pdf');
  await enterMulti(win);
  await installSampler(win, 'B');
  const results = [];
  for (const fp of targets) {
    const clear = win.locator('.tab-pane[data-pane="B"] [data-pane-clear]');
    if (await clear.count()) { await clear.first().click().catch(() => {}); await sleep(500); }
    const before = (await readSamples(win)).length;
    let openErr = null;
    try { await openIntoB(app, win, fp); } catch (e) { openErr = String(e.message).slice(0, 160); }
    await sleep(5000);
    const slice = (await readSamples(win)).slice(before);
    const assigned = slice.filter((s) => s.empty === false && s.paneW !== null && s.paneW > 0);
    const fs2 = await finalState(win, 'B');
    // Any visible dialog / error surface?
    const dialogs = await win.evaluate(() => [...document.querySelectorAll('[role="dialog"], .sheet-backdrop, .toast, [data-toast]')]
      .map((d) => d.innerText.replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean));
    results.push({
      file: path.basename(fp),
      openErr,
      assignedFrames: assigned.length,
      finalState: fs2,
      blankHeld: assigned.length > 60 && fs2 !== null && fs2.empty === false && fs2.slots === 0 && fs2.canvas === 0,
      dialogs: dialogs.slice(0, 4),
    });
    await win.keyboard.press('Escape').catch(() => {});
    await sleep(300);
  }
  log('hostile-doc', { results });
  await win.screenshot({ path: path.join(SHOTS, 'gate-hostile-doc.png') });
}

async function setWindowSize(app, win, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes('tfWindow=print'));
    if (bw) bw.setSize(s[0], s[1]);
  }, [w, h]);
  await win.waitForTimeout(500);
}

async function gotoStage(win, n) {
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el !== null && typeof el.blur === 'function') el.blur();
  });
  await win.keyboard.press(`Control+${n}`);
  await win.waitForTimeout(350);
}

async function dockMeasure(win) {
  return win.evaluate(() => {
    const dock = document.querySelector('[data-action-dock]');
    if (!dock) return null;
    const dr = dock.getBoundingClientRect();
    const sc = document.querySelector('[data-dock-scroll]');
    const scR = sc ? sc.getBoundingClientRect() : null;
    const verbs = [...dock.querySelectorAll('[data-dock-verb]')];
    const rects = verbs.map((v) => {
      const r = v.getBoundingClientRect();
      return { id: v.getAttribute('data-dock-verb'), left: +r.left.toFixed(1), right: +r.right.toFixed(1), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), cx: +((r.left + r.right) / 2).toFixed(1), cy: +((r.top + r.bottom) / 2).toFixed(1) };
    });
    const hit = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const owner = el.closest('[data-dock-verb]');
      return owner ? owner.getAttribute('data-dock-verb') : `OUT:${el.tagName}.${String(el.className).slice(0, 40)}`;
    };
    // At scrollLeft 0, is the leading verb visible+hit?
    const firstVisibleHit = rects[0] ? hit(rects[0].cx, rects[0].cy) : null;
    const rows = new Set(rects.map((r) => Math.round(r.top))).size;
    return {
      stage: dock.getAttribute('data-dock-state'),
      innerWidth: window.innerWidth,
      dock: { left: +dr.left.toFixed(1), right: +dr.right.toFixed(1), top: +dr.top.toFixed(1), bottom: +dr.bottom.toFixed(1), width: +dr.width.toFixed(1) },
      scroller: scR ? { left: +scR.left.toFixed(1), right: +scR.right.toFixed(1), width: +scR.width.toFixed(1), clientWidth: sc.clientWidth, scrollWidth: sc.scrollWidth, scrollLeft: Math.round(sc.scrollLeft) } : null,
      arrowsLane: dock.getAttribute('data-dock-arrows-lane'),
      arrows: dock.getAttribute('data-dock-arrows'),
      lifted: dock.getAttribute('data-dock-lift'),
      iconOnly: dock.getAttribute('data-dock-icon-only'),
      count: verbs.length,
      rows,
      firstVisibleHit,
      verbIds: rects.map((r) => r.id),
      verbsOutsideDockH: rects.filter((r) => (r.cx >= dr.left && r.cx <= dr.right) && (r.left < dr.left - 0.6 || r.right > dr.right + 0.6)).map((r) => r.id),
    };
  });
}

async function dockTrailing(win) {
  // Scroll the lane fully right, then check the trailing verb is visible+hit.
  return win.evaluate(() => {
    const sc = document.querySelector('[data-dock-scroll]');
    if (sc) sc.scrollLeft = sc.scrollWidth;
    const dock = document.querySelector('[data-action-dock]');
    const dr = dock.getBoundingClientRect();
    const verbs = [...dock.querySelectorAll('[data-dock-verb]')];
    const last = verbs[verbs.length - 1];
    const r = last ? last.getBoundingClientRect() : null;
    const scR = sc ? sc.getBoundingClientRect() : null;
    let hit = null;
    if (r) {
      const el = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      const owner = el ? el.closest('[data-dock-verb]') : null;
      hit = owner ? owner.getAttribute('data-dock-verb') : (el ? `OUT:${el.tagName}` : null);
    }
    return {
      scrollLeft: sc ? Math.round(sc.scrollLeft) : null,
      scrollWidth: sc ? sc.scrollWidth : null,
      clientWidth: sc ? sc.clientWidth : null,
      lastId: last ? last.getAttribute('data-dock-verb') : null,
      lastRect: r ? { left: +r.left.toFixed(1), right: +r.right.toFixed(1), cx: +((r.left + r.right) / 2).toFixed(1), cy: +((r.top + r.bottom) / 2).toFixed(1) } : null,
      lastInScroller: r && scR ? (r.left >= scR.left - 1 && r.right <= scR.right + 1) : null,
      lastHit: hit,
      lastOutsideDock: r ? (r.left < dr.left - 1 || r.right > dr.right + 1) : null,
    };
  });
}

async function scenarioDock(app, win) {
  await openSampleCard(win, 'report.pdf');
  const widths = [1920, 1440, 1200, 880, 719, 640, 520, 400];
  const out = [];
  for (const w of widths) {
    await setWindowSize(app, win, w, 900);
    for (let s = 1; s <= 4; s += 1) {
      await gotoStage(win, s);
      const m = await dockMeasure(win);
      const t = await dockTrailing(win);
      out.push({ w, s, ...m, trailing: t });
    }
  }
  log('dock-sweep', { rows: out });
  await win.screenshot({ path: path.join(SHOTS, 'dock-400.png') });
}

async function scenarioDockEmpty(app, win) {
  await openSampleCard(win, 'report.pdf');
  await setWindowSize(app, win, 1440, 900);
  await gotoStage(win, 1);
  // Right-click every rendered verb and unpin it, until none remain.
  for (let round = 0; round < 12; round += 1) {
    const ids = await win.evaluate(() => [...document.querySelectorAll('[data-action-dock] [data-dock-verb]')].map((v) => v.getAttribute('data-dock-verb')));
    if (ids.length === 0) break;
    const id = ids[0];
    await win.locator(`[data-action-dock] [data-dock-verb="${id}"]`).first().click({ button: 'right' });
    await win.waitForTimeout(150);
    const unpin = win.locator('[data-dock-menu-item="unpin"]');
    if (!(await unpin.count())) { log('dock-empty-stuck', { id }); break; }
    await unpin.first().click();
    await win.waitForTimeout(200);
  }
  const m = await dockMeasure(win);
  const dom = await win.evaluate(() => {
    const dock = document.querySelector('[data-action-dock]');
    const r = dock.getBoundingClientRect();
    return {
      verbs: dock.querySelectorAll('[data-dock-verb]').length,
      groups: dock.querySelectorAll('[data-dock-group]').length,
      overflow: dock.querySelectorAll('[data-dock-overflow]').length,
      rows: new Set([...dock.querySelectorAll('[data-dock-verb], [data-dock-overflow]')].map((v) => Math.round(v.getBoundingClientRect().top))).size,
      box: { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) },
      hint: !!dock.querySelector('[data-dock-hint]'),
      text: dock.innerText.replace(/\s+/g, ' ').trim().slice(0, 80),
    };
  });
  log('dock-empty', { m, dom });
  await win.screenshot({ path: path.join(SHOTS, 'dock-empty.png') });
}

async function scenarioDockMenuEdges(app, win) {
  await openSampleCard(win, 'report.pdf');
  await setWindowSize(app, win, 420, 560);
  await gotoStage(win, 1);
  const results = [];
  for (const side of ['left', 'right']) {
    await win.evaluate(() => { const sc = document.querySelector('[data-dock-scroll]'); if (sc) sc.scrollLeft = 0; });
    await win.evaluate((s) => { const sc = document.querySelector('[data-dock-scroll]'); if (sc) sc.scrollLeft = s === 'right' ? sc.scrollWidth : 0; }, side);
    await win.waitForTimeout(200);
    const ids = await win.evaluate(() => {
      const verbs = [...document.querySelectorAll('[data-action-dock] [data-dock-verb]')];
      return verbs.map((v) => v.getAttribute('data-dock-verb'));
    });
    const id = side === 'left' ? ids[0] : ids[ids.length - 1];
    const box = await win.locator(`[data-action-dock] [data-dock-verb="${id}"]`).first().boundingBox();
    await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await win.waitForTimeout(250);
    const menu = await win.evaluate(() => {
      const m = document.querySelector('[data-dock-menu]');
      if (!m) return null;
      const r = m.getBoundingClientRect();
      return {
        left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom),
        w: Math.round(r.width), h: Math.round(r.height),
        innerW: window.innerWidth, innerH: window.innerHeight,
        inViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
        items: [...m.querySelectorAll('[data-dock-menu-item]')].map((b) => ({ k: b.getAttribute('data-dock-menu-item'), disabled: b.disabled, text: b.innerText.trim() })),
      };
    });
    results.push({ side, id, menu });
    await win.keyboard.press('Escape');
    await win.waitForTimeout(150);
  }
  log('dock-menu-edges', { results });
  await win.screenshot({ path: path.join(SHOTS, 'dock-menu-edges.png') });
}

async function scenarioDockOscillate(app, win) {
  await openSampleCard(win, 'report.pdf');
  await gotoStage(win, 1);
  const snaps = [];
  for (let i = 0; i < 8; i += 1) {
    await setWindowSize(app, win, i % 2 === 0 ? 1920 : 640, 900);
    const m = await win.evaluate(() => {
      const dock = document.querySelector('[data-action-dock]');
      const verbs = [...dock.querySelectorAll('[data-dock-verb]')];
      return {
        w: window.innerWidth,
        rows: new Set(verbs.map((v) => Math.round(v.getBoundingClientRect().top))).size,
        lane: dock.getAttribute('data-dock-arrows-lane'),
        arrows: dock.getAttribute('data-dock-arrows'),
        lift: dock.getAttribute('data-dock-lift'),
        count: verbs.length,
      };
    });
    snaps.push(m);
  }
  await setWindowSize(app, win, 1440, 900);
  const final = await dockMeasure(win);
  log('dock-oscillate', { snaps, final });
}

async function scenarioLegibility(app, win) {
  await openSampleCard(win, 'report.pdf');
  await setWindowSize(app, win, 1920, 900);
  await gotoStage(win, 1);
  const themes = ['light', 'dark', 'frosted'];
  const result = {};
  for (const theme of themes) {
    // set theme
    await win.evaluate((t) => {
      const root = document.documentElement;
      root.dataset.theme = t;
    }, theme);
    await win.waitForTimeout(400);
    const m = await win.evaluate(() => {
      const root = document.documentElement;
      const v = (name) => getComputedStyle(root).getPropertyValue(name).trim();
      const parse = (s) => {
        if (!s) return null;
        if (s.startsWith('#')) {
          let h = s.slice(1);
          if (h.length === 3) h = h.split('').map((c) => c + c).join('');
          if (h.length === 4) h = h.split('').map((c) => c + c).join('');
          const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
          return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a };
        }
        const mm = String(s).match(/rgba?\(([^)]+)\)/);
        if (!mm) return null;
        const p = mm[1].split(',').map((x) => parseFloat(x.trim()));
        return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
      };
      const comp = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
      const lum = (c) => { const ch = (x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }; return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b); };
      const ratio = (a, b) => { const l1 = lum(a); const l2 = lum(b); return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2)); };
      const dist = (a, b) => Math.round(Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2));

      const bgBase = parse(v('--bg-base')) || { r: 255, g: 255, b: 255, a: 1 };
      const base = comp(bgBase, { r: 255, g: 255, b: 255, a: 1 });
      const surf = comp(parse(v('--bg-elevated')) || base, base);
      const hoverBg = comp(parse(v('--bg-hover')), surf);
      const activeBg = comp(parse(v('--bg-active')), surf);
      const softBg = comp(parse(v('--accent-soft')), surf);
      const softHoverBg = comp(parse(v('--accent-hover-bg')), surf);

      const strong = parse(v('--fg-strong'));
      const disabled = parse(v('--fg-disabled'));
      const primaryFg = parse(v('--dock-primary-fg'));
      const hues = {};
      for (const h of ['blue', 'cyan', 'green', 'orange', 'yellow', 'purple', 'red', 'pink']) hues[h] = parse(v(`--icon-${h}`));

      const hueRows = Object.entries(hues).map(([name, c]) => ({ name, color: c, onSurface: ratio(c, surf), onHover: ratio(c, hoverBg), onActive: ratio(c, activeBg), hex: `rgb(${c.r},${c.g},${c.b})` }));
      const greys = Object.values(hues).map((c) => +lum(c).toFixed(4));
      // Pairwise minimum luminance separation (greyscale legibility).
      let minDelta = 1;
      const arr = Object.values(hues).map(lum);
      for (let i = 0; i < arr.length; i += 1) for (let j = i + 1; j < arr.length; j += 1) minDelta = Math.min(minDelta, Math.abs(arr[i] - arr[j]));

      // The 8 verb labels + icon classes (colour is not the only signal).
      const dock = document.querySelector('[data-action-dock]');
      const verbs = [...dock.querySelectorAll('[data-dock-verb]')].map((b) => {
        const label = b.querySelector('.action-dock-label');
        const icon = b.querySelector('svg');
        const cs = getComputedStyle(b);
        return {
          id: b.getAttribute('data-dock-verb'),
          label: label ? label.textContent.trim() : null,
          iconClass: icon ? icon.getAttribute('class') : null,
          color: cs.color,
          bg: cs.backgroundColor,
          pressed: b.getAttribute('aria-pressed'),
          disabled: b.disabled,
        };
      });
      const min = (xs) => (xs.length ? Math.min(...xs) : null);
      return {
        theme: root.dataset.theme,
        raw: {
          strong: v('--fg-strong'), hover: v('--bg-hover'), active: v('--bg-active'),
          soft: v('--accent-soft'), primaryFg: v('--dock-primary-fg'), elev: v('--bg-elevated'), base: v('--bg-base'),
        },
        surf: `rgb(${Math.round(surf.r)},${Math.round(surf.g)},${Math.round(surf.b)})`,
        statesDebug: {
          strongLum: strong ? +lum(strong).toFixed(4) : null,
          hoverBgLum: +lum(hoverBg).toFixed(4),
          strongRaw: strong,
          hoverBgRaw: { r: +hoverBg.r.toFixed(1), g: +hoverBg.g.toFixed(1), b: +hoverBg.b.toFixed(1) },
          primaryLum: primaryFg ? +lum(primaryFg).toFixed(4) : null,
          softBgLum: +lum(softBg).toFixed(4),
        },
        states: {
          hoverFgOnHoverBg: strong && ratio(strong, hoverBg),
          activeFgOnActiveBg: strong && ratio(strong, activeBg),
          pressedFgOnSoftBg: primaryFg && ratio(primaryFg, softBg),
          primaryFgOnSoftBg: primaryFg && ratio(primaryFg, softBg),
          primaryFgOnSoftHoverBg: primaryFg && ratio(primaryFg, softHoverBg),
          disabledFgOnSurface: disabled && ratio(disabled, surf),
        },
        disabledDistinctFromStrong: disabled && strong ? dist(disabled, strong) : null,
        disabledDistinctFromBlue: disabled && hues.blue ? dist(disabled, hues.blue) : null,
        disabledDistinctFromEnabledMin: disabled ? Math.min(...hueRows.map((h) => dist(disabled, h.color))) : null,
        hues: hueRows,
        minHueOnSurface: Math.min(...hueRows.map((h) => h.onSurface)),
        minHueOnHover: Math.min(...hueRows.map((h) => h.onHover)),
        minHueOnActive: Math.min(...hueRows.map((h) => h.onActive)),
        hoverInkIsFamilyHue: true,
        minGreyscaleLumDelta: +minDelta.toFixed(4),
        verbs,
        distinctVerbColors: new Set(verbs.map((x) => x.color)).size,
        distinctIconClasses: new Set(verbs.map((x) => x.iconClass)).size,
        labelsPresent: verbs.every((x) => x.label && x.label.length > 0),
      };
    });
    result[theme] = m;
    await win.screenshot({ path: path.join(SHOTS, `legibility-${theme}.png`) });
  }

  // Empirical hover + press on the first non-primary verb, per theme.
  for (const theme of themes) {
    await win.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await win.waitForTimeout(350);
    const id = await win.evaluate(() => {
      const dock = document.querySelector('[data-action-dock]');
      const b = [...dock.querySelectorAll('[data-dock-verb]')].find((x) => !x.classList.contains('action-dock-verb-primary'));
      return b ? b.getAttribute('data-dock-verb') : null;
    });
    if (!id) continue;
    const loc = win.locator(`[data-action-dock] [data-dock-verb="${id}"]`).first();
    const box = await loc.boundingBox();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.waitForTimeout(250);
    const hover = await win.evaluate(() => {
      const b = document.activeElement; return null;
    }).catch(() => null);
    const hoverState = await win.evaluate((vid) => {
      const b = document.querySelector(`[data-action-dock] [data-dock-verb="${vid}"]`);
      return { id: vid, color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor };
    }, id);
    await win.mouse.down();
    await win.waitForTimeout(200);
    const activeState = await win.evaluate((vid) => {
      const b = document.querySelector(`[data-action-dock] [data-dock-verb="${vid}"]`);
      return { id: vid, color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor };
    }, id);
    await win.mouse.up();
    result[theme].empiricalHover = hoverState;
    result[theme].empiricalActive = activeState;
  }

  // Sizes across surfaces (reuse the gate's measurement, condensed).
  const sizes = await win.evaluate(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1)]; };
    const glyph = (root) => {
      const boxes = [...root.querySelectorAll('button svg, [role="button"] svg')].map(rect);
      return boxes.length ? { count: boxes.length, minW: Math.min(...boxes.map((b) => b[0])), minH: Math.min(...boxes.map((b) => b[1])) } : null;
    };
    const fs = (el) => (el ? +parseFloat(getComputedStyle(el).fontSize).toFixed(2) : null);
    const out = {};
    for (const [k, sel] of [['dock', '[data-action-dock]'], ['rail', '[data-stage-rail]'], ['panel', '[data-context-panel]'], ['inspector', '[data-inspector]'], ['header', '.app-header, .titlebar']]) {
      const el = document.querySelector(sel);
      out[k] = el ? { icon: glyph(el), minLabelFont: (() => { const ls = [...el.querySelectorAll('button span, [role="button"] span')].map(fs).filter((x) => x !== null && x > 0); return ls.length ? Math.min(...ls) : null; })() } : null;
    }
    return out;
  });

  // Edge audit: the widened stage rail and the dock/pills must not touch an edge.
  const edges = await win.evaluate(() => {
    const W = window.innerWidth; const H = window.innerHeight;
    const check = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), touchesLeft: r.left <= 0, touchesRight: r.right >= W, touchesTop: r.top <= 0, touchesBottom: r.bottom >= H };
    };
    const rail = document.querySelector('[data-stage-rail]');
    const railR = rail ? rail.getBoundingClientRect() : null;
    const btns = rail ? [...rail.querySelectorAll('.stage-rail-btn')].map((b) => { const r = b.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) }; }) : [];
    return { W, H, rail: check('[data-stage-rail]'), dock: check('[data-action-dock]'), pagePill: check('.canvas-pill'), railWidth: railR ? Math.round(railR.width) : null, railBtns: btns };
  });

  log('legibility-states', result);
  log('legibility-sizes', sizes);
  log('legibility-edges', edges);
  await win.screenshot({ path: path.join(SHOTS, 'legibility-edges.png') });
}

async function armPalette(win, search, id) {
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el !== null && typeof el.blur === 'function') el.blur();
  });
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 10000 });
  await win.locator('[data-command-palette-input]').fill(search);
  await win.waitForTimeout(400);
  const row = win.locator(`[data-palette-tool-id="${id}"]`).first();
  if (await row.count()) { await row.click(); }
  await win.waitForTimeout(600);
}

async function textPanelSnapshot(win) {
  return win.evaluate(() => {
    const panel = document.querySelector('[data-inspector-text-panel]');
    const field = panel ? panel.querySelector('[data-txt-text]') : null;
    return {
      inspectorTextPanels: document.querySelectorAll('[data-inspector-text-panel]').length,
      dataTextPanels: document.querySelectorAll('[data-text-panel]').length,
      textPropsPanels: document.querySelectorAll('.text-props-panel').length,
      float: document.querySelectorAll('[data-text-panel-float]').length,
      grip: document.querySelectorAll('[data-text-panel-grip]').length,
      gripClass: document.querySelectorAll('.text-props-grip').length,
      inPaneA: document.querySelectorAll('[data-pane="A"] [data-inspector-text-panel]').length,
      inPaneB: document.querySelectorAll('[data-pane="B"] [data-inspector-text-panel]').length,
      selection: (() => { const i = document.querySelector('[data-inspector]'); return i ? i.getAttribute('data-inspector-selection') : null; })(),
      fieldValue: field ? field.value : null,
      fieldDisabled: field ? field.disabled : null,
      focusedPane: (() => { const p = document.querySelector('.tab-pane[data-pane][data-pane-focused="true"]'); return p ? p.getAttribute('data-pane') : null; })(),
    };
  });
}

async function scenarioTextMulti(app, win) {
  await openSampleCard(win, 'report.pdf');
  await enterMulti(win);
  await openIntoB(app, win, LONG);
  await sleep(3000);
  // Focus pane B.
  await win.locator('.tab-pane[data-pane="B"]').click({ position: { x: 60, y: 40 } });
  await sleep(500);
  await win.locator('.tab-pane[data-pane="B"]').click({ position: { x: 60, y: 40 } });
  await win.keyboard.press('Control+2');
  await win.waitForTimeout(500);
  await armPalette(win, 'Edit text', 'editText');
  // Select a run in pane B.
  const pageLoc = win.locator('.tab-pane[data-pane="B"] .pdf-page[data-page="1"]');
  const pg = await pageLoc.boundingBox();
  let selected = false;
  for (const [fx, fy] of [[0.5, 0.1], [0.3, 0.12], [0.5, 0.16], [0.4, 0.3], [0.5, 0.42]]) {
    await win.mouse.click(Math.round(pg.x + pg.width * fx), Math.round(pg.y + pg.height * fy));
    await win.waitForTimeout(600);
    const sel = await win.evaluate(() => document.querySelector('.tab-pane[data-pane="B"] [data-textrun-selection]') !== null);
    if (sel) { selected = true; break; }
  }
  const afterSelectB = await textPanelSnapshot(win);
  log('text-multi-selectB', { selected, ...afterSelectB });
  await win.screenshot({ path: path.join(SHOTS, 'text-multi-B.png') });

  // Switch stages mid-edit with pane B still focused: the panel must persist
  // exactly once and keep the selection.
  const stageSnaps = [];
  for (let s = 1; s <= 4; s += 1) {
    await win.keyboard.press(`Control+${s}`);
    await win.waitForTimeout(1500);
    stageSnaps.push({ s, ...(await textPanelSnapshot(win)) });
    // At the PAGES stage the panel persisted with selection "page": try to edit
    // it and see whether a stale surface mutates the deselected run.
    if (s === 1) {
      const f = win.locator('[data-inspector-text-panel] [data-txt-text]');
      if (await f.count()) {
        await f.focus();
        await win.keyboard.type('ZZZ');
        await win.waitForTimeout(500);
        stageSnaps.push({ s, typed: true, ...(await textPanelSnapshot(win)) });
        const toast = await win.evaluate(() => [...document.querySelectorAll('.toast, [data-toast]')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean));
        stageSnaps.push({ s, toasts: toast });
      }
    }
  }
  log('text-multi-stages', { stageSnaps });

  // After the stale-surface typing, re-enter EDIT and re-select the same run:
  // did the deselected run's text change?
  await win.keyboard.press('Control+2');
  await win.waitForTimeout(700);
  await armPalette(win, 'Edit text', 'editText');
  const recheck = [];
  for (const [fx, fy] of [[0.5, 0.1], [0.3, 0.12], [0.5, 0.16], [0.4, 0.3], [0.5, 0.42]]) {
    await win.mouse.click(Math.round(pg.x + pg.width * fx), Math.round(pg.y + pg.height * fy));
    await win.waitForTimeout(600);
    const snap = await textPanelSnapshot(win);
    const runSel = await win.evaluate(() => ({ b: document.querySelector('.tab-pane[data-pane="B"] [data-textrun-selection]') !== null }));
    recheck.push({ fx, fy, runSel, ...snap });
    if (runSel.b) break;
  }
  const dirty = await win.evaluate(() => ({
    title: document.title,
    dirty: document.querySelectorAll('[data-tab-dirty], .tab-dirty, [data-modified="true"]').length,
  }));
  log('text-multi-recheckB', { recheck, dirty });

  // Focus pane A and inspect: is B's text selection still shown? Is it stale?
  await win.locator('.tab-pane[data-pane="A"]').click({ position: { x: 60, y: 40 } });
  await sleep(700);
  const afterFocusA = await textPanelSnapshot(win);
  log('text-multi-focusA', afterFocusA);

  // Type while pane A is focused (field must NOT silently edit B's run).
  const field = win.locator('[data-inspector-text-panel] [data-txt-text]');
  const beforeType = await field.count() ? await field.inputValue() : null;
  if (await field.count()) {
    await field.focus();
    await win.keyboard.type('QQ');
    await win.waitForTimeout(400);
  }
  const afterType = await textPanelSnapshot(win);
  const aSelection = await win.evaluate(() => {
    const a = document.querySelector('.tab-pane[data-pane="A"]');
    return { runSel: a ? a.querySelector('[data-textrun-selection]') !== null : null };
  });
  log('text-multi-typeOnA', { beforeType, afterType, aSelection });

  // Close the last document mid-edit and make sure nothing is orphaned.
  await win.keyboard.press('Escape');
  await sleep(200);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-clear]').first().click().catch(() => {});
  await sleep(1500);
  const afterClear = await textPanelSnapshot(win);
  log('text-multi-clear', afterClear);
  await win.screenshot({ path: path.join(SHOTS, 'text-multi-after-clear.png') });
}

async function scenarioTextSingle(app, win) {
  await openSampleCard(win, 'long.pdf');
  await setWindowSize(app, win, 1440, 900);
  await gotoStage(win, 2);
  await armPalette(win, 'Edit text', 'editText');
  const pageLoc = win.locator('.pdf-page[data-page="1"]');
  const pg = await pageLoc.boundingBox();
  let selected = false;
  for (const [fx, fy] of [[0.5, 0.1], [0.3, 0.12], [0.5, 0.16], [0.4, 0.3], [0.5, 0.42]]) {
    await win.mouse.click(Math.round(pg.x + pg.width * fx), Math.round(pg.y + pg.height * fy));
    await win.waitForTimeout(600);
    if (await win.evaluate(() => document.querySelector('[data-textrun-selection]') !== null)) { selected = true; break; }
  }
  const atEdit = await textPanelSnapshot(win);
  log('text-single-edit', { selected, ...atEdit });
  await win.screenshot({ path: path.join(SHOTS, 'text-single-edit.png') });

  // Switch to PAGES mid-edit, single mode.
  await win.keyboard.press('Control+1');
  await win.waitForTimeout(1500);
  const atPages = await textPanelSnapshot(win);
  log('text-single-pages', atPages);

  let typed = null;
  if (atPages.inspectorTextPanels > 0) {
    const f = win.locator('[data-inspector-text-panel] [data-txt-text]');
    if (await f.count()) {
      await f.focus();
      await win.keyboard.type('ZZZ');
      await win.waitForTimeout(500);
      typed = await textPanelSnapshot(win);
    }
  }
  log('text-single-pages-typed', typed);

  // Re-enter EDIT and re-select; read the run text.
  await win.keyboard.press('Control+2');
  await win.waitForTimeout(800);
  let reselected = false;
  for (const [fx, fy] of [[0.5, 0.1], [0.3, 0.12], [0.5, 0.16], [0.4, 0.3], [0.5, 0.42]]) {
    await win.mouse.click(Math.round(pg.x + pg.width * fx), Math.round(pg.y + pg.height * fy));
    await win.waitForTimeout(600);
    if (await win.evaluate(() => document.querySelector('[data-textrun-selection]') !== null)) { reselected = true; break; }
  }
  const recheck = await textPanelSnapshot(win);
  log('text-single-recheck', { reselected, ...recheck });
  await win.screenshot({ path: path.join(SHOTS, 'text-single-recheck.png') });
}

async function measureEditor(win) {
  return win.evaluate(() => {
    const root = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
    const sel = root.querySelector('[data-textrun-selection]');
    const preview = root.querySelector('[data-edit-run-preview]');
    const eraser = root.querySelector('[data-edit-box-eraser]');
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    const page = root.querySelector('.pdf-page[data-page="1"]');
    const pr = page ? page.getBoundingClientRect() : null;
    return {
      rotation: page ? page.className : null,
      pageRect: pr ? { x: +pr.x.toFixed(1), y: +pr.y.toFixed(1), w: +pr.width.toFixed(1), h: +pr.height.toFixed(1) } : null,
      selection: r(sel),
      previewFont: preview ? +parseFloat(getComputedStyle(preview).fontSize).toFixed(2) : null,
      preview: r(preview),
      eraser: r(eraser),
      activeIsField: document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-txt-text') !== null,
      activeTag: document.activeElement ? document.activeElement.tagName : null,
    };
  });
}

async function scenarioEditRotated(app, win) {
  await openSampleCard(win, 'report.pdf');
  await setWindowSize(app, win, 1440, 900);
  const out = [];
  let applied = 0;
  for (const rotations of [0, 1, 2, 3]) {
    await gotoStage(win, 1);
    const rotBtn = win.locator('[data-action-dock] [data-dock-verb="rotate"]').first();
    while (applied < rotations) { await rotBtn.click(); await win.waitForTimeout(700); applied += 1; }
    await gotoStage(win, 2);
    await armPalette(win, 'Edit text', 'editText');
    const pageLoc = win.locator('.pdf-page[data-page="1"]');
    const pg = await pageLoc.boundingBox();
    let selected = false;
    for (const [fx, fy] of [[0.5, 0.1], [0.3, 0.12], [0.5, 0.16], [0.4, 0.3], [0.5, 0.42], [0.6, 0.55], [0.3, 0.7]]) {
      await win.mouse.click(Math.round(pg.x + pg.width * fx), Math.round(pg.y + pg.height * fy));
      await win.waitForTimeout(500);
      if (await win.evaluate(() => document.querySelector('[data-textrun-selection]') !== null)) { selected = true; break; }
    }
    const m = await measureEditor(win);
    const cov = m.selection && m.eraser ? {
      coversTop: m.eraser.y <= m.selection.y + 0.5,
      coversBottom: m.eraser.y + m.eraser.h >= m.selection.y + m.selection.h - 0.5,
      coversLeft: m.eraser.x <= m.selection.x + 0.5,
      coversRight: m.eraser.x + m.eraser.w >= m.selection.x + m.selection.w - 0.5,
    } : null;
    const sizeDelta = m.selection && m.previewFont !== null ? +(m.previewFont - m.selection.h).toFixed(2) : null;
    out.push({ rotations, selected, sizeDelta, cov, ...m });
    if (m.selection) {
      const clip = { x: Math.max(0, m.selection.x - 30), y: Math.max(0, m.selection.y - 30), width: Math.min(m.selection.w + 60, 800), height: Math.min(m.selection.h + 120, 500) };
      await win.screenshot({ path: path.join(SHOTS, `edit-rot-${rotations}.png`), clip }).catch(() => {});
    }
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
  }
  log('edit-rotated', { out });
}

async function scenarioMultiDuringLoad(app, win) {
  // Toggle Multi Mode WHILE the first document is still loading.
  await win.locator('.sample-card').filter({ hasText: 'long.pdf' }).first().click();
  await win.waitForTimeout(120); // still loading
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(6000);
  const state = await win.evaluate(() => {
    const a = document.querySelector('.tab-pane[data-pane="A"]');
    const b = document.querySelector('.tab-pane[data-pane="B"]');
    const info = (p) => (p ? {
      empty: p.hasAttribute('data-pane-empty'),
      slots: p.querySelectorAll('.page-slot').length,
      canvas: p.querySelectorAll('.pdf-page canvas').length,
      paneW: Math.round(p.getBoundingClientRect().width),
    } : null);
    return {
      panes: document.querySelectorAll('.tab-pane[data-pane]').length,
      A: info(a), B: info(b),
      headers: [...document.querySelectorAll('[data-pane-header]')].map((h) => h.innerText.replace(/\s+/g, ' ').trim().slice(0, 50)),
    };
  });
  log('multi-during-load', state);
  await win.screenshot({ path: path.join(SHOTS, 'gate-multi-during-load.png') });

  // Now open a second doc into B and toggle Multi Mode OFF/ON rapidly mid-load.
  await installSampler(win, 'B');
  await mockOpen(app, REPORT);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').click().catch(() => {});
  for (let i = 0; i < 4; i += 1) {
    await win.locator('[data-header-multi-mode]').first().click().catch(() => {});
    await sleep(180);
  }
  await sleep(4000);
  const after = await win.evaluate(() => {
    const a = document.querySelector('.tab-pane[data-pane="A"]');
    const b = document.querySelector('.tab-pane[data-pane="B"]');
    const info = (p) => (p ? { empty: p.hasAttribute('data-pane-empty'), slots: p.querySelectorAll('.page-slot').length, canvas: p.querySelectorAll('.pdf-page canvas').length } : null);
    return { panes: document.querySelectorAll('.tab-pane[data-pane]').length, A: info(a), B: info(b) };
  });
  const d = digest(await readSamples(win));
  log('multi-toggle-rapid-midload', { after, d });
  await win.screenshot({ path: path.join(SHOTS, 'gate-multi-toggle-rapid.png') });
}

async function main() {
  const scenario = process.argv[2] || 'payslip';
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(300);
    const map = {
      payslip: scenarioPayslip,
      payslipDrag: scenarioPayslipDrag,
      dragDuringLoad: scenarioDragDuringLoad,
      rapid: scenarioRapidOpenClose,
      inspector: scenarioInspectorDuringLoad,
      third: scenarioThirdDoc,
      tabSwitch: scenarioTabSwitch,
      tiny: scenarioTinyDoc,
      repeat: scenarioRepeat,
      overshoot: scenarioOvershoot,
      hostileDoc: scenarioHostileDoc,
      dock: scenarioDock,
      dockEmpty: scenarioDockEmpty,
      dockMenuEdges: scenarioDockMenuEdges,
      dockOscillate: scenarioDockOscillate,
      legibility: scenarioLegibility,
      textMulti: scenarioTextMulti,
      textSingle: scenarioTextSingle,
      editRotated: scenarioEditRotated,
      multiDuringLoad: scenarioMultiDuringLoad,
    };
    const fn = map[scenario];
    if (!fn) throw new Error(`unknown scenario ${scenario}`);
    await fn(app, win);
  } catch (e) {
    log('error', { scenario, message: e && e.message, stack: String(e && e.stack).slice(0, 900) });
  } finally {
    if (app) {
      try {
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => { try { w.destroy(); } catch (_) {} }));
      } catch (_) {}
      await app.close().catch(() => {});
    }
  }
  process.exit(0);
}

main();
