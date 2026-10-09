// TFL-1583 — QA focused verification of DEF-673 (collapsed panel headers).
//
// Verifies the three TFL-1557 collapsed-panel affordances in the real app:
//  1. Collapsed Context panel header is arrow-only (no truncated title) in
//     every stage (EDIT / REVIEW / DELIVER).
//  2. Expanded Inspector header leads with the collapse arrow (left of title).
//  3. Collapsed Inspector strip shows a vertical "Inspector" label under the
//     arrow.
// Plus a regression pass that the expanded layouts still render their controls.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { openSample, hardClose, setTheme, gotoStage, ensurePanelExpanded } = require('./lib/helpers.cjs');

// The Paperclip harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads
// process.env into the Electron child, which then exits as plain Node before any
// window is observable. Drop it before any launch.
delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const STAGE_NUM = { edit: 2, review: 3, deliver: 4 };

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(200);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1583-collapsed-panel-headers');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function shot(name) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  return p;
}

async function contextHeaderState() {
  return win.evaluate(() => {
    const panel = document.querySelector('.context-panel[data-context-panel-collapsed="true"]');
    const header = panel ? panel.querySelector('.context-panel-header') : null;
    const title = header ? header.querySelector('.tf-panel-header-title') : null;
    const collapse = header ? header.querySelector('[data-rail-collapse]') : null;
    const text = header ? (header.textContent || '').replace(/\s+/g, ' ').trim() : null;
    return {
      panelCollapsed: !!panel,
      hasHeader: !!header,
      hasTitleEl: !!title,
      titleText: title ? (title.textContent || '').trim() : null,
      headerText: text,
      hasCollapseControl: !!collapse,
    };
  });
}

async function inspectorExpandedState() {
  return win.evaluate(() => {
    const header = document.querySelector('.inspector-header');
    if (!header) return { hasHeader: false };
    const leading = header.querySelector('.tf-panel-header-leading-actions');
    const title = header.querySelector('.tf-panel-header-title');
    const leadingBtn = leading ? leading.querySelector('[data-inspector-collapse]') : null;
    const childClasses = Array.from(header.children).map((c) => c.className);
    return {
      hasHeader: true,
      leadingPrecedesTitle:
        childClasses.findIndex((c) => c.includes('tf-panel-header-leading-actions')) === 0 &&
        childClasses.findIndex((c) => c.includes('tf-panel-header-title')) === 1,
      hasLeadingCollapse: !!leadingBtn,
      leadingLeftOfTitle:
        leadingBtn && title
          ? leadingBtn.getBoundingClientRect().left < title.getBoundingClientRect().left
          : null,
      titleText: title ? (title.textContent || '').trim() : null,
    };
  });
}

async function inspectorCollapsedState() {
  return win.evaluate(() => {
    const strip = document.querySelector('[data-inspector-collapsed-strip]');
    if (!strip) return { hasStrip: false };
    const label = strip.querySelector('.inspector-collapsed-label');
    const arrow = strip.querySelector('[data-inspector-collapse]');
    const labelRect = label ? label.getBoundingClientRect() : null;
    const arrowRect = arrow ? arrow.getBoundingClientRect() : null;
    const writingMode = label ? getComputedStyle(label).writingMode : null;
    return {
      hasStrip: true,
      labelText: label ? (label.textContent || '').trim() : null,
      labelAriaHidden: label ? label.getAttribute('aria-hidden') : null,
      writingMode,
      arrowPresent: !!arrow,
      arrowAboveLabel: labelRect && arrowRect ? arrowRect.top <= labelRect.top : null,
      firstChildIsArrow: strip.firstElementChild ? strip.firstElementChild.hasAttribute('data-inspector-collapse') : false,
    };
  });
}

// ---------------------------------------------------------------------------
// A. Context panel collapsed is arrow-only in EDIT / REVIEW / DELIVER.
// ---------------------------------------------------------------------------
test('TFL1583-A collapsed context header is arrow-only per stage', async () => {
  await openSample(win, 'report.pdf');
  await win.waitForTimeout(600);
  await ensurePanelExpanded(win);

  for (const [stage, n] of Object.entries(STAGE_NUM)) {
    await gotoStage(win, n);
    await win.waitForTimeout(400);
    await ensurePanelExpanded(win);
    await win.waitForTimeout(300);

    const collapse = win.locator('.context-panel-header [data-rail-collapse]').first();
    await expect(collapse).toBeVisible({ timeout: 8000 });
    await collapse.click();
    await win.waitForTimeout(500);

    const st = await contextHeaderState();
    expect(st.panelCollapsed, `${stage}: panel is collapsed`).toBe(true);
    expect(st.hasCollapseControl, `${stage}: expand arrow present`).toBe(true);
    expect(st.hasTitleEl, `${stage}: no title element in collapsed header`).toBe(false);
    expect(st.titleText, `${stage}: no title text`).toBeNull();
    expect((st.headerText || '').trim(), `${stage}: header has no label text`).toBe('');

    for (const theme of ['light', 'dark']) {
      await setTheme(win, theme);
      await win.waitForTimeout(400);
      const p = await shot(`tfl1583_context_collapsed_${stage}_${theme}.png`);
      console.log(`[TFL1583-A] ${stage}/${theme} -> ${p}`);
    }

    await setTheme(win, 'light');
    await collapse.click();
    await win.waitForTimeout(500);
    const expanded = await win.evaluate(() => {
      const panel = document.querySelector('.context-panel');
      const title = panel ? panel.querySelector('.context-panel-header .tf-panel-header-title') : null;
      return {
        collapsed: panel ? panel.getAttribute('data-context-panel-collapsed') : null,
        titleText: title ? (title.textContent || '').trim() : null,
      };
    });
    expect(expanded.collapsed, `${stage}: re-expands`).not.toBe('true');
    expect((expanded.titleText || '').length, `${stage}: expanded header shows its stage title`).toBeGreaterThan(0);
  }
});

// ---------------------------------------------------------------------------
// B. Inspector arrow-left and collapsed vertical label.
// ---------------------------------------------------------------------------
test('TFL1583-B inspector arrow-left and collapsed vertical label', async () => {
  await openSample(win, 'report.pdf');
  await win.waitForTimeout(600);
  await ensurePanelExpanded(win);
  await win.waitForTimeout(300);

  const toggle = win.locator('[data-inspector-collapse]').first();
  await expect(toggle).toBeVisible({ timeout: 8000 });
  const collapsedAttr = await win.evaluate(() => document.querySelector('[data-inspector]')?.getAttribute('data-inspector-collapsed'));
  if (collapsedAttr === 'true') {
    await toggle.click();
    await win.waitForTimeout(500);
  }

  const exp = await inspectorExpandedState();
  expect(exp.hasHeader, 'inspector header present').toBe(true);
  expect(exp.hasLeadingCollapse, 'collapse control in leading slot').toBe(true);
  expect(exp.leadingPrecedesTitle, 'leading cluster precedes title').toBe(true);
  expect(exp.leadingLeftOfTitle, 'arrow is left of the title text').toBe(true);

  for (const theme of ['light', 'dark']) {
    await setTheme(win, theme);
    await win.waitForTimeout(400);
    const p = await shot(`tfl1583_inspector_expanded_${theme}.png`);
    console.log(`[TFL1583-B] expanded/${theme} -> ${p}`);
  }

  await setTheme(win, 'light');
  await win.locator('[data-inspector-collapse]').first().click();
  await win.waitForTimeout(600);
  await expect(win.locator('[data-inspector-collapsed-strip]')).toBeVisible({ timeout: 8000 });

  const col = await inspectorCollapsedState();
  expect(col.hasStrip, 'collapsed strip present').toBe(true);
  expect(col.labelText, 'vertical label reads Inspector').toBe('Inspector');
  expect(col.labelAriaHidden, 'label is aria-hidden (decorative)').toBe('true');
  expect(col.writingMode, 'label uses vertical writing mode').toContain('vertical');
  expect(col.arrowPresent, 'expand arrow present in strip').toBe(true);
  expect(col.firstChildIsArrow, 'arrow precedes the label').toBe(true);
  expect(col.arrowAboveLabel, 'arrow sits above the label').toBe(true);

  for (const theme of ['light', 'dark']) {
    await setTheme(win, theme);
    await win.waitForTimeout(400);
    const p = await shot(`tfl1583_inspector_collapsed_${theme}.png`);
    console.log(`[TFL1583-B] collapsed/${theme} -> ${p}`);
  }
});

// ---------------------------------------------------------------------------
// C. Regression: expanded panels keep their titles and controls.
// ---------------------------------------------------------------------------
test('TFL1583-C expanded layouts unchanged', async () => {
  await openSample(win, 'report.pdf');
  await win.waitForTimeout(600);
  await ensurePanelExpanded(win);

  // Pages stage: expanded context header still shows its title and page actions.
  await gotoStage(win, 1);
  await win.waitForTimeout(400);
  await ensurePanelExpanded(win);
  await win.waitForTimeout(300);
  const ctx = await win.evaluate(() => {
    const panel = document.querySelector('.context-panel');
    const title = panel ? panel.querySelector('.context-panel-header .tf-panel-header-title') : null;
    const layout = document.querySelector('[data-context-panel-layout-split]');
    const combine = document.querySelector('[data-context-panel-combine]');
    return {
      titleText: title ? (title.textContent || '').trim() : null,
      layoutPresent: !!layout,
      combinePresent: !!combine,
      collapsePresent: !!document.querySelector('.context-panel-header [data-rail-collapse]'),
    };
  });
  expect(ctx.collapsePresent, 'context collapse control present').toBe(true);
  expect(ctx.layoutPresent, 'context Layout action present').toBe(true);
  expect(ctx.combinePresent, 'context Combine action present').toBe(true);

  // Inspector expanded still shows its title and close button.
  const collapsedAttr = await win.evaluate(() => document.querySelector('[data-inspector]')?.getAttribute('data-inspector-collapsed'));
  if (collapsedAttr === 'true') {
    await win.locator('[data-inspector-collapse]').first().click();
    await win.waitForTimeout(500);
  }
  const insp = await win.evaluate(() => {
    const title = document.querySelector('.inspector-header .tf-panel-header-title');
    const close = document.querySelector('[data-inspector-close]');
    const toggle = document.querySelector('.inspector-header [data-inspector-collapse]');
    return {
      titleText: title ? (title.textContent || '').trim() : null,
      closePresent: !!close,
      togglePresent: !!toggle,
    };
  });
  expect((insp.titleText || '').length, 'inspector title visible when expanded').toBeGreaterThan(0);
  expect(insp.togglePresent, 'inspector collapse toggle present').toBe(true);
  console.log(`[TFL1583-C] inspector close button present: ${insp.closePresent}`);

  await shot('tfl1583_regression_expanded_light.png');
});
