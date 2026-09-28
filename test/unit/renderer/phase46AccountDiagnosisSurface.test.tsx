// @vitest-environment jsdom
//
// Phase 46 - the account surface reports the provider's REAL failure.
//
// Drives the dialog with a mocked adapter carrying the exact payloads the
// orchestrator captured live, and proves:
//   - a verification-required sign-up (200, token null) is NOT an error and
//     reaches the OTP step; the OTP send is what triggers the email;
//   - a duplicate of an already-verified address is not claimed as a creation;
//   - field validation happens BEFORE any request;
//   - VALIDATION_ERROR / PROVIDER_NOT_FOUND surface their real text.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AccountsDialog } from "../../../src/renderer/components/AccountsDialog";
import type { AccountsAuthAdapter } from "../../../src/renderer/accounts/adapter";

const BASE_URL = "https://example.invalid";

interface FakeAdapter {
  adapter: AccountsAuthAdapter;
  signInEmail: ReturnType<typeof vi.fn>;
  signUpEmail: ReturnType<typeof vi.fn>;
  sendOtp: ReturnType<typeof vi.fn>;
  verifyOtp: ReturnType<typeof vi.fn>;
  signInGoogle: ReturnType<typeof vi.fn>;
  requestPasswordReset: ReturnType<typeof vi.fn>;
  resetPassword: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
}

function fakeAdapter(over: Partial<Record<string, unknown>> = {}): FakeAdapter {
  const fn = (impl: () => Promise<unknown>): ReturnType<typeof vi.fn> => vi.fn(impl);
  const parts = {
    signInEmail: fn(async () => ({ ok: true, user: { id: "u1", email: "ada@example.com", emailVerified: true }, token: "jwt" })),
    signUpEmail: fn(async () => ({ ok: true, existingVerified: false })),
    sendOtp: fn(async () => ({ ok: true })),
    verifyOtp: fn(async () => ({ ok: true, user: { id: "u1", email: "ada@example.com", emailVerified: true }, token: "jwt" })),
    signInGoogle: fn(async () => ({ ok: true })),
    requestPasswordReset: fn(async () => ({ ok: true })),
    resetPassword: fn(async () => ({ ok: true })),
    signOut: fn(async () => undefined),
  };
  for (const [key, value] of Object.entries(over)) {
    (parts as Record<string, ReturnType<typeof vi.fn>>)[key] = vi.fn(value as () => Promise<unknown>);
  }
  return { adapter: parts as unknown as AccountsAuthAdapter, ...parts } as FakeAdapter;
}

function fakeBridge(): Record<string, unknown> {
  return {
    getConfig: vi.fn(async () => ({ authBaseUrl: BASE_URL, configured: true })),
    getStatus: vi.fn(async () => ({ status: "signed-out", email: null, name: null })),
    setSession: vi.fn(async () => undefined),
    clearSession: vi.fn(async () => undefined),
    syncNow: vi.fn(async () => ({ phase: "synced" })),
    onSyncReport: vi.fn(() => () => undefined),
    // Phase 46 - the loopback callback the Google flow needs before it can
    // ask the provider for an authorize URL.
    startOAuthCallback: vi.fn(async () => ({ callbackUrl: "http://127.0.0.1:51234/oauth/callback?token=tok" })),
    stopOAuthCallback: vi.fn(async () => undefined),
    onOAuthCallback: vi.fn(() => () => undefined),
    // Phase 50 - main opens the OS default browser for the provider URL.
    openAuthUrl: vi.fn(async () => ({ ok: true })),
  };
}

const mounted: Array<() => void> = [];
afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
  delete (window as unknown as { tflex?: unknown }).tflex;
});

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderDialog(adapter: FakeAdapter = fakeAdapter()): Promise<{
  container: HTMLElement;
  adapter: FakeAdapter;
}> {
  (window as unknown as { tflex?: unknown }).tflex = { accounts: fakeBridge() };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      <AccountsDialog
        open
        onClose={(): void => undefined}
        createAdapter={(): AccountsAuthAdapter => adapter.adapter}
      />,
    );
  });
  await flush();
  mounted.push(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });
  return { container, adapter };
}

function must(container: HTMLElement, selector: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`missing ${selector}`);
  return el;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

async function typeInto(el: HTMLElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  await act(async () => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const step = (container: HTMLElement): string | null =>
  must(container, "[data-accounts-auth]").getAttribute("data-accounts-step");

function banner(container: HTMLElement): string {
  const el = container.querySelector<HTMLElement>("[data-accounts-banner]");
  return el?.textContent ?? "";
}

describe("Phase 46 - verification-required sign-up is not an error", () => {
  it("a 200 with no session token moves to the OTP step and sends the code", async () => {
    const adapter = fakeAdapter({ signUpEmail: async () => ({ ok: true, existingVerified: false }) });
    const h = await renderDialog(adapter);
    await click(must(h.container, "[data-accounts-mode-signup]"));
    await typeInto(must(h.container, "[data-accounts-email]"), "ada@example.com");
    await typeInto(must(h.container, "[data-accounts-name]"), "Ada Lovelace");
    await typeInto(must(h.container, "[data-accounts-password]"), "pw-123456");
    await click(must(h.container, "[data-accounts-submit]"));

    expect(step(h.container)).toBe("otp");
    // The email is actually triggered by this explicit call.
    expect(h.adapter.sendOtp).toHaveBeenCalledWith({ email: "ada@example.com" });
    // No error banner anywhere.
    expect(h.container.querySelector("[data-accounts-banner='error']")).toBeNull();
    // The sign-up wording stays honest about an already-registered address.
    expect(banner(h.container)).toContain("already had an account");
  });

  it("a duplicate of an ALREADY-verified address is not claimed as a creation", async () => {
    const adapter = fakeAdapter({ signUpEmail: async () => ({ ok: true, existingVerified: true }) });
    const h = await renderDialog(adapter);
    await click(must(h.container, "[data-accounts-mode-signup]"));
    await typeInto(must(h.container, "[data-accounts-email]"), "ada@example.com");
    await typeInto(must(h.container, "[data-accounts-name]"), "Ada Lovelace");
    await typeInto(must(h.container, "[data-accounts-password]"), "pw-123456");
    await click(must(h.container, "[data-accounts-submit]"));

    expect(step(h.container)).toBe("credentials");
    expect(h.adapter.sendOtp).not.toHaveBeenCalled();
    expect(banner(h.container)).toContain("already has an account");
  });
});

describe("Phase 46 - field validation happens before the request", () => {
  it("a missing display name blocks the sign-up", async () => {
    const h = await renderDialog();
    await click(must(h.container, "[data-accounts-mode-signup]"));
    await typeInto(must(h.container, "[data-accounts-email]"), "ada@example.com");
    await typeInto(must(h.container, "[data-accounts-password]"), "pw-123456");
    await click(must(h.container, "[data-accounts-submit]"));

    expect(h.adapter.signUpEmail).not.toHaveBeenCalled();
    expect(banner(h.container)).toContain("display name");
  });

  it("an invalid email blocks the sign-up", async () => {
    const h = await renderDialog();
    await click(must(h.container, "[data-accounts-mode-signup]"));
    await typeInto(must(h.container, "[data-accounts-email]"), "not-an-email");
    await typeInto(must(h.container, "[data-accounts-name]"), "Ada Lovelace");
    await typeInto(must(h.container, "[data-accounts-password]"), "pw-123456");
    await click(must(h.container, "[data-accounts-submit]"));

    expect(h.adapter.signUpEmail).not.toHaveBeenCalled();
    expect(banner(h.container)).toContain("valid email");
  });

  it("a 7-character password blocks the sign-up and states the rule", async () => {
    const h = await renderDialog();
    await click(must(h.container, "[data-accounts-mode-signup]"));
    await typeInto(must(h.container, "[data-accounts-email]"), "ada@example.com");
    await typeInto(must(h.container, "[data-accounts-name]"), "Ada Lovelace");
    await typeInto(must(h.container, "[data-accounts-password]"), "1234567");
    await click(must(h.container, "[data-accounts-submit]"));

    expect(h.adapter.signUpEmail).not.toHaveBeenCalled();
    expect(banner(h.container)).toContain("at least 8 characters");
  });
});

describe("Phase 46 - provider reasons are surfaced verbatim", () => {
  it("a VALIDATION_ERROR shows the field-level message, not the generic copy", async () => {
    const adapter = fakeAdapter({
      signUpEmail: async () => ({
        ok: false,
        code: "server",
        providerCode: "VALIDATION_ERROR",
        detail: "[body.name] Invalid input: expected string, received undefined",
      }),
    });
    const h = await renderDialog(adapter);
    await click(must(h.container, "[data-accounts-mode-signup]"));
    await typeInto(must(h.container, "[data-accounts-email]"), "ada@example.com");
    await typeInto(must(h.container, "[data-accounts-name]"), "Ada Lovelace");
    await typeInto(must(h.container, "[data-accounts-password]"), "pw-123456");
    await click(must(h.container, "[data-accounts-submit]"));

    const text = must(h.container, "[data-accounts-banner='error']").textContent ?? "";
    expect(text).toContain("Name: Invalid input: expected string, received undefined");
    expect(text).not.toContain("Something went wrong");
  });

  it("the live Google BAD_OAUTH_CALLBACK is surfaced verbatim, not hidden", async () => {
    // Captured live from the running app: the renderer is a file:// page, so
    // the SDK passes a relative callback and the provider answers 400.
    const adapter = fakeAdapter({
      signInGoogle: async () => ({
        ok: false,
        code: "server",
        providerCode: "BAD_OAUTH_CALLBACK",
        detail: "Origin header is required when callbackURL is not an absolute URL",
      }),
    });
    const h = await renderDialog(adapter);
    await click(must(h.container, "[data-accounts-google]"));

    expect(h.adapter.signInGoogle).toHaveBeenCalledTimes(1);
    const text = must(h.container, "[data-accounts-banner='error']").textContent ?? "";
    expect(text).toContain("Origin header is required when callbackURL is not an absolute URL");
    expect(text).toContain("BAD_OAUTH_CALLBACK");
    expect(text).not.toContain("Something went wrong");
  });

  it("an unverified sign-in still routes to the OTP step (no dead error banner)", async () => {
    const adapter = fakeAdapter({
      signInEmail: async () => ({ ok: false, code: "email-not-verified", providerCode: "EMAIL_NOT_VERIFIED", detail: "Email not verified" }),
    });
    const h = await renderDialog(adapter);
    await typeInto(must(h.container, "[data-accounts-email]"), "ada@example.com");
    await typeInto(must(h.container, "[data-accounts-password]"), "pw-123456");
    await click(must(h.container, "[data-accounts-submit]"));

    expect(h.adapter.sendOtp).toHaveBeenCalledWith({ email: "ada@example.com" });
    expect(step(h.container)).toBe("otp");
    expect(h.container.querySelector("[data-accounts-banner='error']")).toBeNull();
  });
});
