// ADV phase-35: caption-strip control clickability, window gestures, opaque-window visual.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p35');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const lines = [];
const note = (s) => { console.log(`[adv35-win] ${s}`); lines.push(`[adv35-win] ${s}`); };

(async () => {
  let app = null;
  try {
    app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(400);
    await C.openFile(app, win, C.tmpCopy(C.REPORT, 'adv35-win-a.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1200);

    // ---- caption hit-test across the strip ----
    const hit = await win.evaluate(() => {
      const strip = document.querySelector('.titlebar');
      const r = strip.getBoundingClientRect();
      const y = Math.round(r.top + r.height / 2);
      const regionOf = (el) => { let cur = el; while (cur && cur !== document.documentElement) { const cs = getComputedStyle(cur); const ar = cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region'); if (ar && ar !== 'none') return ar; cur = cur.parentElement; } return 'none'; };
      const isControl = (el) => { let cur = el; while (cur && cur !== document.documentElement) { if (cur.matches && cur.matches("button, input, select, textarea, a, [role='button']")) return true; cur = cur.parentElement; } return false; };
      const pts = [];
      for (let i = 0; i <= 60; i += 1) { const x = Math.round(r.left + ((r.width - 1) * i) / 60); const el = document.elementFromPoint(x, y); pts.push({ x, region: el ? regionOf(el) : 'none', control: el ? isControl(el) : false }); }
      return { drag: pts.filter((p) => p.region !== 'none' && !p.control).length, control: pts.filter((p) => p.control).length, other: pts.filter((p) => p.region === 'none' && !p.control).length, total: pts.length, strip: { w: Math.round(r.width), h: Math.round(r.height) } };
    });
    note(`caption hit-test: strip=${JSON.stringify(hit.strip)} drag=${hit.drag} control=${hit.control} other=${hit.other} total=${hit.total}`);

    // ---- click every caption-strip control and verify the effect ----
    const controls = [
      ['menu', '[data-menu-button]', async () => { const v = await win.locator('[data-menu-popover]').isVisible(); return `popover=${v}`; }],
      ['theme', '[data-theme-toggle]', async () => { const v = await win.locator('[data-theme-option="dark"]').isVisible(); return `options=${v}`; }],
      ['open', '[data-toolbar-open]', async () => { const v = await win.locator('.modal-backdrop').count(); return `dialogs=${v}`; }],
      ['preferences', '[data-open-preferences]', async () => { const v = await win.locator('.modal-backdrop').count(); return `dialogs=${v}`; }],
      ['print', '[data-print]', async () => { const v = await win.locator('[data-print-printer]').isVisible().catch(() => false); return `printDialog=${v}`; }],
      ['maximize', '[data-window-maximize]', async () => { const m = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()); return `maximized=${m}`; }],
    ];

    // stub the open dialog so the Open control never blocks
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true }); });

    for (const [name, sel, verify] of controls) {
      const before = await win.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; }, sel);
      if (before === null) { note(`control ${name}: NOT FOUND (${sel})`); continue; }
      const atPoint = await win.evaluate((p) => { const el = document.elementFromPoint(p.x, p.y); return el ? (el.closest('button,input,select,[role=button]') ? 'control' : el.className.toString().slice(0, 40)) : 'null'; }, before);
      let clicked = 'ok';
      try { await win.locator(sel).first().click({ timeout: 5000 }); } catch (e) { clicked = `CLICK_FAILED: ${String(e.message).split('\n')[0]}`; }
      await win.waitForTimeout(700);
      const effect = await verify();
      note(`control ${name}: rect=${JSON.stringify(before)} elementAtPoint=${atPoint} clicked=${clicked} ${effect}`);
      // clean up: close popovers/dialogs, restore window
      if (name === 'menu') await win.locator('[data-menu-button]').click().catch(() => {});
      if (name === 'theme') { await win.keyboard.press('Escape').catch(() => {}); await win.locator('[data-theme-option="light"]').click({ timeout: 3000 }).catch(() => {}); }
      if (name === 'open' || name === 'preferences' || name === 'print') { await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(300); if ((await win.locator('.modal-backdrop').count()) > 0) { await win.locator('.modal-backdrop').click({ position: { x: 5, y: 5 }, timeout: 3000 }).catch(() => {}); } }
      if (name === 'maximize') { await win.locator('[data-window-maximize]').click().catch(() => {}); await win.waitForTimeout(600); }
      await win.waitForTimeout(300);
    }

    // ---- 10x maximize/restore via the caption control ----
    const maxSeq = [];
    for (let i = 0; i < 10; i += 1) {
      await win.locator('[data-window-maximize]').click({ timeout: 5000 }).catch((e) => maxSeq.push('clickfail'));
      await win.waitForTimeout(350);
      maxSeq.push(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()));
    }
    note(`10x maximize/restore: ${JSON.stringify(maxSeq)}`);
    // ensure restored
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); });
    await win.waitForTimeout(500);

    // ---- minimize + restore via IPC ----
    const minState = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.minimize();
      await new Promise((r) => setTimeout(r, 600));
      const min = w.isMinimized();
      w.restore();
      await new Promise((r) => setTimeout(r, 600));
      return { min, restored: !w.isMinimized() };
    });
    note(`minimize/restore: ${JSON.stringify(minState)}`);

    // ---- double-click the empty caption area (real synthetic dblclick) ----
    const dbl = await win.evaluate(() => {
      const strip = document.querySelector('.titlebar');
      const slot = document.querySelector('.titlebar-slot');
      const r = strip.getBoundingClientRect();
      // find an x that is drag-only
      let x = null;
      for (let i = 0; i <= 60; i += 1) { const px = Math.round(r.left + (r.width - 1) * i / 60); const el = document.elementFromPoint(px, Math.round(r.top + r.height / 2)); if (el && !el.closest("button,input,select,textarea,a,[role='button']")) { x = px; break; } }
      return { x, y: Math.round(r.top + r.height / 2) };
    });
    const maxBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
    if (dbl.x !== null) { await win.mouse.dblclick(dbl.x, dbl.y); await win.waitForTimeout(900); }
    const maxAfter = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
    note(`dblclick empty caption at ${JSON.stringify(dbl)}: maximized ${maxBefore} -> ${maxAfter}`);
    if (maxAfter) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize()); await win.waitForTimeout(500); }

    // ---- opaque window visual state ----
    const bg = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { bg: w.getBackgroundColor(), bounds: w.getBounds(), transparent: w.isAlwaysOnTop() }; });
    const domBg = await win.evaluate(() => {
      const app = document.querySelector('.app');
      const cs = app ? getComputedStyle(app) : null;
      return { appBg: cs ? cs.backgroundColor : null, bodyBg: getComputedStyle(document.body).backgroundColor, htmlBg: getComputedStyle(document.documentElement).backgroundColor };
    });
    note(`opaque: mainBg=${JSON.stringify(bg)} domBg=${JSON.stringify(domBg)}`);
    await win.screenshot({ path: path.join(SHOTS, 'adv-p35-opaque-window.png') });

    fs.writeFileSync(path.join(OUT, 'window.log'), lines.join('\n'));
    note('DONE');
  } catch (e) {
    note(`FATAL ${e && e.stack ? e.stack : e}`);
  } finally {
    try { fs.writeFileSync(path.join(OUT, 'window.log'), lines.join('\n')); } catch (_) {}
    if (app) await hardClose(app, 'adv35-win');
  }
})();
