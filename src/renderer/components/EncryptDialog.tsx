// Phase 52 (feature D) — the Encrypt document dialog.
//
// Collects a user password (required), an optional owner password, the
// algorithm (AES-256 default, AES-128) and the eight permission toggles. On
// confirm the host calls `engine.encryptDocument` and writes the returned
// bytes through the existing bytes-save flow; this dialog never touches IPC
// itself and never persists a password.
//
// The remembered defaults (algorithm + toggles) seed the next open; the
// password fields always start empty.
//
// Motion: TfBackdrop / TfDialog (centralised motion system).

import { useEffect, useState, type ReactElement } from 'react';
import { AnimatePresence } from 'motion/react';
import { Lock, X } from 'lucide-react';
import { Icon } from '../icons/Icon';
import type {
  EncryptDefaults,
  EncryptDocumentOptions,
  EncryptPermissions,
} from '../../shared/types';
import { useBackdropClose } from './modalBackdrop';
import { TfBackdrop, TfDialog } from './motion/TfMotion';
import { PERMISSION_FIELDS } from '../security/protection';
import {
  ENCRYPT_ALGORITHM_LABELS,
  buildEncryptOptions,
  encryptDefaultsFromOptions,
  formValuesFromDefaults,
  type EncryptFormValues,
} from '../security/encrypt';

export interface EncryptDialogConfirm {
  options: EncryptDocumentOptions;
  /** Password-free defaults to remember (algorithm + permissions). */
  defaults: EncryptDefaults;
}

export interface EncryptDialogProps {
  open: boolean;
  defaults: EncryptDefaults;
  /** True while the engine is producing the encrypted bytes. */
  busy: boolean;
  onConfirm: (confirm: EncryptDialogConfirm) => void;
  onClose: () => void;
}

export function EncryptDialog(props: EncryptDialogProps): ReactElement | null {
  const { open, defaults, busy, onConfirm, onClose } = props;
  const [form, setForm] = useState<EncryptFormValues>(() =>
    formValuesFromDefaults(defaults),
  );
  const [error, setError] = useState<string | null>(null);
  const backdrop = useBackdropClose(onClose, busy);

  // Re-seed on open with the persisted defaults (passwords always empty).
  useEffect(() => {
    if (!open) return;
    setForm(formValuesFromDefaults(defaults));
    setError(null);
    // Only re-seed when the dialog opens, not on every defaults identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = (next: Partial<EncryptFormValues>): void => {
    setForm((prev) => ({ ...prev, ...next }));
  };

  const togglePermission = (key: keyof EncryptPermissions): void => {
    setForm((prev) => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: !prev.permissions[key] },
    }));
  };

  const submit = (): void => {
    if (busy) return;
    const built = buildEncryptOptions(form);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    onConfirm({
      options: built.options,
      defaults: encryptDefaultsFromOptions(built.options),
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop className="modal-backdrop" {...backdrop} data-encrypt-dialog>
          <TfDialog
            className="modal-dialog modal-dialog-wide dialog modal-dialog-tool encrypt-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="encrypt-dialog-title"
            onClick={(e): void => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="encrypt-dialog-title" className="modal-title">
                <Icon icon={Lock} size="sm" /> Encrypt document
              </h2>
              <button
                type="button"
                className="btn btn-ghost btn-icon modal-close"
                onClick={onClose}
                aria-label="Close dialog"
                title="Close dialog"
                disabled={busy}
              >
                <Icon icon={X} size="sm" />
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-help">
                Produces an encrypted copy of the document. Anyone opening it
                must enter the user password. The original document is not
                changed.
              </p>

              <label className="modal-field">
                <span>User password</span>
                <input
                  className="modal-input"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={form.userPassword}
                  disabled={busy}
                  onChange={(e): void => patch({ userPassword: e.target.value })}
                  data-encrypt-user-password
                />
              </label>

              <label className="modal-field">
                <span>Owner password (optional)</span>
                <input
                  className="modal-input"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder="Defaults to the user password"
                  value={form.ownerPassword}
                  disabled={busy}
                  onChange={(e): void => patch({ ownerPassword: e.target.value })}
                  data-encrypt-owner-password
                />
              </label>

              <fieldset className="modal-position">
                <legend>Encryption</legend>
                {(['aes-256', 'aes-128'] as const).map((algorithm) => (
                  <label key={algorithm}>
                    <input
                      type="radio"
                      name="encrypt-algorithm"
                      checked={form.algorithm === algorithm}
                      onChange={(): void => patch({ algorithm })}
                      disabled={busy}
                      data-encrypt-algorithm={algorithm}
                    />
                    <span>{ENCRYPT_ALGORITHM_LABELS[algorithm]}</span>
                  </label>
                ))}
              </fieldset>

              <fieldset className="modal-position encrypt-permissions">
                <legend>Permissions</legend>
                <p className="modal-hint">
                  These flags are written into the file. Some readers ignore
                  them; Jovrel itself does not enforce them.
                </p>
                {PERMISSION_FIELDS.map((field) => (
                  <label key={field.key}>
                    <input
                      type="checkbox"
                      checked={form.permissions[field.key]}
                      onChange={(): void => togglePermission(field.key)}
                      disabled={busy}
                      data-encrypt-permission={field.key}
                    />
                    <span>{field.label}</span>
                  </label>
                ))}
              </fieldset>

              {error !== null && (
                <div className="modal-status optimize-error" role="alert" data-encrypt-error>
                  <span>{error}</span>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={submit}
                disabled={busy}
                data-encrypt-confirm
              >
                <Icon icon={Lock} size="sm" />
                {busy ? 'Encrypting\u2026' : 'Encrypt'}
              </button>
            </div>
          </TfDialog>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}
