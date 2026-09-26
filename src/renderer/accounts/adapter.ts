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
  signOut(): Promise<void>;
}

/** OTP purpose the Neon project uses for the emailed verification code. */
const OTP_TYPE_EMAIL_VERIFICATION = "email-verification";

/**
 * Map a transport/SDK error to the shared `AccountsErrorCode` union the UI
 * branches on. Kept pure and defensive: the SDK surfaces a `code` string and
 * an HTTP `status` on its `error` object, but the exact spelling can vary, so
 * both the code and a lowercase message are consulted.
 */
export function mapAuthError(error: unknown): AccountsErrorCode {
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
    /network|offline|failed to connect|connection/.test(`${code} ${message}`.toLowerCase())
  ) {
    return "network-offline";
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
  };
  signOut(): Promise<SdkResult>;
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
    async signInGoogle() {
      const res = await call(() => neon.adapter.signIn.social({ provider: "google" }));
      return res.ok ? { ok: true } : failedFrom(res.error);
    },
    async signOut() {
      await call(() => neon.adapter.signOut());
    },
  };
}
