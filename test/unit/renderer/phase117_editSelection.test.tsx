// @vitest-environment jsdom
// Phase 117 (chunk D) — edit-content selection chrome migrated onto the ONE
// shared `SelectionChrome`, the separated More/Delete on the edit toolbars,
// and the Inspector's numeric geometry + keyboard nudge.
//
// Verifies:
//   - a selected IMAGE renders `[data-selection-boundary]` with 4
//     `[data-selection-handle]`, each also carrying `data-handle`;
//   - a selected text BOX renders the same with `data-edit-box-handle`;
//   - the text-box toolbar's primary row is Confirm + Cancel and the Delete
//     control (`data-edit-box-action="delete"`) lives behind the More control;
//   - no rotate handle is rendered (the engine has no object-rotation op);
//   - the Inspector geometry row is disabled with a truthful reason when the
//     host publishes no rect, and routes a typed value / arrow-key nudge to
//     the host's `onChange` when it does.
//
// Setup mirrors the sibling renderer specs (react-dom/client + `act`; the repo
// ships no @testing-library/react).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
import {
  editReducer,
  initialEditState,
  type EditState,
  type EditTool,
  type ImagePlacement,
  type TextBoxPlacement,
} from "../../../src/renderer/edit/model";
import {
  Inspector,
  applyGeometryNudge,
  type InspectorEditGeometry,
  type InspectorProps,
} from "../../../src/renderer/components/Inspector";

const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

// jsdom does not implement URL.createObjectURL; the image placement mirror
// calls it to render its <img>. Stub it for this spec and restore after.
const realCreateObjectURL = (URL as unknown as { createObjectURL?: (b: Blob) => string })
  .createObjectURL;
(URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () =>
  "blob:phase117-edit-selection";
afterAll((): void => {
  (URL as unknown as { createObjectURL?: (b: Blob) => string }).createObjectURL =
    realCreateObjectURL;
});

const stubCapture = function (this: Element): void {
  void this;
};
const stubRelease = function (this: Element): void {
  void this;
};

function makeTextBox(overrides: Partial<TextBoxPlacement> = {}): TextBoxPlacement {
  return {
    id: "tb-1",
    page: 1,
    rect: { x: 100, y: 100, width: 180, height: 40 },
    text: "Committed box",
    style: { font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } },
    background: "white",
    ...overrides,
  };
}

function makePlacement(overrides: Partial<ImagePlacement> = {}): ImagePlacement {
  return {
    id: "img-1",
    page: 1,
    rect: { x: 50, y: 60, width: 120, height: 80 },
    bytes: PNG_1x1,
    format: "png",
    ...overrides,
  };
}

function mountEdit(
  tool: EditTool,
  initial: Partial<EditState>,
): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  Element.prototype.setPointerCapture = stubCapture;
  Element.prototype.releasePointerCapture = stubRelease;
  const root = createRoot(host);
  let lastState: EditState = { ...initialEditState, tool, ...initial };
  const render = (): void => {
    act((): void => {
      root.render(
        createElement(EditOverlay, {
          page: 1,
          pageWidthPt: 612,
          pageHeightPt: 792,
          cssScale: 1,
          tool: lastState.tool,
          getTextItems: (): never[] => [],
          edit: lastState,
          dispatch: (action): void => {
            lastState = editReducer(lastState, action);
            render();
          },
          pickImage: async (): Promise<null> => null,
          defaultFont: "Helvetica",
          onCommitTextEdit: (): void => undefined,
          onCommitTextBox: (): void => undefined,
          onCommitImageEdit: (): void => undefined,
          onCommitTextBoxMove: (): void => undefined,
        }),
      );
    });
  };
  render();
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

function handles(host: HTMLElement): Element[] {
  return Array.from(host.querySelectorAll("[data-selection-handle]"));
}

function cornerMarks(els: Element[], attr: string): string[] {
  return els.map((h) => h.getAttribute(attr) ?? "").sort();
}

function mountInspector(props: InspectorProps): { host: HTMLElement; unmount: () => void } {
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

describe("Phase 117 (chunk D) — image + text-box selection chrome", () => {
  it("a selected image renders the shared boundary + 4 handles marked data-handle", () => {
    const { host, unmount } = mountEdit("image", {
      selectedImage: { id: "img-1" },
      placements: [makePlacement()],
    });
    try {
      const boundary = host.querySelector("[data-selection-boundary]");
      expect(boundary, "shared boundary renders").not.toBeNull();
      expect(boundary?.getAttribute("data-selection-kind")).toBe("image");
      const hs = handles(host);
      expect(hs, "an image gets 4 corner handles").toHaveLength(4);
      for (const h of hs) {
        expect(h.getAttribute("data-handle"), "legacy handle selector survives").not.toBeNull();
        expect(h.classList.contains("selection-handle")).toBe(true);
      }
      expect(cornerMarks(hs, "data-handle")).toEqual(["ne", "nw", "se", "sw"]);
      // The placement element and its <img> are kept.
      expect(host.querySelector("[data-placement-id='img-1']")).not.toBeNull();
      expect(host.querySelector(".edit-image-placement-img")).not.toBeNull();
      // No rotate affordance anywhere (no engine object-rotation op).
      expect(host.querySelectorAll("[data-selection-handle]")).toHaveLength(4);
      expect(host.querySelector("[data-rotate-handle]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("a selected text box renders the shared boundary + 4 handles marked data-edit-box-handle", () => {
    const { host, unmount } = mountEdit("box", {
      selectedTextBox: "tb-1",
      textBoxes: [makeTextBox()],
    });
    try {
      const boundary = host.querySelector("[data-selection-boundary]");
      expect(boundary, "shared boundary renders").not.toBeNull();
      expect(boundary?.getAttribute("data-selection-kind")).toBe("textBox");
      const hs = handles(host);
      expect(hs, "a text box gets 4 corner handles").toHaveLength(4);
      for (const h of hs) {
        expect(h.getAttribute("data-edit-box-handle"), "legacy handle selector survives").not.toBeNull();
      }
      expect(cornerMarks(hs, "data-edit-box-handle")).toEqual(["ne", "nw", "se", "sw"]);
      // Selectors preserved on the box surface + its toolbar.
      expect(host.querySelector("[data-edit-box-id='tb-1']")).not.toBeNull();
      expect(host.querySelector("[data-rotate-handle]")).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("Phase 117 (chunk D) — text-box toolbar Delete inline", () => {
  it("primary row is Confirm + Cancel + Delete, all inline", () => {
    const { host, unmount } = mountEdit("box", {
      selectedTextBox: "tb-1",
      textBoxes: [makeTextBox()],
    });
    try {
      const bar = host.querySelector("[data-edit-box-toolbar]");
      expect(bar).not.toBeNull();
      if (bar === null) return;
      const inPrimary = (b: Element): boolean =>
        b.closest(".content-action-more-menu") === null;
      const primaryVerbs = [...bar.querySelectorAll("button")]
        .filter(inPrimary)
        .map((b) => b.textContent?.trim());
      expect(primaryVerbs, "Confirm is primary").toContain("Confirm");
      expect(primaryVerbs, "Cancel is primary").toContain("Cancel");
      expect(primaryVerbs, "Delete is primary").toContain("Delete");
      // Delete is a direct sibling of Confirm / Cancel, not behind More.
      const del = host.querySelector("[data-edit-box-action='delete']");
      expect(del, "Delete renders inline").not.toBeNull();
      expect(del?.closest(".content-action-more-menu"), "Delete is not in a More surface").toBeNull();
      expect(host.querySelector("[data-content-action='editbox-more']"), "the More control is gone").toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("Phase 117 (chunk D) — Inspector numeric geometry + keyboard nudge", () => {
  it("applyGeometryNudge shifts a position or a size field, clamped to 1 pt", () => {
    const rect = { x: 100, y: 200, width: 180, height: 40 };
    expect(applyGeometryNudge(rect, "x", 5)).toEqual({ x: 105, y: 200, width: 180, height: 40 });
    expect(applyGeometryNudge(rect, "y", -10)).toEqual({ x: 100, y: 190, width: 180, height: 40 });
    expect(applyGeometryNudge(rect, "width", 20)).toEqual({ x: 100, y: 200, width: 200, height: 40 });
    expect(applyGeometryNudge(rect, "height", -50)).toEqual({ x: 100, y: 200, width: 180, height: 1 });
  });

  it("renders the row DISABLED with the truthful reason when no live rect is published", () => {
    const { host, unmount } = mountInspector({
      stage: "edit",
      selection: { kind: "text", name: "Text object" },
      editGeometry: { kind: "textBox" },
    });
    try {
      const row = host.querySelector("[data-edit-geometry]");
      expect(row, "geometry row renders for the known kind").not.toBeNull();
      expect(host.querySelector("[data-edit-geometry-disabled]")).not.toBeNull();
      expect(host.querySelectorAll("[data-edit-geometry-field]")).toHaveLength(0);
      const reason = host.querySelector("[data-edit-geometry-reason]")?.textContent ?? "";
      expect(reason.toLowerCase()).toContain("no live selection rectangle");
    } finally {
      unmount();
    }
  });

  it("renders X / Y / width / height and routes a nudge to the overlay handler", () => {
    const onChange = vi.fn();
    const geometry: InspectorEditGeometry = {
      kind: "textBox",
      rect: { x: 100, y: 200, width: 180, height: 40 },
      onChange,
    };
    const { host, unmount } = mountInspector({
      stage: "edit",
      selection: { kind: "text", name: "Text object" },
      editGeometry: geometry,
    });
    try {
      const fields = [...host.querySelectorAll<HTMLInputElement>("[data-edit-geometry-field]")];
      expect(fields.map((f) => f.getAttribute("data-edit-geometry-field")).sort()).toEqual([
        "height", "width", "x", "y",
      ]);
      const xField = host.querySelector<HTMLInputElement>("[data-edit-geometry-field='x']");
      expect(xField).not.toBeNull();
      if (xField === null) return;
      expect(Number(xField.value)).toBe(100);
      // ArrowRight nudges x by +1 pt through the SAME overlay handler.
      act((): void => {
        xField.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
        );
      });
      expect(onChange).toHaveBeenCalledWith({ x: 101, y: 200, width: 180, height: 40 });
      // Shift+ArrowUp nudges y by +10 pt.
      const yField = host.querySelector<HTMLInputElement>("[data-edit-geometry-field='y']");
      expect(yField).not.toBeNull();
      if (yField === null) return;
      act((): void => {
        yField.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true, cancelable: true }),
        );
      });
      expect(onChange).toHaveBeenCalledWith({ x: 100, y: 210, width: 180, height: 40 });
      // A typed value commits the field through the same handler.
      const wField = host.querySelector<HTMLInputElement>("[data-edit-geometry-field='width']");
      expect(wField).not.toBeNull();
      if (wField === null) return;
      act((): void => {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        nativeSetter?.call(wField, "240");
        wField.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(onChange).toHaveBeenCalledWith({ x: 100, y: 200, width: 240, height: 40 });
    } finally {
      unmount();
    }
  });
});
