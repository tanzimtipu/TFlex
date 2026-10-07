// Phase 109 adversary probe 6 (TFL-918) - frosted-theme footer coverage: are the
// View Strip controls hit-testable/clickable in the frosted theme?
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const OUT = [];
function log(...a) { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); OUT.push(s); console.log(s); }
async function setWindow(app, win, w, h) { await app.evaluate(({ BrowserWindow }, sz) => { const bw = BrowserWindow.getAllWindows()[0]; if (bw) { try { bw.unmaximize(); } catch (_) {} bw.setSize(sz[0], sz[1]); } }, [w, h]); await win.waitForTimeout(700); }
async function openSample(win, name = 'report.pdf') { await win.locator('.sample-card').filter({ hasText: name }).first().click(); await win.waitForSelector('.workspace', { timeout: 30000 }); await win.waitForSelector('.pdf-page canvas', { timeout: 30000 }); await win.waitForTimeout(1200); }
async function setTheme(win, theme) {
  for (let i = 0; i < 4; i += 1) {
    const now = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (now === theme) return true;
    await win.locator('[data-app-menu]').first().click();
    await win.waitForSelector('[data-app-menu-popover]', { state: 'visible', timeout: 8000 });
    await win.locator('[data-app-menu-popover] [data-menu-action="toggleTheme"]').first().click();
    await win.waitForTimeout(900);
  }
  return (await win.evaluate(() => document.documentElement.getAttribute('data-theme'))) === theme;
}
async function hitAll(win) {
  return win.evaluate(() => {
    const out = [];
    document.querySelectorAll('[data-view-strip] button, [data-view-strip] input').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const x = Math.round(r.left + r.width / 2); const y = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(x, y);
      out.push({ label: el.getAttribute('aria-label') || el.className, top: top ? `${top.tagName.toLowerCase()}.${String(top.className)}` : null, hit: top === el || el.contains(top) });
    });
    return out;
  });
}
async function main() {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);
  await openSample(win);
  await setWindow(app, win, 1440, 900);

  log('== light theme control hit-test ==');
  await setTheme(win, 'light');
  const lightHits = await hitAll(win);
  log('  light:', JSON.stringify(lightHits));
  log('  light all hit:', lightHits.every((h) => h.hit));

  log('== frosted theme control hit-test ==');
  await setTheme(win, 'frosted');
  await win.waitForTimeout(600);
  const frostedHits = await hitAll(win);
  log('  frosted:', JSON.stringify(frostedHits));
  log('  frosted all hit:', frostedHits.every((h) => h.hit));
  const geom = await win.evaluate(() => {
    const s = document.querySelector('.document-scroller').getBoundingClientRect();
    const f = document.querySelector('[data-view-strip]').getBoundingClientRect();
    const ws = document.querySelector('.workspace-main').getBoundingClientRect();
    return { scroller: [Math.round(s.x), Math.round(s.y), Math.round(s.width), Math.round(s.height), Math.round(s.bottom)], footer: [Math.round(f.x), Math.round(f.y), Math.round(f.width), Math.round(f.height)], workspaceMain: [Math.round(ws.x), Math.round(ws.y), Math.round(ws.width), Math.round(ws.height)], scrollerZ: getComputedStyle(document.querySelector('.document-scroller')).zIndex, scrollerPos: getComputedStyle(document.querySelector('.document-scroller')).position };
  });
  log('  frosted geom:', JSON.stringify(geom));
  await win.screenshot({ path: path.join(SHOTS, 'phase109-adv-frosted-footer-covered.png') });

  // Try an actual click on Fit width in frosted and see if it registers.
  const before = await win.locator('.view-strip-view .zoom-percent').first().textContent().catch(() => null);
  await win.locator('.view-strip-view [aria-label="Fit width"]').first().click({ timeout: 3000 }).then(() => log('  frosted Fit width click: resolved')).catch((e) => log('  frosted Fit width click ERROR:', e.message.split('\n')[0]));
  await win.waitForTimeout(600);
  const pressed = await win.locator('[data-view-strip] [aria-label="Fit width"]').first().getAttribute('aria-pressed');
  log('  frosted Fit width aria-pressed after click:', pressed, 'zoom before=', before);

  fs.writeFileSync(path.join(__dirname, 'probe6.output.json'), JSON.stringify(OUT, null, 2));
  await app.close();
}
main().then(() => { console.log('PROBE6-DONE'); process.exit(0); }).catch((e) => { console.error('PROBE6-ERROR', e && e.stack ? e.stack : e); try { fs.writeFileSync(path.join(__dirname, 'probe6.output.json'), JSON.stringify(OUT, null, 2)); } catch (_) {} process.exit(1); });
