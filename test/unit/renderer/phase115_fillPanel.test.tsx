// @vitest-environment jsdom
//
// Phase 115 D1 - Guided Fill panel.
//
// The panel is built from the chunk-C primitives (FieldRow, RequiredSummary,
// validateFieldValue) and the shared FormFieldControl. It reads fields from
// props, shows no error and moves no focus until the explicit Validate action,
// and reports edits through the same (id, value) / (id, option) callbacks the
// canvas overlay uses.

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

const FIELDS: FormField[] = [
  field({ id: "f-name", name: "Full name", kind: "text", required: true }),
  field({
    id: "f-notes",
    name: "Notes",
    kind: "text",
    rect: { x: 0, y: 0, width: 120, height: 48 },
  }),
  field({
    id: "f-state",
    name: "State",
    kind: "dropdown",
    options: [
      { value: "ca", label: "California" },
      { value: "ny", label: "New York" },
    ],
  }),
  field({
    id: "f-locked",
    name: "Locked",
    kind: "checkbox",
    rect: { x: 0, y: 0, width: 14, height: 14 },
    value: "true",
    readOnly: true,
  }),
  field({
    id: "f-colors",
    name: "Colors",
    kind: "listbox",
    rect: { x: 0, y: 0, width: 120, height: 80 },
    value: [],
    multi: true,
    options: [
      { value: "red", label: "Red" },
      { value: "green", label: "Green" },
    ],
  }),
  field({
    id: "f-sign",
    name: "Signature",
    kind: "signature" as unknown as FormField["kind"],
    rect: { x: 0, y: 0, width: 160, height: 24 },
  }),
  field({ id: "f-page2", name: "On page two", kind: "text", page: 2 }),
];

interface Handle {
  host: HTMLElement;
  onValueChange: ReturnType<typeof vi.fn>;
  onToggleListbox: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function renderPanel(overrides: Partial<Parameters<typeof GuidedFillPanel>[0]> = {}): Handle {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const onValueChange = vi.fn();
  const onToggleListbox = vi.fn();
  const onClose = vi.fn();
  const root: Root = createRoot(host);
  act((): void => {
    root.render(
      <GuidedFillPanel
        fields={FIELDS}
        currentPage={1}
        totalPages={3}
        onValueChange={onValueChange}
        onToggleListbox={onToggleListbox}
        onClose={onClose}
        {...overrides}
      />,
    );
  });
  return {
    host,
    onValueChange,
    onToggleListbox,
    onClose,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act((): void => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("GuidedFillPanel - scope line", () => {
  it("(a) shows Document and 'Page n of m' as separate figures", () => {
    const m = renderPanel();
    try {
      const scope = m.host.querySelector<HTMLElement>("[data-form-scope]");
      const doc = m.host.querySelector<HTMLElement>('[data-form-scope-figure="document"]');
      const page = m.host.querySelector<HTMLElement>('[data-form-scope-figure="page"]');
      expect(scope).not.toBeNull();
      expect(doc?.textContent).toBe("Document");
      expect(page?.textContent).toBe("Page 1 of 3");
      expect(doc).not.toBe(page);
      expect(scope?.textContent).toContain("Document");
      expect(scope?.textContent).toContain("Page 1 of 3");
    } finally {
      m.unmount();
    }
  });
});

describe("GuidedFillPanel - required marker", () => {
  it("(b) the required marker appears only for the required field", () => {
    const m = renderPanel();
    try {
      const markers = m.host.querySelectorAll("[data-form-required]");
      expect(markers.length).toBe(1);
      expect(markers[0]?.closest('[data-form-field="f-name"]')).not.toBeNull();
    } finally {
      m.unmount();
    }
  });
});

describe("GuidedFillPanel - validate gates errors and focus", () => {
  it("(c) shows no error node before Validate", () => {
    const m = renderPanel();
    try {
      expect(m.host.querySelectorAll("[data-form-error]").length).toBe(0);
    } finally {
      m.unmount();
    }
  });

  it("(d) Validate shows the required error and focuses the first invalid control", () => {
    const m = renderPanel();
    try {
      const button = m.host.querySelector<HTMLButtonElement>("[data-form-validate]");
      expect(button).not.toBeNull();
      act((): void => {
        button?.click();
      });
      const error = m.host.querySelector<HTMLElement>("[data-form-error]");
      expect(error).not.toBeNull();
      expect(error?.textContent).toContain("This field is required.");
      const input = m.host.querySelector<HTMLInputElement>("#guided-fill-f-name-control");
      expect(input).not.toBeNull();
      expect(document.activeElement).toBe(input);
    } finally {
      m.unmount();
    }
  });
});

describe("GuidedFillPanel - per-kind controls", () => {
  it("(e) renders input/textarea/select/checkbox/listbox", () => {
    const m = renderPanel();
    try {
      expect(m.host.querySelector('input[data-form-kind="text"]')).not.toBeNull();
      expect(m.host.querySelector('textarea[data-form-kind="text"]')).not.toBeNull();
      expect(m.host.querySelector('select[data-form-kind="dropdown"]')).not.toBeNull();
      expect(m.host.querySelector('button[data-form-kind="checkbox"]')).not.toBeNull();
      expect(m.host.querySelector('ul[data-form-kind="listbox"]')).not.toBeNull();
      const non = m.host.querySelector<HTMLElement>('[data-form-nonfillable="true"]');
      expect(non?.textContent).toContain("Signature fields cannot be filled");
    } finally {
      m.unmount();
    }
  });

  it("(g) renders only the current page's fields", () => {
    const m = renderPanel();
    try {
      expect(m.host.querySelector('[data-form-field="f-page2"]')).toBeNull();
    } finally {
      m.unmount();
    }
  });
});

describe("GuidedFillPanel - edit callbacks and close", () => {
  it("(f) a text change calls onValueChange and a listbox click calls onToggleListbox", () => {
    const m = renderPanel();
    try {
      const input = m.host.querySelector<HTMLInputElement>('input[data-form-kind="text"]');
      expect(input).not.toBeNull();
      if (input !== null) setInputValue(input, "Jane");
      expect(m.onValueChange).toHaveBeenCalledWith("f-name", "Jane");
      const opt = m.host.querySelector<HTMLButtonElement>('button[data-form-option="red"]');
      expect(opt).not.toBeNull();
      act((): void => {
        opt?.click();
      });
      expect(m.onToggleListbox).toHaveBeenCalledWith("f-colors", "red");
    } finally {
      m.unmount();
    }
  });

  it("Escape calls onClose", () => {
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
