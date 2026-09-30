// @vitest-environment jsdom
//
// Phase 59 item 4 (part 3) — per-widget form editors + native-fill report UI.
//
// The backend now lists one entry per widget (a 6-option radio group ships
// 24 widget rects) and classifies >1-widget button groups as `radio` with a
// `widgets[]` array. These specs pin the renderer half:
//   (a) a 3-widget radio group renders THREE controls at the three rects
//       with the correct per-widget values;
//   (b) selecting the second calls the fill with the group's second option
//       and marks only that widget selected;
//   (c) a read-only field renders non-editable with the truthful reason;
//   (d) a mixed-status formFillReport renders a summary naming each skipped
//       field + reason;
//   (e) a single checkbox / text field is unchanged.

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  FormsOverlay,
  FormFillReportSummary,
  READ_ONLY_REASON,
} from "../../../src/renderer/forms/FormsOverlay";
import type { FormField, FormFieldKind, FormFillReport } from "../../../src/shared/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Mount {
  container: HTMLElement;
  rerender: (fields: FormField[]) => void;
  onChange: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function mountOverlay(fields: FormField[]): Mount {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onChange = vi.fn();
  const root: Root = createRoot(container);
  const render = (next: FormField[]): void => {
    act((): void => {
      root.render(
        <FormsOverlay
          page={1}
          cssScale={1}
          fields={next}
          onValueChange={(id: string, value: string | string[]): void => onChange(id, value)}
          onToggleListbox={(): void => undefined}
        />,
      );
    });
  };
  render(fields);
  return {
    container,
    rerender: render,
    onChange,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function widgetRadio(overrides: Partial<FormField> = {}): FormField {
  return {
    id: "f-radio",
    name: "gender",
    page: 1,
    kind: "radio",
    rect: { x: 0, y: 0, width: 14, height: 14 },
    value: "",
    options: [
      { value: "mr", label: "Mr" },
      { value: "ms", label: "Ms" },
      { value: "dr", label: "Dr" },
    ],
    widgets: [
      { value: "mr", rect: { x: 100, y: 20, width: 14, height: 14 }, selected: false },
      { value: "ms", rect: { x: 100, y: 44, width: 14, height: 14 }, selected: false },
      { value: "dr", rect: { x: 100, y: 68, width: 14, height: 14 }, selected: false },
    ],
    ...overrides,
  };
}

describe("Phase 59 item 4 — per-widget form editors", () => {
  it("(a) renders one control per widget at each widget rect, with its own value", () => {
    const m = mountOverlay([widgetRadio()]);
    const controls = m.container.querySelectorAll<HTMLButtonElement>(
      'button[data-form-kind="radio"][data-form-widget]',
    );
    expect(controls.length).toBe(3);
    expect(controls[0]?.style.left).toBe("100px");
    expect(controls[0]?.style.top).toBe("20px");
    expect(controls[1]?.style.top).toBe("44px");
    expect(controls[2]?.style.top).toBe("68px");
    expect(controls[0]?.getAttribute("data-form-widget-value")).toBe("mr");
    expect(controls[1]?.getAttribute("data-form-widget-value")).toBe("ms");
    expect(controls[2]?.getAttribute("data-form-widget-value")).toBe("dr");
    expect(controls[0]?.textContent).toContain("mr");
    expect(controls[1]?.textContent).toContain("ms");
    expect(controls[2]?.textContent).toContain("dr");
    m.unmount();
  });

  it("(b) selecting the second widget fills the group value and selects only that widget", () => {
    const m = mountOverlay([widgetRadio()]);
    const second = m.container.querySelector<HTMLButtonElement>(
      'button[data-form-widget-value="ms"]',
    );
    expect(second).not.toBeNull();
    if (second === null) return m.unmount();
    act((): void => {
      second.click();
    });
    expect(m.onChange).toHaveBeenCalledWith("f-radio", "ms");

    // The host (App.tsx) updates the group value optimistically; re-render
    // with the field now carrying value 'ms' (and the engine's per-widget
    // selection flags) and assert exactly one control reads selected.
    m.rerender([
      widgetRadio({
        value: "ms",
        widgets: [
          { value: "mr", rect: { x: 100, y: 20, width: 14, height: 14 }, selected: false },
          { value: "ms", rect: { x: 100, y: 44, width: 14, height: 14 }, selected: true },
          { value: "dr", rect: { x: 100, y: 68, width: 14, height: 14 }, selected: false },
        ],
      }),
    ]);
    const checked = m.container.querySelectorAll<HTMLButtonElement>(
      'button[data-form-kind="radio"].form-radio-checked',
    );
    expect(checked.length).toBe(1);
    expect(checked[0]?.getAttribute("data-form-widget-value")).toBe("ms");
    m.unmount();
  });

  it("(c) a read-only text field renders non-editable with the truthful reason", () => {
    const field: FormField = {
      id: "f-locked",
      name: "locked",
      page: 1,
      kind: "text",
      rect: { x: 0, y: 0, width: 120, height: 20 },
      value: "Fixed",
      readOnly: true,
    };
    const m = mountOverlay([field]);
    const input = m.container.querySelector<HTMLInputElement>(
      'input[data-form-field="f-locked"]',
    );
    expect(input).not.toBeNull();
    if (input === null) return m.unmount();
    expect(input.disabled).toBe(true);
    expect(input.title).toBe(READ_ONLY_REASON);
    expect(input.getAttribute("data-form-readonly")).toBe("true");
    // A disabled control never dispatches a fill.
    act((): void => {
      input.click();
    });
    expect(m.onChange).not.toHaveBeenCalled();
    m.unmount();
  });

  it("(c) a read-only multi-widget radio group renders each widget non-editable", () => {
    const m = mountOverlay([widgetRadio({ readOnly: true, value: "mr" })]);
    const controls = m.container.querySelectorAll<HTMLButtonElement>(
      'button[data-form-widget]',
    );
    expect(controls.length).toBe(3);
    for (const c of Array.from(controls)) {
      expect(c.disabled).toBe(true);
      expect(c.title).toBe(READ_ONLY_REASON);
      expect(c.getAttribute("data-form-readonly")).toBe("true");
    }
    act((): void => {
      controls[1]?.click();
    });
    expect(m.onChange).not.toHaveBeenCalled();
    m.unmount();
  });
});

describe("Phase 59 item 4 — native-fill report summary", () => {
  it("(d) names every skipped field and its reason, and counts filled vs skipped", () => {
    const report: FormFillReport[] = [
      { name: "first", page: 1, kind: "text", status: "filled" },
      { name: "locked", page: 1, kind: "text", status: "skipped-readonly" },
      { name: "sig1", page: 1, kind: "signature", status: "skipped-signature" },
      { name: "title", page: 1, kind: "text", status: "font-unavailable" },
      { name: "xfaRoot", page: null, kind: "xfa", status: "xfa" },
      { name: "orphan1", page: 2, kind: "orphan", status: "orphan-unfilled" },
    ];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(<FormFillReportSummary report={report} />);
    });
    expect(container.querySelector("[data-form-fill-report]")).not.toBeNull();
    expect(container.querySelector("[data-form-fill-counts]")?.textContent).toContain(
      "1 filled",
    );
    expect(container.querySelector("[data-form-fill-counts]")?.textContent).toContain(
      "5 skipped",
    );
    const skipRows = container.querySelectorAll("[data-form-fill-skip]");
    expect(skipRows.length).toBe(5);
    const text = container.textContent ?? "";
    expect(text).toContain("locked");
    expect(text).toContain("read-only");
    expect(text).toContain("sig1");
    expect(text).toContain("signature");
    expect(text).toContain("title");
    expect(text).toContain("font does not support the text");
    expect(text).toContain("xfaRoot");
    expect(text).toContain("XFA");
    expect(text).toContain("orphan1");
    expect(text).toContain("orphan widget");
    act((): void => {
      root.unmount();
    });
    container.remove();
  });

  it("(d) the dismiss control fires and an empty report renders nothing", () => {
    const onDismiss = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        <FormFillReportSummary
          report={[{ name: "locked", page: 1, kind: "text", status: "skipped-readonly" }]}
          onDismiss={onDismiss}
        />,
      );
    });
    const dismiss = container.querySelector<HTMLButtonElement>("[data-form-fill-dismiss]");
    expect(dismiss).not.toBeNull();
    act((): void => {
      dismiss?.click();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // Empty report -> no DOM.
    act((): void => {
      root.render(<FormFillReportSummary report={[]} />);
    });
    expect(container.querySelector("[data-form-fill-report]")).toBeNull();
    act((): void => {
      root.unmount();
    });
    container.remove();
  });
});

describe("Phase 59 item 4 — ADV-123 / ADV-124: non-fillable kinds never become inputs", () => {
  function nonFillable(kind: string): FormField {
    return {
      id: `f-${kind}`,
      name: kind,
      page: 1,
      kind: kind as unknown as FormFieldKind,
      rect: { x: 10, y: 20, width: 160, height: 24 },
      value: "",
    };
  }

  it("a signature field renders non-editable with the signature reason, not an input", () => {
    const m = mountOverlay([nonFillable("signature")]);
    // No editable control of ANY kind is mounted for it.
    expect(m.container.querySelector("input")).toBeNull();
    expect(m.container.querySelector("textarea")).toBeNull();
    expect(m.container.querySelector("select")).toBeNull();
    expect(m.container.querySelector("button")).toBeNull();
    const view = m.container.querySelector<HTMLElement>('[data-form-nonfillable="true"]');
    expect(view).not.toBeNull();
    if (view === null) return m.unmount();
    expect(view.getAttribute("data-form-kind")).toBe("signature");
    expect(view.getAttribute("data-form-readonly")).toBe("true");
    expect(view.getAttribute("title")).toBe("Signature fields cannot be filled");
    expect(view.getAttribute("aria-label")).toBe("Signature fields cannot be filled");
    expect(view.textContent).toContain("Signature fields cannot be filled");
    act((): void => {
      view.click();
    });
    expect(m.onChange).not.toHaveBeenCalled();
    m.unmount();
  });

  it("an orphan widget renders non-editable with the orphan reason, not an input", () => {
    const m = mountOverlay([nonFillable("orphan")]);
    expect(m.container.querySelector("input")).toBeNull();
    expect(m.container.querySelector("textarea")).toBeNull();
    const view = m.container.querySelector<HTMLElement>('[data-form-nonfillable="true"]');
    expect(view).not.toBeNull();
    if (view === null) return m.unmount();
    expect(view.getAttribute("data-form-kind")).toBe("orphan");
    expect(view.getAttribute("title")).toBe("Orphan widgets cannot be filled");
    expect(view.textContent).toContain("Orphan widgets cannot be filled");
    act((): void => {
      view.click();
    });
    expect(m.onChange).not.toHaveBeenCalled();
    m.unmount();
  });

  it("a listing that flags a field unfillable renders it non-editable (forward-compatible kind)", () => {
    const flagged = {
      id: "f-flagged",
      name: "flagged",
      page: 1,
      kind: "text",
      rect: { x: 0, y: 0, width: 120, height: 20 },
      value: "",
      fillable: false,
    } as unknown as FormField;
    const m = mountOverlay([flagged]);
    expect(m.container.querySelector("input")).toBeNull();
    const view = m.container.querySelector<HTMLElement>('[data-form-nonfillable="true"]');
    expect(view).not.toBeNull();
    expect(view?.getAttribute("title")).toBe("This field cannot be filled");
    m.unmount();
  });

  it("a fillable text field in the same overlay is still editable (the gate is per-kind)", () => {
    const m = mountOverlay([
      nonFillable("signature"),
      {
        id: "f-name",
        name: "name",
        page: 1,
        kind: "text",
        rect: { x: 0, y: 60, width: 120, height: 20 },
        value: "",
      },
    ]);
    expect(m.container.querySelector('input[data-form-field="f-name"]')).not.toBeNull();
    expect(
      m.container.querySelector('[data-form-nonfillable="true"][data-form-field="f-signature"]'),
    ).not.toBeNull();
    m.unmount();
  });
});

describe("Phase 59 item 4 — no regression for single-control fields", () => {
  it("(e) a single checkbox still toggles through onValueChange", () => {
    const field: FormField = {
      id: "f-terms",
      name: "terms",
      page: 1,
      kind: "checkbox",
      rect: { x: 0, y: 0, width: 14, height: 14 },
      value: "false",
    };
    const m = mountOverlay([field]);
    const box = m.container.querySelector<HTMLButtonElement>(
      'button[data-form-field="f-terms"]',
    );
    expect(box).not.toBeNull();
    if (box === null) return m.unmount();
    act((): void => {
      box.click();
    });
    expect(m.onChange).toHaveBeenCalledWith("f-terms", "true");
    m.unmount();
  });

  it("(e) a text field still fires onValueChange and a widget-less radio keeps the options layout", () => {
    const text: FormField = {
      id: "f-name",
      name: "name",
      page: 1,
      kind: "text",
      rect: { x: 0, y: 0, width: 120, height: 20 },
      value: "",
    };
    const radio: FormField = {
      id: "f-choice",
      name: "choice",
      page: 1,
      kind: "radio",
      rect: { x: 0, y: 40, width: 120, height: 20 },
      value: "",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    };
    const m = mountOverlay([text, radio]);
    const input = m.container.querySelector<HTMLInputElement>(
      'input[data-form-field="f-name"]',
    );
    expect(input).not.toBeNull();
    if (input !== null) {
      act((): void => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, "Jane");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(m.onChange).toHaveBeenCalledWith("f-name", "Jane");
    }
    // No widgets -> the options-based single-select editor is retained.
    const options = m.container.querySelectorAll('button[data-form-option]');
    expect(options.length).toBe(2);
    act((): void => {
      m.container
        .querySelector<HTMLButtonElement>('button[data-form-option="no"]')
        ?.click();
    });
    expect(m.onChange).toHaveBeenLastCalledWith("f-choice", "no");
    m.unmount();
  });
});
