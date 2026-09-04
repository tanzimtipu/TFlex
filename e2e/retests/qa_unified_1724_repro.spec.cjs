// QA repro spec for the v1.7.24 unified interaction model regressions
// reported by the operator. Installed app only (real mouse events).
//
//   Item 1: double-click a committed TEXTBOX (annotation) - what opens?
//   Item 2: move a committed TEXTBOX, Confirm - does it render at the
//           new position? (DOM vs canvas vs engine state)
//   Item 3: callout move - does the box and the arrow move together
//           or can they be moved separately?
//   Item 4: double-click a committed CALLOUT - what opens?
//   Item 5: matrix sweep - every placeable kind, move + confirm:
//           (a) live drag movement (b) renders at the new position
//           after confirm (c) persists in save + reopen.

const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const PAGE = 4;

test.setTimeout(600000);

let electronApp = null;
let win = null;
const pageErrors = [];

async function launch() {
  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  win.on('pageerror', (err) => {
    const m = err && err.message ? err.message : String(err);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  const ver = await electronApp.evaluate(({ app }) => app.getVersion());
  process.stdout.write(`[APP-VERSION] ${ver}\n`);
  if (ver !== '1.7.24') console.log('[WARN] historical version pin was 1.7.24; running on DEV build version ' + ver);
  await win.waitForTimeout(600);
}

test.beforeEach(async () => {
  electronApp = null; win = null;
});

test.afterEach(async () => {
  await hardClose(electronApp);
  electronApp = null; win = null;
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
  process.stdout.write(`[CROP] ${name}\n`);
  return p;
}

async function openSample(name) {
  const p = getSamplePath(name);
  await electronApp.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
  return p;
}

async function scrollToPage(n) {
  // Scroll until slot n's top sits ~90px below the viewport top, verified
  // by getBoundingClientRect (offsetTop semantics are unreliable here).
  for (let i = 0; i < 40; i += 1) {
    const st = await win.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return { done: false };
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (!slot) { sc.scrollTop += 1500; return { done: false }; }
      const r = slot.getBoundingClientRect();
      const delta = r.top - 90;
      if (Math.abs(delta) < 40) return { done: true };
      sc.scrollTop += delta;
      return { done: false, delta };
    }, n);
    await win.waitForTimeout(350);
    if (st.done) break;
  }
  await win.waitForTimeout(900);
}

async function pageRect(n = PAGE) {
  return await win.evaluate((pg) => {
    const el = document.querySelector(`.page-slot[data-page="${pg}"] .pdf-page`)
      || document.querySelector(`.page-slot[data-page="${pg}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, n);
}

async function armAnnTool(tool) {
  await win.click(`[data-annotation-toolbar] [data-tool="${tool}"]`);
  await win.waitForTimeout(350);
}

async function drag(x, y, dx, dy, steps = 8) {
  await win.mouse.move(x, y);
  await win.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await win.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
    await win.waitForTimeout(16);
  }
  await win.mouse.up();
}

// ---- kind-specific DOM finders (page-scoped, smallest element) ----
const KIND_SELECTORS = {
  textbox: 'div.ann-textbox[data-kind="textbox"]',
  callout: 'div.ann-callout[data-kind="callout"]',
  note: 'div.ann-note[data-kind="note"]',
  rect: 'rect[data-kind="rect"]',
  ellipse: 'ellipse[data-kind="ellipse"]',
  arrow: 'g[data-kind="arrow"]:not([data-kind="callout"])',
  ink: '[data-kind="ink"]:not([data-kind="callout"])',
};

async function findKind(kind) {
  return await win.evaluate(([k, pg, selMap]) => {
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    if (!slot) return null;
    const sels = selMap[k];
    if (!sels) return null;
    let best = null;
    for (const el of slot.querySelectorAll(sels)) {
      const r = el.getBoundingClientRect();
      if (r.width < 3 || r.height < 3) continue;
      const cand = {
        tag: el.tagName.toLowerCase(),
        cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '')
          .split(' ').filter(Boolean).slice(0, 4).join('.'),
        id: el.getAttribute('data-annotation-id'),
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        text: (el.textContent || '').trim().slice(0, 60),
        visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden',
      };
      if (!best || cand.rect.w * cand.rect.h < best.rect.w * best.rect.h) best = cand;
    }
    return best;
  }, [kind, PAGE, KIND_SELECTORS]);
}

// Edit-mode committed add-box finder
async function findAddBox() {
  return await win.evaluate((pg) => {
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    if (!slot) return null;
    let best = null;
    for (const el of slot.querySelectorAll('[data-edit-box-id]')) {
      const r = el.getBoundingClientRect();
      if (r.width < 3 || r.height < 3) continue;
      const cand = {
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').split(' ').filter(Boolean).slice(0, 4).join('.'),
        id: el.getAttribute('data-edit-box-id'),
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        text: (el.getAttribute('data-edit-box-text') || '').slice(0, 60),
      };
      if (!best || cand.rect.w * cand.rect.h < best.rect.w * best.rect.h) best = cand;
    }
    return best;
  }, PAGE);
}

// All floating bars / editors / palettes visible on the page (diagnostic)
async function floatingChrome() {
  return await win.evaluate((pg) => {
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    const root = slot || document;
    const out = [];
    const sels = [
      '[data-annotation-editor]', '[data-annotation-color-editor]',
      '[data-content-action-bar]', '[data-annotation-action-bar]',
      '[data-edit-editor]', '[data-edit-box-action]', '[data-move-hint]',
      '.ann-note-editor', '.shape-color-editor', '.ann-textbox-wrap',
      '.color-palette', '[data-drag-grip]',
    ];
    for (const sel of sels) {
      for (const el of root.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
        const attrs = {};
        for (const a of el.getAttributeNames()) {
          if (a.startsWith('data-')) attrs[a] = el.getAttribute(a);
        }
        const btns = [...el.querySelectorAll('button')].map((b) => ({
          t: (b.textContent || '').trim(),
          aria: b.getAttribute('aria-label'),
          act: b.getAttribute('data-annotation-action') || b.getAttribute('data-content-action')
            || b.getAttribute('data-edit-box-action') || b.getAttribute('data-edit-action') || null,
        }));
        out.push({ sel, attrs, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, btns });
      }
    }
    return out;
  }, PAGE);
}

async function engineAnns(label) {
  const st = await win.evaluate(() => {
    const d = window.tflexDiagnostics ? window.tflexDiagnostics() : null;
    const anns = (d && d.engineState && d.engineState.annotations) || [];
    const toasts = [...document.querySelectorAll('.toast')].map((t) => (t.textContent || '').trim());
    return { anns: anns.map((a) => ({
      id: a.id, kind: a.kind, page: a.page,
      rects: a.rects, rect: a.rect, at: a.at, from: a.from, to: a.to,
      points: a.points ? a.points.length : undefined,
      text: (a.text || a.content || '').slice(0, 40),
    })), toasts };
  });
  process.stdout.write(`[ENGINE|${label}] ${JSON.stringify(st)}\n`);
  return st;
}

// The visible pixels check: is there non-background ink inside a rect?
async function pixelsPresent(rect, pageNo = PAGE) {
  return await win.evaluate(([rc, pg]) => {
    const slot = document.querySelector(`.page-slot[data-page="${pg}"] .pdf-page`)
      || document.querySelector(`.page-slot[data-page="${pg}"]`);
    if (!slot) return { err: 'no page' };
    const pr = slot.getBoundingClientRect();
    const canvas = slot.querySelector('canvas');
    if (!canvas) return { err: 'no canvas' };
    const sx = Math.max(0, Math.round((rc.x - pr.x) * (canvas.width / pr.width)));
    const sy = Math.max(0, Math.round((rc.y - pr.y) * (canvas.height / pr.height)));
    const sw = Math.max(1, Math.round(rc.w * (canvas.width / pr.width)));
    const sh = Math.max(1, Math.round(rc.h * (canvas.height / pr.height)));
    const ctx = document.createElement('canvas');
    ctx.width = canvas.width; ctx.height = canvas.height;
    const c2 = ctx.getContext('2d');
    c2.drawImage(canvas, 0, 0);
    const img = c2.getImageData(sx, sy, Math.min(sw, canvas.width - sx), Math.min(sh, canvas.height - sy)).data;
    // count pixels far from white
    let dark = 0; const total = img.length / 4;
    for (let i = 0; i < img.length; i += 4) {
      if (img[i] < 225 || img[i + 1] < 225 || img[i + 2] < 225) dark++;
    }
    return { darkPx: dark, total, ratio: +(dark / total).toFixed(3) };
  }, [rect, pageNo]);
}

// ---------------------------------------------------------------------------
// T1 + T4: double-click toolboxes (textbox, callout)
// ---------------------------------------------------------------------------
for (const [ti, kind] of [['T1', 'textbox'], ['T4', 'callout']]) {
  test(`${ti}: double-click committed ${kind.toUpperCase()} - what opens?`, async () => {
    await launch();
    await openSample('report.pdf');
    await scrollToPage(PAGE);
    const pr = await pageRect(PAGE);
    expect(pr).toBeTruthy();

    let anchor = null;
    if (kind === 'textbox') {
      await armAnnTool('textbox');
      await win.mouse.click(pr.x + pr.w * 0.2, pr.y + pr.h * 0.15);
      await win.waitForTimeout(500);
      const ta = win.locator('[data-annotation-editor="textbox"] textarea');
      await ta.waitFor({ timeout: 8000 });
      await ta.fill(`MOVE ${kind.toUpperCase()} A1`);
      await win.click('[data-annotation-action="textbox-confirm"]');
      await win.waitForTimeout(900);
    } else {
      anchor = { x: pr.x + pr.w * 0.25, y: pr.y + pr.h * 0.5 };
      await armAnnTool('callout');
      await shot(`def-160-${ti}-callout-armed.png`);
      await drag(anchor.x, anchor.y, 180, 110);
      await win.waitForTimeout(800);
      const ta = win.locator('[data-annotation-editor="callout"] textarea');
      const opened = await ta.count();
      process.stdout.write(`[T4 CALLOUT DRAG DONE] editor count=${opened}\n`);
      if (opened === 0) {
        await shot(`def-160-t4-callout-drag-no-editor.png`);
        const ch = await floatingChrome();
        process.stdout.write(`[T4 CALLOUT NO-EDITOR CHROME] ${JSON.stringify(ch)}\n`);
      }
      await ta.waitFor({ timeout: 8000 });
      await ta.fill(`DBLCLK ${kind.toUpperCase()} B2`);
      await win.click('[data-annotation-action="callout-confirm"]');
      await win.waitForTimeout(900);
    }

    const el = await findKind(kind);
    process.stdout.write(`[COMMIT ${kind}] ${JSON.stringify(el)}\n`);
    expect(el, `${kind} committed`).toBeTruthy();

    // select tool, then REAL double-click on the committed surface
    await armAnnTool('select');
    await win.waitForTimeout(300);
    const cx = el.rect.x + el.rect.w * 0.5;
    const cy = el.rect.y + el.rect.h * 0.5;
    await win.mouse.dblclick(cx, cy, { delay: 60 });
    await win.waitForTimeout(900);

    const chrome = await floatingChrome();
    process.stdout.write(`[RES|${ti}-DBLCLK-${kind}] chrome=${JSON.stringify(chrome, null, 1)}\n`);
    await shot(`def-160-${ti}-dblclk-${kind}.png`);

    const colorEditor = chrome.find((c) => c.sel === '[data-annotation-color-editor]');
    const textEditor = chrome.find((c) => c.sel === '[data-annotation-editor]' && String(c.attrs['data-annotation-editor']).startsWith('edit-'));
    const noteEditor = chrome.find((c) => c.sel === '[data-annotation-editor]' && String(c.attrs['data-annotation-editor']).startsWith('note'));
    process.stdout.write(`[RES|${ti}-SUMMARY ${kind}] colorToolbox=${!!colorEditor} textToolbox=${!!textEditor} noteEditor=${!!noteEditor}\n`);

    // close whatever opened (Esc) for cleanliness
    await win.keyboard.press('Escape');
  });
}

// ---------------------------------------------------------------------------
// T2: move committed TEXTBOX + Confirm - before/during/after deep probe
// ---------------------------------------------------------------------------
test('T2: move committed TEXTBOX + Confirm - renders at new position?', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();

  await armAnnTool('textbox');
  await win.mouse.click(pr.x + pr.w * 0.2, pr.y + pr.h * 0.15);
  await win.waitForTimeout(500);
  const ta = win.locator('[data-annotation-editor="textbox"] textarea');
  await ta.waitFor({ timeout: 8000 });
  await ta.fill('MOVE ME TB-42');
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(900);

  let el = await findKind('textbox');
  process.stdout.write(`[BEFORE] ${JSON.stringify(el)}\n`);
  expect(el).toBeTruthy();
  const beforeRect = { ...el.rect };
  const pxBefore = await pixelsPresent(beforeRect);
  process.stdout.write(`[BEFORE-PX] ${JSON.stringify(pxBefore)}\n`);

  // engine state before
  const engBefore = await engineAnns('before-move');

  await armAnnTool('select');
  await win.waitForTimeout(300);

  // click to select, then drag
  const sx = el.rect.x + el.rect.w * 0.5;
  const sy = el.rect.y + el.rect.h * 0.4;
  await win.mouse.click(sx, sy);
  await win.waitForTimeout(600);
  await shot('def-160-t2-textbox-selected.png');

  // LIVE drag: sample the DOM rect mid-drag
  const dx = 150; const dy = 100;
  await win.mouse.move(sx, sy);
  await win.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await win.mouse.move(sx + (dx * i) / 8, sy + (dy * i) / 8);
    await win.waitForTimeout(16);
    if (i === 5) {
      const mid = await findKind('textbox');
      process.stdout.write(`[MIDDRAG] ${JSON.stringify(mid && mid.rect)}\n`);
    }
  }
  await win.mouse.up();
  await win.waitForTimeout(500);

  const afterDrag = await findKind('textbox');
  process.stdout.write(`[AFTER-DRAG] ${JSON.stringify(afterDrag)}\n`);
  await shot('def-160-t2-textbox-moved-pending.png');

  // find Confirm on the selection bar
  const bar = await floatingChrome();
  process.stdout.write(`[BAR-PENDING] ${JSON.stringify(bar)}\n`);

  await win.click('[data-content-action="ann-textbox-confirm"]');
  await win.waitForTimeout(1200);

  const afterConfirm = await findKind('textbox');
  process.stdout.write(`[AFTER-CONFIRM] ${JSON.stringify(afterConfirm)}\n`);
  const engAfter = await engineAnns('after-confirm');
  await shot('def-160-t2-textbox-after-confirm.png');

  const expected = {
    x: beforeRect.x + dx, y: beforeRect.y + dy, w: beforeRect.w, h: beforeRect.h,
  };
  process.stdout.write(`[RES|T2] before=${JSON.stringify(beforeRect)} expected=${JSON.stringify(expected)} afterConfirm=${JSON.stringify(afterConfirm && afterConfirm.rect)}\n`);
  if (afterConfirm) {
    const pxAfter = await pixelsPresent(afterConfirm.rect);
    process.stdout.write(`[AFTER-CONFIRM-PX] ${JSON.stringify(pxAfter)}\n`);
    const ghost = await pixelsPresent({ x: beforeRect.x + 5, y: beforeRect.y + 5, w: Math.min(beforeRect.w - 10, 80), h: Math.min(beforeRect.h - 10, 40) });
    process.stdout.write(`[AFTER-CONFIRM-GHOST-AT-OLD] ${JSON.stringify(ghost)}\n`);
  } else {
    const pxNew = await pixelsPresent({ x: expected.x + 4, y: expected.y + 4, w: Math.min(expected.w - 8, 100), h: Math.min(expected.h - 8, 40) });
    const pxOld = await pixelsPresent({ x: beforeRect.x + 5, y: beforeRect.y + 5, w: Math.min(beforeRect.w - 10, 80), h: Math.min(beforeRect.h - 10, 40) });
    process.stdout.write(`[AFTER-CONFIRM-NO-DOM] pxAtNew=${JSON.stringify(pxNew)} pxAtOld=${JSON.stringify(pxOld)}\n`);
  }
  // diagnostics: DOM count of textbox nodes + engine annotation count
  const domCount = await win.evaluate((pg) => {
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    return slot ? slot.querySelectorAll('div.ann-textbox[data-kind="textbox"]').length : -1;
  }, PAGE);
  process.stdout.write(`[RES|T2-DOM-COUNT] textbox nodes on page=${domCount} engineAnns=${JSON.stringify(engAfter.anns.length)} toasts=${JSON.stringify(engAfter.toasts)}\n`);
  await shot('def-160-t2-textbox-after-confirm-full.png');
});

// ---------------------------------------------------------------------------
// T3: callout move - box + arrow together or separately?
// ---------------------------------------------------------------------------
test('T3: callout move - do box and arrow move together?', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();

  const ax = pr.x + pr.w * 0.25;
  const ay = pr.y + pr.h * 0.5;
  await armAnnTool('callout');
  await drag(ax, ay, 180, 110);
  await win.waitForTimeout(600);
  const ta = win.locator('[data-annotation-editor="callout"] textarea');
  await ta.waitFor({ timeout: 8000 });
  await ta.fill('CALLOUT MOVE C3');
  await win.click('[data-annotation-action="callout-confirm"]');
  await win.waitForTimeout(900);

  const co = await findKind('callout');
  process.stdout.write(`[COMMIT callout] ${JSON.stringify(co)}\n`);
  expect(co).toBeTruthy();

  // measure the arrow svg line endpoints (screen coords) BEFORE the move
  async function arrowEndpoints() {
    return await win.evaluate((pg) => {
      const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
      const svg = slot && slot.querySelector('svg.ann-callout-arrow');
      if (!svg) return null;
      const line = svg.querySelector('line');
      const sr = svg.getBoundingClientRect();
      return {
        p1: { x: svg.getBoundingClientRect().x + Number(line.getAttribute('x1')), y: svg.getBoundingClientRect().y + Number(line.getAttribute('y1')) },
        p2: { x: svg.getBoundingClientRect().x + Number(line.getAttribute('x2')), y: svg.getBoundingClientRect().y + Number(line.getAttribute('y2')) },
      };
    }, PAGE);
  }

  const beforeArrow = await arrowEndpoints();
  const beforeBox = { ...co.rect };
  process.stdout.write(`[BEFORE] box=${JSON.stringify(beforeBox)} arrow=${JSON.stringify(beforeArrow)}\n`);

  await armAnnTool('select');
  await win.waitForTimeout(300);

  // Can the ARROW be grabbed separately? The arrow svg has pointer-events none;
  // try a press-drag on the arrow midpoint and see what happens.
  if (beforeArrow) {
    const mid = { x: (beforeArrow.p1.x + beforeArrow.p2.x) / 2, y: (beforeArrow.p1.y + beforeArrow.p2.y) / 2 };
    const hit = await win.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const cls = (e) => { const s = e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className; return String(s || '').split(' ').filter(Boolean).slice(0, 4).join('.'); };
      return { tag: el.tagName.toLowerCase(), cls: cls(el), pe: getComputedStyle(el).pointerEvents,
        inCalloutSvg: !!el.closest('svg.ann-callout-arrow') };
    }, [mid.x, mid.y]);
    process.stdout.write(`[ARROW-MID-HIT] ${JSON.stringify(hit)}\n`);
    // try to drag the arrow midpoint alone
    await win.mouse.move(mid.x, mid.y);
    await win.mouse.down();
    await win.mouse.move(mid.x + 120, mid.y + 80, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(600);
    const co2 = await findKind('callout');
    const arrow2 = await arrowEndpoints();
    process.stdout.write(`[AFTER-ARROW-DRAG] box=${JSON.stringify(co2 && co2.rect)} arrow=${JSON.stringify(arrow2)}\n`);
    await shot('def-160-t3-callout-arrow-drag-attempt.png');
    // Did the arrow move alone?
    const arrowMovedAlone = beforeArrow && arrow2 && (
      Math.abs((arrow2.p1.x + arrow2.p2.x) / 2 - (beforeArrow.p1.x + beforeArrow.p2.x) / 2) > 8);
    const boxMovedToo = co2 && beforeBox && (Math.abs(co2.rect.x - beforeBox.x) > 8 || Math.abs(co2.rect.y - beforeBox.y) > 8);
    process.stdout.write(`[RES|T3-SEPARATE] arrowMovedAlone=${arrowMovedAlone} boxMovedToo=${boxMovedToo}\n`);
  }

  // reset: move the BOX (via its surface) and observe whether the arrow follows
  const co3 = await findKind('callout');
  const bx = co3.rect.x + co3.rect.w * 0.5;
  const by = co3.rect.y + co3.rect.h * 0.4;
  await win.mouse.click(bx, by);
  await win.waitForTimeout(500);
  // live drag sample: arrow during drag
  await win.mouse.move(bx, by);
  await win.mouse.down();
  await win.mouse.move(bx + 140, by + 90, { steps: 10 });
  const midArrow = await arrowEndpoints();
  const midBox = await findKind('callout');
  process.stdout.write(`[MIDDRAG] box=${JSON.stringify(midBox && midBox.rect)} arrow=${JSON.stringify(midArrow)}\n`);
  await win.mouse.up();
  await win.waitForTimeout(500);

  const afterDragArrow = await arrowEndpoints();
  const afterDragBox = (await findKind('callout')).rect;
  process.stdout.write(`[AFTER-DRAG] box=${JSON.stringify(afterDragBox)} arrow=${JSON.stringify(afterDragArrow)}\n`);
  await shot('def-160-t3-callout-moved-pending.png');

  await win.click('[data-content-action="ann-callout-confirm"]');
  await win.waitForTimeout(1200);
  const coF = await findKind('callout');
  const arrowF = await arrowEndpoints();
  process.stdout.write(`[AFTER-CONFIRM] box=${JSON.stringify(coF && coF.rect)} arrow=${JSON.stringify(arrowF)}\n`);
  const eng = await engineAnns('after-callout-move');
  await shot('def-160-t3-callout-after-confirm.png');
  process.stdout.write(`[RES|T3] moved box delta expected (140,90); arrowAnchorBefore=${JSON.stringify(beforeArrow)} arrowAnchorAfter=${JSON.stringify(arrowF)} engineCallout=${JSON.stringify(eng.anns.filter((a) => a.kind === 'callout'))}\n`);
});

// ---------------------------------------------------------------------------
// T5: matrix sweep - annotation kinds move + confirm (live/new-position/ghost)
// ---------------------------------------------------------------------------
test('T5: matrix sweep - move+confirm for every annotation kind', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();

  const results = {};

  // -- commit each kind --
  // textbox
  await armAnnTool('textbox');
  await win.mouse.click(pr.x + pr.w * 0.05, pr.y + pr.h * 0.08);
  await win.waitForTimeout(400);
  const ta1 = win.locator('[data-annotation-editor="textbox"] textarea');
  await ta1.waitFor({ timeout: 8000 });
  await ta1.fill('SWEEP TEXTBOX');
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(700);

  // note
  await armAnnTool('note');
  await win.mouse.click(pr.x + pr.w * 0.45, pr.y + pr.h * 0.1);
  await win.waitForTimeout(400);
  const ta2 = win.locator('.ann-note-editor textarea, [data-annotation-editor="note"] textarea').first();
  await ta2.waitFor({ timeout: 8000 });
  await ta2.fill('SWEEP NOTE');
  const noteConfirm = win.locator('[data-annotation-action="note-confirm"], .ann-note-editor button:has-text("Confirm")').first();
  await noteConfirm.click();
  await win.waitForTimeout(700);

  // callout
  await armAnnTool('callout');
  await drag(pr.x + pr.w * 0.45, pr.y + pr.h * 0.28, 150, 90);
  await win.waitForTimeout(500);
  const ta3 = win.locator('[data-annotation-editor="callout"] textarea');
  await ta3.waitFor({ timeout: 8000 });
  await ta3.fill('SWEEP CALLOUT');
  await win.click('[data-annotation-action="callout-confirm"]');
  await win.waitForTimeout(700);

  // rect / ellipse / arrow / ink — all commit positions stay inside the
  // VISIBLE viewport (the page is ~2340 css px tall at 189% zoom; drags
  // outside the window never reach the page).
  await armAnnTool('rect');
  await drag(pr.x + pr.w * 0.06, pr.y + pr.h * 0.3, 110, 60);
  await win.waitForTimeout(500);
  await armAnnTool('ellipse');
  await drag(pr.x + pr.w * 0.3, pr.y + pr.h * 0.3, 110, 60);
  await win.waitForTimeout(500);
  await armAnnTool('arrow');
  await drag(pr.x + pr.w * 0.62, pr.y + pr.h * 0.08, 100, 60);
  await win.waitForTimeout(500);
  await armAnnTool('ink');
  await drag(pr.x + pr.w * 0.62, pr.y + pr.h * 0.3, 130, 45);
  await win.waitForTimeout(500);

  await armAnnTool('select');
  await win.waitForTimeout(400);

  const DX = 140; const DY = 80;

  for (const kind of ['textbox', 'note', 'callout', 'rect', 'ellipse', 'arrow', 'ink']) {
    const r = { kind, live: null, pendingRender: null, confirmRender: null, ghostAtOld: null, engine: null };
    let el = await findKind(kind);
    if (!el) { r.confirmRender = 'NOT FOUND'; results[kind] = r; continue; }
    const beforeRect = { ...el.rect };
    r.before = beforeRect;

    const sx = el.rect.x + el.rect.w * 0.5;
    const sy = el.rect.y + el.rect.h * 0.4;

    // press-drag directly on the surface (pointerdown selects + begins
    // the move drag; no pre-click so the note never opens its editor)
    await win.mouse.move(sx, sy);
    await win.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await win.mouse.move(sx + (DX * i) / 8, sy + (DY * i) / 8);
      await win.waitForTimeout(16);
    }
    const midEl = await findKind(kind);
    await win.mouse.up();
    await win.waitForTimeout(400);

    r.live = midEl ? {
      movedLive: Math.abs(midEl.rect.x - beforeRect.x) > 20 || Math.abs(midEl.rect.y - beforeRect.y) > 20,
      midRect: { x: Math.round(midEl.rect.x), y: Math.round(midEl.rect.y) },
    } : 'NOT FOUND MIDDRAG';

    const afterDrag = await findKind(kind);
    r.pendingRender = afterDrag ? { rect: { x: Math.round(afterDrag.rect.x), y: Math.round(afterDrag.rect.y) }, moved: Math.abs(afterDrag.rect.x - beforeRect.x) > 20 } : 'NOT FOUND';

    // Confirm via the selection bar
    const confirmSel = `[data-content-action="ann-${kind}-confirm"]`;
    const hasBar = await win.locator(confirmSel).count();
    if (hasBar === 0) {
      // fall back: maybe the bar did not appear; record
      r.confirmRender = 'NO CONFIRM BUTTON';
      results[kind] = r;
      await win.keyboard.press('Escape');
      await win.waitForTimeout(300);
      continue;
    }
    await win.click(confirmSel);
    await win.waitForTimeout(1100);

    const afterConfirm = await findKind(kind);
    if (!afterConfirm) {
      r.confirmRender = 'GONE (nothing rendered after confirm)';
      const px = await pixelsPresent({ x: beforeRect.x + DX, y: beforeRect.y + DY, w: beforeRect.w, h: beforeRect.h });
      r.confirmPx = px;
    } else {
      const nr = afterConfirm.rect;
      const expectedX = beforeRect.x + DX; const expectedY = beforeRect.y + DY;
      const atNew = Math.abs(nr.x - expectedX) < 25 && Math.abs(nr.y - expectedY) < 25;
      r.confirmRender = {
        rect: { x: Math.round(nr.x), y: Math.round(nr.y), w: Math.round(nr.w), h: Math.round(nr.h) },
        atNewPosition: atNew,
        text: afterConfirm.text,
      };
      const ghost = await pixelsPresent({ x: beforeRect.x + 5, y: beforeRect.y + 5, w: Math.min(beforeRect.w - 10, 60), h: Math.min(beforeRect.h - 10, 40) });
      r.ghostAtOld = ghost;
    }
    r.engine = (await engineAnns(`sweep-${kind}`)).anns.filter((a) => a.kind === kind || (kind === 'textbox' && a.kind === 'text-box'));
    results[kind] = r;
    await shot(`def-160-t5-${kind}-after-confirm.png`);
    // deselect
    await win.mouse.click(pr.x + pr.w * 0.75, pr.y + pr.h * 0.9);
    await win.waitForTimeout(400);
  }

  process.stdout.write(`\n[RES|T5-MATRIX] ${JSON.stringify(results, null, 1)}\n`);
});

// ---------------------------------------------------------------------------
// T6: save + reopen persistence for all kinds
// ---------------------------------------------------------------------------
test('T6: save+reopen - do moved items persist at the new position?', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();

  // commit + move + confirm a textbox (the kind the operator flagged)
  await armAnnTool('textbox');
  await win.mouse.click(pr.x + pr.w * 0.1, pr.y + pr.h * 0.12);
  await win.waitForTimeout(400);
  const ta = win.locator('[data-annotation-editor="textbox"] textarea');
  await ta.waitFor({ timeout: 8000 });
  await ta.fill('PERSIST TB-77');
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(800);

  await armAnnTool('select');
  let el = await findKind('textbox');
  expect(el).toBeTruthy();
  const beforeRect = { ...el.rect };
  const sx = el.rect.x + el.rect.w * 0.5;
  const sy = el.rect.y + el.rect.h * 0.4;
  await win.mouse.click(sx, sy);
  await win.waitForTimeout(500);
  await drag(sx, sy, 150, 100, 8);
  await win.waitForTimeout(500);
  const barCount = await win.locator('[data-content-action="ann-textbox-confirm"]').count();
  process.stdout.write(`[T6] confirm-bar count=${barCount}\n`);
  if (barCount > 0) {
    await win.click('[data-content-action="ann-textbox-confirm"]');
    await win.waitForTimeout(1100);
  }
  const afterMove = await findKind('textbox');
  process.stdout.write(`[T6] before=${JSON.stringify(beforeRect)} afterMoveConfirm=${JSON.stringify(afterMove && afterMove.rect)}\n`);

  // Save As
  const savePath = path.join(os.tmpdir(), `tflex-def160-${Date.now()}.pdf`);
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  for (let i = 0; i < 24 && !fs.existsSync(savePath); i++) await win.waitForTimeout(500);
  expect(fs.existsSync(savePath), 'saved file exists').toBe(true);
  process.stdout.write(`[SAVED] ${savePath}\n`);

  // close tab, reopen
  await win.locator('.tab-active .tab-close').click();
  await win.waitForTimeout(1500);
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2500);
  await scrollToPage(PAGE);
  await win.waitForTimeout(800);

  const reopened = await findKind('textbox');
  process.stdout.write(`[REOPEN] ${JSON.stringify(reopened)}\n`);
  const eng = await engineAnns('reopened');
  await shot('def-160-t6-textbox-reopened.png');

  process.stdout.write(`[RES|T6] afterConfirm=${JSON.stringify(afterMove && afterMove.rect)} reopened=${JSON.stringify(reopened && reopened.rect)} engineAnns=${JSON.stringify(eng.anns)}\n`);
});

// ---------------------------------------------------------------------------
// T7: EDIT mode - add-box and edit-text run: move + confirm matrix rows
// ---------------------------------------------------------------------------
test('T7: add-box + edit-text run - move + confirm behavior', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);

  const results = {};

  // ---------------- ADD BOX ----------------
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);
  // drag-create a box on a quiet area
  const bx = pr.x + pr.w * 0.45;
  const by = pr.y + pr.h * 0.45;
  await win.mouse.move(bx, by);
  await win.mouse.down();
  await win.mouse.move(bx + 180, by + 70, { steps: 8 });
  await win.mouse.up();
  await win.waitForSelector('[data-edit-textarea]', { timeout: 8000 }).catch(() => {});
  const boxTa = win.locator('[data-edit-textarea]').first();
  if (await boxTa.count()) {
    await boxTa.fill('ADD BOX SWEEP T7');
    await win.keyboard.press('Control+Enter');
    await win.waitForTimeout(1500);
  }
  let box = await findAddBox();
  process.stdout.write(`[T7 ADDBOX COMMIT] ${JSON.stringify(box)}\n`);
  const addbox = { live: null, pendingRender: null, confirmRender: null };
  if (box) {
    const bBefore = { ...box.rect };
    const bsx = box.rect.x + box.rect.w * 0.5;
    const bsy = box.rect.y + box.rect.h * 0.4;
    // press-drag the box
    await win.mouse.move(bsx, bsy);
    await win.mouse.down();
    await win.mouse.move(bsx + 140, bsy + 90, { steps: 8 });
    const midBox = await findAddBox();
    await win.mouse.up();
    await win.waitForTimeout(500);
    addbox.live = midBox ? {
      movedLive: Math.abs(midBox.rect.x - bBefore.x) > 20 || Math.abs(midBox.rect.y - bBefore.y) > 20,
      midRect: { x: Math.round(midBox.rect.x), y: Math.round(midBox.rect.y) },
    } : 'NOT FOUND MIDDRAG';
    await shot('def-160-t7-addbox-moved-pending.png');
    const pendBox = await findAddBox();
    addbox.pendingRender = pendBox ? { rect: { x: Math.round(pendBox.rect.x), y: Math.round(pendBox.rect.y) }, moved: Math.abs(pendBox.rect.x - bBefore.x) > 20 } : 'NOT FOUND';
    // Confirm
    const bc = await win.locator('[data-edit-box-action="confirm"]').count();
    process.stdout.write(`[T7 ADDBOX] confirm-bar count=${bc}\n`);
    if (bc > 0) {
      await win.click('[data-edit-box-action="confirm"]');
      await win.waitForTimeout(2000); // engine mask + proxy refresh
    }
    const afterBox = await findAddBox();
    addbox.confirmRender = afterBox ? {
      rect: { x: Math.round(afterBox.rect.x), y: Math.round(afterBox.rect.y) },
      atNewPosition: Math.abs(afterBox.rect.x - (bBefore.x + 140)) < 30 && Math.abs(afterBox.rect.y - (bBefore.y + 90)) < 30,
    } : 'GONE (no DOM box after confirm)';
    addbox.engineTextBoxes = await win.evaluate(() => {
      const d = window.tflexDiagnostics ? window.tflexDiagnostics() : null;
      return (d && d.engineState && d.engineState.textBoxes) || null;
    });
    await shot('def-160-t7-addbox-after-confirm.png');
    process.stdout.write(`[T7 ADDBOX RES] before=${JSON.stringify(bBefore)} ${JSON.stringify(addbox)}\n`);
  } else {
    addbox.confirmRender = 'BOX NOT CREATED';
    await shot('def-160-t7-addbox-not-committed.png');
  }

  // ---------------- EDIT TEXT RUN ----------------
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(400);
  // pick a sizeable isolated text run
  const run = await win.evaluate((pg) => {
    const spans = [];
    document.querySelectorAll(`.page-slot[data-page="${pg}"] .textLayer span`).forEach((s) => {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (t && r.width > 60 && r.height > 6) spans.push({ x: r.x, y: r.y, w: r.width, h: r.height, text: t.slice(0, 40) });
    });
    return spans.find((s) => s.text.length > 14) || spans[0] || null;
  }, PAGE);
  process.stdout.write(`[T7 RUN TARGET] ${JSON.stringify(run)}\n`);
  const runRes = { live: null, confirmRender: null };
  if (run) {
    const rx = run.x + run.w * 0.5;
    const ry = run.y + run.h * 0.5;
    // single click selects the run
    await win.mouse.click(rx, ry);
    await win.waitForTimeout(500);
    const sel = await win.locator('[data-textrun-selection]').count();
    process.stdout.write(`[T7 RUN SELECTED] selection-outline count=${sel}\n`);
    await shot('def-160-t7-textrun-selected.png');
    // press-drag the run (pointerdown on the layer at the run point starts the move)
    await win.mouse.move(rx, ry);
    await win.mouse.down();
    await win.mouse.move(rx + 150, ry + 90, { steps: 10 });
    const midSel = await win.evaluate(() => {
      const s = document.querySelector('[data-textrun-selection]');
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return { x: r.x, y: r.y };
    });
    await win.mouse.up();
    await win.waitForTimeout(500);
    runRes.live = midSel ? {
      movedLive: Math.abs(midSel.x - run.x) > 30 || Math.abs(midSel.y - run.y) > 20,
      midRect: { x: Math.round(midSel.x), y: Math.round(midSel.y) },
    } : 'NO SELECTION MIDDRAG';
    await shot('def-160-t7-textrun-moved-pending.png');
    const pxOldBeforeConfirm = await pixelsPresent({ x: run.x + 3, y: run.y + 1, w: Math.min(run.w - 6, 120), h: Math.max(run.h - 2, 8) });
    process.stdout.write(`[T7 RUN PENDING] old-run canvas pixels still visible=${JSON.stringify(pxOldBeforeConfirm)}\n`);
    // Confirm
    const rb = await win.locator('[data-content-action="textrun-confirm"]').count();
    process.stdout.write(`[T7 RUN] confirm-bar count=${rb}\n`);
    if (rb > 0) {
      await win.click('[data-content-action="textrun-confirm"]');
      await win.waitForTimeout(2500); // engine mask + proxy refresh
    }
    await shot('def-160-t7-textrun-after-confirm.png');
    const pxOldAfter = await pixelsPresent({ x: run.x + 3, y: run.y + 1, w: Math.min(run.w - 6, 120), h: Math.max(run.h - 2, 8) });
    const pxNewAfter = await pixelsPresent({ x: run.x + 150 + 3, y: run.y + 90 + 1, w: Math.min(run.w - 6, 120), h: Math.max(run.h - 2, 8) });
    runRes.confirmRender = { pxAtOldRect: pxOldAfter, pxAtNewRect: pxNewAfter };
    process.stdout.write(`[T7 RUN RES] before=${JSON.stringify({ x: run.x, y: run.y })} ${JSON.stringify(runRes)}\n`);
  } else {
    runRes.confirmRender = 'NO TEXT RUN FOUND';
  }
  process.stdout.write(`\n[RES|T7] ${JSON.stringify({ addbox, run: runRes }, null, 1)}\n`);
});

// ---------------------------------------------------------------------------
// T8: NOTE save+reopen - the note moves live and survives confirm, but the
// engine keeps rects[0] at the OLD anchor. Does the SAVED file keep the move?
// ---------------------------------------------------------------------------
test('T8: note move+confirm, save, reopen - which position persists?', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();

  // commit a note
  await armAnnTool('note');
  await win.mouse.click(pr.x + pr.w * 0.2, pr.y + pr.h * 0.12);
  await win.waitForTimeout(500);
  const ta2 = win.locator('.ann-note-editor textarea, [data-annotation-editor="note"] textarea').first();
  await ta2.waitFor({ timeout: 8000 });
  await ta2.fill('NOTE MOVE PERSIST 88');
  await win.click('[data-annotation-action="note-confirm"]');
  await win.waitForTimeout(800);

  const before = await findKind('note');
  process.stdout.write(`[T8 BEFORE] ${JSON.stringify(before)}\n`);
  expect(before).toBeTruthy();
  const beforeRect = { ...before.rect };

  // move it
  await armAnnTool('select');
  await win.waitForTimeout(300);
  const sx = before.rect.x + before.rect.w * 0.5;
  const sy = before.rect.y + before.rect.h * 0.5;
  await drag(sx, sy, 150, 100, 8);
  await win.waitForTimeout(400);
  await win.click('[data-content-action="ann-note-confirm"]');
  await win.waitForTimeout(1000);
  const afterMove = await findKind('note');
  process.stdout.write(`[T8 AFTER-MOVE] ${JSON.stringify(afterMove && afterMove.rect)}\n`);
  await engineAnns('t8-after-move');

  // save + reopen
  const savePath = path.join(os.tmpdir(), `tflex-def160-note-${Date.now()}.pdf`);
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  for (let i = 0; i < 24 && !fs.existsSync(savePath); i++) await win.waitForTimeout(500);
  expect(fs.existsSync(savePath), 'saved file exists').toBe(true);
  await win.locator('.tab-active .tab-close').click();
  await win.waitForTimeout(1500);
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2500);
  await scrollToPage(PAGE);
  await win.waitForTimeout(800);

  const reopened = await findKind('note');
  process.stdout.write(`[T8 REOPEN] ${JSON.stringify(reopened)}\n`);
  await engineAnns('t8-reopened');
  await shot('def-160-t8-note-reopened.png');

  const movedInLive = afterMove ? Math.abs(afterMove.rect.x - beforeRect.x) > 100 : false;
  const keptMoveAfterReopen = reopened ? Math.abs(reopened.rect.x - beforeRect.x) > 100 : false;
  process.stdout.write(`[RES|T8] beforeX=${Math.round(beforeRect.x)} afterMoveX=${afterMove && Math.round(afterMove.rect.x)} reopenedX=${reopened && Math.round(reopened.rect.x)} movedInLive=${movedInLive} keptMoveAfterReopen=${keptMoveAfterReopen}\n`);
});
