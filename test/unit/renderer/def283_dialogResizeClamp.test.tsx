// @vitest-environment jsdom
//
// DEF-283 — the movable print dialog must be re-clamped when the WINDOW
// resizes. The drag clamp runs only on pointermove (anchored at drag start),
// so a stored translate3d offset used to survive a window shrink and push the
// panel off-screen. This file pins:
//   1. `clampDragOffset` (pure): shrink re-clamps, each edge, smaller-than-
//      panel pins to the min edge, grow is a no-op.
//   2. The live component: a `resize` event re-clamps an already-moved dialog
//      so the panel ends inside the viewport.
//   3. The listener is registered only while open and removed on close.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

beforeEach((): void => {
  Element.prototype.setPointerCapture = function (): void {
    /* no-op */
  };
  Element.prototype.releasePointerCapture = function (): void {
    /* no-op */
  };
});

vi.mock("../../../src/renderer/pdf/printRaster", () => ({
  PRINT_DPI: 200,
  MAX_PRINT_PIXELS: 12000000,
  rasterizePagesForPrint: vi.fn(
    async (args: { pages: number[] }): Promise<Array<{ page: number; dataUrl: string; widthPx: number; heightPx: number }>> =>
      args.pages.map((p) => ({
        page: p,
        dataUrl: `data:image/png;base64,page-${p}`,
        widthPx: 612,
        heightPx: 792,
      })),
  ),
}));

import { PrintDialog } from "../../../src/renderer/components/PrintDialog";
import {
  clampDragOffset,
  type DragRect,
  type DragViewport,
} from "../../../src/renderer/components/printDialogDrag";
import type { PrinterInfo } from "../../../src/shared/types";

const PRINTERS: PrinterInfo[] = [
  { name: "HP LaserJet", displayName: "HP LaserJet", isDefault: true },
];

const RECT: DragRect = { left: 100, top: 50, right: 500, bottom: 350 };
const VIEWPORT: DragViewport = { width: 1024, height: 768 };

describe("clampDragOffset — pure re-clamp maths", () => {
  it("re-clamps a previously valid offset when the viewport shrinks", () => {
    // Moved to the far bottom-right at 1024x768, then the window shrinks.
    const moved: DragRect = { left: 624, top: 468, right: 1024, bottom: 768 };
    const next = clampDragOffset({ x: 524, y: 418 }, moved, { width: 700, height: 400 });
    expect(next).toEqual({ x: 200, y: 50 });
    // The panel's rect at the clamped offset is fully inside the viewport.
    const dx = next.x - 524;
    const dy = next.y - 418;
    expect(moved.right + dx).toBeLessThanOrEqual(700);
    expect(moved.bottom + dy).toBeLessThanOrEqual(400);
    expect(moved.left + dx).toBeGreaterThanOrEqual(0);
    expect(moved.top + dy).toBeGreaterThanOrEqual(0);
  });

it("clamps at every edge", () => {
    // Each rect is the panel's rect AT the offset passed alongside it.
    const farRect: DragRect = { left: 700, top: 550, right: 1100, bottom: 850 };
    expect(clampDragOffset({ x: 600, y: 500 }, farRect, VIEWPORT)).toEqual({
      x: VIEWPORT.width - RECT.right,
      y: VIEWPORT.height - RECT.bottom,
    });
    const nearRect: DragRect = { left: -500, top: -450, right: -100, bottom: -150 };
    expect(clampDragOffset({ x: -600, y: -500 }, nearRect, VIEWPORT)).toEqual({
      x: -RECT.left,
      y: -RECT.top,
    });
    // An offset already inside the range is left untouched.
    expect(clampDragOffset({ x: 10, y: 20 }, RECT, VIEWPORT)).toEqual({ x: 10, y: 20 });
  });

  it("pins to the min edge when the viewport is smaller than the panel", () => {
    const big: DragRect = { left: 40, top: 20, right: 640, bottom: 520 };
    const tiny: DragViewport = { width: 300, height: 300 };
    const next = clampDragOffset({ x: 0, y: 0 }, big, tiny);
    expect(next).toEqual({ x: -big.left, y: -big.top });
    expect(big.left + next.x).toBe(0);
    expect(big.top + next.y).toBe(0);
  });

it("leaves the offset alone when the viewport grows", () => {
    const small: DragViewport = { width: 700, height: 400 };
    const moved: DragRect = { left: 300, top: 50, right: 700, bottom: 350 };
    const at = { x: 200, y: 0 };
    expect(clampDragOffset(at, moved, small)).toEqual(at);
    expect(clampDragOffset(at, moved, { width: 1600, height: 1000 })).toEqual(at);
  });
});
interface Mounted {
  container: HTMLElement;
  shellOffset: () => { x: number; y: number };
  cleanup: () => void;
}

function mountOpen(onClose: () => void): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act((): void => {
    root.render(
      <PrintDialog
        open
        totalPages={3}
        currentPage={1}
        resolveActiveDoc={(): never => ({ numPages: 3 }) as never}
        listPrinters={async (): Promise<PrinterInfo[]> => PRINTERS}
        printJob={async (): Promise<{ ok: true }> => ({ ok: true })}
        onClose={onClose}
      />,
    );
  });
  return {
    container,
    shellOffset: (): { x: number; y: number } => {
      const el = container.querySelector<HTMLElement>("[data-print-dialog-shell]");
      return {
        x: Number.parseFloat(el?.getAttribute("data-drag-x") ?? "0"),
        y: Number.parseFloat(el?.getAttribute("data-drag-y") ?? "0"),
      };
    },
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 24));
  });
}

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, writable: true, configurable: true });
}

/** The dialog rect follows the shell's current drag offset. */
function stubDialogRect(container: HTMLElement): void {
  const el = container.querySelector<HTMLElement>(".modal-dialog");
  const shell = container.querySelector<HTMLElement>("[data-print-dialog-shell]");
  if (el === null) throw new Error("dialog not found");
  el.getBoundingClientRect = (): DOMRect => {
    const dx = Number.parseFloat(shell?.getAttribute("data-drag-x") ?? "0");
    const dy = Number.parseFloat(shell?.getAttribute("data-drag-y") ?? "0");
    return {
      x: RECT.left + dx,
      y: RECT.top + dy,
      left: RECT.left + dx,
      top: RECT.top + dy,
      right: RECT.right + dx,
      bottom: RECT.bottom + dy,
      width: RECT.right - RECT.left,
      height: RECT.bottom - RECT.top,
      toJSON: (): Record<string, never> => ({}),
    };
  };
}

function pointer(el: Element, type: "pointerdown" | "pointermove", x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        button: 0,
      }),
    );
  });
}

describe("PrintDialog — DEF-283 resize re-clamp", () => {
  it("re-clamps the open dialog when the window shrinks", async () => {
    setViewport(1024, 768);
    const m = mountOpen((): void => undefined);
    await flush();
    try {
      stubDialogRect(m.container);
      const header = m.container.querySelector<HTMLElement>("[data-print-drag-handle]");
      if (header === null) throw new Error("header not found");
      pointer(header, "pointerdown", 400, 300);
      pointer(header, "pointermove", 99999, 99999);
      expect(m.shellOffset()).toEqual({ x: 1024 - RECT.right, y: 768 - RECT.bottom });

      setViewport(700, 400);
      act((): void => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(m.shellOffset()).toEqual({ x: 200, y: 50 });
      const at = m.shellOffset();
      expect(RECT.right + at.x).toBeLessThanOrEqual(window.innerWidth);
      expect(RECT.bottom + at.y).toBeLessThanOrEqual(window.innerHeight);
      expect(RECT.left + at.x).toBeGreaterThanOrEqual(0);
      expect(RECT.top + at.y).toBeGreaterThanOrEqual(0);
    } finally {
      m.cleanup();
      setViewport(1024, 768);
    }
  });

  it("removes the resize listener when the dialog closes", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const m = mountOpen((): void => undefined);
    await flush();
    const added = add.mock.calls.filter((c) => c[0] === "resize").length;
    expect(added).toBe(1);
    m.cleanup();
    const removed = remove.mock.calls.filter((c) => c[0] === "resize").length;
    expect(removed).toBe(1);
    add.mockRestore();
    remove.mockRestore();
  });
});
