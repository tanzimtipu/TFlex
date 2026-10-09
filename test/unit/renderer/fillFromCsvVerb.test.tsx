// @vitest-environment jsdom
//
// Phase 53 (feature G mode 2) — the "Fill form fields from CSV" verb.
//
// Two halves:
//   1. The registry entry + the live ToolsPalette gate: the verb is
//      disabled without a document and with a document that has no form
//      fields, and enabled (and wired) only when the active document has
//      AcroForm fields. The refusal copy is the shared dock availability
//      line, so the two surfaces can never disagree.
//   2. The bridge-absent guard: with no `onFillFromCsv` the entry does not
//      render at all (fail loud: no dead control), and nothing throws.
//   3. The App wiring source contract: the handler calls
//      `convert.csvToDocumentFields` with the ACTIVE document's engine id
//      and guards the optional bridge.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { ToolsPalette } from "../../../src/renderer/components/ToolsPalette";
import { toolById } from "../../../src/renderer/state/toolsRegistry";
import { DOCK_AVAILABILITY_REASON } from "../../../src/renderer/state/dockModel";

function mountPalette(args: {
  documentRequired: boolean;
  hasFormFields: boolean;
  onFillFromCsv?: () => void;
}): { host: HTMLElement; onFillFromCsv: ReturnType<typeof vi.fn> | undefined } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  // Carry the REAL `undefined` through so the bridge-absent case is real.
  const onFillFromCsv =
    args.onFillFromCsv === undefined ? undefined : vi.fn(args.onFillFromCsv);
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
        onFillFromCsv={onFillFromCsv}
      />,
    );
  });
  return { host, onFillFromCsv };
}

describe("fillFromCsv — registry and live gate", () => {
  it("declares the form-fields precondition and a distinct action id", () => {
    const entry = toolById("fillFromCsv");
    expect(entry).toBeDefined();
    expect(entry?.availability).toBe("form-fields");
    expect(entry?.action).toBe("fillFromCsv");
    expect(entry?.stage).toBe("review");
    // The disabled copy the user sees is the shared dock line.
    expect(DOCK_AVAILABILITY_REASON["form-fields"]).toBe("This document has no form fields");
  });

  it("is DISABLED with no open document", () => {
    const { host } = mountPalette({ documentRequired: false, hasFormFields: false, onFillFromCsv: (): void => undefined });
    const btn = host.querySelector<HTMLButtonElement>("[data-tool-id='fillFromCsv']");
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(true);
    host.remove();
  });

  it("is DISABLED with a document that has no form fields", () => {
    const { host } = mountPalette({ documentRequired: true, hasFormFields: false, onFillFromCsv: (): void => undefined });
    const btn = host.querySelector<HTMLButtonElement>("[data-tool-id='fillFromCsv']");
    expect(btn?.disabled).toBe(true);
    host.remove();
  });

  it("is ENABLED and clickable with a document that has form fields", () => {
    const { host, onFillFromCsv } = mountPalette({
      documentRequired: true,
      hasFormFields: true,
      onFillFromCsv: (): void => undefined,
    });
    const btn = host.querySelector<HTMLButtonElement>("[data-tool-id='fillFromCsv']");
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(false);
    act((): void => {
      btn?.click();
    });
    expect(onFillFromCsv).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it("bridge-absent: an unwired verb does not render and nothing throws", () => {
    expect((): void => {
      const { host } = mountPalette({ documentRequired: true, hasFormFields: true });
      expect(host.querySelector("[data-tool-id='fillFromCsv']")).toBeNull();
      host.remove();
    }).not.toThrow();
  });
});

describe("fillFromCsv — App wiring source contract", () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "src", "renderer", "App.tsx"),
    "utf8",
  );

  it("calls csvToDocumentFields with the ACTIVE document's engine id and the path", () => {
    expect(appSource).toMatch(
      /convert\.csvToDocumentFields\(open\.session\.engineDocId, path\)/,
    );
  });

  it("guards the optional bridge", () => {
    expect(appSource).toMatch(/convert\?\.csvToDocumentFields === undefined/);
  });

  it("reuses the existing form-state refresh path (syncEngineStateAfterFill)", () => {
    const call = appSource.indexOf("convert.csvToDocumentFields(open.session.engineDocId, path)");
    expect(call).toBeGreaterThan(-1);
    expect(appSource.slice(call, call + 900)).toMatch(/syncEngineStateAfterFill\(activeId\)/);
  });

  it("picks the CSV through the existing 'document' dialog kind", () => {
    expect(appSource).toMatch(/window\.tflex\.openFileDialog\("document"\)/);
  });

  it("wires the verb into the dock/palette handler map", () => {
    expect(appSource).toMatch(/fillFromCsv: onFillFromCsvClick,/);
  });

  it("mounts the dialog with the host handlers", () => {
    expect(appSource).toMatch(/<FillFromCsvDialog[\s\S]*?runCsvFill=\{runCsvToFieldsForActiveTab\}/);
    expect(appSource).toMatch(/<FillFromCsvDialog[\s\S]*?pickCsvFile=\{pickCsvFile\}/);
  });

  it("surfaces convertDefaults in Preferences through the settings path", () => {
    expect(appSource).toMatch(/convertDefaults=\{settings\.convertDefaults \?\? DEFAULT_CONVERT_DEFAULTS\}/);
    expect(appSource).toMatch(/onSetConvertDefaults=\{/);
  });
});
