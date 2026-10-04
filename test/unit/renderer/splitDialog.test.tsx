// @vitest-environment jsdom
//
// Phase 92 (TFL-513 chunk C1) — minimal render contract for SplitDialog
// after its DialogShell adoption. Mirrors the raw react-dom/client + act
// mount used by phase52Dialogs.test.tsx:20-46.
//
// The dialog previously had no unit spec. These checks pin the shell DOM
// hooks the e2e suite selects and the confirm payload:
//   - the DialogShell root hook `[data-dialog-shell]`,
//   - the `#split-dialog-title` heading,
//   - the page-range input,
//   - the primary action fires onConfirm with the parsed range.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  SplitDialog,
  type SplitConfirm,
} from "../../../src/renderer/components/SplitDialog";

function mount(node: React.ReactElement): {
  root: Root;
  container: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(node);
  });
  return {
    root,
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function renderDialog(args: {
  totalPages?: number;
  onConfirm?: (c: SplitConfirm) => void;
  onClose?: () => void;
} = {}): { container: HTMLElement; cleanup: () => void } {
  const { container, cleanup } = mount(
    <SplitDialog
      open={true}
      totalPages={args.totalPages ?? 3}
      onClose={args.onClose ?? ((): void => undefined)}
      onConfirm={args.onConfirm ?? ((): void => undefined)}
    />,
  );
  return { container, cleanup };
}

describe("SplitDialog — DialogShell render contract", () => {
  it("renders through DialogShell with the pinned title and range input", () => {
    const { container, cleanup } = renderDialog();
    try {
      expect(container.querySelector("[data-dialog-shell]")).not.toBeNull();
      expect(container.querySelector("#split-dialog-title")?.textContent).toBe(
        "Extract or split pages",
      );
      expect(
        container.querySelector(".modal-body input[type='text']"),
      ).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("primary action fires onConfirm with the parsed range and mode", () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({ totalPages: 3, onConfirm });
    try {
      const confirm = container.querySelector<HTMLButtonElement>(
        '[data-dialog-action="confirm"]',
      );
      expect(confirm).not.toBeNull();
      act((): void => {
        confirm?.click();
      });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith({ range: [1, 2, 3], mode: "extract" });
    } finally {
      cleanup();
    }
  });

  it("cancel action fires onClose", () => {
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({ onClose });
    try {
      const cancel = container.querySelector<HTMLButtonElement>(
        '[data-dialog-action="cancel"]',
      );
      expect(cancel).not.toBeNull();
      act((): void => {
        cancel?.click();
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });
});
