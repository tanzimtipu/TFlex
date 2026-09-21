// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { normalizeUpdateState } from "../../../src/renderer/components/updateStateNormalize";
import { UpdateIndicator } from "../../../src/renderer/components/UpdateIndicator";
import { UpdatePromptDialog } from "../../../src/renderer/components/UpdatePromptDialog";
import type { UpdateState } from "../../../src/shared/types";

/**
 * DEF-275 — renderer-side hardening of the update IPC payload.
 *
 * A malformed `update:statusChanged` payload (non-primitive `version`,
 * non-array `notes`, non-string note entries) used to throw during
 * render in the always-mounted update surfaces, and React unmounted
 * the whole root: blank window, no recovery without a relaunch.
 *
 * These tests pin the single normaliser the App boundary applies:
 *   1. Every version-carrying variant passes a string version through
 *      unchanged, and coerces a non-string one to a string.
 *   2. `notes` is `string[] | undefined` — a non-array becomes
 *      `undefined`, non-string entries are dropped.
 *   3. `checking` / `error` / `unsupported` pass through untouched.
 *   4. Unknown / non-object payloads normalise to `null`.
 *   5. The two update surfaces render without throwing when their
 *      state has been through the normaliser (the DEF-275 shape).
 */

describe("normalizeUpdateState — string versions pass through unchanged", () => {
  it("keeps a string version on 'up-to-date'", () => {
    expect(normalizeUpdateState({ kind: "up-to-date", version: "1.2.3" }))
      .toEqual({ kind: "up-to-date", version: "1.2.3" });
  });

  it("keeps version, releaseDate and notes on 'available'", () => {
    expect(
      normalizeUpdateState({
        kind: "available",
        version: "2.0.0",
        releaseDate: "2026-09-01",
        notes: ["one", "two"],
      }),
    ).toEqual({
      kind: "available",
      version: "2.0.0",
      releaseDate: "2026-09-01",
      notes: ["one", "two"],
    });
  });

  it("keeps version and notes on 'downloaded'", () => {
    expect(
      normalizeUpdateState({ kind: "downloaded", version: "3.1.0", notes: ["fix"] }),
    ).toEqual({ kind: "downloaded", version: "3.1.0", notes: ["fix"] });
  });
});

describe("normalizeUpdateState — non-string versions are coerced to strings", () => {
  it("coerces an object version on 'available' (the DEF-275 lethal shape)", () => {
    const next = normalizeUpdateState({ kind: "available", version: { a: 1 } });
    expect(next).toEqual({ kind: "available", version: "[object Object]" });
  });

  it("coerces a number version on 'downloaded'", () => {
    expect(normalizeUpdateState({ kind: "downloaded", version: 123 }))
      .toEqual({ kind: "downloaded", version: "123" });
  });

  it("coerces null / undefined versions on 'up-to-date'", () => {
    expect(normalizeUpdateState({ kind: "up-to-date", version: null }))
      .toEqual({ kind: "up-to-date", version: "null" });
    expect(normalizeUpdateState({ kind: "up-to-date" }))
      .toEqual({ kind: "up-to-date", version: "undefined" });
  });
});

describe("normalizeUpdateState — notes becomes string[] | undefined", () => {
  it("turns a non-array notes into undefined", () => {
    expect(normalizeUpdateState({ kind: "available", version: "1", notes: "just a string" }))
      .toEqual({ kind: "available", version: "1" });
    expect(normalizeUpdateState({ kind: "available", version: "1", notes: { note: "x" } }))
      .toEqual({ kind: "available", version: "1" });
    expect(normalizeUpdateState({ kind: "downloaded", version: "1", notes: 42 }))
      .toEqual({ kind: "downloaded", version: "1" });
  });

  it("keeps only the string entries of a mixed notes array", () => {
    expect(
      normalizeUpdateState({
        kind: "available",
        version: "1",
        notes: [null, 123, { a: 1 }, "kept string"],
      }),
    ).toEqual({ kind: "available", version: "1", notes: ["kept string"] });
  });

  it("keeps an empty notes array as an empty list", () => {
    expect(normalizeUpdateState({ kind: "available", version: "1", notes: [] }))
      .toEqual({ kind: "available", version: "1", notes: [] });
  });
});

describe("normalizeUpdateState — kinds without a version pass through untouched", () => {
  it("passes 'checking' through", () => {
    expect(normalizeUpdateState({ kind: "checking" })).toEqual({ kind: "checking" });
  });

  it("passes 'error' through by reference", () => {
    const state = { kind: "error", message: "boom" } as unknown as UpdateState;
    expect(normalizeUpdateState(state)).toBe(state);
  });

  it("passes 'unsupported' through by reference", () => {
    const state = { kind: "unsupported", reason: "portable" } as unknown as UpdateState;
    expect(normalizeUpdateState(state)).toBe(state);
  });

  it("passes 'downloading' through by reference", () => {
    const state = { kind: "downloading", progress: 42 } as unknown as UpdateState;
    expect(normalizeUpdateState(state)).toBe(state);
  });
});

describe("normalizeUpdateState — error/unsupported/downloading values are coerced", () => {
  it("coerces an object message on 'error' to a string", () => {
    const next = normalizeUpdateState({ kind: "error", message: { a: 1 } });
    expect(next).toEqual({ kind: "error", message: "[object Object]" });
    expect(typeof (next as Extract<UpdateState, { kind: "error" }>).message).toBe("string");
  });

  it("coerces a null message on 'error' to a string", () => {
    const next = normalizeUpdateState({ kind: "error", message: null });
    expect(next).toEqual({ kind: "error", message: "null" });
    expect(typeof (next as Extract<UpdateState, { kind: "error" }>).message).toBe("string");
  });

  it("coerces an object reason on 'unsupported' to a string", () => {
    const next = normalizeUpdateState({ kind: "unsupported", reason: { a: 1 } });
    expect(next).toEqual({ kind: "unsupported", reason: "[object Object]" });
    expect(typeof (next as Extract<UpdateState, { kind: "unsupported" }>).reason).toBe("string");
  });

  it("coerces a non-finite / out-of-range 'downloading' progress to a finite in-range number", () => {
    const progressOf = (progress: unknown): number =>
      (normalizeUpdateState({ kind: "downloading", progress }) as Extract<
        UpdateState,
        { kind: "downloading" }
      >).progress;

    expect(progressOf(NaN)).toBe(0);
    expect(progressOf(Infinity)).toBe(0);
    expect(progressOf(-Infinity)).toBe(0);
    expect(progressOf(-5)).toBe(0);
    expect(progressOf(1000)).toBe(100);
    for (const bad of [NaN, Infinity, -Infinity, -5, 1000]) {
      const next = progressOf(bad);
      expect(Number.isFinite(next)).toBe(true);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThanOrEqual(100);
    }
  });

  it("keeps valid values unchanged (in range, by reference)", () => {
    const state = { kind: "downloading", progress: 42 } as unknown as UpdateState;
    expect(normalizeUpdateState(state)).toBe(state);
    expect(normalizeUpdateState({ kind: "downloading", progress: 0 }))
      .toEqual({ kind: "downloading", progress: 0 });
    expect(normalizeUpdateState({ kind: "downloading", progress: 100 }))
      .toEqual({ kind: "downloading", progress: 100 });
    expect(normalizeUpdateState({ kind: "error", message: "boom" }))
      .toEqual({ kind: "error", message: "boom" });
    expect(normalizeUpdateState({ kind: "unsupported", reason: "portable" }))
      .toEqual({ kind: "unsupported", reason: "portable" });
  });
});

describe("normalizeUpdateState — unusable payloads become null", () => {
  it("returns null for null / undefined / non-objects", () => {
    expect(normalizeUpdateState(null)).toBeNull();
    expect(normalizeUpdateState(undefined)).toBeNull();
    expect(normalizeUpdateState("nope")).toBeNull();
    expect(normalizeUpdateState(42)).toBeNull();
  });

  it("returns null for an object without a known kind", () => {
    expect(normalizeUpdateState({})).toBeNull();
    expect(normalizeUpdateState({ kind: "something-else" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Render proof: the two always-mounted update surfaces survive a
// non-primitive version once it has gone through the normaliser.
// ---------------------------------------------------------------------------

function normalizedAvailableShape(): UpdateState | null {
  return normalizeUpdateState({
    kind: "available",
    version: { a: 1 },
    notes: [null, 123, { a: 1 }, "kept string"],
  });
}

describe("update surfaces render a normalised malformed payload (DEF-275)", () => {
  it("UpdatePromptDialog shows the coerced version text and throws nothing", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act((): void => {
      root.render(
        <UpdatePromptDialog
          open={true}
          state={normalizedAvailableShape()}
          onUpdate={(): void => undefined}
          onInstall={(): void => undefined}
          onClose={(): void => undefined}
        />,
      );
    });
    expect(container.querySelector('[data-update-prompt-kind="available"]')).not.toBeNull();
    expect(container.textContent).toContain("Update to v[object Object] is available.");
    act((): void => {
      root.unmount();
    });
    container.remove();
  });

  it("UpdateIndicator shows the coerced version chip and throws nothing", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act((): void => {
      root.render(
        <UpdateIndicator enabled={false} externalState={normalizedAvailableShape()} />,
      );
    });
    const chip = container.querySelector('[data-update-indicator-kind="available"]');
    expect(chip).not.toBeNull();
    expect(container.textContent).toContain("Update v[object Object]");
    act((): void => {
      root.unmount();
    });
    container.remove();
  });
});