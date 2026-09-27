// @vitest-environment jsdom
//
// Phase 46 - the account surface drives the Google loopback flow, with the
// auth adapter and the preload bridge MOCKED:
//
//   - an `ok` outcome completes the sign-in exactly like the email flow
//     (setSession -> signed-in UI) and closes the popup;
//   - a timeout shows the non-blocking message and does NOT sign anyone in;
//   - closing/unmounting the surface cancels the flow and releases the
//     loopback listener, so nothing outlives the dialog;
//   - the reset request carries the absolute loopback redirect, and a bridge
//     too old to mint one falls back to the plain request.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AccountsDialog } from "../../../src/renderer/components/AccountsDialog";
import type { AccountsAuthAdapter } from "../../../src/renderer/accounts/adapter";
import type { AccountUser, OAuthCallbackOutcome } from "../../../src/shared/accounts";

const BASE_URL = "https://example.invalid";
const CALLBACK_URL = "http://127.0.0.1:51234/oauth/callback?token=tok";
const AUTHORIZE_URL = "https://auth.example.invalid/oauth2/authorize";
const USER: AccountUser = { id: "u1", email: "ada@example.com", emailVerified: true };

interface FakeAdapter {
  adapter: AccountsAuthAdapter;
  signInGoogle: ReturnType<typeof vi.fn>;
  completeWebSignIn: ReturnType<typeof vi.fn>;
  requestPasswordReset: ReturnType<typeof vi.fn>;
}

function fakeAdapter(over: Partial<Record<string, unknown>> = {}): FakeAdapter {
  const parts = {
    signInEmail: vi.fn(async () => ({ ok: true, user: USER, token: "jwt" })),
    signUpEmail: vi.fn(async () => ({ ok: true })),
    sendOtp: vi.fn(async () => ({ ok: true })),
    verifyOtp: vi.fn(async () => ({ ok: true, user: USER, token: "jwt" })),
    signInGoogle: vi.fn(async () => ({ ok: true, url: AUTHORIZE_URL })),
    completeWebSignIn: vi.fn(async () => ({ ok: true, user: USER, token: "session-jwt" })),
    requestPasswordReset: vi.fn(async () => ({ ok: true })),
    resetPassword: vi.fn(async () => ({ ok: true })),
    signOut: vi.fn(async () => undefined),
    updateName: vi.fn(async () => ({ ok: true })),
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
  startOAuthCallback?: ReturnType<typeof vi.fn>;
  stopOAuthCallback: ReturnType<typeof vi.fn>;
  onOAuthCallback?: ReturnType<typeof vi.fn>;
  emitOAuth: (outcome: OAuthCallbackOutcome) => void;
  oauthUnsubscribed: () => boolean;
}

function fakeBridge(options: { noLoopback?: boolean } = {}): FakeBridge {
  let oauthListener: ((outcome: OAuthCallbackOutcome) => void) | null = null;
  let unsubscribed = false;
  const parts: Record<string, unknown> = {
    getConfig: vi.fn(async () => ({ authBaseUrl: BASE_URL, configured: true })),
    getStatus: vi.fn(async () => ({ status: "signed-out", email: null, name: null })),
    setSession: vi.fn(async () => undefined),
    clearSession: vi.fn(async () => undefined),
    syncNow: vi.fn(async () => ({ phase: "synced" })),
    onSyncReport: vi.fn(() => () => undefined),
    stopOAuthCallback: vi.fn(async () => undefined),
  };
  if (options.noLoopback !== true) {
    parts.startOAuthCallback = vi.fn(async () => ({ callbackUrl: CALLBACK_URL }));
    parts.onOAuthCallback = vi.fn((cb: (outcome: OAuthCallbackOutcome) => void) => {
      oauthListener = cb;
      return () => {
        oauthListener = null;
        unsubscribed = true;
      };
    });
  }
  parts.emitOAuth = (outcome: OAuthCallbackOutcome): void => oauthListener?.(outcome);
  parts.oauthUnsubscribed = (): boolean => unsubscribed;
  return parts as unknown as FakeBridge;
}

const mounted: Array<() => void> = [];
afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
  delete (window as unknown as { tflex?: unknown }).tflex;
  vi.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderDialog(options: {
  adapter?: FakeAdapter;
  bridge?: FakeBridge;
} = {}): Promise<{
  container: HTMLElement;
  adapter: FakeAdapter;
  bridge: FakeBridge;
  unmount: () => void;
}> {
  const adapter = options.adapter ?? fakeAdapter();
  const bridge = options.bridge ?? fakeBridge();
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
  const unmount = (): void => {
    const index = mounted.indexOf(unmount);
    if (index >= 0) mounted.splice(index, 1);
    act(() => {
      root.unmount();
    });
    container.remove();
  };
  mounted.push(unmount);
  return { container, adapter, bridge, unmount };
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

const bannerText = (container: HTMLElement): string =>
  container.querySelector<HTMLElement>("[data-accounts-banner]")?.textContent ?? "";

async function openGoogle(container: HTMLElement): Promise<void> {
  await click(must(container, "[data-accounts-google]"));
}

describe("Phase 46 - the surface completes a Google sign-in", () => {
  it("ok -> session -> setSession -> signed-in UI, and the popup is closed", async () => {
    const popup = { close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const h = await renderDialog();
    await openGoogle(h.container);

    expect(h.bridge.startOAuthCallback).toHaveBeenCalledTimes(1);
    expect(h.adapter.signInGoogle).toHaveBeenCalledWith({ callbackUrl: CALLBACK_URL });

    await act(async () => {
      h.bridge.emitOAuth({ ok: true });
    });
    await flush();

    expect(h.adapter.completeWebSignIn).toHaveBeenCalledTimes(1);
    expect(h.bridge.setSession).toHaveBeenCalledWith({ user: USER, token: "session-jwt" });
    expect(must(h.container, "[data-accounts-email-shown]").textContent).toBe("ada@example.com");
    expect(popup.close).toHaveBeenCalled();
    expect(h.bridge.stopOAuthCallback).toHaveBeenCalledTimes(1);
  });

  it("a timeout shows the message, signs nobody in, and releases the listener", async () => {
    vi.spyOn(window, "open").mockReturnValue({ close: vi.fn() } as unknown as Window);
    const h = await renderDialog();
    await openGoogle(h.container);

    await act(async () => {
      h.bridge.emitOAuth({ ok: false, reason: "timeout" });
    });
    await flush();

    expect(bannerText(h.container)).toContain("Google sign-in timed out. Try again.");
    expect(h.adapter.completeWebSignIn).not.toHaveBeenCalled();
    expect(h.bridge.setSession).not.toHaveBeenCalled();
    expect(h.bridge.stopOAuthCallback).toHaveBeenCalledTimes(1);
  });

  it("unmounting the surface cancels the flow; a late outcome fires nothing", async () => {
    vi.spyOn(window, "open").mockReturnValue({ close: vi.fn() } as unknown as Window);
    const h = await renderDialog();
    await openGoogle(h.container);
    expect(h.bridge.oauthUnsubscribed()).toBe(false);

    h.unmount();

    expect(h.bridge.oauthUnsubscribed()).toBe(true);
    expect(h.bridge.stopOAuthCallback).toHaveBeenCalledTimes(1);

    await act(async () => {
      h.bridge.emitOAuth({ ok: true });
    });
    await flush();
    expect(h.bridge.setSession).not.toHaveBeenCalled();
  });
});

describe("Phase 46 - the reset request carries an absolute redirect", () => {
  it("uses the renderer's own absolute origin (no listener needed)", async () => {
    const h = await renderDialog();
    await click(must(h.container, "[data-accounts-forgot]"));
    await typeInto(must(h.container, "[data-accounts-reset-email]"), "ada@example.com");
    await click(must(h.container, "[data-accounts-reset-submit]"));

    expect(h.adapter.requestPasswordReset).toHaveBeenCalledWith({
      email: "ada@example.com",
      redirectTo: `${window.location.origin}/`,
    });
    // The trusted origin is the page's own: the loopback is not touched.
    expect(h.bridge.startOAuthCallback).not.toHaveBeenCalled();
    expect(h.bridge.stopOAuthCallback).not.toHaveBeenCalled();
    expect(must(h.container, "[data-accounts-reset-confirm]")).not.toBeNull();
  });

  it("still sends the absolute origin when the bridge has no loopback", async () => {
    const h = await renderDialog({ bridge: fakeBridge({ noLoopback: true }) });
    await click(must(h.container, "[data-accounts-forgot]"));
    await typeInto(must(h.container, "[data-accounts-reset-email]"), "ada@example.com");
    await click(must(h.container, "[data-accounts-reset-submit]"));

    expect(h.adapter.requestPasswordReset).toHaveBeenCalledWith({
      email: "ada@example.com",
      redirectTo: `${window.location.origin}/`,
    });
    expect(must(h.container, "[data-accounts-reset-confirm]")).not.toBeNull();
  });
});
