import { dialog } from 'electron';
import { normalize } from 'node:path';
import type { OpenFileDialogKind } from '../../shared/types';

interface FilterSpec {
  title: string;
  filters: { name: string; extensions: string[] }[];
}

function specForKind(kind: OpenFileDialogKind): FilterSpec {
  switch (kind) {
    case 'fdf':
      // Phase 12 — Import comments (FDF) picker. A separate filter is needed
      // because the PDF-only default filter hid `.fdf` files from users.
      return {
        title: 'Import FDF Comments',
        filters: [{ name: 'FDF', extensions: ['fdf'] }],
      };
    case 'pdf':
    default:
      return {
        title: 'Open PDF',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      };
  }
}

/**
 * Phase 35 — the app's single "Save PDF As" destination picker. Shared by the
 * Save-As engine flow (`index.ts`) and the virtual-PDF print path (`print.ts`)
 * so the app has exactly ONE save dialog; returns the chosen path, or `null`
 * when the user dismisses it (a quiet cancel, never an error).
 */
export async function savePdfDialog(): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: 'Save PDF As',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || result.filePath === undefined) {
    return null;
  }
  return result.filePath;
}

/**
 * Show an OS open-file dialog. `kind` selects which file-type filter is shown
 * (default `'pdf'`); `'fdf'` switches to the FDF comments filter used by the
 * Import comments (FDF) flow. Returns the normalized picked path, or `null`
 * if the user cancelled.
 */
export async function openPdfDialog(
  kind: OpenFileDialogKind = 'pdf',
): Promise<string | null> {
  const spec = specForKind(kind);
  const result = await dialog.showOpenDialog({
    title: spec.title,
    properties: ['openFile'],
    filters: spec.filters,
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return normalize(result.filePaths[0]);
}
