// @vitest-environment jsdom
//
// Phase 55 (feature D) — the office export surfaces.
//
// This pins the reachability of the two new writers AND the mandatory fidelity
// warning on every export surface:
//   - the two verbs exist in the registry on the DELIVER dock (the live surface
//     the existing export verbs reach) and their live gate distinguishes
//     "no document" from "bridge absent";
//   - the dialogs call `window.tflex.export.xlsx|pptx` as MEMBERS of the client
//     object (a detached local would throw — DEF-106 / DEF-374);
//   - every export surface renders EVERY fidelity note for its format, imported
//     from `EXPORT_FIDELITY_NOTES` (never retyped);
//   - `pagesWithoutText` is surfaced when non-empty and silent when empty;
//   - a typed failure renders readable copy and downloads nothing.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import {
  EXPORT_FIDELITY_NOTES,
  type ExportBuild,
  type ExportFormat,
} from "../../../src/shared/export";
import { err, ok } from "../../../src/shared/result";
import type { TFlexApiExport } from "../../../src/shared/ipc";
import { OfficeExportDialog } from "../../../src/renderer/components/OfficeExportDialog";
import { DocxExportDialog } from "../../../src/renderer/components/DocxExportDialog";
import { TextExportDialog } from "../../../src/renderer/components/TextExportDialog";
import {
  DOCK_AVAILABILITY_REASON,
  OFFICE_EXPORT_DISABLED_REASON,
  OFFICE_EXPORT_NO_DOCUMENT_REASON,
  dockEnabledWithFallback,
  officeExportGate,
} from "../../../src/renderer/state/dockModel";
import {
  dockToolsForStage,
  toolById,
} from "../../../src/renderer/state/toolsRegistry";

// jsdom has no canvas backend, so the dialog's per-page rasterize step is
// stubbed exactly like the docx dialog test does.
vi.mock("../../../src/renderer/pdf/rasterize", () => ({
  rasterizePageToBlob: async (): Promise<{ blob: Blob; width: number; height: number }> => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    return { blob: new Blob([bytes], { type: "image/png" }), width: 612, height: 792 };
  },
}));

function mount(node: ReactElement): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(node);
  });
  return {
    host,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function makeBuild(format: ExportFormat, pagesWithoutText: number[]): ExportBuild {
  return {
    format,
    bytes: new Uint8Array([1, 2, 3, 4]),
    fidelityNotes: EXPORT_FIDELITY_NOTES[format],
    pagesWithoutText,
  };
}

/** A client whose methods read `this.inner`: a detached local loses `this` and
 *  throws, so the member call is proven by the call being recorded at all. */
function makeClient(): {
  client: TFlexApiExport;
  calls: Array<{ member: "xlsx" | "pptx"; docId: string; payload: unknown }>;
} {
  const calls: Array<{ member: "xlsx" | "pptx"; docId: string; payload: unknown }> = [];
  const client = {
    inner: {
      xlsx(docId: string, payload: unknown) {
        calls.push({ member: "xlsx", docId, payload });
        return Promise.resolve(ok(makeBuild("xlsx", [2, 5])));
      },
      pptx(docId: string, payload: unknown) {
        calls.push({ member: "pptx", docId, payload });
        return Promise.resolve(ok(makeBuild("pptx", [])));
      },
    },
    xlsx(docId: string, payload?: unknown) {
      return this.inner.xlsx(docId, payload);
    },
    pptx(docId: string, payload?: unknown) {
      return this.inner.pptx(docId, payload);
    },
  };
  return { client: client as unknown as TFlexApiExport, calls };
}

const RUN_ENGINE_EXPORT = async (): Promise<
  { pageIndex: number; buffer: Uint8Array; format: "png"; width: number; height: number }[]
> => [
  { pageIndex: 1, buffer: new Uint8Array([1]), format: "png", width: 612, height: 792 },
  { pageIndex: 2, buffer: new Uint8Array([2]), format: "png", width: 612, height: 792 },
];

describe("phase 55 — the two office verbs are registered on the live dock surface", () => {
  it("registers exportXlsx/exportPptx as DELIVER dock verbs", () => {
    const ids = dockToolsForStage("deliver").map((e) => e.id);
    expect(ids).toContain("exportXlsx");
    expect(ids).toContain("exportPptx");
    for (const id of ["exportXlsx", "exportPptx"] as const) {
      const entry = toolById(id);
      expect(entry, id).toBeDefined();
      expect(entry?.action, id).toBe(id);
      expect(entry?.stage, id).toBe("deliver");
      expect(entry?.surface, id).toBe("dock");
      expect(entry?.availability, id).toBe("office-export");
      expect(entry?.label.trim().length, id).toBeGreaterThan(0);
      expect(entry?.description.trim().length, id).toBeGreaterThan(10);
    }
  });

  it("disables with a DIFFERENT reason for no-document vs bridge-absent", () => {
    const noDocument = officeExportGate({ hasDocument: false, bridgePresent: true });
    expect(noDocument.enabled).toBe(false);
    expect(noDocument.reason).toBe(OFFICE_EXPORT_NO_DOCUMENT_REASON);
    const noBridge = officeExportGate({ hasDocument: true, bridgePresent: false });
    expect(noBridge.enabled).toBe(false);
    expect(noBridge.reason).toBe(OFFICE_EXPORT_DISABLED_REASON);
    expect(noBridge.reason).not.toBe(noDocument.reason);
    expect(officeExportGate({ hasDocument: true, bridgePresent: true })).toEqual({
      enabled: true,
      reason: undefined,
    });
    // The dock's static fallback copy is the bridge-absent one.
    expect(DOCK_AVAILABILITY_REASON["office-export"]).toBe(OFFICE_EXPORT_DISABLED_REASON);
  });

  it("the dock's shared gate reads the live office gate", () => {
    const entry = toolById("exportXlsx");
    if (entry === undefined) throw new Error("missing exportXlsx");
    const base = {
      pageSelectionCount: 0,
      editModeOpen: false,
      canUndo: false,
      canRedo: false,
      viewActions: {},
    };
    const enabled = (hasDocument: boolean, bridgePresent: boolean): boolean =>
      dockEnabledWithFallback(entry, {
        ...base,
        appEnabled: () => officeExportGate({ hasDocument, bridgePresent }).enabled,
      });
    expect(enabled(false, true)).toBe(false);
    expect(enabled(true, false)).toBe(false);
    expect(enabled(true, true)).toBe(true);
  });

  it("App wires the verbs, the live bridge gate and the dialogs end to end", () => {
    const app = readFileSync(resolve(__dirname, "../../../src/renderer/App.tsx"), "utf8");
    expect(app).toMatch(/exportXlsx: onXlsxExportClick,/);
    expect(app).toMatch(/exportPptx: onPptxExportClick,/);
    expect(app).toMatch(/typeof window\.tflex\.export\?\.xlsx === "function"/);
    expect(app).toMatch(/typeof window\.tflex\.export\?\.pptx === "function"/);
    expect(app).toMatch(/case "office-export":[\s\S]{0,160}officeExportGate\(/);
    expect(app).toMatch(/<OfficeExportDialog[\s\S]*?format="xlsx"/);
    expect(app).toMatch(/<OfficeExportDialog[\s\S]*?format="pptx"/);
    expect(app).toMatch(/client=\{window\.tflex\.export as TFlexApiExport \| undefined\}/);
    expect(app).toMatch(/docId=\{activeTab\?\.session\.engineDocId \?\? null\}/);
    expect(app).toMatch(/onConfirm=\{onXlsxExportConfirm\}/);
    expect(app).toMatch(/onConfirm=\{onPptxExportConfirm\}/);
  });
});

describe("phase 55 — the mandatory fidelity warning on ALL FOUR export surfaces", () => {
  const FORMATS: readonly ExportFormat[] = ["txt", "docx", "xlsx", "pptx"];

  function assertNotes(host: HTMLElement, format: ExportFormat): void {
    const block = host.querySelector(`[data-export-fidelity-notes="${format}"]`);
    expect(block, `${format}: fidelity block present`).not.toBeNull();
    const items = [...host.querySelectorAll("[data-export-fidelity-note]")].map(
      (el) => el.textContent,
    );
    const expected = EXPORT_FIDELITY_NOTES[format];
    // Every note renders, verbatim and in order.
    expect(items, `${format}: all notes`).toEqual([...expected]);
    expect(items.length, `${format}: non-empty`).toBeGreaterThan(0);
  }

  it("the txt and docx dialogs render their complete note set", () => {
    const txt = mount(
      createElement(TextExportDialog, {
        open: true,
        totalPages: 3,
        runExport: async () => [],
        onConfirm: (): void => undefined,
        sourceName: "report.pdf",
        onClose: (): void => undefined,
      }),
    );
    try {
      assertNotes(txt.host, "txt");
    } finally {
      txt.cleanup();
    }
    const docx = mount(
      createElement(DocxExportDialog, {
        open: true,
        totalPages: 3,
        runEngineExport: async () => [],
        runAssemble: async () => new Uint8Array(0),
        onConfirm: (): void => undefined,
        sourceName: "report.pdf",
        onClose: (): void => undefined,
      }),
    );
    try {
      assertNotes(docx.host, "docx");
    } finally {
      docx.cleanup();
    }
  });

  it("the two office dialogs each render their complete note set", () => {
    for (const format of ["xlsx", "pptx"] as const) {
      const { client } = makeClient();
      const view = mount(
        createElement(OfficeExportDialog, {
          open: true,
          format,
          totalPages: 3,
          sourceName: "report.pdf",
          docId: "doc-1",
          client,
          runEngineExport: RUN_ENGINE_EXPORT,
          onConfirm: (): void => undefined,
          onClose: (): void => undefined,
        }),
      );
      try {
        assertNotes(view.host, format);
      } finally {
        view.cleanup();
      }
    }
  });

  it("the four note sets are pairwise different (no copy-paste mix-up)", () => {
    const rendered = FORMATS.map((f) => EXPORT_FIDELITY_NOTES[f].join("\n"));
    expect(new Set(rendered).size).toBe(FORMATS.length);
  });
});

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

beforeEach((): void => {
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn(
    () => "blob:phase55-test",
  );
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
});

afterEach((): void => {
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = realCreate;
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = realRevoke;
});

async function clickConfirm(host: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    host.querySelector<HTMLButtonElement>("[data-office-export-confirm]")?.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

function renderOffice(
  format: "xlsx" | "pptx",
  client: TFlexApiExport,
  runEngineExport = RUN_ENGINE_EXPORT,
): { host: HTMLElement; cleanup: () => void; onConfirm: ReturnType<typeof vi.fn> } {
  const onConfirm = vi.fn();
  const view = mount(
    createElement(OfficeExportDialog, {
      open: true,
      format,
      totalPages: 2,
      sourceName: "report.pdf",
      docId: "doc-1",
      client,
      runEngineExport,
      onConfirm,
      onClose: (): void => undefined,
    }),
  );
  return { ...view, onConfirm };
}

describe("phase 55 — the office dialogs call the bridge as a MEMBER", () => {
  it("xlsx: calls client.xlsx(docId, {images}) with the rasterised entries, then downloads", async () => {
    const { client, calls } = makeClient();
    const { host, cleanup, onConfirm } = renderOffice("xlsx", client);
    try {
      await clickConfirm(host);
      // The mock records only when `this` survived — an extracted local would
      // have thrown before the push (DEF-106 / DEF-374).
      expect(calls).toEqual([
        { member: "xlsx", docId: "doc-1", payload: { images: expect.any(Array) } },
      ]);
      const payload = calls[0]?.payload as { images: Array<{ pageNumber: number }> };
      expect(payload.images).toHaveLength(2);
      expect(payload.images[0]?.pageNumber).toBe(1);
      expect(payload.images[1]?.pageNumber).toBe(2);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(host.querySelector("[role='alert']")).toBeNull();
      expect(onConfirm).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("pptx: calls client.pptx(docId, {entries})", async () => {
    const { client, calls } = makeClient();
    const { host, cleanup } = renderOffice("pptx", client);
    try {
      await clickConfirm(host);
      expect(calls).toEqual([
        { member: "pptx", docId: "doc-1", payload: { entries: expect.any(Array) } },
      ]);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });
});

describe("phase 55 — honest results and failures", () => {
  it("surfaces every page with no extractable text when the build reports one", async () => {
    const { client } = makeClient(); // xlsx build carries pagesWithoutText [2,5]
    const { host, cleanup } = renderOffice("xlsx", client);
    try {
      await clickConfirm(host);
      const notice = host.querySelector("[data-export-pages-without-text]");
      expect(notice).not.toBeNull();
      expect(notice?.textContent ?? "").toContain("2");
      expect(notice?.textContent ?? "").toContain("5");
    } finally {
      cleanup();
    }
  });

  it("renders NO such notice when the build reports an empty list", async () => {
    const { client } = makeClient(); // pptx build carries pagesWithoutText []
    const { host, cleanup } = renderOffice("pptx", client);
    try {
      await clickConfirm(host);
      expect(host.querySelector("[data-export-pages-without-text]")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("renders a readable failure and creates no file / no success for a typed error", async () => {
    const failing = {
      inner: {
        xlsx() {
          return Promise.resolve(err("unsupported-format", "unsupported"));
        },
      },
      xlsx(this: { inner: { xlsx: () => Promise<unknown> } }) {
        return this.inner.xlsx();
      },
    } as unknown as TFlexApiExport;
    const { host, cleanup, onConfirm } = renderOffice("xlsx", failing);
    try {
      await clickConfirm(host);
      const alert = host.querySelector("[role='alert']");
      expect(alert?.textContent ?? "").toMatch(/not supported/i);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("a cancelled dialog (close) triggers no bridge call and no download", async () => {
    const { client, calls } = makeClient();
    const onClose = vi.fn();
    const view = mount(
      createElement(OfficeExportDialog, {
        open: true,
        format: "xlsx",
        totalPages: 2,
        sourceName: "report.pdf",
        docId: "doc-1",
        client,
        runEngineExport: RUN_ENGINE_EXPORT,
        onConfirm: (): void => undefined,
        onClose,
      }),
    );
    try {
      await act(async (): Promise<void> => {
        view.host.querySelector<HTMLButtonElement>("[data-office-export-close]")?.click();
        await Promise.resolve();
      });
      expect(calls).toHaveLength(0);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    } finally {
      view.cleanup();
    }
  });

  it("disables Export with no document id", () => {
    const { client } = makeClient();
    const view = mount(
      createElement(OfficeExportDialog, {
        open: true,
        format: "xlsx",
        totalPages: 2,
        sourceName: "report.pdf",
        docId: null,
        client,
        runEngineExport: RUN_ENGINE_EXPORT,
        onConfirm: (): void => undefined,
        onClose: (): void => undefined,
      }),
    );
    try {
      const confirm = view.host.querySelector<HTMLButtonElement>(
        "[data-office-export-confirm]",
      );
      expect(confirm?.disabled).toBe(true);
    } finally {
      view.cleanup();
    }
  });
});


