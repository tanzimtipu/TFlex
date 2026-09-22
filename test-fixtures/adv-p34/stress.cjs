// ADV phase-34: panel inset under stress - drag in flight, rapid toggles,
// mode toggle, theme change, divider extremes with panel open, and the
// panel/pane lockstep. Real dev build via launchApp.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p34');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const findings = [];
function note(s) { const l = `[adv34-stress] ${s}`; console.log(l); lines.push(l); }
function finding(t, sev, d) { findings.push({ title: t, severity: sev, detail: d }); note(`FINDING (${sev}): ${t} :: ${JSON.stringify(d)}`); }

async function geom(win) {
  return win.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width) }; };
    const am = document.querySelector('.app-main');
    return {
      stage: r('.tab-stage'), divider: r('[data-multi-divider]'), panel: r('[data-tools-palette]'),
      A: r('.tab-pane[data-pane="A"] .workspace-main'), B: r('.tab-pane[data-pane="B"] .workspace-main'),
      inset: am ? getComputedStyle(am).getPropertyValue('--tf-tools-inset').trim() : null,
      frac: getComputedStyle(document.querySelector('.tab-stage')).getPropertyValue('--tf-split-frac').trim(),
      dividerBg: (() => { const d = document.querySelector('[data-multi-divider]'); return d ? getComputedStyle(d).backgroundColor : null; })(),
      dividerW: (() => { const d = document.querySelector('[data-multi-divider]'); return d ? Math.round(d.getBoundingClientRect().width) : null; })(),
      grip: (() => { const g = document.querySelector('.multi-divider-grip'); if (!g) return null; const b = g.getBoundingClientRect(); const cs = getComputedStyle(g); return { w: Math.round(b.width), h: Math.round(b.height), opacity: cs.opacity, bg: cs.backgroundColor }; })(),
    };
  });
}
async function openPanel(win) { await win.locator('[data-tools-badge]').first().click(); await win.waitForSelector('[data-tools-palette]', { timeout: 10000 }); await win.waitForTimeout(700); }
async function closePanel(win) { await win.locator('.tools-palette-close').first().click(); await win.waitForSelector('[data-tools-palette]', { state: 'detached', timeout: 10000 }); await win.waitForTimeout(700); }
async function setup(app, win, tag) {
  const alpha = C.tmpCopy(C.REPORT, `adv34-${tag}-alpha.pdf`);
  const beta = C.tmpCopy(C.LONG, `adv34-${tag}-beta.pdf`);
  await C.openFile(app, win, alpha); await win.waitForTimeout(700);
  await C.openFile(app, win, beta); await win.waitForTimeout(700);
  await win.locator('.tab[data-tab-id]').filter({ hasText: `adv34-${tag}-alpha` }).first().click();
  await win.waitForTimeout(300);
  await win.locator('[data-toolbar-multi-mode]:visible').first().click();
  await win.waitForTimeout(500);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: `adv34-${tag}-beta` }).first().click();
  await win.waitForTimeout(1600);
}
async function dragDividerTo(win, frac) {
  const box = await win.locator('[data-multi-divider]').boundingBox();
  const stage = await win.locator('.tab-stage').boundingBox();
  if (!box || !stage) return;
  const usable = await win.evaluate(() => { const st = document.querySelector('.tab-stage'); const am = document.querySelector('.app-main'); const inset = parseFloat(getComputedStyle(am).getPropertyValue('--tf-tools-inset')) || 0; return st.getBoundingClientRect().width - inset; });
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(stage.x + usable * frac, box.y + box.height / 2, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(400);
}
async function dispatchDrag(win, step, arg) {
  return win.evaluate(({ step: s, arg: a }) => {
    const KEY = '__p34dt';
    if (s === 'start') { const src = document.querySelector(a.src); if (!src) return { ok: false }; const dt = new DataTransfer(); window[KEY] = dt; src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })); return { ok: true }; }
    const dt = window[KEY]; if (!dt) return { ok: false };
    if (s === 'over') { const tgt = document.querySelector(a.tgt); if (!tgt) return { ok: false }; const r = tgt.getBoundingClientRect(); tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.3 })); return { ok: true }; }
    if (s === 'end') { const src = document.querySelector(a.src); if (src) src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt })); delete window[KEY]; return { ok: true }; }
    return { ok: false };
  }, { step, arg });
}
async function withApp(name, fn) {
  let app = null, win = null;
  try {
    app = await launchApp(); win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 }); await win.waitForTimeout(300);
    note(`=== ${name} ===`);
    await fn(app, win);
  } catch (e) { note(`${name} THREW: ${e.message}`); }
  finally { if (app) await hardClose(app, `p34-${name}`).catch(() => {}); }
}

(async () => {
  // ---- Divider extremes with the panel open + panel/pane lockstep ----
  await withApp('S1-extremes-panel', async (app, win) => {
    await setup(app, win, 's1');
    await openPanel(win);
    for (const f of [0.05, 0.5, 0.95]) {
      await dragDividerTo(win, f);
      const g = await geom(win);
      const paneW = Math.min(g.A ? g.A.w : 999, g.B ? g.B.w : 999);
      note(`panel-open drag f=${f} frac=${g.frac} A=${g.A && g.A.w} B=${g.B && g.B.w} divider=${JSON.stringify(g.divider)} panelLeft=${g.panel && g.panel.left}`);
      if (g.A && g.B && g.A.w < 100) finding(`Panel open: pane A collapsed to ${g.A.w}px when dragging the divider to ${f}`, 'MEDIUM', { g });
      if (g.B && g.panel && g.B.right > g.panel.left + 2) finding(`Panel open: pane B overlaps the panel when dragging to ${f}`, 'HIGH', { g });
      if (g.divider && g.A && g.B && !(g.divider.left >= g.A.right - 2 && g.divider.right <= g.B.left + 2)) finding(`Panel open: divider not between panes at ${f}`, 'HIGH', { g });
    }
    // rest lockstep: pane B right == panel left
    const rest = await geom(win);
    if (rest.B && rest.panel) {
      const gap = rest.B.right - rest.panel.left;
      note(`rest gap paneB.right - panel.left = ${gap}`);
      if (Math.abs(gap) > 1) finding(`At rest the pane B right edge and the panel left edge are not flush (gap ${gap}px)`, 'MEDIUM', { rest });
    }
    await closePanel(win);
  });

  // ---- rapid panel open/close ----
  await withApp('S2-rapid-panel', async (app, win) => {
    await setup(app, win, 's2');
    const before = await geom(win);
    for (let i = 0; i < 10; i += 1) {
      await openPanel(win);
      await closePanel(win);
    }
    const after = await geom(win);
    note(`rapid before inset=${before.inset} A=${before.A && before.A.w} B=${before.B && before.B.w}; after inset=${after.inset} A=${after.A && after.A.w} B=${after.B && after.B.w} panel=${after.panel}`);
    if (after.panel !== null) finding('Panel still mounted after 10 open/close cycles', 'MEDIUM', { after });
    if (after.inset !== '0px') finding(`Inset did not return to 0 after rapid cycles (${after.inset})`, 'MEDIUM', { after });
    if (before.A && after.A && Math.abs(before.A.w - after.A.w) > 1) finding('Pane A width did not return after rapid panel cycles', 'MEDIUM', { before, after });
  });

  // ---- panel toggle during a drag ----
  await withApp('S3-panel-during-drag', async (app, win) => {
    await setup(app, win, 's3');
    const src = '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]';
    await dispatchDrag(win, 'start', { src });
    await win.waitForTimeout(200);
    await dispatchDrag(win, 'over', { tgt: '.tab-pane[data-pane="B"] .page-slot[data-page="3"]' });
    await win.waitForTimeout(300);
    const before = await geom(win);
    // open the panel mid-drag
    await win.locator('[data-tools-badge]').first().click();
    await win.waitForTimeout(1200);
    const mid = await geom(win);
    const ind = await win.evaluate(() => Array.from(document.querySelectorAll('.tab-pane[data-pane="B"] [data-drop-indicator]')).map((el) => ({ side: el.getAttribute('data-drop-indicator'), page: el.getAttribute('data-drop-page') })));
    note(`during drag panel open: before inset=${before.inset} mid inset=${mid.inset} indicators=${JSON.stringify(ind)}`);
    if (mid.inset === '0px') finding('Opening the panel during a page drag did not apply the inset', 'MEDIUM', { mid });
    await dispatchDrag(win, 'end', { src });
    await win.waitForTimeout(500);
    const gone = await win.evaluate(() => document.querySelectorAll('[data-drop-indicator]').length);
    if (gone > 0) finding('Drop indicator survived drag end that was interrupted by a panel open', 'LOW', { gone });
    await closePanel(win);
  });

  // ---- theme change with panel open + divider visibility ----
  await withApp('S4-theme', async (app, win) => {
    await setup(app, win, 's4');
    await openPanel(win);
    for (const theme of ['dark', 'light', 'frosted']) {
      await win.click('[data-theme-toggle]');
      await win.waitForSelector(`[data-theme-option="${theme}"]`, { state: 'visible', timeout: 8000 });
      await win.click(`[data-theme-option="${theme}"]`);
      await win.waitForTimeout(800);
      const g = await geom(win);
      note(`theme=${theme} dividerW=${g.dividerW} bg=${g.dividerBg} grip=${JSON.stringify(g.grip)} B.right=${g.B && g.B.right} panel.left=${g.panel && g.panel.left}`);
      if (g.dividerBg === 'rgba(0, 0, 0, 0)' || g.dividerBg === 'transparent') finding(`Divider has no visible surface in theme ${theme}`, 'MEDIUM', { g });
      if (g.grip && Number(g.grip.opacity) < 0.99) finding(`Divider grip is not always visible in theme ${theme} (opacity ${g.grip.opacity})`, 'LOW', { g });
      if (g.B && g.panel && g.B.right > g.panel.left + 2) finding(`Pane B overlaps the panel in theme ${theme}`, 'HIGH', { g });
      await win.screenshot({ path: path.join(C.SHOTS, `adv-p34-divider-${theme}.png`) });
    }
    await closePanel(win);
  });

  // ---- mode toggle + immediate panel open ----
  await withApp('S5-mode-panel', async (app, win) => {
    await setup(app, win, 's5');
    // turn mode off then immediately open the panel, then turn mode on
    await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode]:visible').first().click();
    await win.waitForTimeout(150);
    await win.locator('[data-tools-badge]').first().click().catch(() => {});
    await win.waitForTimeout(900);
    await win.locator('[data-toolbar-multi-mode]:visible').first().click().catch(() => {});
    await win.waitForTimeout(1200);
    const g = await geom(win);
    note(`mode+panel: multi=${await win.locator('.tab-stage').getAttribute('data-multi-mode')} inset=${g.inset} A=${g.A && g.A.w} B=${g.B && g.B.w} panel=${g.panel}`);
    // Now the key question: is the panel still open in multi mode and is pane B flush?
    if (g.panel && g.B) {
      const gap = g.B.right - g.panel.left;
      note(`mode+panel gap=${gap}`);
      if (Math.abs(gap) > 1) finding(`After toggling mode with the panel open, pane B is not flush with the panel (gap ${gap})`, 'MEDIUM', { g });
    }
    await win.screenshot({ path: path.join(C.SHOTS, 'adv-p34-mode-panel.png') });
  });

  fs.writeFileSync(path.join(OUT, 'stress.log'), lines.join('\n') + '\n', 'utf8');
  note(`TOTAL FINDINGS: ${findings.length}`);
  console.log(`\n=== SUMMARY ===\n${JSON.stringify(findings, null, 2)}`);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exitCode = 2; });