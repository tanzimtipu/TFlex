// TFL-648 adversary diff-pass probe. Read-only over product code.
// Launched ONLY through the canonical e2e/lib/launch.cjs.
delete process.env.ELECTRON_RUN_AS_NODE;
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const ROOT = 'C:/Users/tanzi/OneDrive/App Development/TFlex';
const { launchApp, getSamplePath } = require(path.join(ROOT, 'e2e/lib/launch.cjs'));

const out = [];
const log = (o) => { out.push(o); console.log('PROBE ' + JSON.stringify(o)); };

function parse(c) { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(v => parseFloat(v.trim())); return [p[0],p[1],p[2],p.length>3?p[3]:1]; }
function comp(fg,bg){const a=fg[3];return [Math.round(fg[0]*a+bg[0]*(1-a)),Math.round(fg[1]*a+bg[1]*(1-a)),Math.round(fg[2]*a+bg[2]*(1-a)),1];}
function lum([r,g,b]){const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);}
function ratio(a,b){const A=lum(a),B=lum(b);const hi=Math.max(A,B),lo=Math.min(A,B);return (hi+0.05)/(lo+0.05);}

async function setTheme(win, theme) {
  await win.keyboard.press('Escape').catch(()=>{});
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 8000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction(t => document.documentElement.getAttribute('data-theme') === t, theme, { timeout: 8000 });
  await win.waitForTimeout(350);
}
async function openPdf(win, app, filePath) {
  await app.evaluate(async ({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[f] }); }, filePath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForTimeout(2500);
}
function makeZeroPagePdf() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p96z-'));
  const p = path.join(dir, 'zero-pages.pdf');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [] /Count 0 >>'];
  let body = '%PDF-1.4\n'; const offs=[];
  objs.forEach((o,i)=>{offs.push(body.length); body += `${i+1} 0 obj\n${o}\nendobj\n`;});
  const x = body.length;
  body += `xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;
  for (const o of offs) body += `${String(o).padStart(10,'0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  fs.writeFileSync(p, body, 'latin1');
  return p;
}

async function main() {
  // ---------- PASS 1: real doc, dialog elevation, state colours ----------
  {
    const app = await launchApp([], path.join(os.tmpdir(), `tflex-p96-adv-${Date.now()}`));
    const win = await app.firstWindow();
    const errs = [];
    win.on('pageerror', e => errs.push(String(e.message)));
    try {
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await setTheme(win, 'light');
      await openPdf(win, app, getSamplePath('report.pdf'));
      const reached = await win.waitForSelector('.workspace', { timeout: 15000 }).then(()=>true).catch(()=>false);
      log({ pass:1, check:'report-opens', reached });
      const diag = await win.evaluate(() => { try { const d = window.tflexDiagnostics(); return { pageCount: d.engineState.pageCount, tabs: d.engineState.pageCount }; } catch(e){ return { err:String(e) }; } });
      log({ pass:1, check:'diagnostics', diag });

      // false-empty on a NON-empty surface
      const fe = await win.evaluate(() => ({
        thumbsEmpty: !!document.querySelector('[data-context-panel-thumbs-empty]'),
        thumbItems: document.querySelectorAll('.thumb-item').length,
        inspectorEmpty: !!document.querySelector('[data-inspector-empty]'),
        inspectorFileSize: !!document.querySelector('[data-inspector-value="file-size"]'),
        inspectorHasPagesRow: !!document.querySelector('[data-inspector-row="page-count"], [data-inspector-value="file-size"]'),
      }));
      log({ pass:1, check:'false-empty', fe });

      // state colour distinctness in the panel context
      const states = await win.evaluate(() => {
        const host = document.querySelector('[data-context-panel] .context-panel-section') || document.querySelector('[data-context-panel]') || document.body;
        const mk = (cls, attrs={}) => { const b=document.createElement('button'); b.className=cls; Object.entries(attrs).forEach(([k,v])=>b.setAttribute(k,v)); b.textContent='x'; host.appendChild(b); const cs=getComputedStyle(b); const r={bg:cs.backgroundColor,border:cs.borderColor,color:cs.color,opacity:cs.opacity,shadow:cs.boxShadow}; b.remove(); return r; };
        const probe = document.createElement('div');
        host.appendChild(probe);
        const hoverToken = getComputedStyle(probe).getPropertyValue('--bg-hover').trim();
        const activeToken = getComputedStyle(probe).getPropertyValue('--bg-active').trim();
        const selectFill = getComputedStyle(probe).getPropertyValue('--select-fill').trim();
        probe.remove();
        return {
          hoverToken, activeToken, selectFill,
          selected: mk('context-panel-item context-panel-item-selected'),
          selectedAria: mk('context-panel-item', { 'aria-pressed':'true' }),
          disabled: mk('context-panel-item', { disabled:'' }),
          reviewSelected: mk('review-elements-row-select'),
        };
      });
      log({ pass:1, check:'state-colours', states });

      // dialog elevation contract
      await win.locator('[data-open-preferences]').first().click({ timeout:10000 });
      await win.waitForSelector('[data-prefs-dialog]', { timeout:8000 });
      const elev = await win.evaluate(() => {
        const probe = (v) => { const d=document.createElement('div'); d.style.boxShadow=v; document.body.appendChild(d); const s=getComputedStyle(d).boxShadow; d.remove(); return s; };
        const el = document.querySelector('[data-prefs-dialog]');
        const shell = el.closest('[data-dialog-shell]') || el.closest('.modal-dialog') || el;
        return {
          shellClass: shell.className,
          dialogShadow: getComputedStyle(shell).boxShadow,
          elevation2: probe('var(--elevation-2)'),
          elevation3: probe('var(--elevation-3)'),
        };
      });
      log({ pass:1, check:'dialog-elevation', elev, matchesElevation2: elev.dialogShadow===elev.elevation2, matchesElevation3: elev.dialogShadow===elev.elevation3 });
      await win.keyboard.press('Escape'); await win.waitForTimeout(300);

      // empty-state hero sizes in all themes (palette no-results + edit-content)
      for (const theme of ['light','dark','frosted']) {
        await setTheme(win, theme);
        await win.keyboard.press('Control+k');
        await win.waitForSelector('[data-command-palette]', { timeout:8000 });
        await win.locator('[data-command-palette-input]').fill('zzzzznomatch');
        await win.waitForSelector('[data-command-palette-empty]', { timeout:8000 });
        const pal = await win.evaluate(() => { const m=document.querySelector('[data-command-palette-empty] .empty-state-mark'); return m?{w:Math.round(m.getBoundingClientRect().width),h:Math.round(m.getBoundingClientRect().height),cls:m.getAttribute('class'),color:getComputedStyle(m).color}:null; });
        await win.keyboard.press('Escape'); await win.waitForTimeout(250);
        log({ pass:1, check:'palette-hero', theme, pal });
      }
      log({ pass:1, check:'pageerrors', errs });
    } catch (e) {
      log({ pass:1, check:'EXCEPTION', error:String(e && e.message) });
    } finally { await app.close().catch(()=>{}); }
  }

  // ---------- PASS 2: zero-page document reachability ----------
  {
    const app = await launchApp([], path.join(os.tmpdir(), `tflex-p96-advz-${Date.now()}`));
    const win = await app.firstWindow();
    const errs = [];
    win.on('pageerror', e => errs.push(String(e.message)));
    const winText = [];
    win.on('console', m => { if (m.type()==='error') winText.push(m.text().slice(0,200)); });
    try {
      await win.waitForSelector('.sample-card', { timeout:30000 });
      const z = makeZeroPagePdf();
      log({ pass:2, check:'zero-fixture', path: z, bytes: fs.statSync(z).size });
      await openPdf(win, app, z);
      const reached = await win.waitForSelector('.workspace', { timeout: 8000 }).then(()=>true).catch(()=>false);
      const st = await win.evaluate(() => {
        let d=null; try { d = window.tflexDiagnostics(); } catch(e) {}
        return {
          welcome: !!document.querySelector('.welcome-body'),
          workspace: !!document.querySelector('.workspace'),
          pageCount: d ? d.engineState.pageCount : null,
          activeId: d ? d.activeTabId : undefined,
          thumbsEmpty: !!document.querySelector('[data-context-panel-thumbs-empty]'),
          inspectorEmpty: !!document.querySelector('[data-inspector-empty]'),
          contextPanel: !!document.querySelector('[data-context-panel]'),
          inspector: !!document.querySelector('[data-inspector]'),
        };
      });
      log({ pass:2, check:'zero-page-result', reached, st, consoleErrors: winText, pageerrors: errs });
      await win.screenshot({ path: path.join(ROOT,'screenshots','phase96','adv-zero-page.png') }).catch(()=>{});
    } catch (e) {
      log({ pass:2, check:'EXCEPTION', error:String(e && e.message) });
    } finally { await app.close().catch(()=>{}); }
  }

  fs.writeFileSync(process.env.PAPERCLIP_RUN_SCRATCH_DIR + '/p96_probe_results.json', JSON.stringify(out, null, 2));
  console.log('PROBE DONE ' + out.length + ' records');
}
main().catch(e => { console.error('PROBE FATAL', e); process.exit(1); });
