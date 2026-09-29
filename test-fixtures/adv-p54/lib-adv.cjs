// Phase 54 adversary app-level harness helpers. Launches the REAL built app
// through the canonical e2e/lib/launch.cjs helper and drives the product's own
// renderer bridge (window.tflex.convert / engine / validation).
'use strict';

const path = require('node:path');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const { PDFDocument } = require('@cantoo/pdf-lib');

const FIX = __dirname;
const fix = (name) => path.join(FIX, name);

async function launch() {
  const app = await launchApp();
  const win = await app.firstWindow();
  const logs = [];
  win.on('console', (m) => logs.push(`[console:${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
  return { app, win, logs };
}

async function close({ app }, label) {
  try {
    await hardClose(app, label);
  } catch (e) {
    process.stdout.write(`hardClose threw: ${e.message}\n`);
  }
}

/** Race an evaluate against a Node-side deadline. On timeout returns {timedOut:true}. */
async function withDeadline(promise, ms, label) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timedOut: true, label }), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Convert one or many paths via the real conversion bridge. Never throws. */
async function convertMany(win, docId, paths, { timeoutMs = 90000, options } = {}) {
  const t0 = Date.now();
  const call = win
    .evaluate(
      ({ id, p, o }) => window.tflex.convert.toDocumentMany(id, p, o),
      { id: docId, p: paths, o: options },
    )
    .then((r) => ({ result: r }))
    .catch((e) => ({ throw: String(e && e.message ? e.message : e) }));
  const r = await withDeadline(call, timeoutMs, 'toDocumentMany');
  return { ...r, ms: Date.now() - t0 };
}

async function convertOne(win, docId, filePath, opts = {}) {
  return convertMany(win, docId, [filePath], opts);
}

/** Read a converted doc's bytes back through the engine and parse page sizes. */
async function pageSizes(win, docId) {
  const res = await win
    .evaluate(async (id) => {
      const r = await window.tflex.engine.getDocumentBytes(id);
      if (!r || !r.ok) return { error: r ? r.error : 'no result' };
      const bytes = new Uint8Array(r.value);
      let bin = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return { b64: btoa(bin), size: bytes.length };
    }, docId)
    .catch((e) => ({ error: String(e && e.message ? e.message : e) }));
  if (res.error) return { error: res.error };
  const buf = Buffer.from(res.b64, 'base64');
  const doc = await PDFDocument.load(buf, {
    ignoreEncryption: true,
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
  const sizes = doc.getPages().map((p) => p.getSize());
  return { sizeBytes: res.size, pageCount: doc.getPageCount(), sizes };
}

/** Is the renderer still alive and responsive? */
async function usable(win) {
  try {
    return await withDeadline(
      win.evaluate(() => document.querySelectorAll('.sample-card').length > 0 || document.querySelector('.workspace') !== null),
      5000,
      'usable',
    );
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
}

/** Validate raw bytes against a target through the real bridge. */
async function validateBytes(win, filePath, target, timeoutMs = 90000) {
  const b64 = require('node:fs').readFileSync(filePath).toString('base64');
  const t0 = Date.now();
  const call = win
    .evaluate(
      async ({ b, t }) => {
        const bin = atob(b);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        return window.tflex.validation.validateBytes(bytes, t);
      },
      { b: b64, t: target },
    )
    .then((r) => ({ result: r }))
    .catch((e) => ({ throw: String(e && e.message ? e.message : e) }));
  const r = await withDeadline(call, timeoutMs, 'validateBytes');
  return { ...r, ms: Date.now() - t0 };
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

module.exports = { launch, close, convertMany, convertOne, pageSizes, usable, validateBytes, fix, out, withDeadline };
