// Phase 91 adversarial diff-pass — DISCOVERY pass (read-only).
// Maps the LIVE migrated surfaces to concrete selectors/state before the real
// attack spec asserts anything. Launch only via e2e/lib/launch.cjs.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require(path.resolve(__dirname, '..', '..', 'e2e', 'lib', 'launch.cjs'));
const { hardClose, gotoStage, ensurePanelExpanded, openAnnotationFlyout } = require(
  path.resolve(__dirname, '..', '..', 'e2e', 'lib', 'helpers.cjs'),
);

delete process.env.ELECTRON_RUN_AS_NODE;
const USER_DATA = path.join(os.tmpdir(), `tflex-p91-adv-disc-${Date.now()}`);
test.setTimeout(600000);

let app;
let win;

const dump = async (label, sel) => {
  const out = await win.evaluate((s) => {
    const els = Array.from(document.querySelectorAll(s));
    return {
      count: els.length,
      items: els.slice(0, 40).map((e) => ({
        tag: e.tagName,
        data: Array.from(e.attributes)
          .filter((a) => a.name.startsWith('data-'))
          .map((a) => `${a.name}=${a.value}`),
        cls: Array.from(e.classList),
        ariaLabel: e.getAttribute('aria-label'),
        title: e.getAttribute('title'),
        pressed: e.getAttribute('aria-pressed'),
        disabled: e.disabled === true || e.getAttribute('disabled') !== null,
        text: (e.textContent || '').trim().slice(0, 30),
        visible: e.getClientRects().length > 0,
      })),
    };
  }, sel);
  console.log(`\n[DISC] ${label} sel=${sel} count=${out.count}`);
  for (const it of out.items) console.log(`   ${JSON.stringify(it)}`);
  return out;
};

test('P91 discovery', async () => {
  app = await launchApp([], USER_DATA);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  try {
    await dump('welcome tools', '[data-home-tool]');
    await dump('home edit toggle', '[data-home-edit-toggle]');
    await dump('welcome region btns', '[data-home-tools] button');
    console.log('[DISC] diag', JSON.stringify(await win.evaluate(() => {
      const d = window.tflexDiagnostics();
      return { keys: Object.keys(d), engineKeys: d.engineState ? Object.keys(d.engineState) : null, pageCount: d.pageCount, currentPage: d.currentPage };
    })));

    await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForTimeout(900);

    await dump('command bar btns', '.toolbar button');
    await dump('app header toolbar', '[data-toolbar-open], [data-toolbar-save], [data-toolbar-save-as], [data-new-tab], [data-header-multi-mode], [data-header-find]');
    await dump('titlebar menus', '[data-menu-button]');

    for (const st of [1, 2, 3, 4]) {
      await gotoStage(win, st);
      await win.waitForTimeout(300);
      const active = await win.evaluate(() => document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage'));
      console.log(`[DISC] stage ${st} active=${active} toolbarVisible=${await win.locator('.toolbar').first().isVisible().catch(() => false)}`);
      await dump(`stage-${st} context panel actions`, '[data-context-panel-action]');
      await dump(`stage-${st} dock verbs`, '[data-dock-verb]');
      await dump(`stage-${st} rail tabs`, '[data-rail-tab]');
    }

    await gotoStage(win, 1);
    await ensurePanelExpanded(win);
    await dump('blank scan open', '[data-blank-scan-open]');
    await dump('context panel combine', '[data-context-panel-combine]');
    await dump('page layout options', '[data-page-layout-option]');
    await dump('canvas pills', '[data-page-pill] button, [data-zoom-pill] button');

    // inspector
    await dump('inspector', '[data-inspector]');
    const collapsed = await win.locator('[data-inspector][data-inspector-collapsed="true"]').count();
    if (collapsed > 0) { await win.locator('[data-inspector-collapse]').first().click(); await win.waitForTimeout(400); }
    await dump('inspector actions', '[data-inspector-action]');

    // side rail annotations tab
    await dump('rail tabs attrs', '[data-rail-tab]');

    // stage rail buttons
    await dump('stage rail buttons', '[data-stage]');

    // search bar
    await win.keyboard.press('Control+f');
    await win.waitForTimeout(500);
    await dump('search bar', '.search-bar button');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    // annotation flyout + toolbar
    await openAnnotationFlyout(win);
    await dump('ann flyout controls', '[data-annotation-flyout] button');
    await dump('ann tools visible', '[data-ann-tools-visible] button');
    await dump('ann dropdown toggle', '[data-ann-dropdown-toggle]');

    // redact via palette
    await win.keyboard.press('Control+k');
    await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 10000 });
    await win.locator('[data-command-palette-input]').fill('Redact');
    await win.waitForTimeout(400);
    const row = win.locator('[data-palette-tool-id="redact"]').first();
    if ((await row.count()) > 0) await row.click(); else await win.keyboard.press('Enter');
    await win.waitForSelector('.redact-modes', { state: 'visible', timeout: 10000 }).catch(() => {});
    await dump('redact modes', '.redact-modes .redact-mode');

    // context menu
    await gotoStage(win, 1);
    await ensurePanelExpanded(win);
    const thumb = win.locator('[data-context-panel] .thumb-item[data-page="1"]').first();
    await thumb.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await thumb.scrollIntoViewIfNeeded().catch(() => {});
    await thumb.click({ button: 'right' }).catch(() => {});
    await win.waitForTimeout(400);
    await dump('context menu items', '[data-context-menu] [data-menu-item]');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(200);

    console.log('\n[DISC] DONE');
  } finally {
    await hardClose(app, 'p91-discovery');
  }
});
