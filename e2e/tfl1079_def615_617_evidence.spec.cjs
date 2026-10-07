// TFL-1079 (qa) — Phase 111 fix-verify evidence for DEF-615 / DEF-616 / DEF-617.
//
// Re-runs the adversary's own facts against the REAL Electron app (not unit
// values): the outline row More menu / "Set destination..." popover anchoring
// and clipping, the deep-indent horizontal overflow at the 240px floor, and the
// tree roles + dismissible retarget surface.
//
// Launch is via the canonical e2e/lib/launch.cjs launcher only.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument, PDFName, PDFString, PDFNumber } = require('@cantoo/pdf-lib');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const TMP = path.join(os.tmpdir(), 'tfl1079-def615');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
const FIXTURE = path.join(TMP, 'tfl1079-nested-outline.pdf');
const PANEL = '[data-context-panel="pages"]';
const OUTLINE_BODY = '[data-context-panel-outline-body]';

let app = null;
let win = null;
test.setTimeout(300000);

// A 12-page PDF whose outline has 24 flat root rows followed by a 10-level
// deep chain (level 1 "Deep 1" ... level 10 "Deep 10"), so the outline scrolls
// and a depth-10 row exists at the 240px floor.
async function buildNestedOutlinePdf(file) {
  const doc = await PDFDocument.create();
  const pages = [];
  for (let i = 0; i < 12; i += 1) pages.push(doc.addPage([612, 792]));
  const ctx = doc.context;
  const root = ctx.obj({ Type: 'Outlines' });
  const rootRef = ctx.register(root);

  const flat = [];
  for (let i = 1; i <= 24; i += 1) flat.push({ title: `Flat ${i}`, page: ((i - 1) % 12) + 1 });
  let deep = { title: 'Deep 10', page: 12 };
  for (let d = 9; d >= 1; d -= 1) deep = { title: `Deep ${d}`, page: d, children: [deep] };
  const specs = [...flat, deep];

  // Recursively register a sibling list under parentRef, linking Prev/Next and
  // setting Parent/First/Last/Count.
  const addSiblings = (list, parentRef) => {
    const refs = list.map((spec) => {
      const item = ctx.obj({ Title: PDFString.of(spec.title), Parent: parentRef });
      const ref = ctx.register(item);
      item.set(PDFName.of('Dest'), ctx.obj([pages[spec.page - 1].ref, 'Fit']));
      if (spec.children) {
        const kids = addSiblings(spec.children, ref);
        item.set(PDFName.of('First'), kids[0]);
        item.set(PDFName.of('Last'), kids[kids.length - 1]);
        item.set(PDFName.of('Count'), PDFNumber.of(kids.length));
      }
      return ref;
    });
    for (let i = 0; i < refs.length; i += 1) {
      const item = ctx.lookup(refs[i]);
      if (i > 0) item.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < refs.length - 1) item.set(PDFName.of('Next'), refs[i + 1]);
    }
    return refs;
  };
  const roots = addSiblings(specs, rootRef);
  root.set(PDFName.of('First'), roots[0]);
  root.set(PDFName.of('Last'), roots[roots.length - 1]);
  root.set(PDFName.of('Count'), PDFNumber.of(roots.length));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  fs.writeFileSync(file, await doc.save());
  return file;
}

test.beforeAll(async () => { await buildNestedOutlinePdf(FIXTURE); });

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1079-def615');
  app = null; win = null;
});

async function openFixture(filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector(`${PANEL} .thumb-item`, { timeout: 30000 });
  await win.waitForTimeout(1500);
}

async function openOutlineView() {
  await win.locator('[data-context-panel-view-tab="outline"]').click();
  await win.waitForSelector(OUTLINE_BODY, { timeout: 10000 });
  await win.waitForTimeout(700);
}

async function setThemeIfNeeded() { /* no-op: fixes are theme-independent */ }

async function shot(name) {
  const file = path.join(SHOTS, `${name}.png`);
  await win.screenshot({ path: file });
  return file;
}

// Opens the More menu at `moreLocator`, then returns the trigger/menu geometry,
// the ancestor body transform, and a hit-test at the menu's Delete row.
async function openRowMenuAndMeasure(moreLocator) {
  const trigger = await moreLocator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, bottom: r.bottom, right: r.right };
  });
  await moreLocator.click();
  await win.waitForSelector('[data-outline-menu="true"]', { timeout: 10000 });
  await win.waitForTimeout(120);
  const measured = await win.evaluate(() => {
    const body = document.querySelector('[data-context-panel-outline-body]');
    const menu = document.querySelector('[data-outline-menu="true"]');
    const m = menu.getBoundingClientRect();
    const del = menu.querySelector('[data-outline-delete]');
    const dr = del ? del.getBoundingClientRect() : null;
    const hit = dr ? document.elementFromPoint(dr.left + dr.width / 2, dr.top + dr.height / 2) : null;
    return {
      bodyTransform: body ? getComputedStyle(body).transform : null,
      bodyRectLeft: body ? body.getBoundingClientRect().left : null,
      menu: { left: m.left, top: m.top, bottom: m.bottom, right: m.right },
      deleteHitInsideMenu: hit !== null && del !== null && (del === hit || del.contains(hit)),
      menuInViewport: m.left >= 0 && m.top >= 0 && m.right <= window.innerWidth && m.bottom <= window.innerHeight,
    };
  });
  const deltaLeft = measured.menu.left - trigger.left;
  const deltaTop = measured.menu.top - trigger.bottom;
  console.log(`[TFL1079 menu] bodyTransform=${measured.bodyTransform} deltaLeft=${deltaLeft.toFixed(1)} deltaTop=${deltaTop.toFixed(1)} hit=${measured.deleteHitInsideMenu} inViewport=${measured.menuInViewport}`);
  return { trigger, ...measured, deltaLeft, deltaTop };
}


// --- DEF-615: menu/popover anchoring with Animations ON (default) ----------
test('TFL1079-DEF615 anchor: row More menu is not offset or clipped (animations ON)', async () => {
  await openFixture(FIXTURE);
  await openOutlineView();

  const first = await openRowMenuAndMeasure(win.locator('[data-outline-more]').first());
  await shot('tfl1079-def615-top-menu');
  expect(first.bodyTransform, 'DEF-615 body transform at rest').toBe('none');
  expect(Math.abs(first.deltaLeft), 'menu left anchored to trigger viewport x').toBeLessThanOrEqual(2);
  expect(first.deltaTop, 'menu top anchored just under the trigger').toBeGreaterThanOrEqual(0);
  expect(first.deltaTop).toBeLessThanOrEqual(8);
  expect(first.deleteHitInsideMenu, 'Delete row is hit-testable (not clipped)').toBe(true);
  await win.keyboard.press('Escape');

  // Bottom of the scrolling outline: the menu must still be fully on screen and
  // its Delete row must be reachable.
  await win.evaluate(() => {
    const p = document.querySelector('.outline-panel');
    p.scrollTop = p.scrollHeight;
  });
  await win.waitForTimeout(300);
  const last = await openRowMenuAndMeasure(win.locator('[data-outline-more]').last());
  await shot('tfl1079-def615-bottom-menu');
  expect(last.menuInViewport, 'bottom-row menu stays inside the viewport').toBe(true);
  expect(last.deleteHitInsideMenu, 'bottom-row Delete row is reachable').toBe(true);
});

// --- DEF-615: same geometry under OS reduced motion -------------------------
test('TFL1079-DEF615 anchor holds under reduced motion', async () => {
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await openFixture(FIXTURE);
  await openOutlineView();
  const m = await openRowMenuAndMeasure(win.locator('[data-outline-more]').first());
  await shot('tfl1079-def615-reduced-motion');
  expect(m.bodyTransform, 'reduced-motion body transform').toBe('none');
  expect(Math.abs(m.deltaLeft)).toBeLessThanOrEqual(2);
  expect(m.deleteHitInsideMenu).toBe(true);
});

// --- DEF-615: same geometry with the Animations preference OFF -------------
test('TFL1079-DEF615 anchor holds with Animations preference OFF', async () => {
  await openFixture(FIXTURE);
  await win.click('[data-stage-rail-gear]');
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.locator('[data-prefs-animations]').uncheck();
  await win.waitForFunction(() => document.documentElement.dataset.animations === 'off', null, { timeout: 10000 });
  await win.click('button[aria-label="Close preferences"]');
  await win.waitForSelector('[data-prefs-dialog]', { state: 'detached', timeout: 10000 });
  await openOutlineView();
  const m = await openRowMenuAndMeasure(win.locator('[data-outline-more]').first());
  await shot('tfl1079-def615-animations-off');
  expect(m.bodyTransform, 'animations-OFF body transform').toBe('none');
  expect(Math.abs(m.deltaLeft)).toBeLessThanOrEqual(2);
  expect(m.deleteHitInsideMenu).toBe(true);
});


// --- DEF-616: no horizontal overflow at the 240px floor ---------------------
test('TFL1079-DEF616 no horizontal overflow and reachable More at the 240px floor', async () => {
  await openFixture(FIXTURE);
  await openOutlineView();
  const handle = win.locator('[data-panel-resize="left"]');
  await handle.focus();
  await win.keyboard.press('Home');
  await win.waitForTimeout(300);
  expect(Number(await handle.getAttribute('aria-valuenow'))).toBe(240);

  const overflow = await win.evaluate(() => {
    const p = document.querySelector('.outline-panel');
    const cs = getComputedStyle(p);
    const rows = [...document.querySelectorAll('[data-outline-row]')];
    let deepest = rows[0];
    for (const r of rows) {
      if (parseFloat(getComputedStyle(r).paddingLeft) > parseFloat(getComputedStyle(deepest).paddingLeft)) deepest = r;
    }
    // TFL-1084 oracle correction (DEF-616): the depth-10 row starts below the
    // fold, so elementFromPoint cannot hit its More without scrolling it into
    // view first. Scroll vertically only - moving scrollLeft would mask a
    // horizontal-overflow regression, which is what this check guards.
    const panelTop = p.getBoundingClientRect().top;
    const rowTopInScroll = deepest.getBoundingClientRect().top - panelTop + p.scrollTop;
    const targetTop = rowTopInScroll - (p.clientHeight - deepest.offsetHeight) / 2;
    p.scrollTop = Math.max(0, Math.min(targetTop, p.scrollHeight));
    const more = deepest.querySelector('[data-outline-more]');
    const mr = more.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    const hit = document.elementFromPoint(mr.left + mr.width / 2, mr.top + mr.height / 2);
    return {
      overflowX: cs.overflowX,
      scrollWidth: p.scrollWidth,
      clientWidth: p.clientWidth,
      deepestIndent: getComputedStyle(deepest).paddingLeft,
      moreRight: mr.right,
      panelRight: pr.right,
      moreInsidePanel: mr.right <= pr.right + 0.5,
      moreReachable: hit !== null && (more === hit || more.contains(hit)),
    };
  });
  console.log('[TFL1079 DEF616] ' + JSON.stringify(overflow));
  await shot('tfl1079-def616-240px-floor');
  expect(overflow.overflowX).toBe('hidden');
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  expect(overflow.moreInsidePanel, 'deep row More stays inside the panel').toBe(true);
  expect(overflow.moreReachable, 'deep row More is hit-testable at the floor').toBe(true);
});

// --- DEF-617: tree roles on the real editable outline -----------------------
test('TFL1079-DEF617 tree roles and aria-selected on the editable outline', async () => {
  await openFixture(FIXTURE);
  await openOutlineView();
  await expect(win.locator('[role="tree"]')).toHaveCount(1);
  const items = win.locator('[role="treeitem"]');
  expect(await items.count()).toBeGreaterThan(0);
  for (const lvl of await items.evaluateAll((els) => els.map((e) => e.getAttribute('aria-level')))) {
    expect(lvl).not.toBeNull();
  }
  expect(await items.evaluateAll((els) => els.filter((e) => e.hasAttribute('aria-expanded')).length)).toBeGreaterThan(0);
  expect(await win.locator('[role="group"]').count()).toBeGreaterThan(0);
  await win.locator('[data-outline-row]').first().click();
  const selected = await win.evaluate(() => document.querySelector('[data-outline-row]').closest('[role="treeitem"]')?.getAttribute('aria-selected'));
  expect(selected).toBe('true');
  await shot('tfl1079-def617-tree-roles');
});

// --- DEF-617: retarget popover dismiss + focus return -----------------------
test('TFL1079-DEF617 retarget popover dismisses on Escape and outside pointer-down', async () => {
  await openFixture(FIXTURE);
  await openOutlineView();
  const more = win.locator('[data-outline-more]').first();
  const pop = win.locator('[data-outline-retarget-popover]');

  await more.click();
  await win.waitForSelector('[data-outline-menu="true"]', { timeout: 10000 });
  await win.locator('[data-outline-retarget-open]').click();
  await expect(pop).toHaveCount(1);
  await shot('tfl1079-def617-retarget-open');
  await win.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  expect(await win.evaluate(() => document.activeElement?.hasAttribute?.('data-outline-more') ?? false), 'focus returns to More on Escape').toBe(true);

  await more.click();
  await win.waitForSelector('[data-outline-menu="true"]', { timeout: 10000 });
  await win.locator('[data-outline-retarget-open]').click();
  await expect(pop).toHaveCount(1);
  // A genuinely outside, non-focusable point: the document stage area.
  const stage = await win.evaluate(() => ({ x: window.innerWidth - 60, y: window.innerHeight - 60 }));
  await win.mouse.click(stage.x, stage.y);
  await expect(pop).toHaveCount(0);
  const active = await win.evaluate(() => {
    const a = document.activeElement;
    return { tag: a ? a.tagName : null, isMore: a?.hasAttribute?.('data-outline-more') ?? false, cls: a?.className ?? null };
  });
  console.log('[TFL1079 DEF617 outside] activeElement=' + JSON.stringify(active));
  expect(active.isMore, 'focus returns to More on outside pointerdown').toBe(true);
});
