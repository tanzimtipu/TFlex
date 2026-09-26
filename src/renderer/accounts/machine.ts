// Phase 44 — the accounts sign-in/sign-up/OTP state machine.
//
// Pure and reducer-shaped so every branch (success, wrong code, expired code,
// network error, unavailable config) is unit-tested without a DOM or the SDK.
// The account surface drives this reducer and renders `banner` verbatim; the
// banner is always non-blocking (a message, never a modal or a thrown error).

import type { AccountsErrorCode } from "../../shared/accounts";

export type AccountsMode = "sign-in" | "sign-up";
export type AccountsStep = "credentials" | "otp";

export interface AccountsBanner {
  tone: "error" | "info";
  text: string;
}

export interface AccountsMachineState {
  mode: AccountsMode;
  step: AccountsStep;
  email: string;
  password: string;
  name: string;
  otp: string;
  busy: boolean;
  banner: AccountsBanner | null;
  /** True once a code has been requested for the current email. */
  otpSent: boolean;
}

export type AccountsMachineAction =
  | { type: "set-mode"; mode: AccountsMode }
  | { type: "set-field"; field: "email" | "password" | "name" | "otp"; value: string }
  | { type: "busy"; value: boolean }
  | { type: "back" }
  | { type: "otp-sent" }
  | { type: "signed-in" }
  | { type: "info"; text: string }
  | { type: "error"; code: AccountsErrorCode }
  | { type: "reset" };

export const initialAccountsState: AccountsMachineState = {
  mode: "sign-in",
  step: "credentials",
  email: "",
  password: "",
  name: "",
  otp: "",
  busy: false,
  banner: null,
  otpSent: false,
};

/** One clear, non-blocking message per error code. */
export function messageForError(code: AccountsErrorCode): string {
  switch (code) {
    case "invalid-credentials":
      return "That email or password is not correct. Check it and try again.";
    case "email-not-verified":
      return "This email still needs verifying. Enter the code we emailed you.";
    case "code-invalid":
      return "That code is not correct. Check the code and try again.";
    case "code-expired":
      return "That code has expired. Resend a new one to continue.";
    case "network-offline":
      return "You appear to be offline. Check your connection and try again.";
    case "server":
      return "Something went wrong. Try again in a moment.";
  }
}

/** Which mode a `set-mode` lands on. Switching modes clears the credentials. */
export function switchedMode(state: AccountsMachineState, mode: AccountsMode): AccountsMachineState {
  if (state.mode === mode) return state;
  return {
    ...initialAccountsState,
    mode,
    email: state.email,
    step: "credentials",
  };
}

export function accountsReducer(
  state: AccountsMachineState,
  action: AccountsMachineAction,
): AccountsMachineState {
  switch (action.type) {
    case "set-mode":
      return switchedMode(state, action.mode);
    case "set-field":
      return { ...state, [action.field]: action.value, banner: null };
    case "busy":
      return { ...state, busy: action.value };
    case "back":
      return { ...state, step: "credentials", otp: "", busy: false, banner: null, otpSent: false };
    case "otp-sent":
      return {
        ...state,
        step: "otp",
        busy: false,
        otpSent: true,
        otp: "",
        banner: { tone: "info", text: `We sent a verification code to ${state.email}.` },
      };
    case "signed-in":
      return { ...initialAccountsState, banner: null };
    case "info":
      return { ...state, busy: false, banner: { tone: "info", text: action.text } };
    case "error":
      return { ...state, busy: false, banner: { tone: "error", text: messageForError(action.code) } };
    case "reset":
      return initialAccountsState;
  }
}
