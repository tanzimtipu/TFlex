// DEF-592 retest (TFL-943, Phase 106 chunk C) - Home sample cards must render the
// REAL first page of each bundled sample (via readSample IPC + pdf.js), or an
// honest per-sample fallback that keeps form / long / report / scanned distinct.
//
// The recorded defect: every card showed the same per-TASK glyph on an identical
// gradient, so `long.pdf` and `report.pdf` were pixel-identical. This spec drives
// the real Electron app, settles each card's preview, and PROVES the two former
// twins now differ - with a real rendered page when the raster succeeds.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setTheme(win, theme) {
  await win.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await win.waitForFunction(
    (t) => document.documentElement.getAttribute('data-theme') === t,
    theme,
    { timeout: 8000 },
  );
}

// Wait until every card's preview has settled (ready or unavailable), never stuck
// on the initial "loading" state.
async function waitSettled(win) {
  await win.waitForFunction(
    () => {
      const cards = [...document.querySelectorAll('[data-sample-card] .sample-thumb')];
      return (
        cards.length > 0 &&
        cards.every((t) => ['ready', 'unavailable'].includes(t.getAttribute('data-sample-preview')))
      );
    },
    null,
    { timeout: 30000 },
  );
}

let app;
let win;

test.beforeEach(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  app = await launchApp([]);
  win = await app.firstWindow();
  await win.waitForSelector('.welcome.orbit-desk', { timeout: 30000 });
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app);
});

test('DEF-592 - sample cards render real first pages and long/report are distinct', async () => {
  await waitSettled(win);
  const cards = await win.evaluate(() => {
    return [...document.querySelectorAll('[data-sample-card]')].map((card) => {
      const thumb = card.querySelector('.sample-thumb');
      const img = card.querySelector('.sample-thumb-page');
      const glyph = card.querySelector('.sample-thumb-glyph');
      const src = img ? img.getAttribute('src') || '' : '';
      let pageHash = null;
      if (src.length > 0) {
        let h = 5381;
        for (let i = 0; i < src.length; i += 97) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
        pageHash = `${src.length}:${h.toString(16)}`;
      }
      return {
        name: card.querySelector('.sample-name')?.textContent ?? '',
        tone: thumb?.getAttribute('data-sample-tone') ?? null,
        preview: thumb?.getAttribute('data-sample-preview') ?? null,
        pageSrc: src.slice(0, 32),
        pageFullLen: src.length,
        pageHash,
        glyph: glyph ? glyph.outerHTML : null,
      };
    });
  });
  fs.writeFileSync(
    path.join(SHOTS, 'def592-sample-preview-probe.json'),
    JSON.stringify(cards, null, 2),
  );

  // Four bundled samples are shown.
  expect(cards.length).toBe(4);
  const byName = Object.fromEntries(cards.map((c) => [c.name, c]));
  expect(byName['long.pdf']).toBeTruthy();
  expect(byName['report.pdf']).toBeTruthy();

  // Every card renders EITHER a real first-page PNG raster OR a fallback glyph,
  // never both and never neither.
  for (const c of cards) {
    if (c.preview === 'ready') {
      expect(c.pageSrc.startsWith('data:image/png')).toBe(true);
      expect(c.pageFullLen).toBeGreaterThan(64);
      expect(c.glyph).toBeNull();
    } else {
      expect(c.preview).toBe('unavailable');
      expect(c.pageFullLen).toBe(0);
      expect(c.glyph).toBeTruthy();
    }
  }

  // Fallback honesty: every card's tone is distinct, and every card's rendered
  // content (real page hash or fallback glyph) is distinct - the DEF-592 gap was
  // four identical thumbs.
  expect(new Set(cards.map((c) => c.tone)).size).toBe(4);
  const glyphs = cards.map((c) => c.pageHash ?? c.glyph);
  expect(new Set(glyphs).size).toBe(4);

  // The exact DEF-592 twins must now differ in BOTH tone and rendered content.
  expect(byName['long.pdf'].tone).not.toBe(byName['report.pdf'].tone);
  expect(byName['long.pdf'].pageHash).not.toBe(byName['report.pdf'].pageHash);

  // Evidence: at least one real page raster must exist in the live app, proving
  // the fix renders real first pages (not just a relabelled fallback).
  const ready = cards.filter((c) => c.preview === 'ready');
  expect(ready.length).toBeGreaterThan(0);

  // Close-up evidence of the two former twins.
  const longThumb = win.locator('[data-sample-card]', { hasText: 'long.pdf' }).locator('.sample-thumb');
  const reportThumb = win.locator('[data-sample-card]', { hasText: 'report.pdf' }).locator('.sample-thumb');
  await longThumb.screenshot({ path: path.join(SHOTS, 'def592-thumb-long.png') });
  await reportThumb.screenshot({ path: path.join(SHOTS, 'def592-thumb-report.png') });

  await setTheme(win, 'light');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, 'def592-home-light.png') });
  await setTheme(win, 'dark');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, 'def592-home-dark.png') });
});
