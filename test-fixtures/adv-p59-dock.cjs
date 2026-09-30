// Focused dock add/remove + pen containment probe.
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp } = require(REPO + '\\e2e\\lib\\launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const TMP = path.join(os.tmpdir(), 'adv-p59-dock-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });
const log = (...a) => console.log('###', ...a);

async function openPath(app, win, p) {
  await app.evaluate(async ({ dialog }, fp) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] }); }, p);
  const welcome = await win.locator('button:has-text("Open PDF")').count();
  if (welcome > 0) await win.locator('button:has-text("Open PDF")').first().click({ timeout: 15000 });
  else await win.locator('[data-toolbar-open]').first().click({ timeout: 15000 });
  await win.waitForSelector('.workspace', { timeout: 30000 });
}

(async () => {
  const app = await launchApp([], path.join(TMP, 'ud'));
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const c = path.join(TMP, 'r.pdf');
  fs.copyFileSync(path.join(REPO, 'assets', 'samples', 'report.pdf'), c);
  await openPath(app, win, c);
  await win.waitForTimeout(1500);
  const dockState = () => win.evaluate(() => {
    const dock = document.querySelector('[data-action-dock]');
    if (!dock) return { dock: false };
    const pen = document.querySelector('[data-dock-edit-toggle]');
    const dr = dock.getBoundingClientRect();
    const pr = pen ? pen.getBoundingClientRect() : null;
    return {
      dock: true,
      verbs: document.querySelectorAll('[data-dock-verb]').length,
      minus: document.querySelectorAll('[data-dock-minus]').length,
      edit: dock.getAttribute('data-dock-edit'),
      penInside: pr ? (pr.left >= dr.left - 0.5 && pr.right <= dr.right + 0.5) : null,
      penVisible: pr ? pr.width > 0 && pr.height > 0 : false,
    };
  });
  log('initial', JSON.stringify(await dockState()));
  // enter edit mode
  await win.locator('[data-dock-edit-toggle]').click({ timeout: 5000 }).catch((e) => log('edit-err', String(e.message).split('\n')[0]));
  await win.waitForTimeout(500);
  log('edit-on', JSON.stringify(await dockState()));
  // add many tools via the plus picker
  let added = 0;
  for (let i = 0; i < 12; i++) {
    const plus = win.locator('[data-dock-plus]');
    if (await plus.count() === 0) break;
    await plus.first().click({ timeout: 3000 }).catch(() => {});
    const items = win.locator('[data-dock-picker-item]');
    const n = await items.count();
    if (n === 0) { await win.keyboard.press('Escape'); break; }
    await items.nth(i % n).click({ timeout: 3000 }).catch(() => {});
    added++;
    await win.waitForTimeout(120);
  }
  await win.waitForTimeout(400);
  log('after-add', JSON.stringify({ added, state: await dockState() }));
  // remove every verb via minus
  let removed = 0;
  for (let i = 0; i < 40; i++) {
    const minus = win.locator('[data-dock-minus]');
    if (await minus.count() === 0) break;
    await minus.first().click({ timeout: 3000 }).catch(() => {});
    removed++;
    await win.waitForTimeout(100);
  }
  await win.waitForTimeout(800);
  log('after-remove-all', JSON.stringify({ removed, state: await dockState() }));
  const errs = await win.evaluate(() => null);
  await app.close().catch(() => {});
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
