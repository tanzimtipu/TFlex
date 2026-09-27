// @vitest-environment jsdom
//
// Phase 45 (item A) - the rebuilt account surface, with the auth adapter
// MOCKED. Proves the branded header, the Google brand mark, the
// forgot-password request/confirm flow, the unverified-email branch and the
// honest error copy (a reachability failure is never called "offline" when
// the app has connectivity).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AccountsDialog } from "../../../src/renderer/components/AccountsDialog";
import type { AccountsAuthAdapter } from "../../../src/renderer/accounts/adapter";

const BASE_URL = "https://example.invalid";
const CALLBACK_URL = "http://127.0.0.1:51234/oauth/callback?token=tok";

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
    signUpEmail: fn(async () => ({ ok: true })),
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

interface FakeBridge {
  getConfig: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
  setSession: ReturnType<typeof vi.fn>;
  clearSession: ReturnType<typeof vi.fn>;
  syncNow: ReturnType<typeof vi.fn>;
  onSyncReport: ReturnType<typeof vi.fn>;
  startOAuthCallback: ReturnType<typeof vi.fn>;
  stopOAuthCallback: ReturnType<typeof vi.fn>;
  onOAuthCallback: ReturnType<typeof vi.fn>;
}

function fakeBridge(over: Partial<Record<string, unknown>> = {}): FakeBridge {
  const parts = {
    getConfig: vi.fn(async () => ({ authBaseUrl: BASE_URL, configured: true })),
    getStatus: vi.fn(async () => ({ status: "signed-out", email: null, name: null })),
    setSession: vi.fn(async () => undefined),
    clearSession: vi.fn(async () => undefined),
    syncNow: vi.fn(async () => ({ phase: "synced" })),
    onSyncReport: vi.fn(() => () => undefined),
    startOAuthCallback: vi.fn(async () => ({ callbackUrl: CALLBACK_URL })),
    stopOAuthCallback: vi.fn(async () => undefined),
    onOAuthCallback: vi.fn(() => () => undefined),
  };
  for (const [key, value] of Object.entries(over)) {
    (parts as Record<string, unknown>)[key] = vi.fn(value as () => unknown);
  }
  return parts as FakeBridge;
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
  bridge: FakeBridge;
}> {
  const bridge = fakeBridge();
  (window as unknown as { tflex?: unknown }).tflex = { accounts: bridge };
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
  return { container, adapter, bridge };
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

describe("Phase 45 - the surface belongs to TFlex", () => {
  it("renders the app wordmark (TF mark + TFlex) in the header", async () => {
    const h = await renderDialog();
    expect(must(h.container, ".accounts-brand-mark").textContent).toBe("TF");
    expect(must(h.container, ".accounts-brand-name").textContent).toBe("TFlex");
    expect(must(h.container, ".accounts-brand-sub").textContent).toContain("Account");
  });

  it("sizes the sheet to its content (sheet-accounts + a full-width body)", async () => {
    const h = await renderDialog();
    const sheet = must(h.container, '[data-animated-dialog="accounts-dialog"]');
    expect(sheet.classList.contains("sheet-accounts")).toBe(true);
    expect(must(h.container, ".sheet-body-accounts")).not.toBeNull();
  });

  it("the Google button carries the inline Google mark, not just text", async () => {
    const h = await renderDialog();
    const button = must(h.container, "[data-accounts-google]");
    expect(button.textContent).toContain("Continue with Google");
    const mark = button.querySelector("svg.accounts-google-mark");
    expect(mark).not.toBeNull();
    // The four Google brand paths (blue/green/yellow/red), no theme recolour.
    expect(mark?.querySelectorAll("path").length).toBe(4);
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("still wires the Google flow: loopback callback -> adapter -> popup", async () => {
    const openSpy = vi
      .spyOn(window, "open")
      .mockReturnValue({ close: vi.fn() } as unknown as Window);
    try {
      const adapter = fakeAdapter({
        signInGoogle: async () => ({ ok: true, url: "https://auth.example.invalid/authorize" }),
      });
      const h = await renderDialog(adapter);
      await click(must(h.container, "[data-accounts-google]"));

      expect(h.bridge.startOAuthCallback).toHaveBeenCalledTimes(1);
      expect(h.adapter.signInGoogle).toHaveBeenCalledWith({ callbackUrl: CALLBACK_URL });
      expect(openSpy).toHaveBeenCalledWith(
        "https://auth.example.invalid/authorize",
        expect.any(String),
        expect.any(String),
      );
      expect(must(h.container, "[data-accounts-banner]").textContent).toContain(
        "Finish signing in with Google",
      );
    } finally {
      openSpy.mockRestore();
    }
  });
});

describe("Phase 45 - forgot password", () => {
  it("the sign-in view offers a Forgot password? link and opens the request step", async () => {
    const h = await renderDialog();
    await click(must(h.container, "[data-accounts-forgot]"));
    expect(step(h.container)).toBe("reset-request");
    expect(must(h.container, "[data-accounts-reset-lead]").textContent).toContain("reset code");
    expect(must(h.container, "[data-accounts-reset-submit]")).not.toBeNull();
  });

  it("requests a reset code and moves to the confirm step", async () => {
    const h = await renderDialog();
    await click(must(h.container, "[data-accounts-forgot]"));
    await typeInto(must(h.container, "[data-accounts-reset-email]"), "ada@example.com");
    await click(must(h.container, "[data-accounts-reset-submit]"));

    // Phase 46 - the request carries an ABSOLUTE, trusted redirect: the app's
    // own origin when it has one (a file:// renderer falls back to the URL
    // main mints). The provider refuses a relative one with VALIDATION_FAILED.
    expect(h.adapter.requestPasswordReset).toHaveBeenCalledWith({
      email: "ada@example.com",
      redirectTo: `${window.location.origin}/`,
    });
    // The app origin needs no listener at all.
    expect(h.bridge.startOAuthCallback).not.toHaveBeenCalled();
    expect(step(h.container)).toBe("reset-confirm");
    expect(must(h.container, "[data-accounts-reset-confirm-lead]").textContent).toContain("ada@example.com");
  });

  it("completes the reset with the code and a new password", async () => {
    const h = await renderDialog();
    await click(must(h.container, "[data-accounts-forgot]"));
    await typeInto(must(h.container, "[data-accounts-reset-email]"), "ada@example.com");
    await click(must(h.container, "[data-accounts-reset-submit]"));

    await typeInto(must(h.container, "[data-accounts-reset-code]"), "123456");
    await typeInto(must(h.container, "[data-accounts-new-password]"), "new-password-9");
    await click(must(h.container, "[data-accounts-reset-confirm]"));

    expect(h.adapter.resetPassword).toHaveBeenCalledWith({
      email: "ada@example.com",
      otp: "123456",
      password: "new-password-9",
    });
    // Back on sign-in, with a positive banner and the email kept.
    expect(step(h.container)).toBe("credentials");
    expect(must(h.container, "[data-accounts-banner='info']").textContent).toContain("Password updated");
    expect((must(h.container, "[data-accounts-email]") as HTMLInputElement).value).toBe("ada@example.com");
  });

  it("rejects a too-short new password without calling the adapter", async () => {
    const h = await renderDialog();
    await click(must(h.container, "[data-accounts-forgot]"));
    await typeInto(must(h.container, "[data-accounts-reset-email]"), "ada@example.com");
    await click(must(h.container, "[data-accounts-reset-submit]"));
    await typeInto(must(h.container, "[data-accounts-reset-code]"), "123456");
    await typeInto(must(h.container, "[data-accounts-new-password]"), "short");
    await click(must(h.container, "[data-accounts-reset-confirm]"));

    expect(h.adapter.resetPassword).not.toHaveBeenCalled();
    expect(step(h.container)).toBe("reset-confirm");
    expect(must(h.container, "[data-accounts-banner]").textContent).toContain("8 characters");
  });

  it("a request that fails as a reachability error is NOT called offline", async () => {
    const adapter = fakeAdapter({ requestPasswordReset: async () => ({ ok: false, code: "server" }) });
    const h = await renderDialog(adapter);
    await click(must(h.container, "[data-accounts-forgot]"));
    await typeInto(must(h.container, "[data-accounts-reset-email]"), "ada@example.com");
    await click(must(h.container, "[data-accounts-reset-submit]"));

    const banner = must(h.container, "[data-accounts-banner='error']").textContent?.toLowerCase() ?? "";
    expect(banner).toContain("something went wrong");
    expect(banner).not.toContain("offline");
    expect(step(h.container)).toBe("reset-request");
  });
});

describe("Phase 45 - honest states", () => {
  it("an unverified-email sign-in sends the code and moves to the OTP step", async () => {
    const adapter = fakeAdapter({ signInEmail: async () => ({ ok: false, code: "email-not-verified" }) });
    const h = await renderDialog(adapter);
    await typeInto(must(h.container, "[data-accounts-email]"), "ada@example.com");
    await typeInto(must(h.container, "[data-accounts-password]"), "pw-123456");
    await click(must(h.container, "[data-accounts-submit]"));

    expect(h.adapter.sendOtp).toHaveBeenCalledWith({ email: "ada@example.com" });
    expect(step(h.container)).toBe("otp");
    expect(must(h.container, "[data-accounts-otp-lead]").textContent).toContain("ada@example.com");
  });

  it("wrong credentials keep the user on the form with the credential message", async () => {
    const adapter = fakeAdapter({ signInEmail: async () => ({ ok: false, code: "invalid-credentials" }) });
    const h = await renderDialog(adapter);
    await typeInto(must(h.container, "[data-accounts-email]"), "ada@example.com");
    await typeInto(must(h.container, "[data-accounts-password]"), "nope");
    await click(must(h.container, "[data-accounts-submit]"));

    expect(step(h.container)).toBe("credentials");
    const banner = must(h.container, "[data-accounts-banner='error']");
    expect(banner.textContent).toContain("not correct");
    expect(banner.textContent?.toLowerCase()).not.toContain("offline");
  });

  it("only a genuine offline failure shows the offline message", async () => {
    const adapter = fakeAdapter({ signInEmail: async () => ({ ok: false, code: "network-offline" }) });
    const h = await renderDialog(adapter);
    await typeInto(must(h.container, "[data-accounts-email]"), "ada@example.com");
    await typeInto(must(h.container, "[data-accounts-password]"), "pw-123456");
    await click(must(h.container, "[data-accounts-submit]"));

    expect(must(h.container, "[data-accounts-banner='error']").textContent?.toLowerCase()).toContain("offline");
  });
});

