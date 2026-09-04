const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

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

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

// DEF-106 decisive: DOCX export completes and produces a real .docx file.
// The renderer uses an anchor-download; we hook the main-process session's
// will-download to force a save path and confirm a valid OOXML ZIP lands.
test('DEF-106: DOCX export completes and produces a file', async () => {
  test.setTimeout(120000);
  const savePath = path.join(os.tmpdir(), `def106-${Date.now()}.docx`);

  await electronApp.evaluate(({ BrowserWindow }, opts) => {
    const win = BrowserWindow.getAllWindows()[0];
    const sess = win && win.webContents ? win.webContents.session : null;
    global.__DEF106__ = { registerError: null, started: false, state: null, savePath: opts.savePath };
    if (!sess) { global.__DEF106__.registerError = 'no session'; return; }
    sess.on('will-download', (event, item) => {
      global.__DEF106__.started = true;
      // Do NOT event.preventDefault() — that cancels the download.
      // setSavePath alone routes the save to our temp file without
      // surfacing a native save dialog.
      item.setSavePath(opts.savePath);
      item.once('done', (e, state) => {
        global.__DEF106__.state = state;
      });
    });
  }, { savePath });

  await openSample('report.pdf');

  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]');
  await window.click('[data-tool-id="exportDocx"]');
  await window.waitForSelector('[data-docx-export-dialog]');
  await window.waitForTimeout(400);

  await window.click('[data-docx-export-confirm]');

  // Poll for the download to finish.
  let info = null;
  for (let i = 0; i < 30; i++) {
    await window.waitForTimeout(1000);
    info = await electronApp.evaluate(() => global.__DEF106__);
    if (info && info.state) break;
  }
  console.log('DEF-106 will-download info:', JSON.stringify(info));

  const status = await window.evaluate(() => {
    const s = document.querySelector('[data-docx-export-dialog] .modal-status');
    return s ? s.textContent : null;
  });
  console.log('DEF-106 dialog status:', status);

  const exists = fs.existsSync(savePath);
  let size = 0;
  let isZip = false;
  if (exists) {
    const stat = fs.statSync(savePath);
    size = stat.size;
    const head = fs.readFileSync(savePath);
    isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  }
  console.log('DEF-106 saved-file exists=', exists, 'size=', size, 'zipMagic=', isZip, 'path=', savePath);

  expect(info && info.registerError).toBeNull();
  expect(info && info.started, 'a download should have started').toBe(true);
  expect(info && info.state, 'download should complete').toBe('completed');
  expect(exists, 'a .docx file should be produced').toBe(true);
  expect(size, 'saved docx must be non-empty').toBeGreaterThan(0);
  expect(isZip, 'saved docx must be a valid OOXML zip (PK magic)').toBe(true);

  await window.screenshot({ path: 'screenshots/def106-after-export.png' });
});
