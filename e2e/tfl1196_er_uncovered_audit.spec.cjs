// TFL-1196 — ER01..ER24 delta re-audit (qa). Manual reproduction of the
// un-covered ERs at HEAD: ER02 (text inspector independent of R11), ER16
// (reading-view terminology), ER18 (image dialog empty body), ER20 (all-pages
// PNG output-name copy), ER21 ("Not analysed" output checks), ER24 (Stamp copy),
// plus the phase's three required-scenario checks. Read-only product checks;
// captures land under screenshots/. Launches ONLY via e2e/lib/launch.cjs.
delete process.env.ELECTRON_RUN_AS_NODE;

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, openSample, gotoStage, clickDockVerb } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (n) => path.join(SHOTS, n);

// Smallest valid PNG (1x1 transparent) for the ER18 "after selection" state.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1196-er');
  app = null;
  win = null;
});

test.setTimeout(300000);

const dims = () =>
  win.evaluate(() => ({ innerW: window.innerWidth, innerH: window.innerHeight, dpr: window.devicePixelRatio }));

const setSize = async (w, h) => {
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw.isMaximized()) bw.unmaximize();
  });
  await win.waitForTimeout(350);
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]);
  }, [w, h]);
  await win.waitForFunction((s) => Math.abs(window.innerWidth - s) < 60, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(400);
};

// --- Test A: Home surfaces, ER18 image dialog, ER16 home strings, ER04 menu ---
test('A: Home + image dialog + compact app menu (ER04/ER16/ER18, scenario 2)', async () => {
  const d = await dims();
  console.log(`[tfl1196-A] launch viewport=${JSON.stringify(d)}`);
  await win.screenshot({ path: shot('tfl1196_home_launch.png') });

  // ER18 — Home -> Create PDF from images. DEF-632 fix: with nothing selected
  // the dialog must size to its content (no reserved ~588px blank body); the
  // tall preview body returns only once images exist.
  const fromImages = win.locator('[data-home-tool="createFromImages"]').first();
  await fromImages.waitFor({ state: 'visible', timeout: 10000 });
  await fromImages.click();
  await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  const readImgDialog = () => win.evaluate(() => {
    const dlg = document.querySelector('[data-create-from-images-dialog]');
    const help = dlg ? dlg.querySelector('.modal-help') : null;
    const body = dlg ? dlg.querySelector('.modal-body, .sheet-body, .preview-task-body') : null;
    const list = dlg ? dlg.querySelector('[data-create-list]') : null;
    return {
      help: help ? help.textContent.replace(/\s+/g, ' ').trim() : null,
      bodyH: body ? Math.round(body.getBoundingClientRect().height) : null,
      listPresent: list !== null,
      hasFilesAttr: dlg ? dlg.hasAttribute('data-create-has-files') : null,
      growClass: dlg ? dlg.classList.contains('task-dialog-preview-grow') : null,
      dialogH: dlg ? Math.round(dlg.getBoundingClientRect().height) : null,
    };
  });

  const emptyImg = await readImgDialog();
  console.log(`[tfl1196-ER18-empty] ${JSON.stringify(emptyImg)}`);
  await win.screenshot({ path: shot('tfl1196_er18_empty.png') });
  expect(emptyImg.dialogH, 'ER18 empty dialog is content-driven (well under old 760)').toBeLessThan(600);
  expect(emptyImg.bodyH, 'ER18 empty body holds no large blank reservation').toBeLessThan(400);
  expect(emptyImg.listPresent, 'ER18 empty list is absent').toBe(false);
  expect(emptyImg.hasFilesAttr, 'ER18 empty carries no files marker').toBe(false);
  expect(emptyImg.growClass, 'ER18 empty preview does not grow').toBe(false);

  // After selection: the list appears and the layout grows (R18 after-selection).
  const chooserPromise = win.waitForEvent('filechooser');
  await win.locator('[data-create-pick]').click();
  const chooser = await chooserPromise;
  await chooser.setFiles([
    { name: 'qa-er18-a.png', mimeType: 'image/png', buffer: PNG_1x1 },
    { name: 'qa-er18-b.png', mimeType: 'image/png', buffer: PNG_1x1 },
  ]);
  await win.waitForFunction(
    () => document.querySelectorAll('[data-create-image-row]').length === 2,
    undefined,
    { timeout: 10000 },
  );
  await win.waitForTimeout(400);
  const filledImg = await readImgDialog();
  console.log(`[tfl1196-ER18-filled] ${JSON.stringify(filledImg)}`);
  await win.screenshot({ path: shot('tfl1196_er18_filled.png') });
  expect(filledImg.listPresent, 'ER18 list appears once images are selected').toBe(true);
  expect(filledImg.hasFilesAttr, 'ER18 files marker present once images are selected').toBe(true);
  expect(filledImg.growClass, 'ER18 preview grows once images are selected').toBe(true);
  expect(filledImg.dialogH, 'ER18 dialog grows with images').toBeGreaterThan(emptyImg.dialogH);
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-create-from-images-dialog]', { state: 'detached', timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(300);

  // ER16 — user-visible reading terminology strings present on Home/doc shells.
  const readingStrings = await win.evaluate(() => ({
    readingOpenCount: document.querySelectorAll('[data-reading-open]').length,
    readingOpenLabel: (() => { const b = document.querySelector('[data-reading-open]'); return b ? b.textContent.replace(/\s+/g, ' ').trim() : null; })(),
    bookViewCount: Array.from(document.querySelectorAll('[aria-label="Book View"], .view-strip-book-label')).length,
    comicStrings: (document.body.innerText.match(/open comic view/gi) || []).length,
  }));
  console.log(`[tfl1196-ER16-home] ${JSON.stringify(readingStrings)}`);

  // Required scenario 2 — compact Home application menu at the right edge:
  // no horizontal scrollbar; Escape closes and returns focus to the trigger.
  await setSize(985, 645);
  console.log(`[tfl1196-compact] ${JSON.stringify(await dims())}`);
  await win.click('[data-app-menu]');
  await win.waitForSelector('[data-app-menu-popover]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(300);
  const menu = await win.evaluate(() => {
    const pop = document.querySelector('[data-app-menu-popover]');
    const list = pop ? pop.querySelector('.command-menu-list') : null;
    const r = pop.getBoundingClientRect();
    const cs = getComputedStyle(pop);
    return {
      innerW: window.innerWidth, left: Math.round(r.left), right: Math.round(r.right),
      rightGutter: Math.round(window.innerWidth - r.right),
      popScrollW: pop.scrollWidth, popClientW: pop.clientWidth,
      listScrollW: list ? list.scrollWidth : null, listClientW: list ? list.clientWidth : null,
      overflowX: cs.overflowX,
    };
  });
  console.log(`[tfl1196-scenario2-menu] ${JSON.stringify(menu)}`);
  await win.screenshot({ path: shot('tfl1196_scenario2_compact_menu.png') });
  expect(menu.right, 'compact menu right inside viewport').toBeLessThanOrEqual(menu.innerW + 1);
  expect(menu.popScrollW, 'compact menu no horizontal scroll').toBeLessThanOrEqual(menu.popClientW + 1);
  expect(menu.listScrollW || 0, 'compact menu list no horizontal scroll').toBeLessThanOrEqual((menu.listClientW || 0) + 1);
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-app-menu-popover]', { state: 'detached', timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(200);
  const focusBack = await win.evaluate(() => !!document.activeElement && document.activeElement.hasAttribute('data-app-menu'));
  console.log(`[tfl1196-scenario2-focus] escapeReturnedFocus=${focusBack}`);
});

// --- Test B: reading terminology (ER16), Stamp copy (ER24), text inspector (ER02/scenario 3) ---
test('B: reading terminology, stamp dialog, text inspector normal + compact (ER16/ER24/ER02, scenario 3)', async () => {
  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);

  // ER16 — the Footer ViewStrip "Book View" entry for a PDF.
  const er16 = await win.evaluate(() => ({
    bookViewLabel: (() => { const el = document.querySelector('.view-strip-book-label'); return el ? el.textContent.trim() : null; })(),
    bookViewAria: document.querySelector('[aria-label="Book View"]') !== null,
    readingOpenLabel: (() => { const b = document.querySelector('[data-reading-open]'); return b ? b.textContent.replace(/\s+/g, ' ').trim() : null; })(),
    comicVisible: /open comic view/i.test(document.body.innerText),
  }));
  console.log(`[tfl1196-ER16-doc] ${JSON.stringify(er16)}`);

  // ER24 — Stamp dialog copy conflict.
  await gotoStage(win, 3);
  await clickDockVerb(win, 3, 'stamp');
  await win.waitForSelector('[data-stamp-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  const stamp = await win.evaluate(() => {
    const dlg = document.querySelector('[data-stamp-dialog]');
    const help = dlg ? dlg.querySelector('.modal-help') : null;
    const hints = Array.from(dlg ? dlg.querySelectorAll('.modal-hint') : []).map((h) => h.textContent.replace(/\s+/g, ' ').trim());
    const confirm = dlg ? dlg.querySelector('[data-stamp-confirm]') : null;
    const pageSelect = dlg ? dlg.querySelector('[data-stamp-page-select]') : null;
    const body = dlg ? dlg.querySelector('.modal-body, .sheet-body') : null;
    const cr = confirm ? confirm.getBoundingClientRect() : null;
    return {
      help: help ? help.textContent.replace(/\s+/g, ' ').trim() : null,
      hints,
      confirmLabel: confirm ? confirm.textContent.trim() : null,
      pageSelectPresent: pageSelect !== null,
      dialogText: dlg ? dlg.textContent.replace(/\s+/g, ' ').trim() : null,
      bodyH: body ? Math.round(body.getBoundingClientRect().height) : null,
      dialogH: dlg ? Math.round(dlg.getBoundingClientRect().height) : null,
      confirmVisible: cr ? cr.width > 0 && cr.height > 0 : false,
      confirmInView: cr ? cr.right <= window.innerWidth + 1 && cr.bottom <= window.innerHeight + 1 : false,
    };
  });
  console.log(`[tfl1196-ER24] ${JSON.stringify(stamp)}`);
  // DEF-635 (ER24) — the copy now matches the real placement flow. The page
  // picker was a silent no-op (the handler arms the stamp and the NEXT page
  // click chooses the page), so it must be gone along with the false
  // "centered on the picked page / 60 pt" promise; the intro must state the
  // click-to-place flow and the Escape cancel.
  expect(stamp.pageSelectPresent, 'ER24 no page picker in the stamp dialog').toBe(false);
  expect(stamp.confirmLabel, 'ER24 primary control reads Start placement').toBe('Start placement');
  expect(stamp.dialogText.toLowerCase(), 'ER24 no "centered on the picked page" promise')
    .not.toContain('centered on the picked page');
  expect(stamp.dialogText.toLowerCase(), 'ER24 no false "60 pt" size promise').not.toContain('60 pt');
  expect(stamp.dialogText.toLowerCase(), 'ER24 no "Place on page" label').not.toContain('place on page');
  expect(/click/i.test(stamp.help ?? ''), 'ER24 intro states click-to-place').toBe(true);
  expect(/escape/i.test(stamp.help ?? ''), 'ER24 intro states Escape cancel').toBe(true);
  // Blast radius — PreviewTaskDialog also serves StampDialog. The added
  // `grow?` prop must leave the Stamp layout as before: a real (non-collapsed)
  // body and a visible, in-view confirm control.
  expect(stamp.bodyH, 'StampDialog body is not collapsed by the PreviewTaskDialog change').toBeGreaterThan(100);
  expect(stamp.dialogH, 'StampDialog dialog has real height').toBeGreaterThan(150);
  expect(stamp.confirmVisible, 'StampDialog confirm control is visible').toBe(true);
  expect(stamp.confirmInView, 'StampDialog confirm control is inside the viewport').toBe(true);
  await win.screenshot({ path: shot('tfl1196_er24_stamp_dialog_full.png') });
  await setSize(985, 645);
  await win.screenshot({ path: shot('tfl1196_er24_stamp_dialog_compact.png') });
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-stamp-dialog]', { state: 'detached', timeout: 8000 }).catch(() => {});
  await setSize(1440, 900);
  await win.waitForTimeout(400);

  // ER02 + scenario 3 — Edit text inspector at normal width: all formatting
  // controls fit, no nested horizontal scroll, no clipped control.
  await gotoStage(win, 2);
  const textVerb = win.locator('[data-action-dock] [data-dock-verb="editText"]').first();
  await textVerb.waitFor({ state: 'visible', timeout: 12000 });
  await textVerb.click();
  await win.waitForFunction(() => document.querySelector('.edit-layer[data-tool="text"]') !== null, undefined, { timeout: 8000 });
  await win.waitForTimeout(400);

  const run = await win.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (t.length >= 6 && r.width > 20 && r.height > 4) {
        s.setAttribute('data-tfl1196-run', '1');
        return { text: t.slice(0, 30), x: r.x, y: r.y, w: r.width, h: r.height };
      }
    }
    return null;
  });
  console.log(`[tfl1196-ER02-run] ${JSON.stringify(run)}`);
  if (run) {
    // The text layer span is role=presentation with pointer-events:none, so a
    // real click lands on the page beneath it: click the run's on-screen centre.
    await win.mouse.click(Math.round(run.x + run.w / 2), Math.round(run.y + run.h / 2));
    await win.waitForSelector('[data-text-panel]', { timeout: 10000 }).catch(() => {});
    await win.waitForTimeout(500);
  }
  const insp = () => win.evaluate(() => {
    const panel = document.querySelector('[data-text-panel]');
    const body = document.querySelector('.inspector-body');
    const b = body ? body.getBoundingClientRect() : null;
    let clipped = 0;
    let controls = 0;
    if (body) {
      for (const el of body.querySelectorAll('button, input, select, [data-txt-font], [data-txt-size]')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        controls += 1;
        if (r.right > b.right + 1) clipped += 1;
      }
    }
    // Deep scan: any descendant with real horizontal overflow (scrollWidth >
    // clientWidth) means a nested horizontal scroller inside the inspector.
    const nested = [];
    if (body) {
      for (const el of body.querySelectorAll('*')) {
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
          nested.push({
            sel: `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(/\s+/).slice(0,2).join('.')}`,
            scrollW: el.scrollWidth, clientW: el.clientWidth,
            overflowX: getComputedStyle(el).overflowX,
          });
        }
      }
    }
    return {
      textPanel: panel !== null,
      bodyScrollW: body ? body.scrollWidth : null,
      bodyClientW: body ? body.clientWidth : null,
      bodyOverflowX: body ? getComputedStyle(body).overflowX : null,
      controls, clipped, nested,
      innerW: window.innerWidth,
    };
  });
  const normal = await insp();
  console.log(`[tfl1196-ER02-normal-1440] ${JSON.stringify(normal)}`);
  await win.screenshot({ path: shot('tfl1196_er02_text_inspector_full.png') });
  // DEF-631 / ER02 — at 1440x900 the text inspector must not overflow
  // horizontally at any depth, must not clip a control, and must expose all
  // 25 formatting controls.
  expect(normal.textPanel, 'ER02 1440 text panel present').toBe(true);
  expect(normal.nested, 'ER02 1440 no nested horizontal overflow').toEqual([]);
  expect(normal.bodyOverflowX, 'ER02 1440 inspector body clips horizontal overflow').toBe('hidden');
  expect(normal.clipped, 'ER02 1440 no clipped control').toBe(0);
  expect(normal.controls, 'ER02 1440 all 25 controls present').toBe(25);
  expect(normal.bodyScrollW, 'ER02 1440 no horizontal scrollbar').toBeLessThanOrEqual(normal.bodyClientW + 1);

  // Scenario 3 compact: Expand inspector opens and STAYS open.
  await setSize(985, 645);
  await win.waitForTimeout(500);
  const openers = await win.locator('[data-inspector-collapse]').count();
  console.log(`[tfl1196-scenario3-compact] collapseOpeners=${openers}`);
  expect(openers, 'ER02 compact Edit inspector offers the drawer opener at 985x645').toBeGreaterThan(0);
  if (openers > 0) {
    await win.click('[data-inspector-collapse]');
    await win.waitForSelector('[data-inspector][data-inspector-drawer="true"]', { timeout: 5000 });
    await win.waitForFunction(() => {
      const el = document.querySelector('[data-inspector][data-inspector-drawer="true"]');
      if (!el) return false;
      return el.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle');
    }, null, { timeout: 3000 }).catch(() => {});
    await win.waitForTimeout(600);
    const stillOpen = await win.locator('[data-inspector][data-inspector-drawer="true"]').count();
    const compact = await insp();
    console.log(`[tfl1196-ER02-compact-985] stillOpen=${stillOpen} ${JSON.stringify(compact)}`);
    await win.screenshot({ path: shot('tfl1196_er02_text_inspector_compact.png') });
    // DEF-631 / ER02 — same containment contract in the compact Edit drawer.
    expect(stillOpen, 'ER02 compact drawer stays open').toBeGreaterThan(0);
    expect(compact.textPanel, 'ER02 compact text panel present').toBe(true);
    expect(compact.nested, 'ER02 compact no nested horizontal overflow').toEqual([]);
    expect(compact.bodyOverflowX, 'ER02 compact inspector body clips horizontal overflow').toBe('hidden');
    expect(compact.clipped, 'ER02 compact no clipped control').toBe(0);
    expect(compact.controls, 'ER02 compact all 25 controls present').toBe(25);
    expect(compact.bodyScrollW, 'ER02 compact no horizontal scrollbar').toBeLessThanOrEqual(compact.bodyClientW + 1);
  }
});

// --- Test C: Deliver export copy — ER20 (all-pages PNG output name) + ER21 ("Not analysed") ---
test('C: Deliver export output name + output checks copy (ER20/ER21)', async () => {
  const samplePath = await openSample(win, app, 'report.pdf');
  // getSamplePath copies the sample to `<timestamp>-report.pdf`; the export
  // scheme is derived from THIS real source name (the same helper the save
  // flow uses), so the expected stem is the opened file's stem.
  const stem = path.basename(samplePath).replace(/\.pdf$/i, '');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1000);
  await setSize(1440, 900);
  await gotoStage(win, 4);
  await win.waitForSelector('[data-export-config]', { timeout: 10000 });
  await win.waitForTimeout(400);

  const readDeliver = () => win.evaluate(() => {
    const out = document.querySelector('[data-export-config-output-value]');
    const scheme = document.querySelector('[data-export-config-output-scheme]');
    const range = document.querySelector('[data-export-config-range-summary]');
    const cfg = document.querySelector('[data-export-config]');
    const legend = document.querySelector('[data-deliver-observation-legend]');
    const prot = document.querySelector('[data-deliver-protection]');
    const fid = document.querySelector('[data-deliver-fidelity]');
    const protReason = document.querySelector('[data-deliver-protection-reason]');
    const fidReason = document.querySelector('[data-deliver-fidelity-reason]');
    const panel = document.querySelector('[data-context-panel]');
    const ocr = document.querySelector('[data-preflight="ocr"] [data-deliver-observation-value]');
    const norm = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
    return {
      format: cfg ? cfg.getAttribute('data-export-config-format') : null,
      outputName: out ? out.textContent.trim() : null,
      outputScheme: scheme ? scheme.textContent.replace(/\s+/g, ' ').trim() : null,
      rangeSummary: range ? range.textContent.trim() : null,
      legend: norm(legend),
      protection: prot ? prot.textContent.trim() : null,
      fidelity: fid ? fid.textContent.trim() : null,
      protectionReason: norm(protReason),
      fidelityReason: norm(fidReason),
      panelText: norm(panel),
      ocr: ocr ? ocr.textContent.trim() : null,
    };
  });

  const png = win.locator('[data-export-config-format-option="png"]');
  if ((await png.count()) > 0) await png.check();
  await win.waitForTimeout(300);
  const pngState = await readDeliver();
  console.log(`[tfl1196-ER20-png] ${JSON.stringify(pngState)}`);
  await win.screenshot({ path: shot('tfl1196_er20_21_deliver_full.png') });

  await setSize(985, 645);
  await win.waitForTimeout(500);
  const collapsed = await win.locator('[data-inspector-collapse]').count();
  if (collapsed > 0) {
    await win.click('[data-inspector-collapse]');
    await win.waitForSelector('[data-inspector][data-inspector-drawer="true"]', { timeout: 5000 }).catch(() => {});
    await win.waitForTimeout(600);
  }
  const compact = await readDeliver();
  console.log(`[tfl1196-ER20-png-compact] ${JSON.stringify(compact)}`);
  await win.screenshot({ path: shot('tfl1196_er20_21_deliver_compact.png') });
  console.log(`[tfl1196-ER20-strings] outputName="${pngState.outputName}" rangeSummary="${pngState.rangeSummary}"`);
  console.log(`[tfl1196-ER21-strings] legend="${pngState.legend}" protection="${pngState.protection}" fidelity="${pngState.fidelity}" ocr="${pngState.ocr}"`);

  // DEF-633 (ER20) — report.pdf (34 pages) + Images PNG + All pages writes one
  // PNG per page, named by `defaultExportFilename`. The surface must state the
  // real selected file count and the shipped per-page scheme, not a single name.
  const assertEr20 = (state, where) => {
    expect(state.format, `ER20 ${where} format is an image format`).toBe('png');
    expect(state.rangeSummary, `ER20 ${where} page scope is all pages`).toBe('1-34');
    expect(state.outputName, `ER20 ${where} states the real selected file count`).toBe('34 files');
    expect(state.outputScheme, `ER20 ${where} names the shipped per-page scheme`).toBe(
      `${stem}-page-1.png \u2026 ${stem}-page-34.png`,
    );
  };
  // The full-width Deliver surface is where the rows render; the compact read
  // (below) is captured as evidence only.
  assertEr20(pngState, 'full');

  // DEF-634 (ER21) — the unavailable output checks state WHAT they are and WHY
  // honestly; the old bare "Not analysed" literal must be gone.
  const assertEr21 = (state, where) => {
    expect(state.protection, `ER21 ${where} protection reads Not read`).toBe('Not read');
    expect(state.protectionReason, `ER21 ${where} protection carries a reason`).toBeTruthy();
    expect(/encryption dictionary/i.test(state.protectionReason ?? ''),
      `ER21 ${where} protection reason explains why the value is unread`).toBe(true);
    expect(state.fidelity, `ER21 ${where} fidelity reads Not applicable for an image export`).toBe('Not applicable');
    expect(state.fidelityReason, `ER21 ${where} fidelity carries a reason`).toBeTruthy();
    expect(/office/i.test(state.fidelityReason ?? ''),
      `ER21 ${where} fidelity reason names the office-only scope`).toBe(true);
    expect(state.protection, `ER21 ${where} protection is not the bare literal`).not.toBe('Not analysed');
    expect(state.fidelity, `ER21 ${where} fidelity is not the bare literal`).not.toBe('Not analysed');
    expect(state.panelText ?? '', `ER21 ${where} no "Not analysed" remains in the panel`)
      .not.toContain('Not analysed');
    expect(state.legend ?? '', `ER21 ${where} the observation legend is kept`).toBeTruthy();
  };
  assertEr21(pngState, 'full');
});

// --- Test D: scenario 1 — active empty Home tab with another doc open ---
test('D: active empty Home tab capabilities (scenario 1)', async () => {
  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-new-tab]').first().click();
  await win.waitForSelector('.welcome', { timeout: 8000 });
  await win.waitForTimeout(400);

  await win.locator('[data-menu-button]').first().click();
  await win.waitForTimeout(300);
  const fileMenu = await win.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-menu-action]'));
    const byAction = {};
    for (const r of rows) {
      byAction[r.getAttribute('data-menu-action')] = {
        disabled: r.getAttribute('aria-disabled') === 'true' || r.disabled === true,
      };
    }
    return byAction;
  });
  console.log(`[tfl1196-scenario1-filemenu] ${JSON.stringify(fileMenu)}`);
  await win.screenshot({ path: shot('tfl1196_scenario1_empty_tab_filemenu.png') });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);

  await win.keyboard.press('Control+Shift+P');
  await win.waitForSelector('[data-palette-row]', { timeout: 8000 });
  const palette = await win.evaluate(() => {
    const read = (id) => {
      const el = document.querySelector(`[data-palette-tool-id="${id}"]`);
      if (!el) return { present: false };
      return {
        present: true,
        disabled: el.getAttribute('aria-disabled') === 'true' || el.disabled === true || el.hasAttribute('data-palette-disabled'),
        text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60),
      };
    };
    return {
      save: read('save'), saveAs: read('saveAs'), print: read('print'),
      tabClose: read('tabClose'), tabNew: read('tabNew'),
    };
  });
  console.log(`[tfl1196-scenario1-palette] ${JSON.stringify(palette)}`);
  await win.screenshot({ path: shot('tfl1196_scenario1_empty_tab_palette.png') });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);

  const toolbar = await win.evaluate(() => ({
    saveAs: document.querySelectorAll('[data-toolbar-save-as]').length,
    print: document.querySelectorAll('[data-print]').length,
  }));
  console.log(`[tfl1196-scenario1-toolbar] ${JSON.stringify(toolbar)}`);
});

// --- Test E: ER03 — compact Edit-stage dock labels (no partial label) ---
test('E: compact Edit dock labels (ER03)', async () => {
  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1000);
  await gotoStage(win, 2); // EDIT — the stage ER03 was reported against
  await setSize(985, 645);
  await win.waitForTimeout(600);
  const dock = await win.evaluate(() => {
    const d = document.querySelector('[data-action-dock]');
    const primary = d ? Array.from(d.querySelectorAll('[data-dock-group="primary"] .action-dock-label')) : [];
    const overflowScroll = [];
    if (d) {
      for (const el of d.querySelectorAll('*')) {
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
          overflowScroll.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().split(/\s+/)[0], sw: el.scrollWidth, cw: el.clientWidth });
        }
      }
    }
    const rect = d ? d.getBoundingClientRect() : null;
    return {
      labels: primary.map((l) => l.textContent.trim()),
      iconOnly: d ? d.getAttribute('data-dock-icon-only') : null,
      arrows: d ? d.getAttribute('data-dock-arrows') : null,
      arrowCount: document.querySelectorAll('[data-dock-arrow]').length,
      dockRight: rect ? Math.round(rect.right) : null,
      overflowScroll,
      innerW: window.innerWidth,
    };
  });
  console.log(`[tfl1196-ER03-dock-compact] ${JSON.stringify(dock)}`);
  await win.screenshot({ path: shot('tfl1196_er03_compact_edit_dock.png') });
});

// --- Test F: blast radius — stamp place THEN undo (DEF-635 neighbour) ---
// The DEF-635 change removed the page picker and only relabelled the confirm;
// the click-to-place handler at App.tsx:6765-7345 is unchanged. Prove the whole
// flow still works on a DISPOSABLE copy of the sample (getSamplePath copies to
// the temp dir, so the baked stamp never touches the source tree).
test('F: stamp Start placement arms, a page click places, Undo removes', async () => {
  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1000);

  await gotoStage(win, 3);
  await clickDockVerb(win, 3, 'stamp');
  await win.waitForSelector('[data-stamp-dialog]', { timeout: 10000 });
  await win.waitForTimeout(300);
  const label = await win.locator('[data-stamp-confirm]').first().textContent();
  expect((label ?? '').trim(), 'F stamp primary control reads Start placement').toBe('Start placement');

  // Confirm arms the stamp; the dialog closes and the ghost layer appears.
  await win.locator('[data-stamp-confirm]').first().click();
  await win.waitForSelector('[data-stamp-dialog]', { state: 'detached', timeout: 8000 });
  await win.waitForSelector('[data-stamp-layer]', { timeout: 8000 });

  const before = await win.locator('[data-stamp-annotation]').count();
  expect(before, 'F no stamp annotation before placement').toBe(0);

  // A real page click places the stamp at the click point.
  const box = await win.locator('.pdf-page[data-page="1"]').first().boundingBox();
  expect(box, 'F page 1 has a bounding box').not.toBeNull();
  await win.mouse.click(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  await win.waitForFunction(() => document.querySelectorAll('[data-stamp-annotation]').length >= 1, undefined, {
    timeout: 10000,
  });
  await win.waitForTimeout(500);
  const placed = await win.locator('[data-stamp-annotation]').count();
  const canUndo = await win.evaluate(() => window.tflexDiagnostics().canUndo);
  console.log(`[tfl1196-stamp-place] placed=${placed} canUndo=${canUndo}`);
  await win.screenshot({ path: shot('tfl1196_stamp_placed.png') });
  expect(placed, 'F page click placed exactly one stamp').toBe(1);
  expect(canUndo, 'F placement is undoable').toBe(true);

  // Undo reverts the bake and drops the renderer mirror.
  await win.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
  await win.keyboard.press('Control+z');
  await win.waitForFunction(() => document.querySelectorAll('[data-stamp-annotation]').length === 0, undefined, {
    timeout: 10000,
  });
  await win.waitForTimeout(400);
  const after = await win.locator('[data-stamp-annotation]').count();
  console.log(`[tfl1196-stamp-undo] remaining=${after}`);
  await win.screenshot({ path: shot('tfl1196_stamp_undone.png') });
  expect(after, 'F Undo removed the placed stamp').toBe(0);
});

