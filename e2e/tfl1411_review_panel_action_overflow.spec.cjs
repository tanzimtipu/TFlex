// TFL-1467 (TFL-1411 chunk B) — Review panel action-row overflow verification.
//
// Change under test (styles.css):
//   - .glass-sidebar-actions now wraps + shrinks (flex-wrap: wrap; min-width: 0;
//     justify-content: flex-end).
//   - .glass-sidebar-header / -preferred and .tf-panel-header-preferred use
//     min-height (44px / 52px) instead of a fixed height, so a wrapped second
//     action row GROWS the header instead of being clipped.
//
// Evidence:
//   Test 1 pins the LEFT navigator to its 240px MIN width on the REVIEW stage
//   and proves the Annotations header's Export / Import buttons and the count
//   pill are fully inside the .ann-panel rectangle and hit-test to themselves
//   (elementFromPoint), i.e. not clipped or covered by the overflow:hidden body.
//   Test 2 is the breadth sweep: at the left AND right min widths, across every
//   stage, every .glass-sidebar-actions cluster on screen has its children
//   inside their header content box. Home (no document) is swept too.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, hardClose, gotoStage } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const WIN_W = 1440;
const WIN_H = 900;
const OVERFLOW_TOLERANCE_PX = 1;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function resize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, b) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    win.setBounds({ width: b.width, height: b.height });
  }, { width, height });
  await sleep(700);
}

async function shot(win, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  console.log(`[tfl1411 shot] ${p}`);
  return p;
}

// Expand the context panel and the inspector so both resize handles are mounted.
async function ensureBothExpanded(win) {
  if ((await win.locator('[data-context-panel][data-context-panel-collapsed="true"]').count()) > 0) {
    await win.locator('[data-rail-collapse]').first().click();
    await sleep(500);
  }
  if ((await win.locator('[data-inspector][data-inspector-collapsed="true"]').count()) > 0) {
    await win.locator('[data-inspector-collapsed-strip] [data-inspector-collapse]').first().click();
    await sleep(500);
  }
}

// Focus a real separator and drive it with a keyboard bound (Home = min width).
async function pinHandle(win, side, key) {
  const h = win.locator(`[data-panel-resize="${side}"]`).first();
  await expect(h).toBeVisible({ timeout: 10000 });
  await h.focus();
  await win.keyboard.press(key);
  await sleep(350);
}

// Measure the REVIEW Annotations header action cluster against the panel and
// header content boxes, and hit-test each control's centre. One evaluate so the
// rects are read in the same frame.
async function measureReview(win) {
  return win.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100;
    const panel = document.querySelector('.context-panel');
    const ann = document.querySelector('.ann-panel');
    const header = document.querySelector('.ann-panel-header');
    const cluster = header ? header.querySelector('.glass-sidebar-actions') : null;
    if (!panel || !ann || !header || !cluster) {
      return { missing: true, panel: !!panel, ann: !!ann, header: !!header, cluster: !!cluster };
    }
    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return {
        left: round(r.left), right: round(r.right), top: round(r.top),
        bottom: round(r.bottom), width: round(r.width), height: round(r.height),
      };
    };
    const annRect = ann.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const cs = getComputedStyle(header);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const hr = header.getBoundingClientRect();
    const contentLeft = hr.left + padL;
    const contentRight = hr.right - padR;
    const gap = parseFloat(getComputedStyle(cluster).columnGap) || 0;
    const entries = [
      ['count', '.ann-panel-count'],
      ['export', '[data-ann-io="export"]'],
      ['import', '[data-ann-io="import"]'],
    ];
    const controls = [];
    let requiredWidth = 0;
    for (const [name, sel] of entries) {
      const el = cluster.querySelector(sel);
      if (!el) { controls.push({ name, missing: true }); continue; }
      const r = el.getBoundingClientRect();
      requiredWidth += r.width;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      controls.push({
        name,
        rect: rectOf(el),
        insidePanel: r.left >= panelRect.left - 0.5 && r.right <= panelRect.right + 0.5
          && r.top >= panelRect.top - 0.5 && r.bottom <= panelRect.bottom + 0.5,
        insideAnn: r.left >= annRect.left - 0.5 && r.right <= annRect.right + 0.5
          && r.top >= annRect.top - 0.5 && r.bottom <= annRect.bottom + 0.5,
        insideHeaderContent: r.left >= contentLeft - 0.5 && r.right <= contentRight + 0.5
          && r.top >= hr.top - 0.5 && r.bottom <= hr.bottom + 0.5,
        hitSelf: !!hit && (hit === el || el.contains(hit)),
        hitTag: hit ? hit.tagName : null,
        disabled: !!el.disabled,
      });
    }
    requiredWidth += gap * 2;
    return {
      missing: false,
      panel: rectOf(panel),
      ann: rectOf(ann),
      header: rectOf(header),
      headerContent: { left: round(contentLeft), right: round(contentRight), width: round(contentRight - contentLeft) },
      cluster: rectOf(cluster),
      clusterChildCount: cluster.children.length,
      gap: round(gap),
      requiredWidth: round(requiredWidth),
      availableWidth: round(contentRight - contentLeft),
      controls,
    };
  });
}

// Breadth sweep: every .glass-sidebar-actions cluster on screen; for each, the
// max px any child sticks out past its header's content box. Returns one row
// per cluster; the caller logs a line per cluster and asserts no overflow.
async function sweepClusters(win, label) {
  const rows = await win.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100;
    const out = [];
    document.querySelectorAll('.glass-sidebar-actions').forEach((cluster) => {
      const header = cluster.parentElement;
      if (!header) return;
      const cs = getComputedStyle(header);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const hr = header.getBoundingClientRect();
      const contentLeft = hr.left + padL;
      const contentRight = hr.right - padR;
      let maxOverflow = 0;
      let counted = 0;
      Array.from(cluster.children).forEach((k) => {
        const kr = k.getBoundingClientRect();
        if (kr.width === 0 && kr.height === 0) return;
        counted += 1;
        maxOverflow = Math.max(maxOverflow, contentLeft - kr.left, kr.right - contentRight);
      });
      out.push({
        headerClass: header.className,
        childCount: cluster.children.length,
        measuredChildren: counted,
        visible: hr.width > 0 && hr.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
        maxOverflowPx: round(maxOverflow),
      });
    });
    return out;
  });
  console.log(`[tfl1411 sweep] ${label} clusters=${rows.length}`);
  for (const r of rows) {
    console.log(`[tfl1411 sweep] ${label} | header="${r.headerClass}" children=${r.childCount} measured=${r.measuredChildren} visible=${r.visible} maxOverflowPx=${r.maxOverflowPx}`);
  }
  return rows;
}

test.describe('TFL-1411 review panel action-row overflow', () => {
  let app;
  let win;
  test.setTimeout(300000);

  test.beforeAll(async () => {
    app = await launchApp();
    win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await resize(app, WIN_W, WIN_H);
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await expect(win.locator('.pdf-page canvas:visible').first()).toBeVisible({ timeout: 30000 });
    await gotoStage(win, 3);
    await ensureBothExpanded(win);
    await sleep(500);
  });

  test.afterAll(async () => {
    await hardClose(app, 'tfl1411-overflow');
  });

  test('Review Export / Import / count stay fully inside the 240px panel', async () => {
    await pinHandle(win, 'left', 'Home');
    await sleep(400);
    await expect(win.locator('.context-panel')).toHaveAttribute('data-context-panel-stage', 'review');
    await expect(win.locator('.ann-panel-header')).toBeVisible();
    await expect(win.locator('[data-panel-resize="left"]')).toHaveAttribute('aria-valuenow', '240');

    const m = await measureReview(win);
    console.log(`[tfl1411 geometry] ${JSON.stringify(m)}`);
    await shot(win, 'tfl1411_review_panel_import_inside_240.png');

    expect(m.missing, 'Review Annotations header cluster must be present').toBe(false);
    expect(m.controls).toHaveLength(3);
    for (const c of m.controls) {
      expect(c.missing, `${c.name} control present`).not.toBe(true);
      expect(c.insidePanel, `${c.name} inside .context-panel rectangle: ${JSON.stringify(c.rect)}`).toBe(true);
      expect(c.insideAnn, `${c.name} inside .ann-panel rectangle: ${JSON.stringify(c.rect)}`).toBe(true);
      expect(c.insideHeaderContent, `${c.name} inside header content box: ${JSON.stringify(c.rect)}`).toBe(true);
      expect(c.hitSelf, `${c.name} elementFromPoint resolves to the control (hitTag=${c.hitTag})`).toBe(true);
    }
  });

  test('breadth sweep: no panel action cluster overflows at min panel widths', async () => {
    await pinHandle(win, 'left', 'Home');
    await pinHandle(win, 'right', 'Home');
    await sleep(400);

    const violations = [];
    const stages = [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']];
    for (const [num, name] of stages) {
      await gotoStage(win, num);
      await ensureBothExpanded(win);
      await sleep(500);
      const rows = await sweepClusters(win, `stage${num}:${name}`);
      for (const r of rows) {
        if (r.visible && r.maxOverflowPx > OVERFLOW_TOLERANCE_PX) violations.push({ stage: name, ...r });
      }
    }

    // Home / welcome (no document open).
    for (let i = 0; i < 8; i += 1) {
      const close = win.locator('[data-animated-tab] .tab-close:visible');
      if ((await close.count()) === 0) break;
      await close.first().click().catch(() => {});
      await sleep(500);
    }
    await win.waitForSelector('.sample-card, .welcome', { timeout: 20000 }).catch(() => {});
    await sleep(600);
    const homeRows = await sweepClusters(win, 'home-welcome');
    for (const r of homeRows) {
      if (r.visible && r.maxOverflowPx > OVERFLOW_TOLERANCE_PX) violations.push({ stage: 'home', ...r });
    }

    console.log(`[tfl1411 sweep] violations=${JSON.stringify(violations)}`);
    expect(violations, `action clusters overflowing their header at min widths: ${JSON.stringify(violations)}`).toEqual([]);
  });
});
