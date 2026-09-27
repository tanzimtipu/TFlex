// Phase 45 gate (qa) — the eleven success criteria of REQUIREMENTS.md Phase 45,
// verified against the RUNNING dev build. Every launch goes through the
// canonical e2e/lib/launch.cjs launchApp helper. Raw [P45 ...] lines are the
// evidence.
//
//   1. the account surface reaches the network (CSP fix); bogus creds -> a
//      CREDENTIAL/server response, never a false "offline"; "offline" only when
//      genuinely offline;
//   2. the surface belongs to the app (branded, no dead space, Google mark,
//      forgot-password flow);
//   3. honest states;
//   4. create-from-clipboard: a copied IMAGE inserts a row with a working
//      preview; plain text shows the no-image message;
//   5. distinct tab colours (three adjacent tabs differ in all three themes);
//   6. the Multi Mode activation animation (frames, same nodes, reduced motion);
//   7. the EDIT dock highlight + "Edit mode off" leftmost;
//   8. the first thumbnail does not intersect "Undo last change";
//   9. the reshaped dialogs are squarer, no clipping/scrollbar loss;
//  10. the Watermark custom X/Y tick disables the grid and the coords are
//      APPLIED to the produced watermark;
//  11. no regression (verify:full + the phase suites, run separately).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, runTool, gotoStage, ensurePanelExpanded } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
test.setTimeout(300000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'p45-gate');
  app = null;
  win = null;
});

async function launch() {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  return win;
}

// Open a PDF through the real title-bar Open control, with the OS dialog stubbed.
async function openViaDialog(absPath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, absPath);
  await win.locator('[data-toolbar-open]').click();
  await win.waitForTimeout(1600);
}

async function setTheme(theme) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, theme);
  await win.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// Criterion 1 — the CSP permits the provider, narrowly.
// ---------------------------------------------------------------------------
test('P45-1a CSP: connect-src gains exactly https://*.neon.tech, commented', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  const content = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? '';
  const directives = {};
  for (const raw of content.split(';')) {
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 0) directives[parts[0]] = parts.slice(1);
  }
  console.log(`[P45-1a connect-src] ${JSON.stringify(directives['connect-src'])}`);
  expect(new Set(directives['connect-src'])).toEqual(
    new Set(["'self'", 'blob:', 'data:', 'https://*.neon.tech']),
  );
  // Nothing broader: no bare https: scheme source anywhere in connect-src.
  expect(directives['connect-src']).not.toContain('https:');
  expect(html).toContain('Phase 45');
  expect(html).toContain('connect-src must permit');
  // The built renderer carries the same policy.
  const built = fs.readFileSync(path.join(ROOT, 'dist', 'renderer', 'index.html'), 'utf8');
  expect(built).toContain('https://*.neon.tech');
});

// ---------------------------------------------------------------------------
// Criterion 1b — bogus credentials reach the provider: a CREDENTIAL/server
// response, never the false "offline" text.
// ---------------------------------------------------------------------------
test('P45-1b bogus email+password -> the provider reason is surfaced honestly, NOT offline', async () => {
  await launch();
  const neonRequests = [];
  const neonResponses = [];
  win.on('request', (r) => { if (/neon\.tech/i.test(r.url())) neonRequests.push(r.url()); });
  win.on('response', async (r) => {
    if (/neon\.tech/i.test(r.url())) {
      let body = '';
      try { body = await r.text(); } catch (_) { /* body unavailable */ }
      neonResponses.push({ url: r.url(), status: r.status(), body });
    }
  });

  await win.locator('[data-header-accounts]').click();
  await win.waitForSelector('[data-animated-dialog="accounts-dialog"]', { timeout: 10000 });
  await win.waitForSelector('[data-accounts-auth]', { timeout: 15000 });

  await win.locator('[data-accounts-email]').fill('qa-phase45-bogus@example.invalid');
  await win.locator('[data-accounts-password]').fill('not-a-real-password-123');
  await win.locator('[data-accounts-submit]').click();

  await win.waitForSelector('[data-accounts-banner]', { timeout: 30000 });
  await win.waitForTimeout(600);
  const banner = (await win.locator('[data-accounts-banner]').first().textContent()) ?? '';
  const tone = await win.locator('[data-accounts-banner]').first().getAttribute('data-accounts-banner');
  console.log(`[P45-1b banner] tone=${tone} text=${JSON.stringify(banner)}`);
  console.log(`[P45-1b neonRequests] ${JSON.stringify(neonRequests)}`);
  console.log(`[P45-1b neonResponses] ${JSON.stringify(neonResponses.map((r) => ({ url: r.url, status: r.status, body: r.body.slice(0, 200) })))}`);

  // The request actually left the renderer for the provider host.
  expect(neonRequests.length, 'the renderer reached a *.neon.tech host').toBeGreaterThan(0);
  // The false offline text must NOT appear.
  expect(banner, 'no false offline text').not.toContain('offline');

  // The provider's real response is the truth. A credential rejection is
  // surfaced as the credential copy; any OTHER refusal (e.g. a 403
  // MISSING_ORIGIN) must be surfaced verbatim, never masked as a wrong
  // password. The old assertion hardcoded the masked copy and could not tell
  // the two apart.
  const credential = 'That email or password is not correct. Check it and try again.';
  const providerVerbatim = /^The account service returned an error:/;
  const resp = neonResponses.find((r) => /sign-in\/email/.test(r.url)) ?? neonResponses[0];
  const providerCode = (resp?.body.match(/"code"\s*:\s*"([^"]+)"/)?.[1] ?? '').toUpperCase();
  const credentialCodes = ['INVALID_EMAIL_OR_PASSWORD', 'INVALID_CREDENTIALS', 'USER_NOT_FOUND'];
  console.log(`[P45-1b providerCode] ${providerCode} status=${resp?.status}`);
  if (credentialCodes.includes(providerCode)) {
    expect(banner, 'a credential rejection is surfaced as the credential copy').toBe(credential);
  } else {
    expect(banner, 'a non-credential refusal is never masked as a wrong password').not.toBe(credential);
    expect(banner, 'the provider reason is surfaced verbatim').toMatch(providerVerbatim);
  }
  console.log(`[P45-1b verdict] providerCode=${providerCode} banner=${JSON.stringify(banner)}`);
});

// ---------------------------------------------------------------------------
// Criterion 1c — "offline" appears ONLY when the app is genuinely offline.
// ---------------------------------------------------------------------------
test('P45-1c offline text appears only when navigator.onLine is false', async () => {
  await launch();
  await win.locator('[data-header-accounts]').click();
  await win.waitForSelector('[data-accounts-auth]', { timeout: 15000 });

  const cdp = await win.context().newCDPSession(win);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });
  await win.waitForTimeout(600);
  const onLine = await win.evaluate(() => navigator.onLine);
  console.log(`[P45-1c] navigator.onLine=${onLine}`);
  expect(onLine, 'the emulated offline state is live').toBe(false);

  await win.locator('[data-accounts-email]').fill('qa-phase45-offline@example.invalid');
  await win.locator('[data-accounts-password]').fill('whatever-123456');
  await win.locator('[data-accounts-submit]').click();
  await win.waitForSelector('[data-accounts-banner]', { timeout: 30000 });
  const banner = (await win.locator('[data-accounts-banner]').first().textContent()) ?? '';
  console.log(`[P45-1c banner] ${JSON.stringify(banner)}`);
  expect(banner, 'genuinely offline -> the offline text').toContain('offline');

  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
  await cdp.detach();
});

// ---------------------------------------------------------------------------
// Criterion 2 — the surface belongs to the app: branded, no dead space, a
// Google button with the Google mark, and a working forgot-password flow.
// ---------------------------------------------------------------------------
async function measureAccountsBox() {
  return win.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) };
    };
    const sheet = q('.sheet-accounts');
    const body = q('.sheet-body-accounts');
    const auth = q('[data-accounts-auth]');
    const cs = body ? getComputedStyle(body) : null;
    return {
      sheet: box(sheet),
      body: box(body),
      auth: box(auth),
      bodyPad: cs ? { l: parseFloat(cs.paddingLeft), r: parseFloat(cs.paddingRight) } : null,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  });
}

test('P45-2a branded header + Google mark + no dead space at 1440 and min window', async () => {
  await launch();
  await win.locator('[data-header-accounts]').click();
  await win.waitForSelector('[data-accounts-auth]', { timeout: 15000 });

  // Branded header: the app's own wordmark treatment.
  const brandMark = (await win.locator('.accounts-brand-mark').textContent()) ?? '';
  const brandName = (await win.locator('.accounts-brand-name').textContent()) ?? '';
  console.log(`[P45-2a brand] mark=${JSON.stringify(brandMark)} name=${JSON.stringify(brandName)}`);
  expect(brandMark.trim()).toBe('TF');
  expect(brandName.trim()).toBe('TFlex');

  // Google button carries the Google "G" mark (4 brand-coloured paths).
  const google = await win.locator('[data-accounts-google]').evaluate((el) => {
    const svg = el.querySelector('svg.accounts-google-mark');
    return svg ? { paths: svg.querySelectorAll('path').length, fills: [...svg.querySelectorAll('path')].map((p) => p.getAttribute('fill')) } : null;
  });
  console.log(`[P45-2a google] ${JSON.stringify(google)}`);
  expect(google, 'the Google mark svg is present').not.toBeNull();
  expect(google.paths, 'the Google G has its four brand paths').toBe(4);
  expect(new Set(google.fills).size, 'the four Google brand colours').toBe(4);

  // No dead space at 1440.
  const at1440 = await measureAccountsBox();
  console.log(`[P45-2a 1440] ${JSON.stringify(at1440)}`);
  const fill1440 = at1440.auth.w / at1440.body.w;
  console.log(`[P45-2a 1440 fill] auth/body=${fill1440.toFixed(3)} body/sheet=${(at1440.body.w / at1440.sheet.w).toFixed(3)}`);
  expect(fill1440, 'the auth form fills the sheet body at 1440').toBeGreaterThan(0.85);
  expect(at1440.body.w / at1440.sheet.w, 'the body fills the sheet at 1440').toBeGreaterThan(0.9);

  // Minimum window (640x480).
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(640, 480);
  });
  await win.waitForTimeout(900);
  const atMin = await measureAccountsBox();
  console.log(`[P45-2a min] ${JSON.stringify(atMin)}`);
  const fillMin = atMin.auth.w / atMin.body.w;
  console.log(`[P45-2a min fill] auth/body=${fillMin.toFixed(3)} body/sheet=${(atMin.body.w / atMin.sheet.w).toFixed(3)}`);
  expect(fillMin, 'the auth form fills the sheet body at the minimum window').toBeGreaterThan(0.85);
  expect(atMin.body.w / atMin.sheet.w, 'the body fills the sheet at the minimum window').toBeGreaterThan(0.9);
  // The sheet never overflows the viewport.
  expect(atMin.sheet.right, 'the sheet stays inside the viewport').toBeLessThanOrEqual(atMin.viewport.w + 1);
  await win.screenshot({ path: path.join(SHOTS, 'phase45-accounts-min.png') });
});

test('P45-2b forgot-password flow: request -> confirm', async () => {
  await launch();
  await win.locator('[data-header-accounts]').click();
  await win.waitForSelector('[data-accounts-auth]', { timeout: 15000 });

  await win.locator('[data-accounts-forgot]').click();
  await win.waitForSelector('[data-accounts-reset-lead]', { timeout: 8000 });
  const lead = (await win.locator('[data-accounts-reset-lead]').textContent()) ?? '';
  console.log(`[P45-2b request lead] ${JSON.stringify(lead)}`);
  expect(lead).toContain('reset code');

  await win.locator('[data-accounts-reset-email]').fill('qa-phase45-reset@example.invalid');
  await win.locator('[data-accounts-reset-submit]').click();

  // Either the server accepted the request (-> confirm step) or it returned an
  // honest error. Both are real server responses; report which.
  await win.waitForTimeout(4000);
  const confirmVisible = await win.locator('[data-accounts-reset-confirm-lead]').isVisible().catch(() => false);
  const banner = await win.locator('[data-accounts-banner]').first().textContent().catch(() => null);
  console.log(`[P45-2b] confirmStep=${confirmVisible} banner=${JSON.stringify(banner)}`);
  if (confirmVisible) {
    const confirmLead = (await win.locator('[data-accounts-reset-confirm-lead]').textContent()) ?? '';
    console.log(`[P45-2b confirm lead] ${JSON.stringify(confirmLead)}`);
    expect(confirmLead).toContain('reset code');
    // The confirm step exposes the code + new-password fields and the submit.
    await expect(win.locator('[data-accounts-reset-code]')).toBeVisible();
    await expect(win.locator('[data-accounts-new-password]')).toBeVisible();
    await expect(win.locator('[data-accounts-reset-confirm]')).toBeVisible();
    // In-dialog validation: a short password is refused without a network call.
    await win.locator('[data-accounts-reset-code]').fill('123456');
    await win.locator('[data-accounts-new-password]').fill('short');
    await win.locator('[data-accounts-reset-confirm]').click();
    await win.waitForTimeout(400);
    const vBanner = (await win.locator('[data-accounts-banner]').first().textContent()) ?? '';
    console.log(`[P45-2b validation] ${JSON.stringify(vBanner)}`);
    expect(vBanner).toContain('at least 8 characters');
  } else {
    // The provider refused the request for an unknown address; the flow still
    // reached the server and reported honestly (never a false offline).
    expect(banner, 'an honest server response, not offline').not.toContain('offline');
    console.log('[P45-2b] provider refused the reset request for the unknown address (honest error)');
  }
});

// ---------------------------------------------------------------------------
// Criterion 3 — honest states. Report which are exercisable live.
// ---------------------------------------------------------------------------
test('P45-3 honest states: loading, wrong credentials, reset sent', async () => {
  await launch();
  const neonResponses = [];
  win.on('response', async (r) => {
    if (/neon\.tech/i.test(r.url())) {
      let body = '';
      try { body = await r.text(); } catch (_) { /* body unavailable */ }
      neonResponses.push({ url: r.url(), status: r.status(), body });
    }
  });
  await win.locator('[data-header-accounts]').click();
  // Loading state is transient; capture it if it is observable.
  const loadingSeen = await win.locator('[data-accounts-loading]').isVisible().catch(() => false);
  console.log(`[P45-3 loading] visible=${loadingSeen}`);
  await win.waitForSelector('[data-accounts-auth]', { timeout: 15000 });

  // Wrong credentials (already proven in P45-1b; re-confirm the honest string).
  await win.locator('[data-accounts-email]').fill('qa-phase45-bogus@example.invalid');
  await win.locator('[data-accounts-password]').fill('not-a-real-password-123');
  await win.locator('[data-accounts-submit]').click();
  await win.waitForSelector('[data-accounts-banner]', { timeout: 30000 });
  await win.waitForTimeout(600);
  const wrong = (await win.locator('[data-accounts-banner]').first().textContent()) ?? '';
  console.log(`[P45-3 wrongCreds] ${JSON.stringify(wrong)}`);
  console.log(`[P45-3 neonResponses] ${JSON.stringify(neonResponses.map((r) => ({ url: r.url, status: r.status, body: r.body.slice(0, 200) })))}`);

  // The provider's real response is the truth: a credential rejection is
  // surfaced as the credential copy; any OTHER refusal must be surfaced
  // verbatim, never masked as a wrong password.
  const credential = 'That email or password is not correct. Check it and try again.';
  const providerVerbatim = /^The account service returned an error:/;
  const resp = neonResponses.find((r) => /sign-in\/email/.test(r.url)) ?? neonResponses[0];
  const providerCode = (resp?.body.match(/"code"\s*:\s*"([^"]+)"/)?.[1] ?? '').toUpperCase();
  const credentialCodes = ['INVALID_EMAIL_OR_PASSWORD', 'INVALID_CREDENTIALS', 'USER_NOT_FOUND'];
  console.log(`[P45-3 providerCode] ${providerCode} status=${resp?.status}`);
  if (credentialCodes.includes(providerCode)) {
    expect(wrong, 'a credential rejection is surfaced as the credential copy').toBe(credential);
  } else {
    expect(wrong, 'a non-credential refusal is never masked as a wrong password').not.toBe(credential);
    expect(wrong, 'the provider reason is surfaced verbatim').toMatch(providerVerbatim);
  }

  // The unverified-email and OTP states need a real account; report NOT YET.
  console.log('[P45-3] unverified-email + OTP states: NOT YET VERIFIED (need a real account)');
});

// ---------------------------------------------------------------------------
// Criterion 2 (confirm half) — the reset CONFIRM step needs a real account: the
// real provider refuses an unknown address, and the CSP (correctly) blocks a
// local stub host. This test proves the CSP narrowness by asserting the block,
// and records the confirm step as NOT YET VERIFIED.
// ---------------------------------------------------------------------------
function startResetStub() {
  const hits = [];
  const server = require('node:http').createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, body });
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      });
      res.end(JSON.stringify({ status: true }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, hits, port: server.address().port }));
  });
}

test('P45-2c CSP blocks a non-provider host (narrowness); reset confirm NOT YET', async () => {
  const stub = await startResetStub();
  process.env.TFLEX_AUTH_BASE_URL = `http://127.0.0.1:${stub.port}/auth`;
  const cspViolations = [];
  try {
    await launch();
    win.on('console', (m) => {
      const t = m.text();
      if (/Content Security Policy|Refused to connect/.test(t)) cspViolations.push(t);
    });
    await win.locator('[data-header-accounts]').click();
    await win.waitForSelector('[data-accounts-auth]', { timeout: 15000 });
    await win.locator('[data-accounts-forgot]').click();
    await win.waitForSelector('[data-accounts-reset-lead]', { timeout: 8000 });
    await win.locator('[data-accounts-reset-email]').fill('qa-phase45-reset@example.invalid');
    await win.locator('[data-accounts-reset-submit]').click();
    await win.waitForTimeout(3000);
    console.log(`[P45-2c cspViolations] ${JSON.stringify(cspViolations)}`);
    console.log(`[P45-2c stub hits] ${JSON.stringify(stub.hits.map((h) => h.url))}`);
    // The narrow CSP refuses the localhost stub: the request never reaches it.
    expect(cspViolations.length, 'the CSP blocked the non-provider host').toBeGreaterThan(0);
    expect(stub.hits.length, 'the stub received nothing (blocked before the wire)').toBe(0);
    console.log('[P45-2c] reset CONFIRM step: NOT YET VERIFIED (needs a real account; the CSP correctly blocks a local stub)');
  } finally {
    delete process.env.TFLEX_AUTH_BASE_URL;
    await new Promise((r) => stub.server.close(r));
  }
});

// ---------------------------------------------------------------------------
// Criterion 4 — create from clipboard: a copied IMAGE inserts a row with a
// working preview; plain text shows the no-image message.
// ---------------------------------------------------------------------------
const { PNG } = require('pngjs');
const { pathToFileURL } = require('node:url');

function makePng(filePath) {
  const png = new PNG({ width: 12, height: 12 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 220; png.data[i + 1] = 30; png.data[i + 2] = 30; png.data[i + 3] = 255;
  }
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

async function writeClipboardUriList(uri) {
  await app.evaluate(async ({ clipboard, ClipboardItem }, u) => {
    await clipboard.write([new ClipboardItem({ 'text/uri-list': u })]);
  }, uri);
}

async function writeClipboardText(text) {
  await app.evaluate(async ({ clipboard }, t) => {
    await clipboard.writeText(t);
  }, text);
}

async function openCreateFromImages() {
  await runTool(win, 'createFromImages');
  await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 15000 });
  await win.waitForSelector('[data-create-from-clipboard]', { timeout: 10000 });
}

test('P45-4a copied IMAGE file -> a row with a working preview', async () => {
  await launch();
  const pngPath = path.join(os.tmpdir(), `tflex-p45-clip-${Date.now()}.png`);
  makePng(pngPath);
  await writeClipboardUriList(pathToFileURL(pngPath).href);
  try {
    await openCreateFromImages();
    await win.locator('[data-create-from-clipboard]').click();
    await win.waitForSelector('[data-create-image-row="0"]', { timeout: 15000 });
    const row = await win.locator('[data-create-image-row="0"]').evaluate((el) => {
      const img = el.querySelector('[data-create-thumb]');
      return {
        name: el.querySelector('.create-image-name')?.textContent ?? null,
        thumbSrc: img ? img.getAttribute('src') : null,
        naturalW: img ? img.naturalWidth : 0,
        naturalH: img ? img.naturalHeight : 0,
        complete: img ? img.complete : false,
      };
    });
    console.log(`[P45-4a row] ${JSON.stringify(row)}`);
    expect(row.thumbSrc, 'the row carries a preview img').not.toBeNull();
    expect(row.thumbSrc.startsWith('blob:'), 'the preview is a blob URL').toBe(true);
    expect(row.naturalW, 'the preview image actually decoded').toBeGreaterThan(0);
    expect(row.naturalH, 'the preview image actually decoded').toBeGreaterThan(0);
    expect(row.name, 'the row is named as a clipboard image').toContain('Clipboard image');
    // The confirm button is enabled now that an image is present.
    await expect(win.locator('[data-create-confirm]')).toBeEnabled();
    await win.screenshot({ path: path.join(SHOTS, 'phase45-clipboard-image.png') });
  } finally {
    fs.rmSync(pngPath, { force: true });
  }
});

test('P45-4b plain text -> the no-image message, no row', async () => {
  await launch();
  await writeClipboardText('this is just some plain text, not an image');
  await openCreateFromImages();
  await win.locator('[data-create-from-clipboard]').click();
  await win.waitForSelector('[data-create-from-images-dialog] [role="alert"]', { timeout: 15000 });
  const msg = (await win.locator('[data-create-from-images-dialog] [role="alert"]').textContent()) ?? '';
  const rows = await win.locator('[data-create-image-row]').count();
  console.log(`[P45-4b message] ${JSON.stringify(msg)} rows=${rows}`);
  expect(msg).toContain('The clipboard has no image');
  expect(rows, 'plain text never becomes an image row').toBe(0);
  await expect(win.locator('[data-create-confirm]')).toBeDisabled();
});

// ---------------------------------------------------------------------------
// Criterion 5 — distinct tab colours: three adjacent tabs differ in all three
// themes; the active/inactive state stays obvious; text contrast floors hold.
// ---------------------------------------------------------------------------
async function readTabs() {
  return win.evaluate(() => {
    const parse = (c) => {
      if (!c) return null;
      let m = /rgba?\(([^)]+)\)/.exec(c);
      if (m) {
        const p = m[1].split(',').map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      }
      m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(c);
      if (m) {
        return { r: Number(m[1]) * 255, g: Number(m[2]) * 255, b: Number(m[3]) * 255, a: m[4] === undefined ? 1 : Number(m[4]) };
      }
      return null;
    };
    const lum = (c) => {
      const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    // Composite an element's own background over its ancestors' backgrounds.
    const comp = (el) => {
      const chain = []; let n = el;
      while (n && n.nodeType === 1) { chain.push(n); n = n.parentElement; }
      chain.reverse();
      let acc = { r: 255, g: 255, b: 255, a: 1 };
      for (const node of chain) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (!bg || bg.a === 0) continue;
        acc = { r: bg.r * bg.a + acc.r * (1 - bg.a), g: bg.g * bg.a + acc.g * (1 - bg.a), b: bg.b * bg.a + acc.b * (1 - bg.a), a: 1 };
      }
      return acc;
    };
    return [...document.querySelectorAll('.tab')].map((t) => {
      const cs = getComputedStyle(t);
      const chip = t.querySelector('.tab-colour-chip');
      const chipCs = chip ? getComputedStyle(chip) : null;
      const fg = parse(cs.color);
      const bg = comp(t);
      return {
        id: t.getAttribute('data-tab-id'),
        slot: t.getAttribute('data-tab-colour'),
        active: t.classList.contains('tab-active'),
        bg: cs.backgroundColor,
        color: cs.color,
        chip: chipCs ? chipCs.backgroundColor : null,
        contrast: fg ? +ratio(fg, bg).toFixed(2) : null,
      };
    });
  });
}

test('P45-5 three adjacent tabs differ in all three themes; contrast floors', async () => {
  await launch();
  await openViaDialog(getSamplePath('report.pdf'));
  await openViaDialog(getSamplePath('form.pdf'));
  await openViaDialog(getSamplePath('long.pdf'));
  await win.waitForTimeout(800);
  const count = await win.locator('.tab').count();
  console.log(`[P45-5] tab count=${count}`);
  expect(count, 'three tabs are open').toBe(3);

  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(theme);
    const tabs = await readTabs();
    console.log(`[P45-5 ${theme}] ${JSON.stringify(tabs)}`);
    expect(tabs.length).toBe(3);
    // Adjacent tabs carry different palette slots and different chip colours.
    expect(tabs[0].slot, `${theme}: tab0 vs tab1 slot`).not.toBe(tabs[1].slot);
    expect(tabs[1].slot, `${theme}: tab1 vs tab2 slot`).not.toBe(tabs[2].slot);
    expect(tabs[0].chip, `${theme}: tab0 vs tab1 chip colour`).not.toBe(tabs[1].chip);
    expect(tabs[1].chip, `${theme}: tab1 vs tab2 chip colour`).not.toBe(tabs[2].chip);
    // The active tab is obvious: exactly one active, with the strong text tier.
    const active = tabs.filter((t) => t.active);
    expect(active.length, `${theme}: exactly one active tab`).toBe(1);
    const inactive = tabs.filter((t) => !t.active);
    expect(active[0].color, `${theme}: active text is the strong tier`).not.toBe(inactive[0].color);
    // Text contrast floors on the tinted tabs (>= 4.5:1).
    for (const t of tabs) {
      console.log(`[P45-5 ${theme}] tab ${t.id} active=${t.active} contrast=${t.contrast}`);
      expect(t.contrast, `${theme}: tab ${t.id} text contrast >= 4.5`).toBeGreaterThanOrEqual(4.5);
    }
  }
  await win.screenshot({ path: path.join(SHOTS, 'phase45-tab-colours.png') });
});

// ---------------------------------------------------------------------------
// Criterion 6 — the Multi Mode activation animation: token-driven, the panes
// are the SAME nodes, reduced motion switches instantly.
// ---------------------------------------------------------------------------
async function startScreencast(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (ev) => {
    frames.push({ data: ev.data, recv: Date.now() });
    cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', quality: 70, maxWidth: 720, maxHeight: 540, everyNthFrame: 1 });
  return { cdp, frames };
}
async function stopScreencast(cdp) {
  try { await cdp.send('Page.stopScreencast'); } catch (_) { /* ignore */ }
  try { await cdp.detach(); } catch (_) { /* ignore */ }
}

function installModeProbe() {
  const g = window;
  g.__p45mode = { anims: [] };
  document.addEventListener('animationstart', (e) => {
    if (e.animationName !== 'tf-mode-split') return;
    const cs = getComputedStyle(e.target);
    g.__p45mode.anims.push({
      phase: 'start', name: e.animationName,
      dur: cs.animationDuration, ease: cs.animationTimingFunction,
      pane: e.target.getAttribute('data-pane'),
      opacity: cs.opacity, filter: cs.filter,
    });
  }, true);
  document.addEventListener('animationend', (e) => {
    if (e.animationName !== 'tf-mode-split') return;
    g.__p45mode.anims.push({ phase: 'end', name: e.animationName, pane: e.target.getAttribute('data-pane') });
  }, true);
}

test('P45-6a entering Multi Mode animates on the layout token; same nodes', async () => {
  await launch();
  await openViaDialog(getSamplePath('report.pdf'));
  await win.waitForSelector('.tab-pane[data-pane-tab]', { timeout: 15000 });

  // Mark the live pane node so a remount is detectable.
  await win.evaluate(() => {
    const el = document.querySelector('.tab-pane[data-pane-tab]');
    el.__p45mark = 'same-node';
    el.setAttribute('data-p45-mark', '1');
  });
  await win.evaluate(installModeProbe);
  const { cdp, frames } = await startScreencast(win);
  const clickWall = Date.now();
  await win.locator('[data-header-multi-mode]').click();
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1200);
  await stopScreencast(cdp);

  const data = await win.evaluate(() => window.__p45mode);
  const starts = data.anims.filter((a) => a.phase === 'start');
  const ends = data.anims.filter((a) => a.phase === 'end');
  console.log(`[P45-6a anims] ${JSON.stringify(data.anims)}`);
  expect(starts.length, 'the mode toggle started the tf-mode-split animation').toBeGreaterThan(0);
  expect(ends.length, 'the animation completed').toBeGreaterThan(0);
  const s0 = starts[0];
  console.log(`[P45-6a computed] dur=${s0.dur} ease=${s0.ease} opacity=${s0.opacity} filter=${s0.filter}`);
  expect(s0.dur, 'the mode animation runs over the 350ms layout token').toBe('0.35s');
  expect(s0.ease, 'the mode animation uses the layout easing').toContain('cubic-bezier(0.4, 0, 0.2, 1)');
  expect(s0.opacity, 'the pane is fully opaque (no cross-fade)').toBe('1');
  expect(s0.filter, 'no filter recolour').toBe('none');

  // The pane is the SAME node (the marker survived) and is visible.
  const same = await win.evaluate(() => {
    const el = document.querySelector('.tab-pane[data-pane-tab]');
    return { mark: el ? el.__p45mark : null, attr: el ? el.getAttribute('data-p45-mark') : null, hidden: el ? el.getAttribute('aria-hidden') : null };
  });
  console.log(`[P45-6a sameNode] ${JSON.stringify(same)}`);
  expect(same.mark, 'the pane node was not remounted').toBe('same-node');
  expect(same.attr, 'the pane node was not remounted').toBe('1');

  // Painted frames across the transition.
  const idx0 = frames.findIndex((f) => f.recv >= clickWall);
  const saved = [];
  for (let i = Math.max(0, idx0 - 1); i < Math.min(frames.length, idx0 + 2); i += 1) {
    const p = path.join(SHOTS, `phase45-mode-enter-${String(i - Math.max(0, idx0 - 1)).padStart(2, '0')}.png`);
    fs.writeFileSync(p, Buffer.from(frames[i].data, 'base64'));
    saved.push({ path: p, dt: frames[i].recv - clickWall });
  }
  console.log(`[P45-6a frames] total=${frames.length} firstAfterClick=${idx0} saved=${JSON.stringify(saved.map((s) => ({ dt: s.dt, f: path.basename(s.path) })))}`);
  expect(saved.length, 'painted frames captured across the entering transition').toBeGreaterThanOrEqual(2);

  // Leaving Multi Mode also animates (frame capture).
  await win.evaluate(() => { window.__p45mode.anims = []; });
  const { cdp: cdp2, frames: frames2 } = await startScreencast(win);
  const leaveWall = Date.now();
  await win.locator('[data-header-multi-mode]').click();
  await win.waitForSelector('.tab-stage[data-multi-mode="false"]', { timeout: 15000 });
  await win.waitForTimeout(1000);
  await stopScreencast(cdp2);
  const data2 = await win.evaluate(() => window.__p45mode);
  const starts2 = data2.anims.filter((a) => a.phase === 'start');
  console.log(`[P45-6a leaving anims] ${JSON.stringify(data2.anims)}`);
  expect(starts2.length, 'leaving Multi Mode also animates').toBeGreaterThan(0);
  expect(starts2[0].dur, 'the leaving animation uses the layout token').toBe('0.35s');
  const idxL = frames2.findIndex((f) => f.recv >= leaveWall);
  const savedL = [];
  for (let i = Math.max(0, idxL - 1); i < Math.min(frames2.length, idxL + 1); i += 1) {
    const p = path.join(SHOTS, `phase45-mode-leave-${String(i - Math.max(0, idxL - 1)).padStart(2, '0')}.png`);
    fs.writeFileSync(p, Buffer.from(frames2[i].data, 'base64'));
    savedL.push({ path: p, dt: frames2[i].recv - leaveWall });
  }
  console.log(`[P45-6a leaving frames] total=${frames2.length} firstAfterClick=${idxL} saved=${JSON.stringify(savedL.map((s) => ({ dt: s.dt, f: path.basename(s.path) })))}`);
  expect(savedL.length, 'painted frames captured across the leaving transition').toBeGreaterThanOrEqual(1);
});

test('P45-6b reduced motion: the mode switch is instant, no animation', async () => {
  await launch();
  await openViaDialog(getSamplePath('report.pdf'));
  await win.waitForSelector('.tab-pane[data-pane-tab]', { timeout: 15000 });

  const cdp = await win.context().newCDPSession(win);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await win.waitForTimeout(500);
  const matches = await win.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  console.log(`[P45-6b] prefers-reduced-motion matches=${matches}`);
  expect(matches).toBe(true);

  await win.evaluate(installModeProbe);
  await win.locator('[data-header-multi-mode]').click();
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(900);
  const data = await win.evaluate(() => window.__p45mode);
  const starts = data.anims.filter((a) => a.phase === 'start');
  const armed = await win.evaluate(() => document.querySelector('.tab-stage')?.hasAttribute('data-mode-anim') ?? null);
  console.log(`[P45-6b] animStarts=${starts.length} data-mode-anim=${armed}`);
  expect(starts.length, 'no mode animation under reduced motion').toBe(0);
  expect(armed, 'the animation band is never armed under reduced motion').toBe(false);
  // The switch still happened.
  const multi = await win.locator('.tab-stage').getAttribute('data-multi-mode');
  expect(multi).toBe('true');
  await cdp.detach();
});

// ---------------------------------------------------------------------------
// Criterion 7 — the EDIT dock: with "Edit mode off" armed, no other edit verb
// looks selected, and it is the LEFTMOST verb.
// ---------------------------------------------------------------------------
async function readEditVerbs() {
  return win.evaluate(() => {
    const read = (el, lane) => {
      const cs = getComputedStyle(el);
      return {
        id: el.getAttribute('data-dock-verb') || el.getAttribute('data-dock-overflow-item'),
        lane,
        pressed: el.getAttribute('aria-pressed') === 'true',
        bg: cs.backgroundColor,
        color: cs.color,
        boxShadow: cs.boxShadow,
        disabled: el.disabled,
      };
    };
    const inline = [...document.querySelectorAll('[data-action-dock] [data-dock-verb]')].map((el) => read(el, 'inline'));
    const overflow = [...document.querySelectorAll('[data-dock-overflow-item]')].map((el) => read(el, 'overflow'));
    return { inline, overflow };
  });
}

async function clickEditVerb(id) {
  const inline = win.locator(`[data-action-dock] [data-dock-verb="${id}"]`);
  if ((await inline.count()) > 0) {
    await inline.first().click();
    await win.waitForTimeout(500);
    return 'inline';
  }
  await win.locator('[data-dock-overflow]').first().click();
  await win.waitForSelector('[data-dock-overflow-menu]', { timeout: 8000 });
  await win.locator(`[data-dock-overflow-item="${id}"]`).first().click();
  await win.waitForTimeout(500);
  return 'overflow';
}

test('P45-7 EDIT dock: Edit mode off is leftmost and the only pressed verb', async () => {
  await launch();
  await openViaDialog(getSamplePath('report.pdf'));
  await gotoStage(win, 2);
  await win.waitForSelector('[data-action-dock]', { timeout: 10000 });
  await win.waitForTimeout(500);

  // Arm "Edit mode off".
  const lane = await clickEditVerb('editToolOff');
  console.log(`[P45-7] editToolOff clicked via ${lane}`);
  const state1 = await readEditVerbs();
  console.log(`[P45-7 state1 inline] ${JSON.stringify(state1.inline)}`);
  if (state1.overflow.length > 0) console.log(`[P45-7 state1 overflow] ${JSON.stringify(state1.overflow)}`);
  const all1 = [...state1.inline, ...state1.overflow];
  const pressed1 = all1.filter((v) => v.pressed).map((v) => v.id);
  console.log(`[P45-7 state1 pressed] ${JSON.stringify(pressed1)}`);
  expect(pressed1, 'only editToolOff is pressed').toEqual(['editToolOff']);
  // Leftmost: the first inline verb is editToolOff.
  expect(state1.inline[0]?.id, 'editToolOff is the leftmost inline verb').toBe('editToolOff');
  // The armed verb carries the pressed treatment (accent wash + inset ring).
  const lead = state1.inline[0];
  console.log(`[P45-7 lead armed] bg=${lead.bg} color=${lead.color} shadow=${lead.boxShadow}`);
  expect(lead.bg, 'the armed verb carries the accent wash').toContain('37, 99, 235');
  expect(lead.boxShadow, 'the armed verb carries the inset ring').toContain('inset');

  // Arm "Edit text": only editText is pressed; editToolOff is not.
  await clickEditVerb('editText');
  const state2 = await readEditVerbs();
  console.log(`[P45-7 state2 inline] ${JSON.stringify(state2.inline)}`);
  if (state2.overflow.length > 0) console.log(`[P45-7 state2 overflow] ${JSON.stringify(state2.overflow)}`);
  const all2 = [...state2.inline, ...state2.overflow];
  const pressed2 = all2.filter((v) => v.pressed).map((v) => v.id);
  console.log(`[P45-7 state2 pressed] ${JSON.stringify(pressed2)}`);
  expect(pressed2, 'only editText is pressed').toEqual(['editText']);
  const off2 = all2.find((v) => v.id === 'editToolOff');
  expect(off2?.pressed, 'editToolOff is not pressed while editText is armed').toBe(false);
  expect(state2.inline[0]?.id, 'editToolOff stays leftmost').toBe('editToolOff');
  // The lead verb, when NOT armed, is ink-only (no accent wash).
  const lead2 = state2.inline[0];
  console.log(`[P45-7 lead unarmed] bg=${lead2.bg} color=${lead2.color} shadow=${lead2.boxShadow}`);
  expect(lead2.bg, 'the unarmed lead verb has no accent wash').toMatch(/rgba?\(0, 0, 0, 0\)|transparent/);
  expect(lead2.boxShadow, 'the unarmed lead verb has no inset ring').toBe('none');
});

// ---------------------------------------------------------------------------
// Criterion 8 — the first thumbnail preview does not intersect "Undo last
// change" (measured boxes, zero intersection) in the rail's normal and
// collapsed states and with the Outline open/closed.
// ---------------------------------------------------------------------------
async function measureUndoThumb() {
  return win.evaluate(() => {
    const undo = document.querySelector('button[aria-label="Undo last change"]');
    const thumb = document.querySelector('.thumb');
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const u = box(undo), t = box(thumb);
    let inter = null;
    if (u && t) {
      const ix = Math.max(0, Math.min(u.r, t.r) - Math.max(u.l, t.l));
      const iy = Math.max(0, Math.min(u.b, t.b) - Math.max(u.t, t.t));
      inter = { w: ix, h: iy, area: ix * iy };
    }
    return { undo: u, thumb: t, inter };
  });
}

test('P45-8 first thumbnail never intersects "Undo last change"', async () => {
  await launch();
  await openViaDialog(getSamplePath('report.pdf'));
  await ensurePanelExpanded(win);
  await win.waitForTimeout(600);

  const states = [];
  // Normal, Outline open.
  states.push(['outline-open', await measureUndoThumb()]);
  // Outline closed.
  if ((await win.locator('[data-outline-toggle]').count()) > 0) {
    await win.locator('[data-outline-toggle]').first().click();
    await win.waitForTimeout(500);
    states.push(['outline-closed', await measureUndoThumb()]);
    await win.locator('[data-outline-toggle]').first().click();
    await win.waitForTimeout(500);
  }
  // Panel collapsed.
  await win.locator('[data-rail-collapse]').first().click();
  await win.waitForTimeout(600);
  states.push(['panel-collapsed', await measureUndoThumb()]);
  // Panel expanded again.
  await win.locator('[data-rail-collapse]').first().click();
  await win.waitForTimeout(600);
  states.push(['panel-expanded', await measureUndoThumb()]);

  for (const [name, m] of states) {
    console.log(`[P45-8 ${name}] undo=${JSON.stringify(m.undo)} thumb=${JSON.stringify(m.thumb)} inter=${JSON.stringify(m.inter)}`);
    if (m.undo && m.thumb) {
      expect(m.inter.area, `${name}: zero intersection`).toBe(0);
    }
  }
});

// ---------------------------------------------------------------------------
// Criterion 9 — the reshaped tool dialogs are squarer; no control clipped and
// no scrollbar appeared where there was none.
// ---------------------------------------------------------------------------
async function measureOpenDialog() {
  return win.evaluate(() => {
    const d = document.querySelector('.modal-dialog');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    const body = d.querySelector('.modal-body');
    const footer = d.querySelector('.modal-footer');
    const fr = footer ? footer.getBoundingClientRect() : null;
    return {
      cls: d.className,
      w: Math.round(r.width), h: Math.round(r.height),
      aspect: +(r.width / r.height).toFixed(3),
      body: body ? { sh: body.scrollHeight, ch: body.clientHeight, sw: body.scrollWidth, cw: body.clientWidth } : null,
      footerVisible: fr ? (fr.bottom <= window.innerHeight + 1 && fr.top >= 0) : null,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  });
}

async function closeOpenDialog() {
  const close = win.locator('.modal-dialog .modal-close').first();
  if ((await close.count()) > 0) {
    await close.click().catch(() => {});
  } else {
    await win.keyboard.press('Escape');
  }
  await win.waitForTimeout(500);
}

test('P45-9 reshaped tool dialogs: squarer boxes, no clipping/scrollbar loss', async () => {
  await launch();
  await openViaDialog(getSamplePath('report.pdf'));
  const tools = ['watermark', 'optimize', 'merge', 'split', 'cropPages', 'renumberPages', 'stamp', 'exportPages', 'recognizeText', 'audit', 'exportDocx', 'exportText', 'insertPages', 'replacePages'];
  const results = [];
  for (const id of tools) {
    try {
      await runTool(win, id);
      await win.waitForSelector('.modal-dialog', { timeout: 8000 });
      await win.waitForTimeout(500);
      const m = await measureOpenDialog();
      if (m) {
        results.push([id, m]);
        console.log(`[P45-9 ${id}] w=${m.w} h=${m.h} aspect=${m.aspect} body=${JSON.stringify(m.body)} footerVisible=${m.footerVisible}`);
      }
      await closeOpenDialog();
    } catch (e) {
      console.log(`[P45-9 ${id}] could not open: ${e.message.split('\n')[0]}`);
      await win.keyboard.press('Escape').catch(() => {});
      await win.waitForTimeout(400);
    }
  }
  // Save As (a header control, not a dock tool).
  try {
    await win.locator('[data-toolbar-save-as]').click();
    await win.waitForSelector('.modal-dialog', { timeout: 8000 });
    await win.waitForTimeout(500);
    const m = await measureOpenDialog();
    if (m) { results.push(['saveAs', m]); console.log(`[P45-9 saveAs] w=${m.w} h=${m.h} aspect=${m.aspect} body=${JSON.stringify(m.body)} footerVisible=${m.footerVisible}`); }
    await closeOpenDialog();
  } catch (e) {
    console.log(`[P45-9 saveAs] could not open: ${e.message.split('\n')[0]}`);
  }

  // Renumber pages: its only affordance is the Inspector's `Label - renumber.`.
  try {
    await win.locator('[data-inspector-action="renumber"]').click();
    await win.waitForSelector('.modal-dialog', { timeout: 8000 });
    await win.waitForTimeout(500);
    const m = await measureOpenDialog();
    if (m) { results.push(['renumberPages', m]); console.log(`[P45-9 renumberPages] w=${m.w} h=${m.h} aspect=${m.aspect} body=${JSON.stringify(m.body)} footerVisible=${m.footerVisible}`); }
    await closeOpenDialog();
  } catch (e) {
    console.log(`[P45-9 renumberPages] could not open: ${e.message.split('\n')[0]}`);
  }

  expect(results.length, 'at least the named tool dialogs opened').toBeGreaterThanOrEqual(8);
  for (const [id, m] of results) {
    // Not a tall slab: the box is at least as wide as it is tall (square-ish).
    expect(m.aspect, `${id}: box is not a tall slab (aspect ${m.aspect})`).toBeGreaterThanOrEqual(0.9);
    // No horizontal overflow (no control clipped sideways).
    if (m.body) {
      expect(m.body.sw, `${id}: no horizontal overflow`).toBeLessThanOrEqual(m.body.cw + 1);
    }
    // The footer (confirm/cancel) is on screen.
    expect(m.footerVisible, `${id}: the footer is visible`).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Criterion 10 — the Watermark custom X/Y tick disables the grid, enables X/Y
// with validation, restores the grid when unticked, and the X/Y are ACTUALLY
// APPLIED to the produced watermark (verified on the saved output).
// ---------------------------------------------------------------------------
async function applyWatermarkAndSave(x, y, outPath) {
  await runTool(win, 'watermark');
  await win.waitForSelector('[data-watermark-dialog]', { timeout: 15000 });
  await win.locator('[data-watermark-custom-xy]').check();
  await win.waitForTimeout(300);
  await win.locator('[data-watermark-x]').fill(String(x));
  await win.locator('[data-watermark-y]').fill(String(y));
  await win.locator('[data-watermark-confirm]').click();
  await win.waitForTimeout(1500);
  // Save As through the real UI, with the OS save dialog stubbed.
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, outPath);
  await win.locator('[data-toolbar-save-as]').click();
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 8000 });
  await win.locator('[data-save-as-confirm]').click();
  for (let i = 0; i < 40; i += 1) {
    if (fs.existsSync(outPath)) break;
    await win.waitForTimeout(250);
  }
  expect(fs.existsSync(outPath), `saved output exists: ${outPath}`).toBe(true);
}

function readWatermarkTm(filePath) {
  const raw = fs.readFileSync(filePath, 'latin1');
  const re = /1 0 0 1 (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) Tm/g;
  const out = [];
  let m;
  while ((m = re.exec(raw)) !== null) out.push({ x: Number(m[1]), y: Number(m[2]) });
  return out;
}

test('P45-10 watermark custom X/Y: grid disabled, validation, applied to output', async () => {
  await launch();
  await openViaDialog(getSamplePath('report.pdf'));
  await runTool(win, 'watermark');
  await win.waitForSelector('[data-watermark-dialog]', { timeout: 15000 });

  // Initial: grid enabled, X/Y disabled.
  const before = await win.evaluate(() => ({
    xDisabled: document.querySelector('[data-watermark-x]').disabled,
    yDisabled: document.querySelector('[data-watermark-y]').disabled,
    slots: document.querySelectorAll('[data-watermark-position]').length,
    slotDisabled: document.querySelector('[data-watermark-position="center"]').disabled,
  }));
  console.log(`[P45-10 before] ${JSON.stringify(before)}`);
  expect(before.xDisabled).toBe(true);
  expect(before.yDisabled).toBe(true);
  expect(before.slots).toBe(9);
  expect(before.slotDisabled).toBe(false);

  // Tick: grid visibly disabled (still 9 slots), X/Y enabled and seeded.
  await win.locator('[data-watermark-custom-xy]').check();
  await win.waitForTimeout(300);
  const after = await win.evaluate(() => ({
    xDisabled: document.querySelector('[data-watermark-x]').disabled,
    yDisabled: document.querySelector('[data-watermark-y]').disabled,
    slots: document.querySelectorAll('[data-watermark-position]').length,
    slotDisabled: document.querySelector('[data-watermark-position="center"]').disabled,
    xVal: document.querySelector('[data-watermark-x]').value,
    yVal: document.querySelector('[data-watermark-y]').value,
    hint: !!document.querySelector('[data-watermark-custom-hint]'),
  }));
  console.log(`[P45-10 after tick] ${JSON.stringify(after)}`);
  expect(after.slotDisabled, 'the grid slots are disabled while ticked').toBe(true);
  expect(after.slots, 'the slots are disabled, never hidden').toBe(9);
  expect(after.xDisabled).toBe(false);
  expect(after.yDisabled).toBe(false);
  expect(after.xVal).toBe('72');
  expect(after.yVal).toBe('72');
  expect(after.hint).toBe(true);

  // Validation: an out-of-bounds X is refused in-dialog.
  await win.locator('[data-watermark-x]').fill('99999');
  await win.locator('[data-watermark-confirm]').click();
  await win.waitForTimeout(400);
  const alert = (await win.locator('[data-watermark-dialog] [role="alert"]').first().textContent().catch(() => '')) ?? '';
  console.log(`[P45-10 validation] ${JSON.stringify(alert)}`);
  expect(alert).toContain('between 0 and 14400');

  // Untick restores the grid.
  await win.locator('[data-watermark-custom-xy]').uncheck();
  await win.waitForTimeout(300);
  const restored = await win.evaluate(() => ({
    slotDisabled: document.querySelector('[data-watermark-position="center"]').disabled,
    xDisabled: document.querySelector('[data-watermark-x]').disabled,
  }));
  console.log(`[P45-10 restored] ${JSON.stringify(restored)}`);
  expect(restored.slotDisabled).toBe(false);
  expect(restored.xDisabled).toBe(true);
  await closeOpenDialog();

  // Apply X=120,Y=340 and save; then apply X=120,Y=100 on top and save again.
  const out1 = path.join(os.tmpdir(), `tflex-p45-wm1-${Date.now()}.pdf`);
  const out2 = path.join(os.tmpdir(), `tflex-p45-wm2-${Date.now()}.pdf`);
  try {
    await applyWatermarkAndSave(120, 340, out1);
    const tm1 = readWatermarkTm(out1);
    console.log(`[P45-10 out1 Tm] ${JSON.stringify(tm1.slice(0, 2))} (${tm1.length} total)`);
    expect(tm1.length, 'the saved PDF carries the watermark text matrix').toBeGreaterThan(0);
    expect(tm1[0].x, 'the custom X is applied exactly').toBeCloseTo(120, 3);
    const y1 = +tm1[0].y.toFixed(2);

    // A second watermark with a different Y, on top of the first.
    await applyWatermarkAndSave(120, 100, out2);
    const tm2 = readWatermarkTm(out2);
    const ys = [...new Set(tm2.map((t) => +t.y.toFixed(2)))].sort((a, b) => a - b);
    console.log(`[P45-10 out2 distinct Y] ${JSON.stringify(ys)}`);
    expect(tm2[0].x, 'the custom X is applied exactly').toBeCloseTo(120, 3);
    expect(ys.length, 'both watermarks are present').toBeGreaterThanOrEqual(2);
    // The Y delta (340 -> 100) moves the baseline by exactly 240pt.
    const dy = +(ys[ys.length - 1] - ys[0]).toFixed(2);
    console.log(`[P45-10 Y delta] ${dy} (expected 240); y1=${y1}`);
    expect(dy, 'the custom Y is applied (240pt delta)').toBeCloseTo(240, 1);
  } finally {
    fs.rmSync(out1, { force: true });
    fs.rmSync(out2, { force: true });
  }
});

