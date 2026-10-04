// qa retest: DEF-167 (extract off-by-one + last-page out-of-bounds),
// DEF-168 (radios/checkboxes accent), DEF-169 (palette dimmed under modal
// backdrop). Dev build only (launchApp with no executablePath).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { PNG } = require('pngjs');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose, clickDockVerb } = require('../lib/helpers.cjs');

const FIXTURE = path.resolve(__dirname, '..', '..', 'test-fixtures', 'marker-3pages.pdf');

// DPR-aware mean luminance: window screenshots are device-scaled
// (this machine runs 150% -> PNG 1.5x the CSS viewport), so the CSS
// rect must be scaled by png.width / cssViewportWidth before sampling.
// (The DPR-1 assumption made the DEF-169 check mis-sample on hi-dpi
// runs — qa fix 2026-09-06; assertion thresholds unchanged.)
function meanLuminance(file, rect, cssViewportWidth) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const k = cssViewportWidth ? png.width / cssViewportWidth : 1;
  let sum = 0, n = 0;
  const x0 = Math.max(0, Math.floor(rect.x * k));
  const y0 = Math.max(0, Math.floor(rect.y * k));
  const x1 = Math.min(png.width, Math.floor((rect.x + rect.width) * k));
  const y1 = Math.min(png.height, Math.floor((rect.y + rect.height) * k));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (png.width * y + x) << 2;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
      n++;
    }
  }
  return n === 0 ? -1 : sum / n;
}

function round1(v) { return Math.round(v * 10) / 10; }

test.describe('DEF-167/168/169 dev-build retests', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
    await window.waitForSelector('.sample-card', { timeout: 30000 });
  });

  test.afterEach(async () => {
    await hardClose(electronApp);
    electronApp = null;
  });

  test('DEF-167: extract "1" lands PAGE 1; extract of the LAST page succeeds', async () => {
    test.setTimeout(180000);

    // Open the 3-page marker fixture through the real Open flow (mocked dialog).
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, FIXTURE);
    await window.locator('[data-home-tool="open"]').first().click();
    await window.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 20000 });
    await window.waitForTimeout(1500);

    const activeMarker = () => window.evaluate(() => {
      const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
      const tl = pane ? pane.querySelector('.pdf-page .textLayer') : null;
      const m = (tl ? tl.textContent : '').match(/MARKER-PAGE-(\d)/);
      return m ? `MARKER-PAGE-${m[1]}` : '(no marker)';
    });
    const activeTabTitle = () => window.evaluate(() => {
      const t = document.querySelector('.tab-active, .tab[aria-selected="true"], [role="tab"][aria-selected="true"]');
      return t ? (t.textContent || '').trim() : null;
    });

    // Sanity: the source doc opens on page 1.
    expect(await activeMarker()).toBe('MARKER-PAGE-1');

    // --- Part 1: extract "1" must yield the FIRST page ---
    // Phase 36 migration: All-tools palette retired; Extract is a PAGES dock verb.
    await clickDockVerb(window, 1, 'split');
    await window.waitForSelector('.modal-dialog.dialog', { timeout: 8000 });
    await window.fill('.modal-dialog .modal-input', '1');
    await window.click('.modal-dialog button.btn-primary');
    await window.waitForTimeout(2500);

    // The new tab should be active and show MARKER-PAGE-1 (pre-fix: page 2).
    const markerAfter1 = await activeMarker();
    const titleAfter1 = await activeTabTitle();
    console.log('[def167] after extract("1"): marker=', markerAfter1, ' tabTitle=', JSON.stringify(titleAfter1));
    await window.screenshot({ path: 'screenshots/def-167-retest-extract-1.png' });
    expect(markerAfter1, 'extract("1") must render MARKER-PAGE-1 (was MARKER-PAGE-2)').toBe('MARKER-PAGE-1');
    expect(titleAfter1 || '').toContain('page 1');

    // --- Part 2: extract the LAST page must not error "out of bounds" ---
    // Back to the SOURCE tab (the one titled without a "- page N" suffix;
    // with two tabs mounted there are two headers, so click the VISIBLE toggle).
    const allTabs = () => window.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.tab, [role="tab"]'));
      const act = document.querySelector('.tab-active, .tab[aria-selected="true"], [role="tab"][aria-selected="true"]');
      return {
        titles: tabs.map((t) => (t.textContent || '').trim()),
        active: act ? (act.textContent || '').trim() : null,
      };
    });
    console.log('[def167] tabs before switch:', JSON.stringify(await allTabs()));
    // Tabs activate on onMouseDown, so use a REAL mouse click on the tab
    // whose title has no "- page N" suffix (the source doc).
    const sourceTabId = await window.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab'));
      const src = tabs.find((t) => /marker-3pages\.pdf/.test(t.textContent || '') && !/page \d/.test(t.textContent || ''));
      return src ? src.getAttribute('data-tab-id') : null;
    });
    expect(sourceTabId, 'source tab found').toBeTruthy();
    await window.locator(`[data-tab-id="${sourceTabId}"]`).click();
    await window.waitForTimeout(900);
    const afterSwitch = await allTabs();
    console.log('[def167] tabs after switch:', JSON.stringify(afterSwitch));
    expect(afterSwitch.active, 'must be back on the SOURCE tab (no "page N" suffix)').not.toContain('page 1');
    expect(await activeMarker()).toBe('MARKER-PAGE-1');

    // The palette typically stays open behind the closed dialog; only
    // toggle it when it is not already up.
    await clickDockVerb(window, 1, 'split');
    await window.waitForSelector('.modal-dialog.dialog', { timeout: 8000 });
    await window.fill('.modal-dialog .modal-input', '3');
    await window.click('.modal-dialog button.btn-primary');
    await window.waitForTimeout(2500);

    const toast = await window.evaluate(() => document.querySelector('.toast')?.textContent || null);
    console.log('[def167] after extract("3"): toast=', JSON.stringify(toast));
    await window.screenshot({ path: 'screenshots/def-167-retest-extract-3.png' });
    expect(toast || '', 'extract("3") must NOT error out-of-bounds (was "extract page 3 out of bounds for 3 pages")')
      .not.toContain('out of bounds');
    // NOTE: a SECOND extract in the same session (this one) orphans its
    // result document - DEF-170, repro + fresh-session proof in
    // e2e/retests/def167_probe_extract3.spec.cjs (fresh extract("3") opens
    // tab "- page 3" with MARKER-PAGE-3; only the repeat extract fails to
    // open its tab). DEF-167's own contract (no out-of-bounds error,
    // correct page on extraction) is verified there and in part 1.
  });

  test('DEF-168: radios/checkboxes follow the single --accent token in both themes', async () => {
    test.setTimeout(180000);
    await window.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click({ force: true });
    await window.waitForSelector('.workspace', { state: 'visible', timeout: 20000 });

    const readDialogInputs = () => window.evaluate(() => {
      const dlg = document.querySelector('.modal-dialog');
      const inputs = dlg ? Array.from(dlg.querySelectorAll('input[type="radio"], input[type="checkbox"]')) : [];
      return inputs.map((el) => ({
        kind: el.type,
        name: el.name || '',
        checked: el.checked,
        accent: getComputedStyle(el).accentColor,
      }));
    });
    // DEF-168 (re-scoped after the Phase 36 3A change): the app deliberately
    // uses ONE accent token (`--accent`), not the old hardcoded orange. Resolve
    // the token to the same `rgb(...)` form getComputedStyle reports for
    // `accent-color`, so the assertion is token-driven rather than a stale
    // literal.
    const accentToken = () => window.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--accent)';
      document.body.appendChild(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      return rgb;
    });

    // Open Tools palette -> Insert pages (the dialog cited in DEF-168).
    // Phase 36 migration: All-tools palette retired; Insert pages is a PAGES dock verb.
    await clickDockVerb(window, 1, 'insertPages');
    await window.waitForSelector('.modal-dialog', { timeout: 8000 });
    await window.waitForTimeout(400);

    const darkAccent = await accentToken();
    const darkInputs = await readDialogInputs();
    console.log('[def168] dark --accent=', darkAccent);
    console.log('[def168] dark inputs:', JSON.stringify(darkInputs));
    await window.screenshot({ path: 'screenshots/def-168-retest-insert-dialog-dark.png' });

    const assertAccent = (list, label, token) => {
      expect(list.length, `${label}: dialog should expose radio/checkbox inputs`).toBeGreaterThan(0);
      for (const r of list) {
        expect(r.accent, `${label} ${r.kind}(${r.name}) accent-color tracks --accent`).toBe(token);
      }
    };
    assertAccent(darkInputs, 'dark', darkAccent);

    // Switch theme with the dialog CLOSED (the modal backdrop blocks the
    // header by design), then reopen the same dialog in the light theme.
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);
    await window.click('.theme-toggle');
    await window.waitForTimeout(500);
    await clickDockVerb(window, 1, 'insertPages');
    await window.waitForSelector('.modal-dialog', { timeout: 8000 });
    await window.waitForTimeout(400);
    const lightAccent = await accentToken();
    const lightInputs = await readDialogInputs();
    console.log('[def168] light --accent=', lightAccent);
    console.log('[def168] light inputs:', JSON.stringify(lightInputs));
    await window.screenshot({ path: 'screenshots/def-168-retest-insert-dialog-light.png' });
    assertAccent(lightInputs, 'light', lightAccent);
  });

  // DEF-169 RETIRED (Phase 36 migration). The subject was the retired All-tools
  // PALETTE being dimmed under a modal backdrop (its z-order). The palette is
  // gone; the modal/backdrop z-order + dimming contract is covered by
  // e2e/phase20_verify.spec.cjs (morph menus / modal backdrop) and the palette
  // retirement proof e2e/phase36_chunk456_gate.spec.cjs. DEF-167 and DEF-168
  // remain live above.
});