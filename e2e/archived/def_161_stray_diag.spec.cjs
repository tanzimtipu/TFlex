// Diagnostic: open the SAVED callout file (the one DEF-161 verification
// saved), go to page 4, and dump EVERY element whose text contains the
// callout string, with page-local rects + ancestor classes - to pin down
// the stray blue "VERIFY CALLOUT 1725" render (expected: pdf.js annotation
// layer section at the baked /Rect position ~130px BELOW the app overlay).
const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const SAVE = process.env.TFLEX_SAVED || 'C:\\Users\\tanzi\\AppData\\Local\\Temp\\tflex-def161-callout-1788479046572.pdf';

test.setTimeout(240000);

test('diag: stray callout text element in the reopened saved file', async () => {
  const electronApp = await launchApp([]);
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await electronApp.evaluate(({ dialog }, p) => {
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

  const probe = await win.evaluate(() => {
    const slot = document.querySelector('.page-slot[data-page="4"]');
    const pageEl = (slot && (slot.querySelector('.pdf-page') || slot));
    const pr = pageEl.getBoundingClientRect();
    const out = [];
    const walk = document.createTreeWalker(slot, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const t = walk.currentNode;
      if (!t.textContent || !t.textContent.includes('VERIFY CALLOUT')) continue;
      const el = t.parentElement;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const chain = [];
      let p = el;
      for (let d = 0; d < 6 && p; d += 1) {
        const cls = String(p.className && p.className.baseVal !== undefined ? p.className.baseVal : p.className || '').split(' ').filter(Boolean).slice(0, 3).join('.');
        chain.push(`${p.tagName.toLowerCase()}.${cls}`);
        p = p.parentElement;
      }
      out.push({
        pageLocal: { x: +(r.x - pr.x).toFixed(1), y: +(r.y - pr.y).toFixed(1) },
        size: { w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        color: getComputedStyle(el).color,
        text: t.textContent.trim().slice(0, 40),
        chain,
      });
    }
    // also: any pdf.js annotation-layer sections on the page
    const sections = [];
    for (const el of slot.querySelectorAll('.annotationLayer section, section[data-annotation-id], [data-annotation-id]')) {
      const r = el.getBoundingClientRect();
      const cls = String(el.className || '').split(' ').filter(Boolean).slice(0, 3).join('.');
      sections.push({ cls, id: el.getAttribute('data-annotation-id'),
        pageLocal: { x: +(r.x - pr.x).toFixed(1), y: +(r.y - pr.y).toFixed(1) },
        size: { w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        text: (el.textContent || '').trim().slice(0, 40) });
    }
    return { texts: out, sections };
  });
  process.stdout.write(`\n[DIAG-STRAY] ${JSON.stringify(probe, null, 1)}\n`);
  await win.screenshot({ path: path.join(SHOTS, 'def-161-1725-reopened-stray-text.png') });
  await hardClose(electronApp);
  expect(probe.texts.length, 'found the callout text renders').toBeGreaterThan(0);
});