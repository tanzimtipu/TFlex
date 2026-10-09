// @vitest-environment jsdom
//
// DEF-674 (recurrence of TFL-1405) — the edit-text RUN move Confirm must keep the
// white eraser over the OLD rect at the FULL `runCoverRect` height (raw height *
// (1 + RUN_COVER_DESCENT)), NOT the raw pdf.js cover rect. Pre-fix the
// `pendingRunEdit` branch returned `{ ...pendingRunEdit.coverRect }`, shrinking
// the commit-window cover by 20% and exposing descenders at the old position.
//
// This mirrors the TFL-1431 run-move harness (real overlay, commit held pending)
// and asserts the rendered eraser geometry directly.
import { describe, expect, it, vi, type Mock } from "vitest";
import { act, useRef, useState, type ReactElement } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditOverlay, RUN_COVER_DESCENT, type EditTextTarget } from "../../../src/renderer/edit/EditOverlay";
import type { TextItemGeom } from "../../../src/renderer/annotations/AnnotationOverlay";
import { initialEditState, type EditTextStyle } from "../../../src/renderer/edit/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.IntersectionObserver === "undefined") {
  class NoopIntersectionObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
}
Element.prototype.setPointerCapture = function (this: Element): void {
  void this;
};
Element.prototype.releasePointerCapture = function (this: Element): void {
  void this;
};

const NOOP = (): void => undefined;
type Rect = { x: number; y: number; width: number; height: number };
type CommitTextEditFn = (args: {
  rect: Rect;
  newText: string;
  style: EditTextStyle;
  oldRect?: Rect;
  page: number;
}) => void | Promise<void>;

const RUN_GEOM: TextItemGeom = { x: 100, y: 100, width: 200, height: 20, text: "Source run" };

interface RunHostApi {
  host: HTMLElement;
  onCommitTextEdit: Mock<CommitTextEditFn>;
  unmount: () => void;
}

function mountRunHost(): RunHostApi {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  const root = createRoot(host);
  const api: RunHostApi = {
    host,
    onCommitTextEdit: vi.fn<CommitTextEditFn>(),
    unmount: NOOP,
  };
  function RunHost(): ReactElement {
    const [live, setLive] = useState<string | null>(null);
    const [token, setToken] = useState(0);
    const prevTargetRef = useRef<EditTextTarget | null>(null);
    const liveRef = useRef<string | null>(null);
    liveRef.current = live;
    const onTextTargetChange = (target: EditTextTarget | null): void => {
      const prev = prevTargetRef.current;
      prevTargetRef.current = target;
      if (target === null && prev !== null && prev.kind === "run" && liveRef.current !== null) {
        liveRef.current = null;
        setLive(null);
        setToken((n) => n + 1);
      }
    };
    return createElement(EditOverlay, {
      page: 1,
      pageWidthPt: 612,
      pageHeightPt: 792,
      cssScale: 1,
      tool: "text",
      getTextItems: (): TextItemGeom[] => [RUN_GEOM],
      edit: { ...initialEditState, tool: "text" },
      dispatch: (): void => undefined,
      pickImage: async (): Promise<null> => null,
      defaultFont: "Helvetica",
      onCommitTextEdit: api.onCommitTextEdit,
      onCommitTextBox: (): void => undefined,
      onCommitImageEdit: (): void => undefined,
      onCommitTextBoxMove: (): void => undefined,
      onTextTargetChange,
      textLive: live,
      textCommitToken: token,
      onDiscardTextEdit: NOOP,
    });
  }
  act((): void => {
    root.render(createElement(RunHost));
  });
  api.unmount = (): void => {
    act((): void => {
      root.unmount();
    });
    host.remove();
  };
  return api;
}

function pointer(el: Element, type: string, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

function click(el: Element): void {
  act((): void => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function layerOf(host: HTMLElement): HTMLElement {
  const layer = host.querySelector<HTMLElement>(".edit-layer");
  if (layer === null) throw new Error("edit layer not found");
  return layer;
}

describe("DEF-674 — run-move Confirm eraser keeps the full runCoverRect height", () => {
  it("the commit-window eraser over the OLD rect is 1.25x the raw run height (not the raw rect)", () => {
    const h = mountRunHost();
    try {
      // Hold the commit pending so the in-flight eraser frame is inspectable.
      h.onCommitTextEdit.mockImplementation(
        () =>
          new Promise<void>(() => {
            /* never resolves within this test */
          }),
      );

      const layer = layerOf(h.host);
      pointer(layer, "pointerdown", 150, 110);
      pointer(layer, "pointermove", 190, 140);
      pointer(layer, "pointerup", 190, 140);

      const confirm = h.host.querySelector<HTMLElement>('[data-content-action="textrun-confirm"]');
      if (confirm === null) throw new Error("run Confirm button not found");
      expect(confirm.getAttribute("title")).toBe("Confirm the move");

      click(confirm);

      const eraser = h.host.querySelector<HTMLElement>("[data-edit-box-eraser]");
      expect(eraser, "the OLD rect is white-masked during the commit").not.toBeNull();
      if (eraser === null) return;

      const rawHeight = RUN_GEOM.height;
      const expected = rawHeight * (1 + RUN_COVER_DESCENT);
      console.log(
        `[DEF-674 unit] eraser top=${eraser.style.top} left=${eraser.style.left} height=${eraser.style.height} expected=${expected}`,
      );

      // Geometry: still over the OLD rect.
      expect(eraser.style.top).toBe(`${RUN_GEOM.y}px`);
      expect(eraser.style.left).toBe(`${RUN_GEOM.x}px`);
      expect(eraser.style.width).toBe(`${RUN_GEOM.width}px`);

      // Regression: the height is the runCoverRect output, NOT the raw rect.
      expect(eraser.style.height).toBe(`${expected}px`);
      expect(eraser.style.height).not.toBe(`${rawHeight}px`);
      expect(Number.parseFloat(eraser.style.height)).toBeGreaterThan(rawHeight);
    } finally {
      h.unmount();
    }
  });
});
