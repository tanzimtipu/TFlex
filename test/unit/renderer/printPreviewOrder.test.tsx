// @vitest-environment jsdom
//
// Phase 33 / DEF-280 — the print preview sheet must follow the SHARED
// `printSheetLayout` rule the main process composes the printed sheets
// with, so the preview and the printed page can never disagree. The old
// preview used a fixed `PRINT_NUP_GRID` plus a `direction` /
// `grid-auto-flow` CSS trick, which left the grid DIMENSIONS unchanged:
// at 2-up Horizontal and Vertical produced byte-identical geometry.
//
// Contract pinned here:
//   1. The sheet's `grid-template-columns` / `grid-template-rows` follow
//      the order: 2-up Horizontal is 2x1, Vertical is 1x2; 6-up 3x2 vs 2x3.
//   2. Every DOM cell carries the image the shared rule puts there
//      (`slots[cellIndex]`), so the reversed variants place the pages in
//      the expected cells — asserted through the rendered `img` alt text,
//      not just a class change.
//   3. The sheet still renders one cell per image and the meta line still
//      reports the correct sheet count.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PrinterInfo } from "../../../src/shared/types";
import type { PrintPageOrder } from "../../../src/shared/types";

// jsdom has no canvas backend; return one tiny PNG data URL per page.
vi.mock("../../../src/renderer/pdf/printRaster", () => ({
  PRINT_DPI: 200,
  MAX_PRINT_PIXELS: 12000000,
  rasterizePagesForPrint: vi.fn(
    async (args: {
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
    },
  ),
}));

import { PrintSurface } from "./printSurfaceHarness";

const PRINTERS: PrinterInfo[] = [
  { name: "HP LaserJet", displayName: "HP LaserJet", isDefault: true },
];

function renderDialog(totalPages: number): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act((): void => {
    root.render(
      <PrintSurface
        active
        totalPages={totalPages}
        currentPage={1}
        resolveActiveDoc={(): never => ({ numPages: totalPages }) as never}
        listPrinters={async (): Promise<PrinterInfo[]> => PRINTERS}
        printJob={async (): Promise<{ ok: true }> => ({ ok: true })}
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

function setValue(container: HTMLElement, selector: string, value: string): void {
  const el = container.querySelector<HTMLSelectElement>(selector);
  expect(el, selector).not.toBeNull();
  if (el === null) return;
  act((): void => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** The page number rendered in each row-major DOM cell (null = blank). */
function cellPages(container: HTMLElement): Array<number | null> {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-print-preview-cell]"),
  ).map((cell) => {
    const raw = cell.getAttribute("data-print-preview-page");
    return raw === null ? null : Number.parseInt(raw, 10);
  });
}

function grid(container: HTMLElement): { cols: string; rows: string; cells: number } {
  const sheet = container.querySelector<HTMLElement>("[data-print-preview-sheet]");
  expect(sheet).not.toBeNull();
  const cells = container.querySelectorAll("[data-print-preview-cell]").length;
  return {
    cols: sheet?.style.gridTemplateColumns ?? "",
    rows: sheet?.style.gridTemplateRows ?? "",
    cells,
  };
}

interface Case {
  nup: number;
  order: PrintPageOrder;
  cols: string;
  rows: string;
  pages: Array<number | null>;
}

const CASES: Case[] = [
  // 2-up: the defect's headline case — the grid DIMENSIONS must differ.
  { nup: 2, order: "horizontal", cols: "repeat(2, 1fr)", rows: "repeat(1, 1fr)", pages: [1, 2] },
  { nup: 2, order: "vertical", cols: "repeat(1, 1fr)", rows: "repeat(2, 1fr)", pages: [1, 2] },
  // Reversed variants reverse the flow within the same grid.
  { nup: 2, order: "horizontalReversed", cols: "repeat(2, 1fr)", rows: "repeat(1, 1fr)", pages: [2, 1] },
  { nup: 2, order: "verticalReversed", cols: "repeat(1, 1fr)", rows: "repeat(2, 1fr)", pages: [2, 1] },
  // 4-up is square: only the fill flow differs.
  { nup: 4, order: "horizontal", cols: "repeat(2, 1fr)", rows: "repeat(2, 1fr)", pages: [1, 2, 3, 4] },
  { nup: 4, order: "horizontalReversed", cols: "repeat(2, 1fr)", rows: "repeat(2, 1fr)", pages: [2, 1, 4, 3] },
  // 6-up: 3x2 becomes 2x3 under the vertical order.
  { nup: 6, order: "horizontal", cols: "repeat(3, 1fr)", rows: "repeat(2, 1fr)", pages: [1, 2, 3, 4, 5, 6] },
  { nup: 6, order: "vertical", cols: "repeat(2, 1fr)", rows: "repeat(3, 1fr)", pages: [1, 4, 2, 5, 3, 6] },
  { nup: 6, order: "horizontalReversed", cols: "repeat(3, 1fr)", rows: "repeat(2, 1fr)", pages: [3, 2, 1, 6, 5, 4] },
  { nup: 6, order: "verticalReversed", cols: "repeat(2, 1fr)", rows: "repeat(3, 1fr)", pages: [3, 6, 2, 5, 1, 4] },
];

describe("PrintSurface preview — Phase 33 / DEF-280 page order", () => {
  it("maps every sheet layout through the shared rule (grid dims + cell images)", async () => {
    const { container, cleanup } = renderDialog(6);
    await flush();
    try {
      for (const c of CASES) {
        setValue(container, "[data-print-nup]", String(c.nup));
        setValue(container, "[data-print-page-order]", c.order);
        await flush();
        const g = grid(container);
        const label = `${c.nup}-up ${c.order}`;
        expect(g.cols, `${label} cols`).toBe(c.cols);
        expect(g.rows, `${label} rows`).toBe(c.rows);
        expect(g.cells, `${label} cell count`).toBe(c.nup);
        expect(cellPages(container), `${label} cell images`).toEqual(c.pages);
      }
    } finally {
      cleanup();
    }
  });

  it("renders the sheet count for the selected pages", async () => {
    const { container, cleanup } = renderDialog(6);
    await flush();
    try {
      setValue(container, "[data-print-nup]", "2");
      await flush();
      const meta = container.querySelector<HTMLElement>("[data-print-preview-meta]");
      expect(meta?.textContent).toContain("6 pages");
      expect(meta?.textContent).toContain("3 sheets");
      setValue(container, "[data-print-nup]", "6");
      await flush();
      expect(container.querySelector<HTMLElement>("[data-print-preview-meta]")?.textContent)
        .toContain("1 sheet");
    } finally {
      cleanup();
    }
  });
});