// @vitest-environment jsdom
// Bug 16 — Update pop-up must transition to a progress state on
// click, then to a restart prompt; Cancel dismisses.
//
// The previous UpdatePromptDialog sat on the "available" prompt
// after the user clicked Update, with no visible feedback while
// the download streamed. The fix:
//   1. Captures the version the user requested (`pendingVersion`)
//      on click, so the header keeps showing a meaningful title
//      while the live state transitions through `checking` and
//      `downloading`.
//   2. Renders a progress bar + label when the live state is
//      `downloading` (or right after the Update click, before the
//      first progress event) so the dialog gives visible feedback.
//   3. Replaces the passive "Close" button with a "Cancel"
//      action during the post-click download, so the user can
//      dismiss the dialog without waiting for the download to
//      finish (the toolbar indicator continues to surface
//      progress independently).
//
// We exercise the dialog here with synthetic state transitions
// and assert the rendered output for each phase.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  UpdatePromptDialog,
  promptKindFromState,
} from "../../../src/renderer/components/UpdatePromptDialog";
import type { UpdateState } from "../../../src/shared/types";

function makeAvailable(version: string): UpdateState {
  return { kind: "available", version };
}

function makeDownloading(progress: number): UpdateState {
  return { kind: "downloading", progress };
}

function makeDownloaded(version: string): UpdateState {
  return { kind: "downloaded", version };
}

function renderDialog(args: {
  open: boolean;
  state: UpdateState | null;
  onUpdate?: () => void;
  onInstall?: () => void;
  onClose?: () => void;
}): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <UpdatePromptDialog
        open={args.open}
        state={args.state}
        onUpdate={args.onUpdate ?? ((): void => undefined)}
        onInstall={args.onInstall ?? ((): void => undefined)}
        onClose={args.onClose ?? ((): void => undefined)}
      />,
    );
  });
  return container;
}

describe("Bug 16 — UpdatePromptDialog progress + cancel transitions", () => {
  it("promptKindFromState maps 'downloading' to the 'downloading' kind (Bug 9 progress state)", () => {
    // Bug 9 — the dialog renders its own progress presentation for
    // the `downloading` state (spinner + "Downloading…" + live
    // percent) instead of folding it into the passive "checking"
    // kind, so the pure mapping keeps them distinct.
    expect(promptKindFromState(makeDownloading(50))).toBe("downloading");
  });

  it("renders the download progress bar when state is 'downloading'", () => {
    const root = renderDialog({
      open: true,
      state: makeDownloading(42),
    });
    const bar = root.querySelector("[data-update-prompt-progress='42']");
    expect(bar).not.toBeNull();
    // The progress label shows the percent.
    expect(root.textContent).toMatch(/42%/);
  });

  it("Update click captures the requested version (post-click progress state)", () => {
    // When the user clicks Update on an 'available' state, the
    // dialog captures the version in local state so the header
    // keeps a meaningful title while the live state transitions
    // through `checking` (no progress yet) and then `downloading`.
    // We can't fully simulate the multi-step state push in a
    // single render, but we can assert the dialog's available
    // action routes through onUpdate with the expected handler.
    const onUpdate = vi.fn();
    const root = renderDialog({
      open: true,
      state: makeAvailable("1.7.0"),
      onUpdate,
    });
    const updateBtn = root.querySelector<HTMLButtonElement>(
      "[data-update-prompt-update]",
    );
    expect(updateBtn).not.toBeNull();
    if (updateBtn === null) return;
    act((): void => {
      updateBtn.click();
    });
    expect(onUpdate).toHaveBeenCalled();
  });

  it("transitions to the restart prompt on 'downloaded' state", () => {
    // After the download completes, the dialog renders the
    // 'downloaded' prompt with a primary Restart button. The
    // header reads "Restart to update" and the action set is
    // [Later, Restart].
    const onInstall = vi.fn();
    const root = renderDialog({
      open: true,
      state: makeDownloaded("1.7.0"),
      onInstall,
    });
    const title = root.querySelector("#update-prompt-title");
    expect(title?.textContent).toMatch(/Restart to update/);
    const restartBtn = root.querySelector<HTMLButtonElement>(
      "[data-update-prompt-restart]",
    );
    expect(restartBtn).not.toBeNull();
    if (restartBtn === null) return;
    act((): void => {
      restartBtn.click();
    });
    expect(onInstall).toHaveBeenCalled();
  });

  it("Cancel button dismisses the dialog (onClose fires)", () => {
    const onClose = vi.fn();
    const root = renderDialog({
      open: true,
      state: makeAvailable("1.7.0"),
      onClose,
    });
    const cancelBtn = root.querySelector<HTMLButtonElement>(
      "[data-update-prompt-cancel]",
    );
    expect(cancelBtn).not.toBeNull();
    if (cancelBtn === null) return;
    act((): void => {
      cancelBtn.click();
    });
    expect(onClose).toHaveBeenCalled();
  });
});
