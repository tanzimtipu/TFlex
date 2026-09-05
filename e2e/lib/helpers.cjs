// Shared driving helpers for the v1.7.11 deep sweep. Canonical under e2e/lib.
// Only qa writes here. launchDev() (dev build) is the DEFAULT for every
// standard/regression/sweep spec; launchInstalled() is ONLY for specs under
// e2e/installed/, when the orchestrator explicitly asks for installed-app runs.

const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const { launchApp, getSamplePath } = require('./launch.cjs');

const INSTALLED = path.join(process.env.LOCALAPPDATA, 'Programs', 'tflex', 'TFlex.exe');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

// Bound window so `shot(name)` works without threading `win` through every call.
let currentWin = null;

// DEV build launch - the standard for the whole e2e suite. Never pass an
// executablePath from a spec; the installed app is launched only from
// e2e/installed/* specs via launchInstalled().
async function launchDev(extraArgs = []) {
  const electronApp = await launchApp(extraArgs, null, null);
  const window = await electronApp.firstWindow();
  await window.waitForSelector('.sample-card', { timeout: 30000 });
  currentWin = window;
  return { electronApp, window };
}

// INSTALLED-app launch. e2e/installed/* ONLY - never from a standard spec.
async function launchInstalled(extraArgs = []) {
  const electronApp = await launchApp(extraArgs, null, INSTALLED);
  const window = await electronApp.firstWindow();
  await window.waitForSelector('.sample-card', { timeout: 30000 });
  currentWin = window;
  return { electronApp, window };
}

async function openSample(window, electronApp, name) {
  const samplePath = getSamplePath(name);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, samplePath);
  await window.locator('button:has-text("Open PDF")').first().click();
  await window.waitForSelector('.workspace', { timeout: 30000 });
  return samplePath;
}

async function openSamplePath(window, electronApp, absolutePath) {
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, absolutePath);
  await window.locator('button:has-text("Open PDF")').first().click();
  await window.waitForSelector('.workspace', { timeout: 30000 });
}

async function diag(window) {
  return window.evaluate(() => window.tflexDiagnostics());
}

// Step-scroll the (virtualized) document scroller until the requested page-slot
// is mounted, then nudge it near the top of the viewport so pointer gestures on
// it land on the page, not on the toolbar / window chrome.
async function scrollToPage(window, n) {
  for (let i = 0; i < 50; i += 1) {
    const done = await window.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return true;
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (slot) {
        sc.scrollTop = slot.offsetTop - 100;
        return true;
      }
      sc.scrollTop += 1200;
      return false;
    }, n);
    await window.waitForTimeout(250);
    if (done) break;
  }
  await window.waitForTimeout(900);
}

async function shot(windowOrName, name) {
  // Support both shot(win, 'name.png') and shot('name.png') (uses currentWin).
  const w = (name === undefined) ? currentWin : windowOrName;
  const n = (name === undefined) ? windowOrName : name;
  const p = path.join(SHOTS, n);
  await w.screenshot({ path: p });
  return p;
}

// Sample the page-1 canvas's pixels inside a PAGE-RELATIVE css rect
// { x, y, w, h } (css px measured from the .pdf-page[data-page="1"]
// element's top-left). Returns the dominant rgb colors with counts and the
// dark-glyph pixel count. Used by the DEF-173/174 reopen specs to prove the
// canvas-rendered annotation color (pale translucent wash vs full-opacity
// block) without trusting screenshots alone.
async function sampleCanvasPageRect(window, relRect, pageNo = 1) {
  return window.evaluate(({ rel, want }) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const page = pane && pane.querySelector(`.pdf-page[data-page="${want}"]`);
    const canvas = page && page.querySelector('canvas');
    if (!page || !canvas) return null;
    const pb = page.getBoundingClientRect();
    const cb = canvas.getBoundingClientRect();
    const sx = canvas.width / cb.width;
    const sy = canvas.height / cb.height;
    const x0 = Math.max(0, Math.round((rel.x + (pb.left - cb.left)) * sx));
    const y0 = Math.max(0, Math.round((rel.y + (pb.top - cb.top)) * sy));
    const w = Math.max(1, Math.min(canvas.width - x0, Math.round(rel.w * sx)));
    const h = Math.max(1, Math.min(canvas.height - y0, Math.round(rel.h * sy)));
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(x0, y0, w, h);
    const counts = {};
    let darkGlyphs = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      const key = `${r},${g},${b}`;
      counts[key] = (counts[key] || 0) + 1;
      if (r < 100 && g < 100 && b < 100) darkGlyphs += 1;
    }
    const topColors = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([rgb, n]) => {
        const [r, g, b] = rgb.split(',').map(Number);
        return { rgb: [r, g, b], n };
      });
    return { bboxCanvasPx: [x0, y0, w, h], topColors, darkGlyphs };
  }, { rel: relRect, want: pageNo });
}

// Dump key engine-state pieces for diagnosis.
async function dumpEngine(window, label) {
  const out = await window.evaluate(() => {
    const d = window.tflexDiagnostics();
    const e = d.engineState || {};
    const res = {
      pageCount: d.pageCount,
      currentPage: d.currentPage,
      modified: d.modified,
      tabModified: d.tabModified,
      canUndo: d.canUndo,
      canRedo: d.canRedo,
      activeTool: d.activeTool,
      theme: d.theme,
      annotations: e.annotations || [],
      pageOrder: e.pageOrder && e.pageOrder.slice(0, 12),
      rotations: e.rotations && e.rotations.slice(0, 12),
      pageOrderLen: e.pageOrder ? e.pageOrder.length : null,
    };
    return res;
  });
  console.log(`[${label}] ${JSON.stringify(out)}`);
  return out;
}

// Force-destroy the window(s) so the DEF-142 close gate (which would prompt on
// a modified doc and hang electronApp.close) cannot block teardown. Only qa
// may edit this helper.
//
// Wedge-proofing (def_085 escalation, 2026-09-06). electronApp.close() waits
// for the launched process tree to exit: on Windows Playwright launches
// Electron through a cmd.exe shell, and the shell's 'close' event (what
// close() ultimately awaits) fires only once the WHOLE tree has exited and
// every inherited stdio pipe is closed. When teardown lands while a
// renderer/GPU operation is still in flight (repro: a Playwright
// window.screenshot() taken immediately before hardClose), Chromium's quit
// wedges mid-shutdown and the tree stays alive indefinitely, so close() never
// settles and the afterEach hangs the whole runner. Diagnosis (one-off
// harnesses, deleted after the fix; evidence reproduced 5x):
//   - destroy with no CDP activity before it  -> app quits in ~150ms;
//   - screenshot then immediate destroy       -> whole tree (main, gpu,
//     renderer, network utility, shell) still alive at 45s, close() hung;
//   - killing ONLY the main process (process.exit(0)) does NOT unwedge:
//     the orphaned gpu/renderer children keep the inherited pipes open;
//   - taskkill /pid <shell> /T /F unwedges: close() resolved ~300ms later.
// This is a test-harness race, not a product defect (normal quit, and quit
// after a settle delay, always completes). So hardClose now bounds every
// wait, dumps state on the fallback path, and tree-kills the app exactly
// like Playwright's own killProcess. hardClose must never hang.
const DESTROY_GRACE_MS = 10000;
const CLOSE_GRACE_MS = 10000;
const KILL_SETTLE_MS = 15000;

async function bounded(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Snapshot the app's process tree (external, works even when CDP is dead).
function appTreeDump(rootPid) {
  try {
    const lines = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress"',
      { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const all = JSON.parse(lines);
    const arr = Array.isArray(all) ? all : [all];
    const out = [];
    const walk = (pid, depth) => {
      for (const p of arr.filter((x) => x.ParentProcessId === pid)) {
        out.push(`${'  '.repeat(depth)}pid=${p.ProcessId} ${p.Name}`);
        walk(p.ProcessId, depth + 1);
      }
    };
    const root = arr.find((x) => x.ProcessId === rootPid);
    out.push(root ? `pid=${root.ProcessId} ${root.Name}` : `root pid=${rootPid} not found (already exited)`);
    walk(rootPid, 1);
    return out.join('\n');
  } catch (e) {
    return `tree dump failed: ${e.message}`;
  }
}

async function hardClose(electronApp, label = 'hardClose') {
  if (!electronApp) return;
  const t0 = Date.now();
  const log = (msg) => {
    try { process.stdout.write(`[${label} +${Date.now() - t0}ms] ${msg}\n`); } catch (_) { /* stdout gone */ }
  };

  // 1. Destroy all windows (bypasses the DEF-142 close gate). Bounded: a
  //    wedged main must not block the rest of the teardown.
  try {
    await bounded(
      electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((w) => { try { w.destroy(); } catch (_) { /* ignore */ } });
      }),
      DESTROY_GRACE_MS,
      'window destroy',
    );
  } catch (e) {
    log(`window destroy did not confirm: ${e.message} (continuing)`);
  }

  // 2. close() with a bounded wait. Resolves in a few hundred ms normally.
  const closePromise = electronApp.close().catch(() => {});
  let closed = false;
  try {
    await bounded(closePromise, CLOSE_GRACE_MS, 'app close');
    closed = true;
  } catch (_) { /* fall through to diagnostics + force kill */ }
  if (closed) {
    log(`closed normally in ${Date.now() - t0}ms`);
    return;
  }

  // 3. Dump main-process state so the wedge is diagnosable from the log.
  log(`close() did not settle within ${CLOSE_GRACE_MS}ms - dumping state`);
  try {
    const state = await bounded(
      electronApp.evaluate(({ BrowserWindow }) => ({
        openWindows: BrowserWindow.getAllWindows().length,
        activeHandles: process._getActiveHandles().map((h) => {
          const name = (h && h.constructor && h.constructor.name) || typeof h;
          try {
            if (name === 'Timeout') return `${name} idle=${h._idleTimeout}`;
            if (name === 'ChildProcess') return `${name} pid=${h.pid}`;
            if (name === 'Socket' || name === 'Pipe') {
              return `${name} remote=${h.remoteAddress || ''}:${h.remotePort || ''}`;
            }
            return name;
          } catch (_) { return name; }
        }),
      })),
      5000,
      'state evaluate',
    );
    log(`main state: openWindows=${state.openWindows} handles=${JSON.stringify(state.activeHandles)}`);
  } catch (e) {
    log(`main state unavailable (CDP dead or wedged): ${e.message}`);
  }
  const proc = electronApp.process();
  const pid = proc ? proc.pid : null;
  log(`process tree at wedge (shell pid=${pid}):\n${pid ? appTreeDump(pid) : 'no child process handle'}`);

  // 4. Force kill the tree. On Windows the child of record is the cmd.exe
  //    shell, so only a tree kill (/T) reaches the electron processes that
  //    keep the stdio pipes open - same as Playwright's own killProcess.
  if (pid) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 });
        log('force-killed app process tree');
      } else {
        proc.kill('SIGKILL');
        log('force-killed app process');
      }
    } catch (e) {
      log(`force kill failed: ${e.message}`);
    }
  }
  await bounded(closePromise, KILL_SETTLE_MS, 'post-kill close').catch(() => {});
  log(`hardClose done (force path) in ${Date.now() - t0}ms`);
}

module.exports = { launchDev, launchInstalled, openSample, openSamplePath, diag, shot, dumpEngine, getSamplePath, scrollToPage, sampleCanvasPageRect, hardClose };
