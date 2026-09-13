// Phase 16 CONTROL-INDEX sweep (qa gate, 2026-09-13).
//
// Exercises every NEW Phase-16 control in the real dev build and asserts its
// promised state change (AGENTS.md "no control is a no-op" contract):
//
//   P16C-1  Header is icon-only (no "Pages" title text); collapse button
//           present with title "Collapse panel"; view-toggle icons
//           (thumbnails / annotations / bookmarks) still work while expanded.
//   P16C-2  Collapse button shrinks the rail to the 48px ruler strip; the
//           grid column tweens 220px -> 48px on the registered --tf-rail-w
//           token (Phase-15 motion token, 280ms). The SETTLED width is
//           asserted deterministically (ruler mounted, then 350ms past the
//           280ms token, one-shot read) - never from a rAF sample.
//   P16C-2b The tween itself is proven by rAF sampling mid-flight (a frame
//           strictly between 48 and 220), kept in its own test so a slow
//           React commit can never race a settled assertion.
//   P16C-3  Ruler numbers: one per page, no scrollbar chrome, current page
//           painted in the theme's ACCENT token + bold, plain numbers in the
//           theme text colour (probes compare resolved tokens, so it holds
//           in every theme).
//   P16C-4  Click-to-jump in the ruler navigates the workspace to the
//           clicked page; the accent highlight follows; page indicator
//           agrees.
//   P16C-5  The same control while collapsed is the EXPAND button
//           ("Expand panel"): one click restores the thumbnail rail, the
//           ruler strip detaches and the column re-tweens to 220px.
//   P16C-6  No-op sweep: every new control clicked TWICE (collapse/expand,
//           a ruler number, each view-toggle icon) - the app must stay
//           responsive and state must stay coherent (nothing hangs).
//   P16C-7  Theme matrix: ruler (collapsed) + expanded mode captured in
//           light / dark / frosted for visual judgment (screenshots), with
//           the accent highlight re-verified per theme.
//
// Each test launches its own DEV instance through the canonical launcher
// (e2e/lib/launch.cjs via launchDev). Serial by config (workers: 1).

const { test, expect } = require('@playwright/test');
const { launchDev, openSample, diag, shot, hardClose } = require('./lib/helpers.cjs');

// Set the theme through the UI (title-bar theme popover), the way a user
// would, and wait for data-theme + the 400ms crossfade to settle.
async function setTheme(window, want) {
  await window.click('[data-theme-toggle]');
  await window.click(`[data-theme-option="${want}"]`);
  await window.waitForFunction(
    (w) => document.documentElement.getAttribute('data-theme') === w,
    want,
    { timeout: 10000 },
  );
  await window.waitForTimeout(800); // 400ms crossfade token + settle
}

// Sample the workspace's first grid column (the rail column, resolved from
// --tf-rail-w) every animation frame for `ms` and resolve with the samples.
// Start BEFORE the triggering click to capture mid-tween frames.
function sampleRailColumn(window, ms) {
  return window.evaluate(
    (dur) =>
      new Promise((resolve) => {
        const out = [];
        const t0 = performance.now();
        const tick = () => {
          const ws = document.querySelector('.workspace');
          let w = null;
          if (ws) {
            const cols = getComputedStyle(ws).gridTemplateColumns.split(' ');
            w = parseFloat(cols[0]) || null;
          }
          out.push({ t: Math.round(performance.now() - t0), w });
          if (performance.now() - t0 < dur) requestAnimationFrame(tick);
          else resolve(out);
        };
        tick();
      }),
    ms,
  );
}

// Resolve var() tokens to the colour the page would paint with them, using a
// hidden probe element - theme-correct in whatever theme is active.
async function tokenColors(window) {
  return window.evaluate(() => {
    const probe = (v) => {
      const el = document.createElement('span');
      el.style.color = v;
      el.style.display = 'none';
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    };
    return {
      accent: probe('var(--accent)'),
      fgStrong: probe('var(--fg-strong)'),
    };
  });
}

// The app is "not hung" if the renderer still evaluates and the engine probe
// answers. This is the "nothing hangs" oracle for the no-op sweep.
async function assertResponsive(window, label) {
  const d = await window.evaluate(() => {
    const t = window.tflexDiagnostics ? window.tflexDiagnostics() : null;
    return { ready: document.readyState, pg: t ? t.pageCount : -1 };
  });
  expect(d.ready, `renderer responsive after: ${label}`).toBe('complete');
  return d;
}

async function openWorkspace() {
  const { electronApp, window } = await launchDev();
  await openSample(window, electronApp, 'report.pdf');
  const d0 = await window.evaluate(() => window.tflexDiagnostics());
  return { electronApp, window, pageCount: d0.pageCount };
}

test('P16C-1: icon-only header; view-toggle icons work while expanded', async () => {
  const { electronApp, window } = await openWorkspace();
  try {
    const header = window.locator('.rail-header');
    await header.waitFor({ timeout: 15000 });

    // Icon-only: no title span, no visible text anywhere in the header.
    expect(await window.locator('.rail-header .glass-sidebar-title').count()).toBe(0);
    const headerText = (await header.textContent().catch(() => null)) ?? '';
    expect(headerText.trim(), 'rail header must be icon-only').toBe('');

    // Collapse control exists with the expanded-state promise.
    const collapse = window.locator('[data-rail-collapse]');
    await collapse.waitFor({ timeout: 10000 });
    expect(await collapse.getAttribute('title')).toBe('Collapse panel');
    expect(await window.locator('[data-rail-ruler]').count()).toBe(0);

    // View-toggle icons (thumbnails / annotations / bookmarks) still work.
    const thumbsTab = window.locator('.rail-tab[title="Page thumbnails"]');
    const annTab = window.locator('[data-rail-tab="annotations"]');
    const bookmarksTab = window.locator('.rail-tab[title="Bookmarks"]');
    await expect(thumbsTab).toBeVisible();
    await expect(annTab).toBeVisible();
    const hasBookmarks = (await bookmarksTab.count()) > 0; // only with an outline

    await thumbsTab.click();
    await window.locator('.thumb-item').first().waitFor({ timeout: 15000 });

    // Annotations tab swaps the rail body to the annotations panel. The
    // swap is an AnimatePresence crossfade (280ms exit), so wait for the
    // outgoing thumbnail layer to fully detach before counting.
    await annTab.click();
    await window.locator('[data-annotation-panel]').waitFor({ timeout: 10000 });
    await window.locator('.thumb-item').first().waitFor({ state: 'detached', timeout: 5000 });
    expect(await window.locator('.thumb-item').count()).toBe(0);

    // Back to thumbnails.
    await thumbsTab.click();
    await window.locator('.thumb-item').first().waitFor({ timeout: 10000 });

    // Bookmarks tab only exists when the document has an outline.
    if (hasBookmarks) {
      await bookmarksTab.click();
      await window.locator('.outline-panel').waitFor({ timeout: 10000 });
      await thumbsTab.click();
      await window.locator('.thumb-item').first().waitFor({ timeout: 10000 });
    } else {
      console.log('[P16C-1] report.pdf has no outline - bookmarks tab correctly absent');
    }

    await shot(window, 'phase16-ctl-expanded-verify.png');
  } finally {
    await hardClose(electronApp);
  }
});

test('P16C-2: collapse button -> 48px ruler strip, settled on the registered token', async () => {
  const { electronApp, window } = await openWorkspace();
  try {
    const base = await window.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.workspace'));
      return {
        col1: parseFloat(cs.gridTemplateColumns.split(' ')[0]),
        hasRailTokenTransition: cs.transitionProperty.includes('--tf-rail-w'),
        trDuration: cs.transitionDuration,
        panelToken: getComputedStyle(document.documentElement)
          .getPropertyValue('--motion-duration-panel')
          .trim(),
      };
    });
    console.log(`[P16C-2] baseline: ${JSON.stringify(base)}`);
    expect(base.col1, 'rail column at rest is 220px').toBeCloseTo(220, 0);
    expect(
      base.hasRailTokenTransition,
      '.workspace must transition --tf-rail-w (registered token; no hardcoded duration)',
    ).toBe(true);
    // Computed styles normalize the token to seconds (".28s" == 280ms),
    // so parse seconds and convert to ms before comparing.
    const trMs = parseFloat(base.trDuration) * 1000;
    const tokenMs = parseFloat(base.panelToken) * 1000;
    expect(trMs, 'transition duration is the 280ms panel token').toBeCloseTo(280, 0);
    expect(tokenMs, '--motion-duration-panel must be 280ms').toBeCloseTo(280, 0);

    // Deterministic settle: wait for the ruler to mount, then outlast the
    // 280ms --motion-duration-panel transition and read the column width
    // exactly once. (The old rAF "last sample" raced React's render commit
    // and landed mid-tween ~92px, so it can never back a settled
    // assertion; mid-flight sampling lives in P16C-2b instead.)
    await window.locator('[data-rail-collapse]').click();
    await window.locator('[data-rail-ruler]').waitFor({ timeout: 10000 });
    await window.waitForTimeout(350); // 280ms transition + buffer
    await window.locator('.thumb-scroller').waitFor({ state: 'detached', timeout: 5000 });

    const col = await window.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns.split(' ')[0]),
    );
    expect(col, 'rail column settles at 48px').toBeCloseTo(48, 0);
    console.log(`[P16C-2] settled rail column: ${col}px`);

    // Strip geometry + separator border, no scrollbar chrome.
    const box = await window.locator('[data-rail-ruler]').boundingBox();
    expect(box.width, 'ruler strip width ~48px').toBeLessThanOrEqual(56);
    const sb = await window.evaluate(() => {
      const r = document.querySelector('.rail-ruler');
      const cs = getComputedStyle(r);
      const webkit = getComputedStyle(r, '::-webkit-scrollbar');
      return {
        scrollbarWidth: cs.scrollbarWidth,
        webkitWidth: webkit.width,
        webkitDisplay: webkit.display,
        railBorder: getComputedStyle(document.querySelector('.side-rail')).borderRightWidth,
      };
    });
    const noChrome = sb.scrollbarWidth === 'none' || sb.webkitWidth === '0px' || sb.webkitDisplay === 'none';
    expect(noChrome, `ruler strip must hide scrollbar chrome (got ${JSON.stringify(sb)})`).toBe(true);
    expect(sb.railBorder, 'ruler strip keeps its separator border').toBe('1px');

    // data-rail-collapsed is the state driver on .app-main.
    expect(await window.locator('.app-main[data-rail-collapsed="true"]').count()).toBe(1);
    await shot(window, 'phase16-ctl-collapsed-default.png');
  } finally {
    await hardClose(electronApp);
  }
});

test('P16C-2b: rail width tweens through intermediate frames (no snap)', async () => {
  const { electronApp, window } = await openWorkspace();
  try {
    // rAF sampling is fine HERE: this assertion only needs evidence that the
    // transition ran (some frame strictly between 48 and 220) - never the
    // settled value, which P16C-2 proves deterministically. Start the sampler
    // before the click so the 280ms tween fits inside the 500ms window.
    const samples = sampleRailColumn(window, 500);
    await window.locator('[data-rail-collapse]').click();
    const s = await samples;

    const mids = s.filter((x) => x.w !== null && x.w > 48.5 && x.w < 219.5);
    expect(mids.length, 'width must TWEEN 220->48 with intermediate frames, not snap').toBeGreaterThan(0);
    console.log(`[P16C-2b] mid-tween frames: ${JSON.stringify(mids.slice(0, 6))} ... total=${mids.length}`);
  } finally {
    await hardClose(electronApp);
  }
});

test('P16C-3: ruler numbers visible; current page in accent; plain numbers in text colour', async () => {
  const { electronApp, window } = await openWorkspace();
  try {
    const pageCount = (await window.evaluate(() => window.tflexDiagnostics())).pageCount;

    await window.locator('[data-rail-collapse]').click();
    await window.locator('[data-rail-ruler]').waitFor({ timeout: 10000 });
    await window.waitForTimeout(500); // swap crossfade + tween settle

    expect(await window.locator('[data-ruler-page]').count(), 'one ruler number per page').toBe(pageCount);

    const colors = await tokenColors(window);
    expect(colors.accent, 'accent token must resolve').not.toBe('');
    const probe = await window.evaluate(() => {
      const cur = document.querySelector('.rail-ruler-current');
      const plain = document.querySelector('.rail-ruler-page:not(.rail-ruler-current)');
      return {
        current: cur ? getComputedStyle(cur).color : null,
        plain: plain ? getComputedStyle(plain).color : null,
        curWeight: cur ? getComputedStyle(cur).fontWeight : null,
      };
    });
    expect(probe.current, 'current page number painted with the ACCENT token').toBe(colors.accent);
    expect(probe.plain, 'plain numbers sit in the theme text colour (fg-strong)').toBe(colors.fgStrong);
    expect(Number(probe.curWeight), 'current page number is bold').toBeGreaterThanOrEqual(600);
    console.log(`[P16C-3] accent=${colors.accent} current=${probe.current} plain=${probe.plain}`);

    await shot(window, 'phase16-ctl-ruler-highlight.png');
  } finally {
    await hardClose(electronApp);
  }
});

test('P16C-4: click-to-jump in the ruler navigates the workspace', async () => {
  const { electronApp, window } = await openWorkspace();
  try {
    const pageCount = (await window.evaluate(() => window.tflexDiagnostics())).pageCount;
    const target = Math.min(7, pageCount);

    await window.locator('[data-rail-collapse]').click();
    await window.locator('[data-rail-ruler]').waitFor({ timeout: 10000 });

    await window.locator(`[data-ruler-page="${target}"]`).click();
    await window.waitForFunction(
      (p) => window.tflexDiagnostics().currentPage === p,
      target,
      { timeout: 20000 },
    );
    await window.waitForFunction(
      (p) => {
        const el = document.querySelector('input.page-input');
        return el !== null && el.value === String(p);
      },
      target,
      { timeout: 10000 },
    );
    expect(await window.locator('input.page-input').inputValue()).toBe(String(target));

    expect(
      (await window.locator(`[data-ruler-page="${target}"]`).getAttribute('class')) || '',
      'jumped page carries the ruler highlight',
    ).toContain('rail-ruler-current');
    if (target !== 1) {
      expect(
        (await window.locator('[data-ruler-page="1"]').getAttribute('class')) || '',
        'page 1 loses the highlight',
      ).not.toContain('rail-ruler-current');
    }
    await shot(window, 'phase16-ctl-ruler-jump.png');
  } finally {
    await hardClose(electronApp);
  }
});

test('P16C-5: expand button on the ruler strip restores the thumbnail rail', async () => {
  const { electronApp, window } = await openWorkspace();
  try {
    await window.locator('[data-rail-collapse]').click();
    await window.locator('[data-rail-ruler]').waitFor({ timeout: 10000 });

    const expand = window.locator('[data-rail-collapse]');
    expect(await expand.getAttribute('title')).toBe('Expand panel');
    await expand.click();

    await window.locator('[data-rail-ruler]').waitFor({ state: 'detached', timeout: 5000 });
    expect(await window.locator('[data-rail-ruler]').count(), 'ruler strip must be gone').toBe(0);
    await window.locator('.thumb-item').first().waitFor({ timeout: 15000 });
    expect(await window.locator('[data-rail-collapse]').getAttribute('title')).toBe('Collapse panel');

    const col = await window.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns.split(' ')[0]),
    );
    expect(col, 'rail column restored to 220px').toBeCloseTo(220, 0);
    expect(await window.locator('.app-main[data-rail-collapsed="true"]').count()).toBe(0);

    await shot(window, 'phase16-ctl-expanded-restored.png');
  } finally {
    await hardClose(electronApp);
  }
});

test('P16C-6: no-op sweep - every new control double-clicked, nothing hangs', async () => {
  const { electronApp, window } = await openWorkspace();
  try {
    const settle = () => window.waitForTimeout(650); // past the 280ms tween + settle

    // 1. Collapse/expand control twice: collapse -> expand (net: expanded).
    await window.locator('[data-rail-collapse]').click();
    await window.locator('[data-rail-ruler]').waitFor({ timeout: 10000 });
    await settle();
    await assertResponsive(window, 'after collapse');
    await window.locator('[data-rail-collapse]').click(); // second click: expand
    await window.locator('.thumb-scroller').waitFor({ timeout: 10000 });
    await settle();
    await assertResponsive(window, 'after expand');
    console.log('[P16C-6] collapse/expand double-click: OK, responsive');

    // 2. While collapsed: double-click a ruler number (re-jump same page).
    await window.locator('[data-rail-collapse]').click();
    await window.locator('[data-rail-ruler]').waitFor({ timeout: 10000 });
    const num3 = window.locator('[data-ruler-page="3"]');
    await num3.click();
    await num3.click();
    await settle();
    await assertResponsive(window, 'after ruler double-click');
    const d = await window.evaluate(() => window.tflexDiagnostics());
    expect(d.currentPage, 'double-click on a ruler number lands on that page').toBe(3);
    console.log('[P16C-6] ruler number double-click: page', d.currentPage, ', responsive');

    // 3. Expand, then double-click each view-toggle icon.
    await window.locator('[data-rail-collapse]').click();
    await window.locator('.thumb-scroller').waitFor({ timeout: 10000 });
    const thumbsTab = window.locator('.rail-tab[title="Page thumbnails"]');
    await thumbsTab.click();
    await thumbsTab.click();
    const annTab = window.locator('[data-rail-tab="annotations"]');
    await annTab.click();
    await annTab.click();
    const bm = window.locator('.rail-tab[title="Bookmarks"]');
    if ((await bm.count()) > 0) {
      await bm.click();
      await bm.click();
      await thumbsTab.click();
    }
    await settle();
    await assertResponsive(window, 'after view-toggle double-clicks');
    const d2 = await window.evaluate(() => window.tflexDiagnostics());
    expect(d2.pageCount, 'engine state intact after the sweep').toBeGreaterThan(0);
    console.log('[P16C-6] view-toggle double-clicks: responsive, engine intact');

    await shot(window, 'phase16-ctl-noop-aftermath.png');
  } finally {
    await hardClose(electronApp);
  }
});

test('P16C-7: ruler (collapsed) + expanded captured in light / dark / frosted', async () => {
  const { electronApp, window } = await openWorkspace();
  try {
    for (const theme of ['light', 'dark', 'frosted']) {
      await setTheme(window, theme);

      // Expanded capture (thumbnails).
      await window.locator('.thumb-item').first().waitFor({ timeout: 15000 });
      await window.waitForTimeout(250);
      await shot(window, `phase16-ctl-expanded-${theme}.png`);

      // Collapse and capture the ruler mode.
      await window.locator('[data-rail-collapse]').click();
      await window.locator('[data-rail-ruler]').waitFor({ timeout: 10000 });
      await window.waitForTimeout(900); // 280ms tween + 400ms crossfade settle
      const check = await window.evaluate(() => {
        const cur = document.querySelector('.rail-ruler-current');
        const probe = document.createElement('span');
        probe.style.color = 'var(--accent)';
        probe.style.display = 'none';
        document.body.appendChild(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        return {
          current: cur ? getComputedStyle(cur).color : null,
          accent,
          theme: document.documentElement.getAttribute('data-theme'),
        };
      });
      expect(check.theme, `theme applied`).toBe(theme);
      expect(check.current, `current page stays accent-highlighted in ${theme}`).toBe(check.accent);
      console.log(`[P16C-7] ${theme}: current=${check.current} accent=${check.accent}`);
      await shot(window, `phase16-ctl-collapsed-${theme}.png`);

      // Expand again so the next theme starts from the thumbnail rail.
      await window.locator('[data-rail-collapse]').click();
      await window.locator('.thumb-scroller').waitFor({ timeout: 10000 });
    }
  } finally {
    await hardClose(electronApp);
  }
});