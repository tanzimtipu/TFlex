// @vitest-environment jsdom
//
// Phase 112 (TFL-854, chunk C5) - the DELIVER Context Pair.
//
// LEFT - the output checks and preparation: Ported onto the shared panel
// primitives. Every check is a FACTUAL OBSERVATION read from the existing
// state (never a blocker, never a readiness score): the OCR status (not-run is
// not an error), the real file size, the interactive form-field count (a
// nonzero count is not a problem to flatten), the document's real encryption
// dictionary when read, and an office format's mandatory fidelity limits when
// one is being prepared. Unknown / not-analysed reads distinctly; no readiness
// percentage and no size-savings estimate is ever invented.
//
// RIGHT - the export configuration: format / preset, a page scope (All /
// Current / Custom) validated by the REAL parser (engine/types.ts) with the
// error close to the field, the output name, format-specific options (image
// DPI; office fidelity), the live office gate with its disabled reason and a
// clearly named Export action that hands the prepared request to the host's
// EXISTING export flow. No export-time flatten toggle exists.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import type { ContextPanelProps } from "../../../src/renderer/components/ContextPanel";
import { Inspector } from "../../../src/renderer/components/Inspector";
import type { InspectorExportRequest } from "../../../src/renderer/components/Inspector";
import { ExportDialog } from "../../../src/renderer/components/ExportDialog";
import { TextExportDialog } from "../../../src/renderer/components/TextExportDialog";
import { DocxExportDialog } from "../../../src/renderer/components/DocxExportDialog";
import { OfficeExportDialog } from "../../../src/renderer/components/OfficeExportDialog";
import {
  exportConfigGate,
  exportDefaultName,
  exportDialogSeed,
  exportFidelityNotes,
  exportOutputNameStem,
  exportPrimaryLabel,
  exportRangeExpression,
  exportRangeText,
  exportScopeLabel,
  validateExportRange,
} from "../../../src/renderer/components/exportConfig";
import { OFFICE_EXPORT_DISABLED_REASON } from "../../../src/renderer/state/dockModel";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { DocumentProtectionState } from "../../../src/shared/types";

function mount(node: ReactElement): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(node);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function clickOn(target: Element | null): void {
  if (target === null) throw new Error("clickOn: missing target");
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  act((): void => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, 612, 792],
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void>; cancel: () => void } => ({
          promise: Promise.resolve(),
          cancel: (): void => undefined,
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function makeEngineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
  };
}

function mountDeliver(overrides: Partial<ContextPanelProps> = {}): {
  host: HTMLElement;
  unmount: () => void;
} {
  return mount(
    <ContextPanel
      stage="deliver"
      doc={makeDocStub(3)}
      currentPage={1}
      defaultWidthPt={612}
      defaultHeightPt={792}
      pageSizes={null}
      engineState={makeEngineState(3)}
      proxyVisibleOrder={false}
      canUndo={false}
      onUndo={(): void => undefined}
      onJump={(): void => undefined}
      outline={null}
      {...overrides}
    />,
  );
}

const PROTECTION = {
  algorithm: "AES-256",
  r: 6,
  v: 5,
  cfm: "AESV3",
} as unknown as DocumentProtectionState;

const textLower = (host: HTMLElement): string => (host.textContent ?? "").toLowerCase();
describe("Phase 112 C5 - the LEFT output checks", () => {
  it("renders the checks through the primitives with labelled observations", () => {
    const { host, unmount } = mountDeliver({
      ocrStatus: "Recognized",
      fileSize: 2048,
      formFieldCount: 3,
      protection: PROTECTION,
      exportFidelityFormat: "docx",
    });
    try {
      const preflight = host.querySelector('[data-context-panel-section="preflight"]');
      expect(preflight).not.toBeNull();
      expect(preflight?.classList.contains("tf-panel-section")).toBe(true);

      const observations = [...host.querySelectorAll("[data-deliver-observation]")];
      expect(observations.length).toBeGreaterThanOrEqual(4);
      for (const row of observations) expect(row.classList.contains("tf-panel-row")).toBe(true);
      expect(
        host.querySelector("[data-deliver-observation-legend]")?.textContent,
      ).toContain("Observation");

      expect(host.querySelector('[data-preflight="ocr"]')?.textContent).toContain("Recognized");
      expect(host.querySelector("[data-file-size]")?.textContent).toBe("2.0 KB");
      // A nonzero interactive-field count is not a problem to flatten.
      expect(host.querySelector("[data-form-fields]")?.textContent).toBe("3 interactive");
      expect(host.querySelector("[data-deliver-protection]")?.textContent).toContain("AES-256");
      expect(host.querySelector("[data-deliver-fidelity]")?.textContent).toContain("Word");
    } finally {
      unmount();
    }
  });

  it("shows unknown / not-analysed distinctly and invents no readiness or savings", () => {
    const { host, unmount } = mountDeliver({});
    try {
      expect(host.querySelector('[data-preflight="ocr"]')?.textContent).toContain("Not run");
      expect(host.querySelector("[data-file-size]")?.textContent).toBe("\u2014");
      expect(host.querySelector("[data-form-fields]")?.textContent).toBe("None");
      expect(host.querySelector("[data-deliver-protection]")?.textContent).toBe("Not analysed");
      expect(host.querySelector("[data-deliver-fidelity]")?.textContent).toBe("Not analysed");
      const text = textLower(host);
      expect(text).not.toContain("readiness");
      expect(text).not.toContain("%");
      expect(text).not.toContain("savings");
      expect(text).not.toContain("ready");
    } finally {
      unmount();
    }
  });

  it("preserves the Optimize and From-images entries", () => {
    const onOptimize = vi.fn();
    const onCreateFromImages = vi.fn();
    const { host, unmount } = mountDeliver({ onOptimize, onCreateFromImages });
    try {
      const optimize = host.querySelector<HTMLButtonElement>(
        '[data-context-panel-action="optimize"]',
      );
      const fromImages = host.querySelector<HTMLButtonElement>(
        '[data-context-panel-action="from-images"]',
      );
      expect(optimize).not.toBeNull();
      expect(fromImages).not.toBeNull();
      clickOn(optimize);
      clickOn(fromImages);
      expect(onOptimize).toHaveBeenCalledTimes(1);
      expect(onCreateFromImages).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("disables an entry the host did not wire", () => {
    const { host, unmount } = mountDeliver({});
    try {
      expect(
        host.querySelector<HTMLButtonElement>('[data-context-panel-action="optimize"]')?.disabled,
      ).toBe(true);
      expect(
        host.querySelector<HTMLButtonElement>('[data-context-panel-action="from-images"]')?.disabled,
      ).toBe(true);
    } finally {
      unmount();
    }
  });
});

interface RightOptions {
  format?: "png" | "jpeg" | "tiff" | "txt" | "docx" | "xlsx" | "pptx";
  bridge?: { xlsx: boolean; pptx: boolean };
  status?: { state: "running" | "error" | "success"; message?: string; current?: number; total?: number };
  onExportRun?: (request: InspectorExportRequest) => void;
}

function mountExport(options: RightOptions = {}): { host: HTMLElement; unmount: () => void } {
  return mount(
    <Inspector
      stage="deliver"
      selection={{ kind: "none" }}
      pageCount={5}
      exportFormat={options.format ?? "png"}
      exportSourceName="Report.pdf"
      exportBridge={options.bridge ?? { xlsx: true, pptx: true }}
      exportStatus={options.status ?? null}
      onExportRun={options.onExportRun ?? vi.fn()}
    />,
  );
}

describe("Phase 112 C5 - the RIGHT export configuration", () => {
  it("surfaces format / pages / output / options and a named Export wired to the host", () => {
    const onExportRun = vi.fn();
    const { host, unmount } = mountExport({ format: "png", onExportRun });
    try {
      expect(host.querySelector("[data-export-config]")).not.toBeNull();
      expect(host.querySelector('[data-export-config-format-option="png"]')).not.toBeNull();
      expect(host.querySelector("[data-export-config-pages]")).not.toBeNull();
      expect(host.querySelector('[data-export-config-scope="all"]')).not.toBeNull();
      expect(host.querySelector('[data-export-config-scope="current"]')).not.toBeNull();
      expect(host.querySelector('[data-export-config-scope="custom"]')).not.toBeNull();
      expect(host.querySelector("[data-export-config-output-value]")?.textContent).toContain(
        "Report.png",
      );
      expect(host.querySelector("[data-export-config-dpi]")).not.toBeNull();

      const action = host.querySelector<HTMLButtonElement>('[data-inspector-action="export"]');
      expect(action?.textContent).toContain("Export images");
      expect(action?.disabled).toBe(false);
      clickOn(action);
      expect(onExportRun).toHaveBeenCalledWith(
        expect.objectContaining({
          format: "png",
          range: [1, 2, 3, 4, 5],
          dpi: 150,
          outputName: "Report.png",
        }),
      );
    } finally {
      unmount();
    }
  });

  it("validates a custom range with the real parser and keeps the error by the field", () => {
    const onExportRun = vi.fn();
    const { host, unmount } = mountExport({ format: "png", onExportRun });
    try {
      clickOn(host.querySelector('[data-export-config-scope="custom"]'));
      const input = host.querySelector<HTMLInputElement>("[data-export-config-range]");
      expect(input).not.toBeNull();
      // The empty custom range is invalid; the error sits next to the field.
      expect(host.querySelector("[data-export-config-range-error]")).not.toBeNull();
      expect(
        host.querySelector<HTMLButtonElement>('[data-inspector-action="export"]')?.disabled,
      ).toBe(true);

      setInputValue(input as HTMLInputElement, "9-2");
      expect(host.querySelector("[data-export-config-range-error]")).not.toBeNull();

      setInputValue(input as HTMLInputElement, "2-4");
      expect(host.querySelector("[data-export-config-range-error]")).toBeNull();
      const action = host.querySelector<HTMLButtonElement>('[data-inspector-action="export"]');
      expect(action?.disabled).toBe(false);
      clickOn(action);
      expect(onExportRun).toHaveBeenCalledWith(expect.objectContaining({ range: [2, 3, 4] }));
    } finally {
      unmount();
    }
  });

  it("disables the office writers with the shipped reason when the bridge is absent", () => {
    const { host, unmount } = mountExport({
      format: "xlsx",
      bridge: { xlsx: false, pptx: false },
    });
    try {
      const reason = host.querySelector("[data-export-config-gate-reason]");
      expect(reason).not.toBeNull();
      expect(reason?.textContent).toBe(OFFICE_EXPORT_DISABLED_REASON);
      expect(
        host.querySelector<HTMLButtonElement>('[data-inspector-action="export"]')?.disabled,
      ).toBe(true);
    } finally {
      unmount();
    }
  });

  it("hides image-only options for non-PDF formats", () => {
    const txt = mountExport({ format: "txt" });
    try {
      expect(txt.host.querySelector("[data-export-config-dpi]")).toBeNull();
      expect(txt.host.querySelector('[data-export-fidelity-notes="txt"]')).not.toBeNull();
    } finally {
      txt.unmount();
    }
    const png = mountExport({ format: "png" });
    try {
      expect(png.host.querySelector("[data-export-config-dpi]")).not.toBeNull();
    } finally {
      png.unmount();
    }
  });

  it("never adds an export-time flatten toggle", () => {
    const { host, unmount } = mountExport({ format: "txt" });
    try {
      expect(textLower(host)).not.toContain("flatten");
    } finally {
      unmount();
    }
  });

  it("renders real export progress / failure / success", () => {
    const running = mountExport({
      status: { state: "running", current: 1, total: 3 },
    });
    try {
      expect(running.host.querySelector("[data-export-config-progress]")?.textContent).toContain("1");
    } finally {
      running.unmount();
    }
    const failure = mountExport({ format: "docx", status: { state: "error", message: "Disk full" } });
    try {
      expect(failure.host.querySelector("[data-export-config-error]")?.textContent).toContain(
        "Disk full",
      );
    } finally {
      failure.unmount();
    }
    const success = mountExport({ status: { state: "success", message: "Done" } });
    try {
      expect(success.host.querySelector("[data-export-config-success]")?.textContent).toContain(
        "Done",
      );
    } finally {
      success.unmount();
    }
  });
});

describe("Phase 112 C5 - the export-config model", () => {
  it("names the scope and resolves the range through the shared parser", () => {
    expect(exportScopeLabel("all")).toBe("All pages");
    expect(exportScopeLabel("current")).toBe("Current page");
    expect(exportScopeLabel("custom")).toBe("Custom range");
    expect(exportRangeText("all", "", 5, 1)).toBe("1-5");
    expect(exportRangeText("current", "", 5, 3)).toBe("3");
    expect(exportRangeText("custom", "2,4", 5, 1)).toBe("2,4");
    expect(validateExportRange("1-3", 5).valid).toBe(true);
    expect(validateExportRange("9-2", 5).valid).toBe(false);
    expect(validateExportRange("", 5).valid).toBe(false);
    expect(validateExportRange("1-3", 0).error).toBe("Open a document first.");
  });

  it("gates office formats on the bridge and leaves the others document-gated", () => {
    expect(exportConfigGate("png", { hasDocument: true, bridgePresent: false }).enabled).toBe(true);
    expect(
      exportConfigGate("xlsx", { hasDocument: true, bridgePresent: false }),
    ).toEqual({ enabled: false, reason: OFFICE_EXPORT_DISABLED_REASON });
    expect(exportConfigGate("png", { hasDocument: false, bridgePresent: false }).enabled).toBe(
      false,
    );
  });

  it("exposes fidelity only for office formats and a real primary label", () => {
    expect(exportFidelityNotes("png")).toBeNull();
    expect(exportFidelityNotes("docx")?.length).toBeGreaterThan(0);
    expect(exportPrimaryLabel("png")).toBe("Export images");
    expect(exportPrimaryLabel("docx")).toContain("Word");
    expect(exportDefaultName("Report.pdf", "png")).toBe("Report.png");
  });
});

// Phase 112 (C5 follow-up, TFL-985) - the Deliver inspector's prepared request
// must reach the EXISTING export dialog's initial props, so clicking Export
// honours exactly what the user configured (format / range / DPI / output
// name). The dialog still owns parsing, validation and the save.
describe("Phase 112 C5 follow-up - the inspector request seeds the export dialog", () => {
  it("renders the prepared pages as a compact range expression", () => {
    expect(exportRangeExpression([1, 2, 3, 4, 5])).toBe("1-5");
    expect(exportRangeExpression([2, 4])).toBe("2,4");
    expect(exportRangeExpression([1, 2, 3, 5, 7, 8, 9])).toBe("1-3,5,7-9");
    // Dedupes and sorts.
    expect(exportRangeExpression([3, 1, 2, 2])).toBe("1-3");
    expect(exportRangeExpression([])).toBe("");
  });

  it("derives the filename stem from the prepared output name", () => {
    expect(exportOutputNameStem("Report.png")).toBe("Report");
    expect(exportOutputNameStem("archive.tar.png")).toBe("archive.tar");
    expect(exportOutputNameStem("Report")).toBe("Report");
  });

  it("maps the inspector's emitted request into the dialog initial props", () => {
    const onExportRun = vi.fn();
    const inspector = mountExport({ format: "jpeg", onExportRun });
    try {
      clickOn(inspector.host.querySelector('[data-export-config-scope="custom"]'));
      const range = inspector.host.querySelector<HTMLInputElement>("[data-export-config-range]");
      setInputValue(range as HTMLInputElement, "2-4");
      const dpi = inspector.host.querySelector<HTMLInputElement>("[data-export-config-dpi-input]");
      setInputValue(dpi as HTMLInputElement, "300");
      clickOn(inspector.host.querySelector('[data-inspector-action="export"]'));
    } finally {
      inspector.unmount();
    }

    expect(onExportRun).toHaveBeenCalledTimes(1);
    const request = onExportRun.mock.calls[0]?.[0] as InspectorExportRequest;
    const seed = exportDialogSeed(request);
    expect(seed).toEqual({
      format: "jpeg",
      initialRange: "2-4",
      initialDpi: 300,
      initialOutputName: "Report.jpeg",
    });

    // The real dialog honours the seeded props.
    const dialog = mount(
      <ExportDialog
        open
        totalPages={5}
        initialFormat="jpeg"
        initialDpi={seed.initialDpi ?? 150}
        initialRange={seed.initialRange}
        initialOutputName={seed.initialOutputName}
        runExport={async (): Promise<[]> => []}
        onConfirm={(): void => undefined}
        sourceName="Report.pdf"
        onClose={(): void => undefined}
      />,
    );
    try {
      expect(
        dialog.host.querySelector<HTMLInputElement>("[data-export-range]")?.value,
      ).toBe("2-4");
      expect(
        dialog.host.querySelector<HTMLInputElement>("[data-export-dpi]")?.value,
      ).toBe("300");
      expect(
        dialog.host.querySelector<HTMLInputElement>('[data-export-format="jpeg"]')?.checked,
      ).toBe(true);
    } finally {
      dialog.unmount();
    }
  });

  it("seeds the text / docx / office dialogs with the prepared range and DPI", () => {
    const text = mount(
      <TextExportDialog
        open
        totalPages={5}
        runExport={async (): Promise<[]> => []}
        onConfirm={(): void => undefined}
        sourceName="Report.pdf"
        initialRange="2,4"
        initialOutputName="Report.txt"
        onClose={(): void => undefined}
      />,
    );
    try {
      expect(
        text.host.querySelector<HTMLInputElement>("[data-text-export-range]")?.value,
      ).toBe("2,4");
    } finally {
      text.unmount();
    }

    const docx = mount(
      <DocxExportDialog
        open
        totalPages={5}
        runEngineExport={async (): Promise<[]> => []}
        runAssemble={async (): Promise<{ error: string }> => ({ error: "unused" })}
        onConfirm={(): void => undefined}
        sourceName="Report.pdf"
        initialRange="3"
        initialDpi={220}
        initialOutputName="Report.docx"
        onClose={(): void => undefined}
      />,
    );
    try {
      expect(
        docx.host.querySelector<HTMLInputElement>("[data-docx-export-range]")?.value,
      ).toBe("3");
      expect(
        docx.host.querySelector<HTMLInputElement>("[data-docx-export-dpi]")?.value,
      ).toBe("220");
    } finally {
      docx.unmount();
    }

    const office = mount(
      <OfficeExportDialog
        open
        format="xlsx"
        totalPages={5}
        sourceName="Report.pdf"
        docId="doc-1"
        client={undefined}
        runEngineExport={async (): Promise<[]> => []}
        onConfirm={(): void => undefined}
        initialRange="1-2"
        initialDpi={200}
        initialOutputName="Report.xlsx"
        onClose={(): void => undefined}
      />,
    );
    try {
      expect(
        office.host.querySelector<HTMLInputElement>("[data-office-export-range]")?.value,
      ).toBe("1-2");
      expect(
        office.host.querySelector<HTMLInputElement>("[data-office-export-dpi]")?.value,
      ).toBe("200");
    } finally {
      office.unmount();
    }
  });
});
