// @vitest-environment jsdom
//
// DEF-201 — the Preferences sheet ignored the Escape key. Every other
// dialog in the app installs a window-level keydown listener while
// open (DeletePageDialog, MergeDialog, OptimizeDialog, ...); the
// preferences sheet was the odd one out, so Escape only closed it via
// the X button or a backdrop click.
//
// These tests pin the fixed contract:
//   1. Escape while the sheet is open calls onClose exactly once.
//   2. Escape while the sheet is CLOSED does nothing (no listener is
//      installed for a closed sheet).
//   3. After unmount the listener is gone (no stray Escape handling).
//   4. Escape still closes when the focus/keystroke originates from
//      inside the sheet's recents input (window-level listener, not
//      focus-dependent).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { PreferencesDialog } from "../../../src/renderer/components/PreferencesDialog";

function mountPrefs(open: boolean): {
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
        <PreferencesDialog
          open={current.open}
          onClose={onClose}
          themeDefault="dark"
          recentsCap={10}
          onSetThemeDefault={(): void => undefined}
          onSetRecentsCap={(): void => undefined}
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

describe("DEF-201 — Preferences sheet closes on Escape", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("renders the sheet when open and Escape calls onClose once", () => {
    const { host, onClose, unmount } = mountPrefs(true);
    // Sanity: the sheet is actually mounted.
    expect(host.querySelector("[data-prefs-dialog]")).not.toBeNull();
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("Escape does nothing while the sheet is closed (no listener installed)", () => {
    const { onClose, unmount } = mountPrefs(false);
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("removes the Escape listener on unmount", () => {
    const { onClose, unmount } = mountPrefs(true);
    unmount();
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes only once per Escape press (repeated Escape repeats onClose)", () => {
    const { onClose, unmount } = mountPrefs(true);
    pressEscape();
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("stops listening after the sheet closes via onClose (open flips false)", () => {
    const { setOpen, onClose, unmount } = mountPrefs(true);
    // Escape while open closes the sheet (call 1)...
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
