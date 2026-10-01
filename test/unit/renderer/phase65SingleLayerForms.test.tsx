// @vitest-environment jsdom
//
// Phase 65 chunk 1 (driver TFL-49 / DEF-436) — single-layer, Adobe-grade
// form field rendering.
//
// DEF-436: on the operator's 956.pdf every field showed TWICE — the page
// canvas painted the widget's own /AP appearance, then FormsOverlay
// painted a second transparent, accent-bordered editor over the same box.
// The renderer-side fix has two halves:
//   (1) PageView passes `annotationMode: AnnotationMode.ENABLE_FORMS` to
//       pageProxy.render so pdf.js leaves standard HTML-renderable widget
//       appearances OUT of the canvas display list. The editor is then the
//       ONLY visible field affordance (one surface, not two).
//   (2) FormsOverlay's old page-wide zero-rect heuristic (restack EVERY
//       editor down the left margin if ANY field had a zero rect) is
//       replaced by PER-FIELD handling: a usable rect renders exactly at
//       field.rect; only a genuinely degenerate rect gets a staggered,
//       positive-sized fallback box.
//
// These specs pin the renderer half:
//   (a) EXACTLY one control per field at `field.rect`;
//   (b) a multi-widget group renders one control per widget at each
//       `widget.rect`;
//   (c) no left-margin stacking when every rect is usable (and a single
//       degenerate rect no longer restacks the whole page);
//   (d) the fill dispatch path still fires with the same payload.
//   (e) static guard: PageView's one render call requests ENABLE_FORMS.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FormsOverlay, mapRectForRotation } from "../../../src/renderer/forms/FormsOverlay";
import type { FormField } from "../../../src/shared/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Mount {
  container: HTMLElement;
  rerender: (fields: FormField[]) => void;
  onChange: ReturnType<typeof vi.fn>;
  onToggleListbox: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

interface MountOptions {
  rotation?: number;
  pageWidthPt?: number;
  pageHeightPt?: number;
}

function mountOverlay(fields: FormField[], options: MountOptions = {}): Mount {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onChange = vi.fn();
  const onToggleListbox = vi.fn();
  const root: Root = createRoot(container);
  const render = (next: FormField[]): void => {
    act((): void => {
      root.render(
        <FormsOverlay
          page={1}
          cssScale={1}
          fields={next}
          rotation={options.rotation}
          pageWidthPt={options.pageWidthPt}
          pageHeightPt={options.pageHeightPt}
          onValueChange={(id: string, value: string | string[]): void => onChange(id, value)}
          onToggleListbox={(id: string, option: string): void => onToggleListbox(id, option)}
        />,
      );
    });
  };
  render(fields);
  return {
    container,
    rerender: render,
    onChange,
    onToggleListbox,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function textField(id: string, rect: FormField["rect"], value = ""): FormField {
  return { id, name: id, page: 1, kind: "text", rect, value };
}

function checkboxField(id: string, rect: FormField["rect"], value = "false"): FormField {
  return { id, name: id, page: 1, kind: "checkbox", rect, value };
}

function widgetRadio(): FormField {
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
  };
}

describe("Phase 65 — exactly one control per field at field.rect", () => {
  it("(a) a text field renders ONE editor positioned at its own rect", () => {
    const m = mountOverlay([textField("f-a", { x: 50, y: 70, width: 120, height: 20 })]);
    const controls = m.container.querySelectorAll('[data-form-field="f-a"]');
    expect(controls.length).toBe(1);
    const input = controls[0] as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.style.left).toBe("50px");
    expect(input.style.top).toBe("70px");
    expect(input.style.width).toBe("120px");
    m.unmount();
  });

  it("(a) a checkbox renders ONE control at its own rect (not a second box elsewhere)", () => {
    const m = mountOverlay([checkboxField("f-cb", { x: 200, y: 300, width: 14, height: 14 })]);
    const controls = m.container.querySelectorAll('[data-form-field="f-cb"]');
    expect(controls.length).toBe(1);
    const btn = controls[0] as HTMLButtonElement;
    expect(btn.style.left).toBe("200px");
    m.unmount();
  });
});

describe("Phase 65 — one control per widget of a multi-widget group", () => {
  it("(b) a 3-widget radio group renders three controls at the three widget rects", () => {
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
    m.unmount();
  });
});

describe("Phase 65 item 4 — degenerate rects never restack a well-formed page", () => {
  it("(c) every usable rect renders at its own position, none stacked at the left margin", () => {
    const m = mountOverlay([
      textField("f-1", { x: 10, y: 10, width: 100, height: 20 }),
      checkboxField("f-2", { x: 10, y: 60, width: 14, height: 14 }),
      textField("f-3", { x: 200, y: 120, width: 80, height: 18 }),
    ]);
    const a = m.container.querySelector<HTMLElement>('[data-form-field="f-1"]');
    const b = m.container.querySelector<HTMLElement>('[data-form-field="f-2"]');
    const c = m.container.querySelector<HTMLElement>('[data-form-field="f-3"]');
    expect(a?.style.left).toBe("10px");
    expect(a?.style.top).toBe("10px");
    expect(b?.style.left).toBe("10px");
    expect(c?.style.left).toBe("200px");
    expect(c?.style.top).toBe("120px");
    // The old heuristic dropped every editor at x=36 whenever ANY field
    // had a zero rect; with all rects usable no editor may sit there.
    const stacked = Array.from(
      m.container.querySelectorAll<HTMLElement>("[data-form-field]"),
    ).filter((el) => el.style.left === "36px");
    expect(stacked.length).toBe(0);
    m.unmount();
  });

  it("(c) a single degenerate rect does NOT restack the usable fields around it", () => {
    const m = mountOverlay([
      textField("f-good", { x: 150, y: 200, width: 100, height: 20 }),
      textField("f-bad", { x: 0, y: 0, width: 0, height: 0 }),
    ]);
    const good = m.container.querySelector<HTMLElement>('[data-form-field="f-good"]');
    expect(good?.style.left).toBe("150px");
    expect(good?.style.top).toBe("200px");
    // The degenerate field still gets ONE visible, hit-testable control.
    const bad = m.container.querySelector<HTMLElement>('[data-form-field="f-bad"]');
    expect(bad).not.toBeNull();
    if (bad === null) return m.unmount();
    expect(bad.style.left).toBe("36px");
    expect(Number.parseFloat(bad.style.width)).toBeGreaterThan(0);
    m.unmount();
  });

  it("(c) multiple degenerate rects are staggered so none overlap or vanish", () => {
    const m = mountOverlay([
      textField("f-bad-1", { x: 0, y: 0, width: 0, height: 0 }),
      textField("f-bad-2", { x: 0, y: 0, width: 0, height: 0 }),
    ]);
    const one = m.container.querySelector<HTMLElement>('[data-form-field="f-bad-1"]');
    const two = m.container.querySelector<HTMLElement>('[data-form-field="f-bad-2"]');
    expect(one).not.toBeNull();
    expect(two).not.toBeNull();
    if (one === null || two === null) return m.unmount();
    expect(one.style.top).not.toBe(two.style.top);
    expect(Number.parseFloat(one.style.width)).toBeGreaterThan(0);
    expect(Number.parseFloat(two.style.width)).toBeGreaterThan(0);
    m.unmount();
  });
});

describe("Phase 65 — fill dispatch payload is unchanged", () => {
  it("(d) checkbox / text / radio still surface the same (id, value) payload", () => {
    const m = mountOverlay([
      checkboxField("f-cb", { x: 10, y: 10, width: 14, height: 14 }),
      textField("f-name", { x: 10, y: 40, width: 100, height: 20 }),
      widgetRadio(),
    ]);
    const box = m.container.querySelector<HTMLButtonElement>('button[data-form-field="f-cb"]');
    expect(box).not.toBeNull();
    if (box !== null) {
      act((): void => {
        box.click();
      });
      expect(m.onChange).toHaveBeenCalledWith("f-cb", "true");
    }
    const input = m.container.querySelector<HTMLInputElement>('input[data-form-field="f-name"]');
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
    const ms = m.container.querySelector<HTMLButtonElement>('button[data-form-widget-value="ms"]');
    expect(ms).not.toBeNull();
    if (ms !== null) {
      act((): void => {
        ms.click();
      });
      expect(m.onChange).toHaveBeenCalledWith("f-radio", "ms");
    }
    m.unmount();
  });
});

describe("Phase 65 chunk 2 — overlay only where pdf.js does NOT paint the widget", () => {
  // With ENABLE_FORMS pdf.js sets `hasOwnCanvas` ONLY on read-only TEXT
  // widgets, push-buttons and signature widgets, so only those are painted on
  // the canvas (a FormsOverlay control over them would be a second surface,
  // DEF-436) and must be suppressed. A read-only checkbox / radio / dropdown /
  // listbox is NOT canvas-painted and must render its one disabled overlay
  // control (DEF-444).

  function nonFillable(kind: string, overrides: Partial<FormField> = {}): FormField {
    return {
      id: `f-${kind}`,
      name: kind,
      page: 1,
      kind: kind as FormField["kind"],
      rect: { x: 10, y: 20, width: 160, height: 24 },
      value: "",
      ...overrides,
    };
  }

  it("suppresses the overlay for a real read-only text field (canvas paints it)", () => {
    const m = mountOverlay([
      {
        ...textField("form-1-locked", { x: 10, y: 20, width: 120, height: 20 }, "Fixed"),
        readOnly: true,
      },
    ]);
    expect(
      m.container.querySelectorAll('[data-form-field="form-1-locked"]').length,
    ).toBe(0);
    m.unmount();
  });

  it("renders the disabled checkbox surface for a read-only checkbox (not canvas-painted)", () => {
    const m = mountOverlay([
      {
        ...checkboxField("form-1-terms", { x: 10, y: 10, width: 14, height: 14 }, "true"),
        readOnly: true,
      },
    ]);
    const controls = m.container.querySelectorAll<HTMLButtonElement>(
      '[data-form-field="form-1-terms"]',
    );
    expect(controls.length).toBe(1);
    expect(controls[0]?.classList.contains("form-checkbox")).toBe(true);
    expect(controls[0]?.getAttribute("data-form-readonly")).toBe("true");
    expect(controls[0]?.disabled).toBe(true);
    m.unmount();
  });

  it("suppresses a signature field entirely (canvas paints it)", () => {
    const m = mountOverlay([nonFillable("signature")]);
    expect(m.container.querySelectorAll('[data-form-field="f-signature"]').length).toBe(0);
    expect(m.container.querySelector('[data-form-nonfillable="true"]')).toBeNull();
    m.unmount();
  });

  it("suppresses a push button entirely (canvas paints it)", () => {
    const m = mountOverlay([
      {
        ...textField("form-1-go", { x: 10, y: 20, width: 90, height: 24 }, ""),
        pushButton: true,
      },
    ]);
    expect(m.container.querySelectorAll('[data-form-field="form-1-go"]').length).toBe(0);
    expect(m.container.querySelector('[data-form-nonfillable="true"]')).toBeNull();
    m.unmount();
  });

  it("renders one disabled control per widget of a read-only radio group", () => {
    const group = { ...widgetRadio(), readOnly: true, value: "mr" };
    const m = mountOverlay([group]);
    const controls = m.container.querySelectorAll<HTMLButtonElement>("button[data-form-widget]");
    expect(controls.length).toBe(3);
    for (const control of Array.from(controls)) {
      expect(control.disabled).toBe(true);
      expect(control.getAttribute("data-form-readonly")).toBe("true");
    }
    m.unmount();
  });

  it("renders the disabled dropdown surface for a read-only dropdown", () => {
    const m = mountOverlay([
      {
        ...nonFillable("dropdown", {
          id: "form-1-state",
          value: "ca",
          options: [
            { value: "ca", label: "California" },
            { value: "ny", label: "New York" },
          ],
        }),
        readOnly: true,
      },
    ]);
    const controls = m.container.querySelectorAll<HTMLSelectElement>(
      '[data-form-field="form-1-state"]',
    );
    expect(controls.length).toBe(1);
    expect(controls[0]?.tagName).toBe("SELECT");
    expect(controls[0]?.classList.contains("form-select")).toBe(true);
    expect(controls[0]?.getAttribute("data-form-readonly")).toBe("true");
    expect(controls[0]?.disabled).toBe(true);
    m.unmount();
  });

  it("renders the disabled listbox surface for a read-only listbox", () => {
    const m = mountOverlay([
      {
        ...nonFillable("listbox", {
          id: "form-1-colors",
          value: ["red"],
          options: [
            { value: "red", label: "Red" },
            { value: "green", label: "Green" },
          ],
        }),
        readOnly: true,
      },
    ]);
    const boxes = m.container.querySelectorAll<HTMLElement>('[data-form-field="form-1-colors"]');
    expect(boxes.length).toBe(1);
    expect(boxes[0]?.classList.contains("form-listbox")).toBe(true);
    expect(boxes[0]?.getAttribute("data-form-readonly")).toBe("true");
    const rows = boxes[0]?.querySelectorAll<HTMLButtonElement>("button[data-form-option]") ?? [];
    expect(rows.length).toBe(2);
    for (const row of Array.from(rows)) {
      expect(row.disabled).toBe(true);
    }
    m.unmount();
  });

  it("an orphan widget (id orphan-…) keeps exactly ONE non-fillable surface", () => {
    // Engine convention: a real orphan id starts with `orphan-` and its
    // readOnly is forced true. It is excluded from suppression so it never
    // becomes invisible.
    const m = mountOverlay([
      nonFillable("orphan", { id: "orphan-2-ctx", readOnly: true }),
    ]);
    const surfaces = m.container.querySelectorAll('[data-form-field="orphan-2-ctx"]');
    expect(surfaces.length).toBe(1);
    expect(surfaces[0]?.getAttribute("data-form-nonfillable")).toBe("true");
    m.unmount();
  });

  it("a fillable, non-read-only field still renders exactly ONE control", () => {
    const m = mountOverlay([textField("form-1-name", { x: 10, y: 20, width: 120, height: 20 })]);
    expect(m.container.querySelectorAll('[data-form-field="form-1-name"]').length).toBe(1);
    m.unmount();
  });
});

describe("Phase 65 criterion 4 — centralized page-rotation mapping (DEF-438)", () => {
  const W = 600;
  const H = 800;
  const rect = { x: 10, y: 20, width: 30, height: 40 };

  it("rot 0 leaves the rect unchanged", () => {
    expect(mapRectForRotation(rect, 0, W, H)).toEqual(rect);
  });

  it("rot 1 (90 CW): x'=H-(y+h), y'=x, w'=h, h'=w", () => {
    expect(mapRectForRotation(rect, 1, W, H)).toEqual({
      x: H - (rect.y + rect.height),
      y: rect.x,
      width: rect.height,
      height: rect.width,
    });
  });

  it("rot 2 (180): x'=W-(x+w), y'=H-(y+h), w'=w, h'=h", () => {
    expect(mapRectForRotation(rect, 2, W, H)).toEqual({
      x: W - (rect.x + rect.width),
      y: H - (rect.y + rect.height),
      width: rect.width,
      height: rect.height,
    });
  });

  it("rot 3 (270 CW): x'=y, y'=W-(x+w), w'=h, h'=w", () => {
    expect(mapRectForRotation(rect, 3, W, H)).toEqual({
      x: rect.y,
      y: W - (rect.x + rect.width),
      width: rect.height,
      height: rect.width,
    });
  });

  it("normalizes out-of-range and negative quarter turns", () => {
    expect(mapRectForRotation(rect, 4, W, H)).toEqual(rect);
    expect(mapRectForRotation(rect, -1, W, H)).toEqual(mapRectForRotation(rect, 3, W, H));
    expect(mapRectForRotation(rect, 5, W, H)).toEqual(mapRectForRotation(rect, 1, W, H));
  });

  it("reproduces the DEF-438 proven example [751.5, 180.5, 19.0, 121.0]", () => {
    const widget = { x: 180.5, y: 71.4, width: 121, height: 19 };
    const mapped = mapRectForRotation(widget, 1, 595.3, 841.9);
    expect(mapped.x).toBeCloseTo(751.5, 4);
    expect(mapped.y).toBeCloseTo(180.5, 4);
    expect(mapped.width).toBeCloseTo(19.0, 4);
    expect(mapped.height).toBeCloseTo(121.0, 4);
  });

  it("FormsOverlay places a text editor on the mapped rect at rot 1", () => {
    const widget = { x: 180.5, y: 71.4, width: 121, height: 19 };
    const m = mountOverlay([textField("f-rot", widget)], {
      rotation: 1,
      pageWidthPt: 595.3,
      pageHeightPt: 841.9,
    });
    const input = m.container.querySelector<HTMLElement>('[data-form-field="f-rot"]');
    expect(input).not.toBeNull();
    if (input === null) return m.unmount();
    expect(Number.parseFloat(input.style.left)).toBeCloseTo(751.5, 3);
    expect(Number.parseFloat(input.style.top)).toBeCloseTo(180.5, 3);
    expect(Number.parseFloat(input.style.width)).toBeCloseTo(19, 3);
    expect(Number.parseFloat(input.style.minHeight)).toBeCloseTo(121, 3);
    m.unmount();
  });

  it("FormsOverlay maps EVERY widget of a multi-widget group", () => {
    const m = mountOverlay([widgetRadio()], {
      rotation: 1,
      pageWidthPt: 595.3,
      pageHeightPt: 841.9,
    });
    const controls = m.container.querySelectorAll<HTMLButtonElement>(
      'button[data-form-kind="radio"][data-form-widget]',
    );
    expect(controls.length).toBe(3);
    // widget mr rect (100,20,14,14) -> x'=841.9-34=807.9, y'=100, w'=14, h'=14
    expect(Number.parseFloat(controls[0]?.style.left ?? "")).toBeCloseTo(807.9, 3);
    expect(Number.parseFloat(controls[0]?.style.top ?? "")).toBeCloseTo(100, 3);
    // widget ms rect (100,44,14,14) -> x'=841.9-58=783.9, y'=100
    expect(Number.parseFloat(controls[1]?.style.left ?? "")).toBeCloseTo(783.9, 3);
    expect(Number.parseFloat(controls[1]?.style.top ?? "")).toBeCloseTo(100, 3);
    // widget dr rect (100,68,14,14) -> x'=841.9-82=759.9, y'=100
    expect(Number.parseFloat(controls[2]?.style.left ?? "")).toBeCloseTo(759.9, 3);
    expect(Number.parseFloat(controls[2]?.style.top ?? "")).toBeCloseTo(100, 3);
    m.unmount();
  });
});

describe("Phase 65 — PageView requests form-only canvas rendering", () => {
  it("(e) the page render call passes AnnotationMode.ENABLE_FORMS (single-layer guard)", () => {
    // Static guard for the mechanism: pdf.js defaults to AnnotationMode.ENABLE,
    // which paints the widget /AP appearance onto the canvas underneath the
    // FormsOverlay editor (the DEF-436 duplicate). ENABLE_FORMS drops standard
    // HTML-renderable widget appearances from the canvas list while leaving
    // non-widget annotation appearances intact.
    const src = readFileSync(
      resolve(__dirname, "../../../src/renderer/components/PageView.tsx"),
      "utf8",
    );
    expect(src).toContain("annotationMode: AnnotationMode.ENABLE_FORMS");
    expect(src).toMatch(/import\s*\{[^}]*\bAnnotationMode\b[^}]*\}\s*from\s*['"]pdfjs-dist['"]/);
  });
});
