// @vitest-environment jsdom
//
// DEF-430 — the About dialog ignored the Escape key. Every other dialog
// in the app installs a window-level keydown listener while open
// (DeletePageDialog, MergeDialog, OptimizeDialog, ...); the About sheet
// was the odd one out, so Escape only closed it via the X button or a
// backdrop click.
//
// These tests pin the fixed contract (mirrors DEF-201):
//   1. Escape while the sheet is open calls onClose exactly once.
//   2. Escape while the sheet is CLOSED does nothing (no listener is
//      installed for a closed sheet).
//   3. After unmount the listener is gone (no stray Escape handling).
//   4. Two Escapes while open call onClose exactly twice.
//   5. Escape (call 1) -> host flips `open` false -> Escape -> still
//      exactly 1 call (effect cleanup tears the listener down).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AboutDialog } from "../../../src/renderer/components/AboutDialog";

function mountAbout(open: boolean): {
  host: HTMLElement;
  setOpen: (next: boolean) => void;
  unmount: () => void;
  onClose: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onClose = vi.fn((): void => undefined);
  let current = { open };
  const render = (): void => {
    act((): void => {
      root.render(
        <AboutDialog
          open={current.open}
          onClose={onClose}
        />,
      );
    });
  };
  render();
  return {
    host,
    setOpen: (next: boolean): void => {
      current = { ...current, open: next };
      render();
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
    onClose,
  };
}

function pressEscape(): void {
  act((): void => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
}

describe("DEF-430 — About dialog closes on Escape", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("renders the dialog when open and Escape calls onClose once", () => {
    const { host, onClose, unmount } = mountAbout(true);
    // Sanity: the dialog is actually mounted.
    expect(host.querySelector("[data-about-dialog]")).not.toBeNull();
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("Escape does nothing while the dialog is closed (no listener installed)", () => {
    const { onClose, unmount } = mountAbout(false);
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("removes the Escape listener on unmount", () => {
    const { onClose, unmount } = mountAbout(true);
    unmount();
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes only once per Escape press (repeated Escape repeats onClose)", () => {
    const { onClose, unmount } = mountAbout(true);
    pressEscape();
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("stops listening after the dialog closes via onClose (open flips false)", () => {
    const { setOpen, onClose, unmount } = mountAbout(true);
    // Escape while open closes the dialog (call 1)...
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
    // ...the host flips `open` false (the real app re-renders the
    // dialog closed); the effect cleanup must tear the listener down.
    setOpen(false);
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1); // no second call
    unmount();
  });
});
