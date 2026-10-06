// @vitest-environment jsdom
//
// Phase 112 (TFL-854, chunk C3) — the EDIT Context Pair.
//
// The Edit workspace's LEFT content navigator (ContextPanel.renderEdit) and
// RIGHT selection inspector (the text scope + TextPropertiesPanel) migrated
// onto the shared panel primitives WITHOUT changing a command, handler,
// shortcut, selector, document operation or undo/redo behaviour.
//
// These tests pin the two contracts the brief names:
//   LEFT  — the content + recognition sections render through PanelSection;
//           the diagnostic states render through the shared empty-state
//           primitives; the Default-font row, the content items and the OCR
//           actions (recognize / suspects + the OCR gate) are preserved.
//   RIGHT — the text controls appear only for a valid text selection; they
//           read the ACTUAL selected values; advanced typography is disclosed
//           progressively; the font label is user-facing availability copy
//           (never the retired base-14 / embedding internal prose).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ContextPanel,
  editContentState,
} from "../../../src/renderer/components/ContextPanel";
import type { ContextPanelEditContent } from "../../../src/renderer/components/ContextPanel";
import {
  Inspector,
  inspectorTextPanelFor,
  inspectorTextPanelForSelection,
} from "../../../src/renderer/components/Inspector";
import type {
  InspectorProps,
  InspectorTextSelection,
} from "../../../src/renderer/components/Inspector";
import { clearFormattingPatch } from "../../../src/renderer/edit/TextPropertiesPanel";
import { defaultTextStyleValues } from "../../../src/renderer/edit/textStyle";
import type { TextStyleValues } from "../../../src/renderer/edit/textStyle";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { EditFont } from "../../../src/shared/types";

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, 612, 792],
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void>; cancel: () => void } => ({
          promise: Promise.resolve(),
          cancel: (): void => undefined,
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
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
  };
}

function mountContextPanel(
  props: Partial<Parameters<typeof ContextPanel>[0]> = {},
): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const pageCount = props.engineState?.pageCount ?? 3;
  act((): void => {
    root.render(
      <ContextPanel
        stage="edit"
        doc={makeDocStub(pageCount)}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        engineState={makeEngineState(pageCount)}
        canUndo={false}
        onJump={(): void => undefined}
        outline={null}
        {...props}
      />,
    );
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function mountInspector(props: InspectorProps): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(<Inspector {...props} />);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const ITEMS: ContextPanelEditContent[] = [
  { id: "box-1", kind: "text", label: "Hello", page: 1, selected: true },
  { id: "img-1", kind: "image", label: "Image", page: 1, selected: false },
  { id: "box-2", kind: "text", label: "Elsewhere", page: 3, selected: false },
];

function textSnapshot(values: TextStyleValues, text: string | null = "Styled text"): InspectorTextSelection {
  return {
    targetKey: "box-1",
    name: "Text object",
    values,
    defaults: defaultTextStyleValues(values.font),
    mode: "text",
    text,
    onPatch: (): void => undefined,
    onTextChange: (): void => undefined,
    onTextCommit: (): void => undefined,
    focusToken: 0,
  };
}

describe("Phase 112 C3 — editContentState", () => {
  it("keeps a real page with items ready", () => {
    expect(
      editContentState({ editContent: ITEMS, pageItemCount: 2 }),
    ).toBe("ready");
  });
  it("reads no-content for a real but empty page", () => {
    expect(editContentState({ editContent: ITEMS, pageItemCount: 0 })).toBe("no-content");
  });
  it("reads no-selection when the host published no edit content", () => {
    expect(editContentState({ editContent: null, pageItemCount: 0 })).toBe("no-selection");
    expect(editContentState({ editContent: undefined, pageItemCount: 0 })).toBe("no-selection");
  });
  it("lets the engine flags win, restricted over unsupported", () => {
    expect(
      editContentState({ editContent: ITEMS, pageItemCount: 2, unsupported: true }),
    ).toBe("unsupported");
    expect(
      editContentState({
        editContent: ITEMS,
        pageItemCount: 2,
        unsupported: true,
        restricted: true,
      }),
    ).toBe("restricted");
  });
});

describe("Phase 112 C3 — the LEFT Edit content navigator", () => {
  it("renders the content + recognition sections through PanelSection", () => {
    const { host, unmount } = mountContextPanel({ editContent: ITEMS });
    try {
      const sections = [...host.querySelectorAll<HTMLElement>("[data-context-panel-section]")];
      expect(sections.map((el) => el.getAttribute("data-context-panel-section"))).toEqual([
        "content",
        "recognition",
      ]);
      for (const section of sections) {
        expect(section.classList.contains("tf-panel-section")).toBe(true);
      }
    } finally {
      unmount();
    }
  });

  it("preserves the Default font row as a property row", () => {
    const { host, unmount } = mountContextPanel({ editContent: ITEMS });
    try {
      const row = host.querySelector<HTMLElement>("[data-edit-default-font-row]");
      expect(row).not.toBeNull();
      expect(row?.classList.contains("tf-panel-row")).toBe(true);
      expect(row?.querySelector("[data-edit-default-font]")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("lists only the current page's objects and routes selection", () => {
    const onSelectEditContent = vi.fn();
    const { host, unmount } = mountContextPanel({ editContent: ITEMS, onSelectEditContent });
    try {
      const items = [...host.querySelectorAll<HTMLElement>("[data-edit-content-item]")];
      expect(items.map((el) => el.getAttribute("data-edit-content-item"))).toEqual([
        "box-1",
        "img-1",
      ]);
      expect(items.map((el) => el.getAttribute("data-edit-content-kind"))).toEqual([
        "text",
        "image",
      ]);
      clickOn(host.querySelector('[data-edit-content-item="img-1"]') as Element);
      expect(onSelectEditContent).toHaveBeenCalledWith("img-1", "image");
    } finally {
      unmount();
    }
  });

  it("keeps the designed no-content empty state and its hook", () => {
    const { host, unmount } = mountContextPanel({ editContent: [ITEMS[2]] });
    try {
      const empty = host.querySelector<HTMLElement>("[data-edit-content-empty]");
      expect(empty).not.toBeNull();
      expect(empty?.classList.contains("empty-state")).toBe(true);
      expect(empty?.querySelector(".empty-state-headline")?.textContent).toBe(
        "No editable content on this page.",
      );
      expect(host.querySelectorAll("[data-edit-content-item]").length).toBe(0);
    } finally {
      unmount();
    }
  });

  it("renders the unsupported / restricted diagnostics through PanelEmptyState", () => {
    const unsupported = mountContextPanel({ editContent: [], editUnsupported: true });
    try {
      const empty = unsupported.host.querySelector<HTMLElement>('[data-edit-content-state="unsupported"]');
      expect(empty?.classList.contains("tf-panel-empty")).toBe(true);
      expect(empty?.querySelector(".tf-panel-empty-headline")?.textContent).toBe("Unsupported editing");
    } finally {
      unsupported.unmount();
    }
    const restricted = mountContextPanel({ editContent: [], editPermissionRestricted: true });
    try {
      const empty = restricted.host.querySelector<HTMLElement>('[data-edit-content-state="restricted"]');
      expect(empty?.classList.contains("tf-panel-empty")).toBe(true);
      expect(empty?.querySelector(".tf-panel-empty-headline")?.textContent).toBe("Permission restricted");
    } finally {
      restricted.unmount();
    }
  });

  it("shows the Recognition-not-run state and preserves the OCR rows + gate", () => {
    const { host, unmount } = mountContextPanel({ editContent: [], ocrHasRun: false });
    try {
      const empty = host.querySelector<HTMLElement>("[data-ocr-empty]");
      expect(empty?.classList.contains("tf-panel-empty")).toBe(true);
      expect(empty?.querySelector(".tf-panel-empty-headline")?.textContent).toBe("Recognition not run");
      expect(host.querySelector("[data-ocr-status]")?.textContent).toBe("Not run");
      const suspects = host.querySelector<HTMLButtonElement>('[data-context-panel-action="suspects"]');
      expect(suspects?.disabled).toBe(true);
      expect(suspects?.getAttribute("title")).toBe("Run Recognize text first");
    } finally {
      unmount();
    }
  });

  it("wires the EXISTING recognize / suspects actions once OCR has run", () => {
    const onRecognizeText = vi.fn();
    const onOpenOcrSuspects = vi.fn();
    const { host, unmount } = mountContextPanel({
      editContent: [],
      ocrHasRun: true,
      ocrSuspectCount: 2,
      onRecognizeText,
      onOpenOcrSuspects,
    });
    try {
      expect(host.querySelector("[data-ocr-empty]")).toBeNull();
      expect(host.querySelector("[data-ocr-suspect-count]")?.textContent).toBe("2");
      clickOn(host.querySelector('[data-context-panel-action="recognize"]') as Element);
      clickOn(host.querySelector('[data-context-panel-action="suspects"]') as Element);
      expect(onRecognizeText).toHaveBeenCalledTimes(1);
      expect(onOpenOcrSuspects).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });
});

describe("Phase 112 C3 — the RIGHT selection inspector", () => {
  it("shows the text controls only for a valid text selection", () => {
    const snap = textSnapshot({ ...defaultTextStyleValues("Times"), size: 15 });
    expect(inspectorTextPanelForSelection({ kind: "text", name: "Text object" }, snap)).not.toBeNull();
    expect(inspectorTextPanelForSelection({ kind: "page", page: 1 }, snap)).toBeNull();
  });

  it("reads the ACTUAL selected values from the snapshot", () => {
    const values: TextStyleValues = {
      ...defaultTextStyleValues("DejaVu Serif"),
      size: 22,
      bold: true,
      align: "center",
    };
    const { host, unmount } = mountInspector({
      stage: "edit",
      selection: { kind: "text", name: "Text object" },
      textPanel: inspectorTextPanelFor(textSnapshot(values)),
    });
    try {
      const font = host.querySelector<HTMLSelectElement>("[data-txt-font]");
      expect(font?.value).toBe("DejaVu Serif");
      expect(host.querySelector<HTMLInputElement>("[data-txt-size]")?.value).toBe("22");
      expect(host.querySelector('[data-txt-bold]')?.getAttribute("aria-pressed")).toBe("true");
      expect(host.querySelector('[data-txt-align-center]')?.getAttribute("aria-pressed")).toBe("true");
    } finally {
      unmount();
    }
  });

  it("discloses advanced typography progressively (collapsed by default)", () => {
    const { host, unmount } = mountInspector({
      stage: "edit",
      selection: { kind: "text", name: "Text object" },
      textPanel: inspectorTextPanelFor(textSnapshot(defaultTextStyleValues("Helvetica"))),
    });
    try {
      const advanced = host.querySelector<HTMLDetailsElement>("[data-txt-advanced]");
      expect(advanced).not.toBeNull();
      expect(advanced?.tagName.toLowerCase()).toBe("details");
      expect(advanced?.open).toBe(false);
      expect(advanced?.querySelector("[data-txt-line-height]")).not.toBeNull();
      expect(advanced?.querySelector("[data-txt-character-spacing]")).not.toBeNull();
      expect(advanced?.querySelector("[data-txt-horizontal-scaling]")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("shows user-facing font availability copy, not internal base-14 prose", () => {
    const { host, unmount } = mountInspector({
      stage: "edit",
      selection: { kind: "text", name: "Text object" },
      textPanel: inspectorTextPanelFor(textSnapshot(defaultTextStyleValues("Helvetica"))),
    });
    try {
      const hint = host.querySelector("[data-txt-font-availability]")?.textContent ?? "";
      expect(hint.toLowerCase()).toContain("available");
      expect(hint).not.toContain("base-14");
      expect(hint.toLowerCase()).not.toContain("embed");
    } finally {
      unmount();
    }
  });

  it("keeps the default new-text style separately scoped", () => {
    // "Clear formatting" resets to the PER-TOOL defaults, never to the panel's
    // own baseline; the left Default-font row owns the new-text font.
    const defaults = defaultTextStyleValues("Courier");
    const patch = clearFormattingPatch(defaults);
    expect(patch.font).toBe("Courier");
    expect(patch.size).toBe(defaults.size);

    const left = mountContextPanel({ editContent: [], editDefaultFont: "Courier" as EditFont });
    try {
      const select = left.host.querySelector<HTMLSelectElement>("[data-edit-default-font]");
      expect(select?.value).toBe("Courier");
    } finally {
      left.unmount();
    }
  });
});
