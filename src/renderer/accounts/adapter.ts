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

/** A completed sign-in/verify: the identity plus the JWT to hand to main. */
export type AuthOutcome =
  | { ok: true; user: AccountUser; token: string }
  | { ok: false; code: AccountsErrorCode };

/** A step that starts a flow (sign-up, OTP send, Google launch). */
export type StartOutcome = { ok: true } | { ok: false; code: AccountsErrorCode };

/** The seam the UI depends on; mocked in unit tests. */
export interface AccountsAuthAdapter {
  signInEmail(input: { email: string; password: string }): Promise<AuthOutcome>;
  signUpEmail(input: { email: string; password: string; name?: string }): Promise<StartOutcome>;
  sendOtp(input: { email: string }): Promise<StartOutcome>;
  verifyOtp(input: { email: string; otp: string }): Promise<AuthOutcome>;
  /** Starts the provider flow. The SDK owns the popup/redirect. */
signInGoogle(): Promise<StartOutcome>;
  /** Phase 45 - request an emailed password-reset code (the Email OTP
   *  plugin's `/email-otp/request-password-reset`). No redirect link: the
   *  code is entered in-app, which is what an offline desktop app needs. */
  requestPasswordReset(input: { email: string }): Promise<StartOutcome>;
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
 * branches on. Kept pure and defensive: the SDK surfaces a `code` string and
 * an HTTP `status` on its `error` object, but the exact spelling can vary, so
 * both the code and a lowercase message are consulted.
 *
 * `online` is injected (defaulting to the live renderer connectivity) so the
 * mapping is unit-testable without a DOM: a transport failure becomes
 * `network-offline` only when the app is genuinely offline, and `server`
 * otherwise.
 */
export function mapAuthError(error: unknown, online: boolean = rendererIsOnline()): AccountsErrorCode {
  const rec = (error ?? {}) as { code?: unknown; status?: unknown; message?: unknown };
  const code = typeof rec.code === "string" ? rec.code.toUpperCase() : "";
  const status = typeof rec.status === "number" ? rec.status : 0;
  const message = typeof rec.message === "string" ? rec.message.toLowerCase() : "";

  if (code === "OTP_EXPIRED" || /code has expired|otp.*expired/.test(message)) {
    return "code-expired";
  }
  if (code === "INVALID_OTP" || code === "OTP_NOT_FOUND" || /invalid.*code|code.*invalid/.test(message)) {
    return "code-invalid";
  }
  if (code === "EMAIL_NOT_VERIFIED" || /not verified|verify your email/.test(message)) {
    return "email-not-verified";
  }
  if (
    code === "INVALID_EMAIL_OR_PASSWORD" ||
    code === "INVALID_CREDENTIALS" ||
    code === "USER_NOT_FOUND" ||
    status === 401 ||
    status === 403
  ) {
    return "invalid-credentials";
  }
  if (
    status === 0 ||
    code.startsWith("NETWORK_") ||
    /network|offline|failed to connect|connection|failed to fetch/.test(`${code} ${message}`.toLowerCase())
  ) {
    // Phase 45 - only claim "offline" when the renderer itself reports no
    // link; otherwise the transport failed for a non-connectivity reason and
    // the honest answer is a server/reachability error.
    return online ? "server" : "network-offline";
  }
  return "server";
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
    social(input: { provider: string; callbackURL?: string }): Promise<SdkResult>;
  };
  signUp: {
    email(input: { email: string; password: string; name?: string }): Promise<SdkResult>;
  };
  emailOtp: {
    sendVerificationOtp(input: { email: string; type: string }): Promise<SdkResult>;
    verifyEmail(input: { email: string; otp: string }): Promise<SdkResult>;
    /** Phase 45 - the Email OTP plugin's password-reset endpoints. */
    requestPasswordReset(input: { email: string }): Promise<SdkResult>;
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

function failedFrom(error: unknown): { ok: false; code: AccountsErrorCode } {
  return { ok: false, code: mapAuthError(error) };
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
      return res.ok ? { ok: true } : failedFrom(res.error);
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
      const res = await call(() =>
        neon.adapter.emailOtp.requestPasswordReset({ email: input.email }),
      );
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
    async signInGoogle() {
      const res = await call(() => neon.adapter.signIn.social({ provider: "google" }));
      return res.ok ? { ok: true } : failedFrom(res.error);
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
