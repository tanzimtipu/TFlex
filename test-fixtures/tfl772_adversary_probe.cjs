// TFL-772 adversary probe v2 (Phase 102 in-app sign-in diff-pass).
// Focused, deterministic evidence for:
//   A. hostile URLs through the main renderer window.open -> setWindowOpenHandler
//      (per-URL polling + the created window's real URL, so no async miscount)
//   B. reverse tabnabbing: the in-app auth popup keeps window.opener on the
//      privileged main window; navigate it, then verify the attacker origin is
//      left holding the live `window.tflex` preload bridge + working IPC
//   C. child window.open FROM the popup (the popup has no open handler)
// No token / code / verifier is ever printed: URL query strings are redacted.
const { launchApp } = require('../e2e/lib/launch.cjs');
const { hardClose } = require('../e2e/lib/helpers.cjs');

const AUTH_HOST = 'ep-fragrant-pond-b3gqd6cf.neonauth.c-4.ap-southeast-1.aws.neon.tech';
const U = AUTH_HOST;
const BACKSLASH = '\\';

const redact = (s) =>
  typeof s === 'string'
    ? s.replace(/([?&](token|code|neon_auth_session_verifier|state)=)[^&#\s]*/gi, '$1<redacted>')
    : s;

const HOSTILE = [
  ['evil https host', 'https://evil.example.com/'],
  ['auth host over http', `http://${U}/`],
  ['javascript uri', 'javascript:alert(1)'],
  ['file uri', 'file:///C:/Windows/win.ini'],
  ['data uri', 'data:text/html,<h1>x</h1>'],
  ['subdomain', `https://sub.${U}/`],
  ['suffix look-alike', `https://${U}.evil.example/`],
  ['userinfo look-alike', `https://user@evil.example/`],
  ['userinfo auth host then evil', `https://${U}@evil.example/`],
  ['auth-host port + evil user', `https://${U}:443@evil.example/`],
  ['backslash trick', `https://${U}${BACKSLASH}@evil.example/`],
  ['percent-encoded slash', `https://${U}%2f@evil.example/`],
  ['trailing dot auth host', `https://${U}./`],
  ['auth host in path', `https://evil.example/${U}/`],
  ['malformed', 'not a url at all'],
  ['null', null],
  ['object', {}],
];

const authHostOf = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.toLowerCase() === U ? 'allow' : 'deny';
  } catch {
    return 'deny';
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function remoteUrls(app) {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .map((w) => { try { return w.webContents.getURL(); } catch (_) { return ''; } })
      .filter((u) => u.length > 0 && !u.startsWith('file://')),
  );
}

async function destroyRemote(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .filter((w) => { try { const u = w.webContents.getURL(); return u.length > 0 && !u.startsWith('file://'); } catch (_) { return false; } })
      .forEach((w) => { try { w.destroy(); } catch (_) { /* ignore */ } });
  }).catch(() => {});
  await sleep(200);
}

(async () => {
  const result = { windowOpen: [], tabnabbing: {}, popupChild: {}, notes: [] };
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });

    await app.evaluate(({ shell }) => {
      globalThis.__t772shell = { opened: [] };
      shell.openExternal = async (url) => { globalThis.__t772shell.opened.push(url); };
    });

    // ---- A. hostile window.open from the main renderer ----------------------
    for (const [label, payload] of HOSTILE) {
      await destroyRemote(app);
      const before = (await remoteUrls(app)).length;
      await win.evaluate((p) => { try { window.open(p, '_blank'); } catch (_) { /* ignore */ } }, payload);
      let created = [];
      for (let i = 0; i < 12; i += 1) {
        await sleep(250);
        created = await remoteUrls(app);
        if (created.length > before) break;
      }
      result.windowOpen.push({
        label,
        payload: redact(payload === null ? null : String(payload)),
        expected: authHostOf(payload),
        windowsCreated: Math.max(0, created.length - before),
        createdUrls: created.map(redact),
      });
    }
    await destroyRemote(app);

    // ---- B. reverse tabnabbing ---------------------------------------------
    await win.locator('[data-header-accounts]').click();
    await win.waitForSelector('[data-accounts-auth]', { timeout: 15000 });
    const baseCount = (await remoteUrls(app)).length;
    await win.locator('[data-accounts-google]').click();

    let popupUrl = null;
    for (let i = 0; i < 40; i += 1) {
      const urls = await remoteUrls(app);
      if (urls.length > baseCount) { popupUrl = urls[urls.length - 1]; break; }
      await sleep(500);
    }
    result.tabnabbing.popupOpened = popupUrl !== null;
    result.tabnabbing.popupUrl = redact(popupUrl);

    if (popupUrl !== null) {
      const popup = app.windows().find((w) => {
        try { return w.url() === popupUrl; } catch (_) { return false; }
      }) || app.windows()[app.windows().length - 1];

      const opener = await popup.evaluate(() => {
        const out = { hasOpener: false, readOpenerHref: 'n/a', navigateAttempt: 'not-run' };
        try { out.hasOpener = Boolean(window.opener); } catch (e) { out.hasOpener = `err:${e}`; }
        if (window.opener) {
          try { out.readOpenerHref = String(window.opener.location.href); }
          catch (e) { out.readOpenerHref = `blocked:${e.name}`; }
          try { window.opener.location.href = 'https://example.com/?tfl772=tabnabbing'; out.navigateAttempt = 'invoked'; }
          catch (e) { out.navigateAttempt = `threw:${e}`; }
        }
        return out;
      });
      result.tabnabbing.opener = opener;

      let mainUrl = '';
      for (let i = 0; i < 20; i += 1) {
        await sleep(400);
        mainUrl = String(win.url());
        if (mainUrl.includes('tfl772=tabnabbing')) break;
      }
      result.tabnabbing.mainUrlAfterNav = redact(mainUrl);

      // The decisive question: does the attacker origin keep the preload bridge?
      const bridge = await win.evaluate(async () => {
        const out = { hasTflex: typeof window.tflex, hasAccounts: false, ipcResult: null };
        try { out.hasAccounts = Boolean(window.tflex && window.tflex.accounts); } catch (_) { /* ignore */ }
        if (out.hasAccounts) {
          try { const r = await window.tflex.accounts.getStatus(); out.ipcResult = { ok: true, status: r && r.status }; }
          catch (e) { out.ipcResult = { ok: false, err: String(e) }; }
        }
        return out;
      }).catch((e) => ({ hasTflex: `evaluate-threw:${e}` }));
      result.tabnabbing.attackerOriginBridge = bridge;

      // ---- C. child window.open FROM the popup (no handler on the popup) ----
      if (!popup.isClosed()) {
        const beforeChild = (await remoteUrls(app)).length;
        let childResult = null;
        try {
          childResult = await popup.evaluate(() => {
            try { const w = window.open('https://evil.example.com/', '_blank'); return w ? 'window-returned' : 'null'; }
            catch (e) { return `threw:${e}`; }
          });
        } catch (e) { childResult = `evaluate-threw:${e}`; }
        let childUrls = [];
        for (let i = 0; i < 10; i += 1) {
          await sleep(300);
          childUrls = await remoteUrls(app);
          if (childUrls.length > beforeChild) break;
        }
        result.popupChild = {
          result: childResult,
          windowsCreated: Math.max(0, childUrls.length - beforeChild),
          createdUrls: childUrls.map(redact),
        };
      }
    } else {
      result.notes.push('no in-app popup opened (network offline?) - B/C INCONCLUSIVE');
    }

    result.shellOpened = (await app.evaluate(() => globalThis.__t772shell.opened.slice())).map(redact);
  } catch (err) {
    result.notes.push(`PROBE ERROR: ${err && err.stack ? err.stack : err}`);
  } finally {
    try { await hardClose(app, 't772-probe2'); } catch (_) { /* ignore */ }
  }
  const fs = require('node:fs');
  const path = require('node:path');
  const outPath = path.join(__dirname, 'tfl772_probe_result.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`[t772] result written to ${outPath}`);
})();
