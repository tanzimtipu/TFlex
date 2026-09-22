// ADV phase-35: in-app virtual-PDF output — failure paths, produced-file validity,
// no OS print window. Uses the app's own save seam (dialog.showSaveDialog stub).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const note = (s) => { console.log(`[adv35-pdf] ${s}`); lines.push(`[adv35-pdf] ${s}`); };

function listOsWindows(filterPid) {
  const ps = `
$src = @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class WinEnum2 {
  public delegate bool Proc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(Proc cb, IntPtr l);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  public static List<string> List() {
    var r = new List<string>();
    EnumWindows((h, l) => {
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      uint p; GetWindowThreadProcessId(h, out p);
      r.Add(p + "|" + IsWindowVisible(h) + "|" + c.ToString() + "|" + t.ToString());
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@
Add-Type -TypeDefinition $src
[WinEnum2]::List()
`;
  try {
    const b64 = Buffer.from(ps, 'utf16le').toString('base64');
    const out = require('node:child_process').execSync(`powershell -NoProfile -EncodedCommand ${b64}`, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).filter((l) => l.startsWith(String(filterPid) + '|'));
  } catch (e) { return [`enum failed: ${e.message}`]; }
}

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-pdf-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);
    const mainPid = await app.evaluate(() => process.pid);
    note(`mainPid=${mainPid}`);

    // Instrument the save dialog so we know it was really invoked.
    await app.evaluate(({ dialog }) => {
      globalThis.__advSave = { calls: 0, lastPath: null, mode: 'ok' };
      dialog.showSaveDialog = async (opts) => {
        globalThis.__advSave.calls += 1;
        if (globalThis.__advSave.mode === 'cancel') return { canceled: true };
        return { canceled: false, filePath: globalThis.__advSave.lastPath };
      };
    });
    const setSave = (mode, p) => app.evaluate(({ }, a) => {
      globalThis.__advSave.mode = a.mode; globalThis.__advSave.lastPath = a.p;
    }, { mode, p });
    const saveInfo = () => app.evaluate(() => ({ calls: globalThis.__advSave.calls, mode: globalThis.__advSave.mode }));

    const openPrintDialog = async () => {
      await win.click('[data-print]');
      await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
      await win.waitForFunction(() => {
        const sel = document.querySelector('[data-print-printer]');
        if (sel === null) return false;
        const hasReal = [...sel.querySelectorAll('option')].some((o) => o.value !== '');
        return hasReal || document.querySelector('[data-print-empty], [data-print-printers-error]') !== null;
      }, null, { timeout: 20000 });
      const opts = await win.$$eval('[data-print-printer] option', (o) => o.map((x) => ({ t: x.textContent.trim(), v: x.value })));
      const pdf = opts.find((o) => /pdf/i.test(o.t) || /pdf/i.test(o.v));
      if (!pdf) throw new Error('no virtual PDF printer found: ' + JSON.stringify(opts));
      await win.selectOption('[data-print-printer]', pdf.v);
      await win.waitForTimeout(400);
      return pdf;
    };
    const closeDialog = async () => {
      const open = await win.locator('.modal-backdrop').count();
      if (open > 0) {
        await win.locator('[data-print-cancel]').click({ timeout: 5000 }).catch(() => {});
        await win.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 8000 }).catch(() => {});
      }
      await win.waitForTimeout(400);
    };

    // ---- 1. Cancel the save dialog: quiet, no file, no hidden window ----
    await openPrintDialog();
    const winCountBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    await setSave('cancel', null);
    const calls0 = (await saveInfo()).calls;
    await win.click('[data-print-confirm]');
    await win.waitForTimeout(5000);
    const cancelState = await win.evaluate(() => ({
      error: (document.querySelector('[data-print-error]') || {}).textContent || null,
      success: (document.querySelector('[data-print-success]') || {}).textContent || null,
      confirmDisabled: document.querySelector('[data-print-confirm]') ? document.querySelector('[data-print-confirm]').disabled : null,
    }));
    const winCountAfter = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    note(`cancel: saveDialogCalls=${(await saveInfo()).calls - calls0} state=${JSON.stringify(cancelState)} windows ${winCountBefore}->${winCountAfter}`);
    await closeDialog();

    // ---- 2. Happy path 1-up: produced file validity ----
    const out1 = path.join(os.tmpdir(), `adv35-1up-${Date.now()}.pdf`);
    await openPrintDialog();
    await win.click('[data-print-range-custom]');
    await win.fill('[data-print-range-input]', '1-5');
    await win.waitForTimeout(600);
    await setSave('ok', out1);
    const before = listOsWindows(mainPid);
    await win.click('[data-print-confirm]');
    await win.waitForSelector('[data-print-success]', { timeout: 60000 });
    const success1 = await win.locator('[data-print-success]').innerText();
    await win.waitForTimeout(1500);
    const after = listOsWindows(mainPid);
    note(`1up: success=${JSON.stringify(success1)}`);
    note(`1up OS windows before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    await closeDialog();
    const insp1 = await inspectPdf(out1);
    note(`1up produced: ${JSON.stringify(insp1)}`);

    // ---- 3. N-up 2 + landscape + reverse order ----
    const out2 = path.join(os.tmpdir(), `adv35-2up-${Date.now()}.pdf`);
    await openPrintDialog();
    await win.click('[data-print-range-custom]');
    await win.fill('[data-print-range-input]', '1-6');
    await win.locator('[data-print-orientation-landscape]').check();
    await win.locator('[data-print-nup]').selectOption('2');
    await win.locator('[data-print-reverse]').check();
    await win.waitForTimeout(800);
    const previewMeta = await win.locator('[data-print-preview-meta]').innerText();
    await setSave('ok', out2);
    await win.click('[data-print-confirm]');
    await win.waitForSelector('[data-print-success]', { timeout: 60000 });
    await win.waitForTimeout(1200);
    await closeDialog();
    const insp2 = await inspectPdf(out2);
    note(`2up: preview=${JSON.stringify(previewMeta)} produced=${JSON.stringify(insp2)}`);

    // ---- 4. Existing file overwrite ----
    const out3 = path.join(os.tmpdir(), `adv35-overwrite-${Date.now()}.pdf`);
    fs.writeFileSync(out3, 'ORIGINAL-CONTENT-NOT-A-PDF');
    await openPrintDialog();
    await win.click('[data-print-range-custom]');
    await win.fill('[data-print-range-input]', '1-1');
    await win.waitForTimeout(600);
    await setSave('ok', out3);
    await win.click('[data-print-confirm]');
    await win.waitForSelector('[data-print-success]', { timeout: 60000 });
    await win.waitForTimeout(1000);
    await closeDialog();
    const ov = fs.readFileSync(out3);
    note(`overwrite: bytes=${ov.length} magic=${ov.subarray(0, 5).toString('latin1')} isPdf=${ov.subarray(0, 5).toString('latin1') === '%PDF-'}`);

    // ---- 5. Destination is a directory ----
    const dirPath = path.join(os.tmpdir(), `adv35-dir-${Date.now()}`);
    fs.mkdirSync(dirPath, { recursive: true });
    await openPrintDialog();
    await win.click('[data-print-range-custom]');
    await win.fill('[data-print-range-input]', '1-1');
    await win.waitForTimeout(600);
    await setSave('ok', dirPath);
    await win.click('[data-print-confirm]');
    await win.waitForTimeout(6000);
    const dirState = await win.evaluate(() => ({
      error: (document.querySelector('[data-print-error]') || {}).textContent || null,
      success: (document.querySelector('[data-print-success]') || {}).textContent || null,
    }));
    note(`dir-dest: state=${JSON.stringify(dirState)} dirStillExists=${fs.existsSync(dirPath)}`);
    await closeDialog();

    // ---- 6. Removed drive ----
    await openPrintDialog();
    await win.click('[data-print-range-custom]');
    await win.fill('[data-print-range-input]', '1-1');
    await win.waitForTimeout(600);
    await setSave('ok', 'Z:\\nope\\adv35-out.pdf');
    await win.click('[data-print-confirm]');
    await win.waitForTimeout(6000);
    const driveState = await win.evaluate(() => ({
      error: (document.querySelector('[data-print-error]') || {}).textContent || null,
      success: (document.querySelector('[data-print-success]') || {}).textContent || null,
    }));
    note(`removed-drive: state=${JSON.stringify(driveState)}`);
    await closeDialog();

    // ---- 7. Read-only file destination ----
    const roPath = path.join(os.tmpdir(), `adv35-ro-${Date.now()}.pdf`);
    fs.writeFileSync(roPath, '%PDF-1.4 fake');
    try { fs.chmodSync(roPath, 0o444); } catch (_) {}
    await openPrintDialog();
    await win.click('[data-print-range-custom]');
    await win.fill('[data-print-range-input]', '1-1');
    await win.waitForTimeout(600);
    await setSave('ok', roPath);
    await win.click('[data-print-confirm]');
    await win.waitForTimeout(6000);
    const roState = await win.evaluate(() => ({
      error: (document.querySelector('[data-print-error]') || {}).textContent || null,
      success: (document.querySelector('[data-print-success]') || {}).textContent || null,
    }));
    let roBytes = null; try { roBytes = fs.readFileSync(roPath).length; } catch (_) {}
    note(`read-only-dest: state=${JSON.stringify(roState)} bytes=${roBytes}`);
    try { fs.chmodSync(roPath, 0o666); } catch (_) {}
    await closeDialog();

    // ---- 8. Long / unicode path ----
    const uniDir = path.join(os.tmpdir(), `adv35-ünïcødé-${Date.now()} 空`);
    fs.mkdirSync(uniDir, { recursive: true });
    const uniPath = path.join(uniDir, 'øut 文.pdf');
    await openPrintDialog();
    await win.click('[data-print-range-custom]');
    await win.fill('[data-print-range-input]', '1-2');
    await win.waitForTimeout(600);
    await setSave('ok', uniPath);
    await win.click('[data-print-confirm]');
    await win.waitForTimeout(8000);
    const uniState = await win.evaluate(() => ({
      error: (document.querySelector('[data-print-error]') || {}).textContent || null,
      success: (document.querySelector('[data-print-success]') || {}).textContent || null,
    }));
    note(`unicode-dest: state=${JSON.stringify(uniState)} exists=${fs.existsSync(uniPath)}`);
    if (fs.existsSync(uniPath)) note(`unicode-dest produced=${JSON.stringify(await inspectPdf(uniPath))}`);
    await closeDialog();

    fs.writeFileSync(path.join(OUT, 'pdf_out.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'pdf_out.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-pdf');
  }

  async function inspectPdf(p) {
    try {
      if (!fs.existsSync(p)) return { exists: false };
      const bytes = fs.readFileSync(p);
      const magic = bytes.subarray(0, 5).toString('latin1');
      const { PDFDocument } = require('pdf-lib');
      let pageCount = null, sizes = null, err = null;
      try {
        return PDFDocument.load(bytes).then((pdf) => ({ exists: true, bytes: bytes.length, magic, pageCount: pdf.getPageCount(), sizes: pdf.getPages().map((x) => { const s = x.getSize(); return [Math.round(s.width), Math.round(s.height)]; }) })).catch((e) => ({ exists: true, bytes: bytes.length, magic, loadError: String(e.message).slice(0, 120) }));
      } catch (e) { return { exists: true, bytes: bytes.length, magic, loadError: String(e.message).slice(0, 120) }; }
    } catch (e) { return { inspectError: String(e.message).slice(0, 120) }; }
  }
})();


