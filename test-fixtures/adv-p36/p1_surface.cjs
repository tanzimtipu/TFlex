// ADV phase-36 probe 1: surface inventory + full Command Palette row matrix.
'use strict';
const { boot, openSample, shot, gotoStage, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const { app, window } = await boot({ profile: 'p1' });
  const out = { stages: {}, palette: {}, inspector: {}, pills: {}, rails: {} };
  try {
    const welcome = await window.evaluate(() => ({
      welcome: !!document.querySelector('[data-welcome], .welcome'),
      stageRail: !!document.querySelector('[data-stage-rail]'),
      dock: !!document.querySelector('[data-action-dock]'),
      inspector: !!document.querySelector('[data-inspector]'),
    }));
    out.rails.emptyState = welcome;
    await shot(window, 'adv-p36/p1-welcome.png');

    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1200);

    // ---- per-stage surfaces ----
    for (const n of [1, 2, 3, 4]) {
      await gotoStage(window, n);
      out.stages[n] = await window.evaluate(() => {
        const dock = document.querySelector('[data-action-dock]');
        const verbs = Array.from(document.querySelectorAll('[data-dock-verb]')).map((b) => ({
          id: b.getAttribute('data-dock-verb'),
          disabled: b.disabled,
          pressed: b.getAttribute('aria-pressed'),
          title: b.getAttribute('title'),
          text: (b.textContent || '').trim(),
        }));
        const overflowItems = Array.from(document.querySelectorAll('[data-dock-overflow-item]')).map((b) => b.getAttribute('data-dock-overflow-item'));
        const pins = Array.from(document.querySelectorAll('[data-dock-pin]')).map((b) => b.getAttribute('data-dock-pin'));
        const panel = document.querySelector('[data-context-panel]');
        const insp = document.querySelector('[data-inspector]');
        const sections = Array.from(document.querySelectorAll('[data-context-panel-section]')).map((s) => s.getAttribute('data-context-panel-section'));
        const inspSections = Array.from(document.querySelectorAll('[data-inspector-section]')).map((s) => s.getAttribute('data-inspector-section'));
        const inspSlots = Array.from(document.querySelectorAll('[data-inspector-slot]')).map((s) => s.getAttribute('data-inspector-slot'));
        const actions = Array.from(document.querySelectorAll('[data-inspector-action]')).map((b) => ({
          id: b.getAttribute('data-inspector-action'), disabled: b.disabled,
        }));
        const panelActions = Array.from(document.querySelectorAll('[data-context-panel-action]')).map((b) => ({
          id: b.getAttribute('data-context-panel-action'), disabled: b.disabled,
        }));
        return {
          railActive: document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage'),
          railCompact: document.querySelector('[data-stage-rail]')?.getAttribute('data-stage-rail-compact'),
          dockState: dock?.getAttribute('data-dock-state'),
          dockIdle: dock?.getAttribute('data-dock-idle'),
          dockIconOnly: dock?.getAttribute('data-dock-icon-only'),
          dockCompact: dock?.getAttribute('data-dock-compact'),
          dockBand: dock?.getAttribute('data-dock-band'),
          dockLift: dock?.getAttribute('data-dock-lift'),
          verbs, overflowItems, pins,
          panelStage: panel?.getAttribute('data-context-panel-stage'),
          panelCollapsed: panel?.getAttribute('data-context-panel-collapsed'),
          panelHeader: (document.querySelector('.context-panel-header .sheet-title, .context-panel-header')?.textContent || '').trim().slice(0, 80),
          sections, panelActions,
          inspStage: insp?.getAttribute('data-inspector-stage'),
          inspSelection: insp?.getAttribute('data-inspector-selection'),
          inspSections, inspSlots, actions,
          thumbCount: document.querySelectorAll('[data-thumb], .thumb-wrap').length,
          annPanel: !!document.querySelector('[data-annotation-panel]'),
        };
      });
      await shot(window, `adv-p36/p1-stage${n}.png`);
    }

    // ---- pills ----
    await gotoStage(window, 1);
    out.pills = await window.evaluate(() => {
      const p = document.querySelector('[data-page-pill]');
      const z = document.querySelector('[data-zoom-pill]');
      const box = (el) => el ? el.getBoundingClientRect().toJSON() : null;
      return {
        page: box(p), zoom: box(z),
        pageText: p ? p.textContent.trim() : null,
        zoomText: z ? z.textContent.trim() : null,
        controls: p ? Array.from(p.querySelectorAll('button,input')).map((c) => ({
          tag: c.tagName, label: c.getAttribute('aria-label') || c.getAttribute('title') || '', disabled: c.disabled,
        })) : [],
      };
    });

    // ---- Command Palette full row matrix (empty query renders every row) ----
    await window.keyboard.press('Control+k');
    await window.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
    await window.waitForTimeout(400);
    out.palette.empty = await window.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.command-palette-row'));
      return {
        count: document.querySelector('[data-command-palette-count]')?.getAttribute('data-command-palette-count'),
        rows: rows.map((r) => ({
          kind: r.getAttribute('data-palette-row'),
          id: r.getAttribute('data-palette-tool-id'),
          stage: r.getAttribute('data-stage'),
          disabled: r.getAttribute('data-palette-disabled'),
          pinned: r.getAttribute('data-palette-pinned'),
          title: r.getAttribute('title'),
          label: r.querySelector('.command-palette-row-label')?.textContent || '',
        })),
      };
    });
    await shot(window, 'adv-p36/p1-palette-empty.png');
    out.palette.registeredIds = out.palette.empty.rows.filter((r) => r.kind === 'tool').map((r) => r.id);

    // hostile queries
    const q = async (text) => {
      await window.locator('[data-command-palette-input]').fill(text);
      await window.waitForTimeout(300);
      return window.evaluate(() => ({
        count: document.querySelector('[data-command-palette-count]')?.getAttribute('data-command-palette-count'),
        rows: Array.from(document.querySelectorAll('.command-palette-row')).slice(0, 8).map((r) => ({
          id: r.getAttribute('data-palette-tool-id'), label: r.querySelector('.command-palette-row-label')?.textContent || '', disabled: r.getAttribute('data-palette-disabled'),
        })),
        empty: !!document.querySelector('[data-command-palette-empty]'),
        highlighted: document.querySelector('.command-palette-row[aria-selected="true"]')?.getAttribute('data-palette-tool-id') || null,
      }));
    };
    out.palette.query = {};
    out.palette.query.crop = await q('crop');
    out.palette.query.long = await q('x'.repeat(4000));
    out.palette.query.unicode = await q('签名 \u00e9\u00e8\u4f60\u597d \ud83d\ude00');
    out.palette.query.regex = await q('.*[a-z]+\\d{2,');
    out.palette.query.none = await q('zzzzzzzznotatool');
    await shot(window, 'adv-p36/p1-palette-none.png');
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);

    // ---- File menu ----
    await window.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    const fileBtn = window.locator('[data-titlebar-menu], [data-app-menu]').first();
    if (await fileBtn.count() > 0) {
      await fileBtn.click().catch(() => {});
      await window.waitForTimeout(400);
      out.fileMenu = await window.evaluate(() => ({
        open: !!document.querySelector('[data-menu-panel], [role="menu"]'),
        text: (document.querySelector('[data-menu-panel]')?.textContent || '').replace(/\s+/g, ' ').trim(),
        items: Array.from(document.querySelectorAll('[data-menu-panel] [role="menuitem"], [data-menu-panel] button')).map((b) => (b.textContent || '').trim()),
      }));
      await shot(window, 'adv-p36/p1-filemenu.png');
      await window.keyboard.press('Escape');
    } else {
      out.fileMenu = { error: 'no menu button found' };
    }

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p1.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p1.error.txt'), String(err && err.stack || err));
  } finally {
    await app.close().catch(() => {});
  }
})();
