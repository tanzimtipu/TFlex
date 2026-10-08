// @vitest-environment jsdom
//
// Phase 116 (TFL-1228 chunk E) - the RIGHT inspector's selected-annotation
// properties.
//
// The inspector owns the selected annotation's REAL properties: the /T author
// only when the document supplies one (never a fabricated initial), the kind /
// page facts, the rounded Position geometry (or no row when the kind carries
// none), and a live Color control that routes a pick through the host's
// existing onEditAnnotation. The nothing-selected state is unchanged. Mounted
// exactly like phase36Inspector / phase112_review.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import {
  Inspector,
  inspectorTextPanelFor,
  selectedReviewAnnotation,
} from "../../../src/renderer/components/Inspector";
import type {
  InspectorProps,
  InspectorTextSelection,
} from "../../../src/renderer/components/Inspector";
import type { Annotation, InkAnnotation, MarkupAnnotation } from "../../../src/renderer/annotations/model";
import { defaultTextStyleValues } from "../../../src/renderer/edit/textStyle";

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

function click(target: Element | null): void {
  if (target === null) throw new Error("click: missing target");
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const CREATED = "2026-01-01T00:00:00Z";

function snapshot(id: string): InspectorTextSelection {
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

function highlight(id: string, over: Partial<MarkupAnnotation> = {}): Annotation {
  return {
    id,
    page: 4,
    color: "yellow",
    createdAt: CREATED,
    kind: "highlight",
    rects: [{ x: 10.4, y: 20.6, width: 30.2, height: 40.9 }],
    text: "Excerpt",
    ...over,
  };
}

function ink(id: string, over: Partial<InkAnnotation> = {}): Annotation {
  return {
    id,
    page: 2,
    color: "blue",
    createdAt: CREATED,
    kind: "ink",
    points: [
      { x: 12, y: 34 },
      { x: 56, y: 78 },
    ],
    width: 2,
    ...over,
  };
}

function scope(
  id: string,
  ann: Annotation,
  extra: Partial<InspectorProps> = {},
): InspectorProps {
  return {
    stage: "review",
    selection: { kind: "text", name: "Text annotation" },
    textPanel: inspectorTextPanelFor(snapshot(id)),
    annotations: [ann],
    ...extra,
  };
}

describe("Phase 116 chunk E - the selected-annotation inspector", () => {
  it("(a) shows the real Author only when the document supplies one", () => {
    const ann = highlight("h1", { author: "Ada Example" });
    const { host, unmount } = mount(<Inspector {...scope("h1", ann)} />);
    try {
      const row = host.querySelector('[data-inspector-row="annotation-author"]');
      expect(row).not.toBeNull();
      expect(row?.textContent).toContain("Ada Example");
    } finally {
      unmount();
    }
  });

  it("(b) omits the Author row entirely when there is no author", () => {
    const { host, unmount } = mount(<Inspector {...scope("h2", highlight("h2"))} />);
    try {
      expect(host.querySelector('[data-inspector-row="annotation-author"]')).toBeNull();
      expect((host.textContent ?? "").toLowerCase()).not.toContain("author");
    } finally {
      unmount();
    }
  });

  it("(c) renders the real Type label and Page number", () => {
    const { host, unmount } = mount(
      <Inspector {...scope("h3", highlight("h3", { page: 7 }))} />,
    );
    try {
      expect(
        host.querySelector('[data-inspector-row="annotation-type"]')?.textContent,
      ).toContain("Highlight");
      expect(
        host.querySelector('[data-inspector-row="annotation-page"]')?.textContent,
      ).toContain("7");
    } finally {
      unmount();
    }
  });
  it("(d) renders the rounded Position geometry, or omits it with no rect", () => {
    const withRect = mount(<Inspector {...scope("h4", highlight("h4"))} />);
    try {
      const row = withRect.host.querySelector('[data-inspector-row="annotation-position"]');
      expect(row).not.toBeNull();
      expect(row?.textContent).toContain("10, 21 \u00b7 30\u00d741 pt");
    } finally {
      withRect.unmount();
    }

    const note: Annotation = {
      id: "n4",
      page: 1,
      color: "green",
      createdAt: CREATED,
      kind: "note",
      at: { x: 1, y: 2 },
      text: "hi",
    };
    const noRect = mount(<Inspector {...scope("n4", note)} />);
    try {
      expect(
        noRect.host.querySelector('[data-inspector-row="annotation-position"]'),
      ).toBeNull();
    } finally {
      noRect.unmount();
    }
  });

  it("(e) renders the color control and applies a pick through onEditAnnotation", () => {
    const onEditAnnotation = vi.fn();
    const { host, unmount } = mount(
      <Inspector {...scope("h5", highlight("h5"), { onEditAnnotation })} />,
    );
    try {
      const box = host.querySelector("[data-ann-color-box]");
      expect(box).not.toBeNull();
      click(box);
      const swatch = document.body.querySelector(
        ".color-popover [data-palette-built-in='red']",
      );
      expect(swatch).not.toBeNull();
      click(swatch);
      expect(onEditAnnotation).toHaveBeenCalledWith("h5", { color: "red" });
    } finally {
      unmount();
    }
  });

  it("(f) renders the existing empty state when nothing is selected", () => {
    const { host, unmount } = mount(
      <Inspector stage="review" selection={{ kind: "none" }} annotations={[]} />,
    );
    try {
      const empty = host.querySelector("[data-inspector-review-empty]");
      expect(empty).not.toBeNull();
      expect(empty?.classList.contains("tf-panel-empty")).toBe(true);
      expect(empty?.querySelector(".tf-panel-empty-headline")?.textContent).toBe(
        "No annotation selected",
      );
    } finally {
      unmount();
    }
  });

  it("(g) resolves the real annotation when the published key carries the annotation: prefix", () => {
    // The host publishes the text-annotation snapshot's key as `annotation:<id>`
    // while the document list holds the RAW id; both must resolve the same row.
    const anns = [highlight("h7"), note("n7")];
    expect(
      selectedReviewAnnotation(
        { kind: "text", name: "Text annotation" },
        { mode: "annotation", targetKey: "annotation:h7" },
        anns,
      )?.id,
    ).toBe("h7");
    expect(
      selectedReviewAnnotation(
        { kind: "text", name: "Text annotation" },
        { mode: "annotation", targetKey: "n7" },
        anns,
      )?.id,
    ).toBe("n7");
  });

  it("(h) renders the annotation scope for a selected SHAPE annotation", () => {
    // A shape (ink) publishes no text snapshot; the dedicated selected-annotation
    // id is the host's only source, so the scope must still populate and the
    // empty hint must not show.
    const shape = ink("ink-8", { page: 2, color: "blue" });
    const { host, unmount } = mount(
      <Inspector
        stage="review"
        selection={{ kind: "text", name: "Text annotation" }}
        selectedAnnotationId="ink-8"
        annotations={[shape]}
      />,
    );
    try {
      expect(host.querySelector("[data-inspector-review-empty]")).toBeNull();
      expect(host.querySelector("[data-inspector-review-actions]")).not.toBeNull();
      expect(host.querySelector("[data-ann-prop=\"color\"]")).not.toBeNull();
      expect(
        host.querySelector('[data-inspector-row="annotation-type"]')?.textContent,
      ).toContain("Pen stroke");
      expect(
        host.querySelector('[data-inspector-row="annotation-page"]')?.textContent,
      ).toContain("2");
    } finally {
      unmount();
    }
  });
});

function note(id: string): Annotation {
  return {
    id,
    page: 1,
    color: "green",
    createdAt: CREATED,
    kind: "note",
    at: { x: 1, y: 2 },
    text: "hi",
  };
}
