// TFL-925 diagnostic - what is the top element at the DEF-588 More trigger's
// centre at 640x480 @150%, and what footer controls are hit-testable there?
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const OUT = [];
function log(...a) { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); OUT.push(s); console.log(s); }

async function setWindow(app, win, w, h) {
  await app.evaluate(({ BrowserWindow }, sz) => { const bw = BrowserWindow.getAllWindows()[0]; if (bw) { try { bw.unmaximize(); } catch (_) {} bw.setSize(sz[0], sz[1]); } }, [w, h]);
  await win.waitForTimeout(700);
}
async function zoom(app, win, z) {
  await app.evaluate(({ BrowserWindow }, zf) => { const bw = BrowserWindow.getAllWindows()[0]; if (bw) bw.webContents.setZoomFactor(zf); }, z);
  await win.waitForTimeout(900);
}
async function openSample(win, name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function main() {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);
  await openSample(win);
  await setWindow(app, win, 640, 480);
  await zoom(app, win, 1.5);

  log('== top element at the More trigger centre ==');
  const r = await win.evaluate(() => {
    const el = document.querySelector('[data-view-strip-more-toggle]');
    const b = el.getBoundingClientRect();
    const x = Math.round(b.left + b.width / 2);
    const y = Math.round(b.top + b.height / 2);
    const t = document.elementFromPoint(x, y);
    const chain = [];
    let e = t;
    while (e && chain.length < 8) {
      const cb = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      chain.push({ tag: e.tagName.toLowerCase(), cls: String(e.className).slice(0, 70), pos: cs.position, z: cs.zIndex, pe: cs.pointerEvents, rect: [Math.round(cb.x), Math.round(cb.y), Math.round(cb.width), Math.round(cb.height)] });
      e = e.parentElement;
    }
    return { toggle: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], x, y, top: t ? { tag: t.tagName.toLowerCase(), cls: String(t.className).slice(0, 90), aria: t.getAttribute('aria-label') } : null, topInStrip: t ? !!t.closest('[data-view-strip]') : null, chain };
  });
  log(JSON.stringify(r, null, 1));

  log('== suspect overlayers ==');
  const suspects = await win.evaluate(() => {
    const sels = ['[data-action-dock]', '[data-view-strip]', '.view-strip-more', '[data-view-strip-more-toggle]', '[data-tools-badge]', '[data-inspector]', '.canvas-overlay', '[data-document-rail]'];
    const out = {};
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) { out[s] = null; continue; }
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out[s] = { rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], pos: cs.position, z: cs.zIndex, pe: cs.pointerEvents, display: cs.display };
    }
    return out;
  });
  log(JSON.stringify(suspects, null, 1));

  log('== footer control hit table at 640x480@150% ==');
  const hits = await win.evaluate(() => {
    const out = [];
    document.querySelectorAll('[data-view-strip] button, [data-view-strip] input').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return;
      const x = Math.round(b.left + b.width / 2); const y = Math.round(b.top + b.height / 2);
      const t = document.elementFromPoint(x, y);
      out.push({ label: el.getAttribute('aria-label') || el.className, rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], hit: t === el || el.contains(t), top: t ? `${t.tagName.toLowerCase()}.${String(t.className).slice(0, 40)}` : null });
    });
    return out;
  });
  for (const h of hits) log('  ', JSON.stringify(h));

  log('== real Playwright click attempt on the More trigger ==');
  try {
    await win.locator('[data-view-strip-more-toggle]').first().click({ timeout: 6000 });
    const open = await win.evaluate(() => !!document.querySelector('[data-view-strip-more-menu]'));
    log('  click resolved; menu open =', open);
  } catch (e) {
    log('  click FAILED:', (e && e.message ? e.message.split('\n')[0] : String(e)));
  }
  await win.screenshot({ path: path.join(SHOTS, 'phase109-qa-def588-overflow-640x480.png') });
  fs.writeFileSync(path.join(__dirname, 'probe-more-hit.output.json'), JSON.stringify(OUT, null, 2));
  await app.close();
}
main().then(() => { console.log('PROBE-DONE'); process.exit(0); }).catch((e) => { console.error('PROBE-ERROR', e && e.stack ? e.stack : e); process.exit(1); });
