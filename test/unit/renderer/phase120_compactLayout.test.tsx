// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../../../src/renderer/pdf/printRaster", () => ({
  PRINT_DPI: 200,
  MAX_PRINT_PIXELS: 12000000,
  rasterizePagesForPrint: vi.fn(async (args: {
    pages: number[];
    onProgress?: (page: number) => void;
  }): Promise<Array<{ page: number; dataUrl: string; widthPx: number; heightPx: number }>> => {
    for (const p of args.pages) args.onProgress?.(p);
    return args.pages.map((p) => ({
      page: p,
      dataUrl: `data:image/png;base64,page-${p}`,
      widthPx: 612,
      heightPx: 792,
    }));
  }),
}));

import { PrintSurface } from "./printSurfaceHarness";
import { PRINT_OUTPUT_BREAKPOINT_PX } from "../../../src/renderer/components/PrintPanel";
import type {
  PrintJobResult,
  PrinterInfo,
} from "../../../src/shared/types";

/**
 * Phase 120 B - the compact Output Studio layout. ONE declared logical-pixel
 * threshold (PRINT_OUTPUT_BREAKPOINT_PX, mirrors --tf-break-compact) switches
 * the SAME surface between the two-column studio and the stacked compact form.
 * Advanced groups collapse but their controls stay in the DOM and reachable.
 */

const PRINTERS: PrinterInfo[] = [
  { name: "HP LaserJet", displayName: "HP LaserJet", isDefault: true },
];

function fakeDocProxy(numPages: number): unknown {
  return {
    numPages,
    getPage: async (): Promise<unknown> => ({}),
    destroy: async (): Promise<unknown> => undefined,
  };
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

function setValue(container: HTMLElement, selector: string, value: string): void {
  const el = container.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  expect(el, selector).not.toBeNull();
  if (el === null) return;
  act((): void => {
    const setter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLSelectElement
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const ORIGINAL_WIDTH = window.innerWidth;

afterEach((): void => {
  setViewportWidth(ORIGINAL_WIDTH);
  document.body.innerHTML = "";
});

function renderSurface(totalPages = 6): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act((): void => {
    root.render(
      <PrintSurface
        active
        totalPages={totalPages}
        currentPage={1}
        resolveActiveDoc={(): never => fakeDocProxy(totalPages) as never}
        listPrinters={async (): Promise<PrinterInfo[]> => PRINTERS}
        printJob={async (): Promise<PrintJobResult> => ({ ok: true })}
        onClose={(): void => undefined}
      />,
    );
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

describe("Phase 120 B - compact Output Studio layout", () => {
  it("declares a single breakpoint and renders wide at or above it", async () => {
    expect(PRINT_OUTPUT_BREAKPOINT_PX).toBe(720);
    setViewportWidth(PRINT_OUTPUT_BREAKPOINT_PX);
    const { container, cleanup } = renderSurface();
    await flush();
    expect(container.querySelector("[data-print-layout-mode]")?.getAttribute(
      "data-print-layout-mode",
    )).toBe("wide");
    cleanup();
  });

  it("switches to the stacked compact form below the breakpoint", async () => {
    setViewportWidth(1024);
    const { container, cleanup } = renderSurface();
    await flush();
    expect(container.querySelector("[data-print-layout-mode]")?.getAttribute(
      "data-print-layout-mode",
    )).toBe("wide");

    setViewportWidth(PRINT_OUTPUT_BREAKPOINT_PX - 1);
    await act(async (): Promise<void> => {
      window.dispatchEvent(new Event("resize"));
      await flush();
    });
    expect(container.querySelector("[data-print-layout-mode]")?.getAttribute(
      "data-print-layout-mode",
    )).toBe("compact");
    cleanup();
  });

  it("keeps Booklet and Poster options reachable in the compact form", async () => {
    setViewportWidth(500);
    const { container, cleanup } = renderSurface(6);
    await flush();
    expect(container.querySelector("[data-print-layout-mode]")?.getAttribute(
      "data-print-layout-mode",
    )).toBe("compact");

    setValue(container, "[data-print-layout]", "booklet");
    await flush();
    expect(container.querySelector("[data-print-group='booklet']")).not.toBeNull();
    expect(container.querySelector("[data-print-booklet-gutter]")).not.toBeNull();
    expect(container.querySelector("[data-print-booklet-creep]")).not.toBeNull();
    expect(container.querySelector("[data-print-booklet-subset]")).not.toBeNull();

    setValue(container, "[data-print-layout]", "poster");
    await flush();
    expect(container.querySelector("[data-print-group='poster']")).not.toBeNull();
    for (const selector of [
      "[data-print-poster-rows]",
      "[data-print-poster-cols]",
      "[data-print-poster-overlap]",
      "[data-print-poster-scale]",
      "[data-print-poster-cut-marks]",
    ]) {
      expect(container.querySelector(selector), selector).not.toBeNull();
    }
    cleanup();
  });

  it("collapses the advanced groups in compact and reopens them when wide", async () => {
    setViewportWidth(500);
    const { container, cleanup } = renderSurface(6);
    await flush();
    setValue(container, "[data-print-layout]", "booklet");
    await flush();
    const booklet = container.querySelector<HTMLDetailsElement>("[data-print-group='booklet']");
    expect(booklet?.dataset.printGroupAdvanced).toBe("true");
    expect(booklet?.hasAttribute("data-print-group-advanced")).toBe(true);
    expect(booklet?.open).toBe(false);

    setViewportWidth(1024);
    await act(async (): Promise<void> => {
      window.dispatchEvent(new Event("resize"));
      await flush();
    });
    expect(container.querySelector<HTMLDetailsElement>("[data-print-group='booklet']")?.open).toBe(
      true,
    );
    cleanup();
  });
});
