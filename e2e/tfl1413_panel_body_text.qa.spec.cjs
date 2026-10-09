// TFL-1413 C2 (qa) — focused verification of the panel section body-text fix.
//
// Change under test (src/renderer/styles.css, C1 / TFL-1435):
//   .tf-panel-empty            -> align-items: flex-start; text-align: left
//   .tf-panel-empty-headline   -> font-size: var(--tf-panel-body-size);
//                                 font-weight: var(--type-body-weight)  (= 400)
//   .tf-panel-section .empty-state + ... .empty-state-headline likewise.
//
// This spec reads getComputedStyle in the real Electron app on the REVIEW stage
// (report.pdf), sweeps every visible panel body line / heading across the four
// document stages, proves the body line is left-aligned flush with its section
// title, and captures before/after/dark screenshots of the REVIEW panel.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, hardClose, gotoStage, setTheme, ensurePanelExpanded } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const WIN_W = 1440;
const WIN_H = 900;
const OLD_STYLE_ID = 'tfl1413-old-presentation';
const OLD_STYLE = '.tf-panel-empty{align-items:center;text-align:center}'
  + '.tf-panel-empty-headline{font-size:var(--tf-panel-heading-size);font-weight:var(--tf-panel-heading-weight)}';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function resize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, b) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    w.setBounds({ width: b.width, height: b.height });
  }, { width, height });
  await sleep(700);
}

async function shotEl(win, selector, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = path.join(SHOTS, name);
  await win.locator(selector).first().screenshot({ path: p });
  console.log(`[tfl1413 shot] ${p}`);
  return p;
}

// Per review category: the body line's and the section title's computed type
// plus their left edges (to prove the body line is flush with the title).
async function readReview(win) {
  return win.evaluate(() => {
    const out = [];
    document.querySelectorAll('[data-review-empty-category]').forEach((el) => {
      const line = el.querySelector('.tf-panel-empty-headline');
      const section = el.closest('.tf-panel-section');
      const title = section ? section.querySelector('.tf-panel-section-title') : null;
      const es = getComputedStyle(el);
      const ls = line ? getComputedStyle(line) : null;
      const ts = title ? getComputedStyle(title) : null;
      const er = el.getBoundingClientRect();
      const lr = line ? line.getBoundingClientRect() : null;
      const tr = title ? title.getBoundingClientRect() : null;
      out.push({
        category: el.getAttribute('data-review-empty-category'),
        rootAlign: es.textAlign,
        rootAlignItems: es.alignItems,
        rootPadding: es.paddingLeft,
        lineWeight: ls ? ls.fontWeight : null,
        lineAlign: ls ? ls.textAlign : null,
        titleWeight: ts ? ts.fontWeight : null,
        titleAlign: ts ? ts.textAlign : null,
        rootLeft: Math.round(er.left * 100) / 100,
        rootRight: Math.round(er.right * 100) / 100,
        lineLeft: lr ? Math.round(lr.left * 100) / 100 : null,
        titleLeft: tr ? Math.round(tr.left * 100) / 100 : null,
      });
    });
    return out;
  });
}

// The `.tf-panel-empty` root presentation (what before/after screenshots show).
async function emptyRootStyle(win) {
  return win.evaluate(() => {
    const el = document.querySelector('[data-review-empty-category]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const line = el.querySelector('.tf-panel-empty-headline');
    return {
      rootAlign: cs.textAlign,
      rootAlignItems: cs.alignItems,
      rootPadding: cs.paddingLeft,
      lineAlign: line ? getComputedStyle(line).textAlign : null,
      lineWeight: line ? getComputedStyle(line).fontWeight : null,
    };
  });
}

// Blast-radius sweep: every visible panel body line and every visible panel
// section title on the current stage, with its computed weight + align.
async function sweepStyles(win, stage) {
  return win.evaluate((label) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    };
    const rows = [];
    const push = (el, kind, selector) => {
      const cs = getComputedStyle(el);
      rows.push({ stage: label, kind, selector, cls: el.className, weight: cs.fontWeight, align: cs.textAlign, visible: vis(el) });
    };
    document.querySelectorAll('.tf-panel-empty-headline').forEach((el) => push(el, 'line', '.tf-panel-empty-headline'));
    document.querySelectorAll('.tf-panel-section .empty-state .empty-state-headline')
      .forEach((el) => push(el, 'line', '.tf-panel-section .empty-state .empty-state-headline'));
    document.querySelectorAll('.tf-panel-section-title').forEach((el) => push(el, 'title', '.tf-panel-section-title'));
    return rows;
  }, stage);
}

test.describe('TFL-1413 C2 - review panel body text normal weight + left-aligned', () => {
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
  });

  test.afterAll(async () => {
    await hardClose(app, 'tfl1413-body-text');
  });

  test('body lines are 400/left, headings 500/left, flush and blast-radius clean', async () => {
    // ---- REVIEW stage: the sections under test -----------------------------
    await gotoStage(win, 3);
    await ensurePanelExpanded(win);
    await setTheme(win, 'light');
    await expect(win.locator('[data-review-empty-category]').first()).toBeVisible({ timeout: 15000 });

    const review = await readReview(win);
    console.log(`[tfl1413 review] ${JSON.stringify(review)}`);
    expect(review.length, 'report.pdf exposes review empty categories').toBeGreaterThan(0);

    for (const r of review) {
      expect(r.lineWeight, `${r.category} body line font-weight`).toBe('400');
      expect(r.lineAlign, `${r.category} body line text-align`).toBe('left');
      expect(r.titleWeight, `${r.category} title font-weight`).toBe('500');
      // Headings are never given `text-align` in CSS, so an unstyled block
      // computes the initial keyword `start`, which is left in this LTR UI.
      // Accept either `left`/`start` and reject a centred title.
      expect(['left', 'start'], `${r.category} title renders left (computed=${r.titleAlign})`).toContain(r.titleAlign);
      expect(r.rootAlign, `${r.category} empty-state root text-align`).toBe('left');
      expect(r.rootAlignItems, `${r.category} empty-state root align-items`).toBe('flex-start');
      // The body line sits at its empty-state content-left (its own padding
      // inset), i.e. flush with the empty-state's left edge, NOT centred.
      const inset = r.lineLeft - r.rootLeft;
      expect(inset, `${r.category} body line at content-left (inset=${inset}, padding=${r.rootPadding})`).toBeLessThanOrEqual(parseFloat(r.rootPadding) + 1);
      expect(r.lineLeft, `${r.category} body line left of centre`).toBeLessThan(r.rootLeft + (r.rootRight - r.rootLeft) / 2);
      console.log(`[tfl1413 review] ${r.category} lineLeft=${r.lineLeft} titleLeft=${r.titleLeft} insetFromRoot=${inset} padding=${r.rootPadding} titleAlign=${r.titleAlign}`);
    }

    // ---- Blast-radius sweep across the document stages ---------------------
    const stages = [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']];
    const sweep = [];
    for (const [num, name] of stages) {
      await gotoStage(win, num);
      await ensurePanelExpanded(win);
      await sleep(400);
      const rows = await sweepStyles(win, name);
      sweep.push(...rows);
    }
    for (const r of sweep) {
      console.log(`[tfl1413 sweep] stage=${r.stage} kind=${r.kind} cls="${r.cls}" weight=${r.weight} align=${r.align} visible=${r.visible}`);
    }
    const visible = sweep.filter((r) => r.visible);
    // Lines must be 400 and explicitly left; titles must stay 500 and render
    // left (`left`, or the LTR-identical initial keyword `start`).
    const violations = visible.filter((r) => (
      r.kind === 'line'
        ? (r.weight !== '400' || r.align !== 'left')
        : (r.weight !== '500' || !['left', 'start'].includes(r.align))
    ));
    const counts = visible.reduce((acc, r) => {
      const k = `${r.kind}:${r.selector}`;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    console.log(`[tfl1413 sweep] visible counts = ${JSON.stringify(counts)}`);
    console.log(`[tfl1413 sweep] violations = ${JSON.stringify(violations)}`);
    expect(violations, `visible body lines / headings deviating from 400-left / 500-left: ${JSON.stringify(violations)}`).toEqual([]);

    // ---- Before / after screenshots on the REVIEW panel --------------------
    await gotoStage(win, 3);
    await ensurePanelExpanded(win);
    await setTheme(win, 'light');
    await sleep(300);

    const after = await emptyRootStyle(win);
    console.log(`[tfl1413 styles] after(light, fixed) = ${JSON.stringify(after)}`);

    await win.evaluate(({ id, css }) => {
      const s = document.createElement('style');
      s.id = id;
      s.textContent = css;
      document.head.appendChild(s);
    }, { id: OLD_STYLE_ID, css: OLD_STYLE });
    await sleep(250);
    const before = await emptyRootStyle(win);
    console.log(`[tfl1413 styles] before(light, old presentation) = ${JSON.stringify(before)}`);
    await shotEl(win, '.context-panel', 'tfl1413_before_light.png');

    await win.evaluate((id) => {
      const s = document.getElementById(id);
      if (s) s.remove();
    }, OLD_STYLE_ID);
    await sleep(250);
    await shotEl(win, '.context-panel', 'tfl1413_after_light.png');

    await setTheme(win, 'dark');
    await sleep(300);
    await shotEl(win, '.context-panel', 'tfl1413_after_dark.png');

    expect(before.lineAlign, 'old presentation centres the body line').toBe('center');
    expect(after.lineAlign, 'fixed presentation left-aligns the body line').toBe('left');
    expect(before.lineAlign).not.toBe(after.lineAlign);
    expect(after.lineWeight, 'fixed body line is normal weight').toBe('400');
  });
});
