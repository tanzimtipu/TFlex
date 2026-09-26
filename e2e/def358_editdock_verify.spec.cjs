// DEF-358 retest (qa) — from ADV-096. After the Phase 37 EDIT-toolbar
// retirement, arming an edit tool left its dock verb with NO active state:
// DocumentView still passed `activeToolIds={editModeOpen ? ['editMode'] : []}`,
// but `editMode` is no longer a rendered dock verb, so the dock's pressed
// treatment `.action-dock-verb[aria-pressed='true']` never matched.
//
// The fix maps the armed edit tool to its OWN rendered verb
// (`editDockVerbFor`: text->editText, box->editTextBox, image->editImage,
// off->editToolOff) in BOTH the single-mode dock (DocumentView) and the
// Multi Mode shared dock (App's `dockActiveToolIds`).
//
// This spec verifies IN THE REAL APP:
//   * arming editText/editTextBox/editImage marks exactly that verb
//     `aria-pressed="true"` with the dock's selected treatment (accent wash +
//     inset accent ring), and no other edit verb;
//   * entering EDIT marks `editToolOff` (the initial `off` tool);
//   * the unarmed state is visually distinct (no inset ring);
//   * the same holds in Multi Mode's shared dock.
//
// Launches only through the canonical e2e/lib/launch.cjs launchApp.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const EDIT_VERBS = ['editText', 'editTextBox', 'editImage', 'editToolOff'];

let app = null;
let win = null;
test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def358');
  app = null;
  win = null;
});

async function setWindow(w, h) {
  await app.evaluate(({ BrowserWindow }, sz) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.setSize(sz[0], sz[1]);
  }, [w, h]);
  await win.waitForFunction((want) => Math.abs(window.innerWidth - want) <= 24, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(500);
}

async function openDoc(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  const openBtn = win.locator('[data-toolbar-open]').first();
  if ((await openBtn.count()) > 0) await openBtn.click();
  else await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

// Read the aria-pressed + selected-treatment state of every edit verb inside a
// dock scope. `scope` is a CSS selector for the dock container.
function readMatrix(scope) {
  return win.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const out = {};
    for (const id of ['editText', 'editTextBox', 'editImage', 'editToolOff']) {
      const el = root.querySelector(`[data-dock-verb="${id}"]`);
      if (!el) { out[id] = null; continue; }
      const cs = getComputedStyle(el);
      out[id] = {
        pressed: el.getAttribute('aria-pressed'),
        boxShadow: cs.boxShadow,
        background: cs.backgroundColor,
        hasInsetRing: /inset/.test(cs.boxShadow),
      };
    }
    return out;
  }, scope);
}

async function clickVerb(scope, id) {
  const inline = win.locator(`${scope} [data-dock-verb="${id}"]`);
  if ((await inline.count()) > 0 && (await inline.first().isVisible().catch(() => false))) {
    await inline.first().click();
    await win.waitForTimeout(450);
    return 'inline';
  }
  const overflow = win.locator(`${scope} [data-dock-overflow]`);
  if ((await overflow.count()) > 0 && (await overflow.first().isVisible().catch(() => false))) {
    await overflow.first().click();
    await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
    await win.locator(`[data-dock-overflow-item="${id}"]`).first().click();
    await win.waitForTimeout(450);
    return 'overflow';
  }
  throw new Error(`clickVerb: '${id}' not reachable in ${scope}`);
}

function assertExactlyOne(m, expected, label) {
  expect(m, `${label}: dock present`).not.toBeNull();
  for (const id of EDIT_VERBS) {
    const cell = m[id];
    if (id === expected) {
      expect(cell, `${label}: ${id} rendered`).not.toBeNull();
      expect(cell.pressed, `${label}: ${id} aria-pressed`).toBe('true');
      expect(cell.hasInsetRing, `${label}: ${id} carries the selected inset ring (boxShadow=${cell.boxShadow})`).toBe(true);
      expect(cell.background, `${label}: ${id} carries the accent wash (background=${cell.background})`).not.toMatch(/rgba\(0, 0, 0, 0\)/);
    } else {
      if (cell === null) continue;
      expect(cell.pressed, `${label}: ${id} must NOT be pressed`).toBe(null);
      expect(cell.hasInsetRing, `${label}: ${id} must NOT carry the selected ring (boxShadow=${cell.boxShadow})`).toBe(false);
    }
  }
}

test('DEF-358 single-mode dock: the armed edit tool marks its own verb pressed with the selected treatment', async () => {
  await openDoc(getSamplePath('report.pdf'));
  await setWindow(1440, 900);
  await gotoStage(win, 2);
  await win.waitForTimeout(500);

  const SCOPE = '[data-action-dock]';
  await win.locator(`${SCOPE} [data-dock-verb="editText"]`).waitFor({ state: 'visible', timeout: 10000 });

  // Entering EDIT: the initial tool is `off` -> editToolOff is the pressed verb.
  const entered = await readMatrix(SCOPE);
  console.log(`[DEF-358 single entered] ${JSON.stringify(entered)}`);
  assertExactlyOne(entered, 'editToolOff', 'single/entered');

  const rows = [];
  for (const [id, tool] of [['editText', 'text'], ['editTextBox', 'box'], ['editImage', 'image'], ['editToolOff', 'off']]) {
    const lane = await clickVerb(SCOPE, id);
    const m = await readMatrix(SCOPE);
    console.log(`[DEF-358 single ${id}] lane=${lane} ${JSON.stringify(m)}`);
    assertExactlyOne(m, id, `single/${id}`);
    const layer = await win.evaluate(() => ({
      layers: document.querySelectorAll('.edit-layer').length,
      tool: document.querySelector('.edit-layer')?.getAttribute('data-tool') ?? null,
    }));
    console.log(`[DEF-358 single ${id}] edit-layer=${JSON.stringify(layer)}`);
    if (tool === 'off') expect(layer.layers, 'editToolOff returns the layer to the plain viewer').toBe(0);
    else expect(layer.tool, `edit layer armed with '${tool}'`).toBe(tool);
    rows.push({ id, lane, pressed: m[id].pressed, ring: m[id].hasInsetRing });
  }
  console.log(`[DEF-358 single matrix] ${JSON.stringify(rows)}`);

  // Screenshot with editText armed (the primary verb + its pressed ring).
  await clickVerb(SCOPE, 'editText');
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, 'def358-edit-dock-armed.png') });
  console.log(`[DEF-358] screenshot ${path.join(SHOTS, 'def358-edit-dock-armed.png')}`);
});

test('DEF-358 Multi Mode shared dock: the armed edit tool marks its own verb pressed', async () => {
  await openDoc(getSamplePath('report.pdf'));
  await setWindow(1440, 900);

  // Enter Multi Mode through its real title-bar control.
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(800);
  await gotoStage(win, 2);
  await win.waitForTimeout(700);

  const SCOPE = '.multi-dock-layer';
  await win.locator(`${SCOPE} [data-dock-verb="editText"]`).waitFor({ state: 'visible', timeout: 12000 });

  const entered = await readMatrix(SCOPE);
  console.log(`[DEF-358 multi entered] ${JSON.stringify(entered)}`);
  assertExactlyOne(entered, 'editToolOff', 'multi/entered');

  const rows = [];
  for (const [id, tool] of [['editText', 'text'], ['editTextBox', 'box'], ['editImage', 'image'], ['editToolOff', 'off']]) {
    const lane = await clickVerb(SCOPE, id);
    const m = await readMatrix(SCOPE);
    console.log(`[DEF-358 multi ${id}] lane=${lane} ${JSON.stringify(m)}`);
    assertExactlyOne(m, id, `multi/${id}`);
    const layer = await win.evaluate(() => ({
      layers: document.querySelectorAll('.edit-layer').length,
      tool: document.querySelector('.edit-layer')?.getAttribute('data-tool') ?? null,
    }));
    console.log(`[DEF-358 multi ${id}] edit-layer=${JSON.stringify(layer)}`);
    if (tool === 'off') expect(layer.layers, 'editToolOff returns the layer to the plain viewer').toBe(0);
    else expect(layer.tool, `edit layer armed with '${tool}'`).toBe(tool);
    rows.push({ id, lane, pressed: m[id].pressed, ring: m[id].hasInsetRing });
  }
  console.log(`[DEF-358 multi matrix] ${JSON.stringify(rows)}`);
});
