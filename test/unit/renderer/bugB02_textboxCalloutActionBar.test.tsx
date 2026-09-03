// @vitest-environment jsdom
// B2 — textbox / callout floating action bar (Confirm / Cancel /
// Delete). The textbox and callout inline editors previously
// committed on blur; an accidental page click would bake an
// empty or partial textbox into the engine. The fix is a
// floating action bar (mirrors the sig-pending pattern) that
// gives the user an explicit Confirm / Cancel / Delete
// affordance before any commit lands. The keyboard shortcuts
// (Enter = newline, Ctrl+Enter = commit, Esc = cancel) are
// retained for power users.
//
// We exercise the overlay's textbox flow end-to-end:
//   1. Click the page with the textbox tool armed -> the inline
//      editor opens, and the .ann-textbox-actions action bar
//      is rendered with the three buttons.
//   2. Typing into the textarea updates the editor's state
//      (we verify by reading the textarea's value).
//   3. Clicking Confirm -> the textbox annotation is created.
//   4. Opening a textbox, typing, then clicking Cancel -> no
//      annotation is created; the editor closes.
//   5. Opening a textbox, typing, then clicking Delete -> same
//      outcome as Cancel; the editor closes without committing.
//   6. Repeat (1)-(3) for the callout flow (drag to anchor, drop
//      to set the box, type, click Confirm).
//   7. onBlur no longer fires the commit (regression guard for
//      the "focus leaving the textarea to the Confirm button
//      would commit" symptom that motivated removing onBlur).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type {
  Annotation,
  AnnotationToolState,
} from "../../../src/renderer/annotations/model";

function mountOverlay(args: {
  onCreate: (a: Annotation) => void;
  onFinishedOneShot?: () => void;
  tool?: AnnotationToolState;
}): {
  host: HTMLElement;
  onCreate: ReturnType<typeof vi.fn>;
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
  // jsdom returns zero-sized rects; override so the pagePoint
  // math works.
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
        onFinishedOneShot={args.onFinishedOneShot}
      />,
    );
  });
  return { host, onCreate };
}

describe("B2 — textbox / callout floating action bar", () => {
  it("opens the editor with Confirm / Cancel / Delete buttons (textbox)", () => {
    const { host } = mountOverlay({
      onCreate: (): void => undefined,
    });
    const layer = host.querySelector("[data-annotation-layer='1']") as HTMLElement | null;
    expect(layer).not.toBeNull();
    if (layer === null) return;
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    // The action bar must be present with all three buttons.
    const bar = host.querySelector("[data-annotation-action-bar='textbox']");
    expect(bar).not.toBeNull();
    const confirm = host.querySelector("[data-annotation-action='textbox-confirm']");
    const cancel = host.querySelector("[data-annotation-action='textbox-cancel']");
    const del = host.querySelector("[data-annotation-action='textbox-delete']");
    expect(confirm).not.toBeNull();
    expect(cancel).not.toBeNull();
    expect(del).not.toBeNull();
  });

  it("Confirm commits the textbox; Cancel / Delete drop it without committing", () => {
    const { host, onCreate } = mountOverlay({
      onCreate: (): void => undefined,
    });
    const layer = host.querySelector("[data-annotation-layer='1']") as HTMLElement | null;
    if (layer === null) return;
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    const textarea = host.querySelector("textarea.ann-textbox-editor") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    if (textarea === null) return;
    // Type some text into the editor.
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "hello world");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Click Confirm.
    const confirmBtn = host.querySelector<HTMLButtonElement>(
      "[data-annotation-action='textbox-confirm']",
    );
    expect(confirmBtn).not.toBeNull();
    if (confirmBtn === null) return;
    act((): void => {
      confirmBtn.click();
    });
    expect(onCreate).toHaveBeenCalledTimes(1);
    const ann = onCreate.mock.calls[0]?.[0];
    expect(ann?.kind).toBe("textbox");
    expect((ann as { text: string } | undefined)?.text).toBe("hello world");
    // The editor + action bar are gone after commit.
    expect(host.querySelector("[data-annotation-action-bar='textbox']")).toBeNull();
  });

  it("Cancel drops the in-flight textbox without calling onCreate", () => {
    const { host, onCreate } = mountOverlay({
      onCreate: (): void => undefined,
    });
    const layer = host.querySelector("[data-annotation-layer='1']") as HTMLElement | null;
    if (layer === null) return;
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 50,
          clientY: 50,
        }),
      );
    });
    const cancelBtn = host.querySelector<HTMLButtonElement>(
      "[data-annotation-action='textbox-cancel']",
    );
    expect(cancelBtn).not.toBeNull();
    if (cancelBtn === null) return;
    act((): void => {
      cancelBtn.click();
    });
    expect(onCreate).not.toHaveBeenCalled();
    expect(host.querySelector("[data-annotation-action-bar='textbox']")).toBeNull();
  });

  it("Delete drops the in-flight textbox without calling onCreate", () => {
    const { host, onCreate } = mountOverlay({
      onCreate: (): void => undefined,
    });
    const layer = host.querySelector("[data-annotation-layer='1']") as HTMLElement | null;
    if (layer === null) return;
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 80,
          clientY: 80,
        }),
      );
    });
    const delBtn = host.querySelector<HTMLButtonElement>(
      "[data-annotation-action='textbox-delete']",
    );
    expect(delBtn).not.toBeNull();
    if (delBtn === null) return;
    act((): void => {
      delBtn.click();
    });
    expect(onCreate).not.toHaveBeenCalled();
    expect(host.querySelector("[data-annotation-action-bar='textbox']")).toBeNull();
  });

  it("onBlur no longer fires commit (focus leaving the textarea does not commit)", () => {
    // Without this, clicking Confirm or anywhere else outside the
    // editor would commit via onBlur BEFORE the click event landed,
    // firing a partial commit (e.g. the user types nothing, clicks
    // Delete — onBlur fires onCreate with empty text first). The
    // fix removes onBlur entirely; commit is now exclusively
    // through Confirm / Ctrl+Enter.
    const { host, onCreate } = mountOverlay({
      onCreate: (): void => undefined,
    });
    const layer = host.querySelector("[data-annotation-layer='1']") as HTMLElement | null;
    if (layer === null) return;
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    const textarea = host.querySelector("textarea.ann-textbox-editor") as HTMLTextAreaElement | null;
    if (textarea === null) return;
    // Blur fires when focus moves to the Confirm button. The
    // overlay used to commit on blur; it now must NOT.
    act((): void => {
      textarea.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("callout flow: drag to anchor + drop to box, then Confirm commits", () => {
    const { host, onCreate } = mountOverlay({
      onCreate: (): void => undefined,
      tool: { tool: "callout", color: "yellow", penWidth: 2 },
    });
    const layer = host.querySelector("[data-annotation-layer='1']") as HTMLElement | null;
    if (layer === null) return;
    // pointerdown at the anchor point.
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 50,
          clientY: 50,
        }),
      );
    });
    // pointermove extends the box to a wide enough size.
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 220,
          clientY: 90,
        }),
      );
    });
    // pointerup commits the box and opens the inline editor.
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 220,
          clientY: 90,
        }),
      );
    });
    const textarea = host.querySelector("textarea.ann-textbox-editor") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    if (textarea === null) return;
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
    act((): void => {
      confirmBtn.click();
    });
    expect(onCreate).toHaveBeenCalledTimes(1);
    const ann = onCreate.mock.calls[0]?.[0];
    expect(ann?.kind).toBe("callout");
    expect((ann as { text: string } | undefined)?.text).toBe("see this");
  });

  it("Ctrl+Enter keyboard shortcut still commits the textbox", () => {
    const { host, onCreate } = mountOverlay({
      onCreate: (): void => undefined,
    });
    const layer = host.querySelector("[data-annotation-layer='1']") as HTMLElement | null;
    if (layer === null) return;
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    const textarea = host.querySelector("textarea.ann-textbox-editor") as HTMLTextAreaElement | null;
    if (textarea === null) return;
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "via keyboard");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
          ctrlKey: true,
        }),
      );
    });
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("Esc keyboard shortcut cancels the textbox without committing", () => {
    const { host, onCreate } = mountOverlay({
      onCreate: (): void => undefined,
    });
    const layer = host.querySelector("[data-annotation-layer='1']") as HTMLElement | null;
    if (layer === null) return;
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    const textarea = host.querySelector("textarea.ann-textbox-editor") as HTMLTextAreaElement | null;
    if (textarea === null) return;
    act((): void => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Escape",
        }),
      );
    });
    expect(onCreate).not.toHaveBeenCalled();
    expect(host.querySelector("[data-annotation-action-bar='textbox']")).toBeNull();
  });
});
