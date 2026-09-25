/* Adversary Phase 40 - hostile settings + rapid pin toggle + restart.
 * Usage: node test-fixtures/adv-p40/hostile.cjs
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (l, o) => console.log(`ADV40 ${l} ${JSON.stringify(o)}`);

async function runCase(name, settingsContent) {
  const ud = path.join(os.tmpdir(), `adv40-settings-${name}-${Date.now()}`);
  fs.mkdirSync(ud, { recursive: true });
  if (settingsContent !== null) {
    fs.writeFileSync(path.join(ud, 'settings.json'), settingsContent, 'utf8');
  }
  const app = await launchApp([], ud);
  const out = { name };
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1500);
    out.workspace = await win.locator('.welcome, .workspace').count();
    // open a doc so stages are live
    const card = win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first();
    if (await card.count()) { await card.click().catch(() => {}); await win.waitForTimeout(2000); }
    out.dock = await win.evaluate(() => Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => ({ id: v.getAttribute('data-dock-verb'), pin: v.getAttribute('data-dock-pin') !== null })));
    // open palette, compare
    await win.locator('[data-header-tool-search]').first().click().catch(() => {});
    await win.waitForSelector('[data-command-palette]', { timeout: 8000 }).catch(() => {});
    await win.waitForTimeout(500);
    const st = await win.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-palette-row="tool"]')).map((r) => ({
        id: r.getAttribute('data-palette-tool-id'),
        pinned: r.getAttribute('data-palette-pinned'),
      }));
      const dock = Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => v.getAttribute('data-dock-verb'));
      return { rows, dock };
    });
    out.disagree = st.rows.filter((r) => (r.pinned === 'true') !== st.dock.includes(r.id)).map((r) => r.id);
    out.dockIds = st.dock;
    // rapid pin toggling on first 3 rows
    for (let round = 0; round < 6; round += 1) {
      for (let i = 0; i < 3; i += 1) {
        const btn = win.locator('[data-palette-row="tool"]').nth(i).locator('[data-palette-pin-toggle]');
        if (await btn.count()) { await btn.click({ timeout: 2000 }).catch(() => {}); }
      }
    }
    await win.waitForTimeout(600);
    out.afterRapidDock = await win.evaluate(() => Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => v.getAttribute('data-dock-verb')));
    out.paletteStillOpen = await win.locator('[data-command-palette]').count();
    out.errors = await win.evaluate(() => window.__advErrors || []);
    await win.screenshot({ path: path.join(__dirname, 'shots', `hostile-${name}.png`) });
    log('hostile', out);
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e).slice(0, 600);
    log('hostile', out);
  } finally {
    setTimeout(() => process.exit(0), 6000).unref();
    try { await Promise.race([app.close(), sleep(4000)]); } catch { /* ignore */ }
  }
}

async function runPersist() {
  const ud = path.join(os.tmpdir(), `adv40-persist-${Date.now()}`);
  fs.mkdirSync(ud, { recursive: true });
  const out = { userData: ud };
  const openDoc = async (win) => {
    const card = win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first();
    if (await card.count()) { await card.click().catch(() => {}); await win.waitForTimeout(2000); }
  };
  // session 1: pin watermark (a non-PAGES default -> explicit cross-stage pin)
  {
    const app = await launchApp([], ud);
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1500);
    await openDoc(win);
    await win.locator('[data-header-tool-search]').first().click().catch(() => {});
    await win.waitForSelector('[data-command-palette]', { timeout: 8000 }).catch(() => {});
    await win.locator('[data-command-palette-input]').fill('watermark');
    await win.waitForTimeout(500);
    const row = win.locator('[data-palette-tool-id="watermark"]').first();
    out.beforePin = { pinned: await row.getAttribute('data-palette-pinned') };
    await row.locator('[data-palette-pin-toggle]').click().catch(() => {});
    await win.waitForTimeout(1500);
    out.afterPin = { pinned: await row.getAttribute('data-palette-pinned') };
    out.dock1 = await win.evaluate(() => Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => v.getAttribute('data-dock-verb')));
    out.settings1 = fs.existsSync(path.join(ud, 'settings.json')) ? JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).dockPins : null;
    await Promise.race([app.close(), sleep(4000)]).catch(() => {});
  }
  // session 2: same userData
  {
    const app = await launchApp([], ud);
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1500);
    await openDoc(win);
    out.dock2 = await win.evaluate(() => Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => v.getAttribute('data-dock-verb')));
    await win.locator('[data-header-tool-search]').first().click().catch(() => {});
    await win.waitForSelector('[data-command-palette]', { timeout: 8000 }).catch(() => {});
    await win.locator('[data-command-palette-input]').fill('watermark');
    await win.waitForTimeout(500);
    out.session2Pinned = await win.locator('[data-palette-tool-id="watermark"]').first().getAttribute('data-palette-pinned').catch(() => null);
    await Promise.race([app.close(), sleep(4000)]).catch(() => {});
  }
  log('persist', out);
}

async function main() {
  const which = process.argv[2] || 'array';
  if (which === 'persist') { await runPersist(); process.exit(0); }
  if (which === 'array') {
    await runCase('array',
      JSON.stringify({
        theme: 'dark',
        dockPins: ['__nope__', 'rotate', 'rotate', 'delete', 'delete', 'annotate', 'sign', 'watermark', 'merge'],
        dockUnpinned: ['merge', 'merge', '__bogus__', 'not-real-tool', 'delete'],
        recentFiles: [{ path: 'C:\\does\\not\\exist.pdf', name: 'ghost.pdf' }],
      }));
  } else if (which === 'nonarray') {
    await runCase('nonarray', JSON.stringify({ theme: 'light', dockPins: 'rotate', dockUnpinned: { a: 1 } }));
  } else if (which === 'corrupt') {
    await runCase('corrupt', '{ this is not valid json ');
  }
  process.exit(0);
}

main();
