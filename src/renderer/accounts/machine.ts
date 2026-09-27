// Phase 44 — the accounts sign-in/sign-up/OTP state machine.
//
// Pure and reducer-shaped so every branch (success, wrong code, expired code,
// network error, unavailable config) is unit-tested without a DOM or the SDK.
// The account surface drives this reducer and renders `banner` verbatim; the
// banner is always non-blocking (a message, never a modal or a thrown error).

import type { AccountsErrorCode } from "../../shared/accounts";

export type AccountsMode = "sign-in" | "sign-up";
export type AccountsStep = "credentials" | "otp" | "reset-request" | "reset-confirm";

export interface AccountsBanner {
  tone: "error" | "info";
  text: string;
}

/** The provider's own diagnosis, carried alongside the coarse code so the
 *  surface can show WHY instead of a generic "something went wrong".
 *  `detail` is the provider's `message`, `providerCode` its `code`. Both are
 *  plain data from the auth service; the UI renders them as text, never as a
 *  source of behaviour. */
export interface AccountsErrorInfo {
  detail?: string;
  providerCode?: string;
}

export interface AccountsMachineState {
  mode: AccountsMode;
  step: AccountsStep;
  email: string;
  password: string;
  name: string;
  otp: string;
  /** Phase 45 - the reset code emailed for the forgot-password flow. */
  resetCode: string;
  /** Phase 45 - the new password entered on the reset-confirm step. */
  newPassword: string;
  busy: boolean;
  banner: AccountsBanner | null;
  /** True once a code has been requested for the current email. */
  otpSent: boolean;
  /** Phase 45 - true once a password-reset code has been requested. */
  resetSent: boolean;
}

export type AccountsMachineAction =
  | { type: "set-mode"; mode: AccountsMode }
  | { type: "set-field"; field: "email" | "password" | "name" | "otp" | "resetCode" | "newPassword"; value: string }
  | { type: "busy"; value: boolean }
  | { type: "back" }
  | { type: "otp-sent" }
  | { type: "open-reset" }
  | { type: "reset-sent" }
  | { type: "reset-done" }
  | { type: "signed-in" }
  | { type: "info"; text: string }
  | { type: "error"; code: AccountsErrorCode; detail?: string; providerCode?: string }
  | { type: "reset" };

export const initialAccountsState: AccountsMachineState = {
  mode: "sign-in",
  step: "credentials",
  email: "",
  password: "",
  name: "",
  otp: "",
  resetCode: "",
  newPassword: "",
  busy: false,
  banner: null,
  otpSent: false,
  resetSent: false,
};

/** Turn the provider's zod path syntax into a field label a person can read:
 *  `[body.name] Invalid input: expected string, received undefined` becomes
 *  `Name: Invalid input: expected string, received undefined`. Unknown paths
 *  are left as-is. */
function humanizeFieldMessage(detail: string): string {
  const match = /^\[body\.([A-Za-z0-9_]+)]\s*(.*)$/.exec(detail.trim());
  if (match === null) return detail.trim();
  const field = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  return `${field}: ${match[2]}`;
}

/**
 * One clear, non-blocking message per error code. When the provider gave a
 * code/message, it is surfaced verbatim (via `info`) instead of the generic
 * copy, so the operator can see WHY. The coarse code still chooses the shape
 * of the sentence; `invalid-credentials` keeps its exact wording (a wrong
 * password is already the precise reason).
 */
/** The provider codes that genuinely mean "these credentials are wrong". A
 *  401/403 carrying any OTHER code is a different failure (a rejected redirect
 *  URL, a disabled provider...) and must not be reported as a wrong password. */
const CREDENTIAL_ERROR_CODES = new Set([
  "INVALID_EMAIL_OR_PASSWORD",
  "INVALID_CREDENTIALS",
  "USER_NOT_FOUND",
]);

export function messageForError(code: AccountsErrorCode, info?: AccountsErrorInfo): string {
  const providerCode = (info?.providerCode ?? "").toUpperCase();
  const detail = (info?.detail ?? "").trim();

  if (code === "invalid-credentials") {
    // Only claim the credentials are wrong when the provider says so (or says
    // nothing specific). Otherwise fall through and show its real reason.
    if (providerCode.length === 0 || CREDENTIAL_ERROR_CODES.has(providerCode)) {
      return "That email or password is not correct. Check it and try again.";
    }
  }

  // Provider-specific reasons, most precise first.
  if (providerCode === "VALIDATION_ERROR" && detail.length > 0) {
    return `The account service rejected that: ${humanizeFieldMessage(detail)}`;
  }
  if (providerCode === "PASSWORD_TOO_SHORT") {
    return "That password is too short. Use at least 8 characters.";
  }
  if (providerCode === "PASSWORD_TOO_LONG") {
    return "That password is too long. Use a shorter one.";
  }
  if (providerCode === "INVALID_EMAIL") {
    return "That email address was not accepted. Check it and try again.";
  }
  if (providerCode === "INVALID_PASSWORD") {
    return "That password was not accepted. Check it and try again.";
  }
  if (providerCode === "USER_ALREADY_EXISTS" || providerCode === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
    return "That email already has an account. Sign in with it instead, or use a different email.";
  }
  if (providerCode === "EMAIL_PASSWORD_SIGN_UP_DISABLED") {
    return "Email and password sign-up is not enabled for this app.";
  }
  if (providerCode === "PROVIDER_NOT_FOUND") {
    return "Google sign-in is not enabled for this app yet. Use email and password instead.";
  }
  if (providerCode === "BAD_OAUTH_CALLBACK") {
    // Captured live from the production branch: the renderer is a file://
    // page, so the SDK's callback address is the relative string "null" and
    // the provider refuses to build the OAuth URL.
    return `Social sign-in could not start: ${detail.length > 0 ? detail : "the callback address was rejected"} (BAD_OAUTH_CALLBACK).`;
  }
  if (providerCode === "EMAIL_NOT_VERIFIED" || code === "email-not-verified") {
    return "This email still needs verifying. Enter the code we emailed you.";
  }
  if (code === "code-invalid") return "That code is not correct. Check the code and try again.";
  if (code === "code-expired") return "That code has expired. Resend a new one to continue.";
  if (code === "network-offline") return "You appear to be offline. Check your connection and try again.";

  // Any other provider message/code is shown verbatim rather than swallowed.
  if (detail.length > 0) {
    const suffix = providerCode.length > 0 ? ` (${providerCode})` : "";
    return `The account service returned an error: ${detail}${suffix}`;
  }
  // Phase 45 - reached with connectivity present (a blocked or refused
  // request). Deliberately NOT worded as an offline error.
  return "Something went wrong. Try again in a moment.";
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
      return {
        ...state,
        step: "credentials",
        otp: "",
        resetCode: "",
        newPassword: "",
        busy: false,
        banner: null,
        otpSent: false,
        resetSent: false,
      };
    case "otp-sent":
      return {
        ...state,
        step: "otp",
        busy: false,
        otpSent: true,
        otp: "",
        banner: {
          tone: "info",
          // A sign-up for an address that already has an account returns the
          // provider's anti-enumeration synthetic 200 (a user object, but no
          // new row). It is indistinguishable from a real creation, so the
          // copy stays honest about both possibilities instead of claiming a
          // new account was made.
          text:
            state.mode === "sign-up"
              ? `We sent a verification code to ${state.email}. If that address already had an account, sign in with it instead.`
              : `We sent a verification code to ${state.email}.`,
        },
      };
    case "open-reset":
      return {
        ...state,
        step: "reset-request",
        busy: false,
        banner: null,
        resetSent: false,
        resetCode: "",
        newPassword: "",
      };
    case "reset-sent":
      return {
        ...state,
        step: "reset-confirm",
        busy: false,
        resetSent: true,
        resetCode: "",
        banner: { tone: "info", text: `We sent a password reset code to ${state.email}.` },
      };
    case "reset-done":
      // The reset succeeded: return to sign-in with a positive banner, keeping
      // the email so the user only has to type the new password.
      return {
        ...initialAccountsState,
        mode: state.mode,
        email: state.email,
        banner: { tone: "info", text: "Password updated. Sign in with your new password." },
      };
    case "signed-in":
      return { ...initialAccountsState, banner: null };
    case "info":
      return { ...state, busy: false, banner: { tone: "info", text: action.text } };
    case "error":
      return {
        ...state,
        busy: false,
        banner: {
          tone: "error",
          text: messageForError(action.code, {
            detail: action.detail,
            providerCode: action.providerCode,
          }),
        },
      };
    case "reset":
      return initialAccountsState;
  }
}
