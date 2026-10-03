// Phase 52 (feature A) — the password prompt dialog.
//
// A small, focused modal shown when an open reports `need-password` or
// `incorrect-password`. It owns only the transient input; the host owns the
// pending open and the prompt state machine. A failed attempt clears the
// field and shows the reducer's inline sentence (which never contains the
// attempted password).
//
// Motion: the shared dialog surfaces animate through the centralised motion
// system (TfBackdrop / TfDialog), which consume the motion tokens
// (--motion-duration-* / --motion-ease-*, see hooks/motionTokens.ts).

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { KeyRound } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { DialogShell, type DialogAction } from './DialogShell';
import { PASSWORD_PROMPT_COPY } from '../security/passwordPrompt';

export interface PasswordPromptDialogProps {
  open: boolean;
  /** Display name of the document being opened. */
  target: string;
  /** Inline error sentence from the state machine, or null. */
  error: string | null;
  /** True while a retry is in flight; the input and buttons lock. */
  busy: boolean;
  /** Failed-attempt counter; a change clears the field. */
  attempts: number;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export function PasswordPromptDialog(
  props: PasswordPromptDialogProps,
): ReactElement | null {
  const { open, target, error, busy, attempts, onSubmit, onCancel } = props;
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Clear the field whenever the dialog opens or a failed attempt lands, so
  // a wrong password is never left on screen to be resubmitted or read.
  useEffect(() => {
    if (!open) {
      setValue('');
      return;
    }
    if (error !== null) {
      setValue('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attempts, error]);

  // Focus the input on open / after a failure so the user can retry at once.
  useEffect(() => {
    if (!open) return;
    queueMicrotask((): void => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open, attempts]);

  const submit = (): void => {
    if (busy) return;
    const password = value;
    // The host decides correctness; we only forward the typed value.
    onSubmit(password);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  // Actions render in order (cancel then confirm, primary right-most). The
  // extra hyphenated key is the pre-Phase-92 e2e hook; Object.assign keeps
  // it typed as the canonical DialogAction while carrying it at runtime.
  const actions: DialogAction[] = [
    {
      key: 'cancel',
      label: PASSWORD_PROMPT_COPY.cancel,
      variant: 'secondary',
      onClick: onCancel,
      disabled: busy,
    },
    Object.assign(
      {
        key: 'confirm',
        label: busy ? PASSWORD_PROMPT_COPY.checking : PASSWORD_PROMPT_COPY.open,
        variant: 'primary' as const,
        onClick: submit,
        disabled: busy || value.length === 0,
      },
      { 'data-password-submit': true },
    ),
  ];

  return (
    <DialogShell
      open={open}
      title={PASSWORD_PROMPT_COPY.title}
      titleId="password-prompt-title"
      size="tool"
      className="password-prompt"
      icon={<Icon icon={KeyRound} size="sm" />}
      onClose={onCancel}
      closeAriaLabel="Cancel"
      blockBackdropClose={busy}
      closeDisabled={busy}
      onKeyDown={onKeyDown}
      actions={actions}
      data-password-prompt
    >
      <p className="modal-help">{PASSWORD_PROMPT_COPY.body(target)}</p>
      <label className="modal-field">
        <span>{PASSWORD_PROMPT_COPY.label}</span>
        <input
          ref={inputRef}
          className="modal-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={PASSWORD_PROMPT_COPY.placeholder}
          value={value}
          disabled={busy}
          onChange={(e): void => setValue(e.target.value)}
          data-password-input
        />
      </label>
      {error !== null && (
        <div className="modal-status optimize-error" role="alert" data-password-error>
          <span>{error}</span>
        </div>
      )}
    </DialogShell>
  );
}
