// @vitest-environment jsdom
//
// Phase 116 (TFL-1228 chunk H) - Thread Stream accessibility / adaptation.
//
// Pins the a11y hardening of the chunk-C primitives as consumed by the chunk-D
// AnnotationsPanel: the selected row reaches assistive tech via aria-current,
// every filter button carries an accessible name with exactly one aria-pressed,
// the row jump / delete controls keep non-empty accessible names and the delete
// control targets exactly its own row, and the empty-state tools action keeps
// its accessible name.

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

/** A DOM approximation of the accessible name: `aria-label` when present,
 *  otherwise the trimmed text content. */
function accessibleName(el: Element | null): string {
  if (el === null) return "";
  const label = el.getAttribute("aria-label");
  if (label !== null && label.trim() !== "") return label.trim();
  return (el.textContent ?? "").trim();
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

const THREE: Annotation[] = [markup("h1", 1), markup("h2", 2), note("n1", 1)];

describe("Phase 116 chunk H - Thread Stream accessibility", () => {
  it("delete control targets exactly its own row and keeps non-empty names", () => {
    const onDelete = vi.fn();
    const m = mount(
      <AnnotationsPanel
        annotations={THREE}
        onJumpTo={NOOP}
        onEdit={NOOP}
        onDelete={onDelete}
      />,
    );
    try {
      const row = m.host.querySelector('[data-annotation-row="h2"]');
      expect(row).not.toBeNull();
      const del = row?.querySelector<HTMLButtonElement>('button[aria-label^="Delete"]') ?? null;
      const jump = row?.querySelector<HTMLButtonElement>('button[aria-label^="Jump"]') ?? null;
      expect(del).not.toBeNull();
      expect(jump).not.toBeNull();
      expect(accessibleName(del)).not.toBe("");
      expect(accessibleName(jump)).not.toBe("");

      click(del);
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onDelete).toHaveBeenCalledWith("h2");
    } finally {
      m.unmount();
    }
  });

  it("exposes only the selected row via aria-current alongside data-ann-selected", () => {
    const m = mount(
      <AnnotationsPanel
        annotations={THREE}
        onJumpTo={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
        selectedAnnotationId="h2"
      />,
    );
    try {
      const selected = m.host.querySelector('[data-annotation-row="h2"]');
      expect(selected?.getAttribute("aria-current")).toBe("true");
      expect(selected?.getAttribute("data-ann-selected")).toBe("true");
      expect(m.host.querySelector('[data-annotation-row="h1"]')?.getAttribute("aria-current")).toBeNull();
      expect(m.host.querySelector('[data-annotation-row="n1"]')?.getAttribute("aria-current")).toBeNull();
    } finally {
      m.unmount();
    }
  });

  it("names every filter button and marks exactly one as pressed", () => {
    const m = mount(
      <AnnotationsPanel
        annotations={THREE}
        onJumpTo={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
      />,
    );
    try {
      const buttons = [...m.host.querySelectorAll<HTMLElement>("[data-ann-filter]")];
      expect(buttons.length).toBeGreaterThan(0);
      for (const b of buttons) {
        expect(b.getAttribute("aria-pressed")).not.toBeNull();
        expect(accessibleName(b)).not.toBe("");
      }
      expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);
      expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "false")).toHaveLength(
        buttons.length - 1,
      );
    } finally {
      m.unmount();
    }
  });

  it("keeps the 'Open annotation tools' accessible name on the empty-state action", () => {
    const m = mount(
      <AnnotationsPanel
        annotations={[]}
        onJumpTo={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
        onOpenTools={NOOP}
      />,
    );
    try {
      const action = m.host.querySelector("[data-ann-empty-action]");
      expect(action).not.toBeNull();
      expect(accessibleName(action)).toBe("Open annotation tools");
    } finally {
      m.unmount();
    }
  });
});
