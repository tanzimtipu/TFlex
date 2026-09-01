// @vitest-environment jsdom
//
// B10 / DEF-101 — stamp placement must produce a visible
// `.stamp-annotation` surface at the placed rect. The engine's
// `addStamp` bakes the pixels into the page bitmap (no DOM node),
// so the renderer mirrors each successful placement as a positioned
// `.stamp-annotation` div carrying the placed raster. This is what
// makes a placement verifiable in the DOM (and is the surface
// QA's e2e `.stamp-annotation` locator resolves to).
//
// Coverage (behavior):
//   1. No placements -> renders nothing (null).
//   2. One placement -> one `.stamp-annotation` node positioned at
//      rect * cssScale with pointer-events: none and a page / id
//      data attribute.
//   3. Multiple placements on different pages -> one node each,
//      each with its own rect.
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  StampAnnotations,
  type PlacedStamp,
} from "../../../src/renderer/annotations/StampAnnotations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function makePlaced(overrides: Partial<PlacedStamp>): PlacedStamp {
  return {
    id: "p-1",
    stampId: "APPROVED",
    page: 1,
    rect: { x: 50, y: 60, width: 200, height: 80 },
    pngBytes: PNG_1x1,
    pngWidth: 200,
    pngHeight: 80,
    ...overrides,
  };
}

function mount(items: PlacedStamp[]): {
  host: HTMLElement;
  root: ReturnType<typeof createRoot>;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(<StampAnnotations cssScale={2} items={items} />);
  });
  return {
    host,
    root,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("B10 / DEF-101 — placed stamps render as .stamp-annotation surfaces at the placed rect", () => {
  it("renders nothing when no stamp has been placed", () => {
    const { host, cleanup } = mount([]);
    try {
      expect(host.querySelector(".stamp-annotation")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("renders one .stamp-annotation per placement at rect * cssScale", () => {
    const { host, cleanup } = mount([makePlaced({})]);
    try {
      const node = host.querySelector<HTMLElement>(".stamp-annotation");
      if (node === null) throw new Error("stamp annotation not rendered");
      // Geometry: rect (page points) scaled by cssScale (2).
      expect(node.style.left).toBe("100px");
      expect(node.style.top).toBe("120px");
      expect(node.style.width).toBe("400px");
      expect(node.style.height).toBe("160px");
      // Pointer-transparent (baked content, not interactive).
      expect(node.style.pointerEvents).toBe("none");
      // Identity + page data so tests / panel links can resolve it.
      expect(node.getAttribute("data-stamp-annotation")).toBe("p-1");
      expect(node.getAttribute("data-stamp-id")).toBe("APPROVED");
      expect(node.getAttribute("data-page")).toBe("1");
    } finally {
      cleanup();
    }
  });

  it("keeps placements on different pages distinct with their own rects", () => {
    const { host, cleanup } = mount([
      makePlaced({ id: "p-1", page: 1, rect: { x: 0, y: 0, width: 100, height: 50 } }),
      makePlaced({ id: "p-2", page: 2, rect: { x: 10, y: 20, width: 60, height: 30 } }),
    ]);
    try {
      const nodes = host.querySelectorAll<HTMLElement>(".stamp-annotation");
      expect(nodes.length).toBe(2);
      const a = nodes[0];
      const b = nodes[1];
      if (a === undefined || b === undefined) throw new Error("missing nodes");
      expect(a.getAttribute("data-page")).toBe("1");
      expect(a.style.left).toBe("0px");
      expect(a.style.top).toBe("0px");
      expect(b.getAttribute("data-page")).toBe("2");
      expect(b.style.left).toBe("20px");
      expect(b.style.top).toBe("40px");
    } finally {
      cleanup();
    }
  });
});