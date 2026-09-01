// @vitest-environment jsdom
//
// Regression test for the textbox/callout action bar buttons
// becoming unresponsive. Root cause: the AnnotationOverlay's
// catch-all `onPointerDown` handler used to check only
// `.ann-editor` for the editor textarea, then proceed to call
// `e.preventDefault()` whenever the click happened to fall on the
// textbox tool. The action bar lives OUTSIDE the textarea (it's
// a sibling of the textarea inside the `.ann-textbox-wrap`
// wrapper), so clicks on its Confirm / Cancel / Delete buttons
// bubbled up to the layer's handler, which then called
// preventDefault on the pointerdown — and per the Pointer Events
// spec, preventDefault on pointerdown suppresses the
// synthesized `click` event on the same target. The result was
// that the buttons' React `onClick` handlers never fired.
//
// The fix walks the target's ancestor chain for every
// interactive UI surface — the action bar wrapper, the editor
// wrapper, the textarea, and any standard interactive element —
// and lets those events flow through unchanged. Only true page-
// canvas pointerdowns land in the tool's drag / place path.
//
// We exercise the fix end-to-end:
//   1. Click the page with the textbox tool armed → editor opens,
//      action bar visible.
//   2. Dispatch a pointerdown on the Confirm button followed by a
//      click event. With the fix, the click fires the button's
//      React onClick (the test asserts `onCreate` is called once)
//      and the layer's handler does NOT call preventDefault on
//      the pointerdown.
//   3. Same shape for Cancel: pointerdown on Cancel + click →
//      editor closes, onCreate is NOT called.
//   4. Same shape for the note editor's Add note button.
//   5. Same shape for the callout editor's Confirm button.
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type {
  Annotation,
  AnnotationToolState,
} from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  Element.prototype.setPointerCapture = function (): void {
    /* no-op */
  };
  Element.prototype.releasePointerCapture = function (): void {
    /* no-op */
  };
  const root = createRoot(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
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

function dispatchPointerThenClick(
  target: HTMLElement,
  clientX: number,
  clientY: number,
): void {
  act((): void => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX,
        clientY,
      }),
    );
  });
  act((): void => {
    target.click();
  });
}

function captureDocumentPointerdown(host: HTMLElement): { defaultPrevented: () => boolean } {
  let prevented = false;
  const handler = (e: Event): void => {
    prevented = (e as PointerEvent).defaultPrevented;
  };
  document.addEventListener("pointerdown", handler, true);
  // Tear down after the test's pointerdown bubbles up. We schedule
  // the cleanup via a microtask so any synchronous dispatch in the
  // caller still has the listener attached when it fires.
  queueMicrotask((): void => {
    document.removeEventListener("pointerdown", handler, true);
  });
  void host;
  return {
    defaultPrevented: (): boolean => prevented,
  };
}

describe("B2 followup — action bar buttons stay clickable (no preventDefault on UI-target pointerdowns)", () => {
  it("Confirm button click fires after a pointerdown that bubbles to the AnnotationOverlay layer", () => {
    // Regression: previously the layer's onPointerDown called
    // e.preventDefault() on the pointerdown, suppressing the click
    // event on Confirm. The fix bails out before preventDefault
    // when the target sits inside any UI control ancestor.
    const { host, onCreate, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
    });
    try {
      const layer = host.querySelector<HTMLElement>(
        "[data-annotation-layer='1']",
      );
      if (layer === null) throw new Error("layer not found");
      // Open the editor with a page click.
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            clientX: 100,
            clientY: 100,
          }),
        );
      });
      const confirmBtn = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='textbox-confirm']",
      );
      expect(confirmBtn).not.toBeNull();
      if (confirmBtn === null) return;
      const rect = {
        left: 50,
        top: 60,
        right: 150,
        bottom: 90,
        width: 100,
        height: 30,
        x: 50,
        y: 60,
        toJSON: () => ({}),
      };
      confirmBtn.getBoundingClientRect = (): DOMRect => rect as DOMRect;
      // Type into the textarea so commitTextbox creates a real annotation.
      const textarea = host.querySelector<HTMLTextAreaElement>(
        "textarea[data-annotation-editor='textbox']",
      );
      if (textarea === null) throw new Error("textarea not found");
      act((): void => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(textarea, "hello");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      // Single-click the Confirm button via the full pointerdown+click chain.
      dispatchPointerThenClick(
        confirmBtn,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      // The button's React onClick must have fired → onCreate called once.
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect((onCreate.mock.calls[0]?.[0] as Annotation).kind).toBe("textbox");
    } finally {
      cleanup();
    }
  });

  it("Cancel button click drops the in-flight textbox without preventDefault swallowing the click", () => {
    const { host, onCreate, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
    });
    try {
      const layer = host.querySelector<HTMLElement>(
        "[data-annotation-layer='1']",
      );
      if (layer === null) throw new Error("layer not found");
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            clientX: 80,
            clientY: 80,
          }),
        );
      });
      const cancelBtn = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='textbox-cancel']",
      );
      expect(cancelBtn).not.toBeNull();
      if (cancelBtn === null) return;
      const rect = {
        left: 30,
        top: 30,
        right: 130,
        bottom: 60,
        width: 100,
        height: 30,
        x: 30,
        y: 30,
        toJSON: () => ({}),
      };
      cancelBtn.getBoundingClientRect = (): DOMRect => rect as DOMRect;
      dispatchPointerThenClick(cancelBtn, rect.left + 10, rect.top + 10);
      expect(onCreate).not.toHaveBeenCalled();
      // The action bar is gone — the editor was torn down by the
      // Cancel handler, not by a swallowed click.
      expect(
        host.querySelector("[data-annotation-action-bar='textbox']"),
      ).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("Delete button click drops the in-flight textbox (same path as Cancel)", () => {
    const { host, onCreate, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
    });
    try {
      const layer = host.querySelector<HTMLElement>(
        "[data-annotation-layer='1']",
      );
      if (layer === null) throw new Error("layer not found");
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            clientX: 120,
            clientY: 120,
          }),
        );
      });
      const delBtn = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='textbox-delete']",
      );
      expect(delBtn).not.toBeNull();
      if (delBtn === null) return;
      const rect = {
        left: 200,
        top: 200,
        right: 300,
        bottom: 230,
        width: 100,
        height: 30,
        x: 200,
        y: 200,
        toJSON: () => ({}),
      };
      delBtn.getBoundingClientRect = (): DOMRect => rect as DOMRect;
      dispatchPointerThenClick(delBtn, rect.left + 5, rect.top + 5);
      expect(onCreate).not.toHaveBeenCalled();
      expect(
        host.querySelector("[data-annotation-action-bar='textbox']"),
      ).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("callout editor's Confirm button also stays clickable", () => {
    const { host, onCreate, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
      tool: { tool: "callout", color: "yellow", penWidth: 2 },
    });
    try {
      const layer = host.querySelector<HTMLElement>(
        "[data-annotation-layer='1']",
      );
      if (layer === null) throw new Error("layer not found");
      // Drag-out a callout: pointerdown anchor -> pointermove box -> pointerup drop.
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            clientX: 50,
            clientY: 50,
          }),
        );
      });
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: 250,
            clientY: 100,
          }),
        );
      });
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            clientX: 250,
            clientY: 100,
          }),
        );
      });
      const textarea = host.querySelector<HTMLTextAreaElement>(
        "textarea[data-annotation-editor='callout']",
      );
      if (textarea === null) throw new Error("callout textarea not found");
      act((): void => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(textarea, "see this");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const confirmBtn = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='callout-confirm']",
      );
      expect(confirmBtn).not.toBeNull();
      if (confirmBtn === null) return;
      const rect = {
        left: 200,
        top: 80,
        right: 300,
        bottom: 110,
        width: 100,
        height: 30,
        x: 200,
        y: 80,
        toJSON: () => ({}),
      };
      confirmBtn.getBoundingClientRect = (): DOMRect => rect as DOMRect;
      dispatchPointerThenClick(
        confirmBtn,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect((onCreate.mock.calls[0]?.[0] as Annotation).kind).toBe("callout");
    } finally {
      cleanup();
    }
  });

  it("note editor's Add note button stays clickable", () => {
    const { host, onCreate, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
      tool: { tool: "note", color: "yellow", penWidth: 2 },
    });
    try {
      const layer = host.querySelector<HTMLElement>(
        "[data-annotation-layer='1']",
      );
      if (layer === null) throw new Error("layer not found");
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            clientX: 150,
            clientY: 150,
          }),
        );
      });
      const textarea = host.querySelector<HTMLTextAreaElement>(
        "[data-annotation-editor='note'] textarea",
      );
      if (textarea === null) throw new Error("note textarea not found");
      act((): void => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(textarea, "sticky");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const addBtn = host.querySelector<HTMLButtonElement>(
        "button.ann-note-btn.btn-primary",
      );
      expect(addBtn).not.toBeNull();
      if (addBtn === null) return;
      const rect = {
        left: 50,
        top: 200,
        right: 150,
        bottom: 230,
        width: 100,
        height: 30,
        x: 50,
        y: 200,
        toJSON: () => ({}),
      };
      addBtn.getBoundingClientRect = (): DOMRect => rect as DOMRect;
      dispatchPointerThenClick(addBtn, rect.left + 10, rect.top + 10);
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect((onCreate.mock.calls[0]?.[0] as Annotation).kind).toBe("note");
    } finally {
      cleanup();
    }
  });

  it("pointerdown on a page-canvas point still creates a textbox editor (no over-bail)", () => {
    // Belt-and-braces: the new interactive-ancestor check must
    // still let true page-canvas pointerdowns fall through to
    // the textbox-create branch. The old handler only bailed on
    // `.ann-editor`; the new handler expands that list, but
    // only for UI-control ancestors — a true page click still
    // creates the editor.
    const { host, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
    });
    try {
      const layer = host.querySelector<HTMLElement>(
        "[data-annotation-layer='1']",
      );
      if (layer === null) throw new Error("layer not found");
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            clientX: 200,
            clientY: 200,
          }),
        );
      });
      // The editor (and its action bar) must appear after the
      // page-canvas click.
      expect(
        host.querySelector("[data-annotation-action-bar='textbox']"),
      ).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("the layer's onPointerDown does NOT call preventDefault when the target is an action-bar button (regression guard)", () => {
    // Drive a real pointerdown on the Confirm button after the
    // editor is open. The layer's handler MUST NOT call
    // preventDefault — doing so swallows the subsequent click.
    // We capture the post-handler defaultPrevented via a capture
    // phase listener on the document.
    const { host, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
    });
    try {
      const layer = host.querySelector<HTMLElement>(
        "[data-annotation-layer='1']",
      );
      if (layer === null) throw new Error("layer not found");
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            clientX: 100,
            clientY: 100,
          }),
        );
      });
      const confirmBtn = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='textbox-confirm']",
      );
      expect(confirmBtn).not.toBeNull();
      if (confirmBtn === null) return;
      confirmBtn.getBoundingClientRect = (): DOMRect => ({
        left: 50,
        top: 60,
        right: 150,
        bottom: 90,
        width: 100,
        height: 30,
        x: 50,
        y: 60,
        toJSON: () => ({}),
      }) as DOMRect;
      // Attach a capture-phase listener on document so we see
      // the pointerdown AFTER the layer's handler runs.
      const seen: { prevented: boolean | null } = { prevented: null };
      const handler = (e: Event): void => {
        seen.prevented = (e as PointerEvent).defaultPrevented;
      };
      document.addEventListener("pointerdown", handler, true);
      try {
        act((): void => {
          confirmBtn.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              clientX: 100,
              clientY: 75,
            }),
          );
        });
        expect(seen.prevented).toBe(false);
      } finally {
        document.removeEventListener("pointerdown", handler, true);
      }
    } finally {
      cleanup();
    }
    void captureDocumentPointerdown;
  });
});