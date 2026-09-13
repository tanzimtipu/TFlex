// INSTALLED-APP-ONLY spec. Excluded from the standard suite via
// playwright.config.js testIgnore (e2e/installed/**). Run ONLY via
//   npx playwright test --config=e2e/installed/playwright.installed.config.js
// when the orchestrator explicitly asks to test the installed app.
//
// DEF-172 regression - the OTA update prompt must never block an
// installed-app sweep. Two proofs:
//
//   1. LIVE LAUNCH PATH: launch the installed app through the canonical
//      launchInstalled() helper (which runs dismissUpdatePrompt internally).
//      While the installed build is up to date no prompt exists, so the
//      helper must return fast (getStatus fast-exit, not the full 20s poll)
//      and leave the app clickable.
//
//   2. DISMISS PATH: with the app running, mount the exact UpdatePromptDialog
//      DOM (same .sheet-backdrop / .sheet.sheet-update-prompt structure,
//      title and data-* attributes as src/renderer/components/
//      UpdatePromptDialog.tsx) with a working onClose, prove it intercepts
//      pointer events (elementFromPoint lands on the backdrop - the DEF-172
//      failure mode), then prove dismissUpdatePrompt() detects it, dismisses
//      it via the Cancel button, and the same click lands on the control
//      afterwards.
const { test, expect } = require('@playwright/test');
const { launchInstalled, dismissUpdatePrompt, hardClose } = require('../lib/helpers.cjs');

let electronApp = null;
let win = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ({ electronApp, window: win } = await launchInstalled());
});

test.afterAll(async () => {
  if (electronApp) await hardClose(electronApp);
});

test('DEF-172 A: launchInstalled leaves no update prompt and returns control fast', async () => {
  // The helper already ran inside launchInstalled(). It must have exited via
  // the up-to-date fast path (or a quick DOM poll), not burned the full
  // 20s window - an installed sweep pays this on every launch.
  const t0 = Date.now();
  const dismissed = await dismissUpdatePrompt(win, 20000);
  const elapsed = Date.now() - t0;
  console.log(`[DEF-172] no-prompt run: dismissed=${dismissed} elapsed=${elapsed}ms`);
  expect(dismissed).toBe(false);
  expect(elapsed).toBeLessThan(10000);
  await expect(win.locator('.sheet-backdrop')).toHaveCount(0);
  await expect(win.locator('[data-update-prompt]')).toHaveCount(0);
});

test('DEF-172 B: dismissUpdatePrompt detects and dismisses the update prompt', async () => {
  // Mount the exact prompt DOM from UpdatePromptDialog.tsx with a working
  // onClose (the real Cancel handler closes the dialog).
  await win.evaluate(() => {
    const bd = document.createElement('div');
    bd.className = 'sheet-backdrop';
    bd.setAttribute('role', 'presentation');
    bd.innerHTML = `
      <div class="sheet sheet-update-prompt" role="dialog" aria-modal="true"
           data-update-prompt data-update-prompt-kind="available"
           aria-labelledby="update-prompt-title">
        <header class="sheet-header">
          <h2 id="update-prompt-title" class="sheet-title">Update available</h2>
        </header>
        <div class="sheet-body">
          <p class="update-prompt-text">Update to <strong>v9.9.9</strong> is available.</p>
          <div class="update-prompt-actions">
            <button type="button" class="btn btn-secondary" data-update-prompt-cancel>Cancel</button>
            <button type="button" class="btn btn-primary" data-update-prompt-update>Update</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(bd);
    bd.querySelector('[data-update-prompt-cancel]').addEventListener('click', () => bd.remove());
  });
  await win.waitForSelector('.sheet-update-prompt');

  // Interception proof (the DEF-172 harm): the update prompt's fixed inset-0
  // backdrop owns the pointer at the viewport center - a control click there
  // would hit the overlay, exactly the retry-loop failure mode. Polled: the
  // app restores its window geometry right after launch and the hit-test is
  // briefly unreliable until the compositor settles.
  await expect
    .poll(async () => {
      const probe = await win.evaluate(() => {
        const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        return {
          hit: hit ? String(hit.className || hit.tagName) : '(none)',
          insideBackdrop: !!(hit && hit.closest && hit.closest('.sheet-backdrop')),
        };
      });
      return probe.insideBackdrop ? 'inside' : `outside:${probe.hit}`;
    }, { timeout: 10000 })
    .toBe('inside');

  // Dismiss via the helper (Cancel click path).
  const dismissed = await dismissUpdatePrompt(win, 5000);
  console.log(`[DEF-172] dismiss run: dismissed=${dismissed}`);
  expect(dismissed).toBe(true);
  await expect(win.locator('.sheet-update-prompt')).toHaveCount(0);
  await expect(win.locator('.sheet-backdrop')).toHaveCount(0);

  // Control returned: a real click now lands and drives the app (the first
  // pointer event of a sweep - exactly what the backdrop used to swallow).
  const t0 = Date.now();
  await win.locator('.sample-card').first().click({ timeout: 10000 });
  await win.waitForSelector('.workspace', { timeout: 15000 });
  const clickMs = Date.now() - t0;
  console.log(`[DEF-172] sample-card click after dismissal landed in ${clickMs}ms`);
  expect(clickMs).toBeLessThan(10000);
});
