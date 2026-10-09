// @vitest-environment jsdom
//
// Phase 57 (feature B, part 2) — the "Export / Import form data" verbs.
//
// Four halves:
//   1. The two registry entries: REVIEW stage, shared `form-fields`
//      precondition, distinct action ids and app-wide-unique icons.
//   2. The live ToolsPalette gate: disabled without form fields, enabled
//      with them, and absent when the host did not wire the handler.
//   3. The App wiring source contract: the import path refreshes form state
//      through `syncEngineStateAfterFill`, and the export path writes the
//      bytes with `saveFormDataFile` AFTER `exportFormData` returns them.
//   4. The dialog render contract: the three-list report (the unmatched
//      list states no field was created) and the format selector pass-through.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { ToolsPalette } from "../../../src/renderer/components/ToolsPalette";
import {
  TOOL_REGISTRY,
  toolById,
} from "../../../src/renderer/state/toolsRegistry";
import { DOCK_AVAILABILITY_REASON } from "../../../src/renderer/state/dockModel";
import { FormDataIoDialog } from "../../../src/renderer/components/FormDataIoDialog";
import type { FormDataImportReport } from "../../../src/shared/types";

function mountPalette(args: {
  documentRequired: boolean;
  hasFormFields: boolean;
  onExportFormData?: () => void;
  onImportFormData?: () => void;
}): { host: HTMLElement; handlers: Array<ReturnType<typeof vi.fn> | undefined> } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const exportHandler =
    args.onExportFormData === undefined ? undefined : vi.fn(args.onExportFormData);
  const importHandler =
    args.onImportFormData === undefined ? undefined : vi.fn(args.onImportFormData);
  act((): void => {
    root.render(
      <ToolsPalette
        layout="list"
        onLayoutChange={(): void => undefined}
        onMerge={(): void => undefined}
        onSplit={(): void => undefined}
        onExtract={(): void => undefined}
        onRotate={(): void => undefined}
        onDelete={(): void => undefined}
        onSign={(): void => undefined}
        onOptimize={(): void => undefined}
        onAudit={(): void => undefined}
        onClose={(): void => undefined}
        hasOcrSuspects={false}
        documentRequired={args.documentRequired}
        hasFormFields={args.hasFormFields}
        onExportFormData={exportHandler}
        onImportFormData={importHandler}
      />,
    );
  });
  return { host, handlers: [exportHandler, importHandler] };
}

describe("form-data verbs — registry contract", () => {
  it("registers both verbs on REVIEW with the shared form-fields precondition", () => {
    for (const id of ["exportFormData", "importFormData"] as const) {
      const entry = toolById(id);
      expect(entry, id).toBeDefined();
      expect(entry?.availability, id).toBe("form-fields");
      expect(entry?.stage, id).toBe("review");
      expect(entry?.action, id).toBe(id);
    }
    // The disabled copy the user sees is the shared dock line.
    expect(DOCK_AVAILABILITY_REASON["form-fields"]).toBe("This document has no form fields");
  });

  it("gives each verb a distinct, app-wide-unique icon", () => {
    const exportIcon = toolById("exportFormData")?.icon;
    const importIcon = toolById("importFormData")?.icon;
    expect(exportIcon).toBeDefined();
    expect(importIcon).toBeDefined();
    expect(exportIcon).not.toBe(importIcon);
    const icons = TOOL_REGISTRY.map((e) => e.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe("form-data verbs — live ToolsPalette gate", () => {
  it("is DISABLED for both verbs without form fields", () => {
    const { host } = mountPalette({
      documentRequired: true,
      hasFormFields: false,
      onExportFormData: (): void => undefined,
      onImportFormData: (): void => undefined,
    });
    for (const id of ["exportFormData", "importFormData"]) {
      const btn = host.querySelector<HTMLButtonElement>(`[data-tool-id='${id}']`);
      expect(btn, id).not.toBeNull();
      expect(btn?.disabled, id).toBe(true);
    }
    host.remove();
  });

  it("is ENABLED and clickable for both verbs with form fields", () => {
    const { host, handlers } = mountPalette({
      documentRequired: true,
      hasFormFields: true,
      onExportFormData: (): void => undefined,
      onImportFormData: (): void => undefined,
    });
    for (const id of ["exportFormData", "importFormData"]) {
      const btn = host.querySelector<HTMLButtonElement>(`[data-tool-id='${id}']`);
      expect(btn?.disabled, id).toBe(false);
      act((): void => {
        btn?.click();
      });
    }
    expect(handlers[0]).toHaveBeenCalledTimes(1);
    expect(handlers[1]).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it("bridge-absent: an unwired verb does not render and nothing throws", () => {
    expect((): void => {
      const { host } = mountPalette({ documentRequired: true, hasFormFields: true });
      expect(host.querySelector("[data-tool-id='exportFormData']")).toBeNull();
      expect(host.querySelector("[data-tool-id='importFormData']")).toBeNull();
      host.remove();
    }).not.toThrow();
  });
});

describe("form-data verbs — App wiring source contract", () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "src", "renderer", "App.tsx"),
    "utf8",
  );

  it("imports through the engine bridge and refreshes form state with syncEngineStateAfterFill", () => {
    const call = appSource.indexOf("engineRef.current.importFormData(");
    expect(call).toBeGreaterThan(-1);
    expect(appSource.slice(call, call + 700)).toMatch(/syncEngineStateAfterFill\(activeId\)/);
  });

  it("exports the bytes first, then writes them with saveFormDataFile", () => {
    const exported = appSource.indexOf("engineRef.current.exportFormData(");
    const saved = appSource.indexOf("window.tflex.saveFormDataFile(");
    expect(exported).toBeGreaterThan(-1);
    expect(saved).toBeGreaterThan(exported);
  });

  it("loads the picked file with loadFormData", () => {
    expect(appSource).toMatch(/window\.tflex\.loadFormData\(path\)/);
  });

  it("picks through the 'formData' dialog kind", () => {
    expect(appSource).toMatch(/window\.tflex\.openFileDialog\("formData"\)/);
  });

  it("wires both verbs into the dock/palette handler map", () => {
    expect(appSource).toMatch(/exportFormData: onExportFormDataClick,/);
    expect(appSource).toMatch(/importFormData: onImportFormDataClick,/);
  });
});

describe("FormDataIoDialog — render contract", () => {
  it("renders the three-list report, stating no field was created for unmatched names", async () => {
    const report: FormDataImportReport = {
      matched: ["Name", "Email"],
      unmatched: ["LEGACY_ID"],
      empty: ["Phone"],
    };
    const pickFormDataFile = vi.fn(async (): Promise<string> => "C:/data/values.xfdf");
    const runImport = vi.fn(async () => ({ report, path: "C:/data/values.xfdf" }));
    const onApplied = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(
        <FormDataIoDialog
          open={true}
          mode="import"
          pickFormDataFile={pickFormDataFile}
          runExport={async () => ({ error: "unused" })}
          runImport={runImport}
          onApplied={onApplied}
          onClose={(): void => undefined}
        />,
      );
    });

    const pick = host.querySelector<HTMLButtonElement>("[data-testid='form-data-import-pick']");
    await act(async (): Promise<void> => {
      pick?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const run = host.querySelector<HTMLButtonElement>("[data-testid='form-data-import-run']");
    await act(async (): Promise<void> => {
      run?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runImport).toHaveBeenCalledWith("xfdf", "C:/data/values.xfdf");
    expect(host.querySelector("[data-form-data-report]")).not.toBeNull();
    expect(host.querySelector("[data-form-data-imported]")?.textContent).toContain("2");
    expect(host.querySelectorAll("[data-testid='form-data-matched-item']")).toHaveLength(2);
    expect(host.querySelectorAll("[data-testid='form-data-unmatched-item']")).toHaveLength(1);
    expect(host.querySelectorAll("[data-testid='form-data-empty-item']")).toHaveLength(1);
    expect(host.textContent).toContain("Fields updated");
    expect(host.textContent).toContain("Names not in this document");
    expect(host.textContent).toContain("Fields with no data");
    expect(host.textContent).toMatch(/no field was created/i);
    expect(onApplied).toHaveBeenCalledWith({
      kind: "import",
      report,
      path: "C:/data/values.xfdf",
    });
    act((): void => root.unmount());
    host.remove();
  });

  it("defaults to XFDF and passes the chosen format through to runExport", async () => {
    const runExport = vi.fn(async () => ({ path: "C:/out.xfdf", count: 3 }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(
        <FormDataIoDialog
          open={true}
          mode="export"
          pickFormDataFile={async () => null}
          runExport={runExport}
          runImport={async () => ({ error: "unused" })}
          onApplied={(): void => undefined}
          onClose={(): void => undefined}
        />,
      );
    });

    expect(host.querySelector("[data-testid='form-data-format-xfdf']")?.getAttribute("aria-pressed")).toBe("true");
    const run = host.querySelector<HTMLButtonElement>("[data-testid='form-data-export-run']");
    await act(async (): Promise<void> => {
      run?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runExport).toHaveBeenLastCalledWith("xfdf");

    const fdf = host.querySelector<HTMLButtonElement>("[data-testid='form-data-format-fdf']");
    act((): void => {
      fdf?.click();
    });
    await act(async (): Promise<void> => {
      run?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runExport).toHaveBeenLastCalledWith("fdf");
    expect(host.querySelector("[data-form-data-export-result]")).not.toBeNull();

    act((): void => root.unmount());
    host.remove();
  });

  it("treats an explicit cancelled export as a silent no-op", async () => {
    const runExport = vi.fn(async () => ({ cancelled: true as const }));
    const onApplied = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(
        <FormDataIoDialog
          open={true}
          mode="export"
          pickFormDataFile={async () => null}
          runExport={runExport}
          runImport={async () => ({ error: "unused" })}
          onApplied={onApplied}
          onClose={(): void => undefined}
        />,
      );
    });

    const run = host.querySelector<HTMLButtonElement>("[data-testid='form-data-export-run']");
    await act(async (): Promise<void> => {
      run?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runExport).toHaveBeenCalledWith("xfdf");
    // No error box, no success block, no applied callback: a silent no-op.
    expect(host.querySelector("[data-form-data-error]")).toBeNull();
    expect(host.querySelector("[data-form-data-export-result]")).toBeNull();
    expect(onApplied).not.toHaveBeenCalled();
    // The run button is re-enabled (the dialog did not get stuck busy).
    expect(run?.disabled).toBe(false);

    act((): void => root.unmount());
    host.remove();
  });
});
