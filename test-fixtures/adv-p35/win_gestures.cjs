// ADV phase-35: real OS-level caption gestures (double-click maximise, snap-to-top).
// Uses user32 SetCursorPos + mouse_event via PowerShell - a genuine OS input, not CDP.
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
const note = (s) => { console.log(`[adv35-gest] ${s}`); lines.push(`[adv35-gest] ${s}`); };

function ps(script) {
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  return execFileSync('powershell', ['-NoProfile', '-EncodedCommand', b64], { encoding: 'utf8', timeout: 30000 });
}
const SRC = `
$src = @"
using System; using System.Runtime.InteropServices;
public class M {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public const uint LEFTDOWN=0x0002, LEFTUP=0x0004, MOVE=0x0001;
  public static void Click() { mouse_event(LEFTDOWN,0,0,0,IntPtr.Zero); System.Threading.Thread.Sleep(40); mouse_event(LEFTUP,0,0,0,IntPtr.Zero); }
  public static void MoveTo(int x,int y){ SetCursorPos(x,y); System.Threading.Thread.Sleep(30); }
  public static void DragTo(int x,int y){ mouse_event(LEFTDOWN,0,0,0,IntPtr.Zero); System.Threading.Thread.Sleep(60); SetCursorPos(x,y); System.Threading.Thread.Sleep(120); mouse_event(LEFTUP,0,0,0,IntPtr.Zero); }
}
"@
Add-Type -TypeDefinition $src
`;

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-gest-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);

    // Find a drag-only point on the caption strip (viewport -> screen DIP).
    const ptDip = await win.evaluate(() => {
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
        while (cur && cur !== document.documentElement) {
          const cs = getComputedStyle(cur);
          const ar = cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region');
          if (ar && ar !== 'none') { drag = true; break; }
          cur = cur.parentElement;
        }
        if (drag) found.push(x);
      }
      if (found.length === 0) return null;
      return { x: found[Math.floor(found.length / 2)], y };
    });
    const info = await app.evaluate(({ BrowserWindow, screen }, vp) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.focus(); w.moveTop();
      const b = w.getBounds();
      const dip = vp ? { x: b.x + vp.x, y: b.y + vp.y } : null;
      return { bounds: b, workArea: screen.getPrimaryDisplay().workArea, scaleFactor: screen.getPrimaryDisplay().scaleFactor, dip, phys: dip ? screen.dipToScreenPoint(dip) : null, maximized: w.isMaximized() };
    }, ptDip);
    note(`window bounds=${JSON.stringify(info.bounds)} workArea=${JSON.stringify(info.workArea)} sf=${info.scaleFactor} dip=${JSON.stringify(info.dip)} phys=${JSON.stringify(info.phys)} maximized=${info.maximized}`);

    if (info.phys) {
      // Real double-click.
      ps(`${SRC}\n[M]::MoveTo(${info.phys.x}, ${info.phys.y})\n[M]::Click()\nStart-Sleep -Milliseconds 90\n[M]::Click()\n`);
      await win.waitForTimeout(1200);
      const afterDbl = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
      note(`after real double-click: maximized=${afterDbl}`);
      if (afterDbl) {
        ps(`${SRC}\n[M]::MoveTo(${info.phys.x}, ${info.phys.y})\n[M]::Click()\nStart-Sleep -Milliseconds 90\n[M]::Click()\n`);
        await win.waitForTimeout(1200);
        note(`after second real double-click (restore): maximized=${await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())}`);
      }
    }

    // Real drag of the caption to the top screen edge (Aero Snap maximise).
    const phys2 = info.phys;
    ps(`${SRC}\n[M]::MoveTo(${phys2.x}, ${phys2.y})\nStart-Sleep -Milliseconds 120\n[M]::DragTo(${phys2.x + 30}, 2)\n`);
    await win.waitForTimeout(1500);
    const afterSnap = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { maximized: w.isMaximized(), bounds: w.getBounds(), workArea: screen.getPrimaryDisplay().workArea };
    });
    note(`after real drag to top edge: ${JSON.stringify(afterSnap)}`);
    if (afterSnap.maximized) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize()); await win.waitForTimeout(600); }

    fs.writeFileSync(path.join(OUT, 'gestures.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'gestures.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-gest');
  }
})();
