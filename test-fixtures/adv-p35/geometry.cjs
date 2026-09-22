// ADV phase-35: window geometry clamping from a hostile settings.json.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-geom] ${s}`); lines.push(`[adv35-geom] ${s}`); };

const cases = [
  ['offscreen-far', { x: 99999, y: 99999, width: 1440, height: 900, maximized: false }],
  ['huge-size', { x: 100, y: 100, width: 100000, height: 100000, maximized: false }],
  ['negative-xy', { x: -5000, y: -5000, width: 1440, height: 900, maximized: false }],
  ['tiny-size', { x: 100, y: 100, width: 10, height: 10, maximized: false }],
  ['partial-right', { x: 2500, y: 100, width: 1440, height: 900, maximized: false }],
  ['maximized-true', { x: 100, y: 100, width: 1440, height: 900, maximized: true }],
  ['nan-strings', { x: 'abc', y: null, width: '999', height: -5, maximized: 'yes' }],
];

(async () => {
  for (const [name, geometry] of cases) {
    let app = null;
    const dir = path.join(os.tmpdir(), `adv35-geom-${name}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ geometry }));
    try {
      app = await launchApp([], dir);
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card, .workspace, .app', { timeout: 30000 }).catch(() => {});
      await win.waitForTimeout(1200);
      const st = await app.evaluate(({ BrowserWindow, screen }) => {
        const w = BrowserWindow.getAllWindows()[0];
        return { bounds: w.getBounds(), workArea: screen.getPrimaryDisplay().workArea, maximized: w.isMaximized() };
      });
      const b = st.bounds, wa = st.workArea;
      const inside = b.x >= wa.x - 1 && b.y >= wa.y - 1 && b.x + b.width <= wa.x + wa.width + 1 && b.y + b.height <= wa.y + wa.height + 1;
      note(`${name}: geom=${JSON.stringify(geometry)} bounds=${JSON.stringify(b)} workArea=${JSON.stringify(wa)} maximized=${st.maximized} insideWorkArea=${inside}`);
    } catch (e) {
      note(`${name}: FATAL ${e.message}`);
    } finally {
      if (app) await hardClose(app, `adv35-geom-${name}`);
    }
  }

  // corrupt JSON
  {
    let app = null;
    const dir = path.join(os.tmpdir(), `adv35-geom-corrupt-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ this is not json');
    try {
      app = await launchApp([], dir);
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card, .workspace, .app', { timeout: 30000 }).catch(() => {});
      await win.waitForTimeout(1200);
      const ok = await win.evaluate(() => ({ app: !!document.querySelector('.app'), samples: !!document.querySelector('.sample-card'), welcome: !!document.querySelector('.welcome') }));
      note(`corrupt-json: rendered=${JSON.stringify(ok)}`);
    } catch (e) { note(`corrupt-json: FATAL ${e.message}`); }
    finally { if (app) await hardClose(app, 'adv35-geom-corrupt'); }
  }

  // recentFiles that no longer exist
  {
    let app = null;
    const dir = path.join(os.tmpdir(), `adv35-geom-mru-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    const recents = Array.from({ length: 30 }, (_, i) => ({ path: path.join(os.tmpdir(), `adv35-gone-${i}.pdf`), name: `gone-${i}.pdf`, openedAt: new Date().toISOString() }));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false }, recentFiles: recents }));
    try {
      app = await launchApp([], dir);
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card, .workspace, .app', { timeout: 30000 }).catch(() => {});
      await win.waitForTimeout(1500);
      const st = await win.evaluate(() => ({ app: !!document.querySelector('.app'), welcome: !!document.querySelector('.welcome, .sample-card'), recents: document.querySelectorAll('[data-recent], .recent-item').length }));
      note(`missing-recents: rendered=${JSON.stringify(st)}`);
    } catch (e) { note(`missing-recents: FATAL ${e.message}`); }
    finally { if (app) await hardClose(app, 'adv35-geom-mru'); }
  }

  fs.writeFileSync(path.join(OUT, 'geometry.log'), lines.join('\n'));
  note('DONE');
})().catch((e) => { note(`TOP FATAL ${e && e.stack ? e.stack : e}`); });
