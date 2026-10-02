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

import { PrintSurface } from "./printSurfaceHarness";
import type {
  PrintJobPayload,
  PrintJobResult,
  PrintPreset,
  PrinterInfo,
  PrintSettings,
} from "../../../src/shared/types";

const PRINTERS: PrinterInfo[] = [
  { name: "HP LaserJet", displayName: "HP LaserJet", isDefault: true },
];

function fakeDocProxy(numPages: number): unknown {
  return { numPages, getPage: async (): Promise<unknown> => ({}), destroy: async (): Promise<unknown> => undefined };
}

// Stable seams: the hook's effects are keyed on these identities.
const LIST_PRINTERS = async (): Promise<PrinterInfo[]> => PRINTERS;
const PRINT_JOB = async (_payload: PrintJobPayload): Promise<PrintJobResult> => ({ ok: true });
const RESOLVE_DOC = (): never => fakeDocProxy(3) as never;
const NOOP_CLOSE = (): void => undefined;

function preset(name: string, settings: PrintSettings): PrintPreset {
  return { name, settings };
}

interface RenderArgs {
  loadPresets?: () => Promise<PrintPreset[]>;
  savePresets?: (presets: PrintPreset[]) => Promise<void>;
}

function renderSurface(args: RenderArgs = {}): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act((): void => {
    root.render(
      <PrintSurface
        active
        totalPages={3}
        currentPage={1}
        resolveActiveDoc={RESOLVE_DOC}
        listPrinters={LIST_PRINTERS}
        printJob={PRINT_JOB}
        onClose={NOOP_CLOSE}
        loadPresets={args.loadPresets}
        savePresets={args.savePresets}
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

function setValue(container: HTMLElement, selector: string, value: string): void {
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

async function clickAndFlush(container: HTMLElement, selector: string): Promise<void> {
  const el = container.querySelector<HTMLButtonElement>(selector);
  expect(el).not.toBeNull();
  await act(async (): Promise<void> => {
    el?.click();
    await flush();
  });
}

function optionLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLOptionElement>("[data-print-preset] option")).map(
    (o) => o.textContent ?? "",
  );
}

// Phase 81 - named print presets in the shared print surface.
describe("PrintSurface - named print presets (Phase 81)", () => {
  it("lists the persisted presets in the preset select", async () => {
    const loadPresets = async (): Promise<PrintPreset[]> => [
      preset("Duplex greyscale", { duplex: "longEdge", color: false }),
      preset("Booklet", { pagesPerSheet: 2 }),
    ];
    const { container, cleanup } = renderSurface({ loadPresets });
    await flush();
    const labels = optionLabels(container);
    expect(labels).toContain("Duplex greyscale");
    expect(labels).toContain("Booklet");
    expect(labels[0]).toBe("Custom");
    cleanup();
  });

  it("saves the current options under a trimmed name without a deviceName", async () => {
    const saved: PrintPreset[][] = [];
    const savePresets = vi.fn(async (list: PrintPreset[]): Promise<void> => {
      saved.push(list);
    });
    const loadPresets = async (): Promise<PrintPreset[]> => [];
    const { container, cleanup } = renderSurface({ loadPresets, savePresets });
    await flush();
    setValue(container, "[data-print-preset-name]", "  My preset  ");
    await clickAndFlush(container, "[data-print-preset-save]");
    expect(savePresets).toHaveBeenCalledTimes(1);
    const entry = saved[0]?.find((p) => p.name === "My preset");
    expect(entry).toBeDefined();
    expect(entry?.settings).not.toHaveProperty("deviceName");
    expect(container.querySelector("[data-print-preset-notice]")).not.toBeNull();
    expect(container.querySelector("[data-print-preset-error]")).toBeNull();
    cleanup();
  });

  it("refuses an empty name without calling savePresets", async () => {
    const savePresets = vi.fn(async (): Promise<void> => undefined);
    const loadPresets = async (): Promise<PrintPreset[]> => [];
    const { container, cleanup } = renderSurface({ loadPresets, savePresets });
    await flush();
    await clickAndFlush(container, "[data-print-preset-save]");
    expect(container.querySelector("[data-print-preset-error]")).not.toBeNull();
    expect(savePresets).not.toHaveBeenCalled();
    cleanup();
  });

  it("refuses a new name when the preset list is at the cap", async () => {
    const savePresets = vi.fn(async (): Promise<void> => undefined);
    const loadPresets = async (): Promise<PrintPreset[]> =>
      Array.from({ length: 30 }, (_v, i) => preset(`p${String(i).padStart(2, "0")}`, {}));
    const { container, cleanup } = renderSurface({ loadPresets, savePresets });
    await flush();
    setValue(container, "[data-print-preset-name]", "extra");
    await clickAndFlush(container, "[data-print-preset-save]");
    expect(container.querySelector("[data-print-preset-error]")).not.toBeNull();
    expect(savePresets).not.toHaveBeenCalled();
    expect(optionLabels(container)).toHaveLength(31);
    cleanup();
  });

  it("re-seeds the visible controls when a preset is applied", async () => {
    const loadPresets = async (): Promise<PrintPreset[]> => [
      preset("Duplex greyscale", {
        duplex: "longEdge",
        color: false,
        scaling: "fit",
      }),
    ];
    const { container, cleanup } = renderSurface({ loadPresets });
    await flush();
    // Move away from the preset's values first, so the assertion proves the
    // apply actually re-seeded the controls.
    const actual = container.querySelector<HTMLInputElement>("[data-print-scale-actual]");
    act((): void => {
      actual?.click();
    });
    expect(container.querySelector<HTMLInputElement>("[data-print-scale-fit]")?.checked).toBe(false);

    setValue(container, "[data-print-preset]", "Duplex greyscale");
    expect(container.querySelector<HTMLSelectElement>("[data-print-duplex]")?.value).toBe("longEdge");
    expect(container.querySelector<HTMLSelectElement>("[data-print-color]")?.value).toBe("grey");
    expect(container.querySelector<HTMLInputElement>("[data-print-scale-fit]")?.checked).toBe(true);
    cleanup();
  });

  it("deletes the selected preset from the persisted list", async () => {
    const saved: PrintPreset[][] = [];
    const savePresets = vi.fn(async (list: PrintPreset[]): Promise<void> => {
      saved.push(list);
    });
    const loadPresets = async (): Promise<PrintPreset[]> => [
      preset("Keep me", {}),
      preset("Delete me", {}),
    ];
    const { container, cleanup } = renderSurface({ loadPresets, savePresets });
    await flush();
    setValue(container, "[data-print-preset]", "Delete me");
    await clickAndFlush(container, "[data-print-preset-delete]");
    expect(savePresets).toHaveBeenCalledTimes(1);
    const last = saved[saved.length - 1] ?? [];
    expect(last.some((p) => p.name === "Delete me")).toBe(false);
    expect(last.some((p) => p.name === "Keep me")).toBe(true);
    cleanup();
  });

  it("reloads a saved preset after a restart", async () => {
    let stored: PrintPreset[] = [];
    const loadPresets = async (): Promise<PrintPreset[]> => stored;
    const savePresets = async (list: PrintPreset[]): Promise<void> => {
      stored = list;
    };
    const first = renderSurface({ loadPresets, savePresets });
    await flush();
    setValue(first.container, "[data-print-preset-name]", "Restart test");
    await clickAndFlush(first.container, "[data-print-preset-save]");
    first.cleanup();
    expect(stored.some((p) => p.name === "Restart test")).toBe(true);

    const second = renderSurface({ loadPresets, savePresets });
    await flush();
    expect(optionLabels(second.container)).toContain("Restart test");
    second.cleanup();
  });
});