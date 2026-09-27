// @vitest-environment node
//
// Phase 45 (item A) - the CSP root cause and the honest error mapping.
//
// Part 1 proves the renderer is no longer forbidden from reaching the app's
// own backend, and that the relaxation is NARROW: connect-src gains exactly
// the one provider domain (https://*.neon.tech) and nothing broader such as a
// bare `https:` scheme source. It also pins the layout fix as a source fact
// (the account sheet is sized to its content, not a narrow form adrift in a
// wide sheet). Finally it covers the mapper that decides between
// "network-offline" and "server" - the mislabelling the operator reported.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mapAuthError } from "../../../src/renderer/accounts/adapter";
import { messageForError } from "../../../src/renderer/accounts/machine";

const HTML = readFileSync(resolve(process.cwd(), "src/renderer/index.html"), "utf8");
const STYLES = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");

function directives(): Record<string, string[]> {
  const content =
    HTML.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? "";
  const out: Record<string, string[]> = {};
  for (const raw of content.split(";")) {
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 0) out[parts[0]] = parts.slice(1);
  }
  return out;
}

describe("Phase 45 - the CSP permits the provider, narrowly", () => {
  it("connect-src gains exactly https://*.neon.tech and nothing broader", () => {
    const d = directives();
    expect(d["connect-src"]).toBeDefined();
    // The WHOLE allow-list is pinned: adding `https:` (or any other host)
    // would fail this equality rather than slip through a substring check.
    expect(new Set(d["connect-src"])).toEqual(
      new Set(["'self'", "blob:", "data:", "https://*.neon.tech"]),
    );
  });

  it("the reason is commented in place", () => {
    expect(HTML).toContain("Phase 45");
    expect(HTML).toContain("connect-src must permit");
    expect(HTML).toContain("https://*.neon.tech");
  });

  it("does not touch the other directives (img-src stays the Google avatar host only)", () => {
    const d = directives();
    expect(new Set(d["img-src"])).toEqual(
      new Set(["'self'", "data:", "blob:", "https://lh3.googleusercontent.com"]),
    );
    expect(d["script-src"]).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(d["default-src"]).toEqual(["'self'"]);
  });
});

describe("Phase 45 - the account sheet is sized to its content", () => {
  it("the sheet shrinks to 440px instead of a wide box around a narrow form", () => {
    expect(STYLES).toContain(".sheet-accounts {");
    expect(STYLES).toContain("width: min(440px, calc(100vw - 64px));");
  });

  it("the body fills that box (no residual min/max width cap)", () => {
    const body = STYLES.match(/\.sheet-body-accounts\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(body).toContain("width: 100%;");
    expect(body).toContain("max-width: none;");
    expect(body).not.toContain("max-width: 420px");
    expect(body).not.toContain("min-width: 340px");
  });
});

describe("Phase 45 - a blocked request is not mislabelled offline", () => {
  it("a fetch failure WITH connectivity maps to server, not offline", () => {
    // A CSP block surfaces as a TypeError("Failed to fetch") with no status.
    expect(mapAuthError(new TypeError("Failed to fetch"), true)).toBe("server");
    expect(mapAuthError({ status: 0, message: "Failed to fetch" }, true)).toBe("server");
  });

  it("only genuine no-connectivity maps to network-offline", () => {
    expect(mapAuthError(new TypeError("Failed to fetch"), false)).toBe("network-offline");
    expect(mapAuthError({ code: "NETWORK_ERROR" }, false)).toBe("network-offline");
  });

  it("credential failures are unaffected by connectivity", () => {
    expect(mapAuthError({ status: 401 }, true)).toBe("invalid-credentials");
    expect(mapAuthError({ code: "INVALID_EMAIL_OR_PASSWORD" }, true)).toBe("invalid-credentials");
    expect(mapAuthError({ code: "OTP_EXPIRED" }, true)).toBe("code-expired");
    expect(mapAuthError({ code: "EMAIL_NOT_VERIFIED" }, true)).toBe("email-not-verified");
  });

  it("BEFORE/AFTER: the operator's offline text vs the credential text", () => {
    // BEFORE - a CSP-blocked fetch failed with no status and the old mapper
    // sent every transport failure to network-offline. This is the exact text
    // the operator saw; it is pinned so the regression cannot return.
    expect(messageForError("network-offline")).toBe(
      "You appear to be offline. Check your connection and try again.",
    );
    // AFTER - the request now reaches the provider; a bogus email/password
    // comes back as 401 and maps to the credential error.
    const badCredentials = { status: 401, message: "Invalid email or password" };
    expect(mapAuthError(badCredentials, true)).toBe("invalid-credentials");
    expect(messageForError("invalid-credentials")).toBe(
      "That email or password is not correct. Check it and try again.",
    );
    // And a transport failure that is NOT a real offline state says so.
    expect(mapAuthError(new TypeError("Failed to fetch"), true)).toBe("server");
  });
});
