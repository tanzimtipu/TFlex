// Phase 44 — the renderer's accounts/auth adapter.
//
// A SMALL, framework-agnostic seam over the installed Neon auth SDK. The
// account surface talks only to this interface, so the UI is unit-tested with
// a fake adapter and the SDK never leaks into components. Imported from the
// VANILLA entry (@neondatabase/auth/vanilla) — the React entry needs a
// provider and is deliberately not used here.
//
// SECURITY: the session JWT is read here only to hand it to the main process
// via accounts.setSession (which encrypts and stores it). This module never
// writes the token anywhere.

import { createInternalNeonAuth } from "@neondatabase/auth";
import { BetterAuthVanillaAdapter } from "@neondatabase/auth/vanilla";
import type { AccountUser, AccountsErrorCode } from "../../shared/accounts";
import type { AccountsErrorInfo } from "./machine";

/** A failed auth step: the coarse code plus the provider's own diagnosis,
 *  when it gave one. `detail` / `providerCode` are the raw `message` / `code`
 *  from the auth service - surfaced to the user so a real failure is not
 *  hidden behind generic copy. */
export type AuthFailure = { ok: false; code: AccountsErrorCode } & AccountsErrorInfo;

/** A completed sign-in/verify: the identity plus the JWT to hand to main. */
export type AuthOutcome =
  | { ok: true; user: AccountUser; token: string }
  | AuthFailure;

/** A step that starts a flow (sign-up, OTP send, Google launch).
 *  `existingVerified` is true when a sign-up landed on an account whose email
 *  is ALREADY verified - a duplicate, not a new account. The provider's
 *  anti-enumeration response hides unverified duplicates, so only this case is
 *  detectable; the caller must still word the OTP step honestly. */
export type StartOutcome = { ok: true; existingVerified?: boolean } | AuthFailure;

/** Phase 46 - the provider's authorize URL to open in a popup. The caller owns
 *  the window and the loopback callback; the SDK owns the code exchange that
 *  its redirect performs. */
export type GoogleStartOutcome = { ok: true; url: string } | AuthFailure;

/** The seam the UI depends on; mocked in unit tests. */
export interface AccountsAuthAdapter {
  signInEmail(input: { email: string; password: string }): Promise<AuthOutcome>;
  signUpEmail(input: { email: string; password: string; name?: string }): Promise<StartOutcome>;
  sendOtp(input: { email: string }): Promise<StartOutcome>;
  verifyOtp(input: { email: string; otp: string }): Promise<AuthOutcome>;
  /** Phase 46 - start the Google flow with the app's absolute loopback
   *  `callbackUrl`. Returns the provider authorize URL for the caller to open
   *  (the SDK does NOT navigate: `disableRedirect` keeps the redirect ours). */
  signInGoogle(input: { callbackUrl: string }): Promise<GoogleStartOutcome>;
  /** Phase 46 - read the session a provider redirect established (`getSession`
   *  + JWT), the same completion path the email flow uses. */
  completeWebSignIn(): Promise<AuthOutcome>;
  /** Phase 45 - request an emailed password-reset code (the Email OTP
   *  plugin's `/email-otp/request-password-reset`). No redirect link: the
   *  code is entered in-app, which is what an offline desktop app needs.
   *  `redirectTo` must be an ABSOLUTE, provider-trusted URL or the provider
   *  refuses the request (400 VALIDATION_FAILED). */
  requestPasswordReset(input: { email: string; redirectTo?: string }): Promise<StartOutcome>;
  /** Phase 45 - complete the reset with the emailed code and a new
   *  password (`/email-otp/reset-password`). */
  resetPassword(input: { email: string; otp: string; password: string }): Promise<StartOutcome>;
  signOut(): Promise<void>;
  /** Phase 44 (operator amendment) — the ONE profile field the identity
   *  provider lets the app change (the display name). Reads the updated name
   *  back from the session in `readUser`, so the surface stays in sync. */
  updateName(input: { name: string }): Promise<StartOutcome>;
}

/** OTP purpose the Neon project uses for the emailed verification code. */
const OTP_TYPE_EMAIL_VERIFICATION = "email-verification";

/**
 * True unless the renderer positively knows it has no network link.
 *
 * Phase 45 - `navigator.onLine === false` is the ONLY signal that earns the
 * "offline" copy. Unknown/absent maps to online, so a request that fails for
 * any other reason (a CSP block, DNS/proxy failure, a server that refused)
 * is never mislabelled as the user being offline.
 */
export function rendererIsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * Map a transport/SDK error to the shared `AccountsErrorCode` union the UI
 * branches on, AND keep the provider's own `code` / `message` so the surface
 * can report the real reason. Kept pure and defensive: the SDK surfaces a
 * `code` string, an HTTP `status` and a `message` on its `error` object, and
 * `@better-fetch` spreads the parsed JSON body onto that object, so the
 * provider's `code`/`message` are read directly.
 *
 * `online` is injected (defaulting to the live renderer connectivity) so the
 * mapping is unit-testable without a DOM: a transport failure becomes
 * `network-offline` only when the app is genuinely offline, and `server`
 * otherwise. A transport failure carries NO detail (there is no provider
 * message to show); a real HTTP error carries the provider's message.
 */
export function describeAuthError(
  error: unknown,
  online: boolean = rendererIsOnline(),
): { code: AccountsErrorCode } & AccountsErrorInfo {
  const rec = (error ?? {}) as { code?: unknown; status?: unknown; message?: unknown };
  const providerCode = typeof rec.code === "string" ? rec.code : "";
  const code = providerCode.toUpperCase();
  const status = typeof rec.status === "number" ? rec.status : 0;
  const message = typeof rec.message === "string" ? rec.message : "";
  const messageLower = message.toLowerCase();

  if (code === "OTP_EXPIRED" || /code has expired|otp.*expired/.test(messageLower)) {
    return { code: "code-expired", providerCode, detail: message };
  }
  if (code === "INVALID_OTP" || code === "OTP_NOT_FOUND" || /invalid.*code|code.*invalid/.test(messageLower)) {
    return { code: "code-invalid", providerCode, detail: message };
  }
  if (code === "EMAIL_NOT_VERIFIED" || /not verified|verify your email/.test(messageLower)) {
    return { code: "email-not-verified", providerCode, detail: message };
  }
  if (
    code === "INVALID_EMAIL_OR_PASSWORD" ||
    code === "INVALID_CREDENTIALS" ||
    code === "USER_NOT_FOUND" ||
    status === 401 ||
    status === 403
  ) {
    return { code: "invalid-credentials", providerCode, detail: message };
  }
  if (
    status === 0 ||
    code.startsWith("NETWORK_") ||
    /network|offline|failed to connect|connection|failed to fetch/.test(`${code} ${messageLower}`)
  ) {
    // Phase 45 - only claim "offline" when the renderer itself reports no
    // link; otherwise the transport failed for a non-connectivity reason and
    // the honest answer is a server/reachability error. No provider message
    // exists here, so `detail` stays empty and the generic copy is used.
    return { code: online ? "server" : "network-offline" };
  }
  // A real HTTP error from the provider: keep its message and code verbatim.
  return { code: "server", providerCode, detail: message };
}

/** Back-compat: the coarse code only (the existing unit tests pin this). */
export function mapAuthError(error: unknown, online: boolean = rendererIsOnline()): AccountsErrorCode {
  return describeAuthError(error, online).code;
}

/** The loose SDK shape this adapter reads. The installed SDK types are wide
 *  and version-sensitive; pinning only what we call keeps the seam small and
 *  the migration surface obvious. */
interface SdkResult {
  data?: unknown;
  error?: unknown;
}
interface NeonSdkClient {
  signIn: {
    email(input: { email: string; password: string }): Promise<SdkResult>;
    /** `disableRedirect` makes the provider return the authorize URL instead
     *  of the SDK navigating the renderer away from the app. */
    social(input: {
      provider: string;
      callbackURL?: string;
      disableRedirect?: boolean;
    }): Promise<SdkResult>;
  };
  signUp: {
    email(input: { email: string; password: string; name?: string }): Promise<SdkResult>;
  };
  emailOtp: {
    sendVerificationOtp(input: { email: string; type: string }): Promise<SdkResult>;
    verifyEmail(input: { email: string; otp: string }): Promise<SdkResult>;
    /** Phase 45 - the Email OTP plugin's password-reset endpoints. The
     *  provider's origin check requires an absolute `redirectTo`. */
    requestPasswordReset(input: { email: string; redirectTo?: string }): Promise<SdkResult>;
    resetPassword(input: { email: string; otp: string; password: string }): Promise<SdkResult>;
  };
signOut(): Promise<SdkResult>;
  /** Better Auth's user update; the Managed provider permits `name`. */
  updateUser(input: { name: string }): Promise<SdkResult>;
  getSession(): Promise<SdkResult>;
}
interface NeonInternalClient {
  adapter: NeonSdkClient;
  getJWTToken(): Promise<string | null>;
}

function readUser(raw: unknown): AccountUser | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { user?: unknown };
  const u = (typeof r.user === "object" && r.user !== null ? r.user : raw) as Record<string, unknown>;
  if (typeof u.id !== "string" || typeof u.email !== "string") return null;
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerified === true,
    name: typeof u.name === "string" ? u.name : undefined,
  };
}

function failedFrom(error: unknown): AuthFailure {
  return { ok: false, ...describeAuthError(error) };
}

/** Run one SDK call, normalising both thrown and returned errors. */
async function call(fn: () => Promise<SdkResult>): Promise<{ ok: true; data: unknown } | { ok: false; error: unknown }> {
  try {
    const res = await fn();
    if (res.error !== undefined && res.error !== null) return { ok: false, error: res.error };
    return { ok: true, data: res.data };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Build the production adapter from the base URL `accounts.getConfig()`
 * returned. No URL is hardcoded here; the caller supplies it.
 */
export function createNeonAuthAdapter(baseUrl: string): AccountsAuthAdapter {
  const neon = createInternalNeonAuth(baseUrl, {
    adapter: BetterAuthVanillaAdapter(),
  }) as unknown as NeonInternalClient;

  const finishSession = async (): Promise<AuthOutcome> => {
    const session = await call(() => neon.adapter.getSession());
    if (!session.ok) return failedFrom(session.error);
    const user = readUser(session.data);
    if (user === null) return { ok: false, code: "server" };
    let token: string | null = null;
    try {
      token = await neon.getJWTToken();
    } catch {
      token = null;
    }
    if (token === null || token.length === 0) return { ok: false, code: "server" };
    return { ok: true, user, token };
  };

  return {
    async signInEmail(input) {
      const res = await call(() => neon.adapter.signIn.email(input));
      if (!res.ok) return failedFrom(res.error);
      return finishSession();
    },
    async signUpEmail(input) {
      const res = await call(() => neon.adapter.signUp.email(input));
      if (!res.ok) return failedFrom(res.error);
      // With verification required the provider answers 200 with
      // `{ token: null, user }` for a genuinely new account. A duplicate for
      // an address whose email is ALREADY verified is distinguishable only by
      // `user.emailVerified === true` (unverified duplicates are synthetic and
      // indistinguishable), so surface that one honest signal.
      const user = readUser(res.data);
      return { ok: true, existingVerified: user?.emailVerified === true };
    },
    async sendOtp(input) {
      const res = await call(() =>
        neon.adapter.emailOtp.sendVerificationOtp({
          email: input.email,
          type: OTP_TYPE_EMAIL_VERIFICATION,
        }),
      );
      return res.ok ? { ok: true } : failedFrom(res.error);
    },
    async verifyOtp(input) {
      const res = await call(() => neon.adapter.emailOtp.verifyEmail(input));
      if (!res.ok) return failedFrom(res.error);
      return finishSession();
    },
    async requestPasswordReset(input) {
      const body: { email: string; redirectTo?: string } = { email: input.email };
      if (typeof input.redirectTo === "string" && input.redirectTo.length > 0) {
        body.redirectTo = input.redirectTo;
      }
      const res = await call(() => neon.adapter.emailOtp.requestPasswordReset(body));
      return res.ok ? { ok: true } : failedFrom(res.error);
    },
    async resetPassword(input) {
      const res = await call(() =>
        neon.adapter.emailOtp.resetPassword({
          email: input.email,
          otp: input.otp,
          password: input.password,
        }),
      );
      return res.ok ? { ok: true } : failedFrom(res.error);
    },
    async signInGoogle(input) {
      // A single-use absolute loopback URL is supplied by the caller (main
      // mints it). `disableRedirect` keeps the browser navigation in the
      // caller's hands: without it the SDK sets window.location.href and the
      // app renderer leaves the app.
      const res = await call(() =>
        neon.adapter.signIn.social({
          provider: "google",
          callbackURL: input.callbackUrl,
          disableRedirect: true,
        }),
      );
      if (!res.ok) return failedFrom(res.error);
      const data = (res.data ?? {}) as { url?: unknown };
      if (typeof data.url !== "string" || data.url.length === 0) {
        return { ok: false, code: "server", detail: "The provider did not return a sign-in URL." };
      }
      return { ok: true, url: data.url };
    },
    /** The provider redirect established a session cookie on the auth host;
     *  read it back exactly as the email flow completes. */
    async completeWebSignIn() {
      return finishSession();
    },
    async signOut() {
      await call(() => neon.adapter.signOut());
    },
    async updateName(input) {
      const res = await call(() => neon.adapter.updateUser({ name: input.name }));
      return res.ok ? { ok: true } : failedFrom(res.error);
    },
  };
}
