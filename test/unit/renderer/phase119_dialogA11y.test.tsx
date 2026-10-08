// @vitest-environment jsdom
//
// Phase 119 (TFL-1328 chunk F) — DialogShell framework-native accessibility.
// Focus trap, background inert, always-present name/description, focus restore.
// Mounted with the same raw react-dom/client + act harness as
// dialogShell.test.tsx:1-40.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DialogShell } from "../../../src/renderer/components/DialogShell";

function mount(node: React.ReactElement): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act((): void => {
    root.render(node);
  });
  return {
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

// Flush the queueMicrotask the shell uses for initial focus.
async function flushMicrotasks(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
  });
}

function surfaceRoot(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>(".modal-dialog") as HTMLElement;
}

function pressTab(target: HTMLElement, shiftKey = false): void {
  act((): void => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true }));
  });
}

afterEach((): void => {
  document.body.innerHTML = "";
});

describe("Phase 119 — useDialogA11y via DialogShell", () => {
  it("NAME: always exposes an accessible name that resolves to the title", () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Greetings">
        <p>Body</p>
      </DialogShell>,
    );
    const root = surfaceRoot(container);
    const labelledBy = root.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const label = document.getElementById(labelledBy as string);
    expect(label?.textContent).toBe("Greetings");
    cleanup();
  });

  it("DESCRIPTION: names the description element through aria-describedby", () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Title" description="Details here">
        <p>Body</p>
      </DialogShell>,
    );
    const root = surfaceRoot(container);
    const describedBy = root.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const desc = document.getElementById(describedBy as string);
    expect(desc?.textContent).toContain("Details here");
    expect(container.querySelector(".modal-body")?.firstElementChild).toBe(desc);
    cleanup();
  });

  it("TRAP: wraps Tab at the last control and Shift+Tab at the first", async () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Title">
        <button type="button" data-first="">
          First
        </button>
        <button type="button" data-last="">
          Last
        </button>
      </DialogShell>,
    );
    await flushMicrotasks();
    const dialog = surfaceRoot(container);
    const first = container.querySelector<HTMLButtonElement>("[data-first]") as HTMLButtonElement;
    const last = container.querySelector<HTMLButtonElement>("[data-last]") as HTMLButtonElement;

    last.focus();
    pressTab(dialog);
    expect(document.activeElement).toBe(first);

    first.focus();
    pressTab(dialog, true);
    expect(document.activeElement).toBe(last);
    cleanup();
  });

  it("INERT: marks the background sibling while open and restores it on close", () => {
    const external = document.createElement("div");
    external.setAttribute("data-external", "");
    document.body.appendChild(external);

    const { cleanup } = mount(
      <DialogShell open title="Title">
        <p>Body</p>
      </DialogShell>,
    );
    expect(external.hasAttribute("inert")).toBe(true);
    cleanup();
    expect(external.hasAttribute("inert")).toBe(false);
    external.remove();
  });

  it("RESTORE: returns focus to the opener after the dialog unmounts", () => {
    const opener = document.createElement("button");
    opener.type = "button";
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { cleanup } = mount(
      <DialogShell open title="Title">
        <p>Body</p>
      </DialogShell>,
    );
    cleanup();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
