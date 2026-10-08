// Phase 118 (Drag Drop and Import) - truthful content / engine detection.
//
// Chunk F owns this seam: the ONE place the intake turns a queued path (or a
// dropped / picked `File`) into a real `IntakeDetection`. It trusts no file
// extension on its own:
//   - a real PDF (by extension) stays `pdf` and lets the shared PDF open path
//     own its own error, exactly as `routeOpenPath` does (`convert.ts:148`);
//   - every other input is probed with the engine's `convert.sourceInfo`
//     (magic-byte / adapter detection). A recognised image becomes `image`, a
//     recognised document / archive becomes `convertible`, and a real failure
//     becomes a `failed` item carrying the existing truthful message helper
//     (`toastForConvertError` `convert.ts:77`, `unsupportedFileMessage`
//     `convert.ts:116`, `associationMessageFor` `convert.ts:120`).
//   - with no conversion bridge, only a real `.pdf` can be promised; an
//     image-typed `File` is `image`, anything else is a truthful failure.
//
// Nothing here mutates a document, marks it dirty or recolours a pixel: it
// only reads metadata and returns the kind / error the row should show.

import type { ConvertErrorCode, ConvertFormatId, ConvertSourceInfo } from "../../shared/convert";
import type { Result } from "../../shared/result";
import {
  associationMessageFor,
  isPdfPath,
  toastForConvertError,
  unsupportedFileMessage,
} from "../state/convert";
import type { IntakeDetection } from "./model";

/** The conversion probe this helper needs. Structural so a jsdom test can pass
 *  a stub and a bridge-less preload yields `undefined`. */
export interface IntakeDetectApi {
  sourceInfo(path: string): Promise<Result<ConvertSourceInfo, ConvertErrorCode>>;
}

export interface IntakeDetectArgs {
  /** The resolved on-disk path, or null when it could not be resolved. */
  path: string | null;
  /** The row's basename, used only in truthful failure copy. */
  name: string;
  /** The dropped `File`'s MIME type when there is one (never trusted alone). */
  mimeType?: string;
  /** `window.tflex.convert`, or undefined when the bridge is absent. */
  api?: IntakeDetectApi;
}

/** The conversion formats that are image collections (one page per image),
 *  mirroring the `ConvertFormatId` image adapters. */
const IMAGE_FORMATS: ReadonlySet<ConvertFormatId> = new Set<ConvertFormatId>([
  "png",
  "jpeg",
  "tiff",
  "svg",
]);

/** True when a dropped File is typed as an image by the OS. Used ONLY as the
 *  no-bridge fallback; a present bridge always prefers `sourceInfo`. */
function isImageMime(mimeType: string | undefined): boolean {
  return typeof mimeType === "string" && mimeType.startsWith("image/");
}

/**
 * Resolve one queued input to a truthful detection. Never throws: an
 * unexpected probe failure becomes a `failed` item with readable copy rather
 * than an unhandled rejection.
 */
export async function detectIntakeItem(args: IntakeDetectArgs): Promise<IntakeDetection> {
  const { path, name, mimeType, api } = args;
  if (path === null) {
    return {
      kind: "unknown",
      error: `"${name}" could not be read from disk.`,
    };
  }
  const pdf = isPdfPath(path);
  if (api === undefined) {
    // No conversion bridge: a `.pdf` is the only promise we can make; an
    // image-typed File is a real image; anything else is a truthful refusal.
    if (pdf) return { kind: "pdf" };
    if (isImageMime(mimeType)) return { kind: "image" };
    return {
      kind: "unknown",
      error: associationMessageFor(path, name) ?? unsupportedFileMessage(name),
    };
  }
  let info: Result<ConvertSourceInfo, ConvertErrorCode>;
  try {
    info = await api.sourceInfo(path);
  } catch {
    info = { ok: false, error: { code: "internal", message: "detect failed" } };
  }
  if (info.ok) {
    if (IMAGE_FORMATS.has(info.value.format)) return { kind: "image" };
    return { kind: "convertible" };
  }
  // A real failure. A `.pdf` defers to the shared PDF open path (which reports
  // the specific PDF error); every other input gets the engine's own truthful
  // failure copy, never a fabricated "Ready".
  if (pdf) return { kind: "pdf" };
  return {
    kind: "unknown",
    error: associationMessageFor(path, name) ?? toastForConvertError(info.error.code, name),
  };
}
