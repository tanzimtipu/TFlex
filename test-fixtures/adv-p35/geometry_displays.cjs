// ADV phase-35: confirm geometry placement against ALL displays (multi-monitor).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-geom2] ${s}`); lines.push(`[adv35-geom2] ${s}`); };

(async () => {
  for (const [name, geometry] of [
    ['huge-size', { x: 100, y: 100, width: 100000, height: 100000, maximized: false }],
    ['partial-right', { x: 2500, y: 100, width: 1440, height: 900, maximized: false }],
  ]) {
    let app = null;
    const dir = path.join(os.tmpdir(), `adv35-geom2-${name}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ geometry }));
    try {
      app = await launchApp([], dir);
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card, .workspace, .app', { timeout: 30000 }).catch(() => {});
      await win.waitForTimeout(1200);
      const st = await app.evaluate(({ BrowserWindow, screen }) => {
        const w = BrowserWindow.getAllWindows()[0];
        const b = w.getBounds();
        const displays = screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor, primary: d.id === screen.getPrimaryDisplay().id }));
        // does the window's VISIBLE core (bounds shrunk by the 8px resize border) sit inside some work area?
        const core = { x: b.x + 8, y: b.y + 8, width: b.width - 16, height: b.height - 16 };
        const insideAny = displays.some((d) => {
          const a = d.workArea;
          return core.x >= a.x - 2 && core.y >= a.y - 2 && core.x + core.width <= a.x + a.width + 2 && core.y + core.height <= a.y + a.height + 2;
        });
        const overlapsAny = displays.some((d) => {
          const a = d.workArea;
          const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          return ox > 50 && oy > 50;
        });
        return { bounds: b, displays, insideAny, overlapsAny };
      });
      note(`${name}: bounds=${JSON.stringify(st.bounds)} displays=${JSON.stringify(st.displays)} insideAnyWorkArea=${st.insideAny} overlapsAny=${st.overlapsAny}`);
    } catch (e) { note(`${name}: FATAL ${e.message}`); }
    finally { if (app) await hardClose(app, `adv35-geom2-${name}`); }
  }
  fs.writeFileSync(path.join(OUT, 'geometry2.log'), lines.join('\n'));
  note('DONE');
})().catch((e) => note(`TOP FATAL ${e && e.stack ? e.stack : e}`));
