const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');

const EXE_PATH = "C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe";

let electronApp = null;
let window = null;

async function launch() {
  electronApp = await launchApp([], null, EXE_PATH);
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

// DEF-105 decisive: edit-mode click opens the text editor AND it stays open
// (does not auto-close) loaded with the run's text.
test('DEF-105: edit-mode click opens editor and it stays open', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await window.click('[data-toolbar-edit-toggle]');
  await window.waitForSelector('[data-edit-toolbar]');
  await window.click('[data-edit-tool="text"]');
  await window.waitForTimeout(400);

  // Find a body text span in the textLayer (w > 100, y in the visible area)
  const spans = await window.evaluate(() => {
    const out = [];
    document.querySelectorAll('.textLayer span').forEach((s) => {
      const r = s.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: (s.textContent || '').slice(0, 40) });
    });
    return out;
  });
  const target = (spans.find(s => s.y >= 300 && s.w > 150) || spans[0]);
  console.log('DEF-105 target span:', JSON.stringify(target));

  await window.mouse.move(target.x + target.w / 2, target.y + target.h / 2);
  await window.waitForTimeout(400);
  await window.mouse.click(target.x + target.w / 2, target.y + target.h / 2);
  await window.waitForTimeout(600);

  const editorOpen = await window.evaluate(() => {
    const ta = document.querySelector('[data-edit-textarea]');
    const input = document.querySelector('[data-edit-editor] input, [data-edit-editor] textarea, [contenteditable="true"]');
    const anyEditor = document.querySelector('[data-edit-editor], [data-edit-textarea]');
    const value = ta ? (ta.value || '').slice(0, 40) : (input ? (input.value || (input.textContent || '')).slice(0, 40) : null);
    return { taPresent: !!ta, inputPresent: !!input, anyPresent: !!anyEditor, value };
  });
  console.log('DEF-105 editor open at click:', JSON.stringify(editorOpen));
  await snap('def105-editor-open');

  // STAYS OPEN: wait and re-check it did not auto-close.
  await window.waitForTimeout(3000);
  const stillOpen = await window.evaluate(() => {
    const ta = document.querySelector('[data-edit-textarea]');
    const anyEditor = document.querySelector('[data-edit-editor], [data-edit-textarea]');
    return { taPresent: !!ta, anyPresent: !!anyEditor };
  });
  console.log('DEF-105 editor after 3s (stays open):', JSON.stringify(stillOpen));
  await snap('def105-editor-still-open');

  expect(stillOpen.anyPresent, 'editor should remain open after 3s').toBe(true);
});
