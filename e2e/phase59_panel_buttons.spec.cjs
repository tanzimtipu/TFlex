// Phase 59 (item 9) — panel button identity.
//
// The assigned behaviour: in the Context and Inspector panels, interactive
// buttons are visually distinct from body text (button surface/border/tone),
// and no button label ends with an ellipsis ("..." or the U+2026 character).
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let app = null;
let win = null;

test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p59-panelbtn');
  app = null;
  win = null;
});

async function openReport() {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1400);
}

// Every VISIBLE button inside `panelSelector`, with its visible text and the
// computed background/border that give it its identity.
async function collectButtons(panelSelector) {
  return win.evaluate((sel) => {
    const panel = document.querySelector(sel);
    if (panel === null) return null;
    const buttons = Array.from(panel.querySelectorAll('button'));
    return buttons
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
      })
      .map((b) => {
        const cs = getComputedStyle(b);
        return {
          cls: String(b.className),
          text: (b.textContent || '').replace(/\s+/g, ' ').trim(),
          background: cs.backgroundColor,
          borderTopWidth: cs.borderTopWidth,
          borderTopStyle: cs.borderTopStyle,
          borderTopColor: cs.borderTopColor,
          color: cs.color,
        };
      });
  }, panelSelector);
}

// The panel's body-text styling (a non-interactive value/paragraph).
async function bodyTextStyle(panelSelector) {
  return win.evaluate((sel) => {
    const panel = document.querySelector(sel);
    if (panel === null) return null;
    const el =
      panel.querySelector('.context-panel-row-value') ??
      panel.querySelector('.context-panel-empty') ??
      panel.querySelector('.inspector-row-value') ??
      panel.querySelector('.inspector-note');
    if (el === null) return null;
    const cs = getComputedStyle(el);
    return {
      background: cs.backgroundColor,
      borderTopWidth: cs.borderTopWidth,
      borderTopStyle: cs.borderTopStyle,
      color: cs.color,
    };
  }, panelSelector);
}

function endsWithEllipsis(text) {
  return text.endsWith('\u2026') || text.endsWith('...');
}

test('Context/Inspector buttons: no label ends with an ellipsis; buttons are visually distinct from body text', async () => {
  await openReport();

  const stages = [
    { n: 1, name: 'PAGES' },
    { n: 2, name: 'EDIT' },
    { n: 3, name: 'REVIEW' },
    { n: 4, name: 'DELIVER' },
  ];

  const allButtons = [];
  for (const stage of stages) {
    await gotoStage(win, stage.n);
    await win.waitForTimeout(500);
    const ctx = await collectButtons('[data-context-panel]');
    const insp = await collectButtons('[data-inspector]');
    console.log(`[P59-panelbtn] ${stage.name} context=${JSON.stringify(ctx)}`);
    console.log(`[P59-panelbtn] ${stage.name} inspector=${JSON.stringify(insp)}`);
    for (const b of ctx ?? []) allButtons.push({ panel: 'context', stage: stage.name, ...b });
    for (const b of insp ?? []) allButtons.push({ panel: 'inspector', stage: stage.name, ...b });
  }

  // 1. No visible button/label text ends with an ellipsis.
  const offenders = allButtons.filter((b) => b.text.length > 0 && endsWithEllipsis(b.text));
  console.log(`[P59-panelbtn] ellipsis offenders=${JSON.stringify(offenders)}`);
  expect(offenders, `button labels ending with an ellipsis: ${JSON.stringify(offenders.map((o) => `${o.panel}/${o.stage}:${o.text}`))}`).toEqual([]);

  // 2. Button identity: a representative action button's computed surface/border
  //    differs from the panel's body text.
  await gotoStage(win, 2); // EDIT — the ContextPanel's action buttons render here.
  await win.waitForTimeout(500);
  const ctxBody = await bodyTextStyle('[data-context-panel]');
  const ctxButtons = await collectButtons('[data-context-panel]');
  const ctxAction = (ctxButtons ?? []).find((b) => b.cls.includes('context-panel-action'));
  console.log(`[P59-panelbtn] context body=${JSON.stringify(ctxBody)} action=${JSON.stringify(ctxAction)}`);
  expect(ctxAction, 'the ContextPanel renders an action button in EDIT').toBeTruthy();
  expect(ctxBody, 'the ContextPanel body text is measurable').toBeTruthy();
  const ctxDistinct =
    ctxAction.background !== ctxBody.background ||
    parseFloat(ctxAction.borderTopWidth) > 0;
  expect(ctxDistinct, `ContextPanel button surface/border differs from body text (btn bg=${ctxAction.background} border=${ctxAction.borderTopWidth}; body bg=${ctxBody.background} border=${ctxBody.borderTopWidth})`).toBe(true);

  await gotoStage(win, 1); // PAGES — the Inspector's rename action renders here.
  await win.waitForTimeout(500);
  const inspBody = await bodyTextStyle('[data-inspector]');
  const inspButtons = await collectButtons('[data-inspector]');
  const inspAction = (inspButtons ?? []).find((b) => b.cls.includes('inspector-action'));
  console.log(`[P59-panelbtn] inspector body=${JSON.stringify(inspBody)} action=${JSON.stringify(inspAction)}`);
  expect(inspAction, 'the Inspector renders an action button in PAGES').toBeTruthy();
  expect(inspBody, 'the Inspector body text is measurable').toBeTruthy();
  const inspDistinct =
    inspAction.background !== inspBody.background ||
    parseFloat(inspAction.borderTopWidth) > 0;
  expect(inspDistinct, `Inspector button surface/border differs from body text (btn bg=${inspAction.background} border=${inspAction.borderTopWidth}; body bg=${inspBody.background} border=${inspBody.borderTopWidth})`).toBe(true);

  await win.screenshot({ path: path.join(SHOTS, 'p59-panel-buttons.png') });
});
