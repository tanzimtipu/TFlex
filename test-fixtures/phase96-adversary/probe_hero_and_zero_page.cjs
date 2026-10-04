// TFL-648 adversary probe #2: settled hero sizes + zero-page reachability.
delete process.env.ELECTRON_RUN_AS_NODE;
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const ROOT = 'C:/Users/tanzi/OneDrive/App Development/TFlex';
const { launchApp, getSamplePath } = require(path.join(ROOT, 'e2e/lib/launch.cjs'));
const out = []; const log = o => { out.push(o); console.log('PROBE ' + JSON.stringify(o)); };

async function setTheme(win, theme) {
  await win.keyboard.press('Escape').catch(()=>{});
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 8000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction(t => document.documentElement.getAttribute('data-theme') === t, theme, { timeout: 8000 });
  await win.waitForTimeout(400);
}
async function openPdf(win, app, f) {
  await app.evaluate(async ({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[p] }); }, f);
  await win.locator('button:has-text("Open PDF")').first().click();
}
async function hero(win, sel) {
  return win.evaluate((s) => { const m = document.querySelector(s); if (!m) return null; const r = m.getBoundingClientRect(); const cs = getComputedStyle(m); return { w:+r.width.toFixed(2), h:+r.height.toFixed(2), cssW:cs.width, cssH:cs.height }; }, sel);
}
function makeZeroPagePdf() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p96z2-'));
  const p = path.join(dir, 'zero-pages.pdf');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [] /Count 0 >>'];
  let body='%PDF-1.4\n'; const offs=[];
  objs.forEach((o,i)=>{offs.push(body.length); body+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const x=body.length;
  body+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;
  for(const o of offs) body+=`${String(o).padStart(10,'0')} 00000 n \n`;
  body+=`trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  fs.writeFileSync(p, body, 'latin1'); return p;
}

async function main() {
  // PASS A: settled hero sizes across themes (palette + context-panel edit)
  {
    const app = await launchApp([], path.join(os.tmpdir(), `tflex-p96-h-${Date.now()}`));
    const win = await app.firstWindow();
    try {
      await win.waitForSelector('.sample-card', { timeout:30000 });
      await openPdf(win, app, getSamplePath('report.pdf'));
      await win.waitForSelector('.workspace', { timeout:30000 });
      for (const theme of ['light','dark','frosted']) {
        await setTheme(win, theme);
        await win.keyboard.press('Control+k');
        await win.waitForSelector('[data-command-palette-empty]', { timeout:8000 }).catch(()=>{});
        await win.locator('[data-command-palette-input]').fill('zzzzznomatch');
        await win.waitForSelector('[data-command-palette-empty]', { timeout:8000 });
        await win.waitForTimeout(700);
        log({ pass:'A', theme, paletteHero: await hero(win, '[data-command-palette-empty] .empty-state-mark') });
        await win.keyboard.press('Escape'); await win.waitForTimeout(300);
      }
      // edit-content empty: gotoStage(2) via data-stage-rail, expand panel
      await setTheme(win, 'light');
      // try the e2e helper semantics: click stage rail data-stage=edit then ensure panel
      const stageClicked = await win.evaluate(() => { const b=document.querySelector('[data-stage-rail] [data-stage="edit"]'); if(b){b.click(); return true;} return false; });
      await win.waitForTimeout(600);
      // ensure context panel expanded
      await win.evaluate(() => { const b=document.querySelector('[data-context-panel-collapsed], [data-panel-expand]'); if(b && b.getAttribute('data-context-panel-collapsed')!==null) b.click(); });
      await win.waitForTimeout(600);
      for (const theme of ['light','dark','frosted']) {
        await setTheme(win, theme);
        const present = await win.locator('[data-edit-content-empty]').count();
        if (present) {
          await win.waitForTimeout(400);
          log({ pass:'A', theme, editHero: await hero(win, '[data-edit-content-empty] .empty-state-mark'), stageClicked });
        } else {
          log({ pass:'A', theme, editHero:'selector-absent', stageClicked, panel: await win.locator('[data-context-panel]').count() });
        }
      }
    } catch(e) { log({ pass:'A', check:'EXCEPTION', error:String(e&&e.message) }); }
    finally { await app.close().catch(()=>{}); }
  }
  // PASS B: zero-page reachability
  {
    const app = await launchApp([], path.join(os.tmpdir(), `tflex-p96-z2-${Date.now()}`));
    const win = await app.firstWindow();
    const errs=[]; win.on('pageerror', e=>errs.push(String(e.message)));
    const dialogs=[];
    win.on('dialog', async d => { dialogs.push({type:d.type(), message:d.message().slice(0,200)}); await d.dismiss().catch(()=>{}); });
    try {
      await win.waitForSelector('.sample-card', { timeout:30000 });
      const z = makeZeroPagePdf();
      await openPdf(win, app, z);
      const reached = await win.waitForSelector('.workspace', { timeout: 8000 }).then(()=>true).catch(()=>false);
      const st = await win.evaluate(() => {
        let d=null; try { d=window.tflexDiagnostics(); } catch(e) { return { diagErr:String(e) }; }
        const pc = d && d.engineState ? d.engineState.pageCount : (d && d.pageCount !== undefined ? d.pageCount : null);
        return {
          welcome: !!document.querySelector('.welcome-body'),
          workspace: !!document.querySelector('.workspace'),
          pageCount: pc,
          thumbsEmpty: !!document.querySelector('[data-context-panel-thumbs-empty]'),
          inspectorEmpty: !!document.querySelector('[data-inspector-empty]'),
          contextPanel: !!document.querySelector('[data-context-panel]'),
          inspector: !!document.querySelector('[data-inspector]'),
          bodyText: (document.body.innerText||'').replace(/\s+/g,' ').slice(0,300),
        };
      });
      log({ pass:'B', reached, st, dialogs, pageerrors: errs });
      await win.screenshot({ path: path.join(ROOT,'screenshots','phase96','adv-zero-page.png') }).catch(()=>{});
    } catch(e) { log({ pass:'B', check:'EXCEPTION', error:String(e&&e.message), dialogs, pageerrors: errs }); }
    finally { await app.close().catch(()=>{}); }
  }
  fs.writeFileSync(process.env.PAPERCLIP_RUN_SCRATCH_DIR + '/p96_probe2_results.json', JSON.stringify(out,null,2));
  console.log('PROBE2 DONE ' + out.length);
}
main().catch(e => { console.error('PROBE2 FATAL', e); process.exit(1); });
