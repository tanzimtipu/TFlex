// @vitest-environment jsdom
// Phase 87 / C2 (FEA-039) — Remove blank pages dialog.
//
// The dialog is a pure UI shell: it classifies the `measurements` prop through
// the shared classifier and reports the user's picks. These cases pin the
// CONTROL-INDEX contract:
//   1. one [data-blank-candidate] per blank page (default-checked); confirm
//      sends the ascending page list.
//   2. no candidates -> the report reads "No blank pages found." and confirm
//      is disabled.
//   3. an unmeasurable page (coverage null) is reported, never a candidate.
//   4. running -> progress text renders and the run button is disabled.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  BlankPagesDialog,
  type BlankPagesDialogProps,
} from "../../../src/renderer/components/BlankPagesDialog";

function mount(overrides: Partial<BlankPagesDialogProps>): {
  host: HTMLElement;
  unmount: () => void;
  rerender: (next: Partial<BlankPagesDialogProps>) => void;
  onConfirm: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onConfirm = vi.fn((): void => undefined);
  const baseProps: BlankPagesDialogProps = {
    open: true,
    totalPages: 4,
    threshold: 0.005,
    running: false,
    progress: 0,
    measurements: null,
    report: null,
    onThresholdChange: (): void => undefined,
    onRun: (): void => undefined,
    onConfirm,
    onClose: (): void => undefined,
    ...overrides,
  };
  act((): void => {
    root.render(<BlankPagesDialog {...baseProps} />);
  });
  return {
    host,
    rerender: (next: Partial<BlankPagesDialogProps>): void => {
      act((): void => {
        root.render(<BlankPagesDialog {...baseProps} {...next} />);
      });
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
    onConfirm,
  };
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function commitByBlur(input: HTMLInputElement): void {
  act((): void => {
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function commitByEnter(input: HTMLInputElement): void {
  act((): void => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
}

describe("Phase 87 / C2 — Remove blank pages dialog", () => {
  it("renders one candidate row and confirms the checked page", () => {
    const { host, onConfirm, unmount } = mount({
      measurements: [
        { page: 1, coverage: 0 },
        { page: 2, coverage: 0.5 },
      ],
    });
    const rows = host.querySelectorAll("[data-blank-candidate]");
    expect(rows.length).toBe(1);
    expect(rows[0]?.getAttribute("data-blank-candidate")).toBe("1");
    expect(rows[0]?.textContent).toContain("Page 1 - 0.00% ink");
    const confirm = host.querySelector<HTMLButtonElement>(
      "[data-blank-scan-confirm]",
    );
    expect(confirm?.disabled).toBe(false);
    act((): void => {
      confirm?.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).toEqual([1]);
    unmount();
  });

  it("shows the empty-state report and disables confirm with no candidates", () => {
    const { host, unmount } = mount({
      measurements: [{ page: 1, coverage: 0.5 }],
    });
    const report = host.querySelector("[data-blank-scan-report]");
    expect(report?.textContent).toContain("No blank pages");
    expect(
      host.querySelector<HTMLButtonElement>("[data-blank-scan-confirm]")?.disabled,
    ).toBe(true);
    unmount();
  });

  it("reports an unmeasurable page and never lists it as a candidate", () => {
    const { host, unmount } = mount({
      measurements: [{ page: 3, coverage: null, reason: "boom" }],
    });
    const report = host.querySelector("[data-blank-scan-report]");
    expect(report?.textContent).toContain("Page 3: boom");
    expect(host.querySelectorAll("[data-blank-candidate]").length).toBe(0);
    unmount();
  });

  it("disables run and shows progress while running", () => {
    const { host, unmount } = mount({
      running: true,
      progress: 2,
      totalPages: 9,
    });
    const progress = host.querySelector("[data-blank-scan-progress]");
    expect(progress?.textContent).toContain("page");
    expect(
      host.querySelector<HTMLButtonElement>("[data-blank-scan-run]")?.disabled,
    ).toBe(true);
    unmount();
  });

  // DEF-502 / ADV-169: a page that was checked under a looser threshold must
  // not survive into the confirm payload once it is no longer a candidate.
  it("never confirms a checked page that is no longer a candidate (DEF-502)", () => {
    const measurements = [
      { page: 1, coverage: 0.004 },
      { page: 2, coverage: 0.5 },
    ];
    const { host, onConfirm, rerender, unmount } = mount({
      measurements,
      threshold: 0.005,
    });
    expect(host.querySelectorAll("[data-blank-candidate]").length).toBe(1);
    const enabledConfirm = host.querySelector<HTMLButtonElement>(
      "[data-blank-scan-confirm]",
    );
    expect(enabledConfirm?.disabled).toBe(false);
    expect(enabledConfirm?.textContent).toContain("Remove 1 selected");

    // Same measurements array reference, tighter threshold -> page 1 drops out.
    rerender({ measurements, threshold: 0.001 });
    expect(host.querySelectorAll("[data-blank-candidate]").length).toBe(0);
    const disabledConfirm = host.querySelector<HTMLButtonElement>(
      "[data-blank-scan-confirm]",
    );
    expect(disabledConfirm?.disabled).toBe(true);
    expect(disabledConfirm?.textContent).toContain("Remove 0 selected");

    act((): void => {
      disabledConfirm?.click();
    });
    expect(onConfirm).not.toHaveBeenCalled();
    unmount();
  });

  // Threshold field keeps a raw string while typing and clamps on commit.
  it("commits a typed threshold on Enter", () => {
    const onThresholdChange = vi.fn((): void => undefined);
    const { host, unmount } = mount({ onThresholdChange });
    const input = host.querySelector<HTMLInputElement>(
      "[data-blank-scan-threshold]",
    );
    expect(input).not.toBeNull();
    if (input === null) return;
    typeInto(input, "0.4");
    commitByEnter(input);
    expect(onThresholdChange).toHaveBeenLastCalledWith(0.4);
    unmount();
  });

  it("clamps a committed threshold above 1", () => {
    const onThresholdChange = vi.fn((): void => undefined);
    const { host, unmount } = mount({ onThresholdChange });
    const input = host.querySelector<HTMLInputElement>(
      "[data-blank-scan-threshold]",
    );
    expect(input).not.toBeNull();
    if (input === null) return;
    typeInto(input, "1.5");
    commitByBlur(input);
    expect(onThresholdChange).toHaveBeenLastCalledWith(1);
    unmount();
  });

  it("clamps a committed threshold below 0", () => {
    const onThresholdChange = vi.fn((): void => undefined);
    const { host, unmount } = mount({ onThresholdChange });
    const input = host.querySelector<HTMLInputElement>(
      "[data-blank-scan-threshold]",
    );
    expect(input).not.toBeNull();
    if (input === null) return;
    typeInto(input, "-0.2");
    commitByBlur(input);
    expect(onThresholdChange).toHaveBeenLastCalledWith(0);
    unmount();
  });
});
