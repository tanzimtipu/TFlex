import { vi, describe, it, expect, beforeEach } from 'vitest';

// vi.mock factories are hoisted — use vi.hoisted() so the mock references
// are available before the hoisted factory runs.

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

import { openPdfDialog, openPdfDialogMulti, savePdfDialog } from '../../../src/main/services/dialog';

describe('openPdfDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the normalized path when a file is selected', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\Users\\test\\Documents\\report.pdf'],
    });

    const result = await openPdfDialog();
    expect(result).toBe('C:\\Users\\test\\Documents\\report.pdf');
  });

  it('returns null when the dialog is canceled', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    });

    const result = await openPdfDialog();
    expect(result).toBeNull();
  });

  it('returns null when filePaths is empty even if not canceled', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [],
    });

    const result = await openPdfDialog();
    expect(result).toBeNull();
  });

  it('passes the PDF filter to the dialog by default', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/test/doc.pdf'],
    });

    await openPdfDialog();

    expect(mockShowOpenDialog).toHaveBeenCalledWith({
      title: 'Open PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
  });

  it('passes the PDF filter when kind is "pdf"', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/test/doc.pdf'],
    });

    await openPdfDialog('pdf');

    expect(mockShowOpenDialog).toHaveBeenCalledWith({
      title: 'Open PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
  });

  it('switches to the FDF filter when kind is "fdf"', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/test/comments.fdf'],
    });

    const result = await openPdfDialog('fdf');

    expect(mockShowOpenDialog).toHaveBeenCalledWith({
      title: 'Import FDF Comments',
      properties: ['openFile'],
      filters: [{ name: 'FDF', extensions: ['fdf'] }],
    });
    // normalize() on Windows flips forward slashes to backslashes.
    expect(result).toBe('\\test\\comments.fdf');
  });

  it('returns null when the FDF picker is canceled', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    });

    const result = await openPdfDialog('fdf');
    expect(result).toBeNull();
    expect(mockShowOpenDialog).toHaveBeenCalledWith({
      title: 'Import FDF Comments',
      properties: ['openFile'],
      filters: [{ name: 'FDF', extensions: ['fdf'] }],
    });
  });

  it('uses the "Open Files" title and grouped document filters when kind is "document"', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/test/report.pdf'],
    });

    await openPdfDialog('document');

    const call = mockShowOpenDialog.mock.calls[0][0] as {
      title: string;
      properties: string[];
      filters: { name: string; extensions: string[] }[];
    };
    expect(call.title).toBe('Open Files');
    expect(call.properties).toEqual(['openFile']);
    const allSupported = call.filters.find(
      (filter) => filter.name === 'All supported files',
    );
    expect(allSupported).toBeDefined();
    expect(allSupported?.extensions).toContain('pdf');
  });
});

describe('openPdfDialogMulti', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns several normalized paths in the picked order', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/one/first.pdf', '/two/second.pdf', '/three/third.pdf'],
    });

    const result = await openPdfDialogMulti();

    // normalize() on Windows rewrites separators; order must be preserved.
    expect(result).toEqual(['\\one\\first.pdf', '\\two\\second.pdf', '\\three\\third.pdf']);
    expect(result).toHaveLength(3);
  });

  it('returns a single-element array for one picked file', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/one/only.pdf'],
    });

    expect(await openPdfDialogMulti()).toEqual(['\\one\\only.pdf']);
  });

  it('returns an empty array when the dialog is canceled', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    });

    expect(await openPdfDialogMulti()).toEqual([]);
  });

  it('returns an empty array when filePaths is empty even if not canceled', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [],
    });

    expect(await openPdfDialogMulti()).toEqual([]);
  });

  it('enables multi-selection and passes the PDF filter by default', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/a.pdf'] });

    await openPdfDialogMulti();

    expect(mockShowOpenDialog).toHaveBeenCalledWith({
      title: 'Open PDF',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
  });

  it('uses the FDF filter and multi-selection when kind is "fdf"', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/comments/a.fdf', '/comments/b.fdf'],
    });

    const result = await openPdfDialogMulti('fdf');

    expect(mockShowOpenDialog).toHaveBeenCalledWith({
      title: 'Import FDF Comments',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'FDF', extensions: ['fdf'] }],
    });
    expect(result).toEqual(['\\comments\\a.fdf', '\\comments\\b.fdf']);
  });
});

describe('savePdfDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the chosen path when a destination is picked', async () => {
    mockShowSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: 'C:\\Users\\test\\Documents\\out.pdf',
    });
    const result = await savePdfDialog();
    expect(result).toBe('C:\\Users\\test\\Documents\\out.pdf');
    expect(mockShowSaveDialog).toHaveBeenCalledWith({
      title: 'Save PDF As',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
  });

  it('returns null when the save dialog is cancelled', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: true });
    expect(await savePdfDialog()).toBeNull();
  });

  it('returns null when filePath is undefined even if not cancelled', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: undefined });
    expect(await savePdfDialog()).toBeNull();
  });
});
