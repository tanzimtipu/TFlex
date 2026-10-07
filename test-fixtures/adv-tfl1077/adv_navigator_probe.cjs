// TFL-1077 (Phase 111 adversary diff-pass) - reproduction probe for the
// navigator outline popover positioning and the outline horizontal overflow.
//
// TFL-1079 (qa fix-verify): the two CSS facts under test are now READ FROM THE
// PRODUCT SOURCE at run time instead of being hard-coded in the fixture, so the
// probe actually validates the shipped fix rather than a frozen copy of the bug:
//
//   - the `tf-anim-materialize` keyframe comes from
//     `src/renderer/styles/animations.css` (TFL-1078 ends it at `transform: none`);
//   - the `.outline-panel` rule comes from `src/renderer/styles.css` (TFL-1078
//     adds `overflow-x: hidden`);
//   - the depth-10 indent comes from `outlineIndent()` in
//     `src/renderer/components/SideRail.tsx` (TFL-1078 caps the depth).
//
//   P1  There is no longer a settled `transform` on the animated ancestor, so a
//       `position: fixed` child renders at its viewport coordinates and is not
//       offset by the ancestor origin nor clipped by it.
//   P2  `.outline-panel` no longer scrolls horizontally; a depth-10 row fits the
//       240px floor.
//
// TFL-1081 (fixture correction): the old P1 clipping assertion was
// `m.y + m.height > b.bottom`, a rect comparison that is TRUE for every source
// state — the fixture placed the menu below the ancestor bottom even with NO
// containing block, and `getBoundingClientRect()` ignores `overflow: hidden`
// clipping entirely, so the predicate could never pass and never detected the
// defect. It is replaced with a real clip probe: a viewport point that lies
// inside the REQUESTED menu rect and BELOW the animated ancestor's bottom edge
// must hit-test to #menu. When the ancestor establishes a containing block the
// fixed menu is offset into the ancestor's coordinate space and clipped by its
// `overflow: hidden`, so the same point hits the document instead.
//
// A negative control is rendered alongside P1: the TFL-1078-era keyframe that
// ends at `transform: none` with fill-mode both. Chromium still computes the
// identity matrix while it fills forwards, so that ancestor IS a containing
// block. `passed` requires the control to be flagged as defective, so the
// assertion is proven non-vacuous: it must fail on the bug and pass on the fix.
//
// Run: node test-fixtures/adv-tfl1077/adv_navigator_probe.cjs
// PASS: P1 bodyTransform "none", menuRendered == menuRequested,
//       clippedByAncestorBottom false (probe point hits #menu); the settled-
//       transform control must report bodyTransform != "none", anchored false,
//       clippedByAncestorBottom true; P2 overflowX "hidden", horizontalOverflow
//       false.

const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function extractKeyframe(css, name) {
  const start = css.indexOf(`@keyframes ${name}`);
  if (start === -1) throw new Error(`keyframe ${name} not found in source`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated keyframe ${name}`);
}

function extractRule(css, selector) {
  const match = css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{[^}]*\\}`));
  if (!match) throw new Error(`rule ${selector} not found in source`);
  return match[0];
}

function num(css, name) {
  const m = css.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
  if (!m) throw new Error(`constant ${name} not found in source`);
  return Number(m[1]);
}

const animationsCss = read('src/renderer/styles/animations.css');
const stylesCss = read('src/renderer/styles.css');
const sideRailTsx = read('src/renderer/components/SideRail.tsx');

const MATERIALIZE = extractKeyframe(animationsCss, 'tf-anim-materialize');
const OUTLINE_PANEL_RULE = extractRule(stylesCss, '.outline-panel');
const INDENT_BASE = num(sideRailTsx, 'OUTLINE_INDENT_BASE');
const INDENT_STEP = num(sideRailTsx, 'OUTLINE_INDENT_STEP');
const INDENT_MAX_DEPTH = num(sideRailTsx, 'OUTLINE_INDENT_MAX_DEPTH');
const DEPTH10_INDENT = INDENT_BASE + Math.min(10, INDENT_MAX_DEPTH) * INDENT_STEP;

function requirePlaywright() {
  return require(path.join(ROOT, 'node_modules', 'playwright-core'));
}

function findChromium() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!fs.existsSync(base)) return null;
  for (const entry of fs.readdirSync(base)) {
    if (entry.startsWith('chromium_headless_shell-')) {
      const exe = path.join(base, entry, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  for (const entry of fs.readdirSync(base)) {
    if (entry.startsWith('chromium-')) {
      const exe = path.join(base, entry, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

// Requested viewport coordinates of the fixed row menu. When the animated
// ancestor does not establish a containing block the menu must render at
// exactly these viewport coordinates. Its bottom edge deliberately extends
// BELOW the animated ancestor's bottom edge, so the ancestor's `overflow:
// hidden` would clip it if the ancestor ever became its containing block.
const MENU = { left: 100, top: 360, width: 180, height: 200 };

const P1_CSS = `
:root { --motion-duration-standard: 250ms; --motion-ease-enter: ease-out;
        --motion-opacity-hidden: 0; --motion-scale-enter: 0.96; }
body { margin: 0; }
#panel { position: relative; width: 280px; height: 400px; margin-left: 100px; margin-top: 92px; overflow: hidden; }
#body { position: relative; width: 100%; height: 100%; overflow: hidden;
        animation: __ANIM__ var(--motion-duration-standard) var(--motion-ease-enter) both; }
#row { position: absolute; top: 300px; left: 0; width: 200px; height: 44px; background: #eee; }
#menu { position: fixed; left: ${MENU.left}px; top: ${MENU.top}px; width: ${MENU.width}px; height: ${MENU.height}px; background: rgba(255,0,0,.4); }`;

function p1Html(keyframesCss) {
  return `<!doctype html><html><head><style>${keyframesCss}
${P1_CSS.replace('__ANIM__', 'tf-anim-materialize')}
</style></head><body>
<div id="panel"><div id="body"><div id="row"></div><div id="menu"></div></div></div>
</body></html>`;
}

const P1_HTML = p1Html(MATERIALIZE);

// Negative control: the TFL-1078-era keyframe that ended at `transform: none`
// with fill-mode both. Chromium still computes the identity matrix while it
// fills forwards, so the ancestor DOES become a containing block and the fixed
// menu is offset + clipped. P1's assertions must fail on this state.
const MATERIALIZE_SETTLED_TRANSFORM = `@keyframes tf-anim-materialize {
  from { opacity: var(--motion-opacity-hidden); transform: scale(var(--motion-scale-enter)); }
  to   { opacity: var(--motion-opacity-visible); transform: none; }
}`;
const P1_CONTROL_HTML = p1Html(MATERIALIZE_SETTLED_TRANSFORM);

const P2_HTML = `<!doctype html><html><head><style>
* { box-sizing: border-box; }
:root { --sp-2: 8px; }
body { margin: 0; }
.panel { position: relative; width: 240px; height: 300px; }
${OUTLINE_PANEL_RULE}
.outline-list { list-style: none; margin: 0; padding: 0; }
.outline-row { display: flex; align-items: center; gap: 2px; padding-right: 8px; min-height: 44px; font-size: 13px; }
.toggle { width: 18px; height: 22px; flex-shrink: 0; }
.link { flex: 1 1 auto; min-width: 0; overflow: hidden; }
.page { flex: 0 0 32px; width: 32px; }
.more { flex: 0 0 auto; width: 32px; height: 32px; }
</style></head><body>
<div class="panel"><div class="outline-panel" id="op"><ul class="outline-list">
<li><div class="outline-row" style="padding-left:${DEPTH10_INDENT}px"><span class="toggle"></span><span class="link">Deeply nested bookmark title</span><span class="page">9</span><span class="more">M</span></div></li>
</ul></div></div>
</body></html>`;

(async () => {
  const { chromium } = requirePlaywright();
  const exe = findChromium();
  if (exe === null) throw new Error('no Playwright Chromium found under %LOCALAPPDATA%/ms-playwright');
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });

    const readP1 = (menu) => {
      const body = document.getElementById('body');
      const el = document.getElementById('menu');
      const b = body.getBoundingClientRect();
      const m = el.getBoundingClientRect();
      const probeX = menu.left + menu.width / 2;
      const probeY = b.bottom + 40;
      const hit = document.elementFromPoint(probeX, probeY);
      const hitId = hit ? (hit.id || hit.tagName) : null;
      return {
        bodyTransform: getComputedStyle(body).transform,
        bodyOrigin: { x: b.x, y: b.y },
        menuRendered: { x: m.x, y: m.y },
        menuRequested: { left: menu.left, top: menu.top },
        menuOffsetFromAncestor: { x: m.x - b.x, y: m.y - b.y },
        clipProbePoint: { x: probeX, y: probeY },
        clipProbeHit: hitId,
        clippedByAncestorBottom: hitId !== 'menu',
        anchoredToViewport: Math.abs(m.x - menu.left) < 0.5 && Math.abs(m.y - menu.top) < 0.5,
      };
    };

    await page.setContent(P1_HTML, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const p1 = await page.evaluate(readP1, MENU);

    await page.setContent(P1_CONTROL_HTML, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const p1Control = await page.evaluate(readP1, MENU);

    await page.setContent(P2_HTML, { waitUntil: 'load' });
    const p2 = await page.evaluate(() => {
      const op = document.getElementById('op');
      const cs = getComputedStyle(op);
      return {
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
        scrollWidth: op.scrollWidth,
        clientWidth: op.clientWidth,
        horizontalOverflow: op.scrollWidth > op.clientWidth,
      };
    });

    const p1Ok = p1.bodyTransform === 'none'
      && p1.anchoredToViewport
      && p1.clippedByAncestorBottom === false;
    const p1ControlOk = p1Control.bodyTransform !== 'none'
      && p1Control.anchoredToViewport === false
      && p1Control.clippedByAncestorBottom === true;
    const p2Ok = p2.overflowX === 'hidden' && p2.horizontalOverflow === false;
    const passed = p1Ok && p1ControlOk && p2Ok;
    console.log(JSON.stringify({
      source: { materialize: MATERIALIZE.replace(/\s+/g, ' ').trim(), outlinePanel: OUTLINE_PANEL_RULE.replace(/\s+/g, ' ').trim(), depth10Indent: DEPTH10_INDENT },
      P1_fixedMenuInAnimatedAncestor: p1,
      P1_negativeControl_settledTransform: p1Control,
      P2_outlineOverflowX: p2,
      checks: { p1Ok, p1ControlOk, p2Ok },
      passed,
    }, null, 2));
    if (!passed) process.exitCode = 2;
  } finally {
    await browser.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
