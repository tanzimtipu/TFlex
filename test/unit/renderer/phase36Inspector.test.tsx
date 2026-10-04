// @vitest-environment jsdom
//
// Phase 36 (chunk 5) — the INSPECTOR component contract.
//
// The panel is prop-driven: this suite pins which sections each
// (stage, selection) pair renders, the DOCUMENT fallback when nothing is
// selected, that every affordance calls the host's EXISTING handler, and that
// the re-parented text-properties component renders with its own selectors
// intact. Phase 90 (TFL-509-C1) replaced the reference-only annotations
// section with the unified `review-elements` section, and the suspects view is
// NOT mounted here at all (3A ruling 4).

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
    // Phase 37 (item 1) — a selected text object lifts the panel to the TOP;
    // the sections BELOW are the stage's existing content.
    ["edit", "text", ["document"]],
    ["edit", "page", ["cropbox"]],
    ["edit", "none", ["document"]],
    ["review", "signature", ["signature"]],
    ["review", "none", ["comments", "review-elements"]],
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
      pageRotation: 1,
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
      for (const id of ["size", "rotation", "label"]) {
        expect(host.querySelector(`[data-inspector-row="${id}"]`), id).not.toBeNull();
      }
      // Section 3A ruling 3 - the PAGES inspector has NO Crop row.
      expect(host.querySelector('[data-inspector-row="crop"]')).toBeNull();
      expect(host.querySelector('[data-inspector-action="crop"]')).toBeNull();
      expect(host.querySelector('[data-inspector-row="size"]')?.textContent).toContain("612 x 792 pt");
      // DEF-329 - `pageRotation` is the engine's QUARTER-TURN index (1 = 90°).
      expect(host.querySelector('[data-inspector-value="rotation"]')?.textContent).toBe("90\u00b0");
      expect(host.querySelector('[data-inspector-value="label"]')?.textContent).toBe("ii");
      expect(host.querySelector('[data-inspector-annotations-count]')?.textContent).toBe("4");
      expect(host.querySelector('[data-inspector-row="form-fields"]')?.textContent).toContain("2");
      expect(host.querySelector('[data-inspector-value="file-size"]')?.textContent).toBe("2.0 KB");
      expect(host.querySelector('[data-inspector-row="title"]')?.textContent).toContain("Report.pdf");
    } finally {
      unmount();
    }
  });

  it("ROTATION is a READ-ONLY value (section 3A ruling 1: no ↻ affordance)", () => {
    const { host, unmount } = mount({
      stage: "pages",
      selection: { kind: "page", page: 1 },
      pageRotation: 2,
      onRenumberPages: vi.fn(),
    });
    try {
      expect(host.querySelector('[data-inspector-value="rotation"]')?.textContent).toBe("180\u00b0");
      // No rotate affordance anywhere in the Inspector.
      expect(host.querySelector('[data-inspector-action="rotate"]')).toBeNull();
    } finally {
      unmount();
    }
  });

  it("wires the Label renumber affordance to the host handler", () => {
    const onRenumberPages = vi.fn();
    const { host, unmount } = mount({
      stage: "pages",
      selection: { kind: "page", page: 1 },
      onRenumberPages,
    });
    try {
      click(host, '[data-inspector-action="renumber"]');
      expect(onRenumberPages).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("the Annotations count is read-only but JUMPS to REVIEW on click (ruling 6)", () => {
    const onJumpToReview = vi.fn();
    const { host, unmount } = mount({
      stage: "pages",
      selection: { kind: "page", page: 1 },
      annotationCount: 3,
      onJumpToReview,
    });
    try {
      const jump = host.querySelector<HTMLButtonElement>('[data-inspector-action="jump-to-review"]');
      expect(jump).not.toBeNull();
      expect(jump?.querySelector("[data-inspector-annotations-count]")?.textContent).toBe("3");
      click(host, '[data-inspector-action="jump-to-review"]');
      expect(onJumpToReview).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("disables the renumber affordance the host did not wire (never a silent no-op)", () => {
    const { host, unmount } = mount({
      stage: "pages",
      selection: { kind: "page", page: 1 },
    });
    try {
      const renumber = host.querySelector<HTMLButtonElement>('[data-inspector-action="renumber"]');
      expect(renumber).not.toBeNull();
      expect(renumber?.disabled).toBe(true);
    } finally {
      unmount();
    }
  });
});

describe("Phase 36 chunk 5 - the DOCUMENT read-only facts", () => {
  it("renders file size as a VALUE with NO affordance (section 3A ruling 5)", () => {
    const { host, unmount } = mount({
      stage: "pages",
      selection: { kind: "page", page: 1 },
      fileSize: 2048,
    });
    try {
      expect(host.querySelector('[data-inspector-value="file-size"]')?.textContent).toBe("2.0 KB");
      // No disclosure and no Optimize/Audit affordance anywhere.
      expect(host.querySelector('[data-inspector-action="document-menu"]')).toBeNull();
      expect(host.querySelector('[data-inspector-action="optimize"]')).toBeNull();
      expect(host.querySelector('[data-inspector-action="audit"]')).toBeNull();
      expect(host.querySelector('[data-inspector-quick-actions]')).toBeNull();
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
    });
    try {
      expect(slots(host)).toEqual(["document"]);
      expect(host.querySelector(".glass-sidebar-title")?.textContent).toBe("Inspector \u00b7 Document");
      expect(host.querySelector('[data-inspector-row="page-count"]')?.textContent).toContain("12");
      expect(host.querySelector('[data-inspector-value="file-size"]')?.textContent).toBe("4.0 KB");
      // Section 3A ruling 5 - the document facts are read-only.
      expect(host.querySelector("[data-inspector-quick-actions]")).toBeNull();
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

  it("renders the designed no-selection empty state when no document is open", () => {
    const { host, unmount } = mount({ stage: "pages", selection: { kind: "none" } });
    try {
      expect(slots(host)).toEqual(["document"]);
      const empty = host.querySelector("[data-inspector-empty]");
      expect(empty).not.toBeNull();
      expect(empty?.classList.contains("empty-state")).toBe(true);
      expect(empty?.querySelector(".empty-state-headline")?.textContent).toBe("No document open");
      expect(empty?.querySelector(".empty-state-mark")).not.toBeNull();
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
      // Phase 37 (item 1) — the text panel leads the column; the stage's own
      // content (the document facts in EDIT) renders below the divider.
      expect(slots(host)).toEqual(["document"]);
      // The re-parented component's own selectors are untouched.
      expect(host.querySelector("[data-inspector-text-panel]")).not.toBeNull();
      expect(host.querySelector("[data-inspector-text-top]")).not.toBeNull();
      expect(host.querySelector("[data-inspector-divider]")).not.toBeNull();
      expect(host.querySelector("[data-text-panel]")).not.toBeNull();
      expect(host.querySelector("[data-txt-font]")).not.toBeNull();
      expect(host.querySelector("[data-txt-size]")).not.toBeNull();
      expect(host.querySelector("[data-txt-color]")).not.toBeNull();
      expect(host.querySelector('[data-txt-align-left="true"]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

it("EDIT + a page shows ONLY the CropBox values (no OCR status — ruling 4)", () => {
    const { host, unmount } = mount({
      stage: "edit",
      selection: { kind: "page", page: 1 },
      cropBox: { x: 10.4, y: 20.6, width: 300.2, height: 400.9 },
    });
    try {
      expect(slots(host)).toEqual(["cropbox"]);
      expect(host.querySelector('[data-inspector-row="cropbox-x"]')?.textContent).toContain("10");
      expect(host.querySelector('[data-inspector-row="cropbox-w"]')?.textContent).toContain("300");
      // Section 3A ruling 4 — the OCR status is the EDIT ContextPanel's ONLY.
      expect(host.querySelector('[data-inspector-row="ocr-status"]')).toBeNull();
      expect(host.querySelector('[data-inspector-section="ocr"]')).toBeNull();
      expect(host.querySelector('[data-inspector-action="recognize"]')).toBeNull();
    } finally {
      unmount();
    }
  });

  it("EDIT never mounts the suspects view — the EDIT panel owns it (ruling 4)", () => {
    const { host, unmount } = mount({
      stage: "edit",
      selection: { kind: "page", page: 1 },
      cropBox: { x: 10, y: 20, width: 300, height: 400 },
    });
    try {
      // The 3A cleanup: the suspects view is entered from the EDIT ContextPanel
      // alone, so the Inspector has no mount point for it at all.
      expect(host.querySelector("[data-ocr-suspects-panel]")).toBeNull();
      expect(host.querySelector('[data-inspector-slot="ocr-suspects"]')).toBeNull();
    } finally {
      unmount();
    }
  });

  it("REVIEW + the document renders the unified review list and wires the FDF actions", () => {
    const onExportComments = vi.fn();
    const onImportComments = vi.fn();
    const { host, unmount } = mount({
      stage: "review",
      selection: { kind: "none" },
      annotations: [],
      onExportComments,
      onImportComments,
    });
    try {
      expect(slots(host)).toEqual(["comments", "review-elements"]);
      // Phase 90 (TFL-509-C1) — Ruling 6: the unified list IS rendered here,
      // and its Annotations category re-parents the ONE real AnnotationsPanel.
      expect(host.querySelector("[data-review-elements]")).not.toBeNull();
      expect(
        host.querySelector('[data-review-category="annotations"] [data-annotation-panel]'),
      ).not.toBeNull();
      // The superseded reference-only section is gone — the list is rendered
      // once, never duplicated.
      expect(host.querySelector("[data-inspector-annotations-reference]")).toBeNull();
      // The 3A cleanup: no per-annotation verbs here either — the list owns
      // them, so the Inspector adds no separate row callbacks.
      expect(host.querySelector('[data-inspector-action="annotation-jump"]')).toBeNull();
      expect(host.querySelector('[data-inspector-action="annotation-edit"]')).toBeNull();
      expect(host.querySelector('[data-inspector-action="annotation-delete"]')).toBeNull();
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
