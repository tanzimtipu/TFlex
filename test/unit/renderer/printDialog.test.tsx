// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so that
// `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Mock the print rasteriser: jsdom has no canvas backend. The mock returns
// one tiny PNG data URL per requested page and mirrors the real helper's
// per-page progress callback.
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

import { PrintDialog } from "../../../src/renderer/components/PrintDialog";
import { rasterizePagesForPrint } from "../../../src/renderer/pdf/printRaster";
import type {
  PrintJobPayload,
  PrintJobResult,
  PrinterInfo,
} from "../../../src/shared/types";

/**
 * Phase 30 — print dialog rendering tests. Pins the control surface (every
 * `data-print-*` selector), the no-printer empty state, the run-state
 * disabling, the custom-range validation message, and that the
 * annotations toggle reaches the outgoing PrintSettings.
 */

const PRINTERS: PrinterInfo[] = [
  { name: "HP LaserJet", displayName: "HP LaserJet", isDefault: true },
  { name: "Microsoft Print to PDF", displayName: "Microsoft Print to PDF", isDefault: false },
];

interface RenderArgs {
  totalPages?: number;
  currentPage?: number;
  listPrinters?: () => Promise<PrinterInfo[]>;
  printJob?: (payload: PrintJobPayload) => Promise<PrintJobResult>;
  onClose?: () => void;
}

function fakeDocProxy(numPages: number): unknown {
  return { numPages, getPage: async (): Promise<unknown> => ({}), destroy: async (): Promise<unknown> => undefined };
}

function renderDialog(args: RenderArgs = {}): {
  container: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const listPrinters = args.listPrinters ?? (async (): Promise<PrinterInfo[]> => PRINTERS);
  const printJob = args.printJob ?? (async (): Promise<PrintJobResult> => ({ ok: true }));
  act((): void => {
    root.render(
      <PrintDialog
        open={true}
        totalPages={args.totalPages ?? 3}
        currentPage={args.currentPage ?? 1}
        resolveActiveDoc={(): never => fakeDocProxy(args.totalPages ?? 3) as never}
        listPrinters={listPrinters}
        printJob={printJob}
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

/** Flush pending microtasks for the printer load + preview raster. */
async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
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

function setValue(
  container: HTMLElement,
  selector: string,
  value: string,
): void {
  const el = container.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  expect(el).not.toBeNull();
  if (el === null) return;
  act((): void => {
    const setter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("PrintDialog — control surface (Phase 30)", () => {
  it("renders every promised control with its data-print-* selector", async () => {
    const { container, cleanup } = renderDialog();
    await flush();
    const selectors = [
      "[data-print-printer]",
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
      "[data-print-nup]",
      "[data-print-page-order]",
      "[data-print-odd-even]",
      "[data-print-reverse]",
      "[data-print-annotations]",
      "[data-print-confirm]",
      "[data-print-cancel]",
      "[data-print-preview]",
    ];
    for (const selector of selectors) {
      expect(container.querySelector(selector), selector).not.toBeNull();
    }
    cleanup();
  });

  it("preselects the system default printer", async () => {
    const { container, cleanup } = renderDialog();
    await flush();
    const select = container.querySelector<HTMLSelectElement>("[data-print-printer]");
    expect(select?.value).toBe("HP LaserJet");
    cleanup();
  });

  it("disables the custom scale percent unless scaling is custom", async () => {
    const { container, cleanup } = renderDialog();
    await flush();
    const percent = container.querySelector<HTMLInputElement>("[data-print-scale-percent]");
    expect(percent?.disabled).toBe(true);
    clickLabelFor(container, "[data-print-scale-custom]");
    expect(percent?.disabled).toBe(false);
    cleanup();
  });

  it("disables collate when copies is 1", async () => {
    const { container, cleanup } = renderDialog();
    await flush();
    const collate = container.querySelector<HTMLInputElement>("[data-print-collate]");
    expect(collate?.disabled).toBe(true);
    setValue(container, "[data-print-copies]", "3");
    expect(collate?.disabled).toBe(false);
    cleanup();
  });
});

describe("PrintDialog — no printer (Phase 30)", () => {
  it("shows the empty state and disables Print", async () => {
    const { container, cleanup } = renderDialog({
      listPrinters: async (): Promise<PrinterInfo[]> => [],
    });
    await flush();
    expect(container.querySelector("[data-print-empty]")).not.toBeNull();
    const confirm = container.querySelector<HTMLButtonElement>("[data-print-confirm]");
    expect(confirm?.disabled).toBe(true);
    cleanup();
  });
});

describe("PrintDialog — range validation (Phase 30)", () => {
  it("shows the range error for a malformed custom range and disables Print", async () => {
    const { container, cleanup } = renderDialog();
    await flush();
    clickLabelFor(container, "[data-print-range-custom]");
    setValue(container, "[data-print-range-input]", "9-3");
    const error = container.querySelector<HTMLElement>("[data-print-range-error]");
    expect(error).not.toBeNull();
    expect(error?.textContent).toMatch(/reversed/);
    expect(container.querySelector<HTMLButtonElement>("[data-print-confirm]")?.disabled).toBe(true);
    cleanup();
  });
});

describe("PrintDialog — print run (Phase 30)", () => {
  it("send the selected pages and settings, including the annotations toggle", async () => {
    const payloads: PrintJobPayload[] = [];
    const printJob = vi.fn(async (payload: PrintJobPayload): Promise<PrintJobResult> => {
      payloads.push(payload);
      return { ok: true };
    });
    const { container, cleanup } = renderDialog({ printJob, totalPages: 3 });
    await flush();
    // Turn annotations OFF before printing.
    const ann = container.querySelector<HTMLInputElement>("[data-print-annotations]");
    expect(ann?.checked).toBe(true);
    act((): void => {
      ann?.click();
    });
    const confirm = container.querySelector<HTMLButtonElement>("[data-print-confirm]");
    await act(async (): Promise<void> => {
      confirm?.click();
      await flush();
    });
    expect(printJob).toHaveBeenCalledTimes(1);
    expect(payloads[0]?.images).toHaveLength(3);
    expect(payloads[0]?.settings.printAnnotations).toBe(false);
    expect(payloads[0]?.settings.deviceName).toBe("HP LaserJet");
    cleanup();
  });

  it("disables Print while running", async () => {
    let release: (() => void) | null = null;
    const gate = { release: (): void => release?.() };
    const printJob = vi.fn(
      async (): Promise<PrintJobResult> => {
        await new Promise<void>((r) => {
          release = r;
        });
        return { ok: true };
      },
    );
    const { container, cleanup } = renderDialog({ printJob });
    await flush();
    const confirm = container.querySelector<HTMLButtonElement>("[data-print-confirm]");
    await act(async (): Promise<void> => {
      confirm?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector<HTMLButtonElement>("[data-print-confirm]")?.disabled).toBe(true);
    expect(container.querySelector("[data-print-progress]")).not.toBeNull();
    gate.release();
    await flush();
    cleanup();
  });

  it("surfaces a failure reason in the error region", async () => {
    const printJob = async (): Promise<PrintJobResult> => ({
      ok: false,
      reason: "The printer is offline",
    });
    const { container, cleanup } = renderDialog({ printJob });
    await flush();
    const confirm = container.querySelector<HTMLButtonElement>("[data-print-confirm]");
    await act(async (): Promise<void> => {
      confirm?.click();
      await flush();
    });
    const error = container.querySelector<HTMLElement>("[data-print-error]");
    expect(error?.textContent).toContain("offline");
    cleanup();
  });

  it("stays quiet on a user-cancel reason", async () => {
    const printJob = async (): Promise<PrintJobResult> => ({
      ok: false,
      reason: "Print job canceled",
    });
    const { container, cleanup } = renderDialog({ printJob });
    await flush();
    const confirm = container.querySelector<HTMLButtonElement>("[data-print-confirm]");
    await act(async (): Promise<void> => {
      confirm?.click();
      await flush();
    });
    expect(container.querySelector("[data-print-error]")).toBeNull();
    cleanup();
  });

  it("same-task double activation starts exactly one job (DEF-272)", async () => {
    // The render-state `running` flag only flips on the next React
    // commit, so two programmatic activations inside one task would
    // both pass the render-state check. The synchronous ref guard must
    // collapse them to a single rasterisation and a single printJob.
    const printJob = vi.fn(async (): Promise<PrintJobResult> => ({ ok: true }));
    const raster = vi.mocked(rasterizePagesForPrint);
    raster.mockClear();
    const { container, cleanup } = renderDialog({ printJob, totalPages: 3 });
    await flush();
    const confirm = container.querySelector<HTMLButtonElement>("[data-print-confirm]");
    expect(confirm?.disabled).toBe(false);
    await act(async (): Promise<void> => {
      // Both clicks land in the SAME task — no commit between them.
      confirm?.click();
      confirm?.click();
      await flush();
    });
    // The preview path also calls the rasteriser (with a `dpi`); isolate
    // the print-job rasterisations, which carry no `dpi`.
    const jobRasters = raster.mock.calls.filter(
      (call) => (call[0] as { dpi?: number }).dpi === undefined,
    );
    expect(jobRasters).toHaveLength(1);
    expect(printJob).toHaveBeenCalledTimes(1);
    cleanup();
  });
});