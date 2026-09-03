// QA verification round 3 for DEF-152..159 on installed v1.7.23.
//   T1: DEF-155 tail — Confirm-then-sample (skip the first repaint-race
//       samples), save/reopen verified via the textLayer run count + canvas
//       control sample (proves the canvas was painted when sampled).
//   T2: DEF-153/154 — arrow + callout probed with kind-strict selectors
//       (round 2 matched the page-wide ann-callout-arrow svg by substring).
//   T3: DEF-154 resize deep-check — document-wide scan for resize affordances
//       (any handle-like element, HTML or SVG) near each selected shape.
// Launch only via e2e/lib/launch.cjs. Real mouse events only.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(480000);

let electronApp = null;
let win = null;
const pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([], null, EXE_PATH);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  win.on('pageerror', (err) => {
    const m = err && err.message ? err.message : String(err);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  await hardClose(electronApp);
  electronApp = null;
  win = null;
});

async function shot(name) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  process.stdout.write(`[SHOT] ${name}\n`);
  return p;
}

async function cropShot(name, rect) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p, clip: rect });
  process.stdout.write(`[CROP] ${name} ${JSON.stringify(rect)}\n`);
  return p;
}

async function openSampleFromCard(name) {
  await win.locator(`.sample-card:has-text("${name}")`).first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
}

async function scrollToPage(n) {
  await win.evaluate((pg) => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  }, n);
  await win.waitForTimeout(1200);
}

async function scrollStable() {
  let last = null;
  for (let i = 0; i < 12; i++) {
    const st = await win.evaluate(() => {
      const sc = document.querySelector('.document-scroller');
      return sc ? sc.scrollTop : -1;
    });
    if (last !== null && Math.abs(st - last) < 1) return st;
    last = st;
    await win.waitForTimeout(300);
  }
  return last;
}

async function pageRect(n) {
  return await win.evaluate((pg) => {
    const page = document.querySelector(`.page-slot[data-page="${pg}"] .pdf-page`);
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    const el = page || slot;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, n);
}

async function cursorAt(x, y) {
  return await win.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    if (!el) return { cursor: null, hit: null };
    let cur = el;
    let cursor = 'auto';
    for (let i = 0; i < 14 && cur; i++) {
      const c = getComputedStyle(cur).cursor;
      if (c && c !== 'auto') { cursor = c; break; }
      cur = cur.parentElement;
    }
    const cls = (e) => {
      const s = e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className;
      return String(s || '').split(' ').filter(Boolean).slice(0, 4).join('.');
    };
    return {
      cursor,
      hit: `${el.tagName.toLowerCase()}.${cls(el)}`,
      pe: getComputedStyle(el).pointerEvents,
    };
  }, [x, y]);
}

// Visible buttons inside SMALL floating bars intersecting the area.
async function overPageButtons(areaRect) {
  return await win.evaluate((area) => {
    const out = [];
    for (const b of document.querySelectorAll('button, [role="button"]')) {
      const r = b.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(b);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
      let bar = b.parentElement;
      let barCls = '';
      let br = null;
      for (let i = 0; i < 8 && bar; i++) {
        const pcs = getComputedStyle(bar);
        if (pcs.position === 'absolute' || pcs.position === 'fixed') {
          const rr = bar.getBoundingClientRect();
          if (rr.width <= 950 && rr.height <= 320) {
            const s = bar.className && bar.className.baseVal !== undefined ? bar.className.baseVal : bar.className;
            barCls = String(s || '').split(' ').filter(Boolean).slice(0, 4).join('.');
            br = rr;
          }
          break;
        }
        bar = bar.parentElement;
      }
      if (!br) continue;
      const intersects = br.x < area.x + area.w + 360 && br.x + br.width > area.x - 60
        && br.y < area.y + area.h + 220 && br.y + br.height > area.y - 60;
      if (!intersects) continue;
      out.push({
        text: (b.textContent || '').trim(),
        aria: b.getAttribute('aria-label'),
        act: b.getAttribute('data-annotation-action')
          || b.getAttribute('data-edit-box-action')
          || b.getAttribute('data-edit-action')
          || b.getAttribute('data-shape-action')
          || null,
        bar: { cls: barCls, x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height) },
        btn: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
      });
    }
    return out;
  }, areaRect);
}

async function scanHint(label) {
  const found = await win.evaluate(() => {
    const hits = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const t = (node.textContent || '').trim();
      if (/double.?click/i.test(t)) hits.push({ text: t.slice(0, 60), via: 'text' });
      node = walker.nextNode();
    }
    return hits;
  });
  process.stdout.write(`[RES|HINT|${label}] ${JSON.stringify(found)}\n`);
  return found;
}

async function canvasDark(pageNum, rect) {
  return await win.evaluate(([pg, rc]) => {
    const canvas = document.querySelector(`.page-slot[data-page="${pg}"] .pdf-page canvas`);
    if (!canvas) return null;
    const cr = canvas.getBoundingClientRect();
    const sx = Math.max(0, Math.round((rc.x - cr.x) * (canvas.width / cr.width)));
    const sy = Math.max(0, Math.round((rc.y - cr.y) * (canvas.height / cr.height)));
    const sw = Math.max(1, Math.round(rc.w * (canvas.width / cr.width)));
    const sh = Math.max(1, Math.round(rc.h * (canvas.height / cr.height)));
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(sx, sy, Math.min(sw, canvas.width - sx), Math.min(sh, canvas.height - sy));
    let dark = 0;
    const total = img.data.length / 4;
    for (let i = 0; i < img.data.length; i += 4) {
      const l = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
      if (l < 128) dark++;
    }
    return Math.round((dark / total) * 10000) / 10000;
  }, [pageNum, rect]);
}

async function noPageErrors(label) {
  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  process.stdout.write(`[PAGEERRORS|${label}] ${JSON.stringify(pageErrors)}\n`);
  expect(bad, 'no pageerrors').toHaveLength(0);
}

// ---------------------------------------------------------------------------
// T1: DEF-155 tail — confirm-then-sample + textLayer-verified save/reopen
// ---------------------------------------------------------------------------
test('T1 DEF-155: confirm clears old rect; saved file carries the move', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage(1);
  await scrollStable();
  const pr = await pageRect(1);
  expect(pr, 'page 1 must be mounted').toBeTruthy();

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  const p0 = { x: pr.x + pr.w * 0.16, y: pr.y + pr.h * 0.14 };
  await win.mouse.move(p0.x, p0.y);
  await win.mouse.down();
  await win.mouse.move(p0.x + 150, p0.y + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(700);
  const ta = win.locator('[data-edit-textarea]').first();
  await ta.waitFor({ timeout: 10000 });
  await ta.fill('MOVE TEST 88');
  await win.waitForTimeout(250);
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(1800);

  const R0 = await win.evaluate(() => {
    const b = document.querySelector('.edit-box[data-edit-box-id]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  expect(R0, 'committed box must exist').toBeTruthy();

  const start = { x: R0.x + R0.w / 2, y: R0.y + R0.h / 2 };
  await win.mouse.move(start.x, start.y);
  await win.mouse.down();
  await win.mouse.move(start.x + 200, start.y + 120, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(200);

  const confirmBtn = await win.evaluate(() => {
    for (const b of document.querySelectorAll('.edit-box-toolbar button')) {
      if (/confirm/i.test(b.textContent || '')) {
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  });
  expect(confirmBtn, 'Confirm button present').toBeTruthy();
  await win.mouse.click(confirmBtn.x, confirmBtn.y);

  const R1 = await win.evaluate(() => {
    const b = document.querySelector('.edit-box[data-edit-box-id]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  process.stdout.write(`[RES|MOVE] R0=${JSON.stringify(R0)} R1=${JSON.stringify(R1)}\n`);

  // Poll from t=500ms (the engine repaint lands between 250-500ms).
  const samples = [];
  for (let i = 0; i < 12; i++) {
    const t = 500 + i * 250;
    const dR0 = await canvasDark(1, { x: R0.x + 6, y: R0.y + 6, w: R0.w - 12, h: R0.h - 12 });
    samples.push({ t, dR0 });
    if (i === 0) await shot('def-155-1723c-postconfirm-500ms.png');
    await win.waitForTimeout(250);
  }
  for (const s of samples) process.stdout.write(`[POLL t=${s.t}ms] darkR0=${s.dR0}\n`);
  const maxPost = Math.max(...samples.map((s) => s.dR0 || 0));
  process.stdout.write(`[RES|DEF155-POSTCONFIRM] maxDarkR0(t>=500)=${maxPost}\n`);

  // Save As + reopen; verify via textLayer runs + canvas with a control sample.
  const savePath = path.join(os.tmpdir(), `tflex-def155c-${Date.now()}.pdf`);
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  for (let i = 0; i < 20 && !fs.existsSync(savePath); i++) await win.waitForTimeout(500);
  expect(fs.existsSync(savePath), 'saved file exists').toBe(true);

  const pageNow = await pageRect(1);
  const relR0 = { x: (R0.x - pageNow.x) / pageNow.w, y: (R0.y - pageNow.y) / pageNow.h, w: R0.w / pageNow.w, h: R0.h / pageNow.h };

  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await win.locator('button.btn-primary:has-text("Open")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2500);
  await scrollToPage(1);
  await scrollStable();
  await win.waitForTimeout(1500);
  const pr2 = await pageRect(1);
  expect(pr2, 'reopened page 1 mounted').toBeTruthy();

  const reopened = await win.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    const runs = [];
    for (const s of spans) {
      if ((s.textContent || '').includes('MOVE TEST 88')) {
        const r = s.getBoundingClientRect();
        runs.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    // control: the title run must be visible (canvas painted)
    const title = spans.find((s) => (s.textContent || '').includes('TFlex Technical Report'));
    const tr = title ? title.getBoundingClientRect() : null;
    return { runs, titleRect: tr ? { x: Math.round(tr.x), y: Math.round(tr.y), w: Math.round(tr.width), h: Math.round(tr.height) } : null };
  });
  process.stdout.write(`[RES|DEF155-REOPENED-RUNS] count=${reopened.runs.length} runs=${JSON.stringify(reopened.runs)} title=${JSON.stringify(reopened.titleRect)}\n`);

  const oldRectAbs = {
    x: pr2.x + relR0.x * pr2.w + 6,
    y: pr2.y + relR0.y * pr2.h + 6,
    w: relR0.w * pr2.w - 12,
    h: relR0.h * pr2.h - 12,
  };
  const reopenedOld = await canvasDark(1, oldRectAbs);
  const reopenedTitleCtl = reopened.titleRect ? await canvasDark(1, reopened.titleRect) : null;
  const reopenedRun = reopened.runs.length ? await canvasDark(1, reopened.runs[0]) : null;
  process.stdout.write(`[RES|DEF155-REOPENED-CANVAS] oldRect=${reopenedOld} runRect=${reopenedRun} titleControl=${reopenedTitleCtl}\n`);
  await shot('def-155-1723c-reopened.png');
  if (reopened.runs.length) {
    await cropShot('def-155-1723c-reopened-run-crop.png', {
      x: Math.max(0, reopened.runs[0].x - 30), y: Math.max(0, reopened.runs[0].y - 30),
      width: Math.min(reopened.runs[0].w + 60, 700), height: Math.min(reopened.runs[0].h + 60, 260),
    });
  }

  expect(maxPost, 'DEF-155: after Confirm the old rect must be clean (<=0.5% dark)').toBeLessThanOrEqual(0.005);
  expect(reopenedTitleCtl === null || reopenedTitleCtl > 0.02, 'control: reopened canvas is painted').toBe(true);
  expect(reopened.runs.length, 'DOC SAFETY: exactly ONE visible MOVE TEST 88 in the saved file').toBe(1);
  expect(reopenedOld, 'DOC SAFETY: saved file must not carry the box at the old rect').toBeLessThanOrEqual(0.005);
  expect(reopenedRun === null || reopenedRun > 0.005, 'DOC SAFETY: box text visible at the moved position').toBe(true);
  await noPageErrors('T1');
});

// ---------------------------------------------------------------------------
// T2: arrow + callout with kind-strict discovery
// ---------------------------------------------------------------------------
test('T2 DEF-153+154: arrow + callout full interaction (light)', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage(4);
  await scrollStable();
  let pr = await pageRect(4);
  expect(pr, 'page 4 must be mounted').toBeTruthy();

  async function armAnnTool(tool) {
    await win.click(`[data-annotation-toolbar] [data-tool="${tool}"]`);
    await win.waitForTimeout(350);
  }
  async function drag(x, y, dx, dy) {
    await win.mouse.move(x, y);
    await win.mouse.down();
    await win.mouse.move(x + dx, y + dy, { steps: 8 });
    await win.mouse.up();
  }

  // Kind-strict: arrow -> g.ann-arrow[data-kind=arrow]; callout -> div.ann-callout[data-kind=callout]
  async function findStrict(kind) {
    return await win.evaluate((k) => {
      const slot = document.querySelector('.page-slot[data-page="4"]');
      if (!slot) return null;
      const sel = k === 'arrow' ? 'g.ann-arrow[data-kind="arrow"], [data-kind="arrow"]:not([data-kind="callout"])' : 'div.ann-callout[data-kind="callout"]';
      let best = null;
      for (const el of slot.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        const cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
        const cand = {
          tag: el.tagName.toLowerCase(),
          cls: String(cls || '').split(' ').filter(Boolean).slice(0, 4).join('.'),
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          pe: getComputedStyle(el).pointerEvents,
        };
        if (!best || cand.rect.w * cand.rect.h < best.rect.w * best.rect.h) best = cand; // smallest = the shape itself
      }
      return best;
    }, kind);
  }

  // commit arrow
  pr = await pageRect(4);
  await armAnnTool('arrow');
  await drag(pr.x + pr.w * 0.70, pr.y + pr.h * 0.06, 100, 60);
  await win.waitForTimeout(600);
  const arrowEl = await findStrict('arrow');
  process.stdout.write(`[COMMIT arrow] ${JSON.stringify(arrowEl)}\n`);
  expect(arrowEl, 'arrow committed').toBeTruthy();

  // commit callout
  pr = await pageRect(4);
  await armAnnTool('callout');
  await drag(pr.x + pr.w * 0.06, pr.y + pr.h * 0.32, pr.w * 0.18, pr.h * 0.06);
  await win.waitForTimeout(600);
  const coTa = win.locator('[data-annotation-editor="callout"] textarea');
  await coTa.waitFor({ timeout: 8000 });
  await coTa.fill('CALLOUT T42');
  await win.waitForTimeout(200);
  await win.click('[data-annotation-action="callout-confirm"]');
  await win.waitForTimeout(900);
  const calloutEl = await findStrict('callout');
  process.stdout.write(`[COMMIT callout] ${JSON.stringify(calloutEl)}\n`);
  expect(calloutEl, 'callout committed').toBeTruthy();

  await armAnnTool('select');
  await win.waitForTimeout(300);

  for (const [kind, el] of [['arrow', arrowEl], ['callout', calloutEl]]) {
    process.stdout.write(`--- probing ${kind} ---\n`);
    // refresh rect (scroll-independent? both were measured at the same scroll)
    const elNow = await findStrict(kind);
    const rect = elNow ? elNow.rect : el.rect;

    // hover at several points
    const hoverPts = kind === 'arrow'
      ? [0.3, 0.5, 0.7].map((t) => ({ x: rect.x + rect.w * t, y: rect.y + rect.h * t }))
      : [{ x: rect.x + Math.min(rect.w / 2, 80), y: rect.y + Math.min(rect.h / 2, 35) }];
    const hovers = [];
    for (const hp of hoverPts) {
      await win.mouse.move(hp.x, hp.y);
      await win.waitForTimeout(220);
      hovers.push({ pt: { x: Math.round(hp.x), y: Math.round(hp.y) }, ...await cursorAt(hp.x, hp.y) });
    }
    process.stdout.write(`[RES|${kind}-HOVER] ${JSON.stringify(hovers)}\n`);
    await shot(`def-153-1723c-${kind}-hover.png`);

    const probe = hoverPts[Math.floor(hoverPts.length / 2)];

    // move
    await win.mouse.move(probe.x, probe.y);
    await win.mouse.down();
    await win.mouse.move(probe.x + 70, probe.y + 45, { steps: 8 });
    const midHint = await scanHint(`${kind}-mid`);
    await win.mouse.up();
    await win.waitForTimeout(800);
    const afterMove = await findStrict(kind);
    const moved = afterMove ? (Math.abs(afterMove.rect.x - rect.x) > 5 || Math.abs(afterMove.rect.y - rect.y) > 5) : null;
    process.stdout.write(`[RES|${kind}-MOVE] before=${JSON.stringify(rect)} after=${JSON.stringify(afterMove && afterMove.rect)} moved=${moved} midHint=${midHint.length}\n`);
    await shot(`def-153-1723c-${kind}-moved.png`);

    // click state
    const el2 = await findStrict(kind);
    const pt2 = el2 ? { x: el2.rect.x + el2.rect.w * (kind === 'arrow' ? 0.5 : 0.4), y: el2.rect.y + el2.rect.h * (kind === 'arrow' ? 0.5 : 0.4) } : probe;
    await win.mouse.click(pt2.x, pt2.y);
    await win.waitForTimeout(800);
    const clickBtns = await overPageButtons(el2 ? el2.rect : rect);
    const hintClick = await scanHint(`${kind}-click`);
    await shot(`def-153-1723c-${kind}-selected.png`);
    process.stdout.write(`[RES|${kind}-CLICK] btns=${JSON.stringify(clickBtns.map((b) => `${b.text}|${b.bar.cls}`))} hint=${hintClick.length}\n`);

    // dblclick
    await win.mouse.dblclick(pt2.x, pt2.y);
    await win.waitForTimeout(800);
    const dblBtns = await overPageButtons(el2 ? el2.rect : rect);
    await shot(`def-153-1723c-${kind}-dblclick.png`);
    process.stdout.write(`[RES|${kind}-DBL] btns=${JSON.stringify(dblBtns.map((b) => `${b.text}|${b.bar.cls}`))}\n`);

    // close: Cancel via bar, else Escape + blank
    const cancel = dblBtns.find((b) => /cancel/i.test(`${b.text} ${b.aria || ''} ${b.act || ''}`));
    if (cancel) {
      await win.mouse.click(cancel.btn.x, cancel.btn.y);
      await win.waitForTimeout(400);
    } else {
      await win.keyboard.press('Escape');
      await win.waitForTimeout(300);
    }
    await win.mouse.click(pr.x + pr.w * 0.45, Math.min(pr.y + pr.h * 0.62, 1150));
    await win.waitForTimeout(400);

    // delete via bar
    const el3 = await findStrict(kind);
    if (el3) {
      const pt3 = { x: el3.rect.x + el3.rect.w * (kind === 'arrow' ? 0.5 : 0.4), y: el3.rect.y + el3.rect.h * (kind === 'arrow' ? 0.5 : 0.4) };
      await win.mouse.click(pt3.x, pt3.y);
      await win.waitForTimeout(800);
      const delBtn = (await overPageButtons(el3.rect)).find((b) => /delete/i.test(`${b.text} ${b.aria || ''} ${b.act || ''}`));
      let deleted = false;
      if (delBtn) {
        await win.mouse.click(delBtn.btn.x, delBtn.btn.y);
        await win.waitForTimeout(1000);
        deleted = !(await findStrict(kind));
      }
      process.stdout.write(`[RES|${kind}-DELETE] delBtn=${JSON.stringify(delBtn ? { text: delBtn.text, bar: delBtn.bar.cls } : null)} deleted=${deleted}\n`);
      await shot(`def-154-1723c-${kind}-after-delete.png`);
    }
  }

  await noPageErrors('T2');
});

// ---------------------------------------------------------------------------
// T3: resize affordance deep-check for shapes/ink
// ---------------------------------------------------------------------------
test('T3 DEF-154: resize affordances on selected shapes', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage(4);
  await scrollStable();
  let pr = await pageRect(4);
  expect(pr, 'page 4 must be mounted').toBeTruthy();

  async function armAnnTool(tool) {
    await win.click(`[data-annotation-toolbar] [data-tool="${tool}"]`);
    await win.waitForTimeout(350);
  }
  async function drag(x, y, dx, dy) {
    await win.mouse.move(x, y);
    await win.mouse.down();
    await win.mouse.move(x + dx, y + dy, { steps: 8 });
    await win.mouse.up();
  }
  async function findStrict(kind) {
    return await win.evaluate((k) => {
      const slot = document.querySelector('.page-slot[data-page="4"]');
      if (!slot) return null;
      const sels = {
        rect: 'rect.ann-shape[data-kind="rect"], rect[data-kind="rect"]',
        ellipse: 'ellipse[data-kind="ellipse"]',
        arrow: '[data-kind="arrow"]',
        ink: '[data-kind="ink"]',
      };
      let best = null;
      for (const el of slot.querySelectorAll(sels[k])) {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        const cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
        const cand = {
          tag: el.tagName.toLowerCase(),
          cls: String(cls || '').split(' ').filter(Boolean).slice(0, 4).join('.'),
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        };
        if (!best || cand.rect.w * cand.rect.h < best.rect.w * best.rect.h) best = cand;
      }
      return best;
    }, kind);
  }

  // commit all four
  pr = await pageRect(4);
  await armAnnTool('rect');
  await drag(pr.x + pr.w * 0.06, pr.y + pr.h * 0.06, 120, 70);
  await win.waitForTimeout(500);
  await armAnnTool('ellipse');
  await drag(pr.x + pr.w * 0.38, pr.y + pr.h * 0.06, 120, 70);
  await win.waitForTimeout(500);
  await armAnnTool('arrow');
  await drag(pr.x + pr.w * 0.70, pr.y + pr.h * 0.06, 100, 60);
  await win.waitForTimeout(500);
  await armAnnTool('ink');
  await drag(pr.x + pr.w * 0.06, pr.y + pr.h * 0.20, 130, 45);
  await win.waitForTimeout(500);
  await armAnnTool('select');
  await win.waitForTimeout(300);

  for (const kind of ['rect', 'ellipse', 'arrow', 'ink']) {
    const el = await findStrict(kind);
    if (!el) { process.stdout.write(`[RES|T3 ${kind}] not found\n`); continue; }
    const pt = {
      x: el.rect.x + el.rect.w * (kind === 'arrow' ? 0.5 : 0.4),
      y: el.rect.y + el.rect.h * (kind === 'arrow' ? 0.5 : 0.4),
    };
    await win.mouse.click(pt.x, pt.y);
    await win.waitForTimeout(800);

    // document-wide scan for ANY handle-like affordance near the shape
    const afford = await win.evaluate((rc) => {
      const out = [];
      for (const h of document.querySelectorAll('[class*="handle"], [class*="resize"], [class*="grip"], [data-handle], [data-resize], circle[class*="handle"], rect[class*="handle"]')) {
        const hr = h.getBoundingClientRect();
        if (hr.width < 2 || hr.height < 2) continue;
        const cs = getComputedStyle(h);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
        const cx = hr.x + hr.width / 2;
        const cy = hr.y + hr.height / 2;
        const near = cx >= rc.x - 40 && cx <= rc.x + rc.w + 40 && cy >= rc.y - 40 && cy <= rc.y + rc.h + 40;
        const s = h.className && h.className.baseVal !== undefined ? h.className.baseVal : h.className;
        out.push({
          tag: h.tagName.toLowerCase(),
          cls: String(s || '').split(' ').filter(Boolean).slice(0, 3).join('.'),
          x: Math.round(hr.x), y: Math.round(hr.y), w: Math.round(hr.width), h: Math.round(hr.height),
          nearShape: near,
        });
      }
      return out;
    }, el.rect);
    process.stdout.write(`[RES|T3 ${kind}] affordances=${JSON.stringify(afford)}\n`);
    await shot(`def-154-1723c-${kind}-selected.png`);
    await cropShot(`def-154-1723c-${kind}-selected-crop.png`, {
      x: Math.max(0, el.rect.x - 90), y: Math.max(0, el.rect.y - 90),
      width: Math.min(el.rect.w + 220, 800), height: Math.min(el.rect.h + 240, 560),
    });

    // try dragging the BR-most near affordance if any
    const near = afford.filter((a) => a.nearShape);
    if (near.length) {
      const brp = { x: el.rect.x + el.rect.w, y: el.rect.y + el.rect.h };
      let best = null; let bestD = Infinity;
      for (const h of near) {
        const d = Math.hypot(h.x + h.w / 2 - brp.x, h.y + h.h / 2 - brp.y);
        if (d < bestD) { bestD = d; best = h; }
      }
      const hx = best.x + best.w / 2;
      const hy = best.y + best.h / 2;
      await win.mouse.move(hx, hy);
      await win.mouse.down();
      await win.mouse.move(hx + 30, hy + 20, { steps: 6 });
      await win.mouse.up();
      await win.waitForTimeout(800);
      const el2 = await findStrict(kind);
      const delta = el2 ? { dw: Math.round(el2.rect.w - el.rect.w), dh: Math.round(el2.rect.h - el.rect.h) } : null;
      process.stdout.write(`[RES|T3 ${kind}] resizeDrag from ${best.cls || best.tag} bestD=${Math.round(bestD)} delta=${JSON.stringify(delta)} resized=${delta ? (Math.abs(delta.dw) > 8 || Math.abs(delta.dh) > 8) : null}\n`);
      await shot(`def-154-1723c-${kind}-resized.png`);
    } else {
      process.stdout.write(`[RES|T3 ${kind}] NO resize affordance in DOM near the selected shape\n`);
    }

    // deselect for next kind
    await win.keyboard.press('Escape');
    await win.waitForTimeout(250);
    await win.mouse.click(pr.x + pr.w * 0.45, Math.min(pr.y + pr.h * 0.62, 1150));
    await win.waitForTimeout(300);
  }

  await noPageErrors('T3');
});
