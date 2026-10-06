// @vitest-environment jsdom
//
// Phase 112 (TFL-854, chunk C4) â€” the REVIEW Context Pair.
//
// The Review workspace's LEFT review navigator (the unified ReviewElementsPanel:
// the annotation list plus the document-marks categories) and RIGHT annotation
// inspector migrated onto the shared panel primitives (PanelShell / ScopedHeader
// / PanelSection / PropertyRow / ActionList / PanelEmptyState) WITHOUT changing
// a command, handler, shortcut, selector, document operation or undo/redo
// behaviour.
//
// These tests pin the two contracts the brief names:
//   LEFT  â€” one authoritative annotation list GROUPED BY PAGE (page group
//           header) with the type / content excerpt / page per row, and every
//           legacy hook preserved (data-annotation-panel, data-annotation-row,
//           .ann-panel-*, data-color, jump / edit / delete); the no-annotations
//           state is a PanelEmptyState; the marks categories + their empty
//           states ride PanelSection / PanelEmptyState with data-review-* intact.
//   RIGHT â€” the inspector's REVIEW scope is the SELECTED annotation's
//           inspector (content/appearance via the lifted text panel + real
//           contextual actions), never a second annotation list; with nothing
//           selected it shows a short designed hint; no resolve / reply state is
//           invented.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { AnnotationsPanel } from "../../../src/renderer/annotations/AnnotationsPanel";
import type { Annotation } from "../../../src/renderer/annotations/model";
import { ReviewElementsPanel } from "../../../src/renderer/components/ReviewElementsPanel";
import {
  Inspector,
  inspectorTextPanelFor,
  selectedReviewAnnotation,
} from "../../../src/renderer/components/Inspector";
import type {
  InspectorProps,
  InspectorTextSelection,
} from "../../../src/renderer/components/Inspector";
import { defaultTextStyleValues } from "../../../src/renderer/edit/textStyle";
import type {
  BatesInfo,
  SignaturePlacement,
  WatermarkInfo,
} from "../../../src/shared/types";

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

const CREATED = "2026-01-01T00:00:00Z";

function markup(id: string, page: number, color: Annotation["color"]): Annotation {
  return {
    id,
    page,
    color,
    createdAt: CREATED,
    kind: "highlight",
    rects: [{ x: 0, y: 0, width: 10, height: 10 }],
    text: `Excerpt ${id}`,
  };
}

function note(id: string, page: number, color: Annotation["color"]): Annotation {
  return { id, page, color, createdAt: CREATED, kind: "note", at: { x: 0, y: 0 }, text: `Note ${id}` };
}

function annotationSnapshot(id: string): InspectorTextSelection {
  const values = defaultTextStyleValues("Helvetica");
  return {
    targetKey: id,
    name: "Text annotation",
    values,
    defaults: values,
    mode: "annotation",
    text: "Annotation body",
    onPatch: (): void => undefined,
    onTextChange: (): void => undefined,
    onTextCommit: (): void => undefined,
    focusToken: 0,
  };
}

const BATES: BatesInfo = {
  id: "bates-1",
  prefix: "ABC",
  suffix: "",
  startNumber: 1,
  pages: [2],
  labels: ["ABC000001"],
} as unknown as BatesInfo;

const WATERMARK: WatermarkInfo = {
  id: "wm-1",
  type: "Draft",
  text: "Confidential",
  pages: [5],
} as unknown as WatermarkInfo;

const SIGNATURE: SignaturePlacement = {
  id: "sig-place-1",
  page: 7,
} as unknown as SignaturePlacement;

describe("Phase 112 C4 ï¿½ the LEFT review navigator: the annotation list", () => {
  it("groups the list by page with a group header and preserves the row hooks", () => {
    const annotations = [markup("h1", 2, "yellow"), note("n1", 1, "green"), markup("h2", 1, "blue")];
    const onJumpTo = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const { host, unmount } = mount(
      <AnnotationsPanel
        annotations={annotations}
        onJumpTo={onJumpTo}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    try {
      const root = host.querySelector<HTMLElement>("[data-annotation-panel]");
      expect(root).not.toBeNull();
      expect(root?.classList.contains("tf-panel-shell")).toBe(true);

      const groups = [...host.querySelectorAll<HTMLElement>("[data-annotation-page]")];
      expect(groups.map((g) => g.getAttribute("data-annotation-page"))).toEqual(["1", "2"]);
      for (const g of groups) expect(g.classList.contains("tf-panel-section")).toBe(true);
      expect(groups[0]?.querySelector(".ann-panel-group-title")?.textContent).toBe("Page 1");
      expect(groups[0]?.querySelectorAll("[data-annotation-row]").length).toBe(2);

      const rows = [...host.querySelectorAll<HTMLElement>("[data-annotation-row]")];
      expect(rows).toHaveLength(3);
      const first = rows[0];
      expect(first?.querySelector(".ann-panel-row-jump")).not.toBeNull();
      expect(first?.querySelector(".ann-panel-row-delete")).not.toBeNull();
      expect(first?.querySelector(".ann-panel-row-kind")?.textContent).toBeTruthy();
      expect(first?.querySelectorAll("[data-color]").length).toBeGreaterThan(0);

      clickOn(first?.querySelector(".ann-panel-row-jump") ?? null);
      expect(onJumpTo).toHaveBeenCalledTimes(1);
      clickOn(first?.querySelector(".ann-panel-row-delete") ?? null);
      expect(onDelete).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("edits a row's colour through its swatch", () => {
    const onEdit = vi.fn();
    const { host, unmount } = mount(
      <AnnotationsPanel
        annotations={[markup("h1", 1, "yellow")]}
        onJumpTo={vi.fn()}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />,
    );
    try {
      const green = host.querySelector('[data-color="green"]');
      expect(green).not.toBeNull();
      clickOn(green);
      expect(onEdit).toHaveBeenCalledWith("h1", { color: "green" });
    } finally {
      unmount();
    }
  });

  it("renders the no-annotations state through PanelEmptyState", () => {
    const { host, unmount } = mount(
      <AnnotationsPanel annotations={[]} onJumpTo={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    try {
      const empty = host.querySelector<HTMLElement>("[data-annotation-empty]");
      expect(empty).not.toBeNull();
      expect(empty?.classList.contains("tf-panel-empty")).toBe(true);
      expect(empty?.querySelector(".tf-panel-empty-headline")?.textContent).toBe("No annotations");
      expect(host.querySelector(".hint")).not.toBeNull();
      expect(host.querySelectorAll("[data-annotation-row]").length).toBe(0);
    } finally {
      unmount();
    }
  });
});

describe("Phase 112 C4 ï¿½ the LEFT document marks", () => {
  it("renders the categories through PanelSection and empty states through PanelEmptyState", () => {
    const { host, unmount } = mount(
      <ReviewElementsPanel
        annotations={[markup("h1", 1, "yellow")]}
        bates={[BATES]}
        watermarks={[]}
        signatures={[SIGNATURE]}
      />,
    );
    try {
      const cats = [...host.querySelectorAll<HTMLElement>("[data-review-category]")];
      expect(cats.map((c) => c.getAttribute("data-review-category"))).toEqual([
        "annotations",
        "bates",
        "watermarks",
        "signatures",
      ]);
      for (const c of cats) expect(c.classList.contains("tf-panel-section")).toBe(true);
      expect(
        host.querySelector('[data-review-category="annotations"] [data-annotation-panel]'),
      ).not.toBeNull();

      const empty = host.querySelector<HTMLElement>(
        '[data-review-category="watermarks"] [data-review-empty]',
      );
      expect(empty).not.toBeNull();
      expect(empty?.classList.contains("tf-panel-empty")).toBe(true);
      expect(empty?.querySelector(".tf-panel-empty-headline")?.textContent).toBe(
        "No watermarks applied.",
      );

      const row = host.querySelector<HTMLElement>('[data-review-element-type="bates"]');
      expect(row?.getAttribute("data-review-element-id")).toBe("bates-1");
      expect(row?.querySelector("[data-review-element-select]")).not.toBeNull();
      expect(row?.querySelector("[data-review-element-edit]")).not.toBeNull();
      expect(row?.querySelector("[data-review-element-delete]")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("routes a marks row's select / edit / delete to the host handlers", () => {
    const onSelect = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const { host, unmount } = mount(
      <ReviewElementsPanel
        annotations={[]}
        bates={[BATES]}
        watermarks={[WATERMARK]}
        signatures={[]}
        onSelect={onSelect}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    try {
      clickOn(host.querySelector('[data-review-element-type="bates"] [data-review-element-select]'));
      clickOn(host.querySelector('[data-review-element-type="bates"] [data-review-element-edit]'));
      clickOn(
        host.querySelector('[data-review-element-type="watermark"] [data-review-element-delete]'),
      );
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ type: "bates", id: "bates-1" }));
      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ type: "bates", id: "bates-1" }));
      expect(onDelete).toHaveBeenCalledWith(
        expect.objectContaining({ type: "watermark", id: "wm-1" }),
      );
    } finally {
      unmount();
    }
  });
});

describe("Phase 112 C4 - the RIGHT annotation inspector", () => {
  it("shows a short hint, not a duplicated list, when nothing is selected", () => {
    const { host, unmount } = mount(
      <Inspector
        stage="review"
        selection={{ kind: "none" }}
        annotations={[]}
        onExportComments={vi.fn()}
        onImportComments={vi.fn()}
      />,
    );
    try {
      const hint = host.querySelector<HTMLElement>("[data-inspector-review-empty]");
      expect(hint).not.toBeNull();
      expect(hint?.classList.contains("tf-panel-empty")).toBe(true);
      expect(hint?.querySelector(".tf-panel-empty-headline")?.textContent).toBe(
        "No annotation selected",
      );
      expect(host.querySelector("[data-annotation-panel]")).toBeNull();
      expect(host.querySelector("[data-review-elements]")).not.toBeNull();
      expect(host.querySelector('[data-review-category="annotations"]')).not.toBeNull();
      expect(host.querySelector('[data-inspector-action="export-comments"]')).not.toBeNull();
      expect(host.querySelector('[data-inspector-action="import-comments"]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("shows the selected annotation surface and its contextual actions", () => {
    const onJumpToAnnotation = vi.fn();
    const onDeleteAnnotation = vi.fn();
    const props: InspectorProps = {
      stage: "review",
      selection: { kind: "text", name: "Text annotation" },
      textPanel: inspectorTextPanelFor(annotationSnapshot("n1")),
      annotations: [note("n1", 3, "green")],
      onJumpToAnnotation,
      onDeleteAnnotation,
    };
    const { host, unmount } = mount(<Inspector {...props} />);
    try {
      expect(host.querySelector("[data-inspector-text-panel]")).not.toBeNull();
      expect(host.querySelector("[data-inspector-review-actions]")).not.toBeNull();
      expect(host.querySelector('[data-inspector-row="annotation-type"]')?.textContent).toContain(
        "Note",
      );
      expect(host.querySelector('[data-inspector-row="annotation-page"]')?.textContent).toContain(
        "3",
      );
      clickOn(host.querySelector('[data-tf-panel-action="annotation-jump"]'));
      clickOn(host.querySelector('[data-tf-panel-action="annotation-delete"]'));
      expect(onJumpToAnnotation).toHaveBeenCalledWith(3, "n1");
      expect(onDeleteAnnotation).toHaveBeenCalledWith("n1");
    } finally {
      unmount();
    }
  });

  it("never renders resolve / reply state", () => {
    const { host, unmount } = mount(
      <Inspector
        stage="review"
        selection={{ kind: "text", name: "Text annotation" }}
        textPanel={inspectorTextPanelFor(annotationSnapshot("n2"))}
        annotations={[note("n2", 1, "green")]}
      />,
    );
    try {
      const text = (host.textContent ?? "").toLowerCase();
      expect(text).not.toContain("resolve");
      expect(text).not.toContain("reopen");
      expect(text).not.toContain("reply");
      expect(text).not.toContain("unread");
    } finally {
      unmount();
    }
  });
});

describe("Phase 112 C4 - selectedReviewAnnotation", () => {
  const anns = [note("n1", 1, "green")];
  it("resolves the published annotation-mode snapshot to the real annotation", () => {
    expect(
      selectedReviewAnnotation({ kind: "text", name: "Text annotation" }, annotationSnapshot("n1"), anns)
        ?.id,
    ).toBe("n1");
  });
  it("returns null without an annotation selection or a matching annotation", () => {
    expect(selectedReviewAnnotation({ kind: "none" }, annotationSnapshot("n1"), anns)).toBeNull();
    expect(selectedReviewAnnotation({ kind: "text" }, null, anns)).toBeNull();
    expect(selectedReviewAnnotation({ kind: "text" }, annotationSnapshot("missing"), anns)).toBeNull();
  });
});
