// ADV phase-34: corrected drop-line probes (last-page append via lower-half
// hover, hover-leave via a real dragleave, rail append after a real scroll).
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
function note(s) { const l = `[adv34-drop2] ${s}`; console.log(l); lines.push(l); }
function finding(t, sev, d) { findings.push({ title: t, severity: sev, detail: d }); note(`FINDING (${sev}): ${t} :: ${JSON.stringify(d)}`); }

async function dispatch(win, step, arg) {
  return win.evaluate(({ step: s, arg: a }) => {
    const KEY = '__p34dt';
    if (s === 'start') {
      const src = document.querySelector(a.src);
      if (!src) return { ok: false, reason: 'no-src' };
      const dt = new DataTransfer();
      window[KEY] = dt;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { ok: true };
    }
    const dt = window[KEY];
    if (!dt) return { ok: false, reason: 'no-dt' };
    if (s === 'over') {
      const tgt = document.querySelector(a.tgt);
      if (!tgt) return { ok: false, reason: 'no-tgt' };
      const r = tgt.getBoundingClientRect();
      const y = a.lower ? r.top + r.height * 0.8 : r.top + r.height * 0.25;
      const ev = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: y });
      tgt.dispatchEvent(ev);
      return { ok: true, prevented: ev.defaultPrevented };
    }
    if (s === 'leave') {
      const tgt = document.querySelector(a.tgt);
      if (tgt) tgt.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: dt, relatedTarget: document.body }));
      return { ok: true };
    }
    if (s === 'end') {
      const src = document.querySelector(a.src);
      if (src) src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      delete window[KEY];
      return { ok: true };
    }
    return { ok: false, reason: 'bad-step' };
  }, { step, arg });
}
async function canvasInd(win, pane) {
  return win.evaluate((p) => Array.from(document.querySelectorAll(`.tab-pane[data-pane="${p}"] [data-drop-indicator]`)).map((el) => { const b = el.getBoundingClientRect(); return { side: el.getAttribute('data-drop-indicator'), page: el.getAttribute('data-drop-page'), top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; }), pane);
}
async function railLines(win, pane) {
  return win.evaluate((p) => {
    const sc = document.querySelector(`[data-pane-strip-pane="${p}"] .thumb-scroller-inner`);
    return {
      scrollTop: sc ? sc.scrollTop : null,
      scrollHeight: sc ? sc.scrollHeight : null,
      clientHeight: sc ? sc.clientHeight : null,
      lines: Array.from(document.querySelectorAll(`[data-pane-strip-pane="${p}"] [data-thumb-drop-line]`)).map((el) => { const b = el.getBoundingClientRect(); return { cls: el.className, top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), w: Math.round(b.width) }; }),
      lastThumb: (() => { const t = document.querySelector(`[data-pane-strip-pane="${p}"] .thumb-item[data-page="520"]`); if (!t) return null; const b = t.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; })(),
    };
  }, pane);
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
  await withApp('E1-boundaries2', async (app, win) => {
    await setup(app, win, 'e1');
    const src = '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]';
    await win.evaluate(() => { const sc = document.querySelector('.tab-pane[data-pane="B"] .document-scroller'); if (sc) sc.scrollTop = 0; });
    await win.waitForTimeout(600);
    await dispatch(win, 'start', { src });
    await win.waitForTimeout(200);

    // FIRST page before-line + screenshot to judge the header overlap.
    await dispatch(win, 'over', { tgt: '.tab-pane[data-pane="B"] .page-slot[data-page="1"]' });
    await win.waitForTimeout(400);
    const first = await canvasInd(win, 'B');
    const headerB = await win.evaluate(() => { const h = document.querySelector('.tab-pane[data-pane="B"] [data-pane-header]'); const b = h.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; });
    note(`first page line=${JSON.stringify(first)} headerB=${JSON.stringify(headerB)}`);
    if (first[0] && first[0].top < headerB.bottom) note(`NOTE: first-page line top ${first[0].top} is above the header bottom ${headerB.bottom} (overlaps the header band)`);
    await win.screenshot({ path: path.join(C.SHOTS, 'adv-p34-firstpage-line.png') });

    // LEAVE: real dragleave -> line must clear
    await dispatch(win, 'leave', { tgt: '.tab-pane[data-pane="B"] .document-scroller' });
    await win.waitForTimeout(400);
    let after = await canvasInd(win, 'B');
    note(`after dragleave on scroller: ${JSON.stringify(after)}`);
    if (after.length > 0) finding('Canvas insertion line survives a dragleave that leaves the pane', 'MEDIUM', { after });

    // LAST page append via lower-half hover
    await win.evaluate(() => { const sc = document.querySelector('.tab-pane[data-pane="B"] .document-scroller'); const s = document.querySelector('.tab-pane[data-pane="B"] .page-slot[data-page="520"]'); if (sc && s) sc.scrollTop = s.offsetTop - 200; });
    await win.waitForTimeout(1200);
    await dispatch(win, 'over', { tgt: '.tab-pane[data-pane="B"] .page-slot[data-page="520"]', lower: true });
    await win.waitForTimeout(400);
    const last = await canvasInd(win, 'B');
    note(`last-page lower-half line=${JSON.stringify(last)}`);
    const append = last.find((i) => i.side === 'after' && i.page === '-1');
    if (!append) finding('No canvas append line hovering the LOWER half of the LAST page', 'MEDIUM', { last });
    await win.screenshot({ path: path.join(C.SHOTS, 'adv-p34-lastpage-append.png') });
    await dispatch(win, 'end', { src });
  });

  await withApp('E2-rail-bottom', async (app, win) => {
    await setup(app, win, 'e2');
    const src = '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]';
    await dispatch(win, 'start', { src });
    await win.waitForTimeout(200);
    // scroll the real rail scroller to the end
    await win.evaluate(() => {
      const sc = document.querySelector('[data-pane-strip-pane="B"] .thumb-scroller-inner');
      if (sc) sc.scrollTop = sc.scrollHeight;
    });
    await win.waitForTimeout(1500);
    let rs = await railLines(win, 'B');
    note(`rail scrolled: ${JSON.stringify({ scrollTop: rs.scrollTop, scrollHeight: rs.scrollHeight, clientHeight: rs.clientHeight, lastThumb: rs.lastThumb })}`);
    // hover the empty space below the last thumb: dispatch on the inner scroller
    await dispatch(win, 'over', { tgt: '[data-pane-strip-pane="B"] .thumb-scroller-inner' });
    await win.waitForTimeout(500);
    rs = await railLines(win, 'B');
    note(`rail append at bottom: lines=${JSON.stringify(rs.lines)} lastThumb=${JSON.stringify(rs.lastThumb)}`);
    const appLine = rs.lines.find((l) => l.cls.includes('thumb-drop-line-after'));
    if (!appLine) finding('No rail append line at the bottom of the 520-page rail after scrolling to the end', 'MEDIUM', { rs });
    else if (rs.lastThumb && appLine.top < rs.lastThumb.bottom - 2) finding('Rail append line is not below the last thumb', 'LOW', { appLine, rs });
    // is the append line inside the visible viewport?
    const vp = await win.evaluate(() => window.innerHeight);
    if (appLine && (appLine.bottom < 0 || appLine.top > vp)) note(`NOTE: rail append line not visible in viewport (top ${appLine.top}, vp ${vp})`);
    await win.screenshot({ path: path.join(C.SHOTS, 'adv-p34-rail-append-bottom.png') });
    await dispatch(win, 'end', { src });
    await win.waitForTimeout(400);
    rs = await railLines(win, 'B');
    if (rs.lines.length > 0) finding('Rail line survives drag end at the bottom', 'MEDIUM', { rs });
  });

  fs.writeFileSync(path.join(OUT, 'drop2.log'), lines.join('\n') + '\n', 'utf8');
  note(`TOTAL FINDINGS: ${findings.length}`);
  console.log(`\n=== SUMMARY ===\n${JSON.stringify(findings, null, 2)}`);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exitCode = 2; });