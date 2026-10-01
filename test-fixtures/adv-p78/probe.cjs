// Adversarial Phase-78 DIFF-PASS probe: the in-canvas notice family.
//
//   node test-fixtures/adv-p78/probe.cjs multi     (protection + long 3D, both sizes)
//   node test-fixtures/adv-p78/probe.cjs book      (Book View open/close vs notices)
//   node test-fixtures/adv-p78/probe.cjs races     (rapid expand/collapse + enter leg)
//   node test-fixtures/adv-p78/probe.cjs hit       (icon/box elementFromPoint + tab order)
//   node test-fixtures/adv-p78/probe.cjs conversion(conversion notice)
//
// Standalone harness (NOT an e2e spec). Launches ONLY through the canonical
// helper e2e/lib/launch.cjs. Emits `### <json>` per measurement and writes a
// full log under test-fixtures/adv-p78/. Adversary probe artifact.
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp } = require(REPO + '\\e2e\\lib\\launch.cjs');
const { hardClose } = require(REPO + '\\e2e\\lib\\helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument, PDFName, PDFString, rgb } = require('@cantoo/pdf-lib');

const SHOTS = path.join(REPO, 'screenshots');
const OUTDIR = path.join(REPO, 'test-fixtures', 'adv-p78');
const FIX53 = path.join(REPO, 'test-fixtures', 'phase53');

function rec(o) { console.log('### ' + JSON.stringify(o)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tmpDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), `tflex-adv-p78-${tag}-`)); }

// Encrypted PDF carrying N synthetic /Subtype /3D annotations on page 2.
async function buildEncrypted3d(file, n3d) {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const p2 = doc.addPage([400, 400]);
  p2.drawRectangle({ x: 80, y: 80, width: 240, height: 240, color: rgb(0.15, 0.45, 0.25) });
  const annots = [];
  for (let i = 0; i < n3d; i += 1) {
    const annot = doc.context.obj({
      Type: 'Annot', Subtype: '3D', NM: PDFString.of('Turbine-' + i), Rect: [0, 0, 10, 10],
    });
    annots.push(doc.context.register(annot));
  }
  p2.node.set(PDFName.of('Annots'), doc.context.obj(annots));
  doc.encrypt({
    userPassword: 'P78-Adv!', algorithm: 'AES-256', allowWeakCryptography: false,
    permissions: { printing: 'highResolution', modifying: true, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true },
  });
  fs.writeFileSync(file, await doc.save());
  return file;
}

async function installErrorCapture(win) {
  const errors = [];
  win.on('console', (m) => { if (m.type() === 'error') errors.push('console:' + m.text()); });
  win.on('pageerror', (e) => errors.push('pageerror:' + e.message));
  await win.exposeFunction('__advPushError', (s) => errors.push(s));
  await win.evaluate(() => {
    window.__advErrors = [];
    window.addEventListener('error', (e) => window.__advErrors.push('error:' + (e.message || '')));
    window.addEventListener('unhandledrejection', (e) => window.__advErrors.push('rejection:' + String(e.reason)));
  });
  return errors;
}

async function setWindow(app, w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw.isMaximized()) bw.unmaximize();
    bw.setSize(size.w, size.h);
  }, { w, h });
  await sleep(500);
}

async function stubOpen(app, filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

async function openAndUnlock(app, win, filePath, password) {
  await stubOpen(app, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  if (password) {
    await win.waitForSelector('[data-password-prompt]', { timeout: 20000 });
    await win.locator('[data-password-input]').fill(password);
    await win.locator('[data-password-submit]').click();
    await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 });
  }
  await win.waitForSelector('.workspace', { timeout: 30000 });
}

const ACTIVE = '.tab-pane[aria-hidden="false"] ';
function act(sel) { return ACTIVE + sel; }

async function rect(win, sel) {
  return win.evaluate((s) => {
    const el = document.querySelector('.tab-pane[aria-hidden="false"] ' + s) || document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }, sel);
}
function overlaps(a, b) { return a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }

async function measureBox(win, boxSel) {
  return win.evaluate((s) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
    const box = pane.querySelector(s) || document.querySelector(s);
    const overlay = pane.querySelector('[data-canvas-overlay]') || document.querySelector('[data-canvas-overlay]');
    if (!box || !overlay) return { box: null, overlay: null };
    const br = box.getBoundingClientRect();
    const or = overlay.getBoundingClientRect();
    const hit = document.elementFromPoint(br.left + br.width / 2, br.height > 0 ? br.top + Math.min(br.height / 2, 12) : br.top);
    const cs = getComputedStyle(box);
    const scrollHeight = box.scrollHeight;
    const clientHeight = box.clientHeight;
    const maxScroll = scrollHeight - clientHeight;
    let scrolledBy = 0;
    if (maxScroll > 0) {
      box.scrollTop = scrollHeight;
      scrolledBy = box.scrollTop;
      box.scrollTop = 0;
    }
    return {
      box: { left: br.left, top: br.top, right: br.right, bottom: br.bottom, width: br.width, height: br.height },
      overlay: { left: or.left, top: or.top, right: or.right, bottom: or.bottom, width: or.width, height: or.height },
      insideCanvas: br.left >= or.left - 0.5 && br.top >= or.top - 0.5 && br.right <= or.right + 0.5 && br.bottom <= or.bottom + 0.5,
      escapeBottomPx: Math.round(br.bottom - or.bottom),
      hitInBox: hit === box || box.contains(hit),
      hitTop: hit ? `${hit.tagName}.${String(hit.className).slice(0, 60)}` : 'none',
      borderRadius: cs.borderTopLeftRadius, transformOrigin: cs.transformOrigin,
      animationName: cs.animationName, animationDuration: cs.animationDuration,
      scrollHeight, clientHeight, maxScroll, scrolledBy, overflowY: cs.overflowY,
      scrollable: maxScroll > 0 && scrolledBy > 0 && cs.overflowY === 'auto',
    };
  }, boxSel);
}

async function cmdMulti() {
  const app = await launchApp();
  const win = await app.firstWindow();
  const errors = await installErrorCapture(win);
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  const dir = tmpDir('multi');
  const n = 30;
  const file = await buildEncrypted3d(path.join(dir, `p78-enc-${n}x3d.pdf`), n);

  const n3d = Number(process.argv[3] || n);
  const w = Number(process.argv[4] || 2048);
  const h = Number(process.argv[5] || 1392);
  const file2 = await buildEncrypted3d(path.join(dir, `p78-enc-${n3d}x3d.pdf`), n3d);
  await setWindow(app, w, h);
  await openAndUnlock(app, win, file2, 'P78-Adv!');
  await win.waitForSelector(act('[data-protection-notice]'), { timeout: 20000 });
  await win.waitForSelector(act('[data-pdf3d-notice]'), { timeout: 20000 });
  await win.waitForTimeout(700);

  const prot = await measureBox(win, '[data-protection-notice]');
  const three = await measureBox(win, '[data-pdf3d-notice]');
  const cluster = await rect(win, '.canvas-top-right');
  const book = await rect(win, '[data-book-view-open]');
  const layout = await rect(win, '[data-page-layout-control]');
  const winSize = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  rec({ cmd: 'multi', tag: `${w}x${h}-${n3d}x3d`, winSize, prot, three, cluster, overlap: overlaps(prot.box, three.box), book, layout, errors: errors.slice() });
  await win.screenshot({ path: path.join(SHOTS, `adv-p78-multi-${w}x${h}.png`) });
  rec({ cmd: 'multi', errors });
  await hardClose(app, 'adv-p78-multi');
}

async function cmdBook() {
  const app = await launchApp();
  const win = await app.firstWindow();
  const errors = await installErrorCapture(win);
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await setWindow(app, 2048, 1392);
  const dir = tmpDir('book');
  const file = await buildEncrypted3d(path.join(dir, 'p78-enc-1x3d.pdf'), 1);
  await openAndUnlock(app, win, file, 'P78-Adv!');
  await win.waitForSelector(act('[data-protection-notice]'), { timeout: 20000 });

  // Wait to collapse, then re-expand so the notice is expanded when Book View opens.
  await win.waitForSelector(act('[data-protection-icon]'), { timeout: 20000 });
  await win.locator(act('[data-protection-icon]')).click();
  await win.waitForSelector(act('[data-protection-notice]'), { timeout: 5000 });
  const beforeBook = await win.evaluate(() => ({
    open: document.querySelector('.tab-pane[aria-hidden="false"] [data-book-view-open]') !== null,
    boxes: document.querySelectorAll('.tab-pane[aria-hidden="false"] [data-protection-notice], .tab-pane[aria-hidden="false"] [data-pdf3d-notice]').length,
  }));

  await win.locator(act('[data-book-view-open]')).click();
  await win.waitForSelector('.book-view', { timeout: 15000 });
  await win.waitForTimeout(800);
  const inBook = await win.evaluate(() => ({
    bookOpen: document.querySelector('.book-view') !== null,
    noticeRegions: document.querySelectorAll('[data-protection-notice], [data-pdf3d-notice], [data-protection-icon], [data-pdf3d-icon]').length,
  }));
  await win.screenshot({ path: path.join(SHOTS, 'adv-p78-bookview-open.png') });

  // Close Book View via its close control.
  await win.locator('[aria-label="Close book view"]').click();
  await win.waitForSelector('.book-view', { state: 'detached', timeout: 10000 });
  await win.waitForTimeout(1200);
  let afterClose = await win.evaluate(() => ({
    bookOpen: document.querySelector('.book-view') !== null,
    notices: document.querySelectorAll('.tab-pane[aria-hidden="false"] [data-protection-notice]').length + document.querySelectorAll('.tab-pane[aria-hidden="false"] [data-protection-icon]').length,
    protBoxes: document.querySelectorAll('.tab-pane[aria-hidden="false"] [data-protection-notice]').length,
    threeBoxes: document.querySelectorAll('.tab-pane[aria-hidden="false"] [data-pdf3d-notice]').length,
    protIcons: document.querySelectorAll('.tab-pane[aria-hidden="false"] [data-protection-icon]').length,
    threeIcons: document.querySelectorAll('.tab-pane[aria-hidden="false"] [data-pdf3d-icon]').length,
    regions: document.querySelectorAll('.tab-pane[aria-hidden="false"] [data-protection-notice-state]').length,
    dupProtRegions: document.querySelectorAll('.tab-pane[aria-hidden="false"] .protection-notice-region').length,
  }));
  rec({ cmd: 'book', beforeBook, inBook, afterClose, errors: errors.slice() });
  await win.screenshot({ path: path.join(SHOTS, 'adv-p78-bookview-after.png') });
  await hardClose(app, 'adv-p78-book');
}

async function cmdRaces() {
  const app = await launchApp();
  const win = await app.firstWindow();
  const errors = await installErrorCapture(win);
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await setWindow(app, 2048, 1392);
  await stubOpen(app, path.join(FIX53, 'network.html'));
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector(act('[data-conversion-notice]'), { timeout: 25000 });

  // Rapid expand/collapse storm via direct DOM clicks (bypasses actionability).
  const storm = await win.evaluate(async () => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
    const q = (s) => pane.querySelector(s) || document.querySelector(s);
    const states = [];
    const snap = () => {
      const box = q('[data-conversion-notice]');
      const icon = q('[data-conversion-icon]');
      states.push(box ? 'box' : icon ? 'icon' : 'none');
    };
    for (let i = 0; i < 40; i += 1) {
      const icon = q('[data-conversion-icon]');
      const coll = q('[data-conversion-collapse]');
      if (icon) icon.click();
      else if (coll) coll.click();
      snap();
      await new Promise((r) => setTimeout(r, 12));
    }
    return states;
  });
  const frac = (a) => a.filter((x) => x === 'box').length;
  rec({ cmd: 'races', stormLen: storm.length, boxFrames: frac(storm), iconFrames: storm.filter((x) => x === 'icon').length, tail: storm.slice(-8), errors: errors.slice() });
  await win.waitForTimeout(1200);
  const settled = await win.evaluate(() => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
    return {
      box: (pane.querySelector('[data-conversion-notice]') || document.querySelector('[data-conversion-notice]')) !== null,
      icon: (pane.querySelector('[data-conversion-icon]') || document.querySelector('[data-conversion-icon]')) !== null,
      dupBoxes: document.querySelectorAll('.tab-pane[aria-hidden="false"] [data-conversion-notice]').length,
      dupIcons: document.querySelectorAll('.tab-pane[aria-hidden="false"] [data-conversion-icon]').length,
    };
  });
  rec({ cmd: 'races', settled, errors: errors.slice() });

  // Animations OFF instant path.
  await win.evaluate(() => { document.documentElement.setAttribute('data-animations', 'off'); });
  await win.waitForTimeout(150);
  const off = await win.evaluate(() => {
    const icon = document.querySelector('.tab-pane[aria-hidden="false"] [data-conversion-icon]');
    if (icon) icon.click();
    return true;
  });
  await win.waitForTimeout(250);
  const offState = await win.evaluate(() => {
    const box = document.querySelector('.tab-pane[aria-hidden="false"] [data-conversion-notice]');
    const icon = document.querySelector('.tab-pane[aria-hidden="false"] [data-conversion-icon]');
    const cs = box ? getComputedStyle(box) : null;
    return { box: box !== null, icon: icon !== null, animDur: cs ? cs.animationDuration : null };
  });
  rec({ cmd: 'races', animationsOff: offState, errors: errors.slice() });
  await hardClose(app, 'adv-p78-races');
}

async function cmdHit() {
  const app = await launchApp();
  const win = await app.firstWindow();
  const errors = await installErrorCapture(win);
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await setWindow(app, 2048, 1392);
  const dir = tmpDir('hit');
  const file = await buildEncrypted3d(path.join(dir, 'p78-enc-1x3d.pdf'), 1);
  await openAndUnlock(app, win, file, 'P78-Adv!');
  await win.waitForSelector(act('[data-protection-icon]'), { timeout: 20000 });
  await win.waitForSelector(act('[data-pdf3d-icon]'), { timeout: 20000 });
  await win.waitForTimeout(300);

  const probe = await win.evaluate(() => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
    const q = (s) => pane.querySelector(s) || document.querySelector(s);
    const hitOf = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { top: hit ? `${hit.tagName}.${String(hit.className).slice(0, 70)}` : 'none', resolves: hit === el || el.contains(hit), z: hit ? getComputedStyle(hit).zIndex : null };
    };
    const icons = [...document.querySelectorAll('.tab-pane[aria-hidden="false"] [data-protection-icon], .tab-pane[aria-hidden="false"] [data-pdf3d-icon]')]
      .map((el) => ({ sel: el.getAttribute('data-protection-icon') !== null ? 'protection' : 'pdf3d', ...hitOf(el) }));
    const book = hitOf(q('[data-book-view-open]'));
    const layout = hitOf(q('[data-page-layout-control]'));
    const page = q('.pdf-page');
    const pageHit = page ? hitOf(page) : null;
    // Tab order: list focusable controls in the top-right cluster in DOM order.
    const cluster = q('.canvas-top-right');
    const focusables = cluster ? [...cluster.querySelectorAll('button, [tabindex]')].filter((b) => !b.disabled).map((b) => (b.getAttribute('aria-label') || b.className)) : [];
    const aria = {
      protIcon: q('[data-protection-icon]') ? q('[data-protection-icon]').getAttribute('aria-label') : null,
      pdf3dIcon: q('[data-pdf3d-icon]') ? q('[data-pdf3d-icon]').getAttribute('aria-label') : null,
      book: q('[data-book-view-open]') ? q('[data-book-view-open]').getAttribute('aria-label') : null,
    };
    return { icons, book, layout, pageHit, focusables, aria };
  });
  rec({ cmd: 'hit', probe, errors: errors.slice() });

  // Focus survival across auto-collapse: expand, focus the collapse control, wait past dwell.
  await win.locator(act('[data-protection-icon]')).click();
  await win.waitForSelector(act('[data-protection-collapse]'), { timeout: 5000 });
  await win.locator(act('[data-protection-collapse]')).focus();
  await win.waitForTimeout(11000);
  const focusAfter = await win.evaluate(() => ({
    activeTag: document.activeElement ? document.activeElement.tagName : null,
    activeLabel: document.activeElement ? (document.activeElement.getAttribute('aria-label') || '') : null,
    boxGone: (document.querySelector('.tab-pane[aria-hidden="false"] [data-protection-notice]') || document.querySelector('[data-protection-notice]')) === null,
  }));
  rec({ cmd: 'hit', focusAfterAutoCollapse: focusAfter, errors: errors.slice() });
  await hardClose(app, 'adv-p78-hit');
}

async function cmdConversion() {
  const app = await launchApp();
  const win = await app.firstWindow();
  const errors = await installErrorCapture(win);
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await setWindow(app, 2048, 1392);
  await stubOpen(app, path.join(FIX53, 'network.html'));
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector(act('[data-conversion-notice]'), { timeout: 25000 });
  await win.waitForTimeout(700);
  const m = await measureBox(win, '[data-conversion-notice]');
  const icon = await win.evaluate(() => {
    const el = document.querySelector('.tab-pane[aria-hidden="false"] [data-conversion-icon]') || document.querySelector('[data-conversion-icon]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { resolves: hit === el || el.contains(hit), top: hit ? `${hit.tagName}.${String(hit.className).slice(0, 60)}` : 'none' };
  });
  rec({ cmd: 'conversion', box: m, errors: errors.slice() });
  await win.screenshot({ path: path.join(SHOTS, 'adv-p78-conversion.png') });
  await hardClose(app, 'adv-p78-conversion');
}

async function main() {
  const cmd = process.argv[2] || 'multi';
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(OUTDIR, { recursive: true });
  const run = { multi: cmdMulti, book: cmdBook, races: cmdRaces, hit: cmdHit, conversion: cmdConversion };
  if (cmd === 'all') { for (const k of Object.keys(run)) { try { await run[k](); } catch (e) { rec({ cmd: k, error: String((e && e.stack) || e) }); } } }
  else if (run[cmd]) { await run[cmd](); }
  else { console.error('unknown cmd: ' + cmd); process.exit(2); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
