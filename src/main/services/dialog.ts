import { dialog } from 'electron';
import { normalize } from 'node:path';
import type { OpenFileDialogKind } from '../../shared/types';
import { createDefaultRegistry } from './convert/registry';

interface FilterSpec {
  title: string;
  filters: { name: string; extensions: string[] }[];
}

/** Phase 53 feature I - which group each registered format's extensions
 *  advertise in the universal-import picker. An unknown/future format falls
 *  back to 'Documents' so a newly registered adapter never silently disappears
 *  from the picker. */
const GROUP_BY_FORMAT: Record<string, string> = {
  rtf: 'Documents',
  text: 'Text and markup',
  markdown: 'Text and markup',
  html: 'Text and markup',
  csv: 'Spreadsheets',
};

const GROUP_ORDER = ['Documents', 'Text and markup', 'Spreadsheets'];

function bareExtension(extension: string): string {
  return extension.replace(/^\./, '').toLowerCase();
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * The grouped filters for the universal-import picker. The advertised extension
 * set is DERIVED from the shipped registry (`listRegistrations`) plus `pdf` -
 * the single source of truth - never a second hardcoded list, so a newly
 * registered adapter appears in the picker automatically.
 */
function documentFilters(): { name: string; extensions: string[] }[] {
  const groups = new Map<string, string[]>();
  const all = new Set<string>(['pdf']);

  for (const registration of createDefaultRegistry().listRegistrations()) {
    const group = GROUP_BY_FORMAT[registration.id] ?? 'Documents';
    const list = groups.get(group) ?? [];
    for (const extension of registration.extensions) {
      const bare = bareExtension(extension);
      list.push(bare);
      all.add(bare);
    }
    groups.set(group, list);
  }

  const documents = groups.get('Documents') ?? [];
  documents.unshift('pdf');
  groups.set('Documents', documents);

  const filters = GROUP_ORDER.filter(
    (name) => (groups.get(name) ?? []).length > 0,
  ).map((name) => ({ name, extensions: sortUnique(groups.get(name) ?? []) }));
  filters.push({ name: 'All supported files', extensions: sortUnique([...all]) });
  return filters;
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
    case 'formData':
      // Phase 57 feature B — Import form data (FDF/XFDF) picker.
      return {
        title: 'Open Form Data',
        filters: [{ name: 'Form data', extensions: ['fdf', 'xfdf'] }],
      };
    case 'document':
      // Phase 53 feature I — grouped universal-import filters.
      return {
        title: 'Open Document',
        filters: documentFilters(),
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
 * Phase 57 feature B — the "Save Form Data As" destination picker for the
 * Export form data (FDF/XFDF) flow. Returns the chosen path, or `null` when
 * the user dismisses it (a quiet cancel, never an error).
 */
export async function saveFormDataDialog(
  format: 'fdf' | 'xfdf',
  defaultName?: string,
): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: 'Save Form Data As',
    filters: [{ name: format === 'xfdf' ? 'XFDF' : 'FDF', extensions: [format] }],
    defaultPath: defaultName,
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

/**
 * Phase 40 — multi-select sibling of `openPdfDialog`, used by the
 * "Merge PDF from scratch" picker. Uses the same `specForKind` filter set
 * (default `'pdf'`) with OS multi-selection enabled. Returns the NORMALIZED
 * picked paths in the order the user selected them; a cancel resolves to an
 * EMPTY ARRAY (never `null`), so a caller can iterate the result
 * unconditionally. The single-file `openPdfDialog` is unchanged.
 */
export async function openPdfDialogMulti(
  kind: OpenFileDialogKind = 'pdf',
): Promise<string[]> {
  const spec = specForKind(kind);
  const result = await dialog.showOpenDialog({
    title: spec.title,
    properties: ['openFile', 'multiSelections'],
    filters: spec.filters,
  });
  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }
  return result.filePaths.map(normalize);
}
