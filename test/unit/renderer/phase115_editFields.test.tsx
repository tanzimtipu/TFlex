// @vitest-environment jsdom
//
// Phase 115 F - Edit / Field properties surface.
//
// FieldProperties is a read-only inspector of the focused field's real
// metadata. It must show only what the document declares, must never render an
// editable control, and must state plainly that editing is unsupported.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FieldProperties } from "../../../src/renderer/forms/FieldProperties";
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

interface Handle {
  host: HTMLElement;
  unmount: () => void;
}

function render(ui: React.ReactElement): Handle {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act((): void => {
    root.render(ui);
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

function valueOf(host: HTMLElement, name: string): string | null {
  const row = host.querySelector<HTMLElement>(`[data-form-property="${name}"]`);
  return row?.querySelector(".guided-fill-properties-value")?.textContent ?? null;
}

const UNSUPPORTED_TEXT =
  "Editing a field's name, type or flags is not supported by the current engine.";

describe("FieldProperties - empty state", () => {
  it("(f) renders the empty state and no property rows when field is null", () => {
    const m = render(<FieldProperties field={null} />);
    try {
      expect(m.host.querySelector("[data-form-properties-empty]")).not.toBeNull();
      expect(m.host.textContent).toContain("Select a field to see its properties.");
      expect(m.host.querySelector("[data-form-properties]")).toBeNull();
      expect(m.host.querySelectorAll("[data-form-property]").length).toBe(0);
    } finally {
      m.unmount();
    }
  });
});

describe("FieldProperties - required and read-only", () => {
  it("(a) Required is Yes only when required === true, else No", () => {
    const on = render(<FieldProperties field={field({ id: "a", name: "A", kind: "text", required: true })} />);
    try {
      expect(valueOf(on.host, "required")).toBe("Yes");
    } finally {
      on.unmount();
    }
    const off = render(<FieldProperties field={field({ id: "b", name: "B", kind: "text" })} />);
    try {
      expect(valueOf(off.host, "required")).toBe("No");
    } finally {
      off.unmount();
    }
  });

  it("(a) Read-only is Yes only when readOnly === true, else No", () => {
    const on = render(<FieldProperties field={field({ id: "a", name: "A", kind: "text", readOnly: true })} />);
    try {
      expect(valueOf(on.host, "read-only")).toBe("Yes");
    } finally {
      on.unmount();
    }
    const off = render(<FieldProperties field={field({ id: "b", name: "B", kind: "text" })} />);
    try {
      expect(valueOf(off.host, "read-only")).toBe("No");
    } finally {
      off.unmount();
    }
  });

  it("renders the declared Name and human Type label", () => {
    const m = render(<FieldProperties field={field({ id: "a", name: "Full name", kind: "dropdown" })} />);
    try {
      expect(valueOf(m.host, "name")).toBe("Full name");
      expect(valueOf(m.host, "type")).toBe("Dropdown");
    } finally {
      m.unmount();
    }
  });
});

describe("FieldProperties - tooltip row", () => {
  it("(b) shows the Tooltip row only when tooltip is a non-empty string", () => {
    const withTip = render(
      <FieldProperties field={field({ id: "a", name: "A", kind: "text", tooltip: "Enter your legal name" })} />,
    );
    try {
      expect(withTip.host.querySelector('[data-form-property="tooltip"]')).not.toBeNull();
      expect(valueOf(withTip.host, "tooltip")).toBe("Enter your legal name");
    } finally {
      withTip.unmount();
    }

    const noTip = render(<FieldProperties field={field({ id: "b", name: "B", kind: "text" })} />);
    try {
      expect(noTip.host.querySelector('[data-form-property="tooltip"]')).toBeNull();
    } finally {
      noTip.unmount();
    }

    const emptyTip = render(
      <FieldProperties field={field({ id: "c", name: "C", kind: "text", tooltip: "" })} />,
    );
    try {
      expect(emptyTip.host.querySelector('[data-form-property="tooltip"]')).toBeNull();
    } finally {
      emptyTip.unmount();
    }
  });
});

describe("FieldProperties - options", () => {
  it("(c) a dropdown lists each real option label and value", () => {
    const m = render(
      <FieldProperties
        field={field({
          id: "s",
          name: "State",
          kind: "dropdown",
          options: [
            { value: "ca", label: "California" },
            { value: "ny", label: "New York" },
          ],
        })}
      />,
    );
    try {
      const options = m.host.querySelectorAll("[data-form-option-value]");
      expect(options.length).toBe(2);
      expect(options[0]?.getAttribute("data-form-option-value")).toBe("ca");
      expect(options[0]?.textContent).toContain("California");
      expect(options[0]?.textContent).toContain("ca");
      expect(options[1]?.getAttribute("data-form-option-value")).toBe("ny");
      expect(options[1]?.textContent).toContain("New York");
    } finally {
      m.unmount();
    }
  });

  it("(c) a multi listbox states multiple selection", () => {
    const m = render(
      <FieldProperties
        field={field({
          id: "c",
          name: "Colors",
          kind: "listbox",
          multi: true,
          value: [],
          options: [
            { value: "red", label: "Red" },
            { value: "green", label: "Green" },
          ],
        })}
      />,
    );
    try {
      const multi = m.host.querySelector("[data-form-property-multi]");
      expect(multi).not.toBeNull();
      expect(multi?.textContent).toContain("multiple selection");
    } finally {
      m.unmount();
    }
  });

  it("does not render an options row for a text field", () => {
    const m = render(<FieldProperties field={field({ id: "t", name: "T", kind: "text" })} />);
    try {
      expect(m.host.querySelector('[data-form-property="options"]')).toBeNull();
    } finally {
      m.unmount();
    }
  });
});

describe("FieldProperties - read-only guarantees", () => {
  it("(d) renders no input, select, textarea or button", () => {
    const m = render(
      <FieldProperties
        field={field({
          id: "c",
          name: "Colors",
          kind: "listbox",
          multi: true,
          required: true,
          readOnly: true,
          tooltip: "tip",
          options: [{ value: "red", label: "Red" }],
        })}
      />,
    );
    try {
      expect(m.host.querySelectorAll("input").length).toBe(0);
      expect(m.host.querySelectorAll("select").length).toBe(0);
      expect(m.host.querySelectorAll("textarea").length).toBe(0);
      expect(m.host.querySelectorAll("button").length).toBe(0);
    } finally {
      m.unmount();
    }
  });

  it("(e) renders the unsupported note with the exact text", () => {
    const m = render(<FieldProperties field={field({ id: "a", name: "A", kind: "text" })} />);
    try {
      const note = m.host.querySelector("[data-form-edit-unsupported]");
      expect(note).not.toBeNull();
      expect(note?.textContent).toBe(UNSUPPORTED_TEXT);
    } finally {
      m.unmount();
    }
  });
});

describe("GuidedFillPanel - properties mount", () => {
  it("mounts the Field properties section and reflects the focused field", () => {
    const fields: FormField[] = [
      field({ id: "f-name", name: "Full name", kind: "text", required: true }),
    ];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    act((): void => {
      root.render(
        <GuidedFillPanel
          fields={fields}
          currentPage={1}
          totalPages={1}
          onValueChange={(): void => {}}
          onToggleListbox={(): void => {}}
          onClose={(): void => {}}
          focusedFieldId="f-name"
        />,
      );
    });
    try {
      const section = host.querySelector("[data-form-properties-section]");
      expect(section).not.toBeNull();
      expect(section?.querySelector(".guided-fill-panel-properties-heading")?.textContent).toBe(
        "Field properties",
      );
      expect(host.querySelector("[data-form-properties]")).not.toBeNull();
      expect(host.querySelector("[data-form-properties-empty]")).toBeNull();
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }

    const host2 = document.createElement("div");
    document.body.appendChild(host2);
    const root2: Root = createRoot(host2);
    act((): void => {
      root2.render(
        <GuidedFillPanel
          fields={fields}
          currentPage={1}
          totalPages={1}
          onValueChange={(): void => {}}
          onToggleListbox={(): void => {}}
          onClose={(): void => {}}
        />,
      );
    });
    try {
      expect(host2.querySelector("[data-form-properties-empty]")).not.toBeNull();
    } finally {
      act((): void => {
        root2.unmount();
      });
      host2.remove();
    }
  });
});