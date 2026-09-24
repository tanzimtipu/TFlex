// Adversary Phase-37 probe helpers. Dev-only; not part of the product or the
// e2e suite. Launches the real dev build through e2e/lib/launch.cjs.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../e2e/lib/launch.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots', 'adv-p37');
const OUT = path.join(__dirname, 'out');
const FIX = path.join(ROOT, 'test-fixtures');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

async function boot(opts = {}) {
  const userDataDir = opts.userDataDir || path.join(__dirname, 'userdata', opts.profile || 'default');
  ensureDir(userDataDir);
  const app = await launchApp(['--disable-gpu', '--no-sandbox'], userDataDir);
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
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

// Open an arbitrary fixture path (copied first).
async function openPath(app, window, absPath) {
  const dst = path.join(__dirname, 'samples', `${Date.now()}-${path.basename(absPath)}`);
  ensureDir(path.dirname(dst));
  fs.copyFileSync(absPath, dst);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, dst);
  await window.locator('button:has-text("Open PDF")').first().click({ timeout: 15000 });
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

// Exact inner-size resize via the main process (innerWidth === content box).
async function setContentSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes('tfWindow=print'));
    if (!win) return;
    win.setContentSize(size.w, size.h);
  }, { w, h });
}

function writeOut(name, obj) {
  ensureDir(OUT);
  fs.writeFileSync(path.join(OUT, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wedge-proof teardown: a modified document raises the DEF-142 close gate, so
// destroy every window first, then close with a bound.
async function safeClose(app) {
  try {
    await Promise.race([
      app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().forEach((w) => { try { w.destroy(); } catch (_) {} }); }),
      sleep(8000),
    ]);
  } catch (_) {}
  try { await Promise.race([app.close(), sleep(10000)]); } catch (_) {}
}

module.exports = { boot, openSample, openPath, shot, gotoStage, setContentSize, writeOut, sleep, ensureDir, safeClose, ROOT, SHOTS, OUT, FIX };
