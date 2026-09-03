// QA reproduction probe (items 2/3 continuation) — installed v1.7.22:
// sticky note, rect, ellipse, arrow, pen/ink interaction matrix.
// Each kind is isolated with try/catch so one failure doesn't kill the rest.
// Launch only via e2e/lib/launch.cjs (launchApp) against the packaged exe.

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

async function armAnnTool(tool) {
  await win.click(`[data-annotation-toolbar] [data-tool="${tool}"]`);
  await win.waitForTimeout(350);
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
      return String(s || '').split(' ').filter(Boolean).slice(0, 3).join('.');
    };
    return {
      cursor,
      hit: `${el.tagName.toLowerCase()}.${cls(el)}`,
      pe: getComputedStyle(el).pointerEvents,
    };
  }, [x, y]);
}

async function probeBars(label) {
  const out = await win.evaluate(() => {
    const sels = [
      '.edit-box-toolbar', '.edit-inline-editor', '.edit-image-toolbar',
      '.sig-action-bar', '.ann-editor', '[data-annotation-action-bar]',
      '[data-annotation-editor]', '.ann-textbox-wrap', '.ann-note-editor',
    ];
    const seen = [];
    const idset = new Set();
    for (const sel of sels) {
      for (const c of document.querySelectorAll(sel)) {
        if (idset.has(c)) continue;
        idset.add(c);
        const buttons = Array.from(c.querySelectorAll('button')).map((b) => ({
          text: (b.textContent || '').trim(),
          aria: b.getAttribute('aria-label'),
        }));
        seen.push({
          sel,
          editorKind: c.getAttribute('data-annotation-editor')
            || c.getAttribute('data-annotation-editor-wrap') || null,
          buttons,
        });
      }
    }
    return seen;
  });
  process.stdout.write(`[BARS|${label}] ${JSON.stringify(out)}\n`);
  return out;
}

test('B2. note + shapes: interaction matrix (light)', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage(4);
  const pr = await pageRect(4);
  expect(pr, 'page 4 must be mounted').toBeTruthy();
  await armAnnTool('select');

  // ---- STICKY NOTE ----------------------------------------------------------
  try {
    await armAnnTool('note');
    const noteAt = { x: pr.x + pr.w * 0.14, y: pr.y + pr.h * 0.16 };
    // What is under the click point?
    const under = await cursorAt(noteAt.x, noteAt.y);
    process.stdout.write(`[DIAG|note-click-target] ${JSON.stringify(under)}\n`);
    await win.mouse.click(noteAt.x, noteAt.y);
    await win.waitForTimeout(600);
    const bars1 = await probeBars('NOTE-EDITOR-1');
    if (bars1.length === 0) {
      process.stdout.write('[DIAG] note editor not open after click 1; retrying\n');
      await shot('def-158-b-note-editor-missing.png');
      await win.mouse.click(noteAt.x + 30, noteAt.y + 30);
      await win.waitForTimeout(600);
    }
    const bars2 = await probeBars('NOTE-EDITOR-2');
    if (bars2HasTextarea(bars1) || bars2HasTextarea(bars2)) {
      const noteTa = win.locator('[data-annotation-editor="note"] textarea');
      await noteTa.waitFor({ timeout: 6000 });
      await noteTa.fill('STICKY TEXT');
      await win.waitForTimeout(250);
      await win.click('[data-annotation-action="note-confirm"]');
      await win.waitForTimeout(900);
    }
    function bars2HasTextarea(bars) { return bars.some((b) => b.editorKind === 'note'); }

    const noteSurf = await win.evaluate(() => {
      const b = document.querySelector('.ann-note[data-kind="note"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const txt = document.querySelector('.ann-note-text');
      return {
        icon: { x: r.x, y: r.y, w: r.width, h: r.height },
        cursor: getComputedStyle(b).cursor,
        textCursor: txt ? getComputedStyle(txt).color : null,
      };
    });
    let noteHover = null; let noteDbl = 0; let noteClickBars = []; let noteMoved = null;
    if (noteSurf && noteSurf.icon) {
      const cx = noteSurf.icon.x + noteSurf.icon.w / 2;
      const cy = noteSurf.icon.y + noteSurf.icon.h / 2;
      await win.mouse.move(cx, cy);
      await win.waitForTimeout(150);
      noteHover = await cursorAt(cx, cy);
      await win.mouse.dblclick(cx, cy);
      await win.waitForTimeout(500);
      noteDbl = (await probeBars('NOTE-DBL')).length;
      await win.keyboard.press('Escape');
      await win.waitForTimeout(300);
      await win.mouse.click(cx, cy);
      await win.waitForTimeout(500);
      noteClickBars = await probeBars('NOTE-CLICK');
      await win.keyboard.press('Escape');
      await win.waitForTimeout(300);
      await win.mouse.move(cx, cy);
      await win.mouse.down();
      await win.mouse.move(cx + 60, cy + 40, { steps: 8 });
      await win.mouse.up();
      await win.waitForTimeout(700);
      const note2 = await win.evaluate(() => {
        const b = document.querySelector('.ann-note[data-kind="note"]');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.x, y: r.y };
      });
      noteMoved = note2
        ? (Math.abs(note2.x - noteSurf.icon.x) > 5 || Math.abs(note2.y - noteSurf.icon.y) > 5)
        : null;
    }
    process.stdout.write(`[RES|KIND note] surface=${JSON.stringify(noteSurf)} hover=${JSON.stringify(noteHover)} dblclickBars=${noteDbl} clickBars=${noteClickBars.length} clickButtons=${JSON.stringify(noteClickBars.flatMap((b) => b.buttons.map((x) => x.text)))} moved=${noteMoved}\n`);
  } catch (e) {
    process.stdout.write(`[RES|KIND note] ERROR ${e.message.split('\n')[0]}\n`);
  }
  await armAnnTool('select');

  // ---- RECT / ELLIPSE / ARROW / INK -----------------------------------------
  for (const kind of ['rect', 'ellipse', 'arrow', 'ink']) {
    try {
      await armAnnTool(kind);
      const fy = kind === 'rect' ? 0.34 : kind === 'ellipse' ? 0.55 : kind === 'arrow' ? 0.72 : 0.85;
      const a = { x: pr.x + pr.w * 0.10, y: pr.y + pr.h * fy };
      await win.mouse.move(a.x, a.y);
      await win.mouse.down();
      await win.mouse.move(a.x + 120, a.y + 70, { steps: 8 });
      await win.mouse.up();
      await win.waitForTimeout(800);
      await armAnnTool('select');
      await win.waitForTimeout(250);

      const shape = await win.evaluate((k) => {
        const b = document.querySelector(`.ann[data-kind="${k}"]`);
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return {
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          pe: getComputedStyle(b).pointerEvents,
          tag: b.tagName.toLowerCase(),
        };
      }, kind);
      let hover = null; let dblCount = 0; let clickCount = 0; let moved = null;
      let before = null; let after = null;
      if (shape && shape.rect && shape.rect.w > 0) {
        const cx = shape.rect.x + shape.rect.w / 2;
        const cy = shape.rect.y + shape.rect.h / 2;
        await win.mouse.move(cx, cy);
        await win.waitForTimeout(150);
        hover = await cursorAt(cx, cy);
        const before = await shapeGeom(kind);
        await win.mouse.dblclick(cx, cy);
        await win.waitForTimeout(500);
        const dblBars = await probeBars(`SHAPE-${kind}-DBL`);
        dblCount = dblBars.length;
        await armAnnTool('select');
        await win.waitForTimeout(250);
        await win.mouse.click(cx, cy);
        await win.waitForTimeout(500);
        clickCount = (await probeBars(`SHAPE-${kind}-CLICK`)).length;
        await win.mouse.move(cx, cy);
        await win.mouse.down();
        await win.mouse.move(cx + 60, cy + 40, { steps: 6 });
        await win.mouse.up();
        await win.waitForTimeout(700);
        const after = await shapeGeom(kind);
        moved = before && after
          ? (Math.abs(after.geom[0] - before.geom[0]) > 3 || Math.abs(after.geom[1] - before.geom[1]) > 3)
          : null;
        process.stdout.write(`[RES|SHAPE-GEOM ${kind}] before=${JSON.stringify(before)} after=${JSON.stringify(after)}\n`);
      }
      process.stdout.write(`[RES|KIND ${kind}] shape=${JSON.stringify(shape)} hover=${JSON.stringify(hover)} dblclickBars=${dblCount} clickBars=${clickCount} moved=${moved}\n`);
    } catch (e) {
      process.stdout.write(`[RES|KIND ${kind}] ERROR ${e.message.split('\n')[0]}\n`);
    }
  }

  await shot('def-154-b-shapes-committed.png');

  // ---- "Double click to edit" hint scan while an add-box is movable ----------
  try {
    await win.click('[data-toolbar-edit-toggle]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
    await win.waitForTimeout(300);
    await win.click('[data-edit-tool="box"]');
    await win.waitForTimeout(300);
    const bAt = { x: pr.x + pr.w * 0.55, y: pr.y + pr.h * 0.12 };
    await win.mouse.move(bAt.x, bAt.y);
    await win.mouse.down();
    await win.mouse.move(bAt.x + 140, bAt.y + 80, { steps: 6 });
    await win.mouse.up();
    await win.waitForTimeout(600);
    const ta2 = win.locator('[data-edit-textarea]').first();
    await ta2.waitFor({ timeout: 8000 });
    await ta2.fill('HINT SCAN BOX');
    await win.waitForTimeout(200);
    await win.click('[aria-label="Apply edit"]');
    await win.waitForTimeout(1200);
    const hb = await win.evaluate(() => {
      const b = document.querySelector('.edit-box[data-edit-box-id]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    if (hb) {
      const cx = hb.x + hb.w / 2; const cy = hb.y + hb.h / 2;
      await win.mouse.move(cx, cy);
      await win.mouse.down();
      await win.mouse.move(cx + 90, cy + 60, { steps: 6 });
      await scanHint('MID-DRAG');
      await win.screenshot({ path: path.join(SHOTS, 'def-153-b-movable-middrag.png') });
      await win.mouse.up();
      await win.waitForTimeout(800);
      await scanHint('AFTER-MOVE');
      await win.screenshot({ path: path.join(SHOTS, 'def-153-b-movable-selected.png') });
    } else {
      process.stdout.write('[RES|HINTSCAN] no box to drag\n');
    }
  } catch (e) {
    process.stdout.write(`[RES|HINTSCAN] ERROR ${e.message.split('\n')[0]}\n`);
  }
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  process.stdout.write(`[PAGEERRORS|B2] ${JSON.stringify(pageErrors)}\n`);
  expect(bad, 'no pageerrors').toHaveLength(0);
});

async function shapeGeom(kind) {
  return await win.evaluate((k) => {
    const b = document.querySelector(`.ann[data-kind="${k}"]`);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { geom: [Math.round(r.x), Math.round(r.y)], w: r.width, h: r.height };
  }, kind);
}

async function scanHint(label) {
  const found = await win.evaluate(() => {
    const hits = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const t = (node.textContent || '').trim();
      if (/double.?click|drag to move/i.test(t)) {
        hits.push({ text: t.slice(0, 60), cls: String(node.parentElement.className).slice(0, 60) });
      }
      node = walker.nextNode();
    }
    return hits;
  });
  process.stdout.write(`[RES|HINTSCAN|${label}] ${JSON.stringify(found)}\n`);
  return found;
}
