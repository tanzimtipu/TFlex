// @vitest-environment jsdom
//
// Phase 36 (chunk 5) — the INSPECTOR component contract.
//
// The panel is prop-driven: this suite pins which sections each
// (stage, selection) pair renders, the DOCUMENT fallback when nothing is
// selected, that every affordance calls the host's EXISTING handler, and that
// the three re-parented components (text-properties, OCR suspects,
// annotations) render with their own selectors intact.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  Inspector,
  inspectorSections,
  inspectorSelectionLabel,
} from "../../../src/renderer/components/Inspector";
import type { InspectorProps } from "../../../src/renderer/components/Inspector";
import { defaultTextStyleValues } from "../../../src/renderer/edit/textStyle";

function mount(props: InspectorProps): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(createElement(Inspector, props));
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

function click(host: HTMLElement, selector: string): void {
  const el = host.querySelector(selector);
  if (el === null) throw new Error(`missing ${selector}`);
  act((): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const slots = (host: HTMLElement): string[] =>
  [...host.querySelectorAll<HTMLElement>("[data-inspector-slot]")].map(
    (el) => el.getAttribute("data-inspector-slot") ?? "",
  );

describe("Phase 36 chunk 5 — inspectorSections resolves the per-stage contract", () => {
  it.each([
    ["pages", "page", ["page", "on-page", "document"]],
    ["pages", "none", ["document"]],
    ["edit", "text", ["text"]],
    ["edit", "page", ["cropbox", "ocr"]],
    ["edit", "none", ["document"]],
    ["review", "signature", ["signature"]],
    ["review", "none", ["comments", "annotations"]],
    ["deliver", "none", ["export", "document"]],
  ] as const)("%s + %s renders %j", (stage, kind, expected) => {
    expect(inspectorSections(stage, kind)).toEqual(expected);
  });

  it("labels the header per selection", () => {
    expect(inspectorSelectionLabel({ kind: 'page', page: 3 })).toBe('Page 3');
    expect(inspectorSelectionLabel({ kind: 'page', page: 3, name: 'iii' })).toBe('iii');
    expect(inspectorSelectionLabel({ kind: 'text' })).toBe('Text object');
    expect(inspectorSelectionLabel({ kind: 'signature' })).toBe('Signature');
    expect(inspectorSelectionLabel({ kind: 'none' })).toBe('Document');
  });
});

describe("Phase 36 chunk 5 - the PAGES sections and their affordances", () => {
  it("renders the page + on-page + document sections for a selected page", () => {
    const { host, unmount } = mount({
      stage: "pages",
      selection: { kind: "page", page: 2 },
      pageCount: 9,
      pageSize: { widthPt: 612, heightPt: 792 },
      pageRotation: 90,
      pageLabel: "ii",
      annotationCount: 4,
      formFieldCount: 2,
      fileSize: 2048,
      documentTitle: "Report.pdf",
    });
    try {
      expect(host.querySelector("[data-inspector]")).not.toBeNull();
      expect(host.querySelector("[data-inspector-stage]")?.getAttribute("data-inspector-stage")).toBe("pages");
      expect(host.querySelector("[data-inspector-selection]")?.getAttribute("data-inspector-selection")).toBe("page");
      expect(slots(host)).toEqual(["page", "on-page", "document"]);
      // Header carries the selection label.
      expect(host.querySelector(".glass-sidebar-title")?.textContent).toBe("Inspector \u00b7 Page 2");
      // Property rows: label left, value right.
      for (const id of ["size", "rotation", "label", "crop"]) {
        expect(host.querySelector(`[data-inspector-row="${id}"]`), id).not.toBeNull();
      }
      expect(host.querySelector('[data-inspector-row="size"]')?.textContent).toContain("612 x 792 pt");
      expect(host.querySelector('[data-inspector-value="rotation"]')?.textContent).toBe("90\u00b0");
      expect(host.querySelector('[data-inspector-value="label"]')?.textContent).toBe("ii");
      expect(host.querySelector('[data-inspector-row="annotations"]')?.textContent).toContain("4");
      expect(host.querySelector('[data-inspector-row="form-fields"]')?.textContent).toContain("2");
      expect(host.querySelector('[data-inspector-value="file-size"]')?.textContent).toBe("2.0 KB");
      expect(host.querySelector('[data-inspector-row="title"]')?.textContent).toContain("Report.pdf");
    } finally {
      unmount();
    }
  });

  it("wires the inline page affordances to the host handlers", () => {
    const onRotatePage = vi.fn();
    const onRenumberPages = vi.fn();
    const onCropPages = vi.fn();
    const { host, unmount } = mount({
      stage: "pages",
      selection: { kind: "page", page: 1 },
      onRotatePage,
      onRenumberPages,
      onCropPages,
    });
    try {
      click(host, '[data-inspector-action="rotate"]');
      click(host, '[data-inspector-action="renumber"]');
      click(host, '[data-inspector-action="crop"]');
      expect(onRotatePage).toHaveBeenCalledTimes(1);
      expect(onRenumberPages).toHaveBeenCalledTimes(1);
      expect(onCropPages).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("opens the document disclosure and runs Optimize / Audit from it", () => {
    const onOptimize = vi.fn();
    const onAudit = vi.fn();
    const { host, unmount } = mount({
      stage: "pages",
      selection: { kind: "page", page: 1 },
      onOptimize,
      onAudit,
    });
    try {
      expect(host.querySelector('[data-inspector-menu="document"]')).toBeNull();
      click(host, '[data-inspector-action="document-menu"]');
      expect(host.querySelector('[data-inspector-menu="document"]')).not.toBeNull();
      click(host, '[data-inspector-menu="document"] [data-inspector-action="optimize"]');
      click(host, '[data-inspector-menu="document"] [data-inspector-action="audit"]');
      expect(onOptimize).toHaveBeenCalledTimes(1);
      expect(onAudit).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("disables an affordance the host did not wire (never a silent no-op)", () => {
    const { host, unmount } = mount({
      stage: "pages",
      selection: { kind: "page", page: 1 },
    });
    try {
      const rotate = host.querySelector<HTMLButtonElement>('[data-inspector-action="rotate"]');
      expect(rotate).not.toBeNull();
      expect(rotate?.disabled).toBe(true);
    } finally {
      unmount();
    }
  });
});

describe("Phase 36 chunk 5 - the DOCUMENT fallback with nothing selected", () => {
  it("renders the document inspector for a `none` selection", () => {
    const { host, unmount } = mount({
      stage: "pages",
      selection: { kind: "none" },
      pageCount: 12,
      fileSize: 4096,
      documentTitle: "Deck.pdf",
      onOptimize: vi.fn(),
      onAudit: vi.fn(),
      onExportPages: vi.fn(),
    });
    try {
      expect(slots(host)).toEqual(["document"]);
      expect(host.querySelector(".glass-sidebar-title")?.textContent).toBe("Inspector \u00b7 Document");
      expect(host.querySelector('[data-inspector-row="page-count"]')?.textContent).toContain("12");
      expect(host.querySelector('[data-inspector-value="file-size"]')?.textContent).toBe("4.0 KB");
      expect(host.querySelector('[data-inspector-quick-actions]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("defaults to the document inspector when no selection prop is given", () => {
    const { host, unmount } = mount({ stage: "edit", pageCount: 3 });
    try {
      expect(slots(host)).toEqual(["document"]);
    } finally {
      unmount();
    }
  });
});

describe("Phase 36 chunk 5 - the re-parented components", () => {
  it("EDIT + a text object hosts the existing text-properties component", () => {
    const values = defaultTextStyleValues("Helvetica");
    const { host, unmount } = mount({
      stage: "edit",
      selection: { kind: "text" },
      textPanel: {
        open: true,
        values,
        defaults: values,
        onPatch: vi.fn(),
        mode: "text",
        text: "Hello",
      },
    });
    try {
      expect(slots(host)).toEqual(["text"]);
      // The re-parented component's own selectors are untouched.
      expect(host.querySelector("[data-inspector-text-panel]")).not.toBeNull();
      expect(host.querySelector("[data-text-panel]")).not.toBeNull();
      expect(host.querySelector("[data-txt-font]")).not.toBeNull();
      expect(host.querySelector("[data-txt-size]")).not.toBeNull();
      expect(host.querySelector("[data-txt-color]")).not.toBeNull();
      expect(host.querySelector('[data-txt-align-left="true"]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("EDIT + a page shows the CropBox values and the OCR status", () => {
    const { host, unmount } = mount({
      stage: "edit",
      selection: { kind: "page", page: 1 },
      cropBox: { x: 10.4, y: 20.6, width: 300.2, height: 400.9 },
      ocrStatus: "Recognized",
      onRecognizeText: vi.fn(),
    });
    try {
      expect(slots(host)).toEqual(["cropbox", "ocr"]);
      expect(host.querySelector('[data-inspector-row="cropbox-x"]')?.textContent).toContain("10");
      expect(host.querySelector('[data-inspector-row="cropbox-w"]')?.textContent).toContain("300");
      expect(host.querySelector('[data-inspector-row="ocr-status"]')?.textContent).toContain("Recognized");
    } finally {
      unmount();
    }
  });

  it("EDIT re-parents the OCR-suspects component when the host supplies it", () => {
    const onNavigate = vi.fn();
    const { host, unmount } = mount({
      stage: "edit",
      selection: { kind: "page", page: 1 },
      ocrSuspects: {
        suspects: [{ page: 1, word: "teh", confidence: 41, rect: { x: 1, y: 2, width: 3, height: 4 } }],
        hasRun: true,
        onNavigate,
        onClose: vi.fn(),
      },
    });
    try {
      // The re-parented component keeps its own selector.
      expect(host.querySelector("[data-ocr-suspects-panel]")).not.toBeNull();
      click(host, "[data-ocr-suspect-word]");
      expect(onNavigate).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("REVIEW + the document re-parents the comments rows and REFERENCES the annotations list", () => {
    const onJump = vi.fn();
    const onExportComments = vi.fn();
    const onImportComments = vi.fn();
    const { host, unmount } = mount({
      stage: "review",
      selection: { kind: "none" },
      annotations: [],
      onAnnotationJump: onJump,
      onExportComments,
      onImportComments,
    });
    try {
      expect(slots(host)).toEqual(["comments", "annotations"]);
      // Phase 36 (chunk 6) — the annotations LIST has exactly ONE home (the
      // REVIEW panel); the Inspector shows a reference, never a second copy.
      expect(host.querySelector("[data-annotation-panel]")).toBeNull();
      expect(host.querySelector("[data-inspector-annotations-reference]")).not.toBeNull();
      click(host, '[data-inspector-action="export-comments"]');
      click(host, '[data-inspector-action="import-comments"]');
      expect(onExportComments).toHaveBeenCalledTimes(1);
      expect(onImportComments).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("REVIEW + a signature shows the style and the placement hint", () => {
    const { host, unmount } = mount({
      stage: "review",
      selection: { kind: "signature" },
      signatureStyle: "Drawn",
      signatureHint: "Click a page to place",
    });
    try {
      expect(slots(host)).toEqual(["signature"]);
      expect(host.querySelector('[data-inspector-row="signature-style"]')?.textContent).toContain("Drawn");
      expect(host.querySelector('[data-inspector-row="signature-hint"]')?.textContent).toContain("Click a page");
    } finally {
      unmount();
    }
  });
});

describe("Phase 36 chunk 5 - the DELIVER export section", () => {
  it("shows format / pages / preset and runs Export", () => {
    const onExport = vi.fn();
    const { host, unmount } = mount({
      stage: "deliver",
      selection: { kind: "none" },
      exportFormat: "png",
      exportPages: "1-3",
      exportPreset: "Print",
      onExport,
    });
    try {
      expect(slots(host)).toEqual(["export", "document"]);
      expect(host.querySelector('[data-inspector-row="export-format"]')?.textContent).toContain("png");
      expect(host.querySelector('[data-inspector-row="export-pages"]')?.textContent).toContain("1-3");
      expect(host.querySelector('[data-inspector-row="export-preset"]')?.textContent).toContain("Print");
      click(host, '[data-inspector-slot="export"] [data-inspector-action="export"]');
      expect(onExport).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });
});
