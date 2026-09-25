// Phase 38 gate (qa) — features B, C, D measured in the real Electron app.
//
// Groups:
//   1. rich readable icons/text (criteria 4, 5, 6): rendered icon glyph sizes,
//      label font sizes across dock / rail / panel / Inspector / header / pills,
//      the family/stage accent colours in all three themes, an independent
//      contrast sample of the REAL rendered colours, the one-row dock at 1440
//      and 640, and disabled-vs-enabled distinctness.
//   2. the legacy text panel is retired (criteria 7, 8): DOM counts for the
//      retired selectors in the ANNOTATE and EDIT flows, the two
//      capability-preservation cases, and the Ctrl+K palette reaching the
//      text-manipulation controls.
//   3. edit fidelity (criteria 9, 10): editor font-size vs the source run size
//      at two sizes/zooms, glyph coverage (eraser over the run), and the
//      Inspector text-field focus on selection in both flows.
//
// Launches only through the canonical e2e/lib/launch.cjs launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, armAnnotationTool } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[P38] ${label} ${JSON.stringify(obj)}`);
const THEMES = ['light', 'dark', 'frosted'];

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p38-gate');
  app = null;
  win = null;
});
test.setTimeout(420000);

async function openSample(name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function setWindowSize(w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows().find(
      (x) => !x.webContents.getURL().includes('tfWindow=print'),
    );
    if (bw) bw.setSize(s[0], s[1]);
  }, [w, h]);
  await win.waitForTimeout(700);
  await win.waitForFunction((t) => Math.abs(window.innerWidth - t) < 45, w, { timeout: 10000 });
}

async function gotoStage(n) {
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el !== null && typeof el.blur === 'function') el.blur();
  });
  await win.keyboard.press(`Control+${n}`);
  await win.waitForTimeout(400);
}

async function setTheme(name) {
  const cur = await win.evaluate(() => document.documentElement.dataset.theme);
  if (cur === name) return;
  await win.locator('[data-theme-toggle]').click();
  await win.waitForSelector('[data-theme-option]', { state: 'visible', timeout: 8000 });
  await win.locator(`[data-theme-option="${name}"]`).click();
  await win.waitForFunction((t) => document.documentElement.dataset.theme === t, name, { timeout: 8000 });
  await win.waitForTimeout(400);
}

// ===========================================================================
// Group 1 — sizes, accents, contrast, dock row.
// ===========================================================================
test('P38-1 rendered sizes + accents + contrast (3 themes) + one-row dock', async () => {
  await openSample('report.pdf');
  await setWindowSize(1440, 900);
  await gotoStage(1);

  const sizes = {};
  const contrast = {};
  for (const theme of THEMES) {
    await setTheme(theme);
    // Park the pointer away from the dock so hover states do not skew colours.
    await win.mouse.move(700, 420);
    await win.waitForTimeout(400);

    const m = await win.evaluate(() => {
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return [+r.width.toFixed(1), +r.height.toFixed(1)];
      };
      const fontSize = (el) => (el === null ? null : +parseFloat(getComputedStyle(el).fontSize).toFixed(2));
      const parse = (v) => {
        const m2 = String(v).match(/rgba?\(([^)]+)\)/);
        if (!m2) return null;
        const p = m2[1].split(',').map((x) => parseFloat(x.trim()));
        return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
      };
      const comp = (fg, bg) => ({
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
      });
      const lum = (c) => {
        const ch = (v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
      };
      const ratio = (a, b) => {
        const l1 = lum(a), l2 = lum(b);
        return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
      };
      const baseRaw = parse(getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim())
        || { r: 255, g: 255, b: 255, a: 1 };
      const base = comp(baseRaw, { r: 255, g: 255, b: 255, a: 1 });
      const effectiveBg = (el) => {
        const layers = [];
        let n = el;
        while (n && n !== document.documentElement) {
          const c = parse(getComputedStyle(n).backgroundColor);
          if (c && c.a > 0) {
            layers.push(c);
            if (c.a >= 1) break;
          }
          n = n.parentElement;
        }
        let out = base;
        for (let i = layers.length - 1; i >= 0; i -= 1) out = comp(layers[i], out);
        return out;
      };

      const svgMin = (root) => {
        const boxes = [...root.querySelectorAll('button svg, [role="button"] svg')].map(rect);
        if (boxes.length === 0) return null;
        return {
          count: boxes.length,
          minW: Math.min(...boxes.map((b) => b[0])),
          minH: Math.min(...boxes.map((b) => b[1])),
        };
      };
      const svgDetails = (root) => [...root.querySelectorAll('button svg, [role="button"] svg')].map((s) => {
        const b = s.getBoundingClientRect();
        const cs = getComputedStyle(s);
        const btn = s.closest('button, [role="button"]');
        const pcs = btn ? getComputedStyle(btn) : null;
        return {
          w: +b.width.toFixed(1), h: +b.height.toFixed(1),
          cw: cs.width, ch: cs.height, shrink: cs.flexShrink,
          parentDisplay: pcs ? pcs.display : null,
          parentFlex: pcs ? pcs.flex : null,
          cls: s.getAttribute('class'),
          parent: btn ? (btn.getAttribute('aria-label') || btn.getAttribute('data-inspector-action') || btn.className) : null,
        };
      });

      // Dock.
      const dock = document.querySelector('[data-action-dock]');
      const dockBg = dock ? effectiveBg(dock) : null;
      const dockVerbs = dock ? [...dock.querySelectorAll('[data-dock-verb]')].map((b) => {
        const icon = b.querySelector('.action-dock-icon svg');
        const label = b.querySelector('.action-dock-label');
        const cs = getComputedStyle(b);
        const col = parse(cs.color);
        const ownBg = effectiveBg(b);
        return {
          id: b.getAttribute('data-dock-verb'),
          disabled: b.disabled,
          icon: icon ? rect(icon) : null,
          label: fontSize(label),
          color: cs.color,
          bg: ownBg,
          contrastOnDock: col && ownBg ? ratio(col, ownBg) : null,
        };
      }) : [];

      // Stage rail.
      const rail = document.querySelector('[data-stage-rail]');
      const railBg = rail ? effectiveBg(rail) : null;
      const railRows = rail ? [...rail.querySelectorAll('.stage-rail-btn')].map((b) => {
        const icon = b.querySelector('.stage-rail-icon svg');
        const iconSpan = b.querySelector('.stage-rail-icon');
        const label = b.querySelector('.stage-rail-label');
        const iconColor = iconSpan ? getComputedStyle(iconSpan).color : null;
        const labelColor = label ? getComputedStyle(label).color : null;
        return {
          stage: b.getAttribute('data-stage') || 'gear',
          icon: icon ? rect(icon) : null,
          label: fontSize(label),
          labelHidden: label ? getComputedStyle(label).display === 'none' : null,
          iconColor,
          labelColor,
          iconContrast: iconColor && railBg ? ratio(parse(iconColor), railBg) : null,
          labelContrast: labelColor && railBg ? ratio(parse(labelColor), railBg) : null,
        };
      }) : [];

      // Context panel (thumbnail panel).
      const cp = document.querySelector('[data-context-panel]');
      const cpBg = cp ? effectiveBg(cp) : null;
      const cpLabels = cp ? [...cp.querySelectorAll(
        '.context-panel-section-title, .context-panel-item-label, .context-panel-row-label, .context-panel-action',
      )] : [];
      const cpTitle = cp ? cp.querySelector('.context-panel-section-title') : null;
      const cpAction = cp ? cp.querySelector('.context-panel-action, .context-panel-item-label') : null;
      const cpLabelFonts = cpLabels.map((el) => fontSize(el)).filter((v) => v !== null);

      // Inspector.
      const insp = document.querySelector('[data-inspector]');
      const inspAction = insp ? insp.querySelector('.inspector-action, .inspector-row-label') : null;

      // Header / pills.
      const header = document.querySelector('.app-header, .titlebar');

      return {
        theme: document.documentElement.dataset.theme,
        dock: {
          present: dock !== null,
          iconOnly: dock ? dock.getAttribute('data-dock-icon-only') : null,
          icons: dock ? svgMin(dock) : null,
          labelFont: dock ? fontSize(dock.querySelector('.action-dock-label')) : null,
          verbs: dockVerbs,
          bg: dockBg,
        },
        rail: {
          present: rail !== null,
          icons: rail ? svgMin(rail) : null,
          labelFont: rail ? fontSize(rail.querySelector('.stage-rail-label')) : null,
          rows: railRows,
        },
        contextPanel: {
          present: cp !== null,
          icons: cp ? svgMin(cp) : null,
          titleFont: fontSize(cpTitle),
          actionFont: fontSize(cpAction),
          minLabelFont: cpLabelFonts.length ? Math.min(...cpLabelFonts) : null,
          labelFonts: cpLabelFonts,
          titleColor: cpTitle ? getComputedStyle(cpTitle).color : null,
          titleContrast: cpTitle && cpBg ? ratio(parse(getComputedStyle(cpTitle).color), cpBg) : null,
        },
        inspector: {
          present: insp !== null,
          icons: insp ? svgMin(insp) : null,
          iconDetails: insp ? svgDetails(insp) : null,
          actionFont: fontSize(inspAction),
        },
        header: {
          present: header !== null,
          icons: header ? svgMin(header) : null,
          iconDetails: header ? svgDetails(header) : null,
        },
        pills: (() => {
          const p = document.querySelector('.canvas-pill');
          if (!p) return null;
          const svgs = [...p.querySelectorAll('svg')].map(rect);
          return { count: svgs.length, minW: Math.min(...svgs.map((b) => b[0])), minH: Math.min(...svgs.map((b) => b[1])) };
        })(),
      };
    });
    sizes[theme] = m;

    await win.screenshot({ path: path.join(SHOTS, `phase38-accents-${theme}.png`) });
    log(`sizes-${theme}`, {
      dockIcon: m.dock.icons, dockLabel: m.dock.labelFont,
      railIcon: m.rail.icons, railLabel: m.rail.labelFont,
      panelIcon: m.contextPanel.icons, panelTitle: m.contextPanel.titleFont, panelAction: m.contextPanel.actionFont,
      inspIcon: m.inspector.icons, inspAction: m.inspector.actionFont,
      headerIcon: m.header.icons, pillIcon: m.pills,
    });
    log(`icon-details-${theme}`, { inspector: m.inspector.iconDetails, header: m.header.iconDetails });
    log(`accents-${theme}`, {
      verbs: m.dock.verbs.map((v) => ({ id: v.id, color: v.color, c: v.contrastOnDock, disabled: v.disabled })),
      rail: m.rail.rows.map((r) => ({ s: r.stage, icon: r.iconColor, ic: r.iconContrast, label: r.labelColor, lc: r.labelContrast })),
      panelTitle: { color: m.contextPanel.titleColor, c: m.contextPanel.titleContrast },
    });
    contrast[theme] = {
      verbs: m.dock.verbs,
      rail: m.rail.rows,
      panelTitle: m.contextPanel.titleContrast,
    };

    // --- size floors, measured on the rendered elements. Soft so the full
    //     sweep reports every surface before the test verdict. ---
    const glyph = (s) => (s === null ? null : Math.min(s.minW, s.minH));
    expect.soft(glyph(m.dock.icons), `${theme}: dock icon glyph >= 18 (${JSON.stringify(m.dock.icons)})`).toBeGreaterThanOrEqual(18);
    expect.soft(glyph(m.rail.icons), `${theme}: rail icon glyph >= 18 (${JSON.stringify(m.rail.icons)})`).toBeGreaterThanOrEqual(18);
    expect.soft(glyph(m.contextPanel.icons), `${theme}: panel icon glyph >= 18 (${JSON.stringify(m.contextPanel.icons)})`).toBeGreaterThanOrEqual(18);
    expect.soft(glyph(m.inspector.icons), `${theme}: Inspector icon glyph >= 18 (${JSON.stringify(m.inspector.icons)})`).toBeGreaterThanOrEqual(18);
    expect.soft(glyph(m.header.icons), `${theme}: header icon glyph >= 18 (${JSON.stringify(m.header.icons)})`).toBeGreaterThanOrEqual(18);
    expect.soft(glyph(m.pills), `${theme}: pill icon glyph >= 18 (${JSON.stringify(m.pills)})`).toBeGreaterThanOrEqual(18);
    // Label floors.
    expect.soft(m.dock.labelFont, `${theme}: dock label >= 12`).toBeGreaterThanOrEqual(12);
    expect.soft(m.rail.labelFont, `${theme}: rail label >= 12`).toBeGreaterThanOrEqual(12);
    if (m.contextPanel.minLabelFont !== null) {
      expect.soft(m.contextPanel.minLabelFont, `${theme}: panel label >= 12`).toBeGreaterThanOrEqual(12);
    }
    expect.soft(m.inspector.actionFont, `${theme}: Inspector action label >= 12`).toBeGreaterThanOrEqual(12);
  }

  // --- accent distinctness per theme: the family hues are actually applied. ---
  for (const theme of THEMES) {
    const verbColors = sizes[theme].dock.verbs.map((v) => v.color);
    const distinct = new Set(verbColors);
    log(`distinct-${theme}`, { verbs: verbColors.length, distinctColors: distinct.size });
    expect(distinct.size, `${theme}: tool families are distinguishable by colour`).toBeGreaterThanOrEqual(4);
    const railColors = sizes[theme].rail.rows.map((r) => r.iconColor);
    log(`rail-distinct-${theme}`, { stages: railColors.length, distinct: new Set(railColors).size, colors: railColors });
    expect(new Set(railColors).size, `${theme}: the stage accents are distinct`).toBeGreaterThanOrEqual(4);
  }

  // --- independent contrast sample: every rendered dock verb colour vs its
  //     ACTUAL surface must clear the 4.5 text floor; stage rail labels 4.5,
  //     rail icons 3.0. ---
  const failures = [];
  for (const theme of THEMES) {
    for (const v of contrast[theme].verbs) {
      if (!v.disabled && v.contrastOnDock !== null && v.contrastOnDock < 4.5) {
        failures.push(`${theme} dock ${v.id} ${v.color} on ${JSON.stringify(v.bg)} = ${v.contrastOnDock}`);
      }
    }
    for (const r of contrast[theme].rail) {
      if (r.labelContrast !== null && r.labelContrast < 4.5) {
        failures.push(`${theme} rail label ${r.stage} ${r.labelColor} = ${r.labelContrast}`);
      }
      if (r.iconContrast !== null && r.iconContrast < 3) {
        failures.push(`${theme} rail icon ${r.stage} ${r.iconColor} = ${r.iconContrast}`);
      }
    }
  }
  log('contrast-failures', failures);
  expect.soft(failures, failures.join('\n')).toEqual([]);

  // --- disabled vs enabled distinct. ---
  await gotoStage(2); // EDIT: batchOcr / ocrSuspects are unavailable with one doc.
  await win.waitForTimeout(400);

  // The EDIT ContextPanel carries real section labels; measure them there.
  const panelLabels = await win.evaluate(() => {
    const cp = document.querySelector('[data-context-panel]');
    if (!cp) return null;
    const labels = [...cp.querySelectorAll(
      '.context-panel-section-title, .context-panel-section-toggle, .context-panel-item-label, .context-panel-row-label, .context-panel-action',
    )].map((el) => ({ t: el.textContent.trim().slice(0, 20), fs: +parseFloat(getComputedStyle(el).fontSize).toFixed(2) }));
    const svgs = [...cp.querySelectorAll('button svg, [role="button"] svg')].map((s) => {
      const b = s.getBoundingClientRect();
      return +Math.min(b.width, b.height).toFixed(1);
    });
    return { labels, minFont: labels.length ? Math.min(...labels.map((l) => l.fs)) : null, minIcon: svgs.length ? Math.min(...svgs) : null };
  });
  log('panel-edit', panelLabels);
  expect(panelLabels && panelLabels.minFont, 'EDIT ContextPanel label >= 12').toBeGreaterThanOrEqual(12);
  expect(panelLabels && panelLabels.minIcon, 'EDIT ContextPanel icon glyph >= 18').toBeGreaterThanOrEqual(18);

  const disabledInfo = await win.evaluate(() => {
    const d = document.querySelector('[data-action-dock]');
    const verbs = [...d.querySelectorAll('[data-dock-verb]')].map((b) => ({
      id: b.getAttribute('data-dock-verb'), disabled: b.disabled, color: getComputedStyle(b).color,
    }));
    const disabled = verbs.filter((v) => v.disabled);
    const enabled = verbs.filter((v) => !v.disabled);
    return {
      disabled,
      enabledColors: [...new Set(enabled.map((v) => v.color))],
      disabledToken: getComputedStyle(document.documentElement).getPropertyValue('--fg-disabled').trim(),
    };
  });
  log('disabled-state', disabledInfo);
  expect(disabledInfo.disabled.length, 'at least one disabled dock verb exists in EDIT with one document').toBeGreaterThan(0);
  for (const d of disabledInfo.disabled) {
    expect(disabledInfo.enabledColors, `${d.id}: disabled colour is distinct from every enabled colour`).not.toContain(d.color);
  }

  // --- one-row dock at 1440 and 640, arrows lane absorbing overflow. ---
  for (const w of [1440, 640]) {
    await setWindowSize(w, 900);
    await gotoStage(1);
    await win.waitForTimeout(500);
    const d = await win.evaluate(() => {
      const dock = document.querySelector('[data-action-dock]');
      const verbs = [...dock.querySelectorAll('[data-dock-verb]')].map((b) => Math.round(b.getBoundingClientRect().top));
      const sc = document.querySelector('[data-dock-scroll]');
      return {
        innerWidth: window.innerWidth,
        flexWrap: getComputedStyle(dock).flexWrap,
        verbRows: new Set(verbs).size,
        verbs: verbs.length,
        arrows: dock.getAttribute('data-dock-arrows'),
        arrowsLane: dock.getAttribute('data-dock-arrows-lane'),
        iconOnly: dock.getAttribute('data-dock-icon-only'),
        height: Math.round(dock.getBoundingClientRect().height),
        scrollWidth: sc ? sc.scrollWidth : null,
        clientWidth: sc ? sc.clientWidth : null,
      };
    });
    log(`dock-w=${w}`, d);
    expect(d.verbRows, `w=${w}: the dock is ONE row`).toBe(1);
    expect(d.flexWrap, `w=${w}: flex-wrap is nowrap`).toBe('nowrap');
    // The arrows lane absorbs overflow rather than wrapping.
    expect(d.arrowsLane, `w=${w}: the arrows lane state is published`).toMatch(/true|false/);
    if (d.scrollWidth > d.clientWidth) {
      expect(d.arrows, `w=${w}: arrows render when the row overflows`).toBe('true');
    }
  }
});

// ===========================================================================
// Group 2 — the legacy text panel is retired; the Inspector is the one surface.
// ===========================================================================
async function dragOnPage(fx, fy, dx, dy) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 260));
  const y = Math.max(40, Math.min(pg.y + pg.height * fy, vp.h - 150 - dy));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 6 });
  await win.mouse.up();
}

async function textSurfaceCounts() {
  return win.evaluate(() => ({
    textPropsPanel: document.querySelectorAll('.text-props-panel').length,
    dataTextPanel: document.querySelectorAll('[data-text-panel]').length,
    inspectorTextPanel: document.querySelectorAll('[data-inspector-text-panel]').length,
    float: document.querySelectorAll('[data-text-panel-float]').length,
    grip: document.querySelectorAll('[data-text-panel-grip]').length,
    gripClass: document.querySelectorAll('.text-props-grip').length,
    dragGrip: document.querySelectorAll("[data-drag-grip='text-props']").length,
    insideInspector: (() => {
      const p = document.querySelector('[data-text-panel]');
      const i = document.querySelector('[data-inspector]');
      return p !== null && i !== null ? i.contains(p) : false;
    })(),
    position: (() => {
      const p = document.querySelector('[data-inspector-text-panel] .text-props-panel');
      return p === null ? null : { position: getComputedStyle(p).position, transform: getComputedStyle(p).transform };
    })(),
    field: (() => {
      const t = document.querySelector('[data-inspector-text-panel] [data-txt-text]');
      return t === null ? null : { disabled: t.disabled, value: t.value };
    })(),
    font: document.querySelectorAll('[data-inspector-text-panel] [data-txt-font]').length,
    bold: document.querySelectorAll('[data-inspector-text-panel] [data-txt-bold]').length,
  }));
}

// Arm a tool through the Command Palette (the universal surface). Used here
// because the default-window dock's leading verbs are covered by the page pill
// (a separate defect, measured above); the palette is a real user path and is
// itself the criterion-8 capability being checked.
async function armViaPalette(search, id) {
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el !== null && typeof el.blur === 'function') el.blur();
  });
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-command-palette-input]').fill(search);
  await win.waitForTimeout(450);
  const row = win.locator(`[data-palette-tool-id="${id}"]`).first();
  await expect(row, `palette row ${id}`).toHaveCount(1);
  await row.click();
  await win.waitForTimeout(700);
}

test('P38-2 legacy text panel retired + capability preservation + palette', async () => {
  await openSample('report.pdf');
  await setWindowSize(1440, 900);
  await gotoStage(3);

  // Diagnostic: the dock vs the floating canvas pills at the default window.
  const overlap = await win.evaluate(() => {
    const dock = document.querySelector('[data-action-dock]');
    const annotate = dock ? dock.querySelector('[data-dock-verb="annotate"]') : null;
    const dr = dock ? dock.getBoundingClientRect() : null;
    const ar = annotate ? annotate.getBoundingClientRect() : null;
    const pills = [...document.querySelectorAll('.canvas-pill')].map((p) => {
      const r = p.getBoundingClientRect();
      return { cls: p.className, x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
    });
    let hit = null;
    if (ar) {
      const el = document.elementFromPoint(ar.x + ar.width / 2, ar.y + ar.height / 2);
      hit = el ? { tag: el.tagName, cls: String(el.className).slice(0, 90) } : null;
    }
    return {
      dock: dr ? { x: Math.round(dr.x), right: Math.round(dr.right), w: Math.round(dr.width) } : null,
      annotate: ar ? { x: Math.round(ar.x), right: Math.round(ar.right), cy: Math.round(ar.y + ar.height / 2) } : null,
      pills,
      hit,
      reserve: dock ? getComputedStyle(dock).getPropertyValue('--dock-reserve').trim() : null,
      arrows: dock ? dock.getAttribute('data-dock-arrows') : null,
      arrowsLane: dock ? dock.getAttribute('data-dock-arrows-lane') : null,
      scroll: (() => {
        const sc = document.querySelector('[data-dock-scroll]');
        return sc ? { display: getComputedStyle(sc).display, scrollLeft: sc.scrollLeft, scrollWidth: sc.scrollWidth, clientWidth: sc.clientWidth } : null;
      })(),
      annotateCount: document.querySelectorAll('[data-dock-verb="annotate"]').length,
      verbRects: dock ? [...dock.querySelectorAll('[data-dock-verb]')].map((b) => {
        const r = b.getBoundingClientRect();
        return { id: b.getAttribute('data-dock-verb'), x: Math.round(r.x), right: Math.round(r.right) };
      }) : [],
    };
  });
  log('dock-overlap', overlap);
  await win.screenshot({ path: path.join(SHOTS, 'phase38-dock-overlap.png') });

  // Which stage dock verbs are covered by another surface at the default window?
  const stageHits = [];
  for (const [n, stage] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
    await gotoStage(n);
    await win.waitForTimeout(450);
    stageHits.push(await win.evaluate((s) => {
      const dock = document.querySelector('[data-action-dock]');
      const verbs = [...dock.querySelectorAll('[data-dock-verb]')];
      const first = verbs[0];
      const r = first.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        stage: s, first: first.getAttribute('data-dock-verb'),
        x: Math.round(r.x), covered: el !== null && !first.contains(el) && el !== first,
        hit: el ? String(el.className).slice(0, 70) : null,
      };
    }, stage));
  }
  log('stage-first-verb-hits', stageHits);
  await gotoStage(3);
  await win.waitForTimeout(300);

  // --- Capability (a): an ARMED text tool with NOTHING selected presents the
  //     text controls in the Inspector (the retired card's old home). Armed
  //     through the Ctrl+K palette, which is criterion 8's own capability. ---
  await armViaPalette('Text box', 'annTextbox');
  await win.waitForSelector('[data-inspector-text-panel]', { timeout: 10000 });
  await win.waitForTimeout(500);
  const armed = await textSurfaceCounts();
  log('annotate-armed', armed);
  expect(armed.textPropsPanel, 'armed: exactly ONE text-props panel').toBe(1);
  expect(armed.dataTextPanel, 'armed: exactly ONE [data-text-panel]').toBe(1);
  expect(armed.inspectorTextPanel, 'armed: it is the Inspector instance').toBe(1);
  expect(armed.insideInspector, 'armed: the surface lives in the Inspector').toBe(true);
  expect(armed.float + armed.grip + armed.gripClass + armed.dragGrip, 'armed: retired float/grip absent').toBe(0);
  expect(armed.field && armed.field.disabled, 'armed: the Text field is disabled with nothing selected').toBe(true);
  expect(armed.font, 'armed: font control present').toBeGreaterThan(0);
  expect(armed.bold, 'armed: bold control present').toBeGreaterThan(0);

  // --- Place a text annotation; it becomes the selection. ---
  await dragOnPage(0.35, 0.28, 180, 60);
  await win.waitForSelector('[data-txt-text]', { timeout: 10000 });
  await win.waitForTimeout(700);
  const sel = await win.locator('[data-inspector]').getAttribute('data-inspector-selection');
  const placed = await textSurfaceCounts();
  log('annotate-placed', { sel, ...placed });
  expect(sel, 'the text annotation drives the Inspector selection').toBe('text');
  expect(placed.textPropsPanel, 'annotate flow: exactly ONE text-manipulation surface').toBe(1);
  expect(placed.inspectorTextPanel, 'annotate flow: it is the Inspector instance').toBe(1);
  expect(placed.insideInspector, 'annotate flow: it is inside the Inspector').toBe(true);
  expect(placed.float, 'annotate flow: [data-text-panel-float] is ABSENT from the DOM').toBe(0);
  expect(placed.grip, 'annotate flow: [data-text-panel-grip] is ABSENT').toBe(0);
  expect(placed.gripClass, 'annotate flow: .text-props-grip is ABSENT').toBe(0);
  expect(placed.dragGrip, 'annotate flow: the drag grip attribute is ABSENT').toBe(0);
  expect(placed.position && placed.position.position, 'annotate flow: the surface is not a floating overlay')
    .not.toMatch(/absolute|fixed/);
  expect(placed.field && placed.field.disabled, 'annotate flow: the Text field is editable').toBe(false);

  // --- Focus on placement + immediate typing, no manual click (annotate). ---
  const focusAnn = await win.evaluate(() => {
    const t = document.querySelector('[data-inspector-text-panel] [data-txt-text]');
    return { active: document.activeElement === t, tag: document.activeElement ? document.activeElement.tagName : null };
  });
  log('annotate-focus', focusAnn);
  expect(focusAnn.active, 'annotate flow: selecting the text object focuses the Inspector text field').toBe(true);
  const beforeAnn = await win.inputValue('[data-inspector-text-panel] [data-txt-text]');
  await win.keyboard.type('AB');
  await win.waitForTimeout(300);
  const afterAnn = await win.inputValue('[data-inspector-text-panel] [data-txt-text]');
  log('annotate-type', { beforeAnn, afterAnn });
  expect(afterAnn, 'annotate flow: typing immediately changes the field value').not.toBe(beforeAnn);
  expect(afterAnn).toContain('AB');
  await win.locator('[data-inspector-text-panel] [data-txt-text]').blur();
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'phase38-text-inspector-annotate.png') });

  // --- Capability (b): the SAME annotation selected in REVIEW presents its
  //     text controls in the Inspector (select tool, not the armed tool). ---
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  await armViaPalette('Select', 'annSelect');
  await win.locator('.ann-textbox[data-kind="textbox"]').first().click({ position: { x: 12, y: 12 } });
  await win.waitForSelector('[data-inspector-text-panel]', { timeout: 10000 });
  await win.waitForTimeout(500);
  const reselected = await textSurfaceCounts();
  log('annotate-reselected', reselected);
  expect(reselected.inspectorTextPanel, 'REVIEW selection: the Inspector hosts the text controls').toBe(1);
  expect(reselected.float + reselected.grip + reselected.gripClass, 'REVIEW selection: retired chrome absent').toBe(0);
  expect(reselected.field && reselected.field.disabled, 'REVIEW selection: the Text field is editable').toBe(false);
  expect(reselected.field && reselected.field.value, 'REVIEW selection: it carries the annotation text').toContain('AB');

  // --- Ctrl+K palette still reaches the text-manipulation controls. ---
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el !== null && typeof el.blur === 'function') el.blur();
  });
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-command-palette-input]').fill('text');
  await win.waitForTimeout(400);
  const paletteRows = await win.evaluate(() =>
    [...document.querySelectorAll('[data-palette-tool-id]')].map((e) => e.getAttribute('data-palette-tool-id')));
  log('palette-rows', paletteRows);
  expect(paletteRows, 'the palette lists the text-manipulation tools').toContain('annTextbox');
  await win.locator('[data-palette-tool-id="annTextbox"]').first().click();
  await win.waitForTimeout(700);
  const viaPalette = await textSurfaceCounts();
  log('palette-armed', viaPalette);
  expect(viaPalette.inspectorTextPanel, 'the palette reaches the Inspector text surface').toBe(1);
  expect(viaPalette.float + viaPalette.grip + viaPalette.gripClass, 'the palette path mounts no retired chrome').toBe(0);

  // --- EDIT flow: create a text box; exactly one surface, in the Inspector. ---
  await win.keyboard.press('Escape');
  await gotoStage(2);
  await armViaPalette('Add a text box', 'editTextBox');
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  await win.mouse.click(Math.round(pg.x + pg.width * 0.4), Math.round(pg.y + pg.height * 0.3));
  await win.waitForSelector('[data-txt-text]', { timeout: 10000 });
  await win.waitForTimeout(800);
  const editSel = await win.locator('[data-inspector]').getAttribute('data-inspector-selection');
  const editCounts = await textSurfaceCounts();
  log('edit-flow', { editSel, ...editCounts });
  expect(editSel, 'a text object selected in EDIT drives the Inspector').toBe('text');
  expect(editCounts.textPropsPanel, 'EDIT flow: exactly ONE text-manipulation surface').toBe(1);
  expect(editCounts.inspectorTextPanel, 'EDIT flow: it is the Inspector instance').toBe(1);
  expect(editCounts.insideInspector, 'EDIT flow: it is inside the Inspector').toBe(true);
  expect(editCounts.float, 'EDIT flow: [data-text-panel-float] is ABSENT').toBe(0);
  expect(editCounts.grip, 'EDIT flow: [data-text-panel-grip] is ABSENT').toBe(0);
  expect(editCounts.gripClass, 'EDIT flow: .text-props-grip is ABSENT').toBe(0);
  expect(editCounts.dragGrip, 'EDIT flow: the drag grip attribute is ABSENT').toBe(0);
  expect(editCounts.position && editCounts.position.position, 'EDIT flow: the surface is fixed, not floating')
    .not.toMatch(/absolute|fixed/);

  // --- Focus on selection + immediate typing (edit flow). ---
  const focusEdit = await win.evaluate(() => {
    const t = document.querySelector('[data-inspector-text-panel] [data-txt-text]');
    return { active: document.activeElement === t };
  });
  log('edit-focus', focusEdit);
  expect(focusEdit.active, 'EDIT flow: selecting the text object focuses the Inspector text field').toBe(true);
  const beforeEdit = await win.inputValue('[data-inspector-text-panel] [data-txt-text]');
  await win.keyboard.type('XY');
  await win.waitForTimeout(300);
  const afterEdit = await win.inputValue('[data-inspector-text-panel] [data-txt-text]');
  log('edit-type', { beforeEdit, afterEdit });
  expect(afterEdit, 'EDIT flow: typing immediately changes the field value').not.toBe(beforeEdit);
  expect(afterEdit).toContain('XY');
  await win.locator('[data-inspector-text-panel] [data-txt-text]').blur();
  await win.waitForTimeout(600);

  // --- Fixed in place: a drag on the surface must not move it, and the
  //     Inspector must not be dragged out of position. ---
  const beforeDrag = await win.locator('[data-inspector-text-panel]').boundingBox();
  await win.mouse.move(beforeDrag.x + 12, beforeDrag.y + 12);
  await win.mouse.down();
  await win.mouse.move(beforeDrag.x + 12 + 120, beforeDrag.y + 12 + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  const afterDrag = await win.locator('[data-inspector-text-panel]').boundingBox();
  log('edit-drag', { beforeDrag, afterDrag });
  expect(Math.abs(afterDrag.x - beforeDrag.x), 'the Inspector text surface does not drag (x)').toBeLessThanOrEqual(1.5);
  expect(Math.abs(afterDrag.y - beforeDrag.y), 'the Inspector text surface does not drag (y)').toBeLessThanOrEqual(1.5);
  await win.screenshot({ path: path.join(SHOTS, 'phase38-text-inspector-edit.png') });
});

// ===========================================================================
// Group 3 — edit fidelity: editor size vs source run size + glyph coverage.
// ===========================================================================
async function selectRun() {
  const pageLoc = win.locator('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]');
  const pg = await (await pageLoc.count() ? pageLoc.first() : win.locator('.pdf-page[data-page="1"]').first()).boundingBox();
  const fracs = [[0.5, 0.1], [0.3, 0.12], [0.5, 0.16], [0.25, 0.22], [0.5, 0.3], [0.35, 0.42], [0.55, 0.5], [0.4, 0.62]];
  for (const [fx, fy] of fracs) {
    await win.mouse.click(Math.round(pg.x + pg.width * fx), Math.round(pg.y + pg.height * fy));
    await win.waitForTimeout(550);
    const active = await win.evaluate(() => {
      const root = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
      return root.querySelector('[data-textrun-selection]') !== null;
    });
    if (active) return true;
  }
  return false;
}

async function measureRunEditor() {
  return win.evaluate(() => {
    const root = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
    const sel = root.querySelector('[data-textrun-selection]');
    const preview = root.querySelector('[data-edit-run-preview]');
    const eraser = root.querySelector('[data-edit-box-eraser]');
    const zoom = document.querySelector('[data-zoom-pill] .zoom-percent');
    const r = (el) => {
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
    };
    return {
      zoom: zoom ? zoom.textContent.trim() : null,
      selection: r(sel),
      previewFont: preview ? +parseFloat(getComputedStyle(preview).fontSize).toFixed(2) : null,
      preview: r(preview),
      eraser: r(eraser),
      eraserBg: eraser ? getComputedStyle(eraser).backgroundColor : null,
    };
  });
}

test('P38-3 edit renders at the source run size and covers the original glyphs', async () => {
  await openSample('report.pdf');
  await setWindowSize(1440, 900);
  await gotoStage(2);
  await armViaPalette('Edit text', 'editText');
  await win.waitForTimeout(500);

  const rows = [];
  // Run 1 at the default zoom.
  const got1 = await selectRun();
  expect(got1, 'report.pdf: run 1 selectable').toBe(true);
  await win.waitForTimeout(500);
  const m = await measureRunEditor();
  rows.push({ doc: 'report.pdf', zoom: m.zoom, source: m.selection, previewFont: m.previewFont, eraser: m.eraser });
  log('run-size', rows[rows.length - 1]);
  expect(m.selection && m.selection.h, 'the run selection rect exists').toBeGreaterThan(0);
  expect(m.previewFont, 'the live editor renders at the source run size (within 0.5px)')
    .toBeGreaterThan(m.selection.h - 0.5);
  expect(m.previewFont).toBeLessThan(m.selection.h + 0.5);
  // Coverage: the white eraser fully covers the run's glyph rect.
  expect(m.eraser, 'the eraser cover is mounted').not.toBeNull();
  expect(m.eraser.y, 'eraser covers the run top').toBeLessThanOrEqual(m.selection.y + 0.5);
  expect(m.eraser.y + m.eraser.h, 'eraser covers the run bottom (descenders included)')
    .toBeGreaterThanOrEqual(m.selection.y + m.selection.h - 0.5);
  expect(m.eraser.x, 'eraser covers the run left').toBeLessThanOrEqual(m.selection.x + 0.5);
  expect(m.eraser.x + m.eraser.w, 'eraser covers the run right').toBeGreaterThanOrEqual(m.selection.x + m.selection.w - 0.5);

  // Zoom in two steps; the preview must still equal the source run's size.
  await win.locator('[data-zoom-pill] button[aria-label="Zoom in"]').first().click();
  await win.waitForTimeout(900);
  await win.locator('[data-zoom-pill] button[aria-label="Zoom in"]').first().click();
  await win.waitForTimeout(900);
  const gotZoom = await selectRun();
  expect(gotZoom, 'report.pdf: run selectable after zoom-in').toBe(true);
  await win.waitForTimeout(500);
  const zoomed = await measureRunEditor();
  rows.push({ doc: 'report.pdf', zoom: zoomed.zoom, source: zoomed.selection, previewFont: zoomed.previewFont, eraser: zoomed.eraser });
  log('run-size', rows[rows.length - 1]);
  expect(zoomed.previewFont, 'zoomed: the live editor still renders at the source run size (within 0.5px)')
    .toBeGreaterThan(zoomed.selection.h - 0.5);
  expect(zoomed.previewFont).toBeLessThan(zoomed.selection.h + 0.5);
  expect(zoomed.eraser.y + zoomed.eraser.h, 'zoomed: eraser covers the run bottom').toBeGreaterThanOrEqual(zoomed.selection.y + zoomed.selection.h - 0.5);

  // A zoomed-in capture of the edited region for visual ghost inspection.
  const clip = {
    x: Math.max(0, zoomed.selection.x - 30),
    y: Math.max(0, zoomed.selection.y - 30),
    width: Math.min(zoomed.selection.w + 60, 900),
    height: Math.min(zoomed.selection.h + 60, 500),
  };
  await win.screenshot({ path: path.join(SHOTS, 'phase38-edit-coverage-zoom.png'), clip });
  log('coverage-shot', clip);

  // A second document (source run with descenders) — same two measurements.
  const p2 = require('./lib/launch.cjs').getSamplePath('long.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p2);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await gotoStage(2);
  await armViaPalette('Edit text', 'editText');
  await win.waitForTimeout(500);
  const gotLong = await selectRun();
  expect(gotLong, 'long.pdf: a text run is selectable').toBe(true);
  await win.waitForTimeout(500);
  const longM = await measureRunEditor();
  rows.push({ doc: 'long.pdf', zoom: longM.zoom, source: longM.selection, previewFont: longM.previewFont, eraser: longM.eraser });
  log('run-size', rows[rows.length - 1]);
  expect(longM.previewFont, 'long.pdf: the live editor renders at the source run size (within 0.5px)')
    .toBeGreaterThan(longM.selection.h - 0.5);
  expect(longM.previewFont).toBeLessThan(longM.selection.h + 0.5);
  expect(longM.eraser.y + longM.eraser.h, 'long.pdf: eraser covers the run bottom').toBeGreaterThanOrEqual(longM.selection.y + longM.selection.h - 0.5);

  log('run-size-summary', rows);
});

// ===========================================================================
// Group 4 — DEF-341: the leading verb of EVERY stage is contained in the dock
// box and hit-testable at every acceptance width. The fix is `safe center` on
// the group plus `flex-start` in the arrows lane, so a centred overflowing row
// can never spill to the LEFT of the dock (the old bug laid REVIEW's annotate
// out at x=340 while the dock began at x=422).
// ===========================================================================
test('P38-4 DEF-341 leading verb contained + hit-testable at 1920/1440/1200/880/719/640', async () => {
  await openSample('report.pdf');
  const widths = [1920, 1440, 1200, 880, 719, 640];
  const rows = [];
  for (const w of widths) {
    await setWindowSize(w, 900);
    for (const [n, stage] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
      await gotoStage(n);
      await win.waitForTimeout(450);
      const m = await win.evaluate(() => {
        const dock = document.querySelector('[data-action-dock]');
        const dr = dock.getBoundingClientRect();
        const sc = document.querySelector('[data-dock-scroll]');
        const verbs = [...dock.querySelectorAll('[data-dock-verb]')];
        const first = verbs[0];
        const fr = first.getBoundingClientRect();
        const cx = fr.left + fr.width / 2;
        const cy = fr.top + fr.height / 2;
        const el = document.elementFromPoint(cx, cy);
        const hit = el !== null && (el === first || first.contains(el));
        const vClipped = verbs.filter((v) => {
          const r = v.getBoundingClientRect();
          return r.top < dr.top - 0.6 || r.bottom > dr.bottom + 0.6;
        }).map((v) => v.getAttribute('data-dock-verb'));
        return {
          stage: first.getAttribute('data-dock-verb'),
          dock: { left: Math.round(dr.left), right: Math.round(dr.right), top: Math.round(dr.top), bottom: Math.round(dr.bottom) },
          first: { left: Math.round(fr.left), right: Math.round(fr.right), cx: Math.round(cx), cy: Math.round(cy) },
          inside: fr.left >= dr.left - 0.6 && fr.right <= dr.right + 0.6
            && fr.top >= dr.top - 0.6 && fr.bottom <= dr.bottom + 0.6,
          vClipped,
          hit,
          hitTag: el ? el.tagName : null,
          hitCls: el ? String(el.className).slice(0, 60) : null,
          rows: new Set(verbs.map((v) => Math.round(v.getBoundingClientRect().top))).size,
          scrollLeft: sc ? Math.round(sc.scrollLeft) : null,
          scrollWidth: sc ? sc.scrollWidth : null,
          clientWidth: sc ? sc.clientWidth : null,
        };
      });
      rows.push({ w, ...m });
      expect(m.rows, `w=${w} ${m.stage}: the dock is ONE row`).toBe(1);
      expect(m.vClipped, `w=${w} ${m.stage}: no verb is vertically clipped`).toEqual([]);
      expect(m.inside, `w=${w} ${m.stage}: the leading verb is inside the dock box (first=${JSON.stringify(m.first)} dock=${JSON.stringify(m.dock)})`).toBe(true);
      expect(m.hit, `w=${w} ${m.stage}: elementFromPoint at the leading verb centre returns it (got ${m.hitTag}.${m.hitCls})`).toBe(true);
    }
  }
  log('def341-sweep', rows);
});
