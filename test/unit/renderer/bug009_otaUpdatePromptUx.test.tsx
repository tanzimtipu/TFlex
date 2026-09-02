// @vitest-environment jsdom
// Bug 9 — OTA update prompt UX.
//
// The backend now pushes `downloading(0)` immediately on Download
// (no gap) and then continuous `downloading(N)` -> `downloaded(ver)`.
// This test pins the renderer side of the state machine:
//
//   available -> (click Update) -> downloading (dismiss to
//   background + toolbar indicator progress) -> downloaded ->
//   restart/cancel prompt.
//
// Concretely:
//   1. Clicking Update shows an IMMEDIATE progress state (spinner +
//      "Downloading…" with the live percent once events flow) — no
//      "no progress for seconds" blank.
//   2. Outside-click during a background download does NOT re-arm
//      the "Update" prompt (the popup stays dismissed; the pure
//      host decision `decideUpdatePromptOpen` guards this).
//   3. A completed download (`downloaded`) shows a fresh Restart /
//      Later prompt.
//
// The dialog-level tests exercise `UpdatePromptDialog` directly;
// the host's open/close decisions live in the pure
// `updatePromptMachine` module and are tested without mounting
// React (the App host delegates to it, so the state machine is
// pinned here even though App.tsx itself isn't a unit target).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  UpdatePromptDialog,
  dialogKind,
  promptKindFromState,
} from "../../../src/renderer/components/UpdatePromptDialog";
import {
  decideUpdatePromptOpen,
  updateActionableKey,
} from "../../../src/renderer/components/updatePromptMachine";
import type { UpdateState } from "../../../src/shared/types";

function makeAvailable(
  version: string,
): Extract<UpdateState, { kind: "available" }> {
  return { kind: "available", version };
}
function makeDownloading(progress: number): UpdateState {
  return { kind: "downloading", progress };
}
function makeDownloaded(
  version: string,
): Extract<UpdateState, { kind: "downloaded" }> {
  return { kind: "downloaded", version };
}

function noop(): void {
  return undefined;
}

function renderDialog(args: {
  open: boolean;
  state: UpdateState | null;
  onUpdate?: () => void;
  onInstall?: () => void;
  onClose?: () => void;
}): { container: HTMLElement; root: Root; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <UpdatePromptDialog
        open={args.open}
        state={args.state}
        onUpdate={args.onUpdate ?? noop}
        onInstall={args.onInstall ?? noop}
        onClose={args.onClose ?? noop}
      />,
    );
  });
  return {
    container,
    root,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Immediate progress on the Update click (no blank moment).
// ---------------------------------------------------------------------------
describe("Bug 9 — Update click shows immediate progress (no blank)", () => {
  it("promptKindFromState maps 'downloading' to the 'downloading' kind", () => {
    expect(promptKindFromState(makeDownloading(0))).toBe("downloading");
  });

  it("dialogKind pins the presentation to 'downloading' right after an Update click", () => {
    // Even while the live state is still 'available' (the backend
    // hasn't pushed a downloading event yet), a committed click shows
    // the downloading progress presentation — not a blank "available".
    expect(dialogKind(makeAvailable("1.9.0"), "1.9.0")).toBe("downloading");
    expect(dialogKind(makeDownloading(12), "1.9.0")).toBe("downloading");
    expect(dialogKind({ kind: "checking" }, "1.9.0")).toBe("downloading");
    // Terminal states supersede the post-click presentation.
    expect(dialogKind(makeDownloaded("1.9.0"), "1.9.0")).toBe("downloaded");
    // With no committed click, the live state maps directly.
    expect(dialogKind(makeAvailable("1.9.0"), null)).toBe("available");
  });

  it("clicking Update flips the rendered dialog to the downloading view immediately", () => {
    const onUpdate = vi.fn();
    const { container, cleanup } = renderDialog({
      open: true,
      state: makeAvailable("1.9.0"),
      onUpdate,
    });
    // Pre-click: the 'available' prompt with the Update button.
    expect(
      container.querySelector("[data-update-prompt-update]"),
    ).not.toBeNull();

    const updateBtn = container.querySelector<HTMLButtonElement>(
      "[data-update-prompt-update]",
    );
    expect(updateBtn).not.toBeNull();
    if (updateBtn !== null) {
      act((): void => {
        updateBtn.click();
      });
    }

    expect(onUpdate).toHaveBeenCalledTimes(1);
    // The still-open dialog (host hasn't dismissed yet) now shows the
    // downloading presentation — immediately, without waiting for the
    // backend's first progress event.
    expect(
      container.querySelector("[data-update-prompt-kind='downloading']"),
    ).not.toBeNull();
    expect(container.querySelector("[data-update-prompt-downloading]")).not.toBeNull();
    // The Update button is gone; a Cancel (dismiss to background) is
    // the only action, and the header stays anchored on the version.
    expect(container.querySelector("[data-update-prompt-update]")).toBeNull();
    expect(container.querySelector("[data-update-prompt-cancel]")).not.toBeNull();
    expect(container.textContent).toMatch(/Downloading update to v1\.9\.0/);
    cleanup();
  });

  it("renders an indeterminate spinner + 'Downloading…' until the first progress event", () => {
    const { container, cleanup } = renderDialog({
      open: true,
      state: makeAvailable("1.9.0"),
      onUpdate: noop,
    });
    const updateBtn = container.querySelector<HTMLButtonElement>(
      "[data-update-prompt-update]",
    );
    expect(updateBtn).not.toBeNull();
    if (updateBtn !== null) {
      act((): void => {
        updateBtn.click();
      });
    }
    // No progress event yet -> indeterminate: no determinate data
    // attribute (the element isn't rendered at all), indeterminate
    // bar class + spinning icon, "Downloading…".
    expect(container.querySelector("[data-update-prompt-progress]")).toBeNull();
    expect(
      container.querySelector(".update-prompt-progress-indeterminate"),
    ).not.toBeNull();
    expect(container.querySelector(".update-prompt-spinner")).not.toBeNull();
    expect(container.textContent).toMatch(/Downloading the update/);
    cleanup();
  });

  it("shows the live percent once downloading(N) events flow", () => {
    const onUpdate = vi.fn();
    const { container, root, cleanup } = renderDialog({
      open: true,
      state: makeAvailable("1.9.0"),
      onUpdate,
    });
    const updateBtn = container.querySelector<HTMLButtonElement>(
      "[data-update-prompt-update]",
    );
    if (updateBtn !== null) {
      act((): void => {
        updateBtn.click();
      });
    }
    // The backend streams progress into the same still-open dialog.
    act((): void => {
      root.render(
        <UpdatePromptDialog
          open
          state={makeDownloading(63)}
          onUpdate={noop}
          onInstall={noop}
          onClose={noop}
        />,
      );
    });
    const bar = container.querySelector("[data-update-prompt-progress='63']");
    expect(bar).not.toBeNull();
    expect(container.textContent).toMatch(/63%/);
    // Determinate now — the indeterminate bar is gone.
    expect(
      container.querySelector(".update-prompt-progress-indeterminate"),
    ).toBeNull();
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// 2. Outside-click during a background download does NOT re-arm "available".
// ---------------------------------------------------------------------------
describe("Bug 9 — host auto-open decision (outside-click must not re-arm)", () => {
  it("arms the prompt for a fresh 'available' state", () => {
    const d = decideUpdatePromptOpen({
      state: makeAvailable("1.9.0"),
      open: false,
      downloadInFlight: false,
      dismissedKey: null,
    });
    expect(d.shouldOpen).toBe(true);
    expect(d.key).toBe("available:1.9.0");
  });

  it("does NOT re-arm 'available' while a download is in the background", () => {
    // The user clicked Update; the popup went to the background; a
    // stray/lingering `available` push must NOT bring the "Update"
    // prompt back (the toolbar indicator owns the progress now).
    const d = decideUpdatePromptOpen({
      state: makeAvailable("1.9.0"),
      open: false,
      downloadInFlight: true,
      dismissedKey: null,
    });
    expect(d.shouldOpen).toBe(false);
  });

  it("keeps an already-open prompt open without toggling", () => {
    const d = decideUpdatePromptOpen({
      state: makeAvailable("1.9.0"),
      open: true,
      downloadInFlight: false,
      dismissedKey: null,
    });
    expect(d.shouldOpen).toBe(false);
    expect(d.key).toBe("available:1.9.0");
  });

  it("does not re-arm a prompt the user dismissed for the same state", () => {
    const key = updateActionableKey(makeAvailable("1.9.0"));
    const d = decideUpdatePromptOpen({
      state: makeAvailable("1.9.0"),
      open: false,
      downloadInFlight: false,
      dismissedKey: key,
    });
    expect(d.shouldOpen).toBe(false);
  });

  it("does not arm for passive / non-actionable states", () => {
    expect(
      decideUpdatePromptOpen({
        state: makeDownloading(30),
        open: false,
        downloadInFlight: false,
        dismissedKey: null,
      }).shouldOpen,
    ).toBe(false);
    expect(
      decideUpdatePromptOpen({
        state: { kind: "checking" },
        open: false,
        downloadInFlight: false,
        dismissedKey: null,
      }).shouldOpen,
    ).toBe(false);
    expect(
      decideUpdatePromptOpen({
        state: { kind: "up-to-date", version: "1.9.0" },
        open: false,
        downloadInFlight: false,
        dismissedKey: null,
      }).shouldOpen,
    ).toBe(false);
    expect(
      decideUpdatePromptOpen({
        state: { kind: "error", message: "x" },
        open: false,
        downloadInFlight: false,
        dismissedKey: null,
      }).shouldOpen,
    ).toBe(false);
    expect(
      decideUpdatePromptOpen({
        state: { kind: "unsupported", reason: "x" },
        open: false,
        downloadInFlight: false,
        dismissedKey: null,
      }).shouldOpen,
    ).toBe(false);
    expect(
      decideUpdatePromptOpen({
        state: null,
        open: false,
        downloadInFlight: false,
        dismissedKey: null,
      }).shouldOpen,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. downloaded -> fresh restart/cancel prompt.
// ---------------------------------------------------------------------------
describe("Bug 9 — downloaded arms the restart/cancel prompt", () => {
  it("arms the prompt when the download completes, even mid-flight latch", () => {
    // The in-flight latch is still set until the host's effect clears
    // it, but a completed download MUST surface the restart prompt.
    const d = decideUpdatePromptOpen({
      state: makeDownloaded("1.9.0"),
      open: false,
      downloadInFlight: true,
      dismissedKey: null,
    });
    expect(d.shouldOpen).toBe(true);
    expect(d.key).toBe("downloaded:1.9.0");
  });

  it("a fresh 'downloaded' state re-arms even after an 'available' prompt was dismissed", () => {
    const d = decideUpdatePromptOpen({
      state: makeDownloaded("1.9.0"),
      open: false,
      downloadInFlight: false,
      dismissedKey: "available:1.9.0",
    });
    expect(d.shouldOpen).toBe(true);
  });

  it("does not re-show a restart prompt the user dismissed (Later)", () => {
    const key = updateActionableKey(makeDownloaded("1.9.0"));
    const d = decideUpdatePromptOpen({
      state: makeDownloaded("1.9.0"),
      open: false,
      downloadInFlight: false,
      dismissedKey: key,
    });
    expect(d.shouldOpen).toBe(false);
  });

  it("renders Restart + Later for a downloaded state", () => {
    const onInstall = vi.fn();
    const { container, cleanup } = renderDialog({
      open: true,
      state: makeDownloaded("1.9.0"),
      onInstall,
    });
    const title = container.querySelector("#update-prompt-title");
    expect(title?.textContent).toMatch(/Restart to update/);
    expect(
      container.querySelector("[data-update-prompt-restart]"),
    ).not.toBeNull();
    expect(container.querySelector("[data-update-prompt-later]")).not.toBeNull();
    // No Update button — the download already happened.
    expect(container.querySelector("[data-update-prompt-update]")).toBeNull();
    const restart = container.querySelector<HTMLButtonElement>(
      "[data-update-prompt-restart]",
    );
    expect(restart).not.toBeNull();
    if (restart !== null) {
      act((): void => {
        restart.click();
      });
    }
    expect(onInstall).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("a post-click dialog supersedes to the restart prompt on 'downloaded'", () => {
    const onUpdate = vi.fn();
    const { container, root, cleanup } = renderDialog({
      open: true,
      state: makeAvailable("1.9.0"),
      onUpdate,
    });
    const updateBtn = container.querySelector<HTMLButtonElement>(
      "[data-update-prompt-update]",
    );
    if (updateBtn !== null) {
      act((): void => {
        updateBtn.click();
      });
    }
    // Download completes while the dialog is (still) open.
    act((): void => {
      root.render(
        <UpdatePromptDialog
          open
          state={makeDownloaded("1.9.0")}
          onUpdate={noop}
          onInstall={noop}
          onClose={noop}
        />,
      );
    });
    expect(
      container.querySelector("[data-update-prompt-restart]"),
    ).not.toBeNull();
    expect(container.querySelector("[data-update-prompt-later]")).not.toBeNull();
    expect(container.querySelector("[data-update-prompt-update]")).toBeNull();
    cleanup();
  });
});
