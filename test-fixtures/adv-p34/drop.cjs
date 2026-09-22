// ADV phase-34: the insertion line (canvas + rail) under stress: first page,
// last page, append, 1-page doc, empty pane, hover leaving all slots, and the
// rail append at the very bottom of a 520-page document. Real dev build.
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
function note(s) { const l = `[adv34-drop] ${s}`; console.log(l); lines.push(l); }
function finding(t, sev, d) { findings.push({ title: t, severity: sev, detail: d }); note(`FINDING (${sev}): ${t} :: ${JSON.stringify(d)}`); }

const ONE = path.join(C.FIX, 'adv-p34', 'one-page.pdf');
const TWO = path.join(C.FIX, 'adv-p34', 'two-page.pdf');

async function synthStep(win, step, arg) {
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
      const ev = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.25 });
      tgt.dispatchEvent(ev);
      return { ok: true, prevented: ev.defaultPrevented, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
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

async function canvasState(win, pane) {
  return win.evaluate((p) => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
    const inds = Array.from(document.querySelectorAll(`.tab-pane[data-pane="${p}"] [data-drop-indicator]`)).map((el) => ({ side: el.getAttribute('data-drop-indicator'), page: el.getAttribute('data-drop-page'), rect: r(el) }));
    const slots = Array.from(document.querySelectorAll(`.tab-pane[data-pane="${p}"] .page-slot`)).map((el) => ({ page: el.getAttribute('data-page'), rect: r(el) }));
    return { indicators: inds, slotCount: slots.length, slots: slots.slice(0, 6) };
  }, pane);
}
async function railState(win, pane) {
  return win.evaluate((p) => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
    const lines = Array.from(document.querySelectorAll(`[data-pane-strip-pane="${p}"] [data-thumb-drop-line]`)).map((el) => ({ cls: el.className, rect: r(el) }));
    const thumbs = Array.from(document.querySelectorAll(`[data-pane-strip-pane="${p}"] .thumb-item`)).map((el) => el.getAttribute('data-page'));
    return { lines, thumbCount: thumbs.length, firstThumb: thumbs[0], lastThumb: thumbs[thumbs.length - 1] };
  }, pane);
}

async function setup(app, win, tag, aPath, bPath, nameA, nameB) {
  const alpha = C.tmpCopy(aPath, nameA);
  const beta = C.tmpCopy(bPath || C.LONG, nameB);
  await C.openFile(app, win, alpha); await win.waitForTimeout(700);
  await C.openFile(app, win, beta); await win.waitForTimeout(700);
  await win.locator('.tab[data-tab-id]').filter({ hasText: nameA.split('-').slice(2).join('-') || nameA }).first().click().catch(async () => {
    await win.locator('.tab[data-tab-id]').first().click();
  });
  await win.waitForTimeout(300);
  await win.locator('[data-toolbar-multi-mode]:visible').first().click();
  await win.waitForTimeout(500);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: nameB }).first().click();
  await win.waitForTimeout(1600);
  return { alpha, beta };
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
  // ---- first page, last page, hover-leave ----
  await withApp('D1-boundaries', async (app, win) => {
    await setup(app, win, 'd1', C.REPORT, C.LONG, 'adv34-d1-alpha.pdf', 'adv34-d1-beta.pdf');
    const src = '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]';
    await win.evaluate(() => { const sc = document.querySelector('.tab-pane[data-pane="B"] .document-scroller'); if (sc) sc.scrollTop = 0; });
    await win.waitForTimeout(600);
    await synthStep(win, 'start', { src });
    await win.waitForTimeout(200);

    // FIRST page before-line
    await synthStep(win, 'over', { tgt: '.tab-pane[data-pane="B"] .page-slot[data-page="1"]' });
    await win.waitForTimeout(400);
    let cs = await canvasState(win, 'B');
    note(`first-page: indicators=${JSON.stringify(cs.indicators)} slots=${cs.slotCount}`);
    const before1 = cs.indicators.find((i) => i.side === 'before' && i.page === '1');
    if (!before1) finding('No canvas before-line for the FIRST page slot', 'MEDIUM', { cs });
    else if (before1.rect.top < cs.slots[0].rect.top - 8) finding('First-page line sits above the first slot / clipped', 'LOW', { before1, slot: cs.slots[0] });

    // hover the pane header (leaves all slots within the pane) -> line clears
    await synthStep(win, 'over', { tgt: '.tab-pane[data-pane="B"] [data-pane-header]' });
    await win.waitForTimeout(400);
    cs = await canvasState(win, 'B');
    note(`hover-header: indicators=${JSON.stringify(cs.indicators)}`);
    if (cs.indicators.length > 0) finding('Insertion line survives a hover that leaves all page slots', 'MEDIUM', { cs });

    // LAST page after-line (canvas)
    const lastPage = 520;
    await win.evaluate((p) => {
      const sc = document.querySelector('.tab-pane[data-pane="B"] .document-scroller');
      const slot = document.querySelector(`.tab-pane[data-pane="B"] .page-slot[data-page="${p}"]`);
      if (sc && slot) sc.scrollTop = slot.offsetTop - 200;
    }, lastPage);
    await win.waitForTimeout(1200);
    const hasLast = await win.locator(`.tab-pane[data-pane="B"] .page-slot[data-page="${lastPage}"]`).count();
    note(`last page slot ${lastPage} mounted=${hasLast}`);
    if (hasLast > 0) {
      await synthStep(win, 'over', { tgt: `.tab-pane[data-pane="B"] .page-slot[data-page="${lastPage}"]` });
      await win.waitForTimeout(400);
      cs = await canvasState(win, 'B');
      note(`last-page indicators=${JSON.stringify(cs.indicators.slice(-3))}`);
      const afterLast = cs.indicators.find((i) => i.side === 'after' && i.page === String(lastPage));
      if (!afterLast) finding(`No canvas after-line for the LAST page slot (page ${lastPage})`, 'MEDIUM', { cs });
    }
    await synthStep(win, 'end', { src });
  });

  // ---- 1-page document ----
  await withApp('D2-one-page', async (app, win) => {
    await setup(app, win, 'd2', ONE, C.REPORT, 'adv34-d2-one.pdf', 'adv34-d2-beta.pdf');
    const src = '[data-pane-strip-pane="B"] .thumb-item[data-page="1"]';
    // pane A = one page
    await synthStep(win, 'start', { src });
    await win.waitForTimeout(200);
    await synthStep(win, 'over', { tgt: '.tab-pane[data-pane="A"] .page-slot[data-page="1"]' });
    await win.waitForTimeout(400);
    const cs = await canvasState(win, 'A');
    note(`one-page: slotCount=${cs.slotCount} indicators=${JSON.stringify(cs.indicators)}`);
    if (cs.slotCount !== 1) finding('1-page pane did not mount exactly one slot', 'LOW', { cs });
    if (cs.indicators.length === 0) finding('No insertion line for a 1-page document', 'MEDIUM', { cs });
    await synthStep(win, 'end', { src });
  });

  // ---- empty pane ----
  await withApp('D3-empty-pane', async (app, win) => {
    const alpha = C.tmpCopy(C.REPORT, 'adv34-d3-alpha.pdf');
    const beta = C.tmpCopy(C.LONG, 'adv34-d3-beta.pdf');
    await C.openFile(app, win, alpha); await win.waitForTimeout(700);
    await C.openFile(app, win, beta); await win.waitForTimeout(700);
    await win.locator('.tab[data-tab-id]').filter({ hasText: 'adv34-d3-alpha' }).first().click();
    await win.waitForTimeout(300);
    await win.locator('[data-toolbar-multi-mode]:visible').first().click();
    await win.waitForTimeout(700);
    const src = '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]';
    await synthStep(win, 'start', { src });
    await win.waitForTimeout(200);
    const r = await synthStep(win, 'over', { tgt: '.tab-pane[data-pane="B"][data-pane-empty] .multi-pane-empty' });
    await win.waitForTimeout(400);
    const cs = await canvasState(win, 'B');
    note(`empty pane: over-result=${JSON.stringify(r)} indicators=${JSON.stringify(cs.indicators)}`);
    if (cs.indicators.length > 0) finding('Insertion line drawn inside an EMPTY pane', 'LOW', { cs });
    await synthStep(win, 'end', { src });
  });

  // ---- rail: first thumb, append at the very bottom of 520 pages ----
  await withApp('D4-rail', async (app, win) => {
    await setup(app, win, 'd4', C.REPORT, C.LONG, 'adv34-d4-alpha.pdf', 'adv34-d4-beta.pdf');
    const src = '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]';
    await synthStep(win, 'start', { src });
    await win.waitForTimeout(200);
    // first thumb of B
    await synthStep(win, 'over', { tgt: '[data-pane-strip-pane="B"] .thumb-item[data-page="1"]' });
    await win.waitForTimeout(400);
    let rs = await railState(win, 'B');
    note(`rail first: ${JSON.stringify(rs)}`);
    if (rs.lines.length === 0) finding('No rail insertion line for the FIRST thumb', 'MEDIUM', { rs });
    else if (rs.lines[0].rect.top < 0) note('rail first line top negative (potential clip)');

    // scroll the rail to the very bottom of the 520-page doc
    await win.evaluate(() => {
      const sc = document.querySelector('[data-pane-strip-pane="B"] .thumb-scroller') || document.querySelector('[data-pane-strip-pane="B"]');
      if (sc) sc.scrollTop = sc.scrollHeight;
    });
    await win.waitForTimeout(1500);
    rs = await railState(win, 'B');
    note(`rail after scroll-to-end: thumbCount=${rs.thumbCount} first=${rs.firstThumb} last=${rs.lastThumb} lines=${JSON.stringify(rs.lines)}`);
    const lastPage = 520;
    // hover the empty space below the last thumb (the scroller, near bottom)
    await synthStep(win, 'over', { tgt: '[data-pane-strip-pane="B"] .thumb-scroller' });
    await win.waitForTimeout(500);
    rs = await railState(win, 'B');
    note(`rail append after scroll: ${JSON.stringify(rs)}`);
    const append = rs.lines.find((l) => l.cls.includes('thumb-drop-line-after'));
    if (!append) finding('No rail append line after scrolling the 520-page rail to the end', 'MEDIUM', { rs });
    else if (append.rect.top < 0 || append.rect.bottom > 20000) note('append line rect odd: ' + JSON.stringify(append.rect));
    await synthStep(win, 'end', { src });
    await win.waitForTimeout(400);
    rs = await railState(win, 'B');
    if (rs.lines.length > 0) finding('Rail insertion line(s) survive drag end', 'MEDIUM', { rs });
  });

  fs.writeFileSync(path.join(OUT, 'drop.log'), lines.join('\n') + '\n', 'utf8');
  note(`TOTAL FINDINGS: ${findings.length}`);
  console.log(`\n=== SUMMARY ===\n${JSON.stringify(findings, null, 2)}`);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exitCode = 2; });