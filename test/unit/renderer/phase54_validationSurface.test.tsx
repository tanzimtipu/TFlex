// @vitest-environment jsdom
//
// Phase 54 (features D + E) — the validation surface.
//
// Covers: the live verb (registry + shared availability gate + App wiring),
// the dialog's chooser/report, the report card's three variants, the
// blocked/warned save bridge, the hardened "no conformance claim" wording rule,
// and the settings persistence of the remembered target + onViolation.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { ValidationNotice } from "../../../src/renderer/components/ValidationNotice";
import { ValidateDocumentDialog } from "../../../src/renderer/components/ValidateDocumentDialog";
import {
  blockedSaveMessage,
  effectiveValidationDefaults,
  isValidationReport,
  validationErrorText,
  validationFromSaveResult,
  withValidationDefaults,
  VALIDATION_TARGETS,
} from "../../../src/renderer/state/validation";
import {
  DOCK_AVAILABILITY_REASON,
  dockEnabledWithFallback,
} from "../../../src/renderer/state/dockModel";
import {
  dockToolsForStage,
  toolById,
} from "../../../src/renderer/state/toolsRegistry";
import {
  DEFAULT_PDF_VALIDATION_DEFAULTS,
  type AppSettings,
} from "../../../src/shared/types";
import type { ValidationReport } from "../../../src/shared/validation";

const CONFORMING: ValidationReport = {
  target: "pdfa-1b",
  standard: "pdfa",
  declared: "PDF/A-1b",
  conforms: true,
  violations: [],
};

const NONCONFORMING: ValidationReport = {
  target: "pdfx-1a",
  standard: "pdfx",
  declared: "PDF/X-1:2001",
  conforms: false,
  violations: [
    { rule: "pdfx.cmyk-only", detail: "Page 1 uses an RGB colour space.", severity: "error" },
    { rule: "pdfx.output-intent", detail: "The output intent could not be read.", severity: "warning" },
  ],
};

function mount(node: ReactElement): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(node);
  });
  return {
    host,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function click(host: HTMLElement, selector: string): void {
  const el = host.querySelector<HTMLElement>(selector);
  expect(el, selector).not.toBeNull();
  act((): void => {
    el?.click();
  });
}

function mountDialog(
  overrides: Partial<{
    initialTarget: "none" | (typeof VALIDATION_TARGETS)[number];
    initialOnViolation: "warn" | "block";
    runValidation: (target: (typeof VALIDATION_TARGETS)[number]) =>
      Promise<{ report: ValidationReport } | { error: string }>;
    onRememberDefaults: (d: { target: string; onViolation: string }) => void;
  }> = {},
) {
  const runValidation = vi.fn(
    overrides.runValidation ?? (async () => ({ report: CONFORMING })),
  );
  const onRememberDefaults = vi.fn(overrides.onRememberDefaults);
  const view = mount(
    createElement(ValidateDocumentDialog, {
      open: true,
      initialTarget: overrides.initialTarget ?? "pdfa-2b",
      initialOnViolation: overrides.initialOnViolation ?? "warn",
      runValidation,
      onRememberDefaults,
      onClose: (): void => undefined,
    }),
  );
  return { ...view, runValidation, onRememberDefaults };
}

/** Every rendered text node and labelling attribute, for the wording rule. */
function assertNoForbiddenWording(host: HTMLElement): void {
  const strings: string[] = [host.textContent ?? ""];
  for (const el of Array.from(host.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === "aria-label" || attr.name === "title" || attr.name === "placeholder") {
        strings.push(attr.value);
      }
    }
  }
  for (const text of strings) expect(text).not.toMatch(/certifi/i);
}

describe("phase 54 — the validate verb reaches a live surface", () => {
  it("registers as a REVIEW dock verb with the validation precondition", () => {
    const entry = toolById("validateDocument");
    expect(entry).toBeDefined();
    expect(entry?.availability).toBe("validation");
    expect(entry?.action).toBe("validateDocument");
    expect(entry?.stage).toBe("review");
    expect(entry?.label.trim().length).toBeGreaterThan(0);
    expect(entry?.description.trim().length).toBeGreaterThan(10);
    expect(dockToolsForStage("review").map((e) => e.id)).toContain("validateDocument");
  });

  it("is DISABLED until a document is open and the bridge exists", () => {
    const entry = toolById("validateDocument");
    if (entry === undefined) throw new Error("missing entry");
    const base = { pageSelectionCount: 0, editModeOpen: false, canUndo: false, canRedo: false, viewActions: {} };
    // The App gate: no document (or no bridge) reads false.
    expect(
      dockEnabledWithFallback(entry, { ...base, appEnabled: (id) => id === "validateDocument" && false }),
    ).toBe(false);
    // With a document AND the bridge it reads true.
    expect(
      dockEnabledWithFallback(entry, { ...base, appEnabled: (id) => id === "validateDocument" && true }),
    ).toBe(true);
    expect(DOCK_AVAILABILITY_REASON.validation.trim().length).toBeGreaterThan(0);
  });

  it("App wires the verb, the live gate and the dialog end to end", () => {
    const app = readFileSync(resolve(__dirname, "../../../src/renderer/App.tsx"), "utf8");
    // The handler reaches the dock + palette through the ONE shared map.
    expect(app).toMatch(/validateDocument: onValidateDocumentClick,/);
    // The bridge guard: an absent `window.tflex.validation` disables it.
    expect(app).toMatch(/hasValidationBridge/);
    expect(app).toMatch(/typeof window\.tflex\.validation\?\.validate === "function"/);
    expect(app).toMatch(/case "validation":\s*\n\s*return hasValidationBridge && dockHasDocument;/);
    // The run validates the ACTIVE document's engine id against the chosen target.
    expect(app).toMatch(/validation\.validate\(open\.session\.engineDocId, target\)/);
    // The dialog is mounted with the live handlers.
    expect(app).toMatch(/<ValidateDocumentDialog[\s\S]*?runValidation=\{runValidationForActiveTab\}/);
    expect(app).toMatch(/onRememberDefaults=\{onValidationDefaultsChange\}/);
  });
});

describe("phase 54 — the dialog chooser and report", () => {
  it("offers exactly the six targets plus the no-validation opt-out", () => {
    const { host, cleanup } = mountDialog();
    try {
      const values = Array.from(
        host.querySelectorAll<HTMLInputElement>("input[name='validation-target']"),
      ).map((i) => i.getAttribute("data-validation-target"));
      expect(values).toEqual([...VALIDATION_TARGETS, "none"]);
    } finally {
      cleanup();
    }
  });

  it("'No validation' never calls the validation bridge", async () => {
    const { host, runValidation, cleanup } = mountDialog();
    try {
      click(host, "[data-validation-target='none']");
      const run = host.querySelector<HTMLButtonElement>("[data-validation-run]");
      expect(run?.disabled).toBe(true);
      await act(async (): Promise<void> => {
        run?.click();
        await Promise.resolve();
      });
      expect(runValidation).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("runs the chosen target and renders a conforming report inline", async () => {
    const { host, runValidation, cleanup } = mountDialog({
      initialTarget: "pdfa-1b",
      runValidation: async () => ({ report: CONFORMING }),
    });
    try {
      await act(async (): Promise<void> => {
        host.querySelector<HTMLButtonElement>("[data-validation-run]")?.click();
        await Promise.resolve();
      });
      expect(runValidation).toHaveBeenCalledWith("pdfa-1b");
      const notice = host.querySelector("[data-validation-notice]");
      expect(notice).not.toBeNull();
      expect(notice?.getAttribute("data-validation-conforms")).toBe("true");
      expect(host.querySelector("[data-validation-declared-value]")?.textContent).toBe("PDF/A-1b");
      expect(host.querySelector("[data-validation-target-label]")?.textContent).toBe("PDF/A-1b");
      expect(host.querySelector("[data-validation-conforms-banner]")?.textContent).toBe(
        "Conforms to the checked target",
      );
      expect(host.querySelector('[role="alert"]')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("renders every finding of a non-conforming document as a SUCCESSFUL validation", async () => {
    const { host, cleanup } = mountDialog({
      initialTarget: "pdfx-1a",
      runValidation: async () => ({ report: NONCONFORMING }),
    });
    try {
      await act(async (): Promise<void> => {
        host.querySelector<HTMLButtonElement>("[data-validation-run]")?.click();
        await Promise.resolve();
      });
      expect(host.querySelector("[data-validation-conforms]")?.getAttribute("data-validation-conforms")).toBe("false");
      expect(host.querySelector("[data-validation-conforms-banner]")?.textContent).toBe(
        "Does not conform to the checked target",
      );
      const rules = Array.from(host.querySelectorAll("[data-validation-rule-name]")).map((n) => n.textContent);
      expect(rules).toContain("pdfx.cmyk-only");
      expect(rules).toContain("pdfx.output-intent");
      expect(host.textContent).toContain("Page 1 uses an RGB colour space.");
      expect(host.textContent).toContain("The output intent could not be read.");
      // A completed validation that found violations is NOT an error state.
      expect(host.querySelector('[role="alert"]')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("renders severity as distinct classes AND distinct copy, not colour alone", () => {
    const { host, cleanup } = mount(
      createElement(ValidationNotice, { notice: { report: NONCONFORMING, variant: "report" } }),
    );
    try {
      const error = host.querySelector('[data-validation-severity="error"]');
      const warning = host.querySelector('[data-validation-severity="warning"]');
      expect(error).not.toBeNull();
      expect(warning).not.toBeNull();
      expect(error?.className).toContain("validation-notice-violation--error");
      expect(warning?.className).toContain("validation-notice-violation--warning");
      expect(error?.className).not.toContain("--warning");
      expect(warning?.textContent).toContain("Could not be determined");
      expect(error?.textContent).not.toContain("Could not be determined");
    } finally {
      cleanup();
    }
  });

  it("spells out a null declaration instead of leaving a gap", () => {
    const declaredNone: ValidationReport = { ...CONFORMING, declared: null };
    const { host, cleanup } = mount(
      createElement(ValidationNotice, { notice: { report: declaredNone, variant: "report" } }),
    );
    try {
      expect(host.querySelector("[data-validation-declared-value]")?.textContent).toBe("none declared");
    } finally {
      cleanup();
    }
  });
});

describe("phase 54 — blocked and warned saves", () => {
  it("renders the blocked-save report, names the violation and says no file was written", () => {
    const { host, cleanup } = mount(
      createElement(ValidationNotice, { notice: { report: NONCONFORMING, variant: "blocked" } }),
    );
    try {
      expect(host.querySelector("[data-validation-variant]")?.getAttribute("data-validation-variant")).toBe("blocked");
      expect(host.textContent).toContain("Save blocked");
      expect(host.querySelector("[data-validation-blocked]")?.textContent).toBe("No file was written.");
      expect(host.querySelector("[data-validation-rule-name]")?.textContent).toBe("pdfx.cmyk-only");
      // Never the generic error path.
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(blockedSaveMessage(NONCONFORMING)).toContain("No file was written.");
      expect(blockedSaveMessage(NONCONFORMING)).toContain("PDF/X-1a");
    } finally {
      cleanup();
    }
  });

  it("renders the warned-save report as a non-blocking notice", () => {
    const { host, cleanup } = mount(
      createElement(ValidationNotice, { notice: { report: NONCONFORMING, variant: "warned" } }),
    );
    try {
      expect(host.querySelector("[data-validation-notice]")?.getAttribute("data-validation-variant")).toBe("warned");
      expect(host.querySelector("[data-validation-warned]")?.textContent).toContain("The file was written");
      expect(host.textContent).not.toContain("No file was written");
    } finally {
      cleanup();
    }
  });

  it("App reads the report off a save and routes blocked vs warned", () => {
    const app = readFileSync(resolve(__dirname, "../../../src/renderer/App.tsx"), "utf8");
    expect(app).toMatch(/validationFromSaveResult\(result\)/);
    expect(app).toMatch(/variant: "blocked"/);
    expect(app).toMatch(/variant: "warned"/);
    expect(app).toMatch(/notifyValidation|setValidationNotices/);
    expect(app).toMatch(/blockedSaveMessage\(blocked\)/);
  });
});

describe("phase 54 — the save-result bridge", () => {
  it("reads a validation field from either the ok or the error Result", () => {
    expect(
      validationFromSaveResult({ ok: false, error: { code: "engine-error", message: "blocked" }, validation: NONCONFORMING }),
    ).toEqual(NONCONFORMING);
    expect(validationFromSaveResult({ ok: true, value: "/tmp/a.pdf", validation: CONFORMING })).toEqual(CONFORMING);
  });

  it("reads null when the default 'none' path carries no report", () => {
    expect(validationFromSaveResult({ ok: true, value: "/tmp/a.pdf" })).toBeNull();
    expect(validationFromSaveResult({ ok: false, error: { code: "engine-error", message: "no" } })).toBeNull();
    expect(validationFromSaveResult(null)).toBeNull();
    expect(validationFromSaveResult({ ok: false, validation: { target: "nonsense" } })).toBeNull();
  });

  it("validates the report shape", () => {
    expect(isValidationReport(CONFORMING)).toBe(true);
    expect(isValidationReport({ ...CONFORMING, violations: [{ rule: "r" }] })).toBe(false);
    expect(isValidationReport({ ...CONFORMING, target: "pdfa-9" })).toBe(false);
  });
});

describe("phase 54 — settings persistence of the remembered choice", () => {
  it("writes target + onViolation through the shared settings object", () => {
    const settings = { theme: "dark" } as unknown as AppSettings;
    const next = withValidationDefaults(settings, { target: "pdfx-3", onViolation: "block" });
    expect(next.pdfValidationDefaults).toEqual({ target: "pdfx-3", onViolation: "block" });
    expect(next.theme).toBe("dark");
    // An unchanged choice returns the SAME reference (no redundant write).
    expect(withValidationDefaults(next, { target: "pdfx-3", onViolation: "block" })).toBe(next);
  });

  it("falls back to the shipped none/warn defaults", () => {
    expect(effectiveValidationDefaults(null)).toEqual(DEFAULT_PDF_VALIDATION_DEFAULTS);
    expect(effectiveValidationDefaults({} as AppSettings)).toEqual({ target: "none", onViolation: "warn" });
  });

  it("App persists through setSettings + trackAndSave", () => {
    const app = readFileSync(resolve(__dirname, "../../../src/renderer/App.tsx"), "utf8");
    expect(app).toMatch(/withValidationDefaults\(prev, defaults\)/);
    expect(app).toMatch(/if \(updated !== prev\) trackAndSave\(updated\);/);
  });

  it("the dialog persists the chosen target and onViolation when remembering", () => {
    const { host, onRememberDefaults, cleanup } = mountDialog({ initialTarget: "none" });
    try {
      click(host, "[data-validation-remember]");
      click(host, "[data-validation-target='pdfa-1b']");
      click(host, "[data-validation-on-violation='block']");
      expect(onRememberDefaults).toHaveBeenCalledWith({ target: "pdfa-1b", onViolation: "block" });
      cleanup();
    } catch (e) {
      cleanup();
      throw e;
    }
  });

  it("does not persist while remembering is off", () => {
    const { host, onRememberDefaults, cleanup } = mountDialog({ initialTarget: "none" });
    try {
      click(host, "[data-validation-target='pdfa-2b']");
      expect(onRememberDefaults).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});

describe("phase 54 — the wording rule (no conformance claim)", () => {
  it("no rendered string or label matches /certifi/i", () => {
    for (const variant of ["report", "blocked", "warned"] as const) {
      for (const report of [CONFORMING, NONCONFORMING, { ...CONFORMING, declared: null }]) {
        const { host, cleanup } = mount(
          createElement(ValidationNotice, { notice: { report, variant }, onDismiss: (): void => undefined }),
        );
        try {
          assertNoForbiddenWording(host);
        } finally {
          cleanup();
        }
      }
    }
    const dialog = mountDialog({ initialTarget: "pdfa-1b" });
    try {
      assertNoForbiddenWording(dialog.host);
    } finally {
      dialog.cleanup();
    }
  });

  it("the state module itself never spells the forbidden word", () => {
    const source = readFileSync(resolve(__dirname, "../../../src/renderer/state/validation.ts"), "utf8");
    expect(source).not.toMatch(/certifi/i);
    expect(validationErrorText("unknown-target")).not.toMatch(/certifi/i);
    expect(validationErrorText("unreadable-document")).not.toMatch(/certifi/i);
  });
});
