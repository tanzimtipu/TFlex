// TFL-611 (TFL-513-E1) — live capture + DOM checks for the two flagged
// DialogShell adoption surfaces: EncryptDialog and SignatureManagerModal.
// Read-only against the product: launches the canonical dev app, opens a
// sample, runs each tool through its normal user path, screenshots, and
// asserts the shell contract did not drop the shipped hooks.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, runTool, armSignTool, hardClose, shot } = require('./lib/helpers.cjs');

// Harness exports ELECTRON_RUN_AS_NODE=1; leaving it set makes Electron exit as
// Node ("Process failed to launch!"). Deleting before launchApp spreads env.
delete process.env.ELECTRON_RUN_AS_NODE;

test('TFL-611 DialogShell E1 — EncryptDialog + SignatureManagerModal live check', async () => {
  test.setTimeout(150000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(600);

    // ---- EncryptDialog ----
    const encLane = await runTool(win, 'encrypt');
    await win.waitForSelector('[data-encrypt-dialog]', { state: 'visible', timeout: 15000 });
    await win.waitForTimeout(400);
    const enc = await win.evaluate(() => {
      const root = document.querySelector('.encrypt-dialog');
      const close = document.querySelector('.encrypt-dialog .modal-close');
      return {
        rootClasses: root ? root.className : null,
        hasDataHook: document.querySelectorAll('[data-encrypt-dialog]').length,
        backdrop: document.querySelectorAll('.modal-backdrop').length,
        titleId: document.querySelector('#encrypt-dialog-title') ? document.querySelector('#encrypt-dialog-title').textContent : null,
        closeDisabled: close ? close.disabled : null,
        closePresent: close !== null,
        confirmHook: document.querySelectorAll('[data-encrypt-confirm]').length,
      };
    });
    console.log(`[TFL611 encrypt] lane=${encLane} ${JSON.stringify(enc)}`);
    expect(enc.hasDataHook, 'data-encrypt-dialog on shell root').toBe(1);
    expect(enc.backdrop, 'backdrop rendered').toBe(1);
    expect(enc.rootClasses.split(' '), 'keeps modal-dialog-wide').toContain('modal-dialog-wide');
    expect(enc.rootClasses.split(' '), 'adopted shell class').toContain('dialog-shell');
    expect(enc.rootClasses.split(' '), 'keeps modal-dialog-tool').toContain('modal-dialog-tool');
    expect(enc.confirmHook, 'data-encrypt-confirm preserved').toBe(1);
    const encShot = await shot(win, 'tfl611-encrypt-dialog.png');
    console.log(`[TFL611 encrypt] screenshot=${encShot}`);

    await win.keyboard.press('Escape');
    await win.waitForTimeout(500);

    // ---- SignatureManagerModal ----
    await armSignTool(win);
    await win.waitForSelector('#sig-modal-title', { state: 'visible', timeout: 15000 });
    await win.waitForTimeout(400);
    const sig = await win.evaluate(() => {
      const root = document.querySelector('.sig-manager');
      const tabs = document.querySelector('.sig-manager .modal-tabs');
      const tabsInBody = tabs ? tabs.closest('.modal-body') !== null : false;
      const resize = document.querySelector('.sig-manager .sig-tab-stack');
      const btns = tabs ? tabs.querySelectorAll('button') : [];
      return {
        rootClasses: root ? root.className : null,
        title: document.querySelector('#sig-modal-title') ? document.querySelector('#sig-modal-title').textContent : null,
        tabsPresent: tabs !== null,
        tabsInBody,
        tabCount: btns.length,
        tabLabels: Array.from(btns).map((b) => (b.textContent || '').trim()),
        resizePresent: resize !== null,
      };
    });
    console.log(`[TFL611 signature] ${JSON.stringify(sig)}`);
    expect(sig.title, 'sig-modal-title preserved').toBe('Signature');
    expect(sig.tabsPresent, 'modal-tabs present').toBe(true);
    expect(sig.tabsInBody, 'modal-tabs render inside shell-owned .modal-body').toBe(true);
    expect(sig.tabCount, 'three tabs').toBe(3);
    expect(sig.resizePresent, 'TfResize hook preserved').toBe(true);

    // Tabs clickable: switch to Type and back to Saved.
    const typeTab = win.locator('.sig-manager .modal-tabs button', { hasText: 'Type' }).first();
    await typeTab.click();
    await win.waitForTimeout(400);
    const afterType = await win.evaluate(() => ({
      active: Array.from(document.querySelectorAll('.sig-manager .modal-tabs button')).map((b) => ({ t: (b.textContent || '').trim(), a: b.getAttribute('aria-selected') || b.className })),
      pane: document.querySelector('.sig-manager .sig-tab-stack') ? document.querySelector('.sig-manager .sig-tab-stack').textContent.slice(0, 60) : null,
    }));
    console.log(`[TFL611 signature] afterType=${JSON.stringify(afterType)}`);
    await win.locator('.sig-manager .modal-tabs button', { hasText: 'Saved' }).first().click();
    await win.waitForTimeout(400);
    const savedShot = await shot(win, 'tfl611-signature-manager.png');
    console.log(`[TFL611 signature] screenshot=${savedShot}`);
  } finally {
    await hardClose(app, 'TFL611');
  }
});
