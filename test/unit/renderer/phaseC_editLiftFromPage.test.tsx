// @vitest-environment jsdom
//
// Phase C — "Add box" edit mode: the content is LIFTED off the page
// while the toolbox is open and committed SMOOTHLY (no full re-render
// flash).
//
// DEF-150 / DEF-155 context: when the floating toolbox was dragged,
// the run/box mirror moved with it, but the ORIGINAL baked content
// stayed on the page canvas — and on confirm the white eraser cover
// released before the engine re-bake + pdf.js proxy refresh landed, so
// the stale original flashed back. The fix mounts the eraser over the
// ORIGINAL rect for the whole time the toolbox has lifted committed
// content (box or text run), and HOLDS that cover until the commit's
// returned promise resolves (smooth commit; the cover itself unmounts
// after the mask + proxy refresh land).
//
// These tests cover the overlay's local rendering + timing contract.
// The host-side promise wiring (App.tsx returning the engine+refresh
// promise) is covered by type + the DOM behavior here.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

const stubCapture = function (this: Element): void {
  void this;
};
const stubRelease = function (this: Element): void {
  void this;
};

interface Deferred {
  resolve: (value?: void) => void;
  reject: (err: unknown) => void;
  promise: Promise<void>;
}

function deferred(): Deferred {
  let resolve = (): void => undefined;
  let reject = (): void => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
}

interface Host {
  onCommitTextEdit: ReturnType<typeof vi.fn>;
  onCommitTextBoxMove: ReturnType<typeof vi.fn>;
}

/**
 * Mount the EditOverlay with a real local reducer. The text-run commit
 * calls a deferred-controlled `onCommitTextEdit` so tests can hold and
 * release the host promise (simulating the engine mask + proxy refresh
 * in flight).
 */
function mountOverlay(
  initial: EditState,
  getTextItems: () => TextItemGeom[] = () => [],
): {
  host: HTMLElement;
  state: () => EditState;
  commits: Host;
  commitGate: Deferred;
  unmount: () => void;
} {
  const rootEl = document.createElement("div");
  rootEl.style.position = "absolute";
  rootEl.style.left = "0px";
  rootEl.style.top = "0px";
  rootEl.style.width = "800px";
  rootEl.style.height = "600px";
  document.body.appendChild(rootEl);
  rootEl.getBoundingClientRect = (): DOMRect => ({
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
  Element.prototype.setPointerCapture = stubCapture;
  Element.prototype.releasePointerCapture = stubRelease;
  const root = createRoot(rootEl);
  const onCommitTextEdit = vi.fn();
  const onCommitTextBoxMove = vi.fn();
  const commitGate = deferred();
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
          getTextItems,
          edit: lastState,
          dispatch: (action): void => {
            lastState = editReducer(lastState, action);
            render();
          },
          pickImage: async (): Promise<null> => null,
          defaultFont: "Helvetica",
          onCommitTextEdit: ((): (args: {
            rect: { x: number; y: number; width: number; height: number };
            newText: string;
            style: { font: string; size: number; color: { r: number; g: number; b: number } };
            oldRect?: { x: number; y: number; width: number; height: number };
          }) => Promise<void> => {
            return (args): Promise<void> => {
              onCommitTextEdit(args);
              return commitGate.promise;
            };
          })(),
          onCommitTextBox: (): void => undefined,
          onCommitImageEdit: (): void => undefined,
          onCommitTextBoxMove,
        }),
      );
    });
  };
  render();
  return {
    host: rootEl,
    state: (): EditState => lastState,
    commits: { onCommitTextEdit, onCommitTextBoxMove },
    commitGate,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      rootEl.remove();
    },
  };
}

function pointerdown(el: HTMLElement, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function pointerup(el: HTMLElement, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function boxDblClick(box: HTMLElement, x: number, y: number): void {
  act((): void => {
    box.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: x, clientY: y }));
  });
}

function textDblClick(x: number, y: number): void {
  act((): void => {
    window.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: x, clientY: y }));
  });
}

function clickCommit(host: HTMLElement): void {
  const btn = host.querySelector<HTMLButtonElement>(".edit-inline-btn-commit");
  if (btn === null) throw new Error("commit button not found");
  act((): void => {
    btn.click();
  });
}

function eraser(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>("[data-edit-box-eraser]");
}

const RUN: TextItemGeom = { x: 100, y: 100, width: 200, height: 30, text: "TFlex Technical Report" };

const BOX: TextBoxPlacement = {
  id: "tb-1",
  page: 1,
  rect: { x: 100, y: 100, width: 180, height: 40 },
  text: "MOVE TEST 88",
  style: { font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } },
  background: "white",
};

// ---------------------------------------------------------------------------
// Text-run: the toolbox LIFTS the original off the page, and the commit
// holds the eraser until the host promise resolves.

describe("Phase C — text-run edit lifts the original; commit holds the eraser", () => {
  it("opening the toolbox on a text run mounts the eraser over the ORIGINAL rect", () => {
    const { host, unmount } = mountOverlay(
      { ...initialEditState, tool: "text" },
      () => [RUN],
    );
    try {
      const layer = host.querySelector<HTMLElement>('[data-tool="text"]');
      if (layer === null) throw new Error("layer not found");
      pointerdown(layer, 120, 115);
      textDblClick(120, 115);
      const cover = eraser(host);
      expect(cover, "the original run is hidden while the toolbox is open").not.toBeNull();
      if (cover !== null) {
        expect(cover.style.left).toBe("100px");
        expect(cover.style.top).toBe("100px");
        expect(cover.style.width).toBe("200px");
        expect(cover.style.height).toBe("30px");
      }
    } finally {
      unmount();
    }
  });

  it("confirm holds the eraser until the host promise resolves (smooth commit — the original never flashes back)", async () => {
    const { host, commits, commitGate, unmount } = mountOverlay(
      { ...initialEditState, tool: "text" },
      () => [RUN],
    );
    try {
      const layer = host.querySelector<HTMLElement>('[data-tool="text"]');
      if (layer === null) throw new Error("layer not found");
      pointerdown(layer, 120, 115);
      textDblClick(120, 115);
      expect(eraser(host)).not.toBeNull();
      clickCommit(host);
      // The commit fired with the engine rect = the in-place rect.
      expect(commits.onCommitTextEdit).toHaveBeenCalledTimes(1);
      // While the engine mask + proxy refresh are in flight the cover
      // must STAY mounted (the toolbox just unmounted — without it the
      // stale original would flash back).
      expect(eraser(host), "cover held while the engine commit is in flight").not.toBeNull();
      // The host resolves: engine mask + pdf.js proxy refresh landed.
      commitGate.resolve();
      // The overlay holds the cover for two more paint frames (the
      // DEF-155 barrier); in jsdom rAF never fires, so the barrier
      // falls back to its 200ms watchdog — wait for the real release.
      await vi.waitFor(
        () => {
          expect(eraser(host), "cover released after the commit landed").toBeNull();
        },
        { timeout: 2000, interval: 20 },
      );
    } finally {
      unmount();
    }
  });

  it("cancelling the toolbox releases the cover immediately (no engine op is coming)", () => {
    const { host, unmount } = mountOverlay(
      { ...initialEditState, tool: "text" },
      () => [RUN],
    );
    try {
      const layer = host.querySelector<HTMLElement>('[data-tool="text"]');
      if (layer === null) throw new Error("layer not found");
      pointerdown(layer, 120, 115);
      textDblClick(120, 115);
      expect(eraser(host)).not.toBeNull();
      const cancel = host.querySelector<HTMLButtonElement>(".edit-inline-btn-cancel");
      if (cancel === null) throw new Error("cancel button not found");
      act((): void => {
        cancel.click();
      });
      expect(eraser(host), "cancel releases the cover").toBeNull();
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Committed box: opening the box editor lifts the BAKED original off the
// page; a rect-changing commit parks the eraser via the pending-box-move
// path so the original never flashes back mid re-bake.

describe("Phase C — committed-box edit lifts the original; move holds the eraser", () => {
  it("opening the box toolbox mounts the eraser over the box's ORIGINAL rect while moving the toolbox", () => {
    const { host, unmount } = mountOverlay({
      ...initialEditState,
      tool: "box",
      textBoxes: [BOX],
    });
    try {
      const box = host.querySelector<HTMLElement>(`.edit-box[data-edit-box-id="${BOX.id}"]`);
      if (box === null) throw new Error("box not found");
      pointerdown(box, 120, 120);
      pointerup(box, 120, 120);
      boxDblClick(box, 120, 120);
      const cover = eraser(host);
      expect(cover, "the baked box is hidden while its toolbox is open").not.toBeNull();
      if (cover !== null) {
        expect(cover.style.left).toBe("100px");
        expect(cover.style.top).toBe("100px");
      }
    } finally {
      unmount();
    }
  });

  it("a moved box commit holds the eraser through the engine call (no stale frame at the old spot)", () => {
    const { host, commits, unmount } = mountOverlay({
      ...initialEditState,
      tool: "box",
      textBoxes: [BOX],
    });
    try {
      const box = host.querySelector<HTMLElement>(`.edit-box[data-edit-box-id="${BOX.id}"]`);
      if (box === null) throw new Error("box not found");
      pointerdown(box, 120, 120);
      pointerup(box, 120, 120);
      boxDblClick(box, 120, 120);
      const label = host.querySelector<HTMLElement>(".content-grip-inline");
      if (label === null) throw new Error("label not found");
      // Drag the toolbox +40/+30 so the commit rect differs.
      pointerdown(label, 200, 200);
      act((): void => {
        window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 240, clientY: 230, pointerId: 1 }));
      });
      clickCommit(host);
      // The box path is used and the cover is parked (pending box
      // move) while the engine move + proxy refresh resolve.
      expect(commits.onCommitTextBoxMove).toHaveBeenCalledTimes(1);
      expect(eraser(host), "cover held while the box move is in flight").not.toBeNull();
      // Release the resolve promise (the box handler is fire-and-forget
      // in tests, so this settles through the paint barrier watchdog).
    } finally {
      unmount();
    }
  });

  it("an unmoved box re-commit performs no engine write and leaves NO stale eraser", () => {
    const { host, commits, unmount } = mountOverlay({
      ...initialEditState,
      tool: "box",
      textBoxes: [BOX],
    });
    try {
      const box = host.querySelector<HTMLElement>(`.edit-box[data-edit-box-id="${BOX.id}"]`);
      if (box === null) throw new Error("box not found");
      pointerdown(box, 120, 120);
      pointerup(box, 120, 120);
      boxDblClick(box, 120, 120);
      clickCommit(host);
      expect(commits.onCommitTextBoxMove).not.toHaveBeenCalled();
      expect(eraser(host), "no engine op -> no parked eraser").toBeNull();
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Host-side promise wiring (App.tsx). App.tsx is not mountable in a unit
// test (it bootstraps the whole workspace), so — following the repo's
// established source-contract pattern (bug456 / bugB9) — these pin the
// exact wiring a refactor could silently break: the EditOverlay can only
// HOLD its eraser cover until the engine mask + proxy refresh land if the
// promise returned by `onCommitTextEdit` resolves only AFTER the refresh.
// The `handleEditTextRun` body must AWAIT `refreshFn(tabId)` (not fire
// `void refreshFn(...)`, which resolved the promise early and flashed the
// stale original back mid re-bake).

const APP_PATH = resolve(__dirname, "../../../src/renderer/App.tsx");
const appSrc = readFileSync(APP_PATH, "utf8");

function appBlock(startMarker: string, endMarker: string): string {
  const start = appSrc.indexOf(startMarker);
  expect(start, `marker ${startMarker} present`).toBeGreaterThan(-1);
  const end = endMarker === "" ? appSrc.length : appSrc.indexOf(endMarker, start);
  return appSrc.slice(start, end === -1 ? appSrc.length : end);
}

describe("Phase C — App.tsx text-run commit promise wiring", () => {
  it("handleEditTextRun AWAITS the pdf.js proxy refresh so the commit promise resolves after the engine mask + proxy swap have both landed", () => {
    const b = appBlock("const handleEditTextRun = useCallback", "const handleAddTextBox = useCallback");
    expect(b).toMatch(/await refreshFn\(tabId\)/);
    expect(b).not.toMatch(/void refreshFn\(tabId\)/);
    // The engine op runs before the refresh — the promise cannot
    // resolve before the mask is applied.
    expect(b.indexOf("await engineRef.current.editTextRun")).toBeGreaterThan(-1);
    expect(b.indexOf("await refreshFn(tabId)")).toBeGreaterThan(b.indexOf("await engineRef.current.editTextRun"));
  });

  it("the DocumentView edit bundle RETURNS handleEditTextRun's promise (not a fire-and-forget wrapper)", () => {
    // Anchor on the edit-bundle factory: defaultFont (unique to this
    // object) up to the legacy fire-and-forget onCommitTextBox body.
    const b = appBlock(
      'defaultFont: settings?.editDefaultFont ?? "Helvetica",',
      "onCommitTextBox: (args: {",
    );
    expect(b).toMatch(/=> handleEditTextRun\(tabId, args\)/);
    expect(b).not.toMatch(/void handleEditTextRun/);
  });
});