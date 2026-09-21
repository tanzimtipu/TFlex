// ADV P32 hostile sequences part 1: 0/1 tab, rapid toggle, rapid focus,
// divider extremes.
const H = require('./harness.cjs');

async function toasts(win) {
  return win.locator('.toast-text').allInnerTexts().catch(() => []);
}
async function multiAttr(win) {
  return win.locator('.tab-stage').getAttribute('data-multi-mode');
}
async function paneWidths(win) {
  return win.evaluate(() => {
    const g = (s) => {
      const el = document.querySelector(s);
      return el ? Math.round(el.getBoundingClientRect().width) : null;
    };
    return { A: g('.tab-pane[data-pane="A"]'), B: g('.tab-pane[data-pane="B"]'), div: g('[data-multi-divider]') };
  });
}

async function s1_zeroTab() {
  console.log('\n===== S1: multi mode with 0 tabs (welcome) =====');
  const { app, win } = await H.launch();
  try {
    console.log('welcome sample cards=', await win.locator('.sample-card').count());
    const btn = win.locator('[data-toolbar-multi-mode]').first();
    console.log('toolbar multi button count=', await win.locator('[data-toolbar-multi-mode]').count());
    if ((await win.locator('[data-toolbar-multi-mode]').count()) > 0) {
      await btn.click().catch((e) => console.log('click err', e.message));
      await win.waitForTimeout(500);
      console.log('multi-mode=', await multiAttr(win), 'panes=', await win.locator('[data-pane]').count());
      console.log('toasts=', JSON.stringify(await toasts(win)));
    }
    await H.shot(win, 'adv-p32-zero-tab.png');
  } finally { await H.close(app, 'adv-p32-s1'); }
}

async function s2_oneTab() {
  console.log('\n===== S2: multi mode with exactly 1 tab =====');
  const { app, win } = await H.launch();
  try {
    await H.openFile(app, win, H.tmpCopy(H.FIX + '\\report.pdf', 'p32-one.pdf'));
    await H.waitTabs(win, 1);
    await win.locator('[data-toolbar-multi-mode]').first().click();
    await win.waitForTimeout(600);
    console.log('on: multi-mode=', await multiAttr(win), 'panes=', await win.locator('[data-pane]').count(),
      'multi-panes=', await win.locator('.tab-stage').getAttribute('data-multi-panes'));
    console.log('A header=', (await H.paneInfo(win, 'A')).text, 'B empty=', await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count());
    console.log('rail sections=', JSON.stringify(await H.railInfo(win)));
    await win.locator('[data-toolbar-multi-mode]').first().click();
    await win.waitForTimeout(600);
    console.log('off: multi-mode=', await multiAttr(win), 'panes=', await win.locator('[data-pane]').count(),
      'stage visible canvases=', await win.locator('.tab-pane canvas.pdf-page-canvas').count());
  } finally { await H.close(app, 'adv-p32-s2'); }
}

async function s3_rapidToggle() {
  console.log('\n===== S3: 12 rapid toggles =====');
  const { app, win } = await H.launch();
  try {
    await H.openFile(app, win, H.tmpCopy(H.FIX + '\\report.pdf', 'p32-rapid.pdf'));
    await H.waitTabs(win, 1);
    for (let i = 0; i < 12; i += 1) {
      await win.locator('[data-toolbar-multi-mode]').first().click({ delay: 0 }).catch((e) => console.log('click', i, e.message));
      await win.waitForTimeout(40);
    }
    await win.waitForTimeout(800);
    console.log('after 12 clicks: multi-mode=', await multiAttr(win), 'panes=', await win.locator('[data-pane]').count(),
      'divider=', await win.locator('[data-multi-divider]').count(),
      'canvas=', await win.locator('.tab-pane canvas.pdf-page-canvas').count());
    console.log('pageerror check: diag pageCount=', (await win.evaluate(() => window.tflexDiagnostics())).pageCount);
    // one more pair to land OFF deterministically
    const m = await multiAttr(win);
    if (m === 'true') { await win.locator('[data-toolbar-multi-mode]').first().click(); await win.waitForTimeout(500); }
    console.log('final: multi-mode=', await multiAttr(win), 'panes=', await win.locator('[data-pane]').count());
    await H.shot(win, 'adv-p32-rapid-toggle.png');
  } finally { await H.close(app, 'adv-p32-s3'); }
}

async function s4_rapidFocus() {
  console.log('\n===== S4: rapid focus switching on two 34-page docs =====');
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    for (let i = 0; i < 20; i += 1) {
      const pane = i % 2 === 0 ? 'A' : 'B';
      await win.locator(`.multi-pane-header[data-pane="${pane}"]`).click({ delay: 0 }).catch((e) => console.log('focus click', i, e.message));
      await win.waitForTimeout(30);
    }
    await win.waitForTimeout(800);
    // last click was i=19 -> B
    const diag = await win.evaluate(() => window.tflexDiagnostics());
    console.log('focused=', await H.focusedPane(win), 'expected B');
    console.log('diag pageCount=', diag.pageCount, '(B is 34)', 'currentPage=', diag.currentPage);
    await H.snapshot(win, 'after-rapid-focus');
    await H.shot(win, 'adv-p32-rapid-focus.png');
  } finally { await H.close(app, 'adv-p32-s4'); }
}

async function s5_divider() {
  console.log('\n===== S5: divider extremes / past min =====');
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    console.log('initial widths=', JSON.stringify(await paneWidths(win)), 'split=', await win.locator('.tab-stage').evaluate((el) => el.style.getPropertyValue('--tf-split')));
    const div = await win.locator('[data-multi-divider]').boundingBox();
    const cy = div.y + div.height / 2;
    async function dragTo(x) {
      await win.mouse.move(div.x + div.width / 2, cy);
      await win.mouse.down();
      await win.mouse.move(x, cy, { steps: 8 });
      await win.mouse.up();
      await win.waitForTimeout(400);
    }
    await dragTo(0);
    console.log('far-left widths=', JSON.stringify(await paneWidths(win)), 'split=', await win.locator('.tab-stage').evaluate((el) => el.style.getPropertyValue('--tf-split')));
    await H.shot(win, 'adv-p32-divider-left.png');
    await dragTo(1440);
    console.log('far-right widths=', JSON.stringify(await paneWidths(win)), 'split=', await win.locator('.tab-stage').evaluate((el) => el.style.getPropertyValue('--tf-split')));
    await H.shot(win, 'adv-p32-divider-right.png');
    await dragTo(-300);
    console.log('beyond-left widths=', JSON.stringify(await paneWidths(win)));
    await dragTo(2000);
    console.log('beyond-right widths=', JSON.stringify(await paneWidths(win)));
    // both panes still usable?
    const okA = await win.locator('.tab-pane[data-pane="A"] canvas.pdf-page-canvas').first().isVisible();
    const okB = await win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first().isVisible();
    console.log('canvas visible A/B=', okA, okB);
    await H.snapshot(win, 'after-divider');
  } finally { await H.close(app, 'adv-p32-s5'); }
}

H.run(async () => {
  await s1_zeroTab();
  await s2_oneTab();
  await s3_rapidToggle();
  await s4_rapidFocus();
  await s5_divider();
});