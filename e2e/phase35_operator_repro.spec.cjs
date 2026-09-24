// Phase 35 focused verification (qa) — operator-reported defects + Phase 35 baseline.
//
// Seven operator reports (2026-09-22) are reproduced here; each test writes raw
// measurements to the run log and a screenshot under screenshots/. Four Phase 35
// criteria are BASELINE ONLY (A window gestures, B taskbar hover, C file
// associations, D print) and are reported, not filed as defects.
//
// Launches only through the canonical launchApp helper (e2e/lib/launch.cjs).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, dismissUpdatePrompt, toggleMultiModeViaPalette, openStandalonePrintWindow } = require('./lib/helpers.cjs');
const {
  twoPaneSetup,
  focusPaneByPage,
  paneCount,
  openFile,
  tmpCopy,
  REPORT,
  LONG,
} = require('./lib/p33_common.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const INSTALLED = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'tflex', 'TFlex.exe');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p35-operator');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function shot(name) {
  // Run-close passes (TFLEX_SKIP_SHOTS=1) must never overwrite the recorded
  // defect-evidence images; the tests' numeric assertions are the guard.
  if (process.env.TFLEX_SKIP_SHOTS === '1') return null;
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  return p;
}

// --- synthetic HTML5 cross-document drag (same machinery as phase32_drag_drop) --
async function synthStep(step, arg) {
  return win.evaluate(({ step: s, arg: a }) => {
    const KEY = '__p35dt';
    if (s === 'start') {
      const src = document.querySelector(a.src);
      if (!src) return { ok: false, reason: 'no-src' };
      const dt = new DataTransfer();
      window[KEY] = dt;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { ok: true };
    }
    const dt = window[KEY];
    if (!dt) return { ok: false, reason: 'no-dt' };
    if (s === 'over' || s === 'drop') {
      const tgt = document.querySelector(a.tgt);
      if (!tgt) return { ok: false, reason: 'no-tgt' };
      const r = tgt.getBoundingClientRect();
      const clientX = r.left + r.width / 2;
      const clientY = a.after ? r.top + r.height * 0.75 : r.top + r.height * 0.25;
      const ev = new DragEvent(s === 'over' ? 'dragover' : 'drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX,
        clientY,
        ctrlKey: !!a.ctrl,
        altKey: false,
      });
      tgt.dispatchEvent(ev);
      return { ok: true, defaultPrevented: ev.defaultPrevented };
    }
    if (s === 'end') {
      const src = document.querySelector(a.src);
      if (src) src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      delete window[KEY];
      return { ok: true };
    }
    return { ok: false, reason: 'bad-step' };
  }, { step, arg });
}
async function synthDrag(srcSel, tgtSel, opts = {}) {
  const started = await synthStep('start', { src: srcSel });
  if (!started.ok) return started;
  await win.waitForTimeout(120);
  await synthStep('over', { tgt: tgtSel, ...opts });
  await win.waitForTimeout(120);
  const drop = await synthStep('drop', { tgt: tgtSel, ...opts });
  await win.waitForTimeout(1800);
  return drop;
}

// ---------------------------------------------------------------------------
// DEFECT 1 — Multi View: duplicate file-name headers
// ---------------------------------------------------------------------------
test('DEF1 Multi View single file-name header (headerless strip)', async () => {
  await twoPaneSetup(app, win);
  await win.waitForTimeout(700);

  const data = await win.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const paneHeaders = Array.from(document.querySelectorAll('[data-pane-header]')).map((el) => ({
      pane: el.getAttribute('data-pane'),
      text: norm(el.innerText),
      rect: box(el),
    }));
    const stripHeaders = Array.from(document.querySelectorAll('[data-pane-strip-header]')).map((el) => ({
      pane: el.closest('[data-pane-strip]') ? el.closest('[data-pane-strip]').getAttribute('data-pane-strip-pane') : null,
      text: norm(el.innerText),
      rect: box(el),
    }));
    const stripBodies = Array.from(document.querySelectorAll('[data-pane-strip-body]')).map((el) => ({
      pane: el.closest('[data-pane-strip]') ? el.closest('[data-pane-strip]').getAttribute('data-pane-strip-pane') : null,
      rect: box(el),
    }));
    return { paneHeaders, stripHeaders, stripBodies };
  });

  console.log(`[P35-DEF1] paneHeaders=${JSON.stringify(data.paneHeaders)}`);
  console.log(`[P35-DEF1] stripHeaders=${JSON.stringify(data.stripHeaders)}`);
  console.log(`[P35-DEF1] stripBodies=${JSON.stringify(data.stripBodies)}`);
  const offA = data.stripBodies.find((b) => b.pane === 'A');
  const offB = data.stripBodies.find((b) => b.pane === 'B');
  const hA = data.paneHeaders.find((h) => h.pane === 'A');
  const hB = data.paneHeaders.find((h) => h.pane === 'B');
  console.log(`[P35-DEF1] vertical offset stripBody.top - paneHeader.top: A=${offA && hA ? offA.rect.top - hA.rect.top : null}px B=${offB && hB ? offB.rect.top - hB.rect.top : null}px`);
  console.log(`[P35-DEF1] paneHeader.bottom -> stripBody.top gap: A=${offA && hA ? offA.rect.top - hA.rect.bottom : null}px B=${offB && hB ? offB.rect.top - hB.rect.bottom : null}px`);

  await shot('def291-multi-duplicate-headers.png');

  // DEF-291 (fixed) — the Multi Mode strip is HEADERLESS: the pane header above
  // is the single visible name row, and the strip body starts flush at that
  // header's bottom edge. The old repro asserted TWO name rows (the defect).
  expect(data.paneHeaders.length).toBe(2);
  expect(data.stripHeaders.length, 'no duplicate strip header in Multi Mode').toBe(0);
  expect(data.paneHeaders.every((h) => h.text.length > 0)).toBe(true);
  const gapA = offA && hA ? offA.rect.top - hA.rect.bottom : null;
  const gapB = offB && hB ? offB.rect.top - hB.rect.bottom : null;
  expect(gapA, 'pane A strip body is flush with its pane header').toBe(0);
  expect(gapB, 'pane B strip body is flush with its pane header').toBe(0);
  expect(await win.locator('[data-pane-strip-pane="A"]').getAttribute('aria-label')).toContain('Pane A');
  expect(await win.locator('[data-pane-strip-pane="B"]').getAttribute('aria-label')).toContain('Pane B');
});

// ---------------------------------------------------------------------------
// DEFECT 2 — Multi View: undo after a cross-document page move DELETES the page
// ---------------------------------------------------------------------------
test('DEF2 Multi View undo after cross-document move', async () => {
  await twoPaneSetup(app, win);
  await win.waitForTimeout(700);

  const counts = async (label) => {
    const a = await paneCount(win, 'A');
    const b = await paneCount(win, 'B');
    const d = await win.evaluate(() => {
      const x = window.tflexDiagnostics();
      return { activeTabId: x.activeTabId, multi: x.multiMode ? x.multiMode.enabled : null, focused: x.multiMode ? x.multiMode.focused : null, modified: x.modified, canUndo: x.canUndo };
    });
    console.log(`[P35-DEF2] ${label}: paneA=${a} paneB=${b} total=${a + b} diag=${JSON.stringify(d)}`);
    return { a, b, total: a + b, d };
  };

  const before = await counts('before move');
  expect(before.a).toBe(34);
  expect(before.b).toBe(520);

  const drop = await synthDrag(
    '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]',
    '[data-pane-strip-pane="B"] .thumb-item[data-page="2"]',
  );
  console.log(`[P35-DEF2] synthetic drop defaultPrevented=${drop.defaultPrevented}`);
  const afterMove = await counts('after move A->B');
  await shot('def292-multi-undo-after-move.png');

  // Ctrl+Z with pane B (the TARGET) focused.
  await focusPaneByPage(win, 'B');
  const focusedB = await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused');
  console.log(`[P35-DEF2] pane B focused=${focusedB}`);
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1400);
  const afterUndoB = await counts('after Ctrl+Z (pane B focused)');
  await shot('def292-multi-undo-after-undo-B.png');

  // Then Ctrl+Z with pane A (the SOURCE) focused.
  await focusPaneByPage(win, 'A');
  const focusedA = await win.locator('.tab-pane[data-pane="A"]').getAttribute('data-pane-focused');
  console.log(`[P35-DEF2] pane A focused=${focusedA}`);
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1400);
  const afterUndoA = await counts('after Ctrl+Z (pane A focused)');
  await shot('def292-multi-undo-after-undo-A.png');

  const result = {
    before: before.total,
    afterMove: afterMove.total,
    afterUndoB: afterUndoB.total,
    afterUndoA: afterUndoA.total,
    lostAfterUndoB: before.total - afterUndoB.total,
    lostAfterUndoA: before.total - afterUndoA.total,
  };
  console.log(`[P35-DEF2] RESULT=${JSON.stringify(result)}`);
});

// ---------------------------------------------------------------------------
// DEFECT 3 — Multi View composite tab separator
// ---------------------------------------------------------------------------
test('DEF3 Multi View composite tab separator', async () => {
  await twoPaneSetup(app, win);
  await win.waitForTimeout(700);

  const info = await win.evaluate(() => {
    const el = document.querySelector('.tab[data-tab-id="tf-multi-workspace"] .tab-title');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return {
      innerText: el.innerText,
      textContent: el.textContent,
      titleAttr: el.getAttribute('title'),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      truncated: el.scrollWidth > el.clientWidth + 1,
      rect: { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) },
      tabText: (document.querySelector('.tab[data-tab-id="tf-multi-workspace"]').innerText || '').replace(/\s+/g, ' ').trim(),
    };
  });
  console.log(`[P35-DEF3] composite tab title=${JSON.stringify(info)}`);
  await shot('def293-multi-tab-separator.png');

  expect(info).not.toBeNull();
  // DEF-293 (fixed) — the composite tab separator is " | ", never " + ".
  expect(info.innerText).toContain(' | ');
  expect(info.innerText).not.toContain(' + ');
  expect(info.titleAttr).toContain(' | ');
  expect(info.tabText).toContain(' | ');
  expect(info.tabText).not.toContain(' + ');
});

// ---------------------------------------------------------------------------
// DEFECT 4 — thumbnail page-view header's top-right corner is rounded
// ---------------------------------------------------------------------------
test('DEF4 thumbnail header top-right corner radius', async () => {
  // Single mode first: the promoted ContextPanel (Phase 36 chunk 6 replaced the
  // retired .side-rail / .rail-header).
  await openFile(app, win, tmpCopy(REPORT, 'p35-radius.pdf'));
  await win.waitForTimeout(1500);
  const single = await win.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const cs = getComputedStyle(el);
      return {
        selector: sel,
        borderTopRightRadius: cs.borderTopRightRadius,
        borderTopLeftRadius: cs.borderTopLeftRadius,
        borderBottomRightRadius: cs.borderBottomRightRadius,
        overflow: cs.overflow,
        background: cs.backgroundColor,
        rect: (() => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; })(),
      };
    };
    return {
      railHeader: read('.context-panel-header'),
      sideRail: read('.context-panel'),
      railContent: read('.context-panel-body'),
    };
  });
  console.log(`[P35-DEF4] SINGLE mode=${JSON.stringify(single)}`);
  // DEF-294 (fixed) — the thumbnail panel's top-right corner is SQUARE; the
  // panel keeps its bottom-right radius (the old repro captured the rounded
  // top-right corner as the defect).
  expect(single.sideRail, 'single-mode panel found').not.toBeNull();
  expect(single.sideRail.borderTopRightRadius, 'panel top-right corner is square').toBe('0px');
  expect(single.railHeader.borderTopRightRadius, 'panel header top-right corner is square').toBe('0px');
  expect(single.sideRail.borderBottomRightRadius, 'panel keeps its bottom-right radius').toBe('16px');
  // Hover the panel header so its background paints and the clipped corner is visible.
  await win.locator('.context-panel-header').first().hover();
  await win.waitForTimeout(400);
  await shot('def294-single-rail-header-corner.png');

  // Multi Mode with BOTH panes filled: pane B's strip carries the top-right radius.
  await openFile(app, win, tmpCopy(LONG, 'p35-radius-beta.pdf'));
  await win.waitForTimeout(1200);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p35-radius.pdf' }).first().click();
  await win.waitForTimeout(300);
  // Phase 36 (chunk 3) — the CommandBar row is retired in single mode; the
  // Multi Mode toggle now lives in the All-tools palette.
  await toggleMultiModeViaPalette(win);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'p35-radius-beta' }).first().click();
  await win.waitForTimeout(1500);
  const multi = await win.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const cs = getComputedStyle(el);
      return {
        selector: sel,
        borderTopRightRadius: cs.borderTopRightRadius,
        borderTopLeftRadius: cs.borderTopLeftRadius,
        overflow: cs.overflow,
        background: cs.backgroundColor,
      };
    };
    const stripHeaders = Array.from(document.querySelectorAll('[data-pane-strip-header]')).map((el) => {
      const cs = getComputedStyle(el);
      return { pane: el.closest('[data-pane-strip]').getAttribute('data-pane-strip-pane'), borderTopRightRadius: cs.borderTopRightRadius, background: cs.backgroundColor };
    });
    const strips = Array.from(document.querySelectorAll('[data-pane-strip]')).map((el) => {
      const cs = getComputedStyle(el);
      return { pane: el.getAttribute('data-pane-strip-pane'), borderTopRightRadius: cs.borderTopRightRadius, borderTopLeftRadius: cs.borderTopLeftRadius, overflow: cs.overflow, background: cs.backgroundColor };
    });
    return { stripHeaders, strips, paneHeaderB: read('.tab-pane[data-pane="B"] [data-pane-header]') };
  });
  console.log(`[P35-DEF4] MULTI mode=${JSON.stringify(multi)}`);
  // DEF-294 (fixed) — both pane strips carry square top corners.
  expect(multi.strips.length, 'two pane strips').toBe(2);
  for (const strip of multi.strips) {
    expect(strip.borderTopRightRadius, `pane ${strip.pane} strip top-right corner is square`).toBe('0px');
    expect(strip.borderTopLeftRadius, `pane ${strip.pane} strip top-left corner is square`).toBe('0px');
  }
  // Focus pane B so its pane header paints the accent background under the corner
  // (DEF-291 removed the strip's own header, so hover the pane header instead).
  await win.locator('.tab-pane[data-pane="B"] [data-pane-header]').first().hover();
  await win.waitForTimeout(400);
  await shot('def294-multi-strip-header-corner.png');
});

// ---------------------------------------------------------------------------
// DEFECT 5 — dragging a PDF into TFlex doesn't open it
// ---------------------------------------------------------------------------
test('DEF5 drag-and-drop PDF into TFlex', async () => {
  const pdfBytes = Array.from(fs.readFileSync(REPORT));
  const before = await win.evaluate(() => ({
    href: location.href,
    tabs: document.querySelectorAll('.tab[data-tab-id]').length,
    welcome: !!document.querySelector('.sample-card'),
  }));

  // Dispatch a synthetic OS-style file drop (dragover + drop with a real
  // DataTransfer carrying a File) on the app root and on document.body, and
  // record whether any handler calls preventDefault / opens the file.
  const res = await win.evaluate((bytes) => {
    const out = {};
    const makeDt = () => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array(bytes)], 'dropped.pdf', { type: 'application/pdf' });
      dt.items.add(file);
      return dt;
    };
    for (const sel of ['.app', 'body']) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = { missing: true }; continue; }
      const dt = makeDt();
      const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 200, clientY: 300 });
      el.dispatchEvent(over);
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 200, clientY: 300 });
      el.dispatchEvent(drop);
      out[sel] = { dragoverDefaultPrevented: over.defaultPrevented, dropDefaultPrevented: drop.defaultPrevented, files: dt.files.length, types: Array.from(dt.types) };
    }
    return out;
  }, pdfBytes);
  await win.waitForTimeout(1500);
  const after = await win.evaluate(() => ({
    href: location.href,
    tabs: document.querySelectorAll('.tab[data-tab-id]').length,
    welcome: !!document.querySelector('.sample-card'),
  }));
  console.log(`[P35-DEF5] before=${JSON.stringify(before)}`);
  console.log(`[P35-DEF5] synthetic drop=${JSON.stringify(res)}`);
  console.log(`[P35-DEF5] after=${JSON.stringify(after)}`);
  await shot('def295-dragdrop-pdf.png');
  expect(after.tabs).toBe(before.tabs);
});

// ---------------------------------------------------------------------------
// DEFECT 6 — page zoom in/out has no animation
// ---------------------------------------------------------------------------
test('DEF6 page zoom has no animation', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35-zoom.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  const css = await win.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const cs = getComputedStyle(el);
      return { selector: sel, transition: cs.transition, transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration, transform: cs.transform, animation: cs.animationName };
    };
    return {
      page: read('.pdf-page'),
      slot: read('.page-slot'),
      content: read('.document-content'),
      workspaceMain: read('.workspace-main'),
      scroller: read('.document-scroller'),
    };
  });
  console.log(`[P35-DEF6] computed styles=${JSON.stringify(css)}`);

  // Frame sample: record the page-1 slot width at several times after a zoom-in click.
  const sample = async (label) => {
    const r = await win.evaluate(() => {
      const slot = document.querySelector('.page-slot[data-page="1"]');
      const page = document.querySelector('.pdf-page[data-page="1"]');
      const z = document.querySelector('.zoom-percent');
      return {
        slotW: slot ? Math.round(slot.getBoundingClientRect().width) : null,
        pageW: page ? Math.round(page.getBoundingClientRect().width) : null,
        zoom: z ? z.textContent.trim() : null,
      };
    });
    console.log(`[P35-DEF6] ${label}: ${JSON.stringify(r)}`);
    return r;
  };
  const z0 = await sample('t=before');
  const animsBefore = await win.evaluate(() => document.getAnimations({ subtree: true }).length);
  // Phase 36 (chunk 5) — the floating zoom pill is covered by the Inspector
  // (DEF-319), so drive the SAME zoom path through the Command Palette's
  // `zoomIn` view action (the focused view's own handler).
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  await win.fill('[data-command-palette-input]', 'zoom in');
  await win.waitForTimeout(150);
  await win.locator('[data-palette-tool-id="zoomIn"]').first().click();
  const z1 = await sample('t=0ms (immediately after click)');
  await win.waitForTimeout(16);
  const z2 = await sample('t=16ms');
  await win.waitForTimeout(50);
  const z3 = await sample('t=66ms');
  await win.waitForTimeout(150);
  const z4 = await sample('t=216ms');
  await win.waitForTimeout(300);
  const z5 = await sample('t=516ms');
  const animsAfter = await win.evaluate(() => document.getAnimations({ subtree: true }).length);
  console.log(`[P35-DEF6] animations before=${animsBefore} after=${animsAfter}`);
  console.log(`[P35-DEF6] width sequence=${JSON.stringify([z0.pageW, z1.pageW, z2.pageW, z3.pageW, z4.pageW, z5.pageW])}`);
  await shot('def296-zoom-no-animation.png');
});

// ---------------------------------------------------------------------------
// DEFECT 7 — top-bar transparency lost in single mode (frosted)
// ---------------------------------------------------------------------------
test('DEF7 top-bar transparency in frosted single mode', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35-topbar.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  const theme = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const styles = await win.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const cs = getComputedStyle(el);
      return {
        selector: sel,
        background: cs.backgroundColor,
        backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
        opacity: cs.opacity,
        position: cs.position,
        zIndex: cs.zIndex,
        rect: (() => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; })(),
      };
    };
    return {
      html: read('html'), body: read('body'), app: read('.app'), ambient: read('.tf-ambient'),
      titlebar: read('.titlebar'), appHeader: read('.app-header'),
      toolbar: read('.action-dock'), workspaceMain: read('.workspace-main'), scroller: read('.document-scroller'),
      stage: read('.tab-stage'), pane: read('.tab-pane'),
    };
  });
  console.log(`[P35-DEF7] theme=${theme}`);
  console.log(`[P35-DEF7] styles=${JSON.stringify(styles)}`);

  // What is directly behind the Action Dock's centre (the floating chrome).
  const behind = await win.evaluate(() => {
    const t = document.querySelector('.action-dock');
    if (t === null) return null;
    const r = t.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const stack = document.elementsFromPoint(x, y).map((el) => ({
      tag: el.tagName,
      cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 60),
      bg: getComputedStyle(el).backgroundColor,
    }));
    return { x, y, stack };
  });
  console.log(`[P35-DEF7] behind toolbar centre=${JSON.stringify(behind)}`);

  // Alpha-preserving 1x1 samples: a transparent caption strip keeps alpha < 255,
  // an opaque workspace behind the command toolbar forces alpha = 255.
  const alphaAt = async (x, y) => {
    const buf = await win.screenshot({ omitBackground: true, clip: { x, y, width: 1, height: 1 } });
    const { PNG } = require('pngjs');
    const png = PNG.sync.read(buf);
    return { x, y, r: png.data[0], g: png.data[1], b: png.data[2], a: png.data[3] };
  };
  const alpha = {
    titlebar: await alphaAt(700, 22),
    toolbarGap: await alphaAt(620, 70),
    page: await alphaAt(1200, 400),
  };
  console.log(`[P35-DEF7] alpha samples=${JSON.stringify(alpha)}`);

  // Scroll the page so page content sits under the floating toolbar.
  await win.evaluate(() => { const sc = document.querySelector('.document-scroller'); if (sc) sc.scrollTop = 700; });
  await win.waitForTimeout(900);
  await shot('def297-topbar-frosted-single.png');
  await win.evaluate(() => { const sc = document.querySelector('.document-scroller'); if (sc) sc.scrollTop = 0; });
  await win.waitForTimeout(600);
  await shot('def297-topbar-frosted-single-top.png');
});

// ===========================================================================
// PHASE 35 BASELINE — NOT DEFECTS
// ===========================================================================

// A. Window gestures + caption draggable hit-test.
test('P35-A window gestures and caption hit-test', async () => {
  const getState = () => app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return {
      bounds: w.getBounds(),
      normal: w.getNormalBounds(),
      maximized: w.isMaximized(),
      workArea: screen.getPrimaryDisplay().workArea,
      displays: screen.getAllDisplays().map((d) => ({ bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor })),
    };
  });
  const restore = async (label) => {
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w.isMaximized()) w.unmaximize();
      w.setBounds({ x: 140, y: 90, width: 1100, height: 760 });
    });
    await win.waitForTimeout(700);
    const s = await getState();
    console.log(`[P35-A] ${label}: bounds=${JSON.stringify(s.bounds)} maximized=${s.maximized}`);
    return s;
  };

  const s0 = await restore('restored baseline');
  console.log(`[P35-A] workArea=${JSON.stringify(s0.workArea)} displays=${JSON.stringify(s0.displays)}`);

  // Caption draggable hit-test across the strip.
  const hit = await win.evaluate(() => {
    const strip = document.querySelector('.titlebar');
    const r = strip.getBoundingClientRect();
    const y = Math.round(r.top + r.height / 2);
    const regionOf = (el) => {
      let cur = el;
      while (cur && cur !== document.documentElement) {
        const cs = getComputedStyle(cur);
        const ar = cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region');
        if (ar && ar !== 'none') return ar;
        cur = cur.parentElement;
      }
      return 'none';
    };
    const pts = [];
    for (let i = 0; i <= 40; i += 1) {
      const x = Math.round(r.left + ((r.width - 1) * i) / 40);
      const el = document.elementFromPoint(x, y);
      pts.push({ x, region: el ? regionOf(el) : 'none', hit: el ? (el.className && el.className.toString ? el.className.toString().slice(0, 28) : el.tagName) : null });
    }
    const drag = pts.filter((p) => p.region === 'drag').length;
    return { strip: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, y, pts, dragCount: drag, total: pts.length };
  });
  console.log(`[P35-A] caption strip=${JSON.stringify(hit.strip)} y=${hit.y} draggable=${hit.dragCount}/${hit.total} (${Math.round((hit.dragCount / hit.total) * 100)}%)`);
  console.log(`[P35-A] hit-test=${JSON.stringify(hit.pts)}`);

  // Choose a draggable x near the middle of the draggable run.
  const dragXs = hit.pts.filter((p) => p.region === 'drag').map((p) => p.x);
  const gx = dragXs.length > 0 ? dragXs[Math.floor(dragXs.length / 2)] : Math.round(hit.strip.left + hit.strip.w / 2);
  const gy = hit.y;
  console.log(`[P35-A] gesture origin=(${gx},${gy})`);

  // 1. Double-click the caption strip -> maximise toggle.
  await win.mouse.move(gx, gy);
  await win.mouse.dblclick(gx, gy);
  await win.waitForTimeout(1000);
  const afterDbl = await getState();
  console.log(`[P35-A] after double-click: bounds=${JSON.stringify(afterDbl.bounds)} maximized=${afterDbl.maximized}`);

  // 2. Drag to the top edge -> maximise.
  await restore('before top-edge drag');
  await win.mouse.move(gx, gy);
  await win.mouse.down();
  await win.mouse.move(gx, gy - 30, { steps: 5 });
  await win.mouse.move(gx, 2, { steps: 15 });
  await win.waitForTimeout(250);
  await win.mouse.move(gx, 0, { steps: 4 });
  await win.mouse.up();
  await win.waitForTimeout(1000);
  const afterTop = await getState();
  console.log(`[P35-A] after drag-to-top: bounds=${JSON.stringify(afterTop.bounds)} maximized=${afterTop.maximized}`);

  // 3. Drag to the left edge -> half-screen snap.
  await restore('before left-edge drag');
  await win.mouse.move(gx, gy);
  await win.mouse.down();
  await win.mouse.move(gx - 60, gy, { steps: 6 });
  await win.mouse.move(2, gy, { steps: 15 });
  await win.waitForTimeout(250);
  await win.mouse.move(0, gy, { steps: 4 });
  await win.mouse.up();
  await win.waitForTimeout(1200);
  const afterLeft = await getState();
  console.log(`[P35-A] after drag-to-left: bounds=${JSON.stringify(afterLeft.bounds)} maximized=${afterLeft.maximized}`);

  // 4. Drag to the right edge -> half-screen snap.
  await restore('before right-edge drag');
  const rightX = s0.workArea.x + s0.workArea.width - 1;
  await win.mouse.move(gx, gy);
  await win.mouse.down();
  await win.mouse.move(gx + 60, gy, { steps: 6 });
  await win.mouse.move(rightX - 2, gy, { steps: 15 });
  await win.waitForTimeout(250);
  await win.mouse.move(rightX, gy, { steps: 4 });
  await win.mouse.up();
  await win.waitForTimeout(1200);
  const afterRight = await getState();
  console.log(`[P35-A] after drag-to-right: bounds=${JSON.stringify(afterRight.bounds)} maximized=${afterRight.maximized}`);

  const summary = {
    initial: s0.bounds,
    afterDoubleClick: { bounds: afterDbl.bounds, maximized: afterDbl.maximized },
    afterDragTop: { bounds: afterTop.bounds, maximized: afterTop.maximized },
    afterDragLeft: { bounds: afterLeft.bounds, maximized: afterLeft.maximized },
    afterDragRight: { bounds: afterRight.bounds, maximized: afterRight.maximized },
    workArea: s0.workArea,
    draggablePct: Math.round((hit.dragCount / hit.total) * 100),
  };
  console.log(`[P35-A] SUMMARY=${JSON.stringify(summary)}`);
});

// C. File associations: argv open + single-instance behaviour.
test('P35-C file associations argv and single instance', async () => {
  if (!fs.existsSync(INSTALLED)) {
    console.log('[P35-C] installed exe not found at ' + INSTALLED + ' - argv/single-instance probe skipped');
    return;
  }
  // Close the default dev instance from beforeEach before launching the installed app.
  await hardClose(app, 'p35-c-dev');
  app = null;
  win = null;
  const pdf = tmpCopy(REPORT, 'p35-argv.pdf');
  // Real user-data dir so the single-instance lock namespace matches a normal launch.
  app = await launchApp([pdf], 'default', INSTALLED);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 }).catch(() => {});
  await dismissUpdatePrompt(win).catch(() => {});
  await win.waitForTimeout(3000);
  const argvState = await win.evaluate(() => ({
    tabs: document.querySelectorAll('.tab[data-tab-id]').length,
    workspace: !!document.querySelector('.workspace'),
    welcome: !!document.querySelector('.sample-card'),
    title: document.title,
  }));
  console.log(`[P35-C] first launch with PDF arg: ${JSON.stringify(argvState)}`);

  // Second launch while the first runs: does a second process start?
  const { spawn } = require('node:child_process');
  const child = spawn(INSTALLED, [pdf], { stdio: 'ignore', windowsHide: true });
  let exited = false;
  let code = null;
  let signal = null;
  child.on('exit', (c, s) => { exited = true; code = c; signal = s; });
  const t0 = Date.now();
  while (!exited && Date.now() - t0 < 8000) {
    await win.waitForTimeout(250);
  }
  console.log(`[P35-C] second launch exited=${exited} code=${code} signal=${signal} after ${Date.now() - t0}ms`);
  if (!exited) {
    try {
      require('node:child_process').execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      console.log(`[P35-C] second launch did NOT exit - force-killed pid=${child.pid} (a second process was started)`);
    } catch (e) {
      console.log(`[P35-C] second launch kill failed: ${e.message}`);
    }
  }
  const windowsAfter = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ id: w.id, title: w.getTitle(), visible: w.isVisible() })));
  console.log(`[P35-C] main-instance windows after second launch=${JSON.stringify(windowsAfter)}`);
});

// D. Print: in-app dialog confinement + Microsoft Print to PDF behaviour.
test('P35-D print dialog confinement and PDF printer', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35-print.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);

  const printPage = await openStandalonePrintWindow(app, win);
  const options = await printPage.$$eval('[data-print-printer] option', (opts) => opts.map((o) => ({ text: (o.textContent || '').trim(), value: o.value })));
  console.log(`[P35-D] printers=${JSON.stringify(options)}`);
  const pdfOption = options.find((o) => /pdf/i.test(o.text) || /pdf/i.test(o.value));
  if (pdfOption) await printPage.selectOption('[data-print-printer]', pdfOption.value);
  await printPage.waitForTimeout(500);

  // Confinement: the standalone window is a top-level OS window that lives
  // entirely outside the app window (the in-app modal's clamp is retired).
  const rectBefore = await app.evaluate(({ BrowserWindow }) => {
    const pw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('tfWindow=print'));
    return pw.getBounds();
  });
  console.log(`[P35-D] print window rect (before move)=${JSON.stringify(rectBefore)}`);

  await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const pw = all.find((w) => w.webContents.getURL().includes('tfWindow=print'));
    const main = all.find((w) => !w.webContents.getURL().includes('tfWindow=print'));
    const mb = main.getBounds();
    pw.setBounds({ x: mb.x + mb.width + 200, y: mb.y + 120, width: 820, height: 860 });
  });
  await win.waitForTimeout(500);
  const moved = await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const pw = all.find((w) => w.webContents.getURL().includes('tfWindow=print'));
    const main = all.find((w) => !w.webContents.getURL().includes('tfWindow=print'));
    return { print: pw.getBounds(), main: main.getBounds() };
  });
  console.log(`[P35-D] print window rect (after move)=${JSON.stringify(moved)}`);
  expect(moved.print.x, 'the print window lives outside the app window').toBeGreaterThan(moved.main.x + moved.main.width);

  const windowsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ id: w.id, title: w.getTitle(), visible: w.isVisible() })));
  console.log(`[P35-D] windows before confirm=${JSON.stringify(windowsBefore)}`);
  const mainPid = await app.evaluate(() => process.pid);
  console.log(`[P35-D] main electron pid=${mainPid}`);

  // Click confirm with Microsoft Print to PDF and observe what the user sees.
  await printPage.click('[data-print-confirm]').catch(() => {});
  const seenIds = new Set(windowsBefore.map((w) => w.id));
  const newWindows = [];
  const t0 = Date.now();
  let osWindows = null;
  while (Date.now() - t0 < 25000) {
    await win.waitForTimeout(1000);
    let snap = [];
    try {
      snap = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ id: w.id, title: w.getTitle(), visible: w.isVisible(), destroyed: w.isDestroyed() })));
    } catch (_) { /* main busy with the native dialog */ }
    for (const w of snap) {
      if (!seenIds.has(w.id)) { seenIds.add(w.id); newWindows.push(w); }
    }
    // At ~6s enumerate the OS top-level windows owned by the app process -
    // the native print dialog is NOT a BrowserWindow and only this sees it.
    if (osWindows === null && Date.now() - t0 > 5000) {
      osWindows = listOsWindows(mainPid);
      console.log(`[P35-D] OS windows (pid=${mainPid} or dialog class) at +${Date.now() - t0}ms=${JSON.stringify(osWindows)}`);
    }
  }
  console.log(`[P35-D] new BrowserWindows after confirm=${JSON.stringify(newWindows)}`);
  console.log(`[P35-D] OS windows final=${JSON.stringify(osWindows)}`);
  await shot('p35d-print-after-confirm.png');

  // Clean up any extra OS windows created by the print hand-off.
  await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    all.slice(1).forEach((w) => { try { w.destroy(); } catch (_) { /* ignore */ } });
  }).catch(() => {});
  console.log('[P35-D] extra windows destroyed');
});

// Enumerate OS top-level windows (title/class/pid/visible) for the app process
// and any standard dialog (#32770). Read-only probe; PowerShell is used only to
// call EnumWindows, never to launch or drive the app.
function listOsWindows(pid) {
  const ps = `
$src = @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class WinEnum {
  public delegate bool Proc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(Proc cb, IntPtr l);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  public static List<string> List() {
    var r = new List<string>();
    EnumWindows((h, l) => {
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      uint p; GetWindowThreadProcessId(h, out p);
      r.Add(p + "|" + IsWindowVisible(h) + "|" + c.ToString() + "|" + t.ToString());
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@
Add-Type -TypeDefinition $src
[WinEnum]::List() | Where-Object { $_ -match "^${pid}\\|#32770|Print" }
`;
  try {
    const b64 = Buffer.from(ps, 'utf16le').toString('base64');
    const out = require('node:child_process').execSync(
      `powershell -NoProfile -EncodedCommand ${b64}`,
      { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    return [`enum failed: ${e.message}`];
  }
}

