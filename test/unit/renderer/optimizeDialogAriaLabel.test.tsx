// @vitest-environment jsdom
//
// DEF-073 — Optimize dialog aria-label must match the broad
// "Optimization preset" wording shared with the dialog semantics.
//
// The defect: the dialog's preset selector used `<legend>Compression
// preset</legend>` with no `aria-label` on the fieldset / radios, so
// the e2e selector `select[aria-label="Optimization preset"]` could
// not find it and the test reported "Optimize preset selector not
// found in dialog".
//
// The fix: rename the legend to "Optimization preset", add
// `role="radiogroup"` and `aria-label="Optimization preset"` on the
// fieldset, and surface per-radio `aria-label` strings so the radio
// inputs are individually addressable for screen-reader users. The
// broad "Optimization preset" wording matches the wire contract's
// `optimizePreset` field name and the AppSettings key.
//
// These tests pin the contract:
//   1. The fieldset declares `role="radiogroup"` and
//      `aria-label="Optimization preset"`.
//   2. The legend text reads "Optimization preset".
//   3. Every radio input has an `aria-label`.
//   4. The preset name attribute `optimize-preset` is preserved so
//      keyboard navigation / Playwright selectors that target the
//      group via `input[name="optimize-preset"]` keep working.
//   5. The legend / aria-label wording is consistent with the
//      SaveAsDialog's analogous `Web optimisation` legend (both
//      use a fieldset+legend shared-dialog semantic; the broad
//      "Optimization preset" matches the shared settings key).

import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OptimizeDialog } from "../../../src/renderer/components/OptimizeDialog";
import type { OptimizePreset } from "../../../src/shared/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface RenderHandle {
  root: Root;
  container: HTMLElement;
  cleanup: () => void;
}

function renderDialog(initialPreset: OptimizePreset): RenderHandle {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <OptimizeDialog
        open={true}
        initialPreset={initialPreset}
        originalBytes={1024 * 200}
        runOptimize={async (): Promise<{ bytes: ArrayBuffer; size: number }> => ({
          bytes: new ArrayBuffer(0),
          size: 0,
        })}
        onConfirm={(): void => undefined}
        onClose={(): void => undefined}
      />,
    );
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

describe("OptimizeDialog — DEF-073 aria-label matches 'Optimization preset'", () => {
  it("fieldset has role=radiogroup and aria-label='Optimization preset'", () => {
    const { container, cleanup } = renderDialog("none");
    const fieldset = container.querySelector<HTMLFieldSetElement>("fieldset.optimize-preset");
    expect(fieldset).not.toBeNull();
    if (fieldset === null) return cleanup();
    expect(fieldset.getAttribute("role")).toBe("radiogroup");
    expect(fieldset.getAttribute("aria-label")).toBe("Optimization preset");
    cleanup();
  });

  it("legend text reads 'Optimization preset' (the broad wording)", () => {
    const { container, cleanup } = renderDialog("none");
    const legend = container.querySelector<HTMLLegendElement>("fieldset.optimize-preset legend");
    expect(legend).not.toBeNull();
    if (legend === null) return cleanup();
    expect(legend.textContent).toBe("Optimization preset");
    cleanup();
  });

  it("every preset radio has an aria-label so the group is screen-reader friendly", () => {
    const { container, cleanup } = renderDialog("compact");
    const radios = container.querySelectorAll<HTMLInputElement>(
      'input[name="optimize-preset"]',
    );
    expect(radios.length).toBe(3);
    for (const r of Array.from(radios)) {
      const aria = r.getAttribute("aria-label");
      expect(aria).not.toBeNull();
      expect((aria ?? "").length).toBeGreaterThan(0);
    }
    cleanup();
  });

  it("the radio group's name='optimize-preset' is preserved (DEF-073 selector compatibility)", () => {
    // The pre-fix dialog used `name="optimize-preset"` already, but
    // a future rename to "optimization-preset" would silently break
    // Playwright's `input[name="optimize-preset"]` selector. Pin
    // the contract.
    const { container, cleanup } = renderDialog("none");
    const radios = container.querySelectorAll<HTMLInputElement>(
      'input[name="optimize-preset"]',
    );
    expect(radios.length).toBe(3);
    cleanup();
  });

  it("the fieldset's aria-label and the legend text agree (no shared-dialog-semantic mismatch)", () => {
    // The shared dialog semantic is the fieldset+legend pair. Both
    // must carry the same wording — the fieldset's aria-label is
    // what programmatic readers pick up, the legend is the visual
    // label. A mismatch between them surfaces as a defect (one
    // says "Compression preset", the other "Optimization preset").
    const { container, cleanup } = renderDialog("max");
    const fieldset = container.querySelector<HTMLFieldSetElement>("fieldset.optimize-preset");
    const legend = container.querySelector<HTMLLegendElement>("fieldset.optimize-preset legend");
    expect(fieldset).not.toBeNull();
    expect(legend).not.toBeNull();
    if (fieldset === null || legend === null) return cleanup();
    expect(fieldset.getAttribute("aria-label")).toBe(legend.textContent);
    cleanup();
  });
});