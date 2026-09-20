// QA verification spec for DEF-160/161/162 fixes on installed v1.7.25.
// Operator items (real mouse + visual + screenshots):
//   V1: textbox move + Confirm -> renders at the NEW position (no
//       snap-back), persists in save + reopen.               (DEF-160)
//   V2: rect / ellipse move + Confirm -> render at the new
//       position, persist in save + reopen.                  (DEF-160)
//   V3: note move + Confirm -> persists through save+reopen. (DEF-162)
//   V4: callout box and arrow are MOVABLE SEPARATELY (grab the
//       arrow shaft -> the anchor moves alone; grab the box -> the
//       box moves alone); Confirm persists without tearing.  (DEF-161)
//   V5: textbox and callout double-click -> toolbox shows COLOR
//       swatches.                                            (DEF-161 feature)

const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const PAGE = 4;
const TOL = 25; // screen px tolerance for position assertions

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
  if (ver !== '1.7.25') console.log('[WARN] historical version pin was 1.7.25; running on DEV build version ' + ver);
  await win.waitForTimeout(600);
}

test.beforeEach(async () => {
  electronApp = null; win = null;
  pageErrors.length = 0;
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
  if (!rect || !isFinite(rect.x) || !isFinite(rect.y) || !isFinite(rect.w) || !isFinite(rect.h)) {
    process.stdout.write(`[CROP-SKIP] ${name} (no rect)\n`);
    return null;
  }
  // electron windows report a null viewportSize; read the real one from the page
  const vp = await win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const x = Math.max(0, Math.min(rect.x - 30, vp.width - 10));
  const y = Math.max(0, Math.min(rect.y - 30, vp.height - 10));
  const w = Math.min(rect.w + 60, vp.width - x);
  const h = Math.min(rect.h + 60, vp.height - y);
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p, clip: { x, y, width: Math.max(w, 20), height: Math.max(h, 20) } });
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

// Any rect measured in screen px -> page-local px (so numbers stay
// comparable across save/reopen even if the slot shifts).
async function toPageLocal(rect, n = PAGE) {
  const pr = await pageRect(n);
  return {
    x: +(rect.x - pr.x).toFixed(1),
    y: +(rect.y - pr.y).toFixed(1),
    w: +rect.w.toFixed(1),
    h: +rect.h.toFixed(1),
  };
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

// Callout leader endpoints (page-local px) from the VISUAL line of the
// committed callout's arrow svg.
async function calloutArrow(pg = PAGE) {
  return await win.evaluate((p) => {
    const slot = document.querySelector(`.page-slot[data-page="${p}"]`);
    if (!slot) return null;
    const pageEl = slot.querySelector('.pdf-page') || slot;
    const pr = pageEl.getBoundingClientRect();
    const out = [];
    for (const svg of slot.querySelectorAll('svg.ann-callout-arrow')) {
      const line = svg.querySelector('line:not(.ann-callout-arrow-hit)');
      if (!line) continue;
      const sr = svg.getBoundingClientRect();
      out.push({
        entry: {
          x: +(sr.x + Number(line.getAttribute('x1')) - pr.x).toFixed(1),
          y: +(sr.y + Number(line.getAttribute('y1')) - pr.y).toFixed(1),
        },
        anchor: {
          x: +(sr.x + Number(line.getAttribute('x2')) - pr.x).toFixed(1),
          y: +(sr.y + Number(line.getAttribute('y2')) - pr.y).toFixed(1),
        },
        len: +Math.hypot(
          Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')),
          Number(line.getAttribute('y2')) - Number(line.getAttribute('y1')),
        ).toFixed(1),
      });
    }
    return out;
  }, pg);
}

function distToRect(p, r) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

// All floating bars / editors / palettes visible on the page (diagnostic)
async function floatingChrome() {
  return await win.evaluate((pg) => {
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    const root = slot || document;
    const out = [];
    const sels = [
      '[data-annotation-editor]', '[data-annotation-editor-wrap]', '[data-annotation-color-editor]',
      '[data-annotation-color-section]', '[data-content-action-bar]', '[data-annotation-action-bar]',
      '[data-edit-editor]', '[data-edit-box-action]', '[data-move-hint]',
      '.ann-note-editor', '.shape-color-editor', '.ann-textbox-wrap',
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
      text: (a.text || a.content || '').slice(0, 40),
    })), toasts };
  });
  process.stdout.write(`[ENGINE|${label}] ${JSON.stringify(st)}\n`);
  return st;
}

async function saveAsReopen(savePath) {
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
}

// ---------------------------------------------------------------------------
// V1: textbox move + Confirm -> new position, no snap-back; save+reopen keeps it
// ---------------------------------------------------------------------------
test('V1: DEF-160 textbox move + Confirm renders at NEW position + persists', async () => {
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
  await ta.fill('VERIFY TB 1725');
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(900);

  const el = await findKind('textbox');
  process.stdout.write(`[V1 COMMIT] ${JSON.stringify(el)}\n`);
  expect(el).toBeTruthy();
  const before = await toPageLocal(el.rect);
  await shot('def-160-1725-v1-textbox-committed.png');
  await cropShot('def-160-1725-v1-textbox-committed-crop.png', el.rect);
  const engBefore = await engineAnns('v1-before-move');

  const DX = 150; const DY = 100;
  await armAnnTool('select');
  await win.waitForTimeout(300);

  const sx = el.rect.x + el.rect.w * 0.5;
  const sy = el.rect.y + el.rect.h * 0.4;
  await win.mouse.move(sx, sy);
  await win.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await win.mouse.move(sx + (DX * i) / 8, sy + (DY * i) / 8);
    await win.waitForTimeout(16);
    if (i === 5) {
      const mid = await findKind('textbox');
      process.stdout.write(`[V1 MIDDRAG] ${JSON.stringify(mid && mid.rect)}\n`);
    }
  }
  await win.mouse.up();
  await win.waitForTimeout(500);

  const afterDrag = await findKind('textbox');
  process.stdout.write(`[V1 AFTER-DRAG] ${JSON.stringify(afterDrag && afterDrag.rect)}\n`);
  await shot('def-160-1725-v1-textbox-moved-pending.png');
  await cropShot('def-160-1725-v1-textbox-moved-pending-crop.png', afterDrag.rect);
  const pendingAtNew = afterDrag
    && Math.abs(afterDrag.rect.x - (el.rect.x + DX)) < TOL
    && Math.abs(afterDrag.rect.y - (el.rect.y + DY)) < TOL;

  const barCount = await win.locator('[data-content-action="ann-textbox-confirm"]').count();
  process.stdout.write(`[V1] confirm-bar count=${barCount}\n`);
  if (barCount > 0) {
    await win.click('[data-content-action="ann-textbox-confirm"]');
    await win.waitForTimeout(1200);
  }
  const afterConfirm = await findKind('textbox');
  process.stdout.write(`[V1 AFTER-CONFIRM] ${JSON.stringify(afterConfirm && afterConfirm.rect)}\n`);
  const afterConfirmLocal = afterConfirm ? await toPageLocal(afterConfirm.rect) : null;
  const confirmAtNew = afterConfirm
    && Math.abs(afterConfirm.rect.x - (el.rect.x + DX)) < TOL
    && Math.abs(afterConfirm.rect.y - (el.rect.y + DY)) < TOL;
  await shot('def-160-1725-v1-textbox-after-confirm.png');
  if (afterConfirm) await cropShot('def-160-1725-v1-textbox-after-confirm-crop.png', afterConfirm.rect);
  const engAfter = await engineAnns('v1-after-confirm');

  // engine rects[0] must carry the NEW geometry (DEF-160 root-cause signal)
  const rectBefore = (engBefore.anns.find((a) => a.kind === 'textbox' || a.kind === 'text-box') || {}).rects;
  const rectAfter = (engAfter.anns.find((a) => a.kind === 'textbox' || a.kind === 'text-box') || {}).rects;
  const engineMoved = !!(rectBefore && rectAfter && rectAfter[0]
    && (Math.abs(rectAfter[0].x - rectBefore[0].x) > 5 || Math.abs(rectAfter[0].y - rectBefore[0].y) > 5));

  // save + reopen
  const savePath = path.join(os.tmpdir(), `tflex-def160-verify-${Date.now()}.pdf`);
  await saveAsReopen(savePath);
  const reopened = await findKind('textbox');
  const reopenedLocal = reopened ? await toPageLocal(reopened.rect) : null;
  await shot('def-160-1725-v1-textbox-reopened.png');
  if (reopened) await cropShot('def-160-1725-v1-textbox-reopened-crop.png', reopened.rect);
  await engineAnns('v1-reopened');
  const reopenKeptMove = !!(afterConfirmLocal && reopenedLocal
    && Math.abs(reopenedLocal.x - afterConfirmLocal.x) < TOL
    && Math.abs(reopenedLocal.y - afterConfirmLocal.y) < TOL);

  process.stdout.write(`\n[RES|V1] before(local)=${JSON.stringify(await toPageLocal(el.rect))} pendingAtNew=${pendingAtNew} confirmAtNew=${confirmAtNew} engineRectsMoved=${engineMoved} reopenKeptMove=${reopenKeptMove} afterConfirmLocal=${JSON.stringify(afterConfirmLocal)} reopenedLocal=${JSON.stringify(reopenedLocal)} pageErrors=${pageErrors.length}\n`);
  expect(pendingAtNew, 'V1 pending: box follows the drag').toBe(true);
  expect(confirmAtNew, 'V1 confirm: no snap-back, box at NEW position').toBe(true);
  expect(engineMoved, 'V1 engine rects[0] carries the new geometry').toBe(true);
  expect(reopenKeptMove, 'V1 save+reopen: box persists at the moved position').toBe(true);
  expect(pageErrors.length, 'no pageerrors').toBe(0);
});

// ---------------------------------------------------------------------------
// V2: rect + ellipse move + Confirm -> new position; persist via save+reopen
// ---------------------------------------------------------------------------
test('V2: DEF-160 rect/ellipse move + Confirm renders at NEW position + persists', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();

  await armAnnTool('rect');
  await drag(pr.x + pr.w * 0.06, pr.y + pr.h * 0.28, 110, 60);
  await win.waitForTimeout(500);
  await armAnnTool('ellipse');
  await drag(pr.x + pr.w * 0.34, pr.y + pr.h * 0.28, 110, 60);
  await win.waitForTimeout(500);

  const rectEl = await findKind('rect');
  const ellEl = await findKind('ellipse');
  process.stdout.write(`[V2 COMMIT rect]=${JSON.stringify(rectEl && rectEl.rect)}\n`);
  process.stdout.write(`[V2 COMMIT ellipse]=${JSON.stringify(ellEl && ellEl.rect)}\n`);
  expect(rectEl).toBeTruthy();
  expect(ellEl).toBeTruthy();
  await shot('def-160-1725-v2-committed.png');

  const DX = 140; const DY = 80;
  await armAnnTool('select');
  await win.waitForTimeout(400);

  const results = {};
  for (const [kind, el] of [['rect', rectEl], ['ellipse', ellEl]]) {
    const before = { ...el.rect };
    const sx = before.x + before.w * 0.5;
    const sy = before.y + before.h * 0.5;
    await win.mouse.move(sx, sy);
    await win.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await win.mouse.move(sx + (DX * i) / 8, sy + (DY * i) / 8);
      await win.waitForTimeout(16);
    }
    const mid = await findKind(kind);
    await win.mouse.up();
    await win.waitForTimeout(450);
    const pending = await findKind(kind);
    await shot(`def-160-1725-v2-${kind}-moved-pending.png`);
    const pendingAtNew = pending
      && Math.abs(pending.rect.x - (before.x + DX)) < TOL
      && Math.abs(pending.rect.y - (before.y + DY)) < TOL;
    const liveMoved = mid
      && (Math.abs(mid.rect.x - before.x) > 20 || Math.abs(mid.rect.y - before.y) > 20);

    const barCount = await win.locator(`[data-content-action="ann-${kind}-confirm"]`).count();
    if (barCount > 0) {
      await win.click(`[data-content-action="ann-${kind}-confirm"]`);
      await win.waitForTimeout(1100);
    }
    const afterConfirm = await findKind(kind);
    const confirmAtNew = afterConfirm
      && Math.abs(afterConfirm.rect.x - (before.x + DX)) < TOL
      && Math.abs(afterConfirm.rect.y - (before.y + DY)) < TOL;
    await shot(`def-160-1725-v2-${kind}-after-confirm.png`);
    if (afterConfirm) await cropShot(`def-160-1725-v2-${kind}-after-confirm-crop.png`, afterConfirm.rect);
    // deselect for the next kind
    await win.mouse.click(pr.x + pr.w * 0.8, pr.y + pr.h * 0.9);
    await win.waitForTimeout(400);
    results[kind] = { liveMoved: !!liveMoved, pendingAtNew: !!pendingAtNew, confirmAtNew: !!confirmAtNew, barCount, before, after: afterConfirm && afterConfirm.rect };
  }

  const engAfter = await engineAnns('v2-after-confirms');
  const rectEngineMoved = !!(engAfter.anns.find((a) => a.kind === 'rect') || {}).rects;
  const ellEngineMoved = !!(engAfter.anns.find((a) => a.kind === 'ellipse') || {}).rects;

  // save + reopen: both must persist at the moved positions
  const savePath = path.join(os.tmpdir(), `tflex-def160-shapes-${Date.now()}.pdf`);
  await saveAsReopen(savePath);
  const rectAfter = await findKind('rect');
  const ellAfter = await findKind('ellipse');
  await shot('def-160-1725-v2-reopened.png');
  const rectKept = !!(results.rect.after && rectAfter
    && Math.abs((await toPageLocal(rectAfter.rect)).x - (await toPageLocal(results.rect.after)).x) < TOL
    && Math.abs((await toPageLocal(rectAfter.rect)).y - (await toPageLocal(results.rect.after)).y) < TOL);
  const ellKept = !!(results.ellipse.after && ellAfter
    && Math.abs((await toPageLocal(ellAfter.rect)).x - (await toPageLocal(results.ellipse.after)).x) < TOL
    && Math.abs((await toPageLocal(ellAfter.rect)).y - (await toPageLocal(results.ellipse.after)).y) < TOL);

  process.stdout.write(`\n[RES|V2] ${JSON.stringify(results)} engineRectsPresent=${rectEngineMoved}/${ellEngineMoved} reopen rectAt=${JSON.stringify(rectAfter && rectAfter.rect)} ellipseAt=${JSON.stringify(ellAfter && ellAfter.rect)} pageErrors=${pageErrors.length}\n`);
  for (const kind of ['rect', 'ellipse']) {
    expect(results[kind].liveMoved, `V2 ${kind} live drag follows`).toBe(true);
    expect(results[kind].pendingAtNew, `V2 ${kind} pending at new position`).toBe(true);
    expect(results[kind].confirmAtNew, `V2 ${kind} confirm: no snap-back`).toBe(true);
    expect(results[kind].barCount, `V2 ${kind} confirm bar appeared`).toBeGreaterThan(0);
  }
  expect(rectKept, 'V2 rect persists at moved position after save+reopen').toBe(true);
  expect(ellKept, 'V2 ellipse persists at moved position after save+reopen').toBe(true);
  expect(pageErrors.length, 'no pageerrors').toBe(0);
});

// ---------------------------------------------------------------------------
// V3: note move + Confirm -> persists through save+reopen (DEF-162)
// ---------------------------------------------------------------------------
test('V3: DEF-162 note move + Confirm persists through save+reopen', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();

  await armAnnTool('note');
  await win.mouse.click(pr.x + pr.w * 0.2, pr.y + pr.h * 0.12);
  await win.waitForTimeout(500);
  const ta = win.locator('.ann-note-editor textarea, [data-annotation-editor="note"] textarea').first();
  await ta.waitFor({ timeout: 8000 });
  await ta.fill('NOTE VERIFY 1725');
  await win.click('[data-annotation-action="note-confirm"]');
  await win.waitForTimeout(800);

  const before = await findKind('note');
  process.stdout.write(`[V3 COMMIT note] ${JSON.stringify(before && before.rect)}\n`);
  expect(before).toBeTruthy();
  const beforeLocal = await toPageLocal(before.rect);
  await shot('def-160-1725-v3-note-committed.png');

  const DX = 150; const DY = 100;
  await armAnnTool('select');
  await win.waitForTimeout(300);
  const sx = before.rect.x + before.rect.w * 0.5;
  const sy = before.rect.y + before.rect.h * 0.5;
  await win.mouse.move(sx, sy);
  await win.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await win.mouse.move(sx + (DX * i) / 8, sy + (DY * i) / 8);
    await win.waitForTimeout(16);
  }
  const mid = await findKind('note');
  await win.mouse.up();
  await win.waitForTimeout(450);
  const pending = await findKind('note');
  await shot('def-160-1725-v3-note-moved-pending.png');
  const pendingAtNew = pending
    && Math.abs(pending.rect.x - (before.rect.x + DX)) < TOL
    && Math.abs(pending.rect.y - (before.rect.y + DY)) < TOL;

  const barCount = await win.locator('[data-content-action="ann-note-confirm"]').count();
  if (barCount > 0) {
    await win.click('[data-content-action="ann-note-confirm"]');
    await win.waitForTimeout(1100);
  }
  const afterConfirm = await findKind('note');
  const confirmAtNew = afterConfirm
    && Math.abs(afterConfirm.rect.x - (before.rect.x + DX)) < TOL
    && Math.abs(afterConfirm.rect.y - (before.rect.y + DY)) < TOL;
  const afterConfirmLocal = afterConfirm ? await toPageLocal(afterConfirm.rect) : null;
  await shot('def-160-1725-v3-note-after-confirm.png');
  if (afterConfirm) await cropShot('def-160-1725-v3-note-after-confirm-crop.png', afterConfirm.rect);
  const engAfter = await engineAnns('v3-after-confirm');
  const note = engAfter.anns.find((a) => a.kind === 'note') || {};
  const engineMoved = !!(note.at && Math.abs(note.at.x - (beforeLocal ? beforeLocal.x : 0)) > 5);

  const savePath = path.join(os.tmpdir(), `tflex-def162-note-${Date.now()}.pdf`);
  await saveAsReopen(savePath);
  const reopened = await findKind('note');
  const reopenedLocal = reopened ? await toPageLocal(reopened.rect) : null;
  await shot('def-160-1725-v3-note-reopened.png');
  if (reopened) await cropShot('def-160-1725-v3-note-reopened-crop.png', reopened.rect);
  await engineAnns('v3-reopened');
  const reopenKeptMove = !!(afterConfirmLocal && reopenedLocal
    && Math.abs(reopenedLocal.x - afterConfirmLocal.x) < TOL
    && Math.abs(reopenedLocal.y - afterConfirmLocal.y) < TOL);

  process.stdout.write(`\n[RES|V3] beforeLocal=${JSON.stringify(beforeLocal)} pendingAtNew=${pendingAtNew} confirmAtNew=${confirmAtNew} engineNote=${JSON.stringify(note)} reopenKeptMove=${reopenKeptMove} afterConfirmLocal=${JSON.stringify(afterConfirmLocal)} reopenedLocal=${JSON.stringify(reopenedLocal)} pageErrors=${pageErrors.length}\n`);
  expect(pendingAtNew, 'V3 pending: note follows the drag').toBe(true);
  expect(confirmAtNew, 'V3 confirm: note at NEW position').toBe(true);
  expect(reopenKeptMove, 'V3 save+reopen: note persists at the moved anchor').toBe(true);
  expect(pageErrors.length, 'no pageerrors').toBe(0);
});

// ---------------------------------------------------------------------------
// V4: callout box and arrow MOVABLE SEPARATELY; Confirm persists without
// tearing; save+reopen keeps the moved geometry consistent (DEF-161)
// ---------------------------------------------------------------------------
test('V4: DEF-161 callout arrow and box move separately, confirm persists without tearing', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();

  // create: anchor at (0.55w, 0.32h), box +180/+110 — HIGH on the page so
  // every later gesture stays far from the viewport bottom edge (a failed
  // shaft grab falls through to the textLayer and can auto-scroll the doc)
  const ax = pr.x + pr.w * 0.55;
  const ay = pr.y + pr.h * 0.32;
  await armAnnTool('callout');
  await drag(ax, ay, 180, 110);
  await win.waitForTimeout(600);
  const ta = win.locator('[data-annotation-editor="callout"] textarea');
  await ta.waitFor({ timeout: 8000 });
  await ta.fill('VERIFY CALLOUT 1725');
  await win.click('[data-annotation-action="callout-confirm"]');
  await win.waitForTimeout(900);
  await scrollToPage(PAGE); // normalize scroll after the editor interactions

  const co = await findKind('callout');
  process.stdout.write(`[V4 COMMIT callout] ${JSON.stringify(co && co.rect)}\n`);
  expect(co).toBeTruthy();
  let arrows = await calloutArrow();
  expect(arrows.length, 'one callout arrow svg').toBe(1);
  const anchorWanted = { x: pr.x + pr.w * 0.55 - pr.x, y: pr.y + pr.h * 0.32 - pr.y };
  const anchorIsP2 = Math.hypot(arrows[0].anchor.x - anchorWanted.x, arrows[0].anchor.y - anchorWanted.y)
    < Math.hypot(arrows[0].entry.x - anchorWanted.x, arrows[0].entry.y - anchorWanted.y);
  process.stdout.write(`[V4 ARROW-BEFORE] ${JSON.stringify(arrows[0])} anchorIsP2=${anchorIsP2} boxLocal=${JSON.stringify(await toPageLocal(co.rect))}\n`);
  await shot('def-160-1725-v4-callout-committed.png');

  await armAnnTool('select');
  await win.waitForTimeout(300);

  // hit-test along the whole shaft (and the head): where does the hit land?
  const probeHits = [];
  let grabPoint = null; // first shaft/head point the callout svg wins
  for (const t of [0.15, 0.3, 0.5, 0.65, 0.8, 0.97]) {
    const pt = {
      x: pr.x + arrows[0].entry.x + (arrows[0].anchor.x - arrows[0].entry.x) * t,
      y: pr.y + arrows[0].entry.y + (arrows[0].anchor.y - arrows[0].entry.y) * t,
    };
    const h = await win.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const cls = (e) => { const s = e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className; return String(s || '').split(' ').filter(Boolean).slice(0, 4).join('.'); };
      return { tag: el.tagName.toLowerCase(), cls: cls(el), pe: getComputedStyle(el).pointerEvents,
        inCalloutSvg: !!el.closest('svg.ann-callout-arrow'),
        inTextLayer: !!el.closest('.textLayer') };
    }, [pt.x, pt.y]);
    probeHits.push({ t, pt: { x: Math.round(pt.x), y: Math.round(pt.y) }, hit: h });
    if (!grabPoint && h && h.inCalloutSvg) grabPoint = pt;
  }
  process.stdout.write(`[V4 SHAFT-HITS] ${JSON.stringify(probeHits)}\n`);
  const hitCss = await win.evaluate((pg) => {
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    const l = slot && slot.querySelector('line.ann-callout-arrow-hit');
    if (!l) return { present: false };
    const cs = getComputedStyle(l);
    const svg = l.closest('svg.ann-callout-arrow');
    return { present: true, pe: cs.pointerEvents, stroke: cs.stroke, sw: cs.strokeWidth,
      svgPe: svg ? getComputedStyle(svg).pointerEvents : null,
      // stack order: is the textLayer painted above the overlay svg?
      svgIndex: [...document.querySelectorAll(`.page-slot[data-page="${pg}"] *`)].indexOf(svg),
      textLayerIndex: slot.querySelector('.textLayer')
        ? [...slot.querySelectorAll('*')].indexOf(slot.querySelector('.textLayer')) : -1 };
  }, PAGE);
  process.stdout.write(`[V4 HIT-CSS] ${JSON.stringify(hitCss)}\n`);
  const shaftMidScreen = {
    x: pr.x + (arrows[0].entry.x + arrows[0].anchor.x) / 2,
    y: pr.y + (arrows[0].entry.y + arrows[0].anchor.y) / 2,
  };
  await cropShot('def-160-1725-v4-callout-committed-crop.png', { x: shaftMidScreen.x - 120, y: shaftMidScreen.y - 120, w: 260, h: 200 });

  // ---- STEP 1: grab the arrow SHAFT -> the ANCHOR moves alone ----
  // press at the point the callout svg wins in the hit test (falls back to
  // the midpoint if no point resolves — that failure is itself the finding)
  const grabPt = grabPoint || shaftMidScreen;
  const boxBefore1 = { ...(await findKind('callout')).rect };
  const adx = 100; const ady = 60;
  await win.mouse.move(grabPt.x, grabPt.y);
  await win.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await win.mouse.move(grabPt.x + (adx * i) / 8, grabPt.y + (ady * i) / 8);
    await win.waitForTimeout(16);
    if (i === 5) {
      const midArrows = await calloutArrow();
      process.stdout.write(`[V4 MIDDRAG-ARROW] ${JSON.stringify(midArrows && midArrows[0])}\n`);
    }
  }
  await win.mouse.up();
  await win.waitForTimeout(500);
  await scrollToPage(PAGE); // undo any stray scroll from a text-layer grab
  arrows = await calloutArrow();
  const boxAfterArrowDrag = (await findKind('callout')).rect;
  const anchorAfterArrow = anchorIsP2 ? arrows[0].anchor : arrows[0].entry;
  // measure the moved anchor against the creation anchor (page-local)
  const anchorBefore1 = { ...anchorWanted };
  const anchorMoved = Math.abs(anchorAfterArrow.x - anchorBefore1.x) > 60 && Math.abs(anchorAfterArrow.y - anchorBefore1.y) > 40;
  const boxStayed = Math.abs(boxAfterArrowDrag.x - boxBefore1.x) < TOL && Math.abs(boxAfterArrowDrag.y - boxBefore1.y) < TOL;
  await shot('def-160-1725-v4-anchor-moved-alone.png');
  const eng1 = await engineAnns('v4-after-anchor-drag');
  const chrome1 = await floatingChrome();
  process.stdout.write(`[V4 STEP1] anchorMoved=${anchorMoved} boxStayed=${boxStayed} arrow=${JSON.stringify(arrows[0])} bar=${JSON.stringify(chrome1.filter((c) => c.sel.includes('action')))}\n`);

  // Confirm step 1
  const bar1 = await win.locator('[data-content-action="ann-callout-confirm"]').count();
  if (bar1 > 0) {
    await win.click('[data-content-action="ann-callout-confirm"]');
    await win.waitForTimeout(1100);
  }
  arrows = await calloutArrow();
  const boxAfterConfirm1 = (await findKind('callout')).rect;
  const anchorAfterConfirm1 = anchorIsP2 ? arrows[0].anchor : arrows[0].entry;
  const confirm1KeptAnchor = Math.abs(anchorAfterConfirm1.x - anchorAfterArrow.x) < TOL
    && Math.abs(anchorAfterConfirm1.y - anchorAfterArrow.y) < TOL;
  const boxStillAtOriginal1 = Math.abs(boxAfterConfirm1.x - boxBefore1.x) < TOL && Math.abs(boxAfterConfirm1.y - boxBefore1.y) < TOL;
  await shot('def-160-1725-v4-anchor-move-confirmed.png');

  // ---- STEP 2: grab the BOX -> the box moves alone ----
  await scrollToPage(PAGE); // normalize before pressing the box surface
  const coNow = await findKind('callout');
  const bx = coNow.rect.x + coNow.rect.w * 0.5;
  const by = coNow.rect.y + coNow.rect.h * 0.5;
  const bdx = 120; const bdy = 70;
  await win.mouse.move(bx, by);
  await win.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await win.mouse.move(bx + (bdx * i) / 8, by + (bdy * i) / 8);
    await win.waitForTimeout(16);
  }
  const midBox = await findKind('callout');
  await win.mouse.up();
  await win.waitForTimeout(500);
  await scrollToPage(PAGE);
  arrows = await calloutArrow();
  const boxAfterDrag2 = (await findKind('callout')).rect;
  const anchorAfterBoxDrag = anchorIsP2 ? arrows[0].anchor : arrows[0].entry;
  const boxMovedAlone = Math.abs(boxAfterDrag2.x - (boxAfterConfirm1.x + bdx)) < TOL
    && Math.abs(boxAfterDrag2.y - (boxAfterConfirm1.y + bdy)) < TOL;
  const anchorUnmoved2 = Math.abs(anchorAfterBoxDrag.x - anchorAfterConfirm1.x) < TOL
    && Math.abs(anchorAfterBoxDrag.y - anchorAfterConfirm1.y) < TOL;
  await shot('def-160-1725-v4-box-moved-alone.png');

  // Confirm step 2
  const bar2 = await win.locator('[data-content-action="ann-callout-confirm"]').count();
  if (bar2 > 0) {
    await win.click('[data-content-action="ann-callout-confirm"]');
    await win.waitForTimeout(1100);
  }
  arrows = await calloutArrow();
  const coFinal = await findKind('callout');
  const anchorFinal = anchorIsP2 ? arrows[0].anchor : arrows[0].entry;
  const entryFinal = anchorIsP2 ? arrows[0].entry : arrows[0].anchor;
  const leaderLen = arrows[0].len;
  const coFinalLocal = await toPageLocal(coFinal.rect);
  const entryOnBox = distToRect(entryFinal, coFinalLocal) < 15;
  const noTear = leaderLen > 40 && entryOnBox
    && Math.abs(anchorFinal.x - anchorAfterConfirm1.x) < TOL
    && Math.abs(anchorFinal.y - anchorAfterConfirm1.y) < TOL
    && Math.abs(coFinal.rect.x - (boxAfterConfirm1.x + bdx)) < TOL
    && Math.abs(coFinal.rect.y - (boxAfterConfirm1.y + bdy)) < TOL;
  const engFinal = await engineAnns('v4-after-final-confirm');
  await shot('def-160-1725-v4-after-confirm.png');
  await cropShot('def-160-1725-v4-after-confirm-crop.png', { x: coFinal.rect.x - 60, y: coFinal.rect.y - 60, w: coFinal.rect.w + 220, h: coFinal.rect.h + 220 });

  // ---- save + reopen: geometry persists, leader still connects ----
  const savePath = path.join(os.tmpdir(), `tflex-def161-callout-${Date.now()}.pdf`);
  await saveAsReopen(savePath);
  const coRe = await findKind('callout');
  const arrowsRe = await calloutArrow();
  const boxReLocal = coRe ? await toPageLocal(coRe.rect) : null;
  const anchorRe = arrowsRe && arrowsRe.length ? (anchorIsP2 ? arrowsRe[0].anchor : arrowsRe[0].entry) : null;
  const boxFinalLocal = await toPageLocal(coFinal.rect);
  const anchorFinalLocalPg = { x: +(anchorFinal.x), y: +(anchorFinal.y) };
  const reopenBoxKept = !!(boxReLocal && Math.abs(boxReLocal.x - boxFinalLocal.x) < TOL && Math.abs(boxReLocal.y - boxFinalLocal.y) < TOL);
  const reopenAnchorKept = !!(arrowsRe && anchorRe && Math.abs(anchorRe.x - anchorFinalLocalPg.x) < TOL && Math.abs(anchorRe.y - anchorFinalLocalPg.y) < TOL);
  const reopenLeaderOk = !!(arrowsRe && arrowsRe[0] && arrowsRe[0].len > 40 && coRe
    && distToRect(arrowsRe[0].entry, await toPageLocal(coRe.rect)) < 15);
  await shot('def-160-1725-v4-reopened.png');
  if (coRe) await cropShot('def-160-1725-v4-reopened-crop.png', { x: coRe.rect.x - 60, y: coRe.rect.y - 60, w: coRe.rect.w + 260, h: coRe.rect.h + 260 });
  await engineAnns('v4-reopened');

  process.stdout.write(`\n[RES|V4] probeGrabbable=${!!grabPoint} shaftHits=${JSON.stringify(probeHits.map((p) => [p.t, p.hit ? (p.hit.inCalloutSvg ? 'CALLOUT-SVG' : p.hit.inTextLayer ? 'textLayer' : `${p.hit.tag}.${p.hit.cls}`) : 'none']))} anchorMovedAlone=${anchorMoved} boxStayedDuringAnchorDrag=${boxStayed} confirm1KeptAnchor=${confirm1KeptAnchor} boxStillAtOriginal1=${boxStillAtOriginal1} boxMovedAlone=${boxMovedAlone} anchorUnmovedDuringBoxDrag=${anchorUnmoved2} noTear=${noTear} leaderLen=${leaderLen} entryOnBox=${entryOnBox} reopenBoxKept=${reopenBoxKept} reopenAnchorKept=${reopenAnchorKept} reopenLeaderOk=${reopenLeaderOk} pageErrors=${pageErrors.length}\n`);
  process.stdout.write(`[RES|V4-DETAIL] boxBefore1=${JSON.stringify(boxBefore1)} boxAfterConfirm1=${JSON.stringify(boxAfterConfirm1)} boxFinal=${JSON.stringify(coFinal && coFinal.rect)} boxReopenedLocal=${JSON.stringify(boxReLocal)} boxFinalLocal=${JSON.stringify(boxFinalLocal)} anchorAfterConfirm1=${JSON.stringify(anchorAfterConfirm1)} anchorFinal=${JSON.stringify(anchorFinal)} anchorReopened=${JSON.stringify(arrowsRe && (anchorIsP2 ? arrowsRe[0].anchor : arrowsRe[0].entry))} engineCallout=${JSON.stringify(engFinal.anns.filter((a) => a.kind === 'callout'))}\n`);
  expect(hitCss && hitCss.present, 'V4 callout hit line exists with pointer-events: stroke').toBe(true);
  expect(anchorMoved, 'V4 shaft drag: anchor moves alone').toBe(true);
  expect(boxStayed, 'V4 shaft drag: box does not move').toBe(true);
  expect(confirm1KeptAnchor, 'V4 confirm keeps the moved anchor').toBe(true);
  expect(boxStillAtOriginal1, 'V4 anchor-only move does not drag the box').toBe(true);
  expect(boxMovedAlone, 'V4 box drag: box moves alone').toBe(true);
  expect(anchorUnmoved2, 'V4 box drag: anchor stays put').toBe(true);
  expect(noTear, 'V4 confirm: box + arrow consistent (no tear)').toBe(true);
  expect(reopenBoxKept && reopenAnchorKept && reopenLeaderOk, 'V4 save+reopen: moved geometry persists, leader intact').toBe(true);
  expect(pageErrors.length, 'no pageerrors').toBe(0);
});

// ---------------------------------------------------------------------------
// V4b: control - the STANDALONE arrow's hit line still grabs on v1.7.25
// (tells us whether the callout shaft gap is callout-specific or global)
// ---------------------------------------------------------------------------
test('V4b: control - standalone arrow shaft grab moves the arrow', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();

  await armAnnTool('arrow');
  await drag(pr.x + pr.w * 0.5, pr.y + pr.h * 0.2, 140, 80);
  await win.waitForTimeout(600);
  await armAnnTool('select');
  await win.waitForTimeout(300);

  const engBefore = await engineAnns('v4b-before');
  const arr = engBefore.anns.find((a) => a.kind === 'arrow');
  process.stdout.write(`[V4B COMMIT] ${JSON.stringify(arr)}\n`);
  expect(Boolean(arr && arr.from && arr.to), 'standalone arrow committed').toBe(true);

  // shaft midpoint via the visual line's own bbox (screen coords)
  const lineInfo = await win.evaluate((pg) => {
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    const g = slot && slot.querySelector('g.ann-arrow[data-kind="arrow"]');
    if (!g) return null;
    const line = g.querySelector('line:not(.ann-arrow-hit)');
    const lr = line.getBoundingClientRect();
    const page = slot.querySelector('.pdf-page') || slot;
    const pgR = page.getBoundingClientRect();
    return {
      midX: +(lr.x + lr.width / 2 - pgR.x).toFixed(1),
      midY: +(lr.y + lr.height / 2 - pgR.y).toFixed(1),
      len: +Math.hypot(lr.width, lr.height).toFixed(1),
    };
  }, PAGE);
  process.stdout.write(`[V4B LINE] ${JSON.stringify(lineInfo)}\n`);
  expect(lineInfo).toBeTruthy();
  const mid = { x: pr.x + lineInfo.midX, y: pr.y + lineInfo.midY };
  const hit = await win.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    if (!e) return null;
    const s = e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className;
    return { tag: e.tagName.toLowerCase(), cls: String(s || '').split(' ').filter(Boolean).slice(0, 3).join('.'),
      pe: getComputedStyle(e).pointerEvents, inArrowSvg: !!e.closest('g.ann-arrow') };
  }, [mid.x, mid.y]);
  process.stdout.write(`[V4B HIT] ${JSON.stringify(hit)}\n`);

  await win.mouse.move(mid.x, mid.y);
  await win.mouse.down();
  await win.mouse.move(mid.x + 90, mid.y + 60, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(500);

  // pending state lives in the DOM (the engine commits on Confirm) —
  // measure the visual line bbox before judging
  const lineAfter = await win.evaluate((pg) => {
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    const g = slot && slot.querySelector('g.ann-arrow[data-kind="arrow"]');
    if (!g) return null;
    const lr = g.querySelector('line:not(.ann-arrow-hit)').getBoundingClientRect();
    const page = slot.querySelector('.pdf-page') || slot;
    const pgR = page.getBoundingClientRect();
    return { midX: +(lr.x + lr.width / 2 - pgR.x).toFixed(1), midY: +(lr.y + lr.height / 2 - pgR.y).toFixed(1) };
  }, PAGE);
  const domMoved = !!(lineAfter && (Math.abs(lineAfter.midX - lineInfo.midX) > 20 || Math.abs(lineAfter.midY - lineInfo.midY) > 20));
  process.stdout.write(`[V4B PENDING-DOM] lineBeforeMid=(${lineInfo.midX},${lineInfo.midY}) lineAfterMid=(${lineAfter && lineAfter.midX},${lineAfter && lineAfter.midY}) domMoved=${domMoved}\n`);
  await shot('def-160-1725-v4b-arrow-moved-pending.png');

  const barCount = await win.locator('[data-content-action="ann-arrow-confirm"]').count();
  if (barCount > 0) {
    await win.click('[data-content-action="ann-arrow-confirm"]');
    await win.waitForTimeout(1100);
  }
  const engAfter = await engineAnns('v4b-after');
  const arr2 = engAfter.anns.find((a) => a.kind === 'arrow');
  const engineMoved = !!(arr && arr2 && arr2.from && arr.from
    && (Math.abs(arr2.from.x - arr.from.x) > 5 || Math.abs(arr2.to.x - arr.to.x) > 5));
  process.stdout.write(`\n[RES|V4B] hit=${JSON.stringify(hit)} domMoved=${domMoved} engineMoved=${engineMoved} pageErrors=${pageErrors.length}\n`);
  expect(domMoved || engineMoved, 'V4b control: standalone arrow moves when its shaft is grabbed').toBe(true);
  expect(pageErrors.length, 'no pageerrors').toBe(0);
});

// ---------------------------------------------------------------------------
// V5: textbox + callout double-click -> toolbox shows COLOR swatches
// ---------------------------------------------------------------------------
test('V5: DEF-161 feature - textbox and callout dblclick toolbox shows color swatches', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();

  // commit a textbox
  await armAnnTool('textbox');
  await win.mouse.click(pr.x + pr.w * 0.15, pr.y + pr.h * 0.12);
  await win.waitForTimeout(500);
  const ta1 = win.locator('[data-annotation-editor="textbox"] textarea');
  await ta1.waitFor({ timeout: 8000 });
  await ta1.fill('SWATCH TB');
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(800);

  // commit a callout
  await armAnnTool('callout');
  await drag(pr.x + pr.w * 0.5, pr.y + pr.h * 0.45, 150, 90);
  await win.waitForTimeout(500);
  const ta2 = win.locator('[data-annotation-editor="callout"] textarea');
  await ta2.waitFor({ timeout: 8000 });
  await ta2.fill('SWATCH CO');
  await win.click('[data-annotation-action="callout-confirm"]');
  await win.waitForTimeout(800);

  await armAnnTool('select');
  await win.waitForTimeout(300);

  const results = {};
  for (const kind of ['textbox', 'callout']) {
    await scrollToPage(PAGE); // normalize: editor interactions can scroll the doc
    const el = await findKind(kind);
    expect(el, `${kind} committed`).toBeTruthy();
    const cx = el.rect.x + el.rect.w * 0.5;
    const cy = el.rect.y + el.rect.h * 0.5;
    await win.mouse.dblclick(cx, cy, { delay: 60 });
    await win.waitForTimeout(900);

    const chrome = await floatingChrome();
    process.stdout.write(`[V5 ${kind} CHROME] ${JSON.stringify(chrome)}\n`);
    const probe = await win.evaluate((k) => {
      const wrap = document.querySelector(`[data-annotation-editor-wrap="edit-${k}"]`);
      if (!wrap) return { open: false };
      const wr = wrap.getBoundingClientRect();
      const section = wrap.querySelector('[data-annotation-color-section]');
      const swatches = [...wrap.querySelectorAll('.content-color-swatch')];
      const hex = wrap.querySelector('[data-ann-color-hex]');
      const activeBefore = wrap.querySelector('.content-color-swatch-active');
      return {
        open: true,
        wrapRect: { x: Math.round(wr.x), y: Math.round(wr.y), w: Math.round(wr.width), h: Math.round(wr.height) },
        swatchCount: swatches.length,
        visibleSwatches: swatches.filter((s) => s.getBoundingClientRect().width > 0 && s.getBoundingClientRect().height > 0).length,
        hexPresent: !!hex,
        activeBefore: activeBefore ? activeBefore.getAttribute('data-ann-color-edit') : null,
        hasTextArea: !!wrap.querySelector('textarea'),
      };
    }, kind);
    process.stdout.write(`[V5 ${kind} TOOLBOX] ${JSON.stringify(probe)}\n`);
    await shot(`def-160-1725-v5-dblclk-${kind}.png`);
    if (probe.wrapRect) await cropShot(`def-160-1725-v5-dblclk-${kind}-crop.png`, probe.wrapRect);

    // pick a swatch -> active state must move (the swatch is live, not decor)
    let activeAfter = null;
    let editorClosed = false;
    if (probe.open && probe.swatchCount > 0) {
      await win.click(`[data-annotation-editor-wrap="edit-${kind}"] [data-ann-color-edit="teal"]`);
      await win.waitForTimeout(300);
      activeAfter = await win.evaluate((k) => {
        const wrap = document.querySelector(`[data-annotation-editor-wrap="edit-${k}"]`);
        const a = wrap && wrap.querySelector('.content-color-swatch-active');
        return a ? a.getAttribute('data-ann-color-edit') : null;
      }, kind);
      await cropShot(`def-160-1725-v5-dblclk-${kind}-teal-picked.png`, { x: probe.wrapRect.x, y: probe.wrapRect.y, w: probe.wrapRect.w, h: probe.wrapRect.h });
      // focus the textarea so the editor's own Escape (cancel) handler fires
      await win.click(`[data-annotation-editor-wrap="edit-${kind}"] textarea`);
      await win.waitForTimeout(200);
    }
    await win.keyboard.press('Escape');
    await win.waitForTimeout(500);
    editorClosed = (await win.evaluate((k) => !document.querySelector(`[data-annotation-editor-wrap="edit-${k}"]`), kind));

    results[kind] = { ...probe, activeAfter, editorClosed };
    process.stdout.write(`[V5 ${kind}] activeBefore=${probe.activeBefore} activeAfter=${activeAfter} editorClosed=${editorClosed}\n`);
  }

  process.stdout.write(`\n[RES|V5] ${JSON.stringify(results)} pageErrors=${pageErrors.length}\n`);
  for (const kind of ['textbox', 'callout']) {
    expect(results[kind].open, `V5 ${kind}: dblclick opens the toolbox`).toBe(true);
    expect(results[kind].swatchCount, `V5 ${kind}: toolbox carries the 9-color swatch row`).toBe(9);
    expect(results[kind].visibleSwatches, `V5 ${kind}: swatches visible`).toBe(9);
    expect(results[kind].hexPresent, `V5 ${kind}: custom hex input present`).toBe(true);
    expect(results[kind].activeAfter, `V5 ${kind}: picking a swatch moves the active state`).toBe('teal');
    expect(results[kind].editorClosed, `V5 ${kind}: Escape closes the toolbox`).toBe(true);
  }
  expect(pageErrors.length, 'no pageerrors').toBe(0);
});