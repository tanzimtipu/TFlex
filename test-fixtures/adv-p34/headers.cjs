// ADV phase-34: divider-flanking headers at the extremes, long names, empty
// pane, and the header clear affordance. Real dev build via launchApp.
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
function note(s) { const l = `[adv34-hdr] ${s}`; console.log(l); lines.push(l); }
function finding(t, sev, d) { findings.push({ title: t, severity: sev, detail: d }); note(`FINDING (${sev}): ${t} :: ${JSON.stringify(d)}`); }

async function headerInfo(win) {
  return win.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
    const div = document.querySelector('[data-multi-divider]');
    const out = { divider: r(div), vw: window.innerWidth };
    for (const p of ['A', 'B']) {
      const h = document.querySelector(`.multi-pane-header[data-pane="${p}"]`);
      out[p] = {
        header: r(h),
        badge: r(h ? h.querySelector('.multi-pane-badge') : null),
        title: r(h ? h.querySelector('.multi-pane-title') : null),
        count: r(h ? h.querySelector('.multi-pane-count') : null),
        clear: r(h ? h.querySelector('[data-pane-clear]') : null),
        titleText: h ? (h.querySelector('.multi-pane-title') || {}).textContent : null,
        empty: !!document.querySelector(`.tab-pane[data-pane="${p}"][data-pane-empty]`),
      };
    }
    return out;
  });
}
async function dragDividerTo(win, frac) {
  const box = await win.locator('[data-multi-divider]').boundingBox();
  const stage = await win.locator('.tab-stage').boundingBox();
  if (!box || !stage) return;
  const targetX = stage.x + stage.width * frac;
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(targetX, box.y + box.height / 2, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(400);
}
async function setup(app, win, tag, nameA, nameB) {
  const alpha = C.tmpCopy(C.REPORT, nameA || `adv34-${tag}-alpha.pdf`);
  const beta = C.tmpCopy(C.LONG, nameB || `adv34-${tag}-beta.pdf`);
  await C.openFile(app, win, alpha); await win.waitForTimeout(700);
  await C.openFile(app, win, beta); await win.waitForTimeout(700);
  await win.locator('.tab[data-tab-id]').filter({ hasText: nameA || `adv34-${tag}-alpha` }).first().click();
  await win.waitForTimeout(300);
  await win.locator('[data-toolbar-multi-mode]:visible').first().click();
  await win.waitForTimeout(500);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: nameB || `adv34-${tag}-beta` }).first().click();
  await win.waitForTimeout(1600);
  return { alpha, beta };
}
async function withApp(name, fn) {
  let app = null, win = null;
  try {
    app = await launchApp();
    win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(300);
    note(`=== ${name} ===`);
    await fn(app, win);
  } catch (e) { note(`${name} THREW: ${e.message}`); }
  finally { if (app) await hardClose(app, `p34-${name}`).catch(() => {}); }
}

function checkFlanking(info, label) {
  const { A, B, divider } = info;
  const problems = [];
  if (A.title && divider) {
    if (A.count && A.count.right > divider.left + 1) problems.push(`A count right ${A.count.right} > divider left ${divider.left}`);
    if (A.title.right > divider.left + 1) problems.push(`A title right ${A.title.right} > divider left ${divider.left}`);
    if (A.clear && A.badge && A.clear.left > A.badge.left) problems.push(`A clear is not on the outer side (clear.left ${A.clear.left} > badge.left ${A.badge.left})`);
  }
  if (B.title && divider) {
    if (B.badge && B.badge.left < divider.right - 1) problems.push(`B badge left ${B.badge.left} < divider right ${divider.right}`);
    if (B.title.left < divider.right - 1) problems.push(`B title left ${B.title.left} < divider right ${divider.right}`);
    if (B.clear && B.count && B.clear.right < B.count.right - 1) problems.push(`B clear is not on the outer side`);
  }
  if (problems.length > 0) finding(`Headers not flanking the divider (${label})`, 'MEDIUM', { problems, info });
  else note(`flanking OK (${label})`);
}

(async () => {
  await withApp('H1-default-long', async (app, win) => {
    const longA = 'adv34-h1-' + 'A'.repeat(90) + '-left.pdf';
    const longB = 'adv34-h1-' + 'B'.repeat(90) + '-right.pdf';
    await setup(app, win, 'h1', longA, longB);
    let info = await headerInfo(win);
    note(`default split: ${JSON.stringify(info)}`);
    checkFlanking(info, 'default, long names');
    await win.screenshot({ path: path.join(C.SHOTS, 'adv-p34-headers-long.png') });
  });

  await withApp('H2-extremes', async (app, win) => {
    await setup(app, win, 'h2');
    await dragDividerTo(win, 0.25);
    let info = await headerInfo(win);
    note(`A-min split: ${JSON.stringify(info)}`);
    checkFlanking(info, 'A near min');
    // clear A clickable?
    const ca = await win.locator('.tab-pane[data-pane="A"] [data-pane-clear]').first().click({ trial: true, timeout: 2000 }).then(() => true).catch(() => false);
    note(`A-min clear A trialClickable=${ca}`);
    if (!ca) finding('Pane A clear not clickable at the near-min split', 'MEDIUM', { info });
    await win.screenshot({ path: path.join(C.SHOTS, 'adv-p34-headers-Amin.png') });

    await dragDividerTo(win, 0.75);
    info = await headerInfo(win);
    note(`B-min split: ${JSON.stringify(info)}`);
    checkFlanking(info, 'B near min');
    const cb = await win.locator('.tab-pane[data-pane="B"] [data-pane-clear]').first().click({ trial: true, timeout: 2000 }).then(() => true).catch(() => false);
    note(`B-min clear B trialClickable=${cb}`);
    if (!cb) finding('Pane B clear not clickable at the near-min split', 'MEDIUM', { info });
    await win.screenshot({ path: path.join(C.SHOTS, 'adv-p34-headers-Bmin.png') });
  });

  await withApp('H3-empty-pane', async (app, win) => {
    const alpha = C.tmpCopy(C.REPORT, 'adv34-h3-alpha.pdf');
    const beta = C.tmpCopy(C.LONG, 'adv34-h3-beta.pdf');
    await C.openFile(app, win, alpha); await win.waitForTimeout(700);
    await C.openFile(app, win, beta); await win.waitForTimeout(700);
    await win.locator('.tab[data-tab-id]').filter({ hasText: 'adv34-h3-alpha' }).first().click();
    await win.waitForTimeout(300);
    await win.locator('[data-toolbar-multi-mode]:visible').first().click();
    await win.waitForTimeout(700);
    // leave pane B empty
    const info = await headerInfo(win);
    note(`empty B: ${JSON.stringify(info)}`);
    const clearCount = await win.locator('.tab-pane[data-pane="B"] [data-pane-clear]').count();
    note(`empty pane B has [data-pane-clear] count=${clearCount}`);
    if (clearCount !== 0) finding('Empty pane B still renders a clear button', 'LOW', { info });
    // header A should still flank the divider (divider sits at the pane boundary)
    checkFlanking(info, 'empty B');
    await win.screenshot({ path: path.join(C.SHOTS, 'adv-p34-empty-pane.png') });
  });

  await withApp('H4-replace-name', async (app, win) => {
    await setup(app, win, 'h4');
    let info = await headerInfo(win);
    const beforeA = info.A.titleText, beforeB = info.B.titleText;
    // replace pane A's document with a third file through its clear+pick? open into focused A
    const gamma = C.tmpCopy(C.REPORT, 'adv34-h4-gamma.pdf');
    await C.focusPaneByPage(win, 'A');
    await C.openFile(app, win, gamma);
    await win.waitForTimeout(2000);
    info = await headerInfo(win);
    note(`after replacing A: A="${info.A.titleText}" B="${info.B.titleText}"`);
    if (info.A.titleText === beforeA || info.A.titleText.indexOf('adv34-h4-gamma') === -1) {
      finding('Pane A header name did not update when its document was replaced', 'MEDIUM', { beforeA, info });
    }
    checkFlanking(info, 'after replace');
  });

  fs.writeFileSync(path.join(OUT, 'headers.log'), lines.join('\n') + '\n', 'utf8');
  note(`TOTAL FINDINGS: ${findings.length}`);
  console.log(`\n=== SUMMARY ===\n${JSON.stringify(findings, null, 2)}`);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exitCode = 2; });