// Phase 95 (feature A) — REPRO-FIRST failing containment oracle for the dock
// edit-mode remove control.
//
// The assigned behaviour (user report TFL-523, driver TFL-531):
//   After entering edit mode, EVERY dock verb shows a `.action-dock-minus`
//   remove badge at `top:-5px; right:-5px` (styles.css:15838-15866). That badge
//   overhangs its verb by 5px on the top and right and, unlike the pen, was
//   never given a containment guarantee. This spec measures EVERY
//   `[data-dock-minus]` against the ACTIVE clipping ancestor for the current
//   rung (`[data-dock-scroll]` in the arrows lane, else `[data-action-dock]`)
//   and the window viewport at three points (supported minimum window size; a
//   typical size; maximum interface zoom/scale) plus the dock's arrows-lane
//   rung.
//
//   The oracle is the PARTIAL-CLIP contract (TFL-536): a badge PASSES when it is
//   EITHER fully contained inside the clip box AND the viewport (0.5px
//   sub-pixel tolerance, phase58_dock_edit.spec.cjs:59-79), OR does not
//   intersect the clip box at all (fully scrolled out of the lane / off the
//   dock - not visible, not the reported defect). A badge FAILS only when it
//   PARTIALLY intersects (some but not all of its rect is clipped), which is
//   exactly the user's "partially outside" defect. Every fully-visible badge
//   must additionally be hit-testable at its centre.
//
// On the CURRENT (unmodified) build this MUST FAIL: the lane's +5px top clip
// (`stripEscape.top=+5` for every badge) makes every badge partial, so the spec
// is the phase's repro (success criterion 1) and, after the Phase 95-B fix,
// becomes the recurrence oracle (criterion 4). It launches ONLY through the
// canonical `e2e/lib/launch.cjs` `launchApp` helper.
//
// The product exposes no user-facing interface-scale preference, so the
// "maximum interface zoom/scale" point is the interface zoom that a desktop UI
// must survive: Chromium page zoom applied to the window at 200%, which is the
// largest standard desktop display scale. `window.innerWidth`/`innerHeight` are
// read at measurement time, so the CSS-px viewport actually in force is what is
// asserted against.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

// This harness run exports ELECTRON_RUN_AS_NODE=1; launchApp spreads
// process.env, so Electron would exit as Node ("Process failed to launch!").
// Clear it before any launch (same environment adaptation other specs use).
delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const USER_DATA = path.join(os.tmpdir(), `tflex-p95-dockminus-${Date.now()}`);
const DOCK = '[data-action-dock]';
const MAX_INTERFACE_ZOOM = 2.0;

test.setTimeout(300000);

// Mirror of phase58's setWidth (:81-95) generalized to an explicit height so
// the minimum supported size (640x480) can be requested. Always un-maximizes
// first: a maximized window ignores setSize, which would silently defeat the
// point.
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
  console.log(`[P95] setSize(${w}x${h}) -> innerWidth=${inner.w} innerHeight=${inner.h}`);
}

// Apply interface zoom in the MAIN process (Chromium page zoom). This scales
// the whole renderer, dock included, and shrinks the CSS-px viewport exactly as
// a raised display scale does.
async function setInterfaceZoom(app, win, factor) {
  await app.evaluate(({ BrowserWindow }, z) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.webContents.setZoomFactor(z);
  }, factor);
  await win.waitForTimeout(700);
  const inner = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }));
  console.log(`[P95] interface zoom x${factor} -> innerWidth=${inner.w} innerHeight=${inner.h} dpr=${inner.dpr}`);
}

// Capture the whole window at the CURRENT interface zoom. Playwright's
// `page.screenshot()` mis-scales under Chromium page zoom: at interface zoom
// 2.0 (innerWidth 720x450, dpr 2) it writes a 720x450 PNG that is only the
// top-left quadrant of the 1440x900 device buffer, so the dock (CSS y=342,
// device y=684) never appears even though the DOM oracle measures it fully
// on-screen. Electron's `webContents.capturePage()` captures the real
// composited frame at the window's device scale, so the max-zoom evidence
// shows the same full window - dock included - that the zoom-1.0 captures
// already show. Returns the device-pixel size of the saved image.
async function captureWindow(app, outPath) {
  const shot = await app.evaluate(async ({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (!bw) return null;
    const image = await bw.webContents.capturePage();
    const size = image.getSize();
    return { width: size.width, height: size.height, data: image.toPNG().toString('base64') };
  });
  if (shot === null) {
    console.log(`[P95] capturePage ${path.basename(outPath)} FAILED (no window)`);
    return null;
  }
  fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
  console.log(`[P95] capturePage ${path.basename(outPath)} ${shot.width}x${shot.height}`);
  return { width: shot.width, height: shot.height };
}

async function openReport(win) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector(DOCK, { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function enterEditMode(win) {
  expect(await win.locator('[data-dock-edit-toggle]').count()).toBe(1);
  await win.locator('[data-dock-edit-toggle]').click();
  await win.waitForTimeout(400);
  expect(await win.locator(DOCK).getAttribute('data-dock-edit')).toBe('true');
}

// Measure EVERY rendered remove badge against the ACTIVE clipping ancestor for
// the current rung and the window viewport, and apply the PARTIAL-CLIP contract
// (TFL-536):
//   - the clip box is `[data-dock-scroll]` when the arrows lane is engaged,
//     otherwise `[data-action-dock]`; the viewport is the outer bound;
//   - a badge PASSES when it is EITHER fully contained inside the clip box AND
//     the viewport (same 0.5px tolerance penContainment uses), OR does not
//     intersect the clip box at all (fully scrolled out of the lane), because a
//     not-visible badge is not the reported defect;
//   - a badge FAILS only when it PARTIALLY intersects (some but not all of its
//     rect is clipped) - the user's "partially outside" defect.
// Every fully-visible (contained) badge must also be hit-testable at its centre.
async function minusContainment(win) {
  return win.evaluate(() => {
    const dock = document.querySelector('[data-action-dock]');
    if (dock === null) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const viewport = { left: 0, top: 0, right: vw, bottom: vh };

    // The active clipping ancestor for the current rung: the lane's scroll
    // strip when the arrows lane is engaged, otherwise the dock itself.
    const lane = dock.getAttribute('data-dock-arrows-lane') === 'true';
    const scroll = dock.querySelector('[data-dock-scroll]');
    const useScroll = lane && scroll !== null;
    const clipEl = useScroll ? scroll : dock;
    const clipName = useScroll ? '[data-dock-scroll]' : '[data-action-dock]';
    const cr = clipEl.getBoundingClientRect();
    const clip = { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom };

    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const escapes = (b, c) => ({
      left: +(c.left - b.left).toFixed(2),
      right: +(b.right - c.right).toFixed(2),
      top: +(c.top - b.top).toFixed(2),
      bottom: +(b.bottom - c.bottom).toFixed(2),
    });
    // Edges that escape a box beyond the 0.5px tolerance, as human strings.
    const outsideEdges = (b, c) => {
      const e = escapes(b, c);
      const out = [];
      if (e.left > 0.5) out.push(`left +${e.left}`);
      if (e.right > 0.5) out.push(`right +${e.right}`);
      if (e.top > 0.5) out.push(`top +${e.top}`);
      if (e.bottom > 0.5) out.push(`bottom +${e.bottom}`);
      return out;
    };
    const within = (b, c) =>
      b.left >= c.left - 0.5 && b.right <= c.right + 0.5 && b.top >= c.top - 0.5 && b.bottom <= c.bottom + 0.5;
    // Positive-area intersection; a <=0.5px touch counts as disjoint.
    const intersects = (b, c) =>
      Math.min(b.right, c.right) - Math.max(b.left, c.left) > 0.5 &&
      Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top) > 0.5;

    const badges = Array.from(document.querySelectorAll('[data-dock-minus]'));
    const rows = badges.map((badge) => {
      const id = badge.getAttribute('data-dock-minus') || '(unknown)';
      const b = rectOf(badge);
      const containedInClip = within(b, clip);
      const containedInViewport = within(b, viewport);
      const contained = containedInClip && containedInViewport;
      const disjointFromClip = !intersects(b, clip);
      const partial = !contained && !disjointFromClip;
      const row = {
        id,
        box: {
          left: +b.left.toFixed(2), top: +b.top.toFixed(2),
          right: +b.right.toFixed(2), bottom: +b.bottom.toFixed(2),
          width: +b.width.toFixed(2), height: +b.height.toFixed(2),
        },
        contained,
        disjointFromClip,
        partial,
        clipBoxEscape: escapes(b, clip),
        viewportEscape: escapes(b, viewport),
        clipOutsideEdges: outsideEdges(b, clip),
        viewportOutsideEdges: outsideEdges(b, viewport),
        hitTestable: null,
        hitTarget: null,
      };
      if (contained) {
        const cx = (b.left + b.right) / 2;
        const cy = (b.top + b.bottom) / 2;
        const hit = (cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight)
          ? document.elementFromPoint(cx, cy)
          : null;
        row.hitTestable = hit !== null && (hit === badge || badge.contains(hit));
        row.hitTarget = hit === null ? '(none)' : `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0] || ''}`;
      }
      return row;
    });

    const d = dock.getBoundingClientRect();
    return {
      viewport: { width: vw, height: vh, devicePixelRatio: window.devicePixelRatio },
      clip: {
        name: clipName,
        left: +cr.left.toFixed(2), top: +cr.top.toFixed(2),
        right: +cr.right.toFixed(2), bottom: +cr.bottom.toFixed(2),
        width: +cr.width.toFixed(2), height: +cr.height.toFixed(2),
      },
      dock: {
        left: +d.left.toFixed(2), top: +d.top.toFixed(2),
        right: +d.right.toFixed(2), bottom: +d.bottom.toFixed(2),
        width: +d.width.toFixed(2), height: +d.height.toFixed(2),
      },
      edit: dock.getAttribute('data-dock-edit'),
      lane: dock.getAttribute('data-dock-arrows-lane'),
      arrows: dock.getAttribute('data-dock-arrows'),
      iconOnly: dock.getAttribute('data-dock-icon-only'),
      badgeCount: rows.length,
      rows,
    };
  });
}

// Log a full measurement and return the offender lines for the PARTIAL-CLIP
// contract: each offender names the verb id, the clip box and the exact
// partially-overflowing edges in px (plus a clear signal when a fully-visible
// badge is not hit-testable at its centre).
function reportAndCollect(win, measurement, label) {
  const offenders = [];
  if (measurement === null) {
    console.log(`[P95 ${label}] NO DOCK`);
    return ['[no dock]'];
  }
  console.log(
    `[P95 ${label}] viewport=${measurement.viewport.width}x${measurement.viewport.height} dpr=${measurement.viewport.devicePixelRatio}` +
    ` dock=${JSON.stringify(measurement.dock)} clip=${measurement.clip.name}${JSON.stringify({ left: measurement.clip.left, top: measurement.clip.top, right: measurement.clip.right, bottom: measurement.clip.bottom })}` +
    ` edit=${measurement.edit} lane=${measurement.lane} arrows=${measurement.arrows} iconOnly=${measurement.iconOnly} badges=${measurement.badgeCount}`,
  );
  for (const row of measurement.rows) {
    console.log(
      `[P95 ${label}] badge=${row.id} box=${JSON.stringify(row.box)} contained=${row.contained} disjoint=${row.disjointFromClip} partial=${row.partial}` +
      ` clipEscape=${JSON.stringify(row.clipBoxEscape)} viewportEscape=${JSON.stringify(row.viewportEscape)}` +
      ` hitTestable=${row.hitTestable}${row.hitTarget === null ? '' : ` hitTarget=${row.hitTarget}`}`,
    );
    if (row.partial) {
      const edges = row.clipOutsideEdges.length ? row.clipOutsideEdges.join(', ') : row.viewportOutsideEdges.join(', ');
      offenders.push(`${label}: badge "${row.id}" PARTIALLY clipped by ${measurement.clip.name} on ${edges}`);
    } else if (row.contained && row.hitTestable === false) {
      offenders.push(`${label}: badge "${row.id}" fully visible in ${measurement.clip.name} but NOT hit-testable at centre (elementFromPoint -> ${row.hitTarget})`);
    }
  }
  return offenders;
}

test('every dock edit-mode remove badge is either fully visible or fully scrolled out - never partially clipped (minimum size, typical size, maximum interface zoom, arrows lane)', async () => {
  const app = await launchApp([], USER_DATA);
  const win = await app.firstWindow();
  const offenders = [];
  const softAssert = (label, pointOffenders) => {
    offenders.push(...pointOffenders);
    expect.soft(pointOffenders, `[${label}] every remove badge is fully contained (and hit-testable) or fully scrolled out - never partially clipped`).toEqual([]);
  };
  try {
    await openReport(win);
    await enterEditMode(win);

    // Point A — the supported minimum window size (src/main/window.ts: MIN 640x480).
    await setSize(app, win, 640, 480);
    const a = await minusContainment(win);
    await win.screenshot({ path: path.join(SHOTS, 'p95-minus-min-640.png') });
    softAssert('min-640x480', reportAndCollect(win, a, 'min-640x480'));

    // Point B — a typical size (the dock spec's 1440 rung).
    await setSize(app, win, 1440, 900);
    const b = await minusContainment(win);
    await win.screenshot({ path: path.join(SHOTS, 'p95-minus-typical-1440.png') });
    softAssert('typical-1440x900', reportAndCollect(win, b, 'typical-1440x900'));

    // Point C — the maximum interface zoom/scale (Chromium interface zoom 200%).
    // The DOM oracle below runs at this zoom; the capture must show the dock,
    // so use captureWindow (capturePage) instead of win.screenshot, which crops
    // the top-left quadrant under page zoom (see captureWindow).
    await setInterfaceZoom(app, win, MAX_INTERFACE_ZOOM);
    const c = await minusContainment(win);
    await captureWindow(app, path.join(SHOTS, 'p95-minus-zoom-2x.png'));
    softAssert('zoom-2x', reportAndCollect(win, c, 'zoom-2x'));
    await setInterfaceZoom(app, win, 1.0);

    // Point D — the dock's arrows lane ON (narrow rung that forces the scroll
    // strip), so the lane's clipping strip is covered too.
    await setSize(app, win, 700, 900);
    const d = await minusContainment(win);
    await win.screenshot({ path: path.join(SHOTS, 'p95-minus-lane-700.png') });
    softAssert('lane-700', reportAndCollect(win, d, 'lane-700'));

    // Point D-hover — re-run the SAME partial-clip contract while each visible
    // verb in the arrows lane is hovered. DEF-518: a hovered verb lifts
    // --motion-translate-micro (2px), which pushes its top:0 badge above the
    // lane scroller's overflow-y:auto clip box, so the badge becomes partially
    // clipped even though it is fully contained at rest. Every RESTING assertion
    // above is unchanged; this only adds the hovered-state measurement.
    const verbIds = await win.evaluate(() => {
      const dock = document.querySelector('[data-action-dock]');
      if (dock === null) return [];
      return Array.from(dock.querySelectorAll('[data-dock-verb]'))
        .filter((v) => {
          const r = v.getBoundingClientRect();
          const cs = getComputedStyle(v);
          return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
        })
        .map((v) => v.getAttribute('data-dock-verb'))
        .filter((id) => id !== null);
    });
    console.log(`[P95] lane-700 hover sweep over ${verbIds.length} visible verbs: ${verbIds.join(', ')}`);
    for (const verbId of verbIds) {
      await win.locator(`[data-dock-verb="${verbId}"]`).hover();
      await win.waitForTimeout(300);
      const hov = await minusContainment(win);
      const hoveredRow = hov === null ? null : hov.rows.find((r) => r.id === verbId);
      if (hoveredRow !== null && hov !== null) {
        console.log(
          `[P95 lane-700 hover ${verbId}] badgeTop=${hoveredRow.box.top} clipTop=${hov.clip.top}` +
          ` topEscape=${hoveredRow.clipBoxEscape.top} partial=${hoveredRow.partial}`,
        );
      }
      softAssert(`lane-700-hover-${verbId}`, reportAndCollect(win, hov, `lane-700-hover-${verbId}`));
    }

    console.log(`[P95] TOTAL OFFENDERS (${offenders.length}):\n${offenders.join('\n') || 'none'}`);
    expect(
      offenders,
      `every [data-dock-minus] must be EITHER fully contained (and hit-testable) inside its clipping ancestor AND the window viewport, OR fully scrolled out of it - never PARTIALLY clipped; offenders:\n${offenders.join('\n') || 'none'}`,
    ).toEqual([]);
  } finally {
    await hardClose(app, 'p95-dockminus');
  }
});
