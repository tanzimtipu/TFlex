// Phase 82 phase-validation (qa) - offline spell check inside the text-edit
// flow. Drives the real dev app through launchDev() (fresh temp user-data dir)
// and exercises the shared panel Text field ([data-txt-text], Phase 26) with
// an Edit-mode text box selected.
//
// The bundled dictionary is the zxcvbn `english_wikipedia` frequency list
// (assets/dictionary/LICENSE.txt). That list is missing many very common short
// words (cat, sat, dog, run, file, page, word, ...). Scenario 2a of the task
// asked for "teh cat sat" with only "teh" flagged; that literal phrase cannot
// pass against this dictionary. Test T1 proves the promised CONTROL-INDEX
// mechanism (known misspelling flagged, dictionary word not) with words the
// dictionary actually knows; T2 records the literal 2a expectation as a
// discrepancy (dictionary-coverage defect).
//
// Run with:
//   npm.cmd run test:e2e -- e2e/phase82_spellcheck.spec.cjs
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  launchDev,
  openSample,
  openSamplePath,
  toggleEditMode,
  armAnnotationTool,
  hardClose,
} = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[p82|${label}] ${JSON.stringify(obj)}`);

// ---------------------------------------------------------------------------
// settings.json spellCheck reader / poller (mirrors phase81).
// ---------------------------------------------------------------------------
function readSpellEnabled(settingsPath) {
  if (!fs.existsSync(settingsPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return raw && raw.spellCheck ? raw.spellCheck.enabled : null;
  } catch {
    return null;
  }
}

async function waitForSpellEnabled(settingsPath, want, timeoutMs = 20000) {
  const t0 = Date.now();
  let last = 'unread';
  while (Date.now() - t0 < timeoutMs) {
    const v = readSpellEnabled(settingsPath);
    last = v;
    if (v === want) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  log('waitForSpellEnabled-timeout', { want, last });
  return false;
}

// ---------------------------------------------------------------------------
// Edit-mode text box placement / selection (mirrors phase21 createTextBox).
// The panel Text field [data-txt-text] is the single editing surface.
// ---------------------------------------------------------------------------
async function fieldEnabled(win) {
  return win.evaluate(() => {
    const ta = document.querySelector('[data-txt-text]');
    return !!(ta && ta.disabled === false);
  });
}

async function selectEditBox(win) {
  if (await fieldEnabled(win)) return;
  await win.locator('.edit-box').first().click({ position: { x: 8, y: 8 } });
  await win.waitForFunction(
    () => {
      const ta = document.querySelector('[data-txt-text]');
      return !!(ta && ta.disabled === false);
    },
    null,
    { timeout: 8000 },
  );
}

async function placeEditBox(win, text) {
  await toggleEditMode(win);
  const verb = win.locator('[data-dock-verb="editTextBox"]');
  await verb.waitFor({ state: 'visible', timeout: 10000 });
  await verb.click();
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const inspectorLeft = await win.evaluate(() => {
    const i = document.querySelector('[data-inspector]');
    return i ? i.getBoundingClientRect().left : window.innerWidth;
  });
  let x = Math.max(40, Math.min(pg.x + pg.width * 0.28, vp.w - 240));
  x = Math.min(x, inspectorLeft - 40);
  const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * 0.22, vp.h - 200));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 200, y + 70, { steps: 6 });
  await win.mouse.up();
  await win.waitForSelector('[data-txt-text]', { timeout: 8000 });
  await win.waitForFunction(
    () => {
      const ta = document.querySelector('[data-txt-text]');
      return !!(ta && ta.disabled === false);
    },
    null,
    { timeout: 8000 },
  );
  const field = win.locator('[data-txt-text]');
  await field.fill(text);
  await field.blur();
  await win.waitForSelector('.edit-box', { timeout: 8000 });
  await win.waitForTimeout(300);
  await selectEditBox(win);
}

async function setFieldText(win, text) {
  await selectEditBox(win);
  const field = win.locator('[data-txt-text]');
  await field.focus();
  await field.fill(text);
  // Debounce is 150ms; wait a little longer for the mirror to settle.
  await win.waitForTimeout(400);
}

async function fieldValue(win) {
  return win.evaluate(() => {
    const ta = document.querySelector('[data-txt-text]');
    return ta ? ta.value : null;
  });
}

async function misspelledSpans(win) {
  return win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-spell-misspelled]')).map((e) => e.textContent),
  );
}

async function waitForSpellReady(win) {
  // While loading/off/error the status node renders; ready renders none.
  await win
    .waitForFunction(() => document.querySelector('[data-spell-status]') === null, null, { timeout: 15000 })
    .catch(() => {});
}

// Right-click the token at `offset`: set the caret there and dispatch a real
// contextmenu event. `point` true aims the pointer inside the field (so the
// popover lands in bounds); false aims off-field so the handler falls back to
// textarea selectionStart.
async function dispatchContextMenu(win, offset, point) {
  await win.evaluate(
    ({ off, usePoint }) => {
      const ta = document.querySelector('[data-txt-text]');
      ta.focus();
      ta.setSelectionRange(off, off);
      const r = ta.getBoundingClientRect();
      const x = usePoint ? r.left + 10 : 1;
      const y = usePoint ? r.top + 14 : 1;
      ta.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        }),
      );
    },
    { off: offset, usePoint: point },
  );
}

// Accept the first suggestion the popover actually offers and return its text.
// The augmented dictionary (TFL-350) no longer lists "the" among the top
// suggestions for "teh", so the oracle must target whatever is offered rather
// than a hard-coded replacement.
async function clickFirstSuggestion(win) {
  const btn = win.locator('[data-spell-suggestion]').first();
  await btn.waitFor({ state: 'visible', timeout: 5000 });
  const text = (await btn.textContent()).trim();
  await btn.click();
  return text;
}

async function boot(win, app) {
  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 60000 });
  const udd = await app.evaluate(({ app: a }) => a.getPath('userData'));
  return path.join(udd, 'settings.json');
}

// ===========================================================================
// T1 - CONTROL-INDEX mechanics: [data-spell-misspelled] underlines a known
// misspelling and not a dictionary word; [data-spell-suggest] opens on the
// misspelled token; [data-spell-suggestion] click replaces it and clears the
// squiggle; a correct word opens no popover (no blank popover).
// ===========================================================================
test('Phase 82 T1: underline, suggestions, accept, no empty popover', async () => {
  test.setTimeout(300000);
  const { electronApp: app, window: win } = await launchDev();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)));
  try {
    await boot(win, app);
    await placeEditBox(win, 'teh world');
    await waitForSpellReady(win);

    // a. "teh world": only "teh" is flagged.
    await setFieldText(win, 'teh world');
    await win.waitForFunction(
      () => document.querySelectorAll('[data-spell-misspelled]').length > 0,
      null,
      { timeout: 8000 },
    );
    const spans = await misspelledSpans(win);
    log('T1-spans', spans);
    expect(await fieldValue(win), 'field holds the typed value').toBe('teh world');
    expect(spans, 'exactly the misspelling "teh" is underlined').toEqual(['teh']);
    await win.screenshot({ path: path.join(SHOTS, 'phase82-spell-underline.png') });

    // b. right-click "teh" -> suggestion popover.
    await dispatchContextMenu(win, 0, true);
    await win.waitForSelector('[data-spell-suggest]', { state: 'visible', timeout: 5000 });
    const suggestionTexts = await win
      .locator('[data-spell-suggestion]')
      .allTextContents();
    log('T1-suggestions', suggestionTexts);
    expect(suggestionTexts.length, 'at least one suggestion offered').toBeGreaterThanOrEqual(1);
    await win.screenshot({ path: path.join(SHOTS, 'phase82-spell-suggestions.png') });
    const chosen = await clickFirstSuggestion(win);
    log('T1-accepted-suggestion', chosen);
    await win.waitForFunction(
      (c) => document.querySelector('[data-txt-text]').value === `${c} world`,
      chosen,
      { timeout: 5000 },
    );
    await win.waitForFunction(
      () => document.querySelectorAll('[data-spell-misspelled]').length === 0,
      null,
      { timeout: 5000 },
    );
    expect(await fieldValue(win), `accepting "${chosen}" replaces the token`).toBe(
      `${chosen} world`,
    );

    // d. right-click the correctly spelled "world" -> no popover.
    await dispatchContextMenu(win, 4, false);
    await win.waitForTimeout(400);
    expect(
      await win.locator('[data-spell-suggest]').count(),
      'no blank popover on a correctly spelled word',
    ).toBe(0);

    expect(pageErrors, 'zero renderer page errors').toEqual([]);
  } finally {
    await hardClose(app, 'p82-t1');
  }
});

// ===========================================================================
// T2 - the task's literal 2a phrase "teh cat sat". The task expected only
// "teh" flagged. The bundled zxcvbn wikipedia list has no "cat"/"sat", so the
// product flags all three. This test asserts the task's literal expectation
// and therefore FAILS, recording the dictionary-coverage defect as evidence.
// ===========================================================================
test('Phase 82 T2: literal "teh cat sat" (dictionary-coverage discrepancy)', async () => {
  test.setTimeout(300000);
  const { electronApp: app, window: win } = await launchDev();
  try {
    await boot(win, app);
    await placeEditBox(win, 'teh cat sat');
    await waitForSpellReady(win);
    await setFieldText(win, 'teh cat sat');
    await win.waitForFunction(
      () => document.querySelectorAll('[data-spell-misspelled]').length > 0,
      null,
      { timeout: 8000 },
    );
    const spans = await misspelledSpans(win);
    log('T2-spans', spans);
    const dictHasCat = await win.evaluate(() => false); // informational only
    void dictHasCat;
    // The task's literal expectation:
    expect(spans, 'task-literal 2a: only "teh" should be flagged').toEqual(['teh']);
  } finally {
    await hardClose(app, 'p82-t2');
  }
});

// ===========================================================================
// T3 - toggle persistence ([data-txt-spellcheck] / [data-spell-status]) and
// the debounce performance budget.
// ===========================================================================
test('Phase 82 T3: toggle persistence + debounce perf budget', async () => {
  test.setTimeout(300000);
  const { electronApp: app, window: win } = await launchDev();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)));
  try {
    const settingsPath = await boot(win, app);
    await placeEditBox(win, 'teh world');
    await waitForSpellReady(win);
    await setFieldText(win, 'teh world');
    await win.waitForFunction(
      () => document.querySelectorAll('[data-spell-misspelled]').length > 0,
      null,
      { timeout: 8000 },
    );

    const toggleProblems = [];
    const toggle = win.locator('[data-txt-spellcheck]');

    // g. performance FIRST, with spell check definitively on: debounce from the
    // last keystroke to the squiggle appearing <= 500ms.
    await setFieldText(win, '');
    await win.waitForFunction(
      () => document.querySelectorAll('[data-spell-misspelled]').length === 0,
      null,
      { timeout: 5000 },
    );
    const field = win.locator('[data-txt-text]');
    await field.focus();
    const longText = new Array(50).fill('teh').join(' '); // 199 chars
    await win.keyboard.type(longText, { delay: 0 });
    const typedValue = await fieldValue(win);
    const t0 = Date.now();
    let ms = null;
    try {
      await win.waitForFunction(
        () => document.querySelectorAll('[data-spell-misspelled]').length > 0,
        null,
        { timeout: 3000 },
      );
      ms = Date.now() - t0;
    } catch {
      ms = null;
    }
    const perfSpans = await misspelledSpans(win);
    log('T3-perf', {
      ms,
      chars: longText.length,
      typedValueLen: (typedValue || '').length,
      perfSpans: perfSpans.length,
    });
    if (ms === null) {
      toggleProblems.push(
        `no squiggle within 3s of the last keystroke (typedLen=${(typedValue || '').length})`,
      );
    } else if (ms > 500) {
      toggleProblems.push(`last keystroke -> squiggle took ${ms}ms (>500ms budget)`);
    }

    // c. toggle OFF: aria-pressed flips, no underlines, readable status.
    await setFieldText(win, 'teh world');
    await win.waitForFunction(
      () => document.querySelectorAll('[data-spell-misspelled]').length > 0,
      null,
      { timeout: 8000 },
    );
    expect(await toggle.getAttribute('aria-pressed'), 'spell check starts on').toBe('true');
    await toggle.click();
    await win.waitForTimeout(1500);
    const ariaAfter = await toggle.getAttribute('aria-pressed');
    const spansAfter = await misspelledSpans(win);
    const statusOff = (
      (await win.locator('[data-spell-status]').first().textContent().catch(() => '')) || ''
    ).trim();
    const persistedOff = readSpellEnabled(settingsPath);
    log('T3-toggle-off-evidence', { ariaAfter, spansAfter, statusOff, persistedOff });
    await win.screenshot({ path: path.join(SHOTS, 'phase82-spell-status-editmode.png') });
    if (ariaAfter !== 'false') {
      toggleProblems.push(`aria-pressed did not flip to false (got ${ariaAfter})`);
    }
    if (spansAfter.length !== 0) {
      toggleProblems.push(`underlines still drawn when off: ${JSON.stringify(spansAfter)}`);
    }
    if (statusOff.length === 0) toggleProblems.push('status is blank when off');
    if (persistedOff !== false) {
      toggleProblems.push(`spellCheck.enabled not persisted false (got ${persistedOff})`);
    }

    expect(
      toggleProblems,
      'CONTROL-INDEX [data-txt-spellcheck]/[data-spell-status] promised actions in the EDIT-mode panel',
    ).toEqual([]);

    expect(pageErrors, 'zero renderer page errors').toEqual([]);
  } finally {
    await hardClose(app, 'p82-t3');
  }
});

// ===========================================================================
// T4 - no-regression: a spell correction still commits through the normal
// session and survives Save As -> reopen (document-safety), and typing still
// updates the field with spell check off.
// ===========================================================================
async function waitForBox(win, text, timeoutMs = 15000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const boxes = await win.evaluate(() => {
      const st = window.tflexDiagnostics().engineState;
      return st && st.textBoxes ? st.textBoxes.map((b) => b.text) : null;
    });
    last = boxes;
    if (Array.isArray(boxes) && boxes.includes(text)) return true;
    await win.waitForTimeout(200);
  }
  log('waitForBox-timeout', { text, last });
  return false;
}

test('Phase 82 T4: correction persists Save As/reopen; typing works with spell off', async () => {
  test.setTimeout(300000);
  const { electronApp: app, window: win } = await launchDev();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)));
  try {
    await boot(win, app);
    await placeEditBox(win, 'teh world');
    await waitForSpellReady(win);

    // Accept the correction through the popover, then commit on blur.
    await setFieldText(win, 'teh world');
    await win.waitForFunction(
      () => document.querySelectorAll('[data-spell-misspelled]').length > 0,
      null,
      { timeout: 8000 },
    );
    await dispatchContextMenu(win, 0, true);
    await win.waitForSelector('[data-spell-suggest]', { state: 'visible', timeout: 5000 });
    const chosen = await clickFirstSuggestion(win);
    log('T4-accepted-suggestion', chosen);
    const corrected = `${chosen} world`;
    await win.waitForFunction(
      (c) => document.querySelector('[data-txt-text]').value === c,
      corrected,
      { timeout: 5000 },
    );
    await win.locator('[data-txt-text]').blur();
    expect(await waitForBox(win, corrected), 'corrected text committed to the session').toBe(true);

    // Spell check OFF: typing/editing the field still updates the value. The
    // edit-mode toggle is defective (see T3) but the field must keep working.
    await win.locator('[data-txt-spellcheck]').click();
    const fieldOff = win.locator('[data-txt-text]');
    await fieldOff.focus();
    await fieldOff.fill('typing while off');
    await win.waitForTimeout(300);
    expect(await fieldValue(win), 'field still updates with spell check off').toBe(
      'typing while off',
    );
    // Restore the corrected text for the save/reopen document-safety check.
    await setFieldText(win, corrected);
    await win.locator('[data-txt-text]').blur();
    expect(await waitForBox(win, corrected), 'restored correction committed').toBe(true);

    // Save As -> close -> reopen; the corrected text persists.
    const savePath = path.join(os.tmpdir(), `p82-spell-${Date.now()}.pdf`);
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savePath);
    await win.click('[data-toolbar-save-as]');
    await win.waitForSelector('[data-save-as-confirm]', { timeout: 10000 });
    await win.click('[data-save-as-confirm]');
    await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
    expect(fs.existsSync(savePath), 'saved PDF exists').toBe(true);
    log('T4-saved', { savePath, bytes: fs.statSync(savePath).size });
    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1200);
    await openSamplePath(win, app, savePath);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(2000);
    expect(await waitForBox(win, corrected), 'corrected text persisted across save/reopen').toBe(true);

    expect(pageErrors, 'zero renderer page errors').toEqual([]);
  } finally {
    await hardClose(app, 'p82-t4');
  }
});

// ===========================================================================
// T5 - characterises the toggle on the OTHER mount point: an annotation text
// box uses the floating text-properties card (not the Inspector snapshot). If
// the toggle works there but not in T3, the defect is edit-mode-specific.
// Also captures the required status screenshot from the surface that renders
// the honest off state.
// ===========================================================================
async function dragAnnotationBox(win, fx = 0.3, fy = 0.25) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 260));
  const y = Math.max(40, Math.min(pg.y + pg.height * fy, vp.h - 140));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 200, y + 70, { steps: 6 });
  await win.mouse.up();
}

test('Phase 82 T5: annotation-textbox toggle (floating card) off/on + persistence', async () => {
  test.setTimeout(300000);
  const { electronApp: app, window: win } = await launchDev();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)));
  try {
    const settingsPath = await boot(win, app);
    await armAnnotationTool(win, 'textbox');
    await dragAnnotationBox(win);
    await win.waitForSelector('[data-txt-text]', { timeout: 8000 });
    await win.waitForFunction(
      () => {
        const ta = document.querySelector('[data-txt-text]');
        return !!(ta && ta.disabled === false);
      },
      null,
      { timeout: 8000 },
    );
    await waitForSpellReady(win);
    await setFieldText(win, 'teh world');
    await win.waitForFunction(
      () => document.querySelectorAll('[data-spell-misspelled]').length > 0,
      null,
      { timeout: 8000 },
    );

    const toggle = win.locator('[data-txt-spellcheck]').first();
    log('T5-toggle-count', await win.locator('[data-txt-spellcheck]').count());
    expect(await toggle.getAttribute('aria-pressed'), 'spell check on').toBe('true');
    const readSpell = () =>
      win.evaluate(async () => {
        try {
          const r = await window.tflex.loadSettings();
          const s = r && (r.value ?? r);
          return s && s.spellCheck ? s.spellCheck : null;
        } catch (e) {
          return { error: String(e) };
        }
      });
    const spellBefore = await readSpell();
    const btnInfo = await win.evaluate(() => {
      const b = document.querySelector('[data-txt-spellcheck]');
      return b
        ? { disabled: b.disabled, cls: b.className, hasSpellIcon: !!b.querySelector('svg') }
        : null;
    });
    await toggle.click();
    await win.waitForTimeout(1500);
    const ariaAfter = await toggle.getAttribute('aria-pressed');
    const afterPlaywright = ariaAfter;
    const spellAfter = await readSpell();
    const persistedFalse = await waitForSpellEnabled(settingsPath, false, 8000);
    const persistedValue = readSpellEnabled(settingsPath);
    log('T5-toggle-evidence', {
      btnInfo,
      afterPlaywright,
      ariaAfter,
      spellBefore,
      spellAfter,
      persistedFalse,
      persistedValue,
      pageErrors,
    });
    // Probe: does the toggle state at least apply when the panel remounts
    // (deselect + reselect)? Distinguishes "handler never ran" from "stale
    // snapshot never republished".
    await win.keyboard.press('Escape');
    await win.waitForTimeout(600);
    await win.locator('.ann-textbox').first().click().catch(() => {});
    await win.waitForTimeout(800);
    const ariaAfterRemount = await toggle.getAttribute('aria-pressed').catch(() => null);
    const spansAfterRemount = await misspelledSpans(win);
    log('T5-remount-probe', { ariaAfterRemount, spansAfterRemount });
    // After a remount the panel reflects the OFF state, so the honest
    // [data-spell-status] text is finally visible - capture the required shot.
    const statusRemount = (
      (await win.locator('[data-spell-status]').first().textContent().catch(() => '')) || ''
    ).trim();
    log('T5-status-remount', statusRemount);
    await win.screenshot({ path: path.join(SHOTS, 'phase82-spell-status.png') });
    // eslint-disable-next-line no-unused-expressions
    expect(ariaAfter, 'aria-pressed flips to false after the click').toBe('false');
    await win.waitForFunction(
      () =>
        document.querySelector('[data-txt-spellcheck]').getAttribute('aria-pressed') === 'false',
      null,
      { timeout: 5000 },
    );
    await win.waitForFunction(
      () => document.querySelectorAll('[data-spell-misspelled]').length === 0,
      null,
      { timeout: 5000 },
    );
    const statusOff = (
      (await win.locator('[data-spell-status]').first().textContent().catch(() => '')) || ''
    ).trim();
    log('T5-status-off', statusOff);
    expect(statusOff.length, 'readable status text when off').toBeGreaterThan(0);
    await win.screenshot({ path: path.join(SHOTS, 'phase82-spell-status.png') });
    expect(
      await waitForSpellEnabled(settingsPath, false),
      'spellCheck.enabled=false persisted',
    ).toBe(true);

    await toggle.click();
    await win.waitForFunction(
      () =>
        document.querySelector('[data-txt-spellcheck]').getAttribute('aria-pressed') === 'true',
      null,
      { timeout: 5000 },
    );
    await win.waitForFunction(
      () => document.querySelectorAll('[data-spell-misspelled]').length > 0,
      null,
      { timeout: 8000 },
    );
    expect(
      await waitForSpellEnabled(settingsPath, true),
      'spellCheck.enabled=true persisted',
    ).toBe(true);

    expect(pageErrors, 'zero renderer page errors').toEqual([]);
  } finally {
    await hardClose(app, 'p82-t5');
  }
});
