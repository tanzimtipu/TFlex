// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so that
// `act` recognises the test env.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../../../src/renderer/pdf/printRaster", () => ({
  PRINT_DPI: 200,
  MAX_PRINT_PIXELS: 12000000,
  rasterizePagesForPrint: vi.fn(async (args: { pages: number[] }) =>
    args.pages.map((p) => ({
      page: p,
      dataUrl: `data:image/png;base64,page-${p}`,
      widthPx: 612,
      heightPx: 792,
    })),
  ),
}));

import { PrintDialog, type PrintDetachInfo } from "../../../src/renderer/components/PrintDialog";
import type { PrintWindowContext, PrinterInfo } from "../../../src/shared/types";

const PRINTERS: PrinterInfo[] = [
  { name: "HP LaserJet", displayName: "HP LaserJet", isDefault: true },
  { name: "Microsoft Print to PDF", displayName: "Microsoft Print to PDF", isDefault: false },
];

const DETACH: PrintDetachInfo = {
  docId: "doc-42",
  documentName: "contract.pdf",
  pageCount: 5,
};

function renderDialog(args: {
  detach?: PrintDetachInfo | null;
  onDetach?: (context: PrintWindowContext) => void;
}): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act((): void => {
    root.render(
      <PrintDialog
        open={true}
        totalPages={args.detach?.pageCount ?? 5}
        currentPage={1}
        resolveActiveDoc={(): never => ({ numPages: 5 }) as never}
        listPrinters={async (): Promise<PrinterInfo[]> => PRINTERS}
        printJob={async (): Promise<{ ok: true }> => ({ ok: true })}
        onClose={(): void => undefined}
        detach={args.detach === undefined ? DETACH : args.detach}
        onDetach={args.onDetach}
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
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

describe("PrintDialog — detach control (Phase 35 item 8)", () => {
  it("renders a labelled detach control with the data-print-detach hook", async () => {
    const { container, cleanup } = renderDialog({ onDetach: (): void => undefined });
    await flush();
    const button = container.querySelector<HTMLButtonElement>("[data-print-detach]");
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("Separate window");
    expect(button?.getAttribute("title")).toMatch(/own window/);
    cleanup();
  });

  it("hands the host the active document plus the CURRENT settings", async () => {
    const contexts: PrintWindowContext[] = [];
    const { container, cleanup } = renderDialog({ onDetach: (c) => contexts.push(c) });
    await flush();
    // Change the printer, then detach: the context must carry the live choice.
    const select = container.querySelector<HTMLSelectElement>("[data-print-printer]");
    expect(select).not.toBeNull();
    if (select !== null) {
      act((): void => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype,
          "value",
        )?.set;
        setter?.call(select, "Microsoft Print to PDF");
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    act((): void => {
      container.querySelector<HTMLButtonElement>("[data-print-detach]")?.click();
    });
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.docId).toBe("doc-42");
    expect(contexts[0]?.documentName).toBe("contract.pdf");
    expect(contexts[0]?.pageCount).toBe(5);
    expect(contexts[0]?.settings.deviceName).toBe("Microsoft Print to PDF");
    expect(contexts[0]?.settings.copies).toBe(1);
    cleanup();
  });

  it("hides the detach control when there is no active document", async () => {
    const { container, cleanup } = renderDialog({ detach: null });
    await flush();
    expect(container.querySelector("[data-print-detach]")).toBeNull();
    cleanup();
  });

  it("a press on the detach control never starts a header drag", async () => {
    Element.prototype.setPointerCapture = function (): void {
      /* no-op */
    };
    const { container, cleanup } = renderDialog({ onDetach: (): void => undefined });
    await flush();
    const shell = container.querySelector<HTMLElement>("[data-print-dialog-shell]");
    const button = container.querySelector<HTMLButtonElement>("[data-print-detach]");
    expect(shell).not.toBeNull();
    expect(button).not.toBeNull();
    if (shell === null || button === null) return;
    act((): void => {
      button.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          clientX: 400,
          clientY: 300,
          pointerId: 1,
          button: 0,
        }),
      );
    });
    expect(shell.getAttribute("data-drag-x")).toBe("0");
    expect(shell.getAttribute("data-drag-y")).toBe("0");
    cleanup();
  });
});
