// DEF-166 diagnostic (v1.7.27): open the saved round-trip file and identify
// EVERY render source of the textbox/callout text on the reopened page:
//   - each <canvas> in the page slot (dark/blue px in the annotation interior)
//   - every DOM element intersecting the annotation interior that carries text
//     (TFlex overlay, pdf.js annotationLayer sections, textLayer spans, svg text)
const { test } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SAVE = path.resolve(__dirname, '..', '..', 'test-fixtures', 'annot-text-roundtrip-1727.pdf');

test.setTimeout(300000);

test('diag: DEF-166 reopened render sources', async () => {
  const electronApp = await launchApp([], null, EXE_PATH);
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, SAVE);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2500);
  for (let i = 0; i < 40; i += 1) {
    const st = await win.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return { done: false };
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (!slot) { sc.scrollTop += 1500; return { done: false }; }
      const r = slot.getBoundingClientRect();
      const delta = r.top - 90;
      if (Math.abs(delta) < 40) return { done: true };
      sc.scrollTop += delta;
      return { done: false };
    }, 4);
    await win.waitForTimeout(300);
    if (st.done) break;
  }
  await win.waitForTimeout(1200);

  const diag = await win.evaluate(() => {
    const slot = document.querySelector('.page-slot[data-page="4"]');
    if (!slot) return { noSlot: true };
    const pageEl = slot.querySelector('.pdf-page') || slot;
    const pr = pageEl.getBoundingClientRect();
    const out = { canvases: [], textBoxes: [], calloutBoxes: [], intersectors: [] };

    // every canvas in the slot
    for (const c of slot.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      const cx = c.getContext('2d');
      let darkTB = 0, blueTB = 0, darkCO = 0, blueCO = 0, scale = 1;
      try {
        const img = cx.getImageData(0, 0, c.width, c.height);
        scale = c.width / pr.width;
        const scan = (reg) => {
          let d = 0, b = 0;
          const x0 = Math.max(0, Math.floor(reg.x * scale)), x1 = Math.min(c.width, Math.ceil((reg.x + reg.w) * scale));
          const y0 = Math.max(0, Math.floor(reg.y * scale)), y1 = Math.min(c.height, Math.ceil((reg.y + reg.h) * scale));
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const i = (y * c.width + x) * 4;
            const R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
            const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
            if (lum < 140) d++;
            if (Math.abs(R - 37) < 50 && Math.abs(G - 99) < 50 && Math.abs(B - 235) < 50) b++;
          }
          return { d, b };
        };
        const tb = scan({ x: 208.1, y: 359, w: 183.9, h: 49.5 });
        const co = scan({ x: 815.8, y: 618.6, w: 170, h: 49.5 });
        darkTB = tb.d; blueTB = tb.b; darkCO = co.d; blueCO = co.b;
      } catch (e) { /* tainted or none */ }
      out.canvases.push({
        cls: c.className, w: c.width, h: c.height,
        screen: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        darkTB, blueTB, darkCO, blueCO,
      });
    }

    // DOM elements that intersect the textbox interior and carry text or a value
    const regions = {
      tb: { x: 208.1, y: 359, w: 183.9, h: 49.5 },
      co: { x: 815.8, y: 618.6, w: 170, h: 49.5 },
    };
    const hits = { tb: [], co: [] };
    const all = slot.querySelectorAll('*');
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const txt = (el.textContent || '').trim();
      const val = el.value || '';
      for (const key of Object.keys(regions)) {
        const g = regions[key];
        const ix = Math.max(0, Math.min(r.right, g.x + g.w) - Math.max(r.x, g.x));
        const iy = Math.max(0, Math.min(r.bottom, g.y + g.h) - Math.max(r.y, g.y));
        if (ix * iy < 0.5 * r.width * r.height) continue;
        if (!txt && !val) continue;
        // leaf-ish: only elements with direct text or an input value
        const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!direct && !val && el.tagName !== 'text' && el.tagName !== 'TEXT') continue;
        hits[key].push({
          tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60),
          text: (txt || val).slice(0, 60),
          vis: getComputedStyle(el).visibility, op: getComputedStyle(el).opacity,
          fs: getComputedStyle(el).fontSize, color: getComputedStyle(el).color,
          rect: { x: +(r.x - pr.x).toFixed(1), y: +(r.y - pr.y).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        });
      }
    }
    out.intersectors = hits;

    // TFlex overlay boxes
    for (const [key, sel] of [['tb', 'div.ann-textbox[data-kind="textbox"]'], ['co', 'div.ann-callout[data-kind="callout"]']]) {
      for (const el of slot.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        out[key === 'tb' ? 'textBoxes' : 'calloutBoxes'].push({
          rect: { x: +(r.x - pr.x).toFixed(1), y: +(r.y - pr.y).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
          html: el.innerHTML.replace(/\s+/g, ' ').slice(0, 300),
        });
      }
    }
    const d = window.tflexDiagnostics ? window.tflexDiagnostics() : null;
    out.engineAnns = ((d && d.engineState && d.engineState.annotations) || []).map((a) => ({ kind: a.kind, text: (a.text || '').slice(0, 30), rect: a.rects && a.rects[0] }));
    return out;
  });
  process.stdout.write(`[DIAG] ${JSON.stringify(diag, null, 1)}\n`);
  await win.screenshot({ path: path.resolve(__dirname, '..', '..', 'screenshots', 'def-166-1727-diag-reopened.png') });
  await hardClose(electronApp);
});
