// Release hygiene smoke for the SHIPPED 1.45.2 packaged build.
//
// The artifact is the byte-identical packaged payload of the published 1.45.2
// installer/portable: release/win-unpacked/Jovrel.exe. Its absolute path is
// supplied through TFLEX_E2E_EXE and launchApp (e2e/lib/launch.cjs) honours it
// when no explicit executablePath is passed. Missing/incorrect env is FAIL, not
// a silent skip.
//
// Verifies: boot, bundled-sample open + Action Dock, this release's head-line
// changes in the PACKAGED build (tab title not selectable + title-origin
// reorder; usable tab strip at a real 640px window; non-PDF drop opens
// (DEF-418); native form fill re-reads), and the About dialog's 1.45.2 What's
// New entry.
//
// Run with:
//   $env:TFLEX_E2E_EXE='<abs>\release\win-unpacked\Jovrel.exe'
//   npx.cmd playwright test release_1452_smoke.spec.cjs
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, dismissUpdatePrompt } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const EXE = process.env.TFLEX_E2E_EXE;
const NONPDF = path.join(ROOT, 'test-fixtures', 'phase53', 'sample.txt');

test.setTimeout(300000);

let app = null;
let win = null;

test.beforeAll(async () => {
  if (!EXE) {
    throw new Error(
      'TFLEX_E2E_EXE is not set - this spec verifies the PACKAGED build only. ' +
      'Set TFLEX_E2E_EXE to the absolute release/win-unpacked/Jovrel.exe path and rerun.',
    );
  }
  expect(fs.existsSync(EXE), `packaged exe not found at TFLEX_E2E_EXE=${EXE}`).toBe(true);
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => typeof window.tflex !== 'undefined', null, { timeout: 30000 });
});

test.afterAll(async () => {
  if (app) await hardClose(app, 'rel1452');
});

async function tabCount() {
  return win.evaluate(() => document.querySelectorAll('[data-tab-id]').length);
}

async function tabOrder() {
  return win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-tab-id]')).map((el) => el.getAttribute('data-tab-id')));
}

async function activeTabId() {
  return win.evaluate(() => {
    const el = document.querySelector('[data-tab-id][aria-selected="true"]');
    return el === null ? null : el.getAttribute('data-tab-id');
  });
}

async function toasts() {
  return win.evaluate(() => Array.from(document.querySelectorAll('.toast-text')).map((e) => e.textContent));
}

/** Open a bundled sample through the real toolbar Open button (dialog stubbed). */
async function openBundledSample(sampleName) {
  const p = path.join(ROOT, 'assets', 'samples', sampleName);
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(1400);
}

/** Dispatch a real OS file-drop at the window centre via CDP (DEF-418 technique). */
async function dropFile(filePath) {
  const client = await app.context().newCDPSession(win);
  const box = await win.evaluate(() => {
    const el = document.querySelector('.workspace') || document.body;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  const data = { items: [], files: [filePath], dragOperationsMask: 1 };
  await client.send('Input.dispatchDragEvent', { type: 'dragEnter', x: box.x, y: box.y, data });
  await client.send('Input.dispatchDragEvent', { type: 'dragOver', x: box.x, y: box.y, data });
  await client.send('Input.dispatchDragEvent', { type: 'drop', x: box.x, y: box.y, data });
}

/** Resize the real window (unmaximize first - a maximized window ignores setSize). */
async function setWidth(w) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) { bw.unmaximize(); bw.setSize(s[0], s[1]); }
  }, [w, 900]);
  await win.waitForTimeout(650);
  await win.waitForFunction((t) => Math.abs(window.innerWidth - t) < 60, w, { timeout: 10000 });
}

/** Drag a tab by its TITLE text to an absolute viewport X. */
async function dragTabByTitle(tabId, targetX) {
  const title = win.locator(`[data-tab-id="${tabId}"] .tab-title`);
  const box = await title.boundingBox();
  const startX = box.x + Math.min(6, box.width / 2);
  const y = box.y + box.height / 2;
  await win.mouse.move(startX, y);
  await win.mouse.down();
  await win.mouse.move(startX - 10, y, { steps: 3 }); // cross the 6px arm threshold
  await win.mouse.move(targetX, y, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(500);
}

test('packaged 1.45.2 boots, opens a sample, carries the release features', async () => {
  // 1. Boot: welcome/workspace renders, no error page.
  await win.waitForSelector('.sample-card', { timeout: 60000 });
  await dismissUpdatePrompt(win);
  const bodyText = await win.evaluate(() => document.body.innerText);
  expect(bodyText, 'no error page').not.toMatch(/something went wrong|failed to load|uncaught exception/i);
  console.log('[rel1452] boot ok');

  // 2. Open a bundled sample PDF -> tab + Action Dock verbs.
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 60000 });
  await expect(win.locator('[data-tab-id]')).toHaveCount(1, { timeout: 60000 });
  const dockVerbs = await win.locator('[data-dock-verb]').count();
  expect(dockVerbs, 'Action Dock renders at least one verb').toBeGreaterThan(0);
  console.log(`[rel1452] sample open: tabs=1 dockVerbs=${dockVerbs}`);

  // 3a. A second document so the strip has a background tab to drag.
  await openBundledSample('long.pdf');
  await expect(win.locator('[data-tab-id]')).toHaveCount(2, { timeout: 30000 });
  await win.waitForTimeout(500);

  // 3b. The tab TITLE is NOT selectable: a drag-select across a background
  //     tab's title yields an EMPTY selection.
  const order0 = await tabOrder();
  const active0 = await activeTabId();
  const selTab = order0.find((id) => id !== active0);
  expect(selTab, 'a background tab exists').toBeTruthy();
  const titleUserSelect = await win.locator(`[data-tab-id="${selTab}"] .tab-title`).evaluate(
    (el) => getComputedStyle(el).userSelect,
  );
  const textRect = await win.locator(`[data-tab-id="${selTab}"] .tab-title`).evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    if (node === null) return null;
    const r = document.createRange();
    r.selectNodeContents(node);
    const rect = r.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, height: rect.height };
  });
  expect(textRect, 'title has a text node').not.toBeNull();
  const y = textRect.top + textRect.height / 2;
  const startX = textRect.left + 1;
  const endX = textRect.right + 10;
  await win.mouse.move(startX, y);
  await win.mouse.down();
  for (let x = startX + 3; x <= endX; x += 3) await win.mouse.move(x, y);
  await win.mouse.up();
  await win.waitForTimeout(300);
  const selection = await win.evaluate(() => window.getSelection().toString());
  console.log(`[rel1452] title user-select=${titleUserSelect} selection=${JSON.stringify(selection)} (expected empty)`);
  expect(titleUserSelect, 'the tab title is user-select: none').toBe('none');
  expect(selection, 'drag-select across the title selects NO text').toBe('');

  // 3c. A drag starting on the TITLE still reorders the strip.
  const orderBefore = await tabOrder();
  const dragId = orderBefore[orderBefore.length - 1];
  const firstBox = await win.locator(`[data-tab-id="${orderBefore[0]}"]`).boundingBox();
  await dragTabByTitle(dragId, firstBox.x + 2);
  const orderAfter = await tabOrder();
  console.log(`[rel1452] title-origin drag ${dragId}: before=${JSON.stringify(orderBefore)} after=${JSON.stringify(orderAfter)}`);
  expect(orderAfter[0], 'a title-origin drag moved the last tab to the front').toBe(dragId);

  // 3d. At a real 640px window the tab strip keeps a usable width and the
  //     active tab + its close stay reachable.
  await setWidth(640);
  const m640 = await win.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const list = q('.tab-list');
    const area = q('.tab-area');
    const active = q('.tab[data-tab-id][aria-selected="true"]') || q('[data-tab-id]');
    const title = active ? active.querySelector('.tab-title') : null;
    const close = active ? active.querySelector('.tab-close') : null;
    const lr = list.getBoundingClientRect();
    const tr = title ? title.getBoundingClientRect() : null;
    const visibleTitleW = tr ? Math.max(0, Math.min(tr.right, lr.right) - Math.max(tr.left, lr.left)) : 0;
    const hit = (el) => {
      if (!el) return { resolves: false, top: 'none' };
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return { resolves: top === el || el.contains(top), top: top ? `${top.tagName}.${String(top.className)}` : 'none' };
    };
    list.scrollLeft = 0;
    const staticClose = hit(close);
    list.scrollLeft = list.scrollWidth;
    const scrolledClose = hit(close);
    list.scrollLeft = 0;
    return {
      innerW: window.innerWidth,
      areaW: area.clientWidth,
      listClientW: list.clientWidth,
      visibleTitleW: Math.round(visibleTitleW),
      staticClose,
      scrolledClose,
    };
  });
  console.log(`[rel1452|640] ${JSON.stringify(m640)}`);
  expect(m640.innerW, 'window is really ~640px wide').toBeLessThan(760);
  expect(m640.areaW, '640: tab strip has a usable width').toBeGreaterThan(60);
  expect(m640.visibleTitleW, '640: active tab title is visible/reachable').toBeGreaterThan(0);
  expect(m640.scrolledClose.resolves, `640: active tab close reachable (top=${m640.scrolledClose.top})`).toBe(true);
  await setWidth(1440);

  // 3e. Drag-drop a NON-PDF fixture opens it (DEF-418), no "is not a PDF" toast.
  const before = await tabCount();
  await dropFile(NONPDF);
  let after = before;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    after = await tabCount().catch(() => before);
    if (after > before) break;
    await win.waitForTimeout(250);
  }
  const toastTexts = await toasts().catch(() => []);
  console.log(`[rel1452] drop txt: before=${before} after=${after} toasts=${JSON.stringify(toastTexts)}`);
  expect(after, 'non-PDF drop opened a tab').toBeGreaterThan(before);
  expect(toastTexts.join(' | '), 'no "is not a PDF" toast').not.toMatch(/is not a PDF/i);

  // 3f. Native form fill: a filled value re-reads from the document's own field.
  await openBundledSample('form.pdf');
  await win.waitForFunction(() => {
    const d = window.tflexDiagnostics();
    return d.hasFormFields === true && (d.formFields || []).length > 0;
  }, null, { timeout: 40000 });
  await win.waitForTimeout(500);
  const textField = await win.evaluate(() => {
    const f = (window.tflexDiagnostics().formFields || []).find((x) => x.kind === 'text' && x.readOnly !== true);
    return f ? { id: f.id, name: f.name } : null;
  });
  expect(textField, 'a fillable text field exists').not.toBeNull();
  const typed = 'QA1452';
  await win.locator(`[data-form-field="${textField.id}"]`).fill(typed);
  await win.waitForTimeout(900);
  const domValue = await win.locator(`[data-form-field="${textField.id}"]`).inputValue();
  const modelValue = await win.evaluate((id) => {
    const f = (window.tflexDiagnostics().formFields || []).find((x) => x.id === id);
    return f ? f.value : null;
  }, textField.id);
  console.log(`[rel1452] form fill field=${textField.name} dom="${domValue}" model="${modelValue}"`);
  expect(domValue, 'the filled value re-reads from the field input').toBe(typed);
  expect(modelValue, 'the value landed in the document field model (native)').toBe(typed);

  // 4. Evidence screenshot of the packaged workspace.
  fs.mkdirSync(SHOTS, { recursive: true });
  await win.screenshot({ path: path.join(SHOTS, 'release-1452-packaged.png') });

  // 5. About dialog shows the 1.45.2 What's New entry.
  await app.evaluate(({ BrowserWindow }, channel) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.webContents.send(channel, { action: 'about' });
  }, 'menu:action');
  await win.waitForSelector('[data-about-dialog]:visible', { timeout: 15000 });
  const versionLabel = (await win.locator('[data-whats-new-version]').innerText()).trim();
  console.log(`[rel1452] about whats-new version="${versionLabel}"`);
  expect(versionLabel, 'About shows the 1.45.2 notes').toContain('1.45.2');
  const highlights = win.locator('[data-whats-new-highlight]');
  expect(await highlights.count(), 'at least one 1.45.2 highlight').toBeGreaterThanOrEqual(1);
  await expect(highlights.first()).toBeVisible();
  const first = (await highlights.first().innerText()).trim();
  expect(first.length).toBeGreaterThan(0);
  console.log(`[rel1452] first highlight="${first.slice(0, 90)}"`);
});
