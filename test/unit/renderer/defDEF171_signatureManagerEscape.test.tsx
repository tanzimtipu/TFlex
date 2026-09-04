// @vitest-environment jsdom
// DEF-171 — the Signature Manager modal ignored the Escape key: the
// dialog and its full-screen backdrop stayed up, blocking every control
// behind them. Root cause: the modal registered NO window keydown
// listener at all — it only wired backdrop CLICKS via
// `useBackdropClose`. Every other dialog closes on Escape via a
// `window.addEventListener("keydown", ...)` effect keyed on `open`.
//
// The fix adds that same wiring (bubble phase, so it fires even when
// focus is inside the draw canvas or the Type tab's text input, neither
// of which has a keydown handler that would stop propagation).
//
// This test drives the real modal and asserts Escape closes it from all
// three tabs, with the keydown dispatched FROM the canvas / the text
// input (bubbling to window) to prove focus location doesn't matter.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { SignatureManagerModal } from "../../../src/renderer/signatures/SignatureManagerModal";
import { _resetSignatureServiceForTests } from "../../../src/renderer/signatures/service";
import type { SavedSignature } from "../../../src/shared/types";

let closedCount = 0;
let open = true;
let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
let savedList: SavedSignature[] = [];

function renderModal(): void {
  act((): void => {
    root.render(
      createElement(SignatureManagerModal, {
        open,
        onClose: (): void => {
          closedCount += 1;
          open = false;
          // The real host's `onClose` flips `open` and re-renders;
          // mirror that so the modal actually unmounts here.
          renderModal();
        },
        onApply: (): void => undefined,
        savedSignatures: savedList,
        onToast: (): void => undefined,
      }),
    );
  });
}

function mountModal(): void {
  closedCount = 0;
  open = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  renderModal();
}

function unmountModal(): void {
  act((): void => {
    root.unmount();
  });
  host.remove();
}

function pressEscapeFrom(el: HTMLElement): void {
  act((): void => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

function pressEscapeOnWindow(): void {
  act((): void => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

function clickSigTab(name: string): void {
  const tabs = host.querySelectorAll<HTMLElement>(".sig-tab");
  for (const t of tabs) {
    if (t.textContent?.trim().startsWith(name)) {
      act((): void => {
        t.click();
      });
      return;
    }
  }
  throw new Error(`tab ${name} not found`);
}

afterEach(() => {
  unmountModal();
  delete (window as unknown as { tflex?: unknown }).tflex;
  _resetSignatureServiceForTests();
});

describe("DEF-171 — Escape closes the Signature Manager from every tab", () => {
  it("Escape from the draw tab (keydown starts in the canvas) closes dialog + backdrop", () => {
    mountModal();
    const canvas = host.querySelector<HTMLElement>("canvas.sig-canvas");
    expect(canvas).not.toBeNull();
    expect(host.querySelector(".modal-backdrop")).not.toBeNull();

    pressEscapeFrom(canvas as HTMLElement);

    expect(closedCount).toBe(1);
    expect(host.querySelector(".modal-backdrop")).toBeNull();
    expect(host.querySelector(".modal-dialog.sig-manager")).toBeNull();
  });

  it("Escape with focus in the Type input closes dialog + backdrop", () => {
    mountModal();
    clickSigTab("Type");
    const input = host.querySelector<HTMLElement>("[aria-label='Type your signature']");
    expect(input).not.toBeNull();
    // Focus the input, then dispatch Escape FROM the input so the event
    // bubbles through the focused text field.
    act((): void => {
      (input as HTMLElement).focus();
    });
    pressEscapeFrom(input as HTMLElement);

    expect(closedCount).toBe(1);
    expect(host.querySelector(".modal-backdrop")).toBeNull();
    expect(host.querySelector(".modal-dialog.sig-manager")).toBeNull();
  });

  it("Escape from the Saved tab (focus on a row button) closes dialog + backdrop", () => {
    savedList = [
      {
        id: "sig-1",
        label: "Jane",
        createdAt: new Date().toISOString(),
        source: { kind: "typed", text: "Jane", width: 320, height: 80 },
      },
    ];
    mountModal();
    clickSigTab("Saved");
    const rowBtn = host.querySelector<HTMLElement>(".sig-saved-pick");
    expect(rowBtn).not.toBeNull();
    pressEscapeFrom(rowBtn as HTMLElement);

    expect(closedCount).toBe(1);
    expect(host.querySelector(".modal-backdrop")).toBeNull();
  });

  it("closes again after reopening — the window listener is re-registered, not stale", () => {
    mountModal();
    clickSigTab("Type");
    const input = host.querySelector<HTMLElement>("[aria-label='Type your signature']");
    expect(input).not.toBeNull();
    pressEscapeFrom(input as HTMLElement);
    expect(closedCount).toBe(1);
    expect(host.querySelector(".modal-backdrop")).toBeNull();

    // Reopen: the effect must bind a FRESH listener (no stale closure).
    open = true;
    renderModal();
    expect(host.querySelector(".modal-backdrop")).not.toBeNull();
    pressEscapeOnWindow();
    expect(closedCount).toBe(2);
    expect(host.querySelector(".modal-backdrop")).toBeNull();
  });
});