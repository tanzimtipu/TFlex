// Investigation probe (qa): why are AnnotationToolbar (.ann-toolbar) and
// EditToolbar (.edit-toolbar) reported missing from the DOM in TFlex v1.16.1
// when a PDF is open (CommandBar renders, toolbars do not)?
//
// Now runs against the ACTUALLY INSTALLED v1.16.1 app (user-confirmed via the
// About dialog). The task referenced %LOCALAPPDATA%\tflex\TFlex.exe, but the
// NSIS install lives under %LOCALAPPDATA%\Programs\tflex\TFlex.exe
// (FileVersion 1.16.1 — same build the user has); that is what this spec
// launches via the canonical launchApp() from e2e/lib/launch.cjs.
//
// Evidence collected per task steps:
//   1. launch dev app, open the "report" sample via its .sample-card
//   2. DOM presence: .ann-toolbar / .edit-toolbar / .toolbar (CommandBar)
//      counts + bounding boxes (distinguishes "absent" from "present but
//      invisible")
//   3. renderer console errors + uncaught page errors captured from the
//      moment of open (task step 3's window.consoleErrors hook does not
//      exist in the product; Playwright's console/pageerror events are the
//      equivalent test-side capture)
//   4. screenshot screenshots/missing-toolbars.png (state A: default)
//      + screenshots/missing-toolbars-editmode.png (state B: Edit mode on,
//      to test whether .edit-toolbar is conditionally absent by design:
//      App.tsx renders edit={editModeOpen ? ... : null} and DocumentView
//      only mounts <EditToolbar> when editModeOpen && edit !== null)
//   5. .workspace-main child inventory (classes + text)
//
// Diagnostic only: logs the findings, never fails on product state.
// Fails only if the app/flow itself cannot be driven (infrastructure).

const { test } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, shot, dismissUpdatePrompt } = require('./lib/helpers.cjs');

// The actually installed v1.16.1 executable. (The task referenced
// %LOCALAPPDATA%\tflex\TFlex.exe; the NSIS install is under
// %LOCALAPPDATA%\Programs\tflex\TFlex.exe - FileVersion 1.16.1, the same
// build the user confirmed via the About dialog.)
const INSTALLED_EXE = path.join(process.env.LOCALAPPDATA, 'Programs', 'tflex', 'TFlex.exe');

async function toolbarProbe(window, label) {
  const probe = await window.evaluate(() => {
    const describe = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      return {
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
      };
    };
    const ann = document.querySelector('.ann-toolbar');
    const edit = document.querySelector('.edit-toolbar');
    const cmd = document.querySelector('.toolbar');
    const main = document.querySelector('.workspace-main');
    const children = main
      ? Array.from(main.children).map((c) => ({
          tag: c.tagName.toLowerCase(),
          cls: c.className && String(c.className).slice(0, 90),
          data: c.getAttribute('data-annotation-toolbar') !== null
            ? 'data-annotation-toolbar'
            : (c.getAttribute('data-edit-toolbar') !== null ? 'data-edit-toolbar' : null),
          text: (c.textContent || '').trim().slice(0, 60),
        }))
      : null;
    let diag = null;
    try { diag = window.tflexDiagnostics(); } catch (_) { diag = 'tflexDiagnostics threw'; }
    return {
      annToolbar: describe(ann),
      editToolbar: describe(edit),
      commandBar: describe(cmd),
      workspaceMain: main ? { exists: true, childCount: main.children.length, children } : { exists: false },
      diag: diag && typeof diag === 'object'
        ? { pageCount: diag.pageCount, currentPage: diag.currentPage, activeTool: diag.activeTool, theme: diag.theme, modified: diag.modified }
        : diag,
    };
  });
  console.log(`[probe:${label}] ann-toolbar  = ${probe.annToolbar ? 'IN DOM' + JSON.stringify(probe.annToolbar) : 'NOT IN DOM'}`);
  console.log(`[probe:${label}] edit-toolbar = ${probe.editToolbar ? 'IN DOM' + JSON.stringify(probe.editToolbar) : 'NOT IN DOM'}`);
  console.log(`[probe:${label}] .toolbar (CommandBar) = ${probe.commandBar ? 'IN DOM' + JSON.stringify(probe.commandBar) : 'NOT IN DOM'}`);
  console.log(`[probe:${label}] .workspace-main = ${JSON.stringify(probe.workspaceMain)}`);
  console.log(`[probe:${label}] diagnostics = ${JSON.stringify(probe.diag)}`);
  return probe;
}

test('investigate missing AnnotationToolbar / EditToolbar after opening report.pdf (INSTALLED v1.16.1)', async () => {
  // Installed-app launch per task: canonical launchApp() pointed at the
  // installed executable (fresh temp profile). dismissUpdatePrompt keeps the
  // DEF-172 OTA prompt from intercepting clicks on the installed build.
  const electronApp = await launchApp([], null, INSTALLED_EXE);
  const window = await electronApp.firstWindow();
  await window.waitForSelector('.sample-card', { timeout: 30000 });
  const updatePromptDismissed = await dismissUpdatePrompt(window);
  console.log(`[launch] installed exe = ${INSTALLED_EXE}; update prompt dismissed: ${updatePromptDismissed}`);
  try {
    // Console / page-error capture (task step 3). launch.cjs already mirrors
    // renderer console to stdout; this collector keeps the post-open window
    // structured for the report.
    const consoleMsgs = [];
    const pageErrors = [];
    window.on('console', (msg) => {
      const t = msg.type();
      if (t === 'error' || t === 'warning') consoleMsgs.push(`${t}: ${msg.text().slice(0, 300)}`);
    });
    window.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)));

    // Step 1: open the report sample from the welcome screen.
    await window.locator('.sample-card:has-text("report")').first().click();
    await window.waitForSelector('.workspace', { timeout: 30000 });
    await window.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    consoleMsgs.length = 0; // drop welcome-screen noise
    pageErrors.length = 0;
    await window.waitForTimeout(2000); // task step 1 settle

    // Steps 2 + 5: DOM presence in the default state, child inventory.
    const stateA = await toolbarProbe(window, 'A:default');

    // Step 4: primary screenshot (default state).
    await shot(window, 'missing-toolbars.png');

    // State B: arm Edit mode via the CommandBar's Edit button. Per
    // App.tsx (edit={editModeOpen ? editHandlers(...) : null}) and
    // DocumentView.tsx (EditToolbar mounts only when editModeOpen &&
    // edit !== null), .edit-toolbar is EXPECTED absent in state A and
    // EXPECTED present here. Distinguishes "by design" from "broken".
    const editToggle = window.locator('[data-toolbar-edit-toggle]');
    const hasEditToggle = (await editToggle.count()) > 0;
    let editToolbarInB = null;
    if (hasEditToggle) {
      await editToggle.click();
      editToolbarInB = await window
        .locator('.edit-toolbar')
        .waitFor({ timeout: 5000, state: 'attached' })
        .then(() => true)
        .catch(() => false);
      console.log(`[probe:B:editmode] edit toggle clicked; .edit-toolbar attached after click: ${editToolbarInB}`);
      if (editToolbarInB) await window.waitForTimeout(400); // let the enter animation settle
      await toolbarProbe(window, 'B:editmode-on');
      await shot(window, 'missing-toolbars-editmode.png');
    } else {
      console.log('[probe:B:editmode] CommandBar Edit toggle [data-toolbar-edit-toggle] not found - cannot arm edit mode');
    }

    // Step 3: console errors observed after open.
    console.log(`[console] post-open renderer console errors/warnings (${consoleMsgs.length}):`);
    for (const m of consoleMsgs.slice(0, 40)) console.log(`  ${m}`);
    console.log(`[console] post-open uncaught page errors (${pageErrors.length}):`);
    for (const m of pageErrors.slice(0, 20)) console.log(`  ${m}`);

    // Verdict lines for the report.
    const annMissing = !stateA.annToolbar;
    const editMissingInA = !stateA.editToolbar;
    console.log(`[verdict] .ann-toolbar (expected ALWAYS mounted): ${annMissing ? 'MISSING FROM DOM - defect' : 'present'}`);
    console.log(`[verdict] .edit-toolbar in state A (expected absent, edit mode closed): ${editMissingInA ? 'absent as designed' : 'present'}`);
    if (hasEditToggle) {
      console.log(`[verdict] .edit-toolbar after arming Edit mode (expected present): ${editToolbarInB ? 'present' : 'STILL MISSING - defect'}`);
    }
    console.log(`[verdict] console errors after open: ${consoleMsgs.length === 0 && pageErrors.length === 0 ? 'none' : consoleMsgs.length + ' console + ' + pageErrors.length + ' pageerror'}`);
  } finally {
    await hardClose(electronApp);
  }
});