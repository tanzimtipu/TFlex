/* Adversary Phase 40 probe (evidence artifact, not a Playwright spec - lives in
 * test-fixtures/ so Playwright never collects it). Runs the dev build through
 * the canonical e2e launcher.
 *
 * Usage:  node test-fixtures/adv-p40/probe.cjs <scenario>
 * Prints one JSON line per observation with prefix ADV40.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { launchApp } = require('../../e2e/lib/launch.cjs');

const HERE = __dirname;
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const ROOT = path.resolve(HERE, '..', '..');
const FIX = path.join(ROOT, 'test-fixtures');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (label, obj) => console.log(`ADV40 ${label} ${JSON.stringify(obj)}`);

function samplePath(name) {
  return path.join(ROOT, 'assets', 'samples', name);
}

function tmpCopy(src, tag) {
  const dir = path.join(os.tmpdir(), 'adv40-mrg');
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, `${tag}-${path.basename(src)}`);
  fs.copyFileSync(src, dst);
  return dst;
}

function sha(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

async function setWinSize(app, win, w, h) {
  const bw = await app.browserWindow(win);
  await bw.evaluate((b, size) => {
    b.setSize(size.w, size.h);
  }, { w, h });
  await sleep(500);
}

async function mockMulti(app, paths) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: p });
  }, paths);
}

async function mockCancel(app) {
  await app.evaluate(async ({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
}

async function openSampleCard(win, name) {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1600);
}

// ---- DOM measurement helpers -------------------------------------------------

const MEASURE = () => {
  const scroller = document.querySelector('.document-scroller');
  if (scroller === null) return { error: 'no scroller' };
  const sr = scroller.getBoundingClientRect();
  const pages = Array.from(document.querySelectorAll('.pdf-page')).map((p) => {
    const r = p.getBoundingClientRect();
    const canvas = p.querySelector('canvas');
    const cr = canvas ? canvas.getBoundingClientRect() : null;
    const slot = p.closest('.page-slot');
    const slotR = slot ? slot.getBoundingClientRect() : null;
    const txt = p.querySelector('.textLayer');
    const tr = txt ? txt.getBoundingClientRect() : null;
    return {
      page: slot ? Number(slot.getAttribute('data-page')) : null,
      x: Math.round(r.x - sr.x), y: Math.round(r.y - sr.y),
      w: Math.round(r.width), h: Math.round(r.height),
      canvasW: cr ? Math.round(cr.width) : null,
      canvasH: cr ? Math.round(cr.height) : null,
      slotW: slotR ? Math.round(slotR.width) : null,
      slotH: slotR ? Math.round(slotR.height) : null,
      textW: tr ? Math.round(tr.width) : null,
      textOffX: tr ? Math.round(tr.x - r.x) : null,
      textOffY: tr ? Math.round(tr.y - r.y) : null,
      hasCanvas: !!canvas,
      fullyVisible:
        r.top >= sr.top - 1 && r.bottom <= sr.bottom + 1 &&
        r.left >= sr.left - 1 && r.right <= sr.right + 1,
    };
  });
  const content = document.querySelector('.document-content');
  const cs = content ? getComputedStyle(content) : null;
  const active = document.querySelector('[data-page-layout-active]');
  const input = document.querySelector('.page-input');
  const dock = document.querySelector('[data-action-dock]');
  return {
    mode: content ? content.getAttribute('data-page-layout') : null,
    activeOption: active ? active.getAttribute('data-page-layout-active') : null,
    display: cs ? cs.display : null,
    columns: cs ? cs.gridTemplateColumns : null,
    slotCount: document.querySelectorAll('.page-slot').length,
    mountedPages: pages.length,
    pageTotal: document.querySelectorAll('.page-slot').length,
    readout: input ? input.value : null,
    totalText: (() => { const t = document.querySelector('.page-total'); return t ? t.textContent.trim() : null; })(),
    zoom: (() => { const z = document.querySelector('.zoom-percent'); return z ? z.textContent.trim() : null; })(),
    dockState: dock ? dock.getAttribute('data-dock-state') : null,
    scrollTop: Math.round(scroller.scrollTop),
    scrollerW: Math.round(sr.width),
    scrollerH: Math.round(sr.height),
    pages,
  };
};

function rowsOf(pages) {
  const rows = [];
  const sorted = [...pages].sort((a, b) => a.y - b.y);
  for (const p of sorted) {
    let row = rows.find((r) => Math.abs(r.y - p.y) < 12);
    if (row === undefined) { row = { y: p.y, items: [] }; rows.push(row); }
    row.items.push(p);
  }
  return rows.map((r) => ({
    y: r.y,
    n: r.items.length,
    xs: r.items.map((i) => i.x).sort((a, b) => a - b),
    pages: r.items.map((i) => i.page).sort((a, b) => a - b),
    fully: r.items.filter((i) => i.fullyVisible).length,
    h: r.items[0].h,
  }));
}

async function clickLayout(win, mode) {
  await win.locator(`[data-page-layout-option="${mode}"]`).first().click();
  await win.waitForTimeout(1400);
}

// -----------------------------------------------------------------------------

async function scenarioLayout(app, win) {
  const out = { states: [] };
  const sizes = [
    [1920, 1080, 'wide'],
    [1440, 900, 'std'],
    [900, 700, 'narrow'],
    [720, 1000, 'tallnarrow'],
    [1000, 1300, 'tall'],
  ];
  await openSampleCard(win, 'long.pdf');
  for (const [w, h, tag] of sizes) {
    await setWinSize(app, win, w, h);
    for (const mode of ['one', 'two', 'four']) {
      await clickLayout(win, mode);
      const m = await win.evaluate(MEASURE);
      const st = {
        tag, w, h, mode,
        activeOption: m.activeOption,
        display: m.display,
        slotCount: m.slotCount,
        mountedPages: m.mountedPages,
        readout: m.readout,
        total: m.totalText,
        zoom: m.zoom,
        scrollerW: m.scrollerW,
        scrollerH: m.scrollerH,
        rows: rowsOf(m.pages),
      };
      out.states.push(st);
      if (tag === 'wide' || tag === 'narrow' || tag === 'tallnarrow') {
        await win.screenshot({ path: path.join(SHOTS, `layout-${tag}-${mode}.png`) });
      }
    }
  }
  log('layout-long', out);
}

async function scenarioLayoutSingle(app, win) {
  const out = { states: [] };
  await openSampleCard(win, 'form.pdf');
  for (const [w, h, tag] of [[1920, 1080, 'wide'], [900, 700, 'narrow']]) {
    await setWinSize(app, win, w, h);
    for (const mode of ['one', 'two', 'four']) {
      await clickLayout(win, mode);
      const m = await win.evaluate(MEASURE);
      out.states.push({
        tag, mode, activeOption: m.activeOption, display: m.display,
        slotCount: m.slotCount, mountedPages: m.mountedPages, readout: m.readout,
        total: m.totalText, zoom: m.zoom, rows: rowsOf(m.pages),
      });
      await win.screenshot({ path: path.join(SHOTS, `layout-1pg-${tag}-${mode}.png`) });
    }
  }
  log('layout-1page', out);
}

async function scenarioLayoutGeometry(app, win) {
  // TWO/FOUR: row grouping, canvas size sanity, overlay alignment, jump readout.
  const out = {};
  await openSampleCard(win, 'report.pdf');
  await setWinSize(app, win, 1440, 900);

  await clickLayout(win, 'two');
  let m = await win.evaluate(MEASURE);
  out.two = { rows: rowsOf(m.pages), readout: m.readout, zoom: m.zoom, mounted: m.mountedPages };
  // alignment: canvas and slot width equal, textLayer offset 0
  out.two.align = m.pages.map((p) => ({ page: p.page, w: p.w, slotW: p.slotW, canvasW: p.canvasW, textOffX: p.textOffX, textOffY: p.textOffY }));

  await win.locator('.page-input').first().fill('4');
  await win.locator('.page-input').first().press('Enter');
  await win.waitForTimeout(900);
  m = await win.evaluate(MEASURE);
  out.twoJump = { readout: m.readout, scrollTop: m.scrollTop, rows: rowsOf(m.pages) };

  await clickLayout(win, 'four');
  m = await win.evaluate(MEASURE);
  out.four = { rows: rowsOf(m.pages), readout: m.readout, zoom: m.zoom, mounted: m.mountedPages };
  out.four.align = m.pages.map((p) => ({ page: p.page, w: p.w, h: p.h, slotW: p.slotW, slotH: p.slotH, canvasW: p.canvasW, canvasH: p.canvasH, textOffX: p.textOffX, textOffY: p.textOffY }));

  // rotate page 1 while in FOUR, check overlay alignment after rotation
  await win.keyboard.press('Escape');
  const railTab = win.locator('[data-rail-tab="pages"]').first();
  if (await railTab.count()) { await railTab.click().catch(() => {}); await win.waitForTimeout(600); }
  const thumb = win.locator('[data-panel-thumb][data-page="1"], .thumb[data-page="1"]').first();
  if (await thumb.count()) {
    await thumb.click({ button: 'right' }).catch(() => {});
    await win.waitForTimeout(500);
    const rot = win.locator('[data-menu-item="rotate-cw"]').first();
    if (await rot.count()) { await rot.click().catch(() => {}); await win.waitForTimeout(1200); }
    m = await win.evaluate(MEASURE);
    out.fourAfterRotate = { rows: rowsOf(m.pages), align: m.pages.map((p) => ({ page: p.page, w: p.w, h: p.h, slotW: p.slotW, slotH: p.slotH, canvasW: p.canvasW, canvasH: p.canvasH })) };
  } else {
    out.fourAfterRotate = 'thumb not found';
  }
  await win.screenshot({ path: path.join(SHOTS, 'layout-geometry-four.png') });
  log('layout-geometry', out);
}

async function scenarioJump(app, win) {
  const out = { steps: [] };
  const snap = async (label) => {
    const m = await win.evaluate(MEASURE);
    out.steps.push({
      label, readout: m.readout, scrollTop: m.scrollTop,
      firstVisiblePages: rowsOf(m.pages).filter((r) => r.fully > 0).map((r) => r.pages)[0] || null,
      rows: rowsOf(m.pages).map((r) => ({ y: r.y, pages: r.pages })),
    });
  };
  await openSampleCard(win, 'report.pdf');
  await setWinSize(app, win, 1440, 900);
  await clickLayout(win, 'two');
  await snap('two-open');
  const input = win.locator('.page-input').first();
  // method A: fill + Enter
  await input.fill('4');
  out.valueAfterFill = await input.inputValue();
  await input.press('Enter');
  await win.waitForTimeout(1500);
  await snap('after-fill-4');
  // method B: select-all + type
  await input.click();
  await win.keyboard.press('Control+a');
  await win.keyboard.type('8');
  out.valueAfterType = await input.inputValue();
  await win.keyboard.press('Enter');
  await win.waitForTimeout(1500);
  await snap('after-type-8');
  // method C: use Next-page pill twice from page 1
  await input.click();
  await win.keyboard.press('Control+a');
  await win.keyboard.type('1');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(1200);
  await snap('back-to-1');
  await win.locator('[data-page-pill] button[aria-label="Next page"]').first().click();
  await win.waitForTimeout(1000);
  await snap('next-once');
  await win.locator('[data-page-pill] button[aria-label="Next page"]').first().click();
  await win.waitForTimeout(1000);
  await snap('next-twice');
  // method A2: realistic human click-then-type (no clear)
  const input2 = win.locator('.page-input').first();
  await input2.click();
  out.selAfterClick = await input2.evaluate((el) => ({ value: el.value, ss: el.selectionStart, se: el.selectionEnd }));
  await win.keyboard.type('6');
  out.valueAfterHumanType = await input2.inputValue();
  await win.keyboard.press('Enter');
  await win.waitForTimeout(1400);
  await snap('after-human-type-6');
  log('jump', out);
}

async function scenarioLayoutMulti(app, win) {
  const out = {};
  await openSampleCard(win, 'report.pdf');
  await clickLayout(win, 'four');
  const before = await win.evaluate(MEASURE);
  out.beforeMulti = { mode: before.mode, activeOption: before.activeOption, controlPresent: await win.locator('[data-page-layout-control]').count() };
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(1200);
  out.inMulti = await win.evaluate(() => ({
    controls: document.querySelectorAll('[data-page-layout-control]').length,
    contents: Array.from(document.querySelectorAll('.document-content')).map((c) => c.getAttribute('data-page-layout')),
    paneSlots: Array.from(document.querySelectorAll('.tab-pane[data-pane]')).map((p) => p.querySelectorAll('.page-slot').length),
  }));
  await win.screenshot({ path: path.join(SHOTS, 'layout-multi.png') });
  log('layout-multi', out);
}

async function scenarioLayoutPerf(app, win) {
  // 4-up on the 520-page monster: mount cost, render time, memory growth.
  const out = { phases: [] };
  const memMain = async () => app.evaluate(() => Math.round(process.memoryUsage().rss / 1048576));
  const memRender = async () => win.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
  await openSampleCard(win, 'long.pdf');
  await setWinSize(app, win, 1440, 900);
  await clickLayout(win, 'one');
  await sleep(1200);
  out.phases.push({ phase: 'one', mainMB: await memMain(), renderMB: await memRender(), mounted: (await win.evaluate(MEASURE)).mountedPages });
  for (const mode of ['two', 'four', 'one', 'four']) {
    const t0 = Date.now();
    await win.locator(`[data-page-layout-option="${mode}"]`).first().click();
    // wait for next two animation frames to settle
    await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const tFrame = Date.now() - t0;
    await sleep(1600);
    const m = await win.evaluate(MEASURE);
    out.phases.push({ phase: mode, switchToFrameMs: tFrame, mounted: m.mountedPages, zoom: m.zoom, mainMB: await memMain(), renderMB: await memRender(), rows: rowsOf(m.pages).length });
  }
  // open/close cycler for leak: 6 mode switches
  for (let i = 0; i < 6; i += 1) {
    await win.locator(`[data-page-layout-option="${i % 2 === 0 ? 'two' : 'four'}"]`).first().click();
    await sleep(500);
  }
  out.afterCycles = { mainMB: await memMain(), renderMB: await memRender(), mounted: (await win.evaluate(MEASURE)).mountedPages };
  await win.screenshot({ path: path.join(SHOTS, 'layout-perf.png') });
  log('layout-perf', out);
}

// ---- merge from scratch ------------------------------------------------------

async function readTabs(win) {
  return win.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.tab-list [data-tab-id]')).map((t) => ({
      id: t.getAttribute('data-tab-id'),
      title: (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      modified: !!t.querySelector('.tab-modified-dot:not(.tab-modified-dot-hidden)'),
    }));
    const content = document.querySelector('.document-content');
    const slots = document.querySelectorAll('.page-slot').length;
    const input = document.querySelector('.page-input');
    return {
      tabs,
      pageSlots: slots,
      pageTotal: (() => { const t = document.querySelector('.page-total'); return t ? t.textContent.trim() : null; })(),
      readout: input ? input.value : null,
      saveDisabled: (() => { const b = document.querySelector('[data-toolbar-save]'); return b ? b.disabled : null; })(),
      saveDot: !!document.querySelector('.titlebar-file-dot:not(.titlebar-file-dot-hidden)'),
      toast: (() => { const t = document.querySelector('[data-toast], .toast'); return t ? t.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : null; })(),
    };
  });
}

async function scenarioMerge(app, win, mode) {
  const out = { mode };
  const report = tmpCopy(samplePath('report.pdf'), `a-${mode}`);   // 34 pages
  const form = tmpCopy(samplePath('form.pdf'), `b-${mode}`);       // 1 page
  const long = tmpCopy(samplePath('long.pdf'), `c-${mode}`);       // 520 pages

  if (mode === 'cancel0') { await mockCancel(app); }
  else if (mode === 'one') { await mockMulti(app, [report]); }
  else if (mode === 'two') { await mockMulti(app, [report, form]); }
  else if (mode === 'dup') { await mockMulti(app, [report, report]); }
  else if (mode === 'nonpdf') { await mockMulti(app, [path.join(FIX, 'not-a-pdf.txt')]); }
  else if (mode === 'corrupt') { await mockMulti(app, [path.join(FIX, 'corrupted.pdf'), form]); }
  else if (mode === 'missing') { await mockMulti(app, [path.join(FIX, 'does-not-exist.pdf'), form]); }
  else if (mode === 'many') { await mockMulti(app, [report, form, form, form, form, form, form, form, form, form, form]); }

  const beforeReport = sha(report);
  await win.getByRole('button', { name: /Merge PDFs/i }).first().click();
  await win.waitForTimeout(6000);
  out.after = await readTabs(win).catch((e) => ({ err: String(e) }));
  out.sources = { reportShaUnchanged: sha(report) === beforeReport, reportPages: 34, formPages: 1 };

  // hostile: plain save (Ctrl+S) must not overwrite the first source
  await win.keyboard.press('Control+s');
  await win.waitForTimeout(2500);
  out.afterSave = { reportShaUnchanged: sha(report) === beforeReport, reportMtime: fs.statSync(report).mtimeMs };
  out.saveDisabledAfter = (await readTabs(win)).saveDisabled;
  await win.screenshot({ path: path.join(SHOTS, `merge-${mode}.png`) });
  log('merge', out);
}

async function scenarioMergeWithDoc(app, win) {
  // Open a document first, then Merge -> should open the doc-bound dialog, not from-scratch
  await openSampleCard(win, 'report.pdf');
  await mockMulti(app, [tmpCopy(samplePath('form.pdf'), 'x'), tmpCopy(samplePath('long.pdf'), 'y')]);
  await win.getByText('Merge PDFs').first().click().catch(() => {});
  await win.waitForTimeout(1200);
  const out = await win.evaluate(() => ({
    mergeDialog: document.querySelectorAll('[data-merge-dialog]').length,
    anyDialog: document.querySelectorAll('[role="dialog"]').length,
  }));
  await win.screenshot({ path: path.join(SHOTS, 'merge-with-doc.png') });
  log('merge-with-doc', out);
}

// ---- palette pins ------------------------------------------------------------

async function scenarioPins(app, win) {
  const out = {};
  await openSampleCard(win, 'report.pdf');
  await win.locator('[data-header-tool-search]').first().click();
  await win.waitForSelector('[data-command-palette]', { timeout: 10000 });
  await win.waitForTimeout(500);
  const readPins = () => win.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-palette-row="tool"]')).map((r) => ({
      id: r.getAttribute('data-palette-tool-id'),
      pinned: r.getAttribute('data-palette-pinned'),
      disabled: r.getAttribute('data-palette-disabled'),
      pinState: (() => { const b = r.querySelector('[data-palette-pin-toggle]'); return b ? b.getAttribute('data-palette-pin-state') : null; })(),
    }));
    const dock = Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => ({
      id: v.getAttribute('data-dock-verb'), pin: v.getAttribute('data-dock-pin') !== null,
    }));
    return { rows, dock };
  });
  out.initial = await readPins();
  // count disagreement between palette pinned flag and dock membership
  const disagree = (st) => {
    const dockIds = st.dock.map((d) => d.id);
    return st.rows.filter((r) => (r.pinned === 'true') !== dockIds.includes(r.id)).map((r) => ({ id: r.id, palettePinned: r.pinned, inDock: dockIds.includes(r.id) }));
  };
  out.initialDisagree = disagree(out.initial);

  // refresh rows with a query to find a tool not in the dock's current stage
  await win.locator('[data-command-palette-input]').first().fill('');
  await win.waitForTimeout(400);
  out.refreshDisagree = disagree(await readPins());

  // pin/unpin from palette: pick a couple of rows and compare
  const toggle = async (idx) => {
    const btn = win.locator('[data-palette-row="tool"]').nth(idx).locator('[data-palette-pin-toggle]');
    if (await btn.count()) { await btn.click(); await win.waitForTimeout(700); }
  };
  const before = await readPins();
  out.beforeToggleDisagree = disagree(before);
  for (let i = 0; i < 4; i += 1) { await toggle(i); }
  out.afterToggles = await readPins();
  out.afterToggleDisagree = disagree(out.afterToggles);
  await win.screenshot({ path: path.join(SHOTS, 'pins.png') });
  log('pins', out);
}

async function scenarioPills2(app, win) {
  const out = { states: [] };
  await openSampleCard(win, 'report.pdf');
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(1200);
  await mockMulti(app, [samplePath('form.pdf')]);
  const btn = win.locator('.tab-pane[data-pane="B"] [data-pane-open]').first();
  await btn.waitFor({ state: 'visible', timeout: 15000 });
  await btn.click();
  await win.waitForTimeout(2500);
  out.paneB = await win.evaluate(() => {
    const p = document.querySelector('.tab-pane[data-pane="B"]');
    return p ? { slots: p.querySelectorAll('.page-slot').length, empty: p.hasAttribute('data-pane-empty'), pills: p.querySelectorAll('.canvas-pills').length } : null;
  });
  for (let w = 640; w <= 1920; w += 160) {
    await setWinSize(app, win, w, 800);
    await win.waitForTimeout(350);
    out.states.push({ w, ...(await win.evaluate(PILLS)) });
  }
  await setWinSize(app, win, 900, 1400);
  out.tall = await win.evaluate(PILLS);
  await win.screenshot({ path: path.join(SHOTS, 'pills-2docs.png') });
  log('pills2', out);
}

async function scenarioPinsCap(app, win) {
  const out = {};
  const open = async (q) => {
    if (!(await win.locator('[data-command-palette]').count())) {
      await win.locator('[data-header-tool-search]').first().click();
      await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
    }
    await win.locator('[data-command-palette-input]').fill(q);
    await win.waitForTimeout(450);
  };
  const closePal = async () => { await win.keyboard.press('Escape'); await win.waitForTimeout(350); };
  const toggleFirst = async (id) => {
    const row = win.locator(`[data-palette-tool-id="${id}"]`).first();
    const btn = row.locator('[data-palette-pin-toggle]');
    await btn.click();
    await win.waitForTimeout(600);
    return win.evaluate(() => ({
      notice: (() => { const n = document.querySelector('[data-command-palette-notice]'); return n ? n.textContent.trim() : null; })(),
    }));
  };
  const state = (id) => win.evaluate((tid) => {
    const row = document.querySelector(`[data-palette-tool-id="${tid}"]`);
    const dock = Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => v.getAttribute('data-dock-verb'));
    return {
      palettePinned: row ? row.getAttribute('data-palette-pinned') : null,
      pinState: row && row.querySelector('[data-palette-pin-toggle]') ? row.querySelector('[data-palette-pin-toggle]').getAttribute('data-palette-pin-state') : null,
      inDock: dock.includes(tid),
      dockCount: dock.length,
    };
  }, id);
  await openSampleCard(win, 'report.pdf');
  await open('merge');
  out.mergeBefore = await state('merge');
  out.unpinMerge = await toggleFirst('merge');
  await closePal();
  out.mergeAfterUnpin = await win.evaluate(() => {
    const dock = Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => v.getAttribute('data-dock-verb'));
    return { dock, hasMerge: dock.includes('merge'), dockCount: dock.length };
  });
  // pin four non-default tools to fill the explicit-pin cap
  const extras = ['annotate', 'sign', 'stamp', 'watermark'];
  for (const id of extras) {
    await open(id);
    out[`pin_${id}`] = await toggleFirst(id);
    await closePal();
  }
  out.dockAfterExtras = await win.evaluate(() => Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => ({ id: v.getAttribute('data-dock-verb'), pin: v.getAttribute('data-dock-pin') !== null })));
  // now try to RESTORE the removed default merge: no new pin is needed
  await open('merge');
  out.mergeStateBeforeRestore = await state('merge');
  out.restoreMergeAttempt = await toggleFirst('merge');
  out.mergeStateAfterRestore = await state('merge');
  await closePal();
  out.dockAfterRestore = await win.evaluate(() => Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => v.getAttribute('data-dock-verb')));
  await win.screenshot({ path: path.join(SHOTS, 'pins-cap.png') });
  log('pins-cap', out);
}

async function scenarioOutline(app, win) {
  const out = {};
  await openSampleCard(win, 'report.pdf');
  const railTab = win.locator('[data-rail-tab="pages"]').first();
  if (await railTab.count()) { await railTab.click().catch(() => {}); await win.waitForTimeout(800); }
  const measure = () => win.evaluate(() => {
    const sec = document.querySelector('.context-panel-outline');
    const panel = document.querySelector('.context-panel, .glass-sidebar, .rail-content');
    const body = document.querySelector('.context-panel-outline-body');
    if (!sec) return { present: false };
    const sr = sec.getBoundingClientRect();
    const pr = panel ? panel.getBoundingClientRect() : null;
    return {
      present: true,
      open: sec.getAttribute('data-outline-open'),
      secBottom: Math.round(sr.bottom),
      panelBottom: pr ? Math.round(pr.bottom) : null,
      gap: pr ? Math.round(pr.bottom - sr.bottom) : null,
      secH: Math.round(sr.height),
      secFlex: getComputedStyle(sec).flex,
      bodyH: body ? Math.round(body.getBoundingClientRect().height) : null,
    };
  });
  out.collapsed = await measure();
  const toggle = win.locator('.context-panel-section-toggle').first();
  out.toggleCount = await toggle.count();
  if (await toggle.count()) {
    await toggle.click().catch(() => {});
    await win.waitForTimeout(700);
    out.expanded = await measure();
    await win.screenshot({ path: path.join(SHOTS, 'outline-expanded.png') });
  }
  log('outline', out);
}

async function scenarioPinsHostile(app, win) {
  // hostile dockPins values in settings; check palette + dock agree and no crash
  const out = {};
  const ud = await app.evaluate(({ app }) => app.getPath('userData'));
  out.userData = ud;
  const settingsPath = path.join(ud, 'settings.json');
  out.settingsExists = fs.existsSync(settingsPath);
  if (out.settingsExists) {
    out.settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }
  await win.locator('[data-header-tool-search]').first().click({ timeout: 5000 }).catch(() => {});
  await win.waitForTimeout(1500);
  out.dock = await win.evaluate(() => Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => v.getAttribute('data-dock-verb')));
  out.consoleErrors = await win.evaluate(() => window.__advErrors || []);
  log('pins-hostile', out);
}

// ---- header icons ------------------------------------------------------------

async function scenarioHeader(app, win) {
  const out = {};
  const state = () => win.evaluate(() => ({
    paletteOpen: document.querySelectorAll('[data-command-palette]').length,
    searchBar: document.querySelectorAll('[data-search-bar], .search-bar').length,
    findDisabled: (() => { const b = document.querySelector('[data-header-find]'); return b ? b.disabled : null; })(),
    toolSearchName: (() => { const b = document.querySelector('[data-header-tool-search]'); return b ? b.getAttribute('aria-label') : null; })(),
    findName: (() => { const b = document.querySelector('[data-header-find]'); return b ? b.getAttribute('aria-label') : null; })(),
    toolSearchIcon: (() => { const b = document.querySelector('[data-header-tool-search]'); return b ? b.className : null; })(),
  }));
  out.welcome = await state();
  // find on welcome should be disabled
  await win.locator('[data-header-find]').first().click({ force: true }).catch(() => {});
  await win.waitForTimeout(400);
  out.welcomeAfterFindClick = await state();
  await win.locator('[data-header-tool-search]').first().click();
  await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  await win.waitForTimeout(300);
  out.welcomeToolSearchOpened = await state();
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  await openSampleCard(win, 'report.pdf');
  out.withDoc = await state();
  await win.locator('[data-header-find]').first().click();
  await win.waitForTimeout(500);
  out.withDocAfterFind = await state();
  await win.screenshot({ path: path.join(SHOTS, 'header.png') });
  // rapid click both icons
  for (let i = 0; i < 6; i += 1) {
    await win.locator('[data-header-tool-search]').first().click({ timeout: 3000 }).catch(() => {});
    await win.locator('[data-header-find]').first().click({ timeout: 3000 }).catch(() => {});
  }
  await win.waitForTimeout(600);
  out.afterRapid = await state();
  log('header', out);
}

// ---- pills sweep -------------------------------------------------------------

const PILLS = () => {
  const stage = document.querySelector('.tab-stage');
  const out = { panes: {} };
  for (const paneId of ['A', 'B']) {
    const pane = document.querySelector(`.tab-pane[data-pane="${paneId}"]`);
    if (!pane) continue;
    const pr = pane.getBoundingClientRect();
    const layer = pane.querySelector(`.canvas-pills[data-pill-pane="${paneId}"]`);
    const pagePill = layer ? layer.querySelector('.canvas-pill-page') : null;
    const zoomPill = layer ? layer.querySelector('.canvas-pill-zoom') : null;
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
    const a = rect(pagePill), b = rect(zoomPill);
    const overlap = (p, q) => { if (!p || !q) return null; return !(p.right <= q.x || q.right <= p.x || p.bottom <= q.y || q.bottom <= p.y); };
    const sameRow = (p, q) => { if (!p || !q) return null; return Math.min(p.bottom, q.bottom) - Math.max(p.y, q.y) > 0; };
    out.panes[paneId] = {
      pane: { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) },
      pagePill: a, zoomPill: b, sameRow: sameRow(a, b), overlap: overlap(a, b),
      inside: (p) => null,
      pageInside: a ? (a.x >= pr.x - 1 && a.right <= pr.right + 1 && a.y >= pr.y - 1 && a.bottom <= pr.bottom + 1) : null,
      zoomInside: b ? (b.x >= pr.x - 1 && b.right <= pr.right + 1 && b.y >= pr.y - 1 && b.bottom <= pr.bottom + 1) : null,
    };
  }
  return out;
};

async function scenarioPills(app, win, docs) {
  const out = { docs, states: [] };
  await openSampleCard(win, 'report.pdf');
  if (docs === 2) {
    // open a second doc into pane B
    await openSampleCard(win, 'report.pdf'); // may replace; instead use multi + open into B
  }
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(1000);
  if (docs === 2) {
    await mockMulti(app, [samplePath('form.pdf')]);
    const bOpen = win.locator('.tab-pane[data-pane="B"] [data-pane-open]').first();
    if (await bOpen.count()) { await bOpen.click().catch(() => {}); await win.waitForTimeout(2000); }
  }
  for (let w = 640; w <= 1920; w += 160) {
    await setWinSize(app, win, w, 800);
    await win.waitForTimeout(350);
    const m = await win.evaluate(PILLS);
    out.states.push({ w, ...m });
  }
  // tall window
  await setWinSize(app, win, 900, 1400);
  out.tall = await win.evaluate(PILLS);
  // extreme split
  const div = win.locator('[data-multi-divider]').first();
  if (await div.count()) {
    const box = await div.boundingBox();
    if (box) {
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await win.mouse.down();
      await win.mouse.move(box.x - 220, box.y + box.height / 2, { steps: 4 });
      await win.mouse.up();
      await win.waitForTimeout(700);
      out.splitLow = await win.evaluate(PILLS);
      const box2 = await div.boundingBox();
      await win.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
      await win.mouse.down();
      await win.mouse.move(box2.x + 260, box2.y + box2.height / 2, { steps: 4 });
      await win.mouse.up();
      await win.waitForTimeout(700);
      out.splitHigh = await win.evaluate(PILLS);
    }
  }
  await win.screenshot({ path: path.join(SHOTS, `pills-${docs}docs.png`) });
  log('pills', out);
}

// ---- retirement + right-click menu ------------------------------------------

async function scenarioRetire(app, win) {
  const out = {};
  await openSampleCard(win, 'report.pdf');
  out.barCountSingle = await win.locator('[data-rail-action-bar]').count();
  out.actionBarCount = await win.locator('.rail-actions-bar').count();
  // open pages panel, select a page, ensure no under-thumb bar appears
  const railTab = win.locator('[data-rail-tab="pages"]').first();
  if (await railTab.count()) { await railTab.click().catch(() => {}); await win.waitForTimeout(700); }
  const thumb = win.locator('.thumb[data-page="2"]').first();
  if (await thumb.count()) { await thumb.click().catch(() => {}); await win.waitForTimeout(600); }
  out.barCountAfterSelect = await win.locator('[data-rail-action-bar]').count();

  // run rotate from the dock (select pages first)
  const before = await win.evaluate(() => Array.from(document.querySelectorAll('.page-slot')).map((s) => s.getAttribute('data-source-page')));
  const dockRotate = win.locator('[data-dock-verb="rotate"]').first();
  out.dockRotatePresent = await dockRotate.count();
  if (await dockRotate.count()) { await dockRotate.click().catch(() => {}); await win.waitForTimeout(1200); }
  out.dockRotateAfter = await win.evaluate(() => ({ rot: document.querySelectorAll('.page-slot').length }));

  // right-click a page -> menu has rotate / delete
  await thumb.click({ button: 'right' }).catch(() => {});
  await win.waitForTimeout(500);
  out.menuItems = await win.evaluate(() => Array.from(document.querySelectorAll('[data-menu-item]')).map((m) => m.getAttribute('data-menu-item')));
  await win.screenshot({ path: path.join(SHOTS, 'retire.png') });
  await win.keyboard.press('Escape');
  log('retire', out);
}

// ---- palette contrast --------------------------------------------------------

const CONTRAST = () => {
  function parse(css) {
    const m = css.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function ratio(fg, bg) {
    const l1 = lum(fg), l2 = lum(bg);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  }
  function effBg(el) {
    let n = el;
    while (n) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.01) {
        if (c.a >= 0.999) return c;
        // blend over next
        let parent = effBg(n.parentElement);
        if (!parent) parent = { r: 255, g: 255, b: 255, a: 1 };
        return {
          r: c.r * c.a + parent.r * (1 - c.a),
          g: c.g * c.a + parent.g * (1 - c.a),
          b: c.b * c.a + parent.b * (1 - c.a), a: 1,
        };
      }
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  function probe(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    const bg = effBg(el);
    if (!fg) return null;
    const fga = fg.a < 1 ? { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 } : fg;
    return { ratio: ratio(fga, bg), color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})` };
  }
  const out = { theme: document.documentElement.getAttribute('data-theme'), samples: {} };
  const sels = {
    dockVerb: '[data-dock-verb]',
    dockActive: '.action-dock-verb[aria-pressed="true"], [data-dock-verb].tool-btn-active',
    dockDisabled: '[data-dock-verb][disabled]',
    paletteRow: '[data-palette-row="tool"]',
    palettePin: '[data-palette-pin-toggle]',
    paletteTag: '.command-palette-tag',
    layoutOption: '[data-page-layout-option]',
    layoutActive: '[data-page-layout-option][aria-pressed="true"]',
    headerIcon: '[data-header-tool-search]',
    openLabel: '.titlebar-file-label',
    openBtn: '[data-toolbar-open]',
    saveBtn: '[data-toolbar-save]',
  };
  for (const [k, sel] of Object.entries(sels)) {
    const el = document.querySelector(sel);
    out.samples[k] = probe(el);
  }
  return out;
};

const SAMPLE_ONE = ({ sel }) => {
  function parse(css) {
    const m = css.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function ratio(fg, bg) {
    const l1 = lum(fg), l2 = lum(bg);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  }
  function effBg(el) {
    let n = el;
    while (n) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.01) {
        if (c.a >= 0.999) return c;
        let parent = effBg(n.parentElement);
        if (!parent) parent = { r: 255, g: 255, b: 255, a: 1 };
        return { r: c.r * c.a + parent.r * (1 - c.a), g: c.g * c.a + parent.g * (1 - c.a), b: c.b * c.a + parent.b * (1 - c.a), a: 1 };
      }
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const fg = parse(cs.color);
  const bg = effBg(el);
  if (!fg) return null;
  const fga = fg.a < 1 ? { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 } : fg;
  return { sel, ratio: ratio(fga, bg), color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, cls: el.className };
};

async function scenarioContrast(app, win) {
  const out = { themes: {} };
  await openSampleCard(win, 'report.pdf');
  await win.locator('[data-header-tool-search]').first().click();
  await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  await win.waitForTimeout(400);
  const themes = ['light', 'dark', 'frosted'];
  const SELS = {
    dockVerb: '[data-dock-verb]',
    dockActive: '[data-dock-verb][aria-pressed="true"]',
    dockDisabled: '[data-dock-verb][disabled]',
    paletteRow: '[data-palette-row="tool"]',
    paletteRowDisabled: '[data-palette-row="tool"][data-palette-disabled="true"]',
    palettePinOn: '[data-palette-pin-toggle][data-palette-pin-state="pinned"]',
    palettePinOff: '[data-palette-pin-toggle][data-palette-pin-state="unpinned"]',
    paletteTag: '.command-palette-tag',
    tagRecent: '.command-palette-tag[data-stage="recent"]',
    tagPages: '.command-palette-tag[data-stage="pages"]',
    tagEdit: '.command-palette-tag[data-stage="edit"]',
    tagReview: '.command-palette-tag[data-stage="review"]',
    tagDeliver: '.command-palette-tag[data-stage="deliver"]',
    tagGlobal: '.command-palette-tag[data-stage="global"]',
    layoutOption: '[data-page-layout-option]',
    headerIcon: '[data-header-tool-search]',
    openLabel: '.titlebar-file-label',
    openBtn: '[data-toolbar-open]',
    saveBtn: '[data-toolbar-save]',
    contextPanelTitle: '.context-panel-title, .glass-sidebar-title',
    menuItem: '[data-menu-item]',
  };
  for (const t of themes) {
    await win.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), t);
    await win.waitForTimeout(500);
    const resting = {};
    for (const [k, sel] of Object.entries(SELS)) {
      resting[k] = await win.evaluate(SAMPLE_ONE, { sel });
    }
    out.themes[t] = { resting };
  }
  // hover pass on the active theme (light), plus a pressed-state probe
  await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await win.waitForTimeout(300);
  out.hover = {};
  for (const [k, sel] of Object.entries(SELS)) {
    const el = win.locator(sel).first();
    if (!(await el.count())) { out.hover[k] = null; continue; }
    await el.hover({ force: true }).catch(() => {});
    await win.waitForTimeout(150);
    out.hover[k] = await win.evaluate(SAMPLE_ONE, { sel });
  }
  // pressed: hold mouse down over the open button and the layout option
  out.pressed = {};
  for (const [k, sel] of [['openBtn', '[data-toolbar-open]'], ['layoutOption', '[data-page-layout-option="two"]']]) {
    const box = await win.locator(sel).first().boundingBox().catch(() => null);
    if (!box) { out.pressed[k] = null; continue; }
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    await win.waitForTimeout(150);
    out.pressed[k] = await win.evaluate(SAMPLE_ONE, { sel });
    await win.mouse.up();
    await win.waitForTimeout(150);
  }
  await win.screenshot({ path: path.join(SHOTS, 'contrast.png') });
  log('contrast', out);
}

// ---- create-from-images ------------------------------------------------------

async function scenarioImages(app, win) {
  const out = {};
  await openSampleCard(win, 'report.pdf');
  // open dialog via Ctrl+K
  await win.keyboard.press('Control+k');
  await win.waitForTimeout(500);
  await win.locator('[data-command-palette-input]').fill('images');
  await win.waitForTimeout(400);
  const row = win.locator('[data-palette-tool-id="createFromImages"]').first();
  if (await row.count()) { await row.click(); } else { await win.keyboard.press('Enter'); }
  await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 8000 });
  await win.waitForTimeout(400);

  const rects = () => win.evaluate(() => {
    const dlg = document.querySelector('[data-create-from-images-dialog] [role="dialog"], [data-create-from-images-dialog]');
    const dr = dlg.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const ctrl = ['[data-create-pick]', '[data-create-from-clipboard]', '[data-create-quality]', '[data-create-confirm]'];
    const items = ctrl.map((sel) => {
      const e = document.querySelector(`[data-create-from-images-dialog] ${sel}`);
      if (!e) return { sel, present: false };
      const r = e.getBoundingClientRect();
      return { sel, present: true, x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom),
        inside: r.left >= dr.left - 1 && r.right <= dr.right + 1 && r.top >= dr.top - 1 && r.bottom <= dr.bottom + 1,
        inViewport: r.left >= 0 && r.right <= vw + 1 && r.top >= 0 && r.bottom <= vh + 1 };
    });
    const list = document.querySelector('[data-create-list]');
    let scroll = null;
    if (list) { const lr = list.getBoundingClientRect(); scroll = { h: Math.round(lr.height), scrollH: list.scrollHeight, overflowY: getComputedStyle(list).overflowY, y: Math.round(lr.y), bottom: Math.round(lr.bottom) }; }
    return { dlg: { x: Math.round(dr.x), y: Math.round(dr.y), w: Math.round(dr.width), h: Math.round(dr.height) }, vw, vh, items, scroll };
  });
  out.atDefault = await rects();
  await setWinSize(app, win, 640, 620);
  await win.waitForTimeout(500);
  out.atMin = await rects();
  await win.screenshot({ path: path.join(SHOTS, 'images-min.png') });
  await setWinSize(app, win, 1920, 1080);
  await win.waitForTimeout(400);
  out.atLarge = await rects();

  // add many images via Playwright file chooser
  try {
    const png = path.join(FIX, 'red.png');
    const png2 = path.join(FIX, 'green.png');
    const png3 = path.join(FIX, 'blue.png');
    for (let i = 0; i < 3; i += 1) {
      const [chooser] = await Promise.all([
        win.waitForEvent('filechooser', { timeout: 5000 }),
        win.locator('[data-create-pick]').first().click(),
      ]);
      await chooser.setFiles([png, png2, png3]);
      await win.waitForTimeout(500);
    }
    out.afterPick = await rects();
    out.rows = await win.locator('[data-create-image-row]').count();
    await win.screenshot({ path: path.join(SHOTS, 'images-many.png') });
    // remove some
    for (let i = 0; i < 4; i += 1) {
      const rm = win.locator('[data-create-remove]').last();
      if (await rm.count()) { await rm.click().catch(() => {}); await win.waitForTimeout(200); }
    }
    out.afterRemove = await rects();
    out.rowsAfterRemove = await win.locator('[data-create-image-row]').count();
  } catch (e) {
    out.pickError = String(e).slice(0, 300);
  }
  // many images via one file chooser, then min-size clipping check
  try {
    const png = path.join(FIX, 'red.png');
    const dir = path.join(os.tmpdir(), 'adv40-imgs');
    fs.mkdirSync(dir, { recursive: true });
    const many = [];
    for (let i = 0; i < 30; i += 1) {
      const p = path.join(dir, `img-${String(i).padStart(2, '0')}-with-a-long-name.png`);
      if (!fs.existsSync(p)) fs.copyFileSync(png, p);
      many.push(p);
    }
    const [chooser] = await Promise.all([
      win.waitForEvent('filechooser', { timeout: 8000 }),
      win.locator('[data-create-pick]').first().click(),
    ]);
    await chooser.setFiles(many);
    await win.waitForTimeout(1200);
    out.rowsMany = await win.locator('[data-create-image-row]').count();
    await setWinSize(app, win, 640, 620);
    await win.waitForTimeout(600);
    out.manyAtMin = await rects();
    await win.screenshot({ path: path.join(SHOTS, 'images-many-min.png') });
    await setWinSize(app, win, 1920, 1080);
    await win.waitForTimeout(500);
    out.manyAtLarge = await rects();
    await win.screenshot({ path: path.join(SHOTS, 'images-many-large.png') });
  } catch (e) {
    out.manyError = String(e).slice(0, 300);
  }
  log('images', out);
}

// ---- main --------------------------------------------------------------------

const SCENARIOS = {
  layout: scenarioLayout,
  layoutSingle: scenarioLayoutSingle,
  layoutGeometry: scenarioLayoutGeometry,
  layoutMulti: scenarioLayoutMulti,
  jump: scenarioJump,
  layoutPerf: scenarioLayoutPerf,
  merge: scenarioMerge,
  mergeWithDoc: scenarioMergeWithDoc,
  pins: scenarioPins,
  pinsCap: scenarioPinsCap,
  pills2: scenarioPills2,
  outline: scenarioOutline,
  pinsHostile: scenarioPinsHostile,
  header: scenarioHeader,
  pills: scenarioPills,
  retire: scenarioRetire,
  contrast: scenarioContrast,
  images: scenarioImages,
};

async function main() {
  const name = process.argv[2] || 'layout';
  const arg = process.argv[3];
  const scenario = SCENARIOS[name];
  if (!scenario) { console.error('unknown scenario', name); process.exit(2); }
  const app = await launchApp();
  let win;
  try {
    win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1200);
    await win.evaluate(() => {
      window.addEventListener('pageerror', (e) => { (window.__advErrors = window.__advErrors || []).push(String(e.message)); });
    });
    await scenario(app, win, arg);
  } catch (e) {
    log(`${name}-ERROR`, { error: String(e && e.stack ? e.stack : e).slice(0, 1200) });
  } finally {
    await sleep(400);
    setTimeout(() => process.exit(0), 5000).unref();
    try { await Promise.race([app.close(), sleep(4000)]); } catch { /* ignore */ }
    process.exit(0);
  }
}

main();
