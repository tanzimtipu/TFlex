// Phase 52 gate (qa) — encrypted PDF support, verified against the RUNNING
// dev build. Every launch goes through the canonical e2e/lib/launch.cjs
// launchApp helper. Raw [P52 ...] lines are the evidence.
//
// Fixtures are SYNTHETIC (built by e2e/lib/p52_crypto.cjs in a temp dir
// outside the repo). The operator's real file is opened IN PLACE and never
// copied into the repo; its edit is saved via Save-As to a temp path so the
// original is never overwritten.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage, runTool, clickDockVerb, armAnnotationTool } = require('./lib/helpers.cjs');
const {
  makeEncryptedFixture,
  hasEncryptToken,
  readRawEncryptDict,
  pdfjsProbe,
  PDFJS_PERMISSION_FLAG,
} = require('./lib/p52_crypto.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const OPERATOR_FILE = 'C:\\Users\\tanzi\\OneDrive\\Desktop\\Parent visa\\956.pdf';
const AES256_PW = 'P52-AES256-User!';
const AES256_OWNER = 'P52-AES256-Owner!';
const AES128_PW = 'P52-AES128-User!';
const CANARY = 'P52-CANARY-LEAK-7f3a9';
const WRONG_CANARY = 'P52-WRONG-CANARY-4b1c';

// The mixed restriction set used by the banner + create tests.
const MIXED_PERMS = {
  print: true,
  highResPrint: false,
  copy: false,
  accessibleCopy: true,
  modify: false,
  comment: true,
  assemble: false,
  fillForms: true,
};

let app = null;
let win = null;
let userDataDir = null;
let mainLog = [];
let winLog = [];
test.setTimeout(300000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'p52-gate');
  app = null;
  win = null;
  userDataDir = null;
  mainLog = [];
  winLog = [];
});

async function launch() {
  userDataDir = path.join(os.tmpdir(), `tflex-p52-userdata-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  app = await launchApp([], userDataDir);
  const proc = app.process();
  if (proc.stdout) proc.stdout.on('data', (d) => mainLog.push(d.toString()));
  if (proc.stderr) proc.stderr.on('data', (d) => mainLog.push(d.toString()));
  win = await app.firstWindow();
  win.on('console', (msg) => winLog.push(msg.text()));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  // Route every renderer-initiated download (the Encrypt flow's downloadBlob)
  // to a path the test sets, so no native save dialog blocks the run.
  await app.evaluate(({ session }) => {
    globalThis.__p52DownloadPath = null;
    session.defaultSession.on('will-download', (_event, item) => {
      if (globalThis.__p52DownloadPath) item.setSavePath(globalThis.__p52DownloadPath);
    });
  });
  return win;
}

async function openViaDialog(absPath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, absPath);
  await win.locator('[data-toolbar-open]').click();
}

async function setSavePath(target) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, target);
}

async function setDownloadPath(target) {
  await app.evaluate(({}, p) => {
    globalThis.__p52DownloadPath = p;
  }, target);
}

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

async function protection(docId) {
  return win.evaluate((id) => window.tflex.engine.getDocumentProtection(id), docId);
}

async function waitForCanvas() {
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(800);
}

// ---------------------------------------------------------------------------
// Criterion 1 — the operator's real file (RC4-128, V4, empty user password).
// ---------------------------------------------------------------------------
test('P52-C1: the operator file opens with NO prompt, reads V4/R4/CFM=V2, edits and saves decrypted', async () => {
  await launch();
  expect(fs.existsSync(OPERATOR_FILE), 'the operator file exists').toBe(true);

  await openViaDialog(OPERATOR_FILE);
  await waitForCanvas();

  const promptCount = await win.locator('[data-password-prompt]').count();
  console.log(`[P52-C1 prompt] count=${promptCount}`);
  expect(promptCount, 'no password prompt for an empty-user-password file').toBe(0);

  const d = await diag();
  console.log(`[P52-C1 diag] openTabs=${d.openTabs} engineDocId=${d.engineDocId} pageCount=${d.pageCount}`);
  expect(d.openTabs, 'the file opened as a tab').toBe(1);
  expect(d.engineDocId, 'an engine doc id exists').toBeTruthy();

  const prot = await protection(d.engineDocId);
  console.log(`[P52-C1 protection] ${JSON.stringify(prot)}`);
  expect(prot.ok, 'getDocumentProtection ok').toBe(true);
  expect(prot.value, 'the file is reported encrypted').not.toBe(null);
  expect(prot.value.v, '/V').toBe(4);
  expect(prot.value.r, '/R').toBe(4);
  expect(prot.value.cfm, '/CFM').toBe('V2');
  expect(prot.value.algorithm, 'algorithm').toBe('RC4-128');

  // A real edit through the engine: rotate page 1 clockwise (one quarter turn).
  const rotated = await win.evaluate(async (id) => {
    return window.tflex.engine.applyOp(id, { kind: 'rotate-cw', page: 0 });
  }, d.engineDocId);
  console.log(`[P52-C1 rotate] ok=${rotated.ok} rotations=${JSON.stringify(rotated.ok ? rotated.value.rotations : rotated.error)}`);
  expect(rotated.ok, 'the encrypted document accepts a real edit').toBe(true);
  expect(rotated.value.rotations[0], 'page 1 is rotated one quarter turn').toBe(1);

  // Save-As to a temp path (never overwrite the operator's original).
  const outPath = path.join(os.tmpdir(), `p52-operator-saved-${Date.now()}.pdf`);
  await setSavePath(outPath);
  await win.locator('[data-toolbar-save-as]').click();
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.locator('[data-save-as-confirm]').click();
  await win.waitForTimeout(2500);

  expect(fs.existsSync(outPath), 'the saved copy exists').toBe(true);
  const savedRaw = await readRawEncryptDict(outPath);
  const savedHasEncrypt = hasEncryptToken(outPath);
  const savedProbe = await pdfjsProbe(outPath);
  console.log(`[P52-C1 saved] path=${outPath} hasEncrypt=${savedHasEncrypt} raw=${JSON.stringify(savedRaw)} pdfjs=${JSON.stringify(savedProbe)}`);
  expect(savedHasEncrypt, 'the saved copy has no /Encrypt token').toBe(false);
  expect(savedRaw, 'the saved copy has no encryption dictionary').toBe(null);
  expect(savedProbe.opened, 'the saved copy opens in pdf.js with no password').toBe(true);
  expect(savedProbe.numPages, 'the saved copy keeps its pages').toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Criterion 2 — the password prompt (need / incorrect / retry / cancel).
// ---------------------------------------------------------------------------
test('P52-C2: an AES-256 file prompts, retries on a wrong password, opens on the right one, cancels cleanly', async () => {
  await launch();
  const fixture = await makeEncryptedFixture({
    name: 'c2-aes256.pdf',
    algorithm: 'AES-256',
    userPassword: AES256_PW,
    ownerPassword: AES256_OWNER,
    permissions: MIXED_PERMS,
  });
  console.log(`[P52-C2 fixture] ${fixture}`);

  await openViaDialog(fixture);
  await win.waitForSelector('[data-password-prompt]', { timeout: 20000 });
  const promptText = await win.locator('[data-password-prompt]').innerText();
  console.log(`[P52-C2 prompt] ${JSON.stringify(promptText)}`);
  expect(promptText, 'the prompt names the document').toContain('c2-aes256.pdf');
  expect(promptText, 'the prompt says password-protected').toContain('password-protected');

  const tabsBefore = (await diag()).openTabs;

  // Wrong password.
  await win.locator('[data-password-input]').fill(WRONG_CANARY);
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-error]', { timeout: 20000 });
  await win.waitForTimeout(500);
  const afterWrong = await win.evaluate(() => {
    const input = document.querySelector('[data-password-input]');
    const err = document.querySelector('[data-password-error]');
    return {
      errorText: err ? err.textContent : null,
      inputValue: input ? input.value : null,
      bodyHasCanary: document.body.innerText.includes('P52-WRONG-CANARY-4b1c'),
      promptStillOpen: document.querySelector('[data-password-prompt]') !== null,
      openTabs: window.tflexDiagnostics().openTabs,
    };
  });
  console.log(`[P52-C2 wrong] ${JSON.stringify(afterWrong)}`);
  expect(afterWrong.errorText, 'the retry message is shown').toContain('did not open the document');
  expect(afterWrong.inputValue, 'the field is cleared after a wrong attempt').toBe('');
  expect(afterWrong.bodyHasCanary, 'the attempted password is never echoed').toBe(false);
  expect(afterWrong.promptStillOpen, 'the prompt stays open for a retry').toBe(true);
  expect(afterWrong.openTabs, 'no half-open tab after a wrong attempt').toBe(tabsBefore);

  // Correct password.
  await win.locator('[data-password-input]').fill(AES256_PW);
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 });
  await waitForCanvas();
  const afterRight = await diag();
  console.log(`[P52-C2 right] openTabs=${afterRight.openTabs} engineDocId=${afterRight.engineDocId} pageCount=${afterRight.pageCount}`);
  expect(afterRight.openTabs, 'the tab opened after the correct password').toBe(tabsBefore + 1);
  expect(afterRight.pageCount, 'the document rendered').toBeGreaterThan(0);

  // Session cache (engine): reloading the SAME doc id with no password opens.
  const cached = await win.evaluate(async ({ id, p }) => {
    return window.tflex.engine.loadDocument(id, p);
  }, { id: afterRight.engineDocId, p: fixture });
  console.log(`[P52-C2 session-cache] ok=${cached.ok} error=${cached.ok ? null : JSON.stringify(cached.error)}`);
  expect(cached.ok, 'the session cache opens a same-doc reload with no password').toBe(true);

  // UI second open of the same file: observe whether it re-prompts.
  await openViaDialog(fixture);
  await win.waitForTimeout(2500);
  const secondOpen = await win.evaluate(() => ({
    promptOpen: document.querySelector('[data-password-prompt]') !== null,
    openTabs: window.tflexDiagnostics().openTabs,
  }));
  console.log(`[P52-C2 second-open] ${JSON.stringify(secondOpen)}`);
  if (secondOpen.promptOpen) {
    // Dismiss so the cancel test starts clean.
    await win.locator('[data-password-prompt] .btn-secondary').click();
    await win.waitForTimeout(600);
  }

  // Cancel leaves no half-open tab.
  const cancelFixture = await makeEncryptedFixture({
    name: 'c2-cancel.pdf',
    algorithm: 'AES-256',
    userPassword: 'P52-Cancel-Pass!',
  });
  const tabsBeforeCancel = (await diag()).openTabs;
  await openViaDialog(cancelFixture);
  await win.waitForSelector('[data-password-prompt]', { timeout: 20000 });
  await win.locator('[data-password-prompt] .btn-secondary').click();
  await win.waitForTimeout(1200);
  const afterCancel = await win.evaluate(() => ({
    promptOpen: document.querySelector('[data-password-prompt]') !== null,
    openTabs: window.tflexDiagnostics().openTabs,
  }));
  console.log(`[P52-C2 cancel] before=${tabsBeforeCancel} after=${JSON.stringify(afterCancel)}`);
  expect(afterCancel.promptOpen, 'cancel closes the prompt').toBe(false);
  expect(afterCancel.openTabs, 'cancel leaves no half-open tab').toBe(tabsBeforeCancel);
});

// ---------------------------------------------------------------------------
// Criterion 3 — AES-256 and AES-128 fixtures prompt and open.
// ---------------------------------------------------------------------------
test('P52-C3: an AES-128 file prompts and opens with its password', async () => {
  await launch();
  const fixture = await makeEncryptedFixture({
    name: 'c3-aes128.pdf',
    algorithm: 'AES-128',
    userPassword: AES128_PW,
    permissions: MIXED_PERMS,
  });
  console.log(`[P52-C3 fixture] ${fixture}`);
  const raw = await readRawEncryptDict(fixture);
  console.log(`[P52-C3 raw] ${JSON.stringify(raw)}`);
  expect(raw.v, '/V').toBe(4);
  expect(raw.r, '/R').toBe(4);
  expect(raw.cfm, '/CFM').toBe('AESV2');

  await openViaDialog(fixture);
  await win.waitForSelector('[data-password-prompt]', { timeout: 20000 });
  await win.locator('[data-password-input]').fill(AES128_PW);
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 });
  await waitForCanvas();
  const d = await diag();
  console.log(`[P52-C3 opened] openTabs=${d.openTabs} pageCount=${d.pageCount}`);
  expect(d.openTabs, 'the AES-128 file opened').toBe(1);
  expect(d.pageCount, 'the AES-128 file rendered').toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Criterion 4 — the truthful protection banner.
// ---------------------------------------------------------------------------
test('P52-C4: the banner shows the real cipher/revision and permission flags, and says they are not enforced', async () => {
  await launch();
  const fixture = await makeEncryptedFixture({
    name: 'c4-banner.pdf',
    algorithm: 'AES-256',
    userPassword: AES256_PW,
    permissions: MIXED_PERMS,
  });
  await openViaDialog(fixture);
  await win.waitForSelector('[data-password-prompt]', { timeout: 20000 });
  await win.locator('[data-password-input]').fill(AES256_PW);
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 });
  await waitForCanvas();

  await win.waitForSelector('[data-protection-notice]', { timeout: 15000 });
  const banner = await win.evaluate(() => ({
    algorithm: document.querySelector('[data-protection-algorithm]')?.textContent ?? null,
    permissions: document.querySelector('[data-protection-permissions]')?.textContent ?? null,
    enforcement: document.querySelector('[data-protection-enforcement]')?.textContent ?? null,
  }));
  console.log(`[P52-C4 banner] ${JSON.stringify(banner)}`);
  expect(banner.algorithm, 'the cipher is shown').toContain('AES-256');
  expect(banner.algorithm, 'the revision is shown').toContain('/R 6');
  expect(banner.algorithm, 'the version is shown').toContain('/V 5');
  expect(banner.algorithm, 'the crypt filter is shown').toContain('/CFM AESV3');
  expect(banner.permissions, 'allowed flags listed').toContain('Print');
  expect(banner.permissions, 'allowed flags listed').toContain('Accessibility copy');
  expect(banner.permissions, 'denied flags listed').toContain('Not allowed');
  expect(banner.permissions, 'denied flags listed').toContain('Copy');
  expect(banner.permissions, 'denied flags listed').toContain('Modify');
  expect(banner.enforcement, 'the honest disclaimer is present').toContain('does not enforce');
  await win.screenshot({ path: path.join(SHOTS, 'phase52-protection-banner.png') });
});

// ---------------------------------------------------------------------------
// Criterion 5 — saving an opened encrypted document writes a decrypted file
// and says the protection was removed.
// ---------------------------------------------------------------------------
test('P52-C5: the save note is shown and the saved file is /Encrypt-free', async () => {
  await launch();
  const fixture = await makeEncryptedFixture({
    name: 'c5-save.pdf',
    algorithm: 'AES-256',
    userPassword: AES256_PW,
    permissions: MIXED_PERMS,
  });
  await openViaDialog(fixture);
  await win.waitForSelector('[data-password-prompt]', { timeout: 20000 });
  await win.locator('[data-password-input]').fill(AES256_PW);
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 });
  await waitForCanvas();

  // In-place Save FIRST (doc.path is still the fixture): make a real UI edit
  // (a rectangle annotation) so the toolbar Save enables, then save and read
  // the toast. Save-As later re-points doc.path, so it must come second.
  await gotoStage(win, 3);
  await armAnnotationTool(win, 'rect');
  const pg = await win.locator('.pdf-page[data-page="1"]').first().boundingBox();
  const x = Math.round(pg.x + pg.width * 0.35);
  const y = Math.round(pg.y + pg.height * 0.3);
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 140, y + 80, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(1200);
  const d = await diag();
  console.log(`[P52-C5 after ui edit] modified=${d.modified} canUndo=${d.canUndo}`);
  expect(d.modified, 'the UI edit marked the document modified').toBe(true);
  await win.locator('[data-toolbar-save]').click();
  await win.waitForTimeout(2500);
  const toasts = await win.evaluate(() =>
    [...document.querySelectorAll('.toast, [data-toast], [role="alert"]')].map((t) => t.textContent).filter(Boolean),
  );
  console.log(`[P52-C5 save toasts] ${JSON.stringify(toasts)}`);
  const saveToast = toasts.find((t) => t && t.includes('Saved'));
  expect(saveToast, 'a save confirmation toast is shown').toBeTruthy();
  expect(saveToast, 'the in-place save note says the protection was removed').toContain(
    'Saving removes the protection. The saved file will open without a password.',
  );
  // The fixture on disk was overwritten in place: it must now be decrypted.
  const inPlaceProbe = await pdfjsProbe(fixture);
  console.log(`[P52-C5 in-place out] hasEncrypt=${hasEncryptToken(fixture)} raw=${JSON.stringify(await readRawEncryptDict(fixture))} pdfjs=${JSON.stringify(inPlaceProbe)}`);
  expect(hasEncryptToken(fixture), 'the in-place saved file has no /Encrypt').toBe(false);
  expect(inPlaceProbe.opened, 'the in-place saved file opens with no password').toBe(true);

  // Save-As dialog carries the decrypted-save note.
  await win.locator('[data-toolbar-save-as]').click();
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  const note = await win.locator('[data-save-as-decrypt-note]').textContent();
  console.log(`[P52-C5 save-as note] ${JSON.stringify(note)}`);
  expect(note, 'the Save-As note says the protection is removed').toContain(
    'Saving removes the protection. The saved file will open without a password.',
  );
  const outPath = path.join(os.tmpdir(), `p52-c5-saved-${Date.now()}.pdf`);
  await setSavePath(outPath);
  await win.locator('[data-save-as-confirm]').click();
  await win.waitForTimeout(2500);
  expect(fs.existsSync(outPath), 'the Save-As copy exists').toBe(true);
  const savedProbe = await pdfjsProbe(outPath);
  console.log(`[P52-C5 save-as out] hasEncrypt=${hasEncryptToken(outPath)} raw=${JSON.stringify(await readRawEncryptDict(outPath))} pdfjs=${JSON.stringify(savedProbe)}`);
  expect(hasEncryptToken(outPath), 'the Save-As copy has no /Encrypt').toBe(false);
  expect(savedProbe.opened, 'the Save-As copy opens with no password').toBe(true);
});

// ---------------------------------------------------------------------------
// Criterion 6 — create an encrypted PDF (AES-256 default, AES-128, no RC4).
// ---------------------------------------------------------------------------
async function openEncryptDialog() {
  await gotoStage(win, 4);
  const verb = win.locator('[data-dock-verb="encrypt"]');
  if ((await verb.count()) > 0 && (await verb.first().isVisible().catch(() => false))) {
    await verb.first().click();
  } else {
    await clickDockVerb(win, 4, 'encrypt');
  }
  await win.waitForSelector('[data-encrypt-dialog]', { timeout: 15000 });
}

async function waitForFile(p, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fs.existsSync(p) && fs.statSync(p).size > 0) return true;
    await win.waitForTimeout(300);
  }
  return false;
}

test('P52-C6: the Encrypt dialog defaults to AES-256, writes chosen permissions, and cannot produce RC4', async () => {
  await launch();
  await openViaDialog(getSamplePath('report.pdf'));
  await waitForCanvas();

  await openEncryptDialog();
  const defaults = await win.evaluate(() => ({
    aes256: document.querySelector('[data-encrypt-algorithm="aes-256"]')?.checked ?? null,
    aes128: document.querySelector('[data-encrypt-algorithm="aes-128"]')?.checked ?? null,
    rc4Present: document.querySelector('[data-encrypt-algorithm="rc4-128"]') !== null,
    permCount: document.querySelectorAll('[data-encrypt-permission]').length,
    permChecked: [...document.querySelectorAll('[data-encrypt-permission]')].map((c) => c.checked),
  }));
  console.log(`[P52-C6 defaults] ${JSON.stringify(defaults)}`);
  expect(defaults.aes256, 'AES-256 is the default').toBe(true);
  expect(defaults.aes128, 'AES-128 is not selected by default').toBe(false);
  expect(defaults.rc4Present, 'RC4 is not offered').toBe(false);
  expect(defaults.permCount, 'eight permission checkboxes').toBe(8);
  expect(defaults.permChecked.every(Boolean), 'all permissions allowed by default').toBe(true);

  // AES-256 with copy + modify denied.
  await win.locator('[data-encrypt-user-password]').fill(AES256_PW);
  await win.locator('[data-encrypt-permission="copy"]').click();
  await win.locator('[data-encrypt-permission="modify"]').click();
  const out256 = path.join(os.tmpdir(), `p52-c6-aes256-${Date.now()}.pdf`);
  await setDownloadPath(out256);
  await win.locator('[data-encrypt-confirm]').click();
  expect(await waitForFile(out256), 'the AES-256 file was written').toBe(true);
  await win.waitForTimeout(500);

  const raw256 = await readRawEncryptDict(out256);
  const noPw256 = await pdfjsProbe(out256);
  const right256 = await pdfjsProbe(out256, AES256_PW);
  console.log(`[P52-C6 aes256] raw=${JSON.stringify(raw256)} noPw=${JSON.stringify(noPw256)} right=${JSON.stringify(right256)}`);
  expect(raw256.v, '/V').toBe(5);
  expect(raw256.r, '/R').toBe(6);
  expect(raw256.cfm, '/CFM').toBe('AESV3');
  expect(noPw256.opened, 'the created file prompts (pdf.js rejects no password)').toBe(false);
  expect(noPw256.name, 'pdf.js raises a PasswordException').toBe('PasswordException');
  expect(right256.opened, 'the created file opens with its password in pdf.js').toBe(true);
  const perms256 = right256.permissions || [];
  expect(perms256.includes(PDFJS_PERMISSION_FLAG.COPY), 'copy denied -> COPY flag absent').toBe(false);
  expect(perms256.includes(PDFJS_PERMISSION_FLAG.MODIFY_CONTENTS), 'modify denied -> MODIFY flag absent').toBe(false);
  expect(perms256.includes(PDFJS_PERMISSION_FLAG.PRINT), 'print allowed -> PRINT flag present').toBe(true);
  expect(perms256.includes(PDFJS_PERMISSION_FLAG.PRINT_HIGH_QUALITY), 'high-res print allowed -> flag present').toBe(true);

  // The defaults persisted WITHOUT a password.
  const settingsPath = path.join(userDataDir, 'settings.json');
  const settingsText = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : '';
  const settings = settingsText ? JSON.parse(settingsText) : {};
  console.log(`[P52-C6 settings.encryptDefaults] ${JSON.stringify(settings.encryptDefaults)}`);
  expect(settings.encryptDefaults, 'encryptDefaults persisted').toBeTruthy();
  expect(settings.encryptDefaults.algorithm, 'algorithm persisted').toBe('aes-256');
  expect(settings.encryptDefaults.permissions.copy, 'copy default persisted false').toBe(false);
  expect(settings.encryptDefaults.permissions.modify, 'modify default persisted false').toBe(false);
  expect(settingsText.includes(AES256_PW), 'no password in settings.json').toBe(false);
  expect(/"userPassword"|"ownerPassword"|"password"\s*:/.test(settingsText), 'no password-shaped key in settings.json').toBe(false);

  // AES-128.
  await openEncryptDialog();
  await win.locator('[data-encrypt-algorithm="aes-128"]').click();
  await win.locator('[data-encrypt-user-password]').fill(AES128_PW);
  const out128 = path.join(os.tmpdir(), `p52-c6-aes128-${Date.now()}.pdf`);
  await setDownloadPath(out128);
  await win.locator('[data-encrypt-confirm]').click();
  expect(await waitForFile(out128), 'the AES-128 file was written').toBe(true);
  await win.waitForTimeout(500);
  const raw128 = await readRawEncryptDict(out128);
  const noPw128 = await pdfjsProbe(out128);
  const right128 = await pdfjsProbe(out128, AES128_PW);
  console.log(`[P52-C6 aes128] raw=${JSON.stringify(raw128)} noPw=${JSON.stringify(noPw128)} right=${JSON.stringify(right128)}`);
  expect(raw128.v, '/V').toBe(4);
  expect(raw128.r, '/R').toBe(4);
  expect(raw128.cfm, '/CFM').toBe('AESV2');
  expect(noPw128.opened, 'the AES-128 file prompts').toBe(false);
  expect(right128.opened, 'the AES-128 file opens with its password').toBe(true);

  // RC4 cannot be produced: the engine coerces any non-aes-128 request to AES-256.
  const d = await diag();
  const rc4Attempt = await win.evaluate(async (id) => {
    const r = await window.tflex.engine.encryptDocument(id, { userPassword: 'P52-RC4-Attempt!', algorithm: 'rc4-128' });
    if (!r.ok) return { ok: false, error: r.error };
    const bytes = new Uint8Array(r.value);
    return { ok: true, bytes: Array.from(bytes) };
  }, d.engineDocId);
  console.log(`[P52-C6 rc4-attempt] ok=${rc4Attempt.ok}`);
  expect(rc4Attempt.ok, 'the engine produced bytes for the rc4 request').toBe(true);
  const rc4Path = path.join(os.tmpdir(), `p52-c6-rc4-${Date.now()}.pdf`);
  fs.writeFileSync(rc4Path, Buffer.from(rc4Attempt.bytes));
  const rawRc4 = await readRawEncryptDict(rc4Path);
  console.log(`[P52-C6 rc4-coerced] raw=${JSON.stringify(rawRc4)}`);
  expect(rawRc4.cfm, 'an rc4 request is coerced to AES (never RC4)').not.toBe('V2');
  expect(rawRc4.v, 'an rc4 request is coerced to /V 5').toBe(5);
  expect(rawRc4.cfm, 'an rc4 request is coerced to AESV3').toBe('AESV3');

  // Cross-check: the app's own protection reader (the banner) must AGREE with
  // pdf.js on the SAME created file — the two code paths must not disagree.
  await openViaDialog(out256);
  await win.waitForSelector('[data-password-prompt]', { timeout: 20000 });
  await win.locator('[data-password-input]').fill(AES256_PW);
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 });
  await waitForCanvas();
  const banner = await win.evaluate(() => ({
    algorithm: document.querySelector('[data-protection-algorithm]')?.textContent ?? null,
    permissions: document.querySelector('[data-protection-permissions]')?.textContent ?? null,
  }));
  console.log(`[P52-C6 app-reader] ${JSON.stringify(banner)}`);
  expect(banner.algorithm, 'app reader agrees on the cipher').toContain('AES-256');
  expect(banner.algorithm, 'app reader agrees on /R 6').toContain('/R 6');
  expect(banner.algorithm, 'app reader agrees on /V 5').toContain('/V 5');
  expect(banner.permissions, 'app reader agrees copy is denied').toContain('Copy');
  expect(banner.permissions, 'app reader agrees modify is denied').toContain('Modify');
  expect(banner.permissions, 'app reader agrees print is allowed').toContain('Print');
  expect(banner.permissions, 'app reader agrees high-res print is allowed').toContain('High-resolution print');
});

// ---------------------------------------------------------------------------
// Criterion 7 — no password leakage.
// ---------------------------------------------------------------------------
test('P52-C7: the password never reaches settings, logs, traces, IPC payloads or the DOM', async () => {
  await launch();
  const fixture = await makeEncryptedFixture({
    name: 'c7-canary.pdf',
    algorithm: 'AES-256',
    userPassword: CANARY,
    permissions: MIXED_PERMS,
  });
  await openViaDialog(fixture);
  await win.waitForSelector('[data-password-prompt]', { timeout: 20000 });
  // A wrong attempt first (its value must not leak either).
  await win.locator('[data-password-input]').fill(WRONG_CANARY);
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-error]', { timeout: 20000 });
  await win.waitForTimeout(500);
  // Then the correct one.
  await win.locator('[data-password-input]').fill(CANARY);
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 });
  await waitForCanvas();
  await win.waitForTimeout(1500);

  // Scan every file under userData.
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      let text = '';
      try { text = fs.readFileSync(full, 'latin1'); } catch { continue; }
      if (text.includes(CANARY)) hits.push(`file:${full}:canary`);
      if (text.includes(WRONG_CANARY)) hits.push(`file:${full}:wrong-canary`);
    }
  };
  walk(userDataDir);
  const settingsPath = path.join(userDataDir, 'settings.json');
  const tracePath = path.join(userDataDir, 'oauth-trace.log');
  console.log(`[P52-C7 userData] dir=${userDataDir} settingsExists=${fs.existsSync(settingsPath)} traceExists=${fs.existsSync(tracePath)}`);
  console.log(`[P52-C7 file hits] ${JSON.stringify(hits)}`);
  expect(hits, 'no password in any userData file').toEqual([]);

  const domHas = await win.evaluate(({ c, w }) => ({
    canary: document.body.innerText.includes(c) || document.body.innerHTML.includes(c),
    wrong: document.body.innerText.includes(w) || document.body.innerHTML.includes(w),
  }), { c: CANARY, w: WRONG_CANARY });
  console.log(`[P52-C7 dom] ${JSON.stringify(domHas)}`);
  expect(domHas.canary, 'the password is not in the DOM').toBe(false);
  expect(domHas.wrong, 'the attempted password is not in the DOM').toBe(false);

  const mainHas = mainLog.join('\n');
  const winHas = winLog.join('\n');
  console.log(`[P52-C7 logs] mainLen=${mainHas.length} winLen=${winHas.length} mainCanary=${mainHas.includes(CANARY)} mainWrong=${mainHas.includes(WRONG_CANARY)} winCanary=${winHas.includes(CANARY)} winWrong=${winHas.includes(WRONG_CANARY)}`);
  expect(mainHas.includes(CANARY), 'the password is not in the main-process log').toBe(false);
  expect(mainHas.includes(WRONG_CANARY), 'the attempted password is not in the main-process log').toBe(false);
  expect(winHas.includes(CANARY), 'the password is not in the renderer console').toBe(false);
  expect(winHas.includes(WRONG_CANARY), 'the attempted password is not in the renderer console').toBe(false);

  // The engine's returned payloads never carry the password.
  const d = await diag();
  const payloads = await win.evaluate(async (id) => {
    const prot = await window.tflex.engine.getDocumentProtection(id);
    const state = await window.tflex.engine.getState(id);
    return JSON.stringify({ prot, state });
  }, d.engineDocId);
  console.log(`[P52-C7 payloads] canary=${payloads.includes(CANARY)} wrong=${payloads.includes(WRONG_CANARY)}`);
  expect(payloads.includes(CANARY), 'no password in IPC payloads').toBe(false);
  expect(payloads.includes(WRONG_CANARY), 'no attempted password in IPC payloads').toBe(false);
});
