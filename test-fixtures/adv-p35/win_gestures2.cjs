// ADV phase-35: decisive OS-level caption gesture test.
// 1) force the window foreground via its native HWND; 2) real drag should MOVE it;
// 3) real double-click should maximise; 4) real drag to the top edge should snap.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-gest2] ${s}`); lines.push(`[adv35-gest2] ${s}`); };

function ps(script) {
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  return execFileSync('powershell', ['-NoProfile', '-EncodedCommand', b64], { encoding: 'utf8', timeout: 30000 });
}
const SRC = `
$src = @"
using System; using System.Runtime.InteropServices;
public class M2 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public const uint LEFTDOWN=0x0002, LEFTUP=0x0004, MOVE=0x0001;
  public static void Click() { mouse_event(LEFTDOWN,0,0,0,IntPtr.Zero); System.Threading.Thread.Sleep(45); mouse_event(LEFTUP,0,0,0,IntPtr.Zero); }
  public static void MoveTo(int x,int y){ SetCursorPos(x,y); System.Threading.Thread.Sleep(40); }
  public static void DragPath(int x1,int y1,int x2,int y2){ SetCursorPos(x1,y1); System.Threading.Thread.Sleep(60); mouse_event(LEFTDOWN,0,0,0,IntPtr.Zero); System.Threading.Thread.Sleep(80); for(int i=1;i<=12;i++){ SetCursorPos(x1+(x2-x1)*i/12, y1+(y2-y1)*i/12); System.Threading.Thread.Sleep(30);} mouse_event(LEFTUP,0,0,0,IntPtr.Zero); }
}
"@
Add-Type -TypeDefinition $src
`;

const bounds = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
const isMax = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-gest2-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);

    const vp = await win.evaluate(() => {
      const strip = document.querySelector('.titlebar');
      const r = strip.getBoundingClientRect();
      const y = Math.round(r.top + r.height / 2);
      const found = [];
      for (let i = 0; i < 240; i += 1) {
        const x = Math.round(r.left + ((r.width - 1) * i) / 239);
        const el = document.elementFromPoint(x, y);
        if (!el) continue;
        if (el.closest("button,input,select,textarea,a,[role='button']")) continue;
        let cur = el, drag = false;
        while (cur && cur !== document.documentElement) { const cs = getComputedStyle(cur); const ar = cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region'); if (ar && ar !== 'none') { drag = true; break; } cur = cur.parentElement; }
        if (drag) found.push(x);
      }
      return { x: found.length ? found[Math.floor(found.length / 2)] : null, y };
    });
    const meta = await app.evaluate(({ BrowserWindow, screen }, v) => {
      const w = BrowserWindow.getAllWindows()[0];
      const b = w.getBounds();
      const hbuf = w.getNativeWindowHandle();
      const hwnd = hbuf.readBigUInt64LE ? hbuf.readBigUInt64LE(0).toString() : hbuf.readUInt32LE(0).toString();
      const dip = { x: b.x + v.x, y: b.y + v.y };
      return { bounds: b, dip, phys: screen.dipToScreenPoint(dip), hwnd, maximized: w.isMaximized() };
    }, vp);
    note(`bounds=${JSON.stringify(meta.bounds)} point dip=${JSON.stringify(meta.dip)} phys=${JSON.stringify(meta.phys)} hwnd=${meta.hwnd} maximized=${meta.maximized}`);

    // 1) foreground + drag-move test
    ps(`${SRC}\n[M2]::SetForegroundWindow([IntPtr]${meta.hwnd})\n[M2]::BringWindowToTop([IntPtr]${meta.hwnd})\nStart-Sleep -Milliseconds 300\n[M2]::DragPath(${meta.phys.x}, ${meta.phys.y}, ${meta.phys.x + 120}, ${meta.phys.y + 90})\n`);
    await win.waitForTimeout(1200);
    const moved = await bounds(app);
    note(`after real caption drag-move: bounds=${JSON.stringify(moved)} moved=${JSON.stringify(moved) !== JSON.stringify(meta.bounds)}`);

    // 2) real double-click at the current caption point
    const b2 = await bounds(app);
    const vp2 = await app.evaluate(({ screen }, d) => screen.dipToScreenPoint(d), { x: b2.x + vp.x, y: b2.y + vp.y });
    ps(`${SRC}\n[M2]::SetForegroundWindow([IntPtr]${meta.hwnd})\nStart-Sleep -Milliseconds 250\n[M2]::MoveTo(${vp2.x}, ${vp2.y})\n[M2]::Click()\nStart-Sleep -Milliseconds 80\n[M2]::Click()\n`);
    await win.waitForTimeout(1200);
    note(`after real double-click: maximized=${await isMax(app)}`);

    // 3) restore if needed, then real drag to top edge
    if (await isMax(app)) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize()); await win.waitForTimeout(700); }
    const b3 = await bounds(app);
    const vp3 = await app.evaluate(({ screen }, d) => screen.dipToScreenPoint(d), { x: b3.x + vp.x, y: b3.y + vp.y });
    ps(`${SRC}\n[M2]::SetForegroundWindow([IntPtr]${meta.hwnd})\nStart-Sleep -Milliseconds 250\n[M2]::DragPath(${vp3.x}, ${vp3.y}, ${vp3.x + 40}, 1)\n`);
    await win.waitForTimeout(1600);
    const snap = await app.evaluate(({ BrowserWindow, screen }) => ({ maximized: BrowserWindow.getAllWindows()[0].isMaximized(), bounds: BrowserWindow.getAllWindows()[0].getBounds(), workArea: screen.getPrimaryDisplay().workArea }));
    note(`after real drag to top edge: ${JSON.stringify(snap)}`);
    if (snap.maximized) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize()); await win.waitForTimeout(600); }

    fs.writeFileSync(path.join(OUT, 'gestures2.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'gestures2.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-gest2');
  }
})();
