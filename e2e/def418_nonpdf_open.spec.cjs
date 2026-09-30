// DEF-418 retest — a NON-PDF dropped onto the window must OPEN through the
// shared convert-aware path, and a genuinely unsupported file must open
// NOTHING and show a truthful message (never the old "is not a PDF" copy).
//
// The OS file-drop route is driven with a REAL file path via CDP
// `Input.dispatchDragEvent` (DragData.files), so Electron's
// `webUtils.getPathForFile` resolves the fixture exactly as a real Explorer
// drop would. `window.tflex` is contextBridge-frozen, so a stub is impossible
// and unnecessary.
//
// Evidence: screenshots/def418-drop-txt.png, def418-drop-cbz.png,
// def418-drop-unsupported.png and screenshots/def418-retest-evidence.json.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const EVIDENCE_PATH = path.join(SHOTS, 'def418-retest-evidence.json');

const FIXTURES = [
  { key: 'txt', rel: 'phase53/sample.txt' },
  { key: 'docx', rel: 'phase55/sample.docx' },
  { key: 'png', rel: 'phase54/dpi-300.png' },
  { key: 'cbz', rel: 'phase56/phase56-comic.cbz' },
  { key: 'epub', rel: 'phase56/phase56-book.epub' },
];
const UNSUPPORTED = { key: 'xyz', rel: 'phase53/unknown.xyz' };
const PDF = { key: 'pdf', path: path.join(ROOT, 'assets', 'samples', 'report.pdf') };

const evidence = { generatedAt: new Date().toISOString(), drops: {} };

function abs(rel) {
  return path.join(ROOT, 'test-fixtures', rel);
}

function saveEvidence() {
  fs.mkdirSync(SHOTS, { recursive: true });
  // Merge with any on-disk evidence so a worker restart between tests does not
  // drop earlier fixtures' records.
  let prior = {};
  try {
    prior = JSON.parse(fs.readFileSync(EVIDENCE_PATH, 'utf8'));
  } catch {
    prior = {};
  }
  const merged = {
    generatedAt: new Date().toISOString(),
    drops: { ...(prior.drops || {}), ...evidence.drops },
  };
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(merged, null, 2));
}

async function readToasts(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.toast-text')).map((e) => e.textContent),
  );
}

async function tabCount(page) {
  return page.evaluate(() => document.querySelectorAll('[data-tab-id]').length);
}

/** Dispatch a real OS file-drop at the window centre via CDP. */
async function dropFile(app, page, filePath) {
  const client = await app.context().newCDPSession(page);
  const box = await page.evaluate(() => {
    const el = document.querySelector('.workspace') || document.body;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  const data = { items: [], files: [filePath], dragOperationsMask: 1 };
  await client.send('Input.dispatchDragEvent', { type: 'dragEnter', x: box.x, y: box.y, data });
  await client.send('Input.dispatchDragEvent', { type: 'dragOver', x: box.x, y: box.y, data });
  await client.send('Input.dispatchDragEvent', { type: 'drop', x: box.x, y: box.y, data });
}

/** Poll until a document tab opens, or the deadline passes. Toasts are read
 *  at the end (a conversion progress toast may appear before the tab). */
async function waitForTab(page, ms) {
  const deadline = Date.now() + ms;
  let tabs = 0;
  while (Date.now() < deadline) {
    tabs = await tabCount(page).catch(() => 0);
    if (tabs > 0) break;
    await page.waitForTimeout(250);
  }
  return { tabs, toasts: await readToasts(page).catch(() => []) };
}

/** Poll until a toast appears, or the deadline passes. */
async function waitForToast(page, ms) {
  const deadline = Date.now() + ms;
  let toasts = [];
  while (Date.now() < deadline) {
    toasts = await readToasts(page).catch(() => []);
    if (toasts.length > 0) break;
    await page.waitForTimeout(250);
  }
  return { tabs: await tabCount(page).catch(() => 0), toasts };
}

async function launchReady() {
  const app = await launchApp();
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof window.tflex !== 'undefined', null, { timeout: 30000 });
  return { app, page };
}

test.describe('DEF-418 non-PDF OS file-drop opens through the convert path', () => {
  for (const f of FIXTURES) {
    test(`drop ${f.key} opens a document tab, no PDF-only toast`, async () => {
      const { app, page } = await launchReady();
      const before = await tabCount(page);
      await dropFile(app, page, abs(f.rel));
      const outcome = await waitForTab(page, 25000);
      const shot = f.key === 'txt' ? 'def418-drop-txt.png' : f.key === 'cbz' ? 'def418-drop-cbz.png' : null;
      if (shot !== null) {
        await page.screenshot({ path: path.join(SHOTS, shot) }).catch(() => undefined);
      }
      evidence.drops[f.key] = { path: abs(f.rel), before, after: outcome.tabs, toasts: outcome.toasts };
      saveEvidence();
      console.log(`[DEF418] ${f.key}: before=${before} after=${outcome.tabs} toasts=${JSON.stringify(outcome.toasts)}`);
      expect(outcome.tabs, `${f.key}: a document tab opened`).toBeGreaterThan(before);
      expect(outcome.toasts.join(' | '), `${f.key}: no "is not a PDF" toast`).not.toMatch(/is not a PDF/i);
      await app.close();
    });
  }

  test('drop unknown.xyz opens NOTHING and shows the truthful message', async () => {
    const { app, page } = await launchReady();
    const before = await tabCount(page);
    await dropFile(app, page, abs(UNSUPPORTED.rel));
    const outcome = await waitForToast(page, 8000);
    await page.screenshot({ path: path.join(SHOTS, 'def418-drop-unsupported.png') }).catch(() => undefined);
    evidence.drops[UNSUPPORTED.key] = {
      path: abs(UNSUPPORTED.rel),
      before,
      after: outcome.tabs,
      toasts: outcome.toasts,
    };
    saveEvidence();
    console.log(`[DEF418] ${UNSUPPORTED.key}: before=${before} after=${outcome.tabs} toasts=${JSON.stringify(outcome.toasts)}`);
    expect(outcome.tabs, 'unsupported: nothing opened').toBe(before);
    const joined = outcome.toasts.join(' | ');
    expect(joined, 'unsupported: a truthful toast is shown').toMatch(/is not a file type Jovrel can open/i);
    expect(joined, 'unsupported: never the PDF-only copy').not.toMatch(/only PDF/i);
    await app.close();
  });

  test('drop a normal .pdf still opens (regression)', async () => {
    const { app, page } = await launchReady();
    const before = await tabCount(page);
    await dropFile(app, page, PDF.path);
    const outcome = await waitForTab(page, 25000);
    evidence.drops[PDF.key] = { path: PDF.path, before, after: outcome.tabs, toasts: outcome.toasts };
    saveEvidence();
    console.log(`[DEF418] ${PDF.key}: before=${before} after=${outcome.tabs} toasts=${JSON.stringify(outcome.toasts)}`);
    expect(outcome.tabs, 'pdf: a document tab opened').toBeGreaterThan(before);
    expect(outcome.toasts.join(' | '), 'pdf: no error toast').not.toMatch(/is not a PDF|not a file type/i);
    await app.close();
  });
});
