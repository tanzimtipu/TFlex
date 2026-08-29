// Phase 8 — Save-As modal (file size reduction linearize toggle).
//
// A renderer-side modal that appears when the user clicks Save-As.
// The user can opt in to "Fast web view (linearize)" before the OS
// save dialog opens; the choice persists across launches by writing
// through the existing `optimizePreset` AppSettings field.
//
// Why piggy-back on optimizePreset (DEF-040)?
//   The Settings impact rule in AGENTS.md requires every new
//   AppSettings field to ship with backend validation in
//   src/main/services/settings.ts. Frontend-dev can't edit main, so
//   we route through the existing optimizePreset field instead:
//     - toggle ON  -> optimizePreset = 'none'  (linearized output)
//     - toggle OFF -> optimizePreset = 'compact' (default compression)
//   The Optimize dialog reads the same field, so the two flows stay
//   in sync — if the user picks 'max' in Optimize, the Save-As
//   toggle starts OFF; if they tick the toggle, the Optimize dialog
//   will open with 'none' pre-selected.
//
// Why a renderer modal (and not the OS dialog's native extras)?
//   The backend's engineSaveAs IPC handler pops the OS dialog
//   directly. We can't inject extra controls there from the
//   renderer. The cleanest path is to surface our own modal first,
//   persist the choice, and then fire the existing engine.saveAs
//   call as before. The OS dialog still handles the path + filename.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { X } from 'lucide-react';
import type { OptimizePreset } from '../../shared/types';
import { DEFAULT_OPTIMIZE_PRESET, OPTIMIZE_PRESETS } from '../state/preferences';

interface SaveAsDialogProps {
  open: boolean;
  /** Mirror of AppSettings.optimizePreset. 'none' means the
   *  linearize toggle should default ON; any other value means
   *  OFF. The dialog re-syncs from this prop every time it opens. */
  optimizePreset: OptimizePreset | undefined;
  /** Fires when the user flips the linearize checkbox. The host
   *  dispatches `preferencesReducer(prev, {type: 'set-optimize-preset',
   *  value: 'none' | 'compact'})` and writes through trackAndSave.
   *  The value is `'none'` when the toggle is on, `'compact'` when off. */
  onOptimizePresetChange: (preset: OptimizePreset) => void;
  /** Fires when the user confirms Save-As. The host calls the
   *  existing engine.saveAs(tabId) IPC — the OS dialog still
   *  handles the path / filename. */
  onConfirm: () => void;
  onClose: () => void;
}

/** Map a toggle boolean to the optimizePreset enum. Centralised so
 *  the renderer never branches on raw strings and the field stays
 *  the single source of truth for the linearize preference. */
export function linearizeToggleToPreset(on: boolean): OptimizePreset {
  return on ? 'none' : 'compact';
}

/** Inverse of `linearizeToggleToPreset`. Anything other than 'none'
 *  counts as "not linearized"; the Optimize dialog has a richer
 *  surface (none / compact / max) but the Save-As toggle only has
 *  two states, so 'compact' and 'max' both map to toggle=off. */
export function presetToLinearizeToggle(
  preset: OptimizePreset | undefined,
): boolean {
  return preset === 'none';
}

export function SaveAsDialog(props: SaveAsDialogProps): ReactElement | null {
  const { open, optimizePreset, onOptimizePresetChange, onConfirm, onClose } =
    props;

  // Local mirror of the checkbox state, seeded from optimizePreset.
  // The dialog re-seeds whenever it opens so the latest persisted
  // value is what the user sees — the Settings sheet or a previous
  // Save-As session might have changed it since the last render.
  const [linearize, setLinearize] = useState<boolean>(() =>
    presetToLinearizeToggle(optimizePreset),
  );
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Re-seed on every open + every optimizePreset change so the
  // checkbox tracks the persisted value. Without this, opening the
  // dialog after a programmatic preset change would show stale
  // state (DEF-040 verification: restart picks up the persisted
  // value via the same prop).
  useEffect(() => {
    if (!open) return;
    setLinearize(presetToLinearizeToggle(optimizePreset));
  }, [open, optimizePreset]);

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

  if (!open) return null;

  const onToggleLinearize = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const next = e.target.checked;
    setLinearize(next);
    // Surface the change immediately so the host persists it
    // through the preferences reducer. Same pattern as the
    // Optimize dialog: every toggle surfaces, the reducer's
    // equality guard short-circuits no-op writes.
    onOptimizePresetChange(linearizeToggleToPreset(next));
  };

  const onConfirmClick = (): void => {
    // Make sure the latest toggle state has been written before we
    // fire the OS dialog. The previous effect already wrote on
    // every toggle, but a click-then-immediate-confirm sequence
    // could race the reducer. The local `linearize` is the
    // authoritative source at this moment.
    if (presetToLinearizeToggle(optimizePreset) !== linearize) {
      onOptimizePresetChange(linearizeToggleToPreset(linearize));
    }
    onConfirm();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
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
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-help">
            Pick where to write the file. The OS save dialog opens after you
            confirm; the chosen filename and destination are handled by the
            system.
          </p>

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
      </div>
    </div>
  );
}

/** Re-export the constants that the host's reducer depends on so
 *  callers can wire the dialog through the same module path as the
 *  Optimize dialog. The `OPTIMIZE_PRESETS` array doubles as the
 *  validator allowlist — the dialog only ever writes 'none' or
 *  'compact' through `linearizeToggleToPreset`, so the array isn't
 *  used directly here, but exposing it keeps the import surface
 *  consistent with OptimizeDialog. */
export { DEFAULT_OPTIMIZE_PRESET, OPTIMIZE_PRESETS };
