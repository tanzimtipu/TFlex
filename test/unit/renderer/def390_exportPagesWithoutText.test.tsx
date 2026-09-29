// @vitest-environment jsdom
//
// DEF-390 — the txt and docx export surfaces must NAME the pages that carried
// no extractable text, exactly as the xlsx/pptx surfaces already do.
//
// Phase 55 criterion 8: an export of a document containing an empty or
// image-only page must name the text-free pages. The office writers report
// `pagesWithoutText` in their build result; the txt/docx surfaces derive the
// same list from the existing `engine.exportText(docId)` channel. This file
// pins:
//   - both surfaces render `[data-export-pages-without-text]` with the right
//     page numbers, and render nothing when no page is text-free;
//   - `exportText` is called as a MEMBER of the client object (a mock whose
//     method reads `this.inner` throws if detached — DEF-106 / DEF-374);
//   - a failed extraction leaves the export working and renders no notice;
//   - the docx wording is honest for the engine's image-fallback behaviour;
//   - the same selector renders on all four export surfaces.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { DocxExportDialog } from "../../../src/renderer/components/DocxExportDialog";
import { TextExportDialog } from "../../../src/renderer/components/TextExportDialog";
import { OfficeExportDialog } from "../../../src/renderer/components/OfficeExportDialog";
import {
  pagesWithoutTextMessage,
  textFreePageNumbers,
  type TextFreePagesEngine,
} from "../../../src/renderer/utils/exportWithoutText";
import { err, ok } from "../../../src/shared/result";
import type { ExportBuild, ExportFormat } from "../../../src/shared/export";
import { EXPORT_FIDELITY_NOTES } from "../../../src/shared/export";
import type { TFlexApiExport } from "../../../src/shared/ipc";
import type { TextPage } from "../../../src/shared/types";

// jsdom has no canvas backend: stub the docx dialog's per-page rasterize.
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

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/**
 * A client whose `exportText` reads `this.inner`: an extracted local loses
 * `this` and throws before recording the call, so a recorded call proves the
 * member call survived.
 */
function makeEngine(pages: TextPage[] | "reject"): {
  engine: TextFreePagesEngine;
  calls: string[];
} {
  const calls: string[] = [];
  const engine = {
    inner: {
      exportText(docId: string) {
        calls.push(docId);
        if (pages === "reject") return Promise.reject(new Error("boom"));
        return Promise.resolve(ok(pages));
      },
    },
    exportText(this: { inner: { exportText: (id: string) => Promise<unknown> } }, docId: string) {
      return this.inner.exportText(docId);
    },
  };
  return { engine: engine as unknown as TextFreePagesEngine, calls };
}

function renderDocx(engine: TextFreePagesEngine, close = (): void => undefined): {
  host: HTMLElement;
  cleanup: () => void;
  onConfirm: ReturnType<typeof vi.fn>;
} {
  const onConfirm = vi.fn();
  const view = mount(
    createElement(DocxExportDialog, {
      open: true,
      totalPages: 5,
      runEngineExport: async () => [],
      runAssemble: async () => new Uint8Array(0),
      onConfirm,
      sourceName: "image-only.pdf",
      docId: "doc-1",
      engine,
      onClose: close,
    }),
  );
  return { ...view, onConfirm };
}

function renderText(engine: TextFreePagesEngine): { host: HTMLElement; cleanup: () => void } {
  return mount(
    createElement(TextExportDialog, {
      open: true,
      totalPages: 5,
      runExport: async () => [],
      onConfirm: (): void => undefined,
      sourceName: "image-only.pdf",
      docId: "doc-1",
      engine,
      onClose: (): void => undefined,
    }),
  );
}

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

beforeEach((): void => {
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn(
    () => "blob:def390-test",
  );
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
});

afterEach((): void => {
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = realCreate;
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = realRevoke;
});

describe("DEF-390 — textFreePageNumbers", () => {
  it("returns the 1-based, sorted numbers of empty/whitespace-only pages", () => {
    const pages: TextPage[] = [
      { pageIndex: 1, text: "" },
      { pageIndex: 2, text: "hello" },
      { pageIndex: 3, text: "   \n\t " },
      { pageIndex: 4, text: "world" },
      { pageIndex: 5, text: "" },
    ];
    expect(textFreePageNumbers(pages)).toEqual([1, 3, 5]);
    expect(textFreePageNumbers([])).toEqual([]);
  });
});

describe("DEF-390 — the text surface names the text-free pages", () => {
  it("renders the notice for pages 2 and 5, calling exportText as a MEMBER", async () => {
    const { engine, calls } = makeEngine([
      { pageIndex: 1, text: "cover" },
      { pageIndex: 2, text: "" },
      { pageIndex: 3, text: "body" },
      { pageIndex: 4, text: "more" },
      { pageIndex: 5, text: "   " },
    ]);
    const { host, cleanup } = renderText(engine);
    try {
      await settle();
      // A recorded call means `this` survived the call: a detached local would
      // have thrown on `this.inner` before pushing (DEF-106 / DEF-374).
      expect(calls).toEqual(["doc-1"]);
      const notice = host.querySelector("[data-export-pages-without-text]");
      expect(notice).not.toBeNull();
      expect(notice?.textContent ?? "").toContain("2, 5");
    } finally {
      cleanup();
    }
  });

  it("renders no notice when every page has text", async () => {
    const { engine } = makeEngine([
      { pageIndex: 1, text: "cover" },
      { pageIndex: 2, text: "body" },
    ]);
    const { host, cleanup } = renderText(engine);
    try {
      await settle();
      expect(host.querySelector("[data-export-pages-without-text]")).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("DEF-390 — the docx surface names the text-free pages", () => {
  it("renders the notice for pages 2 and 5, calling exportText as a MEMBER", async () => {
    const { engine, calls } = makeEngine([
      { pageIndex: 1, text: "cover" },
      { pageIndex: 2, text: "" },
      { pageIndex: 3, text: "body" },
      { pageIndex: 4, text: "more" },
      { pageIndex: 5, text: "" },
    ]);
    const { host, cleanup } = renderDocx(engine);
    try {
      await settle();
      expect(calls).toEqual(["doc-1"]);
      const notice = host.querySelector("[data-export-pages-without-text]");
      expect(notice).not.toBeNull();
      expect(notice?.textContent ?? "").toContain("2, 5");
    } finally {
      cleanup();
    }
  });

  it("renders no notice when every page has text", async () => {
    const { engine } = makeEngine([{ pageIndex: 1, text: "only" }]);
    const { host, cleanup } = renderDocx(engine);
    try {
      await settle();
      expect(host.querySelector("[data-export-pages-without-text]")).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("DEF-390 — a failed extraction never breaks the export", () => {
  it("a rejecting exportText renders no notice and the docx export still completes", async () => {
    const { engine } = makeEngine("reject");
    const { host, cleanup, onConfirm } = renderDocx(engine);
    try {
      await settle();
      expect(host.querySelector("[data-export-pages-without-text]")).toBeNull();
      await act(async (): Promise<void> => {
        host.querySelector<HTMLButtonElement>("[data-docx-export-confirm]")?.click();
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(host.querySelector("[role='alert']")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("a typed engine failure renders no notice and the text export still completes", async () => {
    const failing: TextFreePagesEngine = {
      async exportText() {
        return err("engine-error", "extract failed");
      },
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onConfirm = vi.fn();
    act((): void => {
      root.render(
        createElement(TextExportDialog, {
          open: true,
          totalPages: 3,
          runExport: async () => [
            { pageIndex: 1, text: "a" },
            { pageIndex: 2, text: "b" },
            { pageIndex: 3, text: "c" },
          ],
          onConfirm,
          sourceName: "doc.pdf",
          docId: "doc-1",
          engine: failing,
          onClose: (): void => undefined,
        }),
      );
    });
    try {
      await settle();
      expect(host.querySelector("[data-export-pages-without-text]")).toBeNull();
      await act(async (): Promise<void> => {
        host.querySelector<HTMLButtonElement>("[data-text-export-confirm]")?.click();
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(host.querySelector("[role='alert']")).toBeNull();
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });

  it("renders no notice when docId is null", async () => {
    const { engine, calls } = makeEngine([{ pageIndex: 1, text: "" }]);
    const view = mount(
      createElement(DocxExportDialog, {
        open: true,
        totalPages: 1,
        runEngineExport: async () => [],
        runAssemble: async () => new Uint8Array(0),
        onConfirm: (): void => undefined,
        sourceName: "doc.pdf",
        docId: null,
        engine,
        onClose: (): void => undefined,
      }),
    );
    try {
      await settle();
      expect(calls).toEqual([]);
      expect(view.host.querySelector("[data-export-pages-without-text]")).toBeNull();
    } finally {
      view.cleanup();
    }
  });
});

describe("DEF-390 — the docx wording is honest about the image fallback", () => {
  it("uses the shared image-fallback wording, identical to the office surfaces", () => {
    // The docx writer embeds an inline page image for EVERY text-free page
    // (`_createDocxFromDocImpl` falls back to {kind:'image'} whenever the
    // extracted text is empty, scan or blank alike), so the two cases do not
    // differ in the file and one image-fallback wording is accurate for both.
    expect(pagesWithoutTextMessage([2, 5])).toBe(
      "Pages with no extractable text: 2, 5. They were exported as page images.",
    );
    expect(pagesWithoutTextMessage([3])).toBe(
      "Page with no extractable text: 3. They were exported as page images.",
    );
    // It must not claim the engine emits an empty page paragraph for a blank
    // page: that path is unreachable while a raster entry exists.
    expect(pagesWithoutTextMessage([2, 5])).not.toMatch(/paragraph/i);
    expect(pagesWithoutTextMessage([2, 5])).not.toMatch(/empty page/i);
  });

  it("renders the same wording on the docx and office surfaces", async () => {
    const { engine } = makeEngine([
      { pageIndex: 1, text: "" },
      { pageIndex: 2, text: "" },
    ]);
    const { host, cleanup } = renderDocx(engine);
    try {
      await settle();
      const docxText =
        host.querySelector("[data-export-pages-without-text]")?.textContent ?? "";
      expect(docxText).toContain("They were exported as page images.");
    } finally {
      cleanup();
    }
  });
});

describe("DEF-390 — cross-surface guard: the notice selector exists on all four surfaces", () => {
  function makeOfficeClient(): {
    client: TFlexApiExport;
    build: (format: ExportFormat) => ExportBuild;
  } {
    const build = (format: ExportFormat): ExportBuild => ({
      format,
      bytes: new Uint8Array([1, 2, 3]),
      fidelityNotes: EXPORT_FIDELITY_NOTES[format],
      pagesWithoutText: [2],
    });
    const client = {
      inner: {
        xlsx() {
          return Promise.resolve(ok(build("xlsx")));
        },
        pptx() {
          return Promise.resolve(ok(build("pptx")));
        },
      },
      xlsx(this: { inner: { xlsx: () => Promise<unknown> } }) {
        return this.inner.xlsx();
      },
      pptx(this: { inner: { pptx: () => Promise<unknown> } }) {
        return this.inner.pptx();
      },
    };
    return { client: client as unknown as TFlexApiExport, build };
  }

  it("txt, docx, xlsx and pptx all render [data-export-pages-without-text]", async () => {
    const pages: TextPage[] = [
      { pageIndex: 1, text: "cover" },
      { pageIndex: 2, text: "" },
    ];
    const { engine } = makeEngine(pages);
    const text = renderText(engine);
    const docx = renderDocx(engine);
    try {
      await settle();
      expect(text.host.querySelector("[data-export-pages-without-text]")).not.toBeNull();
      expect(docx.host.querySelector("[data-export-pages-without-text]")).not.toBeNull();
    } finally {
      text.cleanup();
      docx.cleanup();
    }

    for (const format of ["xlsx", "pptx"] as const) {
      const { client } = makeOfficeClient();
      const view = mount(
        createElement(OfficeExportDialog, {
          open: true,
          format,
          totalPages: 2,
          sourceName: "image-only.pdf",
          docId: "doc-1",
          client,
          runEngineExport: async () => [],
          onConfirm: (): void => undefined,
          onClose: (): void => undefined,
        }),
      );
      try {
        await act(async (): Promise<void> => {
          view.host.querySelector<HTMLButtonElement>("[data-office-export-confirm]")?.click();
          await new Promise((r) => setTimeout(r, 0));
          await new Promise((r) => setTimeout(r, 0));
        });
        const notice = view.host.querySelector("[data-export-pages-without-text]");
        expect(notice, format).not.toBeNull();
        expect(notice?.textContent ?? "").toContain("page images");
      } finally {
        view.cleanup();
      }
    }
  });
});



