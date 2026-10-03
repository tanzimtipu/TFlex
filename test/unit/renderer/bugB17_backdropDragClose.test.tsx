// @vitest-environment jsdom
//
// B3/B6 (formerly B17) — modal backdrops must not close when a
// text-selection drag starts in the input and releases over the
// backdrop.
//
// The defect: the backdrop's `onClick={onClose}` fired whenever a
// click event landed on the backdrop. A drag that starts in the
// input and ends over the backdrop dispatches its `click` on the
// common ancestor (the backdrop), so the dialog closed mid-edit.
//
// The fix: EVERY modal backdrop is wired through the shared
// `useBackdropClose` hook, which records where the pointer
// interaction STARTED (an onMouseDown handler + ref). The click
// handler only closes when BOTH the mousedown and the click landed
// on the backdrop itself (target === currentTarget). A real outside
// click still closes; a drag that ended outside does not.
//
// We exercise InsertPagesDialog in isolation:
//   1. mousedown on the input + click on the backdrop -> dialog
//      stays open.
//   2. mousedown on the backdrop + click on the backdrop ->
//      dialog closes.
//   3. A source-level contract test asserts EVERY file with a
//      `.modal-backdrop` div imports/uses the shared hook, so a
//      future dialog cannot regress to a bare `onClick={onClose}`.
import { describe, expect, it, vi, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { InsertPagesDialog } from "../../../src/renderer/components/InsertPagesDialog";
import { DocxExportDialog } from "../../../src/renderer/components/DocxExportDialog";
import { CropPagesDialog } from "../../../src/renderer/components/CropPagesDialog";
import * as fs from "node:fs";
import * as path from "node:path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver; the crop editor's width-tracking
// effect constructs one. Polyfill a no-op before the dialog mounts
// (same pattern as cropPagesDialog.test.tsx).
beforeAll(() => {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof StubResizeObserver }).ResizeObserver =
    StubResizeObserver;
});

function mountInsert(): {
  host: HTMLElement;
  backdrop: HTMLElement;
  input: HTMLInputElement;
  onClose: ReturnType<typeof vi.fn>;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onClose = vi.fn();
  act((): void => {
    root.render(
      <InsertPagesDialog
        open
        totalPages={5}
        pickOtherFile={async (): Promise<null> => null}
        onConfirm={(): void => undefined}
        onClose={onClose}
      />,
    );
  });
  const backdrop = host.querySelector<HTMLElement>(".modal-backdrop");
  const input = host.querySelector<HTMLInputElement>("[data-insert-position]");
  if (backdrop === null || input === null) throw new Error("dialog parts not found");
  return {
    host,
    backdrop,
    input,
    onClose,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("B3/B6 — backdrop close requires the interaction to start on the backdrop", () => {
  it("a drag that starts in the input and releases over the backdrop does NOT close", () => {
    const { backdrop, input, onClose, cleanup } = mountInsert();
    try {
      // The user mousedowns in the input (to select text)…
      act((): void => {
        input.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
      });
      // …and releases over the backdrop. The browser dispatches
      // the click on the common ancestor (the backdrop).
      act((): void => {
        backdrop.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(onClose).not.toHaveBeenCalled();
      // Dialog still mounted.
      expect(backdrop.isConnected).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("a real outside click (mousedown AND click on the backdrop) still closes", () => {
    const { backdrop, onClose, cleanup } = mountInsert();
    try {
      act((): void => {
        backdrop.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
      });
      act((): void => {
        backdrop.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });
});

describe("B3/B6 — global contract: every modal backdrop uses the shared hook", () => {
  function rendererSources(): string[] {
    const out: string[] = [];
    const root = path.join(__dirname, "..", "..", "..", "src", "renderer");
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (entry.name.endsWith(".tsx")) {
          out.push(full);
        }
      }
    };
    walk(root);
    return out;
  }

  it("every file that renders a .modal-backdrop references useBackdropClose", () => {
    const offenders: string[] = [];
    for (const file of rendererSources()) {
      const src = fs.readFileSync(file, "utf8");
      if (!src.includes('className="modal-backdrop"')) continue;
      if (!src.includes("useBackdropClose")) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

// The named dialogs from the defect report (DocxExportDialog,
// CropPagesDialog) get their own behavioural drag-guard tests —
// the same two cases as InsertPagesDialog above.
function rawDragCases(target: HTMLElement, dragStart: HTMLElement, onClose: () => void): void {
  // Case 1: interaction starts on an inner control, click lands on
  // the backdrop — the dialog stays open.
  act((): void => {
    dragStart.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
  });
  act((): void => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
  expect(onClose).not.toHaveBeenCalled();
  // Case 2: mousedown AND click on the backdrop itself — closes.
  act((): void => {
    target.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
  });
  act((): void => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
  expect(onClose).toHaveBeenCalledTimes(1);
}

describe("B3/B6 — DocxExportDialog backdrop drag-guard", () => {
  it("a drag from the range input over the backdrop does not close; a real backdrop click does", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onClose = vi.fn();
    act((): void => {
      root.render(
        <DocxExportDialog
          open
          totalPages={5}
          runEngineExport={async () => ({ error: "not used" })}
          runAssemble={async () => ({ error: "not used" })}
          onConfirm={(): void => undefined}
          sourceName="report.pdf"
          onClose={onClose}
        />,
      );
    });
    try {
      const backdrop = host.querySelector<HTMLElement>(".modal-backdrop");
      const input = host.querySelector<HTMLInputElement>("[data-docx-export-range]");
      expect(backdrop).not.toBeNull();
      expect(input).not.toBeNull();
      if (backdrop === null || input === null) return;
      rawDragCases(backdrop, input, onClose);
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });
});

describe("B3/B6 — CropPagesDialog backdrop drag-guard", () => {
  it("a drag from the dialog body over the backdrop does not close; a real backdrop click does", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onClose = vi.fn();
    act((): void => {
      root.render(
        <CropPagesDialog
          open
          totalPages={3}
          pageSizes={{ 1: { widthPt: 612, heightPt: 792 } }}
          onConfirm={(): void => undefined}
          onClose={onClose}
        />,
      );
    });
    try {
      const backdrop = host.querySelector<HTMLElement>(".modal-backdrop");
      const dialog = host.querySelector<HTMLElement>(".modal-dialog");
      expect(backdrop).not.toBeNull();
      expect(dialog).not.toBeNull();
      if (backdrop === null || dialog === null) return;
      // mousedown starts inside the dialog body; the browser would
      // dispatch the release click on the backdrop (common ancestor).
      act((): void => {
        dialog.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
      });
      act((): void => {
        backdrop.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(onClose).not.toHaveBeenCalled();
      // Real backdrop click closes.
      act((): void => {
        backdrop.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
      });
      act((): void => {
        backdrop.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });
});