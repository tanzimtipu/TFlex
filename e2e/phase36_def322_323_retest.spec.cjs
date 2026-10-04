// Phase 36 LAYOUT PASS retest — DEF-322 (single-mode pill yield ladder) and
// DEF-323 (Multi Mode pane pills clear of the dock and the other pane).
//
// Developer's claimed rules:
//   DEF-322  `.canvas-overlay` is a container query; the pill pair follows a
//            full / compact / stacked yield ladder (src/renderer/state/pillFit.ts)
//            so the two pills never intersect and every control stays
//            hit-testable at 1440/1100/900/760/640.
//   DEF-323  in Multi Mode each pane's `.canvas-overlay` no longer re-applies
//            the Inspector inset (`right: 0`), so pane A's pills sit at A's left
//            edge and pane B's at B's right edge, clear of the shared dock.
//
// Evidence-first: every test logs raw geometry before asserting. All launches
// go through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { twoPaneSetup } = require('./lib/p33_common.cjs');

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'test-fixtures', 'report.pdf');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p36-def322-323');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function openReport() {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, REPORT);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
}
const setSize = (w, h) => app.evaluate(({ BrowserWindow }, s) => {
  BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]);
}, [w, h]);

function intersects(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

// ---------------------------------------------------------------------------
// DEF-322 — the single-mode pills never intersect and every control is the top
// element at its own centre, at the five supported widths.
// ---------------------------------------------------------------------------
test('DEF-322: the pill pair never intersects and every control is hit-testable at 1440/1100/900/760/640', async () => {
  await openReport();
  const rows = [];
  for (const w of [1440, 1100, 900, 760, 640]) {
    await setSize(w, 900);
    await win.waitForTimeout(800);
    await win.waitForFunction((target) => Math.abs(window.innerWidth - target) < 60, w, { timeout: 10000 });
    const m = await win.evaluate(() => {
      const rect = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width) };
      };
      const overlay = document.querySelector('.canvas-overlay');
      const page = document.querySelector('[data-page-pill]');
      const zoom = document.querySelector('[data-zoom-pill]');
      const covered = [];
      for (const pill of [page, zoom]) {
        if (!pill) continue;
        for (const c of pill.querySelectorAll('button, input')) {
          const r = c.getBoundingClientRect();
          const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
          if (el === null || (el !== c && c.contains(el) === false)) {
            covered.push(`${c.getAttribute('aria-label')} -> ${el ? el.tagName + '.' + String(el.className) : 'null'}`);
          }
        }
      }
      const pageR = rect(page);
      const zoomR = rect(zoom);
      return {
        vw: window.innerWidth,
        overlay: rect(overlay),
        page: pageR,
        zoom: zoomR,
        // The stacked rung raises the zoom pill above the page pill's row.
        zoomRaised: !!(pageR && zoomR && zoomR.bottom <= pageR.top - 4),
        covered,
      };
    });
    rows.push(m);
    console.log(`[P36-DEF322] w=${w} vw=${m.vw} overlay=${JSON.stringify(m.overlay)} page=${JSON.stringify(m.page)} zoom=${JSON.stringify(m.zoom)} zoomRaised=${m.zoomRaised} covered=${JSON.stringify(m.covered)}`);
    expect(m.page, `page pill renders at ${w}`).not.toBeNull();
    expect(m.zoom, `zoom pill renders at ${w}`).not.toBeNull();
    expect(intersects(m.page, m.zoom), `DEF-322: pills intersect at ${w}px page=${JSON.stringify(m.page)} zoom=${JSON.stringify(m.zoom)}`).toBe(false);
    expect(m.covered, `DEF-322: every pill control is hit-testable at ${w}px`).toEqual([]);
  }
  console.log(`[P36-DEF322] ladder zoomRaised: 1440=${rows[0].zoomRaised} 1100=${rows[1].zoomRaised} 900=${rows[2].zoomRaised} 760=${rows[3].zoomRaised} 640=${rows[4].zoomRaised}`);
  // The ladder must yield SOMEWHERE: the pair is one row at the widest width
  // and stacked at the narrowest (the exact rung boundary is the developer's).
  expect(rows[0].zoomRaised, 'the pair is one row at 1440px').toBe(false);
  expect(rows[4].zoomRaised, 'the pair is stacked at 640px').toBe(true);
});

// ---------------------------------------------------------------------------
// DEF-323 — in Multi Mode, for BOTH panes, every pill control is hit-testable
// and clear of the dock and the other pane.
// ---------------------------------------------------------------------------
test('DEF-323: in Multi Mode each pane\'s pills sit inside its own pane, are hit-testable and clear of the dock', async () => {
  await twoPaneSetup(app, win);
  await win.waitForTimeout(800);
  const dump = await win.evaluate(() => {
    const rect = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width) };
    };
    const dock = rect(document.querySelector('[data-action-dock]'));
    const panes = [...document.querySelectorAll('.tab-pane[data-pane]')].map((p) => ({ pane: p.getAttribute('data-pane'), rect: rect(p) }));
    const pills = [...document.querySelectorAll('[data-canvas-pills][data-pill-pane]')].map((c) => {
      const pane = c.getAttribute('data-pill-pane');
      const paneRect = panes.find((p) => p.pane === pane) ? panes.find((p) => p.pane === pane).rect : null;
      const other = panes.find((p) => p.pane !== pane) ? panes.find((p) => p.pane !== pane).rect : null;
      const covered = [];
      for (const ctrl of c.querySelectorAll('button, input')) {
        const r = ctrl.getBoundingClientRect();
        const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        if (el === null || (el !== ctrl && ctrl.contains(el) === false)) {
          covered.push(`${ctrl.getAttribute('aria-label')} -> ${el ? el.tagName + '.' + String(el.className) : 'null'}`);
        }
      }
      return { pane, container: rect(c), page: rect(c.querySelector('[data-page-pill]')), zoom: rect(c.querySelector('[data-zoom-pill]')), covered, paneRect, other };
    });
    return { panes, dock, pills };
  });
  console.log(`[P36-DEF323] dock=${JSON.stringify(dump.dock)} panes=${JSON.stringify(dump.panes)} pills=${JSON.stringify(dump.pills)}`);
  expect(dump.pills.length, 'both panes render their own pills').toBe(2);
  for (const p of dump.pills) {
    expect(p.covered, `DEF-323: pane ${p.pane} pill controls are hit-testable`).toEqual([]);
    expect(p.container.left, `DEF-323: pane ${p.pane} pills start at/after its pane left`).toBeGreaterThanOrEqual(p.paneRect.left - 1);
    expect(p.container.right, `DEF-323: pane ${p.pane} pills end at/before its pane right`).toBeLessThanOrEqual(p.paneRect.right + 1);
    if (dump.dock) {
      for (const part of [p.page, p.zoom]) {
        if (part) {
          expect(intersects(part, dump.dock), `DEF-323: pane ${p.pane} pill ${JSON.stringify(part)} intersects dock ${JSON.stringify(dump.dock)}`).toBe(false);
        }
      }
    }
    if (p.other) {
      for (const part of [p.page, p.zoom]) {
        if (part) {
          expect(intersects(part, p.other), `DEF-323: pane ${p.pane} pill ${JSON.stringify(part)} intersects the other pane ${JSON.stringify(p.other)}`).toBe(false);
        }
      }
    }
  }
});
