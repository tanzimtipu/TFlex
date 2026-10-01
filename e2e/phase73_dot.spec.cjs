// Phase 73 (chunk B) — QA focused verification of the dirty-dot geometry.
//
// Proves the modified dot is FULLY inside the tab body (never clipped by the
// `.tab-title` overflow, the tab edge, the --radius-2 corner or the close
// control) at full AND squeezed widths, on the dirty tab only, in light and
// dark, and that its outer painted size (5px, ring contained by a border-box
// border) is strictly smaller than the retired Phase 72 dot (7px box + 1.5px
// OUTSET ring => ~10px painted). One spec only. Launches only through the
// canonical launchApp helper; mirror of test-fixtures/qa-p72-capture.cjs.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, openSamplePath, runTool } = require('./lib/helpers.cjs');
const { switchTheme } = require('./lib/p33_common.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const USER_DATA = path.join(os.tmpdir(), `tflex-qa-p73-${Date.now()}`);

test.setTimeout(300000);

// Phase 62/72 zoomed-tab evidence: magnify `.tab-area` in place so the dot is
// inspectable, capture the indexed tab box plus a margin, then restore.
async function captureZoomedTab(win, index, file) {
  await win.evaluate(() => {
    const area = document.querySelector('.tab-area');
    area.style.transformOrigin = 'top left';
    area.style.transform = 'scale(4)';
  });
  await win.waitForTimeout(300);
  const clip = await win.evaluate((idx) => {
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
    const r = tabs[idx].getBoundingClientRect();
    const m = 8;
    return { x: r.left - m, y: r.top - m, width: r.width + 2 * m, height: r.height + 2 * m };
  }, index);
  const out = path.join(SHOTS, file);
  await win.screenshot({ path: out, clip });
  await win.evaluate(() => {
    const area = document.querySelector('.tab-area');
    area.style.transform = '';
    area.style.transformOrigin = '';
  });
  await win.waitForTimeout(150);
  return out;
}

async function openViaToolbar(app, win, filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(900);
}

// Full geometry of the dirty dot for one tab: its own painted box, the
// computed ring/shadow, and the tab / title / close rects it must clear.
async function measureDot(win, idx) {
  return win.evaluate((i) => {
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
    const tab = tabs[i];
    if (!tab) return null;
    const dot = tab.querySelector('.tab-modified-dot');
    const title = tab.querySelector('.tab-title');
    const close = tab.querySelector('.tab-close');
    if (!dot) return null;
    const tr = tab.getBoundingClientRect();
    const dr = dot.getBoundingClientRect();
    const tir = title.getBoundingClientRect();
    const cr = close ? close.getBoundingClientRect() : null;
    const cs = getComputedStyle(dot);
    const ts = getComputedStyle(title);
    // REAL paint oracle (TFL-245 / ADV-143). A bounding-rect containment check
    // cannot see an ancestor `overflow:hidden` clip: the dot's rect can sit
    // "inside" the tab while 100% of its pixels are clipped away. Two facts
    // prove actual paint: the dot is the topmost element at its own centre
    // (elementFromPoint), and its rect lies inside EVERY ancestor clip box.
    const cx = (dr.left + dr.right) / 2;
    const cy = (dr.top + dr.bottom) / 2;
    const hitEl = document.elementFromPoint(cx, cy);
    const ancestorClips = [];
    let clippedByAncestor = false;
    for (let el = dot.parentElement; el; el = el.parentElement) {
      const acs = getComputedStyle(el);
      if (acs.overflow === 'visible') continue;
      const ar = el.getBoundingClientRect();
      const clipLeft = ar.left + el.clientLeft; // overflow clips at the padding box
      const clipTop = ar.top + el.clientTop;
      const clipRight = clipLeft + el.clientWidth;
      const clipBottom = clipTop + el.clientHeight;
      const inside = dr.left >= clipLeft - 0.01 && dr.right <= clipRight + 0.01
        && dr.top >= clipTop - 0.01 && dr.bottom <= clipBottom + 0.01;
      ancestorClips.push({
        tag: el.tagName,
        className: String(el.className || ''),
        overflow: acs.overflow,
        clipLeft, clipTop, clipRight, clipBottom, inside,
      });
      if (!inside) clippedByAncestor = true;
    }
    return {
      tab: { left: tr.left, right: tr.right, top: tr.top, bottom: tr.bottom, width: tr.width, height: tr.height },
      dot: { left: dr.left, right: dr.right, top: dr.top, bottom: dr.bottom, width: dr.width, height: dr.height },
      title: { left: tir.left, right: tir.right, paddingLeft: parseFloat(ts.paddingLeft) },
      close: cr ? { left: cr.left, right: cr.right } : null,
      dotCenter: { x: cx, y: cy },
      hit: hitEl ? String(hitEl.className || hitEl.tagName) : null,
      hitIsDot: hitEl ? (hitEl === dot || dot.contains(hitEl)) : false,
      ancestorClips,
      clippedByAncestor,
      offsetWidth: dot.offsetWidth,
      offsetHeight: dot.offsetHeight,
      boxSizing: cs.boxSizing,
      borderTopWidth: cs.borderTopWidth,
      borderTopColor: cs.borderTopColor,
      backgroundColor: cs.backgroundColor,
      boxShadow: cs.boxShadow,
      visibility: cs.visibility,
      opacity: cs.opacity,
      className: dot.className,
    };
  }, idx);
}

// Criterion 1/5 — the dot's painted rect (ring included) lies wholly within the
// tab body, its title clip box, and clear of the close control.
function assertContained(m, label) {
  const clearance = {
    left: m.dot.left - m.tab.left,
    right: m.tab.right - m.dot.right,
    top: m.dot.top - m.tab.top,
    bottom: m.tab.bottom - m.dot.bottom,
    titleLeft: m.dot.left - m.title.left,
  };
  console.log(`[P73 ${label}] dot=${JSON.stringify(m.dot)} tab=${JSON.stringify(m.tab)} title=${JSON.stringify(m.title)} close=${JSON.stringify(m.close)} clearance=${JSON.stringify(clearance)}`);
  expect(clearance.left, `${label}: dot clears the tab left edge (${clearance.left})`).toBeGreaterThanOrEqual(-0.01);
  expect(clearance.right, `${label}: dot clears the tab right edge (${clearance.right})`).toBeGreaterThanOrEqual(-0.01);
  expect(clearance.top, `${label}: dot clears the tab top edge (${clearance.top})`).toBeGreaterThanOrEqual(-0.01);
  expect(clearance.bottom, `${label}: dot clears the tab bottom edge (${clearance.bottom})`).toBeGreaterThanOrEqual(-0.01);
  expect(clearance.titleLeft, `${label}: dot clears the .tab-title overflow clip at x=0 (${clearance.titleLeft})`).toBeGreaterThanOrEqual(-0.01);
  if (m.close) {
    expect(m.dot.right, `${label}: dot does not run under the close control (dot.right ${m.dot.right} vs close.left ${m.close.left})`).toBeLessThanOrEqual(m.close.left + 0.01);
  }
  // REAL visibility oracle (TFL-245 / ADV-143): geometry alone is not paint.
  console.log(`[P73 paint ${label}] center=${JSON.stringify(m.dotCenter)} hit=${m.hit} hitIsDot=${m.hitIsDot} clippedByAncestor=${m.clippedByAncestor} clips=${JSON.stringify(m.ancestorClips)}`);
  expect(m.hitIsDot, `${label}: elementFromPoint at the dot centre returns the dot (got ${m.hit})`).toBe(true);
  expect(m.clippedByAncestor, `${label}: the dot rect lies inside every overflow ancestor clip box`).toBe(false);
}

test('phase73 dirty dot is smaller and fully visible at full and squeezed widths', async () => {
  const app = await launchApp([], USER_DATA);
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });
    await win.waitForTimeout(700);

    // Dirty the active tab (report.pdf = tab 0) FIRST, so after the second
    // document opens tab 0 is briefly an INACTIVE dirty tab (criterion 4).
    await runTool(win, 'rotate');
    await win.waitForFunction(() => {
      const t = document.querySelector('[data-tab-id][aria-selected="true"]');
      const d = t && t.querySelector('.tab-modified-dot');
      if (!d) return false;
      const cs = getComputedStyle(d);
      return cs.visibility === 'visible' && parseFloat(cs.opacity) > 0.5;
    }, null, { timeout: 20000 });
    await win.waitForTimeout(400);

    // A second, CLEAN tab: long.pdf becomes the active tab; tab 0 stays dirty
    // but is now inactive.
    await openViaToolbar(app, win, getSamplePath('long.pdf'));
    await win.waitForFunction(() => document.querySelectorAll('[data-tab-id]').length === 2, null, { timeout: 30000 });
    await win.waitForTimeout(400);

    // ---- Criterion 4: INACTIVE dirty tab dot stays visible + contained ----
    const inactive = await measureDot(win, 0);
    expect(inactive.visibility, 'inactive dirty dot is visible').toBe('visible');
    expect(parseFloat(inactive.opacity), 'inactive dirty dot opacity').toBeGreaterThan(0.5);
    assertContained(inactive, 'full-width-inactive');
    console.log(`[P73 inactive colors] fill=${inactive.backgroundColor} ring=${inactive.borderTopColor}`);

    // Re-activate the dirty tab for the active-tab size/containment checks.
    await win.locator('[data-tab-id]').first().click();
    await win.waitForTimeout(400);

    // ---- Criterion 2/6: full-width dirty active dot, size + containment ----
    const full = await measureDot(win, 0);
    expect(full, 'the dirty tab still carries its dot').toBeTruthy();
    expect(full.visibility, 'dirty dot computed visibility').toBe('visible');
    expect(parseFloat(full.opacity), 'dirty dot computed opacity').toBeGreaterThan(0.5);
    assertContained(full, 'full-width');

    // Criterion 2: own painted box is exactly 5px border-box; ring contained.
    expect(full.offsetWidth, 'dot offsetWidth').toBe(5);
    expect(full.offsetHeight, 'dot offsetHeight').toBe(5);
    expect(full.boxSizing, 'dot box-sizing').toBe('border-box');
    // The sheet declares `border: 1.5px`, but Chromium reports the USED border
    // width and floors 1.5px to 1px at DPR 1 (probe below proves it is a
    // renderer artifact, not an override). The Phase 73 requirement is a ring
    // contained by the 5px border-box, so assert the ring is present and no
    // wider than the specified 1.5px; the box itself stays exactly 5px.
    const borderProbe = await win.evaluate(() => {
      const p = document.createElement('div');
      p.style.cssText = 'position:absolute;left:-9999px;border:1.5px solid red;';
      document.body.appendChild(p);
      const used = getComputedStyle(p).borderTopWidth;
      p.remove();
      return { dpr: window.devicePixelRatio, probeBorderTopWidth: used };
    });
    console.log(`[P73 border] computed=${full.borderTopWidth} probe=${JSON.stringify(borderProbe)}`);
    const borderPx = parseFloat(full.borderTopWidth);
    expect(borderPx, `dot paints a positive contained ring (border-top ${full.borderTopWidth})`).toBeGreaterThan(0);
    expect(borderPx, `dot ring no wider than the specified 1.5px (${full.borderTopWidth})`).toBeLessThanOrEqual(1.5);
    // Criterion 6: no outset shadow; outer painted 5px < Phase 72 box 7px
    // (and 5px < 7 + 2*1.5 = 10px painted baseline).
    expect(full.boxShadow, 'dot computed box-shadow is none (ring contained, not outset)').toBe('none');
    expect(full.offsetWidth, 'outer painted size strictly < Phase 72 7px box').toBeLessThan(7);
    expect(full.offsetWidth + 2 * 1.5, 'painted extent < Phase 72 ~10px painted baseline').toBeLessThan(10);

    // ---- Criterion 4: fill + ring resolve to real colours and differ ----
    const opaque = (c) => Boolean(c) && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)';
    console.log(`[P73 active colors] fill=${full.backgroundColor} ring=${full.borderTopColor}`);
    expect(opaque(full.backgroundColor), `active dirty dot fill resolves to a colour (${full.backgroundColor})`).toBe(true);
    expect(opaque(full.borderTopColor), `active dirty dot ring resolves to a colour (${full.borderTopColor})`).toBe(true);
    expect(full.backgroundColor, 'active dirty dot fill differs from its ring').not.toBe(full.borderTopColor);
    expect(opaque(inactive.backgroundColor), `inactive dirty dot fill resolves to a colour (${inactive.backgroundColor})`).toBe(true);
    expect(opaque(inactive.borderTopColor), `inactive dirty dot ring resolves to a colour (${inactive.borderTopColor})`).toBe(true);

    // ---- Criterion 3: clean tab dot is not visible ----
    const clean = await measureDot(win, 1);
    expect(clean, 'the clean tab carries a reserved dot slot').toBeTruthy();
    console.log(`[P73 clean] visibility=${clean.visibility} opacity=${clean.opacity} class=${clean.className}`);
    expect(
      clean.visibility === 'hidden' || parseFloat(clean.opacity) === 0,
      `clean tab dot is hidden (visibility=${clean.visibility} opacity=${clean.opacity})`,
    ).toBe(true);

    // ---- Criterion 4/5: screenshots, light + dark, dirty + clean ----
    const shots = [];
    await switchTheme(win, 'light');
    shots.push(await captureZoomedTab(win, 0, 'phase73-dot-dirty-light.png'));
    shots.push(await captureZoomedTab(win, 1, 'phase73-dot-clean-light.png'));
    await switchTheme(win, 'dark');
    shots.push(await captureZoomedTab(win, 0, 'phase73-dot-dirty-dark.png'));
    shots.push(await captureZoomedTab(win, 1, 'phase73-dot-clean-dark.png'));
    await switchTheme(win, 'light');
    console.log(`[P73 shots] ${JSON.stringify(shots)}`);

    // ---- Criterion 5: squeezed widths (10 tabs and 20 tabs at the 640px minimum) ----
    const src = getSamplePath('report.pdf');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p73-more-'));
    const openMore = async (n) => {
      for (let i = 0; i < n; i += 1) {
        const p = path.join(tmp, `p73-${Date.now()}-${i}.pdf`);
        fs.copyFileSync(src, p);
        await openViaToolbar(app, win, p);
      }
    };
    const squeezeTo640 = async () => {
      await win.locator('[data-tab-id]').first().click();
      await win.waitForTimeout(400);
      await app.evaluate(({ BrowserWindow }) => {
        const target = BrowserWindow.getAllWindows()[0];
        if (!target) return;
        if (target.isMaximized()) target.unmaximize();
        target.setSize(640, 620);
      });
      await win.waitForTimeout(800);
    };
    const checkSqueezed = async (label, minTabs) => {
      const count = await win.evaluate(() => document.querySelectorAll('[data-tab-id]').length);
      expect(count, `${label}: tab count`).toBeGreaterThanOrEqual(minTabs);
      const widths = await win.evaluate(() => Array.from(document.querySelectorAll('[data-tab-id]')).map((t) => +t.getBoundingClientRect().width.toFixed(2)));
      console.log(`[P73 squeezed ${label}] tabWidths=${JSON.stringify(widths)}`);
      const squeezedTab = await measureDot(win, 0);
      expect(squeezedTab, `${label}: the dirty tab dot exists when squeezed`).toBeTruthy();
      assertContained(squeezedTab, label);
      expect(squeezedTab.offsetWidth, `${label}: squeezed dot offsetWidth`).toBe(5);
      expect(squeezedTab.offsetHeight, `${label}: squeezed dot offsetHeight`).toBe(5);
      expect(squeezedTab.boxShadow, `${label}: squeezed dot box-shadow is none`).toBe('none');
      const minWidth = Math.min(...widths);
      expect(minWidth, `${label}: the strip really squeezed the tabs below the 180px natural width`).toBeLessThan(180);
    };

    // 10 tabs (the ADV-143 first surface).
    await openMore(8);
    await win.waitForFunction(() => document.querySelectorAll('[data-tab-id]').length >= 10, null, { timeout: 60000 });
    await win.waitForTimeout(600);
    await squeezeTo640();
    await checkSqueezed('squeezed-10tabs-640', 10);

    // Push to 20 tabs at the same 640px minimum (ADV-143 second surface).
    await openMore(10);
    await win.waitForFunction(() => document.querySelectorAll('[data-tab-id]').length >= 20, null, { timeout: 90000 });
    await win.waitForTimeout(700);
    await squeezeTo640();
    await checkSqueezed('squeezed-20tabs-640', 20);
    console.log('[P73 DONE] full and squeezed dot contained; size 5px < 7px baseline');
  } finally {
    await hardClose(app, 'p73-dot');
  }
});
