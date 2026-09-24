// Phase-37 items 1,3,5,10 - Inspector text integration, divider, scroll, flush, collapse.
'use strict';
const { boot, openSample, shot, setContentSize, writeOut, sleep, gotoStage } = require('./lib.cjs');

async function scrollToPage(window, n) {
  for (let i = 0; i < 60; i++) {
    const done = await window.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      const slot = document.querySelector(`.page-slot[data-page="${want}"], .pdf-page[data-page="${want}"]`);
      if (!sc) return true;
      if (slot) { sc.scrollTop = slot.offsetTop - 80; return true; }
      sc.scrollTop += 1200; return false;
    }, n);
    await window.waitForTimeout(200); if (done) break;
  }
  await window.waitForTimeout(900);
}
function pickDenseRun(window, pg) {
  return window.evaluate((pageNo) => {
    const slot = document.querySelector(`.page-slot[data-page="${pageNo}"], .pdf-page[data-page="${pageNo}"]`);
    if (!slot) return null;
    const c = slot.querySelector('canvas'); if (!c || c.width === 0) return null;
    const cr = c.getBoundingClientRect();
    let best = null;
    for (const s of slot.querySelectorAll('.textLayer span')) {
      const t = (s.textContent || '').trim(); const r = s.getBoundingClientRect();
      if (t.length < 10 || r.width < 30 || r.height < 4) continue;
      if (r.y < 90 || r.y > window.innerHeight - 90) continue;
      if (!best || r.width > best.rect.w) best = { text: t, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    }
    return best;
  }, pg);
}
function inspectorSnapshot(window) {
  return window.evaluate(() => {
    const insp = document.querySelector('[data-inspector]');
    const body = document.querySelector('.inspector-body');
    const tp = document.querySelector('[data-inspector-text-panel]');
    const div = document.querySelector('[data-inspector-divider]');
    const firstTopEl = body ? body.firstElementChild : null;
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) }; };
    const cs = body ? getComputedStyle(body) : null;
    return {
      present: !!insp,
      collapsed: insp ? insp.getAttribute('data-inspector-collapsed') : null,
      selection: insp ? insp.getAttribute('data-inspector-selection') : null,
      rect: rect(insp),
      bodyRect: rect(body),
      bodyScroll: body ? { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, overflowY: cs.overflowY, canScroll: body.scrollHeight > body.clientHeight + 1 } : null,
      textPanelPresent: !!tp,
      textPanelIsFirst: firstTopEl !== null && firstTopEl.matches('[data-inspector-text-panel]'),
      firstChild: firstTopEl ? firstTopEl.className : null,
      dividerPresent: !!div,
      dividerAfterText: (() => {
        if (!tp || !div || !body) return null;
        return tp.compareDocumentPosition(div) === Node.DOCUMENT_POSITION_FOLLOWING;
      })(),
      sectionSlots: Array.from(document.querySelectorAll('[data-inspector-slot]')).map((e) => e.getAttribute('data-inspector-slot')),
      textPanelRect: rect(tp),
      dividerRect: rect(div),
      controls: (() => {
        const t = document.querySelector('[data-inspector-text-panel]');
        if (!t) return null;
        const btns = Array.from(t.querySelectorAll('button, select, input')).slice(0, 40).map((b) => {
          const r = b.getBoundingClientRect(); return { tag: b.tagName, label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) };
        });
        const fs = getComputedStyle(t).fontSize;
        return { fontSize: fs, count: btns.length, sample: btns };
      })(),
      panelOverflow: (() => { const t = document.querySelector('[data-inspector-text-panel]'); if (!t) return null; const c = getComputedStyle(t); return { overflowY: c.overflowY, maxHeight: c.maxHeight }; })(),
      radiusInspector: insp ? getComputedStyle(insp).borderTopLeftRadius : null,
    };
  });
}

(async () => {
  const { app, window } = await boot({ profile: 'p6-insp' });
  const out = {};
  window.on('pageerror', (e) => { (out.pageErrors = out.pageErrors || []).push(String(e && e.message || e)); });
  try {
    await openSample(app, window, 'report.pdf');
    await gotoStage(window, 2);
    await window.waitForTimeout(600);
    await window.click('[data-edit-tool="text"]').catch(() => {});
    await window.waitForTimeout(300);
    await scrollToPage(window, 1);
    const run = await pickDenseRun(window, 1);
    out.run = run;
    if (run) {
      await window.mouse.click(run.rect.x + run.rect.w / 2, run.rect.y + run.rect.h / 2);
      await window.waitForTimeout(700);
      out.editSel = await inspectorSnapshot(window);
      await shot(window, 'p6-inspector-edit.png');

      // very narrow: 640
      await setContentSize(app, 640, 900); await sleep(800);
      out.editSel640 = await inspectorSnapshot(window);
      await shot(window, 'p6-inspector-edit-640.png');
      // collapse via control
      const hasCtl = await window.locator('[data-inspector-collapse]').count();
      out.collapseCtlCount = hasCtl;
      if (hasCtl) {
        await window.locator('[data-inspector-collapse]').first().click();
        await window.waitForTimeout(600);
        out.afterCollapse = await inspectorSnapshot(window);
        await shot(window, 'p6-inspector-collapsed.png');
        await window.locator('[data-inspector-collapse]').first().click();
        await window.waitForTimeout(600);
      }
      // restore wide, rapid selection switching
      await setContentSize(app, 1440, 900); await sleep(800);
      out.wide = await inspectorSnapshot(window);
      const runs = await window.evaluate(() => Array.from(document.querySelectorAll('.textLayer span')).filter((s) => (s.textContent || '').trim().length >= 8).slice(0, 8).map((s) => { const r = s.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }));
      for (const p of runs) { await window.mouse.click(p.x, p.y); await window.waitForTimeout(120); }
      await window.waitForTimeout(500);
      out.rapidSwitch = await inspectorSnapshot(window);
    }

    // annotate flow: place a textbox, select, inspect
    await gotoStage(window, 3);
    await window.waitForTimeout(500);
    const annotate = window.locator('[data-dock-verb="annotate"]');
    if (await annotate.count()) { await annotate.first().click(); await window.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 8000 }).catch(() => {}); }
    const tb = window.locator('[data-ann-tools-visible] button[data-tool="textbox"]');
    if (await tb.count()) {
      await tb.first().click();
      await window.waitForTimeout(300);
      await scrollToPage(window, 1);
      const geo = await window.evaluate(() => { const s = document.querySelector('.page-slot[data-page="1"], .pdf-page[data-page="1"]'); const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      await window.mouse.move(geo.x + 120, geo.y + 200);
      await window.mouse.down();
      await window.mouse.move(geo.x + 360, geo.y + 250, { steps: 10 });
      await window.mouse.up();
      await window.waitForTimeout(900);
      out.annotatePlace = await inspectorSnapshot(window);
      // commit if a bar is up
      const confirm = window.locator('[data-content-action="ann-textbox-confirm"]');
      if (await confirm.count()) { await confirm.first().click(); await window.waitForTimeout(800); }
      // select the placed annotation by clicking its area
      await window.mouse.click(geo.x + 200, geo.y + 225);
      await window.waitForTimeout(700);
      out.annotateSelect = await inspectorSnapshot(window);
      out.annotateBar = await window.evaluate(() => {
        const bar = document.querySelector('.ann-content-action');
        if (!bar) return null;
        return { dataBar: bar.getAttribute('data-content-action-bar'), buttons: Array.from(bar.querySelectorAll('[data-content-action]')).map((b) => b.getAttribute('data-content-action')), hasColorBox: !!bar.querySelector('.ann-color-box, [data-ann-color-box], [class*=color]') };
      });
      await shot(window, 'p6-inspector-annotate.png');
    } else {
      out.annotateError = 'textbox tool not found';
    }

    writeOut('p6.json', out);
    console.log('P6 done');
  } catch (e) {
    writeOut('p6.error.txt', String(e && e.stack || e));
    console.log('P6 ERROR', e && e.message);
  } finally {
    await app.close().catch(() => {});
    process.exit(0);
  }
})();
