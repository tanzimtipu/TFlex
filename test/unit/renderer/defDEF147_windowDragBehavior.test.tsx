// @vitest-environment jsdom
// DEF-147 (partial-fix follow-up) - behavior tests for the floating windows qa found
// stuck (dx=0, dy=0) after a first wiring pass. The shared useDragWindow hook mechanics
// are pinned in defDEF147_dragWindow.test.tsx; these tests mount the REAL components and
// prove each window ACTUALLY moves MID-DRAG when its chrome is grabbed (the exact qa
// gesture: pointerdown on a real non-control chrome point, pointermove +160/+90 while
// the mouse is held, the window's inline position/transform ALREADY changed BEFORE
// release), and that presses on real controls inside each window never start a move
// while the control's click still fires.
//
// jsdom does no layout, so getBoundingClientRect() is all zeros and the hook's offset
// equals the raw pointer delta (+160/+90). That is exactly the delta qa asserts, so the
// expected values below are the qa numbers, not approximations.
//
// The two windows this test forces to work:
//   - SignatureActionBar: whole-bar chrome drag. The hook's handle is spread on the bar
//     element itself, so a press on the bar's padding / background (never a button)
//     must start the move; qa's chrome scan proved such points exist.
//   - TextBoxEditor: the editor WINDOW is the wrapper (textarea + action bar are
//     siblings under it), and the wrapper carries real draggable chrome: an explicit
//     grip strip above the textarea (data-annotation-editor-handle="textbox") and the
//     action bar's own chrome. The textarea stays a typing surface - a press on it must
//     never bubble into a window move, and the bar buttons keep their clicks.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { SignatureActionBar } from "../../../src/renderer/signatures/SignaturesOverlay";
import { TextBoxEditor } from "../../../src/renderer/annotations/AnnotationOverlay";
import { AnnotationToolbar } from "../../../src/renderer/annotations/AnnotationToolbar";
import { StampDialog } from "../../../src/renderer/components/StampDialog";

// DEF-175 — the color popover PORTALS to document.body, so a previous
// test's still-open popover would pollute body-level queries
// (`document.body.querySelector(".color-popover")` grabs the oldest
// open popover). Unmount every previous surface first so every mount
// starts with an empty body and the portaled query is unambiguous.
const liveRoots: ReturnType<typeof createRoot>[] = [];
function mount(node: ReactElement): HTMLElement {
  while (liveRoots.length > 0) {
    const prev = liveRoots.pop();
    if (prev === undefined) continue;
    act((): void => {
      prev.unmount();
    });
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  liveRoots.push(root);
  act((): void => {
    root.render(node);
  });
  return host;
}

/** Dispatch a pointer event on an element (bubbling, so it reaches
 *  the window-level listeners the drag hook installs). */
function pointer(el: Element | Window, type: string, opts: PointerEventInit = {}): void {
  act((): void => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, ...opts }));
  });
}

/** The qa drag: pointermove to (x, y) while the mouse is held. */
function pointerMove(x: number, y: number): void {
  act((): void => {
    window.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y }),
    );
  });
}

/** Phase C — motion popovers/dialogs settle their enter spring (and
 *  drag-follow) on the next frame under skipAnimations; settle before
 *  asserting the element's composed transform string. */
async function settleMotion(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

describe("DEF-147 - signature pending action bar is movable by its chrome", () => {
  function mountBar(): { host: HTMLElement; bar: HTMLElement | null } {
    const host = mount(
      createElement(SignatureActionBar, {
        base: { x: 40, y: 40, width: 100, height: 130 },
        confirmTitle: "Confirm",
        cancelTitle: "Cancel",
        deleteTitle: "Delete",
        onConfirm: (): void => {},
        onCancel: (): void => {},
        onDelete: (): void => {},
      }),
    );
    return { host, bar: host.querySelector<HTMLElement>("[data-sig-action-bar]") };
  }

  it("a chrome (bar background) press + held drag moves the bar mid-drag and it stays", () => {
    const { host, bar } = mountBar();
    expect(bar).not.toBeNull();
    if (bar === null) return;
    expect(bar.style.left).toBe("40px");
    expect(bar.style.top).toBe("4px");

    // qa's gesture: grab the bar's own padding/background - the element
    // itself is the chrome (its children are only the three buttons),
    // exactly the elementFromPoint scan qa used to find (690,537) /
    // (875,537) as bar background, not buttons.
    pointer(bar, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    expect(bar.classList.contains("sig-action-bar-dragging")).toBe(true);

    // Drag +160/+90 while the mouse is held - the bar must ALREADY
    // have moved before release (qa's mid-drag capture).
    pointerMove(260, 190);
    expect(bar.style.left).toBe("200px");
    expect(bar.style.top).toBe("94px");

    // After release it stays put (no snap-back to the anchor).
    pointer(bar, "pointerup", {});
    expect(bar.style.left).toBe("200px");
    expect(bar.style.top).toBe("94px");
    expect(host.querySelector("[data-sig-action-bar]")).not.toBeNull();
  });

  it("a press on the Confirm / Cancel / Delete buttons never starts a move and the click fires", () => {
    let confirmed = false;
    let cancelled = false;
    let deleted = false;
    const host = mount(
      createElement(SignatureActionBar, {
        base: { x: 40, y: 40, width: 100, height: 130 },
        confirmTitle: "Confirm",
        cancelTitle: "Cancel",
        deleteTitle: "Delete",
        onConfirm: (): void => {
          confirmed = true;
        },
        onCancel: (): void => {
          cancelled = true;
        },
        onDelete: (): void => {
          deleted = true;
        },
      }),
    );
    const bar = host.querySelector<HTMLElement>("[data-sig-action-bar]");
    const confirmBtn = host.querySelector<HTMLElement>(".sig-action-btn-confirm");
    const cancelBtn = host.querySelector<HTMLElement>(".sig-action-btn-cancel");
    const deleteBtn = host.querySelector<HTMLElement>(".sig-action-btn-delete");
    expect(bar).not.toBeNull();
    expect(confirmBtn).not.toBeNull();
    expect(cancelBtn).not.toBeNull();
    expect(deleteBtn).not.toBeNull();
    if (bar === null || confirmBtn === null || cancelBtn === null || deleteBtn === null) return;

    for (const btn of [confirmBtn, cancelBtn, deleteBtn]) {
      pointer(btn, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
      expect(bar.classList.contains("sig-action-bar-dragging")).toBe(false);
      pointerMove(260, 190);
      expect(bar.style.left).toBe("40px");
      expect(bar.style.top).toBe("4px");
    }
    // The buttons still receive their clicks (not swallowed by the drag hook).
    confirmBtn.click();
    cancelBtn.click();
    deleteBtn.click();
    expect(confirmed).toBe(true);
    expect(cancelled).toBe(true);
    expect(deleted).toBe(true);
  });
});

describe("DEF-147 - textbox editor is movable by its wrapper chrome", () => {
  function mountEditor(onCommit: () => void = (): void => {}): {
    host: HTMLElement;
    wrap: HTMLElement | null;
  } {
    const host = mount(
      createElement(TextBoxEditor, {
        at: { x: 40, y: 40 },
        text: "hello",
        cssScale: 1,
        onChange: (): void => {},
        onCommit,
        onCancel: (): void => {},
      }),
    );
    return {
      host,
      wrap: host.querySelector<HTMLElement>('[data-annotation-editor-wrap="textbox"]'),
    };
  }

  it("the editor selector identifies the WRAPPER (the window), not the textarea", () => {
    const { host, wrap } = mountEditor();
    expect(wrap).not.toBeNull();
    if (wrap === null) return;
    // qa's selector [data-annotation-editor="textbox"] must now select
    // the draggable window (the wrapper), never the typing surface.
    expect(host.querySelector<HTMLElement>('[data-annotation-editor="textbox"]')).toBe(wrap);
    expect(wrap.querySelector("textarea.ann-textbox-editor")).not.toBeNull();
  });

  it("a grip-strip (real chrome handle) press + held drag moves the whole editor mid-drag and it stays", () => {
    const { host, wrap } = mountEditor();
    const grip = host.querySelector<HTMLElement>('[data-annotation-editor-handle="textbox"]');
    expect(wrap).not.toBeNull();
    expect(grip).not.toBeNull();
    if (wrap === null || grip === null) return;
    expect(wrap.style.left).toBe("40px");
    expect(wrap.style.top).toBe("40px");

    // qa's gesture on the explicit chrome strip above the textarea.
    pointer(grip, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    expect(wrap.classList.contains("ann-textbox-wrap-dragging")).toBe(true);
    pointerMove(260, 190);
    // MID-DRAG the wrapper - and therefore its textarea + action bar -
    // already moved +160/+90 before release.
    expect(wrap.style.left).toBe("200px");
    expect(wrap.style.top).toBe("130px");
    pointer(grip, "pointerup", {});
    expect(wrap.style.left).toBe("200px");
    expect(wrap.style.top).toBe("130px");
    expect(host.querySelector('[data-annotation-editor-wrap="textbox"]')).not.toBeNull();
  });

  it("the action bar's chrome moves the whole editor through the wrapper handle", () => {
    const { host, wrap } = mountEditor();
    const bar = host.querySelector<HTMLElement>('[data-annotation-action-bar="textbox"]');
    expect(wrap).not.toBeNull();
    expect(bar).not.toBeNull();
    if (wrap === null || bar === null) return;
    // A press on the bar's own chrome (its padding/gap - not a button)
    // bubbles up to the wrapper's drag handler and moves the window.
    pointer(bar, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    pointerMove(260, 190);
    expect(wrap.style.left).toBe("200px");
    expect(wrap.style.top).toBe("130px");
    pointer(bar, "pointerup", {});
    expect(wrap.style.left).toBe("200px");
    expect(wrap.style.top).toBe("130px");
  });

  it("a press on the Confirm button never starts a move and the click fires", () => {
    let committed = false;
    const { host, wrap } = mountEditor((): void => {
      committed = true;
    });
    const confirmBtn = host.querySelector<HTMLElement>(".ann-textbox-action-confirm");
    expect(wrap).not.toBeNull();
    expect(confirmBtn).not.toBeNull();
    if (wrap === null || confirmBtn === null) return;
    pointer(confirmBtn, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    expect(wrap.classList.contains("ann-textbox-wrap-dragging")).toBe(false);
    pointerMove(260, 190);
    expect(wrap.style.left).toBe("40px");
    expect(wrap.style.top).toBe("40px");
    confirmBtn.click();
    expect(committed).toBe(true);
  });

  it("a press inside the textarea never starts a move (typing surface)", () => {
    const { host, wrap } = mountEditor();
    const textarea = host.querySelector<HTMLElement>("textarea.ann-textbox-editor");
    expect(wrap).not.toBeNull();
    expect(textarea).not.toBeNull();
    if (wrap === null || textarea === null) return;
    pointer(textarea, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    expect(wrap.classList.contains("ann-textbox-wrap-dragging")).toBe(false);
    pointerMove(260, 190);
    expect(wrap.style.left).toBe("40px");
    expect(wrap.style.top).toBe("40px");
  });
});

describe("DEF-147 - annotation color palette popover is movable by its chrome (regression)", () => {
  function mountOpenPopover(): { host: HTMLElement; popover: HTMLElement | null } {
    const host = mount(
      createElement(AnnotationToolbar, {
        state: { tool: "ink", color: "yellow", penWidth: 3 },
        onAction: (): void => {},
        theme: "dark",
        palette: { light: [], dark: [] },
      }),
    );
    const swatch = host.querySelector<HTMLElement>(".ann-color-swatch-main");
    if (swatch === null) return { host, popover: null };
    act((): void => {
      swatch.click();
    });
    // DEF-175 — the popover PORTALS to document.body (it must escape
    // the .ann-toolbar stacking context), so it is no longer a child
    // of the mounted host.
    return { host, popover: document.body.querySelector<HTMLElement>(".color-popover") };
  }

  it("a section-label (header) chrome drag moves the popover mid-drag", async () => {
    const { popover } = mountOpenPopover();
    expect(popover).not.toBeNull();
    if (popover === null) return;
    // Phase C — the popover enters through the popover-enter spring
    // (scale 0.97 + translateY -3px travel), then rests at identity.
    expect(popover.style.transform).toContain("0.97");
    await settleMotion();
    const atRest = /(?:translateX\(0px\) translateY\(0px\)|none)/.test(popover.style.transform);
    expect(atRest, "popover rests at the anchor after its enter spring").toBe(true);
    const label = popover.querySelector<HTMLElement>(".color-palette-label");
    expect(label).not.toBeNull();
    if (label === null) return;
    pointer(label, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    pointerMove(260, 190);
    await settleMotion();
    // The drag offset folds into motion x/y: the composed form carries
    // the full +160/+90 delta (DEF-147 mid-drag follow, unchanged).
    expect(popover.style.transform).toMatch(/translateX\(160px\) translateY\(90px\)/);
    pointer(label, "pointerup", {});
    await settleMotion();
    expect(popover.style.transform).toMatch(/translateX\(160px\) translateY\(90px\)/);
  });

  it("a press on a swatch button never starts a move", async () => {
    const { popover } = mountOpenPopover();
    expect(popover).not.toBeNull();
    if (popover === null) return;
    await settleMotion();
    const swatchBtn = popover.querySelector<HTMLElement>(".color-palette-grid .color-swatch");
    expect(swatchBtn).not.toBeNull();
    if (swatchBtn === null) return;
    pointer(swatchBtn, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    pointerMove(260, 190);
    await settleMotion();
    expect(popover.style.transform).not.toMatch(/160px|90px/);
  });
});

describe("DEF-147 - stamp dialog is movable by its chrome (regression)", () => {
  function mountOpen(): { host: HTMLElement; dialog: HTMLElement | null } {
    const host = mount(
      createElement(StampDialog, {
        open: true,
        totalPages: 2,
        currentPage: 1,
        initialStampId: "APPROVED",
        onStampIdChange: (): void => {},
        onConfirm: (): void => {},
        onClose: (): void => {},
      }),
    );
    return { host, dialog: host.querySelector<HTMLElement>(".modal-dialog") };
  }

  it("a body-chrome press + held drag moves the dialog mid-drag", async () => {
    const { host, dialog } = mountOpen();
    expect(dialog).not.toBeNull();
    if (dialog === null) return;
    // Phase C — the dialog enters through the dialog-enter spring
    // (translateY 10px + scale 0.97 travel), then rests at identity.
    expect(dialog.style.transform).toContain("0.97");
    await settleMotion();
    const atRest = /(?:translateX\(0px\) translateY\(0px\)|none)/.test(dialog.style.transform);
    expect(atRest, "dialog rests at identity after its enter spring").toBe(true);
    const help = host.querySelector<HTMLElement>(".modal-help");
    expect(help).not.toBeNull();
    if (help === null) return;
    pointer(help, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    expect(dialog.classList.contains("modal-dialog-dragging")).toBe(true);
    pointerMove(260, 190);
    await settleMotion();
    expect(dialog.style.transform).toMatch(/translateX\(160px\) translateY\(90px\)/);
    pointer(help, "pointerup", {});
    await settleMotion();
    expect(dialog.style.transform).toMatch(/translateX\(160px\) translateY\(90px\)/);
  });

  it("a press on the close button never starts a move and the click fires", async () => {
    let closed = false;
    const host = mount(
      createElement(StampDialog, {
        open: true,
        totalPages: 2,
        currentPage: 1,
        initialStampId: "APPROVED",
        onStampIdChange: (): void => {},
        onConfirm: (): void => {},
        onClose: (): void => {
          closed = true;
        },
      }),
    );
    const dialog = host.querySelector<HTMLElement>(".modal-dialog");
    const closeBtn = host.querySelector<HTMLElement>(".modal-close");
    expect(dialog).not.toBeNull();
    expect(closeBtn).not.toBeNull();
    if (dialog === null || closeBtn === null) return;
    await settleMotion();
    pointer(closeBtn, "pointerdown", { button: 0, clientX: 100, clientY: 100 });
    expect(dialog.classList.contains("modal-dialog-dragging")).toBe(false);
    pointerMove(260, 190);
    await settleMotion();
    expect(dialog.style.transform).not.toMatch(/160px|90px/);
    closeBtn.click();
    expect(closed).toBe(true);
  });
});