// Phase 8/13 — Save-As modal (file size reduction linearize toggle).
//
// A renderer-side modal that appears when the user clicks Save-As.
// The user can opt in to "Fast web view (linearize)" before the OS
// save dialog opens; the choice persists across launches by writing
// through the dedicated `saveAsLinearize` AppSettings boolean.
//
// DEF-073 / ADV-020 — independent of Optimize preset. The previous
// design piggy-backed the linearize toggle on the Optimize
// dialog's `optimizePreset` field ('none' = linearized, 'compact'
// = not linearized). That coupled two unrelated features: opening
// Optimize, picking 'max', then opening Save-As and checking
// "linearize" silently overwrote 'max' with 'none'; the next
// Optimize session showed 'none' with no indication the user's
// compression choice was lost. The two flows now own their own
// fields — `optimizePreset` for compression, `saveAsLinearize` for
// the Save-As linearize choice — and never collide.
//
// Why a renderer modal (and not the OS dialog's native extras)?
// The backend's engineSaveAs IPC handler pops the OS dialog
// directly. We can't inject extra controls there from the
// renderer. The cleanest path is to surface our own modal first,
// persist the choice, and then fire the existing engine.saveAs
// call as before. The OS dialog still handles the path + filename.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { X } from 'lucide-react';
import { useBackdropClose } from './modalBackdrop';
import { AnimatePresence } from 'motion/react';
import { TfBackdrop, TfDialog } from './motion/TfMotion';
import { SAVE_REMOVES_PROTECTION_TEXT } from '../security/protection';

interface SaveAsDialogProps {
  open: boolean;
  /** Mirror of AppSettings.saveAsLinearize. The checkbox state is
   *  seeded from this prop on every open. `undefined` is treated
   *  as the default (`false`) — the field is optional in
   *  AppSettings and the dialog tolerates an absent field the
   *  same way the previous `optimizePreset`-based design did. */
  saveAsLinearize: boolean | undefined;
  /** Phase 52 (feature C) — the active document is encrypted, so saving
   *  writes a decrypted copy. The dialog states this explicitly. */
  protectedDocument?: boolean;
  /** Fires when the user flips the linearize checkbox. The host
   *  writes through `set-save-as-linearize` in the preferences
   *  reducer and persists via trackAndSave so the choice survives
   *  across launches. */
  onSaveAsLinearizeChange: (value: boolean) => void;
  /** Fires when the user confirms Save-As. The host calls the
   *  existing engine.saveAs(tabId) IPC — the OS dialog still
   *  handles the path / filename. */
  onConfirm: () => void;
  onClose: () => void;
}

export function SaveAsDialog(props: SaveAsDialogProps): ReactElement | null {
  const { open, saveAsLinearize, protectedDocument, onSaveAsLinearizeChange, onConfirm, onClose } =
    props;

  // Local mirror of the checkbox state, seeded from saveAsLinearize.
  // `undefined` -> false default so the dialog handles the
  // optional-field case gracefully on first open.
  const [linearize, setLinearize] = useState<boolean>(() => saveAsLinearize ?? false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Re-seed on every open + every saveAsLinearize change so the
  // checkbox tracks the persisted value. Without this, opening the
  // dialog after a programmatic toggle would show stale state.
  useEffect(() => {
    if (!open) return;
    setLinearize(saveAsLinearize ?? false);
  }, [open, saveAsLinearize]);

  // Esc closes; focus the first interactive control on open so the
  // keyboard user can tab through immediately.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'input, button, [tabindex]',
    );
    first?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // B3/B6 — backdrop close only when the interaction started on the
  // backdrop (a drag from the linearize checkbox must not dismiss).
  const backdrop = useBackdropClose(onClose);

  

  const onToggleLinearize = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const next = e.target.checked;
    setLinearize(next);
    // Surface the change immediately so the host persists it
    // through the preferences reducer. Same pattern as the
    // Optimize dialog: every toggle surfaces, the reducer's
    // equality guard short-circuits no-op writes.
    onSaveAsLinearizeChange(next);
  };

  const onConfirmClick = (): void => {
    // Make sure the latest toggle state has been written before we
    // fire the OS dialog. The previous effect already wrote on
    // every toggle, but a click-then-immediate-confirm sequence
    // could race the reducer. The local `linearize` is the
    // authoritative source at this moment.
    if (saveAsLinearize !== linearize) {
      onSaveAsLinearizeChange(linearize);
    }
    onConfirm();
  };

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop className="modal-backdrop" {...backdrop}>
      <TfDialog
        className="modal-dialog dialog modal-dialog-tool"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-as-dialog-title"
        data-save-as-dialog
      >
        <div className="modal-header">
          <h2 id="save-as-dialog-title" className="modal-title">
            Save a copy
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-help">
            Pick where to write the file. The OS save dialog opens after you
            confirm; the chosen filename and destination are handled by the
            system.
          </p>
          {protectedDocument === true && (
            <p className="modal-help save-as-decrypt-note" data-save-as-decrypt-note>
              {SAVE_REMOVES_PROTECTION_TEXT}
            </p>
          )}

          <fieldset className="modal-position save-as-linearize">
            <legend>Web optimisation</legend>
            <label className="save-as-linearize-option">
              <input
                type="checkbox"
                checked={linearize}
                onChange={onToggleLinearize}
                data-save-as-linearize
                aria-label="Fast web view (linearize)"
              />
              <span className="save-as-linearize-text">
                <span className="save-as-linearize-label">
                  Fast web view (linearize)
                </span>
                <span className="save-as-linearize-desc">
                  Rewrites the PDF so the first page is available before the
                  rest of the file finishes downloading. Browsers and
                  web-viewers can start rendering immediately.
                </span>
              </span>
            </label>
          </fieldset>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirmClick}
            data-save-as-confirm
          >
            Choose location…
          </button>
        </div>
      </TfDialog>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}