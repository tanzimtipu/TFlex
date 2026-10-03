// @vitest-environment jsdom
//
// Phase 92 (TFL-513 chunk A) — DialogShell DOM contract.
//
// Mounted with the same raw react-dom/client + act pattern the other
// renderer tests use (phase52Dialogs.test.tsx:20-46).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DialogShell, type DialogAction } from "../../../src/renderer/components/DialogShell";

function mount(node: React.ReactElement): { root: Root; container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(node);
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

// Flush the queueMicrotask the shell uses for initial focus.
async function flushMicrotasks(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
  });
}

function actionButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("[data-dialog-action]"));
}

function twoActions(): DialogAction[] {
  return [
    { key: "cancel", label: "Cancel", variant: "secondary", onClick: vi.fn() },
    { key: "confirm", label: "Confirm", variant: "primary", onClick: vi.fn(), default: true },
  ];
}

describe("Phase 92 — DialogShell structure", () => {
  it("renders the shipped dialog DOM: backdrop, shell, header, body and footer", () => {
    const { container, cleanup } = mount(
      <DialogShell open title="My title" onClose={vi.fn()} actions={twoActions()}>
        <p data-body>Body copy</p>
      </DialogShell>,
    );

    const backdrop = container.querySelector(".modal-backdrop");
    expect(backdrop).not.toBeNull();
    const shell = backdrop?.querySelector(".modal-dialog.dialog.dialog-shell");
    expect(shell).not.toBeNull();
    expect(shell?.getAttribute("data-dialog-shell")).toBe("true");
    expect(shell?.getAttribute("role")).toBe("dialog");
    expect(shell?.getAttribute("aria-modal")).toBe("true");
    expect(container.querySelector(".modal-header .modal-title")?.textContent).toBe("My title");
    expect(container.querySelector(".modal-body [data-body]")).not.toBeNull();
    expect(container.querySelector(".modal-footer")).not.toBeNull();
    cleanup();
  });

  it("renders the title with the supplied titleId for aria-labelledby", () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Labelled" titleId="my-title" onClose={vi.fn()}>
        <p>Body</p>
      </DialogShell>,
    );
    const title = container.querySelector("#my-title.modal-title");
    expect(title?.textContent).toBe("Labelled");
    expect(container.querySelector(".modal-dialog")?.getAttribute("aria-labelledby")).toBe("my-title");
    cleanup();
  });

  it("renders actions in order with the canonical button classes and dialogs-action hooks", () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Order" onClose={vi.fn()} actions={twoActions()}>
        <p>Body</p>
      </DialogShell>,
    );
    const buttons = actionButtons(container);
    expect(buttons.map((b) => b.getAttribute("data-dialog-action"))).toEqual(["cancel", "confirm"]);
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Confirm"]);
    expect(buttons[0].classList.contains("btn")).toBe(true);
    expect(buttons[0].classList.contains("btn-secondary")).toBe(true);
    expect(buttons[1].classList.contains("btn-primary")).toBe(true);
    cleanup();
  });

  it("maps tertiary to btn-ghost and danger to btn-danger", () => {
    const actions: DialogAction[] = [
      { key: "later", label: "Later", variant: "tertiary", onClick: vi.fn() },
      { key: "delete", label: "Delete", variant: "danger", onClick: vi.fn() },
    ];
    const { container, cleanup } = mount(
      <DialogShell open title="Variants" onClose={vi.fn()} actions={actions}>
        <p>Body</p>
      </DialogShell>,
    );
    const buttons = actionButtons(container);
    expect(buttons[0].classList.contains("btn-ghost")).toBe(true);
    expect(buttons[1].classList.contains("btn-danger")).toBe(true);
    cleanup();
  });

  it("emits each action's testId as data-testid and forwards extra per-action hooks", () => {
    const actions: DialogAction[] = [
      Object.assign(
        { key: "confirm", label: "Go", variant: "primary" as const, onClick: vi.fn(), testId: "go-btn" },
        { "data-legacy-confirm": "yes" },
      ),
    ];
    const { container, cleanup } = mount(
      <DialogShell open title="Extras" onClose={vi.fn()} actions={actions}>
        <p>Body</p>
      </DialogShell>,
    );
    const button = actionButtons(container)[0];
    expect(button.getAttribute("data-testid")).toBe("go-btn");
    expect(button.getAttribute("data-legacy-confirm")).toBe("yes");
    cleanup();
  });

  it("renders a disabled action as a disabled button", () => {
    const actions: DialogAction[] = [
      { key: "confirm", label: "Wait", variant: "primary", onClick: vi.fn(), disabled: true },
    ];
    const { container, cleanup } = mount(
      <DialogShell open title="Busy" onClose={vi.fn()} actions={actions}>
        <p>Body</p>
      </DialogShell>,
    );
    expect(actionButtons(container)[0].disabled).toBe(true);
    cleanup();
  });

  it("renders no footer when neither actions nor footer are supplied", () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Bare" onClose={vi.fn()}>
        <p>Body</p>
      </DialogShell>,
    );
    expect(container.querySelector(".modal-footer")).toBeNull();
    cleanup();
  });

  it("gives a supplied footer precedence over actions", () => {
    const { container, cleanup } = mount(
      <DialogShell
        open
        title="Custom footer"
        onClose={vi.fn()}
        actions={twoActions()}
        footer={<div data-custom-footer>custom</div>}
      >
        <p>Body</p>
      </DialogShell>,
    );
    expect(container.querySelector("[data-custom-footer]")).not.toBeNull();
    expect(actionButtons(container)).toHaveLength(0);
    cleanup();
  });
});

describe("Phase 92 — DialogShell close behaviour", () => {
  it("renders the close X (aria-label 'Close dialog') when onClose is given", () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Closable" onClose={vi.fn()}>
        <p>Body</p>
      </DialogShell>,
    );
    const close = container.querySelector(".modal-close");
    expect(close).not.toBeNull();
    expect(close?.getAttribute("aria-label")).toBe("Close dialog");
    cleanup();
  });

  it("calls onClose on Esc and on a genuine backdrop click", () => {
    const onClose = vi.fn();
    const { container, cleanup } = mount(
      <DialogShell open title="Closable" onClose={onClose}>
        <p>Body</p>
      </DialogShell>,
    );
    act((): void => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = container.querySelector(".modal-backdrop") as HTMLElement;
    act((): void => {
      backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("does not close on a drag that starts inside the dialog and releases on the backdrop", () => {
    const onClose = vi.fn();
    const { container, cleanup } = mount(
      <DialogShell open title="Guarded" onClose={onClose}>
        <p>Body</p>
      </DialogShell>,
    );
    const backdrop = container.querySelector(".modal-backdrop") as HTMLElement;
    expect(backdrop).not.toBeNull();
    const dialog = container.querySelector(".modal-dialog") as HTMLElement;
    act((): void => {
      dialog.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    expect(onClose).not.toHaveBeenCalled();
    cleanup();
  });

  it("is must-answer when onClose is omitted: no close X, no Esc close, no backdrop close", () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Must answer" actions={twoActions()}>
        <p>Body</p>
      </DialogShell>,
    );
    expect(container.querySelector(".modal-close")).toBeNull();
    act((): void => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    const backdrop = container.querySelector(".modal-backdrop") as HTMLElement;
    act((): void => {
      backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    // The dialog stays mounted and nothing threw.
    expect(container.querySelector(".modal-dialog")).not.toBeNull();
    cleanup();
  });
});

describe("Phase 92 — DialogShell focus, forwarding and sizes", () => {
  it("focuses the default action on open", async () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Focus" onClose={vi.fn()} actions={twoActions()}>
        <p>Body</p>
      </DialogShell>,
    );
    await flushMicrotasks();
    const confirm = container.querySelector<HTMLButtonElement>('[data-dialog-action="confirm"]');
    expect(document.activeElement).toBe(confirm);
    cleanup();
  });

  it("focuses the first enabled control when the default action is disabled", async () => {
    const { container, cleanup } = mount(
      <DialogShell
        open
        title="Focus fallback"
        onClose={vi.fn()}
        actions={[
          { key: "cancel", label: "Cancel", variant: "secondary", onClick: vi.fn() },
          { key: "create", label: "Create", variant: "primary", onClick: vi.fn(), default: true, disabled: true },
        ]}
      >
        <p>Body</p>
      </DialogShell>,
    );
    await flushMicrotasks();
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]');
    expect(document.activeElement).toBe(close);
    expect(document.activeElement).not.toBe(container.querySelector('[data-dialog-action="create"]'));
    cleanup();
  });

  it("forwards extra data-* props to the dialog root unchanged", () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Forward" onClose={vi.fn()} data-confirm-dialog data-custom="x">
        <p>Body</p>
      </DialogShell>,
    );
    const shell = container.querySelector("[data-dialog-shell]");
    expect(shell?.getAttribute("data-confirm-dialog")).toBe("true");
    expect(shell?.getAttribute("data-custom")).toBe("x");
    cleanup();
  });

  it("emits testId as the data-dialog-shell value", () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Hooked" testId="flatten-confirm" onClose={vi.fn()}>
        <p>Body</p>
      </DialogShell>,
    );
    expect(container.querySelector('[data-dialog-shell="flatten-confirm"]')).not.toBeNull();
    cleanup();
  });

  it("applies exactly one size modifier class", () => {
    for (const [size, expected] of [
      ["sm", "dialog-shell-sm"],
      ["md", null],
      ["lg", "modal-dialog-wide"],
      ["tool", "modal-dialog-tool"],
    ] as const) {
      const { container, cleanup } = mount(
        <DialogShell open title="Size" size={size} onClose={vi.fn()}>
          <p>Body</p>
        </DialogShell>,
      );
      const shell = container.querySelector(".dialog-shell") as HTMLElement;
      for (const cls of ["dialog-shell-sm", "modal-dialog-wide", "modal-dialog-tool"]) {
        expect(shell.classList.contains(cls)).toBe(expected === cls);
      }
      cleanup();
    }
  });

  it("renders the optional leading icon before the title", () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Iconic" icon={<span data-icon />} onClose={vi.fn()}>
        <p>Body</p>
      </DialogShell>,
    );
    const header = container.querySelector(".modal-header") as HTMLElement;
    expect(header.firstElementChild?.getAttribute("data-icon")).not.toBeNull();
    cleanup();
  });
});

describe("Phase 92 — DialogShell blockBackdropClose / closeDisabled / closeTestId", () => {
  it("blockBackdropClose ignores backdrop clicks but keeps Esc working", () => {
    const onClose = vi.fn();
    const { container, cleanup } = mount(
      <DialogShell open title="Busy" onClose={onClose} blockBackdropClose>
        <p>Body</p>
      </DialogShell>,
    );
    const backdrop = container.querySelector(".modal-backdrop") as HTMLElement;
    expect(backdrop).not.toBeNull();
    act((): void => {
      backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    expect(onClose).not.toHaveBeenCalled();
    act((): void => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("defaults blockBackdropClose to false (backdrop click still closes)", () => {
    const onClose = vi.fn();
    const { container, cleanup } = mount(
      <DialogShell open title="Idle" onClose={onClose}>
        <p>Body</p>
      </DialogShell>,
    );
    const backdrop = container.querySelector(".modal-backdrop") as HTMLElement;
    act((): void => {
      backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("closeDisabled disables the close X while Esc still closes", () => {
    const onClose = vi.fn();
    const { container, cleanup } = mount(
      <DialogShell open title="Locked X" onClose={onClose} closeDisabled>
        <p>Body</p>
      </DialogShell>,
    );
    const close = container.querySelector<HTMLButtonElement>(".modal-close");
    expect(close?.disabled).toBe(true);
    act((): void => {
      close?.click();
    });
    expect(onClose).not.toHaveBeenCalled();
    act((): void => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("emits closeTestId on the header close X (keeps a shipped hook)", () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Hooked X" onClose={vi.fn()} closeTestId="doc-info-close">
        <p>Body</p>
      </DialogShell>,
    );
    expect(container.querySelector('[data-testid="doc-info-close"]')).not.toBeNull();
    cleanup();
  });
});

// TFL-513-D3a — opt-in draggable window. Pointer sequences are driven with
// raw MouseEvents of type "pointerdown"/"pointermove"/"pointerup" (the same
// shape bugB17_backdropDragClose.test.tsx uses) so no PointerEvent shim is
// required; the drag hook only reads button / target / clientX / clientY.
function dispatchPointerDown(el: Element, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }),
    );
  });
}

function dispatchWindowPointer(type: "pointermove" | "pointerup", x: number, y: number): void {
  act((): void => {
    window.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }),
    );
  });
}

describe("TFL-513-D3a — DialogShell draggable window", () => {
  it("does not add modal-dialog-dragging when draggable is unset", async () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Static" onClose={vi.fn()}>
        <p>Body</p>
      </DialogShell>,
    );
    const root = container.querySelector<HTMLElement>(".modal-dialog");
    const header = container.querySelector<HTMLElement>(".modal-header");
    expect(root).not.toBeNull();
    expect(header).not.toBeNull();

    dispatchPointerDown(header as HTMLElement, 10, 10);
    await flushMicrotasks();
    expect(root?.classList.contains("modal-dialog-dragging")).toBe(false);
    cleanup();
  });

  it("with draggable, a chrome pointerdown marks the root modal-dialog-dragging and a control press does not", () => {
    const { container, cleanup } = mount(
      <DialogShell
        open
        title="Movable"
        onClose={vi.fn()}
        actions={twoActions()}
        draggable={{ controlsSelector: "button, input, select, textarea" }}
      >
        <p>Body</p>
      </DialogShell>,
    );
    const root = container.querySelector<HTMLElement>(".modal-dialog");
    const title = container.querySelector<HTMLElement>("h2.modal-title");
    expect(root).not.toBeNull();
    expect(title).not.toBeNull();

    dispatchPointerDown(title as HTMLElement, 20, 20);
    expect(root?.classList.contains("modal-dialog-dragging")).toBe(true);

    dispatchWindowPointer("pointerup", 20, 20);
    expect(root?.classList.contains("modal-dialog-dragging")).toBe(false);

    const control = container.querySelector<HTMLElement>("button[data-dialog-action]");
    expect(control).not.toBeNull();
    dispatchPointerDown(control as HTMLElement, 30, 30);
    expect(root?.classList.contains("modal-dialog-dragging")).toBe(false);
    cleanup();
  });
});

// TFL-513-E2a — opt-in sheet surface. The default dialog path is pinned
// unchanged; `surface="sheet"` renders the shipped `.sheet` chrome.
describe("TFL-513-E2a — DialogShell surface=sheet", () => {
  it("defaults to the dialog surface: modal chrome and no .sheet", () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Default" onClose={vi.fn()}>
        <p>Body</p>
      </DialogShell>,
    );
    expect(container.querySelector(".modal-backdrop")).not.toBeNull();
    expect(container.querySelector(".modal-dialog")).not.toBeNull();
    expect(container.querySelector(".modal-header")).not.toBeNull();
    expect(container.querySelector(".modal-body")).not.toBeNull();
    expect(container.querySelector(".sheet")).toBeNull();
    expect(container.querySelector(".sheet-backdrop")).toBeNull();
    cleanup();
  });

  it('surface="dialog" stays on the dialog surface', () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Explicit" surface="dialog" onClose={vi.fn()}>
        <p>Body</p>
      </DialogShell>,
    );
    expect(container.querySelector(".modal-dialog")).not.toBeNull();
    expect(container.querySelector(".sheet")).toBeNull();
    cleanup();
  });

  it('surface="sheet" renders the sheet chrome with no modal chrome', () => {
    const { container, cleanup } = mount(
      <DialogShell
        open
        title="Sheet title"
        surface="sheet"
        titleId="sheet-title"
        onClose={vi.fn()}
        data-x="y"
      >
        <p data-sheet-body>Body</p>
      </DialogShell>,
    );
    expect(container.querySelector(".sheet-backdrop")).not.toBeNull();
    const sheet = container.querySelector(".sheet");
    expect(sheet).not.toBeNull();
    expect(container.querySelector(".sheet-header")).not.toBeNull();
    const title = container.querySelector("#sheet-title.sheet-title");
    expect(title?.textContent).toBe("Sheet title");
    expect(container.querySelector("button.sheet-close")).not.toBeNull();
    expect(container.querySelector(".sheet-body [data-sheet-body]")).not.toBeNull();
    expect(container.querySelector(".modal-dialog")).toBeNull();
    expect(container.querySelector(".modal-backdrop")).toBeNull();
    // The forwarded hook lands on the TfSheet root.
    expect(sheet?.getAttribute("data-x")).toBe("y");
    expect(sheet?.getAttribute("data-dialog-shell")).toBe("true");
    cleanup();
  });

  it("closeAriaLabel sets the close button aria-label on both surfaces", () => {
    const dialog = mount(
      <DialogShell open title="Dialog" onClose={vi.fn()} closeAriaLabel="Close about dialog">
        <p>Body</p>
      </DialogShell>,
    );
    const dialogClose = dialog.container.querySelector(".modal-close");
    expect(dialogClose?.getAttribute("aria-label")).toBe("Close about dialog");
    expect(dialogClose?.getAttribute("title")).toBe("Close about dialog");
    dialog.cleanup();

    const sheet = mount(
      <DialogShell open title="Sheet" surface="sheet" onClose={vi.fn()} closeAriaLabel="Close preferences">
        <p>Body</p>
      </DialogShell>,
    );
    const sheetClose = sheet.container.querySelector(".sheet-close");
    expect(sheetClose?.getAttribute("aria-label")).toBe("Close preferences");
    expect(sheetClose?.getAttribute("title")).toBe("Close preferences");
    sheet.cleanup();
  });

  it("sheet: Esc closes once and a backdrop click closes", () => {
    const onClose = vi.fn();
    const { container, cleanup } = mount(
      <DialogShell open title="Sheet" surface="sheet" onClose={onClose}>
        <p>Body</p>
      </DialogShell>,
    );
    act((): void => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = container.querySelector(".sheet-backdrop") as HTMLElement;
    expect(backdrop).not.toBeNull();
    act((): void => {
      backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("sheet: must-answer when onClose is omitted (no close button, backdrop inert)", () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Sheet" surface="sheet" actions={twoActions()}>
        <p>Body</p>
      </DialogShell>,
    );
    expect(container.querySelector(".sheet-close")).toBeNull();
    const backdrop = container.querySelector(".sheet-backdrop") as HTMLElement;
    act((): void => {
      backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    expect(container.querySelector(".sheet")).not.toBeNull();
    cleanup();
  });
});

// DEF-525 — only the top-most open shell handles Esc.
describe("DEF-525 — top-most Esc guard across stacked DialogShells", () => {
  it("closes only the top-most shell on one Escape; the lower shell closes after it unmounts", () => {
    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    const a = mount(
      <DialogShell open title="A" onClose={onCloseA}>
        <p>A body</p>
      </DialogShell>,
    );
    const b = mount(
      <DialogShell open title="B" onClose={onCloseB}>
        <p>B body</p>
      </DialogShell>,
    );

    act((): void => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCloseB).toHaveBeenCalledTimes(1);
    expect(onCloseA).not.toHaveBeenCalled();

    b.cleanup();

    act((): void => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCloseA).toHaveBeenCalledTimes(1);

    a.cleanup();
  });
});
