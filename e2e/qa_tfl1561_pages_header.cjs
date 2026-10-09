// QA verification harness for TFL-1603 (verifies TFL-1561 / TFL-1582).
// Focused verification of the Pages context-panel header action buttons:
// icon+label, equal sizing, panel responsiveness, theme legibility.
// Run-by-hand node harness (not a vitest/playwright spec):
//   node e2e/qa_tfl1561_pages_header.cjs
// Launches the dev build through the canonical e2e launcher (read-only import).
const path = require('node:path');
const REPO = path.resolve(__dirname, '..');
const { launchApp } = require(path.join(REPO, 'e2e', 'lib', 'launch.cjs'));
const {
  openSample,
  ensurePanelExpanded,
  setTheme,
  hardClose,
} = require(path.join(REPO, 'e2e', 'lib', 'helpers.cjs'));

const SHOTS = path.join(REPO, 'screenshots');
const HOOKS = [
  '[data-context-panel-layout-split]',
  '[data-context-panel-combine]',
  '[data-blank-scan-open]',
];
const EXPECTED = { '[data-context-panel-layout-split]': 'Layout' };
const log = (label, obj) => console.log(`[TFL1561|${label}] ${JSON.stringify(obj)}`);

async function measure(win) {
  return win.evaluate((hooks) => {
    const panel = document.querySelector('.context-panel');
    const group = document.querySelector('.context-panel-page-actions');
    const header = document.querySelector('.context-panel-header');
    const chevron = document.querySelector('.context-panel-header [data-rail-collapse]');
    const hb = header ? header.getBoundingClientRect() : null;
    const gb = group ? group.getBoundingClientRect() : null;
    const cb = chevron ? chevron.getBoundingClientRect() : null;
    const buttons = hooks.map((s) => {
      const el = document.querySelector(s);
      if (!el) return { hook: s, present: false };
      const r = el.getBoundingClientRect();
      const label = el.querySelector('.context-panel-page-action-label');
      let clippedBy = null;
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const nr = n.getBoundingClientRect();
        if (r.right > nr.right + 1 || r.left < nr.left - 1) {
          clippedBy = `${n.className || n.tagName}:${Math.round(nr.left)}-${Math.round(nr.right)}`;
          break;
        }
      }
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const hit = document.elementFromPoint(cx, cy);
      const topmost = hit ? (el.contains(hit) || el === hit) : false;
      return {
        hook: s,
        present: true,
        text: (el.textContent || '').trim(),
        hasIcon: !!el.querySelector('svg'),
        width: Math.round(r.width),
        height: Math.round(r.height),
        left: Math.round(r.left),
        right: Math.round(r.right),
        clippedBy,
        topmostAtCenter: topmost,
        hitEl: hit ? `${hit.tagName}.${hit.className || ''}|${(hit.getAttribute && hit.getAttribute('data-context-panel-close')) || ''}` : null,
        labelTruncated: label ? label.scrollWidth > label.clientWidth + 1 : false,
        labelVisible: label ? label.getBoundingClientRect().width > 0 : false,
      };
    });
    return {
      panelW: panel ? Math.round(panel.getBoundingClientRect().width) : null,
      rows: group
        ? new Set([...group.children].map((c) => c.getBoundingClientRect().top)).size
        : null,
      headerOverflow: header ? getComputedStyle(header).overflow : null,
      headerClientW: header ? header.clientWidth : null,
      headerScrollW: header ? header.scrollWidth : null,
      header: hb ? { l: Math.round(hb.left), r: Math.round(hb.right) } : null,
      group: gb ? { l: Math.round(gb.left), r: Math.round(gb.right) } : null,
      chevronPresent: !!cb,
      groupOverflowsHeader: hb && gb ? Math.round(gb.right) > Math.round(hb.right) + 1 : null,
      groupLeftClipped: hb && gb ? Math.round(gb.left) < Math.round(hb.left) - 1 : null,
      chevronClipped: hb && cb ? Math.round(cb.right) > Math.round(hb.right) + 1 : null,
      buttons,
    };
  }, HOOKS);
}

async function resizeViaHandle(win, key) {
  const handle = win.locator('[data-testid="panel-resize-left"]');
  await handle.focus();
  await handle.press(key);
  await win.waitForTimeout(500);
}

function evaluateCriteria(m) {
  const out = { ok: true, issues: [] };
  const fail = (s) => { out.ok = false; out.issues.push(s); };
  const present = m.buttons.filter((b) => b.present);
  if (present.length !== 3) fail(`expected 3 buttons, found ${present.length}`);
  for (const b of m.buttons) {
    if (!b.present) { fail(`missing button ${b.hook}`); continue; }
    if (!b.hasIcon) fail(`button ${b.hook} has no icon`);
    if (!b.labelVisible) fail(`button ${b.hook} label not visible`);
    if (b.labelTruncated) fail(`button ${b.hook} label truncated`);
    if (b.clippedBy) fail(`button ${b.hook} clipped by ancestor ${b.clippedBy}`);
    if (b.topmostAtCenter === false) fail(`button ${b.hook} not topmost at center`);
  }
  if (present.length === 3) {
    const ws = present.map((b) => b.width);
    const hs = present.map((b) => b.height);
    if (Math.max(...ws) - Math.min(...ws) > 1) fail(`unequal widths ${ws.join(',')}`);
    if (Math.max(...hs) - Math.min(...hs) > 1) fail(`unequal heights ${hs.join(',')}`);
  }
  if (m.groupOverflowsHeader) fail('button group overflows header (right)');
  if (m.groupLeftClipped) fail('button group clipped at header left');
  if (m.chevronClipped) fail('collapse chevron clipped');
  if (!m.chevronPresent) fail('collapse chevron missing');
  return out;
}

async function capture(win, theme, widthLabel, name, resizeKey) {
  if (resizeKey) await resizeViaHandle(win, resizeKey);
  await setTheme(win, theme);
  await win.waitForTimeout(500);
  const m = await measure(win);
  const verdict = evaluateCriteria(m);
  await win.locator('.context-panel-header').screenshot({ path: path.join(SHOTS, name) });
  await win.screenshot({ path: path.join(SHOTS, name.replace('.png', '-window.png')) });
  log(`${theme}-${widthLabel}`, { ...m, verdict });
  return verdict;
}

async function hoverActiveEvidence(win) {
  const combine = win.locator('[data-context-panel-combine]');
  const layout = win.locator('[data-context-panel-layout-split]');
  const styleOf = (loc, prop) =>
    loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  const idle = await styleOf(combine, 'background-color');
  await combine.hover();
  await win.waitForTimeout(250);
  const hover = await styleOf(combine, 'background-color');
  await win.locator('.context-panel-header').screenshot({
    path: path.join(SHOTS, 'qa-tfl1561-header-dark-280-hover.png'),
  });
  const layoutPressed = await layout.getAttribute('aria-pressed');
  const layoutBg = await styleOf(layout, 'background-color');
  const combineBg = await styleOf(combine, 'background-color');
  await layout.click();
  await win.waitForTimeout(400);
  const pressedAfterClick = await layout.getAttribute('aria-pressed');
  const layoutBgPressed = await styleOf(layout, 'background-color');
  await win.locator('.context-panel-header').screenshot({
    path: path.join(SHOTS, 'qa-tfl1561-header-dark-280-active.png'),
  });
  await layout.click();
  await win.waitForTimeout(400);
  const result = {
    combineIdleBg: idle,
    combineHoverBg: hover,
    hoverChangesBackground: idle !== hover,
    layoutAriaPressed: layoutPressed,
    layoutBg,
    combineBg,
    pressedAfterClick,
    togglesPressed: pressedAfterClick !== layoutPressed,
    layoutBgPressed,
    activeChangesBackground: layoutBgPressed !== layoutBg,
  };
  log('interaction', result);
  return result.hoverChangesBackground;
}

async function main() {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  try {
    await openSample(win, 'report.pdf');
  } catch (error) {
    log('openSample', { fallback: String(error && error.message) });
    await openSample(win);
  }
  await win.waitForTimeout(800);
  await ensurePanelExpanded(win);
  await win.waitForSelector('[data-context-panel-layout-split]', { timeout: 15000 });
  await win.waitForTimeout(300);

  const results = {};
  results['dark-280'] = await capture(win, 'dark', 280, 'qa-tfl1561-header-dark-280.png');
  await hoverActiveEvidence(win);
  results['light-280'] = await capture(win, 'light', 280, 'qa-tfl1561-header-light-280.png');
  results['dark-240'] = await capture(win, 'dark', 240, 'qa-tfl1561-header-dark-240.png', 'Home');
  results['dark-420'] = await capture(win, 'dark', 420, 'qa-tfl1561-header-dark-420.png', 'End');

  const allOk = Object.values(results).every((r) => r.ok);
  log('SUMMARY', { allOk, perWidth: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.ok])) });
  await hardClose(app);
  if (!allOk) process.exitCode = 1;
}

main().catch((error) => {
  console.error('TFL1561 harness failed:', error);
  process.exitCode = 1;
});
