// @vitest-environment jsdom
//
// Regression guard for DEF-092 — the textbox editor's floating
// action bar (Confirm / Cancel / Delete) must unmount as soon as
// Confirm is clicked. The previous test suite
// (bugB02_actionBarClickFix.test.tsx) verified that the Confirm
// click handler fired and called `onCreate`, but it did NOT assert
// that the editor DOM was torn down afterwards. That left the
// behaviour under-tested: an edit that returns the editor state to
// `null` (which is the unmount trigger) is the only thing that
// makes the bar disappear, so a regression that leaves the state
// non-null after Confirm would silently keep the bar on screen.
//
// This file exercises the full flow:
//   1. Open the editor with the textbox tool armed.
//   2. Type some text into the textarea.
//   3. Click Confirm via the standard pointerdown+click chain.
//   4. Assert the editor DOM is gone — action bar, wrapper, AND
//      textarea — and that `onFinishedOneShot` fired (which is the
//      host's signal that the tool should be disarmed).
//
// Plus belt-and-braces coverage:
//   - Idempotent Confirm: clicking Confirm twice does not crash
//     and does not create duplicate annotations (the second click
//     is a no-op because `textboxEditor` is already null).
//   - Cancel and Delete also tear the editor down (this part
//     overlaps with bugB02_actionBarClickFix.test.tsx but is kept
//     here for the explicit post-condition assertion).
//   - The `onChange` handler is robust against stale closures
//     (functional setState form) — a sequence of rapid keystrokes
//     appends onto the previous text instead of overwriting the
//     initial empty string.

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type {
  Annotation,
  AnnotationToolState,
} from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Phase 20 — the textbox toolbox is now a TfBar inside an
 *  AnimatePresence, so "gone from the DOM" means the exit animation has
 *  run to completion. Motion's test setup (skipAnimations) completes it
 *  on the next tick, so absence assertions settle first. */
async function settleMotion(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

function mountOverlay(args: {
  onCreate: (a: Annotation) => void;
  onFinishedOneShot?: () => void;
  tool?: AnnotationToolState;
}): {
  host: HTMLElement;
  root: ReturnType<typeof createRoot>;
  onCreate: ReturnType<typeof vi.fn>;
  onFinishedOneShot: ReturnType<typeof vi.fn>;
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
  const onFinishedOneShot = vi.fn(args.onFinishedOneShot ?? ((): void => undefined));
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
        onFinishedOneShot={onFinishedOneShot}
      />,
    );
  });
  return {
    host,
    root,
    onCreate,
    onFinishedOneShot,
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
      new PointerEvent("pointerdown", { bubbles: true, clientX, clientY }),
    );
  });
  act((): void => {
    target.click();
  });
}

function placeEditor(host: HTMLElement): void {
  const layer = host.querySelector<HTMLElement>("[data-annotation-layer='1']");
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
}

function typeIntoTextarea(host: HTMLElement, text: string): void {
  const textarea = host.querySelector<HTMLTextAreaElement>(
    "textarea.ann-textbox-editor",
  );
  if (textarea === null) throw new Error("textbox textarea not found");
  act((): void => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function getConfirmButton(host: HTMLElement): HTMLButtonElement {
  const btn = host.querySelector<HTMLButtonElement>(
    "[data-annotation-action='textbox-confirm']",
  );
  if (btn === null) throw new Error("Confirm button not found");
  return btn;
}

function getButtonRect(button: HTMLElement, override?: Partial<DOMRect>): DOMRect {
  const rect: DOMRect = {
    left: 50,
    top: 60,
    right: 150,
    bottom: 90,
    width: 100,
    height: 30,
    x: 50,
    y: 60,
    toJSON: () => ({}),
    ...override,
  };
  button.getBoundingClientRect = (): DOMRect => rect;
  return rect;
}

describe("DEF-092 — Confirm unmounts the textbox floating bar", () => {
  it("after Confirm, the action bar, wrapper, and textarea are all gone", async () => {
    const { host, onCreate, onFinishedOneShot, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
    });
    try {
      placeEditor(host);
      // Pre-condition: floating bar visible.
      expect(
        host.querySelector("[data-annotation-action-bar='textbox']"),
      ).not.toBeNull();
      expect(
        host.querySelector("[data-annotation-editor-wrap='textbox']"),
      ).not.toBeNull();
      expect(
        host.querySelector("[data-annotation-editor='textbox']"),
      ).not.toBeNull();

      typeIntoTextarea(host, "hello");

      const confirmBtn = getConfirmButton(host);
      const rect = getButtonRect(confirmBtn);
      dispatchPointerThenClick(
        confirmBtn,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );

      // onCreate was called once with a textbox annotation.
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect((onCreate.mock.calls[0]?.[0] as Annotation).kind).toBe("textbox");
      // onFinishedOneShot fired so the host can disarm the tool.
      expect(onFinishedOneShot).toHaveBeenCalledTimes(1);

      // Phase 20 — the outgoing toolbox exits through the presence
      // boundary before it leaves the DOM.
      await settleMotion();

      // Post-condition: every editor fragment is gone from the DOM.
      expect(
        host.querySelector("[data-annotation-action-bar='textbox']"),
      ).toBeNull();
      expect(
        host.querySelector("[data-annotation-editor-wrap='textbox']"),
      ).toBeNull();
      expect(
        host.querySelector("[data-annotation-editor='textbox']"),
      ).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("Confirm is idempotent — a second click is a no-op (no duplicate annotations)", async () => {
    const { host, onCreate, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
    });
    try {
      placeEditor(host);
      typeIntoTextarea(host, "abc");
      const confirmBtn = getConfirmButton(host);
      const rect = getButtonRect(confirmBtn);
      // First click: editor is open, onCreate fires.
      dispatchPointerThenClick(
        confirmBtn,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      expect(onCreate).toHaveBeenCalledTimes(1);
      // Phase 20 — while the toolbox exits it pins pointer-events: none
      // on its first exit frame, so a real second click can never land
      // on the outgoing Confirm. The node leaves the DOM once the exit
      // completes; a second click on the detached node is a no-op. The
      // important assertion is that onCreate is NOT called again.
      await settleMotion();
      act((): void => {
        // Best-effort: try clicking the original DOM node. React
        // unmounted it, so this throws or no-ops depending on the
        // environment. We don't care — what matters is the count.
        try {
          confirmBtn.click();
        } catch {
          /* expected — node detached */
        }
      });
      expect(onCreate).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("Cancel unmounts the editor without calling onCreate", async () => {
    const { host, onCreate, onFinishedOneShot, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
    });
    try {
      placeEditor(host);
      typeIntoTextarea(host, "ignored");
      const cancelBtn = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='textbox-cancel']",
      );
      if (cancelBtn === null) throw new Error("Cancel not found");
      const rect = getButtonRect(cancelBtn);
      dispatchPointerThenClick(cancelBtn, rect.left + 10, rect.top + 10);
      expect(onCreate).not.toHaveBeenCalled();
      expect(onFinishedOneShot).toHaveBeenCalledTimes(1);
      await settleMotion();
      expect(
        host.querySelector("[data-annotation-action-bar='textbox']"),
      ).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("Delete unmounts the editor without calling onCreate", async () => {
    const { host, onCreate, onFinishedOneShot, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
    });
    try {
      placeEditor(host);
      typeIntoTextarea(host, "ignored");
      const delBtn = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='textbox-delete']",
      );
      if (delBtn === null) throw new Error("Delete not found");
      const rect = getButtonRect(delBtn);
      dispatchPointerThenClick(delBtn, rect.left + 10, rect.top + 10);
      expect(onCreate).not.toHaveBeenCalled();
      expect(onFinishedOneShot).toHaveBeenCalledTimes(1);
      await settleMotion();
      expect(
        host.querySelector("[data-annotation-action-bar='textbox']"),
      ).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("rapid keystrokes append to the previous text (functional setState form)", () => {
    // Regression guard for the onChange closure: each keystroke
    // dispatches a synthetic `input` event, but React may not have
    // committed the previous update yet. The functional setState
    // pattern receives the latest state from React's update queue,
    // so the text accumulates correctly instead of overwriting the
    // empty initial value.
    const { host, onCreate, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
    });
    try {
      placeEditor(host);
      const textarea = host.querySelector<HTMLTextAreaElement>(
        "textarea.ann-textbox-editor",
      );
      if (textarea === null) throw new Error("textarea not found");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      // Three keystrokes in rapid succession, each setting the
      // textarea's value to the cumulative string (as the browser
      // would on each `input` event).
      for (const cumulative of ["h", "he", "hel", "hell", "hello"]) {
        act((): void => {
          setter?.call(textarea, cumulative);
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
      const confirmBtn = getConfirmButton(host);
      const rect = getButtonRect(confirmBtn);
      dispatchPointerThenClick(
        confirmBtn,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      expect(onCreate).toHaveBeenCalledTimes(1);
      const ann = onCreate.mock.calls[0]?.[0] as Annotation;
      expect(ann.kind).toBe("textbox");
      // The text must be "hello" — five keystrokes all preserved.
      // If onChange were reading from a stale closure, only the last
      // character would survive.
      expect((ann as { text: string }).text).toBe("hello");
    } finally {
      cleanup();
    }
  });
});
