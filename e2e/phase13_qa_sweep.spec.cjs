// Phase 13 QA sweep — design-comparison screenshots + CONTROL-INDEX control
// verification through the real running Electron app.
//
// Screenshots land in screenshots/phase13-qa-*.png. Every Phase-13
// CONTROL-INDEX control is exercised here: titlebar drag region, window
// controls (minimize / maximize+restore glyph / close), settings gear,
// menu popover, theme toggle + light tokens, icon-only toolbar sweep,
// hand (pan) mode, rotate-ccw, More (ellipsis) palette toggle, accent
// re-point (#2563eb), thumbnail selection ring, emoji scan.
//
// Launches ONLY through e2e/lib/launch.cjs (canonical launcher).

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Emoji/symbol ranges that must not appear in a proper icon-set UI.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

async function setTheme(win, want) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${want}"]`);
  await win.waitForFunction(
    (w) => document.documentElement.getAttribute('data-theme') === w,
    want,
    { timeout: 5000 },
  );
}

async function openReport(electronApp, win) {
  const p = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, p);
  await win.locator('.header-actions .btn-primary').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .pdf-page canvas', { timeout: 30000 });
  await wait(2000);
}

// Full drag-region map of the title bar, transitive through the DOM
// (same ground-truth method as the DEF-132 retest).
async function dragRegionMap(win) {
  return win.evaluate(() => {
    const bar = document.querySelector('.titlebar');
    if (!bar) return null;
    const b = bar.getBoundingClientRect();
    const pointIsDrag = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (el === null) return false;
      let cur = el;
      while (cur && cur !== document.documentElement) {
        const reg = getComputedStyle(cur).webkitAppRegion;
        if (reg === 'no-drag') return false;
        if (reg === 'drag') return true;
        cur = cur.parentElement;
      }
      return false;
    };
    let dragPx = 0;
    let noDragPx = 0;
    const step = 4;
    for (let y = b.top + 2; y < b.bottom - 2; y += step) {
      for (let x = b.left + 2; x < b.right - 2; x += step) {
        if (pointIsDrag(x, y)) dragPx += step * step;
        else noDragPx += step * step;
      }
    }
    // Draggable x positions at bar mid-height (for the real drag attempt).
    const draggableXs = [];
    for (let x = b.left + 4; x < b.right - 4; x += 8) {
      if (pointIsDrag(x, b.top + b.height / 2)) draggableXs.push(Math.round(x));
    }
    const noDragControls = ['[data-window-minimize]', '[data-window-maximize]', '[data-window-close]', '[data-menu-button]', '.header-gear', '[data-theme-toggle]', '.header-actions .btn-primary']
      .filter((s) => {
        const el = document.querySelector(s);
        return el && getComputedStyle(el).webkitAppRegion === 'no-drag';
      });
    return {
      barRect: { x: b.x, y: b.y, width: Math.round(b.width), height: Math.round(b.height) },
      barRegion: getComputedStyle(bar).webkitAppRegion,
      dragPx,
      noDragPx,
      dragFrac: dragPx / Math.max(1, b.width * b.height),
      draggableXs,
      noDragControls,
    };
  });
}

// ---------- Test 1: frameless launch, welcome (light), drag region, window controls, gear, menu ----------
test('P13-QA: frameless launch + drag region + window controls + gear + menu', async () => {
  test.setTimeout(180000);
  const t0 = Date.now();
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setSize(1440, 900);
  });
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  console.log(`[cold] welcome interactive in ${Date.now() - t0}ms`);

  const errors = [];
  win.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  // --- Frameless + drag region ---
  const tb = win.locator('.titlebar').first();
  await expect(tb).toBeVisible();
  expect(await tb.getAttribute('data-titlebar')).toBe('true');
  const region = await dragRegionMap(win);
  console.log(`[region] ${JSON.stringify(region)}`);
  expect(region, 'titlebar region map must resolve').not.toBeNull();
  expect(region.barRegion, '.titlebar carries -webkit-app-region: drag').toBe('drag');
  expect(region.dragPx, 'a real draggable caption surface exists').toBeGreaterThan(0);
  expect(region.dragFrac, 'a meaningful fraction of the bar is draggable').toBeGreaterThan(0.05);
  expect(
    region.noDragControls,
    'window controls + menu + gear + theme + Open must opt out of drag',
  ).toEqual(expect.arrayContaining(['[data-window-minimize]', '[data-window-maximize]', '[data-window-close]', '[data-menu-button]', '.header-gear', '[data-theme-toggle]', '.header-actions .btn-primary']));

  // --- Default theme welcome (record which theme ships) ---
  const theme0 = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log(`[theme] default theme at boot = ${theme0}`);
  await wait(900);
  await win.screenshot({ path: path.join(SHOTS, 'phase13-qa-00-welcome-default.png') });

  // --- Welcome, light theme (design reference is a light workspace) ---
  await setTheme(win, 'light');
  await wait(900);
  const lightTokens = await win.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      bgBase: cs.getPropertyValue('--bg-base').trim(),
      accent: cs.getPropertyValue('--accent').trim(),
      htmlBg: getComputedStyle(document.documentElement).backgroundColor,
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });
  console.log(`[light-tokens] ${JSON.stringify(lightTokens)}`);
  expect(['#fff', '#ffffff'], 'light --bg-base must be white').toContain(lightTokens.bgBase.toLowerCase());
  expect(lightTokens.htmlBg, 'html must paint the base color (DEF-083)').toBe('rgb(255, 255, 255)');
  await win.screenshot({ path: path.join(SHOTS, 'phase13-qa-01-welcome-light.png') });

  // Title bar close-up (light)
  await win.locator('.titlebar').first().screenshot({ path: path.join(SHOTS, 'phase13-qa-04-titlebar-closeup.png') });

  // --- Minimize / restore ---
  await win.click('[data-window-minimize]');
  let minimized = false;
  for (let i = 0; i < 20 && !minimized; i += 1) {
    await wait(250);
    minimized = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized());
  }
  console.log(`[min] isMinimized=${minimized}`);
  expect(minimized, 'minimize control must minimize the window').toBe(true);
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
  for (let i = 0; i < 20; i += 1) {
    await wait(250);
    if (!(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()))) break;
  }
  expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);
  await expect(win.locator('.sample-card').first()).toBeVisible();

  // --- Maximize / restore + caption glyph swap ---
  const maxBtn = win.locator('[data-window-maximize]');
  const minSvg = await win.locator('[data-window-minimize] svg').first().evaluate((el) => el.outerHTML);
  const maxSvgBefore = await maxBtn.locator('svg').first().evaluate((el) => el.outerHTML);
  expect(await maxBtn.getAttribute('aria-label')).toBe('Maximize window');
  await maxBtn.click();
  let maximized = false;
  for (let i = 0; i < 20 && !maximized; i += 1) {
    await wait(250);
    maximized = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
  }
  console.log(`[max] isMaximized=${maximized}`);
  expect(maximized, 'maximize control must maximize the window').toBe(true);
  // The maximized flag reaches the renderer through the settings geometry
  // echo, debounced ~300ms in main (GEOMETRY_DEBOUNCE_MS). Poll for the
  // caption flip instead of reading it in the same tick as isMaximized.
  let maxSvgAfter = null;
  let maxLabelAfter = null;
  for (let i = 0; i < 16; i += 1) {
    await wait(250);
    maxLabelAfter = await maxBtn.getAttribute('aria-label');
    if (maxLabelAfter === 'Restore window') {
      maxSvgAfter = await maxBtn.locator('svg').first().evaluate((el) => el.outerHTML);
      break;
    }
    if (i === 15) maxSvgAfter = await maxBtn.locator('svg').first().evaluate((el) => el.outerHTML);
  }
  console.log(`[max] glyph-swapped=${maxSvgBefore !== maxSvgAfter} label=${maxLabelAfter}`);
  // HARD assertion for this flip lives in e2e/retests/def180_maximize_glyph.spec.cjs
  // (DEF-180): the caption flip breaks after any renderer settings write. Here
  // we record the observed state and continue so the rest of the chrome
  // evidence (drag, gear, menu) is captured in the same run.
  if (maxLabelAfter !== 'Restore window') {
    console.log('[max] DEF-180 REPRODUCED in sweep: maximized caption did not flip (settings write preceded). See DEF-180.');
  }
  expect(maxSvgBefore, 'maximize glyph must differ from minimize glyph (DEF-119)').not.toBe(minSvg);
  await win.locator('.titlebar').first().screenshot({ path: path.join(SHOTS, 'phase13-qa-08-titlebar-maximized.png') });
  await maxBtn.click();
  let restoredLabel = null;
  for (let i = 0; i < 16; i += 1) {
    await wait(250);
    if (!(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()))) {
      restoredLabel = await maxBtn.getAttribute('aria-label');
      if (restoredLabel === 'Maximize window') break;
    }
  }
  console.log(`[max] restored label=${restoredLabel} isMaximized=false`);

  // --- Drag-to-move attempt on a draggable caption point ---
  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isMaximized()) w.unmaximize();
    w.setBounds({ x: 100, y: 100, width: 1440, height: 900 });
  });
  await wait(600);
  const region2 = await dragRegionMap(win);
  const before = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  if (region2.draggableXs.length > 0) {
    const px = region2.draggableXs[Math.floor(region2.draggableXs.length / 2)];
    const py = region2.barRect.y + Math.floor(region2.barRect.height / 2);
    await win.mouse.move(px, py);
    await win.mouse.down();
    for (let i = 1; i <= 12; i += 1) {
      await win.mouse.move(px + i * 12, py + i * 5);
      await wait(30);
    }
    await win.mouse.up();
    await wait(600);
  }
  const after = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  console.log(`[drag] synthetic-input drag delta: dx=${dx} dy=${dy} (window started at x=${before.x}, y=${before.y})`);
  console.log(`[drag] NOTE: -webkit-app-region drags are processed by Chromium's native input path; synthetic CDP input may not move the window. Region map is the structural proof.`);

  // --- Settings gear opens Preferences ---
  await win.click('[data-open-preferences]');
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 5000 });
  await expect(win.locator('[data-prefs-dialog]')).toBeVisible();
  await wait(500);
  await win.locator('[data-prefs-dialog]').screenshot({ path: path.join(SHOTS, 'phase13-qa-06-preferences-gear.png') });
  await win.locator('.sheet-close').click();
  await expect(win.locator('[data-prefs-dialog]')).toBeHidden({ timeout: 5000 });
  console.log('[gear] Preferences sheet opened via gear and closed');

  // --- Menu button popover ---
  const menuBtn = win.locator('.titlebar-menu-button');
  await menuBtn.click();
  await win.waitForSelector('[data-menu-popover]', { timeout: 5000 });
  const rows = await win.locator('[data-menu-popover] [data-menu-action]').count();
  console.log(`[menu] popover rows=${rows}`);
  expect(rows, 'menu popover must expose the menu actions').toBeGreaterThan(5);
  expect(await menuBtn.getAttribute('aria-expanded')).toBe('true');
  await win.locator('[data-menu-popover]').screenshot({ path: path.join(SHOTS, 'phase13-qa-09-menu-popover.png') });
  await win.keyboard.press('Escape');
  await expect(win.locator('[data-menu-popover]')).toBeHidden({ timeout: 3000 });
  expect(await menuBtn.getAttribute('aria-expanded')).toBe('false');

  console.log(`[errors] ${errors.length}: ${JSON.stringify(errors.slice(0, 5))}`);
  expect(errors, 'no page errors during the chrome sweep').toEqual([]);
  await hardClose(electronApp, 'p13-chrome');
});

// ---------- Test 2: close control quits the app ----------
test('P13-QA: window close control quits the app', async () => {
  test.setTimeout(90000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.click('[data-window-close]');
  let drained = false;
  for (let i = 0; i < 40; i += 1) {
    await wait(250);
    try {
      const n = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
      if (n === 0) { drained = true; break; }
    } catch { drained = true; break; } // CDP gone = process exiting
  }
  console.log(`[close] windows drained after close click = ${drained}`);
  expect(drained, 'close control must close the window (app quits)').toBe(true);
  await hardClose(electronApp, 'p13-close');
});

// ---------- Test 3: workspace light + toolbar sweep + hand pan + rotate + accent ----------
test('P13-QA: workspace light + icon-only toolbar sweep + hand pan + rotate + accent', async () => {
  test.setTimeout(180000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setSize(1440, 900);
  });
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const errors = [];
  win.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  await setTheme(win, 'light');
  await openReport(electronApp, win);

  await win.screenshot({ path: path.join(SHOTS, 'phase13-qa-02-workspace-light.png') });
  await win.locator('.toolbar').first().screenshot({ path: path.join(SHOTS, 'phase13-qa-05-toolbar-closeup.png') });
  await win.locator('.ann-toolbar').first().screenshot({ path: path.join(SHOTS, 'phase13-qa-07-annotation-toolbar-closeup.png') });

  // --- Icon-only toolbar sweep: every button named, no text labels ---
  const sweep = await win.evaluate(() => {
    const scan = (scope) => Array.from(document.querySelectorAll(`${scope} .tool-btn, ${scope} button`)).filter((b, i, arr) => arr.indexOf(b) === i).map((b) => ({
      label: b.getAttribute('aria-label'),
      title: b.getAttribute('title'),
      hasTextSpan: b.querySelector('.tool-btn-label, .btn-label') !== null,
      innerText: (b.innerText || '').trim(),
    }));
    return {
      toolbar: scan('.toolbar'),
      annToolbar: scan('.ann-toolbar'),
      editToolbar: scan('.edit-toolbar'),
      labelSpans: document.querySelectorAll('.tool-btn-label').length,
    };
  });
  console.log(`[toolbar] main buttons (${sweep.toolbar.length}): ${JSON.stringify(sweep.toolbar.map((b) => b.label))}`);
  console.log(`[ann] buttons (${sweep.annToolbar.length}): ${JSON.stringify(sweep.annToolbar.map((b) => b.label))}`);
  console.log(`[edit] buttons (${sweep.editToolbar.length}): ${JSON.stringify(sweep.editToolbar.map((b) => b.label))}`);
  for (const b of [...sweep.toolbar, ...sweep.annToolbar]) {
    expect(b.label, 'every toolbar button must have an aria-label').toBeTruthy();
    expect(b.title, 'every toolbar button must have a title tooltip').toBeTruthy();
    expect(b.hasTextSpan, 'icon-only: no text label spans').toBe(false);
  }
  expect(sweep.labelSpans, 'no .tool-btn-label text spans may exist').toBe(0);

  // --- Emoji scan across visible text + tooltips ---
  const emojiScan = await win.evaluate(() => {
    const re = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
    const hits = [];
    const text = document.body.innerText || '';
    for (const ch of text) if (re.test(ch)) hits.push(`body:"${ch}" U+${ch.codePointAt(0).toString(16)}`);
    document.querySelectorAll('[title],[aria-label]').forEach((el) => {
      for (const attr of ['title', 'aria-label']) {
        const v = el.getAttribute(attr) || '';
        for (const ch of v) if (re.test(ch)) hits.push(`${attr}:"${ch}"`);
      }
    });
    return hits;
  });
  console.log(`[emoji] hits=${JSON.stringify(emojiScan)}`);
  expect(emojiScan, 'no emoji characters anywhere in the chrome').toEqual([]);

  // --- Hand (pan) mode: arm, drag pans, Escape exits ---
  await win.click('[data-hand-toggle]');
  await wait(400);
  const handState = await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    return {
      hand: sc ? sc.getAttribute('data-hand') : null,
      cursor: sc ? getComputedStyle(sc).cursor : null,
      pressed: document.querySelector('[data-hand-toggle]')?.getAttribute('aria-pressed'),
    };
  });
  console.log(`[hand] armed: ${JSON.stringify(handState)}`);
  expect(handState.hand).toBe('true');
  expect(handState.cursor).toBe('grab');
  expect(handState.pressed).toBe('true');
  await win.screenshot({ path: path.join(SHOTS, 'phase13-qa-10-hand-armed.png') });
  const scrollerBox = await win.locator('.document-scroller').first().boundingBox();
  const scrollBefore = await win.evaluate(() => document.querySelector('.document-scroller').scrollTop);
  await win.mouse.move(scrollerBox.x + scrollerBox.width / 2, scrollerBox.y + scrollerBox.height / 2);
  await win.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await win.mouse.move(scrollerBox.x + scrollerBox.width / 2, scrollerBox.y + scrollerBox.height / 2 - i * 25);
    await wait(30);
  }
  await win.mouse.up();
  await wait(400);
  const scrollAfter = await win.evaluate(() => document.querySelector('.document-scroller').scrollTop);
  console.log(`[hand] scrollTop ${scrollBefore} -> ${scrollAfter}`);
  expect(scrollAfter, 'dragging in pan mode must scroll the document').toBeGreaterThan(scrollBefore);
  await win.keyboard.press('Escape');
  await wait(400);
  const handOff = await win.evaluate(() => ({
    hand: document.querySelector('.document-scroller')?.getAttribute('data-hand'),
    pressed: document.querySelector('[data-hand-toggle]')?.getAttribute('aria-pressed'),
  }));
  console.log(`[hand] after Escape: ${JSON.stringify(handOff)}`);
  expect(handOff.hand).not.toBe('true');
  expect(handOff.pressed).toBe('false');

  // --- Rotate counter-clockwise changes the engine rotation ---
  const rotBefore = await win.evaluate(() => (window.tflexDiagnostics().engineState.rotations || []).slice(0, 4));
  await win.click('[data-toolbar-rotate-ccw]');
  await wait(1200);
  const rotAfter = await win.evaluate(() => (window.tflexDiagnostics().engineState.rotations || []).slice(0, 4));
  console.log(`[rotate-ccw] before=${JSON.stringify(rotBefore)} after=${JSON.stringify(rotAfter)}`);
  expect(JSON.stringify(rotAfter), 'rotate-ccw must apply the rotation op').not.toBe(JSON.stringify(rotBefore));
  // Undo the rotation to leave a clean doc state.
  await win.keyboard.press('Control+z');
  await wait(600);

  // --- More (ellipsis) opens the Tools palette ---
  await win.click('[data-tools-toggle]');
  await wait(500);
  const palette = await win.evaluate(() => {
    const el = document.querySelector('.tools-palette, [data-tools-palette]');
    return el ? { visible: el.offsetParent !== null, cls: el.className } : null;
  });
  console.log(`[more] palette: ${JSON.stringify(palette)}`);
  expect(palette, 'More (ellipsis) must open the Tools palette').not.toBeNull();
  await win.keyboard.press('Escape');
  await wait(300);

  // --- Single accent rule: --accent + Open button + active tool + thumb ring ---
  const accent = await win.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const open = document.querySelector('.header-actions .btn-primary');
    const openStyle = open ? getComputedStyle(open) : null;
    return {
      accent: cs.getPropertyValue('--accent').trim(),
      openBg: openStyle ? openStyle.backgroundColor : null,
    };
  });
  console.log(`[accent] ${JSON.stringify(accent)}`);
  expect(accent.accent.toLowerCase()).toBe('#2563eb');
  expect(accent.openBg).toBe('rgb(37, 99, 235)');

  await win.click('[data-tool="highlight"]');
  await wait(400);
  // Move the pointer off the toolbar first: the resting :hover wash
  // (specificity 0-3-0) otherwise masks the active accent wash.
  await win.mouse.move(720, 400);
  await wait(300);
  const activeTool = await win.evaluate(() => {
    const btn = document.querySelector('.ann-toolbar .tool-btn-active');
    const s = btn ? getComputedStyle(btn) : null;
    return btn ? { tool: btn.getAttribute('data-tool'), color: s.color, bg: s.backgroundColor, border: s.borderColor } : null;
  });
  console.log(`[accent] active tool (pointer moved away): ${JSON.stringify(activeTool)}`);
  expect(activeTool, 'arming Highlight must leave an active tool button').not.toBeNull();
  expect(activeTool.bg, 'armed tool wash must be the accent-selected blue').toContain('37, 99, 235');
  const thumbRing = await win.evaluate(() => {
    const t = document.querySelector('.thumb-current');
    return t ? getComputedStyle(t).boxShadow : null;
  });
  console.log(`[accent] thumb-current boxShadow: ${thumbRing}`);
  expect(thumbRing, 'thumbnail selection ring uses the accent').toContain('37, 99, 235');

  // Annotation close-up with an armed accent tool (color evidence in shot)
  await win.locator('.ann-toolbar').first().screenshot({ path: path.join(SHOTS, 'phase13-qa-07-annotation-toolbar-closeup.png') });

  // --- Edit toolbar icon-only (CONTROL-INDEX row): Off / Edit text / Add box / Image ---
  await win.click('[data-toolbar-edit-toggle]');
  await wait(600);
  const editSweep = await win.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.edit-toolbar button')).map((b) => ({
      label: b.getAttribute('aria-label'),
      tool: b.getAttribute('data-edit-tool'),
      innerText: (b.innerText || '').trim(),
    }));
    return { btns, labelSpans: document.querySelectorAll('.edit-toolbar .tool-btn-label').length };
  });
  console.log(`[edit-toolbar] ${JSON.stringify(editSweep.btns)} labelSpans=${editSweep.labelSpans}`);
  expect(editSweep.btns.length, 'edit toolbar must render its tools').toBeGreaterThanOrEqual(3);
  for (const b of editSweep.btns) {
    expect(b.label, 'every edit-toolbar button must be named').toBeTruthy();
    expect(b.innerText, 'edit toolbar buttons are icon-only').toBe('');
  }
  expect(editSweep.labelSpans).toBe(0);
  await win.locator('.edit-toolbar').first().screenshot({ path: path.join(SHOTS, 'phase13-qa-11-edit-toolbar-closeup.png') });
  await win.click('[data-toolbar-edit-toggle]'); // close edit mode
  await wait(400);

  console.log(`[errors] ${errors.length}: ${JSON.stringify(errors.slice(0, 5))}`);
  expect(errors, 'no page errors during the workspace sweep').toEqual([]);
  await hardClose(electronApp, 'p13-workspace');
});

// ---------- Test 4: dark theme workspace + theme tokens ----------
test('P13-QA: workspace dark + both-theme tokens', async () => {
  test.setTimeout(180000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setSize(1440, 900);
  });
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const errors = [];
  win.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  await setTheme(win, 'dark');
  await openReport(electronApp, win);
  await wait(800);
  await win.screenshot({ path: path.join(SHOTS, 'phase13-qa-03-workspace-dark.png') });
  const darkBg = await win.evaluate(() => ({
    dataTheme: document.documentElement.getAttribute('data-theme'),
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }));
  console.log(`[dark-bg] ${JSON.stringify(darkBg)}`);
  expect(darkBg.dataTheme).toBe('dark');

  // Back to light: html/body must read white (DEF-083 contract).
  await setTheme(win, 'light');
  const lightBg = await win.evaluate(() => ({
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }));
  console.log(`[light-bg] ${JSON.stringify(lightBg)}`);
  expect(lightBg.htmlBg).toBe('rgb(255, 255, 255)');
  expect(lightBg.bodyBg).toBe('rgb(255, 255, 255)');

  // Update indicator semantic color (DEF-082) if the chip is present.
  const upd = await win.evaluate(() => {
    const el = document.querySelector('.update-indicator');
    if (!el) return null;
    const s = getComputedStyle(el);
    return { cls: el.className, bg: s.backgroundColor, color: s.color, border: s.borderColor };
  });
  console.log(`[update-indicator] ${JSON.stringify(upd)}`);

  console.log(`[errors] ${errors.length}: ${JSON.stringify(errors.slice(0, 5))}`);
  expect(errors, 'no page errors during the theme sweep').toEqual([]);
  await hardClose(electronApp, 'p13-dark');
});