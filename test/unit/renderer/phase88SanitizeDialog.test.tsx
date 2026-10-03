// @vitest-environment jsdom
// Phase 88 / C (FEA-037) — Sanitize document dialog.
//
// The dialog is a pure UI shell: it seeds the four class checkboxes from the
// host's persisted selection, reports each toggle through `onOptionsChange`,
// runs the host's `runSanitize` and renders the honest per-class report plus
// any warnings. These cases pin the CONTROL-INDEX contract:
//   1. the checkboxes are seeded from `initialOptions`;
//   2. the run payload carries exactly the checked classes;
//   3. the report renders one line per class (0 included) plus the findings
//      and every warning;
//   4. the run button is disabled when none are checked;
//   5. a non-ok run shows the message, never blank.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  SanitizeDialog,
  type SanitizeDialogProps,
  type SanitizeRunOutcome,
} from "../../../src/renderer/components/SanitizeDialog";
import type { SanitizeOptions } from "../../../src/shared/sanitize";

const ALL_ON: SanitizeOptions = {
  javascript: true,
  launchActions: true,
  embeddedFiles: true,
  metadata: true,
};

interface Mounted {
  host: HTMLElement;
  unmount: () => void;
  rerender: (next: Partial<SanitizeDialogProps>) => void;
  onOptionsChange: ReturnType<typeof vi.fn>;
  runSanitize: ReturnType<typeof vi.fn>;
}

function mount(overrides: Partial<SanitizeDialogProps> = {}): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onOptionsChange = vi.fn((): void => undefined);
  const runSanitize = vi.fn(
    async (): Promise<SanitizeRunOutcome | { error: string }> => ({
      report: {
        selected: ["javascript", "launchActions", "embeddedFiles", "metadata"],
        removedByClass: { javascript: 0, launchActions: 0, embeddedFiles: 0, metadata: 0 },
        findings: [],
      },
      warnings: [],
    }),
  );
  const baseProps: SanitizeDialogProps = {
    open: true,
    initialOptions: ALL_ON,
    runSanitize,
    onOptionsChange,
    onClose: (): void => undefined,
    ...overrides,
  };
  act((): void => {
    root.render(<SanitizeDialog {...baseProps} />);
  });
  return {
    host,
    rerender: (next: Partial<SanitizeDialogProps>): void => {
      act((): void => {
        root.render(<SanitizeDialog {...baseProps} {...next} />);
      });
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
    onOptionsChange,
    runSanitize,
  };
}

function checkbox(host: HTMLElement, cls: string): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>(`[data-sanitize-class="${cls}"]`);
  if (el === null) throw new Error(`checkbox ${cls} missing`);
  return el;
}

function toggle(el: HTMLInputElement): void {
  act((): void => {
    el.click();
  });
}

function runButton(host: HTMLElement): HTMLButtonElement {
  const el = host.querySelector<HTMLButtonElement>("[data-sanitize-run]");
  if (el === null) throw new Error("run button missing");
  return el;
}

async function clickRun(host: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    runButton(host).click();
  });
}

describe("Phase 88 / C — Sanitize document dialog", () => {
  it("seeds the four checkboxes from the persisted options", () => {
    const { host, unmount } = mount({
      initialOptions: {
        javascript: true,
        launchActions: false,
        embeddedFiles: true,
        metadata: false,
      },
    });
    expect(checkbox(host, "javascript").checked).toBe(true);
    expect(checkbox(host, "launchActions").checked).toBe(false);
    expect(checkbox(host, "embeddedFiles").checked).toBe(true);
    expect(checkbox(host, "metadata").checked).toBe(false);
    expect(host.querySelectorAll("[data-sanitize-class]").length).toBe(4);
    unmount();
  });

  it("persists a toggle through onOptionsChange", () => {
    const { host, onOptionsChange, unmount } = mount();
    toggle(checkbox(host, "metadata"));
    expect(onOptionsChange).toHaveBeenCalledTimes(1);
    expect(onOptionsChange.mock.calls[0]?.[0]).toEqual({
      javascript: true,
      launchActions: true,
      embeddedFiles: true,
      metadata: false,
    });
    expect(checkbox(host, "metadata").checked).toBe(false);
    unmount();
  });

  it("runs with exactly the checked classes", async () => {
    const { host, runSanitize, unmount } = mount();
    toggle(checkbox(host, "metadata"));
    await clickRun(host);
    expect(runSanitize).toHaveBeenCalledTimes(1);
    expect(runSanitize.mock.calls[0]?.[0]).toEqual({
      javascript: true,
      launchActions: true,
      embeddedFiles: true,
      metadata: false,
    });
    unmount();
  });

  it("renders one count per class (0 included), the findings and the warnings", async () => {
    const { host, unmount } = mount({
      runSanitize: async (): Promise<SanitizeRunOutcome> => ({
        report: {
          selected: ["javascript", "launchActions", "embeddedFiles", "metadata"],
          removedByClass: { javascript: 2, launchActions: 0, embeddedFiles: 1, metadata: 0 },
          findings: [
            { class: "javascript", where: "catalog /OpenAction", detail: "JavaScript action removed" },
            { class: "embeddedFiles", where: "page 3 annotation 1", detail: "file spec removed" },
          ],
        },
        warnings: ["catalog /Names has an unexpected type; left untouched"],
      }),
    });
    await clickRun(host);
    const report = host.querySelector("[data-sanitize-report]");
    expect(report).not.toBeNull();
    const text = report?.textContent ?? "";
    expect(text).toContain("JavaScript");
    expect(text).toContain("2 removed");
    expect(text).toContain("1 removed");
    expect(text).toContain("0 removed");
    expect(report?.querySelectorAll(".sanitize-report-class").length).toBe(4);
    expect(text).toContain("catalog /OpenAction");
    expect(text).toContain("JavaScript action removed");
    expect(text).toContain("page 3 annotation 1");
    const warnings = host.querySelectorAll("[data-sanitize-warning]");
    expect(warnings.length).toBe(1);
    expect(warnings[0]?.textContent).toContain("unexpected type");
    unmount();
  });

  it("disables the run button when none of the four classes is checked", () => {
    const { host, unmount } = mount({
      initialOptions: {
        javascript: false,
        launchActions: false,
        embeddedFiles: false,
        metadata: false,
      },
    });
    expect(runButton(host).disabled).toBe(true);
    unmount();
  });

  it("shows the error message when the run fails (never blank)", async () => {
    const { host, unmount } = mount({
      runSanitize: async (): Promise<{ error: string }> => ({
        error: "Nothing to do.",
      }),
    });
    await clickRun(host);
    const error = host.querySelector("[data-sanitize-error]");
    expect(error).not.toBeNull();
    expect(error?.textContent).toContain("Nothing to do.");
    expect(host.querySelector("[data-sanitize-report]")).toBeNull();
    expect(runButton(host).disabled).toBe(false);
    unmount();
  });
});
