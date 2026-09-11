// QA VISUAL VERIFICATION - frosted glass theme correction (light acrylic
// direction), toolbox consistency, and text-first Word export.
// Dispatch acceptance:
//   1. Frosted must look like REAL glass (translucent 0.62-0.85 + blur
//      22px/24px saturate 130% + inner shadows + sheen), NOT a flat light theme.
//   2. Dark / Light / Frosted each verified; side-by-side evidence.
//   3. All toolboxes share the unified sticky-note pattern (grip == body
//      width + action bar) with matching drag bar widths.
//   4. Export to Word produces EDITABLE text (DEF-060 / DEF-177 contract).
// Canonical launcher, dev build (no executablePath). Screenshots -> screenshots/.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { launchApp, getSamplePath } = require('./../lib/launch.cjs');
const { hardClose } = require('./../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

let electronApp = null;
let win = null;
let rendererErrors = [];

function snap(name) {
  return win.screenshot({ path: path.join(SHOTS, name) });
}

function attachErrorCollectors(window) {
  window.on('pageerror', (err) => rendererErrors.push(`pageerror: ${err.message}`));
  window.on('console', (msg) => {
    if (msg.type() === 'error') rendererErrors.push(`console.error: ${msg.text()}`);
  });
}

function parseRgba(str) {
  const m = /rgba?\(([^)]+)\)/.exec(str || '');
  if (!m) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

async function setThemeViaDropdown(want) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${want}"]`);
  await win.waitForFunction(
    (w) => document.documentElement.getAttribute('data-theme') === w,
    want,
  );
}

async function openPalette() {
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(500);
}

async function openReport() {
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(2500);
}

/** Computed material facts for a chrome element. */
async function materialOf(selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const after = getComputedStyle(el, '::after');
    return {
      selector: sel,
      bg: cs.backgroundColor,
      backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
      boxShadow: cs.boxShadow,
      afterAnim: after.animationName,
      afterDur: after.animationDuration,
    };
  }, selector);
}

async function openMenuAndCheck() {
  await win.click('[data-menu-button]');
  await win.waitForSelector('[data-menu-popover]', { timeout: 5000 });
  await win.waitForTimeout(400);
  const facts = await win.evaluate(() => {
    const el = document.querySelector('[data-menu-popover], .titlebar-menu-popover');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter };
  });
  await snap('qa-glass-menu-frosted.png');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  return facts;
}

/* ========================================================================== */
test.describe.serial('qa frosted-glass visual verification (light acrylic redesign)', () => {
  test.afterEach(async () => {
    await hardClose(electronApp);
    electronApp = null;
    win = null;
    rendererErrors = [];
  });

  test('GLASS: frosted material contract + welcome/workspace/palette evidence', async () => {
    test.setTimeout(420000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    attachErrorCollectors(win);
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(800);

    const theme = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme, 'fresh launch must resolve to frosted').toBe('frosted');
    await snap('qa-glass-welcome-frosted.png');

    // Welcome chrome: the header must already be glass (blur + translucent).
    const headerMat = await materialOf('.app-header');
    console.log('[glass] welcome .app-header =', JSON.stringify(headerMat));
    expect(headerMat, 'app-header must exist on welcome').not.toBeNull();
    expect(headerMat.backdropFilter, 'welcome header must carry the acrylic blur').toContain('blur');
    const hAlpha = parseRgba(headerMat.bg).a;
    expect(hAlpha, 'welcome header sheet must sit in the 0.60-0.86 translucent band').toBeGreaterThanOrEqual(0.6);
    expect(hAlpha).toBeLessThanOrEqual(0.86);

    // Open the report and capture the full workspace with the palette open.
    await openReport();
    await openPalette();
    await win.waitForTimeout(400);
    await snap('qa-glass-workspace-frosted.png');

    // ---- The glass ladder: every chrome sheet translucent + blurred ------
    const selectors = ['.titlebar', '.app-header', '.toolbar', '.ann-toolbar', '.side-rail', '.tools-palette'];
    const mats = [];
    for (const sel of selectors) mats.push(await materialOf(sel));
    console.log('[glass] frosted ladder:\n' + mats.map((m) => `  ${JSON.stringify(m)}`).join('\n'));
    for (const m of mats) {
      expect(m, `${m.selector} must exist`).not.toBeNull();
      const a = parseRgba(m.bg).a;
      expect(a, `${m.selector} must be translucent (>=0.60)`).toBeGreaterThanOrEqual(0.6);
      expect(a, `${m.selector} must stay see-through enough for glass (<=0.86)`).toBeLessThanOrEqual(0.86);
      expect(m.backdropFilter, `${m.selector} must blur what is behind it`).toContain('blur');
      expect(m.backdropFilter, `${m.selector} blur must be the heavy 22px glass blur`).toContain('22px');
      expect(m.backdropFilter, `${m.selector} must saturate through the glass`).toContain('saturate');
      // .app-header is a strip INSIDE the .titlebar pane and carries no
      // inner shadow of its own; every real pane does.
      if (m.selector !== '.app-header') {
        expect(m.boxShadow, `${m.selector} must carry inner shadows (glass thickness)`).toContain('inset');
      }
    }

    // The 0.62 frame -> 0.85 dialog hierarchy (depth through opacity).
    const frameA = parseRgba(mats[0].bg).a;
    const panelA = parseRgba(mats[5].bg).a;
    expect(panelA, 'the floating tools sheet must be MORE opaque than the frame (depth)').toBeGreaterThan(frameA);

    // Moving reflection on the big chrome sheets.
    for (const sel of ['.toolbar', '.side-rail', '.tools-palette']) {
      const m = await materialOf(sel);
      expect(m.afterAnim, `${sel}::after must run the acrylic-sheen sweep`).toBe('acrylic-sheen');
      expect(parseFloat(m.afterDur), `${sel} sheen must be slow (>=7s)`).toBeGreaterThanOrEqual(7);
    }

    // Menu popover: blur(24px) + 0.80 sheet.
    const menu = await openMenuAndCheck();
    console.log('[glass] menu popover =', JSON.stringify(menu));
    expect(menu, 'menu popover must exist').not.toBeNull();
    expect(menu.backdropFilter, 'menu popover must carry the 24px popover blur').toContain('24px');
    const menuA = parseRgba(menu.bg).a;
    expect(menuA, 'menu sheet alpha in the 0.78-0.86 band').toBeGreaterThanOrEqual(0.78);
    expect(menuA).toBeLessThanOrEqual(0.86);

    // PDF purity: the page itself stays untouched glass-exempt.
    const purity = await win.evaluate(() => {
      const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
      const page = pane ? pane.querySelector('.pdf-page') : null;
      const ws = pane ? pane.querySelector('.workspace-main') : null;
      const out = {};
      if (page) {
        const cs = getComputedStyle(page);
        out.page = { bg: cs.backgroundColor, blur: cs.backdropFilter || cs.webkitBackdropFilter, filter: cs.filter };
      }
      if (ws) out.ws = { bg: getComputedStyle(ws).backgroundColor, blur: getComputedStyle(ws).backdropFilter };
      return out;
    });
    const pageBg = parseRgba(purity.page.bg);
    expect(pageBg, 'pdf page stays paper-white').toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(purity.page.blur, 'NO blur on the pdf page').toBe('none');
    expect(purity.page.filter, 'no filter on the pdf page').toBe('none');
    const wsBg = parseRgba(purity.ws.bg);
    expect(wsBg.a, 'workspace stays solid behind the page').toBe(1);
    expect(wsBg.r > 200 && wsBg.g > 200 && wsBg.b > 200, 'workspace is the light frosted base').toBe(true);

    // Close-up of the palette edge (glass depth over the workspace).
    const pal = await win.locator('[data-tools-palette]').boundingBox();
    if (pal) {
      await win.screenshot({
        path: path.join(SHOTS, 'qa-glass-palette-closeup-frosted.png'),
        clip: { x: Math.max(pal.x - 60, 0), y: 0, width: Math.min(pal.width + 60, 900), height: Math.min(pal.height, 800) },
      });
    }

    // Zoom chip: thick acrylic float.
    const zoomMat = await materialOf('.zoom-percent');
    console.log('[glass] zoom chip =', JSON.stringify(zoomMat));
    if (zoomMat) {
      const za = parseRgba(zoomMat.bg).a;
      expect(za, 'zoom chip alpha in the 0.78-0.86 float band').toBeGreaterThanOrEqual(0.78);
      expect(zoomMat.boxShadow, 'zoom chip carries an outer shadow (elevation)').toContain('px');
    }

    console.log('[glass] errors so far:', rendererErrors.length);
    expect(rendererErrors, 'no renderer errors').toEqual([]);
  });

  test('THEMES: dark / light / frosted side-by-side evidence + material matrix', async () => {
    test.setTimeout(420000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    attachErrorCollectors(win);
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport();
    await openPalette();
    await win.waitForTimeout(400);

    const matrix = [];
    for (const t of ['dark', 'light', 'frosted']) {
      await setThemeViaDropdown(t);
      await win.waitForTimeout(700);
      const facts = await win.evaluate(() => {
        const grab = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const cs = getComputedStyle(el);
          return { bg: cs.backgroundColor, blur: cs.backdropFilter || cs.webkitBackdropFilter };
        };
        const ws = document.querySelector('.workspace-main');
        return {
          toolbar: grab('.toolbar'),
          palette: grab('.tools-palette'),
          workspace: ws ? { bg: getComputedStyle(ws).backgroundColor } : null,
        };
      });
      console.log(`[themes:${t}] ${JSON.stringify(facts)}`);
      matrix.push({ theme: t, ...facts });
      await snap(`qa-glass-theme-${t}.png`);
    }

    // Contract: three DISTINCT materials.
    for (const m of matrix) {
      const ta = parseRgba(m.toolbar.bg).a;
      const rgb = parseRgba(m.toolbar.bg);
      if (m.theme === 'dark') {
        expect(ta, 'dark toolbar is opaque').toBeGreaterThanOrEqual(0.95);
        expect(rgb.r < 70 && rgb.g < 70 && rgb.b < 80, 'dark toolbar is a dark surface').toBe(true);
      } else if (m.theme === 'light') {
        expect(ta, 'light toolbar is opaque').toBeGreaterThanOrEqual(0.95);
        expect(rgb.r > 235 && rgb.g > 235 && rgb.b > 235, 'light toolbar is near-white').toBe(true);
      } else {
        expect(ta, 'frosted toolbar is TRANSLUCENT (the glass difference)').toBeLessThanOrEqual(0.86);
        expect(ta).toBeGreaterThanOrEqual(0.6);
        expect(m.toolbar.blur, 'frosted toolbar blurs behind it').toContain('blur');
        expect(m.palette.blur, 'frosted palette blurs behind it').toContain('blur');
      }
    }
    const frost = matrix[2];
    expect(frost.toolbar.bg, 'frosted toolbar must NOT equal the light theme toolbar (distinct material)').not.toBe(matrix[1].toolbar.bg);
    console.log('[themes] matrix proves three distinct materials');

    // Keep the palette open across the shots for maximal surface area; done.
    expect(rendererErrors, 'no renderer errors').toEqual([]);
  });

  test('TOOLBOXES: unified sticky-note pattern (grip == body) across textbox / note / stamp', async () => {
    test.setTimeout(420000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    attachErrorCollectors(win);
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport();

    // Page rect for click targets.
    const pr = await win.evaluate(() => {
      const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
      const page = pane ? pane.querySelector('.pdf-page') : null;
      if (!page) return null;
      const r = page.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    expect(pr, 'page must be visible').not.toBeNull();

    const measure = async (sel) => win.evaluate((s) => {
      const el = document.querySelector(s);
      return el ? (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })() : null;
    }, sel);

    // ---- TEXTBOX creation editor ------------------------------------------
    await win.click('[data-annotation-toolbar] [data-tool="textbox"]');
    await win.waitForTimeout(350);
    await win.mouse.click(pr.x + pr.w * 0.55, pr.y + pr.h * 0.10);
    await win.waitForTimeout(500);
    const tbWrap = await measure('[data-annotation-editor="textbox"]');
    const tbGrip = await measure('[data-annotation-editor="textbox"] .ann-textbox-grip');
    const tbBody = await measure('[data-annotation-editor="textbox"] textarea.ann-editor');
    const tbBar = await measure('[data-annotation-editor="textbox"] .ann-textbox-actions');
    console.log('[tb] wrap=' + JSON.stringify(tbWrap) + ' grip=' + JSON.stringify(tbGrip) + ' body=' + JSON.stringify(tbBody) + ' bar=' + JSON.stringify(tbBar));
    expect(tbGrip, 'textbox grip renders').not.toBeNull();
    expect(tbBody, 'textbox body renders').not.toBeNull();
    expect(Math.abs(tbGrip.w - tbBody.w), 'textbox: grip width == body width (unified pattern)').toBeLessThanOrEqual(3);
    expect(Math.abs(tbGrip.w - tbWrap.w), 'textbox: grip spans the wrapper').toBeLessThanOrEqual(3);
    await win.locator('[data-annotation-editor="textbox"] textarea').fill('GLASS TB CHECK');
    await win.waitForTimeout(200);
    await snap('qa-glass-toolbox-textbox.png');
    await win.click('[data-annotation-action="textbox-confirm"]');
    await win.waitForTimeout(900);

    // ---- NOTE creation editor ----------------------------------------------
    await win.click('[data-annotation-toolbar] [data-tool="note"]');
    await win.waitForTimeout(350);
    await win.mouse.click(pr.x + pr.w * 0.30, pr.y + pr.h * 0.35);
    await win.waitForTimeout(500);
    const ntWrap = await measure('[data-annotation-editor="note"]');
    const ntGrip = await measure('[data-annotation-editor="note"] [data-drag-grip="note"]');
    const ntRow = await measure('[data-annotation-editor="note"] .ann-note-editor-row');
    const ntBody = await measure('[data-annotation-editor="note"] textarea');
    const ntBar = await measure('[data-annotation-editor="note"] .ann-note-editor-actions');
    console.log('[nt] wrap=' + JSON.stringify(ntWrap) + ' grip=' + JSON.stringify(ntGrip) + ' row=' + JSON.stringify(ntRow) + ' textarea=' + JSON.stringify(ntBody) + ' bar=' + JSON.stringify(ntBar));
    expect(ntGrip, 'note grip renders').not.toBeNull();
    expect(ntRow, 'note row renders').not.toBeNull();
    // The note body is the co-located icon+textarea row (B4); the bare
    // textarea is intentionally narrower (the icon sits beside it).
    expect(Math.abs(ntGrip.w - ntRow.w), 'note: grip width == body row width (unified pattern)').toBeLessThanOrEqual(3);
    await win.locator('[data-annotation-editor="note"] textarea').fill('GLASS NOTE CHECK');
    await win.waitForTimeout(200);
    await snap('qa-glass-toolbox-note.png');
    await win.click('[data-annotation-action="note-confirm"]');
    await win.waitForTimeout(900);
    // Disarm the sticky note tool before selecting the committed textbox.
    await win.click('[data-annotation-toolbar] [data-tool="select"]');
    await win.waitForTimeout(350);

    // Grip heights match (one drag-bar language).
    expect(Math.abs(tbGrip.h - ntGrip.h), 'textbox and note grip strips share the same height').toBeLessThanOrEqual(4);

    // ---- Committed textbox -> Edit toolbox (the edit path) -----------------
    await win.locator('.ann-textbox[data-kind="textbox"]').first().click();
    await win.waitForTimeout(500);
    const barInfo = await win.evaluate(() => {
      const bar = document.querySelector('[data-content-action-bar], .content-action-bar');
      if (!bar) return null;
      return { cls: bar.className, buttons: Array.from(bar.querySelectorAll('button')).map((b) => b.getAttribute('data-content-action') || b.textContent.trim()) };
    });
    console.log('[ed] selection bar = ' + JSON.stringify(barInfo));
    expect(barInfo, 'selecting the committed textbox must raise its action bar').not.toBeNull();
    await win.locator('[data-content-action="ann-textbox-edit"]').first().click();
    await win.waitForTimeout(600);
    const edWrap = await measure('[data-annotation-editor="edit-textbox"]');
    const edGrip = await measure('[data-annotation-editor="edit-textbox"] [data-drag-grip="edit-textbox"]');
    const edBody = await measure('[data-annotation-editor="edit-textbox"] textarea.ann-editor');
    console.log('[ed] wrap=' + JSON.stringify(edWrap) + ' grip=' + JSON.stringify(edGrip) + ' body=' + JSON.stringify(edBody));
    expect(edGrip, 'edit toolbox grip renders').not.toBeNull();
    expect(Math.abs(edGrip.w - edBody.w), 'edit toolbox: grip width == body width').toBeLessThanOrEqual(3);
    await snap('qa-glass-toolbox-edit.png');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);

    // ---- STAMP: place, select, open the type picker ------------------------
    await openPalette();
    await win.click('[data-tool-id="stamp"]');
    await win.waitForSelector('[data-stamp-dialog]', { timeout: 8000 });
    await win.waitForTimeout(400);
    await win.click('[data-stamp-confirm]');
    await win.waitForTimeout(500);
    await win.mouse.click(pr.x + pr.w * 0.65, pr.y + pr.h * 0.60);
    await win.waitForTimeout(1200);
    const stampCount = await win.locator('.stamp-annotation').count();
    console.log('[stamp] placed stamps = ' + stampCount);
    // Close the palette first: the floating sheet covers the page's right
    // side and intercepts the selection click otherwise.
    await win.click('[data-tools-toggle]');
    await win.waitForTimeout(700);
    if (stampCount > 0) {
      await win.locator('.stamp-annotation').first().click();
      await win.waitForTimeout(400);
      const editBtn = win.locator('[data-content-action="stamp-edit"]').first();
      if (await editBtn.count()) {
        await editBtn.click();
        await win.waitForTimeout(600);
        const stWrap = await measure('[data-stamp-type-editor]');
        const stBar = await measure('[data-stamp-type-editor] .ann-textbox-actions');
        console.log('[st] wrap=' + JSON.stringify(stWrap) + ' bar=' + JSON.stringify(stBar));
        expect(stWrap, 'stamp type picker renders').not.toBeNull();
        await snap('qa-glass-toolbox-stamp.png');
        await win.click('[data-stamp-type-cancel]');
        await win.waitForTimeout(400);
      }
    }

    // One drag-bar language across ALL toolboxes (creation, note, edit —
    // the edit toolbox adds the DEF-161 color row so its ABSOLUTE width
    // legitimately differs; the grip HEIGHT must not).
    expect(Math.abs(tbGrip.h - ntGrip.h), 'textbox and note grip strips share the same height').toBeLessThanOrEqual(4);
    expect(Math.abs(tbGrip.h - edGrip.h), 'creation and edit toolboxes share the same grip height').toBeLessThanOrEqual(4);
    // Within the edit toolbox too: grip == body.
    expect(Math.abs(edGrip.w - edBody.w), 'edit toolbox: grip width == body width').toBeLessThanOrEqual(3);
    console.log('[tb] errors so far:', rendererErrors.length);
    expect(rendererErrors, 'no renderer errors').toEqual([]);
  });

  test('WORD: export produces EDITABLE text (DEF-060 text-first contract)', async () => {
    test.setTimeout(300000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    attachErrorCollectors(win);
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport();
    const savePath = path.join(os.tmpdir(), `qa-glass-docx-${Date.now()}.docx`);

    await electronApp.evaluate(({ BrowserWindow }, opts) => {
      const bw = BrowserWindow.getAllWindows()[0];
      const sess = bw && bw.webContents ? bw.webContents.session : null;
      global.__QAGLASSDOCX__ = { started: false, state: null, registerError: null };
      if (!sess) { global.__QAGLASSDOCX__.registerError = 'no session'; return; }
      sess.on('will-download', (event, item) => {
        global.__QAGLASSDOCX__.started = true;
        item.setSavePath(opts.savePath);
        item.once('done', (e, state) => { global.__QAGLASSDOCX__.state = state; });
      });
    }, { savePath });

    await openPalette();
    await win.click('[data-tool-id="exportDocx"]');
    await win.waitForSelector('[data-docx-export-dialog]', { timeout: 10000 });
    await win.waitForTimeout(400);
    await snap('qa-glass-docx-dialog.png');
    // Range 1-2 keeps the rasterization fast; both pages carry real text.
    const rangeInput = win.locator('[data-docx-export-range]');
    if (await rangeInput.count()) await rangeInput.fill('1-2');
    await win.waitForTimeout(200);
    await win.click('[data-docx-export-confirm]');

    let info = null;
    for (let i = 0; i < 90; i++) {
      await win.waitForTimeout(1000);
      info = await electronApp.evaluate(() => global.__QAGLASSDOCX__);
      if (info && info.state) break;
    }
    console.log('[docx] download info =', JSON.stringify(info));
    expect(info && info.registerError).toBeNull();
    expect(info && info.state, 'download must complete').toBe('completed');
    expect(fs.existsSync(savePath), 'the .docx must exist').toBe(true);
    expect(fs.statSync(savePath).size, 'the .docx must not be empty').toBeGreaterThan(0);

    // Unzip and inspect the OOXML.
    const outDir = path.join(os.tmpdir(), `qa-glass-docx-unzip-${Date.now()}`);
    fs.mkdirSync(outDir, { recursive: true });
    execFileSync('tar', ['-xf', savePath, '-C', outDir]);
    const docXml = fs.readFileSync(path.join(outDir, 'word', 'document.xml'), 'utf8');
    const textRuns = (docXml.match(/<w:t[ >]/g) || []).length;
    const paragraphs = (docXml.match(/<w:p[ >]|<w:p>/g) || []).length;
    const drawings = (docXml.match(/<w:drawing[ >]/g) || []).length;
    const mediaDir = path.join(outDir, 'word', 'media');
    const media = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : [];
    console.log('[docx] OOXML: paragraphs =', paragraphs, 'textRuns =', textRuns, 'drawings =', drawings, 'media =', media.length);

    // THE CONTRACT: real editable text runs, not a picture of the page.
    expect(textRuns, 'the docx must contain EDITABLE w:t text runs (DEF-060/DEF-177)').toBeGreaterThan(0);
    expect(paragraphs, 'the text must live in real w:p paragraphs').toBeGreaterThan(0);

    // The runs must carry ACTUAL document words (not empty shells).
    const texts = [];
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
    let m;
    while ((m = re.exec(docXml)) !== null && texts.length < 40) texts.push(m[1]);
    const joined = texts.join(' ');
    console.log('[docx] first text runs =', JSON.stringify(texts.slice(0, 15)));
    expect(joined.length, 'the runs must contain real characters, not empty shells').toBeGreaterThan(20);
    expect(
      /TFlex|report|page|Page|technical/i.test(joined),
      'the extracted text must be the document s own words',
    ).toBe(true);

    // Keep the artifact + a copy of document.xml for the ledger.
    const evidence = path.join(SHOTS, 'qa-glass-docx-document.xml');
    fs.copyFileSync(path.join(outDir, 'word', 'document.xml'), evidence);
    console.log('[docx] saved artifact =', savePath, 'evidence xml =', evidence);

    expect(rendererErrors, 'no renderer errors').toEqual([]);
  });
});
