// Triage probe (temporary, deleted after triage): does a real click on page 1
// with the Text box tool armed produce the pending editor + action bar?
// Dumps diagnostics at every step. Not a launcher — standard launchDev.
const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchDev, diag, hardClose } = require('../lib/helpers.cjs');
const { getSamplePath } = require('../lib/launch.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

test('probe: textbox ghost placement mechanics', async () => {
  const r = await launchDev();
  const electronApp = r.electronApp;
  const win = r.window;
  const pageErrors = [];
  win.on('pageerror', (e) => {
    const m = e && e.message ? e.message : String(e);
    pageErrors.push(m);
    process.stdout.write(`[PROBE-PAGEERROR] ${m}\n`);
  });

  const p = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2500);

  const dump = async (label) => {
    const d = await diag(win);
    const dom = await win.evaluate(() => ({
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()),
      textboxEditor: !!document.querySelector('[data-annotation-editor="textbox"]'),
      confirmBar: !!document.querySelector('[data-annotation-action="textbox-confirm"]'),
      anyBar: !!document.querySelector('[data-annotation-action-bar]'),
      slotBox: (() => {
        const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
        const slot = pane && pane.querySelector('.page-slot[data-page="1"]');
        if (!slot) return null;
        const r = slot.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      })(),
      winSize: { w: window.innerWidth, h: window.innerHeight },
      buttons: [...document.querySelectorAll('.ann-toolbar button[data-tool]')].map(
        (b) => `${b.getAttribute('data-tool')}:${b.getAttribute('aria-pressed')}`,
      ),
    }));
    const line = `tool=${d.activeTool} modified=${d.modified} dom=${JSON.stringify(dom)}`;
    console.log(`[PROBE ${label}] ${line}`);
    return { d, dom };
  };

  const s0 = await dump('open');
  console.log('[PROBE] launch + open done; slot box:', JSON.stringify(s0.dom.slotBox), 'win', JSON.stringify(s0.dom.winSize));

  await win.click('.ann-toolbar button[data-tool="textbox"]');
  await win.waitForTimeout(500);
  const s1 = await dump('after arm');
  console.log('activeTool after arm =', s1.d.activeTool);

  const slot = s1.d.slotBox || s1.dom.slotBox;
  const clickX = slot.x + slot.w * 0.4;
  const clickY = slot.y + slot.h * 0.45;
  console.log(`[PROBE] clicking page at (${Math.round(clickX)}, ${Math.round(clickY)})`);
  await win.mouse.move(clickX - 5, clickY - 5);
  await win.mouse.move(clickX, clickY);
  await win.mouse.down();
  await win.waitForTimeout(80);
  await win.mouse.up();
  await win.waitForTimeout(900);
  const s2 = await dump('after page click');
  await win.screenshot({ path: path.join(SHOTS, 'def-211-probe-after-click.png') });

  console.log(`[PROBE] verdict: confirmBar=${s2.dom.confirmBar} editor=${s2.dom.textboxEditor} tool=${s2.d.activeTool}`);
  console.log(`[PROBE] pageerrors=${JSON.stringify(pageErrors)}`);
  await hardClose(electronApp);
});