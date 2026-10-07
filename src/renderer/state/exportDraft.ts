// TFL-1119 (TFL-1116 C2) - the document-scoped Deliver export draft.
//
// The Deliver export configuration (format, page scope, custom range, DPI) is
// owned by App, keyed per document, and passed to the Inspector as a CONTROLLED
// value. The Inspector's `ExportConfigSection` unmounts when the panel collapses
// at a compact width (`Inspector.tsx` renders the collapsed strip instead of the
// section bodies), so keeping the configuration in local `useState` loses it on
// every remount and the surface snaps back to the persisted image default - the
// R02 defect. A stored draft survives the unmount/remount, a stage switch and a
// tab switch; reading or writing it never runs an export.
//
// This module is PURE: validation is still derived from `customRange` + the
// total pages through the existing `validateExportRange`, and the output name is
// still derived from `format` through `exportDefaultName`, so storing the draft
// preserves both.

import {
  DEFAULT_EXPORT_CONFIG_FORMAT,
  type ExportConfigFormat,
  type ExportPageScope,
} from '../components/exportConfig';
import { clampExportImageDpi } from './preferences';

/** The Deliver export configuration prepared for ONE document. */
export interface ExportDraft {
  format: ExportConfigFormat;
  scope: ExportPageScope;
  customRange: string;
  dpi: number;
}

/** The opening draft for a document that has no stored draft yet. */
export function defaultExportDraft(dpi: number): ExportDraft {
  return {
    format: DEFAULT_EXPORT_CONFIG_FORMAT,
    scope: 'all',
    customRange: '',
    dpi: clampExportImageDpi(dpi),
  };
}

/** The stored draft for `docId`, or the default when it is unknown/null. */
export function exportDraftFor(
  drafts: Record<string, ExportDraft>,
  docId: string | null,
  fallbackDpi: number,
): ExportDraft {
  if (docId === null) return defaultExportDraft(fallbackDpi);
  return drafts[docId] ?? defaultExportDraft(fallbackDpi);
}

/** A new draft with the format replaced. Never mutates the input. */
export function withExportFormat(
  draft: ExportDraft,
  format: ExportConfigFormat,
): ExportDraft {
  return { ...draft, format };
}

/** A new draft with the page scope replaced. Never mutates the input. */
export function withExportScope(
  draft: ExportDraft,
  scope: ExportPageScope,
): ExportDraft {
  return { ...draft, scope };
}

/** A new draft with the custom range expression replaced. */
export function withExportCustomRange(
  draft: ExportDraft,
  customRange: string,
): ExportDraft {
  return { ...draft, customRange };
}

/** A new draft with the resolution replaced (clamped to the shipped range). */
export function withExportDpi(draft: ExportDraft, dpi: number): ExportDraft {
  return { ...draft, dpi: clampExportImageDpi(dpi) };
}