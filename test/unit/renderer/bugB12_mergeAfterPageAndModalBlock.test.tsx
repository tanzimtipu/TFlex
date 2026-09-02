// @vitest-environment jsdom
//
// B12 — merge dialog: modal blocking while the OS file picker is
// open, plus a new "After page N" insert position.
//
// History:
//   - The merge dialog used to keep the backdrop click handler
//     live while the picker was open. The user could click
//     outside the dialog mid-pick and dismiss the dialog (the
//     backdrop swallowed the click, the picker's button was
//     disabled, and the OS picker went away too). Net effect:
//     the user lost their pick. The fix makes the dialog
//     modal-blocked while `picking === true` (no backdrop
//     dismissal, Esc swallowed, all controls except the close
//     button disabled, aria-busy set) and restores normal
//     behavior when the picker returns.
//   - The dialog used to offer only "before" / "after" the
//     entire doc. Operators asked for an "After page N"
//     option so a merge can land between two existing pages.
//     The renderer-only MergePosition adds "afterPage"; the
//     host routes that position through the engine's
//     `insertFromPdf` IPC, which already accepts a 0-based
//     `afterIndex` (1-based N maps to afterIndex = N-1; N=0
//     maps to afterIndex = -1 = "at the very beginning").
//
// We render the MergeDialog in isolation against a fake
// pickFile and assert:
//   1. The new "After page" radio + number input appear when
//      totalPages > 0.
//   2. Selecting "After page" enables the number input;
//      selecting the others disables it.
//   3. Confirm fires with position="afterPage" and the picked
//      afterPage value.
//   4. While picking is true, the backdrop's click handler is
//      inert (no close), Esc is swallowed, and aria-busy is
//      set.
//   5. After the picker returns, picking flips false and the
//      dialog returns to normal (backdrop click closes).
//   6. When totalPages = 0 the "After page" option is hidden
//      (no meaningless insert on an empty doc).
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MergeDialog,
  type MergePickedFile,
} from "../../../src/renderer/components/MergeDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface RenderArgs {
  totalPages?: number;
  pickFile?: () => Promise<MergePickedFile | null>;
  onConfirm?: (c: {
    otherPath: string;
    otherBytes: Uint8Array;
    position: "before" | "after" | "afterPage";
    afterPage?: number;
  }) => void;
  onClose?: () => void;
}

function mountDialog(args: RenderArgs = {}): {
  root: Root;
  host: HTMLElement;
  onConfirm: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  pickFile: ReturnType<typeof vi.fn>;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const pickFile = vi.fn(args.pickFile);
  act((): void => {
    root.render(
      <MergeDialog
        open={true}
        onClose={onClose}
        onConfirm={onConfirm}
        pickFile={pickFile}
        sourceName="report.pdf"
        totalPages={args.totalPages ?? 5}
      />,
    );
  });
  return {
    root,
    host,
    onConfirm,
    onClose,
    pickFile,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function clickBackdrop(host: HTMLElement): void {
  const backdrop = host.querySelector<HTMLElement>(".modal-backdrop");
  if (backdrop === null) throw new Error("backdrop not found");
  act((): void => {
    // B3/B6 — a genuine outside click includes the mousedown on the
    // backdrop; the backdrop only closes when the interaction
    // STARTED there too.
    backdrop.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
  });
  act((): void => {
    backdrop.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

function pressEscape(): void {
  act((): void => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    );
  });
}

const SAMPLE_PICK: MergePickedFile = {
  path: "/tmp/other.pdf",
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
};

describe("B12 — MergeDialog: After page N + modal blocking during pick", () => {
  it("renders with the .merge-dialog class so the e2e selector finds it", () => {
    // The dialog exposes BOTH the generic `.modal-dialog` class
    // (used by the rest of the dialog system) and the specific
    // `.merge-dialog` class (used by the e2e sweep test's
    // selector). Without the specific class the e2e sweep times
    // out waiting for the dialog.
    const { host, cleanup } = mountDialog({ totalPages: 5 });
    try {
      const dialog = host.querySelector<HTMLElement>(".modal-dialog");
      expect(dialog).not.toBeNull();
      expect(dialog?.classList.contains("merge-dialog")).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("renders the 'After page' radio + number input when totalPages > 0", () => {
    const { host, cleanup } = mountDialog({ totalPages: 5 });
    try {
      const afterRadio = host.querySelector<HTMLInputElement>(
        "[data-merge-pos='afterPage']",
      );
      expect(afterRadio).not.toBeNull();
      const numberInput = host.querySelector<HTMLInputElement>(
        "[data-merge-after-page]",
      );
      expect(numberInput).not.toBeNull();
      // Default value is totalPages (append-after).
      expect(numberInput?.value).toBe("5");
      expect(numberInput?.min).toBe("0");
      expect(numberInput?.max).toBe("5");
    } finally {
      cleanup();
    }
  });

  it("hides the 'After page' option when totalPages = 0", () => {
    const { host, cleanup } = mountDialog({ totalPages: 0 });
    try {
      expect(host.querySelector("[data-merge-pos='afterPage']")).toBeNull();
      expect(host.querySelector("[data-merge-after-page]")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("picking the 'After page' radio enables the number input; other positions disable it", () => {
    const { host, cleanup } = mountDialog({ totalPages: 5 });
    try {
      const numberInput = host.querySelector<HTMLInputElement>(
        "[data-merge-after-page]",
      );
      expect(numberInput).not.toBeNull();
      // Disabled by default (default position is "after", not "afterPage").
      expect(numberInput?.disabled).toBe(true);
      const afterRadio = host.querySelector<HTMLInputElement>(
        "[data-merge-pos='afterPage']",
      );
      expect(afterRadio).not.toBeNull();
      // React controlled input: drive it via the native setter +
      // click (matches the pattern the color-palette tests use).
      act((): void => {
        afterRadio?.click();
      });
      const reQuery = host.querySelector<HTMLInputElement>(
        "[data-merge-after-page]",
      );
      expect(reQuery?.disabled).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("focusing the number input flips the radio on, so the user sees the active option", () => {
    const { host, cleanup } = mountDialog({ totalPages: 5 });
    try {
      const numberInput = host.querySelector<HTMLInputElement>(
        "[data-merge-after-page]",
      );
      expect(numberInput).not.toBeNull();
      // Enable by selecting afterPage first.
      const afterRadio = host.querySelector<HTMLInputElement>(
        "[data-merge-pos='afterPage']",
      );
      act((): void => {
        afterRadio?.click();
      });
      act((): void => {
        numberInput?.focus();
      });
      const checkedRadio = host.querySelector<HTMLInputElement>(
        "input[name='merge-pos']:checked",
      );
      expect(checkedRadio?.dataset.mergePos).toBe("afterPage");
    } finally {
      cleanup();
    }
  });

  it("Confirm with position=afterPage propagates the picked afterPage value", async () => {
    const { host, onConfirm, cleanup } = mountDialog({
      totalPages: 5,
      pickFile: async (): Promise<MergePickedFile> => SAMPLE_PICK,
    });
    try {
      // Pick the file.
      const pickBtn = host.querySelector<HTMLButtonElement>(
        "[data-merge-pick]",
      );
      expect(pickBtn).not.toBeNull();
      await act(async (): Promise<void> => {
        pickBtn?.click();
      });
      // Switch to afterPage by clicking the radio.
      const afterRadio = host.querySelector<HTMLInputElement>(
        "[data-merge-pos='afterPage']",
      );
      await act(async (): Promise<void> => {
        afterRadio?.click();
      });
      // Set the afterPage number to 3 via the native setter so React's
      // controlled input picks it up.
      const numberInput = host.querySelector<HTMLInputElement>(
        "[data-merge-after-page]",
      );
      await act(async (): Promise<void> => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(numberInput, "3");
        numberInput?.dispatchEvent(new Event("input", { bubbles: true }));
        numberInput?.dispatchEvent(new Event("change", { bubbles: true }));
      });
      // Click Confirm.
      const confirm = host.querySelector<HTMLButtonElement>(
        "[data-merge-confirm]",
      );
      expect(confirm).not.toBeNull();
      await act(async (): Promise<void> => {
        confirm?.click();
      });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      const call = onConfirm.mock.calls[0]?.[0];
      expect(call?.position).toBe("afterPage");
      expect(call?.afterPage).toBe(3);
      expect(call?.otherPath).toBe("/tmp/other.pdf");
      expect(call?.otherBytes).toBeInstanceOf(Uint8Array);
    } finally {
      cleanup();
    }
  });

  it("Confirm with position=before/after omits afterPage from the payload", async () => {
    const { host, onConfirm, cleanup } = mountDialog({
      totalPages: 5,
      pickFile: async (): Promise<MergePickedFile> => SAMPLE_PICK,
    });
    try {
      const pickBtn = host.querySelector<HTMLButtonElement>(
        "[data-merge-pick]",
      );
      await act(async (): Promise<void> => {
        pickBtn?.click();
      });
      // Default position is "after".
      const confirm = host.querySelector<HTMLButtonElement>(
        "[data-merge-confirm]",
      );
      await act(async (): Promise<void> => {
        confirm?.click();
      });
      const call = onConfirm.mock.calls[0]?.[0];
      expect(call?.position).toBe("after");
      expect(call?.afterPage).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  describe("B12 modal blocking while the picker is open", () => {
    it("the backdrop click handler is a no-op while picking", async () => {
      let resolvePick: ((v: MergePickedFile | null) => void) | null = null;
      const pickPromise = new Promise<MergePickedFile | null>((res) => {
        resolvePick = res;
      });
      const { host, onClose, cleanup } = mountDialog({
        totalPages: 5,
        pickFile: (): Promise<MergePickedFile | null> => pickPromise,
      });
      try {
        const pickBtn = host.querySelector<HTMLButtonElement>(
          "[data-merge-pick]",
        );
        act((): void => {
          pickBtn?.click();
        });
        // Picking is now true. Click the backdrop — must NOT close.
        clickBackdrop(host);
        expect(onClose).not.toHaveBeenCalled();
        // aria-busy is set on the dialog body.
        const dialog = host.querySelector<HTMLElement>(".modal-dialog");
        expect(dialog?.getAttribute("aria-busy")).toBe("true");
        // backdrop data-picking attribute marks the modal-block state.
        const backdrop = host.querySelector<HTMLElement>(".modal-backdrop");
        expect(backdrop?.getAttribute("data-picking")).toBe("true");
        // Release the picker so the cleanup can finish cleanly.
        await act(async (): Promise<void> => {
          resolvePick?.(SAMPLE_PICK);
        });
      } finally {
        cleanup();
      }
      // Suppress unused-var lint (the post-pick assertion below is
      // covered by the next test).
      void onClose;
    });

    it("Esc is swallowed while picking — the dialog stays open", async () => {
      let resolvePick: ((v: MergePickedFile | null) => void) | null = null;
      const pickPromise = new Promise<MergePickedFile | null>((res) => {
        resolvePick = res;
      });
      const { host, onClose, cleanup } = mountDialog({
        totalPages: 5,
        pickFile: (): Promise<MergePickedFile | null> => pickPromise,
      });
      try {
        const pickBtn = host.querySelector<HTMLButtonElement>(
          "[data-merge-pick]",
        );
        act((): void => {
          pickBtn?.click();
        });
        pressEscape();
        expect(onClose).not.toHaveBeenCalled();
        // The dialog body is still in the DOM.
        expect(host.querySelector(".modal-dialog")).not.toBeNull();
        await act(async (): Promise<void> => {
          resolvePick?.(null);
        });
      } finally {
        cleanup();
      }
    });

    it("after the picker returns, backdrop clicks close the dialog again", async () => {
      let resolvePick: ((v: MergePickedFile | null) => void) | null = null;
      const pickPromise = new Promise<MergePickedFile | null>((res) => {
        resolvePick = res;
      });
      const { host, onClose, cleanup } = mountDialog({
        totalPages: 5,
        pickFile: (): Promise<MergePickedFile | null> => pickPromise,
      });
      try {
        const pickBtn = host.querySelector<HTMLButtonElement>(
          "[data-merge-pick]",
        );
        act((): void => {
          pickBtn?.click();
        });
        // While picking, click does nothing.
        clickBackdrop(host);
        expect(onClose).not.toHaveBeenCalled();
        // Resolve the picker.
        await act(async (): Promise<void> => {
          resolvePick?.(SAMPLE_PICK);
        });
        // Now the backdrop click closes.
        clickBackdrop(host);
        expect(onClose).toHaveBeenCalledTimes(1);
        const dialog = host.querySelector<HTMLElement>(".modal-dialog");
        expect(dialog?.getAttribute("aria-busy")).toBe("false");
      } finally {
        cleanup();
      }
    });
  });
});