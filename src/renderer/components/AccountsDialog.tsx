// Phase 44 — the account surface (sign in / sign up / OTP / signed-in).
//
// Opens from the top bar ONLY when the `accountsEnabled` settings flag is on
// (App gates the control and this dialog on it; nothing about accounts is
// reachable while it is off). The layout is the shared AnimatedDialog sheet:
// Bloom In/Out on the box + Backdrop Fade, both from the centralised motion
// tokens, identical across light/dark/frosted. Banner and sync-status changes
// animate through usePopAnimation (tokens only, transform/opacity, reduced
// motion fallback).
//
// The SDK never appears here: the component talks to `AccountsAuthAdapter`
// (see accounts/adapter.ts), which the tests replace with a fake.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactElement } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, LogOut, RefreshCcw, UserPlus } from "lucide-react";
import { Icon } from "../icons/Icon";
import type {
  AccountStatus,
  AccountStatusResult,
  AccountUser,
  AccountsErrorCode,
  OpenAuthUrlResult,
  SyncReport,
} from "../../shared/accounts";
import type { AccountsAuthAdapter } from "../accounts/adapter";
import { createNeonAuthAdapter } from "../accounts/adapter";
import { accountsBridge } from "../accounts/bridge";
import {
  resetRedirectUrl,
  runGoogleSignIn,
  type GoogleSignInHandle,
} from "../accounts/oauthLoopback";
import {
  accountsReducer,
  initialAccountsState,
  type AccountsBanner,
} from "../accounts/machine";
import {
  credentialsFieldError,
  isValidEmail,
  MIN_PASSWORD_LENGTH,
} from "../accounts/validation";
import { describeSyncReport } from "../accounts/syncStatus";
import { requestAutoSync } from "../accounts/autoSync";
import { AnimatedDialog } from "./AnimatedDialog";
import { Button } from "./Button";
import { TfResize } from "./motion/TfResize";
import { BrandLoader } from "./BrandLoader";
import { BrandMark } from "./BrandMark";
import { BrandWordmark } from "./BrandWordmark";
import { usePopAnimation, type MotionVariantSet } from "../hooks/useAnimations";

export interface AccountsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Test seam: build the adapter from the config base URL. Defaults to the
   *  real Neon SDK adapter. */
  createAdapter?: (baseUrl: string) => AccountsAuthAdapter;
/** Reports the coarse status + email (and the display name when the adapter
   *  returned one) so the host can label the top-bar account control without
   *  duplicating the bridge reads. */
  onStatusChange?: (status: AccountStatus, email: string | null, name: string | null) => void;
}

type ConfigState = "loading" | "ready" | "unconfigured";

/** Read-only marker for the deferred data-management actions (item 6). */
export const DEFERRED_REASON = "Coming with the sync release";

/** A non-blocking message strip; enters/exits on the shared pop tokens. */
function Banner({ banner, variants }: { banner: AccountsBanner | null; variants: MotionVariantSet }): ReactElement {
  return (
    <AnimatePresence initial={false}>
      {banner !== null && (
        <motion.p
          key={banner.text}
          className={`accounts-banner accounts-banner-${banner.tone}`}
          role="status"
          data-accounts-banner={banner.tone}
          variants={variants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {banner.text}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/**
 * The Google "G" mark, inline (no network fetch, so it renders offline).
 * This is a PROVIDER brand mark, not a tool icon: it is an SVG rather than a
 * Lucide glyph and is therefore not a participant in the icon-identity guard,
 * while still being visually distinct from every tool icon in the app.
 */
function GoogleMark(): ReactElement {
  return (
    <svg
      className="accounts-google-mark"
      viewBox="0 0 18 18"
      width="16"
      height="16"
      aria-hidden
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

export function AccountsDialog(props: AccountsDialogProps): ReactElement {
  const { open, onClose, createAdapter, onStatusChange } = props;
  const [state, dispatch] = useReducer(accountsReducer, initialAccountsState);
  const [configState, setConfigState] = useState<ConfigState>("loading");
  const [authBaseUrl, setAuthBaseUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<AccountStatus>("signed-out");
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [syncReport, setSyncReport] = useState<SyncReport | null>(null);
  const [syncing, setSyncing] = useState(false);
  const bannerPop = usePopAnimation({ scale: false });
  // Latest status callback in a ref so an inline host handler never re-runs
  // the load effect.
  const statusCbRef = useRef(onStatusChange);
  statusCbRef.current = onStatusChange;
  // Phase 46 - the in-flight Google flow (if any), so a closing dialog or an
  // unmount can release the loopback listener instead of leaking it. Phase 50
  // no longer opens an in-app popup, so there is no window to close.
  const googleFlowRef = useRef<GoogleSignInHandle | null>(null);
  // The adapter is built once per config base URL (memoised so a re-render
  // never rebuilds the SDK client).
  const adapter = useMemo(
    () => (authBaseUrl === null ? null : (createAdapter ?? createNeonAuthAdapter)(authBaseUrl)),
    [authBaseUrl, createAdapter],
  );

  // Reset the flow and (re)load config + status whenever the surface opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    dispatch({ type: "reset" });
    setSyncReport(null);
    setConfigState("loading");
    const api = accountsBridge();
    if (api === null) {
      // No bridge (preload not wired / jsdom): the feature is simply not
      // configured. This is a disabled state, never a server error.
      setConfigState("unconfigured");
      return (): void => {
        cancelled = true;
      };
    }
    void api.getConfig().then((config) => {
      if (cancelled) return;
      if (!config.configured || config.authBaseUrl === null) {
        setConfigState("unconfigured");
        return;
      }
      setAuthBaseUrl(config.authBaseUrl);
      setConfigState("ready");
    }).catch(() => {
      if (!cancelled) setConfigState("unconfigured");
    });
    void api.getStatus().then((result) => {
      if (cancelled) return;
      setStatus(result.status);
      setSignedInEmail(result.email);
      // Feed the stored name through too, so opening the surface on a
      // cold-boot session never downgrades the top-bar avatar to the email
      // letter. `result.name` is null for a legacy session (unknown).
      statusCbRef.current?.(result.status, result.email, result.name);
    }).catch(() => undefined);
    const unsubscribe = typeof api.onSyncReport === "function"
      ? api.onSyncReport((report) => {
        if (!cancelled) setSyncReport(report);
      })
      : (): void => undefined;
    return (): void => {
      cancelled = true;
      unsubscribe();
      // Phase 46 - leaving the surface (close or unmount) abandons any
      // in-flight Google flow: the loopback listener is released, so nothing
      // outlives the dialog. (Phase 50: the browser it opened is the user's
      // own and is left alone.)
      googleFlowRef.current?.cancel();
      googleFlowRef.current = null;
    };
  }, [open]);

  /** Hand the identity + JWT to main (which encrypts and stores it), then
   *  flip the local surface to its signed-in state. The token is never kept. */
  const completeSignIn = useCallback((user: AccountUser, token: string): void => {
    const api = accountsBridge();
    dispatch({ type: "signed-in" });
    setStatus("signed-in");
    setSignedInEmail(user.email);
    statusCbRef.current?.("signed-in", user.email, user.name ?? null);
    if (api === null) return;
    void api.setSession({ user, token }).then(
      () => {
        // Phase 51 (item 2) — sign-in completion is an automatic sync trigger;
        // fire only after the session is stored so the coordinator sees the
        // token in the vault.
        requestAutoSync({ signedIn: true, bridge: api });
      },
      () => {
        dispatch({ type: "info", text: "Signed in, but the session could not be saved on this device." });
      },
    );
  }, []);

  /** Phase 46 - the Google flow's completion. MAIN has already completed the
   *  exchange and stored the session in the vault (the renderer cannot see the
   *  SameSite=Lax cookie from `file://`), so there is nothing to hand to
   *  `setSession`. Drive the machine to signed-in from the re-read status, the
   *  same way the boot path seeds it, so name/image flow to the top bar. */
  const completeGoogleSignIn = useCallback((result: AccountStatusResult): void => {
    dispatch({ type: "signed-in" });
    setStatus(result.status);
    setSignedInEmail(result.email);
    statusCbRef.current?.(result.status, result.email, result.name);
    // Phase 51 (item 2) — main has already stored the session for the browser
    // flow, so completion is an automatic sync trigger.
    requestAutoSync({ signedIn: result.status === "signed-in" });
  }, []);

  /** Dispatch a failure, carrying the provider's own code/message through so
   *  the banner can say WHY rather than the generic fallback. */
  const fail = useCallback(
    (failure: { code: AccountsErrorCode; detail?: string; providerCode?: string }): void => {
      dispatch({
        type: "error",
        code: failure.code,
        detail: failure.detail,
        providerCode: failure.providerCode,
      });
    },
    [],
  );

  const submit = useCallback((): void => {
    if (adapter === null) return;
    if (state.step === "otp") {
      const email = state.email.trim();
      if (state.otp.trim().length === 0) {
        dispatch({ type: "info", text: "Enter the code from the email." });
        return;
      }
      dispatch({ type: "busy", value: true });
      void adapter.verifyOtp({ email, otp: state.otp.trim() }).then((res) => {
        if (res.ok) completeSignIn(res.user, res.token);
        else fail(res);
      });
      return;
    }
    const email = state.email.trim();
    // Validate BEFORE the request: a missing name or a short password would
    // otherwise come back as the provider's raw zod text.
    const fieldError = credentialsFieldError(state.mode, {
      email,
      password: state.password,
      name: state.name,
    });
    if (fieldError !== null) {
      dispatch({ type: "info", text: fieldError });
      return;
    }
    dispatch({ type: "busy", value: true });
    if (state.mode === "sign-up") {
      void adapter
        .signUpEmail({ email, password: state.password, name: state.name.trim() })
        .then((res) => {
          if (!res.ok) {
            fail(res);
            return;
          }
          if (res.existingVerified === true) {
            // A duplicate of an ALREADY-verified address: no new account was
            // created (the response is the provider's synthetic anti-
            // enumeration one). Say so instead of claiming success.
            dispatch({
              type: "info",
              text: "That email already has an account. Sign in with it instead.",
            });
            return;
          }
          // A new (or unverified-duplicate) account needs a verification code.
          // With verification required the provider returns no session here,
          // so the explicit OTP send below is what actually emails the code.
          void adapter.sendOtp({ email }).then((otpRes) => {
            if (otpRes.ok) dispatch({ type: "otp-sent" });
            else fail(otpRes);
          });
        });
      return;
    }
    void adapter.signInEmail({ email, password: state.password }).then((res) => {
      if (res.ok) {
        completeSignIn(res.user, res.token);
        return;
      }
      if (res.code === "email-not-verified") {
        // Honest unverified-email state: send the verification code and move
        // the surface to its OTP step rather than leaving a dead banner.
        void adapter.sendOtp({ email }).then((otpRes) => {
          if (otpRes.ok) dispatch({ type: "otp-sent" });
          else fail(otpRes);
        });
        return;
      }
      fail(res);
    });
  }, [adapter, state, completeSignIn, fail]);

  const resend = useCallback((): void => {
    if (adapter === null) return;
    dispatch({ type: "busy", value: true });
    void adapter.sendOtp({ email: state.email.trim() }).then((res) => {
      if (res.ok) dispatch({ type: "otp-sent" });
      else fail(res);
    });
  }, [adapter, state.email, fail]);

  /**
   * Phase 46 / 102 - "Continue with Google".
   *
   * There is no absolute page origin to hand the provider (the packaged
   * renderer is `file://`), so the flow asks main for a loopback callback URL,
   * hands it to the SDK as the absolute `callbackURL`, and opens the provider
   * in an IN-APP child window bound to the app session (`window.open` -> the
   * main window's auth-popup handler). The provider's redirect lands on the
   * loopback listener in that same session; main reads the auth-host cookie
   * (which the renderer cannot, being cross-site from `file://`), completes
   * the exchange and stores the session, then reports `{ ok: true }`. The flow
   * re-queries `getStatus()` and drives this surface signed-in from the
   * result. Any real provider/main failure reaches `fail` verbatim; a local
   * outcome (timeout, cancel, a popup that would not open, or a refused
   * address) is reported as a non-blocking message.
   */
  const google = useCallback((): void => {
    const api = accountsBridge();
    if (adapter === null || api === null) return;
    googleFlowRef.current?.cancel();
    dispatch({ type: "busy", value: true });
    googleFlowRef.current = runGoogleSignIn({
      bridge: api,
      adapter,
      getStatus: (): Promise<AccountStatusResult> => api.getStatus(),
      openAuthPopup: (url): Promise<OpenAuthUrlResult> => {
        const w = window.open(url, "jovrel-google-signin", "width=520,height=760");
        return Promise.resolve(w ? { ok: true } : { ok: false, reason: "failed" });
      },
      onSignedIn: completeGoogleSignIn,
      onFailure: fail,
      onInfo: (text): void => dispatch({ type: "info", text }),
    });
  }, [adapter, completeGoogleSignIn, fail]);

  /** Enter the forgot-password flow (sign-in view only). */
  const openReset = useCallback((): void => {
    dispatch({ type: "open-reset" });
  }, []);

  /** Request an emailed password-reset code. */
  const submitResetRequest = useCallback((): void => {
    if (adapter === null) return;
    const email = state.email.trim();
    if (email.length === 0) {
      dispatch({ type: "info", text: "Enter the email for your account." });
      return;
    }
    if (!isValidEmail(email)) {
      dispatch({ type: "info", text: "Enter a valid email address." });
      return;
    }
    dispatch({ type: "busy", value: true });
    const api = accountsBridge();
    void (async (): Promise<void> => {
      // The provider's origin check refuses the reset request without an
      // ABSOLUTE, trusted redirect (`VALIDATION_FAILED` / `MISSING_ORIGIN`).
      // When the renderer has a real absolute origin (the dev build), that
      // origin is the trusted one and is used directly. A packaged `file://`
      // renderer has origin "null", so the absolute URL main mints is used
      // instead. The reset code is typed in-app, so nothing needs to be
      // listening on it.
      const appOrigin = typeof window === "undefined" ? null : window.location.origin;
      const redirectTo = api === null ? null : await resetRedirectUrl(api, appOrigin);
      const input = redirectTo === null ? { email } : { email, redirectTo };
      const res = await adapter.requestPasswordReset(input);
      if (res.ok) dispatch({ type: "reset-sent" });
      else fail(res);
    })();
  }, [adapter, state.email, fail]);

  /** Complete the reset with the emailed code and a new password. */
  const submitResetConfirm = useCallback((): void => {
    if (adapter === null) return;
    const email = state.email.trim();
    if (state.resetCode.trim().length === 0) {
      dispatch({ type: "info", text: "Enter the reset code from the email." });
      return;
    }
    if (state.newPassword.length < MIN_PASSWORD_LENGTH) {
      dispatch({ type: "info", text: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.` });
      return;
    }
    dispatch({ type: "busy", value: true });
    void adapter
      .resetPassword({ email, otp: state.resetCode.trim(), password: state.newPassword })
      .then((res) => {
        if (res.ok) dispatch({ type: "reset-done" });
        else fail(res);
      });
  }, [adapter, state.email, state.resetCode, state.newPassword, fail]);

  const signOut = useCallback((): void => {
    const api = accountsBridge();
    if (adapter !== null) void adapter.signOut();
    const done = (): void => {
      setStatus("signed-out");
      setSignedInEmail(null);
      setSyncReport(null);
      dispatch({ type: "reset" });
      statusCbRef.current?.("signed-out", null, null);
    };
    if (api === null) {
      done();
      return;
    }
    void api.clearSession().then(done).catch(done);
  }, [adapter]);

  const runSync = useCallback((): void => {
    const api = accountsBridge();
    if (api === null) return;
    setSyncing(true);
    void api.syncNow().then((report) => setSyncReport(report)).finally(() => setSyncing(false));
  }, []);

  const signedIn = status === "signed-in" || signedInEmail !== null;
  const syncView = describeSyncReport(syncReport);

  return (
    <AnimatedDialog
      open={open}
      onClose={onClose}
      className="sheet sheet-accounts"
      ariaLabel="Account"
      testId="accounts-dialog"
    >
      <header className="sheet-header accounts-header">
        {/* Phase 49 - the app's own wordmark treatment (the same JOVREL mark
            and "Jovrel" name the title bar renders), so the surface reads as
            part of Jovrel rather than a bare hosted form. */}
        <div className="accounts-brand">
          <BrandMark size={26} className="accounts-brand-mark" />
          <span className="accounts-brand-text">
            <BrandWordmark className="accounts-brand-name" />
            <span className="accounts-brand-sub">Account and sync</span>
          </span>
        </div>
        <h2 className="visually-hidden">Account</h2>
        <button
          type="button"
          className="btn btn-ghost btn-icon sheet-close"
          onClick={onClose}
          aria-label="Close account dialog"
          title="Close account dialog"
          data-accounts-close
        >
          <Icon name="dialogClose" size="sm" />
        </button>
      </header>
      <div className="sheet-body sheet-body-accounts">
        {configState === "loading" && (
          <p className="accounts-status" data-accounts-loading>
            <BrandLoader /> Loading account settings...
          </p>
        )}
        {configState === "unconfigured" && (
          <div className="accounts-unconfigured" data-accounts-unconfigured>
            <p className="accounts-unconfigured-title">Accounts are not available</p>
            <p className="accounts-unconfigured-text">
              The accounts service is not configured on this install, so signing in and cloud
              sync are turned off. Everything else in Jovrel works exactly as before.
            </p>
          </div>
        )}
        {configState === "ready" && !signedIn && (
          <div className="accounts-auth" data-accounts-auth data-accounts-step={state.step}>
            {status === "unavailable" && (
              <p className="accounts-notice" data-accounts-storage-unavailable>
                Secure session storage is unavailable on this machine, so a sign-in will not
                survive a restart.
              </p>
            )}
            <TfResize axes="height">
            {state.step === "credentials" ? (
              <>
<div className="accounts-mode" role="tablist" aria-label="Sign in or create an account">
                  <Button
                    type="button"
                    role="tab"
                    aria-selected={state.mode === "sign-in"}
                    intent="tertiary"
                    kind="exclusive-selection"
                    density="standard"
                    className={state.mode === "sign-in" ? "accounts-mode-tab accounts-mode-tab-active" : "accounts-mode-tab"}
                    onClick={(): void => dispatch({ type: "set-mode", mode: "sign-in" })}
                    data-accounts-mode-signin
                  >
                    Sign in
                  </Button>
                  <Button
                    type="button"
                    role="tab"
                    aria-selected={state.mode === "sign-up"}
                    intent="tertiary"
                    kind="exclusive-selection"
                    density="standard"
                    className={state.mode === "sign-up" ? "accounts-mode-tab accounts-mode-tab-active" : "accounts-mode-tab"}
                    onClick={(): void => dispatch({ type: "set-mode", mode: "sign-up" })}
                    data-accounts-mode-signup
                  >
                    <Icon icon={UserPlus} size="xs" />
                    Create account
                  </Button>
                </div>
                <label className="accounts-field" htmlFor="accounts-email">
                  <span className="accounts-label">Email</span>
                  <input
                    id="accounts-email"
                    type="email"
                    className="accounts-input"
                    value={state.email}
                    autoComplete="email"
                    onChange={(e): void => dispatch({ type: "set-field", field: "email", value: e.target.value })}
                    data-accounts-email
                  />
                </label>
                {state.mode === "sign-up" && (
                  <label className="accounts-field" htmlFor="accounts-name">
                    <span className="accounts-label">Name</span>
                    <input
                      id="accounts-name"
                      type="text"
                      className="accounts-input"
                      value={state.name}
                      autoComplete="name"
                      onChange={(e): void => dispatch({ type: "set-field", field: "name", value: e.target.value })}
                      data-accounts-name
                    />
                  </label>
                )}
                <label className="accounts-field" htmlFor="accounts-password">
                  <span className="accounts-label">Password</span>
                  <input
                    id="accounts-password"
                    type="password"
                    className="accounts-input"
                    value={state.password}
                    autoComplete={state.mode === "sign-up" ? "new-password" : "current-password"}
                    onChange={(e): void => dispatch({ type: "set-field", field: "password", value: e.target.value })}
                    data-accounts-password
                  />
                </label>
                {state.mode === "sign-in" && (
                  <Button
                    type="button"
                    intent="tertiary"
                    kind="action"
                    density="standard"
                    className="accounts-forgot"
                    onClick={openReset}
                    data-accounts-forgot
                  >
                    Forgot password?
                  </Button>
                )}
                <Banner banner={state.banner} variants={bannerPop} />
                <button
                  type="button"
                  className="btn btn-primary accounts-submit"
                  onClick={submit}
                  disabled={state.busy}
                  data-accounts-submit
                >
                  {state.busy ? "Working..." : state.mode === "sign-up" ? "Create account" : "Sign in"}
                </button>
                <div className="accounts-divider" aria-hidden>
                  <span>or</span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary accounts-google"
                  onClick={google}
                  disabled={state.busy}
                  data-accounts-google
                >
                  <GoogleMark />
                  Continue with Google
                </button>
              </>
            ) : state.step === "otp" ? (
              <>
                <p className="accounts-otp-lead" data-accounts-otp-lead>
                  Enter the verification code we emailed to {state.email}.
                </p>
                <label className="accounts-field" htmlFor="accounts-otp">
                  <span className="accounts-label">Verification code</span>
                  <input
                    id="accounts-otp"
                    type="text"
                    inputMode="numeric"
                    className="accounts-input"
                    value={state.otp}
                    autoComplete="one-time-code"
                    onChange={(e): void => dispatch({ type: "set-field", field: "otp", value: e.target.value })}
                    data-accounts-otp
                  />
                </label>
                <Banner banner={state.banner} variants={bannerPop} />
                <button
                  type="button"
                  className="btn btn-primary accounts-submit"
                  onClick={submit}
                  disabled={state.busy}
                  data-accounts-submit
                >
                  {state.busy ? "Verifying..." : "Verify code"}
                </button>
                <div className="accounts-otp-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={resend}
                    disabled={state.busy}
                    data-accounts-resend
                  >
                    Resend code
                  </button>
                  <Button
                    type="button"
                    intent="tertiary"
                    kind="action"
                    density="standard"
                    className="accounts-link"
                    onClick={(): void => dispatch({ type: "back" })}
                    data-accounts-back
                  >
                    <Icon icon={ArrowLeft} size="xs" />
                    Back
                  </Button>
                </div>
              </>
            ) : state.step === "reset-request" ? (
              <>
                <p className="accounts-otp-lead" data-accounts-reset-lead>
                  Enter your account email and we will send a reset code.
                </p>
                <label className="accounts-field" htmlFor="accounts-reset-email">
                  <span className="accounts-label">Email</span>
                  <input
                    id="accounts-reset-email"
                    type="email"
                    className="accounts-input"
                    value={state.email}
                    autoComplete="email"
                    onChange={(e): void => dispatch({ type: "set-field", field: "email", value: e.target.value })}
                    data-accounts-reset-email
                  />
                </label>
                <Banner banner={state.banner} variants={bannerPop} />
                <button
                  type="button"
                  className="btn btn-primary accounts-submit"
                  onClick={submitResetRequest}
                  disabled={state.busy}
                  data-accounts-reset-submit
                >
                  {state.busy ? "Sending..." : "Send reset code"}
                </button>
                <div className="accounts-otp-actions">
                  <Button
                    type="button"
                    intent="tertiary"
                    kind="action"
                    density="standard"
                    className="accounts-link"
                    onClick={(): void => dispatch({ type: "back" })}
                    data-accounts-back
                  >
                    <Icon icon={ArrowLeft} size="xs" />
                    Back to sign in
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="accounts-otp-lead" data-accounts-reset-confirm-lead>
                  Enter the reset code we emailed to {state.email} and choose a new password.
                </p>
                <label className="accounts-field" htmlFor="accounts-reset-code">
                  <span className="accounts-label">Reset code</span>
                  <input
                    id="accounts-reset-code"
                    type="text"
                    inputMode="numeric"
                    className="accounts-input"
                    value={state.resetCode}
                    autoComplete="one-time-code"
                    onChange={(e): void => dispatch({ type: "set-field", field: "resetCode", value: e.target.value })}
                    data-accounts-reset-code
                  />
                </label>
                <label className="accounts-field" htmlFor="accounts-new-password">
                  <span className="accounts-label">New password</span>
                  <input
                    id="accounts-new-password"
                    type="password"
                    className="accounts-input"
                    value={state.newPassword}
                    autoComplete="new-password"
                    onChange={(e): void => dispatch({ type: "set-field", field: "newPassword", value: e.target.value })}
                    data-accounts-new-password
                  />
                </label>
                <Banner banner={state.banner} variants={bannerPop} />
                <button
                  type="button"
                  className="btn btn-primary accounts-submit"
                  onClick={submitResetConfirm}
                  disabled={state.busy}
                  data-accounts-reset-confirm
                >
                  {state.busy ? "Updating..." : "Set new password"}
                </button>
                <div className="accounts-otp-actions">
                  <Button
                    type="button"
                    intent="tertiary"
                    kind="action"
                    density="standard"
                    className="accounts-link"
                    onClick={(): void => dispatch({ type: "back" })}
                    data-accounts-back
                  >
                    <Icon icon={ArrowLeft} size="xs" />
                    Back to sign in
                  </Button>
                </div>
              </>
            )}
          </TfResize>
          </div>
        )}
        {configState === "ready" && signedIn && (
          <div className="accounts-signed-in" data-accounts-signed-in>
            <div className="accounts-identity">
              <span className="accounts-identity-label">Signed in as</span>
              <span className="accounts-identity-email" data-accounts-email-shown>{signedInEmail}</span>
            </div>
            <div className="accounts-sync">
              <button
                type="button"
                className="btn btn-secondary accounts-sync-now"
                onClick={runSync}
                disabled={syncing}
                data-accounts-sync-now
              >
                <Icon icon={RefreshCcw} size="xs" />
                {syncing ? "Syncing..." : "Sync now"}
              </button>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${syncView.phase}:${syncView.detail ?? ""}`}
                  className={`accounts-sync-status accounts-sync-${syncView.tone}`}
                  data-sync-phase={syncView.phase}
                  variants={bannerPop}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  role="status"
                >
                  <span className="accounts-sync-label">{syncView.label}</span>
                  {syncView.detail !== null && (
                    <span className="accounts-sync-detail">{syncView.detail}</span>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="accounts-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled
                title={DEFERRED_REASON}
                data-accounts-export
              >
                Export my data
              </button>
              <button
                type="button"
                className="btn btn-secondary accounts-danger"
                disabled
                title={DEFERRED_REASON}
                data-accounts-delete
              >
                Delete my account
              </button>
              <button
                type="button"
                className="btn btn-secondary accounts-signout"
                onClick={signOut}
                data-accounts-signout
              >
                <Icon icon={LogOut} size="xs" />
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </AnimatedDialog>
  );
}
