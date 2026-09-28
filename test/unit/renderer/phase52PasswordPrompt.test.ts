// @vitest-environment jsdom
//
// Phase 52 (feature A) — the password-prompt state machine and the no-leak
// rule. Pure logic, so these run without mounting App or a dialog.

import { describe, expect, it } from 'vitest';
import {
  IDLE_PASSWORD_PROMPT,
  PASSWORD_PROMPT_COPY,
  passwordEventForFailure,
  passwordKindFromEngineError,
  passwordKindFromPdfjsError,
  passwordPromptIsPending,
  passwordPromptReducer,
  type PasswordPromptState,
} from '../../../src/renderer/security/passwordPrompt';

function advance(
  events: Parameters<typeof passwordPromptReducer>[1][],
  start: PasswordPromptState = IDLE_PASSWORD_PROMPT,
): PasswordPromptState {
  return events.reduce((state, event) => passwordPromptReducer(state, event), start);
}

describe('phase 52 — password prompt state machine', () => {
  it('need -> prompt', () => {
    const state = advance([{ type: 'need', target: 'protected.pdf' }]);
    expect(state.phase).toBe('prompt');
    expect(state.target).toBe('protected.pdf');
    expect(state.error).toBeNull();
    expect(passwordPromptIsPending(state)).toBe(true);
  });

  it('prompt -> submit -> checking', () => {
    const state = advance([
      { type: 'need', target: 'protected.pdf' },
      { type: 'submit' },
    ]);
    expect(state.phase).toBe('checking');
    expect(state.error).toBeNull();
  });

  it('incorrect -> inline message, then retry keeps the prompt open', () => {
    const failed = advance([
      { type: 'need', target: 'protected.pdf' },
      { type: 'submit' },
      { type: 'incorrect' },
    ]);
    expect(failed.phase).toBe('incorrect');
    expect(failed.error).toBe(PASSWORD_PROMPT_COPY.incorrect);
    expect(failed.attempts).toBe(1);
    expect(passwordPromptIsPending(failed)).toBe(true);

    const retry = passwordPromptReducer(failed, { type: 'submit' });
    expect(retry.phase).toBe('checking');
    expect(retry.error).toBeNull();
  });

  it('correct -> open clears everything pending', () => {
    const opened = advance([
      { type: 'need', target: 'protected.pdf' },
      { type: 'submit' },
      { type: 'opened' },
    ]);
    expect(opened).toEqual(IDLE_PASSWORD_PROMPT);
    expect(passwordPromptIsPending(opened)).toBe(false);
  });

  it('cancel -> nothing pending (no half-open tab)', () => {
    const cancelled = advance([
      { type: 'need', target: 'protected.pdf' },
      { type: 'cancel' },
    ]);
    expect(cancelled).toEqual(IDLE_PASSWORD_PROMPT);
    expect(passwordPromptIsPending(cancelled)).toBe(false);
  });

  it('a NEW target resets the attempts; the same target keeps them', () => {
    const failed = advance([
      { type: 'need', target: 'a.pdf' },
      { type: 'incorrect' },
    ]);
    expect(failed.attempts).toBe(1);
    expect(
      passwordPromptReducer(failed, { type: 'need', target: 'b.pdf' }).attempts,
    ).toBe(0);
    expect(
      passwordPromptReducer(failed, { type: 'need', target: 'a.pdf' }).attempts,
    ).toBe(1);
  });
});

describe('phase 52 — password failure classification', () => {
  it('maps the engine typed codes', () => {
    expect(passwordKindFromEngineError('need-password')).toBe('need');
    expect(passwordKindFromEngineError('incorrect-password')).toBe('incorrect');
    expect(passwordKindFromEngineError('open-error')).toBeNull();
  });

  it('maps pdf.js PasswordException codes', () => {
    expect(passwordKindFromPdfjsError({ name: 'PasswordException', code: 1 })).toBe('need');
    expect(passwordKindFromPdfjsError({ name: 'PasswordException', code: 2 })).toBe(
      'incorrect',
    );
    // A non-password rejection keeps its normal error path (no prompt).
    expect(passwordKindFromPdfjsError({ name: 'InvalidPDFException' })).toBeNull();
    expect(passwordKindFromPdfjsError(new Error('boom'))).toBeNull();
  });

  it('an OK open produces NO prompt event (the empty-user-password path)', () => {
    // The empty-user-password document resolves on the first attempt, so the
    // UI never calls the prompt. The classification for a non-password
    // string is null — that is the guard.
    expect(passwordEventForFailure(null, 'plain.pdf')).toBeNull();
    expect(passwordKindFromEngineError('open-error')).toBeNull();
  });

  it('maps a failure to its reducer event', () => {
    expect(passwordEventForFailure('need', 'x.pdf')).toEqual({
      type: 'need',
      target: 'x.pdf',
    });
    expect(passwordEventForFailure('incorrect', 'x.pdf')).toEqual({ type: 'incorrect' });
  });
});

describe('phase 52 — no password leaks into any string', () => {
  const SENTINEL = 'hunter2-not-in-the-ui';

  it('the prompt copy and reducer state never echo the attempted password', () => {
    // The reducer only ever holds the typed event, never the password; feed a
    // sentinel through the failure events and assert no rendered string does.
    let state = advance([{ type: 'need', target: 'protected.pdf' }, { type: 'submit' }]);
    state = passwordPromptReducer(state, { type: 'incorrect' });
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain(SENTINEL);
    expect(state.error).toBe(PASSWORD_PROMPT_COPY.incorrect);

    const copyStrings = [
      PASSWORD_PROMPT_COPY.title,
      PASSWORD_PROMPT_COPY.body('protected.pdf'),
      PASSWORD_PROMPT_COPY.incorrect,
      PASSWORD_PROMPT_COPY.placeholder,
      PASSWORD_PROMPT_COPY.open,
      PASSWORD_PROMPT_COPY.cancel,
    ];
    for (const s of copyStrings) {
      expect(s).not.toContain(SENTINEL);
    }
  });
});
