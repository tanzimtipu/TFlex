// Phase 52 (feature A) — the password-prompt state machine.
//
// A document that returns `need-password` / `incorrect-password` from the
// edit-path open (or a pdf.js PasswordException on the display path) must
// NOT leave a half-open tab or a toast: it opens this small prompt instead.
// The machine is PURE and async-free so every transition (need -> prompt ->
// correct -> open, incorrect -> retry, cancel -> nothing pending) is
// unit-testable without touching IPC or React.
//
// Password handling rules encoded here:
//   - a wrong attempt never echoes the attempted password (the reducer only
//     ever holds a human sentence, never the input);
//   - cancelling clears the pending open so no tab is created;
//   - a successful open returns to `idle` (nothing pending).

import type { EngineOpenError, PdfOpenError } from '../../shared/types';

/** The password failure the renderer reacts to. Mirrors pdf.js's
 *  `PasswordResponses.NEED_PASSWORD` / `INCORRECT_PASSWORD` and the engine's
 *  typed `PasswordError` so both open paths speak one language. */
export type PasswordPromptKind = 'need' | 'incorrect';

export type PasswordPromptPhase = 'idle' | 'prompt' | 'checking' | 'incorrect';

export interface PasswordPromptState {
  phase: PasswordPromptPhase;
  /** Display name of the document being opened, for the prompt copy. */
  target: string;
  /** Inline error sentence for a failed attempt. NEVER the password. */
  error: string | null;
  /** How many failed attempts the user has made. */
  attempts: number;
}

/** The exact user-facing copy. Kept in one place so tests can pin it and
 *  the no-password-leak rule is easy to audit. */
export const PASSWORD_PROMPT_COPY = {
  title: 'Password required',
  body: (target: string): string =>
    target.length > 0
      ? `"${target}" is password-protected. Enter its password to open it.`
      : 'This document is password-protected. Enter its password to open it.',
  label: 'Password',
  placeholder: 'Document password',
  open: 'Open',
  cancel: 'Cancel',
  incorrect: 'That password did not open the document. Try again.',
  checking: 'Checking\u2026',
} as const;

export const IDLE_PASSWORD_PROMPT: PasswordPromptState = {
  phase: 'idle',
  target: '',
  error: null,
  attempts: 0,
};

export type PasswordPromptEvent =
  /** Open reported `need-password` (no or empty password supplied). */
  | { type: 'need'; target: string }
  /** The user submitted; the retry is in flight. */
  | { type: 'submit' }
  /** The retry returned `incorrect-password`. */
  | { type: 'incorrect' }
  /** The retry returned `need-password` again (defensive). */
  | { type: 'need-again' }
  /** The open succeeded — nothing is pending. */
  | { type: 'opened' }
  /** The user dismissed the prompt. */
  | { type: 'cancel' };

/** True while an open is waiting on a password. */
export function passwordPromptIsPending(state: PasswordPromptState): boolean {
  return state.phase !== 'idle';
}

export function passwordPromptReducer(
  state: PasswordPromptState,
  event: PasswordPromptEvent,
): PasswordPromptState {
  switch (event.type) {
    case 'need':
      // Re-entering `need` on the SAME target keeps any attempts already
      // made (a defensive re-prompt); a new target resets them.
      return {
        phase: 'prompt',
        target: event.target,
        error: null,
        attempts: state.target === event.target ? state.attempts : 0,
      };
    case 'submit':
      if (state.phase === 'idle') return state;
      return { ...state, phase: 'checking', error: null };
    case 'incorrect':
      if (state.phase === 'idle') return state;
      return {
        ...state,
        phase: 'incorrect',
        error: PASSWORD_PROMPT_COPY.incorrect,
        attempts: state.attempts + 1,
      };
    case 'need-again':
      if (state.phase === 'idle') return state;
      return { ...state, phase: 'prompt', error: null };
    case 'opened':
      return IDLE_PASSWORD_PROMPT;
    case 'cancel':
      return IDLE_PASSWORD_PROMPT;
  }
}

/** The engine's typed open error maps 1:1 onto a prompt kind; `open-error`
 *  and any non-password code do NOT prompt. */
export function passwordKindFromEngineError(
  code: EngineOpenError | PdfOpenError,
): PasswordPromptKind | null {
  if (code === 'need-password') return 'need';
  if (code === 'incorrect-password') return 'incorrect';
  return null;
}

/** Classify a pdf.js rejection. `code` is pdf.js's `PasswordResponses`
 *  (NEED_PASSWORD = 1, INCORRECT_PASSWORD = 2) when the error is a
 *  `PasswordException`; anything else returns null so a corrupt/not-pdf
 *  failure keeps its normal error path. */
export function passwordKindFromPdfjsError(error: unknown): PasswordPromptKind | null {
  const name = (error as { name?: unknown } | null)?.name;
  if (name !== 'PasswordException') return null;
  const code = (error as { code?: unknown }).code;
  if (code === 2) return 'incorrect';
  // NEED_PASSWORD (1) and any code-less PasswordException both mean
  // "a password is required".
  return 'need';
}

/** Build the reducer event for an open attempt that failed with a password
 *  code, or null when the failure is not a password failure. `target` names
 *  the document for the prompt copy. */
export function passwordEventForFailure(
  kind: PasswordPromptKind | null,
  target: string,
): PasswordPromptEvent | null {
  if (kind === null) return null;
  return kind === 'need' ? { type: 'need', target } : { type: 'incorrect' };
}
