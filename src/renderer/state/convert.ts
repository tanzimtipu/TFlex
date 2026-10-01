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
  ConvertManyResult,
  ConvertOpenResult,
  ConvertProgress,
  ConvertSourceInfo,
  ConvertWarning,
} from '../../shared/convert';
import type { TFlexApiConvert } from '../../shared/ipc';
import type { Result } from '../../shared/result';
import type { EngineError } from '../../shared/types';
import { describeEngineError } from '../engine/types';

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
    case 'drm-protected':
      return `This e-book is DRM-protected and cannot be imported ("${displayName}"). Jovrel never decrypts protected e-books.`;
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

/** True when the path names a `.pdf` (case-insensitive). The PDF path is the
 *  only fallback that may run for a path the conversion route cannot take. */
export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path);
}

/** The truthful message for a dropped/requested path that is neither a
 *  recognised convertible nor a `.pdf`. Never the misleading PDF-only copy. */
export function unsupportedFileMessage(displayName: string): string {
  return `"${displayName}" is not a file type Jovrel can open.`;
}

/** Phase 53 routing. Convert when the bridge is present AND `sourceInfo`
 *  recognises the file. Otherwise: a `.pdf` falls through to the unchanged
 *  PDF path (so a `.pdf` and a corrupt `.pdf` keep today's exact behaviour
 *  and messages); a NON-`.pdf` is reported through `onUnsupported` and opens
 *  nothing — the PDF loader is never invoked for a non-PDF (DEF-418). An
 *  absent bridge is treated the same way. */
export interface ConvertRouteDeps {
  api: TFlexApiConvert | undefined;
  /** The existing PDF open path, invoked unchanged (`.pdf` only). */
  openPdf: (path: string) => Promise<string | null>;
  /** The convert route; only reached when `sourceInfo` succeeds. */
  openConverted: (
    path: string,
    info: ConvertSourceInfo,
    api: TFlexApiConvert,
  ) => Promise<string | null>;
  /** Called with the path when a non-`.pdf` cannot be opened (absent bridge
   *  or a failed `sourceInfo`). Nothing is opened. */
  onUnsupported?: (path: string) => void;
}

export async function routeOpenPath(
  path: string,
  deps: ConvertRouteDeps,
): Promise<string | null> {
  const pdf = isPdfPath(path);
  if (deps.api === undefined) {
    if (!pdf) {
      deps.onUnsupported?.(path);
      return null;
    }
    return deps.openPdf(path);
  }
  const info = await deps.api.sourceInfo(path);
  if (!info.ok) {
    if (!pdf) {
      deps.onUnsupported?.(path);
      return null;
    }
    return deps.openPdf(path);
  }
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

// ---------------------------------------------------------------------------
// Phase 54 — DPI-aware multi-image import routing.
//
// The Create-from-images flow must reach `convert.toDocumentMany` when every
// input is a real on-disk file: the conversion service sizes each page from the
// image's OWN DPI metadata, which the legacy engine path (`createFromImages`)
// cannot do. Clipboard images and virtual files have no on-disk path, so they
// keep the legacy path byte-for-byte. This is the pure, App-free half so the
// routing, the single-docId invariant and the bind-sensitive bytes read-back
// are all unit-testable without booting the App.
// ---------------------------------------------------------------------------

/** Build the notice-card payload for a multi-file conversion. The card has no
 *  single `sourceFormat`, so it shows the first contributing format. */
export function noticeFromManyResult(result: ConvertManyResult): ConvertNoticeState {
  return {
    sourceLabel: result.title !== '' ? result.title : 'Images',
    sourceFormat: result.sourceFormats[0] ?? 'png',
    fidelity: result.fidelity,
    warnings: result.warnings,
  };
}

/** The fail-loud warning line for a multi-file conversion, or null when there
 *  is nothing to say. Names the count AND the first message, so a DPI
 *  assumption or a corrupt frame cannot pass silently. */
export function convertManyWarningToast(result: ConvertManyResult): string | null {
  if (result.warnings.length === 0) return null;
  const count = result.warnings.length;
  const first = result.warnings[0]?.message ?? '';
  return `Imported with ${count} warning${count === 1 ? '' : 's'}: ${first}`;
}

export interface CreateFromImagesRouteResult {
  bytes: ArrayBuffer;
  size: number;
  name: string;
  /** Present when the multi-file conversion route ran. The caller surfaces
   *  `warnings` (a toast) and can install the Phase 53 conversion card via
   *  `noticeFromManyResult`. Absent on the legacy engine route. */
  conversion?: ConvertManyResult;
}

export interface CreateFromImagesRouteDeps {
  files: File[];
  quality: number;
  /** `window.tflex.webUtils?.getPathForFile` — undefined when the bridge or
   *  the method is absent (older preload, jsdom). */
  getPathForFile: ((file: File) => string) | undefined;
  /** `window.tflex.convert` — undefined when the bridge is absent. */
  convert: TFlexApiConvert | undefined;
  /** `engine.createFromImages(docId, buffers, quality)` — the unchanged
   *  legacy path, used whenever the on-disk conversion route is unavailable. */
  createFromImages: (
    docId: string,
    buffers: Uint8Array[],
    quality: number,
  ) => Promise<Result<ArrayBuffer, EngineError>>;
  /** The engine bytes hook, called BOUND by the caller
   *  (`engineRef.current.getDocumentBytes(id)`). An extracted local alias
   *  loses `this` on RealEngineAdapter's prototype method and throws
   *  (DEF-374). */
  getDocumentBytes: (docId: string) => Promise<Result<ArrayBuffer, string>>;
  /** Warnings from a multi-file conversion surface immediately (fail-loud). */
  pushToast: (kind: 'error' | 'info' | 'warning', text: string) => void;
  /** Test seam; defaults to `crypto.randomUUID`. Called exactly ONCE per
   *  invocation — a second mint would name a phantom engine document. */
  mintDocId?: () => string;
}

/** Resolve every File to an on-disk path, or null when any one lacks a path
 *  (clipboard images, virtual files) or the resolver is absent/throws. */
function resolveImagePaths(
  files: File[],
  getPathForFile: ((file: File) => string) | undefined,
): string[] | null {
  if (getPathForFile === undefined) return null;
  const paths: string[] = [];
  for (const file of files) {
    let resolved: string;
    try {
      resolved = getPathForFile(file);
    } catch {
      return null;
    }
    if (typeof resolved !== 'string' || resolved === '') return null;
    paths.push(resolved);
  }
  return paths;
}

function mintCreateDocId(deps: CreateFromImagesRouteDeps): string {
  return (deps.mintDocId ?? ((): string => `create-${crypto.randomUUID()}`))();
}

/**
 * The Create-from-images routing. When EVERY input resolves to a non-empty
 * on-disk path AND `toDocumentMany` exists, the conversion service produces
 * the document (each page sized from its image's DPI metadata) and this
 * function reads the produced bytes back under the SAME docId. Otherwise the
 * legacy `createFromImages(docId, buffers, quality)` path runs unchanged, so
 * clipboard images and virtual files never regress.
 *
 * Exactly one docId is minted per invocation; the conversion route passes it
 * to both `toDocumentMany` and `getDocumentBytes`, and the fallback route
 * passes it to `createFromImages`.
 */
export async function createFromImagesRoute(
  deps: CreateFromImagesRouteDeps,
): Promise<CreateFromImagesRouteResult | { error: string }> {
  const { files } = deps;
  if (files.length === 0) return { error: 'No images selected.' };
  const name = files[0]?.name ?? 'new.pdf';
  try {
    const paths = resolveImagePaths(files, deps.getPathForFile);
    const many = deps.convert?.toDocumentMany;
    if (paths !== null && many !== undefined) {
      // Conversion route: the service embeds the SOURCE bytes and sizes each
      // page from the image's own DPI metadata.
      const docId = mintCreateDocId(deps);
      const converted = await many.call(deps.convert, docId, paths);
      if (!converted.ok) {
        return { error: toastForConvertError(converted.error.code, name) };
      }
      const bytesResult = await deps.getDocumentBytes(docId);
      if (!bytesResult.ok) {
        return { error: convertBytesUnreadableMessage(name) };
      }
      const warningToast = convertManyWarningToast(converted.value);
      if (warningToast !== null) deps.pushToast('warning', warningToast);
      return {
        bytes: bytesResult.value,
        size: bytesResult.value.byteLength,
        name,
        conversion: converted.value,
      };
    }
    // Fallback route (unchanged): read the file bytes and let the engine size
    // pages at the image's natural pixel size.
    const buffers: Uint8Array[] = [];
    for (const file of files) {
      const buf = new Uint8Array(await file.arrayBuffer());
      buffers.push(buf);
    }
    const docId = mintCreateDocId(deps);
    const result = await deps.createFromImages(docId, buffers, deps.quality);
    if (!result.ok) {
      return { error: describeEngineError(result.error.code, result.error.message) };
    }
    return {
      bytes: result.value,
      size: result.value.byteLength,
      name,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  }
}
