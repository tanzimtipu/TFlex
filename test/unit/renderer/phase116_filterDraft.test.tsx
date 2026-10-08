// @vitest-environment jsdom
//
// Phase 116 (TFL-1228 chunk D) - the left navigator's Thread Stream migration.
//
// Pins AnnotationsPanel onto the chunk-C primitives: the All / kind filter,
// selection retention across filtering, the document-empty vs filter-empty
// states, the retired colour swatch, and that filtering never dispatches an
// edit or a delete.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AnnotationsPanel } from "../../../src/renderer/annotations/AnnotationsPanel";
import type { Annotation } from "../../../src/renderer/annotations/model";

const NOOP = (): void => undefined;

interface Mounted {
  host: HTMLElement;
  root: Root;
  unmount: () => void;
}

function mount(element: ReactElement): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return {
    host,
    root,
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

function markup(id: string, page: number): Annotation {
  return {
    id,
    page,
    color: "yellow",
    createdAt: "2026-01-01T00:00:00Z",
    kind: "highlight",
    rects: [{ x: 0, y: 0, width: 10, height: 10 }],
    text: `Excerpt ${id}`,
  };
}

function note(id: string, page: number): Annotation {
  return {
    id,
    page,
    color: "green",
    createdAt: "2026-01-01T00:00:01Z",
    kind: "note",
    at: { x: 0, y: 0 },
    text: `Note ${id}`,
  };
}

function rowIds(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLElement>("[data-annotation-row]")].map(
    (r) => r.getAttribute("data-annotation-row") ?? "",
  );
}

describe("Phase 116 - AnnotationsPanel filter", () => {
  it("renders All plus one filter per kind and filters the rows", () => {
    const m = mount(
      <AnnotationsPanel
        annotations={[markup("h1", 1), markup("h2", 2), note("n1", 1)]}
        onJumpTo={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
      />,
    );
    try {
      const filters = [...m.host.querySelectorAll("[data-ann-filter]")].map((b) =>
        b.getAttribute("data-ann-filter"),
      );
      expect(filters).toEqual(["all", "highlight", "note"]);
      // Page 1 (h1 created 00:00:00, n1 created 00:00:01), then page 2 (h2).
      expect(rowIds(m.host)).toEqual(["h1", "n1", "h2"]);

      click(m.host.querySelector('[data-ann-filter="highlight"]'));
      expect(rowIds(m.host)).toEqual(["h1", "h2"]);
      expect(
        m.host.querySelector('[data-ann-filter="highlight"]')?.getAttribute("aria-pressed"),
      ).toBe("true");

      click(m.host.querySelector('[data-ann-filter="all"]'));
      expect(rowIds(m.host)).toEqual(["h1", "n1", "h2"]);
    } finally {
      m.unmount();
    }
  });

  it("retains the selected row across a filter change", () => {
    const m = mount(
      <AnnotationsPanel
        annotations={[markup("h1", 1), note("n1", 2)]}
        onJumpTo={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
        selectedAnnotationId="h1"
      />,
    );
    try {
      expect(
        m.host.querySelector('[data-annotation-row="h1"]')?.getAttribute("data-ann-selected"),
      ).toBe("true");
      expect(
        m.host.querySelector('[data-annotation-row="n1"]')?.getAttribute("data-ann-selected"),
      ).toBe("false");

      click(m.host.querySelector('[data-ann-filter="highlight"]'));
      expect(
        m.host.querySelector('[data-annotation-row="h1"]')?.getAttribute("data-ann-selected"),
      ).toBe("true");
    } finally {
      m.unmount();
    }
  });

  it("renders the document empty state and fires onOpenTools", () => {
    const onOpenTools = vi.fn();
    const m = mount(
      <AnnotationsPanel
        annotations={[]}
        onJumpTo={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
        onOpenTools={onOpenTools}
      />,
    );
    try {
      expect(m.host.querySelector("[data-annotation-empty]")).not.toBeNull();
      const action = m.host.querySelector<HTMLElement>("[data-ann-empty-action]");
      expect(action).not.toBeNull();
      click(action);
      expect(onOpenTools).toHaveBeenCalledTimes(1);
    } finally {
      m.unmount();
    }
  });

  it("shows the filter-empty state, not the document-empty state, when a filter matches none", () => {
    const m = mount(
      <AnnotationsPanel
        annotations={[markup("h1", 1), note("n1", 2)]}
        onJumpTo={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
      />,
    );
    try {
      click(m.host.querySelector('[data-ann-filter="note"]'));
      expect(rowIds(m.host)).toEqual(["n1"]);
      // Re-render with the matching annotation removed while the filter holds.
      act((): void => {
        m.root.render(
          <AnnotationsPanel
            annotations={[markup("h1", 1)]}
            onJumpTo={NOOP}
            onEdit={NOOP}
            onDelete={NOOP}
          />,
        );
      });
      expect(m.host.querySelector("[data-ann-filtered-empty]")).not.toBeNull();
      expect(m.host.querySelector("[data-annotation-empty]")).toBeNull();
      expect(rowIds(m.host)).toEqual([]);
    } finally {
      m.unmount();
    }
  });

  it("changing the filter calls neither onEdit nor onDelete", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const m = mount(
      <AnnotationsPanel
        annotations={[markup("h1", 1), note("n1", 2)]}
        onJumpTo={NOOP}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    try {
      click(m.host.querySelector('[data-ann-filter="highlight"]'));
      click(m.host.querySelector('[data-ann-filter="all"]'));
      click(m.host.querySelector('[data-ann-filter="note"]'));
      expect(onEdit).not.toHaveBeenCalled();
      expect(onDelete).not.toHaveBeenCalled();
    } finally {
      m.unmount();
    }
  });

  it("renders no colour swatch anywhere in the panel", () => {
    const m = mount(
      <AnnotationsPanel
        annotations={[markup("h1", 1), note("n1", 2)]}
        onJumpTo={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
      />,
    );
    try {
      expect(m.host.querySelector(".ann-panel-swatch")).toBeNull();
      expect(m.host.querySelector("[data-color]")).toBeNull();
    } finally {
      m.unmount();
    }
  });
});
