// @vitest-environment node
//
// Phase 44 — the accounts state machine, error copy and sync-status mapping.
// Pure: no DOM, no SDK. Covers every branch the UI relies on.

import { describe, expect, it } from "vitest";
import {
  accountsReducer,
  initialAccountsState,
  messageForError,
  switchedMode,
  type AccountsMachineState,
} from "../../../src/renderer/accounts/machine";
import { describeSyncReport } from "../../../src/renderer/accounts/syncStatus";
import type { AccountsErrorCode, SyncPhase } from "../../../src/shared/accounts";

const ALL_CODES: readonly AccountsErrorCode[] = [
  "invalid-credentials",
  "email-not-verified",
  "code-invalid",
  "code-expired",
  "network-offline",
  "server",
];

function seeded(over: Partial<AccountsMachineState>): AccountsMachineState {
  return { ...initialAccountsState, ...over };
}

describe("Phase 44 — accounts reducer", () => {
  it("starts on the sign-in credentials step", () => {
    expect(initialAccountsState).toMatchObject({
      mode: "sign-in",
      step: "credentials",
      busy: false,
      banner: null,
      otpSent: false,
    });
  });

  it("switching to create-account keeps the email but clears the password", () => {
    const state = seeded({ email: "a@b.co", password: "secret" });
    const next = accountsReducer(state, { type: "set-mode", mode: "sign-up" });
    expect(next.mode).toBe("sign-up");
    expect(next.email).toBe("a@b.co");
    expect(next.password).toBe("");
    expect(next.banner).toBeNull();
  });

  it("editing a field clears any stale banner", () => {
    const state = seeded({ banner: { tone: "error", text: "old" } });
    const next = accountsReducer(state, { type: "set-field", field: "email", value: "x@y.z" });
    expect(next.email).toBe("x@y.z");
    expect(next.banner).toBeNull();
  });

  it("an OTP send lands on the code step with an info banner naming the email", () => {
    const next = accountsReducer(seeded({ email: "a@b.co" }), { type: "otp-sent" });
    expect(next.step).toBe("otp");
    expect(next.otpSent).toBe(true);
    expect(next.busy).toBe(false);
    expect(next.banner?.tone).toBe("info");
    expect(next.banner?.text).toContain("a@b.co");
  });

  it("back returns to credentials and clears the entered code", () => {
    const next = accountsReducer(seeded({ step: "otp", otp: "123456" }), { type: "back" });
    expect(next.step).toBe("credentials");
    expect(next.otp).toBe("");
  });

  it("a successful sign-in resets the flow", () => {
    const next = accountsReducer(seeded({ email: "a@b.co", busy: true }), { type: "signed-in" });
    expect(next).toEqual(initialAccountsState);
  });

  it("every error code produces a clear, non-empty, non-blocking message", () => {
    for (const code of ALL_CODES) {
      const next = accountsReducer(seeded({ busy: true }), { type: "error", code });
      expect(next.busy, code).toBe(false);
      expect(next.banner?.tone, code).toBe("error");
      expect(next.banner?.text, code).toBe(messageForError(code));
      expect((next.banner?.text ?? "").length, code).toBeGreaterThan(10);
    }
  });

  it("the messages distinguish wrong code from expired code from network error", () => {
    const wrong = messageForError("code-invalid");
    const expired = messageForError("code-expired");
    const offline = messageForError("network-offline");
    expect(new Set([wrong, expired, offline]).size).toBe(3);
    expect(expired.toLowerCase()).toContain("expired");
    expect(offline.toLowerCase()).toContain("offline");
  });

  it("switchedMode is a no-op when the mode is unchanged", () => {
    const state = seeded({ mode: "sign-in" });
    expect(switchedMode(state, "sign-in")).toBe(state);
  });
});

describe("Phase 44 — sync-status mapping", () => {
  const PHASES: readonly SyncPhase[] = ["idle", "syncing", "synced", "unavailable", "error", "offline"];

  it("null renders the neutral idle state", () => {
    expect(describeSyncReport(null).phase).toBe("idle");
  });

  it("each phase maps to a non-empty label with the right tone", () => {
    const tones: Record<SyncPhase, string> = {
      idle: "neutral",
      syncing: "neutral",
      synced: "positive",
      unavailable: "warning",
      error: "error",
      offline: "warning",
    };
    for (const phase of PHASES) {
      const view = describeSyncReport({ phase });
      expect(view.phase, phase).toBe(phase);
      expect(view.label.length, phase).toBeGreaterThan(2);
      expect(view.tone, phase).toBe(tones[phase]);
    }
  });

  it("unavailable and idle never carry an error (they are not failures)", () => {
    expect(describeSyncReport({ phase: "unavailable" }).tone).toBe("warning");
    expect(describeSyncReport({ phase: "idle" }).detail).toBeNull();
  });

  it("error surfaces the report's error message", () => {
    const view = describeSyncReport({
      phase: "error",
      error: { code: "server", message: "boom" },
    });
    expect(view.detail).toContain("boom");
  });

  it("synced reports the row counts", () => {
    const view = describeSyncReport({ phase: "synced", pushed: 2, pulled: 3, at: "2026-09-27T10:00:00Z" });
    expect(view.detail).toContain("3 pulled");
    expect(view.detail).toContain("2 pushed");
  });
});
