// QA reproduction probe (items 2/3 continuation) — installed v1.7.22:
// ellipse, arrow, ink interaction matrix with in-viewport placement coords.
// Launch only via e2e/lib/launch.cjs (launchApp) against the packaged exe.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(420000);

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

async function openSampleFromCard(name) {
  await win.locator(`.sample-card:has-text("${name}")`).first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
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
    return { cursor, hit: `${el.tagName.toLowerCase()}.${cls(el)}`, pe: getComputedStyle(el).pointerEvents };
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
        seen.push({
          sel,
          editorKind: c.getAttribute('data-annotation-editor')
            || c.getAttribute('data-annotation-editor-wrap') || null,
          buttons: Array.from(c.querySelectorAll('button')).map((b) => (b.textContent || '').trim()),
        });
      }
    }
    return seen;
  });
  process.stdout.write(`[BARS|${label}] ${JSON.stringify(out)}\n`);
  return out;
}

async function shapeGeom(kind) {
  return await win.evaluate((k) => {
    const b = document.querySelector(`.ann[data-kind="${k}"]`);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { geom: [Math.round(r.x), Math.round(r.y)], w: r.width, h: r.height };
  }, kind);
}

test('B3. ellipse / arrow / ink interaction matrix (light)', async () => {
  await openSampleFromCard('report.pdf');
  // Scroll to page 5 and use the TOP band of the page (always in viewport).
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="5"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1200);
  const pr = await pageRect(5);
  expect(pr, 'page 5 must be mounted').toBeTruthy();
  await armAnnTool('select');

  const plan = [
    { kind: 'ellipse', fx: 0.14, fy: 0.10 },
    { kind: 'arrow', fx: 0.42, fy: 0.10 },
    { kind: 'ink', fx: 0.66, fy: 0.10 },
  ];
  for (const { kind, fx, fy } of plan) {
    try {
      await armAnnTool(kind);
      const a = { x: pr.x + pr.w * fx, y: pr.y + pr.h * fy };
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
        before = await shapeGeom(kind);
        await win.mouse.dblclick(cx, cy);
        await win.waitForTimeout(500);
        dblCount = (await probeBars(`SHAPE-${kind}-DBL`)).length;
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
        after = await shapeGeom(kind);
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
  await win.screenshot({ path: path.join(SHOTS, 'def-154-b3-shapes.png') });
  process.stdout.write('[SHOT] def-154-b3-shapes.png\n');

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  process.stdout.write(`[PAGEERRORS|B3] ${JSON.stringify(pageErrors)}\n`);
  expect(bad, 'no pageerrors').toHaveLength(0);
});
