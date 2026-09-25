// @vitest-environment jsdom
//
// Phase 37 (features C + D) — the edit-text items 11 / 12 / 13 / 14.
//
//   Item 11  the edit-flow action bar is Confirm / Delete / Cancel in that
//            order, with NO Edit (selecting text already brings the panel);
//            Cancel reverts the renderer-local pending move.
//   Item 12  the selected text stays VISIBLE — the white eraser cover must
//            always be backed by the run preview.
//   Item 13  the EDIT stage is the Edit-mode switch (the dock verb is gone).
//   Item 14  "Renumber pages" is "Rename pages" everywhere it is a LABEL.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { RenumberPagesDialog } from "../../../src/renderer/components/RenumberPagesDialog";
import { Inspector } from "../../../src/renderer/components/Inspector";
import {
  dockToolsForStage,
  toolById,
} from "../../../src/renderer/state/toolsRegistry";
import { editModeForStage } from "../../../src/renderer/state/stages";

const APP_SOURCE = readFileSync(
  resolve(__dirname, "../../../src/renderer/App.tsx"),
  "utf8",
);

const stubCapture = function (this: Element): void {
  void this;
};
const stubRelease = function (this: Element): void {
  void this;
};

const RUN_ITEM: TextItemGeom = { x: 100, y: 100, width: 200, height: 20, text: "Source run" };

/** Mount EditOverlay with the text tool; `live` is the panel's draft text. */
function mountRunTool(options: { live?: string | null; textCommitToken?: number } = {}): {
  host: HTMLElement;
  onCommitTextEdit: ReturnType<typeof vi.fn>;
  unmount: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  Element.prototype.setPointerCapture = stubCapture;
  Element.prototype.releasePointerCapture = stubRelease;
  const root = createRoot(host);
  const onCommitTextEdit = vi.fn();
  const state: EditState = { ...initialEditState, tool: "text" };
  act((): void => {
    root.render(
      createElement(EditOverlay, {
        page: 1,
        pageWidthPt: 612,
        pageHeightPt: 792,
        cssScale: 1,
        tool: "text",
        getTextItems: (): TextItemGeom[] => [RUN_ITEM],
        edit: state,
        dispatch: (): void => undefined,
        pickImage: async (): Promise<null> => null,
        defaultFont: "Helvetica",
        onCommitTextEdit,
        onCommitTextBox: (): void => undefined,
        onCommitImageEdit: (): void => undefined,
        onCommitTextBoxMove: (): void => undefined,
        textLive: options.live ?? null,
        textCommitToken: options.textCommitToken ?? 0,
      }),
    );
  });
  return {
    host,
    onCommitTextEdit,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function layerOf(host: HTMLElement): HTMLElement {
  const layer = host.querySelector<HTMLElement>(".edit-layer");
  if (layer === null) throw new Error("edit layer not found");
  return layer;
}

function pointer(
  el: HTMLElement,
  type: string,
  x: number,
  y: number,
  button = 0,
): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

function selectRun(host: HTMLElement): void {
  pointer(layerOf(host), "pointerdown", 150, 110);
}

function barButtons(host: HTMLElement, bar: string): string[] {
  const el = host.querySelector(`[data-content-action-bar="${bar}"]`);
  if (el === null) throw new Error(`bar ${bar} not found`);
  return [...el.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
}

function clickAction(host: HTMLElement, selector: string): void {
  const btn = host.querySelector<HTMLButtonElement>(selector);
  if (btn === null) throw new Error(`${selector} not found`);
  act((): void => {
    btn.click();
  });
}

/** Let an exiting AnimatePresence element finish its exit animation. */
async function settleFrames(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

describe("Phase 37 item 11 — the edit-flow bar is Confirm / Delete / Cancel", () => {
  it("the text-run bar carries exactly those verbs, in order, with no Edit", () => {
    const m = mountRunTool();
    try {
      selectRun(m.host);
      expect(m.host.querySelector("[data-textrun-selection]")).not.toBeNull();
      expect(barButtons(m.host, "textrun")).toEqual(["Confirm", "Delete", "Cancel"]);
      expect(m.host.querySelector('[data-content-action="textrun-edit"]')).toBeNull();
      expect(m.host.querySelector('[data-content-action="textrun-confirm"]')).not.toBeNull();
      expect(m.host.querySelector('[data-content-action="textrun-delete"]')).not.toBeNull();
      expect(m.host.querySelector('[data-content-action="textrun-cancel"]')).not.toBeNull();
    } finally {
      m.unmount();
    }
  });

  it("Cancel dismisses the selection and never commits the pending move", async () => {
    const m = mountRunTool();
    try {
      selectRun(m.host);
      // Drag the run and release: parks a renderer-local pending move.
      pointer(layerOf(m.host), "pointermove", 200, 130);
      pointer(layerOf(m.host), "pointerup", 200, 130);
      expect(m.host.querySelector("[data-content-action-bar='textrun']")).not.toBeNull();
      clickAction(m.host, '[data-content-action="textrun-cancel"]');
      expect(m.onCommitTextEdit, "the engine never saw the move").not.toHaveBeenCalled();
      expect(m.host.querySelector("[data-textrun-selection]"), "selection dismissed").toBeNull();
      await settleFrames();
      expect(m.host.querySelector("[data-content-action-bar='textrun']")).toBeNull();
    } finally {
      m.unmount();
    }
  });
});

describe("Phase 37 item 12 � the selected text stays VISIBLE", () => {
  it("a bare run selection is backed by the preview over the white eraser", () => {
    const m = mountRunTool();
    try {
      selectRun(m.host);
      const eraser = m.host.querySelector<HTMLElement>("[data-edit-box-eraser]");
      const preview = m.host.querySelector<HTMLElement>("[data-edit-run-preview]");
      expect(eraser, "the white cover masks the baked run").not.toBeNull();
      expect(preview, "the preview must back the cover (text stays visible)").not.toBeNull();
      expect(preview?.textContent).toContain("Source run");
      // The preview must PAINT OVER the cover: it follows the eraser in DOM order.
      expect(
        eraser !== null && preview !== null &&
          (eraser.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        "the preview paints after (on top of) the eraser",
      ).toBe(true);
    } finally {
      m.unmount();
    }
  });

  it("the live panel draft wins once the session exists", () => {
    const m = mountRunTool({ live: "Edited run" });
    try {
      selectRun(m.host);
      expect(m.host.querySelector("[data-edit-run-preview]")?.textContent).toContain("Edited run");
    } finally {
      m.unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Item 11 (box half) + the revert half of Cancel. The box's registry rect is
// renderer-local until Confirm, so Cancel must restore it.

function makeTextBox(): TextBoxPlacement {
  return {
    id: "tb-1",
    page: 1,
    rect: { x: 100, y: 100, width: 180, height: 40 },
    text: "MOVE TEST 88",
    style: { font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } },
    background: "white",
  };
}

function mountBox(initial: EditState): {
  host: HTMLElement;
  state: () => EditState;
  unmount: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  Element.prototype.setPointerCapture = stubCapture;
  Element.prototype.releasePointerCapture = stubRelease;
  const root = createRoot(host);
  let last: EditState = initial;
  const render = (): void => {
    act((): void => {
      root.render(
        createElement(EditOverlay, {
          page: 1,
          pageWidthPt: 612,
          pageHeightPt: 792,
          cssScale: 1,
          tool: last.tool,
          getTextItems: (): TextItemGeom[] => [],
          edit: last,
          dispatch: (action): void => {
            last = editReducer(last, action);
            render();
          },
          pickImage: async (): Promise<null> => null,
          defaultFont: "Helvetica",
          onCommitTextEdit: (): void => undefined,
          onCommitTextBox: (): void => undefined,
          onCommitImageEdit: (): void => undefined,
          onCommitTextBoxMove: (): void => undefined,
          onDeleteTextBox: (): void => undefined,
        }),
      );
    });
  };
  render();
  return {
    host,
    state: (): EditState => last,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("Phase 37 item 11 � the box bar is Confirm / Delete / Cancel and Cancel reverts", () => {
  it("renders the three verbs in order (no Edit)", () => {
    const initial: EditState = {
      ...initialEditState,
      tool: "box",
      selectedTextBox: "tb-1",
      textBoxes: [makeTextBox()],
    };
    const m = mountBox(initial);
    try {
      const bar = m.host.querySelector("[data-edit-box-toolbar]");
      expect(bar).not.toBeNull();
      const verbs = [...(bar?.querySelectorAll("button") ?? [])].map((b) =>
        b.textContent?.trim(),
      );
      expect(verbs).toEqual(["Confirm", "Delete", "Cancel"]);
      expect(m.host.querySelector("[data-edit-box-action='edit']")).toBeNull();
    } finally {
      m.unmount();
    }
  });

  it("Cancel restores the registry rect the drag had moved", async () => {
    const initial: EditState = {
      ...initialEditState,
      tool: "box",
      selectedTextBox: "tb-1",
      textBoxes: [makeTextBox()],
    };
    const m = mountBox(initial);
    try {
      const box = m.host.querySelector<HTMLElement>(".edit-box");
      if (box === null) throw new Error("box not found");
      pointer(box, "pointerdown", 120, 120);
      pointer(layerOf(m.host), "pointermove", 160, 140);
      pointer(layerOf(m.host), "pointerup", 160, 140);
      expect(m.state().textBoxes[0]?.rect.x).toBe(140);
      clickAction(m.host, "[data-edit-box-action='cancel']");
      expect(m.state().textBoxes[0]?.rect.x, "Cancel reverts the pending move").toBe(100);
      expect(m.state().selectedTextBox, "selection dismissed").toBeNull();
      await settleFrames();
      expect(m.host.querySelector("[data-edit-box-toolbar]")).toBeNull();
    } finally {
      m.unmount();
    }
  });
});

describe("Phase 37 item 14 � 'Renumber pages' is 'Rename pages'", () => {
  it("the registry entry label is Rename pages", () => {
    expect(toolById("renumberPages")?.label).toBe("Rename pages");
    expect(toolById("renumberPages")?.label).not.toContain("Renumber");
  });

  it("the dialog title is Rename pages", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        createElement(RenumberPagesDialog, {
          open: true,
          totalPages: 2,
          initialLabels: [],
          onConfirm: (): void => undefined,
          onClose: (): void => undefined,
        }),
      );
    });
    try {
      expect(container.querySelector(".modal-title")?.textContent?.trim()).toBe("Rename pages");
    } finally {
      act((): void => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("the Inspector's Label affordance reads rename", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        createElement(Inspector, {
          stage: "pages",
          selection: { kind: "page", page: 1 },
          onRenumberPages: vi.fn(),
        }),
      );
    });
    try {
      const action = container.querySelector('[data-inspector-action="renumber"]');
      expect(action, "the affordance keeps its id/action, only the label changes").not.toBeNull();
      expect(action?.textContent ?? "").toContain("rename");
      expect(action?.textContent ?? "").not.toContain("renumber");
    } finally {
      act((): void => {
        root.unmount();
      });
      container.remove();
    }
  });
});

describe("Phase 37 item 13 � the EDIT stage is the Edit-mode switch", () => {
  it("maps EDIT to edit mode ON and every other stage to OFF", () => {
    expect(editModeForStage("edit")).toBe(true);
    expect(editModeForStage("pages")).toBe(false);
    expect(editModeForStage("review")).toBe(false);
    expect(editModeForStage("deliver")).toBe(false);
  });

  it("the EDIT dock no longer offers an editMode verb", () => {
    expect(dockToolsForStage("edit").map((e) => e.id)).not.toContain("editMode");
    expect(toolById("editMode")?.surface).not.toBe("dock");
  });

it("App owns the single stage -> edit-mode effect (no second switch)", () => {
    // Phase 38 / DEF-342 — the effect is keyed on the active stage AND the
    // active document id so it re-applies when a document arrives while the
    // stage is unchanged (reopening a tab while EDIT is shown).
    const effect =
      /const prevStageApplyRef[\s\S]*?useEffect\(\(\): void => \{[\s\S]*?setEditMode\(editModeForStage\(activeStage\)\)[\s\S]*?\}, \[activeStage, tabs\.activeId, setEditMode\]\);/;
    expect(APP_SOURCE).toMatch(effect);
  });
});
