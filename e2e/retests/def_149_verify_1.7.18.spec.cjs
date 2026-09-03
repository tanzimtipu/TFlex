// QA retest — DEF-149 (installed v1.7.18).
//
// Edit text "TFlex Technical Report" -> "NEW TITLE 123", confirm. Then:
//   (a) RE-CLICK the edited text: the editor must show "NEW TITLE 123"
//       (not the OLD "TFlex Technical Report").
//   (b) Move the floating toolbox (drag its chrome) + confirm: the text
//       must COMMIT at the MOVED position (the run shifts with the
//       toolbox, guardrail #4), not stay at the original rect.
//
// Asserts the FIXED behavior (the bug: re-click showed the OLD text; the
// move+confirm left the text at the original rect). Launch only via
// e2e/lib/launch.cjs against the packaged installed exe.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const OLD_TITLE = 'TFlex Technical Report';
const NEW_TITLE = 'NEW TITLE 123';

test.setTimeout(300000);

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([], null, EXE_PATH);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  pageErrors = [];
  win.on('pageerror', (err) => {
    const m = err && err.message ? err.message : String(err);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  await hardClose(electronApp);
  electronApp = null;
  win = null;
  pageErrors = [];
});

async function shot(name) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  console.log(`[SHOT] ${name}`);
  return p;
}

async function openSampleFromCard(name) {
  await win.locator(`.sample-card:has-text("${name}")`).first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
}

async function findTextRun(text) {
  return win.evaluate((needle) => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (t.length > 0 && t.includes(needle.split(' ')[0])) {
        const r = s.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, text: t };
      }
    }
    return null;
  }, text);
}

async function readEditor(label) {
  const info = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    if (!e) return { present: false };
    const ta = e.querySelector('[data-edit-textarea]');
    const r = e.getBoundingClientRect();
    const confirmBtn = e.querySelector('[data-edit-confirm]');
    return {
      present: true,
      mode: e.getAttribute('data-edit-editor'),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      textareaValue: ta ? ta.value : null,
      confirmAttr: confirmBtn ? confirmBtn.getAttribute('data-edit-confirm') : null,
      confirmLabel: confirmBtn ? confirmBtn.getAttribute('aria-label') : null,
    };
  });
  console.log(`[EDITOR|${label}] ${JSON.stringify(info)}`);
  return info;
}

async function page1Text() {
  return win.evaluate(() => {
    const p = document.querySelector('.page-slot[data-page="1"]');
    if (!p) return { present: false, text: '' };
    const layer = p.querySelector('.textLayer');
    let joined = '';
    if (layer) layer.querySelectorAll('span').forEach((s) => { joined += s.textContent || ''; });
    return { present: true, text: (joined || '').replace(/[ \t\r\n]+/g, ' ').trim() };
  });
}

// Find the position of the text run matching a substring on page 1.
async function runPos(substr) {
  return win.evaluate((needle) => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (t.length > 0 && t.includes(needle)) {
        const r = s.getBoundingClientRect();
        if (r.width > 0) return { text: t, x: Math.round(r.x), y: Math.round(r.y) };
      }
    }
    return null;
  }, substr);
}

async function scrollToPage1() {
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="1"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1000);
}

test('DEF-149: re-click edited text shows NEW text; move toolbox+confirm commits at moved position', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage1();

  // Enter Edit mode + Edit text tool.
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(500);
  await shot('def-149-1718-edit-text-tool.png');

  // Find + click the title run.
  const run = await findTextRun(OLD_TITLE);
  console.log(`[DEF-149|TEXTRUN] title run=${JSON.stringify(run)}`);
  expect(run, 'title text run must exist on page 1').toBeTruthy();
  const cx = run.rect.x + run.rect.w / 2;
  const cy = run.rect.y + run.rect.h / 2;
  await win.mouse.click(cx, cy);
  await win.waitForTimeout(700);

  const editor1 = await readEditor('AFTER-CLICK-TITLE');
  console.log(`[DEF-149] editor opened with initialText="${editor1.textareaValue}"`);
  expect(editor1.textareaValue, 'editor must open pre-filled with the title').toBe(OLD_TITLE);

  // Replace the title with NEW_TITLE and confirm.
  const ta = win.locator('[data-edit-textarea]').first();
  await ta.fill(NEW_TITLE);
  await win.waitForTimeout(300);
  await shot('def-149-1718-editor-typed-new.png');
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(1800);

  const afterCommit = await page1Text();
  console.log(`[DEF-149|AFTER-COMMIT] page1 text="${afterCommit.text}"`);
  expect(/NEW TITLE 123/i.test(afterCommit.text), 'page must show the new title after commit').toBe(true);
  await shot('def-149-1718-after-commit.png');

  // (a) RE-CLICK the edited text run.
  const newRun = await findTextRun(NEW_TITLE);
  console.log(`[DEF-149|NEWRUN] ${JSON.stringify(newRun)}`);
  let reclicked = false;
  if (newRun) {
    await win.mouse.click(newRun.rect.x + newRun.rect.w / 2, newRun.rect.y + newRun.rect.h / 2);
    await win.waitForTimeout(700);
    reclicked = true;
  } else {
    await win.mouse.click(cx, cy);
    await win.waitForTimeout(700);
  }
  const editor2 = await readEditor('AFTER-RECLICK');
  await shot('def-149-1718-editor-after-reclick.png');
  const editorShowsNew = editor2.textareaValue === NEW_TITLE;
  const editorShowsOld = editor2.textareaValue === OLD_TITLE;
  console.log(`[DEF-149|RECLICK] editorShowsNew="${editor2.textareaValue}" ===new? ${editorShowsNew} ===old? ${editorShowsOld}`);
  expect(editorShowsNew, 're-clicking the edited text must open the editor with the NEW text, not the OLD text').toBe(true);

  // Record where the new title sits BEFORE the toolbox move.
  const posBefore = await runPos('NEW TITLE 123');
  console.log(`[DEF-149|POS-BEFORE] ${JSON.stringify(posBefore)}`);

  // (b) Move the floating toolbox + confirm: text must commit at the moved position.
  if (editor2.present) {
    const bar = await win.evaluate(() => {
      const e = document.querySelector('.edit-inline-editor');
      const b = e && e.querySelector('[data-edit-drag-handle]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    console.log(`[DEF-149|DRAGBAR] ${JSON.stringify(bar)}`);
    expect(bar, 'editor drag handle must exist').toBeTruthy();
    const gx = bar.x + 5;
    const gy = bar.y + 5;
    await win.mouse.move(gx, gy);
    await win.mouse.down();
    await win.mouse.move(gx + 200, gy + 120, { steps: 12 });
    await win.mouse.up();
    await win.waitForTimeout(500);
    const editorAfterMove = await readEditor('AFTER-TOOLBOX-MOVE');
    const movedBy = { dx: editorAfterMove.rect.x - editor2.rect.x, dy: editorAfterMove.rect.y - editor2.rect.y };
    console.log(`[DEF-149|TOOLBOX-MOVED] dx=${movedBy.dx} dy=${movedBy.dy}`);
    await shot('def-149-1718-editor-toolbox-moved.png');
    // Confirm via the Confirm-move affordance if present, else Ctrl+Enter.
    const confirmBtn = await win.evaluate(() => {
      const b = document.querySelector('.edit-inline-editor [data-edit-confirm]');
      if (!b) return null;
      return { attr: b.getAttribute('data-edit-confirm'), label: b.getAttribute('aria-label') };
    });
    console.log(`[DEF-149|CONFIRM-AFFORDANCE] ${JSON.stringify(confirmBtn)}`);
    const ta2 = win.locator('[data-edit-textarea]').first();
    await ta2.click();
    await win.keyboard.press('Control+Enter');
    await win.waitForTimeout(1200);
    await shot('def-149-1718-after-move-confirm.png');
    const posAfter = await runPos('NEW TITLE 123');
    console.log(`[DEF-149|POS-AFTER] ${JSON.stringify(posAfter)} (before=${JSON.stringify(posBefore)})`);
    // The run must have shifted with the toolbox (>= 120px horizontally).
    const committedMoved = posBefore && posAfter && (Math.abs(posAfter.x - posBefore.x) >= 120);
    console.log(`[DEF-149|VERDICT-B] committedMoved=${committedMoved}`);
    expect(committedMoved, 'after move+confirm the committed text must move with the toolbox (>=120px shift)').toBe(true);
  }

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  console.log(`[DEF-149] pageErrors=${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);

  console.log(`[DEF-149|RESULT] PASS`);
});
