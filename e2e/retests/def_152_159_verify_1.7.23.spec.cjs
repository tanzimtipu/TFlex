// QA verification of DEF-152..DEF-159 on installed v1.7.23
// (C:\Users\tanzi\AppData\Local\Programs\tflex\TFlex.exe, FileVersion 1.7.23).
//
//   DEF-152: add-box moved box bar has Confirm + Edit + Delete.
//   DEF-153: hover=grab, single-click=select+movable (bar + handles +
//            "Double click to edit" hint), double-click=toolbox, consistent
//            across add-box, edit text, callout, note, rect, ellipse, arrow, ink.
//   DEF-154: shapes/ink selectable/movable/resizable/deletable from canvas.
//   DEF-155: no stale artifact at the original rect after box move.
//   DEF-156: "Drag to move" grip label stays visible on hover in dark mode.
//   DEF-157: callout arrow renders (non-zero length) + text readable in dark.
//   DEF-158: sticky-note committed text visible in dark.
//   DEF-159: dark-mode page text visible (note, annotation textbox, callout).
//
// Real mouse events only; cursors verified via elementFromPoint + computed
// styles (exactly what the user sees). Launch only via e2e/lib/launch.cjs.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(420000);

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

async function setTheme(want) {
  for (let i = 0; i < 5; i++) {
    const cur = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (cur === want) return;
    await win.click('.theme-toggle');
    await win.waitForTimeout(500);
  }
}

async function armAnnTool(tool) {
  await win.click(`[data-annotation-toolbar] [data-tool="${tool}"]`);
  await win.waitForTimeout(350);
}

// What the user sees under the cursor: hit element + effective CSS cursor.
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
      return String(s || '').split(' ').filter(Boolean).slice(0, 3).join('.');
    };
    return {
      cursor,
      hit: `${el.tagName.toLowerCase()}.${cls(el)}`,
      pe: getComputedStyle(el).pointerEvents,
    };
  }, [x, y]);
}

// Every floating bar/editor currently in the DOM with its buttons.
async function probeBars(label) {
  const out = await win.evaluate(() => {
    const sels = [
      '.edit-box-toolbar', '.edit-inline-editor', '.edit-image-toolbar',
      '.sig-action-bar', '.ann-editor', '[data-annotation-action-bar]',
      '[data-annotation-editor]', '.ann-textbox-wrap', '.ann-note-editor',
      '.ann-shape-toolbar', '[data-shape-toolbar]', '[data-annotation-toolbox]',
      '.color-palette',
    ];
    const seen = [];
    const idset = new Set();
    for (const sel of sels) {
      let list = [];
      try { list = Array.from(document.querySelectorAll(sel)); } catch (_) { /* bad sel */ }
      for (const c of list) {
        if (idset.has(c)) continue;
        idset.add(c);
        const r = c.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const buttons = Array.from(c.querySelectorAll('button')).map((b) => ({
          text: (b.textContent || '').trim(),
          aria: b.getAttribute('aria-label'),
          dataAction: b.getAttribute('data-edit-box-action')
            || b.getAttribute('data-edit-action')
            || b.getAttribute('data-annotation-action')
            || b.getAttribute('data-shape-action')
            || null,
          dataConfirm: b.getAttribute('data-edit-confirm'),
        }));
        seen.push({
          sel,
          editorKind: c.getAttribute('data-annotation-editor')
            || c.getAttribute('data-annotation-editor-wrap') || null,
          gripLabel: (c.querySelector('.ann-textbox-grip-label') || {}).textContent || null,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          buttons,
        });
      }
    }
    return seen;
  });
  process.stdout.write(`[BARS|${label}] ${JSON.stringify(out)}\n`);
  return out;
}

// "Double click to edit"-style hint: full text-node + attribute scan.
async function scanHint(label) {
  const found = await win.evaluate(() => {
    const hits = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const t = (node.textContent || '').trim();
      if (/double.?click/i.test(t)) {
        hits.push({ text: t.slice(0, 80), via: 'textNode', cls: String(node.parentElement.className).slice(0, 60) });
      }
      node = walker.nextNode();
    }
    for (const el of document.querySelectorAll('[title], [aria-label], [placeholder], [data-hint]')) {
      const v = `${el.getAttribute('title') || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('data-hint') || ''}`;
      if (/double.?click/i.test(v)) {
        hits.push({ text: v.trim().slice(0, 80), via: 'attr', cls: String(el.className).slice(0, 60) });
      }
    }
    return hits;
  });
  process.stdout.write(`[RES|HINTSCAN|${label}] ${JSON.stringify(found)}\n`);
  return found;
}

// Small handle-like elements near a rect (resize/rotate grips).
async function handleInfo(pageNum, near) {
  return await win.evaluate(([pg, rc]) => {
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    if (!slot) return null;
    const out = [];
    for (const h of slot.querySelectorAll('*')) {
      const hr = h.getBoundingClientRect();
      if (hr.width < 4 || hr.height < 4 || hr.width > 26 || hr.height > 26) continue;
      const cs = getComputedStyle(h);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
      const cx = hr.x + hr.width / 2;
      const cy = hr.y + hr.height / 2;
      const inside = cx >= rc.x - 26 && cx <= rc.x + rc.w + 26 && cy >= rc.y - 26 && cy <= rc.y + rc.h + 26;
      if (!inside) continue;
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

async function lum(colorStr) {
  const m = colorStr && colorStr.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((s) => parseFloat(s));
  const alpha = p.length >= 4 ? p[3] : 1;
  if (alpha < 0.3) return null;
  return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
}

// Effective opaque backdrop behind an element (walk up ancestors).
async function textColorOf(selector) {
  return await win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    let backdrop = 'none';
    let cur = el;
    for (let i = 0; i < 16 && cur; i++) {
      const bg = getComputedStyle(cur).backgroundColor;
      const m = bg && bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map((s) => parseFloat(s));
        const alpha = parts.length >= 4 ? parts[3] : 1;
        if (alpha > 0.5) { backdrop = bg; break; }
      }
      cur = cur.parentElement;
    }
    return { color: cs.color, bg: backdrop, fontSize: cs.fontSize };
  }, selector);
}

// Sample the page canvas darkness inside a CSS rect (text presence proxy).
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

async function clickButtonByText(selectors, pattern) {
  const hit = await win.evaluate(([sels, re]) => {
    const rx = new RegExp(re, 'i');
    for (const sel of sels) {
      let list = [];
      try { list = Array.from(document.querySelectorAll(sel)); } catch (_) { /* ignore */ }
      for (const root of list) {
        for (const b of root.querySelectorAll('button')) {
          const hay = `${b.textContent || ''} ${b.getAttribute('aria-label') || ''} ${b.getAttribute('data-annotation-action') || ''} ${b.getAttribute('data-edit-box-action') || ''}`;
          if (rx.test(hay)) {
            const r = b.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: hay.trim().slice(0, 60) };
          }
        }
      }
    }
    return null;
  }, [selectors, pattern.source]);
  if (!hit) return false;
  await win.mouse.click(hit.x, hit.y);
  await win.waitForTimeout(400);
  return true;
}

async function noPageErrors(label) {
  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  process.stdout.write(`[PAGEERRORS|${label}] ${JSON.stringify(pageErrors)}\n`);
  expect(bad, 'no pageerrors').toHaveLength(0);
}

// ---------------------------------------------------------------------------
// V1: DEF-152 (Confirm+Edit+Delete on the moved box bar) + DEF-155 (artifact)
// ---------------------------------------------------------------------------
test('V1 DEF-152+155: add-box move bar + stale artifact (light)', async () => {
  await setTheme('light');
  await openSampleFromCard('report.pdf');
  await scrollToPage(1);
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
  expect(R0, 'committed .edit-box must exist').toBeTruthy();
  process.stdout.write(`[R0] ${JSON.stringify(R0)}\n`);
  await shot('def-152-1723-committed.png');

  // Real-mouse drag of the box body +200/+120, then release.
  const start = { x: R0.x + R0.w / 2, y: R0.y + R0.h / 2 };
  await win.mouse.move(start.x, start.y);
  await win.mouse.down();
  await win.mouse.move(start.x + 200, start.y + 120, { steps: 12 });
  const mid = await domBox();
  process.stdout.write(`[MID-DRAG] dom=${JSON.stringify(mid)}\n`);
  await win.mouse.up();
  await win.waitForTimeout(80);
  await shot('def-155-1723-release-80ms.png');
  await win.waitForTimeout(520);
  await shot('def-155-1723-release-600ms.png');
  await win.waitForTimeout(1000);
  await shot('def-155-1723-release-1600ms.png');

  const R1 = await domBox();
  const delta = R1 && R0 ? { dx: R1.x - R0.x, dy: R1.y - R0.y } : null;
  process.stdout.write(`[RES|BOX-MOVE] R0=${JSON.stringify(R0)} R1=${JSON.stringify(R1)} delta=${JSON.stringify(delta)}\n`);

  // DEF-155: poll canvas darkness at the OLD rect interior.
  const samples = [];
  for (let i = 0; i < 14; i++) {
    const darkR0 = await canvasDark(1, { x: R0.x + 6, y: R0.y + 6, w: R0.w - 12, h: R0.h - 12 });
    samples.push({ t: i * 150, darkR0 });
    await win.waitForTimeout(150);
  }
  for (const s of samples) process.stdout.write(`[POLL t=${s.t}ms] darkR0=${s.darkR0}\n`);
  const maxStale = Math.max(...samples.map((s) => s.darkR0 || 0));
  process.stdout.write(`[RES|DEF155] maxDarkR0AfterRelease=${maxStale}\n`);

  // DEF-152: which action bar appears under the moved box?
  await win.waitForTimeout(400);
  const bars = await probeBars('V1-AFTER-RELEASE');
  const boxBar = bars.find((b) => b.sel === '.edit-box-toolbar');
  const btns = boxBar ? boxBar.buttons.map((b) => b.text) : [];
  process.stdout.write(`[RES|DEF152] boxToolbarPresent=${!!boxBar} buttons=${JSON.stringify(btns)}\n`);
  await shot('def-152-1723-actionbar.png');
  if (R1) {
    await cropShot('def-152-1723-actionbar-crop.png', {
      x: Math.max(0, R1.x - 24),
      y: Math.max(0, R1.y - 24),
      width: Math.min(R1.w + 340, 1100),
      height: Math.min(R1.h + 170, 560),
    });
  }

  const hasConfirm = btns.some((t) => /confirm/i.test(t));
  const hasEdit = btns.some((t) => /edit/i.test(t));
  const hasDelete = btns.some((t) => /delete/i.test(t));
  process.stdout.write(`[RES|DEF152-VERDICT] hasConfirm=${hasConfirm} hasEdit=${hasEdit} hasDelete=${hasDelete}\n`);
  expect(hasConfirm && hasEdit && hasDelete, 'DEF-152: bar must offer Confirm + Edit + Delete').toBe(true);
  expect(R1, 'box still present after move').toBeTruthy();
  expect(Math.abs(delta.dx) > 150 && Math.abs(delta.dy) > 80, 'DEF-152 precond: box actually moved').toBe(true);
  expect(maxStale, 'DEF-155: no stale text at the old rect (<=0.5% dark) after release').toBeLessThanOrEqual(0.005);
  await noPageErrors('V1');
});

// ---------------------------------------------------------------------------
// V2: DEF-153 interaction matrix + DEF-154 shapes select/move/resize/delete
// ---------------------------------------------------------------------------
test('V2 DEF-153+154: interaction matrix across all kinds (light)', async () => {
  await setTheme('light');
  await openSampleFromCard('report.pdf');
  await scrollToPage(4);
  const pr = await pageRect(4);
  expect(pr, 'page 4 must be mounted').toBeTruthy();

  const results = {};
  const KIND_SEL = {
    textbox: '.ann-textbox[data-kind="textbox"]',
    callout: '.ann-callout[data-kind="callout"]',
    note: '.ann-note[data-kind="note"]',
    rect: '.ann[data-kind="rect"]',
    ellipse: '.ann[data-kind="ellipse"]',
    arrow: '.ann[data-kind="arrow"]',
    ink: '.ann[data-kind="ink"]',
  };

  async function clearSelection() {
    await win.keyboard.press('Escape');
    await win.waitForTimeout(250);
    await win.mouse.click(pr.x + pr.w * 0.5, pr.y + pr.h * 0.93);
    await win.waitForTimeout(350);
  }

  async function kindRect(kind) {
    return await win.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 2 && r.height < 2) return null;
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, KIND_SEL[kind] || '');
  }

  // Full probe of one committed kind: hover cursor, click state, dblclick, move.
  async function probeKind(kind, movable = true) {
    const r = {};
    await clearSelection();
    const rect = await kindRect(kind);
    if (!rect) { process.stdout.write(`[RES|KIND ${kind}] NO COMMITTED ELEMENT (${KIND_SEL[kind]})\n`); return null; }
    const cx = rect.x + Math.min(rect.w / 2, 60);
    const cy = rect.y + Math.min(rect.h / 2, 30);

    // hover cursor
    await win.mouse.move(cx, cy);
    await win.waitForTimeout(200);
    r.hover = await cursorAt(cx, cy);
    await shot(`def-153-1723-${kind}-hover.png`);

    // single click -> select + movable (bar + handles + hint)
    await win.mouse.click(cx, cy);
    await win.waitForTimeout(600);
    r.clickBars = await probeBars(`${kind}-CLICK`);
    const rectAfterClick = await kindRect(kind);
    r.clickHandles = await handleInfo(4, rectAfterClick || rect);
    r.clickHint = await scanHint(`${kind}-CLICK`);
    await shot(`def-153-1723-${kind}-selected.png`);

    // movable: press-drag from center
    if (movable) {
      const before = await kindRect(kind);
      await win.mouse.move(cx, cy);
      await win.mouse.down();
      await win.mouse.move(cx + 70, cy + 45, { steps: 8 });
      r.midDragHint = await scanHint(`${kind}-MIDDRAG`);
      await win.mouse.up();
      await win.waitForTimeout(700);
      const after = await kindRect(kind);
      r.moved = before && after
        ? (Math.abs(after.x - before.x) > 5 || Math.abs(after.y - before.y) > 5)
        : null;
      r.geom = { before, after };
      process.stdout.write(`[RES|KIND ${kind}] moveGeom before=${JSON.stringify(before)} after=${JSON.stringify(after)} moved=${r.moved}\n`);
    }

    // double click -> toolbox
    const rectNow = await kindRect(kind);
    const dx = rectNow ? rectNow.x + Math.min(rectNow.w / 2, 60) : cx;
    const dy = rectNow ? rectNow.y + Math.min(rectNow.h / 2, 30) : cy;
    await win.mouse.dblclick(dx, dy);
    await win.waitForTimeout(700);
    r.dblBars = await probeBars(`${kind}-DBLCLICK`);
    r.dblHint = await scanHint(`${kind}-DBL`);
    await shot(`def-153-1723-${kind}-dblclick.png`);
    await clearSelection();

    process.stdout.write(`[RES|KIND ${kind}] hover=${JSON.stringify(r.hover)} clickBars=${r.clickBars.length} clickBtns=${JSON.stringify(r.clickBars.flatMap((b) => b.buttons.map((x) => x.text)))} handles=${JSON.stringify(r.clickHandles)} hint=${JSON.stringify(r.clickHint.map((h) => h.text))} moved=${r.moved} dblBars=${r.dblBars.length} dblKinds=${JSON.stringify(r.dblBars.map((b) => b.editorKind || b.sel))}\n`);
    return r;
  }

  // ---- commit each annotation kind on page 4 -------------------------------
  // textbox
  await armAnnTool('textbox');
  await win.mouse.click(pr.x + pr.w * 0.55, pr.y + pr.h * 0.10);
  await win.waitForTimeout(500);
  const tbTa = win.locator('[data-annotation-editor="textbox"] textarea');
  await tbTa.waitFor({ timeout: 8000 });
  await tbTa.fill('ANN BOX T42');
  await win.waitForTimeout(200);
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(900);

  // callout (drag anchor -> box)
  await armAnnTool('callout');
  await win.mouse.move(pr.x + pr.w * 0.10, pr.y + pr.h * 0.26);
  await win.mouse.down();
  await win.mouse.move(pr.x + pr.w * 0.28, pr.y + pr.h * 0.33, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(600);
  const coTa = win.locator('[data-annotation-editor="callout"] textarea');
  await coTa.waitFor({ timeout: 8000 });
  await coTa.fill('CALLOUT T42');
  await win.waitForTimeout(200);
  await win.click('[data-annotation-action="callout-confirm"]');
  await win.waitForTimeout(900);

  // note
  await armAnnTool('note');
  await win.mouse.click(pr.x + pr.w * 0.14, pr.y + pr.h * 0.12);
  await win.waitForTimeout(500);
  const noTa = win.locator('[data-annotation-editor="note"] textarea');
  await noTa.waitFor({ timeout: 8000 });
  await noTa.fill('STICKY T42');
  await win.waitForTimeout(200);
  await win.click('[data-annotation-action="note-confirm"]');
  await win.waitForTimeout(900);

  // rect / ellipse / arrow / ink
  const shapeSpecs = [
    ['rect', 0.08, 0.45, 120, 70],
    ['ellipse', 0.40, 0.45, 120, 70],
    ['arrow', 0.72, 0.45, 100, 60],
    ['ink', 0.08, 0.68, 120, 50],
  ];
  for (const [kind, fx, fy, dx, dy] of shapeSpecs) {
    await armAnnTool(kind);
    const a = { x: pr.x + pr.w * fx, y: pr.y + pr.h * fy };
    await win.mouse.move(a.x, a.y);
    await win.mouse.down();
    await win.mouse.move(a.x + dx, a.y + dy, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(800);
  }
  await shot('def-154-1723-shapes-committed.png');

  // ---- probe each kind with the select tool armed ---------------------------
  await armAnnTool('select');
  for (const kind of ['textbox', 'callout', 'note', 'rect', 'ellipse', 'arrow', 'ink']) {
    try {
      results[kind] = await probeKind(kind);
    } catch (e) {
      process.stdout.write(`[RES|KIND ${kind}] ERROR ${e.message.split('\n')[0]}\n`);
    }
    await armAnnTool('select');
  }

  // ---- DEF-154 extras for the four shape kinds: resize + delete -------------
  for (const kind of ['rect', 'ellipse', 'arrow', 'ink']) {
    try {
      await clearSelection();
      const rect = await kindRect(kind);
      if (!rect) { process.stdout.write(`[RES|EXTRA ${kind}] element gone before extras\n`); continue; }
      await win.mouse.click(rect.x + Math.min(rect.w / 2, 60), rect.y + Math.min(rect.h / 2, 30));
      await win.waitForTimeout(600);
      const afterClick = await kindRect(kind);
      const handles = await handleInfo(4, afterClick || rect);
      process.stdout.write(`[RES|EXTRA ${kind}] handlesAfterClick=${JSON.stringify(handles)}\n`);
      await shot(`def-154-1723-${kind}-selected.png`);

      // resize: drag the handle closest to the bottom-right corner +30/+20
      let resized = null;
      if (handles && handles.length) {
        const base = afterClick || rect;
        const br = { x: base.x + base.w, y: base.y + base.h };
        let best = null; let bestD = Infinity;
        for (const h of handles) {
          const d = Math.hypot(h.x + h.w / 2 - br.x, h.y + h.h / 2 - br.y);
          if (d < bestD) { bestD = d; best = h; }
        }
        if (best && bestD < 60) {
          const hx = best.x + best.w / 2;
          const hy = best.y + best.h / 2;
          const before = await kindRect(kind);
          await win.mouse.move(hx, hy);
          await win.mouse.down();
          await win.mouse.move(hx + 30, hy + 20, { steps: 6 });
          await win.mouse.up();
          await win.waitForTimeout(700);
          const after = await kindRect(kind);
          resized = before && after
            ? (Math.abs(after.w - before.w) > 8 || Math.abs(after.h - before.h) > 8)
            : null;
          process.stdout.write(`[RES|EXTRA ${kind}] resize before=${JSON.stringify(before)} after=${JSON.stringify(after)} resized=${resized}\n`);
          await shot(`def-154-1723-${kind}-resized.png`);
        } else {
          process.stdout.write(`[RES|EXTRA ${kind}] no bottom-right handle within 60px (bestD=${Math.round(bestD)})\n`);
        }
      }

      // delete via the bar button
      const delHit = await clickButtonByText(
        ['.edit-box-toolbar', '[data-annotation-action-bar]', '[data-annotation-editor]', '.ann-editor', '[data-annotation-toolbox]', '[data-shape-toolbar]'],
        /delete/,
      );
      process.stdout.write(`[RES|EXTRA ${kind}] deleteButtonHit=${delHit ? JSON.stringify(delHit) : 'false'}\n`);
      await win.waitForTimeout(900);
      const gone = !(await kindRect(kind));
      process.stdout.write(`[RES|EXTRA ${kind}] deleted=${gone}\n`);
      await shot(`def-154-1723-${kind}-after-delete.png`);
      results[kind] = results[kind] || {};
      results[kind].resized = resized;
      results[kind].deleted = gone;
    } catch (e) {
      process.stdout.write(`[RES|EXTRA ${kind}] ERROR ${e.message.split('\n')[0]}\n`);
    }
    await armAnnTool('select');
  }

  await shot('def-154-1723-after-extras.png');

  // ---- add-box kind (page 1) ------------------------------------------------
  await scrollToPage(1);
  const pr1 = await pageRect(1);
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);
  const b0 = { x: pr1.x + pr1.w * 0.16, y: pr1.y + pr1.h * 0.14 };
  await win.mouse.move(b0.x, b0.y);
  await win.mouse.down();
  await win.mouse.move(b0.x + 150, b0.y + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(700);
  const ta = win.locator('[data-edit-textarea]').first();
  await ta.waitFor({ timeout: 10000 });
  await ta.fill('MATRIX BOX 7');
  await win.waitForTimeout(250);
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(1600);
  const boxRect = await domBox();
  expect(boxRect, 'committed add-box must exist').toBeTruthy();

  try {
    // hover cursor on the box body
    const bcx = boxRect.x + boxRect.w / 2;
    const bcy = boxRect.y + boxRect.h / 2;
    await win.mouse.move(bcx, bcy);
    await win.waitForTimeout(200);
    const boxHover = await cursorAt(bcx, bcy);
    await shot('def-153-1723-addbox-hover.png');

    // single click -> select state
    await win.mouse.click(bcx, bcy);
    await win.waitForTimeout(600);
    const boxClickBars = await probeBars('ADDBOX-CLICK');
    const boxHandles = await handleInfo(1, await domBox());
    const boxHint = await scanHint('ADDBOX-CLICK');
    await shot('def-153-1723-addbox-selected.png');

    // dblclick -> toolbox
    await win.mouse.dblclick(bcx, bcy);
    await win.waitForTimeout(700);
    const boxDblBars = await probeBars('ADDBOX-DBLCLICK');
    await shot('def-153-1723-addbox-dblclick.png');

    results.addbox = {
      hover: boxHover,
      clickBars: boxClickBars,
      handles: boxHandles,
      hint: boxHint,
      dblBars: boxDblBars,
    };
    process.stdout.write(`[RES|KIND addbox] hover=${JSON.stringify(boxHover)} clickBars=${boxClickBars.length} clickBtns=${JSON.stringify(boxClickBars.flatMap((b) => b.buttons.map((x) => x.text)))} handles=${JSON.stringify(boxHandles)} hint=${JSON.stringify(boxHint.map((h) => h.text))} dblBars=${boxDblBars.length} dblKinds=${JSON.stringify(boxDblBars.map((b) => b.editorKind || b.sel))}\n`);
  } catch (e) {
    process.stdout.write(`[RES|KIND addbox] ERROR ${e.message.split('\n')[0]}\n`);
  }
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // ---- edit-text kind (page 1 title run) ------------------------------------
  try {
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    // exit box tool -> text tool
    await win.click('[data-edit-tool="text"]');
    await win.waitForTimeout(400);
    const run = await win.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
      const s = spans.find((x) => (x.textContent || '').includes('TFlex Technical Report')) || spans[0];
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return { text: (s.textContent || '').slice(0, 40), x: r.x, y: r.y, w: r.width, h: r.height };
    });
    process.stdout.write(`[RES|edittext] run=${JSON.stringify(run)}\n`);
    if (run) {
      const rcx = run.x + run.w / 2;
      const rcy = run.y + run.h / 2;
      await win.mouse.move(rcx, rcy);
      await win.waitForTimeout(200);
      const etHover = await cursorAt(rcx, rcy);
      await shot('def-153-1723-edittext-hover.png');

      await win.mouse.click(rcx, rcy);
      await win.waitForTimeout(600);
      const etClickBars = await probeBars('EDITTEXT-CLICK');
      const etHandles = await handleInfo(1, { x: run.x, y: run.y, w: run.w, h: run.h });
      const etHint = await scanHint('EDITTEXT-CLICK');
      await shot('def-153-1723-edittext-click.png');

      await win.keyboard.press('Escape');
      await win.waitForTimeout(300);
      await win.mouse.dblclick(rcx, rcy);
      await win.waitForTimeout(700);
      const etDblBars = await probeBars('EDITTEXT-DBLCLICK');
      await shot('def-153-1723-edittext-dblclick.png');

      results.edittext = { hover: etHover, clickBars: etClickBars, handles: etHandles, hint: etHint, dblBars: etDblBars };
      process.stdout.write(`[RES|KIND edittext] hover=${JSON.stringify(etHover)} clickBars=${etClickBars.length} clickBtns=${JSON.stringify(etClickBars.flatMap((b) => b.buttons.map((x) => x.text)))} handles=${JSON.stringify(etHandles)} hint=${JSON.stringify(etHint.map((h) => h.text))} dblBars=${etDblBars.length} dblKinds=${JSON.stringify(etDblBars.map((b) => b.editorKind || b.sel))}\n`);
    }
  } catch (e) {
    process.stdout.write(`[RES|KIND edittext] ERROR ${e.message.split('\n')[0]}\n`);
  }

  process.stdout.write(`[RES|MATRIX-SUMMARY] ${JSON.stringify(Object.keys(results))}\n`);
  await noPageErrors('V2');
});

// ---------------------------------------------------------------------------
// V3: DEF-156 grip label hover in dark mode
// ---------------------------------------------------------------------------
test('V3 DEF-156: drag-to-move grip visible on hover (dark)', async () => {
  await setTheme('dark');
  await openSampleFromCard('report.pdf');
  await scrollToPage(3);
  const pr = await pageRect(3);
  expect(pr, 'page 3 must be mounted').toBeTruthy();
  await armAnnTool('textbox');
  await win.mouse.click(pr.x + pr.w * 0.55, pr.y + pr.h * 0.32);
  await win.waitForTimeout(500);
  await win.locator('[data-annotation-editor="textbox"] textarea').waitFor({ timeout: 8000 });

  const nonHover = await win.evaluate(() => {
    const g = document.querySelector('[data-annotation-editor-handle="textbox"]');
    const label = g ? g.querySelector('.ann-textbox-grip-label') : null;
    if (!g || !label) return { gripFound: false };
    return {
      gripFound: true,
      gripText: (label.textContent || '').trim(),
      gripBg: getComputedStyle(g).backgroundColor,
      labelColor: getComputedStyle(label).color,
    };
  });
  process.stdout.write(`[RES|DEF156-nonhover] ${JSON.stringify(nonHover)}\n`);

  const gripBox = await win.evaluate(() => {
    const g = document.querySelector('[data-annotation-editor-handle="textbox"]');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  expect(gripBox, 'grip strip must exist on the textbox create editor').toBeTruthy();
  expect(nonHover.gripFound, 'grip label present').toBe(true);

  // Real hover onto the grip strip.
  await win.mouse.move(gripBox.x + gripBox.w / 2, gripBox.y + gripBox.h / 2);
  await win.waitForTimeout(300);
  const hover = await win.evaluate(() => {
    const g = document.querySelector('[data-annotation-editor-handle="textbox"]');
    const label = g ? g.querySelector('.ann-textbox-grip-label') : null;
    if (!g || !label) return null;
    return {
      gripBg: getComputedStyle(g).backgroundColor,
      labelColor: getComputedStyle(label).color,
    };
  });
  process.stdout.write(`[RES|DEF156-hover] ${JSON.stringify(hover)}\n`);
  await cropShot('def-156-1723-grip-hover-dark-crop.png', {
    x: Math.max(0, gripBox.x - 14), y: Math.max(0, gripBox.y - 14),
    width: Math.min(gripBox.w + 28, 520), height: Math.min(gripBox.h + 70, 260),
  });
  await shot('def-156-1723-textbox-editor-dark.png');

  // Readability verdict: hovered label luminance vs its effective opaque backdrop.
  const verdict = await win.evaluate(() => {
    const g = document.querySelector('[data-annotation-editor-handle="textbox"]');
    const label = g ? g.querySelector('.ann-textbox-grip-label') : null;
    if (!g || !label) return null;
    const lumOf = (rgbStr) => {
      const m = rgbStr && rgbStr.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((s) => parseFloat(s));
      const alpha = p.length >= 4 ? p[3] : 1;
      if (alpha < 0.3) return null;
      return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
    };
    const labelL = lumOf(getComputedStyle(label).color);
    // walk up from the grip for an opaque bg; if none (transparent), the white
    // page underneath is the effective backdrop.
    let bgL = lumOf('rgb(255,255,255)');
    let cur = g;
    for (let i = 0; i < 16 && cur; i++) {
      const bg = getComputedStyle(cur).backgroundColor;
      const m = bg && bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map((s) => parseFloat(s));
        const alpha = parts.length >= 4 ? parts[3] : 1;
        if (alpha > 0.5) { bgL = lumOf(bg); break; }
      }
      cur = cur.parentElement;
    }
    return { labelL, bgL, contrast: labelL !== null && bgL !== null ? Math.abs(labelL - bgL) : null };
  });
  process.stdout.write(`[RES|DEF156-verdict] ${JSON.stringify(verdict)}\n`);
  expect(verdict && verdict.contrast !== null, 'hover label/backdrop luminances measurable').toBe(true);
  expect(verdict.contrast, 'DEF-156: hovered grip label must stay readable (contrast >= 0.35)').toBeGreaterThanOrEqual(0.35);
  await noPageErrors('V3');
});

// ---------------------------------------------------------------------------
// V4: DEF-157 (callout arrow + dark text), DEF-158 (note text), DEF-159 (all)
// ---------------------------------------------------------------------------
test('V4 DEF-157+158+159: dark-mode committed text + callout arrow', async () => {
  await setTheme('dark');
  await openSampleFromCard('report.pdf');
  await scrollToPage(3);
  const pr = await pageRect(3);
  expect(pr, 'page 3 must be mounted').toBeTruthy();
  await win.click('[data-annotation-toolbar] [data-tool="select"]');
  await win.waitForTimeout(250);

  // -- DEF-158: sticky note (dark) -------------------------------------------
  await armAnnTool('note');
  await win.mouse.click(pr.x + pr.w * 0.12, pr.y + pr.h * 0.12);
  await win.waitForTimeout(500);
  const noteTa = win.locator('[data-annotation-editor="note"] textarea');
  await noteTa.waitFor({ timeout: 8000 });
  await noteTa.fill('DARK NOTE TEXT 42');
  await win.waitForTimeout(250);
  await win.click('[data-annotation-action="note-confirm"]');
  await win.waitForTimeout(900);
  const noteText = await textColorOf('.ann-note-text');
  const noteLum = noteText ? await lum(noteText.color) : null;
  process.stdout.write(`[RES|DEF158] .ann-note-text=${JSON.stringify(noteText)} lum=${noteLum}\n`);
  const noteRect = await win.evaluate(() => {
    const t = document.querySelector('.ann-note-text');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (noteRect && noteRect.w > 5) {
    await cropShot('def-158-1723-note-text-dark-crop.png', {
      x: Math.max(0, noteRect.x - 14), y: Math.max(0, noteRect.y - 14),
      width: Math.min(noteRect.w + 28, 500), height: Math.min(noteRect.h + 28, 200),
    });
  }
  await shot('def-158-1723-note-committed-dark.png');

  // -- DEF-157: callout (arrow geometry + dark text) --------------------------
  await armAnnTool('callout');
  const coAnchor = { x: pr.x + pr.w * 0.12, y: pr.y + pr.h * 0.34 };
  const coBoxAt = { x: pr.x + pr.w * 0.30, y: pr.y + pr.h * 0.42 };
  await win.mouse.move(coAnchor.x, coAnchor.y);
  await win.mouse.down();
  await win.mouse.move(coBoxAt.x, coBoxAt.y, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(600);
  const coTa = win.locator('[data-annotation-editor="callout"] textarea');
  await coTa.waitFor({ timeout: 8000 });
  await coTa.fill('DARK CALLOUT TEXT 42');
  await win.waitForTimeout(250);
  await win.click('[data-annotation-action="callout-confirm"]');
  await win.waitForTimeout(900);
  const calloutText = await textColorOf('.ann-callout');
  const calloutLum = calloutText ? await lum(calloutText.color) : null;
  const coGeom = await win.evaluate(() => {
    const svg = document.querySelector('svg.ann-callout-arrow, svg[class*="callout"]');
    const line = svg ? svg.querySelector('line') : null;
    let lineLen = null;
    let lineAttrs = null;
    if (line) {
      lineAttrs = ['x1', 'y1', 'x2', 'y2'].map((a) => line.getAttribute(a));
      lineLen = Math.round(Math.hypot(
        parseFloat(line.getAttribute('x2')) - parseFloat(line.getAttribute('x1')),
        parseFloat(line.getAttribute('y2')) - parseFloat(line.getAttribute('y1')),
      ) * 10) / 10;
    }
    const poly = svg ? svg.querySelector('polygon') : null;
    const polyPts = poly ? poly.getAttribute('points') : null;
    const b = document.querySelector('.ann-callout[data-kind="callout"]');
    const r = b ? b.getBoundingClientRect() : null;
    return { rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null, lineLen, lineAttrs, polyPts };
  });
  process.stdout.write(`[RES|DEF157] .ann-callout=${JSON.stringify(calloutText)} lum=${calloutLum} geom=${JSON.stringify(coGeom)}\n`);
  if (coGeom && coGeom.rect) {
    await cropShot('def-157-1723-callout-dark-crop.png', {
      x: Math.max(0, coGeom.rect.x - 170), y: Math.max(0, coGeom.rect.y - 70),
      width: Math.min(coGeom.rect.w + 350, 720), height: Math.min(coGeom.rect.h + 170, 420),
    });
  }
  await shot('def-157-1723-callout-committed-dark.png');

  // -- DEF-159: annotation text box (dark) ------------------------------------
  await armAnnTool('textbox');
  await win.mouse.click(pr.x + pr.w * 0.55, pr.y + pr.h * 0.14);
  await win.waitForTimeout(500);
  const tbTa = win.locator('[data-annotation-editor="textbox"] textarea');
  await tbTa.waitFor({ timeout: 8000 });
  await tbTa.fill('DARK BOX TEXT 42');
  await win.waitForTimeout(250);
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(900);
  const annBoxText = await textColorOf('.ann-textbox[data-kind="textbox"]');
  const annBoxLum = annBoxText ? await lum(annBoxText.color) : null;
  process.stdout.write(`[RES|DEF159-textbox] .ann-textbox=${JSON.stringify(annBoxText)} lum=${annBoxLum}\n`);

  // -- mechanical faint-text inventory on the page-3 overlays -----------------
  const faint = await win.evaluate(() => {
    const lumOf = (rgbStr) => {
      const m = rgbStr && rgbStr.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((s) => parseFloat(s));
      const alpha = p.length >= 4 ? p[3] : 1;
      if (alpha < 0.3) return null;
      return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
    };
    const out = [];
    const scope = document.querySelectorAll('.page-slot[data-page="3"] *');
    for (const el of scope) {
      if (el.children.length > 0) continue;
      const text = (el.textContent || '').trim();
      if (text.length === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.2) continue;
      const L = lumOf(cs.color);
      if (L === null || L < 0.6) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      out.push({
        text: text.slice(0, 60),
        cls: String(el.className).split(' ').slice(0, 3).join('.'),
        tag: el.tagName.toLowerCase(),
        color: cs.color,
      });
    }
    return out;
  });
  process.stdout.write(`[RES|DEF159-FAINT-INVENTORY] count=${faint.length} items=${JSON.stringify(faint)}\n`);
  await shot('def-159-1723-dark-inventory.png');

  expect(noteLum !== null && noteLum < 0.6, 'DEF-158: note text readable in dark (lum<0.6 over white page)').toBe(true);
  expect(coGeom && coGeom.lineLen !== null && coGeom.lineLen > 10, 'DEF-157: callout leader line non-zero').toBe(true);
  expect(calloutLum !== null && calloutLum < 0.6, 'DEF-157: callout text readable in dark').toBe(true);
  expect(annBoxLum !== null && annBoxLum < 0.6, 'DEF-159: committed textbox text readable in dark').toBe(true);
  expect(faint, 'DEF-159: no faint/invisible text on the dark-mode page overlays').toHaveLength(0);
  await noPageErrors('V4');
});
