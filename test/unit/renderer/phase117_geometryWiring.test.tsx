// @vitest-environment jsdom
// Phase 117 (chunk D follow-up, TFL-1316) — the Inspector numeric geometry row
// WIRED to the real host move / resize handlers.
//
// Chunk D (TFL-1306) shipped the row + the pure `applyGeometryNudge` maths, but
// left host wiring out of its file set, so `DocumentView` / `App` never
// published a live rect and the row was inert. This spec pins the parts that
// belong to the wiring contract:
//   (a) `applyGeometryNudge` returns the exact nudged page-point rect for a
//       1 pt step and, at the Shift scale, a 10 pt step;
//   (b) mounting `Inspector` with a `textPanel` snapshot that CARRIES geometry
//       renders the ENABLED `[data-edit-geometry]` row with its
//       `[data-edit-geometry-field]` inputs, and a step / typed edit calls the
//       published `geometry.onChange` with the nudged rect (the exact shape the
//       host forwards to the overlay's move / resize handler);
//   (c) with no live rect published the row renders DISABLED with the truthful
//       `[data-edit-geometry-reason]` — never fabricated values.
//
// Setup mirrors the sibling renderer specs (react-dom/client + `act`; the repo
// ships no @testing-library/react).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  Inspector,
  applyGeometryNudge,
  type InspectorEditGeometry,
  type InspectorProps,
} from "../../../src/renderer/components/Inspector";
import { defaultTextStyleValues } from "../../../src/renderer/edit/textStyle";

/** The text-panel snapshot the host publishes for a selected text box,
 *  optionally carrying the live geometry this follow-up wires. */
function textPanelWith(geometry?: InspectorEditGeometry): InspectorProps["textPanel"] {
  const values = defaultTextStyleValues("Helvetica");
  return {
    open: true,
    values,
    defaults: values,
    onPatch: (): void => undefined,
    mode: "text",
    text: "Committed box",
    ...(geometry === undefined ? {} : { geometry }),
  };
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

function field(host: HTMLElement, name: string): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>(`[data-edit-geometry-field='${name}']`);
  if (el === null) throw new Error(`no geometry field ${name}`);
  return el;
}

function step(input: HTMLInputElement, key: string, shiftKey = false): void {
  act((): void => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
    );
  });
}

function type(input: HTMLInputElement, value: string): void {
  act((): void => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Phase 117 (chunk D follow-up) — Inspector geometry wiring", () => {
  it("applyGeometryNudge returns the exact page-point rect for a 1 pt / Shift 10 pt step", () => {
    const rect = { x: 100, y: 200, width: 180, height: 40 };
    // 1 pt keyboard step (the unmodified arrow scale).
    expect(applyGeometryNudge(rect, "x", 1)).toEqual({ x: 101, y: 200, width: 180, height: 40 });
    expect(applyGeometryNudge(rect, "y", 1)).toEqual({ x: 100, y: 201, width: 180, height: 40 });
    expect(applyGeometryNudge(rect, "width", 1)).toEqual({ x: 100, y: 200, width: 181, height: 40 });
    expect(applyGeometryNudge(rect, "height", 1)).toEqual({ x: 100, y: 200, width: 180, height: 41 });
    // 10 pt Shift scale.
    expect(applyGeometryNudge(rect, "x", 10)).toEqual({ x: 110, y: 200, width: 180, height: 40 });
    expect(applyGeometryNudge(rect, "y", 10)).toEqual({ x: 100, y: 210, width: 180, height: 40 });
    expect(applyGeometryNudge(rect, "width", 10)).toEqual({ x: 100, y: 200, width: 190, height: 40 });
    // Negative moves shift back, and a size nudge clamps at 1 pt.
    expect(applyGeometryNudge(rect, "x", -1)).toEqual({ x: 99, y: 200, width: 180, height: 40 });
    expect(applyGeometryNudge(rect, "height", -100)).toEqual({ x: 100, y: 200, width: 180, height: 1 });
  });
});

describe("Phase 117 (chunk D follow-up) — ENABLED row from the published textPanel geometry", () => {
  it("renders the fields and routes a step / typed value to geometry.onChange", () => {
    const onChange = vi.fn();
    const geometry: InspectorEditGeometry = {
      kind: "textBox",
      rect: { x: 100, y: 200, width: 180, height: 40 },
      onChange,
    };
    const { host, unmount } = mountInspector({
      stage: "edit",
      selection: { kind: "text", name: "Text object" },
      textPanel: textPanelWith(geometry),
    });
    try {
      const row = host.querySelector("[data-edit-geometry]");
      expect(row, "geometry row renders").not.toBeNull();
      expect(row?.getAttribute("data-edit-geometry-kind")).toBe("textBox");
      // A live rect means the row is ENABLED, never the disabled fallback.
      expect(host.querySelector("[data-edit-geometry-disabled]")).toBeNull();
      const names = [...host.querySelectorAll("[data-edit-geometry-field]")]
        .map((el) => el.getAttribute("data-edit-geometry-field"))
        .sort();
      expect(names).toEqual(["height", "width", "x", "y"]);
      expect(Number(field(host, "x").value)).toBe(100);

      // ArrowRight on X nudges +1 pt through the published handler.
      step(field(host, "x"), "ArrowRight");
      expect(onChange).toHaveBeenLastCalledWith({ x: 101, y: 200, width: 180, height: 40 });

      // Shift+ArrowRight on width nudges +10 pt (the Shift scale).
      step(field(host, "width"), "ArrowRight", true);
      expect(onChange).toHaveBeenLastCalledWith({ x: 100, y: 200, width: 190, height: 40 });

      // A typed value commits the field through the SAME handler.
      type(field(host, "height"), "64");
      expect(onChange).toHaveBeenLastCalledWith({ x: 100, y: 200, width: 180, height: 64 });
      expect(onChange).toHaveBeenCalledTimes(3);
    } finally {
      unmount();
    }
  });
});

describe("Phase 117 (chunk D follow-up) — truthful DISABLED fallback with no live rect", () => {
  it("renders the disabled row + reason when only a kind is published", () => {
    const { host, unmount } = mountInspector({
      stage: "edit",
      selection: { kind: "text", name: "Text object" },
      // The host knows the kind but has no live rect to publish: no `rect`,
      // no `onChange`, and no `editGeometry` prop.
      textPanel: textPanelWith({ kind: "textBox" }),
    });
    try {
      expect(host.querySelector("[data-edit-geometry]")).not.toBeNull();
      expect(host.querySelector("[data-edit-geometry-disabled]")).not.toBeNull();
      expect(host.querySelectorAll("[data-edit-geometry-field]")).toHaveLength(0);
      const reason = (host.querySelector("[data-edit-geometry-reason]")?.textContent ?? "").toLowerCase();
      expect(reason).toContain("no live selection rectangle");
    } finally {
      unmount();
    }
  });

  it("renders no row at all when neither a kind nor a rect is published", () => {
    const { host, unmount } = mountInspector({
      stage: "edit",
      selection: { kind: "text", name: "Text object" },
      textPanel: textPanelWith(),
    });
    try {
      expect(host.querySelector("[data-edit-geometry]")).toBeNull();
      expect(host.querySelector("[data-edit-geometry-disabled]")).toBeNull();
    } finally {
      unmount();
    }
  });
});
