// Adversary Phase 110 runtime probe (TFL-932). Read-only over product code.
// Launches the real app through the canonical helper and measures:
//  - body font-family first family per theme
//  - .welcome-sub computed colour + nearest opaque ancestor background per theme
//  - WCAG contrast on that surface
//  - 200% DPI fixed-height text clipping (scrollHeight vs clientHeight)
// Writes JSON to stdout and screenshots under screenshots/.
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function parseRgb(s) {
  const m = /rgba?\(([^)]+)\)/.exec(s || '');
  if (!m) return null;
  const p = m[1].split(',').map((x) => parseFloat(x.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function relLum(rgb) { return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b); }
function contrast(fg, bg) {
  const l1 = relLum(fg), l2 = relLum(bg);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

async function measureContrast(win, selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { selector: sel, missing: true };
    const cs = getComputedStyle(el);
    const color = cs.color;
    // walk ancestors for the first opaque background-color
    let node = el, bg = null, bgFrom = null;
    while (node) {
      const b = getComputedStyle(node).backgroundColor;
      const m = /rgba?\(([^)]+)\)/.exec(b || '');
      if (m) {
        const p = m[1].split(',').map((x) => parseFloat(x.trim()));
        const a = p.length > 3 ? p[3] : 1;
        if (a > 0.999) { bg = b; bgFrom = node.className || node.tagName; break; }
        if (bg === null) { bg = b; bgFrom = node.className || node.tagName; }
      }
      node = node.parentElement;
    }
    return {
      selector: sel,
      color,
      bg,
      bgFrom: String(bgFrom).slice(0, 60),
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      fontFamily: cs.fontFamily,
      fontVariantNumeric: cs.fontVariantNumeric,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      overflow: cs.overflow,
      whiteSpace: cs.whiteSpace,
    };
  }, selector);
}

async function setTheme(win, t) {
  await win.evaluate((th) => document.documentElement.setAttribute('data-theme', th), t);
  await sleep(350);
}

async function openReport(app, win) {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
  }, p);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await sleep(900);
}

const CLIP_SELECTORS = [
  '.welcome-title', '.welcome-sub', '.home-tool', '.home-tools-hint',
  '.tab-title', '.page-label-hint', '.zoom-percent', '.page-total',
  '.stage-rail-label', '.action-dock-label', '.action-dock-tools-label',
  '.toast-text', '.view-strip .page-total',
];

async function main() {
  const out = { contrast: [], fontFamily: [], clip: [] };

  // ---- 100% pass: theme contrast + font stack ----
  let app = await launchApp();
  let win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await sleep(400);

  out.fontFamily.push(await win.evaluate(() => {
    const body = getComputedStyle(document.body).fontFamily;
    const root = getComputedStyle(document.documentElement).getPropertyValue('--type-family').trim();
    const first = body.split(',')[0].trim().replace(/^["']|["']$/g, '');
    return { body: body, first: first, typeFamily: root };
  }));

  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(win, theme);
    for (const sel of ['.welcome-sub', '.home-tools-hint', '.welcome-title']) {
      const m = await measureContrast(win, sel);
      m.theme = theme;
      const fg = parseRgb(m.color), bg = parseRgb(m.bg);
      if (fg && bg && bg.a > 0.999) m.contrast = Number(contrast(fg, bg).toFixed(3));
      out.contrast.push(m);
    }
    await win.screenshot({ path: path.join(SHOTS, `adv-p110-home-${theme}.png`) });
  }

  // home clip at 100%
  for (const sel of CLIP_SELECTORS) {
    const m = await measureContrast(win, sel);
    m.theme = 'light'; m.dpi = '1x';
    if (!m.missing) out.clip.push(m);
  }

  await hardClose(app, 'adv-p110-1x');

  // ---- 200% DPI pass ----
  app = await launchApp(['--force-device-scale-factor=2']);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await sleep(500);
  const dpr = await win.evaluate(() => window.devicePixelRatio);
  out.dpr = dpr;
  await setTheme(win, 'light');
  await win.screenshot({ path: path.join(SHOTS, 'adv-p110-home-200dpi.png') });

  for (const sel of CLIP_SELECTORS) {
    const m = await measureContrast(win, sel);
    m.theme = 'light'; m.dpi = '2x';
    if (!m.missing) out.clip.push(m);
  }

  await openReport(app, win);
  await win.screenshot({ path: path.join(SHOTS, 'adv-p110-editor-200dpi.png') });
  for (const sel of CLIP_SELECTORS) {
    const m = await measureContrast(win, sel);
    m.theme = 'light'; m.dpi = '2x-editor';
    if (!m.missing) out.clip.push(m);
  }
  await setTheme(win, 'dark');
  await win.screenshot({ path: path.join(SHOTS, 'adv-p110-editor-200dpi-dark.png') });

  await hardClose(app, 'adv-p110-2x');

  console.log('ADV_P110_PROBE_JSON_START');
  const json = JSON.stringify(out, null, 2);
  fs.writeFileSync(path.join(__dirname, 'probe-output.json'), json);
  console.log(json);
  console.log('ADV_P110_PROBE_JSON_END');
}

main().catch((e) => { console.error('PROBE FAILED', e && e.stack || e); process.exit(1); });
