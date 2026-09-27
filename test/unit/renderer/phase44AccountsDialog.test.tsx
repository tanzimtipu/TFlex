// @vitest-environment jsdom
//
// Phase 44 — the account surface with the auth adapter MOCKED. Proves the
// sign-in / sign-up / OTP state machine, the exact setSession / clearSession
// IPC calls, the sync-status rendering and the unconfigured disabled state.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AccountsDialog, DEFERRED_REASON } from "../../../src/renderer/components/AccountsDialog";
import type { AccountsAuthAdapter } from "../../../src/renderer/accounts/adapter";
import type { AccountUser, SyncReport } from "../../../src/shared/accounts";

const USER: AccountUser = { id: "u1", email: "ada@example.com", emailVerified: true };
const BASE_URL = "https://example.invalid";

interface FakeAdapter {
  adapter: AccountsAuthAdapter;
  signInEmail: ReturnType<typeof vi.fn>;
  signUpEmail: ReturnType<typeof vi.fn>;
  sendOtp: ReturnType<typeof vi.fn>;
  verifyOtp: ReturnType<typeof vi.fn>;
  signInGoogle: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
}

function fakeAdapter(over: Partial<Record<string, unknown>> = {}): FakeAdapter {
  const fn = (impl: () => Promise<unknown>): ReturnType<typeof vi.fn> => vi.fn(impl);
  const parts = {
    signInEmail: fn(async () => ({ ok: true, user: USER, token: "jwt-token" })),
    signUpEmail: fn(async () => ({ ok: true })),
    sendOtp: fn(async () => ({ ok: true })),
    verifyOtp: fn(async () => ({ ok: true, user: USER, token: "jwt-token" })),
    signInGoogle: fn(async () => ({ ok: true })),
    signOut: fn(async () => undefined),
  };
  for (const [key, value] of Object.entries(over)) {
    (parts as Record<string, ReturnType<typeof vi.fn>>)[key] = vi.fn(value as () => Promise<unknown>);
  }
  return {
    adapter: parts as unknown as AccountsAuthAdapter,
    ...parts,
  } as FakeAdapter;
}

interface FakeBridge {
  getConfig: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
  setSession: ReturnType<typeof vi.fn>;
  clearSession: ReturnType<typeof vi.fn>;
  syncNow: ReturnType<typeof vi.fn>;
  onSyncReport: ReturnType<typeof vi.fn>;
  emitSync: (report: SyncReport) => void;
}

function fakeBridge(over: Partial<Record<string, unknown>> = {}): FakeBridge {
  let listener: ((report: SyncReport) => void) | null = null;
  const parts = {
    getConfig: vi.fn(async () => ({ authBaseUrl: BASE_URL, configured: true })),
    getStatus: vi.fn(async () => ({ status: "signed-out", email: null })),
    setSession: vi.fn(async () => undefined),
    clearSession: vi.fn(async () => undefined),
    syncNow: vi.fn(async () => ({ phase: "synced", pushed: 1, pulled: 2 }) as SyncReport),
    onSyncReport: vi.fn((cb: (report: SyncReport) => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    }),
  };
  for (const [key, value] of Object.entries(over)) {
    (parts as Record<string, unknown>)[key] = vi.fn(value as () => unknown);
  }
  return {
    ...parts,
    emitSync: (report: SyncReport): void => listener?.(report),
  } as FakeBridge;
}

interface Harness {
  container: HTMLElement;
  root: Root;
  adapter: FakeAdapter;
  bridge: FakeBridge | null;
  onClose: ReturnType<typeof vi.fn>;
  onStatusChange: ReturnType<typeof vi.fn>;
  cleanup: () => void;
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

async function renderDialog(options: {
  adapter?: FakeAdapter;
  bridge?: FakeBridge | null;
  open?: boolean;
} = {}): Promise<Harness> {
  const adapter = options.adapter ?? fakeAdapter();
  const bridge = "bridge" in options ? options.bridge ?? null : fakeBridge();
  (window as unknown as { tflex?: unknown }).tflex = bridge === null ? {} : { accounts: bridge };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onClose = vi.fn();
  const onStatusChange = vi.fn();
  act(() => {
    root.render(
      <AccountsDialog
        open={options.open ?? true}
        onClose={onClose}
        createAdapter={(): AccountsAuthAdapter => adapter.adapter}
        onStatusChange={onStatusChange}
      />,
    );
  });
  await flush();
  const cleanup = (): void => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };
  mounted.push(cleanup);
  return { container, root, adapter, bridge, onClose, onStatusChange, cleanup };
}

function query(container: HTMLElement, selector: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(selector);
}

function must(container: HTMLElement, selector: string): HTMLElement {
  const el = query(container, selector);
  if (el === null) throw new Error(`missing ${selector}`);
  return el;
}

/** The live sync-status strip. During an AnimatePresence swap the exiting
 *  node can still be in the DOM, so take the LAST match (the entering one). */
function syncStatus(container: HTMLElement): HTMLElement {
  const all = container.querySelectorAll<HTMLElement>("[data-sync-phase]");
  const el = all[all.length - 1];
  if (el === undefined) throw new Error("missing [data-sync-phase]");
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

describe("Phase 44 � account surface (adapter mocked)", () => {
  it("shows a clear DISABLED state (not a server error) when the service is unconfigured", async () => {
    const bridge = fakeBridge({ getConfig: async () => ({ authBaseUrl: null, configured: false }) });
    const h = await renderDialog({ bridge });
    expect(query(h.container, "[data-accounts-unconfigured]")).not.toBeNull();
    expect(query(h.container, "[data-accounts-auth]")).toBeNull();
    expect(h.container.textContent).toContain("not configured");
  });

  it("treats a missing preload bridge as unconfigured (never throws)", async () => {
    const h = await renderDialog({ bridge: null });
    expect(query(h.container, "[data-accounts-unconfigured]")).not.toBeNull();
  });

  it("signs in, hands the JWT to main via setSession, and shows the email", async () => {
    const h = await renderDialog();
    await typeInto(must(h.container, "[data-accounts-email]"), "ada@example.com");
    await typeInto(must(h.container, "[data-accounts-password]"), "pw-123456");
    await click(must(h.container, "[data-accounts-submit]"));

    expect(h.adapter.signInEmail).toHaveBeenCalledWith({ email: "ada@example.com", password: "pw-123456" });
    expect(h.bridge?.setSession).toHaveBeenCalledTimes(1);
    expect(h.bridge?.setSession).toHaveBeenCalledWith({
      user: expect.objectContaining({ email: "ada@example.com" }),
      token: "jwt-token",
    });
    expect(query(h.container, "[data-accounts-signed-in]")).not.toBeNull();
    expect(must(h.container, "[data-accounts-email-shown]").textContent).toContain("ada@example.com");
    expect(h.onStatusChange).toHaveBeenCalledWith("signed-in", "ada@example.com", null);
  });

  it("a sign-up creates the account, sends the OTP, and moves to the code step", async () => {
    const h = await renderDialog();
    await click(must(h.container, "[data-accounts-mode-signup]"));
    await typeInto(must(h.container, "[data-accounts-email]"), "ada@example.com");
    await typeInto(must(h.container, "[data-accounts-password]"), "pw-123456");
    await click(must(h.container, "[data-accounts-submit]"));

    expect(h.adapter.signUpEmail).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "pw-123456",
      name: undefined,
    });
    expect(h.adapter.sendOtp).toHaveBeenCalledWith({ email: "ada@example.com" });
    expect(must(h.container, "[data-accounts-auth]").getAttribute("data-accounts-step")).toBe("otp");
    expect(must(h.container, "[data-accounts-otp-lead]").textContent).toContain("ada@example.com");
  });

  it("a WRONG code shows the code-invalid message without blocking the form", async () => {
    const h = await renderDialog();
    await click(must(h.container, "[data-accounts-mode-signup]"));
    await typeInto(must(h.container, "[data-accounts-email]"), "ada@example.com");
    await typeInto(must(h.container, "[data-accounts-password]"), "pw-123456");
    await click(must(h.container, "[data-accounts-submit]"));
    h.adapter.verifyOtp.mockResolvedValueOnce({ ok: false, code: "code-invalid" });

    await typeInto(must(h.container, "[data-accounts-otp]"), "000000");
    await click(must(h.container, "[data-accounts-submit]"));

    const banner = must(h.container, "[data-accounts-banner='error']");
    expect(banner.textContent).toContain("not correct");
    // still on the code step, form usable
    expect(must(h.container, "[data-accounts-auth]").getAttribute("data-accounts-step")).toBe("otp");
    expect(must(h.container, "[data-accounts-submit]").hasAttribute("disabled")).toBe(false);
  });

  it("an EXPIRED code shows the resend hint and leaves the form usable", async () => {
    const h = await renderDialog();
    await click(must(h.container, "[data-accounts-mode-signup]"));
    await typeInto(must(h.container, "[data-accounts-email]"), "ada@example.com");
    await typeInto(must(h.container, "[data-accounts-password]"), "pw-123456");
    await click(must(h.container, "[data-accounts-submit]"));
    h.adapter.verifyOtp.mockResolvedValueOnce({ ok: false, code: "code-expired" });

    await typeInto(must(h.container, "[data-accounts-otp]"), "111111");
    await click(must(h.container, "[data-accounts-submit]"));

    expect(must(h.container, "[data-accounts-banner='error']").textContent?.toLowerCase()).toContain("expired");
  });

  it("resend asks the adapter for a fresh code", async () => {
    const h = await renderDialog();
    await click(must(h.container, "[data-accounts-mode-signup]"));
    await typeInto(must(h.container, "[data-accounts-email]"), "ada@example.com");
    await typeInto(must(h.container, "[data-accounts-password]"), "pw-123456");
    await click(must(h.container, "[data-accounts-submit]"));
    h.adapter.sendOtp.mockClear();

    await click(must(h.container, "[data-accounts-resend]"));
    expect(h.adapter.sendOtp).toHaveBeenCalledWith({ email: "ada@example.com" });
    expect(must(h.container, "[data-accounts-banner]").textContent).toContain("ada@example.com");
  });

  it("a network failure signs nothing in and shows the offline message", async () => {
    const adapter = fakeAdapter({ signInEmail: async () => ({ ok: false, code: "network-offline" }) });
    const surface = await renderDialog({ adapter });
    await typeInto(must(surface.container, "[data-accounts-email]"), "ada@example.com");
    await typeInto(must(surface.container, "[data-accounts-password]"), "pw-123456");
    await click(must(surface.container, "[data-accounts-submit]"));

    expect(surface.bridge?.setSession).not.toHaveBeenCalled();
    expect(query(surface.container, "[data-accounts-signed-in]")).toBeNull();
    expect(must(surface.container, "[data-accounts-banner='error']").textContent?.toLowerCase()).toContain("offline");
  });
});

describe("Phase 44 � signed-in surface and sync status", () => {
  const signedIn = (over: Partial<Record<string, unknown>> = {}): FakeBridge =>
    fakeBridge({ getStatus: async () => ({ status: "signed-in", email: "ada@example.com" }), ...over });

  it("shows the account email and a Sync now action", async () => {
    const h = await renderDialog({ bridge: signedIn() });
    expect(query(h.container, "[data-accounts-signed-in]")).not.toBeNull();
    expect(must(h.container, "[data-accounts-email-shown]").textContent).toContain("ada@example.com");
    expect(query(h.container, "[data-accounts-sync-now]")).not.toBeNull();
  });

  it("Sync now calls the bridge and renders the resolved report", async () => {
    const bridge = signedIn();
    const h = await renderDialog({ bridge });
    await click(must(h.container, "[data-accounts-sync-now]"));
    expect(bridge.syncNow).toHaveBeenCalledTimes(1);
    expect(must(h.container, "[data-sync-phase]").getAttribute("data-sync-phase")).toBe("synced");
    expect(must(h.container, "[data-sync-phase]").textContent).toContain("2 pulled");
  });

  it("renders each pushed sync phase, including the non-error unavailable state", async () => {
    const bridge = signedIn();
    const h = await renderDialog({ bridge });
    const push = async (report: SyncReport): Promise<void> => {
      await act(async () => {
        bridge.emitSync(report);
      });
      await flush();
    };

    await push({ phase: "syncing" });
    expect(syncStatus(h.container).getAttribute("data-sync-phase")).toBe("syncing");

    await push({ phase: "unavailable" });
    expect(syncStatus(h.container).getAttribute("data-sync-phase")).toBe("unavailable");
    expect(syncStatus(h.container).textContent).toContain("not configured");

    await push({ phase: "offline" });
    expect(syncStatus(h.container).getAttribute("data-sync-phase")).toBe("offline");

    await push({ phase: "error", error: { code: "server", message: "boom" } });
    expect(syncStatus(h.container).getAttribute("data-sync-phase")).toBe("error");
    expect(syncStatus(h.container).textContent).toContain("boom");
  });

  it("Sign out clears the session in main and returns to the auth form", async () => {
    const bridge = signedIn();
    const h = await renderDialog({ bridge });
    await click(must(h.container, "[data-accounts-signout]"));

    expect(bridge.clearSession).toHaveBeenCalledTimes(1);
    expect(h.adapter.signOut).toHaveBeenCalledTimes(1);
    expect(query(h.container, "[data-accounts-auth]")).not.toBeNull();
    expect(h.onStatusChange).toHaveBeenCalledWith("signed-out", null, null);
  });

  it("Continue with Google launches the adapter provider flow", async () => {
    const h = await renderDialog();
    await click(must(h.container, "[data-accounts-google]"));
    expect(h.adapter.signInGoogle).toHaveBeenCalledTimes(1);
  });

  it("Export / Delete are visibly disabled with the deferred reason", async () => {
    const h = await renderDialog({ bridge: signedIn() });
    const ex = must(h.container, "[data-accounts-export]") as HTMLButtonElement;
    const del = must(h.container, "[data-accounts-delete]") as HTMLButtonElement;
    expect(ex.disabled).toBe(true);
    expect(del.disabled).toBe(true);
    expect(ex.title).toBe(DEFERRED_REASON);
    expect(del.title).toBe(DEFERRED_REASON);
    expect(DEFERRED_REASON).toContain("sync release");
  });

  it("does not render any account surface when the dialog is closed", async () => {
    const h = await renderDialog({ open: false });
    expect(query(h.container, "[data-accounts-unconfigured]")).toBeNull();
    expect(query(h.container, "[data-accounts-auth]")).toBeNull();
    expect(query(h.container, "[data-accounts-signed-in]")).toBeNull();
  });
});
