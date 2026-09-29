import { describe, expect, it } from 'vitest';
import { err, ok } from '../../../src/shared/result';
import type { ExportTextPage } from '../../../src/shared/export';
import {
  buildPptx,
  exportPptx,
} from '../../../src/main/services/export/pptx-export';
import type { ExportTextEngine } from '../../../src/main/services/export/xlsx-export';
import { openZip } from '../../../src/main/services/convert/convert-zip';

/**
 * Phase 55 feature D — the .pptx writer. The produced package is read back as
 * a real ZIP (convert-zip.ts), never with our own writer's internals.
 */

// A real 1x1 PNG so pptxgenjs accepts the image data.
const PNG_1X1 = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const PAGES: ExportTextPage[] = [
  { pageIndex: 1, text: 'Alpha  Beta' },
  { pageIndex: 2, text: 'Second page body text' },
];

function letterEntry(pageNumber: number) {
  return {
    pageNumber,
    pngBuffer: PNG_1X1,
    width: 612,
    height: 792,
    pageWidth: 612,
    pageHeight: 792,
  };
}

function slideXmlOf(archive: ReturnType<typeof openZip>, slide: number): string {
  return archive.readText(`ppt/slides/slide${slide}.xml`) ?? '';
}

describe('phase55 pptx export writer', () => {
  it('emits one slide per page in page order', async () => {
    const build = await buildPptx({ pages: PAGES, includeImages: false, entries: [] });
    const archive = openZip(build.bytes);
    const slides = archive.names().filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    expect(slides.sort()).toEqual(['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']);
    expect(slideXmlOf(archive, 1)).toContain('Alpha');
    expect(slideXmlOf(archive, 2)).toContain('Second page body text');
  });

  it('sizes the presentation from a LETTER page box', async () => {
    const build = await buildPptx({
      pages: PAGES,
      includeImages: true,
      entries: [letterEntry(1), letterEntry(2)],
    });
    const presentation = openZip(build.bytes).readText('ppt/presentation.xml') ?? '';
    // 612pt x 792pt = 8.5in x 11in = 7,772,400 x 10,058,400 EMU.
    expect(presentation).toContain('<p:sldSz cx="7772400" cy="10058400"');
  });

  it('sizes the presentation from a 16:9-shaped page box', async () => {
    const wide = {
      pageNumber: 1,
      pngBuffer: PNG_1X1,
      width: 960,
      height: 540,
      pageWidth: 960,
      pageHeight: 540,
    };
    const build = await buildPptx({
      pages: [{ pageIndex: 1, text: 'wide' }],
      includeImages: true,
      entries: [wide],
    });
    const presentation = openZip(build.bytes).readText('ppt/presentation.xml') ?? '';
    // 960pt x 540pt = 13.333in x 7.5in = 12,192,000 x 6,858,000 EMU.
    expect(presentation).toContain('<p:sldSz cx="12192000" cy="6858000"');
  });

  it('puts the page text into the slide notes', async () => {
    const build = await buildPptx({ pages: PAGES, includeImages: false, entries: [] });
    const archive = openZip(build.bytes);
    const notes1 = archive.readText('ppt/notesSlides/notesSlide1.xml') ?? '';
    const notes2 = archive.readText('ppt/notesSlides/notesSlide2.xml') ?? '';
    expect(notes1).toContain('Alpha');
    expect(notes2).toContain('Second page body text');
  });

  it('carries the fidelity note in the presentation core properties', async () => {
    const build = await buildPptx({ pages: PAGES, includeImages: false, entries: [] });
    const core = openZip(build.bytes).readText('docProps/core.xml') ?? '';
    expect(core).toContain('<dc:subject>');
    expect(core).toContain('conversion-fidelity');
    expect(core).toContain('One slide per page');
  });

  it('text-only path: no media, text boxes carry the page text', async () => {
    const build = await buildPptx({ pages: PAGES, includeImages: true, entries: [] });
    const archive = openZip(build.bytes);
    // pptxgenjs always emits an empty `ppt/media/` directory entry; assert no
    // image FILE is present.
    expect(
      archive.names().some((name) => name.startsWith('ppt/media/') && name.endsWith('.png')),
    ).toBe(false);
    expect(slideXmlOf(archive, 1)).toContain('Alpha');
    const subject = archive.readText('docProps/core.xml') ?? '';
    expect(subject).toContain('Text-only slides: 1, 2');
  });

  it('image path: the supplied page image is embedded', async () => {
    const build = await buildPptx({
      pages: PAGES,
      includeImages: true,
      entries: [letterEntry(1), letterEntry(2)],
    });
    const archive = openZip(build.bytes);
    const media = archive.names().filter((name) => name.startsWith('ppt/media/') && name.endsWith('.png'));
    expect(media.length).toBeGreaterThanOrEqual(1);
    expect(slideXmlOf(archive, 1)).toContain('blip');
    expect(archive.readText('docProps/core.xml') ?? '').not.toContain('Text-only slides:');
  });

  it('a text-less document still produces a valid package and says so', async () => {
    const build = await buildPptx({
      pages: [{ pageIndex: 1, text: '' }],
      includeImages: false,
      entries: [],
    });
    expect(build.pagesWithoutText).toEqual([1]);
    expect(build.bytes.byteLength).toBeGreaterThan(0);
    const archive = openZip(build.bytes);
    expect(archive.has('ppt/presentation.xml')).toBe(true);
    expect(archive.readText('ppt/slides/slide1.xml') ?? '').toContain('no extractable text');
    expect(archive.readText('docProps/core.xml') ?? '').toContain(
      'Pages with no extractable text: 1',
    );
  });

  it('exportPptx extracts through the engine and maps failures', async () => {
    const good: ExportTextEngine = { exportText: async () => ok(PAGES) };
    const built = await exportPptx(good, 'doc-1', { includeImages: false });
    expect(built.ok).toBe(true);

    const bad: ExportTextEngine = { exportText: async () => err('engine-error', 'nope') };
    const failed = await exportPptx(bad, 'nope');
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe('engine-error');
  });
});
