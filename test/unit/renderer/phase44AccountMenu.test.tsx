// @vitest-environment jsdom
//
// Phase 44 (operator amendment) — the top-bar account section with the auth
// adapter MOCKED. Proves the avatar fallback chain (image -> initials ->
// email letter), the expanding panel and its three actions, the Update-profile
// form (display name editable; email / password read-only), the Sync-now live
// status and sign-out through clearSession.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AccountMenu, PROFILE_IMMUTABLE_NOTE } from "../../../src/renderer/components/AccountMenu";
import type { AccountsAuthAdapter } from "../../../src/renderer/accounts/adapter";
import type { AccountUser, SyncReport } from "../../../src/shared/accounts";

const USER: AccountUser = {
  id: "u1",
  email: "ada@example.com",
  emailVerified: true,
  name: "Ada Lovelace",
};
const BASE_URL = "https://example.invalid";

interface FakeAdapter {
  adapter: AccountsAuthAdapter;
  updateName: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
}

function fakeAdapter(over: Partial<Record<string, unknown>> = {}): FakeAdapter {
  const parts = {
    updateName: vi.fn(async () => ({ ok: true })),
    signOut: vi.fn(async () => undefined),
  };
  for (const [key, value] of Object.entries(over)) {
    (parts as Record<string, ReturnType<typeof vi.fn>>)[key] = vi.fn(value as () => Promise<unknown>);
  }
  return { adapter: parts as unknown as AccountsAuthAdapter, ...parts } as FakeAdapter;
}

interface FakeBridge {
  getConfig: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
  clearSession: ReturnType<typeof vi.fn>;
  syncNow: ReturnType<typeof vi.fn>;
  onSyncReport: ReturnType<typeof vi.fn>;
}

function fakeBridge(over: Partial<Record<string, unknown>> = {}): FakeBridge {
  const parts = {
    getConfig: vi.fn(async () => ({ authBaseUrl: BASE_URL, configured: true })),
    getStatus: vi.fn(async () => ({ status: "signed-in", email: USER.email })),
    clearSession: vi.fn(async () => undefined),
    syncNow: vi.fn(async () => ({ phase: "synced", pushed: 1, pulled: 2 }) as SyncReport),
    onSyncReport: vi.fn(() => () => undefined),
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

interface Harness {
  container: HTMLElement;
  root: Root;
  adapter: FakeAdapter;
  bridge: FakeBridge;
  onOpenSignIn: ReturnType<typeof vi.fn>;
  onSignedOut: ReturnType<typeof vi.fn>;
  onProfileUpdated: ReturnType<typeof vi.fn>;
}

async function renderMenu(options: {
  signedIn?: boolean;
  user?: AccountUser | null;
  imageUrl?: string | null;
  adapter?: FakeAdapter;
  bridge?: FakeBridge;
} = {}): Promise<Harness> {
  const adapter = options.adapter ?? fakeAdapter();
  const bridge = options.bridge ?? fakeBridge();
  (window as unknown as { tflex?: unknown }).tflex = { accounts: bridge };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onOpenSignIn = vi.fn();
  const onSignedOut = vi.fn();
  const onProfileUpdated = vi.fn();
  act(() => {
    root.render(
      <AccountMenu
        signedIn={options.signedIn ?? true}
        user={options.user === undefined ? USER : options.user}
        imageUrl={options.imageUrl ?? null}
        onOpenSignIn={onOpenSignIn}
        onSignedOut={onSignedOut}
        onProfileUpdated={onProfileUpdated}
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
  return { container, root, adapter, bridge, onOpenSignIn, onSignedOut, onProfileUpdated };
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

describe("Phase 44 — the account avatar fallback chain", () => {
  it("renders the profile image when an image URL is set", async () => {
    const h = await renderMenu({ imageUrl: "https://img.example/ada.png" });
    const img = must(h.container, "[data-account-avatar] .account-avatar-img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://img.example/ada.png");
    expect(h.container.querySelector(".account-avatar-text")).toBeNull();
  });

  it("renders initials from a two-word name", async () => {
    const h = await renderMenu({ user: { ...USER, name: "Ada Lovelace" } });
    expect(must(h.container, "[data-account-avatar]").textContent).toBe("AL");
  });

  it("renders one letter for a single-word name", async () => {
    const h = await renderMenu({ user: { ...USER, name: "Ada" } });
    expect(must(h.container, "[data-account-avatar]").textContent).toBe("A");
  });

  it("falls back to the email's first letter when there is no name", async () => {
    const h = await renderMenu({ user: { ...USER, name: undefined } });
    expect(must(h.container, "[data-account-avatar]").textContent).toBe("A");
    expect(must(h.container, "[data-account-avatar]").getAttribute("aria-label")).toBe("ada@example.com");
  });
});

describe("Phase 44 — the signed-in avatar panel", () => {
  it("opens on click with the profile and its three actions", async () => {
    const h = await renderMenu();
    expect(h.container.querySelector("[data-account-panel]")).toBeNull();
    await click(must(h.container, "[data-account-avatar]"));
    expect(h.container.querySelector("[data-account-panel]")).not.toBeNull();
    expect(must(h.container, "[data-account-panel-name]").textContent).toBe("Ada Lovelace");
    expect(must(h.container, "[data-account-panel-email]").textContent).toBe("ada@example.com");
    expect(h.container.querySelector("[data-account-update-profile]")).not.toBeNull();
    expect(h.container.querySelector("[data-account-sync-now]")).not.toBeNull();
    expect(h.container.querySelector("[data-account-signout]")).not.toBeNull();
  });

  it("Sync now calls the bridge and renders the resolved live status", async () => {
    const h = await renderMenu();
    await click(must(h.container, "[data-account-avatar]"));
    await click(must(h.container, "[data-account-sync-now]"));
    expect(h.bridge.syncNow).toHaveBeenCalledTimes(1);
    expect(must(h.container, "[data-sync-phase]").getAttribute("data-sync-phase")).toBe("synced");
  });

  it("Sign out clears the session in main and reports signed-out", async () => {
    const h = await renderMenu();
    await click(must(h.container, "[data-account-avatar]"));
    await click(must(h.container, "[data-account-signout]"));
    expect(h.bridge.clearSession).toHaveBeenCalledTimes(1);
    expect(h.adapter.signOut).toHaveBeenCalledTimes(1);
    expect(h.onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("shows the sign-in entry when signed out and opens the auth surface", async () => {
    const h = await renderMenu({ signedIn: false, user: null });
    const entry = must(h.container, "[data-header-accounts='signed-out']");
    expect(entry.getAttribute("aria-label")).toBe("Sign in or create an account");
    await click(entry);
    expect(h.onOpenSignIn).toHaveBeenCalledTimes(1);
    expect(h.container.querySelector("[data-account-avatar]")).toBeNull();
  });
});

describe("Phase 44 — cold boot: the stored identity renders with no sign-in flow", () => {
  it("shows the stored name's initials immediately (no adapter sign-in runs)", async () => {
    const h = await renderMenu({ user: { ...USER, name: "Ada Lovelace" } });
    const avatar = must(h.container, "[data-account-avatar]");
    expect(avatar.textContent).toBe("AL");
    // No sign-in entry / auth surface: the identity came from boot props alone.
    expect(h.container.querySelector("[data-header-accounts='signed-out']")).toBeNull();
    expect(h.adapter.signOut).not.toHaveBeenCalled();
  });

  it("renders the provider image inside the round avatar with an accessible alt", async () => {
    const h = await renderMenu({ imageUrl: "https://img.example/ada.png" });
    const img = must(h.container, "[data-account-avatar] .account-avatar-img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://img.example/ada.png");
    expect(img.getAttribute("alt")).toBe("Ada Lovelace");
    expect(h.container.querySelector(".account-avatar-text")).toBeNull();
  });

  it("falls back to initials when the provider image fails to load", async () => {
    const h = await renderMenu({ imageUrl: "https://img.example/broken.png" });
    const img = must(h.container, "[data-account-avatar] .account-avatar-img") as HTMLImageElement;
    await act(async () => {
      img.dispatchEvent(new Event("error"));
    });
    expect(h.container.querySelector("[data-account-avatar] .account-avatar-img")).toBeNull();
    expect(must(h.container, "[data-account-avatar]").textContent).toBe("AL");
  });

  it("falls back to the email's first letter when boot carries no name and no image", async () => {
    const h = await renderMenu({ user: { ...USER, name: undefined }, imageUrl: null });
    expect(must(h.container, "[data-account-avatar]").textContent).toBe("A");
  });

  it("App feeds the boot name + image into the account section (source scan)", () => {
    const app = readFileSync(resolve(process.cwd(), "src/renderer/App.tsx"), "utf8");
    // The boot getStatus result forwards name + image into accountStatus.
    expect(app).toContain("name: result.name");
    expect(app).toContain("image: result.image");
    // The account section receives the boot-derived avatar URL.
    expect(app).toContain("imageUrl={accountStatus.image}");
  });
});

describe("Phase 44 — remote avatar hosts (CSP allow-list)", () => {
  // The renderer CSP allows exactly one remote image host (the Google avatar
  // CDN, https://lh3.googleusercontent.com) for the provider `image` field.
  // jsdom does not enforce CSP, so these tests prove the RENDER contract only:
  // an allow-listed URL becomes an <img src>, and any host that fails to load
  // (including one the CSP would block in a real browser) falls back to the
  // initials glyph through the same onError path. They cannot prove CSP
  // enforcement itself.
  const GOOGLE_AVATAR = "https://lh3.googleusercontent.com/a/ada-avatar=s96-c";

  it("renders an <img> for an allow-listed Google CDN URL", async () => {
    const h = await renderMenu({ imageUrl: GOOGLE_AVATAR });
    const img = must(h.container, "[data-account-avatar] .account-avatar-img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(GOOGLE_AVATAR);
    expect(img.getAttribute("alt")).toBe("Ada Lovelace");
    expect(h.container.querySelector(".account-avatar-text")).toBeNull();
  });

  it("falls back to initials via onError for a non-allow-listed host", async () => {
    const h = await renderMenu({ imageUrl: "https://not-allowed.example/ada.png" });
    const img = must(h.container, "[data-account-avatar] .account-avatar-img") as HTMLImageElement;
    await act(async () => {
      img.dispatchEvent(new Event("error"));
    });
    expect(h.container.querySelector("[data-account-avatar] .account-avatar-img")).toBeNull();
    expect(must(h.container, "[data-account-avatar]").textContent).toBe("AL");
  });
});

describe("Phase 44 — the Update-profile form", () => {
  it("saves a new display name through the adapter", async () => {
    const h = await renderMenu();
    await click(must(h.container, "[data-account-avatar]"));
    await click(must(h.container, "[data-account-update-profile]"));
    const input = must(h.container, "[data-account-name-input]");
    await typeInto(input, "Ada King");
    await click(must(h.container, "[data-account-save-profile]"));
    expect(h.adapter.updateName).toHaveBeenCalledWith({ name: "Ada King" });
    expect(h.onProfileUpdated).toHaveBeenCalledWith(expect.objectContaining({ name: "Ada King" }));
    // Back on the menu, showing the new name.
    expect(must(h.container, "[data-account-panel-name]").textContent).toBe("Ada King");
  });

  it("shows the email and password read-only with the explanation", async () => {
    const h = await renderMenu();
    await click(must(h.container, "[data-account-avatar]"));
    await click(must(h.container, "[data-account-update-profile]"));
    const email = must(h.container, "[data-account-email-readonly]") as HTMLInputElement;
    const password = must(h.container, "[data-account-password-readonly]") as HTMLInputElement;
    expect(email.readOnly).toBe(true);
    expect(password.readOnly).toBe(true);
    expect(email.value).toBe("ada@example.com");
    expect(must(h.container, "[data-account-immutable-note]").textContent).toBe(PROFILE_IMMUTABLE_NOTE);
  });

  it("surfaces a failure without leaving the form", async () => {
    const adapter = fakeAdapter({ updateName: async () => ({ ok: false, code: "server" }) });
    const h = await renderMenu({ adapter });
    await click(must(h.container, "[data-account-avatar]"));
    await click(must(h.container, "[data-account-update-profile]"));
    await click(must(h.container, "[data-account-save-profile]"));
    expect(must(h.container, "[data-account-profile-error]").textContent).toContain("Something went wrong");
    expect(h.container.querySelector("[data-account-profile-form]")).not.toBeNull();
  });
});
