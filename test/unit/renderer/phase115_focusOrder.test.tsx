// @vitest-environment jsdom
//
// Phase 115 E - Guided Fill keyboard order + highlight link.
//
// The panel renders one row per page field IN THE DOCUMENT'S FIELD ORDER, so
// native Tab / Shift+Tab follow that order with no custom key handling. The
// canvas field and the panel row linked to the same focused id each carry a
// data-* highlight marker; the link is HIGHLIGHT + ID ONLY - no DOM focus is
// moved, so focus can never cycle. Escape still closes the panel.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GuidedFillPanel } from "../../../src/renderer/forms/GuidedFillPanel";
import type { FormField } from "../../../src/shared/types";

function field(overrides: Partial<FormField> & Pick<FormField, "id" | "name" | "kind">): FormField {
  return {
    page: 1,
    rect: { x: 0, y: 0, width: 120, height: 20 },
    value: "",
    ...overrides,
  };
}

// Distinct ids AND pages: the page-2 field must not appear on page 1.
const FIELDS: FormField[] = [
  field({ id: "f-a", name: "Alpha", kind: "text" }),
  field({ id: "f-b", name: "Bravo", kind: "text", rect: { x: 0, y: 0, width: 120, height: 48 } }),
  field({
    id: "f-c",
    name: "Charlie",
    kind: "dropdown",
    options: [
      { value: "x", label: "Ex" },
      { value: "y", label: "Why" },
    ],
  }),
  field({ id: "f-d", name: "Delta", kind: "checkbox", rect: { x: 0, y: 0, width: 14, height: 14 } }),
  field({
    id: "f-e",
    name: "Echo",
    kind: "listbox",
    rect: { x: 0, y: 0, width: 120, height: 80 },
    value: [],
    multi: true,
    options: [{ value: "r", label: "Red" }],
  }),
  field({ id: "f-p2", name: "On page two", kind: "text", page: 2 }),
];

const PAGE1_ORDER = ["f-a", "f-b", "f-c", "f-d", "f-e"];

interface Handle {
  host: HTMLElement;
  onValueChange: ReturnType<typeof vi.fn>;
  onToggleListbox: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  onFieldFocus: ReturnType<typeof vi.fn>;
  rerender: (overrides: Partial<Parameters<typeof GuidedFillPanel>[0]>) => void;
  unmount: () => void;
}

function renderPanel(overrides: Partial<Parameters<typeof GuidedFillPanel>[0]> = {}): Handle {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const onValueChange = vi.fn();
  const onToggleListbox = vi.fn();
  const onClose = vi.fn();
  const onFieldFocus = vi.fn();
  const root: Root = createRoot(host);
  const base = {
    fields: FIELDS,
    currentPage: 1,
    totalPages: 2,
    onValueChange,
    onToggleListbox,
    onClose,
    onFieldFocus,
  };
  const rerender = (next: Partial<Parameters<typeof GuidedFillPanel>[0]>): void => {
    act((): void => {
      root.render(<GuidedFillPanel {...base} {...next} />);
    });
  };
  rerender(overrides);
  return {
    host,
    onValueChange,
    onToggleListbox,
    onClose,
    onFieldFocus,
    rerender,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/** Every value control root (one per fillable field) in DOM order. */
function controlOrder(host: HTMLElement): string[] {
  const nodes = host.querySelectorAll<HTMLElement>("[data-form-kind]");
  return Array.from(nodes).map((el) => el.getAttribute("data-form-field") ?? "");
}

function controlFor(host: HTMLElement, fieldId: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(`#guided-fill-${fieldId}-control`);
  if (el === null) throw new Error(`no control for ${fieldId}`);
  return el;
}

describe("Phase 115 E - Guided Fill keyboard order", () => {
  it("(a) renders the page's value controls in document field order", () => {
    const m = renderPanel();
    try {
      expect(controlOrder(m.host)).toEqual(PAGE1_ORDER);
      expect(m.host.querySelector('[data-form-field="f-p2"]')).toBeNull();
    } finally {
      m.unmount();
    }
  });
});

describe("Phase 115 E - focus link is highlight only", () => {
  it("(b) marks exactly the focused row and no other", () => {
    const m = renderPanel({ focusedFieldId: "f-c" });
    try {
      const marked = m.host.querySelectorAll('[data-form-active="true"]');
      expect(marked.length).toBe(1);
      expect(marked[0]?.getAttribute("data-form-field")).toBe("f-c");
    } finally {
      m.unmount();
    }
  });

  it("marks no row when focusedFieldId is null", () => {
    const m = renderPanel({ focusedFieldId: null });
    try {
      expect(m.host.querySelectorAll('[data-form-active="true"]').length).toBe(0);
    } finally {
      m.unmount();
    }
  });

  it("(c) reports the field id when its control gains focus", () => {
    const m = renderPanel();
    try {
      act((): void => {
        controlFor(m.host, "f-b").dispatchEvent(
          new FocusEvent("focusin", { bubbles: true }),
        );
      });
      expect(m.onFieldFocus).toHaveBeenCalledTimes(1);
      expect(m.onFieldFocus).toHaveBeenCalledWith("f-b");
    } finally {
      m.unmount();
    }
  });

  it("(d) never moves focus when the linked id changes", () => {
    const m = renderPanel();
    try {
      const a = controlFor(m.host, "f-a");
      act((): void => {
        a.focus();
      });
      expect(document.activeElement).toBe(a);
      const focusSpy = vi.spyOn(a, "focus");

      m.rerender({ focusedFieldId: "f-c" });

      expect(document.activeElement).toBe(a);
      expect(focusSpy).not.toHaveBeenCalled();
      expect(
        m.host.querySelector('[data-form-active="true"]')?.getAttribute("data-form-field"),
      ).toBe("f-c");
    } finally {
      m.unmount();
    }
  });
});

describe("Phase 115 E - Escape closes the panel", () => {
  it("(e) calls onClose once on Escape", () => {
    const m = renderPanel();
    try {
      const root = m.host.querySelector<HTMLElement>("[data-form-panel]");
      expect(root).not.toBeNull();
      act((): void => {
        root?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(m.onClose).toHaveBeenCalledTimes(1);
    } finally {
      m.unmount();
    }
  });
});