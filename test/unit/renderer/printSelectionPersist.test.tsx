// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so that
// `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// DEF-301 — the printer pick must survive the async printer-list resolution.
// The hook (shared by the in-app dialog and the standalone print window)
// used to call `setDeviceName(preferred)` on every resolve, silently
// overwriting the user's selection with the system default, so a
// "Microsoft Print to PDF" job could route to the PHYSICAL printer.
//
// Pinned rules:
//   1. a selection made before a re-resolve survives it;
//   2. a selection made before the FIRST resolve of an activation survives
//      it (the qa-measured stale-list window);
//   3. a fresh dialog still preselects the seeded / system default;
//   4. a selection whose device disappears falls back deterministically
//      AND the routing change is observable.
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../../../src/renderer/pdf/printRaster", () => ({
  PRINT_DPI: 200,
  MAX_PRINT_PIXELS: 12000000,
  rasterizePagesForPrint: vi.fn(
    async (args: {
      pages: number[];
      onProgress?: (page: number) => void;
    }): Promise<
      Array<{ page: number; dataUrl: string; widthPx: number; heightPx: number }>
    > => {
      for (const p of args.pages) args.onProgress?.(p);
      return args.pages.map((p) => ({
        page: p,
        dataUrl: `data:image/png;base64,page-${p}`,
        widthPx: 612,
        heightPx: 792,
      }));
    },
  ),
}));

import { PrintDialog } from "../../../src/renderer/components/PrintDialog";
import type {
  PrintJobPayload,
  PrintJobResult,
  PrinterInfo,
} from "../../../src/shared/types";

const CANON: PrinterInfo = {
  name: "Canon TS3100 series",
  displayName: "Canon TS3100 series",
  isDefault: true,
};
const MS_PDF: PrinterInfo = {
  name: "Microsoft Print to PDF",
  displayName: "Microsoft Print to PDF",
  isDefault: false,
};
const BOTH: PrinterInfo[] = [CANON, MS_PDF];

function fakeDocProxy(numPages: number): unknown {
  return {
    numPages,
    getPage: async (): Promise<unknown> => ({}),
    destroy: async (): Promise<unknown> => undefined,
  };
}

interface Harness {
  container: HTMLElement;
  root: Root;
  render: (open: boolean, listPrinters: () => Promise<PrinterInfo[]>) => void;
  cleanup: () => void;
}

function mountDialog(): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const render = (
    open: boolean,
    listPrinters: () => Promise<PrinterInfo[]>,
  ): void => {
    act((): void => {
      root.render(
        <PrintDialog
          open={open}
          totalPages={3}
          currentPage={1}
          resolveActiveDoc={(): never => fakeDocProxy(3) as never}
          listPrinters={listPrinters}
          printJob={async (_payload: PrintJobPayload): Promise<PrintJobResult> => ({
            ok: true,
          })}
          onClose={(): void => undefined}
        />,
      );
    });
  };
  return {
    container,
    root,
    render,
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
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

function printerValue(container: HTMLElement): string {
  const select = container.querySelector<HTMLSelectElement>("[data-print-printer]");
  expect(select).not.toBeNull();
  return select?.value ?? "";
}

function selectPrinter(container: HTMLElement, value: string): void {
  const select = container.querySelector<HTMLSelectElement>("[data-print-printer]");
  expect(select).not.toBeNull();
  if (select === null) return;
  act((): void => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    )?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("usePrintControls printer selection (DEF-301)", () => {
  it("preselects the system default for a fresh dialog", async () => {
    const h = mountDialog();
    h.render(true, async (): Promise<PrinterInfo[]> => BOTH);
    await flush();
    expect(printerValue(h.container)).toBe(CANON.name);
    h.cleanup();
  });

  it("a selection made before a re-resolve survives it", async () => {
    const h = mountDialog();
    h.render(true, async (): Promise<PrinterInfo[]> => BOTH);
    await flush();
    expect(printerValue(h.container)).toBe(CANON.name);

    selectPrinter(h.container, MS_PDF.name);
    expect(printerValue(h.container)).toBe(MS_PDF.name);

    // A second resolution with a fresh callback identity (the effect
    // re-runs, mirroring a reopen) must not touch the live pick.
    h.render(true, async (): Promise<PrinterInfo[]> => [CANON, MS_PDF]);
    await flush();
    expect(printerValue(h.container)).toBe(MS_PDF.name);
    h.cleanup();
  });

  it("a selection made before the FIRST resolve of an activation survives it", async () => {
    const h = mountDialog();
    h.render(true, async (): Promise<PrinterInfo[]> => BOTH);
    await flush();
    expect(printerValue(h.container)).toBe(CANON.name);

    // Reopen with a resolution held pending. The stale list still renders
    // the options, so the user picks MS PDF before the fresh list lands.
    let release: ((list: PrinterInfo[]) => void) | null = null;
    const pending = new Promise<PrinterInfo[]>((resolve): void => {
      release = resolve;
    });
    h.render(false, async (): Promise<PrinterInfo[]> => BOTH);
    h.render(true, (): Promise<PrinterInfo[]> => pending);
    await flush();
    expect(printerValue(h.container)).toBe(CANON.name);
    selectPrinter(h.container, MS_PDF.name);
    expect(printerValue(h.container)).toBe(MS_PDF.name);

    // The fresh getPrintersAsync resolution lands - the pick must stand.
    await act(async (): Promise<void> => {
      release?.([CANON, MS_PDF]);
      await flush();
    });
    expect(printerValue(h.container)).toBe(MS_PDF.name);
    h.cleanup();
  });

  it("a selection whose device disappears falls back deterministically and is observable", async () => {
    const h = mountDialog();
    h.render(true, async (): Promise<PrinterInfo[]> => BOTH);
    await flush();
    selectPrinter(h.container, MS_PDF.name);
    expect(printerValue(h.container)).toBe(MS_PDF.name);
    expect(h.container.querySelector("[data-print-printer-notice]")).toBeNull();

    // MS PDF disappears from the fresh list.
    h.render(true, async (): Promise<PrinterInfo[]> => [CANON]);
    await flush();

    expect(printerValue(h.container)).toBe(CANON.name);
    const notice = h.container.querySelector<HTMLElement>(
      "[data-print-printer-notice]",
    );
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain(MS_PDF.name);
    expect(notice?.textContent).toContain(CANON.name);
    h.cleanup();
  });

  it("a user pick clears a stale fallback notice", async () => {
    const h = mountDialog();
    h.render(true, async (): Promise<PrinterInfo[]> => BOTH);
    await flush();
    selectPrinter(h.container, MS_PDF.name);
    h.render(true, async (): Promise<PrinterInfo[]> => [CANON]);
    await flush();
    expect(h.container.querySelector("[data-print-printer-notice]")).not.toBeNull();

    selectPrinter(h.container, CANON.name);
    expect(h.container.querySelector("[data-print-printer-notice]")).toBeNull();
    h.cleanup();
  });
});