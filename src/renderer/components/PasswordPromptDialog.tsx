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
import { AnimatePresence } from 'motion/react';
import { KeyRound, X } from 'lucide-react';
import { useBackdropClose } from './modalBackdrop';
import { TfBackdrop, TfDialog } from './motion/TfMotion';
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
  const backdrop = useBackdropClose(onCancel, busy);

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

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop
          className="modal-backdrop"
          {...backdrop}
          data-password-prompt
        >
          <TfDialog
            className="modal-dialog dialog modal-dialog-tool password-prompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="password-prompt-title"
            onClick={(e): void => e.stopPropagation()}
            onKeyDown={(e): void => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          >
            <div className="modal-header">
              <h2 id="password-prompt-title" className="modal-title">
                <KeyRound size={16} aria-hidden /> {PASSWORD_PROMPT_COPY.title}
              </h2>
              <button
                type="button"
                className="modal-close"
                onClick={onCancel}
                aria-label="Cancel"
                disabled={busy}
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="modal-body">
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
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onCancel}
                disabled={busy}
              >
                {PASSWORD_PROMPT_COPY.cancel}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={submit}
                disabled={busy || value.length === 0}
                data-password-submit
              >
                {busy ? PASSWORD_PROMPT_COPY.checking : PASSWORD_PROMPT_COPY.open}
              </button>
            </div>
          </TfDialog>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}
