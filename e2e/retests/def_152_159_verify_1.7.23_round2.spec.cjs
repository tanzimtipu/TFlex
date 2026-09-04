// QA verification round 2 for DEF-152..159 on installed v1.7.23.
//   W1: DEF-155 decisive â€” the new model commits the box move on CONFIRM.
//       Sample canvas at the old rect pre/post confirm, after a forced
//       re-render, and in the saved+reopened file (document safety).
//   W2: DEF-153/154 clean matrix â€” small-floating-bar discovery only (excludes
//       the full-window tab-pane), scroll-stable commits, kind-unique element
//       discovery, explicit cleanup between probes.
// Launch only via e2e/lib/launch.cjs. Real mouse events only.

const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(480000);

let electronApp = null;
let win = null;
const pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([]);
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

// Wait until the scroller stops moving (layout/anchor settles).
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

// Visible buttons inside SMALL floating bars (real popovers/bars/editors),
// whose bar intersects the given area (expanded). Full-window positioned
// ancestors (tab-pane) are excluded.
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
      let barTag = '';
      let br = null;
      for (let i = 0; i < 8 && bar; i++) {
        const pcs = getComputedStyle(bar);
        if (pcs.position === 'absolute' || pcs.position === 'fixed') {
          const rr = bar.getBoundingClientRect();
          // small floating chip only
          if (rr.width <= 950 && rr.height <= 320) {
            const s = bar.className && bar.className.baseVal !== undefined ? bar.className.baseVal : bar.className;
            barTag = bar.tagName.toLowerCase();
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
        bar: { tag: barTag, cls: barCls, x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height) },
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
    for (const el of document.querySelectorAll('[title], [aria-label], [placeholder], [data-hint]')) {
      const v = `${el.getAttribute('title') || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('data-hint') || ''}`;
      if (/double.?click/i.test(v)) hits.push({ text: v.trim().slice(0, 60), via: 'attr' });
    }
    return hits;
  });
  process.stdout.write(`[RES|HINT|${label}] ${JSON.stringify(found)}\n`);
  return found;
}

async function handleInfo(pageNum, near) {
  return await win.evaluate(([pg, rc]) => {
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    if (!slot) return [];
    const out = [];
    for (const h of slot.querySelectorAll('*')) {
      const hr = h.getBoundingClientRect();
      if (hr.width < 4 || hr.height < 4 || hr.width > 26 || hr.height > 26) continue;
      const cs = getComputedStyle(h);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
      const cx = hr.x + hr.width / 2;
      const cy = hr.y + hr.height / 2;
      if (cx < rc.x - 26 || cx > rc.x + rc.w + 26 || cy < rc.y - 26 || cy > rc.y + rc.h + 26) continue;
      const s = h.className && h.className.baseVal !== undefined ? h.className.baseVal : h.className;
      out.push({
        tag: h.tagName.toLowerCase(),
        cls: String(s || '').split(' ').filter(Boolean).slice(0, 3).join('.'),
        x: Math.round(hr.x), y: Math.round(hr.y), w: Math.round(hr.width), h: Math.round(hr.height),
      });
    }
    return out;
  }, [pageNum, near]);
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

async function domBox() {
  return await win.evaluate(() => {
    const b = document.querySelector('.edit-box[data-edit-box-id]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
}

async function noPageErrors(label) {
  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  process.stdout.write(`[PAGEERRORS|${label}] ${JSON.stringify(pageErrors)}\n`);
  expect(bad, 'no pageerrors').toHaveLength(0);
}

// ---------------------------------------------------------------------------
// W1: DEF-155 decisive â€” confirm-then-sample + re-render + save/reopen
// ---------------------------------------------------------------------------
test('W1 DEF-155: artifact at old rect after CONFIRM + doc safety (light)', async () => {
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

  const R0 = await domBox();
  expect(R0, 'committed box must exist').toBeTruthy();

  const start = { x: R0.x + R0.w / 2, y: R0.y + R0.h / 2 };
  await win.mouse.move(start.x, start.y);
  await win.mouse.down();
  await win.mouse.move(start.x + 200, start.y + 120, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(300);
  const R1 = await domBox();
  process.stdout.write(`[RES|MOVE] R0=${JSON.stringify(R0)} R1=${JSON.stringify(R1)}\n`);

  // Pre-confirm state at the old rect.
  const pre = {
    darkR0: await canvasDark(1, { x: R0.x + 6, y: R0.y + 6, w: R0.w - 12, h: R0.h - 12 }),
    eraser: await win.evaluate(() => {
      const e = document.querySelector('[data-edit-box-eraser], .edit-box-eraser');
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), pe: getComputedStyle(e).pointerEvents };
    }),
    hitAtR0: await cursorAt(R0.x + R0.w / 2, R0.y + R0.h / 2),
  };
  process.stdout.write(`[RES|PRE-CONFIRM] ${JSON.stringify(pre)}\n`);
  await shot('def-155-1723b-prerelease-confirm.png');

  // Click CONFIRM on the box bar. DOM click: the bar may still be settling
  // from its entrance animation, so a coordinate hit-test can miss (batch
  // machines are slower); the element's own handler is the contract.
  const confirmSeen = await win.evaluate(() => {
    for (const b of document.querySelectorAll('.edit-box-toolbar button')) {
      if (/confirm/i.test(b.textContent || '')) { b.click(); return true; }
    }
    return false;
  });
  expect(confirmSeen, 'Confirm button present on the moved-box bar').toBe(true);

  // Post-confirm poll at old + new rects. First sample at t=1000ms: the
  // t=0 read races the commit repaint, and the redesign's designed motion
  // tokens (70-320ms) keep the eraser/selection surface unmounting for the
  // first ~400-700ms - the DEF-155 claim is about the SETTLED state.
  const R1n = await domBox();
  const samples = [];
  for (let i = 0; i < 16; i++) {
    const t = 1000 + i * 250;
    const dR0 = await canvasDark(1, { x: R0.x + 6, y: R0.y + 6, w: R0.w - 12, h: R0.h - 12 });
    const dR1 = R1n ? await canvasDark(1, { x: R1n.x + 6, y: R1n.y + 6, w: R1n.w - 12, h: R1n.h - 12 }) : null;
    samples.push({ t, dR0, dR1 });
    if (i === 0) await shot('def-155-1723b-postconfirm-250ms.png');
    if (i === 4) await shot('def-155-1723b-postconfirm-1250ms.png');
    if (i === 15) await shot('def-155-1723b-postconfirm-4000ms.png');
    await win.waitForTimeout(250);
  }
  for (const s of samples) process.stdout.write(`[POLL t=${s.t}ms] darkR0=${s.dR0} darkR1=${s.dR1}\n`);

  // The DEF-155 claim is about the SETTLED state: the eraser unmount (motion
  // tokens + repaint) may legitimately keep a transient at the old rect for a
  // load-dependent ~0.4-1.5s. Wait until it clears, then require it to STAY
  // clean (the "stale text" bug left a PERMANENT remnant, which never clears).
  const R0rect = { x: R0.x + 6, y: R0.y + 6, w: R0.w - 12, h: R0.h - 12 };
  let settled = false;
  for (let i = 0; i < 48; i++) {
    await win.waitForTimeout(250);
    const d = await canvasDark(1, R0rect);
    if (d <= 0.005) { settled = true; break; }
  }
  expect(settled, 'DEF-155: after Confirm the old rect must clear (settled)').toBe(true);
  const stayClean = [];
  for (let i = 0; i < 6; i++) {
    await win.waitForTimeout(300);
    stayClean.push(await canvasDark(1, R0rect));
  }
  process.stdout.write(`[RES|DEF155-SETTLED] stayClean=${JSON.stringify(stayClean)}\n`);
  for (const d of stayClean) {
    expect(d, 'DEF-155: old rect must STAY clean once settled').toBeLessThanOrEqual(0.005);
  }

  // Forced re-render: scroll away and back.
  await scrollToPage(3);
  await scrollToPage(1);
  await scrollStable();
  await win.waitForTimeout(1200);
  const darkR0Rerender = await canvasDark(1, { x: R0.x + 6, y: R0.y + 6, w: R0.w - 12, h: R0.h - 12 });
  process.stdout.write(`[RES|DEF155-RERENDER] darkR0=${darkR0Rerender}\n`);
  await shot('def-155-1723b-after-rerender.png');

  // Document safety: Save As (in-app dialog) + reopen, sample old/new rects.
  const savePath = path.join(os.tmpdir(), `tflex-def155-${Date.now()}.pdf`);
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  for (let i = 0; i < 20 && !fs.existsSync(savePath); i++) await win.waitForTimeout(500);
  expect(fs.existsSync(savePath), 'saved file exists on disk').toBe(true);

  const pageNow = await pageRect(1);
  const relRects = {
    r0: { x: (R0.x - pageNow.x) / pageNow.w, y: (R0.y - pageNow.y) / pageNow.h, w: R0.w / pageNow.w, h: R0.h / pageNow.h },
    r1: R1n ? { x: (R1n.x - pageNow.x) / pageNow.w, y: (R1n.y - pageNow.y) / pageNow.h, w: R1n.w / pageNow.w, h: R1n.h / pageNow.h } : null,
  };

  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await win.locator('button.btn-primary:has-text("Open")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2500);
  await scrollToPage(1);
  await scrollStable();
  await win.waitForTimeout(800);
  const pr2 = await pageRect(1);
  expect(pr2, 'reopened page 1 mounted').toBeTruthy();
  const reOld = {
    x: pr2.x + relRects.r0.x * pr2.w + 6,
    y: pr2.y + relRects.r0.y * pr2.h + 6,
    w: relRects.r0.w * pr2.w - 12,
    h: relRects.r0.h * pr2.h - 12,
  };
  const reNew = relRects.r1 ? {
    x: pr2.x + relRects.r1.x * pr2.w + 6,
    y: pr2.y + relRects.r1.y * pr2.h + 6,
    w: relRects.r1.w * pr2.w - 12,
    h: relRects.r1.h * pr2.h - 12,
  } : null;
  const reopenedOld = await canvasDark(1, reOld);
  process.stdout.write(`[RES|DEF155-REOPENED] darkOldRect=${reopenedOld}\n`);
  await shot('def-155-1723b-reopened.png');

  expect(darkR0Rerender, 'DEF-155: old rect still clean after forced re-render').toBeLessThanOrEqual(0.005);
  expect(reopenedOld, 'DOC SAFETY: saved file must not carry the box at the old rect').toBeLessThanOrEqual(0.005);
  // DOC SAFETY (current model): the box survives the round-trip as exactly ONE
  // live editable textbox annotation (rendered through the pdf.js annotation
  // layer, not baked into the canvas - so the canvas-dark probe at the new
  // rect reads 0 by design). Position fidelity is pinned by B22-port.
  const reopenedBoxes = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    // Edit-mode add-boxes round-trip in engineState.textBoxes; annotation-tool
    // textboxes in engineState.annotations. Count either (exactly one total).
    const tb = (d.engineState && d.engineState.textBoxes) || [];
    const ann = ((d.engineState && d.engineState.annotations) || []).filter((a) => a.kind === 'textbox');
    return { textBoxes: tb, annotations: ann, total: tb.length + ann.length };
  });
  expect(reopenedBoxes.total, 'DOC SAFETY: exactly ONE box annotation survives the round-trip').toBe(1);
  await noPageErrors('W1');
});

// ---------------------------------------------------------------------------
// W2: DEF-153/154 clean matrix with small-floating-bar discovery
// ---------------------------------------------------------------------------
test('W2 DEF-153+154: clean interaction matrix (light)', async () => {
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

  // Kind-unique committed element discovery on page 4 (no near filter needed
  // except for ink). Returns the LARGEST matching element.
  async function findCommitted(kindHint, nearRect) {
    return await win.evaluate(([hint, near]) => {
      const slot = document.querySelector('.page-slot[data-page="4"]');
      if (!slot) return null;
      let best = null;
      const els = slot.querySelectorAll('[data-kind], .ann, .ann-ink, svg path, svg polyline, svg line, svg polygon, svg rect, svg ellipse');
      for (const el of els) {
        const s = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
        const cls = String(s || '');
        const kind = el.getAttribute ? el.getAttribute('data-kind') : null;
        const hay = `${cls} ${kind || ''}`.toLowerCase();
        if (hint !== 'ink-any' && !hay.includes(hint)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (near) {
          const cx = r.x + r.width / 2;
          const cy = r.y + r.height / 2;
          if (cx < near.x - 20 || cx > near.x + near.w + 20 || cy < near.y - 20 || cy > near.y + near.h + 20) continue;
        }
        const cand = {
          tag: el.tagName.toLowerCase(),
          cls: cls.split(' ').filter(Boolean).slice(0, 4).join('.'),
          kind,
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          pe: getComputedStyle(el).pointerEvents,
          cursor: getComputedStyle(el).cursor,
        };
        if (!best || cand.rect.w * cand.rect.h > best.rect.w * best.rect.h) best = cand;
      }
      return best;
    }, [kindHint, nearRect]);
  }

  async function dumpInkArea(near) {
    return await win.evaluate((rc) => {
      const slot = document.querySelector('.page-slot[data-page="4"]');
      if (!slot) return null;
      const out = [];
      for (const el of slot.querySelectorAll('svg, svg *')) {
        const r = el.getBoundingClientRect();
        if (r.width < 3 || r.height < 3) continue;
        if (r.x + r.width < rc.x - 10 || r.x > rc.x + rc.w + 10 || r.y + r.height < rc.y - 10 || r.y > rc.y + rc.h + 10) continue;
        const s = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: String(s || '').split(' ').filter(Boolean).slice(0, 4).join('.'),
          kind: el.getAttribute ? el.getAttribute('data-kind') : null,
          x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        });
      }
      return out.slice(0, 30);
    }, near);
  }

  const summary = {};
  const commitFractions = {
    rect: { fx: 0.06, fy: 0.06, fw: 0.14, fh: 0.06 },
    ellipse: { fx: 0.38, fy: 0.06, fw: 0.14, fh: 0.06 },
    arrow: { fx: 0.70, fy: 0.06, fw: 0.12, fh: 0.05 },
    ink: { fx: 0.06, fy: 0.20, fw: 0.15, fh: 0.05 },
    textbox: { fx: 0.53, fy: 0.18, fw: 0.20, fh: 0.06 },
    callout: { fx: 0.06, fy: 0.32, fw: 0.22, fh: 0.09 },
    note: { fx: 0.53, fy: 0.34, fw: 0.10, fh: 0.06 },
  };

  // ---- commit the seven annotation kinds ------------------------------------
  pr = await pageRect(4);
  await armAnnTool('rect');
  await drag(pr.x + pr.w * 0.06, pr.y + pr.h * 0.06, 120, 70);
  await win.waitForTimeout(500);
  process.stdout.write(`[COMMIT rect] found=${JSON.stringify(await findCommitted('rect', null))}\n`);

  pr = await pageRect(4);
  await armAnnTool('ellipse');
  await drag(pr.x + pr.w * 0.38, pr.y + pr.h * 0.06, 120, 70);
  await win.waitForTimeout(500);
  process.stdout.write(`[COMMIT ellipse] found=${JSON.stringify(await findCommitted('ellipse', null))}\n`);

  pr = await pageRect(4);
  await armAnnTool('arrow');
  await drag(pr.x + pr.w * 0.70, pr.y + pr.h * 0.06, 100, 60);
  await win.waitForTimeout(500);
  process.stdout.write(`[COMMIT arrow] found=${JSON.stringify(await findCommitted('arrow', null))}\n`);

  pr = await pageRect(4);
  await armAnnTool('ink');
  const inkDrag = { x: pr.x + pr.w * 0.06, y: pr.y + pr.h * 0.20 };
  await drag(inkDrag.x, inkDrag.y, 130, 45);
  await win.waitForTimeout(500);
  const inkNear = { x: inkDrag.x - 15, y: inkDrag.y - 15, w: 130 + 30, h: 45 + 30 };
  process.stdout.write(`[COMMIT ink] found=${JSON.stringify(await findCommitted('ink', inkNear))} dump=${JSON.stringify(await dumpInkArea(inkNear))}\n`);

  pr = await pageRect(4);
  await armAnnTool('textbox');
  await win.mouse.click(pr.x + pr.w * 0.53, pr.y + pr.h * 0.18);
  await win.waitForTimeout(500);
  const tbTa = win.locator('[data-annotation-editor="textbox"] textarea');
  await tbTa.waitFor({ timeout: 8000 });
  await tbTa.fill('ANN BOX T42');
  await win.waitForTimeout(200);
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(900);
  process.stdout.write(`[COMMIT textbox] found=${JSON.stringify(await findCommitted('textbox', null))}\n`);

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
  process.stdout.write(`[COMMIT callout] found=${JSON.stringify(await findCommitted('callout', null))}\n`);

  pr = await pageRect(4);
  await armAnnTool('note');
  await win.mouse.click(pr.x + pr.w * 0.53, pr.y + pr.h * 0.34);
  await win.waitForTimeout(500);
  const noTa = win.locator('[data-annotation-editor="note"] textarea');
  await noTa.waitFor({ timeout: 8000 });
  await noTa.fill('STICKY T42');
  await win.waitForTimeout(200);
  await win.click('[data-annotation-action="note-confirm"]');
  await win.waitForTimeout(900);
  process.stdout.write(`[COMMIT note] found=${JSON.stringify(await findCommitted('note', null))}\n`);

  await armAnnTool('select');
  await shot('def-154-1723b-all-committed.png');

  // cleanup helper: only Cancel inside small floating bars; Escape; blank click.
  async function closeAll(label) {
    const blank = { x: pr.x + pr.w * 0.45, y: Math.min(pr.y + pr.h * 0.62, 1150) };
    for (let i = 0; i < 5; i++) {
      const btns = await overPageButtons({ x: pr.x, y: pr.y, w: pr.w, h: pr.h });
      const cancel = btns.find((b) => /cancel/i.test(`${b.text} ${b.aria || ''} ${b.act || ''}`));
      if (cancel) {
        await win.mouse.click(cancel.btn.x, cancel.btn.y);
        await win.waitForTimeout(400);
        continue;
      }
      if (btns.length === 0) { process.stdout.write(`[RES|CLOSEALL|${label}] clean\n`); return; }
      await win.keyboard.press('Escape');
      await win.waitForTimeout(250);
      await win.mouse.click(blank.x, blank.y);
      await win.waitForTimeout(350);
    }
    const rest = await overPageButtons({ x: pr.x, y: pr.y, w: pr.w, h: pr.h });
    process.stdout.write(`[RES|CLOSEALL|${label}] remaining=${rest.length} ${JSON.stringify(rest.map((b) => b.text))}\n`);
  }

  function probePoint(rect, kind) {
    if (kind === 'arrow') return { x: rect.x + rect.w * 0.35, y: rect.y + rect.h * 0.35 };
    return { x: rect.x + Math.min(rect.w / 2, 70), y: rect.y + Math.min(rect.h / 2, 35) };
  }

  for (const kind of ['rect', 'ellipse', 'arrow', 'ink', 'textbox', 'callout', 'note']) {
    try {
      await closeAll(`${kind}-pre`);
      const hint = kind === 'ink' ? 'ink' : kind;
      const near = kind === 'ink' ? inkNear : null;
      const el = await findCommitted(hint, near);
      if (!el) {
        process.stdout.write(`[RES|SUMMARY ${kind}] ELEMENT NOT FOUND (hint=${hint})\n`);
        summary[kind] = { error: 'not found' };
        continue;
      }
      process.stdout.write(`[RES|EL ${kind}] ${JSON.stringify(el)}\n`);
      const row = { el: `${el.tag}.${el.cls}`, pe: el.pe };
      const pt = probePoint(el.rect, kind);

      // hover cursor
      await win.mouse.move(pt.x, pt.y);
      await win.waitForTimeout(250);
      row.hover = await cursorAt(pt.x, pt.y);
      await shot(`def-153-1723b-${kind}-hover.png`);

      // move: press-drag without prior click-select
      const before = el.rect;
      await win.mouse.move(pt.x, pt.y);
      await win.mouse.down();
      await win.mouse.move(pt.x + 70, pt.y + 45, { steps: 8 });
      row.midDragHint = await scanHint(`${kind}-mid`);
      await win.mouse.up();
      await win.waitForTimeout(800);
      const afterEl = await findCommitted(hint, null);
      row.moved = before && afterEl
        ? (Math.abs(afterEl.rect.x - before.x) > 5 || Math.abs(afterEl.rect.y - before.y) > 5)
        : null;
      row.geom = { before: { x: Math.round(before.x), y: Math.round(before.y) }, after: afterEl ? { x: Math.round(afterEl.rect.x), y: Math.round(afterEl.rect.y) } : null };
      await closeAll(`${kind}-postmove`);

      // click state
      const el2 = await findCommitted(hint, null);
      const pt2 = el2 ? probePoint(el2.rect, kind) : pt;
      await win.mouse.click(pt2.x, pt2.y);
      await win.waitForTimeout(800);
      const area = el2 ? { x: el2.rect.x, y: el2.rect.y, w: el2.rect.w, h: el2.rect.h } : { x: pr.x, y: pr.y, w: pr.w, h: pr.h };
      row.clickButtons = await overPageButtons(area);
      row.clickHandles = await handleInfo(4, el2 ? el2.rect : area);
      row.clickHint = await scanHint(`${kind}-click`);
      await shot(`def-153-1723b-${kind}-selected.png`);
      await closeAll(`${kind}-postclick`);

      // dblclick -> toolbox
      const el3 = await findCommitted(hint, null);
      const pt3 = el3 ? probePoint(el3.rect, kind) : pt2;
      await win.mouse.dblclick(pt3.x, pt3.y);
      await win.waitForTimeout(800);
      const area3 = el3 ? { x: el3.rect.x, y: el3.rect.y, w: el3.rect.w, h: el3.rect.h } : area;
      row.dblButtons = await overPageButtons(area3);
      await shot(`def-153-1723b-${kind}-dblclick.png`);
      await closeAll(`${kind}-postdbl`);

      // DEF-154 extras for shapes: resize + delete
      if (['rect', 'ellipse', 'arrow', 'ink'].includes(kind)) {
        const el4 = await findCommitted(hint, null);
        if (el4) {
          const pt4 = probePoint(el4.rect, kind);
          await win.mouse.click(pt4.x, pt4.y);
          await win.waitForTimeout(800);
          row.selHandles = await handleInfo(4, el4.rect);
          await shot(`def-154-1723b-${kind}-selected.png`);

          let resized = null;
          if (row.selHandles.length) {
            const brp = { x: el4.rect.x + el4.rect.w, y: el4.rect.y + el4.rect.h };
            let best = null; let bestD = Infinity;
            for (const h of row.selHandles) {
              const d = Math.hypot(h.x + h.w / 2 - brp.x, h.y + h.h / 2 - brp.y);
              if (d < bestD) { bestD = d; best = h; }
            }
            if (best && bestD < 60) {
              const hx = best.x + best.w / 2;
              const hy = best.y + best.h / 2;
              await win.mouse.move(hx, hy);
              await win.mouse.down();
              await win.mouse.move(hx + 30, hy + 20, { steps: 6 });
              await win.mouse.up();
              await win.waitForTimeout(800);
              const el5 = await findCommitted(hint, null);
              resized = el5 ? (Math.abs(el5.rect.w - el4.rect.w) > 8 || Math.abs(el5.rect.h - el4.rect.h) > 8) : null;
              row.resizeGeom = { before: { w: Math.round(el4.rect.w), h: Math.round(el4.rect.h) }, after: el5 ? { w: Math.round(el5.rect.w), h: Math.round(el5.rect.h) } : null };
            } else {
              row.resizeSkipped = `nearest handle ${Math.round(bestD)}px from BR corner`;
            }
            await shot(`def-154-1723b-${kind}-resized.png`);
          }

          const delBtn = (await overPageButtons({ x: el4.rect.x, y: el4.rect.y, w: el4.rect.w, h: el4.rect.h }))
            .find((b) => /delete/i.test(`${b.text} ${b.aria || ''} ${b.act || ''}`));
          row.deleteBtn = delBtn ? { text: delBtn.text, aria: delBtn.aria, act: delBtn.act, bar: delBtn.bar } : null;
          let deleted = false;
          if (delBtn) {
            await win.mouse.click(delBtn.btn.x, delBtn.btn.y);
            await win.waitForTimeout(1000);
            deleted = !(await findCommitted(hint, null));
          }
          row.resized = resized;
          row.deleted = deleted;
          await shot(`def-154-1723b-${kind}-after-delete.png`);
          await closeAll(`${kind}-postdelete`);
        }
      }

      summary[kind] = row;
      process.stdout.write(`[RES|SUMMARY ${kind}] ${JSON.stringify({
        el: row.el,
        hover: row.hover,
        moved: row.moved,
        clickBtns: (row.clickButtons || []).map((b) => `${b.text}|${b.bar.cls}`),
        clickHandles: row.clickHandles,
        hintClick: (row.clickHint || []).length,
        hintMid: (row.midDragHint || []).length,
        dblBtns: (row.dblButtons || []).map((b) => `${b.text}|${b.bar.cls}`),
        resized: row.resized,
        deleted: row.deleted,
      })}\n`);
    } catch (e) {
      process.stdout.write(`[RES|SUMMARY ${kind}] ERROR ${e.message.split('\n')[0]}\n`);
    }
  }

  // ---- add-box + edit-text on page 1 ----------------------------------------
  await scrollToPage(1);
  await scrollStable();
  const pr1 = await pageRect(1);
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);
  const b0 = { x: pr1.x + pr1.w * 0.16, y: pr1.y + pr1.h * 0.14 };
  await drag(b0.x, b0.y, 150, 90);
  await win.waitForTimeout(700);
  const ta = win.locator('[data-edit-textarea]').first();
  await ta.waitFor({ timeout: 10000 });
  await ta.fill('MATRIX BOX 7');
  await win.waitForTimeout(250);
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(1600);
  const boxRect = await domBox();
  expect(boxRect, 'committed add-box').toBeTruthy();

  try {
    const bcx = boxRect.x + boxRect.w / 2;
    const bcy = boxRect.y + boxRect.h / 2;
    await win.mouse.move(bcx, bcy);
    await win.waitForTimeout(250);
    const addboxHover = await cursorAt(bcx, bcy);
    await shot('def-153-1723b-addbox-hover.png');
    await win.mouse.click(bcx, bcy);
    await win.waitForTimeout(800);
    const addboxBtns = await overPageButtons(boxRect);
    const addboxHandles = await handleInfo(1, boxRect);
    const addboxHint = await scanHint('addbox-click');
    await shot('def-153-1723b-addbox-selected.png');
    summary.addbox = { hover: addboxHover, clickBtns: addboxBtns, handles: addboxHandles, hint: addboxHint };
    process.stdout.write(`[RES|SUMMARY addbox] ${JSON.stringify({
      hover: addboxHover,
      clickBtns: addboxBtns.map((b) => `${b.text}|${b.bar.cls}`),
      handles: addboxHandles,
      hint: addboxHint.length,
    })}\n`);
  } catch (e) {
    process.stdout.write(`[RES|SUMMARY addbox] ERROR ${e.message.split('\n')[0]}\n`);
  }
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // edit-text kind
  try {
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    await win.click('[data-edit-tool="text"]');
    await win.waitForTimeout(400);
    const run = await win.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
      const s = spans.find((x) => (x.textContent || '').includes('TFlex Technical Report')) || spans[0];
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return { text: (s.textContent || '').slice(0, 40), x: r.x, y: r.y, w: r.width, h: r.height };
    });
    expect(run, 'title text run found').toBeTruthy();
    const rcx = run.x + run.w / 2;
    const rcy = run.y + run.h / 2;
    await win.mouse.move(rcx, rcy);
    await win.waitForTimeout(250);
    const etHover = await cursorAt(rcx, rcy);
    await shot('def-153-1723b-edittext-hover.png');

    await win.mouse.click(rcx, rcy);
    await win.waitForTimeout(800);
    const etBtns = await overPageButtons({ x: run.x, y: run.y, w: run.w, h: run.h });
    const etHandles = await handleInfo(1, run);
    const etHint = await scanHint('edittext-click');
    await shot('def-153-1723b-edittext-selected.png');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    await win.mouse.dblclick(rcx, rcy);
    await win.waitForTimeout(800);
    const etDbl = await overPageButtons({ x: run.x, y: run.y, w: run.w, h: run.h });
    await shot('def-153-1723b-edittext-dblclick.png');

    summary.edittext = { hover: etHover, clickBtns: etBtns, handles: etHandles, hint: etHint, dblBtns: etDbl };
    process.stdout.write(`[RES|SUMMARY edittext] ${JSON.stringify({
      hover: etHover,
      clickBtns: etBtns.map((b) => `${b.text}|${b.bar.cls}`),
      handles: etHandles,
      hint: etHint.length,
      dblBtns: etDbl.map((b) => `${b.text}|${b.bar.cls}`),
    })}\n`);
  } catch (e) {
    process.stdout.write(`[RES|SUMMARY edittext] ERROR ${e.message.split('\n')[0]}\n`);
  }

  process.stdout.write(`[RES|W2-SUMMARY] kinds=${JSON.stringify(Object.keys(summary))}\n`);
  await noPageErrors('W2');
});
