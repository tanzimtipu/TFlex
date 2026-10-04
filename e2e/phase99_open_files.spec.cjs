// Phase 99 (qa) - focused e2e verification of the home-screen "Open Files"
// tile: the FIXED Open tile must play NO edit-mode animation, its
// label/tooltip/accessible name must read "Open Files" (never "Open PDF"), and
// the tile must open every supported format (PDF, image, text, office) from
// the home fixed tile; an unsupported type must fail gracefully with the exact
// named toast and no crash.
//
// Anchors verified in the working tree 2026-10-04:
//   src/renderer/components/Welcome.tsx:274-286  fixed tile [data-home-tool="open"]
//   src/renderer/components/Welcome.tsx:302-304  removable tiles: icon-only jiggle
//   src/renderer/components/Welcome.tsx:404-417  [data-home-edit-toggle], [data-home-tools][data-home-edit]
//   src/renderer/App.tsx:2385-2396               home Open -> openFileDialog("document")
//   src/main/services/dialog.ts:80-85            picker title "Open Files"
//   src/renderer/state/convert.ts:116-118        unsupported toast text
//
// Contract fixtures (REQUIREMENTS.md Phase 99, criterion 3):
//   test-fixtures/report.pdf            -> .workspace + .pdf-page canvas
//   test-fixtures/phase54/dpi-72.png    -> .workspace
//   test-fixtures/phase53/sample.txt    -> .workspace
//   test-fixtures/phase55/sample.docx   -> .workspace
//   test-fixtures/phase53/unknown.xyz   -> named error toast, no .workspace
//
// Launch ONLY through e2e/lib/launch.cjs `launchApp`, opening the home screen
// with NO argv. Files are opened via the fixed tile selector directly (the
// helpers' openSample* locator is out of scope / under repair).
//
// Run: npm.cmd run test:e2e -- phase99_open_files
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

// The Paperclip/kimi harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads
// process.env, so leaving it set makes Electron exit as Node before Playwright
// can attach ("Process failed to launch!"). Unset it before the first launch.
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const FIXED_TILE = '[data-home-tool="open"]';
const FIXED_ICON = '[data-home-tool="open"] .home-tool-icon';
const TOGGLE = '[data-home-edit-toggle]';
const ROW = '[data-home-tools]';

let app = null;
let win = null;

test.setTimeout(300000);

async function launchHome() {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector(ROW, { timeout: 30000 });
  await win.waitForTimeout(400);
  return { app, win };
}

test.afterEach(async () => {
  if (app) await hardClose(app, 'phase99');
  app = null;
  win = null;
});

async function fixedIconName() {
  return win.locator(FIXED_ICON).evaluate((el) => getComputedStyle(el).animationName);
}

async function fixedBox() {
  const b = await win.locator(FIXED_TILE).boundingBox();
  expect(b, 'fixed Open tile has a bounding box').not.toBeNull();
  return b;
}

async function removableIconNames() {
  return win.evaluate(() =>
    Array.from(document.querySelectorAll('.home-tool:not(.home-tool-fixed) .home-tool-icon'))
      .map((el) => getComputedStyle(el).animationName));
}

async function editState() {
  return win.locator(ROW).getAttribute('data-home-edit');
}

async function waitEdit(state) {
  await win.waitForFunction(
    (want) => document.querySelector('[data-home-tools]').getAttribute('data-home-edit') === want,
    state,
    { timeout: 8000 },
  );
}

// Open a file through the fixed home tile, feeding the real main-process
// picker a fixed path (the canonical dialog-stub pattern).
async function openViaFixedTile(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  await win.locator(FIXED_TILE).first().click();
}

// --- T1 ---------------------------------------------------------------------
test('fixed Open tile plays no animation in edit mode', async () => {
  const a = await launchHome();

  expect(await editState(), 'home row starts in edit-off').toBe('false');
  expect(await fixedIconName(), 'fixed icon has no animation at rest').toBe('none');
  const baseline = await fixedBox();
  await a.win.screenshot({ path: path.join(SHOTS, 'tfl530-edit-off.png') });

  async function assertEditOnAt(label) {
    expect(await editState(), `${label}: edit mode on`).toBe('true');
    expect(await fixedIconName(), `${label}: fixed tile stays animation-free in edit mode`).toBe('none');
    const removable = await removableIconNames();
    expect(
      removable.some((n) => n.includes('jiggle')),
      `${label}: a removable tile jiggles while the fixed tile does not (names=${JSON.stringify(removable)})`,
    ).toBe(true);
  }

  // Enter edit mode.
  await a.win.locator(TOGGLE).click();
  await waitEdit('true');
  await assertEditOnAt('primary size');
  await a.win.screenshot({ path: path.join(SHOTS, 'tfl530-edit-on.png') });

  // Rapid toggling >= 5 times: the fixed tile must never animate and must not
  // move; sample both the animation name and the box after every click.
  const rapidNames = [];
  const rapidDeltas = [];
  for (let i = 0; i < 6; i += 1) {
    await a.win.locator(TOGGLE).click({ delay: 0 });
    rapidNames.push(await fixedIconName());
    const b = await fixedBox();
    rapidDeltas.push({
      dx: Math.abs(b.x - baseline.x),
      dy: Math.abs(b.y - baseline.y),
      dw: Math.abs(b.width - baseline.width),
      dh: Math.abs(b.height - baseline.height),
    });
  }
  fs.writeFileSync(
    path.join(SHOTS, 'tfl530-rapid-toggle.json'),
    JSON.stringify({ baseline, rapidNames, rapidDeltas }, null, 2),
  );
  expect(
    rapidNames.every((n) => n === 'none'),
    `fixed tile animation-name over rapid toggles: ${JSON.stringify(rapidNames)}`,
  ).toBe(true);
  for (const d of rapidDeltas) {
    expect(d.dx, `fixed tile dx=${d.dx}`).toBeLessThanOrEqual(1);
    expect(d.dy, `fixed tile dy=${d.dy}`).toBeLessThanOrEqual(1);
    expect(d.dw, `fixed tile dw=${d.dw}`).toBeLessThanOrEqual(1);
    expect(d.dh, `fixed tile dh=${d.dh}`).toBeLessThanOrEqual(1);
  }

  // Exit edit mode and assert the fixed tile is still animation-free.
  if ((await editState()) === 'true') {
    await a.win.locator(TOGGLE).click();
  }
  await waitEdit('false');
  expect(await fixedIconName(), 'fixed icon animation-free after exit').toBe('none');

  // Repeat at a second, smaller window size (real BrowserWindow resize).
  await a.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setSize(1024, 720);
  });
  await a.win.waitForTimeout(500);
  const baseline2 = await fixedBox();
  expect(await fixedIconName(), 'fixed icon animation-free at second size').toBe('none');
  await a.win.locator(TOGGLE).click();
  await waitEdit('true');
  await assertEditOnAt('second size');
  const box2 = await fixedBox();
  fs.writeFileSync(
    path.join(SHOTS, 'tfl530-second-size.json'),
    JSON.stringify({
      baseline2,
      box2,
      dx: Math.abs(box2.x - baseline2.x),
      dy: Math.abs(box2.y - baseline2.y),
    }, null, 2),
  );
  expect(Math.abs(box2.x - baseline2.x), `second-size fixed tile dx`).toBeLessThanOrEqual(1);
  expect(Math.abs(box2.y - baseline2.y), `second-size fixed tile dy`).toBeLessThanOrEqual(1);
  await a.win.screenshot({ path: path.join(SHOTS, 'tfl530-second-size-edit-on.png') });
});

// --- T2 ---------------------------------------------------------------------
test('fixed Open tile label, tooltip and accessible name read Open Files', async () => {
  await launchHome();
  const tile = win.locator(FIXED_TILE);

  const text = (await tile.innerText()).trim();
  expect(
    text.startsWith('Open Files'),
    `fixed tile text starts with "Open Files": ${JSON.stringify(text)}`,
  ).toBe(true);
  expect(await tile.getAttribute('title'), 'fixed tile tooltip').toBe('Open Files (Ctrl+O)');
  await expect(tile).toHaveAccessibleName(/Open Files/);
  await expect(tile).not.toHaveAccessibleName(/Open PDF/);

  // No VISIBLE element on the home screen may still render the old copy. The
  // title-bar Open button lives outside .welcome and is out of scope.
  const welcomeText = await win.locator('.welcome').innerText();
  expect(
    /Open PDF/.test(welcomeText),
    `no visible home element still reads "Open PDF": ${JSON.stringify(welcomeText.slice(0, 200))}`,
  ).toBe(false);
  await win.screenshot({ path: path.join(SHOTS, 'tfl530-label.png') });
});

// --- T3 ---------------------------------------------------------------------
test('home Open tile opens PDF, an image, a text document and an office document', async () => {
  // Each supported type is opened end to end from the home fixed tile, each on
  // a fresh app so every open proves the home-tile path rather than a re-used
  // workspace. Fixtures are the exact Phase 99 contract fixtures.
  const cases = [
    { key: 'pdf', fixture: path.join(ROOT, 'test-fixtures', 'report.pdf'), ready: '.pdf-page canvas', shot: 'phase99-open-pdf.png' },
    { key: 'image', fixture: path.join(ROOT, 'test-fixtures', 'phase54', 'dpi-72.png'), ready: null, shot: 'phase99-open-image.png' },
    { key: 'text', fixture: path.join(ROOT, 'test-fixtures', 'phase53', 'sample.txt'), ready: null, shot: 'phase99-open-text.png' },
    { key: 'office', fixture: path.join(ROOT, 'test-fixtures', 'phase55', 'sample.docx'), ready: null, shot: 'phase99-open-office.png' },
  ];

  for (const c of cases) {
    expect(fs.existsSync(c.fixture), `fixture exists: ${c.fixture}`).toBe(true);
    await launchHome();
    await openViaFixedTile(c.fixture);
    await win.waitForSelector('.workspace', { timeout: 60000 });
    if (c.ready) {
      await win.waitForSelector(c.ready, { timeout: 60000 });
    }
    await win.screenshot({ path: path.join(SHOTS, c.shot) });
    await hardClose(app, `phase99-t3-${c.key}`);
    app = null;
    win = null;
  }
});

// --- T4 ---------------------------------------------------------------------
test('unsupported file type fails gracefully with a named toast, no crash', async () => {
  await launchHome();
  const xyzPath = path.join(ROOT, 'test-fixtures', 'phase53', 'unknown.xyz');
  const xyzName = path.basename(xyzPath);
  expect(fs.existsSync(xyzPath), `unsupported fixture exists: ${xyzPath}`).toBe(true);

  await openViaFixedTile(xyzPath);

  const toast = win.locator('.toast-text').last();
  await toast.waitFor({ state: 'visible', timeout: 8000 });
  const toastText = (await toast.innerText()).trim();
  await win.screenshot({ path: path.join(SHOTS, 'phase99-unsupported-toast.png') });

  expect(toastText, 'exact named unsupported-format toast').toBe(
    `"${xyzName}" is not a file type Jovrel can open.`,
  );
  expect(await win.locator('.workspace').count(), 'no workspace mounts for an unsupported type').toBe(0);
  expect(await win.locator(ROW).count(), 'home screen still mounted').toBe(1);

  // The app did not crash: the renderer is live and still responds to input.
  const ready = await win.evaluate(() => document.readyState);
  expect(['interactive', 'complete']).toContain(ready);
  await win.locator(TOGGLE).click();
  await waitEdit('true');
});
