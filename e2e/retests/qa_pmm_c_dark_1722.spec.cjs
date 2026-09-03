// QA reproduction probe (items 5 + 6b + 7 + 8) — installed v1.7.22, DARK mode:
//   5. "Drag to move" grip label invisible when hovered (dark).
//   6. Callout committed text faint in dark mode.
//   7. Sticky-note committed text invisible in dark mode.
//   8. Full inventory of faint/invisible text on page overlays in dark mode.
//
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

test('C. dark mode: grip hover, note text, callout text, faint-text inventory', async () => {
  await setTheme('dark');
  await openSampleFromCard('report.pdf');
  await scrollToPage(3);
  const pr = await pageRect(3);
  expect(pr, 'page 3 must be mounted').toBeTruthy();
  await win.click('[data-annotation-toolbar] [data-tool="select"]');
  await win.waitForTimeout(250);

  // -- 7. sticky note with text (dark) --------------------------------------
  await armAnnTool('note');
  const noteAt = { x: pr.x + pr.w * 0.12, y: pr.y + pr.h * 0.12 };
  await win.mouse.click(noteAt.x, noteAt.y);
  await win.waitForTimeout(500);
  const noteTa = win.locator('[data-annotation-editor="note"] textarea');
  await noteTa.waitFor({ timeout: 8000 });
  await noteTa.fill('DARK NOTE TEXT 42');
  await win.waitForTimeout(250);
  await win.click('[data-annotation-action="note-confirm"]');
  await win.waitForTimeout(900);
  const noteText = await textColorOf('.ann-note-text');
  process.stdout.write(`[RES|ITEM7] .ann-note-text=${JSON.stringify(noteText)}\n`);
  const noteRect = await win.evaluate(() => {
    const t = document.querySelector('.ann-note-text');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (noteRect && noteRect.w > 5) {
    await cropShot('def-158-c-note-text-dark-crop.png', {
      x: Math.max(0, noteRect.x - 14), y: Math.max(0, noteRect.y - 14),
      width: Math.min(noteRect.w + 28, 500), height: Math.min(noteRect.h + 28, 200),
    });
  }
  await shot('def-158-c-note-committed-dark.png');

  // -- 6b. callout with text (dark) ------------------------------------------
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
  const coGeom = await win.evaluate(() => {
    const b = document.querySelector('.ann-callout[data-kind="callout"]');
    const svg = document.querySelector('svg.ann-callout-arrow');
    const line = svg ? svg.querySelector('line') : null;
    let lineLen = null;
    if (line) {
      lineLen = Math.round(Math.hypot(
        parseFloat(line.getAttribute('x2')) - parseFloat(line.getAttribute('x1')),
        parseFloat(line.getAttribute('y2')) - parseFloat(line.getAttribute('y1')),
      ) * 10) / 10;
    }
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, lineLen };
  });
  process.stdout.write(`[RES|ITEM6-dark] .ann-callout=${JSON.stringify(calloutText)} geom=${JSON.stringify(coGeom)}\n`);
  if (coGeom && coGeom.rect) {
    await cropShot('def-157-c-callout-dark-crop.png', {
      x: Math.max(0, coGeom.rect.x - 160), y: Math.max(0, coGeom.rect.y - 60),
      width: Math.min(coGeom.rect.w + 340, 700), height: Math.min(coGeom.rect.h + 160, 400),
    });
  }
  await shot('def-157-c-callout-committed-dark.png');

  // -- committed annotation TEXT BOX (item 8 inventory) ----------------------
  await armAnnTool('textbox');
  const tbAt = { x: pr.x + pr.w * 0.55, y: pr.y + pr.h * 0.14 };
  await win.mouse.click(tbAt.x, tbAt.y);
  await win.waitForTimeout(500);
  const tbTa = win.locator('[data-annotation-editor="textbox"] textarea');
  await tbTa.waitFor({ timeout: 8000 });
  await tbTa.fill('DARK BOX TEXT 42');
  await win.waitForTimeout(250);
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(900);
  const annBoxText = await textColorOf('.ann-textbox[data-kind="textbox"]');
  process.stdout.write(`[RES|ITEM8] .ann-textbox=${JSON.stringify(annBoxText)}\n`);

  // -- 5. grip label hover in dark (create editor open) ----------------------
  await armAnnTool('textbox');
  const gripAt = { x: pr.x + pr.w * 0.55, y: pr.y + pr.h * 0.32 };
  await win.mouse.click(gripAt.x, gripAt.y);
  await win.waitForTimeout(500);
  const gripNonHover = await win.evaluate(() => {
    const g = document.querySelector('[data-annotation-editor-handle="textbox"]');
    const label = g ? g.querySelector('.ann-textbox-grip-label') : null;
    if (!g || !label) return null;
    return {
      gripBg: getComputedStyle(g).backgroundColor,
      gripColor: getComputedStyle(g).color,
      labelColor: getComputedStyle(label).color,
    };
  });
  process.stdout.write(`[RES|ITEM5-nonhover] ${JSON.stringify(gripNonHover)}\n`);
  const gripBox = await win.evaluate(() => {
    const g = document.querySelector('[data-annotation-editor-handle="textbox"]');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (gripBox) {
    await win.mouse.move(gripBox.x + gripBox.w / 2, gripBox.y + gripBox.h / 2);
    await win.waitForTimeout(250);
    const gripHover = await win.evaluate(() => {
      const g = document.querySelector('[data-annotation-editor-handle="textbox"]');
      const label = g ? g.querySelector('.ann-textbox-grip-label') : null;
      if (!g || !label) return null;
      return {
        gripBg: getComputedStyle(g).backgroundColor,
        gripHoverBg: getComputedStyle(g).backgroundColor,
        labelColor: getComputedStyle(label).color,
      };
    });
    process.stdout.write(`[RES|ITEM5-hover] ${JSON.stringify(gripHover)}\n`);
    await cropShot('def-156-c-grip-hover-dark-crop.png', {
      x: Math.max(0, gripBox.x - 10), y: Math.max(0, gripBox.y - 10),
      width: Math.min(gripBox.w + 20, 500), height: Math.min(gripBox.h + 60, 240),
    });
  }
  await shot('def-156-c-textbox-editor-dark.png');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // -- item 8: mechanical faint-text inventory on the page overlays ----------
  const faint = await win.evaluate(() => {
    const lum = (rgbStr) => {
      const m = rgbStr && rgbStr.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((s) => parseFloat(s));
      const alpha = p.length >= 4 ? p[3] : 1;
      if (alpha < 0.3) return null;
      return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
    };
    const out = [];
    const scope = document.querySelectorAll('.page-slot[data-page="3"] *, .ann-toolbar *, .edit-inline-editor *, .edit-box-toolbar *');
    for (const el of scope) {
      if (el.children.length > 0) continue;
      const text = (el.textContent || '').trim();
      if (text.length === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.2) continue;
      const L = lum(cs.color);
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
  process.stdout.write(`[RES|ITEM8-FAINT-INVENTORY] count=${faint.length} items=${JSON.stringify(faint, null, 1)}\n`);
  await shot('def-159-c-dark-inventory.png');

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  process.stdout.write(`[PAGEERRORS|C] ${JSON.stringify(pageErrors)}\n`);
  expect(bad, 'no pageerrors').toHaveLength(0);
});
