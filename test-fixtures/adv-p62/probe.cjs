// Adversarial Phase-62 (TFL-45) probe: the colorful tab restyle.
//
// Standalone harness (NOT an e2e spec). Launches the dev build through the
// canonical e2e/lib/launch.cjs helper only. Measures, in the RUNNING app:
//   1. geometry at default width and at the 640px minimum with 8+ tabs
//      (active tab vs header / canvas, clipping, overflow shrink-stack)
//   2. the active-tab / canvas seam in all three themes, at the pixel level
//      (does a separator line survive between the active tab and the canvas?)
//   3. the `standard` style (34px + `::after` underline)
//   4. reduced motion / Animations OFF (no new motion on tab render)
//
// Run: node test-fixtures/adv-p62/probe.cjs [geom|narrow|standard|motion|all]
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp } = require(REPO + '\\e2e\\lib\\launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const OUT_DIR = path.join(REPO, 'test-fixtures', 'adv-p62');
const SHOTS = path.join(REPO, 'screenshots');
const TMP = path.join(os.tmpdir(), 'adv-p62-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freshUserData(tag) {
  const d = path.join(TMP, `ud-${tag}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function copySample(name, tag) {
  const src = path.join(REPO, 'assets', 'samples', name);
  const dst = path.join(TMP, `${tag}-${Date.now()}-${name}`);
  fs.copyFileSync(src, dst);
  return dst;
}

async function openPath(app, win, p) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  const welcome = await win.locator('button:has-text("Open PDF")').count();
  if (welcome > 0) {
    await win.locator('button:has-text("Open PDF")').first().click({ timeout: 15000 });
  } else {
    await win.locator('[data-toolbar-open]').first().click({ timeout: 15000 });
  }
  await win.waitForSelector('.workspace', { timeout: 30000 }).catch(() => {});
}

async function setWindowSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, { w, h }) => {
    const win = BrowserWindow.getAllWindows().find((x) => x.isVisible()) || BrowserWindow.getAllWindows()[0];
    if (win) { win.unmaximize(); win.setSize(w, h); }
  }, { w, h });
}

const THEME_LABELS = { light: 'Light', dark: 'Dark', frosted: 'Frosted Glass' };
async function switchTheme(win, theme) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector(`[data-theme-option="${theme}"]`, { state: 'visible', timeout: 8000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForTimeout(700);
}

// Pull the geometry + computed styles for the strip.
async function measureGeometry(win) {
  return win.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const rect = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
    };
    const hdr = q('.app-header');
    const titlebar = q('.titlebar');
    const main = q('.app-main');
    const area = q('.tab-area');
    const list = q('.tab-list');
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
    const active = tabs.find((t) => t.getAttribute('aria-selected') === 'true') || null;
    const inactive = tabs.filter((t) => t.getAttribute('aria-selected') !== 'true');
    const cs = (e) => (e ? getComputedStyle(e) : null);
    const root = getComputedStyle(document.documentElement);
    const tabInfo = (t) => {
      const r = t.getBoundingClientRect();
      const before = getComputedStyle(t, '::before');
      const after = getComputedStyle(t, '::after');
      return {
        id: t.getAttribute('data-tab-id'),
        active: t.getAttribute('aria-selected') === 'true',
        box: { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height },
        minWidth: getComputedStyle(t).minWidth,
        width: getComputedStyle(t).width,
        beforeTL: before.borderTopLeftRadius,
        beforeTR: before.borderTopRightRadius,
        beforeBL: before.borderBottomLeftRadius,
        beforeBR: before.borderBottomRightRadius,
        afterContent: after.content,
      };
    };
    const hdrCs = cs(hdr);
    const areaCs = cs(area);
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      tabStyle: area ? area.getAttribute('data-tab-style') : null,
      vw: window.innerWidth,
      vh: window.innerHeight,
      dpr: window.devicePixelRatio,
      hdr: rect(hdr),
      hdrBorderBottom: hdrCs ? `${hdrCs.borderBottomWidth} ${hdrCs.borderBottomStyle} ${hdrCs.borderBottomColor}` : null,
      hdrHeight: hdrCs ? hdrCs.height : null,
      titlebar: rect(titlebar),
      titlebarBorderBottom: titlebar ? `${cs(titlebar).borderBottomWidth} ${cs(titlebar).borderBottomStyle} ${cs(titlebar).borderBottomColor}` : null,
      main: rect(main),
      area: rect(area),
      areaHeight: areaCs ? areaCs.height : null,
      areaMarginBottom: areaCs ? areaCs.marginBottom : null,
      areaAlignSelf: areaCs ? areaCs.alignSelf : null,
      areaOverflow: areaCs ? areaCs.overflow : null,
      list: rect(list),
      listScrollWidth: list ? list.scrollWidth : null,
      listClientWidth: list ? list.clientWidth : null,
      tabCount: tabs.length,
      active: active ? tabInfo(active) : null,
      inactiveCount: inactive.length,
      firstInactive: inactive[0] ? tabInfo(inactive[0]) : null,
      lastInactive: inactive.length ? tabInfo(inactive[inactive.length - 1]) : null,
      tabs: tabs.map(tabInfo),
      vars: {
        border: root.getPropertyValue('--border').trim(),
        borderSubtle: root.getPropertyValue('--border-subtle').trim(),
        bgToolbar: root.getPropertyValue('--bg-toolbar').trim(),
        radius2: root.getPropertyValue('--radius-2').trim(),
      },
      mainBg: main ? cs(main).backgroundColor : null,
    };
  });
}

// Capture a small DIP rect from the window and return BGRA base64 + size.
async function capture(app, rect) {
  return app.evaluate(async ({ BrowserWindow }, r) => {
    const win = BrowserWindow.getAllWindows().find((x) => x.isVisible()) || BrowserWindow.getAllWindows()[0];
    const img = await win.webContents.capturePage({
      x: Math.round(r.l), y: Math.round(r.t), width: Math.round(r.w), height: Math.round(r.h),
    });
    return { bmp: img.toBitmap().toString('base64'), size: img.getSize() };
  }, rect);
}

// Sample an N-column grid from a captured BGRA buffer.
function sampleGrid(cap, rect, cols, ys) {
  const buf = Buffer.from(cap.bmp, 'base64');
  const { width, height } = cap.size;
  const scale = buf.length / (width * height * 4);
  const px = (xDip, yDip) => {
    let sx = Math.round((xDip - rect.l) * scale);
    let sy = Math.round((yDip - rect.t) * scale);
    sx = Math.max(0, Math.min(width - 1, sx));
    sy = Math.max(0, Math.min(height - 1, sy));
    const i = (sy * width + sx) * 4;
    return [buf[i + 2], buf[i + 1], buf[i]];
  };
  return ys.map((y) => ({ y, row: cols.map((c) => ({ label: c.label, rgb: px(c.x, y) })) }));
}

function rgbHex(rgb) {
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}

async function run() {
  const scenario = process.argv[2] || 'all';
  const runS = (s) => scenario === 'all' || scenario === s;
  const results = {};
  const R = (k, o) => { results[k] = o; console.log('### ' + k + ' ' + JSON.stringify(o)); };

  // ===================== GEOM + THEME SEAM ==============================
  if (runS('geom')) {
    const app = await launchApp([], freshUserData('geom'));
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openPath(app, win, copySample('report.pdf', 'g1'));
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });
    await openPath(app, win, copySample('long.pdf', 'g2'));
    await openPath(app, win, copySample('scanned.pdf', 'g3'));
    await win.waitForTimeout(900);

    const perTheme = {};
    for (const theme of ['light', 'dark', 'frosted']) {
      await switchTheme(win, theme);
      await win.waitForTimeout(400);
      const geo = await measureGeometry(win);
      const active = geo.active;
      const main = geo.main;
      const strip = geo.hdr;
      // x sample columns: active centre, first inactive centre, last inactive
      // centre, a gap between two inactive tabs, and the far-right empty strip.
      const cols = [];
      if (active) cols.push({ label: 'active', x: Math.round(active.box.l + active.box.w / 2) });
      if (geo.firstInactive) cols.push({ label: 'inactive1', x: Math.round(geo.firstInactive.box.l + geo.firstInactive.box.w / 2) });
      if (geo.tabs.length > 2) {
        const a = geo.tabs[1].box, b = geo.tabs[2].box;
        cols.push({ label: 'gap12', x: Math.round((a.r + b.l) / 2) });
      }
      cols.push({ label: 'emptyStrip', x: Math.round(geo.list.r - 20) });
      const ys = [];
      if (strip && main) {
        for (let y = Math.floor(strip.b) - 2; y <= Math.ceil(main.t) + 1; y += 1) ys.push(y);
      }
      const cap = await capture(app, { l: 0, t: Math.min(...ys) - 0, w: geo.vw, h: (Math.max(...ys) - Math.min(...ys) + 1) });
      const grid = sampleGrid(cap, { l: 0, t: Math.min(...ys), w: geo.vw, h: 0 }, cols, ys);
      // collapse to hex rows for readability
      const hexGrid = grid.map((r) => ({
        y: r.y,
        cells: r.row.map((c) => `${c.label}=${rgbHex(c.rgb)}`),
      }));
      perTheme[theme] = {
        tabStyle: geo.tabStyle,
        hdrBottom: strip ? strip.b : null,
        mainTop: main ? main.t : null,
        activeBottom: active ? active.box.b : null,
        activeTop: active ? active.box.t : null,
        gapActiveToCanvas: active && main ? +(main.t - active.box.b).toFixed(2) : null,
        activeHeight: active ? active.box.h : null,
        inactiveHeight: geo.firstInactive ? geo.firstInactive.box.h : null,
        activeRadii: active ? [active.beforeTL, active.beforeTR, active.beforeBL, active.beforeBR] : null,
        inactiveRadii: geo.firstInactive ? [geo.firstInactive.beforeTL, geo.firstInactive.beforeTR, geo.firstInactive.beforeBL, geo.firstInactive.beforeBR] : null,
        afterContent: active ? active.afterContent : null,
        hdrBorderBottom: geo.hdrBorderBottom,
        titlebarBorderBottom: geo.titlebarBorderBottom,
        vars: geo.vars,
        mainBg: geo.mainBg,
        columns: cols.map((c) => `${c.label}@x${c.x}`),
        seamRows: hexGrid,
      };
      await win.screenshot({ path: path.join(SHOTS, `adv-p62-header-${theme}.png`) });
      await win.locator('.tab-area').screenshot({ path: path.join(SHOTS, `adv-p62-strip-${theme}.png`) }).catch(() => {});
    }
    await win.screenshot({ path: path.join(SHOTS, 'adv-p62-geom-full.png') });
    R('geom', perTheme);
    await app.close().catch(() => {});
  }

  // ===================== NARROW 640 + 8 TABS ===========================
  if (runS('narrow')) {
    const app = await launchApp([], freshUserData('narrow'));
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openPath(app, win, copySample('report.pdf', 'n1'));
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });
    // 8+ tabs: open two more real docs, then hammer the "+" button.
    await openPath(app, win, copySample('long.pdf', 'n2'));
    await openPath(app, win, copySample('scanned.pdf', 'n3'));
    for (let i = 0; i < 7; i++) {
      const plus = win.locator('[data-new-tab]');
      if ((await plus.count()) === 0) break;
      await plus.first().click({ timeout: 5000 }).catch(() => {});
      await win.waitForTimeout(60);
    }
    await win.waitForTimeout(1200);

    const measureNarrow = async (tag) => {
      const g = await measureGeometry(win);
      const area = g.area, hdr = g.hdr, main = g.main, active = g.active, list = g.list;
      const activeTabs = g.tabs.filter((t) => t.active);
      // vertical containment: is the whole active tab inside the header?
      const insideHeader = active && hdr
        ? active.box.t >= hdr.t - 0.5 && active.box.b <= hdr.b + 0.5
        : null;
      const insideArea = active && area
        ? active.box.t >= area.t - 0.5 && active.box.b <= area.b + 0.5
        : null;
      const activeInViewport = active
        ? active.box.l >= -1 && active.box.r <= g.vw + 1
        : null;
      const activeOnCanvasLine = active && main ? +(main.t - active.box.b).toFixed(2) : null;
      const distinctTops = new Set(g.tabs.map((t) => Math.round(t.box.t))).size;
      const distinctHeights = new Set(g.tabs.map((t) => Math.round(t.box.h))).size;
      const widths = g.tabs.map((t) => Math.round(t.box.w));
      const listEl = await win.evaluate(() => {
        const l = document.querySelector('.tab-list');
        const area = document.querySelector('.tab-area');
        const tabs = Array.from(document.querySelectorAll('[data-tab-id]')).map((t) => ({
          label: (t.querySelector('.tab-title') || {}).textContent || null,
          active: t.getAttribute('aria-selected') === 'true',
          w: Math.round(t.getBoundingClientRect().width),
          l: Math.round(t.getBoundingClientRect().left),
        }));
        return {
          listOffsetH: l ? l.offsetHeight : null,
          listClientH: l ? l.clientHeight : null,
          hScrollbarThickness: l ? l.offsetHeight - l.clientHeight : null,
          areaOffsetH: area ? area.offsetHeight : null,
          tabs,
        };
      });
      return {
        listOffsetH: listEl.listOffsetH,
        listClientH: listEl.listClientH,
        hScrollbarThickness: listEl.hScrollbarThickness,
        areaOffsetH: listEl.areaOffsetH,
        tabLabels: listEl.tabs,
        tag,
        vw: g.vw,
        tabCount: g.tabCount,
        activeId: active ? active.id : null,
        activeBox: active ? active.box : null,
        hdrBottom: hdr ? hdr.b : null,
        areaBottom: area ? area.b : null,
        areaTop: area ? area.t : null,
        mainTop: main ? main.t : null,
        activeBottom: active ? active.box.b : null,
        activeHeight: active ? active.box.h : null,
        activeInactiveHeights: g.tabs.map((t) => t.box.h.toFixed(1)),
        insideHeader,
        insideArea,
        activeInViewport,
        gapActiveToCanvas: activeOnCanvasLine,
        rowCount: distinctTops,
        distinctHeights,
        widthsMin: Math.min(...widths), widthsMax: Math.max(...widths),
        listScrollWidth: g.listScrollWidth,
        listClientWidth: g.listClientWidth,
        scrollOverflow: g.listScrollWidth - g.listClientWidth,
        activeWidth: active ? active.box.w : null,
        activeClippedLeftByArea: active && area ? +(area.l - active.box.l).toFixed(1) : null,
        activeClippedRightByArea: active && area ? +(active.box.r - area.r).toFixed(1) : null,
      };
    };

    const atDefault = await measureNarrow('default');
    await setWindowSize(app, 640, 720);
    await win.waitForTimeout(900);
    const at640 = await measureNarrow('640');
    // Attribution: does the 10px foot gap come from the Phase 62 height rule,
    // or from a pre-existing native horizontal scrollbar? Override the Phase 62
    // rule back to the pre-phase value in-page and re-measure the gap.
    const prePhase62 = await win.evaluate(() => {
      const s = document.createElement('style');
      s.id = 'adv-p62-revert';
      s.textContent = '.tab-area[data-tab-style="colorful"]{height:100%!important;margin-bottom:0!important;align-self:auto!important;}';
      document.head.appendChild(s);
      const l = document.querySelector('.tab-list');
      const a = document.querySelector('.tab-area');
      const t = document.querySelector('[data-tab-id][aria-selected="true"]');
      const main = document.querySelector('.app-main');
      return {
        hScrollbarThickness: l ? l.offsetHeight - l.clientHeight : null,
        areaH: a ? a.offsetHeight : null,
        activeBottom: t ? t.getBoundingClientRect().bottom : null,
        mainTop: main ? main.getBoundingClientRect().top : null,
        gap: t && main ? +(main.getBoundingClientRect().top - t.getBoundingClientRect().bottom).toFixed(2) : null,
      };
    });
    await win.evaluate(() => { const s = document.getElementById('adv-p62-revert'); if (s) s.remove(); });
    await win.screenshot({ path: path.join(SHOTS, 'adv-p62-narrow-640.png') });
    // try to interact with the active tab (click) to prove reachability
    let clickOk = null;
    try {
      const id = at640.activeId;
      await win.locator(`[data-tab-id="${id}"]`).click({ timeout: 3000 });
      clickOk = true;
    } catch (e) { clickOk = 'ERR:' + String(e.message).split('\n')[0]; }
    // active tab's right edge vs window at 640
    await setWindowSize(app, 900, 800);
    await win.waitForTimeout(700);
    const at900 = await measureNarrow('900');
    R('narrow', { atDefault, at640, at900, prePhase62, clickOk });
    await app.close().catch(() => {});
  }

  // ===================== STANDARD STYLE ================================
  if (runS('standard')) {
    const app = await launchApp([], freshUserData('standard'));
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openPath(app, win, copySample('report.pdf', 's1'));
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });
    await openPath(app, win, copySample('long.pdf', 's2'));
    await win.waitForTimeout(700);
    await win.locator('[data-open-preferences]').first().click({ timeout: 8000 });
    await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
    await win.locator('[data-prefs-tab-style]').selectOption('standard');
    await win.waitForTimeout(500);
    await win.locator('[data-prefs-dialog] .sheet-close').first().click();
    await win.waitForSelector('[data-prefs-dialog]', { state: 'hidden', timeout: 10000 });
    await win.waitForTimeout(500);
    const g = await measureGeometry(win);
    const active = g.active;
    const result = {
      tabStyle: g.tabStyle,
      activeHeight: active ? active.box.h : null,
      inactiveHeight: g.firstInactive ? g.firstInactive.box.h : null,
      afterContent: active ? active.afterContent : null,
      activeAfterWidth: active ? await win.evaluate(() => {
        const t = document.querySelector('[data-tab-id][aria-selected="true"]');
        const a = getComputedStyle(t, '::after');
        return { content: a.content, height: a.height, background: a.backgroundColor };
      }) : null,
      gapActiveToCanvas: active && g.main ? +(g.main.t - active.box.b).toFixed(2) : null,
      activeRadiiBefore: active ? [active.beforeTL, active.beforeTR, active.beforeBL, active.beforeBR] : null,
    };
    await win.screenshot({ path: path.join(SHOTS, 'adv-p62-standard.png') });
    // magnified strip
    await win.evaluate(() => {
      const area = document.querySelector('.tab-area');
      area.style.transformOrigin = 'top left';
      area.style.transform = 'scale(4)';
    });
    await win.waitForTimeout(300);
    await win.locator('.tab-area').screenshot({ path: path.join(SHOTS, 'adv-p62-standard-zoom4.png') }).catch(() => {});
    await win.evaluate(() => {
      const area = document.querySelector('.tab-area');
      area.style.transform = '';
      area.style.transformOrigin = '';
    });
    R('standard', result);
    await app.close().catch(() => {});
  }

  // ===================== MOTION / REDUCED ==============================
  if (runS('motion')) {
    const app = await launchApp([], freshUserData('motion'));
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openPath(app, win, copySample('report.pdf', 'm1'));
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });

    const readMotion = () => win.evaluate(() => {
      const t = document.querySelector('.tab-area[data-tab-style="colorful"] .tab');
      const cs = t ? getComputedStyle(t) : null;
      const before = t ? getComputedStyle(t, '::before') : null;
      const live = document.getAnimations().map((a) => ({
        name: (a.animationName || (a.effect && a.effect.getKeyframes && 'transition') || 'transition'),
        target: a.effect && a.effect.target ? (a.effect.target.className || a.effect.target.tagName) : null,
        playState: a.playState,
      })).filter((a) => String(a.target).includes('tab'));
      return {
        animationsOffAttr: document.documentElement.getAttribute('data-animations'),
        tabTransitionProperty: cs ? cs.transitionProperty : null,
        tabTransitionDuration: cs ? cs.transitionDuration : null,
        beforeTransition: before ? before.transitionDuration : null,
        beforeRadiusTransition: before ? before.transitionProperty : null,
        liveTabAnimations: live,
        allAnimationCount: document.getAnimations().length,
      };
    });

    const atRest = await readMotion();
    // Emulate reduced motion at the media level.
    await win.emulateMedia({ reducedMotion: 'reduce' }).catch(() => {});
    await win.waitForTimeout(300);
    const reduced = await readMotion();
    // Also set the app's Animations-OFF hook and re-render tabs by opening a 2nd doc.
    await win.evaluate(() => document.documentElement.setAttribute('data-animations', 'off'));
    await win.waitForTimeout(200);
    const animOff = await readMotion();
    // Render (open) a new tab while Animations OFF, then immediately sample
    // the live animation list to prove no tab motion is introduced.
    await openPath(app, win, copySample('long.pdf', 'm2'));
    const duringRender = await readMotion();
    await win.waitForTimeout(800);
    const afterSettle = await readMotion();
    // And a tab switch.
    const tabs = win.locator('[data-tab-id]');
    await tabs.nth(0).click({ timeout: 4000 }).catch(() => {});
    const duringSwitch = await readMotion();
    R('motion', { atRest, reduced, animOff, duringRender, afterSettle, duringSwitch });
    await app.close().catch(() => {});
  }

  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
  console.log('### DONE');
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
