// ADV phase-34: reruns for the extra-tab composite close and the repeated
// mode-toggle tab-strip integrity (the first script's locators timed out).
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
function note(s) { const l = `[adv34-gi] ${s}`; console.log(l); lines.push(l); }
function finding(t, sev, d) { findings.push({ title: t, severity: sev, detail: d }); note(`FINDING (${sev}): ${t} :: ${JSON.stringify(d)}`); }

const COMPOSITE = '.tab[data-tab-id="tf-multi-workspace"]';
const TOGGLE = '[data-toolbar-multi-mode]:visible';

async function snap(win, label) {
  const s = await win.evaluate(() => {
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
    const tabs = Array.from(document.querySelectorAll('.tab[data-tab-id]')).map((t) => ({
      id: t.getAttribute('data-tab-id'),
      label: txt(t.querySelector('.tab-title')),
      sel: t.getAttribute('aria-selected'),
      dot: !!t.querySelector('.tab-modified-dot:not(.tab-modified-dot-hidden)'),
      close: !!t.querySelector('.tab-close'),
    }));
    const d = window.tflexDiagnostics ? window.tflexDiagnostics() : null;
    return {
      tabs,
      panes: Array.from(document.querySelectorAll('.tab-pane[data-pane]')).map((p) => ({
        pane: p.getAttribute('data-pane'),
        empty: p.hasAttribute('data-pane-empty'),
        header: txt(p.querySelector('[data-pane-header]')),
      })),
      multi: document.querySelector('.tab-stage')?.getAttribute('data-multi-mode') ?? null,
      activeTabId: d ? d.activeTabId : null,
      openTabs: d ? d.openTabs : null,
      welcome: !!document.querySelector('.sample-card'),
    };
  });
  note(`${label}: ${JSON.stringify(s)}`);
  return s;
}
async function toggle(win) {
  await win.locator(TOGGLE).first().click();
  await win.waitForTimeout(700);
}

async function withApp(name, fn) {
  let app = null, win = null;
  try {
    app = await launchApp();
    win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(300);
    note(`=== CASE ${name} ===`);
    await fn(app, win);
  } catch (e) {
    note(`CASE ${name} THREW: ${e.message}`);
  } finally {
    if (app) await hardClose(app, `p34-${name}`).catch(() => {});
  }
}

async function openPath(app, win, p, label) {
  await C.openFile(app, win, p);
  await win.waitForTimeout(900);
  const n = await win.locator('.tab[data-tab-id]').count();
  note(`opened ${label}: tabs=${n}`);
}

(async () => {
  // ---- Extra background tab after composite close ----
  await withApp('G2-extra', async (app, win) => {
    const alpha = C.tmpCopy(C.REPORT, 'adv34-g2-alpha.pdf');
    const beta = C.tmpCopy(C.LONG, 'adv34-g2-beta.pdf');
    const gamma = C.tmpCopy(C.REPORT, 'adv34-g2-gamma.pdf');
    await openPath(app, win, alpha, 'alpha');
    await openPath(app, win, beta, 'beta');
    await openPath(app, win, gamma, 'gamma');
    // activate alpha, enable multi, put beta in B
    await win.locator('.tab[data-tab-id]').filter({ hasText: 'adv34-g2-alpha' }).first().click();
    await win.waitForTimeout(300);
    await toggle(win);
    await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'adv34-g2-beta' }).first().click();
    await win.waitForTimeout(1600);
    await snap(win, 'G2 multi on, panes A=alpha B=beta, gamma background');
    // make alpha dirty so there is a prompt
    await C.focusPaneByPage(win, 'A');
    await win.locator('[data-shared-toolbar] [data-toolbar-rotate-cw]').first().click();
    await win.waitForTimeout(1300);
    await win.locator(`${COMPOSITE} .tab-close`).click();
    await win.waitForSelector('[data-close-tab-prompt]', { timeout: 12000 });
    await win.locator('[data-close-prompt-action="discard"]').click();
    await win.waitForTimeout(2000);
    const s = await snap(win, 'G2 after composite close with gamma background');
    if (s.multi !== 'false') finding('G2 composite close did not leave Multi Mode with a background tab', 'MEDIUM', s);
    if (s.tabs.length !== 1) finding(`G2 expected exactly the gamma tab to remain, got ${s.tabs.length}`, 'HIGH', s);
    if (s.tabs.some((t) => t.sel === 'true') === false && s.tabs.length > 0) finding('G2 no remaining tab is active after composite close', 'MEDIUM', s);
    if (s.tabs.length === 1 && !s.tabs[0].label.includes('adv34-g2-gamma')) finding('G2 the wrong tab remained after composite close', 'HIGH', s);
  });

  // ---- Repeated mode toggles, tab-strip integrity ----
  await withApp('I2-toggles', async (app, win) => {
    const alpha = C.tmpCopy(C.REPORT, 'adv34-i2-alpha.pdf');
    const beta = C.tmpCopy(C.LONG, 'adv34-i2-beta.pdf');
    await openPath(app, win, alpha, 'alpha');
    await openPath(app, win, beta, 'beta');
    await win.locator('.tab[data-tab-id]').filter({ hasText: 'adv34-i2-alpha' }).first().click();
    await win.waitForTimeout(300);
    await toggle(win);
    await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'adv34-i2-beta' }).first().click();
    await win.waitForTimeout(1600);
    for (let i = 0; i < 5; i += 1) {
      const s = await snap(win, `I2 state #${i}`);
      const multi = s.multi === 'true';
      const expected = multi ? 1 : 2;
      if (s.tabs.length !== expected) finding(`Tab count ${s.tabs.length} != ${expected} (multi=${multi}) #${i}`, 'HIGH', s);
      if (multi && s.tabs[0].id !== 'tf-multi-workspace') finding(`Multi strip tab is not composite #${i}`, 'HIGH', s);
      if (multi && s.tabs[0].sel !== 'true') finding(`Composite tab not active #${i}`, 'MEDIUM', s);
      if (!multi && s.tabs.filter((t) => t.sel === 'true').length !== 1) finding(`Single strip active-tab count != 1 #${i}`, 'MEDIUM', s);
      if (!multi && s.tabs.some((t) => !t.close)) finding(`Single strip tab missing close button #${i}`, 'MEDIUM', s);
      // every tab must be activatable: click each and confirm aria-selected moves
      if (!multi) {
        for (const t of s.tabs) {
          await win.locator(`.tab[data-tab-id="${t.id}"] .tab-title`).click();
          await win.waitForTimeout(250);
          const sel = await win.locator(`.tab[data-tab-id="${t.id}"]`).getAttribute('aria-selected');
          if (sel !== 'true') finding(`Tab ${t.label} cannot be activated (sel=${sel}) #${i}`, 'MEDIUM', { t, i });
        }
      }
      await toggle(win);
    }
    await snap(win, 'I2 final');
  });

  fs.writeFileSync(path.join(OUT, 'gi.log'), lines.join('\n') + '\n', 'utf8');
  note(`TOTAL FINDINGS: ${findings.length}`);
  console.log(`\n=== SUMMARY ===\n${JSON.stringify(findings, null, 2)}`);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exitCode = 2; });