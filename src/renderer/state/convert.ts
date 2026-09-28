// Phase 53 (feature I) — the renderer import surface for non-PDF files.
//
// The main process owns the conversion: `window.tflex.convert.toDocument`
// registers the converted PDF in the EXISTING engine under a docId the
// renderer mints, and returns metadata only (never bytes). This module holds
// the pure, App-free half of that flow so the routing, the single-docId
// invariant, the progress/cancel wiring and the failure text are all unit-
// testable without booting the 9k-line App:
//
//   - `routeOpenPath`  decides convert vs. the unchanged PDF path.
//   - `runConvertOpen` drives one conversion (progress, one docId, failure).
//   - `toastForConvertError` mirrors App's `toastForPdfError` shape.
//   - `noticeFromResult` builds the ConversionNotice payload.
//
// The `.pdf` path is the caller's; this module never touches it.

import type {
  ConvertErrorCode,
  ConvertFidelity,
  ConvertFormatId,
  ConvertOpenResult,
  ConvertProgress,
  ConvertSourceInfo,
  ConvertWarning,
} from '../../shared/convert';
import type { TFlexApiConvert } from '../../shared/ipc';
import type { Result } from '../../shared/result';

/** What the ConversionNotice card renders for one tab. */
export interface ConvertNoticeState {
  /** `ConvertSourceInfo.label`, e.g. `Text document`. */
  sourceLabel: string;
  sourceFormat: ConvertFormatId;
  fidelity: ConvertFidelity;
  warnings: ConvertWarning[];
}

/** Live conversion progress; null when no conversion is running. */
export interface ConvertProgressState {
  /** The jobId AND the engine docId — they are the same value. */
  docId: string;
  phase: string;
  /** 0..1 when the phase can estimate its extent. */
  ratio?: number;
}

/** Plain-word fidelity labels (the raw union is not user copy). */
export const FIDELITY_LABELS: Record<ConvertFidelity, string> = {
  native: 'Native',
  layout: 'Layout preserved',
  degraded: 'Degraded',
};

/** One sentence describing what the fidelity means for this document. */
export const FIDELITY_DESCRIPTIONS: Record<ConvertFidelity, string> = {
  native: 'Text and layout match the source closely.',
  layout: 'The layout is preserved; minor differences are possible.',
  degraded: 'Some content could not be reproduced faithfully.',
};

export function fidelityLabel(fidelity: ConvertFidelity): string {
  return FIDELITY_LABELS[fidelity];
}

export function fidelityDescription(fidelity: ConvertFidelity): string {
  return FIDELITY_DESCRIPTIONS[fidelity];
}

/** Readable text for a failed conversion. Mirrors App's `toastForPdfError`
 *  shape: it takes the filename, so the message names the file. `cancelled`
 *  is quiet by design — the caller suppresses it entirely (a cancel is not
 *  an error), so this map throws nothing and the switch is never reached. */
export function toastForConvertError(code: ConvertErrorCode, displayName: string): string {
  switch (code) {
    case 'unsupported-format':
      return `That file type cannot be imported ("${displayName}").`;
    case 'empty-file':
      return `The file is empty ("${displayName}").`;
    case 'password-required':
      return `This file is password-protected and could not be imported ("${displayName}").`;
    case 'too-large':
      return `The file is too large to import ("${displayName}").`;
    case 'decode-failed':
      return `The file could not be decoded ("${displayName}"). It may be damaged or an unsupported variant.`;
    case 'corrupt':
      return `The file could not be read ("${displayName}"). It may be corrupt or truncated.`;
    case 'timeout':
      return `Importing the file timed out ("${displayName}").`;
    case 'internal':
      return `The file could not be imported ("${displayName}").`;
    case 'cancelled':
      return `Import was cancelled ("${displayName}").`;
  }
}

/** The engine accepted the conversion but the renderer could not read the
 *  produced bytes. A readable failure, never a silent no-op. */
export function convertBytesUnreadableMessage(displayName: string): string {
  return `The converted document could not be read ("${displayName}").`;
}

/** Phase 53 routing. Convert when the bridge is present AND `sourceInfo`
 *  recognises the file; fall through to the unchanged PDF path on an absent
 *  bridge or ANY `sourceInfo` failure (including `unsupported-format`, so a
 *  `.pdf` and a corrupt `.pdf` keep today's exact behaviour and messages). */
export interface ConvertRouteDeps {
  api: TFlexApiConvert | undefined;
  /** The existing PDF open path, invoked unchanged. */
  openPdf: (path: string) => Promise<string | null>;
  /** The convert route; only reached when `sourceInfo` succeeds. */
  openConverted: (
    path: string,
    info: ConvertSourceInfo,
    api: TFlexApiConvert,
  ) => Promise<string | null>;
}

export async function routeOpenPath(
  path: string,
  deps: ConvertRouteDeps,
): Promise<string | null> {
  if (deps.api === undefined) return deps.openPdf(path);
  const info = await deps.api.sourceInfo(path);
  if (!info.ok) return deps.openPdf(path);
  return deps.openConverted(path, info.value, deps.api);
}

/** Build the notice payload from a successful open result. */
export function noticeFromResult(
  sourceLabel: string,
  result: ConvertOpenResult,
): ConvertNoticeState {
  return {
    sourceLabel,
    sourceFormat: result.sourceFormat,
    fidelity: result.fidelity,
    warnings: result.warnings,
  };
}

export interface ConvertOpenDeps {
  path: string;
  displayName: string;
  api: TFlexApiConvert;
  /** `window.tflex.getDocumentBytes` — the bytes the PDF.js proxy parses. */
  getDocumentBytes: (docId: string) => Promise<Result<ArrayBuffer, string>>;
  /** The shared tab-setup tail. Mints the tab for an engine doc that is
   *  ALREADY registered, and returns its id, or null when no tab was made. */
  createTab: (args: { docId: string; bytes: ArrayBuffer }) => Promise<string | null>;
  /** Called once the tab exists, with the metadata for the notice card. */
  onOpened: (args: { tabId: string; result: ConvertOpenResult }) => void;
  /** Live progress, then null on settle. */
  onProgress: (progress: ConvertProgressState | null) => void;
  pushToast: (kind: 'error' | 'info', text: string) => void;
  /** Test seam; defaults to `crypto.randomUUID`. Called exactly ONCE. */
  mintDocId?: () => string;
}

/**
 * One conversion. Mints exactly one docId and passes that SAME id to both
 * `toDocument` (which registers it with the engine) and `getDocumentBytes`
 * (which reads the bytes back under it) — a second id would name no live
 * engine document. Subscribes to progress, unsubscribes on settle, and
 * never creates a tab for a failed or cancelled conversion.
 */
export async function runConvertOpen(deps: ConvertOpenDeps): Promise<{ tabId: string } | null> {
  const docId = (deps.mintDocId ?? ((): string => crypto.randomUUID()))();
  let settled = false;
  const unsubscribe = deps.api.onProgress((progress: ConvertProgress): void => {
    if (settled || progress.jobId !== docId) return;
    deps.onProgress({ docId, phase: progress.phase, ratio: progress.ratio });
  });
  try {
    const converted = await deps.api.toDocument(docId, deps.path);
    if (!converted.ok) {
      // A cancelled conversion is quiet: the app is left exactly as it was.
      if (converted.error.code !== 'cancelled') {
        deps.pushToast('error', toastForConvertError(converted.error.code, deps.displayName));
      }
      return null;
    }
    const bytesResult = await deps.getDocumentBytes(docId);
    if (!bytesResult.ok) {
      deps.pushToast('error', convertBytesUnreadableMessage(deps.displayName));
      return null;
    }
    const tabId = await deps.createTab({ docId, bytes: bytesResult.value });
    if (tabId === null) return null;
    deps.onOpened({ tabId, result: converted.value });
    return { tabId };
  } finally {
    settled = true;
    unsubscribe();
    deps.onProgress(null);
  }
}
