// Phase 97 chunk C - focused verification of the Windows PDF-family file
// associations. Nine default-file-types rows plus the `acrobat:` URL protocol.
// OS routing is by extension, so fixture content is irrelevant.
//
// Evidence: screenshots/phase97-<ext>.png, phase97-pdf.png, phase97-acrobat.png
// and screenshots/phase97-evidence.json.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');

// The Paperclip runtime injects ELECTRON_RUN_AS_NODE=1 into the shell. Left set,
// the Electron binary starts as plain Node and exits before any window appears,
// so every launch dies with "Process failed to launch". launch.cjs spreads
// process.env at call time, so stripping it here reaches the real Electron app.
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const FIXDIR = path.join(ROOT, 'test-fixtures', 'phase97');
const DOCS = path.join(ROOT, 'docs', 'FILE-ASSOCIATIONS.md');
const BUDGET_MS = 3000;

const FAMILY = [
  { ext: 'aaui', label: 'Acrobat User Interface' },
  { ext: 'bpdx', label: 'Acrobat Batch PDX' },
  { ext: 'fdf', label: 'Acrobat Forms Document' },
  { ext: 'pdx', label: 'Acrobat Catalog Index' },
  { ext: 'rmf', label: 'Acrobat Rights Management Document' },
  { ext: 'sequ', label: 'Acrobat Action File' },
  { ext: 'xdp', label: 'Acrobat XML Data Package' },
  { ext: 'xfdf', label: 'Acrobat Forms Document' },
];
const PDF = path.join(ROOT, 'assets', 'samples', 'report.pdf');
const ACROBAT_COPY = 'Jovrel cannot open an "acrobat:" link yet.';

const evidence = { generatedAt: new Date().toISOString(), rows: {}, boot: {} };

function saveEvidence() {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, 'phase97-evidence.json'), JSON.stringify(evidence, null, 2));
}

function writeFixtures() {
  fs.mkdirSync(FIXDIR, { recursive: true });
  const map = {};
  for (const f of FAMILY) {
    const p = path.join(FIXDIR, `sample.${f.ext}`);
    fs.writeFileSync(p, `phase97 fixture for .${f.ext}\n`);
    map[f.ext] = p;
  }
  return map;
}

async function tabCount(page) {
  return page.evaluate(() => document.querySelectorAll('[data-tab-id]').length);
}

async function readToasts(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.toast-text')).map((e) => e.textContent));
}

async function waitForToast(page, ms) {
  const deadline = Date.now() + ms;
  let toasts = [];
  while (Date.now() < deadline) {
    toasts = await readToasts(page).catch(() => []);
    if (toasts.length > 0) break;
    await page.waitForTimeout(200);
  }
  return { tabs: await tabCount(page).catch(() => 0), toasts };
}

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

async function launchReady(extraArgs, userDataDir = null) {
  const t0 = Date.now();
  const app = await launchApp(extraArgs, userDataDir);
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof window.tflex !== 'undefined', null, { timeout: 30000 });
  return { app, page, errors, readyMs: Date.now() - t0 };
}

test.describe('Phase 97 - PDF-family OS file associations', () => {
  const fixtures = writeFixtures();

  for (const f of FAMILY) {
    test(`.${f.ext} launches, opens no tab, names the type (${f.label})`, async () => {
      const fixture = fixtures[f.ext];
      const { app, page, errors, readyMs } = await launchReady([fixture]);
      const outcome = await waitForToast(page, 8000);
      const shot = path.join(SHOTS, `phase97-${f.ext}.png`);
      await page.screenshot({ path: shot }).catch(() => undefined);
      const expected = `sample.${f.ext} is an ${f.label} (.${f.ext}) file. Jovrel can be selected for this type but cannot display it yet.`;
      evidence.rows[f.ext] = { fixture, tabs: outcome.tabs, toasts: outcome.toasts, readyMs, expected, errors };
      evidence.boot[f.ext] = readyMs;
      saveEvidence();
      console.log(`[P97] .${f.ext} tabs=${outcome.tabs} toasts=${JSON.stringify(outcome.toasts)} readyMs=${readyMs}`);
      expect(outcome.tabs, `.${f.ext}: no document tab opens`).toBe(0);
      expect(outcome.toasts, `.${f.ext}: type-naming toast`).toContain(expected);
      expect(errors, `.${f.ext}: no page error`).toEqual([]);
      await app.close();
    });
  }

  test('acrobat: protocol launches, opens no tab, shows the exact copy', async () => {
    const { app, page, errors } = await launchReady(['acrobat:test']);
    const outcome = await waitForToast(page, 8000);
    await page.screenshot({ path: path.join(SHOTS, 'phase97-acrobat.png') }).catch(() => undefined);
    evidence.rows.acrobat = { tabs: outcome.tabs, toasts: outcome.toasts, errors };
    saveEvidence();
    console.log(`[P97] acrobat tabs=${outcome.tabs} toasts=${JSON.stringify(outcome.toasts)}`);
    expect(outcome.tabs, 'acrobat: no document tab opens').toBe(0);
    expect(outcome.toasts, 'acrobat: exact copy').toEqual([ACROBAT_COPY]);
    expect(errors, 'acrobat: no page error').toEqual([]);
    await app.close();
  });

  test('.pdf still opens a document tab, no association/error toast', async () => {
    const { app, page, errors, readyMs } = await launchReady([PDF]);
    const outcome = await waitForTab(page, 25000);
    await page.screenshot({ path: path.join(SHOTS, 'phase97-pdf.png') }).catch(() => undefined);
    evidence.rows.pdf = { tabs: outcome.tabs, toasts: outcome.toasts, readyMs, errors };
    evidence.boot.pdf = readyMs;
    saveEvidence();
    console.log(`[P97] pdf tabs=${outcome.tabs} toasts=${JSON.stringify(outcome.toasts)} readyMs=${readyMs}`);
    expect(outcome.tabs, 'pdf: a document tab opens').toBeGreaterThan(0);
    expect(outcome.toasts.join(' | '), 'pdf: no association/error toast').not.toMatch(/is an Acrobat|not a file type Jovrel can open/);
    expect(errors, 'pdf: no page error').toEqual([]);
    expect(readyMs, 'pdf: cold start to interactive < 3000ms').toBeLessThan(BUDGET_MS);
    await app.close();
  });

  test('cold start to interactive is under the 3000ms budget for a family row', async () => {
    const readyMs = evidence.boot.xdp;
    expect(typeof readyMs, 'family-row timing was captured').toBe('number');
    expect(readyMs, 'family row: cold start to interactive < 3000ms').toBeLessThan(BUDGET_MS);
  });

  test('docs/FILE-ASSOCIATIONS.md lists all nine rows with correct renderability', () => {
    const doc = fs.readFileSync(DOCS, 'utf8');
    for (const f of FAMILY) {
      const row = doc.split('\n').find((l) => l.includes(`\`.${f.ext}\``) && l.startsWith('|'));
      expect(row, `doc row for .${f.ext}`).toBeTruthy();
      expect(row, `.${f.ext} registration-only`).toContain('| no |');
      expect(row, `.${f.ext} label`).toContain(f.label);
    }
    const pdfRow = doc.split('\n').find((l) => l.includes('`.pdf`') && l.startsWith('|'));
    expect(pdfRow, 'doc row for .pdf').toBeTruthy();
    expect(pdfRow, '.pdf renderable').toContain('| yes |');
    expect(doc, 'acrobat: marked registration-only').toMatch(/`acrobat:` URL protocol[\s\S]*registration-only/i);
  });

  // Criterion 2 (single-instance hand-off): NOT driven here. A second Playwright
  // Electron launched against the same --user-data-dir cannot be awaited
  // reliably - the second process exits on the single-instance lock before it
  // yields a window, so electron.launch/firstWindow hangs until the test
  // timeout. Per the task, this item is covered by the existing routing tests
  // def300OpenPathRouting (test/unit/main/def300OpenPathRouting.test.ts) and the
  // Phase 35 open-path specs, which pin that a second launch routes its file
  // through handleOsOpenPath into the running main window. No second-instance
  // launch is forced here.
});
