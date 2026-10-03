// Phase 95-C (item 3) — focused containment oracle for the HOME tool row's
// edit-mode remove badge, the one additional same-class occurrence the TFL-537
// sweep reported (`.home-tool-minus` at `top:-6px; right:-6px`, living inside
// `.welcome` which is `overflow:hidden`).
//
// The assigned question: is every `[data-home-minus]` either FULLY contained in
// its clipping containers and the viewport, or FULLY disjoint from them - never
// PARTIALLY clipped? Same PARTIAL-CLIP contract as the dock oracle
// (e2e/phase95_dock_edit_overflow.spec.cjs:99-247):
//   - PASS when fully contained against the clip box AND the viewport (0.5px
//     sub-pixel tolerance), OR does not intersect the clip box at all;
//   - FAIL only when it PARTIALLY intersects (some but not all of its rect is
//     clipped) - the reported overhang defect.
// A fully-visible badge must additionally be hit-testable at its centre.
//
// It measures against the two named containers (`.welcome`, `.home-tools`) and
// the window viewport, but classifies a container as a real CLIPPER only when
// its computed `overflow` is not `visible`. `.home-tools` is `position:relative`
// with default visible overflow, so it cannot clip; `.welcome` is
// `overflow:hidden` (styles.css:2970-2976) and is the meaningful clip box.
// Non-clipper overhang is reported as informational, never as a defect.
//
// Launches ONLY through the canonical `e2e/lib/launch.cjs` `launchApp` helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

// The harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads process.env, so
// Electron would exit as Node. Clear it before any launch.
delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const USER_DATA = path.join(os.tmpdir(), `tflex-p95-home-tools-${Date.now()}`);

test.setTimeout(240000);

// Same sizing helper as the dock oracle: un-maximize first, request the size,
// then read the CSS-px viewport actually in force.
async function setSize(app, win, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (!bw) return;
    if (bw.isMaximized()) bw.unmaximize();
    bw.setSize(s[0], s[1]);
  }, [w, h]);
  await win.waitForTimeout(700);
  await win.waitForFunction((t) => Math.abs(window.innerWidth - t) < 40, w, { timeout: 10000 }).catch(() => {});
  const inner = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  console.log(`[P95H] setSize(${w}x${h}) -> innerWidth=${inner.w} innerHeight=${inner.h}`);
}

// Arm home edit mode from the Welcome screen and confirm the row reports it.
async function enterHomeEditMode(win) {
  await win.waitForSelector('.welcome', { timeout: 30000 });
  await win.waitForSelector('[data-home-tools]', { timeout: 30000 });
  expect(await win.locator('[data-home-edit-toggle]').count()).toBe(1);
  await win.locator('[data-home-edit-toggle]').click();
  await win.waitForTimeout(400);
  expect(await win.locator('[data-home-tools]').getAttribute('data-home-edit')).toBe('true');
}

// Measure EVERY rendered home remove badge against `.welcome`, `.home-tools` and
// the window viewport; apply the PARTIAL-CLIP contract with the real-clipper
// refinement described in the header.
async function homeMinusContainment(win) {
  return win.evaluate(() => {
    const welcome = document.querySelector('.welcome');
    const tools = document.querySelector('[data-home-tools]');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const viewport = { left: 0, top: 0, right: vw, bottom: vh };

    const rectEl = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const within = (b, c) =>
      b.left >= c.left - 0.5 && b.right <= c.right + 0.5 && b.top >= c.top - 0.5 && b.bottom <= c.bottom + 0.5;
    const intersects = (b, c) =>
      Math.min(b.right, c.right) - Math.max(b.left, c.left) > 0.5 &&
      Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top) > 0.5;
    const escapes = (b, c) => ({
      left: +(c.left - b.left).toFixed(2),
      right: +(b.right - c.right).toFixed(2),
      top: +(c.top - b.top).toFixed(2),
      bottom: +(b.bottom - c.bottom).toFixed(2),
    });
    const clips = (el) => {
      if (el === null) return false;
      const s = getComputedStyle(el);
      return s.overflowX !== 'visible' || s.overflowY !== 'visible';
    };
    const classify = (b, box) => {
      const c = rectEl(box.el);
      const contained = within(b, c);
      const disjoint = !intersects(b, c);
      return {
        name: box.name,
        clips: box.clips,
        contained,
        disjoint,
        partial: !contained && !disjoint,
        esc: escapes(b, c),
      };
    };

    const welcomeBox = welcome ? { name: '.welcome', el: welcome, clips: clips(welcome) } : null;
    const toolsBox = tools ? { name: '.home-tools', el: tools, clips: clips(tools) } : null;

    const badges = Array.from(document.querySelectorAll('[data-home-minus]'));
    const rows = badges.map((badge) => {
      const id = badge.getAttribute('data-home-minus') || '(unknown)';
      const b = rectEl(badge);
      const per = [];
      if (welcomeBox) per.push(classify(b, welcomeBox));
      if (toolsBox) per.push(classify(b, toolsBox));

      const vContained = within(b, viewport);
      const vDisjoint = !intersects(b, viewport);
      const vPartial = !vContained && !vDisjoint;

      // A badge is really clipped only by a genuine clipper (or the viewport)
      // when its rect PARTIALLY overlaps that box.
      let clipped = vPartial;
      for (const box of per) if (box.clips && box.partial) clipped = true;

      // Fully visible = contained in every real clipper and the viewport.
      let visible = vContained;
      for (const box of per) if (box.clips && !box.contained) visible = false;

      let hitTestable = null;
      let hitTarget = null;
      if (visible) {
        const cx = (b.left + b.right) / 2;
        const cy = (b.top + b.bottom) / 2;
        const hit = (cx >= 0 && cy >= 0 && cx <= vw && cy <= vh) ? document.elementFromPoint(cx, cy) : null;
        hitTestable = hit !== null && (hit === badge || badge.contains(hit));
        hitTarget = hit === null ? '(none)' : `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0] || ''}`;
      }

      return {
        id,
        box: {
          left: +b.left.toFixed(2), top: +b.top.toFixed(2),
          right: +b.right.toFixed(2), bottom: +b.bottom.toFixed(2),
          width: +b.width.toFixed(2), height: +b.height.toFixed(2),
        },
        per,
        viewport: { contained: vContained, disjoint: vDisjoint, partial: vPartial, esc: escapes(b, viewport) },
        clipped,
        visible,
        hitTestable,
        hitTarget,
      };
    });

    return {
      viewport: { width: vw, height: vh, devicePixelRatio: window.devicePixelRatio },
      welcome: welcome ? Object.assign({ name: '.welcome', clips: welcomeBox.clips }, rectEl(welcome)) : null,
      tools: tools ? Object.assign({ name: '.home-tools', clips: toolsBox.clips }, rectEl(tools)) : null,
      edit: tools ? tools.getAttribute('data-home-edit') : null,
      badgeCount: rows.length,
      rows,
    };
  });
}

// Log a full measurement and return the offender lines for the PARTIAL-CLIP
// contract (real clippers + viewport only).
function reportAndCollect(measurement, label) {
  const offenders = [];
  if (measurement === null) {
    console.log(`[P95H ${label}] NO HOME ROW`);
    return ['[no home row]'];
  }
  console.log(
    `[P95H ${label}] viewport=${measurement.viewport.width}x${measurement.viewport.height} dpr=${measurement.viewport.devicePixelRatio}` +
    ` welcome=${JSON.stringify(measurement.welcome)} tools=${JSON.stringify(measurement.tools)} edit=${measurement.edit} badges=${measurement.badgeCount}`,
  );
  for (const row of measurement.rows) {
    const perStr = row.per
      .map((p) => `${p.name}(clips=${p.clips}) contained=${p.contained} disjoint=${p.disjoint} partial=${p.partial} esc=${JSON.stringify(p.esc)}`)
      .join(' | ');
    console.log(
      `[P95H ${label}] badge=${row.id} box=${JSON.stringify(row.box)} ${perStr}` +
      ` viewport(contained=${row.viewport.contained} disjoint=${row.viewport.disjoint} partial=${row.viewport.partial})` +
      ` clipped=${row.clipped} visible=${row.visible} hitTestable=${row.hitTestable}` +
      `${row.hitTarget === null ? '' : ` hitTarget=${row.hitTarget}`}`,
    );
    if (row.clipped) {
      const partials = row.per.filter((p) => p.clips && p.partial).map((p) => `${p.name} ${JSON.stringify(p.esc)}`);
      if (row.viewport.partial) partials.push(`viewport ${JSON.stringify(row.viewport.esc)}`);
      offenders.push(`${label}: badge "${row.id}" PARTIALLY clipped on ${partials.join(', ') || '(unknown)'}`);
    } else if (row.visible && row.hitTestable === false) {
      offenders.push(`${label}: badge "${row.id}" fully visible but NOT hit-testable at centre (elementFromPoint -> ${row.hitTarget})`);
    }
  }
  return offenders;
}

test('every home edit-mode remove badge is either fully contained or fully disjoint - never partially clipped (minimum size, typical size)', async () => {
  const app = await launchApp([], USER_DATA);
  const win = await app.firstWindow();
  const offenders = [];
  const softAssert = (label, pointOffenders) => {
    offenders.push(...pointOffenders);
    expect.soft(pointOffenders, `[${label}] every [data-home-minus] is fully contained (and hit-testable) or fully disjoint - never partially clipped`).toEqual([]);
  };
  try {
    await enterHomeEditMode(win);

    // Point A - the supported minimum window size (src/main/window.ts: MIN 640x480).
    await setSize(app, win, 640, 480);
    const a = await homeMinusContainment(win);
    await win.screenshot({ path: path.join(SHOTS, 'p95-home-edit-min-640.png') });
    softAssert('home-min-640x480', reportAndCollect(a, 'home-min-640x480'));

    // Point B - a typical size.
    await setSize(app, win, 1440, 900);
    const b = await homeMinusContainment(win);
    await win.screenshot({ path: path.join(SHOTS, 'p95-home-edit-typical-1440.png') });
    softAssert('home-typical-1440x900', reportAndCollect(b, 'home-typical-1440x900'));

    console.log(`[P95H] TOTAL OFFENDERS (${offenders.length}):\n${offenders.join('\n') || 'none'}`);
    expect(
      offenders,
      `every [data-home-minus] must be EITHER fully contained (and hit-testable) inside its real clipping container and the window viewport, OR fully disjoint from it - never PARTIALLY clipped; offenders:\n${offenders.join('\n') || 'none'}`,
    ).toEqual([]);
  } finally {
    await hardClose(app, 'p95-home-tools');
  }
});
