// TFL-1564 (QA, focused verification) — the REVIEW stage Annotations context panel.
//
// Verifies the four reported visual/layout defects against the REAL Electron app
// (canonical launchApp + openSamplePath native-picker helper):
//   1. Truncated header  — exactly ONE "Annotations" title renders (the outer
//      PanelSection title); the redundant inner panel header is gone.
//   2. Import / Export alignment — one horizontal row when the panel is wide,
//      wrapping to a second row at narrow widths without clipping or overlap.
//   3. Typography consistency — the Annotations heading / empty-state /
//      filter-bar / meta text use the same sizes, weights and colours as the
//      EDIT Content and DELIVER Output-checks sections.
//   4. List item width — each `.thread-stream-row` spans the panel container and
//      tracks the panel width as it changes.
//
// Selectors come from the shipped tree: `[data-review-category="annotations"]`,
// `[data-ann-io="export"]` / `[data-ann-io="import"]`, `.thread-stream-row`,
// `.tf-panel-section-title` (the PanelSection heading slot).

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const {
  openSamplePath,
  hardClose,
  gotoStage,
  ensurePanelExpanded,
  openAnnotationFlyout,
  armAnnotationTool,
  slotBox,
} = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const WIN_W = 1440;
const WIN_H = 900;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function shot(win, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  console.log(`[tfl1564 shot] ${p}`);
  return p;
}

async function resize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, b) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    win.setBounds({ width: b.width, height: b.height });
  }, { width, height });
  await sleep(700);
}

async function ensureBothExpanded(win) {
  if ((await win.locator('[data-context-panel][data-context-panel-collapsed="true"]').count()) > 0) {
    await win.locator('[data-rail-collapse]').first().click();
    await sleep(500);
  }
  if ((await win.locator('[data-inspector][data-inspector-collapsed="true"]').count()) > 0) {
    await win.locator('[data-inspector-collapsed-strip] [data-inspector-collapse]').first().click();
    await sleep(500);
  }
}

// Set the LEFT panel width exactly. The keyboard channel only produces
// 240 + 16k px, so only multiples-of-16 offsets from the 240 min are reachable.
async function setLeftWidth(win, target) {
  const handle = win.locator('[data-panel-resize="left"]').first();
  await expect(handle).toBeVisible({ timeout: 10000 });
  await handle.focus();
  await win.keyboard.press('Home');
  await sleep(250);
  const steps = Math.round((target - 240) / 16);
  for (let i = 0; i < steps; i += 1) {
    await win.keyboard.press('ArrowRight');
    await sleep(60);
  }
  await sleep(400);
  const now = await handle.getAttribute('aria-valuenow');
  console.log(`[tfl1564] left panel width -> ${now} (target ${target})`);
  return Number(now);
}

// Read computed typography for a map of key -> CSS selector, plus resolved tokens.
async function readType(win, selectors) {
  return win.evaluate((sels) => {
    const out = {};
    for (const [k, s] of Object.entries(sels)) {
      const el = document.querySelector(s);
      if (!el) { out[k] = null; continue; }
      const cs = getComputedStyle(el);
      out[k] = { fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, text: (el.textContent || '').trim().slice(0, 40) };
    }
    const root = getComputedStyle(document.documentElement);
    out.__tokens = {
      label: root.getPropertyValue('--type-label-size').trim(),
      body: root.getPropertyValue('--type-body-size').trim(),
      helper: root.getPropertyValue('--type-helper-size').trim(),
      row: root.getPropertyValue('--type-row-size').trim(),
    };
    return out;
  }, selectors);
}

// Geometry of the Annotations action row: each control's rect, whether it sits
// inside the `.ann-panel` rect, and whether elementFromPoint hits it.
async function measureActions(win) {
  return win.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100;
    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) };
    };
    const panel = document.querySelector('[data-annotation-panel]');
    if (!panel) return { missing: true };
    const panelRect = panel.getBoundingClientRect();
    const row = panel.querySelector('[data-ann-io-row]');
    if (!row) return { missing: true, noRow: true };
    const entries = [['count', '.ann-panel-count'], ['export', '[data-ann-io="export"]'], ['import', '[data-ann-io="import"]']];
    const controls = [];
    for (const [name, sel] of entries) {
      const el = row.querySelector(sel);
      if (!el) { controls.push({ name, missing: true }); continue; }
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      controls.push({
        name,
        rect: rectOf(el),
        disabled: !!el.disabled,
        insidePanel: r.left >= panelRect.left - 0.5 && r.right <= panelRect.right + 0.5 && r.top >= panelRect.top - 0.5,
        hitSelf: !!hit && (hit === el || el.contains(hit)),
        hitTag: hit ? hit.tagName : null,
      });
    }
    return { missing: false, panel: rectOf(panel), row: rectOf(row), rowFlexWrap: getComputedStyle(row).flexWrap, controls };
  });
}

// Row width vs its list/panel container, for the width criterion.
async function measureRows(win) {
  return win.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100;
    const panel = document.querySelector('[data-annotation-panel]');
    if (!panel) return { missing: true };
    const list = panel.querySelector('.ann-panel-list');
    const rows = Array.from(panel.querySelectorAll('.thread-stream-row'));
    const listRect = list ? list.getBoundingClientRect() : null;
    const cs = list ? getComputedStyle(list) : null;
    const listContent = listRect && cs
      ? round(listRect.width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0))
      : null;
    return {
      missing: false,
      panelWidth: round(panel.getBoundingClientRect().width),
      listContentWidth: listContent,
      rows: rows.map((el) => {
        const r = el.getBoundingClientRect();
        return { width: round(r.width), left: round(r.left), right: round(r.right), text: (el.textContent || '').trim().slice(0, 30) };
      }),
    };
  });
}

function rectsIntersect(a, b) {
  return a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
}

test.describe('review annotations panel', () => {
  let app;
  let win;
  test.setTimeout(300000);

  test.beforeAll(async () => {
    app = await launchApp();
    win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await resize(app, WIN_W, WIN_H);
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await expect(win.locator('.pdf-page canvas:visible').first()).toBeVisible({ timeout: 30000 });
    await gotoStage(win, 3);
    await ensureBothExpanded(win);
    await sleep(500);
  });

  test.afterAll(async () => {
    await hardClose(app, 'tfl1564-annot-panel');
  });

  test('TFL-1564-1: exactly one "Annotations" section title, no truncated inner header', async () => {
    await gotoStage(win, 3);
    await ensureBothExpanded(win);
    await sleep(400);

    const panel = win.locator('[data-context-panel="review"]');
    await expect(panel).toBeVisible();
    const cat = panel.locator('[data-review-category="annotations"]');
    await expect(cat).toHaveCount(1);
    await expect(cat).toBeVisible();

    const titles = cat.locator('.tf-panel-section-title');
    await expect(titles).toHaveCount(1);
    await expect(titles.first()).toHaveText('Annotations');
    await expect(titles.first()).toHaveClass(/review-elements-category-title/);

    await expect(cat.locator('.ann-panel-header')).toHaveCount(0);
    await expect(cat.locator('.tf-panel-header-title')).toHaveCount(0);
    await expect(panel.locator('.tf-panel-header-title', { hasText: 'Annotations' })).toHaveCount(0);

    const fit = await titles.first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const panelEl = el.closest('[data-context-panel]');
      const pr = panelEl.getBoundingClientRect();
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, textOverflow: cs.textOverflow, text: (el.textContent || '').trim(), rightInsidePanel: r.right <= pr.right + 0.5 };
    });
    console.log(`[tfl1564] title fit ${JSON.stringify(fit)}`);
    expect(fit.text).toBe('Annotations');
    expect(fit.scrollWidth, `title content must not overflow its box: ${JSON.stringify(fit)}`).toBeLessThanOrEqual(fit.clientWidth + 1);
    expect(fit.rightInsidePanel, 'title right edge must stay inside the context panel').toBe(true);

    await shot(win, 'tfl1564_review_annotations_header.png');
  });

  test('TFL-1564-2: Import/Export share one row when wide and wrap cleanly when narrow', async () => {
    await gotoStage(win, 3);
    await ensureBothExpanded(win);
    await sleep(400);

    const handle = win.locator('[data-panel-resize="left"]').first();
    const narrowW = Number(await handle.getAttribute('aria-valuenow'));
    const mNarrow = await measureActions(win);
    console.log(`[tfl1564] narrow(${narrowW}) ${JSON.stringify(mNarrow)}`);
    await shot(win, `tfl1564_review_narrow_${narrowW}.png`);

    expect(mNarrow.missing, 'Annotations action row must be present').toBe(false);
    const nControls = mNarrow.controls.filter((c) => !c.missing);
    expect(nControls).toHaveLength(3);
    for (const c of nControls) {
      expect(c.insidePanel, `${c.name} inside .ann-panel at narrow: ${JSON.stringify(c.rect)}`).toBe(true);
      expect(c.hitSelf, `${c.name} elementFromPoint hits itself (hitTag=${c.hitTag})`).toBe(true);
    }
    for (let i = 0; i < nControls.length; i += 1) {
      for (let j = i + 1; j < nControls.length; j += 1) {
        expect(rectsIntersect(nControls[i].rect, nControls[j].rect), `${nControls[i].name} overlaps ${nControls[j].name}`).toBe(false);
      }
    }
    const narrowTops = new Set(nControls.map((c) => Math.round(c.rect.top)));
    console.log(`[tfl1564] narrow distinct row tops = ${narrowTops.size}`);
    const nExport = nControls.find((c) => c.name === 'export');
    const nImport = nControls.find((c) => c.name === 'import');
    console.log(`[tfl1564] narrow export.top=${nExport.rect.top} import.top=${nImport.rect.top}`);
    expect(nImport.rect.top, 'at 280px Import wraps below Export onto a second row').toBeGreaterThan(nExport.rect.top + 2);

    const wideW = await setLeftWidth(win, 400);
    expect(wideW).toBe(400);
    await sleep(300);
    const mWide = await measureActions(win);
    console.log(`[tfl1564] wide(${wideW}) ${JSON.stringify(mWide)}`);
    await shot(win, `tfl1564_review_wide_${wideW}.png`);

    const wControls = mWide.controls.filter((c) => !c.missing);
    for (const c of wControls) {
      expect(c.insidePanel, `${c.name} inside .ann-panel at wide: ${JSON.stringify(c.rect)}`).toBe(true);
      expect(c.hitSelf, `${c.name} hitSelf at wide (hitTag=${c.hitTag})`).toBe(true);
    }
    for (let i = 0; i < wControls.length; i += 1) {
      for (let j = i + 1; j < wControls.length; j += 1) {
        expect(rectsIntersect(wControls[i].rect, wControls[j].rect), `${wControls[i].name} overlaps ${wControls[j].name} at wide`).toBe(false);
      }
    }
    const wideTops = new Set(wControls.map((c) => Math.round(c.rect.top)));
    console.log(`[tfl1564] wide distinct row tops = ${wideTops.size}`);
    const wExport = wControls.find((c) => c.name === 'export');
    const wImport = wControls.find((c) => c.name === 'import');
    console.log(`[tfl1564] wide export.top=${wExport.rect.top} import.top=${wImport.rect.top}`);
    expect(Math.abs(wImport.rect.top - wExport.rect.top), 'at 400px Import and Export sit on a single row').toBeLessThanOrEqual(1);
  });

  test('TFL-1564-3: Annotations typography matches the EDIT and DELIVER section text', async () => {
    await gotoStage(win, 3);
    await ensureBothExpanded(win);
    await sleep(400);
    const review = await readType(win, {
      annTitle: '[data-review-category="annotations"] > .tf-panel-section-title',
      annEmptyHeadline: '[data-annotation-panel] .tf-panel-empty-headline',
      annEmptyHelp: '[data-annotation-panel] .tf-panel-empty-help',
    });
    // Every REVIEW category heading shares one ink (intra-panel consistency).
    const reviewHeadingInks = await win.evaluate(() =>
      [...document.querySelectorAll('[data-review-category] > .tf-panel-section-title')].map((e) => getComputedStyle(e).color));
    // The count pill carries the secondary ink token the empty state must match.
    const countInk = await readType(win, { count: '[data-annotation-panel] .ann-panel-count' });

    await gotoStage(win, 2);
    await ensureBothExpanded(win);
    await sleep(400);
    const edit = await readType(win, {
      contentTitle: '[data-context-panel-section="content"] > .context-panel-section-title',
    });

    await gotoStage(win, 4);
    await ensureBothExpanded(win);
    await sleep(400);
    const deliver = await readType(win, {
      preflightTitle: '[data-context-panel-section="preflight"] > .context-panel-section-title',
      preflightNote: '[data-context-panel-section="preflight"] .tf-panel-section-note',
    });

    console.log(`[tfl1564] typography review=${JSON.stringify(review)}`);
    console.log(`[tfl1564] typography edit=${JSON.stringify(edit)}`);
    console.log(`[tfl1564] typography deliver=${JSON.stringify(deliver)}`);

    const tokens = review.__tokens;
    const px = (v) => `${parseFloat(v)}px`;

    expect(review.annTitle, 'Annotations heading present').not.toBeNull();
    expect(edit.contentTitle, 'EDIT Content heading present').not.toBeNull();
    expect(deliver.preflightTitle, 'DELIVER Output checks heading present').not.toBeNull();
    // Headings share the panel heading scale (size + weight) across panels.
    expect(review.annTitle.fontSize, 'Annotations heading size matches EDIT Content').toBe(edit.contentTitle.fontSize);
    expect(review.annTitle.fontSize, 'Annotations heading size matches DELIVER Output checks').toBe(deliver.preflightTitle.fontSize);
    expect(review.annTitle.fontWeight, 'heading weight matches EDIT Content').toBe(edit.contentTitle.fontWeight);
    expect(review.annTitle.fontWeight, 'heading weight matches DELIVER Output checks').toBe(deliver.preflightTitle.fontWeight);
    // Heading COLOUR is a per-stage accent by design (EDIT is purple, DELIVER is
    // green, so they never match each other either). The consistency check is
    // intra-panel: every REVIEW category heading paints the same ink.
    expect(reviewHeadingInks.length, 'REVIEW panel section headings present').toBeGreaterThanOrEqual(1);
    for (const ink of reviewHeadingInks) {
      expect(ink, 'REVIEW category headings share one ink').toBe(reviewHeadingInks[0]);
    }

    expect(review.annEmptyHeadline.fontSize, 'empty headline uses --type-body-size').toBe(px(tokens.body));
    expect(review.annEmptyHelp.fontSize, 'empty help uses --type-helper-size').toBe(px(tokens.helper));
    expect(countInk.count, 'count pill present at REVIEW').not.toBeNull();
    expect(review.annEmptyHelp.color, 'empty help paints with the secondary ink (--tf-panel-ink-secondary = --fg-muted)').toBe(countInk.count.color);
  });

  async function dragOnPage(x1, y1, x2, y2) {
    const box = await slotBox(win, 1);
    expect(box, 'page slot 1 mounted').not.toBeNull();
    await win.mouse.move(box.x + box.w * x1, box.y + box.h * y1);
    await win.mouse.down();
    await win.mouse.move(box.x + box.w * x2, box.y + box.h * y2, { steps: 10 });
    await win.mouse.up();
    await sleep(800);
  }

  async function makeInk() {
    await openAnnotationFlyout(win);
    await armAnnotationTool(win, 'ink');
    await dragOnPage(0.35, 0.3, 0.55, 0.42);
    await win.keyboard.press('Escape');
    await sleep(300);
  }

  test('TFL-1564-4: filter-bar type + .thread-stream-row spans the panel and tracks its width', async () => {
    await makeInk();
    await gotoStage(win, 3);
    await ensureBothExpanded(win);
    await win.waitForSelector('[data-annotation-panel] .thread-stream-row', { timeout: 15000 });
    await sleep(400);

    const rows = win.locator('[data-annotation-panel] .thread-stream-row');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count(), 'at least one annotation row').toBeGreaterThanOrEqual(1);

    const t = await readType(win, {
      filterButton: '[data-annotation-panel] .ann-filter-button',
      rowKind: '[data-annotation-panel] .thread-stream-row-meta [data-ann-kind]',
      rowMeta: '[data-annotation-panel] .thread-stream-row-meta',
      count: '[data-annotation-panel] .ann-panel-count',
    });
    console.log(`[tfl1564] filter/row typography ${JSON.stringify(t)}`);
    const tokens = t.__tokens;
    const px = (v) => `${parseFloat(v)}px`;
    expect(t.filterButton, 'filter bar present').not.toBeNull();
    expect(t.filterButton.fontSize, 'filter-bar text uses --type-row-size').toBe(px(tokens.row));
    expect(t.rowMeta, 'row meta present').not.toBeNull();
    expect(t.rowMeta.fontSize, 'row body text uses --type-body-size').toBe(px(tokens.body));
    expect(t.rowMeta.color, 'row body text uses the secondary ink').toBe(t.count.color);
    expect(t.rowKind.fontSize, 'row meta text uses --type-helper-size').toBe(px(tokens.helper));

    await setLeftWidth(win, 288);
    await sleep(300);
    const narrow = await measureRows(win);
    await setLeftWidth(win, 400);
    await sleep(300);
    const wide = await measureRows(win);
    console.log(`[tfl1564] rows narrow ${JSON.stringify(narrow)}`);
    console.log(`[tfl1564] rows wide ${JSON.stringify(wide)}`);

    expect(narrow.missing).toBe(false);
    expect(wide.missing).toBe(false);
    expect(narrow.rows.length, 'rows present').toBeGreaterThanOrEqual(1);
    expect(narrow.rows.length).toBe(wide.rows.length);
    for (let i = 0; i < narrow.rows.length; i += 1) {
      expect(narrow.rows[i].width, `narrow row ${i} spans the list content box (${narrow.listContentWidth})`).toBeGreaterThanOrEqual(narrow.listContentWidth - 2);
      expect(wide.rows[i].width, `wide row ${i} spans the list content box (${wide.listContentWidth})`).toBeGreaterThanOrEqual(wide.listContentWidth - 2);
    }
    const grow = wide.rows[0].width - narrow.rows[0].width;
    const panelGrow = wide.panelWidth - narrow.panelWidth;
    console.log(`[tfl1564] row grow=${grow.toFixed(2)} panel grow=${panelGrow.toFixed(2)}`);
    expect(Math.abs(grow - panelGrow), 'row width tracks the panel width').toBeLessThanOrEqual(4);
  });
});
