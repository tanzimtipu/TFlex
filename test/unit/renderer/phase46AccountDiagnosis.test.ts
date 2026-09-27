// @vitest-environment node
//
// Phase 46 - the account surface must report the provider's REAL reason.
//
// These are the exact response shapes the orchestrator captured live against
// the production branch (HTTP probes), so each mapping is pinned to a real
// payload, not a guess:
//   - 400 VALIDATION_ERROR  message "[body.name] Invalid input: expected
//     string, received undefined; ..."
//   - 403 EMAIL_NOT_VERIFIED message "Email not verified"
//   - 401 INVALID_EMAIL_OR_PASSWORD message "Invalid email or password"
//   - 404 PROVIDER_NOT_FOUND message "Provider not found" (the Google path)
//   - 400 PASSWORD_TOO_SHORT message "Password too short"
//   - 422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL
//     "User already exists. Use another email."

import { describe, expect, it } from "vitest";
import { describeAuthError, mapAuthError } from "../../../src/renderer/accounts/adapter";
import { messageForError } from "../../../src/renderer/accounts/machine";
import {
  credentialsFieldError,
  isValidEmail,
  MIN_PASSWORD_LENGTH,
} from "../../../src/renderer/accounts/validation";

const VALIDATION = {
  status: 400,
  code: "VALIDATION_ERROR",
  message: "[body.name] Invalid input: expected string, received undefined; [body.password] Invalid input: expected string, received undefined",
};

describe("Phase 46 - provider errors keep their real reason", () => {
  it("a VALIDATION_ERROR is a server failure that carries the field message", () => {
    const mapped = describeAuthError(VALIDATION, true);
    expect(mapped.code).toBe("server");
    expect(mapped.providerCode).toBe("VALIDATION_ERROR");
    expect(mapped.detail).toContain("[body.name] Invalid input: expected string, received undefined");
    const text = messageForError(mapped.code, mapped);
    expect(text).toContain("Name: Invalid input: expected string, received undefined");
    expect(text).not.toContain("Something went wrong");
  });

  it("EMAIL_NOT_VERIFIED maps to the verify message, never the generic one", () => {
    const mapped = describeAuthError(
      { status: 403, code: "EMAIL_NOT_VERIFIED", message: "Email not verified" },
      true,
    );
    expect(mapped.code).toBe("email-not-verified");
    expect(messageForError(mapped.code, mapped)).toBe(
      "This email still needs verifying. Enter the code we emailed you.",
    );
  });

  it("INVALID_EMAIL_OR_PASSWORD keeps the established credential copy", () => {
    const mapped = describeAuthError(
      { status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
      true,
    );
    expect(mapped.code).toBe("invalid-credentials");
    expect(messageForError(mapped.code, mapped)).toBe(
      "That email or password is not correct. Check it and try again.",
    );
  });

  it("PROVIDER_NOT_FOUND (a disabled provider) names the real problem", () => {
    const mapped = describeAuthError(
      { status: 404, code: "PROVIDER_NOT_FOUND", message: "Provider not found" },
      true,
    );
    expect(mapped.code).toBe("server");
    expect(mapped.providerCode).toBe("PROVIDER_NOT_FOUND");
    expect(messageForError(mapped.code, mapped)).toBe(
      "Google sign-in is not enabled for this app yet. Use email and password instead.",
    );
  });

  it("BAD_OAUTH_CALLBACK (the live Google failure) surfaces the provider's text", () => {
    // Captured live: POST {base}/sign-in/social from the file:// renderer.
    const mapped = describeAuthError(
      {
        status: 400,
        code: "BAD_OAUTH_CALLBACK",
        message: "Origin header is required when callbackURL is not an absolute URL",
      },
      true,
    );
    expect(mapped.code).toBe("server");
    expect(mapped.providerCode).toBe("BAD_OAUTH_CALLBACK");
    const text = messageForError(mapped.code, mapped);
    expect(text).toContain("Origin header is required when callbackURL is not an absolute URL");
    expect(text).toContain("BAD_OAUTH_CALLBACK");
    expect(text).not.toContain("Something went wrong");
  });

  it("VALIDATION_FAILED (the live reset failure) is surfaced verbatim too", () => {
    const mapped = describeAuthError(
      {
        status: 400,
        code: "VALIDATION_FAILED",
        message: "Origin header is required when redirectTo is not an absolute URL",
      },
      true,
    );
    const text = messageForError(mapped.code, mapped);
    expect(text).toContain("Origin header is required when redirectTo is not an absolute URL");
    expect(text).toContain("VALIDATION_FAILED");
  });

  it("PASSWORD_TOO_SHORT states the provider's 8-character floor", () => {
    const mapped = describeAuthError(
      { status: 400, code: "PASSWORD_TOO_SHORT", message: "Password too short" },
      true,
    );
    expect(messageForError(mapped.code, mapped)).toBe(
      "That password is too short. Use at least 8 characters.",
    );
  });

  it("a duplicate email that could not be hidden says so honestly", () => {
    const mapped = describeAuthError(
      { status: 422, code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", message: "User already exists. Use another email." },
      true,
    );
    expect(mapped.code).toBe("server");
    expect(messageForError(mapped.code, mapped)).toContain("already has an account");
    expect(messageForError(mapped.code, mapped)).toContain("Sign in with it instead");
  });

  it("any other provider message/code is surfaced verbatim, not swallowed", () => {
    const mapped = describeAuthError(
      { status: 500, code: "SOMETHING_NEW", message: "Rate limit exceeded" },
      true,
    );
    const text = messageForError(mapped.code, mapped);
    expect(text).toContain("Rate limit exceeded");
    expect(text).toContain("SOMETHING_NEW");
  });

  it("a transport failure carries no provider detail (generic, honest copy)", () => {
    const mapped = describeAuthError(new TypeError("Failed to fetch"), true);
    expect(mapped).toEqual({ code: "server" });
    expect(messageForError(mapped.code, mapped)).toBe("Something went wrong. Try again in a moment.");
    // Offline is still only claimed with genuinely no link.
    expect(describeAuthError(new TypeError("Failed to fetch"), false).code).toBe("network-offline");
  });

  it("mapAuthError keeps its coarse-code contract for the existing tests", () => {
    expect(mapAuthError({ code: "OTP_EXPIRED" }, true)).toBe("code-expired");
    expect(mapAuthError({ status: 401 }, true)).toBe("invalid-credentials");
    expect(mapAuthError({ status: 0 }, true)).toBe("server");
    expect(mapAuthError({ code: "NETWORK_ERROR" }, false)).toBe("network-offline");
  });
});

describe("Phase 46 - a 403 that is not a credential failure", () => {
  // Captured live from the built app (packaged-style file:// renderer) with a
  // Playwright network hook: the provider answers the loopback callback URL
  // with `403 {"error":"Invalid callbackURL","code":"INVALID_CALLBACKURL"}`,
  // and the Neon SDK normalizes that to `code=feature_not_supported`,
  // `message="HTTP 403"` before the renderer sees it. Reporting it as "that
  // email or password is not correct" would be a lie.
  it("the normalized social 403 is surfaced, never as a wrong password", () => {
    const mapped = describeAuthError(
      { status: 403, code: "feature_not_supported", message: "HTTP 403" },
      true,
    );
    expect(mapped.code).toBe("invalid-credentials");
    const text = messageForError(mapped.code, mapped);
    expect(text).toContain("HTTP 403");
    expect(text).toContain("FEATURE_NOT_SUPPORTED");
    expect(text).not.toContain("not correct");
  });

  it("the normalized reset 403 keeps the provider's own message", () => {
    // Wire body: `403 {"message":"Invalid redirectURL","code":"INVALID_REDIRECT_URL"}`.
    const mapped = describeAuthError(
      { status: 403, code: "feature_not_supported", message: "Invalid redirectURL" },
      true,
    );
    const text = messageForError(mapped.code, mapped);
    expect(text).toContain("Invalid redirectURL");
    expect(text).not.toContain("not correct");
  });

  it("a genuine 401 credential payload still keeps the established copy", () => {
    const mapped = describeAuthError(
      { status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
      true,
    );
    expect(messageForError(mapped.code, mapped)).toBe(
      "That email or password is not correct. Check it and try again.",
    );
    // A bare 401 with no provider code keeps it too.
    expect(messageForError("invalid-credentials")).toBe(
      "That email or password is not correct. Check it and try again.",
    );
  });
});

describe("Phase 46 - pre-send field validation", () => {
  it("the provider's password floor is 8 characters", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it("email shape", () => {
    expect(isValidEmail("ada@example.com")).toBe(true);
    expect(isValidEmail("  ada@example.com  ")).toBe(true);
    expect(isValidEmail("ada@example")).toBe(false);
    expect(isValidEmail("ada example.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });

  it("sign-up requires email, a display name, and 8+ characters - in that order", () => {
    expect(credentialsFieldError("sign-up", { email: "", password: "pw-123456", name: "Ada" }))
      .toBe("Enter your email address.");
    expect(credentialsFieldError("sign-up", { email: "nope", password: "pw-123456", name: "Ada" }))
      .toBe("Enter a valid email address.");
    expect(credentialsFieldError("sign-up", { email: "ada@example.com", password: "pw-123456", name: "  " }))
      .toBe("Enter a display name for your account.");
    expect(credentialsFieldError("sign-up", { email: "ada@example.com", password: "short", name: "Ada" }))
      .toBe("Choose a password of at least 8 characters.");
    expect(credentialsFieldError("sign-up", { email: "ada@example.com", password: "pw-123456", name: "Ada" }))
      .toBeNull();
  });

  it("sign-in only needs both fields present (no 8-char gate on an existing password)", () => {
    expect(credentialsFieldError("sign-in", { email: "ada@example.com", password: "", name: "" }))
      .toBe("Enter your password.");
    expect(credentialsFieldError("sign-in", { email: "ada@example.com", password: "old", name: "" }))
      .toBeNull();
  });
});
