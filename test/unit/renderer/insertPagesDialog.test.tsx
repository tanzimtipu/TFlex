// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InsertPagesDialog } from "../../../src/renderer/components/InsertPagesDialog";

/**
 * Phase 9 — InsertPagesDialog render contract tests.
 *
 * The dialog's contract:
 *   - Renders two mode radios (blank / from PDF).
 *   - Position field validates 1..totalPages+1 or "end".
 *   - Confirm is disabled when the position is invalid or
 *     (from-PDF mode) no file has been picked.
 *   - Esc + backdrop + close button fire onClose.
 */

interface RenderArgs {
  totalPages?: number;
  pickOtherFile?: () => Promise<
    { bytes: Uint8Array; path: string } | null
  >;
  onConfirm?: (c: {
    mode: "blank" | "fromPdf";
    position: number;
    widthPt?: number;
    heightPt?: number;
    otherBytes?: Uint8Array;
    otherPath?: string;
  }) => void;
  onClose?: () => void;
}

function renderDialog(args: RenderArgs = {}): {
  root: Root;
  container: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <InsertPagesDialog
        open={true}
        totalPages={args.totalPages ?? 5}
        pickOtherFile={args.pickOtherFile ?? (async () => null)}
        onConfirm={args.onConfirm ?? ((): void => undefined)}
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

/** Set an input's value the way a user typing would (React 19
 *  tracks the input's built-in setter, so a plain value assignment
 *  plus `input` event is the canonical test harness). */
function setInputValue(el: HTMLInputElement, value: string): void {
  act((): void => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("InsertPagesDialog — render contract", () => {
  it("renders both mode radios and the confirm button", () => {
    const { container, cleanup } = renderDialog();
    expect(container.querySelector("[data-insert-mode='blank']")).not.toBeNull();
    expect(container.querySelector("[data-insert-mode='fromPdf']")).not.toBeNull();
    expect(container.querySelector("[data-insert-confirm]")).not.toBeNull();
    cleanup();
  });

  it("seeds the position field to 'end' by default", () => {
    const { container, cleanup } = renderDialog({ totalPages: 5 });
    const position = container.querySelector<HTMLInputElement>(
      "[data-insert-position]",
    );
    expect(position?.value).toBe("6");
    cleanup();
  });

  it("disables confirm when the position is out of range", () => {
    const { container, cleanup } = renderDialog({ totalPages: 3 });
    const position = container.querySelector<HTMLInputElement>(
      "[data-insert-position]",
    );
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-insert-confirm]",
    );
    expect(position).not.toBeNull();
    expect(confirm).not.toBeNull();
    if (position === null || confirm === null) return cleanup();
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(position, "999");
      position.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(confirm.disabled).toBe(true);
    cleanup();
  });

  it("renders the size preset radios in blank mode", () => {
    const { container, cleanup } = renderDialog();
    for (const id of ["letter", "a4", "legal", "square"]) {
      expect(
        container.querySelector<HTMLInputElement>(
          `[data-insert-preset="${id}"]`,
        ),
      ).not.toBeNull();
    }
    cleanup();
  });
});

describe("InsertPagesDialog — close paths", () => {
  it("fires onClose when the backdrop is clicked (mousedown + click both on the backdrop)", () => {
    // B17 — the backdrop close requires the pointer interaction to
    // START on the backdrop (tracked via onMouseDown). A real
    // outside click is mousedown + click on the backdrop; a drag
    // that starts in the input and releases over the backdrop must
    // NOT close (covered by bugB17_backdropDragClose).
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({ onClose });
    const backdrop = container.querySelector<HTMLElement>(".modal-backdrop");
    expect(backdrop).not.toBeNull();
    if (backdrop === null) return cleanup();
    act((): void => {
      backdrop.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });
    act((): void => {
      backdrop.click();
    });
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// DEF-122 — the position value is the 1-based page number the new
// content BECOMES (rank semantics: 2 = after page 1, TotalPages+1 =
// append, "end" = append). Position 1 (before page 1) is valid in
// BOTH modes (DEF-129): blank mode maps slot 0 to the engine's -2
// PREPEND sentinel, so the new blank page becomes page 1 (pageOrder[0]
// is the new index). The dialog emits the 0-based rank slot (v - 1;
// -1 = append) and the host translates it per engine contract
// (App.tsx).
// ---------------------------------------------------------------------------
describe("InsertPagesDialog — DEF-122 position semantics", () => {
  function positionOf(container: HTMLElement): HTMLInputElement | null {
    return container.querySelector("[data-insert-position]");
  }

  function confirmOf(container: HTMLElement): HTMLButtonElement | null {
    return container.querySelector("[data-insert-confirm]");
  }

  it("blank mode accepts 1 on a non-empty doc (before page 1 — DEF-129) and confirms slot 0", () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({ totalPages: 5, onConfirm });
    const position = positionOf(container);
    const confirm = confirmOf(container);
    if (position === null || confirm === null) return cleanup();
    setInputValue(position, "1");
    // DEF-129 — position 1 is a legitimate choice in blank mode:
    // the Insert button must NOT silently disable. The host owns
    // the engine translation (slot 0 -> afterIndex -2, so the blank
    // becomes page 1 — see App.tsx onInsertPagesConfirm).
    expect(confirm.disabled).toBe(false);
    act((): void => {
      confirm.click();
    });
    // "1" -> rank slot 0 (the blank page becomes page 1).
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "blank", position: 0 }),
    );
    cleanup();
  });

  it("blank mode accepts 2 (after page 1) and confirms rank slot 1", () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({ totalPages: 5, onConfirm });
    const position = positionOf(container);
    const confirm = confirmOf(container);
    if (position === null || confirm === null) return cleanup();
    setInputValue(position, "2");
    expect(confirm.disabled).toBe(false);
    act((): void => {
      confirm.click();
    });
    // Rank slot v - 1: "2" -> slot 1 -> the blank becomes page 2.
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "blank", position: 1 }),
    );
    cleanup();
  });

  it("blank mode confirms slot 4 for value 5 (becomes page 5, between 4 and 5)", () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({ totalPages: 5, onConfirm });
    const position = positionOf(container);
    const confirm = confirmOf(container);
    if (position === null || confirm === null) return cleanup();
    setInputValue(position, "5");
    expect(confirm.disabled).toBe(false);
    act((): void => {
      confirm.click();
    });
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "blank", position: 4 }),
    );
    cleanup();
  });

  it("fromPdf mode keeps 1 = before page 1 and confirms slot 0", () => {
    const onConfirm = vi.fn();
    const pickOtherFile = async (): Promise<{ bytes: Uint8Array; path: string } | null> => ({
      bytes: new Uint8Array([1, 2, 3]),
      path: "other.pdf",
    });
    const { container, cleanup } = renderDialog({ totalPages: 5, pickOtherFile, onConfirm });
    const fromPdf = container.querySelector<HTMLInputElement>(
      "[data-insert-mode='fromPdf']",
    );
    const pick = container.querySelector<HTMLButtonElement>("[data-insert-pick]");
    const position = positionOf(container);
    const confirm = confirmOf(container);
    if (fromPdf === null || pick === null || position === null || confirm === null) {
      return cleanup();
    }
    act((): void => {
      fromPdf.click();
    });
    void act(async (): Promise<void> => {
      pick.click();
    });
    setInputValue(position, "1");
    expect(confirm.disabled).toBe(false);
    act((): void => {
      confirm.click();
    });
    // "1" -> slot 0 -> the copied pages start before page 1.
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "fromPdf", position: 0 }),
    );
    cleanup();
  });

  it("'end' still confirms position -1 (append) in blank mode", () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({ totalPages: 5, onConfirm });
    const position = positionOf(container);
    const confirm = confirmOf(container);
    if (position === null || confirm === null) return cleanup();
    setInputValue(position, "end");
    expect(confirm.disabled).toBe(false);
    act((): void => {
      confirm.click();
    });
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "blank", position: -1 }),
    );
    cleanup();
  });

  it("blank mode accepts 1 on an empty doc (the only slot) and confirms slot 0", () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({ totalPages: 0, onConfirm });
    const position = positionOf(container);
    const confirm = confirmOf(container);
    // defaultInsertPosition(0) seeds the field to "1".
    expect(position?.value).toBe("1");
    if (position === null || confirm === null) return cleanup();
    expect(confirm.disabled).toBe(false);
    act((): void => {
      confirm.click();
    });
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "blank", position: 0 }),
    );
    cleanup();
  });

  it("blank hint phrases placement as 'after page N' with 1 = before page 1 (DEF-129)", () => {
    const { container, cleanup } = renderDialog({ totalPages: 5 });
    const hint = container.querySelector<HTMLElement>(".modal-hint");
    const text = hint?.textContent ?? "";
    expect(text).toContain("1 inserts before page 1");
    expect(text).toContain("after page 1");
    expect(text).toContain("appends after the last page");
    // The DEF-114-era "cannot be inserted before page 1" caveat
    // is gone — position 1 is a valid dialog choice again.
    expect(text).not.toContain("cannot be inserted before page 1");
    cleanup();
  });

  it("fromPdf hint keeps 1 = before page 1 and '2 after page 1' wording", () => {
    const { container, cleanup } = renderDialog({ totalPages: 5 });
    const fromPdf = container.querySelector<HTMLInputElement>(
      "[data-insert-mode='fromPdf']",
    );
    if (fromPdf === null) return cleanup();
    act((): void => {
      fromPdf.click();
    });
    const hint = container.querySelector<HTMLElement>(".modal-hint");
    const text = hint?.textContent ?? "";
    expect(text).toContain("1 inserts before page 1");
    expect(text).toContain("2 after page 1");
    cleanup();
  });
});
