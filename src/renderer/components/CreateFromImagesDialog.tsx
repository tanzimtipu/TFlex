// Phase 9 — Create-from-images dialog.
//
// The user picks one or more JPEG / PNG files, optionally tweaks the
// JPEG quality, and confirms. The renderer hands the file bytes to
// `engine.createFromImages(docId, imageBuffers, quality)`; the engine
// returns fresh PDF bytes which the host opens as a new tab via the
// same `openFromBytes` flow split / extract / optimize use.
//
// UX:
//   - "Add images…" opens a renderer-side `<input type=file accept=
//     "image/*" multiple>` picker (see utils/pickImageFiles.ts).
//     We keep this in the renderer so we don't need a custom IPC
//     handler for image bytes; the File objects give us both the
//     path (for display) and the bytes (for engine.createFromImages).
//   - "Create from clipboard" reads the OS clipboard (image bytes
//     or text) and asks the engine to synthesize a new PDF.
//   - The picked files show up in a list with their basename; the
//     user can remove an entry before confirming.
//   - Quality is exposed as an integer percentage input (10..100).
//     The persisted value is a FRACTION (0..1) so it matches the
//     backend's preserve-if-valid pipeline (see
//     `src/main/services/settings.ts` and the requirements: default
//     0.85, range 0..1). We display the percentage for the user
//     (familiar to anyone who's touched a JPEG-quality slider) and
//     convert at the boundary in `qualityFractionToPercent` /
//     `qualityPercentToFraction`. PNG inputs ignore the value; the
//     engine's encoder only consumes it for JPEG outputs.
//   - Confirm is disabled until at least one image is picked.
//
// The dialog owns the picker (so the host doesn't need a new IPC
// channel for "open image files").

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Icon } from "../icons/Icon";
import { PreviewTaskDialog } from "./PreviewTaskDialog";
import {
  DEFAULT_CREATE_IMAGE_QUALITY,
  clampCreateImageQuality,
  qualityFractionToPercent,
  qualityPercentToFraction,
} from "../state/preferences";
import { createIntakeModel, type IntakeItem, type IntakeModel } from "../intake/model";
import { pickImageFilesInRenderer, type PickedImages } from "../utils/pickImageFiles";
import type {
  ClipboardImageReason,
  ClipboardImageResult,
} from "../../shared/ipc";

export interface CreateFromImagesConfirm {
  files: File[];
  quality: number;
}

interface CreateFromImagesDialogProps {
  open: boolean;
  /** Mirrors AppSettings.createImageQuality (a fraction in [0, 1]).
   *  The dialog re-seeds its input from this prop on every open. */
  initialQuality: number;
  /** Lets the host respond to quality changes for AppSettings
   *  persistence. The callback receives the FRACTION (0..1); the
   *  host's preferences reducer + `trackAndSave` write it through
   *  to the backend, which preserves it across restarts (DEF-047). */
  onQualityChange?: (quality: number) => void;
  /** Fires with the user's choices when they click Create. The
   *  host reads the File bytes off disk and forwards them to
   *  `engine.createFromImages`. Quality is the FRACTION (0..1). */
  onConfirm: (choice: CreateFromImagesConfirm) => void;
  /** Reads the OS clipboard and returns image bytes, or a string
   *  when the clipboard holds only text. Phase 45 item 1: the dialog
   *  uses this to INSERT a copied image into the item list (with a
   *  preview), never to create a PDF straight from text. Phase 45
   *  item 2: this is now the FALLBACK — the main-side
   *  `window.tflex.clipboard.readImage()` channel is tried first
   *  (it also sees an image FILE copied in Explorer), and this
   *  renderer path is used only when that channel is absent (an
   *  older preload). Returning null signals an empty clipboard;
   *  `{ error }` surfaces a read failure. */
  readClipboard?: () => Promise<Uint8Array | string | null | { error: string }>;
  onClose: () => void;
}

/** Re-export the validation helpers so the dialog's caller doesn't
 *  have to reach into the preferences module. */
export { DEFAULT_CREATE_IMAGE_QUALITY, clampCreateImageQuality };

/** Phase 45 item 1 — the non-blocking message shown when the clipboard
 *  holds only text. The dialog refuses to turn plain text into an
 *  "image" (the operator's "it incorrectly works for texts"); the
 *  message names the fix instead of creating a bogus PDF. Phase 45
 *  item 2 — also the `no-image` reason from the main-side reader. */
export const CLIPBOARD_NO_IMAGE_MESSAGE =
  "The clipboard has no image. Copy an image, then try again - or use Add images…";

/** Phase 45 item 2 — the clipboard held nothing usable (nothing copied). */
export const CLIPBOARD_EMPTY_MESSAGE = "Clipboard is empty.";

/** Phase 45 item 2 — an image was found but exceeded the 20 MB cap. */
export const CLIPBOARD_TOO_LARGE_MESSAGE =
  "That image is too large to import (up to 20 MB). Copy a smaller image, or use Add images…";

/** Phase 45 item 2 — an image path was found but could not be read, or its
 *  magic bytes were neither PNG nor JPEG. */
export const CLIPBOARD_UNREADABLE_MESSAGE =
  "Could not read the image on the clipboard. Copy it again, or use Add images…";

/** Phase 45 item 2 — the four non-blocking messages, keyed by the main-side
 *  reader's reason. Every one keeps the dialog open with the list untouched;
 *  nothing is ever synthesised from a failed read. */
export function clipboardReasonMessage(reason: ClipboardImageReason): string {
  switch (reason) {
    case "empty":
      return CLIPBOARD_EMPTY_MESSAGE;
    case "no-image":
      return CLIPBOARD_NO_IMAGE_MESSAGE;
    case "too-large":
      return CLIPBOARD_TOO_LARGE_MESSAGE;
    case "unreadable":
      return CLIPBOARD_UNREADABLE_MESSAGE;
  }
}

/** Phase 45 item 2 — the main-side clipboard image reader off `window.tflex`,
 *  or null when the preload does not expose it (older builds / jsdom). Guarded
 *  exactly like `accountsBridge` / `tflex.app`: a missing or malformed bridge
 *  is a null, never a throw. */
export function clipboardImageBridge(): {
  readImage(): Promise<ClipboardImageResult>;
} | null {
  const w = window as unknown as {
    tflex?: { clipboard?: { readImage?: () => Promise<ClipboardImageResult> } };
  };
  const api = w.tflex?.clipboard;
  if (api === undefined || typeof api.readImage !== "function") return null;
  return api as { readImage(): Promise<ClipboardImageResult> };
}

/** Sniff the MIME type from the leading magic bytes so a clipboard
 *  JPEG is not mislabelled as a PNG (the blob URL's type drives how the
 *  thumbnail decodes). Falls back to PNG, which the engine's own
 *  `detectImageFormat` corrects anyway. The main-side reader reports the
 *  same mime from the same magic bytes; the sniff here is the renderer's
 *  own validation before an item enters the list. */
function sniffClipboardImageType(bytes: Uint8Array): { mime: string; ext: string } {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  return { mime: "image/png", ext: "png" };
}

/** The de-dupe key the queue has always used: name + byte size. Re-picking
 *  the exact same file is a no-op; two distinct files that happen to share a
 *  name (different size) are both kept. */
function intakeFileKey(file: File): string {
  return `${file.name}|${file.size}`;
}

/** Narrow an intake item's payload back to the File this dialog only ever
 *  queues, so the confirm contract stays `File[]`. */
function itemFile(item: IntakeItem): File | undefined {
  return typeof item.pathOrFile === "string" ? undefined : item.pathOrFile;
}

/** One row's preview thumbnail. Owns its object URL so it is revoked
 *  exactly when the row unmounts (remove, re-open, dialog close) -
 *  the leak the old list could not have managed because it rendered
 *  no preview at all. Clipboard images are converted to a File before
 *  they enter the list, so every item uses this same preview path. */
function ImageThumb({ file }: { file: File }): ReactElement {
  const [url] = useState<string>(() =>
    typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "",
  );
  useEffect(
    () => (): void => {
      if (url !== "") URL.revokeObjectURL(url);
    },
    [url],
  );
  return (
    <img
      className="create-image-thumb"
      src={url}
      alt=""
      aria-hidden
      draggable={false}
      data-create-thumb
    />
  );
}

export function CreateFromImagesDialog(
  props: CreateFromImagesDialogProps,
): ReactElement | null {
  const {
    open,
    initialQuality,
    onQualityChange,
    onConfirm,
    readClipboard,
    onClose,
  } = props;
  // TFL-1245 (TFL-1230 E) — the queue is a consumer of the ONE renderer
  // intake model, not a dialog-local `File[]`. Picker, clipboard and (where
  // offered) a compact intake layout all feed this single ordered queue and
  // call the same add / remove / reorder handlers. The model is
  // framework-free, so its queue is mirrored into React state to drive the
  // render, exactly as the host App mirrors its own instance.
  const intakeModelRef = useRef<IntakeModel | null>(null);
  if (intakeModelRef.current === null) {
    intakeModelRef.current = createIntakeModel();
  }
  const [items, setItems] = useState<readonly IntakeItem[]>([]);
  const syncItems = useCallback((): void => {
    setItems(intakeModelRef.current?.items() ?? []);
  }, []);
  // Monotonic counter for clipboard-image filenames so repeated pastes
  // do not collide in the list (`Clipboard image 1.png`, `…2.png`).
  const clipboardCountRef = useRef(0);
  // Internal state is the percent display value (10..100) so the
  // input feels natural. We convert to / from a fraction at every
  // boundary. The min/max on the input also reflect the percent
  // range — see the input element below.
  const [qualityPercent, setQualityPercent] = useState<number>(
    qualityFractionToPercent(initialQuality),
  );
  const [picking, setPicking] = useState(false);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time we re-open so a stale file list doesn't sneak in.
  // DEF-646 — reset ONLY on a closed -> open transition. The host echoes an
  // edited quality back through `initialQuality` (the same value that seeds the
  // input), and the previous `[open, initialQuality]` effect re-ran on that
  // echo, clearing the picked queue and disabling Create. Seed the quality at
  // open; a later quality echo must never touch the queue.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    intakeModelRef.current?.clear();
    setItems([]);
    setError(null);
    setQualityPercent(qualityFractionToPercent(initialQuality));
    setPicking(false);
    clipboardCountRef.current = 0;
  }, [open, initialQuality]);

  /** The visible queue reduced back to the `File[]` the confirm contract
   *  speaks. This dialog only ever queues real Files (picker / clipboard). */
  const files: File[] = items
    .map(itemFile)
    .filter((file): file is File => file !== undefined);

  /** Rows paired with their File so the render keeps the model's order and
   *  identity (the same File instance the model holds, byte-for-byte). */
  const imageRows = items
    .map((item) => ({ item, file: itemFile(item) }))
    .filter((row): row is { item: IntakeItem; file: File } => row.file !== undefined);

  // Convert back to fraction for the engine call. The engine's
  // expected quality is the fraction (0..1) so the wire shape
  // matches what's persisted.
  const qualityFraction = qualityPercentToFraction(qualityPercent);
  const valid = files.length > 0 && qualityFraction >= 0 && qualityFraction <= 1;
  // Phase 45 item 2 — the button is offered when EITHER clipboard source
  // exists: the main-side channel (primary, sees a copied image FILE) or the
  // renderer fallback (older preload).
  const clipboardReady = clipboardImageBridge() !== null || readClipboard !== undefined;

  /** Append one real image File to the shared queue and mark it a truthful
   *  image (these inputs are picked/clipboard images, never guessed). */
  const addImageFile = useCallback(
    (file: File): void => {
      const model = intakeModelRef.current;
      if (model === null) return;
      const item = model.add({ pathOrFile: file });
      model.classify(item.id, { kind: "image" });
      syncItems();
    },
    [syncItems],
  );

  const pickFiles = async (): Promise<void> => {
    setPicking(true);
    setError(null);
    try {
      const picked: PickedImages = await pickImageFilesInRenderer();
      if (picked.files.length > 0) {
        const model = intakeModelRef.current;
        // De-dupe by name + size so re-picking the same file twice doesn't
        // grow the queue with phantom entries. Duplicate names with distinct
        // sizes stay separate (the model disambiguates the visible label).
        const seen = new Set(
          model?.items().map((item) => {
            const file = itemFile(item);
            return file === undefined ? `string:${item.name}` : intakeFileKey(file);
          }) ?? [],
        );
        for (const file of picked.files) {
          const key = intakeFileKey(file);
          if (seen.has(key)) continue;
          seen.add(key);
          addImageFile(file);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Could not open file picker: ${msg}`);
    } finally {
      setPicking(false);
    }
  };

  const removeAt = (idx: number): void => {
    const item = items[idx];
    if (item === undefined) return;
    intakeModelRef.current?.remove(item.id);
    syncItems();
  };

  /** Reorder a single image by one slot. Only the queue order changes:
   *  every File keeps its bytes, name and de-dupe key, so the confirm
   *  payload is the visible list order with the exact same files. */
  const moveAt = (idx: number, dir: -1 | 1): void => {
    intakeModelRef.current?.reorder(idx, dir);
    syncItems();
  };

  /** Alt+ArrowUp / Alt+ArrowDown from a focused row handle moves that
   *  row without touching its bytes. Ignored while an IME composition
   *  is in flight so a composing keystroke never reorders the list. */
  const onRowKeyDown =
    (idx: number) =>
    (e: ReactKeyboardEvent<HTMLLIElement>): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.nativeEvent.isComposing) return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveAt(idx, -1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        moveAt(idx, 1);
      }
    };

  /** Insert raw clipboard image bytes into the SAME list the file picker
   *  feeds, as a real File, so the preview, de-dupe-free append, remove and
   *  confirm flows are identical for both sources. Sniffs the magic bytes
   *  (never trusting a label) before the item is added. */
  const insertImageBytes = (bytes: Uint8Array): void => {
    if (bytes.byteLength === 0) {
      setError("The clipboard image is empty.");
      return;
    }
    const { mime, ext } = sniffClipboardImageType(bytes);
    clipboardCountRef.current += 1;
    const name = `Clipboard image ${clipboardCountRef.current}.${ext}`;
    const file = new File([bytes as BlobPart], name, { type: mime });
    addImageFile(file);
  };

  const onClipboardClick = async (): Promise<void> => {
    // PRIMARY: the main-side reader. Unlike `navigator.clipboard.read()` it
    // also sees an image FILE copied in Explorer (CF_HDROP / text/uri-list),
    // because main has `fs`. It never throws; `{ ok: false, reason }` maps to
    // one of four clear, non-blocking messages.
    const bridge = clipboardImageBridge();
    if (bridge === null && readClipboard === undefined) return;
    setClipboardBusy(true);
    setError(null);
    try {
      if (bridge !== null) {
        const result = await bridge.readImage();
        if (result.ok) {
          // The backend already sniffed the mime; the renderer re-sniffs the
          // magic bytes as its own validation before the item enters the list.
          insertImageBytes(result.bytes);
          return;
        }
        setError(clipboardReasonMessage(result.reason));
        return;
      }
      // FALLBACK (older preload): the renderer's async clipboard. It cannot
      // see a copied image FILE, but it is all an older preload exposes.
      const fallback = readClipboard;
      if (fallback === undefined) return;
      const content = await fallback();
      if (content === null) {
        setError(CLIPBOARD_EMPTY_MESSAGE);
        return;
      }
      if (typeof content === "object" && "error" in content) {
        setError(content.error);
        return;
      }
      if (typeof content === "string") {
        // Plain text is NOT an image. Refuse it with a clear, non-blocking
        // message and keep the dialog open; do not synthesize a text PDF.
        setError(CLIPBOARD_NO_IMAGE_MESSAGE);
        return;
      }
      insertImageBytes(content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Could not read clipboard: ${msg}`);
    } finally {
      setClipboardBusy(false);
    }
  };

  // Surface every quality change as the fraction (0..1) so the
  // host's preferences reducer + persist pipeline can write the
  // canonical wire value to disk. The fraction survives the
  // backend's preserve-if-valid validation in settings.ts.
  const emitQualityChange = (percent: number): void => {
    const clampedPct = Math.max(10, Math.min(100, Math.round(percent)));
    setQualityPercent(clampedPct);
    onQualityChange?.(qualityPercentToFraction(clampedPct));
  };

  // TFL-1197 (DEF-632 / ER18) — the tall preview body is only meaningful once
  // images exist; while empty the dialog sizes to its content. The marker is
  // absent (not "false") when there are no files.
  return (
    <PreviewTaskDialog
      open={open}
      title="Create PDF from images"
      titleId="create-images-dialog-title"
      onClose={onClose}
      className="create-images-dialog"
      data-create-from-images-dialog
      {...(files.length > 0 ? { "data-create-has-files": true } : {})}
      grow={files.length > 0}
      actions={[
        { key: "cancel", label: "Cancel", variant: "secondary", onClick: onClose },
        Object.assign(
          {
            key: "create",
            label: "Create PDF",
            variant: "primary" as const,
            onClick: (): void => {
              if (valid) onConfirm({ files, quality: qualityFraction });
            },
            disabled: !valid,
            default: true,
          },
          { "data-create-confirm": true },
        ),
      ]}
    >
          <p className="modal-help">
            Pick one or more JPEG or PNG images, or paste one from the
            clipboard. Each image becomes a page in the new PDF, in the
            order they appear below. The result opens as a new tab.
          </p>

          <div className="modal-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={(): void => {
                void pickFiles();
              }}
              disabled={picking || clipboardBusy}
              data-create-pick
            >
              {picking ? "Picking…" : files.length === 0 ? "Add images…" : "Add more…"}
            </button>
            {clipboardReady && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={(): void => {
                  void onClipboardClick();
                }}
                disabled={clipboardBusy || picking}
                title="Insert the image currently on the OS clipboard"
                data-create-from-clipboard
              >
                <Icon name="createFromClipboard" size="sm" />
                {clipboardBusy ? "Reading…" : "Create from clipboard"}
              </button>
            )}
            <div className="modal-picked" aria-live="polite">
              {files.length === 0 ? (
                <span className="hint">No images selected</span>
              ) : (
                <span>
                  {files.length} page{files.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>

          {files.length > 0 && (
            <ul
              className="create-image-list"
              aria-label="Selected images"
              data-create-list
            >
              {imageRows.map(({ item, file }, idx) => {
                const label = item.name;
                return (
                  <li
                    key={item.id}
                    className="create-image-row"
                    data-create-image-row={idx}
                    tabIndex={0}
                    aria-label={`Image ${idx + 1}: ${label}`}
                    onKeyDown={onRowKeyDown(idx)}
                  >
                    <span className="create-image-index">{idx + 1}</span>
                    <ImageThumb file={file} />
                    <span className="create-image-name" title={label}>
                      {label}
                    </span>
                    <div className="create-image-controls">
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon create-image-move"
                        onClick={(): void => moveAt(idx, -1)}
                        disabled={idx === 0}
                        aria-label={`Move ${label} up`}
                        title="Move up"
                        data-create-move-up={idx}
                      >
                        <Icon icon={ChevronUp} size="sm" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon create-image-move"
                        onClick={(): void => moveAt(idx, 1)}
                        disabled={idx === imageRows.length - 1}
                        aria-label={`Move ${label} down`}
                        title="Move down"
                        data-create-move-down={idx}
                      >
                        <Icon icon={ChevronDown} size="sm" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon create-image-remove"
                        onClick={(): void => removeAt(idx)}
                        aria-label={`Remove ${label}`}
                        title="Remove"
                        data-create-remove={idx}
                      >
                        <Icon name="dialogClose" size="sm" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <fieldset className="create-image-encoding" data-create-encoding>
            <legend className="create-image-encoding-legend">
              Encoding options
            </legend>
            <label className="modal-field">
              <span>JPEG quality ({qualityPercent}%)</span>
              <input
                type="number"
                min={10}
                max={100}
                step={1}
                className="modal-input"
                value={qualityPercent}
                onChange={(e): void => {
                  const next = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(next)) {
                    emitQualityChange(next);
                  }
                }}
                onBlur={(): void => {
                  // Round-trip through emit so an out-of-range entry
                  // snaps back to the allowed band on blur (e.g. user
                  // typed 5 → clamps to 10; user typed 9999 → clamps to
                  // 100). emitQualityChange also writes the fraction
                  // through the host's onQualityChange callback so the
                  // backend sees the clamped value.
                  emitQualityChange(qualityPercent);
                }}
                data-create-quality
                aria-label="JPEG quality percentage (10..100)"
              />
              <span className="modal-hint">
                Applies when an image is re-encoded (for example a clipboard
                image). Images added from disk keep their original quality and
                DPI. 85 is a safe default.
              </span>
            </label>
          </fieldset>

          {error !== null && (
            <div className="modal-status optimize-error" role="alert">
              <span>{error}</span>
            </div>
          )}
    </PreviewTaskDialog>
  );
}
