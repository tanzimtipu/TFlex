// Adversarial Phase-58 probe: Action Dock EDIT mode hostile sequences.
// Adversary probe artifact (test-fixtures/).
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp } = require(REPO + '\\e2e\\lib\\launch.cjs');
const { hardClose, openSamplePath, gotoStage } = require(REPO + '\\e2e\\lib\\helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

function rec(o) { console.log('### ' + JSON.stringify(o)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freshUD(tag) {
  const d = path.join(os.tmpdir(), `tflex-adv-p58-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

async function openReport(win, app) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSamplePath(win, app, path.join(REPO, 'assets', 'samples', 'report.pdf'));
  await win.waitForSelector('[data-action-dock]', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function dockState(win) {
  return win.evaluate(() => {
    const d = document.querySelector('[data-action-dock]');
    const sc = document.querySelector('[data-dock-scroll]');
    return {
      present: !!d,
      edit: d?.getAttribute('data-dock-edit') ?? null,
      verbs: Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => v.getAttribute('data-dock-verb')),
      minusCount: document.querySelectorAll('[data-dock-minus]').length,
      plus: document.querySelectorAll('[data-dock-plus]').length,
      hint: document.querySelector('[data-dock-hint]')?.textContent?.trim() ?? null,
      scrollW: sc?.scrollWidth ?? null,
      clientW: sc?.clientWidth ?? null,
      dockW: d?.getBoundingClientRect().width ?? null,
    };
  });
}

async function main() {
  const scenario = process.argv[2] || 'all';

  // D1: remove EVERY dock verb, then relaunch (same user-data-dir).
  if (scenario === 'd1' || scenario === 'all') {
    let app = null;
    const ud = await freshUD('d1');
    try {
      app = await launchApp([], ud);
      const win = await app.firstWindow();
      await openReport(win, app);
      await win.locator('[data-dock-edit-toggle]').click();
      await win.waitForTimeout(500);
      const before = await dockState(win);

      // Remove every verb, one minus at a time until none remain.
      for (let i = 0; i < 40; i += 1) {
        const n = await win.locator('[data-dock-minus]').count();
        if (n === 0) break;
        await win.locator('[data-dock-minus]').first().click();
        await win.waitForTimeout(450);
      }
      await win.waitForTimeout(800);
      const emptyState = await dockState(win);
      const overflowMenu = await win.locator('[data-dock-overflow]').count();
      await win.screenshot({ path: REPO + '\\screenshots\\adv-p58-d1-dock-empty.png' }).catch(() => {});
      rec({ scenario: 'd1-remove-all', before, emptyState, overflowMenu });

      await sleep(1000);
      await hardClose(app, 'd1-1');
      app = null;

      app = await launchApp([], ud);
      const win2 = await app.firstWindow();
      await openReport(win2, app);
      await win2.waitForTimeout(1000);
      const relaunch = await dockState(win2);
      rec({ scenario: 'd1-remove-all-relaunch', relaunch });
    } catch (e) { rec({ scenario: 'd1', error: String((e && e.stack) || e) }); }
    finally { await hardClose(app, 'd1').catch(() => {}); }
  }

  // D2: rapid edit toggle while a tool is armed / during a page drag.
  if (scenario === 'd2' || scenario === 'all') {
    let app = null;
    try {
      app = await launchApp([], await freshUD('d2'));
      const win = await app.firstWindow();
      await openReport(win, app);
      // Arm a tool (annotate flyout / review) - use stage 3 sign arming as a live arm.
      await gotoStage(win, 3);
      await win.waitForTimeout(400);
      let armed = null;
      try { await win.locator('[data-dock-verb="sign"]').first().click({ timeout: 5000 }); armed = 'sign'; } catch (e) { armed = 'sign-click-err'; }
      await win.waitForTimeout(300);
      // Rapid toggle 8x.
      for (let i = 0; i < 8; i += 1) { await win.locator('[data-dock-edit-toggle]').click({ force: true }).catch(() => {}); await sleep(80); }
      await win.waitForTimeout(1000);
      const state = await dockState(win);
      // Now try a page drag with edit armed.
      await win.mouse.move(700, 500);
      await win.mouse.down();
      await win.mouse.move(760, 560, { steps: 6 });
      await win.mouse.up();
      await win.waitForTimeout(600);
      const after = await dockState(win);
      const dialogs = await win.locator('[role="dialog"]').count();
      rec({ scenario: 'd2-rapid-toggle-armed', armed, state, after, dialogs });
    } catch (e) { rec({ scenario: 'd2', error: String((e && e.stack) || e) }); }
    finally { await hardClose(app, 'd2').catch(() => {}); }
  }

  // D3: add MANY tools through the picker (far more than the stage set) and check scroll/fit.
  if (scenario === 'd3' || scenario === 'all') {
    let app = null;
    try {
      app = await launchApp([], await freshUD('d3'));
      const win = await app.firstWindow();
      await openReport(win, app);
      await win.locator('[data-dock-edit-toggle]').click();
      await win.waitForTimeout(500);
      let added = 0;
      for (let round = 0; round < 30; round += 1) {
        const plus = win.locator('[data-dock-plus]');
        if (await plus.count() === 0) break;
        await plus.first().click();
        await sleep(250);
        const item = win.locator('[data-dock-picker-item]').first();
        if (await item.count() === 0) { await win.keyboard.press('Escape'); break; }
        await item.click();
        added += 1;
        await sleep(300);
      }
      await win.waitForTimeout(800);
      const state = await dockState(win);
      await win.screenshot({ path: REPO + '\\screenshots\\adv-p58-d3-dock-many.png' }).catch(() => {});
      rec({ scenario: 'd3-add-many', added, state });
    } catch (e) { rec({ scenario: 'd3', error: String((e && e.stack) || e) }); }
    finally { await hardClose(app, 'd3').catch(() => {}); }
  }

  console.log('DONE ' + scenario);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
