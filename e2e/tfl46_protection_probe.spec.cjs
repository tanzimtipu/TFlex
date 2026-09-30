// TFL-46.1 — QA probe: where does the collapsed protection "i" actually sit,
// and does it cover a control? Opened by qa while reproducing the operator's
// "document-protection notice not working" report. Read-only probe: it drives
// the real app through the same openProtected() flow as
// e2e/phase59_protection_notice.spec.cjs and measures, after auto-collapse:
//   (a) the collapsed icon bounding box;
//   (b) the .document-column box and the page scroller's left edge;
//   (c) document.elementFromPoint at the icon centre and at the Combine centre;
//   (d) whether the icon rect overlaps the Combine control rect.
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { makeEncryptedFixture } = require('./lib/p52_crypto.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let app = null;
let win = null;

test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl46-probe');
  app = null;
  win = null;
});

async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

async function openProtected() {
  const fixture = await makeEncryptedFixture({
    name: 'tfl46-probe.pdf',
    algorithm: 'AES-256',
    userPassword: 'P59-Protect!',
  });
  await stubOpen(fixture);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('[data-password-prompt]', { timeout: 20000 });
  await win.locator('[data-password-input]').fill('P59-Protect!');
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 });
  await win.waitForSelector('[data-protection-notice]', { timeout: 15000 });
}

function boxOf(r) {
  if (r === null) return null;
  return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.x + r.width, bottom: r.y + r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}

function overlaps(a, b) {
  return a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
}

test('TFL-46.1 probe: collapsed "i" position relative to left panel, page scroller and Combine control', async () => {
  await openProtected();

  // Auto-collapse into the "i".
  await win.waitForSelector('[data-protection-icon]', { timeout: 20000 });
  await win.waitForTimeout(400);

  const iconBox = boxOf(await win.locator('[data-protection-icon]').boundingBox());
  const columnBox = boxOf(await win.locator('.document-column').boundingBox());
  const scrollerBox = boxOf(await win.locator('.document-scroller').boundingBox());
  const panelBox = boxOf(await win.locator('.context-panel').boundingBox().catch(() => null));

  // The element that actually scrolls .pdf-page (walk up the DOM).
  const scrollParent = await win.evaluate(() => {
    let el = document.querySelector('.pdf-page');
    while (el !== null && el !== document.body) {
      const cs = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(cs.overflowY)) {
        const r = el.getBoundingClientRect();
        return { tag: el.tagName, cls: String(el.className), left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
      el = el.parentElement;
    }
    return null;
  });

  const combine = win.locator('[data-context-panel-combine]');
  const combineCount = await combine.count();
  const combineBox = combineCount > 0 ? boxOf(await combine.boundingBox()) : null;

  const hit = await win.evaluate(({ icon, combo }) => {
    const describe = (el) => (el === null ? 'none' : `${el.tagName}.${String(el.className)}`);
    const out = {};
    out.iconCentre = describe(document.elementFromPoint(icon.cx, icon.cy));
    out.iconTopLeft = describe(document.elementFromPoint(icon.x + 2, icon.y + 2));
    if (combo) out.combineCentre = describe(document.elementFromPoint(combo.cx, combo.cy));
    // What is under the icon's rect corner where it would cover a panel control?
    out.iconBelow = describe(document.elementFromPoint(icon.cx, icon.cy));
    return out;
  }, { icon: iconBox, combo: combineBox });

  const overlap = combineBox !== null ? overlaps(iconBox, combineBox) : null;

  console.log(`[TFL46] icon=${JSON.stringify(iconBox)}`);
  console.log(`[TFL46] documentColumn=${JSON.stringify(columnBox)}`);
  console.log(`[TFL46] pageScroller=${JSON.stringify(scrollerBox)} scrollParent=${JSON.stringify(scrollParent)}`);
  console.log(`[TFL46] contextPanel=${JSON.stringify(panelBox)}`);
  console.log(`[TFL46] combineCount=${combineCount} combine=${JSON.stringify(combineBox)}`);
  console.log(`[TFL46] hit=${JSON.stringify(hit)}`);
  console.log(`[TFL46] iconOverlapsCombine=${overlap}`);

  await win.screenshot({ path: path.join(SHOTS, 'tfl46-icon-vs-panel.png') });
  // Zoomed crop of the icon over the left panel for visual inspection.
  await win.screenshot({
    path: path.join(SHOTS, 'tfl46-icon-vs-panel-clip.png'),
    clip: { x: 40, y: 30, width: 320, height: 120 },
  });

  // Probe assertions are informational only for measurements; the real
  // deliverable is the logged evidence above + the screenshot.
  expect(iconBox, 'the collapsed "i" is present after auto-collapse').not.toBeNull();
  expect(combineBox, 'the Combine control exists on the Pages stage').not.toBeNull();
});
