// DEF-344 focused verification (QA, Phase 38): the dock's hover and pressed
// (:active) ink must clear the 4.5:1 text floor for every tool family in all
// three themes. ADV-088 measured light blue/cyan/green/orange at 4.29/4.45/
// 4.16/4.17 because the per-verb family-hue rule out-specified the hover/active
// ink. The fix makes the state ink --fg-strong; this spec samples the REAL
// rendered colours (computed color + composited surface) per family.
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const log = (label, obj) => console.log(`[DEF344] ${label} ${JSON.stringify(obj)}`);
const THEMES = ['light', 'dark', 'frosted'];
const FAMILY = {
  rotate: 'cyan', extract: 'blue', insertPages: 'green', replacePages: 'purple',
  split: 'orange', delete: 'red', merge: 'blue', cropPages: 'pink',
  editText: 'purple', editImage: 'blue', editTextBox: 'cyan', recognizeText: 'yellow',
  batchOcr: 'green', ocrSuspects: 'orange', annotate: 'yellow', sign: 'orange',
  stamp: 'red', flatten: 'purple', forms: 'pink', watermark: 'blue',
  exportComments: 'cyan', importComments: 'green', optimize: 'green', audit: 'purple',
  exportPages: 'blue', exportText: 'cyan', exportDocx: 'orange', createFromImages: 'pink',
};

let app = null;
let win = null;
test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def344');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function setTheme(theme) {
  await win.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await win.waitForTimeout(400);
}
async function gotoStage(n) {
  await win.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
  await win.keyboard.press(`Control+${n}`);
  await win.waitForTimeout(450);
}
async function measure(id) {
  return win.evaluate((vid) => {
    const parse = (v) => {
      const m = String(v).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((x) => parseFloat(x.trim()));
      return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
    };
    const comp = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const lum = (c) => { const ch = (x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }; return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b); };
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2)); };
    const baseRaw = parse(getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim()) || { r: 255, g: 255, b: 255, a: 1 };
    const base = comp(baseRaw, { r: 255, g: 255, b: 255, a: 1 });
    const effectiveBg = (el) => {
      const layers = [];
      let n = el;
      while (n && n !== document.documentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
        n = n.parentElement;
      }
      let out = base;
      for (let i = layers.length - 1; i >= 0; i -= 1) out = comp(layers[i], out);
      return out;
    };
    const b = document.querySelector(`[data-action-dock] [data-dock-verb="${vid}"]`);
    if (!b) return null;
    const cs = getComputedStyle(b);
    const bg = effectiveBg(b);
    return { id: vid, color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, ratio: ratio(parse(cs.color), bg) };
  }, id);
}
async function measureVerb(id) {
  const loc = win.locator(`[data-action-dock] [data-dock-verb="${id}"]`).first();
  const box = await loc.boundingBox();
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.waitForTimeout(250);
  const hover = await measure(id);
  await win.mouse.down();
  await win.waitForTimeout(200);
  const active = await measure(id);
  // Move off before releasing so the press never fires the verb's action.
  await win.mouse.move(700, 420);
  await win.mouse.up();
  await win.waitForTimeout(150);
  return { hover, active };
}

test('DEF-344 hover + pressed dock-verb contrast >= 4.5 per family in all three themes', async () => {
  const report = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] }); }, report);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);

  const table = {};
  const failures = [];
  for (const theme of THEMES) {
    await setTheme(theme);
    await win.mouse.move(700, 420);
    await win.waitForTimeout(300);
    const rows = [];
    const seen = new Set();
    for (const stage of [1, 2, 3, 4]) {
      await gotoStage(stage);
      const ids = await win.evaluate(() => [...document.querySelectorAll('[data-action-dock] [data-dock-verb]')]
        .filter((b) => !b.classList.contains('action-dock-verb-primary') && !b.disabled)
        .map((b) => b.getAttribute('data-dock-verb')));
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const m = await measureVerb(id);
        rows.push({ family: FAMILY[id] ?? '?', id, hover: m.hover, active: m.active });
      }
    }
    table[theme] = rows;
    for (const r of rows) {
      if (r.hover && r.hover.ratio < 4.5) failures.push(`${theme} ${r.family}/${r.id} hover ${r.hover.color} on ${r.hover.bg} = ${r.hover.ratio}`);
      if (r.active && r.active.ratio < 4.5) failures.push(`${theme} ${r.family}/${r.id} active ${r.active.color} on ${r.active.bg} = ${r.active.ratio}`);
    }
    log(`table-${theme}`, rows.map((r) => ({ family: r.family, id: r.id, hover: r.hover && r.hover.ratio, active: r.active && r.active.ratio })));
  }
  log('failures', failures);
  expect(failures, failures.join('\n')).toEqual([]);
  const families = new Set(Object.values(table).flat().map((r) => r.family));
  log('families', [...families].sort());
  expect(families.size, 'all eight families are sampled').toBe(8);
});
