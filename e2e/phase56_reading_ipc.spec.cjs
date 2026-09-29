// Phase 56 chunk 1 (QA run-close) — reachability of the reading-view IPC,
// driven with NO options through the shipped preload API window.tflex.convert.
// Launches ONLY via e2e/lib/launch.cjs. This is item D of the run-close pass:
//   * convert:readingDocument resolves (never rejects) on a real .epub
//   * chapters are in SPINE order (b.xhtml before a.xhtml, not filename order)
//   * each xhtml is a sanitized body fragment (no html/body/script shells)
//   * referenced chapter images are inlined as data: URIs (the cover included)
//   * convert:toDocument imports the same file and opens a document
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIXTURE = path.resolve(__dirname, '..', 'test-fixtures', 'phase56', 'phase56-book.epub');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'phase56-reading-ipc');
  app = null;
  win = null;
});

test.setTimeout(180000);

test('item D: readingDocument resolves in spine order and toDocument opens the book', async () => {
  expect(fs.existsSync(FIXTURE), `fixture missing: ${FIXTURE}`).toBe(true);

  // 1) Shipped preload member exists.
  const apiShape = await win.evaluate(() => ({
    tflex: typeof window.tflex,
    convert: typeof window.tflex?.convert,
    readingDocument: typeof window.tflex?.convert?.readingDocument,
    toDocument: typeof window.tflex?.convert?.toDocument,
  }));
  console.log('P56_API_SHAPE ' + JSON.stringify(apiShape));
  expect(apiShape.readingDocument).toBe('function');
  expect(apiShape.toDocument).toBe('function');

  // 2) readingDocument(path) — capture whether it RESOLVES or REJECTS.
  const reading = await win.evaluate(async (p) => {
    try {
      const result = await window.tflex.convert.readingDocument(p);
      return { resolved: true, result };
    } catch (error) {
      return { resolved: false, error: String(error) };
    }
  }, FIXTURE);
  console.log('P56_READING_RESOLVED ' + reading.resolved);
  console.log('P56_READING ' + JSON.stringify(reading));

  expect(reading.resolved, `readingDocument rejected: ${reading.error}`).toBe(true);
  expect(reading.result.ok, `readingDocument failed: ${JSON.stringify(reading.result)}`).toBe(true);

  const doc = reading.result.value;
  expect(doc.title).toBe('Phase 56 Reachability Book');

  // 3) Chapters in SPINE order (b.xhtml then a.xhtml).
  expect(doc.chapters.map((c) => c.id)).toEqual(['ch1', 'ch2']);
  expect(doc.chapters.map((c) => c.href)).toEqual([
    'OEBPS/text/b.xhtml',
    'OEBPS/text/a.xhtml',
  ]);
  expect(doc.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two']);

  // 4) Each xhtml is a sanitized BODY fragment, not a whole document.
  for (const [i, chapter] of doc.chapters.entries()) {
    const x = chapter.xhtml;
    expect(x, `chapter ${i} kept an <html> shell`).not.toMatch(/<html\b/i);
    expect(x, `chapter ${i} kept a <body> shell`).not.toMatch(/<body\b/i);
    expect(x, `chapter ${i} kept a <head> shell`).not.toMatch(/<head\b/i);
    expect(x, `chapter ${i} carries a script/url-context danger`).not.toMatch(
      /<script|javascript:|onerror|onclick/i,
    );
    expect(x.length, `chapter ${i} fragment is empty`).toBeGreaterThan(0);
  }
  expect(doc.chapters[0].xhtml).toContain('First chapter content');
  expect(doc.chapters[1].xhtml).toContain('Second chapter content');

  // 5) The cover / referenced images are inlined as data: URIs.
  const coverData = doc.chapters[0].xhtml.match(/src="(data:image\/[a-z]+;base64,[^"]+)"/i);
  const picData = doc.chapters[1].xhtml.match(/src="(data:image\/[a-z]+;base64,[^"]+)"/i);
  console.log('P56_COVER_DATA_URI ' + (coverData ? coverData[1].slice(0, 40) : 'MISSING'));
  console.log('P56_PIC_DATA_URI ' + (picData ? picData[1].slice(0, 40) : 'MISSING'));
  expect(coverData, 'chapter one cover image is not an inlined data: URI').not.toBeNull();
  expect(coverData[1]).toMatch(/^data:image\/png;base64,/);
  expect(picData, 'chapter two image is not an inlined data: URI').not.toBeNull();

  // 6) toDocument(docId, path) imports the same file and opens a document.
  const openResult = await win.evaluate(async (p) => {
    const docId = 'p56-reachability-' + Date.now();
    try {
      const result = await window.tflex.convert.toDocument(docId, p);
      return { resolved: true, docId, result };
    } catch (error) {
      return { resolved: false, docId, error: String(error) };
    }
  }, FIXTURE);
  console.log('P56_TODOCUMENT ' + JSON.stringify(openResult));

  expect(openResult.resolved, `toDocument rejected: ${openResult.error}`).toBe(true);
  expect(openResult.result.ok, `toDocument failed: ${JSON.stringify(openResult.result)}`).toBe(true);
  expect(openResult.result.value.docId).toBe(openResult.docId);
  expect(openResult.result.value.sourceFormat).toBe('epub');
  expect(openResult.result.value.pageCount).toBeGreaterThanOrEqual(1);
  expect(openResult.result.value.title).toBe('Phase 56 Reachability Book');
});
