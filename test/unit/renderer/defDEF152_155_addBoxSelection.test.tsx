// @vitest-environment jsdom
//
// DEF-152 / DEF-155 / DEF-153 — the add-box half of the unified
// interaction model.
//
// DEF-152: the box's action bar must carry Confirm / Edit / Delete.
// A real drag parks a PENDING move (the registry rect follows live,
// the ENGINE move is NOT implicit on pointerup); Confirm threads the
// pending position through onCommitTextBoxMove, and cancelling /
// pressing the empty page reverts it.
//
// DEF-155: the white eraser cover over the OLD rect stays mounted
// while the move is pending AND through the Confirm's engine commit
// + proxy-refresh promise, so the moved box never flashes a stale
// frame at its original rect.
//
// DEF-153: while the box is selected/movable a "Double click to
// edit" hint shows, and the inline editor's toolbar carries the
// shared labelled "Drag to move" grip.
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
import {
  editReducer,
  initialEditState,
  type EditState,
  type TextBoxPlacement,
} from "../../../src/renderer/edit/model";
import type { TextItemGeom } from "../../../src/renderer/annotations/AnnotationOverlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    text: "MOVE TEST 88",
    style: { font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } },
    background: "white",
    ...overrides,
  };
}

function mountBoxTool(initial: EditState): {
  host: HTMLElement;
  state: () => EditState;
  onCommitTextBoxMove: ReturnType<typeof vi.fn>;
  /** Resolve the in-flight engine commit (mimics the engine mask +
   *  proxy refresh round-trip completing). */
  resolveCommit: () => void;
  unmount: () => void;
} {
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
  Element.prototype.setPointerCapture = stubCapture;
  Element.prototype.releasePointerCapture = stubRelease;
  const root = createRoot(host);
  let pendingResolvers: (() => void)[] = [];
  const resolveCommit = (): void => {
    const resolvers = pendingResolvers;
    pendingResolvers = [];
    for (const r of resolvers) r();
  };
  const onCommitTextBoxMove = vi.fn((): Promise<void> | void => {
    // DEF-155 — the host commit resolves ONLY when the harness lets
    // it (mimicking the engine mask + proxy refresh round-trip).
    return new Promise<void>((resolve) => {
      pendingResolvers.push(resolve);
    });
  });
  let lastState: EditState = initial;
  const render = (): void => {
    act((): void => {
      root.render(
        createElement(EditOverlay, {
          page: 1,
          pageWidthPt: 612,
          pageHeightPt: 792,
          cssScale: 1,
          tool: lastState.tool,
          getTextItems: (): TextItemGeom[] => [],
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
          onCommitTextBoxMove,
          onDeleteTextBox: (): void => undefined,
        }),
      );
    });
  };
  render();
  return {
    host,
    state: (): EditState => lastState,
    onCommitTextBoxMove,
    resolveCommit,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function pressBox(host: HTMLElement, x: number, y: number): void {
  const box = host.querySelector<HTMLElement>(".edit-box");
  if (box === null) throw new Error("box not found");
  act((): void => {
    box.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function moveLayer(host: HTMLElement, x: number, y: number): void {
  const layer = host.querySelector<HTMLElement>(".edit-layer");
  if (layer === null) throw new Error("layer not found");
  act((): void => {
    layer.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function releaseLayer(host: HTMLElement, x: number, y: number): void {
  const layer = host.querySelector<HTMLElement>(".edit-layer");
  if (layer === null) throw new Error("layer not found");
  act((): void => {
    layer.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function clickConfirm(host: HTMLElement): void {
  const btn = host.querySelector<HTMLButtonElement>("[data-edit-box-action='confirm']");
  if (btn === null) throw new Error("Confirm button not found");
  act((): void => {
    btn.click();
  });
}

/** Let a pending Promise<...> from onCommitTextBoxMove resolve plus
 *  the two post-refresh animation frames the overlay waits for. */
async function settleFrames(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function msgBoxTool(): EditState {
  return { ...initialEditState, tool: "box", textBoxes: [makeTextBox()] };
}

describe("DEF-152 — the moved box's action bar carries Confirm + Cancel with Delete behind More, and Confirm commits the threaded position", () => {
  it("the bar renders Confirm + Cancel (Phase 117) with Delete behind More for a selected/moved box; a drag parks a PENDING move", () => {
    const { host, onCommitTextBoxMove, unmount } = mountBoxTool(msgBoxTool());
    try {
      pressBox(host, 120, 120);
      moveLayer(host, 160, 140); // +40/+20
      releaseLayer(host, 160, 140);
      // The move is NOT implicit on release anymore.
      expect(onCommitTextBoxMove).not.toHaveBeenCalled();
      const bar = host.querySelector("[data-edit-box-toolbar]");
      expect(bar, "bar appears for the selected/moved box").not.toBeNull();
      // Phase 117 (DEF-663) — the primary row is Confirm + Cancel + Delete; the
      // destructive Delete is a direct sibling of Confirm (the More control was
      // removed). The Edit verb stays gone.
      const primaryVerbs = [...(bar?.querySelectorAll("button") ?? [])]
        .filter((b) => b.closest(".content-action-more-menu") === null)
        .map((b) => b.textContent?.trim());
      expect(primaryVerbs).toEqual(["Confirm", "Cancel", "Delete"]);
      expect(host.querySelector("[data-edit-box-action='edit']"), "no Edit verb").toBeNull();
      const del = host.querySelector("[data-edit-box-action='delete']");
      expect(del, "Delete renders inline").not.toBeNull();
      expect(del?.textContent?.trim()).toBe("Delete");
      expect(del?.closest(".content-action-more-menu")).toBeNull();
      expect(host.querySelector("[data-content-action='editbox-more']")).toBeNull();
      // Confirm commits the THREADED position (old = engine rect,
      // new = drag end).
      clickConfirm(host);
      expect(onCommitTextBoxMove).toHaveBeenCalledTimes(1);
      const call = onCommitTextBoxMove.mock.calls[0]?.[0];
      expect(call.oldRect).toEqual({ x: 100, y: 100, width: 180, height: 40 });
      expect(call.newRect).toEqual({ x: 140, y: 120, width: 180, height: 40 });
      expect(call.id).toBe("tb-1");
    } finally {
      unmount();
    }
  });

  it("pressing the empty page after a move REVERTS the pending move (the registry rect returns to the engine position)", () => {
    const { host, state, onCommitTextBoxMove, unmount } = mountBoxTool(msgBoxTool());
    try {
      pressBox(host, 120, 120);
      moveLayer(host, 160, 140);
      releaseLayer(host, 160, 140);
      expect(state().textBoxes[0]?.rect.x).toBe(140);
      // Press the empty page area (drag-to-create would start, but the
      // unconfirmed move is reverted first).
      const layer = host.querySelector<HTMLElement>(".edit-layer");
      if (layer === null) throw new Error("layer not found");
      act((): void => {
        layer.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 500, clientY: 500, pointerId: 1 }));
      });
      expect(onCommitTextBoxMove).not.toHaveBeenCalled();
      expect(state().textBoxes[0]?.rect.x).toBe(100);
    } finally {
      unmount();
    }
  });
});

describe("DEF-155 — the white eraser covers the OLD rect until the confirm's engine+refresh resolve", () => {
  it("the eraser stays mounted while the move is pending (release does not clear it)", () => {
    const { host, unmount } = mountBoxTool(msgBoxTool());
    try {
      pressBox(host, 120, 120);
      moveLayer(host, 160, 140);
      releaseLayer(host, 160, 140);
      // Pending: the eraser must STILL cover the old rect — the old
      // bake is visible on the canvas until the confirmed engine
      // mask + proxy refresh land (this was the DEF-145 stale-frame
      // window; the old code unmounted the eraser at pointerup).
      const eraser = host.querySelector<HTMLElement>("[data-edit-box-eraser]");
      expect(eraser, "eraser stays mounted while the move is pending").not.toBeNull();
      expect(eraser?.style.left).toBe("100px");
      expect(eraser?.style.top).toBe("100px");
      expect(eraser?.style.width).toBe("180px");
      expect(eraser?.style.height).toBe("40px");
    } finally {
      unmount();
    }
  });

  it("Confirm keeps the eraser until the engine+refresh promise resolves; after it + both frames the eraser unmounts (no stale frame)", async () => {
    const { host, onCommitTextBoxMove, resolveCommit, unmount } = mountBoxTool(msgBoxTool());
    try {
      pressBox(host, 120, 120);
      moveLayer(host, 160, 140);
      releaseLayer(host, 160, 140);
      // Click Confirm: the engine commit is now in flight and the
      // promise is pending (the proxy refresh has not landed).
      clickConfirm(host);
      expect(onCommitTextBoxMove).toHaveBeenCalledTimes(1);
      expect(host.querySelector("[data-edit-box-eraser]"), "eraser covers the old rect while the engine+refresh is pending").not.toBeNull();
      // Even after a couple of frames, the pending commit keeps the
      // eraser mounted (the promise has not resolved).
      await settleFrames();
      expect(host.querySelector("[data-edit-box-eraser]"), "eraser stays until the promise resolves").not.toBeNull();
      // The engine mask + proxy refresh complete -> the overlay
      // waits two more frames for the canvas paint, then unmounts.
      await act(async (): Promise<void> => {
        resolveCommit();
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        );
      });
      // Phase C — the box toolbar's exit animation unmounts on the
      // next frame after the selection's last state commit; give the
      // motion exit its frame before asserting no stale DOM.
      await settleFrames();
      expect(host.querySelector("[data-edit-box-eraser]"), "eraser unmounts after the refresh lands").toBeNull();
      // The selection closed with the pending move.
      expect(host.querySelector("[data-edit-box-toolbar]")).toBeNull();
    } finally {
      unmount();
    }
  });

});

