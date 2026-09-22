// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so that
// `act` recognises the test env.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
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

import { PrintWindowApp, type PrintWindowDeps } from "../../../src/renderer/print-window/PrintWindowApp";
import type { RendererEntry } from "../../../src/renderer/print-window/context";
import type {
  PrintJobPayload,
  PrintJobResult,
  PrinterInfo,
  PrintWindowContext,
} from "../../../src/shared/types";

const PRINTERS: PrinterInfo[] = [
  { name: "HP LaserJet", displayName: "HP LaserJet", isDefault: true },
  { name: "Microsoft Print to PDF", displayName: "Microsoft Print to PDF", isDefault: false },
];

const CONTEXT: PrintWindowContext = {
  docId: "doc-1",
  documentName: "quarterly-report.pdf",
  pageCount: 3,
  settings: { deviceName: "Microsoft Print to PDF", copies: 2, landscape: true },
};

function fakeDocProxy(numPages: number): unknown {
  return {
    numPages,
    getPage: async (): Promise<unknown> => ({}),
    destroy: async (): Promise<unknown> => undefined,
  };
}

interface StubOptions {
  printJob?: (payload: PrintJobPayload) => Promise<PrintJobResult>;
  loadDocument?: PrintWindowDeps["loadDocument"];
  listPrinters?: PrintWindowDeps["listPrinters"];
}

interface Harness {
  container: HTMLElement;
  deps: PrintWindowDeps;
  notifyGone: (docId: string) => void;
  closeWindow: ReturnType<typeof vi.fn>;
  cleanup: () => void;
}

function renderWindow(entry: RendererEntry, options: StubOptions = {}): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let goneCb: ((docId: string) => void) | null = null;
  const closeWindow = vi.fn();
  const deps: PrintWindowDeps = {
    listPrinters: options.listPrinters ?? (async (): Promise<PrinterInfo[]> => PRINTERS),
    printJob: options.printJob ?? (async (): Promise<PrintJobResult> => ({ ok: true })),
    onDocumentGone: (cb): (() => void) => {
      goneCb = cb;
      return (): void => undefined;
    },
    loadDocument:
      options.loadDocument ??
      (async (): Promise<{ doc: never }> => ({ doc: fakeDocProxy(CONTEXT.pageCount) as never })),
    closeWindow,
  };
  if (entry.kind === "app") throw new Error("PrintWindowApp never receives the app entry");
  act((): void => {
    root.render(<PrintWindowApp entry={entry} deps={deps} />);
  });
  return {
    container,
    deps,
    notifyGone: (docId: string): void => {
      act((): void => goneCb?.(docId));
    },
    closeWindow,
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

describe("PrintWindowApp - entry rendering", () => {
  it("renders only the print UI for a valid print entry (no app chrome)", async () => {
    const h = renderWindow({ kind: "print", context: CONTEXT });
    await flush();
    expect(h.container.querySelector("[data-print-window]")).not.toBeNull();
    expect(h.container.querySelector("[data-print-window-doc]")?.textContent).toBe(
      "quarterly-report.pdf",
    );
    // The shared print surface, and NO app shell.
    expect(h.container.querySelector("[data-print-confirm]")).not.toBeNull();
    expect(h.container.querySelector("[data-print-preview]")).not.toBeNull();
    // The preview rasterised from the bytes fetched for the context docId.
    expect(h.container.querySelector("[data-print-preview-page]")).not.toBeNull();
    expect(h.container.querySelector(".app")).toBeNull();
    expect(h.container.querySelector(".welcome")).toBeNull();
    h.cleanup();
  });

  it("fetches the document for the context docId and parses it", async () => {
    const loaded: string[] = [];
    const h = renderWindow(
      { kind: "print", context: CONTEXT },
      {
        loadDocument: async (docId: string) => {
          loaded.push(docId);
          return { doc: fakeDocProxy(3) as never };
        },
      },
    );
    await flush();
    expect(loaded).toEqual(["doc-1"]);
    h.cleanup();
  });

  it("seeds the controls from the context settings", async () => {
    const h = renderWindow({ kind: "print", context: CONTEXT });
    await flush();
    expect(h.container.querySelector<HTMLSelectElement>("[data-print-printer]")?.value).toBe(
      "Microsoft Print to PDF",
    );
    expect(h.container.querySelector<HTMLInputElement>("[data-print-copies]")?.value).toBe("2");
    const landscape = h.container.querySelector<HTMLInputElement>("[data-print-orientation-landscape]");
    expect(landscape?.checked).toBe(true);
    h.cleanup();
  });

  it("renders the error state for a malformed context, never a print UI", async () => {
    const h = renderWindow({
      kind: "print-error",
      reason: "The print window context has no document id.",
    });
    await flush();
    const error = h.container.querySelector<HTMLElement>("[data-print-window-error]");
    expect(error).not.toBeNull();
    expect(error?.textContent).toContain("no document id");
    expect(h.container.querySelector("[data-print-confirm]")).toBeNull();
    expect(h.container.querySelector("[data-print-printer]")).toBeNull();
    // The error state can still close the window.
    const close = h.container.querySelector<HTMLButtonElement>("[data-print-window-error-close]");
    expect(close).not.toBeNull();
    h.cleanup();
  });
});

describe("PrintWindowApp - the print run (same pipeline as the dialog)", () => {
  it("drives printJob with the selected pages and renders the printed state", async () => {
    const payloads: PrintJobPayload[] = [];
    const h = renderWindow(
      { kind: "print", context: CONTEXT },
      {
        printJob: async (payload): Promise<PrintJobResult> => {
          payloads.push(payload);
          return { ok: true };
        },
      },
    );
    await flush();
    await clickPrint(h.container);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.images).toHaveLength(3);
    expect(payloads[0]?.settings.deviceName).toBe("Microsoft Print to PDF");
    const success = h.container.querySelector<HTMLElement>("[data-print-success]");
    expect(success?.textContent).toContain("Sent 3 pages to Microsoft Print to PDF.");
    h.cleanup();
  });

  it("renders the saved-to-path state for the virtual-PDF outcome", async () => {
    const h = renderWindow(
      { kind: "print", context: CONTEXT },
      {
        printJob: async (): Promise<PrintJobResult> => ({
          ok: true,
          outcome: "saved",
          path: "C:\\out\\report.pdf",
        }),
      },
    );
    await flush();
    await clickPrint(h.container);
    expect(h.container.querySelector<HTMLElement>("[data-print-success]")?.textContent).toContain(
      "Saved to C:\\out\\report.pdf",
    );
    h.cleanup();
  });

  it("stays quiet on a cancel reason", async () => {
    const h = renderWindow(
      { kind: "print", context: CONTEXT },
      { printJob: async (): Promise<PrintJobResult> => ({ ok: false, reason: "save-cancelled" }) },
    );
    await flush();
    await clickPrint(h.container);
    expect(h.container.querySelector("[data-print-error]")).toBeNull();
    expect(h.container.querySelector("[data-print-success]")).toBeNull();
    h.cleanup();
  });

  it("surfaces a typed failure in the error region", async () => {
    const h = renderWindow(
      { kind: "print", context: CONTEXT },
      { printJob: async (): Promise<PrintJobResult> => ({ ok: false, reason: "print-timeout" }) },
    );
    await flush();
    await clickPrint(h.container);
    expect(h.container.querySelector<HTMLElement>("[data-print-error]")?.textContent).toContain(
      "timed out",
    );
    h.cleanup();
  });
});

describe("PrintWindowApp - document gone", () => {
  it("shows the gone state and disables the print action", async () => {
    const h = renderWindow({ kind: "print", context: CONTEXT });
    await flush();
    const confirm = h.container.querySelector<HTMLButtonElement>("[data-print-confirm]");
    expect(confirm?.disabled).toBe(false);

    h.notifyGone("doc-1");
    await flush();
    expect(h.container.querySelector("[data-print-document-gone]")).not.toBeNull();
    expect(h.container.querySelector<HTMLButtonElement>("[data-print-confirm]")?.disabled).toBe(true);
    h.cleanup();
  });

  it("ignores a gone notification for a different document", async () => {
    const h = renderWindow({ kind: "print", context: CONTEXT });
    await flush();
    h.notifyGone("some-other-doc");
    await flush();
    expect(h.container.querySelector("[data-print-document-gone]")).toBeNull();
    expect(h.container.querySelector<HTMLButtonElement>("[data-print-confirm]")?.disabled).toBe(false);
    h.cleanup();
  });
});

describe("PrintWindowApp - document load", () => {
  it("shows the load error and blocks printing when the document cannot be read", async () => {
    const h = renderWindow(
      { kind: "print", context: CONTEXT },
      { loadDocument: async (): Promise<{ error: string }> => ({ error: "This document could not be opened for printing." }) },
    );
    await flush();
    expect(h.container.querySelector("[data-print-window-load-error]")).not.toBeNull();
    expect(h.container.querySelector<HTMLButtonElement>("[data-print-confirm]")?.disabled).toBe(true);
    h.cleanup();
  });

  it("closes the window through the Close action", async () => {
    const h = renderWindow({ kind: "print", context: CONTEXT });
    await flush();
    const cancel = h.container.querySelector<HTMLButtonElement>("[data-print-cancel]");
    await act(async (): Promise<void> => {
      cancel?.click();
      await flush();
    });
    expect(h.closeWindow).toHaveBeenCalledTimes(1);
    h.cleanup();
  });
});
