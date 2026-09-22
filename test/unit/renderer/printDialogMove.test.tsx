// @vitest-environment jsdom
//
// Phase 33 item 1 — the print dialog is movable by its header.
//
// Contract pinned here:
//   1. Pure clamp maths: the dialog offset range keeps the panel fully
//      inside the viewport at BOTH extremes (and pins to the min edge when
//      the dialog is larger than the viewport).
//   2. A header drag writes a translate3d on the shell (no layout) and the
//      dialog stays inside the viewport at every extreme.
//   3. A press on a control (the close button) never starts a drag and the
//      control's own click still fires.
//   4. Dragging the header does NOT trigger backdrop-close; a real backdrop
//      click still does.
//   5. Reopening the dialog resets it to the default (centred) position.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, beforeEach, expect, it, vi } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

// jsdom has no pointer-capture implementation; the dialog uses it for the
// header drag, so a no-op stand-in keeps the handlers exercisable.
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
  dialogDragRange,
  dialogRectAt,
  nextDragOffset,
  type DragAnchor,
} from "../../../src/renderer/components/printDialogDrag";
import type { PrinterInfo } from "../../../src/shared/types";

const PRINTERS: PrinterInfo[] = [
  { name: "HP LaserJet", displayName: "HP LaserJet", isDefault: true },
];

/** The dialog rect used in every component/maths test. */
const RECT = { left: 100, top: 50, right: 500, bottom: 350 };
const VIEWPORT = { width: 1024, height: 768 };
const anchor: DragAnchor = {
  offset: { x: 0, y: 0 },
  rect: RECT,
  pointer: { x: 400, y: 300 },
  viewport: VIEWPORT,
};

describe("printDialogDrag — pure clamp maths", () => {
  it("derives the offset range that keeps the dialog inside the viewport", () => {
    expect(dialogDragRange(anchor)).toEqual({ minX: -100, maxX: 524, minY: -50, maxY: 418 });
  });

  it("follows the pointer and clamps at both extremes", () => {
    expect(nextDragOffset(anchor, 500, 350)).toEqual({ x: 100, y: 50 });
    expect(nextDragOffset(anchor, 99999, 99999)).toEqual({ x: 524, y: 418 });
    expect(nextDragOffset(anchor, -99999, -99999)).toEqual({ x: -100, y: -50 });
  });

  it("keeps the resulting dialog rect inside the viewport", () => {
    const far = nextDragOffset(anchor, 99999, 99999);
    const r1 = dialogRectAt(anchor, far);
    expect(r1.left).toBeGreaterThanOrEqual(0);
    expect(r1.top).toBeGreaterThanOrEqual(0);
    expect(r1.right).toBeLessThanOrEqual(VIEWPORT.width);
    expect(r1.bottom).toBeLessThanOrEqual(VIEWPORT.height);
    const near = dialogRectAt(anchor, nextDragOffset(anchor, -99999, -99999));
    expect(near.left).toBe(0);
    expect(near.top).toBe(0);
  });

  it("pins to the min edge when the dialog is larger than the viewport", () => {
    const big: DragAnchor = {
      offset: { x: 0, y: 0 },
      rect: { left: -50, top: -30, right: 1200, bottom: 900 },
      pointer: { x: 0, y: 0 },
      viewport: VIEWPORT,
    };
    const range = dialogDragRange(big);
    expect(range.maxX).toBe(range.minX);
    expect(range.maxY).toBe(range.minY);
    expect(nextDragOffset(big, 99999, 99999)).toEqual({ x: range.minX, y: range.minY });
  });
});

interface Mounted {
  container: HTMLElement;
  shell: () => HTMLElement;
  header: () => HTMLElement;
  offset: () => { x: number; y: number };
  cleanup: () => void;
}

function dialogProps(onClose: () => void) {
  return {
    totalPages: 3,
    currentPage: 1,
    resolveActiveDoc: (): never => ({ numPages: 3 }) as never,
    listPrinters: async (): Promise<PrinterInfo[]> => PRINTERS,
    printJob: async (): Promise<{ ok: true }> => ({ ok: true }),
    onClose,
  };
}

function mountOpen(): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act((): void => {
    root.render(<PrintDialog open {...dialogProps((): void => undefined)} />);
  });
  return mountedFrom(container, root);
}

function mountedFrom(container: HTMLElement, root: Root): Mounted {
  return {
    container,
    shell: (): HTMLElement => {
      const el = container.querySelector<HTMLElement>("[data-print-dialog-shell]");
      if (el === null) throw new Error("shell not found");
      return el;
    },
    header: (): HTMLElement => {
      const el = container.querySelector<HTMLElement>("[data-print-drag-handle]");
      if (el === null) throw new Error("header not found");
      return el;
    },
    offset: (): { x: number; y: number } => {
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

function stubDialogRect(container: HTMLElement): void {
  const el = container.querySelector<HTMLElement>(".modal-dialog");
  if (el === null) throw new Error("dialog not found");
  el.getBoundingClientRect = (): DOMRect => ({
    x: RECT.left,
    y: RECT.top,
    left: RECT.left,
    top: RECT.top,
    right: RECT.right,
    bottom: RECT.bottom,
    width: RECT.right - RECT.left,
    height: RECT.bottom - RECT.top,
    toJSON: (): Record<string, never> => ({}),
  });
}

function pointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): void {
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
/** Mount with a specific onClose so backdrop/close behaviour is observable. */
function mountWith(onClose: () => void): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act((): void => {
    root.render(<PrintDialog open {...dialogProps(onClose)} />);
  });
  return mountedFrom(container, root);
}

/** Mount with an `open` prop the test can toggle (reopen reset). */
function mountControllable(): Mounted & { setOpen: (v: boolean) => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let apply: (v: boolean) => void = (): void => undefined;
  function Harness() {
    const [open, setOpen] = useState(true);
    useEffect((): void => {
      apply = setOpen;
    }, []);
    return <PrintDialog open={open} {...dialogProps((): void => undefined)} />;
  }
  act((): void => {
    root.render(<Harness />);
  });
  return {
    ...mountedFrom(container, root),
    setOpen: (v: boolean): void => {
      act((): void => apply(v));
    },
  };
}

describe("PrintDialog � movable by its header (Phase 33 item 1)", () => {
  it("exposes a visible drag affordance on the header", async () => {
    const m = mountOpen();
    await flush();
    try {
      expect(m.header().className).toContain("modal-header-draggable");
      expect(m.container.querySelector(".print-drag-grip")).not.toBeNull();
      expect(m.container.querySelector("[data-print-drag-handle]")).toBe(
        m.container.querySelector(".modal-header"),
      );
    } finally {
      m.cleanup();
    }
  });

  it("moves the shell via a transform and clamps at every extreme", async () => {
    const m = mountOpen();
    await flush();
    try {
      stubDialogRect(m.container);
      expect(m.shell().style.transform).toBe("translate3d(0px, 0px, 0)");

      pointer(m.header(), "pointerdown", 400, 300);
      pointer(m.header(), "pointermove", 500, 350);
      expect(m.offset()).toEqual({ x: 100, y: 50 });
      expect(m.shell().style.transform).toBe("translate3d(100px, 50px, 0)");

      // Far bottom-right: the panel's right/bottom edges reach the
      // viewport edges and no further.
      pointer(m.header(), "pointermove", 99999, 99999);
      const far = m.offset();
      expect(far).toEqual({
        x: window.innerWidth - RECT.right,
        y: window.innerHeight - RECT.bottom,
      });
      expect(RECT.right + far.x).toBeLessThanOrEqual(window.innerWidth);
      expect(RECT.bottom + far.y).toBeLessThanOrEqual(window.innerHeight);

      // Far top-left: the panel's left/top edges reach 0.
      pointer(m.header(), "pointermove", -99999, -99999);
      expect(m.offset()).toEqual({ x: -RECT.left, y: -RECT.top });
      expect(RECT.left + m.offset().x).toBe(0);
      expect(RECT.top + m.offset().y).toBe(0);

      // Released: further moves no longer move the dialog.
      pointer(m.header(), "pointerup", -99999, -99999);
      pointer(m.header(), "pointermove", 400, 300);
      expect(m.offset()).toEqual({ x: -RECT.left, y: -RECT.top });
    } finally {
      m.cleanup();
    }
  });

  it("a press on the close button never starts a drag and its click still fires", async () => {
    const onClose = vi.fn();
    const m = mountWith(onClose);
    await flush();
    try {
      stubDialogRect(m.container);
      const close = m.container.querySelector<HTMLButtonElement>(".modal-close");
      expect(close).not.toBeNull();
      if (close === null) return;
      pointer(close, "pointerdown", 400, 300);
      pointer(m.header(), "pointermove", 600, 500);
      expect(m.offset()).toEqual({ x: 0, y: 0 });
      act((): void => {
        close.click();
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      m.cleanup();
    }
  });

  it("a real backdrop click closes; a header drag that releases outside does not", async () => {
    const onClose = vi.fn();
    const m = mountWith(onClose);
    await flush();
    try {
      stubDialogRect(m.container);
      const backdrop = m.container.querySelector<HTMLElement>(".modal-backdrop");
      expect(backdrop).not.toBeNull();
      if (backdrop === null) return;

      // A header interaction: the mousedown starts INSIDE the dialog, so
      // the backdrop's own press guard records "not started on me".
      act((): void => {
        m.header().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      });
      pointer(m.header(), "pointerdown", 400, 300);
      pointer(m.header(), "pointermove", 460, 340);
      expect(m.offset()).toEqual({ x: 60, y: 40 });
      act((): void => {
        backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onClose).not.toHaveBeenCalled();

      // A genuine outside click (press AND release on the backdrop) closes.
      act((): void => {
        backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      });
      act((): void => {
        backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      m.cleanup();
    }
  });

  it("reopening the dialog resets it to the default centred position", async () => {
    const m = mountControllable();
    await flush();
    try {
      stubDialogRect(m.container);
      pointer(m.header(), "pointerdown", 400, 300);
      pointer(m.header(), "pointermove", 480, 360);
      expect(m.offset()).toEqual({ x: 80, y: 60 });

      m.setOpen(false);
      await flush();
      m.setOpen(true);
      await flush();
      expect(m.offset()).toEqual({ x: 0, y: 0 });
      expect(m.shell().style.transform).toBe("translate3d(0px, 0px, 0)");
    } finally {
      m.cleanup();
    }
  });
});
