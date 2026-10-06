// Phase 106 (chunk A) - focused QA verification of the Orbit Desk Home rebuild.
//
// Verifies the requested chunk-A behaviour in the real Electron app: the Orbit
// Desk shell mounts, the region is centred/fluid, the asymmetric 1.6:1 body
// splits Continue working (left) from Explore (right), the Phase-58 home-tool
// hooks and brand asset survive, and the empty states render. Captures the
// light/dark evidence screenshots. QA evidence only - nothing is committed.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setTheme(win, theme) {
  const cur = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (cur === theme) return;
  // The header theme toggle was removed by concurrent Phase-105/109 chrome
  // work, so the old `[data-theme-toggle]` trigger no longer exists. The live
  // theme stays purely attribute-driven (every theme rule keys on
  // `:root[data-theme=...]`), so flip the attribute directly for evidence
  // screenshots. The Home surface under test is CSS-only, so this exercises
  // the same paint path the removed control used.
  await win.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await win.waitForFunction(
    (t) => document.documentElement.getAttribute('data-theme') === t,
    theme,
    { timeout: 8000 },
  );
}

let app;
let win;
let pageErrors;

test.beforeEach(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  app = await launchApp([]);
  win = await app.firstWindow();
  pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  await win.waitForSelector('.welcome.orbit-desk', { timeout: 30000 });
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app);
});

test('chunk A - Orbit Desk shell, split, hooks, empty state', async () => {
  const probe = await win.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const inner = q('.orbit-desk-inner');
    const recents = q('[data-home-recents]');
    const explore = q('[data-home-explore]');
    const innerCs = inner ? getComputedStyle(inner) : null;
    return {
      shell: !!q('.welcome.orbit-desk'),
      inner: !!inner,
      innerMaxWidth: innerCs ? innerCs.maxWidth : null,
      innerPadding: innerCs ? innerCs.paddingTop : null,
      recents: !!recents,
      explore: !!explore,
      recentsW: recents ? Math.round(recents.getBoundingClientRect().width) : 0,
      exploreW: explore ? Math.round(explore.getBoundingClientRect().width) : 0,
      wordmark: q('.welcome-brand .brand-wordmark')?.textContent ?? null,
      fixedOpenPrimary:
        q('[data-home-tool="open"]')?.classList.contains('btn-primary') ?? false,
      editToggle: !!q('[data-home-edit-toggle]'),
      recentRows: document.querySelectorAll('[data-recent-row]').length,
      recentEmpty: q('[data-home-recents] .recent-empty')?.textContent ?? null,
      recentChipFormats: [...document.querySelectorAll('[data-recent-row] .doc-format')].map(
        (e) => e.getAttribute('data-source-format'),
      ),
      recentChipLabels: [...document.querySelectorAll('[data-recent-row] .doc-format')].map(
        (e) => e.textContent,
      ),
      recentRowTitles: [...document.querySelectorAll('[data-recent-row]')].map((r) =>
        r.getAttribute('title'),
      ),
      sampleCards: document.querySelectorAll('[data-sample-card]').length,
      sampleTasks: [...document.querySelectorAll('[data-sample-card]')].map((c) =>
        c.getAttribute('data-sample-task'),
      ),
    };
  });
  fs.writeFileSync(
    path.join(SHOTS, 'phase106-probe.json'),
    JSON.stringify(probe, null, 2),
  );

  expect(probe.shell).toBe(true);
  expect(probe.inner).toBe(true);
  expect(probe.innerMaxWidth).toBe('1120px');
  expect(probe.recents).toBe(true);
  expect(probe.explore).toBe(true);
  expect(probe.wordmark).toBe('Jovrel');
  expect(probe.fixedOpenPrimary).toBe(true);
  expect(probe.editToggle).toBe(true);
  // The profile is environment-dependent: assert the empty state only when no
  // recents exist, and source-format truth whenever rows are present.
  if (probe.recentRows === 0) {
    expect(probe.recentEmpty).toContain('No recent files yet.');
  } else {
    expect(probe.recentChipFormats.length).toBe(probe.recentRows);
    for (const fmt of probe.recentChipFormats) {
      expect(typeof fmt).toBe('string');
      expect(fmt.length).toBeGreaterThan(0);
    }
  }
  expect(probe.sampleCards).toBeGreaterThan(0);
  // Asymmetric 1.6:1 body - Continue working is the wider column.
  expect(probe.recentsW).toBeGreaterThan(probe.exploreW);

  const layout = await win.evaluate(() => {
    const body = document.querySelector('.welcome-body');
    const cs = body ? getComputedStyle(body) : null;
    return cs ? cs.gridTemplateColumns : null;
  });
  expect(layout).toBeTruthy();

  await setTheme(win, 'light');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, 'phase106-orbit-light.png') });

  await setTheme(win, 'dark');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, 'phase106-orbit-dark.png') });

  expect(pageErrors).toEqual([]);
});

test('chunk A - DEF-574 recent rows stack name over folder; DEF-575 sample subtitle uses a real middle dot', async () => {
  const probe = await win.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-recent-row]')];
    const stacked = rows.map((row) => {
      const text = row.querySelector('.recent-row-text');
      const name = row.querySelector('.doc-name');
      const path = row.querySelector('.doc-path');
      const cs = text ? getComputedStyle(text) : null;
      const nameRect = name ? name.getBoundingClientRect() : null;
      const pathRect = path ? path.getBoundingClientRect() : null;
      return {
        display: cs ? cs.display : null,
        flexDirection: cs ? cs.flexDirection : null,
        nameText: name ? name.textContent : '',
        pathText: path ? path.textContent : '',
        pathBelowName: !!(nameRect && pathRect && pathRect.top >= nameRect.bottom - 1),
      };
    });
    const subs = [...document.querySelectorAll('[data-sample-card] .sample-sub')].map((s) => ({
      text: s.textContent || '',
      hasMiddleDot: (s.textContent || '').includes('\u00b7'),
      hasLiteralEscape: (s.textContent || '').includes('\\u00b7'),
    }));
    return { rows, stacked, subs };
  });

  // DEF-575 - every sample subtitle shows the real middle dot, never the escape.
  expect(probe.subs.length).toBeGreaterThan(0);
  for (const sub of probe.subs) {
    expect(sub.hasMiddleDot).toBe(true);
    expect(sub.hasLiteralEscape).toBe(false);
  }

  // DEF-574 - each recent row stacks the basename over the folder shorthand.
  if (probe.rows.length > 0) {
    for (const row of probe.stacked) {
      expect(row.display).toBe('flex');
      expect(row.flexDirection).toBe('column');
      expect(row.pathBelowName).toBe(true);
      expect(row.nameText.length).toBeGreaterThan(0);
    }
  }

  await setTheme(win, 'light');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, 'phase106-def574-575-light.png') });
  await setTheme(win, 'dark');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, 'phase106-def574-575-dark.png') });

  expect(pageErrors).toEqual([]);
});
