// @vitest-environment jsdom
//
// TFL-1431 — the edit-text RUN move must settle at the NEW position
// immediately on Confirm, with no stale/blank frame and no perceptible delay.
//
// Regression: the run-move Confirm handler cleared `textTarget`, which was the
// ONLY gate on the on-page live preview (`runPreviewText` / `runLiveRect`); the
// moved run then sat blank at its NEW rect until the host's whole-document
// re-parse landed, while the OLD rect was white-masked. The fix keeps the moved
// run's `RunLivePreview` painted at the DESTINATION rect (and the eraser over
// the ORIGINAL rect) for the whole in-flight commit window, releasing both only
// once the host commit promise + paint barrier resolve.
//
// Renderer only; the EditOverlay run-session path runs unmocked.
import { describe, expect, it, vi, type Mock } from "vitest";
import { act, useRef, useState, type ReactElement } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditOverlay, type EditTextTarget } from "../../../src/renderer/edit/EditOverlay";
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
  latestTarget: EditTextTarget | null;
  unmount: () => void;
}

/** A minimal host that mirrors DocumentView's run-session protocol: it feeds
 *  the overlay `textLive` + `textCommitToken`. Same shape as the TFL-525
 *  `mountRunHost` harness, so the run-move gesture runs the real overlay. */
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
    latestTarget: null,
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
      api.latestTarget = target;
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

describe("TFL-1431 — a run-move Confirm keeps the run at the NEW rect in flight", () => {
  it("paints the moved run at the destination (and masks the origin) until the commit promise resolves", async () => {
    const h = mountRunHost();
    try {
      // A controllable commit: hold it pending so the in-flight frame can be
      // inspected before the host's re-parse would land.
      let resolveCommit: (() => void) | null = null;
      h.onCommitTextEdit.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveCommit = resolve;
          }),
      );

      const layer = layerOf(h.host);
      // Select the run, then a real drag (+40, +30) parks a pending move.
      pointer(layer, "pointerdown", 150, 110);
      pointer(layer, "pointermove", 190, 140);
      pointer(layer, "pointerup", 190, 140);

      const confirm = h.host.querySelector<HTMLElement>(
        '[data-content-action="textrun-confirm"]',
      );
      if (confirm === null) throw new Error("run Confirm button not found");
      expect(confirm.getAttribute("title"), "the bar now confirms a MOVE").toBe(
        "Confirm the move",
      );

      click(confirm);

      // The commit fired once with the NEW rect + the ORIGINAL rect.
      expect(h.onCommitTextEdit, "the move commit fired exactly once").toHaveBeenCalledTimes(1);
      const args = h.onCommitTextEdit.mock.calls[0]?.[0];
      expect(args?.rect, "the commit targets the NEW rect").toEqual({
        x: 140, y: 130, width: 200, height: 20,
      });
      expect(args?.oldRect, "the commit carries the OLD rect geometry").toMatchObject({
        x: 100, y: 100, width: 200, height: 20,
      });

      // WHILE the commit is pending: the moved run is painted at the NEW rect
      // (left 140 / top 130) and the OLD rect is white-masked. Nothing paints
      // the run at the old spot (the selection surface is gone).
      const preview = h.host.querySelector<HTMLElement>("[data-edit-run-preview]");
      expect(preview, "the moved run stays painted at the NEW rect").not.toBeNull();
      expect(preview?.style.left, "preview at the NEW x").toBe("140px");
      expect(preview?.style.top, "preview at the NEW y").toBe("130px");

      const eraser = h.host.querySelector<HTMLElement>("[data-edit-box-eraser]");
      expect(eraser, "the OLD rect is white-masked").not.toBeNull();
      expect(eraser?.style.left, "eraser over the OLD x").toBe("100px");
      expect(eraser?.style.top, "eraser over the OLD y").toBe("100px");

      expect(
        h.host.querySelector("[data-textrun-selection]"),
        "nothing paints the run at the old rect while pending",
      ).toBeNull();

      // Resolve the commit + flush the paint barrier: the preview and eraser
      // are released, and no second commit fires.
      await act(async (): Promise<void> => {
        resolveCommit?.();
        await new Promise<void>((r) => setTimeout(r, 260));
      });

      expect(
        h.host.querySelector("[data-edit-run-preview]"),
        "the in-flight preview is released after the commit lands",
      ).toBeNull();
      expect(
        h.host.querySelector("[data-edit-box-eraser]"),
        "the eraser is released after the commit lands",
      ).toBeNull();
      expect(h.onCommitTextEdit, "no double commit").toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });
});

