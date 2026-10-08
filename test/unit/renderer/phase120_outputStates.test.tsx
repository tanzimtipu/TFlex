// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so that
// `act` recognises the test env.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Phase 120 C - the shared preview path goes through the rasteriser (jsdom has
// no canvas backend). The preview raster (carrying a `dpi`) always resolves;
// the print-job raster (no `dpi`) can be HELD so an in-flight abort is
// observable. It honours the run's AbortSignal, exactly like the real helper.
const raster = vi.hoisted(() => ({ holdJobRaster: false }));

vi.mock("../../../src/renderer/pdf/printRaster", () => ({
  PRINT_DPI: 200,
  MAX_PRINT_PIXELS: 12000000,
  rasterizePagesForPrint: (args: {
    pages: number[];
    dpi?: number;
    signal?: AbortSignal;
    onProgress?: (page: number) => void;
  }): Promise<Array<{ page: number; dataUrl: string; widthPx: number; heightPx: number }>> => {
    const result = args.pages.map((p) => ({
      page: p,
      dataUrl: `data:image/png;base64,page-${p}`,
      widthPx: 612,
      heightPx: 792,
    }));
    const hold = args.dpi === undefined && raster.holdJobRaster;
    if (!hold) {
      for (const p of args.pages) args.onProgress?.(p);
      return Promise.resolve(result);
    }
    return new Promise((resolve) => {
      const signal = args.signal;
      if (signal === undefined) {
        resolve(result);
        return;
      }
      const finish = (): void => resolve(result);
      if (signal.aborted) finish();
      else signal.addEventListener("abort", finish, { once: true });
    });
  },
}));

import { PrintSurface } from "./printSurfaceHarness";
import type { PrintJobPayload, PrintJobResult, PrinterInfo } from "../../../src/shared/types";

/**
 * Phase 120 C - consequence summary and the truthful execution / cancellation /
 * failure / completion states. Every state is driven from the REAL
 * `usePrintControls` values through the shared surface; nothing is re-derived.
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

interface RenderArgs {
  totalPages?: number;
  printJob?: (payload: PrintJobPayload) => Promise<PrintJobResult>;
  onClose?: () => void;
}

function renderSurface(args: RenderArgs = {}): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const totalPages = args.totalPages ?? 3;
  act((): void => {
    root.render(
      <PrintSurface
        active
        totalPages={totalPages}
        currentPage={1}
        resolveActiveDoc={(): never => fakeDocProxy(totalPages) as never}
        listPrinters={async (): Promise<PrinterInfo[]> => PRINTERS}
        printJob={args.printJob ?? (async (): Promise<PrintJobResult> => ({ ok: true }))}
        onClose={args.onClose ?? ((): void => undefined)}
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

async function clickPrint(container: HTMLElement): Promise<void> {
  const confirm = container.querySelector<HTMLButtonElement>("[data-print-confirm]");
  expect(confirm).not.toBeNull();
  await act(async (): Promise<void> => {
    confirm?.click();
    await flush();
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

function clickLabelFor(container: HTMLElement, selector: string): void {
  const input = container.querySelector<HTMLInputElement>(selector);
  expect(input).not.toBeNull();
  if (input === null) return;
  const label = input.closest("label");
  act((): void => {
    (label ?? input).click();
  });
}

afterEach((): void => {
  raster.holdJobRaster = false;
  document.body.innerHTML = "";
});

describe("Phase 120 C - consequence summary before execution", () => {
  it("states the selected pages, the real destination and the format", async () => {
    const { container, cleanup } = renderSurface();
    await flush();
    expect(container.querySelector("[data-print-summary]")).not.toBeNull();
    expect(container.querySelector("[data-print-summary-pages]")?.textContent).toContain("1-3 of 3");
    expect(container.querySelector("[data-print-summary-destination]")?.textContent).toContain(
      "HP LaserJet",
    );
    expect(container.querySelector("[data-print-summary-format]")?.textContent).toContain(
      "Print job",
    );
    expect(container.querySelector("[data-print-summary-note]")).toBeNull();
    cleanup();
  });

  it("names the PDF-file destination and PDF format for a virtual destination", async () => {
    const { container, cleanup } = renderSurface();
    await flush();
    setValue(container, "[data-print-printer]", "Microsoft Print to PDF");
    await flush();
    expect(container.querySelector("[data-print-summary-destination]")?.textContent).toContain(
      "PDF file",
    );
    expect(container.querySelector("[data-print-summary-format]")?.textContent).toContain("PDF");
    expect(container.querySelector("[data-print-summary-note]")).not.toBeNull();
    cleanup();
  });

  it("shows the selection error in place of a page count when the range is invalid", async () => {
    const { container, cleanup } = renderSurface();
    await flush();
    clickLabelFor(container, "[data-print-range-custom]");
    setValue(container, "[data-print-range-input]", "9-3");
    const summaryPages = container.querySelector<HTMLElement>("[data-print-summary-pages]");
    expect(summaryPages?.textContent).toMatch(/reversed/i);
    cleanup();
  });

  it("discloses the duplicate merge when the active custom range repeats a page", async () => {
    const { container, cleanup } = renderSurface({ totalPages: 3 });
    await flush();
    clickLabelFor(container, "[data-print-range-custom]");
    setValue(container, "[data-print-range-input]", "1,1,3");
    await flush();
    const summaryPages = container.querySelector<HTMLElement>("[data-print-summary-pages]");
    expect(summaryPages?.textContent).toContain("1, 3 of 3");
    expect(summaryPages?.textContent).toContain("(duplicate page numbers merged)");
    cleanup();
  });

  it("keeps the plain pages summary when the custom range has no duplicate", async () => {
    const { container, cleanup } = renderSurface({ totalPages: 3 });
    await flush();
    clickLabelFor(container, "[data-print-range-custom]");
    setValue(container, "[data-print-range-input]", "1,3");
    await flush();
    const summaryPages = container.querySelector<HTMLElement>("[data-print-summary-pages]");
    expect(summaryPages?.textContent).toContain("1, 3 of 3");
    expect(summaryPages?.textContent).not.toContain("(duplicate page numbers merged)");
    cleanup();
  });
});

describe("Phase 120 C - truthful execution / completion states", () => {
  it("shows the saved state for a persisted file (outcome: saved)", async () => {
    const { container, cleanup } = renderSurface({
      printJob: async (): Promise<PrintJobResult> => ({
        ok: true,
        outcome: "saved",
        path: "C:\\out\\report.pdf",
      }),
    });
    await flush();
    await clickPrint(container);
    const success = container.querySelector<HTMLElement>("[data-print-success]");
    expect(success?.textContent).toContain("Saved to C:\\out\\report.pdf");
    expect(container.querySelector("[data-print-error]")).toBeNull();
    cleanup();
  });

  it("shows the accepted-job state for outcome: printed and never claims a file was saved", async () => {
    const { container, cleanup } = renderSurface({
      printJob: async (): Promise<PrintJobResult> => ({ ok: true, outcome: "printed" }),
    });
    await flush();
    await clickPrint(container);
    const success = container.querySelector<HTMLElement>("[data-print-success]");
    expect(success?.textContent).toContain("Sent 3 pages to HP LaserJet.");
    expect(success?.textContent).not.toContain("Saved");
    cleanup();
  });

  it("stays a quiet no-op on save-cancelled (no banner of either kind)", async () => {
    const { container, cleanup } = renderSurface({
      printJob: async (): Promise<PrintJobResult> => ({ ok: false, reason: "save-cancelled" }),
    });
    await flush();
    await clickPrint(container);
    expect(container.querySelector("[data-print-error]")).toBeNull();
    expect(container.querySelector("[data-print-success]")).toBeNull();
    cleanup();
  });

  it("surfaces a typed failure, keeps the settings and offers the primary-action retry", async () => {
    const { container, cleanup } = renderSurface({
      printJob: async (): Promise<PrintJobResult> => ({ ok: false, reason: "print-timeout" }),
    });
    await flush();
    setValue(container, "[data-print-copies]", "3");
    await clickPrint(container);
    const error = container.querySelector<HTMLElement>("[data-print-error]");
    expect(error?.textContent).toContain("timed out");
    // The settings are retained after a failure.
    expect(container.querySelector<HTMLInputElement>("[data-print-copies]")?.value).toBe("3");
    expect(container.querySelector("[data-print-retry-hint]")).not.toBeNull();
    // The ONE primary action is still available as the retry path.
    expect(container.querySelector<HTMLButtonElement>("[data-print-confirm]")?.disabled).toBe(false);
    cleanup();
  });
});

describe("Phase 120 C - cancellation", () => {
  it("aborts an in-flight run on Cancel without closing the surface or the document", async () => {
    raster.holdJobRaster = true;
    const printJob = vi.fn(async (): Promise<PrintJobResult> => ({ ok: true }));
    const onClose = vi.fn();
    const { container, cleanup } = renderSurface({ printJob, onClose });
    await flush();
    await clickPrint(container);
    expect(container.querySelector("[data-print-progress]")).not.toBeNull();
    const cancel = container.querySelector<HTMLButtonElement>("[data-print-cancel]");
    expect(cancel?.textContent).toBe("Cancel");

    await act(async (): Promise<void> => {
      cancel?.click();
      await flush();
    });

    expect(printJob).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector("[data-print-error]")).toBeNull();
    expect(container.querySelector("[data-print-success]")).toBeNull();
    expect(container.querySelector("[data-print-progress]")).toBeNull();
    cleanup();
  });
});
