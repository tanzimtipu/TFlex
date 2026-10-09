// @vitest-environment jsdom
//
// Phase 14 — the Tools palette is NEVER icon-only: the grid layout
// renders the full icon + title + description triplet as two-column
// cards (the list layout already did). Mirrors the list-mode contract
// in toolsPaletteOrganization.test.tsx for the grid mode.
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ToolsPalette } from "../../../src/renderer/components/ToolsPalette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountGridPalette(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <ToolsPalette
        layout="grid"
        onLayoutChange={(): void => undefined}
        onMerge={(): void => undefined}
        onSplit={(): void => undefined}
        onExtract={(): void => undefined}
        onRotate={(): void => undefined}
        onDelete={(): void => undefined}
        onSign={(): void => undefined}
        onOptimize={(): void => undefined}
        onAudit={(): void => undefined}
        onClose={(): void => undefined}
        onRecognizeText={(): void => undefined}
        onBatchOcr={(): void => undefined}
        onOcrSuspects={(): void => undefined}
        hasOcrSuspects={false}
        documentRequired={true}
        hasFormFields={true}
      />,
    );
  });
  return host;
}

describe("Phase 14 — tools palette grid shows icon + title + description", () => {
  it("every grid entry renders an icon, a title AND a description", () => {
    const host = mountGridPalette();
    const entries = [...host.querySelectorAll<HTMLElement>(".tools-palette-entry-grid")];
    expect(entries.length).toBeGreaterThanOrEqual(8);
    for (const entry of entries) {
      const id = entry.getAttribute("data-tool-id") ?? "";
      const icon = entry.querySelector(".tools-palette-entry-icon svg");
      const label = entry.querySelector(".tools-palette-entry-label");
      const desc = entry.querySelector(".tools-palette-entry-desc");
      expect(icon, `grid entry ${id} must render an icon`).not.toBeNull();
      expect(label, `grid entry ${id} must render a title`).not.toBeNull();
      expect(desc, `grid entry ${id} must render a description (never icon-only)`).not.toBeNull();
      if (label !== null) expect((label.textContent ?? "").trim().length).toBeGreaterThan(0);
      if (desc !== null) expect((desc.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
    host.remove();
  });

  it("the merge card matches the reference triplet exactly", () => {
    const host = mountGridPalette();
    const merge = host.querySelector<HTMLElement>('[data-tool-id="merge"]');
    expect(merge).not.toBeNull();
    expect(merge?.querySelector(".tools-palette-entry-label")?.textContent).toBe("Merge PDFs");
    expect(merge?.querySelector(".tools-palette-entry-desc")?.textContent).toBe(
      "Combine another PDF with the active document.",
    );
    host.remove();
  });

  it("grid entries stay enabled/disabled per the same gating as list entries", () => {
    const host = mountGridPalette();
    const merge = host.querySelector<HTMLButtonElement>('[data-tool-id="merge"]');
    const sign = host.querySelector<HTMLButtonElement>('[data-tool-id="sign"]');
    // documentRequired=true so merge is enabled; the OCR suspects
    // button is disabled because hasOcrSuspects is false.
    const suspects = host.querySelector<HTMLButtonElement>('[data-tool-id="ocrSuspects"]');
    expect(merge?.disabled).toBe(false);
    expect(sign?.disabled).toBe(false);
    expect(suspects?.disabled).toBe(true);
    host.remove();
  });
});
