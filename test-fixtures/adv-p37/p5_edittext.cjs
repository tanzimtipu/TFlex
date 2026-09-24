// Phase-37 items 11,12,13 - edit text bar, visibility, stage-as-switch, annotate bar.
'use strict';
const { boot, openSample, shot, writeOut, sleep, gotoStage } = require('./lib.cjs');

async function scrollToPage(window, n) {
  for (let i = 0; i < 60; i++) {
    const done = await window.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      const slot = document.querySelector(`.page-slot[data-page="${want}"], .pdf-page[data-page="${want}"]`);
      if (!sc) return true;
      if (slot) { sc.scrollTop = slot.offsetTop - 80; return true; }
      sc.scrollTop += 1200; return false;
    }, n);
    await window.waitForTimeout(200);
    if (done) break;
  }
  await window.waitForTimeout(900);
}

function pickDenseRun(window, pg) {
  return window.evaluate((pageNo) => {
    const slot = document.querySelector(`.page-slot[data-page="${pageNo}"], .pdf-page[data-page="${pageNo}"]`);
    if (!slot) return null;
    const c = slot.querySelector('canvas');
    if (!c || c.width === 0) return null;
    const cr = c.getBoundingClientRect();
    const kx = c.width / cr.width, ky = c.height / cr.height;
    const ctx = c.getContext('2d');
    const darkIn = (x0, y0, x1, y1) => {
      const sx = Math.max(0, Math.round(x0)), sy = Math.max(0, Math.round(y0));
      const sw = Math.max(1, Math.min(c.width - sx, Math.round(x1 - x0)));
      const sh = Math.max(1, Math.min(c.height - sy, Math.round(y1 - y0)));
      const d = ctx.getImageData(sx, sy, sw, sh).data; let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 140) dark++;
      return dark;
    };
    let best = null;
    for (const s of slot.querySelectorAll('.textLayer span')) {
      const t = (s.textContent || '').trim(); const r = s.getBoundingClientRect();
      if (t.length < 10 || r.width < 30 || r.height < 4) continue;
      if (r.y < 90 || r.y > window.innerHeight - 90) continue;
      const x0 = (r.x - cr.x) * kx, x1 = (r.x + r.width - cr.x) * kx;
      const yTop = (r.y - cr.y) * ky, yBot = (r.y + r.height - cr.y) * ky;
      const score = darkIn(x0, yTop - 16 * ky, x1, yTop - 2 * ky) + darkIn(x0, yBot + 2 * ky, x1, yBot + 16 * ky);
      if (best === null || score > best.score) best = { text: t, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, canvasPx: { x: Math.round(x0), y: Math.round(yTop), w: Math.max(1, Math.round(x1 - x0)), h: Math.max(1, Math.round(yBot - yTop)) }, score };
    }
    return best;
  }, pg);
}
function darkAtPx(window, px, pg) {
  return window.evaluate(({ r, pageNo }) => {
    const slot = document.querySelector(`.page-slot[data-page="${pageNo}"], .pdf-page[data-page="${pageNo}"]`);
    const c = slot && slot.querySelector('canvas');
    if (!c) return { error: 'no-canvas' };
    const sx = Math.max(0, Math.round(r.x)), sy = Math.max(0, Math.round(r.y));
    const sw = Math.max(1, Math.min(c.width - sx, Math.round(r.w))), sh = Math.max(1, Math.min(c.height - sy, Math.round(r.h)));
    const d = c.getContext('2d').getImageData(sx, sy, sw, sh).data;
    let dark = 0, nearWhite = 0, total = 0;
    for (let i = 0; i < d.length; i += 4) { total++; const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; if (lum < 140) dark++; if (d[i] >= 245 && d[i + 1] >= 245 && d[i + 2] >= 245) nearWhite++; }
    return { dark, nearWhite, total };
  }, { r: px, pageNo: pg });
}
async function barInfo(window) {
  return window.evaluate(() => {
    const bar = document.querySelector('[data-content-action-bar="textrun"]');
    if (!bar) return null;
    return {
      buttons: Array.from(bar.querySelectorAll('[data-content-action]')).map((b) => ({ a: b.getAttribute('data-content-action'), label: b.textContent.trim() })),
      allText: bar.textContent.replace(/\s+/g, ' ').trim(),
      rect: (() => { const r = bar.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
      editBoxCount: bar.querySelectorAll('[data-content-action="textrun-edit"]').length,
    };
  });
}

(async () => {
  const { app, window } = await boot({ profile: 'p5-edit' });
  const out = {};
  try {
    await openSample(app, window, 'report.pdf');
    // Enter EDIT stage - must enable edit mode, show the toolbar, no editMode verb.
    await gotoStage(window, 2);
    await window.waitForTimeout(700);
    out.enterEdit = await window.evaluate(() => ({
      editToolbar: !!document.querySelector('[data-edit-toolbar]'),
      dockVerbs: Array.from(document.querySelectorAll('[data-action-dock] [data-dock-verb]')).map((b) => b.getAttribute('data-dock-verb')),
      editModeVerb: !!document.querySelector('[data-dock-verb="editMode"]'),
      editContentText: document.body.textContent.includes('Edit content'),
    }));

    await window.click('[data-edit-tool="text"]').catch(() => {});
    await window.waitForTimeout(400);
    await scrollToPage(window, 1);
    const run = await pickDenseRun(window, 1);
    out.run = run;
    if (run) {
      const cx = run.rect.x + run.rect.w / 2, cy = run.rect.y + run.rect.h / 2;
      const before = await darkAtPx(window, run.canvasPx, 1);
      await window.mouse.click(cx, cy);
      await window.waitForTimeout(600);
      const bar = await barInfo(window);
      const afterSel = await darkAtPx(window, run.canvasPx, 1);
      out.select = { before, afterSel, bar };
      await shot(window, 'p5-textrun-selected.png');

      // Cancel mid-edit: bar gone, selection dismissed, text unchanged
      if (bar) {
        await window.locator('[data-content-action="textrun-cancel"]').first().click();
        await window.waitForTimeout(500);
        out.cancel = {
          barAfter: await barInfo(window),
          darkAfter: await darkAtPx(window, run.canvasPx, 1),
        };
      }

      // Re-select then switch stage mid-edit
      await window.mouse.click(cx, cy);
      await window.waitForTimeout(500);
      const barBeforeSwitch = await barInfo(window);
      await gotoStage(window, 3);
      await window.waitForTimeout(600);
      out.switchStage = {
        barBeforeSwitch: !!barBeforeSwitch,
        barAfter: await barInfo(window),
        editToolbarAfter: await window.evaluate(() => !!document.querySelector('[data-edit-toolbar]')),
        dockVerbs: await window.evaluate(() => Array.from(document.querySelectorAll('[data-action-dock] [data-dock-verb]')).map((b) => b.getAttribute('data-dock-verb'))),
        pageErrors: window.__errs || [],
      };
      await shot(window, 'p5-after-switch.png');

      // Re-enter edit, select, Delete -> text masked
      await gotoStage(window, 2);
      await window.waitForTimeout(500);
      await window.click('[data-edit-tool="text"]').catch(() => {});
      await window.waitForTimeout(300);
      await scrollToPage(window, 1);
      const run2 = await pickDenseRun(window, 1) || run;
      const cx2 = run2.rect.x + run2.rect.w / 2, cy2 = run2.rect.y + run2.rect.h / 2;
      const before2 = await darkAtPx(window, run.canvasPx, 1);
      await window.mouse.click(cx2, cy2);
      await window.waitForTimeout(500);
      const bar2 = await barInfo(window);
      let afterDel = null;
      if (bar2) {
        await window.locator('[data-content-action="textrun-delete"]').first().click();
        await window.waitForTimeout(900);
        afterDel = await darkAtPx(window, run.canvasPx, 1);
      }
      out.delete = { before: before2, barPresent: !!bar2, afterDelete: afterDel };
      await shot(window, 'p5-textrun-deleted.png');
    }

    writeOut('p5.json', out);
    console.log('P5 done');
  } catch (e) {
    writeOut('p5.error.txt', String(e && e.stack || e));
    console.log('P5 ERROR', e && e.message);
  } finally {
    await app.close().catch(() => {});
  }
})();
