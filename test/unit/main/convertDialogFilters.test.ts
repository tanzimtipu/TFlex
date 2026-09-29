import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockShowOpenDialog, mockShowSaveDialog } = vi.hoisted(() => ({
  mockShowOpenDialog: vi.fn(),
  mockShowSaveDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: mockShowOpenDialog,
    showSaveDialog: mockShowSaveDialog,
  },
}));

import { openPdfDialog } from '../../../src/main/services/dialog';
import { createDefaultRegistry } from '../../../src/main/services/convert/registry';
import { looksLikeOpenablePath, looksLikePdfPath } from '../../../src/main/open-path';

/**
 * Phase 53 feature I - the universal-import picker's grouped filters and the
 * OS-open predicate. The extension set is derived from the shipped registry, so
 * this doubles as the honest version of Phase 57's guard: everything the
 * picker advertises is actually convertible.
 */

interface Filter {
  name: string;
  extensions: string[];
}

function registryExtensions(): Set<string> {
  const set = new Set<string>(['pdf']);
  for (const registration of createDefaultRegistry().listRegistrations()) {
    for (const extension of registration.extensions) {
      set.add(extension.replace(/^\./, '').toLowerCase());
    }
  }
  return set;
}

async function filtersFor(kind: 'pdf' | 'fdf' | 'document'): Promise<Filter[]> {
  mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
  await openPdfDialog(kind);
  const call = mockShowOpenDialog.mock.calls[0][0] as { filters: Filter[] };
  return call.filters;
}

describe('phase53 document dialog filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('advertises the four grouped filters in order', async () => {
    const filters = await filtersFor('document');
    expect(filters.map((filter) => filter.name)).toEqual([
      'Documents',
      'Text and markup',
      'Spreadsheets',
      'All supported files',
    ]);
  });

  it('groups the currently registered formats correctly', async () => {
    const filters = await filtersFor('document');
    const byName = new Map(filters.map((filter) => [filter.name, filter.extensions]));
    // Phase 54 registers the image adapters and Phase 55 the office adapters;
    // ungrouped formats fall back to 'Documents' by design so a new adapter
    // never disappears from the picker. Phase 55 feature B registers the
    // spreadsheet adapters (xlsx/xls/ods) and feature C the presentation
    // adapters (pptx/ppt), which the snapshot now carries.
    expect(byName.get('Documents')).toEqual([
      'doc',
      'docx',
      'jpeg',
      'jpg',
      'ods',
      'odt',
      'pdf',
      'png',
      'ppt',
      'pptx',
      'rtf',
      'svg',
      'tif',
      'tiff',
      'xls',
      'xlsx',
    ]);
    expect(new Set(byName.get('Text and markup'))).toEqual(
      new Set(['txt', 'md', 'markdown', 'html', 'htm', 'xhtml']),
    );
    expect(byName.get('Spreadsheets')).toEqual(['csv']);
  });

  it('advertises exactly the registered extensions plus pdf', async () => {
    const filters = await filtersFor('document');
    const advertised = new Set(filters.flatMap((filter) => filter.extensions));
    expect(advertised).toEqual(registryExtensions());
  });

  it('leaves the PDF and FDF kinds unchanged', async () => {
    const pdf = await filtersFor('pdf');
    expect(pdf).toEqual([{ name: 'PDF', extensions: ['pdf'] }]);
    vi.clearAllMocks();
    const fdf = await filtersFor('fdf');
    expect(fdf).toEqual([{ name: 'FDF', extensions: ['fdf'] }]);
  });
});

describe('phase53 OS-open predicate', () => {
  it('accepts every advertised document extension case-insensitively', () => {
    expect(looksLikeOpenablePath('a.pdf')).toBe(true);
    expect(looksLikeOpenablePath('A.PDF')).toBe(true);
    for (const ext of ['txt', 'md', 'csv', 'rtf', 'html', 'htm', 'xhtml']) {
      expect(looksLikeOpenablePath(`C:\\docs\\file.${ext}`)).toBe(true);
    }
    for (const ext of ['docx', 'odt', 'doc']) {
      expect(looksLikeOpenablePath(`C:\\docs\\file.${ext}`)).toBe(true);
    }
  });

  it('rejects an unsupported extension', () => {
    expect(looksLikeOpenablePath('C:\\docs\\setup.exe')).toBe(false);
    expect(looksLikeOpenablePath('C:\\docs\\archive.zip')).toBe(false);
    expect(looksLikeOpenablePath('noextension')).toBe(false);
  });

  it('does not change looksLikePdfPath for a non-PDF', () => {
    expect(looksLikePdfPath('a.txt')).toBe(false);
    expect(looksLikePdfPath('a.pdf')).toBe(true);
  });
});
