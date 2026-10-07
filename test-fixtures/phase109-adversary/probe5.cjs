// Phase 109 adversary probe 5 (TFL-918) - isolate the scroller/footer overlap trigger.
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const OUT = [];
function log(...a) { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); OUT.push(s); console.log(s); }
async function setWindow(app, win, w, h) { await app.evaluate(({ BrowserWindow }, sz) => { const bw = BrowserWindow.getAllWindows()[0]; if (bw) { try { bw.unmaximize(); } catch (_) {} bw.setSize(sz[0], sz[1]); } }, [w, h]); await win.waitForTimeout(700); }
async function openSample(win, name = 'report.pdf') { await win.locator('.sample-card').filter({ hasText: name }).first().click(); await win.waitForSelector('.workspace', { timeout: 30000 }); await win.waitForSelector('.pdf-page canvas', { timeout: 30000 }); await win.waitForTimeout(1200); }
async function rects(win) {
  return win.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    const strip = document.querySelector('[data-view-strip]');
    const b = strip ? strip.getBoundingClientRect() : null;
    const top = b ? document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)) : null;
    const scroller = document.querySelector('.document-scroller');
    const sb = scroller ? scroller.getBoundingClientRect() : null;
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      workspaceMain: r('.workspace-main'),
      scroller: r('.document-scroller'),
      strip: r('.view-strip'),
      footerTop: b ? Math.round(b.top) : null,
      scrollerBottom: sb ? Math.round(sb.bottom) : null,
      overlapPx: (b && sb) ? Math.round(sb.bottom - b.top) : null,
      topAtFooterCenter: top ? `${top.tagName.toLowerCase()}.${String(top.className)}` : null,
      inStrip: top ? !!top.closest('[data-view-strip]') : false,
    };
  });
}
async function toggleTheme(win) { await win.locator('[data-app-menu]').first().click(); await win.waitForSelector('[data-app-menu-popover]', { state: 'visible', timeout: 8000 }); await win.locator('[data-app-menu-popover] [data-menu-action="toggleTheme"]').first().click(); await win.waitForTimeout(1000); }

async function main() {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);
  await openSample(win);
  await setWindow(app, win, 1440, 900);

  log('== baseline ==');
  log('  ', JSON.stringify(await rects(win)));
  await win.waitForTimeout(2500);
  log('  after 2.5s settle:', JSON.stringify(await rects(win)));

  log('== theme toggles only (no Book View) ==');
  for (let i = 0; i < 4; i += 1) { await toggleTheme(win); log(`  after toggle ${i + 1}:`, JSON.stringify(await rects(win))); }

  log('== Book View open/close only (no theme toggle) ==');
  await win.locator('[data-view-strip] [data-book-view-open]').first().click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(700);
  await win.locator('[data-book-view] [aria-label="Close book view"]').first().click();
  await win.waitForTimeout(1000);
  log('  after book close:', JSON.stringify(await rects(win)));
  await win.waitForTimeout(2000);
  log('  after book close +2s:', JSON.stringify(await rects(win)));

  log('== book close THEN theme toggle ==');
  await win.locator('[data-view-strip] [data-book-view-open]').first().click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(700);
  await win.locator('[data-book-view] [aria-label="Close book view"]').first().click();
  await win.waitForTimeout(1000);
  await toggleTheme(win);
  log('  after book close + theme:', JSON.stringify(await rects(win)));
  await win.waitForTimeout(2500);
  log('  +2.5s settle:', JSON.stringify(await rects(win)));
  await win.screenshot({ path: path.join(__dirname, '..', '..', 'screenshots', 'phase109-adv-scroller-overlap.png') });

  fs.writeFileSync(path.join(__dirname, 'probe5.output.json'), JSON.stringify(OUT, null, 2));
  await app.close();
}
main().then(() => { console.log('PROBE5-DONE'); process.exit(0); }).catch((e) => { console.error('PROBE5-ERROR', e && e.stack ? e.stack : e); try { fs.writeFileSync(path.join(__dirname, 'probe5.output.json'), JSON.stringify(OUT, null, 2)); } catch (_) {} process.exit(1); });
