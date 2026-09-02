// @vitest-environment jsdom
//
// B17 — Insert / Replace dialog backdrop must not close when a
// text-selection drag starts in the input and releases over the
// backdrop.
//
// The defect: the backdrop's `onClick={onClose}` fired whenever a
// click event landed on the backdrop. A drag that starts in the
// input and ends over the backdrop dispatches its `click` on the
// common ancestor (the backdrop), so the dialog closed mid-edit.
//
// The fix: the backdrop records where the pointer interaction
// STARTED (an onMouseDown handler + ref). The click handler only
// closes when BOTH the mousedown and the click landed on the
// backdrop itself (target === currentTarget). A real outside click
// still closes; a drag that ended outside does not.
//
// We exercise InsertPagesDialog in isolation:
//   1. mousedown on the input + click on the backdrop -> dialog
//      stays open.
//   2. mousedown on the backdrop + click on the backdrop ->
//      dialog closes.
//   3. The same drag-guard exists in ReplacePagesDialog (source
//      contract).
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { InsertPagesDialog } from "../../../src/renderer/components/InsertPagesDialog";
import * as fs from "node:fs";
import * as path from "node:path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  const backdrop = host.querySelector<HTMLElement>("[data-insert-pages-dialog]");
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

describe("B17 — backdrop close requires the interaction to start on the backdrop", () => {
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

  it("ReplacePagesDialog carries the same drag-guard contract", () => {
    const replacePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "src",
      "renderer",
      "components",
      "ReplacePagesDialog.tsx",
    );
    const source = fs.readFileSync(replacePath, "utf8");
    expect(source).toMatch(
      /backdropDownRef\.current\s*=\s*e\.target\s*===\s*e\.currentTarget/,
    );
    expect(source).toMatch(
      /backdropDownRef\.current\s*&&\s*e\.target\s*===\s*e\.currentTarget/,
    );
  });
});