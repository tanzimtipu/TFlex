// @vitest-environment jsdom
//
// DEF-095 — the textbox floating action bar must be a real hit
// target OUTSIDE the textarea's interactive area, and Confirm must
// unmount the editor + bar and commit.
//
// Root cause traced: the shared `.ann-editor` rule declares
// `position: absolute; z-index: 3`, and the textbox/callout
// textareas carry that class. An absolutely positioned textarea is
// pulled out of the `.ann-textbox-wrap` flex column, its static
// position lands its box ON TOP of the in-flow action bar, and its
// z-index paints it over the buttons — so every click on Confirm /
// Cancel / Delete hit the textarea instead of the button, the bar
// never received a click, and it stayed mounted after Confirm.
//
// The fix pins the flow layout in two places:
//   1. The textarea stays in the flex column (`position: static`
//      inline + in CSS), so the bar sits BELOW it as a separate
//      flow box.
//   2. The bar is `position: relative; z-index: 5` (inline + CSS),
//      stacking it above the textarea inside the wrapper's stacking
//      context, so even an overlapping textarea can never cover the
//      buttons.
//
// Coverage (behavior, not markers):
//   1. DOM contract: the textarea precedes the bar in the wrapper
//      (bar is its own flow box below the textarea); the textarea
//      has no `position: absolute`; the bar has a positive z-index
//      above the shared `.ann-editor` value (3).
//   2. Behavior: a full pointerdown + click chain on Confirm calls
//      onCreate with the typed text AND unmounts the wrapper and the
//      bar (nothing remains after commit).
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type {
  Annotation,
  AnnotationToolState,
} from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Phase 20 — the textbox toolbox is a TfBar inside an AnimatePresence,
 *  so its removal from the DOM completes after the exit animation. */
async function settleMotion(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

function mountOverlay(args: {
  onCreate: (a: Annotation) => void;
  tool?: AnnotationToolState;
}): {
  host: HTMLElement;
  root: ReturnType<typeof createRoot>;
  onCreate: ReturnType<typeof vi.fn>;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  Element.prototype.setPointerCapture = function (): void { /* no-op */ };
  Element.prototype.releasePointerCapture = function (): void { /* no-op */ };
  const root = createRoot(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  const onCreate = vi.fn(args.onCreate);
  const tool: AnnotationToolState = args.tool ?? {
    tool: "textbox",
    color: "yellow",
    penWidth: 2,
  };
  act((): void => {
    root.render(
      <AnnotationOverlay
        page={1}
        widthPt={612}
        heightPt={792}
        cssScale={1}
        annotations={[]}
        tool={tool}
        flashId={null}
        getTextItems={(): never[] => []}
        onCreate={onCreate}
        onFinishedOneShot={undefined}
      />,
    );
  });
  return {
    host,
    root,
    onCreate,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function openTextboxEditor(host: HTMLElement): HTMLTextAreaElement {
  const layer = host.querySelector<HTMLElement>("[data-annotation-layer='1']");
  if (layer === null) throw new Error("layer not found");
  act((): void => {
    layer.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }),
    );
  });
  const textarea = host.querySelector<HTMLTextAreaElement>("textarea.ann-textbox-editor");
  if (textarea === null) throw new Error("textarea not found");
  return textarea;
}

describe("DEF-095 — textbox action bar is a real hit target outside the textarea, confirm unmounts", () => {
  it("the bar is a separate flow box BELOW the textarea, and the textarea is not absolutely positioned", () => {
    const { host, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
    });
    try {
      const textarea = openTextboxEditor(host);
      const bar = host.querySelector<HTMLElement>("[data-annotation-action-bar='textbox']");
      if (bar === null) throw new Error("action bar not found");
      // (1) The bar is not inside the textarea; the textarea is
      //     not inside the bar. The textarea precedes the bar in
      //     document order (flex column: textarea first, bar below).
      expect(bar.contains(textarea)).toBe(false);
      expect(textarea.contains(bar)).toBe(false);
      // From the bar's perspective the textarea PRECEDES it (the
      // bar is rendered after the textarea, below it in the column).
      const pos = bar.compareDocumentPosition(textarea);
      expect(pos & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
      // (2) The textarea must NOT be `position: absolute` (the root
      //     cause: `.ann-editor` sets absolute, which pulled the
      //     textarea over the bar). Inline `position: static` keeps
      //     it in the wrapper's flex column.
      expect(textarea.style.position).toBe("static");
      // (3) The bar must be stacked ABOVE the textarea (the shared
      //     `.ann-editor` z-index is 3; the bar's relative z 5 wins
      //     inside the wrapper's stacking context).
      expect(bar.style.position).toBe("relative");
      expect(Number(bar.style.zIndex)).toBeGreaterThan(3);
    } finally {
      cleanup();
    }
  });

  it("pointerdown + click chain on Confirm commits the textbox and unmounts the wrapper AND the bar", async () => {
    const { host, onCreate, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
    });
    try {
      const textarea = openTextboxEditor(host);
      act((): void => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(textarea, "hello world");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const confirmBtn = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='textbox-confirm']",
      );
      if (confirmBtn === null) throw new Error("Confirm not found");
      // Real chain: pointerdown (button is the target — the layer's
      // handler must NOT preventDefault it away) then click fires
      // the React onClick.
      act((): void => {
        confirmBtn.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }),
        );
      });
      act((): void => {
        confirmBtn.click();
      });
      expect(onCreate).toHaveBeenCalledTimes(1);
      const ann = onCreate.mock.calls[0]?.[0];
      expect(ann?.kind).toBe("textbox");
      expect((ann as { text: string } | undefined)?.text).toBe("hello world");
      // Phase 20 — let the outgoing toolbox finish its TfBar exit.
      await settleMotion();
      // Editor torn down: the bar AND the wrapper are fully gone.
      expect(host.querySelector("[data-annotation-action-bar='textbox']")).toBeNull();
      expect(host.querySelector("[data-annotation-editor='textbox']")).toBeNull();
      expect(host.querySelector("[data-annotation-editor-wrap='textbox']")).toBeNull();
    } finally {
      cleanup();
    }
  });
});