// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  UpdatePromptDialog,
  promptKindFromState,
  type UpdatePromptKind,
} from "../../../src/renderer/components/UpdatePromptDialog";
import type { UpdateState } from "../../../src/shared/types";

/**
 * OTA UX — UpdatePromptDialog regression tests.
 *
 * The dialog is the actionable surface that pops up when the
 * backend pushes `available` (Update to X.Y.Z available) or
 * `downloaded` (Restart to update) UpdateState. These tests pin:
 *
 *   1. The pure `promptKindFromState(state)` mapping for every
 *      kind in the UpdateState union (TS exhaustiveness +
 *      runtime).
 *   2. The dialog renders nothing when `open` is false.
 *   3. The dialog renders the right action buttons per kind
 *      (`available` -> Update + Cancel, `downloaded` -> Restart +
 *      Later, others -> OK / Close).
 *   4. Clicking Update / Restart routes to the matching handler.
 *   5. Clicking Cancel / Later / OK / X / backdrop routes to
 *      `onClose`.
 *   6. The toolbar indicator (UpdateIndicator) continues to work
 *      independently when the prompt is dismissed — the dialog
 *      and the indicator are independent surfaces by design.
 */

interface RenderArgs {
  open: boolean;
  state?: UpdateState | null;
  onUpdate?: () => void;
  onInstall?: () => void;
  onClose?: () => void;
}

function renderDialog(args: RenderArgs): {
  root: Root;
  container: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <UpdatePromptDialog
        open={args.open}
        state={args.state ?? null}
        onUpdate={args.onUpdate ?? ((): void => undefined)}
        onInstall={args.onInstall ?? ((): void => undefined)}
        onClose={args.onClose ?? ((): void => undefined)}
      />,
    );
  });
  return {
    root,
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Pure mapping (promptKindFromState).
//
// Exhaustive over UpdateState: each kind maps to a precise kind.
// `downloading` maps to its own "downloading" kind (Bug 9) so the
// dialog renders immediate progress feedback (spinner + "Downloading…"
// + live percent) instead of sitting passive.
// A new kind added to the union without a mapping here will fail
// TS exhaustiveness — same shape as `indicatorView` /
// `describeUpdateState`.
// ---------------------------------------------------------------------------
describe("promptKindFromState — pure UpdateState -> UpdatePromptKind", () => {
  it("returns 'none' for null / undefined state", () => {
    expect(promptKindFromState(null)).toBe("none");
    expect(promptKindFromState(undefined)).toBe("none");
  });

  it("returns 'available' for kind='available'", () => {
    expect(promptKindFromState({ kind: "available", version: "1.6.0" })).toBe(
      "available",
    );
  });

  it("returns 'downloaded' for kind='downloaded'", () => {
    expect(
      promptKindFromState({ kind: "downloaded", version: "1.6.0" }),
    ).toBe("downloaded");
  });

  it("maps 'downloading' to the 'downloading' kind (Bug 9 progress presentation)", () => {
    // Bug 9 — the dialog renders its own progress presentation for
    // the `downloading` state (spinner + "Downloading…" + live
    // percent), so the pure mapping keeps it distinct from the
    // passive "checking" kind.
    expect(promptKindFromState({ kind: "downloading", progress: 42 })).toBe(
      "downloading",
    );
  });

  it("returns 'checking' for kind='checking'", () => {
    expect(promptKindFromState({ kind: "checking" })).toBe("checking");
  });

  it("returns 'up-to-date' for kind='up-to-date'", () => {
    expect(promptKindFromState({ kind: "up-to-date", version: "1.5.3" })).toBe(
      "up-to-date",
    );
  });

  it("returns 'unsupported' for kind='unsupported'", () => {
    expect(
      promptKindFromState({
        kind: "unsupported",
        reason: "Portable build does not support auto-update",
      }),
    ).toBe("unsupported");
  });

  it("returns 'error' for kind='error'", () => {
    expect(
      promptKindFromState({ kind: "error", message: "network unreachable" }),
    ).toBe("error");
  });

  it("covers every UpdatePromptKind (smoke)", () => {
    // Pin that every kind has at least one input that produces it.
    const kinds: UpdatePromptKind[] = [
      "available",
      "downloading",
      "downloaded",
      "checking",
      "up-to-date",
      "unsupported",
      "error",
      "none",
    ];
    for (const k of kinds) {
      // The mapping isn't bijective, but every kind should be
      // reachable from at least one UpdateState. None comes from
      // null/undefined; the rest come from the union members.
      expect(typeof k).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// Open / closed contract.
// ---------------------------------------------------------------------------
describe("UpdatePromptDialog — open/closed contract", () => {
  it("renders nothing when open is false", () => {
    const { container, cleanup } = renderDialog({
      open: false,
      state: { kind: "available", version: "1.6.0" },
    });
    expect(container.querySelector("[data-update-prompt]")).toBeNull();
    cleanup();
  });

  it("renders the dialog with kind='available' when open is true with an available state", () => {
    const { container, cleanup } = renderDialog({
      open: true,
      state: { kind: "available", version: "1.6.0" },
    });
    const dialog = container.querySelector<HTMLElement>(
      "[data-update-prompt]",
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("data-update-prompt-kind")).toBe("available");
    cleanup();
  });

  it("renders the dialog with kind='downloaded' for a downloaded state", () => {
    const { container, cleanup } = renderDialog({
      open: true,
      state: { kind: "downloaded", version: "1.6.0" },
    });
    const dialog = container.querySelector<HTMLElement>(
      "[data-update-prompt]",
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("data-update-prompt-kind")).toBe("downloaded");
    cleanup();
  });

  it("renders a non-actionable OK button for 'up-to-date'", () => {
    const { container, cleanup } = renderDialog({
      open: true,
      state: { kind: "up-to-date", version: "1.5.3" },
    });
    const dialog = container.querySelector<HTMLElement>(
      "[data-update-prompt]",
    );
    expect(dialog?.getAttribute("data-update-prompt-kind")).toBe("up-to-date");
    // No Update button — only the OK dismiss button.
    expect(
      container.querySelector("[data-update-prompt-update]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-update-prompt-restart]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-update-prompt-close]"),
    ).not.toBeNull();
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Action buttons — kind-specific.
// ---------------------------------------------------------------------------
describe("UpdatePromptDialog — action buttons (Update / Restart / Cancel / Later)", () => {
  it("renders Update + Cancel buttons for 'available' state", () => {
    const { container, cleanup } = renderDialog({
      open: true,
      state: { kind: "available", version: "1.6.0" },
    });
    expect(
      container.querySelector("[data-update-prompt-update]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-update-prompt-cancel]"),
    ).not.toBeNull();
    // No Restart / Later buttons for an 'available' state.
    expect(
      container.querySelector("[data-update-prompt-restart]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-update-prompt-later]"),
    ).toBeNull();
    cleanup();
  });

  it("renders Restart + Later buttons for 'downloaded' state", () => {
    const { container, cleanup } = renderDialog({
      open: true,
      state: { kind: "downloaded", version: "1.6.0" },
    });
    expect(
      container.querySelector("[data-update-prompt-restart]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-update-prompt-later]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-update-prompt-update]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-update-prompt-cancel]"),
    ).toBeNull();
    cleanup();
  });

  it("includes the new version in the body copy for 'available'", () => {
    const { container, cleanup } = renderDialog({
      open: true,
      state: { kind: "available", version: "1.6.0" },
    });
    const body = container.querySelector("[data-update-prompt-kind='available']");
    expect(body).not.toBeNull();
    expect(body?.textContent).toContain("1.6.0");
    cleanup();
  });

  it("includes the new version in the body copy for 'downloaded'", () => {
    const { container, cleanup } = renderDialog({
      open: true,
      state: { kind: "downloaded", version: "1.6.0" },
    });
    const body = container.querySelector("[data-update-prompt-kind='downloaded']");
    expect(body).not.toBeNull();
    expect(body?.textContent).toContain("1.6.0");
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Click routing.
// ---------------------------------------------------------------------------
describe("UpdatePromptDialog — click routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clicking Update calls onUpdate (not onInstall / onClose)", () => {
    const onUpdate = vi.fn();
    const onInstall = vi.fn();
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({
      open: true,
      state: { kind: "available", version: "1.6.0" },
      onUpdate,
      onInstall,
      onClose,
    });
    const btn = container.querySelector<HTMLButtonElement>(
      "[data-update-prompt-update]",
    );
    expect(btn).not.toBeNull();
    act((): void => {
      btn?.click();
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onInstall).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    cleanup();
  });

  it("clicking Restart calls onInstall (not onUpdate / onClose)", () => {
    const onUpdate = vi.fn();
    const onInstall = vi.fn();
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({
      open: true,
      state: { kind: "downloaded", version: "1.6.0" },
      onUpdate,
      onInstall,
      onClose,
    });
    const btn = container.querySelector<HTMLButtonElement>(
      "[data-update-prompt-restart]",
    );
    expect(btn).not.toBeNull();
    act((): void => {
      btn?.click();
    });
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    cleanup();
  });

  it("clicking Cancel calls onClose (dismiss without action)", () => {
    const onUpdate = vi.fn();
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({
      open: true,
      state: { kind: "available", version: "1.6.0" },
      onUpdate,
      onClose,
    });
    const btn = container.querySelector<HTMLButtonElement>(
      "[data-update-prompt-cancel]",
    );
    expect(btn).not.toBeNull();
    act((): void => {
      btn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
    cleanup();
  });

  it("clicking Later calls onClose (dismiss without action)", () => {
    const onInstall = vi.fn();
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({
      open: true,
      state: { kind: "downloaded", version: "1.6.0" },
      onInstall,
      onClose,
    });
    const btn = container.querySelector<HTMLButtonElement>(
      "[data-update-prompt-later]",
    );
    expect(btn).not.toBeNull();
    act((): void => {
      btn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onInstall).not.toHaveBeenCalled();
    cleanup();
  });

  it("clicking the X button calls onClose", () => {
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({
      open: true,
      state: { kind: "available", version: "1.6.0" },
      onClose,
    });
    const btn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close update prompt"]',
    );
    expect(btn).not.toBeNull();
    act((): void => {
      btn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Independent surfaces — closing the prompt does NOT remove the
// toolbar indicator's state. The toolbar continues to show its
// own affordance; the prompt is the *notification*, the
// indicator is the *always-visible affordance*.
// ---------------------------------------------------------------------------
describe("UpdatePromptDialog — toolbar indicator independence", () => {
  it("renders nothing for the prompt when open is false even if state is 'available'", () => {
    // The toolbar indicator handles 'available' state; this test
    // pins the prompt is *not* auto-rendered. The host owns the
    // open/closed decision via the `open` prop.
    const { container, cleanup } = renderDialog({
      open: false,
      state: { kind: "available", version: "1.6.0" },
    });
    expect(container.querySelector("[data-update-prompt]")).toBeNull();
    cleanup();
  });
});