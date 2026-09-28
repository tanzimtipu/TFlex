// Phase 51 (item 2 / feature B) — automatic sync triggers.
//
// The wire-up test: `requestAutoSync` is the ONE path every trigger uses, it
// funnels into the existing coordinator (`accounts:syncNow`), it refuses while
// signed out, and the sign-in / signature-mutation call sites are wired.
// Document-level assertions (main's settings broadcast already requests a
// debounced sync) are quoted in the report, not re-pinned here.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { requestAutoSync } from "../../../src/renderer/accounts/autoSync";
import type { AccountsBridge } from "../../../src/renderer/accounts/bridge";

const ROOT = resolve(__dirname, "../../..");

function source(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

function fakeBridge(): { bridge: AccountsBridge; syncNow: ReturnType<typeof vi.fn> } {
  const syncNow = vi.fn(async () => ({ phase: "synced" }));
  return { bridge: { syncNow } as unknown as AccountsBridge, syncNow };
}

describe("Phase 51 item 2 — automatic sync triggers", () => {
  it("requests a sync through the existing coordinator when signed in", () => {
    const { bridge, syncNow } = fakeBridge();
    requestAutoSync({ signedIn: true, bridge });
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it("does not touch the coordinator while signed out", () => {
    const { bridge, syncNow } = fakeBridge();
    requestAutoSync({ signedIn: false, bridge });
    expect(syncNow).not.toHaveBeenCalled();
  });

  it("is a silent no-op when no bridge is exposed (unconfigured install)", () => {
    expect(() => requestAutoSync({ signedIn: true, bridge: null })).not.toThrow();
  });

  it("never rejects when the coordinator rejects", () => {
    const syncNow = vi.fn(() => Promise.reject(new Error("offline")));
    const bridge = { syncNow } as unknown as AccountsBridge;
    expect(() => requestAutoSync({ signedIn: true, bridge })).not.toThrow();
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it("wires the sign-in completions, the signature add/delete paths and the manual backup", () => {
    const dialog = source("src/renderer/components/AccountsDialog.tsx");
    // Password sign-in: after the session is stored.
    expect(dialog).toMatch(/api\.setSession\([\s\S]*?requestAutoSync\(\{ signedIn: true, bridge: api \}\)/);
    // Google (browser) sign-in: main already stored the session.
    expect(dialog).toMatch(/completeGoogleSignIn[\s\S]*?requestAutoSync\(\{ signedIn: result\.status === "signed-in" \}\)/);
    // The manual control stays as the backup.
    expect(dialog).toContain("api.syncNow()");

    const modal = source("src/renderer/signatures/SignatureManagerModal.tsx");
    // add (draw) + add (type) + delete each notify the host.
    expect(modal.match(/onSignaturesChanged\?\.\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);

    const app = source("src/renderer/App.tsx");
    expect(app).toContain("onSignaturesChanged={onSignaturesChanged}");
    expect(app).toMatch(/requestAutoSync\(\{ signedIn: accountStatus\.signedIn \}\)/);
    // Main's settings write already requests a debounced sync (existing path).
    expect(source("src/main/index.ts")).toContain("accountsSync?.requestSync()");
  });
});
