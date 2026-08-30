import { vi, describe, it, expect, beforeEach } from 'vitest';

// vi.mock factories are hoisted — use vi.hoisted() so the mock references
// are available before the hoisted factory runs.

const { mockShowOpenDialog } = vi.hoisted(() => ({
  mockShowOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: mockShowOpenDialog,
  },
}));

import { openPdfDialog } from '../../../src/main/services/dialog';

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
});
