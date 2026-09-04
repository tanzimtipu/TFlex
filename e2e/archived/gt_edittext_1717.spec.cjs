// QA ground-truth reproduction (installed v1.7.17) — BUG 2.
//
// Edit text tool: replace a text run, confirm, then RE-CLICK the edited text
// to see what the editor shows (operator: shows the OLD text, not the new).
// Then MOVE the floating toolbox and confirm: does the edited text stay at its
// original page position, or move with the toolbox?
//
// We capture VISUAL screenshots at each step and read the DOM state (the
// inline editor's textarea value, the committed page text) rather than
// trusting arrays.
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const OLD_TITLE = 'TFlex Technical Report';
const NEW_TITLE = 'NEW TITLE 123';

test.setTimeout(300000);

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([]);
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

// Get the viewport bounding box of the textLayer span matching a string.
async function findTextRun(text) {
  return win.evaluate((needle) => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (t.length > 0 && needle.split(' ')[0] && t.includes(needle.split(' ')[0])) {
        const r = s.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, text: t };
        }
      }
    }
    return null;
  }, text);
}

// Read the inline editor state (mode, textarea value, rect).
async function readEditor(label) {
  const info = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    if (!e) return { present: false };
    const ta = e.querySelector('[data-edit-textarea]');
    const r = e.getBoundingClientRect();
    return {
      present: true,
      mode: e.getAttribute('data-edit-editor'),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      textareaValue: ta ? ta.value : null,
    };
  });
  console.log(`[EDITOR|${label}] ${JSON.stringify(info)}`);
  return info;
}

// Page-1 textLayer text content.
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

async function scrollToPage1() {
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="1"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1000);
}

test('BUG2: edit text -> re-click shows OLD text? -> move toolbox+confirm -> text sticks?', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage1();

  // Enter Edit mode + Edit text tool.
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(500);
  await shot('gt-bug2-1717-edit-text-tool.png');

  // Find the title run "TFlex Technical Report" and click it.
  const run = await findTextRun(OLD_TITLE);
  console.log(`[BUG2|TEXTRUN] title run=${JSON.stringify(run)}`);
  expect(run, 'title text run must exist on page 1').toBeTruthy();
  const cx = run.rect.x + run.rect.w / 2;
  const cy = run.rect.y + run.rect.h / 2;
  await win.mouse.click(cx, cy);
  await win.waitForTimeout(700);

  const editor1 = await readEditor('AFTER-CLICK-TITLE');
  await shot('gt-bug2-1717-editor-open-old.png');
  console.log(`[BUG2] editor opened with initialText="${editor1.textareaValue}"`);

  // Replace the title with NEW_TITLE and confirm.
  const ta = win.locator('[data-edit-textarea]').first();
  await ta.fill(NEW_TITLE);
  await win.waitForTimeout(300);
  await shot('gt-bug2-1717-editor-typed-new.png');
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(1800); // allow the proxy refresh to land

  const afterCommit = await page1Text();
  console.log(`[BUG2|AFTER-COMMIT] page1 text="${afterCommit.text}"`);
  const pageShowsNew = /NEW TITLE 123/i.test(afterCommit.text);
  const pageShowsOld = /TFlex Technical Report/i.test(afterCommit.text) && !/NEW TITLE 123/i.test(afterCommit.text);
  console.log(`[BUG2|AFTER-COMMIT] pageShowsNew=${pageShowsNew} pageStillShowsOld=${pageShowsOld}`);
  await shot('gt-bug2-1717-after-commit.png');

  // Now RE-CLICK the (edited) text run and read what the editor shows.
  // The text run "NEW TITLE 123" — find its span.
  const newRun = await findTextRun(NEW_TITLE);
  console.log(`[BUG2|NEWRUN] ${JSON.stringify(newRun)}`);
  let reclicked = false;
  if (newRun) {
    await win.mouse.click(newRun.rect.x + newRun.rect.w / 2, newRun.rect.y + newRun.rect.h / 2);
    await win.waitForTimeout(700);
    reclicked = true;
  } else {
    // Fall back to clicking the same original spot.
    await win.mouse.click(cx, cy);
    await win.waitForTimeout(700);
  }
  const editor2 = await readEditor('AFTER-RECLICK');
  await shot('gt-bug2-1717-editor-after-reclick.png');
  const editorShowsNew = editor2.textareaValue === NEW_TITLE;
  const editorShowsOld = editor2.textareaValue === OLD_TITLE;
  console.log(`[BUG2|RECLICK] editorShowsNew="${editor2.textareaValue}" ===new? ${editorShowsNew} ===old? ${editorShowsOld}`);

  // Record the committed (baked) text run position on the page — where the
  // "NEW TITLE 123" (or old) text actually renders.
  const bakedPos = await win.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (t.length > 0) {
        const r = s.getBoundingClientRect();
        if (r.width > 0) return { text: t, x: Math.round(r.x), y: Math.round(r.y) };
      }
    }
    return null;
  });
  console.log(`[BUG2|BAKED] first text run on page=${JSON.stringify(bakedPos)}`);

  // Move the floating toolbox (drag its chrome) and confirm if possible.
  if (editor2.present) {
    const bar = await win.evaluate(() => {
      const e = document.querySelector('.edit-inline-editor');
      const b = e && e.querySelector('[data-edit-drag-handle]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    console.log(`[BUG2|DRAGBAR] ${JSON.stringify(bar)}`);
    if (bar) {
      const gx = bar.x + 5;
      const gy = bar.y + 5;
      const beforeMove = editor2.rect;
      await win.mouse.move(gx, gy);
      await win.mouse.down();
      await win.mouse.move(gx + 200, gy + 120, { steps: 12 });
      await win.mouse.up();
      await win.waitForTimeout(500);
      const editorAfterMove = await readEditor('AFTER-MOVE');
      await shot('gt-bug2-1717-editor-after-move-toolbox.png');
      // "Confirm" — try Ctrl+Enter then check.
      const ta2 = win.locator('[data-edit-textarea]').first();
      if (await ta2.count() > 0) {
        await ta2.click();
        await win.keyboard.press('Control+Enter');
        await win.waitForTimeout(1200);
      }
      await shot('gt-bug2-1717-after-move-confirm.png');
      const afterConfirmText = await page1Text();
      const afterConfirmPos = await win.evaluate(() => {
        const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
        for (const s of spans) {
          const t = (s.textContent || '').trim();
          if (/NEW TITLE 123/i.test(t)) {
            const r = s.getBoundingClientRect();
            return { text: t, x: Math.round(r.x), y: Math.round(r.y) };
          }
        }
        return null;
      });
      console.log(`[BUG2|AFTER-MOVE-CONFIRM] page1text="${afterConfirmText.text}" newTitlePos=${JSON.stringify(afterConfirmPos)}`);
      console.log(`[BUG2|AFTER-MOVE-CONFIRM] editorMovedBy dx=${editorAfterMove.rect.x - beforeMove.x} dy=${editorAfterMove.rect.y - beforeMove.y}`);
    }
  }

  // --- Verdict: the key BUG2 symptom is editorShowsNew ----------------
  console.log(`[BUG2|VERDICT] pageShowsNew=${pageShowsNew} editorShowsNewAfterReclick=${editorShowsNew} editorShowsOldAfterReclick=${editorShowsOld}`);
  console.log(`[BUG2|VERDICT] RESULT=${editorShowsNew ? 'PASS' : 'FAIL (BUG REPRODUCED: re-click shows OLD text)'}`);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  console.log(`[BUG2] pageErrors=${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);

  // Assert: after re-clicking the edited text, the editor must show the NEW text.
  expect(editorShowsNew, 're-clicking the edited text must open the editor with the NEW text, not the OLD text').toBe(true);
});
