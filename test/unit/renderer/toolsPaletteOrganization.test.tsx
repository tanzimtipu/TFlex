// @vitest-environment jsdom
//
// Tools palette organization (UI/UX redesign): the palette is
// grouped into four canonical sections in a fixed order —
// ORGANIZE PAGES (merge, split, extract, rotate, delete first),
// DOCUMENT (sign, forms, flatten, optimize, audit, ...), RECOGNITION
// and EXPORT — matching the redesign's screenshot. Each list entry is
// icon + bold title + description. The Flatten entry is a new
// DOCUMENT tool gated by hasFormFields and only rendered when the
// host wired onFlatten (fail loud: an entry with no action is a
// click that does nothing).
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ToolsPalette } from "../../../src/renderer/components/ToolsPalette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountPalette(args: {
  documentRequired?: boolean;
  hasFormFields?: boolean;
  /** When true, `onFlatten` is actually wired to the palette (the
   *  host passes it only then). */
  wireFlatten?: boolean;
  onFlatten?: () => void;
}): {
  host: HTMLElement;
  onFlatten: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onFlatten = vi.fn(args.onFlatten ?? ((): void => undefined));
  act((): void => {
    root.render(
      <ToolsPalette
        layout="list"
        onLayoutChange={(): void => undefined}
        onMerge={(): void => undefined}
        onSplit={(): void => undefined}
        onExtract={(): void => undefined}
        onRotate={(): void => undefined}
        onDelete={(): void => undefined}
        onSign={(): void => undefined}
        onForms={(): void => undefined}
        onOptimize={(): void => undefined}
        onAudit={(): void => undefined}
        onClose={(): void => undefined}
        {...(args.wireFlatten === true ? { onFlatten } : {})}
        // Wire every optional entry so every group renders: an empty
        // group is skipped entirely (that is correct UI behavior, but
        // the group-order assertions need all four sections).
        onRecognizeText={(): void => undefined}
        onBatchOcr={(): void => undefined}
        onOcrSuspects={(): void => undefined}
        onCreateFromImages={(): void => undefined}
        onExportPages={(): void => undefined}
        onExportText={(): void => undefined}
        onExportDocx={(): void => undefined}
        onInsertPages={(): void => undefined}
        onReplacePages={(): void => undefined}
        onRenumberPages={(): void => undefined}
        onCropPages={(): void => undefined}
        onStamp={(): void => undefined}
        onExportComments={(): void => undefined}
        onImportComments={(): void => undefined}
        hasOcrSuspects={false}
        documentRequired={args.documentRequired ?? true}
        hasFormFields={args.hasFormFields ?? true}
      />,
    );
  });
  return { host, onFlatten };
}

const entryOrderInGroup = (host: HTMLElement, groupId: string): string[] => {
  const group = host.querySelector<HTMLElement>(`[data-tools-group="${groupId}"]`);
  if (group === null) throw new Error(`group ${groupId} not found`);
  return [...group.querySelectorAll("[data-tool-id]")].map((el) => el.getAttribute("data-tool-id") ?? "");
};

describe("Tools palette organization (UI/UX redesign)", () => {
  it("groups render in the canonical order: Organize Pages, Document, Recognition, Export", () => {
    const { host } = mountPalette({});
    const groups = [...host.querySelectorAll("[data-tools-group]")].map((el) =>
      el.getAttribute("data-tools-group"),
    );
    expect(groups).toEqual(["organize", "document", "recognition", "export"]);
  });

  it("ORGANIZE PAGES leads with Merge / Split / Extract / Rotate / Delete", () => {
    const { host } = mountPalette({});
    const order = entryOrderInGroup(host, "organize");
    expect(order.slice(0, 5)).toEqual(["merge", "split", "extract", "rotate", "delete"]);
  });

  it("DOCUMENT orders Sign / Forms / Flatten / Reduce file size / Optimize positions", () => {
    const { host } = mountPalette({ wireFlatten: true });
    const order = entryOrderInGroup(host, "document");
    // The redesign screenshot's DOCUMENT ladder: sign, forms,
    // flatten, reduce-file-size (optimize), optimize (audit).
    expect(order.indexOf("sign")).toBeLessThan(order.indexOf("forms"));
    expect(order.indexOf("forms")).toBeLessThan(order.indexOf("flatten"));
    expect(order.indexOf("flatten")).toBeLessThan(order.indexOf("optimize"));
    expect(order.indexOf("optimize")).toBeLessThan(order.indexOf("audit"));
  });

  it("each list entry carries an icon, a bold title and a description", () => {
    const { host } = mountPalette({ wireFlatten: true });
    const entries = [...host.querySelectorAll<HTMLElement>(".tools-palette-entry-list")];
    // At least the five canonical ORGANIZE entries + the OCR trio exist.
    expect(entries.length).toBeGreaterThanOrEqual(8);
    for (const entry of entries) {
      const icon = entry.querySelector(".tools-palette-entry-icon svg");
      const label = entry.querySelector(".tools-palette-entry-label");
      const desc = entry.querySelector(".tools-palette-entry-desc");
      expect(icon, `entry ${entry.getAttribute("data-tool-id")} must render an icon`).not.toBeNull();
      expect(label, `entry ${entry.getAttribute("data-tool-id")} must render a title`).not.toBeNull();
      expect(desc, `entry ${entry.getAttribute("data-tool-id")} must render a description`).not.toBeNull();
      if (label !== null) expect((label.textContent ?? "").trim().length).toBeGreaterThan(0);
      if (desc !== null) expect((desc.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("Flatten renders only when onFlatten is wired (fail loud: no dead entry)", () => {
    const without = mountPalette({});
    expect(without.host.querySelector('[data-tool-id="flatten"]')).toBeNull();
    without.host.remove();
    const withHandler = mountPalette({ wireFlatten: true });
    expect(withHandler.host.querySelector('[data-tool-id="flatten"]')).not.toBeNull();
  });

  it("Flatten is disabled without form fields and enabled with them; clicking fires onFlatten", () => {
    // No form fields -> disabled.
    const noFields = mountPalette({ wireFlatten: true, hasFormFields: false });
    const flattenDisabled = noFields.host.querySelector<HTMLButtonElement>('[data-tool-id="flatten"]');
    expect(flattenDisabled).not.toBeNull();
    expect(flattenDisabled?.disabled).toBe(true);
    act((): void => {
      flattenDisabled?.click();
    });
    expect(noFields.onFlatten).not.toHaveBeenCalled();
    noFields.host.remove();

    // Form fields present -> enabled and clickable.
    const withFields = mountPalette({ wireFlatten: true, hasFormFields: true });
    const flattenEnabled = withFields.host.querySelector<HTMLButtonElement>('[data-tool-id="flatten"]');
    expect(flattenEnabled?.disabled).toBe(false);
    act((): void => {
      flattenEnabled?.click();
    });
    expect(withFields.onFlatten).toHaveBeenCalledTimes(1);
  });
});