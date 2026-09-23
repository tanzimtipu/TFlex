// Phase 36 (chunk 1) gate (qa) — the two new settings fields plus the
// tolerated legacy key, in the RUNNING app. Launches only through the canonical
// launchApp helper. No screenshots.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

function makeProfile(label, settings) {
  const dir = path.join(os.tmpdir(), `tflex-e2e-p36-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings), 'utf8');
  return dir;
}

// Boot with a seeded profile, force a settings SAVE (theme pick), read the
// persisted file back after the app is closed.
async function bootSaveRead(label, seed) {
  const userDataDir = makeProfile(label, seed);
  const app = await launchApp([], userDataDir);
  let booted = false;
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    booted = true;
    await win.click('[data-theme-toggle]');
    await win.click('[data-theme-option="dark"]');
    const file = path.join(userDataDir, 'settings.json');
    const start = Date.now();
    while (Date.now() - start < 15000) {
      try {
        if (JSON.parse(fs.readFileSync(file, 'utf8')).theme === 'dark') break;
      } catch { /* not written yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }
  } finally {
    await hardClose(app, `p36-settings-${label}`);
  }
  const stored = JSON.parse(fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8'));
  return { booted, stored };
}

test.setTimeout(240000);

test('P36-C1 settings: valid dockPins + toolUsage + legacy key survive a save', async () => {
  const { booted, stored } = await bootSaveRead('valid', {
    theme: 'light',
    optimizePreset: 'compact',
    toolsPaletteLayout: 'grid',
    dockPins: ['merge', 'split'],
    toolUsage: { merge: 5, split: 2 },
  });
  expect(booted, 'app must boot with the seeded settings').toBe(true);
  console.log(`[p36-settings-valid] ${JSON.stringify(stored)}`);
  expect(stored.theme).toBe('dark'); // the save landed
  expect(stored.toolsPaletteLayout, 'legacy key tolerated through a save').toBe('grid');
  expect(stored.dockPins).toEqual(['merge', 'split']);
  expect(stored.toolUsage).toEqual({ merge: 5, split: 2 });
  expect(stored.optimizePreset).toBe('compact'); // unrelated field preserved
});

test('P36-C1 settings: over-long dockPins truncate, bad entries drop, bad usage drops', async () => {
  const { booted, stored } = await bootSaveRead('malformed', {
    theme: 'light',
    toolsPaletteLayout: 'list',
    dockPins: ['merge', 9, 'split', '', 'extract', 'rotate', 'delete', 'insertPages', 'cropPages'],
    toolUsage: { merge: 3, split: -1, extract: 'x', crop: 2.5, rotate: 0 },
  });
  expect(booted, 'app must still boot with malformed values').toBe(true);
  console.log(`[p36-settings-malformed] ${JSON.stringify(stored)}`);
  expect(stored.dockPins, 'non-strings/empty drop, dedupe, truncate to 4').toEqual([
    'merge', 'split', 'extract', 'rotate',
  ]);
  expect(stored.toolUsage, 'negative/string/non-integer drop; valid kept').toEqual({ merge: 3, rotate: 0 });
  expect(stored.toolsPaletteLayout).toBe('list');
  expect(stored.theme).toBe('dark');
});

test('P36-C1 settings: a wrong-typed field falls back, others preserved', async () => {
  const { booted, stored } = await bootSaveRead('wrongtype', {
    theme: 'light',
    optimizePreset: 'max',
    dockPins: 'not-an-array',
    toolUsage: [1, 2, 3],
  });
  expect(booted, 'app must still boot with wrong-typed values').toBe(true);
  console.log(`[p36-settings-wrongtype] ${JSON.stringify(stored)}`);
  expect('dockPins' in stored, 'a non-array dockPins is dropped').toBe(false);
  expect('toolUsage' in stored, 'a non-object toolUsage is dropped').toBe(false);
  expect(stored.optimizePreset).toBe('max');
  expect(stored.theme).toBe('dark');
});
