// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so `act`
// recognises the test env.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// jsdom has no canvas backend; the shared preview path goes through this
// rasteriser. One tiny PNG data URL per requested page, as the real helper.
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
import type {
  PrintJobResult,
  PrinterInfo,
} from "../../../src/shared/types";

/**
 * Phase 120 B - the Output Studio surface. The dedicated print window renders
 * the shared `PrintPanel` grouped into Destination / Pages / Layout /
 * Appearance with a neutral preview stage. These specs pin the studio chrome,
 * the "Print" primary action, every `data-print-*` control from the phase
 * CONTROL-INDEX, the representative handlers and the real preview counts.
 */

const PRINTERS: PrinterInfo[] = [
  { name: "HP LaserJet", displayName: "HP LaserJet", isDefault: true },
  { name: "Microsoft Print to PDF", displayName: "Microsoft Print to PDF", isDefault: false },
];

function fakeDocProxy(numPages: number): unknown {
  return {
    numPages,
    getPage: async (): Promise<unknown> => ({}),
    destroy: async (): Promise<unknown> => undefined,
  };
}

interface Rendered {
  container: HTMLElement;
  cleanup: () => void;
}

function renderSurface(totalPages = 3): Rendered {
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

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

function clickLabelFor(container: HTMLElement, selector: string): void {
  const input = container.querySelector<HTMLInputElement>(selector);
  expect(input).not.toBeNull();
  if (input === null) return;
  const label = input.closest("label");
  act((): void => {
    (label ?? input).click();
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

afterEach((): void => {
  document.body.innerHTML = "";
});

describe("Phase 120 B - Output Studio surface", () => {
  it("renders the four semantic groups, the Print action and the real preview stage", async () => {
    const { container, cleanup } = renderSurface();
    await flush();
    for (const group of ["destination", "pages", "layout", "appearance"]) {
      expect(container.querySelector(`[data-print-group="${group}"]`), group).not.toBeNull();
    }
    expect(container.querySelector("[data-print-preview-stage], .print-preview-stage")).not.toBeNull();
    const confirm = container.querySelector<HTMLButtonElement>("[data-print-confirm]");
    expect(confirm?.textContent).toBe("Print");
    expect(container.querySelector<HTMLButtonElement>("[data-print-cancel]")?.textContent).toBe(
      "Close",
    );
    cleanup();
  });

  it("keeps every data-print-* control from the phase CONTROL-INDEX", async () => {
    const { container, cleanup } = renderSurface();
    await flush();
    const selectors = [
      "[data-print-preset]",
      "[data-print-preset-name]",
      "[data-print-preset-save]",
      "[data-print-preset-delete]",
      "[data-print-printer]",
      "[data-print-layout]",
      "[data-print-nup]",
      "[data-print-page-order]",
      "[data-print-copies]",
      "[data-print-collate]",
      "[data-print-range-all]",
      "[data-print-range-current]",
      "[data-print-range-custom]",
      "[data-print-range-input]",
      "[data-print-scale-fit]",
      "[data-print-scale-actual]",
      "[data-print-scale-shrink]",
      "[data-print-scale-custom]",
      "[data-print-scale-percent]",
      "[data-print-orientation-auto]",
      "[data-print-orientation-portrait]",
      "[data-print-orientation-landscape]",
      "[data-print-duplex]",
      "[data-print-color]",
      "[data-print-odd-even]",
      "[data-print-reverse]",
      "[data-print-annotations]",
      "[data-print-confirm]",
      "[data-print-cancel]",
      "[data-print-preview]",
      "[data-print-preview-sheet]",
      "[data-print-preview-cell]",
      "[data-print-preview-meta]",
    ];
    for (const selector of selectors) {
      expect(container.querySelector(selector), selector).not.toBeNull();
    }
    cleanup();
  });

  it("still fires the representative handlers (printer, range, scale, N-up, annotations)", async () => {
    const { container, cleanup } = renderSurface();
    await flush();

    setValue(container, "[data-print-printer]", "Microsoft Print to PDF");
    expect(container.querySelector<HTMLSelectElement>("[data-print-printer]")?.value).toBe(
      "Microsoft Print to PDF",
    );

    clickLabelFor(container, "[data-print-range-custom]");
    setValue(container, "[data-print-range-input]", "1-2");
    expect(container.querySelector<HTMLInputElement>("[data-print-range-input]")?.value).toBe("1-2");

    clickLabelFor(container, "[data-print-scale-custom]");
    const percent = container.querySelector<HTMLInputElement>("[data-print-scale-percent]");
    expect(percent?.disabled).toBe(false);
    setValue(container, "[data-print-scale-percent]", "150");
    expect(percent?.value).toBe("150");

    setValue(container, "[data-print-nup]", "4");
    expect(container.querySelector<HTMLSelectElement>("[data-print-nup]")?.value).toBe("4");

    const ann = container.querySelector<HTMLInputElement>("[data-print-annotations]");
    expect(ann?.checked).toBe(true);
    act((): void => {
      ann?.click();
    });
    expect(ann?.checked).toBe(false);
    cleanup();
  });

  it("drives the preview sheet and meta from the real page geometry", async () => {
    const { container, cleanup } = renderSurface(3);
    await flush();
    // Single / N-up: one preview sheet for the first sheet, real page count in
    // the meta ("3 pages · 3 sheets" for 3 one-up pages).
    expect(container.querySelectorAll("[data-print-preview-sheet]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-print-preview-cell]")).toHaveLength(1);
    const meta = container.querySelector<HTMLElement>("[data-print-preview-meta]");
    expect(meta?.textContent).toBe("3 pages · 3 sheets");

    // Booklet swaps in the real saddle-stitch sides (3 pages pad to 4 -> 2).
    setValue(container, "[data-print-layout]", "booklet");
    await flush();
    expect(container.querySelectorAll("[data-print-preview-sheet]")).toHaveLength(2);
    expect(container.querySelector<HTMLElement>("[data-print-preview-meta]")?.textContent).toBe(
      "3 pages · 2 sides",
    );
    cleanup();
  });

  it("exposes the booklet and poster option groups when their layout is chosen", async () => {
    const { container, cleanup } = renderSurface(6);
    await flush();
    setValue(container, "[data-print-layout]", "booklet");
    await flush();
    for (const selector of [
      "[data-print-booklet-gutter]",
      "[data-print-booklet-creep]",
      "[data-print-booklet-subset]",
    ]) {
      expect(container.querySelector(selector), selector).not.toBeNull();
    }
    setValue(container, "[data-print-layout]", "poster");
    await flush();
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
});
