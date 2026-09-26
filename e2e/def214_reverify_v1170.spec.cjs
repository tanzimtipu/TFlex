// DEF-214 re-verification (qa): the v1.16.1 installer shipped without the
// annotation toolbar and the CommandBar Edit toggle (stale renderer bundle -
// a packaging integrity issue, not a code defect). The fix landed in
// v1.16.2/v1.17.0 built from clean source. Per the release-defect
// disposition rule, qa must re-verify the fix on the release artifact
// before the closure stands.
//
// Phase 36 migration note (qa): this is an OUT-OF-SCOPE RELEASE SPEC. It
// drives the FROZEN packaged artifact release/win-unpacked/TFlex.exe
// (built pre-Phase-36 — its asar still contains data-toolbar-edit-toggle
// and no data-dock-verb). The Phase-36 Action Dock replaced the CommandBar
// Edit toggle, so this spec's recorded v1.17.0 selectors stay pinned to the
// artifact DEF-214 was filed against; it is deliberately NOT migrated and
// is excluded from the standard suite run (the dispatch's release-spec
// exclusion). A post-Phase-36 packaging-integrity check belongs in a NEW
// release spec, not this historical re-verification.
//
// This spec drives the v1.17.0 packaged app (release/win-unpacked/TFlex.exe -
// the same payload the NSIS installer and the portable build ship) through
// the canonical launchApp() from e2e/lib/launch.cjs, opens the bundled
// "report" sample, and asserts the exact DOM states DEF-214 recorded as
// missing in v1.16.1:
//
//   1. .ann-toolbar is IN the DOM below the CommandBar (v1.16.1: absent).
//   2. [data-toolbar-edit-toggle] exists in the CommandBar
//      (v1.16.1: absent, Edit mode unreachable).
//   3. Arming an edit tool mounts .edit-layer (v1.16.1: unreachable; Phase 41
//      item 2 retired the legacy .edit-toolbar).
//   4. Zero renderer console errors / uncaught page errors after open
//      (v1.16.1 had none either - the renderer never crashed; the
//      components simply never mounted from the stale bundle).
//
// The executable defaults to <repo>/release/win-unpacked/TFlex.exe and can
// be pointed at any packaged build (e.g. an NSIS-installed exe) via the
// TFLEX_PACKAGED_EXE env var. Screenshots: screenshots/def214-v1170-*.png.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { shot, hardClose, dismissUpdatePrompt } = require('./lib/helpers.cjs');

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(__dirname, '..', 'release', 'win-unpacked', 'TFlex.exe');

test('DEF-214 re-verify: v1.17.0 packaged build mounts .ann-toolbar, the CommandBar Edit toggle, and .edit-layer when armed', async () => {
  test.setTimeout(180000);

  const electronApp = await launchApp([], null, PACKAGED_EXE);
  const window = await electronApp.firstWindow();
  try {
    await window.waitForSelector('.sample-card', { timeout: 30000 });
    // DEF-172: keep a stray OTA update prompt from intercepting clicks on a
    // packaged build (no-op when the build is up to date / offline).
    await dismissUpdatePrompt(window);

    // Renderer console / page-error capture from the moment of open.
    const consoleMsgs = [];
    const pageErrors = [];
    window.on('console', (msg) => {
      const t = msg.type();
      if (t === 'error' || t === 'warning') consoleMsgs.push(`${t}: ${msg.text().slice(0, 300)}`);
    });
    window.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)));

    // Open the bundled "report" sample from the welcome screen.
    await window.locator('.sample-card:has-text("report")').first().click();
    await window.waitForSelector('.workspace', { timeout: 30000 });
    await window.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    consoleMsgs.length = 0;
    pageErrors.length = 0;
    await window.waitForTimeout(2000); // settle

    // 1. The annotation toolbar is IN the DOM and visible (the v1.16.1
    //    defect: the element did not exist at all).
    const ann = window.locator('.ann-toolbar');
    await ann.waitFor({ timeout: 15000, state: 'visible' });
    const annBox = await ann.boundingBox();
    expect(annBox, '.ann-toolbar must have a non-zero bounding box').not.toBeNull();
    expect(annBox.height, '.ann-toolbar must be a visible row, not zero-height').toBeGreaterThan(0);
    console.log(`[def214] .ann-toolbar visible: ${JSON.stringify(annBox)}`);
    await shot(window, 'def214-v1170-ann-toolbar.png');

    // 2. The CommandBar carries the Edit toggle (v1.16.1: absent).
    const editToggle = window.locator('[data-toolbar-edit-toggle]');
    await editToggle.waitFor({ timeout: 15000 });
    expect(await editToggle.count()).toBe(1);
    console.log('[def214] [data-toolbar-edit-toggle] present in CommandBar');

    // 3. Arming Edit mode enables the edit layer (v1.16.1: unreachable).
    //    Phase 41 (item 2) — the legacy edit toolbar is retired; the edit layer
    //    (mounted when a tool is armed) is the observable.
    await editToggle.click();
    await window.waitForTimeout(400);
    const editVerb = window.locator('[data-dock-verb="editTextBox"]');
    await editVerb.waitFor({ timeout: 10000, state: 'visible' });
    await editVerb.click();
    await window.waitForTimeout(400); // enter animation settle
    const editLayer = window.locator('.edit-layer');
    await editLayer.waitFor({ timeout: 10000, state: 'attached' });
    const editBox = await editLayer.boundingBox();
    expect(editBox, '.edit-layer mounted after arming an edit tool').not.toBeNull();
    console.log(`[def214] .edit-layer mounted after arming: ${JSON.stringify(editBox)}`);
    await shot(window, 'def214-v1170-editmode.png');

    // 4. No renderer console errors / uncaught page errors after open.
    console.log(`[def214] post-open console errors/warnings: ${consoleMsgs.length}`);
    for (const m of consoleMsgs.slice(0, 20)) console.log(`  ${m}`);
    console.log(`[def214] post-open uncaught page errors: ${pageErrors.length}`);
    for (const m of pageErrors.slice(0, 10)) console.log(`  ${m}`);
    expect(pageErrors, 'no uncaught renderer page errors after open').toEqual([]);
  } finally {
    await hardClose(electronApp, 'def214-reverify');
  }
});