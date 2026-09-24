// Adversary Phase-36 probe helpers. Dev-only; not part of the product or the
// e2e suite. Launches the real dev build through e2e/lib/launch.cjs.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../e2e/lib/launch.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

async function boot(opts = {}) {
  const userDataDir = opts.userDataDir || path.join(__dirname, 'userdata', opts.profile || 'default');
  ensureDir(userDataDir);
  const app = await launchApp(['--disable-gpu', '--no-sandbox'], userDataDir);
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  // Dismiss a pending update prompt if one appears.
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const open = await window.evaluate(() =>
      !!document.querySelector('[data-update-prompt], .sheet-update-prompt'));
    if (open) {
      await window.locator('[data-update-prompt-cancel], [data-update-prompt-later], [data-update-prompt-close]')
        .first().click({ timeout: 3000 }).catch(() => {});
      await window.keyboard.press('Escape').catch(() => {});
      break;
    }
    const st = await window.evaluate(async () => {
      try {
        const api = window.tflex && window.tflex.update;
        if (!api || typeof api.getStatus !== 'function') return null;
        return await api.getStatus();
      } catch (_) { return null; }
    }).catch(() => null);
    if (st && (st.kind === 'up-to-date' || st.kind === 'error' || st.kind === 'unsupported')) break;
    await window.waitForTimeout(400);
  }
  return { app, window, userDataDir };
}

// Open a copy of a bundled sample (never the original fixture).
async function openSample(app, window, name) {
  const src = path.join(ROOT, 'assets', 'samples', name);
  const dst = path.join(__dirname, 'samples', `${Date.now()}-${name}`);
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, dst);
  const btn = window.locator('button:has-text("Open PDF")').first();
  await btn.click({ timeout: 15000 });
  await window.waitForSelector('.workspace', { timeout: 30000 });
  await window.waitForTimeout(800);
  return dst;
}

async function shot(window, name) {
  ensureDir(SHOTS);
  const file = path.join(SHOTS, name);
  await window.screenshot({ path: file }).catch(() => {});
  return file;
}

async function gotoStage(window, n) {
  await window.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await window.keyboard.press(`Control+${n}`);
  await window.waitForTimeout(400);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { boot, openSample, shot, gotoStage, sleep, ensureDir, ROOT, SHOTS };
