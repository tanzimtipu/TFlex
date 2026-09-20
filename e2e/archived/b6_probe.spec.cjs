const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');

let electronApp = null;
let window = null;

async function launch() {
  electronApp = await launchApp([]);
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
}
async function close() { if (electronApp) await hardClose(electronApp); electronApp = null; }
async function openSample(name) {
  await window.click(`.sample-card:has-text("${name}")`);
  await window.waitForSelector('.workspace', { timeout: 15000 });
  await window.waitForTimeout(1500);
}
async function snap(name) { await window.screenshot({ path: `screenshots/${name}.png` }); }

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

test('B6 probe: clicking a text run in Edit mode', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await window.click('[data-toolbar-edit-toggle]');
  await window.waitForSelector('[data-edit-toolbar]');
  await window.click('[data-edit-tool="text"]');
  await window.waitForTimeout(400);

  const diag = await window.evaluate(() => window.tflexDiagnostics());
  console.log('B6 edit active diag:', JSON.stringify(diag));

  const spans = await window.evaluate(() => {
    const out = [];
    document.querySelectorAll('.textLayer span, .textLayer [class*="text"]').forEach((s) => {
      const r = s.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: (s.textContent || '').slice(0, 20) });
    });
    return out;
  });
  // find a title-like span (large, top) and a body span
  const title = spans.find(s => s.y >= 300 && s.y < 420 && s.w > 100) || spans[0];
  console.log('B6 chosen title span:', JSON.stringify(title));

  // hover then click
  await window.mouse.move(title.x + title.w / 2, title.y + title.h / 2);
  await window.waitForTimeout(400);
  const hoverCount = await window.locator('.edit-text-hover').count();
  console.log('B6 hover rect count:', hoverCount);
  await snap('b6-click-before');
  await window.mouse.click(title.x + title.w / 2, title.y + title.h / 2);
  await window.waitForTimeout(800);

  const state = await window.evaluate(() => {
    const editor = document.querySelector('[data-edit-editor="text"]');
    const ta = document.querySelector('[data-edit-textarea]');
    const anyInput = document.querySelector('[data-edit-editor] input, [data-edit-editor] textarea, [contenteditable="true"]');
    const overlay = document.querySelector('.edit-overlay');
    const activeRun = document.querySelector('.edit-text-active, .edit-text-selected, [data-edit-active]');
    const hover = document.querySelector('.edit-text-hover');
    return {
      editorCount: !!editor,
      taCount: !!ta,
      anyInputCount: !!anyInput,
      overlayPresent: !!overlay,
      activeRunPresent: !!activeRun,
      presentAfterClick: !!document.querySelector('[data-edit-editor], [data-edit-textarea]'),
    };
  });
  console.log('B6 after click state:', JSON.stringify(state));
  await snap('b6-click-after');
});
