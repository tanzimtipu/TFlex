// Phase 35 retest (qa) — DEF-291..DEF-297 after FIX-READY.
//
// Each test asserts the FIXED behaviour (the original repro harness
// e2e/phase35_operator_repro.spec.cjs pinned the buggy behaviour and is left
// as the historical record). Launches only through the canonical launchApp.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const {
  twoPaneSetup,
  focusPaneByPage,
  paneCount,
  openFile,
  tmpCopy,
  REPORT,
  LONG,
} = require('./lib/p33_common.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p35-retest');
  app = null;
  win = null;
});
test.setTimeout(300000);

// --- synthetic HTML5 cross-document drag (same machinery as phase32_drag_drop) --
async function synthStep(step, arg) {
  return win.evaluate(({ step: s, arg: a }) => {
    const KEY = '__p35rtdt';
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
// DEF-291 — Multi Mode strip is headerless and flush
// ---------------------------------------------------------------------------
test('DEF-291 retest: no strip header in Multi Mode, strip flush', async () => {
  // Single mode first: the rail header must still exist (untouched).
  await openFile(app, win, tmpCopy(REPORT, 'p35r-291a.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
  const singleRailHeader = await win.locator('.side-rail .rail-header').count();
  console.log(`[P35R-291] single-mode .side-rail .rail-header count=${singleRailHeader}`);
  expect(singleRailHeader).toBeGreaterThanOrEqual(1);

  // Multi Mode with both panes filled.
  await openFile(app, win, tmpCopy(LONG, 'p35r-291b.pdf'));
  await win.waitForTimeout(1200);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p35r-291a' }).first().click();
  await win.waitForTimeout(300);
  await win.locator('[data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(400);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'p35r-291b' }).first().click();
  await win.waitForTimeout(1500);

  const data = await win.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
    };
    const paneHeaders = Array.from(document.querySelectorAll('[data-pane-header]')).map((el) => ({
      pane: el.getAttribute('data-pane'), text: (el.innerText || '').replace(/\s+/g, ' ').trim(), rect: box(el),
    }));
    const stripHeaders = Array.from(document.querySelectorAll('[data-pane-strip-header]')).map((el) => ({
      pane: el.closest('[data-pane-strip]') ? el.closest('[data-pane-strip]').getAttribute('data-pane-strip-pane') : null,
      text: (el.innerText || '').replace(/\s+/g, ' ').trim(), rect: box(el),
    }));
    const stripBodies = Array.from(document.querySelectorAll('[data-pane-strip-body]')).map((el) => ({
      pane: el.closest('[data-pane-strip]') ? el.closest('[data-pane-strip]').getAttribute('data-pane-strip-pane') : null,
      rect: box(el),
    }));
    return { paneHeaders, stripHeaders, stripBodies };
  });
  console.log(`[P35R-291] paneHeaders=${JSON.stringify(data.paneHeaders)}`);
  console.log(`[P35R-291] stripHeaders=${JSON.stringify(data.stripHeaders)}`);
  console.log(`[P35R-291] stripBodies=${JSON.stringify(data.stripBodies)}`);

  expect(data.paneHeaders.length).toBe(2);
  expect(data.stripHeaders.length).toBe(0);
  expect(data.stripBodies.length).toBe(2);
  for (const pane of ['A', 'B']) {
    const h = data.paneHeaders.find((x) => x.pane === pane);
    const b = data.stripBodies.find((x) => x.pane === pane);
    expect(h).toBeTruthy();
    expect(b).toBeTruthy();
    const gap = b.rect.top - h.rect.bottom;
    console.log(`[P35R-291] pane ${pane}: paneHeader.bottom=${h.rect.bottom} stripBody.top=${b.rect.top} gap=${gap}px`);
    expect(Math.abs(gap)).toBeLessThanOrEqual(1);
  }
});

// ---------------------------------------------------------------------------
// DEF-292 — joint undo from EITHER pane conserves every page
// ---------------------------------------------------------------------------
test('DEF-292 retest: joint undo from either pane conserves 554/554/554/554', async () => {
  await twoPaneSetup(app, win);
  await win.waitForTimeout(700);

  const counts = async (label) => {
    const a = await paneCount(win, 'A');
    const b = await paneCount(win, 'B');
    console.log(`[P35R-292] ${label}: paneA=${a} paneB=${b} total=${a + b}`);
    return { a, b, total: a + b };
  };

  const before = await counts('before move');
  expect(before.a).toBe(34);
  expect(before.b).toBe(520);
  expect(before.total).toBe(554);

  const drop = await synthDrag(
    '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]',
    '[data-pane-strip-pane="B"] .thumb-item[data-page="2"]',
  );
  console.log(`[P35R-292] synthetic drop defaultPrevented=${drop.defaultPrevented}`);
  const afterMove = await counts('after move A->B');
  expect(afterMove.total).toBe(554);

  // Undo with pane B (the TARGET) focused.
  await focusPaneByPage(win, 'B');
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1400);
  const afterUndoB = await counts('after Ctrl+Z (pane B focused)');
  expect(afterUndoB.total).toBe(554);
  expect(afterUndoB.a).toBe(34);
  expect(afterUndoB.b).toBe(520);

  // Undo with pane A (the SOURCE) focused (a no-op after the joint undo).
  await focusPaneByPage(win, 'A');
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1400);
  const afterUndoA = await counts('after Ctrl+Z (pane A focused)');
  expect(afterUndoA.total).toBe(554);

  // Second scenario: move again, then undo from the SOURCE pane first.
  const drop2 = await synthDrag(
    '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]',
    '[data-pane-strip-pane="B"] .thumb-item[data-page="2"]',
  );
  console.log(`[P35R-292] second synthetic drop defaultPrevented=${drop2.defaultPrevented}`);
  const afterMove2 = await counts('after second move A->B');
  expect(afterMove2.total).toBe(554);
  await focusPaneByPage(win, 'A');
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1400);
  const afterUndoA2 = await counts('after Ctrl+Z from SOURCE pane A');
  expect(afterUndoA2.total).toBe(554);
  expect(afterUndoA2.a).toBe(34);
  expect(afterUndoA2.b).toBe(520);

  console.log(`[P35R-292] RESULT=${JSON.stringify({
    before: before.total, afterMove: afterMove.total, afterUndoB: afterUndoB.total,
    afterUndoA: afterUndoA.total, afterMove2: afterMove2.total, afterUndoA2: afterUndoA2.total,
  })}`);
});

// ---------------------------------------------------------------------------
// DEF-293 — composite tab separator is " | "
// ---------------------------------------------------------------------------
test('DEF-293 retest: composite tab separator is " | "', async () => {
  await twoPaneSetup(app, win);
  await win.waitForTimeout(700);

  const info = await win.evaluate(() => {
    const el = document.querySelector('.tab[data-tab-id="tf-multi-workspace"] .tab-title');
    if (el === null) return null;
    return {
      innerText: el.innerText,
      textContent: el.textContent,
      titleAttr: el.getAttribute('title'),
      tabText: (document.querySelector('.tab[data-tab-id="tf-multi-workspace"]').innerText || '').replace(/\s+/g, ' ').trim(),
    };
  });
  console.log(`[P35R-293] composite tab title=${JSON.stringify(info)}`);
  expect(info).not.toBeNull();
  expect(info.innerText).toContain(' | ');
  expect(info.innerText).not.toContain(' + ');
  expect(info.titleAttr).toContain(' | ');
});

// ---------------------------------------------------------------------------
// DEF-294 — thumbnail header top-right corner is square
// ---------------------------------------------------------------------------
test('DEF-294 retest: thumbnail panel top corner radius 0', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35r-294a.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
  const single = await win.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const cs = getComputedStyle(el);
      return { selector: sel, borderTopRightRadius: cs.borderTopRightRadius, borderTopLeftRadius: cs.borderTopLeftRadius, borderBottomRightRadius: cs.borderBottomRightRadius, overflow: cs.overflow };
    };
    return { railHeader: read('.side-rail .rail-header'), sideRail: read('.side-rail') };
  });
  console.log(`[P35R-294] SINGLE=${JSON.stringify(single)}`);
  expect(single.sideRail).not.toBeNull();
  expect(single.sideRail.borderTopRightRadius).toBe('0px');
  expect(single.railHeader.borderTopRightRadius).toBe('0px');

  await openFile(app, win, tmpCopy(LONG, 'p35r-294b.pdf'));
  await win.waitForTimeout(1200);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p35r-294a' }).first().click();
  await win.waitForTimeout(300);
  await win.locator('[data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(400);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'p35r-294b' }).first().click();
  await win.waitForTimeout(1500);
  const multi = await win.evaluate(() => {
    const strips = Array.from(document.querySelectorAll('[data-pane-strip]')).map((el) => {
      const cs = getComputedStyle(el);
      return { pane: el.getAttribute('data-pane-strip-pane'), borderTopRightRadius: cs.borderTopRightRadius, borderTopLeftRadius: cs.borderTopLeftRadius, overflow: cs.overflow };
    });
    return { strips };
  });
  console.log(`[P35R-294] MULTI=${JSON.stringify(multi)}`);
  const stripA = multi.strips.find((s) => s.pane === 'A');
  const stripB = multi.strips.find((s) => s.pane === 'B');
  expect(stripA).toBeTruthy();
  expect(stripB).toBeTruthy();
  expect(stripB.borderTopRightRadius).toBe('0px');
  expect(stripA.borderTopLeftRadius).toBe('0px');
});
// ---------------------------------------------------------------------------
// DEF-295 � OS file drop: defaults prevented + open through the shared path
// ---------------------------------------------------------------------------
test('DEF-295 retest: drop handler prevents defaults; openPathRequest opens', async () => {
  // (a) Unit-level drop behaviour in the real renderer: a Files drag is
  // prevented on both dragover and drop; a text/plain drag is left alone.
  const pdfBytes = Array.from(fs.readFileSync(REPORT));
  const dropRes = await win.evaluate((bytes) => {
    const out = {};
    const makeDt = (withFile) => {
      const dt = new DataTransfer();
      if (withFile) dt.items.add(new File([new Uint8Array(bytes)], 'dropped.pdf', { type: 'application/pdf' }));
      return dt;
    };
    // Files drag on window (the handler is window-level).
    const dtFiles = makeDt(true);
    const overFiles = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dtFiles, clientX: 200, clientY: 300 });
    window.dispatchEvent(overFiles);
    const dropFiles = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dtFiles, clientX: 200, clientY: 300 });
    window.dispatchEvent(dropFiles);
    out.files = { dragoverDefaultPrevented: overFiles.defaultPrevented, dropDefaultPrevented: dropFiles.defaultPrevented, types: Array.from(dtFiles.types) };
    // text/plain drag (the in-app page drag) must NOT be prevented.
    const dtText = new DataTransfer();
    dtText.setData('text/plain', 'page:1');
    const overText = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dtText, clientX: 200, clientY: 300 });
    window.dispatchEvent(overText);
    const dropText = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dtText, clientX: 200, clientY: 300 });
    window.dispatchEvent(dropText);
    out.text = { dragoverDefaultPrevented: overText.defaultPrevented, dropDefaultPrevented: dropText.defaultPrevented, types: Array.from(dtText.types) };
    return out;
  }, pdfBytes);
  console.log(`[P35R-295] drop handler=${JSON.stringify(dropRes)}`);
  expect(dropRes.files.dragoverDefaultPrevented).toBe(true);
  expect(dropRes.files.dropDefaultPrevented).toBe(true);
  expect(dropRes.text.dragoverDefaultPrevented).toBe(false);
  expect(dropRes.text.dropDefaultPrevented).toBe(false);
  // A synthetic File resolves to an empty path -> the handler fails loud.
  await win.waitForTimeout(600);
  const toast = await win.locator('.toast-text').allInnerTexts().catch(() => []);
  console.log(`[P35R-295] toasts after synthetic drop=${JSON.stringify(toast)}`);

  // (b) End-to-end open through the SAME renderer path main uses: push
  // app:openPathRequest from the main process (a synthetic File cannot).
  const pdfPath = tmpCopy(REPORT, 'p35r-295-open.pdf');
  const before = await win.evaluate(() => document.querySelectorAll('.tab[data-tab-id]').length);
  await app.evaluate(({ BrowserWindow }, p) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.send('app:openPathRequest', p);
  }, pdfPath);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(800);
  const after = await win.evaluate(() => ({
    tabs: document.querySelectorAll('.tab[data-tab-id]').length,
    welcome: !!document.querySelector('.sample-card'),
  }));
  console.log(`[P35R-295] single-mode push: beforeTabs=${before} after=${JSON.stringify(after)}`);
  expect(after.tabs).toBe(before + 1);
  expect(after.welcome).toBe(false);
});

test('DEF-295 retest: openPathRequest assigns to the focused pane in Multi Mode', async () => {
  await twoPaneSetup(app, win);
  await win.waitForTimeout(700);
  await focusPaneByPage(win, 'B');
  const gamma = tmpCopy(REPORT, 'p35r-295-gamma.pdf');
  await app.evaluate(({ BrowserWindow }, p) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.send('app:openPathRequest', p);
  }, gamma);
  await win.waitForTimeout(2500);
  const headers = await win.evaluate(() => Array.from(document.querySelectorAll('[data-pane-header]')).map((el) => ({
    pane: el.getAttribute('data-pane'),
    text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
  })));
  console.log(`[P35R-295] multi pane headers after push=${JSON.stringify(headers)}`);
  const b = headers.find((h) => h.pane === 'B');
  expect(b).toBeTruthy();
  expect(b.text).toContain('p35r-295-gamma');
});

// ---------------------------------------------------------------------------
// DEF-296 � zoom animates; suppressed under reduced motion / Animations off
// ---------------------------------------------------------------------------
async function installZoomProbe() {
  await win.evaluate(() => {
    window.__zoomProbe = { seen: false, cls: null, from: null, anims: [] };
    const obs = new MutationObserver(() => {
      const el = document.querySelector('.pdf-page');
      if (el && el.classList.contains('pdf-page-zoom-flip')) {
        window.__zoomProbe.seen = true;
        window.__zoomProbe.cls = el.className;
        window.__zoomProbe.from = el.style.getPropertyValue('--tf-zoom-flip-from');
        window.__zoomProbe.anims = document.getAnimations({ subtree: true }).map((a) => a.animationName);
      }
    });
    obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    window.__zoomProbeObs = obs;
  });
}
async function readZoomProbe() {
  return win.evaluate(() => window.__zoomProbe);
}

test('DEF-296 retest: zoom plays the FLIP animation', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35r-296.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await installZoomProbe();
  await win.locator('button[aria-label="Zoom in"]').first().click();
  await win.waitForTimeout(600);
  const probe = await readZoomProbe();
  console.log(`[P35R-296] zoom probe=${JSON.stringify(probe)}`);
  expect(probe.seen).toBe(true);
  expect(probe.cls).toContain('pdf-page-zoom-flip');
  expect(Number(probe.from)).toBeGreaterThan(0);
  expect(probe.anims).toContain('tf-page-zoom-flip');
});

test('DEF-296 retest: reduced motion suppresses the zoom animation', async () => {
  // Drive the OS reduced-motion media feature through CDP (no relaunch race).
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.waitForTimeout(400);
  const reduced = await win.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  console.log(`[P35R-296] prefers-reduced-motion matches=${reduced}`);
  expect(reduced).toBe(true);
  await openFile(app, win, tmpCopy(REPORT, 'p35r-296-rm.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await installZoomProbe();
  await win.locator('button[aria-label="Zoom in"]').first().click();
  await win.waitForTimeout(600);
  const probe = await readZoomProbe();
  console.log(`[P35R-296] reduced-motion zoom probe=${JSON.stringify(probe)}`);
  expect(probe.seen).toBe(false);
});

test('DEF-296 retest: Animations off suppresses the zoom animation', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35r-296-off.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
  // Turn Animations off through the real Preferences control.
  await win.locator('[data-open-preferences]').first().click();
  await win.waitForSelector('[data-prefs-animations]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-prefs-animations]').first().uncheck();
  await win.waitForTimeout(400);
  const htmlAttr = await win.evaluate(() => document.documentElement.getAttribute('data-animations'));
  console.log(`[P35R-296] data-animations=${htmlAttr}`);
  expect(htmlAttr).toBe('off');
  await win.locator('[aria-label="Close preferences"]').first().click();
  await win.waitForTimeout(500);
  await installZoomProbe();
  await win.locator('button[aria-label="Zoom in"]').first().click();
  await win.waitForTimeout(600);
  const probe = await readZoomProbe();
  console.log(`[P35R-296] animations-off zoom probe=${JSON.stringify(probe)}`);
  expect(probe.seen).toBe(false);
});

// ---------------------------------------------------------------------------
// DEF-297 � frosted top bar reads as glass; canvas stays opaque
// ---------------------------------------------------------------------------
test('DEF-297 retest: frosted top bar glass restored, canvas opaque', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35r-297.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  const theme = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const styles = await win.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const cs = getComputedStyle(el);
      return { selector: sel, background: cs.backgroundColor, backgroundImage: cs.backgroundImage, backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter };
    };
    return {
      titlebar: read('.titlebar'), toolbar: read('.toolbar'),
      workspaceMain: read('.workspace-main'), scroller: read('.document-scroller'),
    };
  });
console.log(`[P35R-297] theme=${theme}`);
  console.log(`[P35R-297] styles=${JSON.stringify(styles)}`);
  expect(theme).toBe('frosted');
  expect(styles.toolbar.backdropFilter).toMatch(/blur/);
  // The workspace frame steps aside (transparent) so the bar has something to diffuse.
  expect(styles.workspaceMain.background).toBe('rgba(0, 0, 0, 0)');
  // The scroller confines the opaque canvas below the chrome band: transparent
  // above --tf-chrome-y, the opaque canvas colour from there down.
  expect(styles.scroller.backgroundImage).toMatch(/linear-gradient/);
  expect(styles.scroller.backgroundImage).toMatch(/rgba\(0, 0, 0, 0\)/);
  expect(styles.scroller.backgroundImage).toMatch(/rgb\(238, 241, 245\)/);

  // What sits directly behind the toolbar's centre: the glass must have a
  // transparent surface to diffuse (not a flat opaque sheet).
  const behind = await win.evaluate(() => {
    const t = document.querySelector('.toolbar');
    if (t === null) return null;
    const r = t.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const stack = document.elementsFromPoint(x, y).map((el) => ({
      tag: el.tagName,
      cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 48),
      bg: getComputedStyle(el).backgroundColor,
      bgImage: getComputedStyle(el).backgroundImage,
    }));
    return { x, y, stack };
  });
  console.log(`[P35R-297] behind toolbar centre=${JSON.stringify(behind)}`);
  const behindToolbar = behind.stack.find((s) => s.cls.includes('workspace-main') || s.cls.includes('document-scroller'));
  expect(behindToolbar).toBeTruthy();
  expect(behindToolbar.bg).toBe('rgba(0, 0, 0, 0)');

  // The page surface itself stays opaque (the canvas the pages sit on).
  const pageOpaque = await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const page = document.querySelector('.pdf-page');
    return {
      scrollerBgImage: sc ? getComputedStyle(sc).backgroundImage : null,
      pagePresent: page !== null,
      pageBg: page ? getComputedStyle(page).backgroundColor : null,
    };
  });
  console.log(`[P35R-297] page surface=${JSON.stringify(pageOpaque)}`);
  expect(pageOpaque.pagePresent).toBe(true);
  expect(pageOpaque.scrollerBgImage).toMatch(/rgb\(238, 241, 245\)/);
});
