// @vitest-environment jsdom
//
// DEF-358 (ADV-096) — after the Phase 37 EDIT-toolbar retirement, arming an
// edit tool left its dock verb with NO active state: DocumentView still passed
// `activeToolIds={editModeOpen ? ['editMode'] : []}`, but `editMode` is no
// longer a rendered dock verb, so `.action-dock-verb[aria-pressed='true']`
// never matched. Armed and unarmed were indistinguishable.
//
// This suite pins the fix at the REAL wiring: mount DocumentView with the EDIT
// stage and a per-tool edit state, then assert the ACTUAL armed verb carries
// `aria-pressed="true"` (and no other edit verb does), and that the unarmed
// state marks NO edit verb pressed.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentView, type PersistedViewer } from "../../../src/renderer/components/DocumentView";
import type { DocDiagnostics } from "../../../src/renderer/components/DocumentView";
import type { EngineState } from "../../../src/renderer/engine/types";
import {
  editDockVerbFor,
  initialEditState,
  type EditTool,
} from "../../../src/renderer/edit/model";

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

const EDIT_VERBS = ["editText", "editTextBox", "editImage", "editToolOff"] as const;

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(): Promise<unknown> {
      return {
        view: [0, 0, 612, 792],
        getViewport: (_args: { scale: number }): { width: number; height: number } => ({
          width: 612,
          height: 792,
        }),
        render: (_args: unknown): { promise: Promise<void> } => ({
          promise: Promise.resolve(),
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function makeEngineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: Array.from({ length: pageCount }, () => 0),
    deleted: Array.from({ length: pageCount }, () => false),
    modified: false,
    annotations: [],
  };
}

const INITIAL_VIEWER: PersistedViewer = {
  zoomMode: "fit-width",
  manualScale: 1,
  currentPage: 1,
  searchOpen: false,
  query: "",
  activeHitIndex: -1,
};

function makeEdit(tool: EditTool): NonNullable<Parameters<typeof DocumentView>[0]["edit"]> {
  return {
    state: { ...initialEditState, tool },
    onAction: vi.fn(),
    defaultFont: "Helvetica",
    pickImage: async (): Promise<null> => null,
    onCommitTextEdit: vi.fn(),
    onCommitTextBox: vi.fn(),
    onCommitImageEdit: vi.fn(),
    onCommitTextBoxMove: vi.fn(),
  };
}

interface Harness {
  host: HTMLElement;
  render: (editModeOpen: boolean, tool: EditTool) => Promise<void>;
  unmount: () => void;
}

async function mountView(): Promise<Harness> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = async (editModeOpen: boolean, tool: EditTool): Promise<void> => {
    await act(async (): Promise<void> => {
      root.render(
        createElement(DocumentView, {
          doc: makeDocStub(3),
          pageCount: 3,
          outline: null,
          initial: INITIAL_VIEWER,
          onPersist: (): void => undefined,
          onDiagnostics: (_d: DocDiagnostics): void => undefined,
          engineState: makeEngineState(3),
          modified: false,
          canUndo: false,
          saveInPlaceEnabled: false,
          annotations: [],
          formFields: [],
          signatures: [],
          savedSignatures: [],
          stampAnnotations: [],
          activeStage: "edit",
          editModeOpen,
          edit: makeEdit(tool),
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  await render(false, "text");
  return {
    host,
    render,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function verb(host: HTMLElement, id: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[data-dock-verb="${id}"]`);
}

/** The press state of every EDIT dock verb, as `{ id: aria-pressed }`. */
function pressedMap(host: HTMLElement): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const id of EDIT_VERBS) out[id] = verb(host, id)?.getAttribute("aria-pressed") ?? null;
  return out;
}

const CASES: ReadonlyArray<[EditTool, string]> = [
  ["text", "editText"],
  ["box", "editTextBox"],
  ["image", "editImage"],
  ["off", "editToolOff"],
];

describe("DEF-358 — an armed edit tool marks its own dock verb pressed", () => {
  it("the mapping targets the rendered dock verb, never the retired editMode id", () => {
    expect(editDockVerbFor("text")).toBe("editText");
    expect(editDockVerbFor("box")).toBe("editTextBox");
    expect(editDockVerbFor("image")).toBe("editImage");
    expect(editDockVerbFor("off")).toBe("editToolOff");
  });

  it("no edit verb is pressed while edit mode is closed", async () => {
    const { host, unmount } = await mountView();
    try {
      expect(pressedMap(host)).toEqual({
        editText: null,
        editTextBox: null,
        editImage: null,
        editToolOff: null,
      });
    } finally {
      unmount();
    }
  });

  it("each armed edit tool presses exactly its own verb (off included)", async () => {
    const { host, render, unmount } = await mountView();
    try {
      for (const [tool, expected] of CASES) {
        await render(true, tool);
        const map = pressedMap(host);
        expect(map[expected], `tool '${tool}' must press ${expected}`).toBe("true");
        for (const id of EDIT_VERBS) {
          if (id === expected) continue;
          expect(map[id], `tool '${tool}' must NOT press ${id}`).toBe(null);
        }
      }
    } finally {
      unmount();
    }
  });
});
