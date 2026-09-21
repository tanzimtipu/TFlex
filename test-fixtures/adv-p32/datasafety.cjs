// ADV P32 data safety: modify both panes, window-close gate, cancel,
// per-tab prompt for a modified pane doc, save one pane keeps the other's
// modified flag.
const H = require('./harness.cjs');

async function toasts(win) { return win.locator('.toast-text').allInnerTexts().catch(() => []); }
function tabByText(win, text) { return win.locator('.tab[data-tab-id]').filter({ hasText: text }).first(); }
function promptBody(win) { return win.locator('[data-close-tab-prompt] .modal-help strong').first().innerText().catch(() => null); }
async function promptOpen(win) { return (await win.locator('[data-close-tab-prompt]').count()) > 0; }

async function modifyFocused(win, pane) {
  await H.setFocused(win, pane);
  await win.locator(`.tab-pane[data-pane="${pane}"] [data-toolbar-rotate-cw]`).first().click().catch((e) => console.log('rotate err', e.message));
  await win.waitForTimeout(1000);
}

async function requestWindowClose(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((w) => { try { w.close(); } catch (_) {} });
  });
}

async function ds1_closeGateBothPanes() {
  console.log('\n===== DS1: modify BOTH panes, window close gate =====');
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    await modifyFocused(win, 'A');
    await modifyFocused(win, 'B');
    const aId = await H.docIdOfPane(win, 'A');
    const bId = await H.docIdOfPane(win, 'B');
    const a0 = await H.engineStateOf(win, aId);
    const b0 = await H.engineStateOf(win, bId);
    console.log('modified before close: A=', a0.modified, 'B=', b0.modified);

    await requestWindowClose(app);
    await win.waitForTimeout(1200);
    console.log('prompt open after close request=', await promptOpen(win));
    console.log('first prompt doc=', await promptBody(win));
    await H.shot(win, 'adv-p32-closegate-prompt1.png');

    // Cancel must ABORT the whole window close.
    await win.locator('[data-close-prompt-action="cancel"]').click().catch((e) => console.log('cancel err', e.message));
    await win.waitForTimeout(1200);
    console.log('after Cancel: prompt open=', await promptOpen(win), 'window alive=', (await app.windows().length) > 0);
    const a1 = await H.engineStateOf(win, aId);
    const b1 = await H.engineStateOf(win, bId);
    console.log('modified after Cancel: A=', a1.modified, 'B=', b1.modified, 'tabs=', await H.tabCount(win));

    // Second close: discard both in sequence.
    await requestWindowClose(app);
    await win.waitForTimeout(1200);
    console.log('second close prompt doc=', await promptBody(win));
    await win.locator('[data-close-prompt-action="discard"]').click().catch((e) => console.log('discard1 err', e.message));
    await win.waitForTimeout(1500);
    const second = await promptBody(win);
    console.log('second prompt in queue doc=', second, 'open=', await promptOpen(win));
    await H.shot(win, 'adv-p32-closegate-prompt2.png');
    if (await promptOpen(win)) {
      await win.locator('[data-close-prompt-action="discard"]').click().catch((e) => console.log('discard2 err', e.message));
    }
    // The window is expected to close here; use a node timer, not page API.
    await new Promise((r) => setTimeout(r, 3000));
    let alive = 'unknown';
    try { alive = (await app.windows().length) > 0; } catch (e) { alive = 'app handle gone: ' + e.message; }
    console.log('after discarding both: window alive=', alive);
  } finally { await H.close(app, 'adv-p32-ds1'); }
}

async function ds2_closeModifiedPaneTab() {
  console.log('\n===== DS2: close the tab of a MODIFIED pane document =====');
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    await modifyFocused(win, 'B');
    const bId = await H.docIdOfPane(win, 'B');
    console.log('B modified=', (await H.engineStateOf(win, bId)).modified);
    // close B's tab
    await tabByText(win, 'p32-beta').locator('.tab-close').click();
    await win.waitForTimeout(1000);
    console.log('prompt open=', await promptOpen(win), 'doc=', await promptBody(win));
    await H.shot(win, 'adv-p32-closegate-tab.png');
    // Cancel -> tab stays
    await win.locator('[data-close-prompt-action="cancel"]').click();
    await win.waitForTimeout(900);
    console.log('after cancel: tabs=', await H.tabCount(win), 'B header=', await win.locator('.tab-pane[data-pane="B"] [data-pane-header]').count());
    // Re-close and discard -> tab closes, pane B empties cleanly
    await tabByText(win, 'p32-beta').locator('.tab-close').click();
    await win.waitForTimeout(900);
    await win.locator('[data-close-prompt-action="discard"]').click();
    await win.waitForTimeout(1200);
    console.log('after discard: tabs=', await H.tabCount(win), 'B empty=', await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count(),
      'B stale header=', await win.locator('.tab-pane[data-pane="B"] [data-pane-header]').count());
    console.log('toasts=', JSON.stringify(await toasts(win)));
  } finally { await H.close(app, 'adv-p32-ds2'); }
}

async function ds3_saveFocusedKeepsOther() {
  console.log('\n===== DS3: save focused pane; other pane modified flag survives =====');
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    await modifyFocused(win, 'A');
    await modifyFocused(win, 'B');
    const aId = await H.docIdOfPane(win, 'A');
    const bId = await H.docIdOfPane(win, 'B');
    console.log('before save: A modified=', (await H.engineStateOf(win, aId)).modified, 'B modified=', (await H.engineStateOf(win, bId)).modified);
    await H.setFocused(win, 'A');
    await win.keyboard.press('Control+s');
    await win.waitForTimeout(2000);
    const a1 = await H.engineStateOf(win, aId);
    const b1 = await H.engineStateOf(win, bId);
    console.log('after Ctrl+S on A: A modified=', a1.modified, 'B modified=', b1.modified, 'tabs=', await H.tabCount(win));
    console.log('toasts=', JSON.stringify(await toasts(win)));
    // Now close window: only B should prompt.
    await requestWindowClose(app);
    await win.waitForTimeout(1200);
    console.log('prompt open=', await promptOpen(win), 'doc=', await promptBody(win));
    if (await promptOpen(win)) await win.locator('[data-close-prompt-action="cancel"]').click();
    await win.waitForTimeout(800);
  } finally { await H.close(app, 'adv-p32-ds3'); }
}

H.run(async () => {
  for (const [name, fn] of [['DS1', ds1_closeGateBothPanes], ['DS2', ds2_closeModifiedPaneTab], ['DS3', ds3_saveFocusedKeepsOther]]) {
    try { await fn(); } catch (e) { console.log(`${name} ERROR`, e && e.message); }
  }
});