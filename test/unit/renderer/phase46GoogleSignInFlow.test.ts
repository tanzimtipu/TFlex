// @vitest-environment node
//
// Phase 46 - the Google sign-in loopback state machine, with the preload
// bridge MOCKED. No DOM, no SDK, no Electron:
//
//   start -> signIn.social(callbackURL) -> open -> provider lands -> ok
//         -> getSession + JWT -> signed in
//   timeout / cancelled / error -> one non-blocking message, nothing left behind
//   provider failure -> onFailure carries the real provider code/message
//   cancel (unmount) -> listener released, popup closed, no callback fires
//
// The callback URL is the point of the whole flow: the packaged renderer is a
// file:// page whose origin the provider rejects, so every request must carry
// the absolute 127.0.0.1 URL main mints.

import { describe, expect, it, vi } from "vitest";
import type { AccountStatusResult, OpenAuthUrlResult } from "../../../src/shared/accounts";
import {
  absoluteRedirectUrl,
  callbackOutcomeMessage,
  isUsableAppOrigin,
  resetRedirectUrl,
  runGoogleSignIn,
  type GoogleSignInPorts,
} from "../../../src/renderer/accounts/oauthLoopback";

const CALLBACK = "http://127.0.0.1:51234/oauth/callback?token=single-use";
const AUTHORIZE = "https://auth.example.invalid/oauth2/authorize?client_id=tflex";
/** The status main reports after IT completed the Google exchange: the real
 *  identity, with name and avatar, never a token. */
const SIGNED_IN_STATUS = {
  status: "signed-in" as const,
  email: "ada@example.com",
  name: "Ada Lovelace",
  image: "https://cdn.example.invalid/ada.png",
};

type Outcome = { ok: true } | { ok: false; reason: "timeout" | "cancelled" | "error"; message?: string };

interface Harness {
  handle: ReturnType<typeof runGoogleSignIn>;
  calls: {
    open: string[];
    signedIn: Array<{ status: unknown }>;
    failure: Array<Record<string, unknown>>;
    info: string[];
  };
  bridge: GoogleSignInPorts["bridge"];
  adapter: GoogleSignInPorts["adapter"];
  getStatus: ReturnType<typeof vi.fn>;
  emit: (outcome: Outcome) => void;
  hasListener: () => boolean;
}

function harness(over: {
  startRejects?: boolean;
  signIn?: () => Promise<unknown>;
  getStatus?: () => Promise<unknown>;
  open?: (url: string) => OpenAuthUrlResult;
  openRejects?: boolean;
  noLoopback?: boolean;
} = {}): Harness {
  let listener: ((outcome: Outcome) => void) | null = null;
  const calls: Harness["calls"] = { open: [], signedIn: [], failure: [], info: [] };
  const bridge = {
    startOAuthCallback: over.noLoopback
      ? undefined
      : vi.fn(async () => {
        if (over.startRejects === true) throw new Error("listen EADDRINUSE: address already in use");
        return { callbackUrl: CALLBACK };
      }),
    stopOAuthCallback: vi.fn(async () => undefined),
    onOAuthCallback: over.noLoopback
      ? undefined
      : vi.fn((cb: (outcome: Outcome) => void) => {
        listener = cb;
        return () => {
          listener = null;
        };
      }),
  } as GoogleSignInPorts["bridge"];
  const adapter = {
    signInGoogle: vi.fn(
      over.signIn ?? (async () => ({ ok: true, url: AUTHORIZE })),
    ),
  } as unknown as GoogleSignInPorts["adapter"];
  const getStatus = vi.fn(over.getStatus ?? (async () => SIGNED_IN_STATUS));
  const handle = runGoogleSignIn({
    bridge,
    adapter,
    getStatus: getStatus as unknown as () => Promise<AccountStatusResult>,
    openAuthPopup: async (url: string): Promise<OpenAuthUrlResult> => {
      calls.open.push(url);
      if (over.openRejects === true) throw new Error("bridge exploded");
      return over.open === undefined ? { ok: true } : over.open(url);
    },
    onSignedIn: (status): void => {
      calls.signedIn.push({ status });
    },
    onFailure: (failure): void => {
      calls.failure.push(failure as unknown as Record<string, unknown>);
    },
    onInfo: (text): void => {
      calls.info.push(text);
    },
  });
  return {
    handle,
    calls,
    bridge,
    adapter,
    getStatus,
    emit: (outcome: Outcome): void => listener?.(outcome),
    hasListener: (): boolean => listener !== null,
  };
}

/** Wait until the async flow has produced the expected observable state. */
async function until(assert: () => void): Promise<void> {
  await vi.waitFor(assert, { timeout: 2000, interval: 10 });
}

describe("Phase 46 - Google sign-in: start -> open -> ok -> getStatus -> signed in", () => {
  it("mints the loopback URL, asks the SDK for the authorize URL, opens it, then learns the identity from getStatus (no SDK session read)", async () => {
    const h = harness();
    await until(() => expect(h.calls.open).toHaveLength(1));

    expect(h.bridge.startOAuthCallback).toHaveBeenCalledTimes(1);
    expect(h.adapter.signInGoogle).toHaveBeenCalledWith({ callbackUrl: CALLBACK });
    expect(h.calls.open).toEqual([AUTHORIZE]);
    expect(h.calls.info).toContain(
      "Finish signing in with Google in the Jovrel sign-in window - Jovrel will take it from there.",
    );
    // Still waiting: no status re-read, nothing closed or cancelled.
    expect(h.getStatus).not.toHaveBeenCalled();
    expect(h.bridge.stopOAuthCallback).not.toHaveBeenCalled();

    h.emit({ ok: true });
    await until(() => expect(h.calls.signedIn).toHaveLength(1));

    // The renderer's own SDK session read is GONE: main completed the
    // exchange, so the identity comes from the status re-query.
    expect(h.getStatus).toHaveBeenCalledTimes(1);
    expect(h.calls.signedIn[0].status).toEqual(SIGNED_IN_STATUS);
    expect(h.calls.failure).toHaveLength(0);
    // The listener is released once the flow settles.
    expect(h.bridge.stopOAuthCallback).toHaveBeenCalledTimes(1);
  });

  it("a timeout reports once, non-blocking, and releases the listener", async () => {
    const h = harness();
    await until(() => expect(h.calls.open).toHaveLength(1));
    h.emit({ ok: false, reason: "timeout" });
    await until(() => expect(h.calls.info).toContain(callbackOutcomeMessage("timeout")));
    expect(h.getStatus).not.toHaveBeenCalled();
    expect(h.calls.failure).toHaveLength(0);
    expect(h.bridge.stopOAuthCallback).toHaveBeenCalledTimes(1);
  });

  it("a cancelled outcome reports the cancel message", async () => {
    const h = harness();
    await until(() => expect(h.calls.open).toHaveLength(1));
    h.emit({ ok: false, reason: "cancelled" });
    await until(() => expect(h.calls.info).toContain("Google sign-in was cancelled."));
    expect(h.calls.signedIn).toHaveLength(0);
  });

  it("a listener error reports the local failure message", async () => {
    const h = harness();
    await until(() => expect(h.calls.open).toHaveLength(1));
    h.emit({ ok: false, reason: "error" });
    await until(() => expect(h.calls.info).toContain("Google sign-in could not complete. Try again."));
  });

  it("the status re-read failing after ok surfaces the real failure, not a sign-in", async () => {
    const h = harness({ getStatus: async () => { throw new Error("status unavailable"); } });
    await until(() => expect(h.calls.open).toHaveLength(1));
    h.emit({ ok: true });
    await until(() => expect(h.calls.failure).toHaveLength(1));
    expect(h.calls.signedIn).toHaveLength(0);
    expect(h.getStatus).toHaveBeenCalledTimes(1);
  });

  it("main says ok but the status is not signed-in: an honest message, no silent signed-out sheet", async () => {
    const h = harness({ getStatus: async () => ({ status: "signed-out", email: null, name: null, image: null }) });
    await until(() => expect(h.calls.open).toHaveLength(1));
    h.emit({ ok: true });
    await until(() => expect(h.calls.info).toContain("Google sign-in finished, but no session was stored. Try again."));
    expect(h.calls.signedIn).toHaveLength(0);
  });
});

describe("Phase 46 - Google sign-in: the real failure reaches the user", () => {
  it("a provider error keeps its code and message, and never opens a window", async () => {
    const h = harness({
      signIn: async () => ({
        ok: false,
        code: "server",
        providerCode: "BAD_OAUTH_CALLBACK",
        detail: "Origin header is required when callbackURL is not an absolute URL",
      }),
    });
    await until(() => expect(h.calls.failure).toHaveLength(1));

    expect(h.calls.failure[0].providerCode).toBe("BAD_OAUTH_CALLBACK");
    expect(h.calls.failure[0].detail).toBe("Origin header is required when callbackURL is not an absolute URL");
    expect(h.calls.open).toHaveLength(0);
    expect(h.calls.signedIn).toHaveLength(0);
    // A failed start never leaves the loopback listener bound.
    expect(h.bridge.stopOAuthCallback).toHaveBeenCalledTimes(1);
  });

  it("a listener that cannot bind is a failure, not a silent no-op", async () => {
    const h = harness({ startRejects: true });
    await until(() => expect(h.calls.failure).toHaveLength(1));
    expect(h.calls.failure[0].code).toBe("server");
    expect(h.adapter.signInGoogle).not.toHaveBeenCalled();
    expect(h.calls.open).toHaveLength(0);
  });

  it("a popup that will not open (failed) is reported, not left as a dead button", async () => {
    const h = harness({ open: () => ({ ok: false, reason: "failed" }) });
    await until(() =>
      expect(h.calls.info).toContain("Jovrel could not open your browser for Google sign-in. Try again."),
    );
    expect(h.calls.signedIn).toHaveLength(0);
    expect(h.bridge.stopOAuthCallback).toHaveBeenCalledTimes(1);
  });

  it("a refused sign-in address (invalid-url) is reported honestly and never retried", async () => {
    const h = harness({ open: () => ({ ok: false, reason: "invalid-url" }) });
    await until(() =>
      expect(h.calls.info).toContain("The Google sign-in address was rejected. Try again."),
    );
    // Handed to main exactly once: a refusal must not silently re-open.
    expect(h.calls.open).toEqual([AUTHORIZE]);
    expect(h.calls.signedIn).toHaveLength(0);
    expect(h.calls.failure).toHaveLength(0);
    expect(h.bridge.stopOAuthCallback).toHaveBeenCalledTimes(1);
  });

  it("a bridge that rejects openAuthPopup surfaces a failure instead of hanging", async () => {
    const h = harness({ openRejects: true });
    await until(() => expect(h.calls.failure).toHaveLength(1));
    expect(h.calls.signedIn).toHaveLength(0);
    expect(h.bridge.stopOAuthCallback).toHaveBeenCalledTimes(1);
  });

  it("an older preload without the loopback bridge says so instead of throwing", async () => {
    const h = harness({ noLoopback: true });
    await until(() => expect(h.calls.info).toContain("Google sign-in is not available in this build."));
    expect(h.adapter.signInGoogle).not.toHaveBeenCalled();
    expect(h.calls.open).toHaveLength(0);
  });

  it("an ok:false outcome WITH a message shows the provider/main reason verbatim, never the generic copy", async () => {
    const h = harness();
    await until(() => expect(h.calls.open).toHaveLength(1));
    const reason = "The account service returned 400 INVALID_CALLBACKURL for this Google sign-in.";
    h.emit({ ok: false, reason: "error", message: reason });
    await until(() => expect(h.calls.info).toContain(reason));
    expect(h.calls.info).not.toContain(callbackOutcomeMessage("error"));
    expect(h.calls.signedIn).toHaveLength(0);
    expect(h.getStatus).not.toHaveBeenCalled();
  });

  it("an ok:false outcome WITHOUT a message falls back to the reason message", async () => {
    const h = harness();
    await until(() => expect(h.calls.open).toHaveLength(1));
    h.emit({ ok: false, reason: "error" });
    await until(() => expect(h.calls.info).toContain(callbackOutcomeMessage("error")));
    expect(h.calls.signedIn).toHaveLength(0);
  });
});

describe("Phase 46 - Google sign-in: cancel / unmount cleanup", () => {
  it("cancel releases the listener and no later outcome fires a callback", async () => {
    const h = harness();
    await until(() => expect(h.calls.open).toHaveLength(1));
    expect(h.hasListener()).toBe(true);

    h.handle.cancel();
    expect(h.hasListener()).toBe(false);
    expect(h.bridge.stopOAuthCallback).toHaveBeenCalledTimes(1);

    h.emit({ ok: true });
    h.emit({ ok: false, reason: "timeout" });
    // Give any (wrong) async continuation a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.calls.signedIn).toHaveLength(0);
    expect(h.calls.failure).toHaveLength(0);
    expect(h.getStatus).not.toHaveBeenCalled();
  });

  it("a browser closed early still ends in a clear message (the timeout path), not silence", async () => {
    const h = harness();
    await until(() => expect(h.calls.open).toHaveLength(1));
    // The user closes the browser tab before landing on the loopback callback;
    // main has not seen a redirect, so the listener expires and reports a
    // timeout.
    h.emit({ ok: false, reason: "timeout" });
    await until(() => expect(h.calls.info).toContain(callbackOutcomeMessage("timeout")));
    expect(h.calls.signedIn).toHaveLength(0);
    expect(h.getStatus).not.toHaveBeenCalled();
    expect(h.bridge.stopOAuthCallback).toHaveBeenCalledTimes(1);
  });

  it("cancel is idempotent", async () => {
    const h = harness();
    await until(() => expect(h.calls.open).toHaveLength(1));
    h.handle.cancel();
    h.handle.cancel();
    expect(h.bridge.stopOAuthCallback).toHaveBeenCalledTimes(1);
  });
});

describe("Phase 46 - the reset redirect is absolute and trusted", () => {
  it("prefers the renderer's own absolute origin and binds no listener", async () => {
    const bridge = {
      startOAuthCallback: vi.fn(async () => ({ callbackUrl: CALLBACK })),
      stopOAuthCallback: vi.fn(async () => undefined),
    };
    await expect(resetRedirectUrl(bridge, "http://localhost:5173")).resolves.toBe("http://localhost:5173/");
    await expect(resetRedirectUrl(bridge, "https://app.example.invalid")).resolves.toBe("https://app.example.invalid/");
    expect(bridge.startOAuthCallback).not.toHaveBeenCalled();
  });

  it("falls back to the minted loopback URL when the origin is a file:// 'null'", async () => {
    const bridge = {
      startOAuthCallback: vi.fn(async () => ({ callbackUrl: CALLBACK })),
      stopOAuthCallback: vi.fn(async () => undefined),
    };
    await expect(resetRedirectUrl(bridge, "null")).resolves.toBe(CALLBACK);
    expect(bridge.startOAuthCallback).toHaveBeenCalledTimes(1);
    expect(bridge.stopOAuthCallback).toHaveBeenCalledTimes(1);
  });

  it("falls back to the minted URL when there is no origin at all", async () => {
    const bridge = {
      startOAuthCallback: vi.fn(async () => ({ callbackUrl: CALLBACK })),
      stopOAuthCallback: vi.fn(async () => undefined),
    };
    await expect(resetRedirectUrl(bridge, null)).resolves.toBe(CALLBACK);
    await expect(resetRedirectUrl(bridge, "")).resolves.toBe(CALLBACK);
  });

  it("returns null (no redirectTo) when neither the origin nor the bridge can supply one", async () => {
    await expect(resetRedirectUrl({}, "null")).resolves.toBeNull();
    await expect(resetRedirectUrl({}, null)).resolves.toBeNull();
  });

  it("recognises only real web origins as usable", () => {
    expect(isUsableAppOrigin("http://localhost:5173")).toBe(true);
    expect(isUsableAppOrigin("https://app.example.invalid")).toBe(true);
    expect(isUsableAppOrigin("null")).toBe(false);
    expect(isUsableAppOrigin("file:///C:/app/index.html")).toBe(false);
    expect(isUsableAppOrigin("")).toBe(false);
    expect(isUsableAppOrigin(null)).toBe(false);
    expect(isUsableAppOrigin(undefined)).toBe(false);
  });
});

describe("Phase 46 - the reset redirect is minted the same way", () => {
  it("returns the loopback URL and releases the listener immediately", async () => {
    const bridge = {
      startOAuthCallback: vi.fn(async () => ({ callbackUrl: CALLBACK })),
      stopOAuthCallback: vi.fn(async () => undefined),
    };
    await expect(absoluteRedirectUrl(bridge)).resolves.toBe(CALLBACK);
    expect(bridge.stopOAuthCallback).toHaveBeenCalledTimes(1);
  });

  it("returns null when the bridge predates the loopback flow", async () => {
    await expect(absoluteRedirectUrl({})).resolves.toBeNull();
  });

  it("returns null when the listener cannot bind, so the caller falls back", async () => {
    const bridge = {
      startOAuthCallback: vi.fn(async () => {
        throw new Error("EADDRINUSE");
      }),
      stopOAuthCallback: vi.fn(async () => undefined),
    };
    await expect(absoluteRedirectUrl(bridge)).resolves.toBeNull();
  });
});
