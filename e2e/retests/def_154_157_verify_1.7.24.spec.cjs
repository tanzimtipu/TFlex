// QA verification of the two remaining OPEN defects on installed v1.7.24
// (= FileVersion 1.7.24). Targets:
//   DEF-157: callout arrow renders non-zero length — LIVE (T1) and after
//            save/reopen (T4). Arrowhead polygon must not be degenerate.
//   DEF-154: committed ARROW is selectable/movable/deletable from the page
//            with grab hover and no textLayer fallthrough (T2); committed
//            rect/ellipse/ink show corner resize handles that actually
//            resize the geometry (T3).
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
  const ver = await electronApp.evaluate(({ app }) => app.getVersion());
  process.stdout.write(`[APP-VERSION] ${ver}\n`);
  expect(ver, 'installed app under test must be 1.7.24').toBe('1.7.24');
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
      inArrow: !!el.closest('[data-kind="arrow"]'),
      textLayer: !!el.closest('.textLayer'),
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

async function noPageErrors(label) {
  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  process.stdout.write(`[PAGEERRORS|${label}] ${JSON.stringify(pageErrors)}\n`);
  expect(bad, 'no pageerrors').toHaveLength(0);
}

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

// Kind-strict smallest committed element on page 4.
async function findStrict(kind) {
  return await win.evaluate((k) => {
    const slot = document.querySelector('.page-slot[data-page="4"]');
    if (!slot) return null;
    const sels = {
      arrow: 'g.ann-arrow[data-kind="arrow"], [data-kind="arrow"]:not([data-kind="callout"])',
      callout: 'div.ann-callout[data-kind="callout"]',
      rect: 'rect.ann-shape[data-kind="rect"], rect[data-kind="rect"]',
      ellipse: 'ellipse[data-kind="ellipse"]',
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
        pe: getComputedStyle(el).pointerEvents,
      };
      if (!best || cand.rect.w * cand.rect.h < best.rect.w * best.rect.h) best = cand;
    }
    return best;
  }, kind);
}

// The committed callout's arrow svg: line attrs + arrowhead polygon points.
async function calloutArrowSvg() {
  return await win.evaluate(() => {
    function readSvg(s) {
      const line = s.querySelector('line');
      const poly = s.querySelector('polygon');
      const sr = s.getBoundingClientRect();
      const read = (el, attrs) => {
        const o = {};
        for (const a of attrs) o[a] = el ? el.getAttribute(a) : null;
        return o;
      };
      const lineAttrs = read(line, ['x1', 'y1', 'x2', 'y2']);
      const polyPoints = poly ? poly.getAttribute('points') : null;
      let pts = [];
      if (polyPoints) {
        pts = polyPoints.trim().split(/\s+/).map((p) => p.split(',').map(Number));
      }
      const distinct = [];
      for (const p of pts) {
        if (!distinct.some((q) => Math.abs(q[0] - p[0]) < 0.01 && Math.abs(q[1] - p[1]) < 0.01)) distinct.push(p);
      }
      return {
        svgRect: { x: Math.round(sr.x), y: Math.round(sr.y), w: Math.round(sr.width), h: Math.round(sr.height) },
        line: lineAttrs,
        polyPoints,
        polyDistinct: distinct.length,
      };
    }
    const slot = document.querySelector('.page-slot[data-page="4"]');
    if (!slot) return null;
    const svg = slot.querySelector('svg.ann-callout-arrow');
    if (!svg) {
      // fallback: any svg inside a committed callout div
      const co = slot.querySelector('div.ann-callout[data-kind="callout"]');
      if (!co) return { found: false };
      const s2 = co.querySelector('svg');
      if (!s2) return { found: false, callout: true };
      return { ...readSvg(s2), found: true, via: 'callout-div-svg' };
    }
    return { ...readSvg(svg), found: true, via: 'ann-callout-arrow' };
  });
}

function lineLen(l) {
  if (!l || l.x1 == null || l.x2 == null) return 0;
  return Math.hypot(Number(l.x2) - Number(l.x1), Number(l.y2) - Number(l.y1));
}

// ---------------------------------------------------------------------------
// T1: DEF-157 (a) — LIVE callout arrow: non-zero leader + non-degenerate head
// ---------------------------------------------------------------------------
test('T1 DEF-157: live callout arrow renders with non-zero length', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage(4);
  await scrollStable();
  const pr = await pageRect(4);
  expect(pr, 'page 4 must be mounted').toBeTruthy();

  // Drag FROM the anchor (where the callout points) TO the box position.
  const ax = pr.x + pr.w * 0.25;
  const ay = pr.y + pr.h * 0.50;
  await armAnnTool('callout');
  await drag(ax, ay, 180, 110);
  await win.waitForTimeout(600);
  const coTa = win.locator('[data-annotation-editor="callout"] textarea');
  await coTa.waitFor({ timeout: 8000 });
  await coTa.fill('CALLOUT ARROW 42');
  await win.waitForTimeout(200);
  await win.click('[data-annotation-action="callout-confirm"]');
  await win.waitForTimeout(900);

  const co = await findStrict('callout');
  process.stdout.write(`[COMMIT callout] ${JSON.stringify(co)}\n`);
  expect(co, 'callout committed').toBeTruthy();

  const svg = await calloutArrowSvg();
  process.stdout.write(`[RES|CALLOUT-SVG] ${JSON.stringify(svg)}\n`);
  expect(svg && svg.line, 'committed callout must carry an arrow svg with a line').toBeTruthy();

  const len = lineLen(svg.line);
  process.stdout.write(`[RES|DEF157-LIVE] lineLen=${len.toFixed(2)} polyDistinct=${svg.polyDistinct} line=${JSON.stringify(svg.line)}\n`);

  // Anchor check: one line endpoint must sit near the dragged anchor
  // (page-local coords: screen point minus page origin).
  const anchorLocal = { x: ax - pr.x, y: ay - pr.y };
  const d1 = Math.hypot(Number(svg.line.x1) - anchorLocal.x, Number(svg.line.y1) - anchorLocal.y);
  const d2 = Math.hypot(Number(svg.line.x2) - anchorLocal.x, Number(svg.line.y2) - anchorLocal.y);
  const dAnchor = Math.min(d1, d2);
  process.stdout.write(`[RES|DEF157-ANCHOR] anchorLocal=${JSON.stringify(anchorLocal)} minEndpointDist=${dAnchor.toFixed(1)} (d1=${d1.toFixed(1)} d2=${d2.toFixed(1)})\n`);

  await shot('def-157-1724-callout-live.png');
  await cropShot('def-157-1724-callout-live-crop.png', {
    x: Math.max(0, Math.min(ax, co.rect.x) - 60),
    y: Math.max(0, Math.min(ay, co.rect.y) - 60),
    width: Math.min(Math.abs(co.rect.x + co.rect.w - ax) + 160, 900),
    height: Math.min(Math.abs(co.rect.y + co.rect.h - ay) + 160, 700),
  });

  expect(len, 'DEF-157: leader line must render with non-zero length (>30)').toBeGreaterThan(30);
  expect(svg.polyDistinct, 'DEF-157: arrowhead polygon must have >=3 distinct points (not a degenerate dot)').toBeGreaterThanOrEqual(3);
  expect(dAnchor, 'DEF-157: an arrow endpoint must sit at the dragged anchor (<=90px)').toBeLessThan(90);
  await noPageErrors('T1');
});

// ---------------------------------------------------------------------------
// T2: DEF-154 — committed ARROW: grab hover (no textLayer fallthrough),
// selectable, movable, deletable from the page
// ---------------------------------------------------------------------------
test('T2 DEF-154: committed arrow is selectable, movable, deletable (grab hover)', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage(4);
  await scrollStable();
  let pr = await pageRect(4);
  expect(pr, 'page 4 must be mounted').toBeTruthy();

  pr = await pageRect(4);
  await armAnnTool('arrow');
  await drag(pr.x + pr.w * 0.70, pr.y + pr.h * 0.06, 100, 60);
  await win.waitForTimeout(600);
  const arrow = await findStrict('arrow');
  process.stdout.write(`[COMMIT arrow] ${JSON.stringify(arrow)}\n`);
  expect(arrow, 'arrow committed').toBeTruthy();

  await armAnnTool('select');
  await win.waitForTimeout(300);

  // HOVER along the diagonal: must hit the arrow (not a textLayer span),
  // with a grab-like cursor.
  const rect = arrow.rect;
  const hoverPts = [0.3, 0.5, 0.7].map((t) => ({ x: rect.x + rect.w * t, y: rect.y + rect.h * t }));
  const hovers = [];
  for (const hp of hoverPts) {
    await win.mouse.move(hp.x, hp.y);
    await win.waitForTimeout(220);
    hovers.push({ pt: { x: Math.round(hp.x), y: Math.round(hp.y) }, ...await cursorAt(hp.x, hp.y) });
  }
  process.stdout.write(`[RES|ARROW-HOVER] ${JSON.stringify(hovers)}\n`);
  await shot('def-154-1724-arrow-hover.png');

  const mid = hovers[1];
  expect(mid.textLayer, 'DEF-154: hover must NOT fall through to the textLayer').toBe(false);
  expect(mid.inArrow, 'DEF-154: elementFromPoint must resolve inside the arrow element').toBe(true);
  expect(['text', 'auto']).not.toContain(mid.cursor);

  // CLICK -> selection bar with Delete
  await win.mouse.click(mid.pt.x, mid.pt.y);
  await win.waitForTimeout(800);
  const btns = await overPageButtons(rect);
  process.stdout.write(`[RES|ARROW-CLICK] btns=${JSON.stringify(btns.map((b) => `${b.text}|${b.aria || ''}|${b.act || ''}|${b.bar.cls}`))}\n`);
  await shot('def-154-1724-arrow-selected.png');
  const del = btns.find((b) => /delete/i.test(`${b.text} ${b.aria || ''} ${b.act || ''}`));
  expect(del, 'DEF-154: clicking the arrow must open an action bar with Delete').toBeTruthy();

  // MOVE: press the line midpoint and drag
  await win.mouse.move(mid.pt.x, mid.pt.y);
  await win.mouse.down();
  await win.mouse.move(mid.pt.x + 70, mid.pt.y + 45, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(800);
  const afterMove = await findStrict('arrow');
  const moved = afterMove ? (Math.abs(afterMove.rect.x - rect.x) > 5 || Math.abs(afterMove.rect.y - rect.y) > 5) : false;
  process.stdout.write(`[RES|ARROW-MOVE] before=${JSON.stringify(rect)} after=${JSON.stringify(afterMove && afterMove.rect)} moved=${moved}\n`);
  await shot('def-154-1724-arrow-moved.png');
  expect(moved, 'DEF-154: press-drag on the arrow must move it').toBe(true);

  // DELETE via the bar
  const cur = await findStrict('arrow');
  const pt2 = { x: cur.rect.x + cur.rect.w * 0.5, y: cur.rect.y + cur.rect.h * 0.5 };
  await win.mouse.click(pt2.x, pt2.y);
  await win.waitForTimeout(800);
  const btns2 = await overPageButtons(cur.rect);
  const del2 = btns2.find((b) => /delete/i.test(`${b.text} ${b.aria || ''} ${b.act || ''}`));
  expect(del2, 'Delete button must be present after re-select').toBeTruthy();
  await win.mouse.click(del2.btn.x, del2.btn.y);
  await win.waitForTimeout(1000);
  const gone = !(await findStrict('arrow'));
  process.stdout.write(`[RES|ARROW-DELETE] deleted=${gone}\n`);
  await shot('def-154-1724-arrow-after-delete.png');
  expect(gone, 'DEF-154: bar Delete must remove the committed arrow from the page').toBe(true);
  await noPageErrors('T2');
});

// ---------------------------------------------------------------------------
// T3: DEF-154 — rect/ellipse/ink show corner resize handles that actually resize
// ---------------------------------------------------------------------------
test('T3 DEF-154: rect/ellipse/ink resize handles actually resize', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage(4);
  await scrollStable();
  let pr = await pageRect(4);
  expect(pr, 'page 4 must be mounted').toBeTruthy();

  // commit all three
  pr = await pageRect(4);
  await armAnnTool('rect');
  await drag(pr.x + pr.w * 0.06, pr.y + pr.h * 0.06, 120, 70);
  await win.waitForTimeout(500);
  await armAnnTool('ellipse');
  await drag(pr.x + pr.w * 0.38, pr.y + pr.h * 0.06, 120, 70);
  await win.waitForTimeout(500);
  await armAnnTool('ink');
  await drag(pr.x + pr.w * 0.06, pr.y + pr.h * 0.24, 130, 45);
  await win.waitForTimeout(500);
  await armAnnTool('select');
  await win.waitForTimeout(300);

  const results = {};
  for (const kind of ['rect', 'ellipse', 'ink']) {
    const el = await findStrict(kind);
    if (!el) { results[kind] = { error: 'not found' }; continue; }
    const pt = { x: el.rect.x + el.rect.w * 0.4, y: el.rect.y + el.rect.h * 0.4 };
    await win.mouse.click(pt.x, pt.y);
    await win.waitForTimeout(800);

    // scan for handle-like affordances near the selected shape
    const afford = await win.evaluate((rc) => {
      const out = [];
      for (const h of document.querySelectorAll('[class*="handle"], [class*="resize"], [class*="grip"], [data-handle], [data-resize], [data-shape-handle], [data-resize-handle]')) {
        const hr = h.getBoundingClientRect();
        if (hr.width < 2 || hr.height < 2) continue;
        const cs = getComputedStyle(h);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
        const cx = hr.x + hr.width / 2;
        const cy = hr.y + hr.height / 2;
        const near = cx >= rc.x - 40 && cx <= rc.x + rc.w + 40 && cy >= rc.y - 40 && cy <= rc.y + rc.h + 40;
        if (!near) continue;
        const s = h.className && h.className.baseVal !== undefined ? h.className.baseVal : h.className;
        out.push({
          tag: h.tagName.toLowerCase(),
          cls: String(s || '').split(' ').filter(Boolean).slice(0, 3).join('.'),
          x: Math.round(hr.x), y: Math.round(hr.y), w: Math.round(hr.width), h: Math.round(hr.height),
        });
      }
      return out;
    }, el.rect);

    // diagnostic: any small hit-testable element near the BR corner
    const smallNear = await win.evaluate((rc) => {
      const out = [];
      for (const e of document.querySelectorAll('.page-slot[data-page="4"] *')) {
        const r = e.getBoundingClientRect();
        if (r.width < 2 || r.width > 22 || r.height < 2 || r.height > 22) continue;
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        if (cx < rc.x + rc.w - 30 || cx > rc.x + rc.w + 30 || cy < rc.y + rc.h - 30 || cy > rc.y + rc.h + 30) continue;
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
        const s = e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className;
        out.push({ tag: e.tagName.toLowerCase(), cls: String(s || '').split(' ').filter(Boolean).slice(0, 3).join('.'), x: Math.round(cx), y: Math.round(cy) });
      }
      return out;
    }, el.rect);

    process.stdout.write(`[RES|T3 ${kind}] affordances=${JSON.stringify(afford)} smallNearBR=${JSON.stringify(smallNear.slice(0, 10))}\n`);
    await shot(`def-154-1724-${kind}-selected-handles.png`);
    await cropShot(`def-154-1724-${kind}-selected-crop.png`, {
      x: Math.max(0, el.rect.x - 90), y: Math.max(0, el.rect.y - 90),
      width: Math.min(el.rect.w + 220, 800), height: Math.min(el.rect.h + 240, 560),
    });

    let resized = false;
    let delta = null;
    if (afford.length) {
      const brp = { x: el.rect.x + el.rect.w, y: el.rect.y + el.rect.h };
      let best = null; let bestD = Infinity;
      for (const h of afford) {
        const d = Math.hypot(h.x + h.w / 2 - brp.x, h.y + h.h / 2 - brp.y);
        if (d < bestD) { bestD = d; best = h; }
      }
      const hx = best.x + best.w / 2;
      const hy = best.y + best.h / 2;
      await win.mouse.move(hx, hy);
      await win.mouse.down();
      await win.mouse.move(hx + 32, hy + 22, { steps: 6 });
      await win.mouse.up();
      await win.waitForTimeout(800);
      const el2 = await findStrict(kind);
      delta = el2 ? { dw: Math.round(el2.rect.w - el.rect.w), dh: Math.round(el2.rect.h - el.rect.h) } : null;
      resized = !!delta && (Math.abs(delta.dw) > 8 || Math.abs(delta.dh) > 8);
      process.stdout.write(`[RES|T3 ${kind}] resizeDrag from ${best.cls || best.tag} bestD=${Math.round(bestD)} delta=${JSON.stringify(delta)} resized=${resized}\n`);
      await shot(`def-154-1724-${kind}-resized.png`);
    } else {
      process.stdout.write(`[RES|T3 ${kind}] NO resize affordance near the selected shape\n`);
    }
    results[kind] = { handles: afford.length, delta, resized };

    // deselect for next kind
    await win.keyboard.press('Escape');
    await win.waitForTimeout(250);
    await win.mouse.click(pr.x + pr.w * 0.45, Math.min(pr.y + pr.h * 0.62, 1150));
    await win.waitForTimeout(300);
  }
  process.stdout.write(`[RES|T3-SUMMARY] ${JSON.stringify(results)}\n`);

  for (const kind of ['rect', 'ellipse', 'ink']) {
    expect(results[kind] && results[kind].handles, `DEF-154: ${kind} must show resize handles when selected (found ${results[kind] && results[kind].handles})`).toBeGreaterThanOrEqual(3);
    expect(results[kind] && results[kind].resized, `DEF-154: dragging ${kind}'s BR handle must actually resize it (delta ${JSON.stringify(results[kind] && results[kind].delta)})`).toBe(true);
  }
  await noPageErrors('T3');
});

// ---------------------------------------------------------------------------
// T4: DEF-157 — the SAVED file carries the callout arrow (save/reopen)
// ---------------------------------------------------------------------------
test('T4 DEF-157: callout arrow survives save/reopen with non-zero length', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage(4);
  await scrollStable();
  const pr = await pageRect(4);
  expect(pr, 'page 4 must be mounted').toBeTruthy();

  const ax = pr.x + pr.w * 0.25;
  const ay = pr.y + pr.h * 0.50;
  await armAnnTool('callout');
  await drag(ax, ay, 180, 110);
  await win.waitForTimeout(600);
  const coTa = win.locator('[data-annotation-editor="callout"] textarea');
  await coTa.waitFor({ timeout: 8000 });
  await coTa.fill('CALLOUT SAVE 42');
  await win.waitForTimeout(200);
  await win.click('[data-annotation-action="callout-confirm"]');
  await win.waitForTimeout(900);
  expect(await findStrict('callout'), 'callout committed before save').toBeTruthy();

  // Save As to a temp path (mock the OS dialog)
  const savePath = path.join(os.tmpdir(), `tflex-def157-1724-${Date.now()}.pdf`);
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

  // Close the tab back to welcome, then reopen the saved file
  await win.locator('.tab-active .tab-close').click();
  await win.waitForTimeout(1500);
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2500);
  await scrollToPage(4);
  await scrollStable();
  await win.waitForTimeout(1200);

  const co2 = await findStrict('callout');
  process.stdout.write(`[REOPEN callout] ${JSON.stringify(co2)}\n`);
  expect(co2, 'callout must be present after reopen').toBeTruthy();

  const svg = await calloutArrowSvg();
  process.stdout.write(`[RES|CALLOUT-SVG-REOPEN] ${JSON.stringify(svg)}\n`);
  expect(svg && svg.line, 'reopened callout must carry an arrow svg with a line').toBeTruthy();
  const len = lineLen(svg.line);
  process.stdout.write(`[RES|DEF157-REOPEN] lineLen=${len.toFixed(2)} polyDistinct=${svg.polyDistinct}\n`);

  await shot('def-157-1724-callout-reopened.png');
  // Frame the crop around BOTH line endpoints (svg-local -> screen) and the box.
  const p1 = { x: svg.svgRect.x + Number(svg.line.x1), y: svg.svgRect.y + Number(svg.line.y1) };
  const p2 = { x: svg.svgRect.x + Number(svg.line.x2), y: svg.svgRect.y + Number(svg.line.y2) };
  const xs = [p1.x, p2.x, co2.rect.x, co2.rect.x + co2.rect.w];
  const ys = [p1.y, p2.y, co2.rect.y, co2.rect.y + co2.rect.h];
  await cropShot('def-157-1724-callout-reopened-crop.png', {
    x: Math.max(0, Math.min(...xs) - 60),
    y: Math.max(0, Math.min(...ys) - 60),
    width: Math.min(Math.max(...xs) - Math.min(...xs) + 120, 1100),
    height: Math.min(Math.max(...ys) - Math.min(...ys) + 120, 900),
  });

  expect(len, 'DEF-157: reopened callout leader must render non-zero (>30)').toBeGreaterThan(30);
  expect(svg.polyDistinct, 'DEF-157: reopened arrowhead polygon >=3 distinct points').toBeGreaterThanOrEqual(3);
  await noPageErrors('T4');
});
