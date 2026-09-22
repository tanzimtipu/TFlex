// ADV phase-34: the composite tab's close path (8 cases) + tab-strip
// integrity across mode toggles. Real dev build through launchApp.
// Writes JSON lines to stdout and a summary to the log file.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p34');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'composite_close.log');
const findings = [];
const lines = [];
function note(s) {
  const line = `[adv34-close] ${s}`;
  console.log(line);
  lines.push(line);
}
function finding(title, severity, detail) {
  findings.push({ title, severity, detail });
  note(`FINDING (${severity}): ${title} :: ${JSON.stringify(detail)}`);
}

const COMPOSITE = '.tab[data-tab-id="tf-multi-workspace"]';

async function snap(win, label) {
  const s = await win.evaluate(() => {
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
    const tabs = Array.from(document.querySelectorAll('.tab[data-tab-id]')).map((t) => ({
      id: t.getAttribute('data-tab-id'),
      label: txt(t.querySelector('.tab-title')),
      sel: t.getAttribute('aria-selected'),
      dot: !!t.querySelector('.tab-modified-dot:not(.tab-modified-dot-hidden)'),
      hasClose: !!t.querySelector('.tab-close'),
    }));
    const panes = Array.from(document.querySelectorAll('.tab-pane[data-pane]')).map((p) => ({
      pane: p.getAttribute('data-pane'),
      empty: p.hasAttribute('data-pane-empty'),
      header: txt(p.querySelector('[data-pane-header]')),
    }));
    const dash = window.tflexDiagnostics ? window.tflexDiagnostics() : null;
    return {
      tabs,
      panes,
      multi: document.querySelector('.tab-stage')?.getAttribute('data-multi-mode') ?? null,
      promptOpen: !!document.querySelector('[data-close-tab-prompt]'),
      diagOpenTabs: dash ? dash.openTabs : null,
      activeTabId: dash ? dash.activeTabId : null,
      welcome: !!document.querySelector('.sample-card'),
      plusTab: !!document.querySelector('[data-new-tab]'),
    };
  });
  note(`${label}: ${JSON.stringify(s)}`);
  return s;
}

async function mtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return null; }
}
async function size(p) {
  try { return fs.statSync(p).size; } catch { return null; }
}

async function openTwo(app, win, tag) {
  const alpha = C.tmpCopy(C.REPORT, `adv34-${tag}-alpha.pdf`);
  const beta = C.tmpCopy(C.LONG, `adv34-${tag}-beta.pdf`);
  await C.openFile(app, win, alpha);
  await win.waitForTimeout(700);
  await C.openFile(app, win, beta);
  await win.waitForTimeout(700);
  await win.locator('.tab[data-tab-id]').filter({ hasText: `adv34-${tag}-alpha` }).first().click();
  await win.waitForTimeout(300);
  await win.locator('[data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(500);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: `adv34-${tag}-beta` }).first().click();
  await win.waitForTimeout(1500);
  return { alpha, beta };
}

async function dirty(win, pane) {
  await C.focusPaneByPage(win, pane);
  await win.locator('[data-shared-toolbar] [data-toolbar-rotate-cw]').first().click();
  await win.waitForTimeout(1200);
}
async function waitPrompt(win) {
  await win.waitForSelector('[data-close-tab-prompt]', { timeout: 12000 });
  return (await win.locator('#close-tab-prompt-body').innerText()).replace(/\s+/g, ' ');
}
async function choose(win, action) {
  await win.locator(`[data-close-prompt-action="${action}"]`).click();
  await win.waitForTimeout(500);
}
async function closeComposite(win) {
  await win.locator(`${COMPOSITE} .tab-close`).click();
  await win.waitForTimeout(400);
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
    note(`CASE ${name} THREW: ${e.stack || e.message}`);
  } finally {
    if (app) await hardClose(app, `p34-${name}`).catch(() => {});
  }
}

(async () => {
  // ---- Case A: both clean ----
  await withApp('A-both-clean', async (app, win) => {
    await openTwo(app, win, 'ca');
    await snap(win, 'A before close');
    await closeComposite(win);
    await win.waitForTimeout(1500);
    const s = await snap(win, 'A after close');
    if (s.tabs.length !== 0 || s.panes.length !== 0 || s.multi !== 'false' || !s.welcome) {
      finding('Both-clean composite close did not leave a clean welcome state', 'MEDIUM', s);
    }
  });

  // ---- Case B: A dirty only ----
  await withApp('B-A-dirty', async (app, win) => {
    await openTwo(app, win, 'cb');
    await dirty(win, 'A');
    await closeComposite(win);
    const body = await waitPrompt(win);
    note(`B prompt: "${body}"`);
    if (!body.includes('ca-alpha')) finding('A-only dirty close prompted for the wrong document', 'HIGH', { body });
    await choose(win, 'discard');
    await win.waitForTimeout(1500);
    const s = await snap(win, 'B after discard');
    if (s.tabs.length !== 0 || s.multi !== 'false') finding('A-only dirty close did not close both/leave mode', 'MEDIUM', s);
  });

  // ---- Case C: B dirty only ----
  await withApp('C-B-dirty', async (app, win) => {
    await openTwo(app, win, 'cc');
    await dirty(win, 'B');
    await closeComposite(win);
    const body = await waitPrompt(win);
    note(`C prompt: "${body}"`);
    if (!body.includes('cc-beta')) finding('B-only dirty close prompted for the wrong document', 'HIGH', { body });
    await choose(win, 'discard');
    await win.waitForTimeout(1500);
    const s = await snap(win, 'C after discard');
    if (s.tabs.length !== 0 || s.multi !== 'false') finding('B-only dirty close did not close both/leave mode', 'MEDIUM', s);
  });

  // ---- Case D: both dirty, Save on one, Don't-save on other ----
  await withApp('D-save-one', async (app, win) => {
    const { alpha } = await openTwo(app, win, 'cd');
    await dirty(win, 'A');
    await dirty(win, 'B');
    const before = await mtime(alpha);
    await closeComposite(win);
    const b1 = await waitPrompt(win);
    note(`D prompt1: "${b1}"`);
    await choose(win, 'save');
    await win.waitForTimeout(1800);
    const b2 = await waitPrompt(win);
    note(`D prompt2: "${b2}"`);
    await choose(win, 'discard');
    await win.waitForTimeout(1800);
    const s = await snap(win, 'D after close');
    const after = await mtime(alpha);
    note(`D alpha mtime ${before} -> ${after} (saved=${after !== before})`);
    if (before === after) finding('Save on first prompt of a composite close did NOT write the file', 'HIGH', { alpha, before, after });
    if (s.tabs.length !== 0 || s.multi !== 'false') finding('D close did not finish', 'MEDIUM', s);
  });

  // ---- Case E: both dirty, Cancel on the SECOND prompt ----
  await withApp('E-cancel-second', async (app, win) => {
    await openTwo(app, win, 'ce');
    await dirty(win, 'A');
    await dirty(win, 'B');
    await closeComposite(win);
    const b1 = await waitPrompt(win);
    note(`E prompt1: "${b1}"`);
    await choose(win, 'discard');
    await win.waitForTimeout(500);
    const b2 = await waitPrompt(win);
    note(`E prompt2: "${b2}"`);
    await choose(win, 'cancel');
    await win.waitForTimeout(1000);
    const s = await snap(win, 'E after cancel-second');
    if (s.tabs.length !== 1 || s.tabs[0].id !== 'tf-multi-workspace') finding('Cancel on second prompt did not leave one composite tab', 'HIGH', s);
    if (s.multi !== 'true') finding('Cancel on second prompt left Multi Mode', 'HIGH', s);
    const a = await win.evaluate(() => document.querySelector('.multi-pane-header[data-pane="A"]')?.textContent || '');
    const b = await win.evaluate(() => document.querySelector('.multi-pane-header[data-pane="B"]')?.textContent || '');
    note(`E paneA header="${a.replace(/\s+/g, ' ').trim()}" paneB header="${b.replace(/\s+/g, ' ').trim()}"`);
    if (!a.includes('34') || !b.includes('520')) finding('Cancel on second prompt lost a pane document', 'HIGH', { a, b, s });
  });

  // ---- Case F: both dirty, Save each; verify disk content ----
  await withApp('F-save-both', async (app, win) => {
    const { alpha, beta } = await openTwo(app, win, 'cf');
    await dirty(win, 'A');
    await dirty(win, 'B');
    const ab = await mtime(alpha), bb = await mtime(beta);
    await closeComposite(win);
    await waitPrompt(win);
    await choose(win, 'save');
    await win.waitForTimeout(2000);
    await waitPrompt(win);
    await choose(win, 'save');
    await win.waitForTimeout(2500);
    const s = await snap(win, 'F after both saves');
    const aa = await mtime(alpha), ba = await mtime(beta);
    note(`F alpha mtime ${ab}->${aa}; beta mtime ${bb}->${ba}`);
    if (ab === aa) finding('F: save on first dirty doc did not write alpha', 'HIGH', { alpha });
    if (bb === ba) finding('F: save on second dirty doc did not write beta', 'HIGH', { beta });
    if (s.tabs.length !== 0 || s.multi !== 'false') finding('F close did not finish', 'MEDIUM', s);

    // Reopen alpha and verify the rotation was persisted.
    if (s.tabs.length === 0 && s.welcome) {
      await C.openFile(app, win, alpha);
      await win.waitForTimeout(2500);
      const rot = await win.evaluate(() => {
        const d = window.tflexDiagnostics();
        return d.engineState ? d.engineState.rotations?.[0] : null;
      });
      note(`F reopened alpha rotations[0]=${rot} (expect 1)`);
      if (rot !== 1) finding('F: saved alpha did not persist the rotation', 'HIGH', { rot });
    }
  });

  // ---- Case G: extra background tab open ----
  await withApp('G-extra-tab', async (app, win) => {
    const { alpha } = await openTwo(app, win, 'cg');
    // open a third document -> with mode on it should land in the focused pane
    const gammaPath = C.tmpCopy(C.REPORT, 'adv34-cg-gamma.pdf');
    await C.openFile(app, win, gammaPath);
    await win.waitForTimeout(1800);
    let s = await snap(win, 'G after opening gamma (mode on)');
    // Now produce an actually-extra tab: open while mode off
    await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode]').first().click();
    await win.waitForTimeout(700);
    const deltaPath = C.tmpCopy(C.REPORT, 'adv34-cg-delta.pdf');
    await C.openFile(app, win, deltaPath);
    await win.waitForTimeout(1500);
    s = await snap(win, 'G single after delta open');
    // Re-enable multi mode (seeds focused active doc into pane A)
    await win.locator('[data-toolbar-multi-mode]').first().click();
    await win.waitForTimeout(600);
    await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'adv34-cg-beta' }).first().click().catch(() => {});
    await win.waitForTimeout(1400);
    s = await snap(win, 'G mode re-enabled');
    await closeComposite(win);
    await win.waitForTimeout(1800);
    s = await snap(win, 'G after composite close with extra tabs');
    if (s.multi !== 'false') finding('G composite close did not leave Multi Mode with extra tabs', 'MEDIUM', s);
    if (s.tabs.length === 0) finding('G composite close closed a background tab too', 'HIGH', s);
    else if (s.tabs.every((t) => t.sel !== 'true')) finding('G no remaining tab is active after composite close', 'MEDIUM', s);
    note(`G alpha path=${alpha}`);
  });

  // ---- Case H: close prompt interrupted by a mode toggle attempt ----
  await withApp('H-toggle-during-prompt', async (app, win) => {
    await openTwo(app, win, 'ch');
    await dirty(win, 'A');
    await dirty(win, 'B');
    await closeComposite(win);
    await waitPrompt(win);
    // try to toggle multi mode while the modal prompt is open
    const clickable = await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode]').first()
      .click({ timeout: 2500 }).then(() => true).catch(() => false);
    await win.waitForTimeout(700);
    const s = await snap(win, 'H after toggle attempt during prompt');
    note(`H toggle clickable while prompt open = ${clickable}`);
    if (!clickable) note('H: mode toggle is not reachable while the close prompt is open (modal blocks it) - interruption path unreachable by pointer');
    // finish via discard
    if (s.promptOpen) {
      await choose(win, 'discard');
      await win.waitForTimeout(500);
      const s2 = await snap(win, 'H after discard 1');
      if (s2.promptOpen) await choose(win, 'discard');
      await win.waitForTimeout(1500);
      await snap(win, 'H final');
    }
  });

  // ---- Tab-strip integrity: repeated toggles ----
  await withApp('I-toggle-integrity', async (app, win) => {
    await openTwo(app, win, 'ci');
    for (let i = 0; i < 6; i += 1) {
      const s = await snap(win, `I toggle on #${i}`);
      const multi = s.multi === 'true';
      const expected = multi ? 1 : 2;
      if (s.tabs.length !== expected) finding(`Tab count ${s.tabs.length} != ${expected} (multi=${multi}) on toggle #${i}`, 'HIGH', s);
      if (multi && s.tabs[0].id !== 'tf-multi-workspace') finding(`Multi strip tab is not the composite (toggle #${i})`, 'HIGH', s);
      if (multi && s.tabs[0].sel !== 'true') finding(`Composite tab not active (toggle #${i})`, 'MEDIUM', s);
      if (!multi && s.tabs.filter((t) => t.sel === 'true').length !== 1) finding(`Single strip does not have exactly one active tab (toggle #${i})`, 'MEDIUM', s);
      if (!multi && s.tabs.some((t) => !t.label || /tf-multi-workspace/.test(t.id) === false && !t.label)) finding(`Single strip has a blank tab (toggle #${i})`, 'MEDIUM', s);
      await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode], [data-toolbar-multi-mode]').first().click();
      await win.waitForTimeout(600);
    }
    await snap(win, 'I after 6 toggles');
  });

  // ---- Tab-strip: "+ tab" while mode on (no-op probe) ----
  await withApp('J-plus-tab-while-multi', async (app, win) => {
    await openTwo(app, win, 'cj');
    const before = await snap(win, 'J before plus');
    await win.locator('[data-new-tab]').click();
    await win.waitForTimeout(800);
    const after = await snap(win, 'J after plus');
    note(`J tabs before=${before.tabs.length} after=${after.tabs.length}; diagOpenTabs ${before.diagOpenTabs}->${after.diagOpenTabs}`);
    if (after.tabs.length === before.tabs.length && after.diagOpenTabs !== before.diagOpenTabs) {
      finding('"+ tab" in Multi Mode is a silent no-op in the strip but mutates hidden tab state', 'MEDIUM', { before, after });
    }
    // leaving the mode reveals the hidden empty tab
    await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode]').first().click();
    await win.waitForTimeout(700);
    const off = await snap(win, 'J mode off');
    note(`J after mode off: tabs=${off.tabs.length} labels=${JSON.stringify(off.tabs.map((t) => t.label))}`);
    if (off.tabs.length !== before.tabs.length) {
      finding('"+ tab" in Multi Mode created a hidden tab that appears after leaving the mode', 'MEDIUM', { off });
    }
  });

  // ---- Tab-strip: close last remaining doc while mode on, empty panes ----
  await withApp('K-empty-composite-close', async (app, win) => {
    await openTwo(app, win, 'ck');
    // clear both panes (tabs stay open, panes empty)
    await win.locator('.tab-pane[data-pane="B"] [data-pane-clear]').click();
    await win.waitForTimeout(500);
    await win.locator('.tab-pane[data-pane="A"] [data-pane-clear]').click();
    await win.waitForTimeout(500);
    const s0 = await snap(win, 'K both panes empty');
    const closeBtn = win.locator(`${COMPOSITE} .tab-close`);
    const exists = await closeBtn.count();
    let clicked = false;
    if (exists > 0) {
      await closeBtn.click();
      await win.waitForTimeout(800);
      clicked = true;
    }
    const s1 = await snap(win, 'K after clicking composite X with empty panes');
    note(`K composite close button exists=${exists} clicked=${clicked}; no visible effect? tabs ${s0.tabs.length}->${s1.tabs.length}, multi ${s0.multi}->${s1.multi}`);
    if (exists > 0 && s1.tabs.length === s0.tabs.length && s1.multi === s0.multi) {
      finding('Composite tab X silently no-ops when both panes are empty', 'LOW', { s0, s1 });
    }
  });

  // ---- Composite tab click / strip gestures while mode on ----
  await withApp('L-strip-gestures', async (app, win) => {
    await openTwo(app, win, 'cl');
    const before = await snap(win, 'L before click composite');
    await win.locator(`${COMPOSITE} .tab-title`).click();
    await win.waitForTimeout(500);
    const after = await snap(win, 'L after click composite');
    if (JSON.stringify(before.panes) !== JSON.stringify(after.panes) || JSON.stringify(before.tabs) !== JSON.stringify(after.tabs)) {
      finding('Clicking the composite tab changed state unexpectedly', 'LOW', { before, after });
    }
    // focus pane B then click composite; which pane document becomes single-active?
    await C.focusPaneByPage(win, 'B');
    await win.locator(`${COMPOSITE} .tab-title`).click();
    await win.waitForTimeout(300);
    const focused = await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused');
    note(`L after focusing B and clicking composite: paneB focused=${focused}`);
  });

  note(`TOTAL FINDINGS: ${findings.length}`);
  fs.writeFileSync(LOG, lines.join('\n') + '\n', 'utf8');
  console.log(`\n=== SUMMARY ===\n${JSON.stringify(findings, null, 2)}`);
  console.log(`log: ${LOG}`);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exitCode = 2;
});