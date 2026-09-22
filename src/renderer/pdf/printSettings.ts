// Phase 30 — print dialog state -> PrintSettings mapping (pure).
//
// The dialog owns a flat state object; this module maps it onto the
// shared `PrintSettings` contract exactly once, so the mapping is unit
// tested without rendering a component.
//
// Division of labour (verified against the main-process print service):
//   - The RENDERER resolves page selection (range/scope), odd/even and
//     reverse into the ordered image list, and sends ONE image per PDF
//     page. It never composes N-up sheets itself.
//   - The MAIN process chunks the images into sheets of `pagesPerSheet`
//     and applies `pageOrder`, `scaling`/`scalePercent` and `landscape`.
//   - `pageRanges` is therefore intentionally left unset: the selected
//     pages already travel as the image list, and setting Electron
//     page ranges on top would re-index the composed document.

import type {
  PrintDuplex,
  PrintPageOrder,
  PrintScaling,
  PrintSettings,
} from '../../shared/types';
import type { PrintOddEven } from './printSelection';

export type PrintOrientation = 'auto' | 'portrait' | 'landscape';

/** The dialog's fully-resolved control state. */
export interface PrintDialogState {
  deviceName: string | null;
  copies: number;
  collate: boolean;
  scaling: PrintScaling;
  scalePercent: number;
  orientation: PrintOrientation;
  /** Resolved from the first preview page's aspect when orientation is
   *  'auto' (true when the page is wider than tall). Kept explicit so
   *  the auto rule is testable and the backend gets a concrete value. */
  autoLandscape: boolean;
  duplex: PrintDuplex;
  color: boolean;
  pagesPerSheet: number;
  pageOrder: PrintPageOrder;
  oddEven: PrintOddEven;
  reverse: boolean;
  printAnnotations: boolean;
}

export const PRINT_MIN_COPIES = 1;
export const PRINT_MAX_COPIES = 99;
export const PRINT_MIN_SCALE_PERCENT = 1;
export const PRINT_MAX_SCALE_PERCENT = 500;
export const PRINT_ALLOWED_NUP = [1, 2, 4, 6, 9, 16] as const;

/** Clamp a copies count to the dialog's 1..99 band. */
export function clampCopies(value: number): number {
  if (!Number.isFinite(value)) return PRINT_MIN_COPIES;
  return Math.min(PRINT_MAX_COPIES, Math.max(PRINT_MIN_COPIES, Math.trunc(value)));
}

/** Clamp a custom scale percent to the dialog's 1..500 band. */
export function clampScalePercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(PRINT_MAX_SCALE_PERCENT, Math.max(PRINT_MIN_SCALE_PERCENT, Math.trunc(value)));
}

/**
 * Map the dialog state onto the shared `PrintSettings` contract. Only the
 * fields the backend understands are emitted; `paperSource` is omitted
 * because Electron has no tray option (the UI does not offer one).
 */
export function buildPrintSettings(state: PrintDialogState): PrintSettings {
  const settings: PrintSettings = {
    deviceName: state.deviceName ?? undefined,
    copies: clampCopies(state.copies),
    collate: state.copies > 1 ? state.collate : false,
    scaling: state.scaling,
    landscape:
      state.orientation === 'landscape' ||
      (state.orientation === 'auto' && state.autoLandscape),
    duplex: state.duplex,
    color: state.color,
    pagesPerSheet: state.pagesPerSheet,
    pageOrder: state.pageOrder,
    oddEven: state.oddEven,
    reverse: state.reverse,
    printAnnotations: state.printAnnotations,
  };
  if (state.scaling === 'custom') {
    settings.scalePercent = clampScalePercent(state.scalePercent);
  }
  return settings;
}

/** Human labels for each orientation value, shared by the dialog. */
export const ORIENTATION_LABELS: Record<PrintOrientation, string> = {
  auto: 'Auto',
  portrait: 'Portrait',
  landscape: 'Landscape',
};

/** True when a `{ok:false}` reason denotes a user cancellation rather than
 *  a real failure, so the dialog stays quiet instead of showing an error
 *  banner (the virtual-PDF path opens the OS dialog, whose Cancel returns
 *  a "canceled" reason). */
export function isCancelReason(reason: string): boolean {
  return /cancel/i.test(reason);
}