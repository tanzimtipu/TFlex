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

import { useEffect, useRef, useState, type ReactElement } from "react";
import { ClipboardPaste, X } from "lucide-react";
import {
  DEFAULT_CREATE_IMAGE_QUALITY,
  clampCreateImageQuality,
  qualityFractionToPercent,
  qualityPercentToFraction,
} from "../state/preferences";
import { pickImageFilesInRenderer, type PickedImages } from "../utils/pickImageFiles";

export interface CreateFromImagesConfirm {
  files: File[];
  quality: number;
}

/** Clipboard create: the host wires the OS clipboard read + engine
 *  call. The dialog surfaces the button; the host owns the bytes
 *  flow. */
export interface CreateFromClipboardConfirm {
  content: Uint8Array | string;
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
  /** Fires when the user clicks "Create from clipboard". Host
   *  reads the OS clipboard, then calls `engine.createFromClipboard`
   *  with the bytes (or text). Quality is the FRACTION (0..1). */
  onCreateFromClipboard?: (choice: CreateFromClipboardConfirm) => void;
  /** Reads the OS clipboard and returns bytes (image) or string
   *  (text). The dialog uses this to surface a one-click
   *  "Create from clipboard" path. Returning null signals an
   *  empty clipboard or read error (the dialog surfaces a toast). */
  readClipboard?: () => Promise<Uint8Array | string | null | { error: string }>;
  onClose: () => void;
}

/** Re-export the validation helpers so the dialog's caller doesn't
 *  have to reach into the preferences module. */
export { DEFAULT_CREATE_IMAGE_QUALITY, clampCreateImageQuality };

export function CreateFromImagesDialog(
  props: CreateFromImagesDialogProps,
): ReactElement | null {
  const {
    open,
    initialQuality,
    onQualityChange,
    onConfirm,
    onCreateFromClipboard,
    readClipboard,
    onClose,
  } = props;
  const [files, setFiles] = useState<File[]>([]);
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
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Reset every time we re-open so a stale file list doesn't sneak in.
  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setError(null);
    setQualityPercent(qualityFractionToPercent(initialQuality));
    setPicking(false);
  }, [open, initialQuality]);

  // Esc closes; focus first interactive control on open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const first = dialogRef.current?.querySelector<HTMLElement>(
      "button, input, [tabindex]",
    );
    first?.focus();
    return (): void => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Convert back to fraction for the engine call. The engine's
  // expected quality is the fraction (0..1) so the wire shape
  // matches what's persisted.
  const qualityFraction = qualityPercentToFraction(qualityPercent);
  const valid = files.length > 0 && qualityFraction >= 0 && qualityFraction <= 1;

  const pickFiles = async (): Promise<void> => {
    setPicking(true);
    setError(null);
    try {
      const picked: PickedImages = await pickImageFilesInRenderer();
      if (picked.files.length > 0) {
        setFiles((prev) => {
          // De-dupe by name + size so re-picking the same file twice
          // doesn't grow the list with phantom entries.
          const seen = new Set(prev.map((f) => `${f.name}|${f.size}`));
          const out = prev.slice();
          for (const f of picked.files) {
            const key = `${f.name}|${f.size}`;
            if (!seen.has(key)) {
              seen.add(key);
              out.push(f);
            }
          }
          return out;
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Could not open file picker: ${msg}`);
    } finally {
      setPicking(false);
    }
  };

  const removeAt = (idx: number): void => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const onClipboardClick = async (): Promise<void> => {
    if (readClipboard === undefined || onCreateFromClipboard === undefined) return;
    setClipboardBusy(true);
    setError(null);
    try {
      const content = await readClipboard();
      if (content === null) {
        setError("Clipboard is empty.");
        return;
      }
      if (typeof content === "object" && "error" in content) {
        setError(content.error);
        return;
      }
      onCreateFromClipboard({
        content,
        quality: qualityPercentToFraction(qualityPercent),
      });
      // The host closes the dialog on success; if the user clicks
      // Create from clipboard and the engine returns an error, the
      // host surfaces the toast but keeps the dialog open.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Could not read clipboard: ${msg}`);
    } finally {
      setClipboardBusy(false);
    }
  };

  if (!open) return null;

  // Surface every quality change as the fraction (0..1) so the
  // host's preferences reducer + persist pipeline can write the
  // canonical wire value to disk. The fraction survives the
  // backend's preserve-if-valid validation in settings.ts.
  const emitQualityChange = (percent: number): void => {
    const clampedPct = Math.max(10, Math.min(100, Math.round(percent)));
    setQualityPercent(clampedPct);
    onQualityChange?.(qualityPercentToFraction(clampedPct));
  };

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      data-create-from-images-dialog
    >
      <div
        className="modal-dialog"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-images-dialog-title"
      >
        <div className="modal-header">
          <h2 id="create-images-dialog-title" className="modal-title">
            Create PDF from images
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-help">
            Pick one or more JPEG or PNG images. Each image becomes a
            page in the new PDF, in the order they appear below. The
            result opens as a new tab.
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
            {onCreateFromClipboard !== undefined && readClipboard !== undefined && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={(): void => {
                  void onClipboardClick();
                }}
                disabled={clipboardBusy || picking}
                title="Create a PDF from the OS clipboard (image or text)"
                data-create-from-clipboard
              >
                <ClipboardPaste size={14} aria-hidden />
                {clipboardBusy ? "Reading…" : "Create from clipboard"}
              </button>
            )}
            <div className="modal-picked" aria-live="polite">
              {files.length === 0 ? (
                <span className="hint">No images selected</span>
              ) : (
                <span>
                  {files.length} image{files.length === 1 ? "" : "s"} selected
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
              {files.map((f, idx) => (
                <li
                  key={`${f.name}-${idx}`}
                  className="create-image-row"
                  data-create-image-row={idx}
                >
                  <span className="create-image-index">{idx + 1}</span>
                  <span className="create-image-name" title={f.name}>
                    {f.name}
                  </span>
                  <button
                    type="button"
                    className="create-image-remove"
                    onClick={(): void => removeAt(idx)}
                    aria-label={`Remove ${f.name}`}
                    title="Remove"
                    data-create-remove={idx}
                  >
                    <X size={12} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

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
              Used for JPEG outputs (PNG inputs ignore this). 85 is a
              safe default.
            </span>
          </label>

          {error !== null && (
            <div className="modal-status optimize-error" role="alert">
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!valid}
            onClick={(): void => {
              if (valid) onConfirm({ files, quality: qualityFraction });
            }}
            data-create-confirm
          >
            Create PDF
          </button>
        </div>
      </div>
    </div>
  );
}
