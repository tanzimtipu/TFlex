// Adversarial Phase-72 probe: tab silhouette / dot / close / border / tint and
// fit-to-width overflow. Standalone harness (NOT an e2e spec); requires the
// canonical launch helper by absolute path. Prints structured JSON per
// scenario. Adversary probe artifact, mirrors test-fixtures/adv-p58-tabs.cjs.
//
//   node test-fixtures/adv-p72-probe.cjs a    (silhouette/dot/close/border/tint)
//   node test-fixtures/adv-p72-probe.cjs b    (10-tab overflow, default + 640px)
//   node test-fixtures/adv-p72-probe.cjs c    (hostile tear-out sequences)
//   node test-fixtures/adv-p72-probe.cjs all
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp, getSamplePath } = require(REPO + '\\e2e\\lib\\launch.cjs');
const { hardClose, openSamplePath, runTool } = require(REPO + '\\e2e\\lib\\helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function rec(o) { console.log('### ' + JSON.stringify(o)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freshUserData(tag) {
  const d = path.join(os.tmpdir(), `tflex-adv-p72-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// Runs in the renderer: full tab-strip geometry + computed style snapshot.
const MEASURE = () => {
  const px = (v) => parseFloat(v) || 0;
  const parseColor = (s) => {
    if (s === null || s === undefined) return null;
    let m = String(s).match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[,\s/]+/).map(Number);
      return [p[0], p[1], p[2]];
    }
    m = String(s).match(/color\(srgb\s+([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[,\s/]+/).map(Number);
      return [Math.round(p[0] * 255), Math.round(p[1] * 255), Math.round(p[2] * 255)];
    }
    return null;
  };
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const area = document.querySelector('.tab-area');
  const list = document.querySelector('.tab-list');
  if (!list) return { error: 'no .tab-list' };
  const listRect = list.getBoundingClientRect();
  const cs = getComputedStyle(list);
  const header = document.querySelector('.app-header');
  const hr = header ? header.getBoundingClientRect() : null;
  const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
  const tabM = (t) => {
    const r = t.getBoundingClientRect();
    const c = getComputedStyle(t);
    const b = getComputedStyle(t, '::before');
    const close = t.querySelector('.tab-close');
    const title = t.querySelector('.tab-title');
    const dot = t.querySelector('.tab-modified-dot');
    const cr = close ? close.getBoundingClientRect() : null;
    const padR = px(c.paddingRight);
    const fill = parseColor(b.backgroundColor);
    const ink = parseColor(c.color);
    const parent = t.parentElement;
    const pcs2 = parent ? getComputedStyle(parent) : null;
    return {
      id: t.dataset.tabId, colour: t.dataset.tabColour,
      active: t.classList.contains('tab-active') || t.getAttribute('aria-selected') === 'true',
      h: r.height, w: r.width, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
      topGap: r.top - listRect.top, bottomGap: listRect.bottom - r.bottom,
      radii: [c.borderTopLeftRadius, c.borderTopRightRadius, c.borderBottomRightRadius, c.borderBottomLeftRadius],
      beforeRadii: [b.borderTopLeftRadius, b.borderTopRightRadius, b.borderBottomRightRadius, b.borderBottomLeftRadius],
      parentTag: parent ? parent.tagName : null,
      parentDisplay: pcs2 ? pcs2.display : null,
      parentAlignSelf: pcs2 ? pcs2.alignSelf : null,
      cssH: c.height, alignSelf: c.alignSelf, paddingRight: c.paddingRight,
      beforeBg: b.backgroundColor, beforeBgImage: b.backgroundImage,
      beforeBorder: { w: b.borderTopWidth, style: b.borderTopStyle, color: b.borderTopColor, transparent: parseColor(b.borderTopColor) === null ? 'no' : 'yes' },
      color: c.color, contrast: (fill && ink) ? Number(ratio(ink, fill).toFixed(2)) : null,
      closeIsLast: close ? t.lastElementChild === close : null,
      closeRightGap: cr ? Number(((r.right - padR) - cr.right).toFixed(2)) : null,
      titleText: title ? title.textContent.trim() : null,
      dot: dot ? { cls: dot.className, vis: getComputedStyle(dot).visibility, op: getComputedStyle(dot).opacity } : null,
    };
  };
  const plus = document.querySelector('.tab-new');
  const pr = plus ? plus.getBoundingClientRect() : null;
  const pcs = plus ? getComputedStyle(plus) : null;
  return {
    theme: document.documentElement.dataset.theme,
    tabStyle: area ? area.getAttribute('data-tab-style') : null,
    header: hr ? { h: hr.height, bottom: hr.bottom, borderBottom: getComputedStyle(header).borderBottomWidth + ' ' + getComputedStyle(header).borderBottomColor } : null,
    list: {
      clientWidth: list.clientWidth, scrollWidth: list.scrollWidth,
      overflowX: cs.overflowX, overflowY: cs.overflowY,
      padL: cs.paddingLeft, padR: cs.paddingRight, padT: cs.paddingTop, padB: cs.paddingBottom,
      top: listRect.top, bottom: listRect.bottom, height: listRect.height, right: listRect.right,
    },
    chips: document.querySelectorAll('.tab-colour-chip').length,
    plus: pr ? { left: pr.left, right: pr.right, width: pr.width, h: pr.height, marginLeft: pcs.marginLeft } : null,
    tabs: tabs.map(tabM),
  };
};

async function setTheme(win, theme) {
  await win.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await win.waitForTimeout(400);
}

// Open a document through the real control: the welcome screen's "Open PDF"
// button for the first file, the titlebar Open control for every later one.
async function openPath(win, app, p, first) {
  await app.evaluate(async ({ dialog }, q) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [q] });
  }, p);
  const before = await win.locator('[data-tab-id]').count();
  if (first) {
    await win.locator('button:has-text("Open PDF")').first().click();
  } else {
    await win.locator('[aria-label="Open PDF document"]').first().click();
  }
  if (first) {
    await win.waitForSelector('.workspace', { timeout: 30000 });
  }
  await win
    .waitForFunction((n) => document.querySelectorAll('[data-tab-id]').length > n, before, { timeout: 30000 })
    .catch(() => {});
}

async function openTwo(win, app) {
  await openPath(win, app, getSamplePath('report.pdf'), true);
  await win.waitForSelector('[data-tab-id]', { timeout: 30000 });
  await win.waitForTimeout(400);
  await openPath(win, app, getSamplePath('report.pdf'), false);
  await win.waitForTimeout(800);
}

// ---------------- A: silhouette / dot / close / border / tint ---------------
async function scenarioA() {
  let app = null;
  try {
    app = await launchApp([], await freshUserData('a'));
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openTwo(win, app);

    const themes = ['light', 'dark', 'frosted'];
    const out = {};
    for (const t of themes) {
      await setTheme(win, t);
      out[t] = await win.evaluate(MEASURE);
    }

    // ---- dot lifecycle: clean -> edit -> save -> clean ----
    await setTheme(win, 'light');
    const activeId = await win.evaluate(() => document.querySelector('[data-tab-id].tab-active')?.dataset.tabId ?? document.querySelector('[data-tab-id][aria-selected="true"]')?.dataset.tabId);
    const dotCleanBefore = await win.evaluate((id) => {
      const t = document.querySelector(`[data-tab-id="${id}"]`);
      const d = t && t.querySelector('.tab-modified-dot');
      return d ? { cls: d.className, vis: getComputedStyle(d).visibility, op: getComputedStyle(d).opacity } : null;
    }, activeId);

    await runTool(win, 'rotate');
    await win.waitForTimeout(1500);
    const afterEdit = await win.evaluate((id) => {
      const t = document.querySelector(`[data-tab-id="${id}"]`);
      const d = t && t.querySelector('.tab-modified-dot');
      return {
        modified: window.tflexDiagnostics().modified,
        tabModified: window.tflexDiagnostics().tabModified,
        dot: d ? { cls: d.className, vis: getComputedStyle(d).visibility, op: getComputedStyle(d).opacity } : null,
      };
    }, activeId);

    // save in place (Ctrl+S) - the tab was opened from a real temp path.
    await win.keyboard.press('Control+s');
    await win.waitForTimeout(2500);
    const afterSave = await win.evaluate((id) => {
      const t = document.querySelector(`[data-tab-id="${id}"]`);
      const d = t && t.querySelector('.tab-modified-dot');
      return {
        modified: window.tflexDiagnostics().modified,
        tabModified: window.tflexDiagnostics().tabModified,
        dot: d ? { cls: d.className, vis: getComputedStyle(d).visibility, op: getComputedStyle(d).opacity } : null,
        toasts: Array.from(document.querySelectorAll('.toast')).map((e) => e.textContent.trim()),
        dialogs: document.querySelectorAll('[role="dialog"], .sheet-backdrop').length,
      };
    }, activeId);

    // Short-title close pinning: add an empty placeholder tab (title "Empty tab").
    await win.locator('[data-new-tab]').click();
    await win.waitForTimeout(900);
    const metricsShort = await win.evaluate(MEASURE);
    const shortTab = metricsShort.tabs[metricsShort.tabs.length - 1];

    await win.screenshot({ path: REPO + '\\screenshots\\adv-p72-a-header-light.png' }).catch(() => {});

    // Zoomed silhouette evidence: magnify .tab-area x4 and clip around the
    // ACTIVE tab plus the strip foot / canvas seam below it.
    await win.evaluate(() => {
      const area = document.querySelector('.tab-area');
      area.style.transformOrigin = 'top left';
      area.style.transform = 'scale(4)';
    });
    await win.waitForTimeout(300);
    const clip = await win.evaluate(() => {
      const el = document.querySelector('[data-tab-id].tab-active') || document.querySelector('[data-tab-id]');
      const r = el.getBoundingClientRect();
      const m = 10;
      return { x: r.left - m, y: r.top - m, width: r.width + 2 * m, height: r.height + 2 * m + 14 };
    });
    await win.screenshot({ path: REPO + '\\screenshots\\adv-p72-a-zoom-active-light.png', clip }).catch(() => {});
    await win.evaluate(() => {
      const area = document.querySelector('.tab-area');
      area.style.transform = '';
      area.style.transformOrigin = '';
    });
    await win.waitForTimeout(200);
    await setTheme(win, 'dark');
    await win.screenshot({ path: REPO + '\\screenshots\\adv-p72-a-header-dark.png' }).catch(() => {});
    await setTheme(win, 'frosted');
    await win.screenshot({ path: REPO + '\\screenshots\\adv-p72-a-header-frosted.png' }).catch(() => {});

    rec({ scenario: 'a-silhouette', activeId, dotCleanBefore, afterEdit, afterSave, metricsShort: { list: metricsShort.list, tabs: metricsShort.tabs }, themes: out });
  } catch (e) {
    rec({ scenario: 'a-silhouette', error: String((e && e.stack) || e) });
  } finally { await hardClose(app, 'a').catch(() => {}); }
}

// ---------------- B: 10-tab overflow, default + 640px minimum ---------------
async function scenarioB() {
  let app = null;
  try {
    app = await launchApp([], await freshUserData('b'));
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    for (let i = 0; i < 10; i += 1) {
      await openPath(win, app, getSamplePath('report.pdf'), i === 0);
      await win.waitForTimeout(300);
    }
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });
    await win.waitForTimeout(1500);

    const def = await win.evaluate(MEASURE);
    await win.screenshot({ path: REPO + '\\screenshots\\adv-p72-b-overflow-default.png' }).catch(() => {});

    const resize = async (w, h) => {
      await app.evaluate(({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes('detached')) || BrowserWindow.getAllWindows()[0];
        if (!win) return;
        if (win.isMaximized()) win.unmaximize();
        win.setSize(size.w, size.h);
      }, { w, h });
      await sleep(1800);
    };

    await resize(1280, 800);
    const normal = await win.evaluate(MEASURE);
    await win.screenshot({ path: REPO + '\\screenshots\\adv-p72-b-overflow-1280.png' }).catch(() => {});

    // shrink to the 640px minimum width
    await resize(640, 800);
    const min = await win.evaluate(MEASURE);
    const bounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes('detached')) || BrowserWindow.getAllWindows()[0];
      return win ? { bounds: win.getBounds(), maximized: win.isMaximized() } : null;
    });
    await win.screenshot({ path: REPO + '\\screenshots\\adv-p72-b-overflow-640.png' }).catch(() => {});

    const summarize = (m) => {
      if (!m || m.error) return m;
      const widths = m.tabs.map((t) => Number(t.w.toFixed(2)));
      return {
        theme: m.theme, tabs: m.tabs.length,
        list: m.list,
        widthsMin: Math.min(...widths), widthsMax: Math.max(...widths),
        widthSpread: Number((Math.max(...widths) - Math.min(...widths)).toFixed(2)),
        clipped: m.tabs.filter((t) => t.right > m.list.right + 0.5).length,
        rightMost: Number(Math.max(...m.tabs.map((t) => t.right)).toFixed(2)),
        plus: m.plus,
        horizOverflow: m.list.scrollWidth - m.list.clientWidth,
        chips: m.chips,
      };
    };
    rec({ scenario: 'b-overflow', bounds, default: summarize(def), normal1280: summarize(normal), min640: summarize(min) });
  } catch (e) {
    rec({ scenario: 'b-overflow', error: String((e && e.stack) || e) });
  } finally { await hardClose(app, 'b').catch(() => {}); }
}

// ---------------- C: hostile tear-out / drag-back sequences -----------------
async function tearOut(win, which) {
  const titles = win.locator('[data-tab-id] .tab-title');
  const idx = which === 'last' ? (await titles.count()) - 1 : 0;
  const title = titles.nth(Math.max(0, idx));
  const tb = await title.boundingBox();
  const strip = await win.locator('.tab-list').boundingBox();
  if (!tb || !strip) return { error: 'no title/strip' };
  const sx = tb.x + Math.min(6, tb.width / 2), sy = tb.y + tb.height / 2;
  const ty = strip.y + strip.height + 60;
  await win.mouse.move(sx, sy);
  await win.mouse.down();
  await win.mouse.move(sx, sy + 10, { steps: 4 });
  await win.mouse.move(sx, ty, { steps: 12 });
  await win.mouse.up();
  return { sx, sy, ty };
}

async function tabState(win) {
  return win.evaluate(() => ({
    count: document.querySelectorAll('[data-tab-id]').length,
    titles: Array.from(document.querySelectorAll('[data-tab-id] .tab-title')).map((e) => e.textContent.trim()),
    active: document.querySelector('[data-tab-id].tab-active')?.dataset.tabId ?? document.querySelector('[data-tab-id][aria-selected="true"]')?.dataset.tabId ?? null,
  })).catch((e) => ({ err: String(e.message) }));
}

async function scenarioC() {
  // C1: drag-back from a detached window returns the doc to the origin.
  let app = null;
  try {
    app = await launchApp([], await freshUserData('c1'));
    const origin = await app.firstWindow();
    await origin.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(origin, app, getSamplePath('report.pdf'));
    await origin.waitForSelector('[data-tab-id]', { timeout: 30000 });
    await origin.waitForTimeout(900);

    const secondP = app.waitForEvent('window', { timeout: 20000 }).catch(() => null);
    await tearOut(origin);
    const second = await secondP;
    if (!second) { rec({ scenario: 'c1-dragback', error: 'no detached window' }); return; }
    await second.waitForLoadState('domcontentloaded').catch(() => {});
    const adopted = await second.waitForSelector('[data-tab-id]', { timeout: 20000 }).then(() => true).catch(() => false);
    await second.waitForTimeout(800);
    const originWhile = await tabState(origin);

    // drag the detached window's tab back out -> origin should re-adopt, detached closes.
    const closeP = second.waitForEvent('close', { timeout: 20000 }).catch(() => null);
    const g = await tearOut(second).catch((e) => ({ error: String(e.message) }));
    await sleep(3000);
    const closedEvt = (await closeP) !== null;
    rec({
      scenario: 'c1-dragback', adopted, originWhile, gesture: g,
      detachedClosed: second.isClosed(), closeEventFired: closedEvt,
      originAfter: await tabState(origin),
      windows: app.windows().filter((w) => !w.isClosed()).length,
    });
  } catch (e) {
    rec({ scenario: 'c1-dragback', error: String((e && e.stack) || e) });
  } finally { hardClose(app, 'c1').catch(() => {}); }

  // C2: close the ORIGIN mid-detach, then interact with the detached window.
  let app2 = null;
  try {
    app2 = await launchApp([], await freshUserData('c2'));
    const origin = await app2.firstWindow();
    await origin.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(origin, app2, getSamplePath('report.pdf'));
    await origin.waitForSelector('[data-tab-id]', { timeout: 30000 });
    await origin.waitForTimeout(900);

    const secondP = app2.waitForEvent('window', { timeout: 20000 }).catch(() => null);
    await tearOut(origin);
    const second = await secondP;
    if (!second) { rec({ scenario: 'c2-close-origin-mid-detach', error: 'no detached window' }); return; }
    // Close the origin immediately, before the detached renderer settles.
    await origin.close({ runBeforeUnload: false }).catch(() => {});
    await sleep(2500);
    const alive = !second.isClosed();
    const state = alive ? await second.evaluate(() => ({
      tabs: document.querySelectorAll('[data-tab-id]').length,
      pages: window.tflexDiagnostics().pageCount,
      modified: window.tflexDiagnostics().modified,
    })).catch((e) => ({ err: String(e.message) })) : 'closed';
    rec({ scenario: 'c2-close-origin-mid-detach', detachedAlive: alive, state, windows: app2.windows().filter((w) => !w.isClosed()).length });
  } catch (e) {
    rec({ scenario: 'c2-close-origin-mid-detach', error: String((e && e.stack) || e) });
  } finally { hardClose(app2, 'c2').catch(() => {}); }

  // C3: tear out then immediately close the detached window.
  let app3 = null;
  try {
    app3 = await launchApp([], await freshUserData('c3'));
    const origin = await app3.firstWindow();
    await origin.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(origin, app3, getSamplePath('report.pdf'));
    await origin.waitForSelector('[data-tab-id]', { timeout: 30000 });
    await origin.waitForTimeout(900);
    const secondP = app3.waitForEvent('window', { timeout: 20000 }).catch(() => null);
    await tearOut(origin);
    const second = await secondP;
    if (!second) { rec({ scenario: 'c3-tearout-close-immediate', error: 'no detached window' }); return; }
    await second.close({ runBeforeUnload: false }).catch(() => {});
    await sleep(2500);
    rec({ scenario: 'c3-tearout-close-immediate', closed: second.isClosed(), origin: await tabState(origin), windows: app3.windows().filter((w) => !w.isClosed()).length });
  } catch (e) {
    rec({ scenario: 'c3-tearout-close-immediate', error: String((e && e.stack) || e) });
  } finally { hardClose(app3, 'c3').catch(() => {}); }
}

// D: modify INSIDE the detached window, then check the dirty dot + diagnostics.
async function scenarioD() {
  let app = null;
  try {
    app = await launchApp([], await freshUserData('d'));
    const origin = await app.firstWindow();
    await origin.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(origin, app, getSamplePath('report.pdf'));
    await origin.waitForSelector('[data-tab-id]', { timeout: 30000 });
    await origin.waitForTimeout(900);

    const secondP = app.waitForEvent('window', { timeout: 20000 }).catch(() => null);
    await tearOut(origin);
    const second = await secondP;
    if (!second) { rec({ scenario: 'd-detached-edit-dot', error: 'no detached window' }); return; }
    await second.waitForLoadState('domcontentloaded').catch(() => {});
    await second.waitForSelector('[data-tab-id]', { timeout: 20000 }).catch(() => {});
    await second.waitForTimeout(1200);

    const before = await second.evaluate(() => {
      const d = document.querySelector('[data-tab-id] .tab-modified-dot');
      return {
        modified: window.tflexDiagnostics().modified,
        tabModified: window.tflexDiagnostics().tabModified,
        dot: d ? { cls: d.className, vis: getComputedStyle(d).visibility, op: getComputedStyle(d).opacity } : null,
      };
    });

    await runTool(second, 'rotate');
    await second.waitForTimeout(2000);
    const after = await second.evaluate(() => {
      const d = document.querySelector('[data-tab-id] .tab-modified-dot');
      return {
        modified: window.tflexDiagnostics().modified,
        tabModified: window.tflexDiagnostics().tabModified,
        dot: d ? { cls: d.className, vis: getComputedStyle(d).visibility, op: getComputedStyle(d).opacity } : null,
      };
    });

    // Now drag the modified doc back to the origin and verify the origin's dot.
    const closeP = second.waitForEvent('close', { timeout: 20000 }).catch(() => null);
    await tearOut(second).catch(() => {});
    await sleep(2500);
    const originDot = await origin.evaluate(() => {
      const d = document.querySelector('[data-tab-id] .tab-modified-dot');
      return {
        tabs: document.querySelectorAll('[data-tab-id]').length,
        modified: window.tflexDiagnostics().modified,
        tabModified: window.tflexDiagnostics().tabModified,
        dot: d ? { cls: d.className, vis: getComputedStyle(d).visibility, op: getComputedStyle(d).opacity } : null,
      };
    });
    rec({ scenario: 'd-detached-edit-dot', before, after, dragBackClosed: second.isClosed(), closeEventFired: (await closeP) !== null, originDot });
  } catch (e) {
    rec({ scenario: 'd-detached-edit-dot', error: String((e && e.stack) || e) });
  } finally { hardClose(app, 'd').catch(() => {}); }
}

async function main() {
  const scenario = process.argv[2] || 'all';
  if (scenario === 'a' || scenario === 'all') await scenarioA();
  if (scenario === 'b' || scenario === 'all') await scenarioB();
  if (scenario === 'c' || scenario === 'all') await scenarioC();
  if (scenario === 'd' || scenario === 'all') await scenarioD();
  console.log('DONE ' + scenario);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
