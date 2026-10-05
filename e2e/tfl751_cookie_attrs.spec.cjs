// TFL-751 chunk C2 - LIVE attribute-level measurement of the sign-in 400.
//
// WHY: the operator's Google sign-in is rejected by Neon Auth with
// "Session challenge cookie not found". C1 added an attribute diagnostic
// (`name|domain|path|sameSite|expires`, never a value). This spec exercises it
// on the REAL Electron dev build against the LIVE auth host: it dumps the
// auth-host cookie ATTRIBUTES from the main process BEFORE and AFTER the flow
// starts (the phase-51 clear) and again when the exchange fires, and it prints
// the on-disk `attrs=` line verbatim.
//
// It does NOT stub `shell.openExternal` and does NOT stand up a stub host: the
// app hands the provider URL to the OS DEFAULT BROWSER. The flow can only land
// if that browser has a Google session, so INCONCLUSIVE is a valid outcome.
// No cookie VALUE, token, OAuth code or verifier is ever read or printed.
//
// VERDICT ([TFL751] VERDICT= line): PASS only when signed-in with a real email
// AND the trace has `exchange-stored`; FAIL when the loopback landed and the
// exchange rejected (`exchange-failed`); INCONCLUSIVE otherwise.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

// Resolve the LIVE auth base exactly like src/main/services/accounts/config.ts:
// the env override first, else the `tflex.neonAuthBaseUrl` block in package.json.
function resolveAuthBase() {
  const env = process.env.TFLEX_AUTH_BASE_URL;
  if (typeof env === 'string' && env.trim().length > 0) return env.trim().replace(/\/+$/, '');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const base = pkg && pkg.tflex && pkg.tflex.neonAuthBaseUrl;
    if (typeof base === 'string' && base.trim().length > 0) return base.trim().replace(/\/+$/, '');
  } catch {
    /* fall through to null */
  }
  return null;
}

// Names/attributes only, NEVER values. Mirrors the cookies.get call pattern at
// e2e/phase522_oauth_exchange.spec.cjs:148-151.
async function cookieAttrs(app, base) {
  return app.evaluate(async ({ session }, url) => {
    const cookies = await session.defaultSession.cookies.get({ url });
    return cookies.map((c) => ({
      name: c.name,
      domain: c.domain,
      path: c.path,
      sameSite: c.sameSite,
      expirationDate: c.expirationDate
        ? new Date(c.expirationDate > 1e12 ? c.expirationDate : c.expirationDate * 1000).toISOString()
        : 'session',
      session: c.session === true,
    }));
  }, base);
}

const fmt = (rows) =>
  rows.map((c) => `${c.name}|${c.domain}|${c.path}|${c.sameSite}|${c.expirationDate}`).join(' ; ');

let app = null;
test.setTimeout(180000);

test.afterAll(async () => {
  if (app) await hardClose(app, 'tfl751-cookie-attrs');
  app = null;
});

test('TFL751 C2: live cookie attributes around the sign-in 400', async () => {
  const base = resolveAuthBase();
  console.log(`[TFL751] auth base=${base}`);
  expect(base, 'a configured auth base').toBeTruthy();

  app = await launchApp([], null);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  // Subscribe to the trace BEFORE any flow action so challenge-clear cannot be missed.
  await win.evaluate(() => {
    window.__tfl751trace = [];
    if (window.tflex && window.tflex.accounts && typeof window.tflex.accounts.onOAuthTrace === 'function') {
      window.tflex.accounts.onOAuthTrace((e) => window.__tfl751trace.push(e));
    }
  });

  const before = await cookieAttrs(app, base);
  console.log(`[TFL751] cookies BEFORE start (${before.length}): ${fmt(before) || 'none'}`);

  await win.locator('[data-header-accounts]').click();
  await win.waitForSelector('[data-accounts-auth]', { timeout: 15000 });

  // The Google click is the single REAL start: it invokes
  // accounts.startOAuthCallback() (the phase-51 clear), then opens the OS browser.
  // Dump immediately after so the clear's effect is visible.
  await win.locator('[data-accounts-google]').click();
  await win.waitForTimeout(1500);
  const afterStart = await cookieAttrs(app, base);
  console.log(`[TFL751] cookies AFTER start (${afterStart.length}): ${fmt(afterStart) || 'none'}`);

  // Poll for the terminal status; dump the cookies once the exchange fires.
  let status = null;
  let exchangeDumped = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    status = await win.evaluate(() => window.tflex.accounts.getStatus()).catch(() => null);
    if (!exchangeDumped) {
      const seen = await win
        .evaluate(() => (window.__tfl751trace || []).some((e) => e.kind === 'exchange-get-session'));
      if (seen) {
        const atExchange = await cookieAttrs(app, base);
        console.log(`[TFL751] cookies AT exchange (${atExchange.length}): ${fmt(atExchange) || 'none'}`);
        exchangeDumped = true;
      }
    }
    if (status && status.status === 'signed-in') break;
    await win.waitForTimeout(2000);
  }
  if (!exchangeDumped) {
    const atEnd = await cookieAttrs(app, base);
    console.log(`[TFL751] cookies AT end (exchange not seen) (${atEnd.length}): ${fmt(atEnd) || 'none'}`);
  }

  const trace = await win.evaluate(() => (window.__tfl751trace || []).map((e) => ({
    kind: e.kind, status: e.status, reason: e.reason,
    cookieNames: e.cookieNames, cookieRemovedNames: e.cookieRemovedNames,
  })));
  const kinds = trace.map((e) => e.kind);
  const challengeClears = trace.filter((e) => e.kind === 'challenge-clear');
  const getSessions = trace.filter((e) => e.kind === 'exchange-get-session');
  console.log(`[TFL751] trace kinds=${JSON.stringify(kinds)}`);
  console.log(`[TFL751] challenge-clear count=${challengeClears.length} present=${JSON.stringify(challengeClears.map((e) => e.cookieNames))} removed=${JSON.stringify(challengeClears.map((e) => e.cookieRemovedNames))}`);
  console.log(`[TFL751] exchange-get-session count=${getSessions.length} statuses=${JSON.stringify(getSessions.map((e) => e.status))}`);
  console.log(`[TFL751] final getStatus=${JSON.stringify(status)}`);

  // Read the on-disk diagnostic verbatim (the attrs= line lives in the outcome
  // message and oauth-trace.log). Never print any cookie value.
  const userDataDir = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const logPath = path.join(userDataDir, 'oauth-trace.log');
  if (fs.existsSync(logPath)) {
    const lines = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    console.log(`[TFL751] oauth-trace.log attrs lines: ${JSON.stringify(lines.filter((l) => l.includes('attrs=')))}`);
    console.log(`[TFL751] oauth-trace.log (last 5): ${JSON.stringify(lines.slice(-5))}`);
  } else {
    console.log(`[TFL751] no oauth-trace.log at ${logPath}`);
  }

  const shotPath = path.join(SHOTS, 'tfl751-cookie-attrs.png');
  await win.screenshot({ path: shotPath }).catch(() => {});
  console.log(`[TFL751] screenshot=${shotPath}`);

  const hasStored = kinds.includes('exchange-stored');
  const hasFailed = kinds.includes('exchange-failed');
  const signedIn = Boolean(status && status.status === 'signed-in' && status.email);
  const verdict = signedIn && hasStored ? 'PASS' : hasFailed ? 'FAIL' : 'INCONCLUSIVE';
  console.log(`[TFL751] VERDICT=${verdict}`);
  if (verdict === 'FAIL') {
    console.log(`[TFL751] decisive exchange-failed=${JSON.stringify(trace.filter((e) => e.kind === 'exchange-failed'))}`);
  }

  // Setup sanity only; the VERDICT line above is the report contract.
  expect(status, 'accounts:getStatus responded').toBeTruthy();
});
