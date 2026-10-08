// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Phase 120 C - jsdom has no canvas backend. Preview rasters resolve; a
// print-job raster can be HELD and honours the run's AbortSignal so the Escape
// / cancel contract is observable.
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
    return new Promise((resolvePromise) => {
      const signal = args.signal;
      if (signal === undefined) {
        resolvePromise(result);
        return;
      }
      const finish = (): void => resolvePromise(result);
      if (signal.aborted) finish();
      else signal.addEventListener("abort", finish, { once: true });
    });
  },
}));

import { PrintSurface } from "./printSurfaceHarness";
import { PrintWindowApp, type PrintWindowDeps } from "../../../src/renderer/print-window/PrintWindowApp";
import type { RendererEntry } from "../../../src/renderer/print-window/context";
import type {
  PrintJobResult,
  PrinterInfo,
  PrintWindowContext,
} from "../../../src/shared/types";

/**
 * Phase 120 C - accessibility, themes and scaling contract for the print
 * surface: framework-native grouped settings, a coherent focus order, Escape
 * closing only this surface, a real progressbar, and the static CSS guards for
 * the forced-colors + reduced-motion remaps.
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

interface Surface {
  container: HTMLElement;
  cleanup: () => void;
}

function renderSurface(options: { totalPages?: number; onClose?: () => void } = {}): Surface {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const totalPages = options.totalPages ?? 3;
  act((): void => {
    root.render(
      <PrintSurface
        active
        totalPages={totalPages}
        currentPage={1}
        resolveActiveDoc={(): never => fakeDocProxy(totalPages) as never}
        listPrinters={async (): Promise<PrinterInfo[]> => PRINTERS}
        printJob={async (): Promise<PrintJobResult> => ({ ok: true })}
        onClose={options.onClose ?? ((): void => undefined)}
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

function pressEscape(): void {
  act((): void => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

afterEach((): void => {
  raster.holdJobRaster = false;
  document.body.innerHTML = "";
});

describe("Phase 120 C - framework-native grouped settings", () => {
  it("renders each required settings group as a fieldset carrying its legend", async () => {
    const { container, cleanup } = renderSurface();
    await flush();
    for (const id of ["destination", "pages", "layout", "appearance"]) {
      const group = container.querySelector(`[data-print-group="${id}"]`);
      expect(group?.tagName, id).toBe("FIELDSET");
      const legend = group?.querySelector("legend");
      expect(legend, id).not.toBeNull();
      expect((legend?.textContent ?? "").length, id).toBeGreaterThan(0);
    }
    cleanup();
  });

  it("exposes the radio groups as fieldsets with legends", async () => {
    const { container, cleanup } = renderSurface();
    await flush();
    const range = container.querySelector("[data-print-range-all]")?.closest("fieldset");
    expect(range?.querySelector("legend")?.textContent).toBe("Page range");
    const scaling = container.querySelector("[data-print-scale-fit]")?.closest("fieldset");
    expect(scaling?.querySelector("legend")?.textContent).toBe("Scaling");
    cleanup();
  });

  it("labels every grouped control with an accessible name", async () => {
    const { container, cleanup } = renderSurface();
    await flush();
    const labels: Array<[string, string]> = [
      ["[data-print-printer]", "Printer"],
      ["[data-print-layout]", "Print layout"],
      ["[data-print-copies]", "Copies"],
      ["[data-print-nup]", "Pages per sheet"],
      ["[data-print-range-input]", "Custom page range"],
    ];
    for (const [selector, name] of labels) {
      expect(container.querySelector(selector)?.getAttribute("aria-label"), selector).toBe(name);
    }
    cleanup();
  });

  it("keeps an advanced group body a labelled role=group and nests no interactives", async () => {
    const { container, cleanup } = renderSurface({ totalPages: 6 });
    await flush();
    setValue(container, "[data-print-layout]", "booklet");
    await flush();
    const body = container.querySelector('[data-print-group="booklet"] .print-group-body');
    expect(body?.getAttribute("role")).toBe("group");
    expect(body?.getAttribute("aria-label")).toBe("Booklet options");
    // No interactive element is nested inside another interactive element.
    for (const el of Array.from(container.querySelectorAll("button, input, select, summary, a"))) {
      const ancestor = el.parentElement?.closest("button, a, select, summary") ?? null;
      expect(ancestor, el.outerHTML.slice(0, 60)).toBeNull();
    }
    cleanup();
  });
});

describe("Phase 120 C - focus order, Escape and live execution", () => {
  it("keeps a coherent focus order: settings before the two footer actions", async () => {
    const { container, cleanup } = renderSurface();
    await flush();
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>("button, input, select, summary, [tabindex]"),
    );
    const cancel = container.querySelector<HTMLElement>("[data-print-cancel]");
    const confirm = container.querySelector<HTMLElement>("[data-print-confirm]");
    expect(cancel).not.toBeNull();
    expect(confirm).not.toBeNull();
    if (cancel === null || confirm === null) {
      cleanup();
      return;
    }
    const cancelIndex = focusables.indexOf(cancel);
    const confirmIndex = focusables.indexOf(confirm);
    expect(cancelIndex).toBeGreaterThan(-1);
    expect(confirmIndex).toBe(cancelIndex + 1);
    // The footer pair is last; every settings control precedes it.
    expect(focusables.length).toBe(confirmIndex + 1);
    expect(focusables.slice(0, cancelIndex).some((el) => el.hasAttribute("data-print-printer"))).toBe(
      true,
    );
    cleanup();
  });

  it("Escape closes only this surface through the opener's close seam", async () => {
    const onClose = vi.fn();
    const { cleanup } = renderSurface({ onClose });
    await flush();
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("Escape cancels an in-flight run instead of closing the surface", async () => {
    raster.holdJobRaster = true;
    const onClose = vi.fn();
    const { container, cleanup } = renderSurface({ onClose });
    await flush();
    await clickPrint(container);
    expect(container.querySelector("[data-print-progress]")).not.toBeNull();
    await act(async (): Promise<void> => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await flush();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector("[data-print-progress]")).toBeNull();
    cleanup();
  });

  it("exposes progress as a real progressbar with a live value", async () => {
    raster.holdJobRaster = true;
    const { container, cleanup } = renderSurface();
    await flush();
    await clickPrint(container);
    const bar = container.querySelector('[data-print-progress] [role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute("aria-valuemin")).toBe("0");
    expect(bar?.getAttribute("aria-valuemax")).toBe("100");
    expect(bar?.getAttribute("aria-valuenow")).not.toBeNull();
    expect(bar?.getAttribute("aria-label")).toBe("Page preparation progress");
    await act(async (): Promise<void> => {
      container.querySelector<HTMLButtonElement>("[data-print-cancel]")?.click();
      await flush();
    });
    cleanup();
  });
});

const CONTEXT: PrintWindowContext = {
  docId: "doc-1",
  documentName: "quarterly-report.pdf",
  pageCount: 3,
  settings: { deviceName: "HP LaserJet", copies: 1 },
};

function renderWindow(): { container: HTMLElement; closeWindow: ReturnType<typeof vi.fn>; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const closeWindow = vi.fn();
  const deps: PrintWindowDeps = {
    listPrinters: async (): Promise<PrinterInfo[]> => PRINTERS,
    printJob: async (): Promise<PrintJobResult> => ({ ok: true }),
    onDocumentGone: (): (() => void) => (): void => undefined,
    loadDocument: async (): Promise<{ doc: never }> => ({
      doc: fakeDocProxy(CONTEXT.pageCount) as never,
    }),
    closeWindow,
  };
  const entry: RendererEntry = { kind: "print", context: CONTEXT };
  act((): void => {
    root.render(<PrintWindowApp entry={entry} deps={deps} />);
  });
  return {
    container,
    closeWindow,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("Phase 120 C - standalone window chrome", () => {
  it("exposes a labelled main landmark for the surface", async () => {
    const h = renderWindow();
    await flush();
    const main = h.container.querySelector("main.print-window-panel");
    expect(main).not.toBeNull();
    expect(main?.getAttribute("aria-labelledby")).toBe("print-window-title");
    expect(h.container.querySelector("#print-window-title")?.textContent).toBe("Print");
    h.cleanup();
  });

  it("Escape closes the standalone window through its close seam", async () => {
    const h = renderWindow();
    await flush();
    pressEscape();
    expect(h.closeWindow).toHaveBeenCalledTimes(1);
    h.cleanup();
  });
});

/* ----------------------------------------------------------------------- */
/* Static CSS guards (jsdom does not apply styles.css).                     */
/* ----------------------------------------------------------------------- */

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

/** The Phase 120 C print-interaction block only. */
function printInteractionCss(): string {
  const css = readFileSync(STYLES_PATH, "utf8");
  const start = css.indexOf("Phase 120 C - the print surface's interaction layer");
  expect(start).toBeGreaterThan(-1);
  const end = css.indexOf("Suspects panel (top bar", start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe("Phase 120 C - forced colors, reduced motion and focus CSS", () => {
  it("remaps boundaries, ink and a visible marker for forced colors", () => {
    const css = printInteractionCss();
    const forced = css.slice(css.indexOf("@media (forced-colors"));
    expect(forced).toMatch(/\.print-group[\s\S]*?border:\s*1px solid CanvasText/);
    expect(forced).toMatch(/forced-color-adjust:\s*none/);
    expect(forced).toMatch(/\.print-status\s*{[^}]*border-left-width:\s*3px/);
    expect(forced).toMatch(/\.print-status-text\s*{[^}]*color:\s*CanvasText/);
    expect(forced).toMatch(/outline:\s*2px solid Highlight/);
  });

  it("removes the surface's non-essential transitions under reduced motion", () => {
    const css = printInteractionCss();
    const reduced = css.slice(
      css.indexOf("@media (prefers-reduced-motion"),
      css.indexOf("@media (forced-colors"),
    );
    expect(reduced).toMatch(/\.print-footer[\s\S]*transition:\s*none/);
  });

  it("gives every interactive element a focus ring independent of hover", () => {
    const css = printInteractionCss();
    expect(css).toMatch(/:focus-visible[\s\S]*box-shadow:\s*var\(--focus-ring\)/);
  });

  it("renders the marker regions the forced-colors remap targets", async () => {
    const wrapper = document.createElement("div");
    wrapper.className = "tf-forced-colors";
    document.body.appendChild(wrapper);
    const { container, cleanup } = renderSurface();
    await flush();
    wrapper.appendChild(container);
    expect(wrapper.querySelector("[data-print-summary]")).not.toBeNull();
    expect(wrapper.querySelectorAll("[data-print-group]").length).toBeGreaterThanOrEqual(4);
    expect(wrapper.querySelector("[data-print-preview]")).not.toBeNull();
    cleanup();
    wrapper.remove();
  });
});

