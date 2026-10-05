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
import { Icon } from '../icons/Icon';
import type {
  EncryptDefaults,
  EncryptDocumentOptions,
  EncryptPermissions,
} from '../../shared/types';
import { DialogShell, type DialogAction } from './DialogShell';
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

  const actions: DialogAction[] = [
    {
      key: 'cancel',
      label: 'Cancel',
      variant: 'secondary',
      onClick: onClose,
      disabled: busy,
    },
    Object.assign(
      {
        key: 'confirm',
        label: busy ? 'Encrypting\u2026' : 'Encrypt',
        variant: 'primary' as const,
        icon: <Icon name="encrypt" size="sm" />,
        onClick: submit,
        disabled: busy,
        default: true,
      },
      { 'data-encrypt-confirm': true },
    ),
  ];

  return (
    <DialogShell
      open={open}
      title="Encrypt document"
      titleId="encrypt-dialog-title"
      icon={<Icon name="encrypt" size="sm" />}
      size="tool"
      className="encrypt-dialog modal-dialog-wide"
      onClose={onClose}
      blockBackdropClose={busy}
      closeDisabled={busy}
      actions={actions}
      data-encrypt-dialog
    >
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
    </DialogShell>
  );
}
