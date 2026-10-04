'use strict';
// TFL-684 verification probe (CDP variant).
//
// The stock adversary probe (test-fixtures/tfl524-adversary/probe-plus-occlusion.cjs)
// uses playwright-core's _electron.launch, which passes --remote-debugging-port=0.
// Electron 44 rejects that switch ("bad option"), so the launch dies and the
// probe cannot run in this environment. This variant launches electron with a
// FIXED debug port and attaches over CDP, then runs the identical measurement:
// at the 640px minimum with N tabs, classify elementFromPoint over the "+" box
// and raw-click the "+" centre to see whether it opens or closes a tab.
//
// Run from the repo root: node test-fixtures/tfl684-plus-hit/probe-cdp.cjs

const path = require('node:path');
const os = require('node:os');
const { spawn, execSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { chromium } = require('@playwright/test');
const electron = require('electron');

const ROOT = path.resolve(__dirname, '../..');
const RENDERER_URL = pathToFileURL(path.join(ROOT, 'dist/renderer/index.html')).href;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort(port, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`CDP port not ready: ${port}`);
}

const SAMPLE = () => {
  const plus = document.querySelector('[data-new-tab]');
  const r = (el) => {
    const b = el.getBoundingClientRect();
    return { top: +b.top.toFixed(2), left: +b.left.toFixed(2), width: +b.width.toFixed(2), height: +b.height.toFixed(2) };
  };
  const classify = (el) => {
    if (!el) return 'none';
    if (el.closest('[data-new-tab]')) return 'plus';
    if (el.closest('.tab-close')) return 'close';
    if (el.closest('[data-tab-id]')) return 'tab';
    return el.tagName ? el.tagName.toLowerCase() : 'none';
  };
  const plusRect = plus ? r(plus) : null;
  const grid = [];
  if (plusRect) {
    for (let iy = 1; iy <= 4; iy += 1) {
      for (let ix = 1; ix <= 4; ix += 1) {
        const x = plusRect.left + (plusRect.width * ix) / 5;
        const y = plusRect.top + (plusRect.height * iy) / 5;
        grid.push(classify(document.elementFromPoint(x, y)));
      }
    }
  }
  const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
  const active = tabs.find((t) => t.getAttribute('aria-selected') === 'true') || null;
  return {
    count: tabs.length,
    activeId: active ? active.getAttribute('data-tab-id') : null,
    tabWidth: active ? +active.getBoundingClientRect().width.toFixed(2) : null,
    plus: plusRect,
    centerHit: plusRect
      ? classify(document.elementFromPoint(plusRect.left + plusRect.width / 2, plusRect.top + plusRect.height / 2))
      : 'none',
    plusHitCount: grid.filter((g) => g === 'plus').length,
    grid,
  };
};

async function connect(ctx, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const p of ctx.pages()) {
      try {
        if (await p.$('.sample-card')) return p;
      } catch {}
    }
    await sleep(300);
  }
  throw new Error(`welcome page not found; pages=${ctx.pages().map((p) => p.url()).join(',')}`);
}

async function runCount(target) {
  const port = 9400 + target;
  const userData = path.join(os.tmpdir(), `tfl684-cdp-${target}-${Date.now()}`);
  const env = { ...process.env, ELECTRON_RENDERER_URL: RENDERER_URL };
  // The harness exports ELECTRON_RUN_AS_NODE=1, which makes electron run the
  // main script as plain Node (app is undefined) and kills the CDP port.
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    electron,
    ['.', '--no-sandbox', `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  try {
    await waitPort(port, 40000);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = await connect(browser.contexts()[0], 25000);
    await page.waitForSelector('.sample-card', { timeout: 30000 });
    await page.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
    await page.waitForSelector('.workspace', { timeout: 30000 });
    await sleep(900);
    let guard = 0;
    while ((await page.locator('[data-tab-id]').count()) < target && guard < 30) {
      guard += 1;
      const plus = page.locator('[data-new-tab]');
      if ((await plus.count()) === 0) break;
      await plus.first().click({ timeout: 4000 }).catch(() => {});
      await sleep(250);
    }
    await page.setViewportSize({ width: 640, height: 800 });
    await sleep(600);
    const s = await page.evaluate(SAMPLE);
    console.log(`[occl n=${target}] count=${s.count} tabW=${s.tabWidth} centerHit=${s.centerHit} plusHits=${s.plusHitCount}/16 grid=${JSON.stringify(s.grid)}`);

    const cx = s.plus.left + s.plus.width / 2;
    const cy = s.plus.top + s.plus.height / 2;
    const before = await page.evaluate(SAMPLE);
    await page.mouse.click(cx, cy);
    await sleep(700);
    const after = await page.evaluate(SAMPLE);
    const verdict =
      after.count === before.count + 1 ? 'opened a tab (OK)'
        : after.count === before.count - 1 ? 'CLOSED a tab (WRONG TARGET)'
          : after.count === before.count ? 'no count change' : `unexpected ${before.count}->${after.count}`;
    console.log(`[click n=${target}] raw +-centre (${cx.toFixed(1)},${cy.toFixed(1)}): ${before.count}->${after.count} active ${before.activeId}->${after.activeId} -> ${verdict}`);
    await page.screenshot({ path: path.join(__dirname, `plus-hit-${target}.png`) }).catch(() => {});
    await browser.close().catch(() => {});
  } finally {
    try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch {}
    await sleep(400);
  }
}

(async () => {
  for (const n of [11, 14]) {
    try { await runCount(n); } catch (e) { console.log(`[occl n=${n}] threw: ${e.message}`); }
  }
})();
