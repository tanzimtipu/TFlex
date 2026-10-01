// Adversarial Phase-73 DIFF-PASS probe: dirty-dot sizing change.
//
//   node test-fixtures/adv-p73/probe.cjs a    (ring / dirty-only / mousedown / layout A/B)
//   node test-fixtures/adv-p73/probe.cjs b    (squeeze: 10 and 20 tabs at 640px, clip test)
//   node test-fixtures/adv-p73/probe.cjs all
//
// Standalone harness (NOT an e2e spec). Launches only through the canonical
// helper e2e/lib/launch.cjs. Prints one `### <json>` line per measurement.
// Adversary probe artifact, mirrors test-fixtures/adv-p72-probe.cjs.
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp, getSamplePath } = require(REPO + '\\e2e\\lib\\launch.cjs');
const { hardClose, openSamplePath, runTool } = require(REPO + '\\e2e\\lib\\helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function rec(o) { console.log('### ' + JSON.stringify(o)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freshUserData(tag) {
  const d = path.join(os.tmpdir(), `tflex-adv-p73-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// Measure one tab's dot geometry AND whether it is actually painted: the
// title's overflow:hidden clip rect (its padding box) vs the dot rect, plus an
// elementFromPoint hit-test at the dot centre (clipped content is neither
// painted nor hit-testable).
const MEASURE = (idx) => {
  const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
  const tab = tabs[idx];
  if (!tab) return { idx, error: 'no tab' };
  const dot = tab.querySelector('.tab-modified-dot');
  const title = tab.querySelector('.tab-title');
  const close = tab.querySelector('.tab-close');
  const tr = tab.getBoundingClientRect();
  const tir = title.getBoundingClientRect();
  const cr = close.getBoundingClientRect();
  const ts = getComputedStyle(title);
  const tpadL = parseFloat(ts.paddingLeft) || 0;
  const tpadR = parseFloat(ts.paddingRight) || 0;
  const tborderL = parseFloat(ts.borderLeftWidth) || 0;
  const tborderR = parseFloat(ts.borderRightWidth) || 0;
  const clipLeft = tir.left + tborderL; // padding-box left (overflow clip edge)
  const clipRight = tir.right - tborderR; // padding-box right
  const contentLeft = clipLeft + tpadL;
  let d = null;
  let hit = null;
  if (dot) {
    const dr = dot.getBoundingClientRect();
    const ds = getComputedStyle(dot);
    const cx = (dr.left + dr.right) / 2;
    const cy = (dr.top + dr.bottom) / 2;
    const el = document.elementFromPoint(cx, cy);
    hit = el ? String(el.className || el.tagName) : null;
    d = {
      left: dr.left, right: dr.right, top: dr.top, bottom: dr.bottom,
      width: dr.width, height: dr.height,
      offsetWidth: dot.offsetWidth, offsetHeight: dot.offsetHeight,
      boxSizing: ds.boxSizing, borderTopWidth: ds.borderTopWidth,
      borderTopStyle: ds.borderTopStyle, borderTopColor: ds.borderTopColor,
      backgroundColor: ds.backgroundColor, boxShadow: ds.boxShadow,
      visibility: ds.visibility, opacity: ds.opacity, className: dot.className,
      center: [Number(cx.toFixed(2)), Number(cy.toFixed(2))],
    };
  }
  const rightOfClip = d ? d.left >= clipRight - 0.51 : null; // dot starts at/after clip right
  const leftOfClip = d ? d.right <= clipLeft + 0.51 : null; // dot ends at/before clip left
  const fullyClipped = d ? (rightOfClip || leftOfClip) : null;
  return {
    idx,
    active: tab.classList.contains('tab-active') || tab.getAttribute('aria-selected') === 'true',
    theme: document.documentElement.dataset.theme,
    tab: { left: tr.left, right: tr.right, top: tr.top, bottom: tr.bottom, width: tr.width, height: tr.height },
    title: {
      left: tir.left, right: tir.right, width: tir.width, paddingLeft: tpadL, paddingRight: tpadR,
      clipLeft, clipRight, contentLeft, overflow: ts.overflow, textOverflow: ts.textOverflow,
      text: title.textContent.trim(),
    },
    close: { left: cr.left, right: cr.right, width: cr.width },
    dot: d,
    hit,
    paint: { rightOfClip, leftOfClip, fullyClipped, hitIsDot: hit ? hit.indexOf('tab-modified-dot') !== -1 : null },
    clearance: {
      dotToTabLeft: d ? Number((d.left - tr.left).toFixed(2)) : null,
      dotToTabRight: d ? Number((tr.right - d.right).toFixed(2)) : null,
      dotToCloseLeft: d ? Number((cr.left - d.right).toFixed(2)) : null,
    },
  };
};

async function openViaToolbar(app, win, filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  const before = await win.locator('[data-tab-id]').count();
  await win.locator('[data-toolbar-open]').first().click();
  await win
    .waitForFunction((n) => document.querySelectorAll('[data-tab-id]').length > n, before, { timeout: 30000 })
    .catch(() => {});
  await win.waitForTimeout(250);
}

async function resize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes('detached')) || BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    win.setSize(size.w, size.h);
  }, { w, h });
  await sleep(1400);
}

async function dirtyFirstTab(win) {
  await runTool(win, 'rotate');
  await win.waitForFunction(() => {
    const t = document.querySelector('[data-tab-id].tab-active') || document.querySelector('[data-tab-id][aria-selected="true"]');
    const d = t && t.querySelector('.tab-modified-dot');
    if (!d) return false;
    const cs = getComputedStyle(d);
    return cs.visibility === 'visible' && parseFloat(cs.opacity) > 0.5;
  }, null, { timeout: 20000 });
  await win.waitForTimeout(300);
}

// ---------------- A: ring / dirty-only / mousedown / layout A/B ------------
async function scenarioA() {
  let app = null;
  try {
    app = await launchApp([], await freshUserData('a'));
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });
    await win.waitForTimeout(600);
    await dirtyFirstTab(win);

    // Clean second tab -> tab0 becomes an INACTIVE dirty tab.
    await openViaToolbar(app, win, getSamplePath('long.pdf'));
    await win.waitForTimeout(500);

    const themeMeasure = {};
    for (const t of ['light', 'dark', 'frosted']) {
      await win.evaluate((th) => { document.documentElement.dataset.theme = th; }, t);
      await win.waitForTimeout(400);
      themeMeasure[t] = {
        dirtyInactive: await win.evaluate(MEASURE, 0),
        cleanActive: await win.evaluate(MEASURE, 1),
      };
    }

    // Layout A/B: tab widths / close positions / title truncation with the
    // shipped padding-left:1px vs an injected padding-left:0 (probe-only style,
    // never written to disk). Any difference beyond the 1px title inset is a
    // layout shift.
    await win.evaluate((th) => { document.documentElement.dataset.theme = th; }, 'light');
    await win.waitForTimeout(300);
    const widthStats = () => {
      const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
      const widths = tabs.map((t) => Number(t.getBoundingClientRect().width.toFixed(2)));
      const closes = tabs.map((t) => Number(t.querySelector('.tab-close').getBoundingClientRect().left.toFixed(2)));
      const titles = tabs.map((t) => Number(t.querySelector('.tab-title').getBoundingClientRect().width.toFixed(2)));
      const clipText = tabs.map((t) => t.querySelector('.tab-title').textContent.trim());
      return { widths, closes, titles, clipText };
    };
    const beforeAB = await win.evaluate(widthStats);
    await win.evaluate(() => {
      const s = document.createElement('style');
      s.id = 'adv-p73-ab';
      s.textContent = '.tab-area[data-tab-style="colorful"] .tab-title { padding-left: 0 !important; }';
      document.head.appendChild(s);
    });
    await win.waitForTimeout(300);
    const afterAB = await win.evaluate(widthStats);
    await win.evaluate(() => { const s = document.getElementById('adv-p73-ab'); if (s) s.remove(); });
    await win.waitForTimeout(200);

    // Interaction: tab0 is inactive dirty. Mousedown ON the dot must activate.
    const dotBox = await win.evaluate(() => {
      const t = document.querySelector('[data-tab-id]');
      const d = t.querySelector('.tab-modified-dot');
      const r = d.getBoundingClientRect();
      return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
    });
    const activeBefore = await win.evaluate(() => document.querySelector('[data-tab-id].tab-active')?.dataset.tabId
      ?? document.querySelector('[data-tab-id][aria-selected="true"]')?.dataset.tabId ?? null);
    await win.mouse.move(dotBox.x, dotBox.y);
    await win.mouse.down();
    await win.mouse.up();
    await win.waitForTimeout(500);
    const activeAfter = await win.evaluate(() => document.querySelector('[data-tab-id].tab-active')?.dataset.tabId
      ?? document.querySelector('[data-tab-id][aria-selected="true"]')?.dataset.tabId ?? null);

    await win.screenshot({ path: REPO + '\\screenshots\\adv-p73-a-header-light.png' }).catch(() => {});
    await win.evaluate(() => {
      const area = document.querySelector('.tab-area');
      area.style.transformOrigin = 'top left';
      area.style.transform = 'scale(6)';
    });
    await win.waitForTimeout(300);
    const clip = await win.evaluate(() => {
      const t = document.querySelector('[data-tab-id]');
      const r = t.getBoundingClientRect();
      const m = 8;
      return { x: r.left - m, y: r.top - m, width: r.width + 2 * m, height: r.height + 2 * m };
    });
    await win.screenshot({ path: REPO + '\\screenshots\\adv-p73-a-zoom-dirty-tab0.png', clip }).catch(() => {});
    await win.evaluate(() => { const a = document.querySelector('.tab-area'); a.style.transform = ''; a.style.transformOrigin = ''; });

    rec({ scenario: 'a', themeMeasure, layoutAB: { before: beforeAB, after: afterAB }, mousedown: { activeBefore, activeAfter, dotBox } });
  } catch (e) {
    rec({ scenario: 'a', error: String((e && e.stack) || e) });
  } finally { await hardClose(app, 'a').catch(() => {}); }
}

// ---------------- B: squeeze hard, prove paint or clip ---------------------
async function openMany(app, win, startIndex, target) {
  const src = getSamplePath('report.pdf');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-adv-p73-more-'));
  for (let i = startIndex; i < target; i += 1) {
    const p = path.join(tmp, `adv-p73-${i + 1}.pdf`);
    fs.copyFileSync(src, p);
    await openViaToolbar(app, win, p);
  }
}

async function scenarioB() {
  let app = null;
  try {
    app = await launchApp([], await freshUserData('b'));
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });
    await win.waitForTimeout(500);
    await dirtyFirstTab(win); // tab0 dirty
    await openMany(app, win, 1, 10); // 10 tabs total, tab0 stays dirty
    await win.waitForFunction(() => document.querySelectorAll('[data-tab-id]').length >= 10, null, { timeout: 60000 });
    await win.waitForTimeout(600);

    // keep the dirty tab0 active and squeezed
    await win.locator('[data-tab-id]').first().click();
    await win.waitForTimeout(400);
    await resize(app, 640, 760);

    const report = async (label, count) => {
      const all = await win.evaluate((n) => {
        const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
        const widths = tabs.map((t) => Number(t.getBoundingClientRect().width.toFixed(2)));
        const list = document.querySelector('.tab-list');
        return {
          theme: document.documentElement.dataset.theme,
          count: tabs.length,
          list: { clientWidth: list.clientWidth, scrollWidth: list.scrollWidth },
          widths,
          widthMin: Math.min(...widths),
          widthMax: Math.max(...widths),
          widthSpread: Number((Math.max(...widths) - Math.min(...widths)).toFixed(2)),
        };
      }, count);
      const dot0 = await win.evaluate(MEASURE, 0);
      rec({ scenario: 'b', label, summary: all, dirtyTab0: dot0 });
      return dot0;
    };

    const ten = await report('10-tabs-640', 10);
    await win.screenshot({ path: REPO + '\\screenshots\\adv-p73-b-10tabs-640.png' }).catch(() => {});

    // zoom + clipped screenshot of the dirty tab at 10 tabs
    const zoomShot = async (file) => {
      await win.evaluate(() => {
        const area = document.querySelector('.tab-area');
        area.style.transformOrigin = 'top left';
        area.style.transform = 'scale(8)';
      });
      await win.waitForTimeout(300);
      const clip = await win.evaluate(() => {
        const t = document.querySelector('[data-tab-id]');
        const r = t.getBoundingClientRect();
        const m = 6;
        return { x: r.left - m, y: r.top - m, width: r.width + 2 * m, height: r.height + 2 * m };
      });
      await win.screenshot({ path: REPO + '\\screenshots\\' + file, clip }).catch(() => {});
      await win.evaluate(() => { const a = document.querySelector('.tab-area'); a.style.transform = ''; a.style.transformOrigin = ''; });
      await win.waitForTimeout(200);
    };
    await zoomShot('adv-p73-b-zoom-dirty-tab0-10tabs.png');

    // Push harder: 20 tabs at the 640px minimum.
    await openMany(app, win, 10, 20);
    await win.waitForFunction(() => document.querySelectorAll('[data-tab-id]').length >= 20, null, { timeout: 90000 });
    await win.waitForTimeout(700);
    await win.locator('[data-tab-id]').first().click();
    await win.waitForTimeout(400);
    await resize(app, 640, 760);
    const twenty = await report('20-tabs-640', 20);
    await win.screenshot({ path: REPO + '\\screenshots\\adv-p73-b-20tabs-640.png' }).catch(() => {});
    await zoomShot('adv-p73-b-zoom-dirty-tab0-20tabs.png');

    rec({ scenario: 'b-verdict', tenFullyClipped: ten && ten.paint.fullyClipped, tenHit: ten && ten.hit,
      twentyFullyClipped: twenty && twenty.paint.fullyClipped, twentyHit: twenty && twenty.hit,
      twentyTabWidth: twenty && twenty.tab.width, twentyTitleWidth: twenty && twenty.title.width });
  } catch (e) {
    rec({ scenario: 'b', error: String((e && e.stack) || e) });
  } finally { await hardClose(app, 'b').catch(() => {}); }
}

async function main() {
  const scenario = process.argv[2] || 'all';
  if (scenario === 'a' || scenario === 'all') await scenarioA();
  if (scenario === 'b' || scenario === 'all') await scenarioB();
  console.log('DONE ' + scenario);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
