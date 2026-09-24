// ADV phase-36 probe 2: reachability runner.
// Parses src/renderer/state/toolsRegistry.ts for the canonical inventory, then
// drives the real dev build to reach and run every entry through its host
// surface. Records path + effect per entry.
'use strict';
const { boot, openSample, shot, gotoStage, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const REG_SRC = path.resolve(__dirname, '..', '..', 'src', 'renderer', 'state', 'toolsRegistry.ts');

function parseRegistry() {
  const text = fs.readFileSync(REG_SRC, 'utf8');
  const regStart = text.indexOf('const REGISTRY = [');
  const regEnd = text.indexOf('] as const satisfies readonly ToolEntry[]');
  const body = text.slice(regStart, regEnd);
  const entries = [];
  const blocks = body.split(/\n  \{\n/).slice(1);
  for (const raw of blocks) {
    const b = raw.split('\n  }')[0];
    const get = (k) => {
      const m = b.match(new RegExp(`${k}:\\s*(?:'([^']*)'|"([^"]*)")`));
      return m ? (m[1] !== undefined ? m[1] : m[2]) : undefined;
    };
    const id = get('id');
    if (!id) continue;
    entries.push({ id, label: get('label'), stage: get('stage'), action: get('action'), availability: get('availability') });
  }
  const surfStart = text.indexOf('const SURFACE_BY_ID: Record<ToolId, ToolSurface> = {');
  const surfEnd = text.indexOf('};', surfStart);
  const surfBody = text.slice(surfStart, surfEnd);
  const surf = {};
  const re = /([A-Za-z'\-]+):\s*'(dock|flyout|panel|palette)'/g;
  let m;
  while ((m = re.exec(surfBody)) !== null) surf[m[1].replace(/'/g, '')] = m[2];
  for (const e of entries) e.surface = surf[e.id] || 'dock';
  return entries;
}

const NO_CLICK = new Set(['windowMinimize', 'windowMaximize', 'windowClose', 'updateInstall', 'updateDownload']);

const ANN_KIND = {
  annHighlight: 'highlight', annUnderline: 'underline', annStrikeout: 'strikeout', annInk: 'ink',
  annTextbox: 'textbox', annRect: 'rect', annEllipse: 'ellipse', annArrow: 'arrow',
  annCallout: 'callout', annNote: 'note', annSelect: 'select',
};

async function signature(window) {
  return window.evaluate(() => {
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    return {
      modal: q('.modal-backdrop').length,
      sheet: q('.sheet-backdrop').length,
      flyout: q('[data-annotation-flyout]').length,
      textPanel: q('[data-text-panel]').length,
      editToolbar: q('[data-edit-toolbar]').length,
      search: q('.search-bar').length,
      suspects: q('[data-ocr-suspects-panel]').length,
      print: q('[data-print-dialog-shell]').length,
      palette: q('[data-command-palette]').length,
      toasts: q('.toast, [data-toast]').map((t) => (t.textContent || '').trim()).join(' | '),
      pressed: q('[data-dock-verb]').filter((b) => b.getAttribute('aria-pressed')).map((b) => b.getAttribute('data-dock-verb')),
      stage: document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage') || null,
      dockState: document.querySelector('[data-action-dock]')?.getAttribute('data-dock-state') || null,
      annTool: document.querySelector('[data-ann-tools-visible] button[aria-pressed="true"]')?.getAttribute('data-tool')
        || document.querySelector('[data-annotation-toolbar] button[aria-pressed="true"]')?.getAttribute('data-tool') || null,
      titles: q('.modal-title, .sheet-title').map((t) => (t.textContent || '').trim()),
      editTool: document.querySelector('[data-edit-toolbar] button[aria-pressed="true"]')?.getAttribute('data-edit-tool') || null,
      hand: document.querySelector('[data-hand-toggle]')?.getAttribute('data-hand-active') || null,
      panelCollapsed: document.querySelector('[data-context-panel]')?.getAttribute('data-context-panel-collapsed') || null,
    };
  });
}

function diff(a, b) {
  const keys = Object.keys(b);
  const out = {};
  for (const k of keys) {
    const av = JSON.stringify(a[k]); const bv = JSON.stringify(b[k]);
    if (av !== bv) out[k] = `${av} -> ${bv}`;
  }
  return out;
}

async function reset(window) {
  for (let i = 0; i < 4; i++) {
    await window.keyboard.press('Escape').catch(() => {});
    await sleep(120);
  }
  await window.evaluate(() => {
    const b = document.querySelector('.modal-backdrop, .sheet-backdrop');
    if (b) {
      const c = b.querySelector('.modal-close, [data-confirm-dialog-action="cancel"], [data-update-prompt-cancel], [data-update-prompt-close]');
      if (c) c.click();
    }
  }).catch(() => {});
  await sleep(250);
  await window.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await gotoStage(window, 1);
  await sleep(200);
}

async function closePalette(window) {
  const open = await window.evaluate(() => !!document.querySelector('[data-command-palette]'));
  if (open) { await window.keyboard.press('Escape'); await sleep(250); }
}

async function paletteRun(window, label) {
  await closePalette(window);
  await window.keyboard.press('Control+k');
  await window.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await window.locator('[data-command-palette-input]').fill(label);
  await sleep(350);
  const before = await signature(window);
  const row = window.locator('.command-palette-row').filter({ hasText: label }).first();
  const n = await row.count();
  if (n === 0) return { path: 'palette', found: false, effect: 'row not found for label' };
  const disabled = await row.getAttribute('data-palette-disabled');
  const id = await row.getAttribute('data-palette-tool-id');
  await row.click();
  await sleep(600);
  const after = await signature(window);
  return { path: 'palette', found: true, rowId: id, disabled, effect: diff(before, after) };
}

(async () => {
  const entries = parseRegistry();
  console.log(`[p2] parsed ${entries.length} registry entries`);
  const results = {};
  const { app, window } = await boot({ profile: 'p2' });
  try {
    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1500);

    // Baseline inventory of every surface affordance once, so panel entries
    // can be checked without clicking.
    const inventory = await window.evaluate(() => {
      const has = (sel) => document.querySelectorAll(sel).length;
      return {
        thumbs: has('.thumb-item'),
        thumbVerbs: has('[data-thumb-verbs]'),
        thumbVerbIds: Array.from(document.querySelectorAll('[data-thumb-verb]')).map((b) => b.getAttribute('data-thumb-verb')),
        outlineToggle: has('[data-outline-toggle]'),
        pagePillInput: has('[data-page-pill] input'),
        handToggle: has('[data-hand-toggle]'),
        railCollapse: has('[data-rail-collapse]'),
        stageRailGear: has('[data-stage-rail-gear]'),
        menuButton: has('[data-menu-button]'),
        titlebarMultiMode: has('[data-header-multi-mode]'),
      };
    });

    // --- per-surface walk ---
    for (const e of entries) {
      const r = { id: e.id, label: e.label, surface: e.surface, stage: e.stage, availability: e.availability, action: e.action };
      try {
        await reset(window);

        if (e.surface === 'dock') {
          const stageNum = { pages: 1, edit: 2, review: 3, deliver: 4 }[e.stage] || 1;
          await gotoStage(window, stageNum);
          const inline = window.locator(`[data-dock-verb="${e.id}"]`);
          let lane = 'inline';
          let cnt = await inline.count();
          if (cnt === 0) {
            const ov = window.locator('[data-dock-overflow]');
            if (await ov.count() > 0 && await ov.first().isVisible().catch(() => false)) {
              await ov.first().click(); await sleep(300);
              lane = 'overflow';
              cnt = await window.locator(`[data-dock-overflow-item="${e.id}"]`).count();
            }
          }
          r.present = cnt > 0;
          r.lane = lane;
          if (cnt === 0) { r.effect = 'NOT PRESENT on stage dock (inline or overflow)'; results[e.id] = r; continue; }
          const target = lane === 'inline' ? inline.first() : window.locator(`[data-dock-overflow-item="${e.id}"]`).first();
          r.disabled = await target.isDisabled().catch(() => null);
          if (r.disabled) {
            r.reason = await target.getAttribute('title');
            r.effect = 'disabled (present with reason)';
            results[e.id] = r; continue;
          }
          const before = await signature(window);
          if (!NO_CLICK.has(e.id) && !['rotate', 'delete', 'rotateCounterClockwise'].includes(e.id)) {
            await target.click(); await sleep(700);
            const after = await signature(window);
            r.effect = diff(before, after);
            if (Object.keys(r.effect).length === 0) r.effect = 'NO OBSERVABLE CHANGE';
          } else {
            r.effect = 'present+enabled (click skipped: mutating/terminal)';
          }
          results[e.id] = r; continue;
        }

        if (e.surface === 'flyout') {
          if (e.id === 'annotate') {
            await gotoStage(window, 3);
            const before = await signature(window);
            const v = window.locator('[data-dock-verb="annotate"]').first();
            if (await v.count() === 0) { r.effect = 'annotate verb missing'; results[e.id] = r; continue; }
            await v.click(); await sleep(700);
            r.effect = diff(before, await signature(window));
            results[e.id] = r; continue;
          }
          // open the flyout then arm the tool
          await gotoStage(window, 3);
          if (await window.locator('[data-annotation-flyout]').count() === 0) {
            const v = window.locator('[data-dock-verb="annotate"]').first();
            if (await v.count() > 0) { await v.click(); await sleep(500); }
          }
          const kind = ANN_KIND[e.id];
          if (e.id === 'annColor') {
            const c = window.locator('[data-ann-color]');
            r.present = await c.count() > 0;
            r.effect = r.present ? 'color control present in flyout' : 'color control MISSING in flyout';
            results[e.id] = r; continue;
          }
          if (e.id === 'annPenWidth') {
            // arm ink, then open the dropdown and look for the pen-width row
            await window.evaluate(() => {
              const b = document.querySelector('[data-ann-tools-visible] button[data-tool="ink"]');
              if (b) b.click();
            });
            await sleep(300);
            await window.evaluate(() => { const t = document.querySelector('[data-ann-dropdown-toggle]'); if (t) t.click(); });
            await sleep(400);
            const pw = await window.locator('[data-pen-width-row]').count();
            r.present = pw > 0;
            r.effect = pw > 0 ? 'pen width row present in flyout dropdown (ink armed)' : 'pen width row MISSING';
            results[e.id] = r; continue;
          }
          const vis = window.locator(`[data-ann-tools-visible] button[data-tool="${kind}"]`);
          const before = await signature(window);
          if (await vis.count() > 0) {
            await vis.first().click(); await sleep(500);
            r.effect = diff(before, await signature(window));
            r.lane = 'flyout-visible';
          } else {
            await window.evaluate(() => { const t = document.querySelector('[data-ann-dropdown-toggle]'); if (t) t.click(); });
            await sleep(400);
            const row = window.locator(`[data-ann-dropdown-menu] button[data-tool="${kind}"]`);
            if (await row.count() > 0) {
              await row.first().click(); await sleep(500);
              r.effect = diff(before, await signature(window));
              r.lane = 'flyout-dropdown';
            } else {
              r.effect = 'tool MISSING in flyout visible+dropdown';
            }
          }
          if (r.effect && Object.keys(r.effect).length === 0) r.effect = 'NO OBSERVABLE CHANGE';
          results[e.id] = r; continue;
        }

        if (e.surface === 'panel') {
          if (e.id === 'pageThumbnails') { r.present = inventory.thumbs > 0; r.effect = `thumbs in PAGES panel: ${inventory.thumbs}`; results[e.id] = r; continue; }
          if (e.id === 'outlinePanel') { r.present = inventory.outlineToggle > 0; r.effect = `outline toggle present: ${inventory.outlineToggle}`; results[e.id] = r; continue; }
          if (e.id === 'annotationsPanel') {
            await gotoStage(window, 3);
            r.present = await window.locator('[data-annotation-panel]').count() > 0;
            r.effect = r.present ? 'annotations panel present in REVIEW ContextPanel' : 'MISSING';
            results[e.id] = r; continue;
          }
          if (e.id === 'pageContextMenu') {
            await gotoStage(window, 1);
            const thumb = window.locator('.thumb-item').first();
            if (await thumb.count() === 0) { r.effect = 'no thumbnails to right-click'; results[e.id] = r; continue; }
            await thumb.click({ button: 'right' }); await sleep(400);
            r.present = await window.locator('[data-context-menu]').count() > 0;
            r.items = await window.evaluate(() => Array.from(document.querySelectorAll('[data-context-menu] [data-menu-item]')).map((b) => b.getAttribute('data-menu-item')));
            r.effect = r.present ? `context menu items=${JSON.stringify(r.items)}` : 'context menu MISSING';
            results[e.id] = r; continue;
          }
          if (e.id === 'dragPage') {
            await gotoStage(window, 1);
            r.draggable = await window.evaluate(() => {
              const t = document.querySelector('.thumb-item');
              return t ? t.getAttribute('draggable') : null;
            });
            r.effect = `thumb-item draggable=${r.draggable}`;
            results[e.id] = r; continue;
          }
          if (e.id === 'clearPageSelection') {
            await gotoStage(window, 1);
            const thumb = window.locator('.thumb-item').first();
            if (await thumb.count() === 0) { r.effect = 'no thumbnails'; results[e.id] = r; continue; }
            await thumb.click(); await sleep(400);
            const before = await signature(window);
            const clear = window.locator('[data-dock-verb="clearPageSelection"]').first();
            r.present = await clear.count() > 0;
            if (r.present) { await clear.click(); await sleep(400); r.effect = diff(before, await signature(window)); }
            else r.effect = 'Clear verb not present after selecting a page';
            results[e.id] = r; continue;
          }
          if (e.id === 'editDefaultFont') {
            await gotoStage(window, 2);
            const v = window.locator('[data-dock-verb="editMode"]').first();
            if (await v.count() > 0) { await v.click(); await sleep(700); }
            r.present = await window.locator('[data-edit-toolbar] select, [data-edit-toolbar]').count() > 0;
            r.fontControl = await window.evaluate(() => {
              const sel = document.querySelector('[data-edit-toolbar] select');
              return sel ? { options: sel.options.length, value: sel.value } : null;
            });
            r.effect = r.present ? `edit toolbar present; font control=${JSON.stringify(r.fontControl)}` : 'edit toolbar MISSING';
            results[e.id] = r; continue;
          }
          if (e.id === 'zoomIn' || e.id === 'zoomOut' || e.id === 'fitWidth' || e.id === 'fitPage') {
            await gotoStage(window, 1);
            const sel = { zoomIn: '[data-zoom-pill] button[aria-label="Zoom in"]', zoomOut: '[data-zoom-pill] button[aria-label="Zoom out"]' }[e.id];
            if (sel) {
              const b = window.locator(sel);
              r.present = await b.count() > 0;
              const before = await window.evaluate(() => document.querySelector('[data-zoom-pill] .zoom-percent')?.textContent);
              if (r.present) { await b.first().click(); await sleep(400); }
              const after = await window.evaluate(() => document.querySelector('[data-zoom-pill] .zoom-percent')?.textContent);
              r.effect = `${before} -> ${after}`;
            } else {
              // fit width/page are palette/pill-independent: use palette
              const pr = await paletteRun(window, e.label);
              r.effect = JSON.stringify(pr);
            }
            results[e.id] = r; continue;
          }
          if (e.id === 'prevPage' || e.id === 'nextPage' || e.id === 'pageJump') {
            await gotoStage(window, 1);
            r.effect = `pills present: ${inventory.pagePillInput > 0 ? 'yes' : 'no'}`;
            if (inventory.pagePillInput > 0) {
              const before = await window.evaluate(() => document.querySelector('[data-page-pill] input')?.value);
              if (e.id === 'nextPage') await window.locator('[data-page-pill] button[aria-label="Next page"]').first().click();
              else if (e.id === 'prevPage') await window.locator('[data-page-pill] button[aria-label="Previous page"]').first().click();
              else {
                const inp = window.locator('[data-page-pill] input').first();
                await inp.fill('3'); await inp.press('Enter');
              }
              await sleep(500);
              const after = await window.evaluate(() => document.querySelector('[data-page-pill] input')?.value);
              r.effect = `${before} -> ${after}`;
            }
            results[e.id] = r; continue;
          }
          if (e.id === 'panMode') {
            await gotoStage(window, 1);
            const b = window.locator('[data-hand-toggle]').first();
            r.present = await b.count() > 0;
            const before = await window.evaluate(() => document.querySelector('[data-hand-toggle]')?.getAttribute('data-hand-active'));
            if (r.present) { await b.click(); await sleep(400); }
            const after = await window.evaluate(() => document.querySelector('[data-hand-toggle]')?.getAttribute('data-hand-active'));
            r.effect = `${before} -> ${after}`;
            results[e.id] = r; continue;
          }
          if (e.id === 'railCollapse') {
            await gotoStage(window, 1);
            const b = window.locator('[data-rail-collapse]').first();
            r.present = await b.count() > 0;
            const before = await window.evaluate(() => document.querySelector('[data-context-panel]')?.getAttribute('data-context-panel-collapsed'));
            if (r.present) { await b.click(); await sleep(500); }
            const after = await window.evaluate(() => document.querySelector('[data-context-panel]')?.getAttribute('data-context-panel-collapsed'));
            r.effect = `${before} -> ${after}`;
            results[e.id] = r; continue;
          }
          if (['paneOpen', 'panePick', 'paneClear', 'paneResize'].includes(e.id)) {
            r.effect = 'multi-mode-only: tested in p3';
            results[e.id] = r; continue;
          }
          r.effect = 'panel entry with no rule (INVESTIGATE)';
          results[e.id] = r; continue;
        }

        // palette surface
        if (e.surface === 'palette') {
          // Title-bar / menu / rail hosts get a presence check plus a palette run.
          if (NO_CLICK.has(e.id)) {
            const pr = await paletteRun(window, e.label);
            r.effect = JSON.stringify({ palette: pr });
            results[e.id] = r; await closePalette(window); continue;
          }
          if (e.id === 'appMenu') {
            const mb = window.locator('[data-menu-button]').first();
            r.present = await mb.count() > 0;
            if (r.present) {
              await mb.click(); await sleep(400);
              r.items = await window.evaluate(() => Array.from(document.querySelectorAll('[data-menu-popover] [data-menu-action]')).map((b) => b.getAttribute('data-menu-action')));
              r.effect = `File menu items=${JSON.stringify(r.items)}`;
              await window.keyboard.press('Escape');
            } else r.effect = 'File menu button MISSING';
            results[e.id] = r; continue;
          }
          if (e.id === 'openSample' || e.id === 'openRecent' || e.id === 'removeRecent') {
            // Only reachable from the welcome screen with the doc closed; record
            // the palette state (disabled) and the welcome state separately.
            const pr = await paletteRun(window, e.label);
            r.effect = JSON.stringify({ palette: pr });
            results[e.id] = r; await closePalette(window); continue;
          }
          if (e.id === 'toolsPalette') {
            await closePalette(window);
            await window.keyboard.press('Control+k');
            await sleep(500);
            r.present = await window.locator('[data-command-palette]').count() > 0;
            r.effect = `palette opened by Ctrl+K: ${r.present}`;
            results[e.id] = r; await closePalette(window); continue;
          }
          if (e.id === 'stagePages' || e.id === 'stageEdit' || e.id === 'stageReview' || e.id === 'stageDeliver') {
            const pr = await paletteRun(window, e.label);
            r.effect = JSON.stringify({ palette: pr });
            results[e.id] = r; await closePalette(window); continue;
          }
          if (e.id === 'print') {
            const before = await signature(window);
            const pr = await paletteRun(window, 'Print');
            r.effect = JSON.stringify(pr.effect);
            results[e.id] = r; await reset(window); continue;
          }
          const pr = await paletteRun(window, e.label);
          r.effect = JSON.stringify(pr);
          results[e.id] = r; await closePalette(window); continue;
        }

        r.effect = 'unclassified surface';
        results[e.id] = r;
      } catch (err) {
        r.error = String(err && err.message || err);
        results[e.id] = r;
        await reset(window).catch(() => {});
      }
    }

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p2.json'), JSON.stringify({ inventory, results }, null, 2));
    const summary = Object.values(results).map((r) => `${r.id} [${r.surface}] present=${r.present} disabled=${r.disabled} :: ${typeof r.effect === 'string' ? r.effect : JSON.stringify(r.effect)}`);
    fs.writeFileSync(path.join(__dirname, 'out', 'p2.summary.txt'), summary.join('\n'));
    console.log('=== SUMMARY ===');
    console.log(summary.join('\n'));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p2.error.txt'), String(err && err.stack || err));
    fs.writeFileSync(path.join(__dirname, 'out', 'p2.partial.json'), JSON.stringify(results, null, 2));
  } finally {
    await app.close().catch(() => {});
  }
})();
