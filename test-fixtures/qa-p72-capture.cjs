// QA Phase-72 evidence capture: zoomed active-tab silhouette (light/dark/frosted)
// plus a dirty-vs-clean tab pair for criterion 3. QA-owned; uses the canonical
// launch helper only. Not part of the test suite.
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp, getSamplePath } = require(REPO + '\\e2e\\lib\\launch.cjs');
const { hardClose, openSamplePath, runTool } = require(REPO + '\\e2e\\lib\\helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freshUserData(tag) {
  const d = path.join(os.tmpdir(), `tflex-qa-p72-${tag}-${Date.now()}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

async function setTheme(win, t) {
  await win.evaluate((x) => { document.documentElement.dataset.theme = x; }, t);
  await win.waitForTimeout(400);
}

async function zoomShot(win, id, out) {
  await win.evaluate(() => {
    const area = document.querySelector('.tab-area');
    area.style.transformOrigin = 'top left';
    area.style.transform = 'scale(4)';
  });
  await win.waitForTimeout(300);
  const clip = await win.evaluate(() => {
    const el =
      document.querySelector('[data-tab-id][aria-selected="true"]') ||
      document.querySelector('[data-tab-id]');
    const r = el.getBoundingClientRect();
    const m = 12;
    return { x: r.left - m, y: r.top - m, width: r.width + 2 * m, height: r.height + 2 * m + 16 };
  });
  await win.screenshot({ path: out, clip }).catch(() => {});
  await win.evaluate(() => {
    const area = document.querySelector('.tab-area');
    area.style.transform = '';
    area.style.transformOrigin = '';
  });
  await win.waitForTimeout(200);
  return out;
}

(async () => {
  const app = await launchApp([], await freshUserData('cap'));
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSamplePath(win, app, getSamplePath('report.pdf'));
  await win.waitForSelector('[data-tab-id]', { timeout: 30000 });
  await win.waitForTimeout(900);

  await setTheme(win, 'light');
  await zoomShot(win, 'clean', REPO + '\\screenshots\\qa-p72-clean-light.png');

  await runTool(win, 'rotate');
  await win.waitForTimeout(1800);
  await zoomShot(win, 'dirty', REPO + '\\screenshots\\qa-p72-dirty-light.png');
  await setTheme(win, 'dark');
  await zoomShot(win, 'dirty', REPO + '\\screenshots\\qa-p72-dirty-dark.png');
  await setTheme(win, 'frosted');
  await zoomShot(win, 'dirty', REPO + '\\screenshots\\qa-p72-dirty-frosted.png');
  await setTheme(win, 'light');

  const dot = await win.evaluate(() => {
    const t = document.querySelector('[data-tab-id][aria-selected="true"]');
    const d = t && t.querySelector('.tab-modified-dot');
    return d ? { cls: d.className, vis: getComputedStyle(d).visibility, op: getComputedStyle(d).opacity } : null;
  });
  console.log('DIRTY_DOT ' + JSON.stringify(dot));
  console.log('DONE qa-p72-capture');
  await hardClose(app, 'cap');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
