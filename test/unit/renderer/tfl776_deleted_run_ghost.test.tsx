// @vitest-environment jsdom
//
// TFL-776.1 — after a text run is DELETED via the Edit Text action bar the
// vacated page position must be INERT: hovering it paints no
// `.edit-text-hover` box and clicking it neither selects nor restores the run.
//
// Root cause: the engine edit that deletes a run MASKS its rect but never
// removes the run's text operators, so pdf.js still returns the phantom item at
// the old spot after the proxy refresh. The bar's Delete committed the engine
// change but never registered the vacated rect, so the hit-test kept matching
// the phantom. The fix dispatches a `push-text-run-commit` whose `maskedRect`
// equals the vacated rect, which the shared `isMaskedRunRect` predicate uses to
// filter the phantom from both hover and click.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
import {
  editReducer,
  initialEditState,
  isMaskedRunRect,
  type EditAction,
  type EditState,
} from "../../../src/renderer/edit/model";
import type { TextItemGeom } from "../../../src/renderer/annotations/AnnotationOverlay";

const RUN: TextItemGeom = { x: 100, y: 100, width: 200, height: 20, text: "Source run" };
const VACATED = { x: 100, y: 100, width: 200, height: 20 };

const stubCapture = function (this: Element): void {
  void this;
};
const stubRelease = function (this: Element): void {
  void this;
};

interface Props {
  textLive: string | null;
  textCommitToken: number;
}

interface Harness {
  host: HTMLElement;
  root: Root;
  items: TextItemGeom[];
  state: EditState;
  props: Props;
  rerender: () => void;
  unmount: () => void;
}

function mount(): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  Element.prototype.setPointerCapture = stubCapture;
  Element.prototype.releasePointerCapture = stubRelease;
  const root = createRoot(host);
  const h: Harness = {
    host,
    root,
    items: [{ ...RUN }],
    state: { ...initialEditState, tool: "text" },
    props: { textLive: null, textCommitToken: 0 },
    rerender: (): void => undefined,
    unmount: (): void => undefined,
  };
  const render = (): void => {
    act((): void => {
      root.render(
        createElement(EditOverlay, {
          page: 1,
          pageWidthPt: 612,
          pageHeightPt: 792,
          cssScale: 1,
          tool: "text",
          getTextItems: (): TextItemGeom[] => h.items,
          edit: h.state,
          dispatch: (action: EditAction): void => {
            h.state = editReducer(h.state, action);
            render();
          },
          pickImage: async (): Promise<null> => null,
          defaultFont: "Helvetica",
          onCommitTextEdit: vi.fn(),
          onCommitTextBox: (): void => undefined,
          onCommitImageEdit: (): void => undefined,
          onCommitTextBoxMove: (): void => undefined,
          textStyle: { font: "Helvetica", size: 20, color: { r: 0, g: 0, b: 0 } },
          onTextTargetChange: (): void => undefined,
          onTextInput: (): void => undefined,
          onTextInputCommit: (): void => undefined,
          onDiscardTextEdit: (): void => undefined,
          textLive: h.props.textLive,
          textCommitToken: h.props.textCommitToken,
        }),
      );
    });
  };
  h.rerender = render;
  h.unmount = (): void => {
    act((): void => {
      root.unmount();
    });
    host.remove();
  };
  render();
  return h;
}

function layerOf(host: HTMLElement): HTMLElement {
  const layer = host.querySelector<HTMLElement>(".edit-layer");
  if (layer === null) throw new Error("edit layer not found");
  return layer;
}

function pointer(el: HTMLElement, type: string, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

function hover(host: HTMLElement, x: number, y: number): void {
  pointer(layerOf(host), "pointermove", x, y);
}

function clickAction(host: HTMLElement, selector: string): void {
  const btn = host.querySelector<HTMLButtonElement>(selector);
  if (btn === null) throw new Error(`${selector} not found`);
  act((): void => {
    btn.click();
  });
}

function selectRun(host: HTMLElement, x: number, y: number): void {
  pointer(layerOf(host), "pointerdown", x, y);
}

function hoverBoxes(host: HTMLElement): number {
  return host.querySelectorAll(".edit-text-hover").length;
}

function hasSelection(host: HTMLElement): boolean {
  return host.querySelector("[data-textrun-selection]") !== null;
}

describe("TFL-776.1 — a deleted run leaves no hover box / hit-target", () => {
  it("delete registers the vacated rect as masked and leaves the spot inert", () => {
    const h = mount();
    try {
      selectRun(h.host, 150, 110);
      clickAction(h.host, '[data-content-action="textrun-delete"]');

      const commits = h.state.committedTextRuns ?? [];
      expect(commits.length, "one delete commit registered").toBe(1);
      const entry = commits[0];
      if (entry === undefined) throw new Error("delete commit missing");
      expect(entry.page).toBe(1);
      expect(entry.text).toBe("");
      expect(entry.maskedRect, "vacated rect recorded as masked").toMatchObject(VACATED);
      expect(isMaskedRunRect(commits, 1, VACATED), "vacated rect is masked").toBe(true);

      // pdf.js still returns the phantom item at the vacated rect after the
      // engine mask + proxy refresh; the hit-test must ignore it.
      h.items = [{ ...RUN }];
      h.rerender();
      hover(h.host, 150, 110);
      expect(hoverBoxes(h.host), "no hover box on the vacated position").toBe(0);

      // A click on the vacated position neither selects nor restores the run.
      selectRun(h.host, 150, 110);
      expect(hasSelection(h.host), "click does not restore the deleted run").toBe(false);
      expect(h.state.committedTextRuns?.length, "click adds no commit").toBe(1);
    } finally {
      h.unmount();
    }
  });

  it("the MOVE path still registers and filters its masked original", () => {
    const h = mount();
    try {
      selectRun(h.host, 150, 110);
      pointer(layerOf(h.host), "pointermove", 210, 140);
      pointer(layerOf(h.host), "pointerup", 210, 140);
      clickAction(h.host, '[data-content-action="textrun-confirm"]');

      const commits = h.state.committedTextRuns ?? [];
      expect(commits.length, "one move commit registered").toBe(1);
      const entry = commits[0];
      if (entry === undefined) throw new Error("move commit missing");
      expect(entry.maskedRect, "move records its original rect").toMatchObject(VACATED);

      h.items = [
        { ...RUN },
        { x: 160, y: 130, width: 200, height: 20, text: "Source run" },
      ];
      h.rerender();
      hover(h.host, 150, 110);
      expect(hoverBoxes(h.host), "old position clean after a move").toBe(0);
      hover(h.host, 300, 140);
      expect(hoverBoxes(h.host), "moved run still hovers").toBe(1);
    } finally {
      h.unmount();
    }
  });

  it("an in-place edit (no maskedRect) is not filtered and still selects", () => {
    const h = mount();
    try {
      selectRun(h.host, 150, 110);
      // Drive the panel commit-token path: the run text changed, no move.
      h.props.textLive = "Edited run";
      h.props.textCommitToken = 1;
      h.rerender();

      const commits = h.state.committedTextRuns ?? [];
      expect(commits.length, "one edit commit registered").toBe(1);
      const entry = commits[0];
      if (entry === undefined) throw new Error("edit commit missing");
      expect(entry.maskedRect, "in-place edit carries no masked rect").toBeUndefined();
      expect(entry.text).toBe("Edited run");
      expect(isMaskedRunRect(commits, 1, VACATED), "in-place edit is not masked").toBe(false);

      // pdf.js returns the stale original AND the engine-drawn new text.
      h.items = [
        { ...RUN },
        { x: 100, y: 100, width: 200, height: 20, text: "Edited run" },
      ];
      h.rerender();
      selectRun(h.host, 150, 110);
      expect(hasSelection(h.host), "in-place edit still selects").toBe(true);
    } finally {
      h.unmount();
    }
  });
});
