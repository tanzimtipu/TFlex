// DEF-235..240 retest support: classify the two adv051 harness-flow timeouts
// the developer flagged as non-regressions.
//   T1  duprepro scenario B: the second drag starts on the box committed by
//       scenario A, so it hits EditOverlay's committed-box MOVE branch
//       (EditOverlay.tsx:672) and no [data-edit-editor] ever mounts.
//   T2  toolboxexit tail: edit-box creation after the stamp flow - probe the
//       hit target / layer pointer-events at the drag point and what commits.
// Evidence is logged with the [HARNESS-FLOW] prefix; screenshots under
// screenshots/def235-*.png. Canonical launcher only.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[HARNESS-FLOW] ${label} ${JSON.stringify(obj)}`);

async function openReport(app, win) {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(400);
}

async function boxRect(win) {
  return win.evaluate(() => {
    const b = document.querySelector('.edit-box');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return [+r.left.toFixed(1), +r.top.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)];
  });
}

async function editState(win) {
  return win.evaluate(() => ({
    editors: document.querySelectorAll('[data-edit-editor]').length,
    boxes: document.querySelectorAll('.edit-box').length,
    boxToolbar: document.querySelectorAll('[data-edit-box-toolbar]').length,
  }));
}

test('T1 duprepro-B: same-rect drag on the committed box hits the move branch', async () => {
  test.setTimeout(120000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    await win.click('[data-edit-tool="box"]');
    const page = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    const x = page.x + page.width * 0.3;
    const y = page.y + page.height * 0.3;
    await win.mouse.move(x, y);
    await win.mouse.down();
    await win.mouse.move(x + 180, y + 60, { steps: 6 });
    await win.mouse.up();
    await win.waitForSelector('[data-edit-editor]', { timeout: 8000 });
    await win.locator('[data-edit-textarea]').fill('DUP-A');
    await win.click('[data-edit-confirm]');
    await win.waitForTimeout(1200);
    const before = await boxRect(win);
    const stateA = await editState(win);
    // Harness flow: toggle edit mode off then back on, re-arm box, drag the SAME rect.
    await win.click('button[aria-label="Edit content"]');
    await win.waitForTimeout(500);
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    await win.click('[data-edit-tool="box"]');
    await win.mouse.move(x, y);
    await win.mouse.down();
    await win.mouse.move(x + 180, y + 60, { steps: 6 });
    await win.mouse.up();
    await win.waitForTimeout(600);
    const after = await editState(win);
    const afterRect = await boxRect(win);
    log('T1-duprepro-B', { boxRectBefore: before, stateA, after, boxRectAfter: afterRect });
    await win.screenshot({ path: path.join(SHOTS, 'def235-harnessflow-duprepro-b.png') }).catch(() => {});
    // Harness-flow artifact: no editor mounts, the one committed box is still there.
    expect(after.editors).toBe(0);
    expect(after.boxes).toBe(1);
  } finally {
    await hardClose(app, 'harnessflow-t1');
  }
});

test('T2 toolboxexit tail: edit-box creation after the stamp flow', async () => {
  test.setTimeout(150000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.click('[data-tool-id="stamp"]');
    await win.waitForSelector('[data-stamp-dialog]', { timeout: 8000 });
    await win.click('[data-stamp-confirm]');
    await win.waitForTimeout(500);
    if (await win.locator('[data-tools-palette]').count()) {
      await win.click('[data-tools-toggle]');
      await win.waitForTimeout(350);
    }
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(pg.x + pg.width * 0.6, pg.y + pg.height * 0.6);
    await win.waitForSelector('.stamp-annotation', { timeout: 10000 });
    await win.waitForTimeout(1000);
    await win.locator('.stamp-annotation').first().click();
    await win.waitForSelector('[data-content-action-bar="stamp"]', { timeout: 8000 });
    await win.click('[data-content-action="stamp-edit"]');
    await win.waitForSelector('[data-stamp-type-editor]', { timeout: 8000 });
    await win.waitForTimeout(300);
    await win.click('[data-stamp-type-cancel]');
    await win.waitForTimeout(400);
    const pre = await win.evaluate(() => ({
      stampArmedLayer: document.querySelectorAll('[data-stamp-layer]').length,
      contentBar: document.querySelectorAll('[data-content-action-bar]').length,
      stamps: document.querySelectorAll('.stamp-annotation').length,
    }));
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    await win.click('[data-edit-tool="box"]');
    const pg2 = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    const px = pg2.x + pg2.width * 0.2;
    const py = pg2.y + pg2.height * 0.2;
    const geo = await win.evaluate(([x, y, bx, by, bw, bh]) => {
      const el = document.elementFromPoint(x, y);
      const centre = document.elementFromPoint(bx + bw / 2, by + bh / 2);
      const edit = document.querySelector('.edit-layer');
      const sc = document.querySelector('.document-scroller');
      return {
        hit: el ? `${el.tagName}.${typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : ''}` : null,
        centreHit: centre ? centre.tagName : null,
        vw: window.innerWidth,
        vh: window.innerHeight,
        scrollerTop: sc ? +sc.scrollTop.toFixed(1) : null,
        inViewport: x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight,
        editLayer: document.querySelectorAll('.edit-layer').length,
        editLayerPe: edit ? getComputedStyle(edit).pointerEvents : null,
        stampArmedLayer: document.querySelectorAll('[data-stamp-layer]').length,
        boxPressed: document.querySelector('[data-edit-tool="box"]')?.getAttribute('aria-pressed'),
      };
    }, [px, py, pg2.x, pg2.y, pg2.width, pg2.height]);
    await win.mouse.move(px, py);
    await win.mouse.down();
    await win.mouse.move(px + 150, py + 50, { steps: 5 });
    await win.mouse.up();
    await win.waitForTimeout(800);
    const post = await win.evaluate(() => ({
      editors: document.querySelectorAll('[data-edit-editor]').length,
      editBoxes: document.querySelectorAll('.edit-box').length,
      stamps: document.querySelectorAll('.stamp-annotation').length,
    }));
    log('T2-toolboxexit-tail', { pre, geo, pg2, px: +px.toFixed(1), py: +py.toFixed(1), post });
    await win.screenshot({ path: path.join(SHOTS, 'def235-harnessflow-toolboxexit.png') }).catch(() => {});
    if (geo.inViewport) {
      // The harness's page-relative drag point is actually on-screen: the
      // drag must create an edit box (product behaviour).
      expect(post.editBoxes).toBeGreaterThan(0);
    } else {
      // Harness-flow artifact: the stamp flow leaves the document scroller
      // part-way down, so page 1's 0.2 point sits above the viewport and the
      // harness's mouse drag lands outside the page. T3 proves the same
      // page*0.2 drag mounts the editor from a fresh launch.
      expect(post.editBoxes).toBe(0);
      log('T2-artifact-confirmed', {
        scrollerTop: geo.scrollerTop,
        py: +py.toFixed(1),
        note: 'page*0.2 above the viewport after the stamp flow scrolled the document; drag commits nothing',
      });
    }
  } finally {
    await hardClose(app, 'harnessflow-t2');
  }
});

test('T3 control: fresh launch, same page*0.2 drag creates the editor', async () => {
  test.setTimeout(120000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    await win.click('[data-edit-tool="box"]');
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    const px = pg.x + pg.width * 0.2;
    const py = pg.y + pg.height * 0.2;
    const geo = await win.evaluate(([x, y, bx, by, bw, bh]) => ({
      hit: document.elementFromPoint(x, y)?.tagName ?? null,
      centreHit: document.elementFromPoint(bx + bw / 2, by + bh / 2)?.tagName ?? null,
      inViewport: x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight,
    }), [px, py, pg.x, pg.y, pg.width, pg.height]);
    await win.mouse.move(px, py);
    await win.mouse.down();
    await win.mouse.move(px + 150, py + 50, { steps: 5 });
    await win.mouse.up();
    await win.waitForTimeout(600);
    const post = await editState(win);
    log('T3-control-fresh', { pg, px: +px.toFixed(1), py: +py.toFixed(1), geo, post });
    expect(post.editors).toBe(1);
  } finally {
    await hardClose(app, 'harnessflow-t3');
  }
});
