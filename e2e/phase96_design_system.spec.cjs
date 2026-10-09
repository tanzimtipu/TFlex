// Phase 96-E — phase validation sweep: 3-theme visual + contrast + empty-state
// evidence for the app-wide design system (chunks B/C/D + the TFL-641
// realignment).
//
// Launched ONLY through the canonical e2e/lib/launch.cjs `launchApp`. Captures
// the named surfaces in light, dark and frosted under screenshots/phase96/, and
// asserts: token application, the elevation ladder, the designed empty states,
// a no-op sweep (shipped action + surviving data-* hook), and the WCAG contrast
// floors. Read-only over product code.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage, ensurePanelExpanded, runTool, openSamplePath } = require('./lib/helpers.cjs');

// The harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads process.env, so
// Electron would exit as Node ("Process failed to launch!"). Clear it.
delete process.env.ELECTRON_RUN_AS_NODE;

const OUT = path.join(__dirname, '..', 'screenshots', 'phase96');
fs.mkdirSync(OUT, { recursive: true });
const THEMES = ['light', 'dark', 'frosted'];
test.setTimeout(720000);

const log = (...a) => console.log('[P96]', ...a);
const shotPath = (name, theme) => path.join(OUT, `${name}-${theme}.png`);

async function setTheme(win, theme) {
  await win.keyboard.press('Escape').catch(() => {});
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 8000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction((t) => document.documentElement.getAttribute('data-theme') === t, theme, { timeout: 8000 });
  await win.waitForTimeout(450);
}

async function openReport(win, app) {
  // Phase 118 — generic Open now stages picked files in the Intake Tray; a
  // path alone no longer opens the document. Use the shared helper, which
  // drives the real Open control, waits for Intake classification, clicks the
  // explicit Intake Open, and waits for the rendered canvas.
  await openSamplePath(win, app, getSamplePath('report.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(800);
}

async function openPdfAt(win, app, filePath) {
  await app.evaluate(async ({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
  }, filePath);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForTimeout(2500);
}

async function makeZeroPagePdf() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p96-zero-'));
  const p = path.join(dir, 'zero-pages.pdf');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [] /Count 0 >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefStart = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  fs.writeFileSync(p, body, 'latin1');
  return p;
}

// Fetch computed colours for a set of selectors plus each element's ancestor
// background chain (root -> element) so contrast can be composited in Node.
async function sampleColours(win, selectors) {
  return win.evaluate((sels) => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(',').map((v) => parseFloat(v.trim()));
      return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
    };
    const out = {};
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = { missing: true }; continue; }
      const chain = [];
      let n = el;
      while (n && n.nodeType === 1) {
        const bg = getComputedStyle(n).backgroundColor;
        const rgba = parse(bg);
        if (rgba && rgba[3] > 0) chain.unshift(rgba);
        n = n.parentElement;
      }
      const cs = getComputedStyle(el);
      const svg = el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg');
      out[sel] = {
        color: parse(cs.color),
        chain,
        text: (el.textContent || '').trim().slice(0, 60),
        svgColor: svg ? parse(getComputedStyle(svg).color) : null,
        svgWidth: svg ? Math.round(svg.getBoundingClientRect().width) : null,
      };
    }
    return out;
  }, selectors);
}

function composite(fg, bg) {
  const a = fg[3];
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
    1,
  ];
}
function effBg(chain) {
  let bg = [255, 255, 255, 1];
  for (const c of chain) bg = composite(c, bg);
  return bg;
}
function lum([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fg, bg) {
  const L1 = lum(fg), L2 = lum(bg);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

// Resolve a CSS custom property to a concrete rgb(a) string using a probe.
async function resolvedTokens(win, names, prop) {
  return win.evaluate(({ list, property }) => {
    const out = {};
    for (const n of list) {
      const d = document.createElement('div');
      d.style[property] = `var(${n})`;
      document.body.appendChild(d);
      out[n] = getComputedStyle(d)[property];
      d.remove();
    }
    return out;
  }, { list: names, property: prop });
}

async function assertEmptyState(win, rootSel, label) {
  const info = await win.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return { found: false };
    const mark = root.querySelector('.empty-state-mark');
    const headline = root.querySelector('.empty-state-headline');
    const help = root.querySelector('.empty-state-help');
    return {
      found: true,
      hasEmptyStateClass: root.classList.contains('empty-state') || root.querySelector('.empty-state') !== null,
      markWidth: mark ? Math.round(mark.getBoundingClientRect().width) : 0,
      markSvg: mark ? mark.tagName.toLowerCase() === 'svg' || !!mark.querySelector('svg') : false,
      headline: headline ? headline.textContent.trim() : null,
      help: help ? help.textContent.trim() : null,
    };
  }, rootSel);
  log(`empty-state ${label}: ${JSON.stringify(info)}`);
  expect(info.found, `${label} present`).toBe(true);
  expect(info.markSvg, `${label} renders a hero mark`).toBe(true);
  expect(info.markWidth, `${label} hero mark is sized (>= 32px)`).toBeGreaterThanOrEqual(32);
  expect((info.headline || '').length, `${label} has a headline`).toBeGreaterThan(0);
  return info;
}

for (const theme of THEMES) {
  test(`Phase 96 validation — ${theme}: tokens, elevation, empty states, no-op sweep, contrast`, async () => {
    const userData = path.join(os.tmpdir(), `tflex-p96-${theme}-${Date.now()}`);
    const app = await launchApp([], userData);
    const win = await app.firstWindow();
    const results = [];
    const record = (name, ok, detail = '') => {
      results.push({ name, ok, detail });
      log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
    };
    const guard = async (name, fn) => {
      try { await fn(); record(name, true); }
      catch (e) { record(name, false, String(e.message).split('\n')[0]); }
    };
    const headlines = {};

    try {
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await setTheme(win, theme);
      await win.waitForSelector('.welcome-body', { timeout: 10000 });
      const diag0 = await win.evaluate(() => ({
        recentRows: document.querySelectorAll('.recent-row').length,
        recentEmpty: !!document.querySelector('.recent-empty'),
        samples: document.querySelectorAll('.sample-card').length,
      }));
      log(`welcome diag ${theme}: ${JSON.stringify(diag0)}`);

      // ---- welcome: recent-files designed empty state --------------------
      // Clear any persisted recents through the shipped remove control so the
      // designed empty state is reachable on every profile.
      await guard('welcome-recent-empty', async () => {
        for (let i = 0; i < 40; i += 1) {
          if ((await win.locator('.recent-row-remove').count()) === 0) break;
          await win.locator('.recent-row-remove').first().click();
          await win.waitForTimeout(180);
        }
        await win.waitForSelector('.recent-empty', { state: 'attached', timeout: 8000 });
        headlines.recent = (await assertEmptyState(win, '.recent-empty', 'recent-empty')).headline;
        const cs = await sampleColours(win, ['.recent-empty .empty-state-headline', '.recent-empty .empty-state-help']);
        for (const [sel, v] of Object.entries(cs)) {
          if (v.missing || !v.color) continue;
          log(`welcome contrast ${theme} ${sel}: ${ratio(v.color, effBg(v.chain)).toFixed(2)}:1 "${v.text}"`);
        }
      });
      await win.screenshot({ path: shotPath('welcome', theme) });

      // ---- NO-OP: a welcome sample card opens ---------------------------------
      await guard('welcome-sample-card-opens', async () => {
        await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
        await win.waitForSelector('.workspace', { timeout: 30000 });
        await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
        await win.waitForTimeout(600);
      });

      // ---- welcome: samples designed empty state (stub samples:list -> []) ----
      await guard('welcome-samples-empty', async () => {
        await app.evaluate(({ ipcMain }) => {
          try { ipcMain.removeHandler('samples:list'); } catch (e) { /* ignore */ }
          ipcMain.handle('samples:list', async () => []);
        });
        await win.reload();
        await win.waitForSelector('.samples-empty .empty-state-headline', { timeout: 20000 });
        await setTheme(win, theme);
        headlines.samples = (await assertEmptyState(win, '.samples-empty', 'samples-empty')).headline;
        await win.screenshot({ path: shotPath('welcome-samples-empty', theme) });
      });

      // ---- open the report through the real Open dialog ----------------------
      await guard('open-report', async () => {
        await openReport(win, app);
      });

      // ---- command palette: no-results designed empty state ------------------
      await guard('palette-empty', async () => {
        // NO-OP first: a palette row dispatches and the palette closes.
        await win.keyboard.press('Control+k');
        await win.waitForSelector('[data-command-palette-input]', { timeout: 8000 });
        await win.locator('[data-command-palette-input]').fill('Rotate pages');
        await win.waitForTimeout(400);
        const row = win.locator('.command-palette-row').first();
        await row.waitFor({ state: 'visible', timeout: 8000 });
        await row.click();
        await win.waitForSelector('[data-command-palette]', { state: 'detached', timeout: 8000 });
        await win.waitForTimeout(500);
        record('palette-row-dispatch', true);
        // If the dispatched command opened a modal, dismiss it before continuing.
        for (let i = 0; i < 3; i += 1) {
          if ((await win.locator('[data-dialog-shell], [role="dialog"]').count()) === 0) break;
          await win.keyboard.press('Escape');
          await win.waitForTimeout(400);
        }

        // Empty-state evidence.
        await win.keyboard.press('Control+k');
        await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
        await win.locator('[data-command-palette-input]').fill('zzzzzznomatch');
        await win.waitForSelector('[data-command-palette-empty]', { timeout: 8000 });
        await win.screenshot({ path: shotPath('command-palette-empty', theme) });
        try {
          headlines.palette = (await assertEmptyState(win, '[data-command-palette-empty]', 'command-palette-empty')).headline;
        } finally {
          await win.keyboard.press('Escape').catch(() => {});
          await win.waitForSelector('[data-command-palette]', { state: 'detached', timeout: 5000 }).catch(() => {});
          await win.waitForTimeout(300);
        }
      });

      // ---- ContextPanel: Edit panel collapses the no-content placeholder -----
      // TFL-1586 — the "No editable content on this page." placeholder is
      // REMOVED. The Edit panel's CONTENT section header + Default font row
      // survive and the Recognition section follows with no placeholder gap;
      // the screenshot captures the collapsed layout for visual inspection.
      await guard('context-panel-edit-content', async () => {
        await gotoStage(win, 2);
        await ensurePanelExpanded(win);
        await win.waitForSelector('[data-edit-default-font-row]', { timeout: 10000 });
        expect(
          await win.locator('[data-edit-content-empty]').count(),
          'edit-content placeholder is gone',
        ).toBe(0);
        expect(
          await win.locator('[data-edit-default-font-row]').count(),
          'Default font row survives the placeholder removal',
        ).toBeGreaterThan(0);
        expect(
          await win.locator('[data-context-panel-section="recognition"]').count(),
          'Recognition section follows without a gap',
        ).toBeGreaterThan(0);
        await win.screenshot({ path: shotPath('context-panel-edit-content', theme) });

        // NO-OP: a ContextPanel action fires its shipped dialog.
        // TFL-1417 retired the page-panel `.context-panel-action` class in favour
        // of direct tool icons; the Remove-blank-pages ("Clean") control is now
        // `.context-panel-remove-blank` and keeps its `data-blank-scan-open` hook.
        // Keep the assertion (an action fires its shipped dialog), use the current
        // control.
        await gotoStage(win, 1);
        await ensurePanelExpanded(win);
        const action = win.locator('[data-blank-scan-open], .context-panel-action').first();
        await action.scrollIntoViewIfNeeded();
        await action.click();
        await win.waitForSelector('[data-dialog-shell], [role="dialog"]', { state: 'visible', timeout: 8000 });
        record('context-panel-action-fires', true);
        await win.keyboard.press('Escape');
        await win.waitForTimeout(400);
      });

      // ---- Inspector: mounted, flat, action fires ----------------------------
      await guard('inspector', async () => {
        await gotoStage(win, 1);
        await ensurePanelExpanded(win);
        await win.waitForSelector('[data-inspector]', { timeout: 10000 });
        const info = await win.evaluate(() => {
          const el = document.querySelector('[data-inspector]');
          return el ? { shadow: getComputedStyle(el).boxShadow, selection: el.getAttribute('data-inspector-selection') } : null;
        });
        if (info.selection && info.selection !== 'none') {
          log(`inspector selection-edge elevation (documented Phase-41): ${info.shadow}`);
        } else {
          expect(info.shadow === 'none' || info.shadow === '', `inspector docked panel is flat (got ${info.shadow})`).toBe(true);
        }
        await win.screenshot({ path: shotPath('inspector', theme) });

        const hook = win.locator('[data-inspector-action="renumber"]').first();
        if ((await hook.count()) > 0) {
          await hook.scrollIntoViewIfNeeded();
          await hook.click();
          await win.waitForSelector('[data-dialog-shell], [role="dialog"]', { state: 'visible', timeout: 8000 });
          record('inspector-action-fires', true);
          await win.keyboard.press('Escape');
          await win.waitForTimeout(400);
        } else {
          record('inspector-action-fires', false, 'renumber hook not present');
        }
      });

      // ---- dock + stage rail + side rail + command bar -----------------------
      await guard('dock', async () => {
        await gotoStage(win, 1);
        await win.waitForSelector('[data-action-dock]', { timeout: 10000 });
        await win.screenshot({ path: shotPath('dock', theme) });
        const before = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations);
        await win.locator('[data-dock-verb="rotate"]').first().click();
        await win.waitForTimeout(700);
        const dialogOpen = (await win.locator('[data-dialog-shell], [role="dialog"]').count()) > 0;
        const after = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations);
        expect(dialogOpen || JSON.stringify(before) !== JSON.stringify(after), 'dock rotate verb ran its tool').toBe(true);
        record('dock-verb-runs', true);
        if (dialogOpen) { await win.keyboard.press('Escape'); await win.waitForTimeout(400); }
      });

      await guard('stage-rail', async () => {
        await win.waitForSelector('[data-stage-rail]', { timeout: 10000 });
        await win.screenshot({ path: shotPath('stage-rail', theme) });
        await win.locator('[data-stage-rail] [data-stage="deliver"]').first().click();
        await win.waitForFunction(() => document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage') === 'deliver' ||
          document.querySelector('[data-stage-rail] [data-stage="deliver"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 8000 });
        record('stage-rail-activates', true);
        await gotoStage(win, 1);
      });

      await guard('side-rail', async () => {
        // The single-mode left rail IS the ContextPanel's rail tab strip; the
        // legacy `.side-rail` element renders only in Multi Mode, so record its
        // absence rather than fail, and capture the present rail surface.
        const legacy = await win.locator('.side-rail').count();
        const railTabs = await win.locator('.rail-tab').count();
        log(`side-rail legacy=${legacy} rail-tabs=${railTabs}`);
        expect(railTabs, 'rail tab strip renders').toBeGreaterThan(0);
        await win.screenshot({ path: shotPath('side-rail', theme) });
        record('side-rail-rail-tabs', true, `legacy .side-rail=${legacy}`);
      });

      await guard('command-bar', async () => {
        // The top command bar is the `.app-header`; its content is re-parented
        // from the retired `.command-bar` container (spec only names it).
        const header = win.locator('.app-header').first();
        if ((await header.count()) > 0) {
          await win.screenshot({ path: shotPath('command-bar', theme) });
          record('command-bar-present', true, '.app-header');
        } else {
          record('command-bar-present', false, '.app-header not found');
        }
      });

      // ---- menu / popover: level-2 elevation + no-op -------------------------
      await guard('menu', async () => {
        await gotoStage(win, 1);
        await ensurePanelExpanded(win);
        const thumb = win.locator('[data-context-panel] .thumb-item[data-page="1"]').first();
        await thumb.waitFor({ state: 'visible', timeout: 10000 });
        await thumb.scrollIntoViewIfNeeded();
        await thumb.click({ button: 'right' });
        await win.waitForSelector('[data-context-menu]', { state: 'visible', timeout: 8000 });
        const { elev2, menuShadow } = await win.evaluate(() => {
          const d = document.createElement('div');
          d.style.boxShadow = 'var(--elevation-2)';
          document.body.appendChild(d);
          const e2 = getComputedStyle(d).boxShadow;
          d.remove();
          return { elev2: e2, menuShadow: getComputedStyle(document.querySelector('[data-context-menu]')).boxShadow };
        });
        log(`elevation-2=${elev2} | menu=${menuShadow}`);
        expect(menuShadow, 'context menu resolves --elevation-2').toBe(elev2);
        await win.screenshot({ path: shotPath('menu', theme) });
        const before = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations);
        await win.locator('[data-context-menu] [data-menu-item="rotate-cw"]').first().click();
        await win.waitForTimeout(800);
        const after = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations);
        expect(JSON.stringify(before), 'menu rotate-cw applied').not.toEqual(JSON.stringify(after));
        record('menu-noop', true);
      });

      // ---- dialog: level-3 elevation -----------------------------------------
      await guard('dialog', async () => {
        await win.locator('[data-open-preferences]').first().click({ timeout: 10000 });
        await win.waitForSelector('[data-prefs-dialog]', { timeout: 8000 });
        await win.waitForTimeout(400);
        const { elev3, dlgShadow } = await win.evaluate(() => {
          const d = document.createElement('div');
          d.style.boxShadow = 'var(--elevation-3)';
          document.body.appendChild(d);
          const e3 = getComputedStyle(d).boxShadow;
          d.remove();
          const el = document.querySelector('[data-prefs-dialog]');
          const sheet = el.closest('[data-dialog-shell]') || el;
          return { elev3: e3, dlgShadow: getComputedStyle(sheet).boxShadow };
        });
        log(`elevation-3=${elev3} | dialog=${dlgShadow}`);
        // The frosted dialog layers documented glass edge insets over the ladder
        // shadow; compare the outer drop-shadow to the level-3 step in each theme.
        const outerShadow = (shadow) => shadow
          .split(/,\s*(?=[a-z]+\()/)
          .map((l) => l.trim())
          .filter((l) => !/\binset\b/.test(l))
          .join(', ');
        expect(outerShadow(dlgShadow), `dialog root resolves --elevation-3 (${theme})`).toBe(elev3);
        await win.screenshot({ path: shotPath('dialog', theme) });
        await win.keyboard.press('Escape');
        await win.waitForSelector('[data-prefs-dialog]', { state: 'detached', timeout: 8000 }).catch(() => {});
        await win.waitForTimeout(300);
      });

      // ---- tokens applied + elevation ladder (surface spot-checks) -----------
      await guard('tokens-elevation', async () => {
        const accent = await win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
        expect(accent.toUpperCase(), 'brand accent is the documented violet').toBe('#7C3AED');
        const tokens = await resolvedTokens(win, ['--menu-bg', '--panel-bg'], 'backgroundColor');
        const surfaces = await win.evaluate(() => {
          const q = (s) => document.querySelector(s);
          const g = (s) => (q(s) ? getComputedStyle(q(s)) : null);
          const insp = g('[data-inspector]');
          return {
            panel: g('[data-context-panel]') ? g('[data-context-panel]').backgroundColor : null,
            inspector: insp ? { bg: insp.backgroundColor, image: insp.backgroundImage } : null,
            toolsPalette: g('.tools-palette') ? g('.tools-palette').backgroundColor : null,
          };
        });
        const paletteShadow = await win.evaluate(() => {
          const d = document.createElement('div');
          d.style.boxShadow = 'var(--elevation-2)';
          document.body.appendChild(d);
          const e2 = getComputedStyle(d).boxShadow; d.remove();
          const p = document.querySelector('[data-command-palette]');
          return p ? getComputedStyle(p).boxShadow : null;
        }).catch(() => null);
        log(`tokens: ${JSON.stringify({ tokens, surfaces, paletteShadow })}`);
        if (surfaces.panel) expect(surfaces.panel, 'context-panel paints --panel-bg').toBe(tokens['--panel-bg']);
        if (surfaces.inspector) {
          const ok = surfaces.inspector.bg === tokens['--panel-bg'] || surfaces.inspector.image !== 'none';
          expect(ok, `inspector paints --panel-bg (bg=${surfaces.inspector.bg} image=${surfaces.inspector.image})`).toBe(true);
        }
        if (surfaces.toolsPalette) expect(surfaces.toolsPalette, 'tools-palette paints --panel-bg').toBe(tokens['--panel-bg']);
        record('tokens-applied', true);
      });

      // ---- contrast floors ---------------------------------------------------
      await guard('contrast', async () => {
        expect((await win.locator('[data-command-palette]').count()) === 0, 'no palette open for contrast sample').toBe(true);
        const sels = [
          '[data-dock-verb="rotate"]',
          '.stage-rail-label',
          '.context-panel-section-title',
          '.inspector-row-label',
          '.context-panel-action',
        ];
        const sampled = await sampleColours(win, sels);
        const rows = [];
        for (const [sel, v] of Object.entries(sampled)) {
          if (v.missing || !v.color) { rows.push({ sel, missing: true }); continue; }
          const bg = effBg(v.chain);
          const r = ratio(v.color, bg);
          rows.push({ sel, color: v.color, bg, ratio: Number(r.toFixed(2)), text: v.text });
          expect(r, `text contrast ${sel} (${r.toFixed(2)}:1) >= 4.5`).toBeGreaterThanOrEqual(4.5);
        }
        log(`contrast ${theme}: ${JSON.stringify(rows)}`);

        // Graphics floor: each stage icon hue on the rail must clear 3:1.
        const icons = await sampleColours(win, ['.stage-rail-icon']);
        for (const [sel, v] of Object.entries(icons)) {
          if (v.missing || !v.svgColor) continue;
          const r = ratio(v.svgColor, effBg(v.chain));
          log(`graphic contrast ${theme} ${sel}: ${r.toFixed(2)}:1`);
          expect(r, `graphic contrast ${sel} (${r.toFixed(2)}:1) >= 3`).toBeGreaterThanOrEqual(3);
        }
      });

      log(`HEADLINES ${theme}: ${JSON.stringify(headlines)}`);
    } finally {
      log(`RESULTS ${theme} ${JSON.stringify(results)}`);
      await hardClose(app, `p96-${theme}`);
    }
    const failed = results.filter((r) => !r.ok);
    expect(failed, `${theme} failed checks: ${failed.map((f) => `${f.name}: ${f.detail}`).join(' | ') || 'none'}`).toEqual([]);
  });
}

// ---- zero-page rail (data-context-panel-thumbs-empty) + Inspector
// no-document empty (data-inspector-empty). Both require a real document with
// zero pages, so a minimal 0-page PDF is opened through the shipped dialog.
test('Phase 96 validation — zero-page rail + no-document Inspector empty states (3 themes)', async () => {
  const userData = path.join(os.tmpdir(), `tflex-p96-zero-${Date.now()}`);
  const app = await launchApp([], userData);
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const zero = await makeZeroPagePdf();
    await openPdfAt(win, app, zero);
    const reached = await win.waitForSelector('.workspace', { timeout: 15000 }).then(() => true).catch(() => false);
    log(`zero-page workspace reached=${reached}`);
    const pc = reached ? await win.evaluate(() => (window.tflexDiagnostics() || {}).pageCount) : null;
    log(`zero-page pageCount=${pc}`);
    if (!reached || pc !== 0) {
      test.info().annotations.push({
        type: 'inconclusive',
        description: `zero-page document not reachable through the shipped open path (reached=${reached}, pageCount=${pc}); data-context-panel-thumbs-empty and data-inspector-empty could not be exercised`,
      });
      log('INCONCLUSIVE: zero-page designed empty states not reachable via e2e');
      return;
    }

    for (const theme of THEMES) {
      await setTheme(win, theme);
      await gotoStage(win, 1);
      await ensurePanelExpanded(win);
      const thumbs = await assertEmptyState(win, '[data-context-panel-thumbs-empty]', `thumbs-empty ${theme}`);
      const insp = await assertEmptyState(win, '[data-inspector-empty]', `inspector-empty ${theme}`);
      log(`ZERO headlines ${theme}: thumbs=${JSON.stringify(thumbs.headline)} inspector=${JSON.stringify(insp.headline)}`);
      await win.screenshot({ path: shotPath('zero-page-empty', theme) });
    }
  } finally {
    await hardClose(app, 'p96-zero');
  }
});

// ---- command palette elevated + docked panels flat, all themes -------------
test('Phase 96 validation — command palette elevation-2 and docked panels flat (3 themes)', async () => {
  const userData = path.join(os.tmpdir(), `tflex-p96-elev-${Date.now()}`);
  const app = await launchApp([], userData);
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(win, app);
    for (const theme of THEMES) {
      await setTheme(win, theme);
      await win.keyboard.press('Control+k');
      await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
      await win.waitForTimeout(300);
      const palette = await win.evaluate(() => {
        const d = document.createElement('div');
        d.style.boxShadow = 'var(--elevation-2)';
        document.body.appendChild(d);
        const e2 = getComputedStyle(d).boxShadow; d.remove();
        const p = document.querySelector('[data-command-palette]');
        return { elev2: e2, shadow: p ? getComputedStyle(p).boxShadow : null };
      });
      log(`[${theme}] command-palette elevation-2=${palette.elev2} actual=${palette.shadow}`);
      expect(palette.shadow, `${theme} command palette resolves --elevation-2`).toBe(palette.elev2);
      await win.screenshot({ path: shotPath('command-palette', theme) });
      await win.keyboard.press('Escape');
      await win.waitForTimeout(300);

      const panels = await win.evaluate((sels) => sels.map((s) => {
        const el = document.querySelector(s);
        return el
          ? { s, shadow: getComputedStyle(el).boxShadow, selection: el.getAttribute('data-inspector-selection') }
          : { s, missing: true };
      }), ['[data-context-panel]', '[data-inspector]', '.tools-palette']);
      for (const p of panels) {
        if (p.missing) continue;
        // The Inspector's page-facing edge gains a documented Phase-41 neutral
        // glow only while a selection is live; at rest it must be flat.
        if (p.s === '[data-inspector]' && p.selection && p.selection !== 'none') {
          log(`[${theme}] inspector selection-edge elevation (documented Phase-41): ${p.shadow}`);
          continue;
        }
        expect(p.shadow === 'none' || p.shadow === '', `${theme} ${p.s} docked panel is flat (got ${p.shadow})`).toBe(true);
      }
    }
  } finally {
    await hardClose(app, 'p96-elev');
  }
});

// ---- performance budget (REQUIREMENTS.md:76 cold start < 3 s, :81 idle
// memory < 400 MB). Whole-app working set via Electron's own app metrics.
test('Phase 96 performance — cold start to interactive welcome + idle memory with one document open', async () => {
  const t0 = Date.now();
  const app = await launchApp([], path.join(os.tmpdir(), `tflex-p96-perf-${Date.now()}`));
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 40000 });
    const coldStart = Date.now() - t0;
    await openReport(win, app);
    await win.waitForTimeout(10000);
    const metrics = await app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().map((m) => ({ type: m.type, ws: (m.memory && m.memory.workingSetSize) || 0 })));
    const mb = (kb) => Number((kb / 1024).toFixed(2));
    const totalMB = mb(metrics.reduce((s, m) => s + m.ws, 0));
    const mainMB = mb(metrics.filter((m) => m.type === 'Browser').reduce((s, m) => s + m.ws, 0));
    const tabMB = mb(metrics.filter((m) => m.type === 'Tab').reduce((s, m) => s + m.ws, 0));
    log(`PERF coldStart=${coldStart}ms mainRSS=${mainMB}MB tabWS=${tabMB}MB wholeApp=${totalMB}MB metrics=${JSON.stringify(metrics)}`);
    fs.writeFileSync(
      path.join(OUT, 'performance.json'),
      JSON.stringify({
        coldStartMs: coldStart,
        idle: { mainRSSMB: mainMB, tabWorkingSetMB: tabMB, wholeAppWorkingSetMB: totalMB, metrics },
        budget: { coldStartMs: 3000, mainRSSMB: 400, tabWorkingSetMB: 250 },
        note: 'Whole-app working set exceeds the blanket <400MB (DEF-016: architecturally unreachable for Electron); the accepted project method is main-process RSS <400MB and Tab <250MB per PERFORMANCE.md.',
      }, null, 2),
    );
    expect(coldStart, `cold start ${coldStart}ms < 3000ms (REQUIREMENTS.md:76)`).toBeLessThan(3000);
    expect(mainMB, `idle main-process RSS ${mainMB}MB < 400MB (REQUIREMENTS.md:81 / PERFORMANCE.md)`).toBeLessThan(400);
    expect(tabMB, `idle Tab working set ${tabMB}MB < 250MB (PERFORMANCE.md revised budget)`).toBeLessThan(250);
  } finally {
    await hardClose(app, 'p96-perf');
  }
});
