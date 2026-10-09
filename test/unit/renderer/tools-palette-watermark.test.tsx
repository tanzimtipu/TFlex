// @vitest-environment jsdom
//
// Phase 18 — tools-palette: the Watermark entry (text or image
// overlay). Mirrors the fail-loud contract of the other host-gated
// entries (flatten, stamp, ...): the entry renders ONLY when the
// host wired `onWatermark` (an entry with no action would be a
// click that does nothing), sits in the DOCUMENT group, carries the
// icon + title + description triplet in both list and grid layouts,
// is enabled only with a document open, and clicking it fires the
// host callback exactly once.
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ToolsPalette } from "../../../src/renderer/components/ToolsPalette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountPalette(args: {
  wireWatermark?: boolean;
  documentRequired?: boolean;
  layout?: "list" | "grid";
  onWatermark?: () => void;
}): { host: HTMLElement; onWatermark: ReturnType<typeof vi.fn> } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onWatermark = vi.fn(args.onWatermark ?? ((): void => undefined));
  act((): void => {
    root.render(
      <ToolsPalette
        layout={args.layout ?? "list"}
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
        onStamp={(): void => undefined}
        {...(args.wireWatermark === true ? { onWatermark } : {})}
        hasOcrSuspects={false}
        documentRequired={args.documentRequired ?? true}
        hasFormFields={false}
      />,
    );
  });
  return { host, onWatermark };
}

describe("Phase 18 — tools-palette watermark entry", () => {
  it("renders only when the host wires onWatermark (fail loud: no dead entry)", () => {
    const without = mountPalette({});
    expect(without.host.querySelector('[data-tool-id="watermark"]')).toBeNull();
    without.host.remove();

    const withHandler = mountPalette({ wireWatermark: true });
    expect(withHandler.host.querySelector('[data-tool-id="watermark"]')).not.toBeNull();
    withHandler.host.remove();
  });

  it("lives in the DOCUMENT group, after Stamp", () => {
    const { host } = mountPalette({ wireWatermark: true });
    const group = host.querySelector<HTMLElement>('[data-tools-group="document"]');
    expect(group).not.toBeNull();
    const order = [...(group?.querySelectorAll("[data-tool-id]") ?? [])].map((el) =>
      el.getAttribute("data-tool-id") ?? "",
    );
    expect(order).toContain("watermark");
    expect(order.indexOf("watermark")).toBeGreaterThan(order.indexOf("stamp"));
    host.remove();
  });

  it("carries the icon + title + description triplet in the list layout", () => {
    const { host } = mountPalette({ wireWatermark: true, layout: "list" });
    const entry = host.querySelector<HTMLElement>('[data-tool-id="watermark"]');
    expect(entry).not.toBeNull();
    expect(entry?.querySelector(".tools-palette-entry-icon svg")).not.toBeNull();
    const label = entry?.querySelector(".tools-palette-entry-label");
    const desc = entry?.querySelector(".tools-palette-entry-desc");
    expect(label?.textContent).toBe("Watermark");
    expect((desc?.textContent ?? "").length).toBeGreaterThan(0);
    host.remove();
  });

  it("carries the icon + title + description triplet in the grid layout too", () => {
    const { host } = mountPalette({ wireWatermark: true, layout: "grid" });
    const entry = host.querySelector<HTMLElement>('[data-tool-id="watermark"]');
    expect(entry).not.toBeNull();
    expect(entry?.querySelector(".tools-palette-entry-icon svg")).not.toBeNull();
    expect(entry?.querySelector(".tools-palette-entry-label")).not.toBeNull();
    expect((entry?.querySelector(".tools-palette-entry-desc")?.textContent ?? "").length).toBeGreaterThan(0);
    host.remove();
  });

  it("is enabled with a document open; clicking fires onWatermark once", () => {
    const { host, onWatermark } = mountPalette({ wireWatermark: true, documentRequired: true });
    const entry = host.querySelector<HTMLButtonElement>('[data-tool-id="watermark"]');
    expect(entry).not.toBeNull();
    expect(entry?.disabled).toBe(false);
    act((): void => {
      entry?.click();
    });
    expect(onWatermark).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it("is disabled without a document open (and the click fires nothing)", () => {
    const { host, onWatermark } = mountPalette({ wireWatermark: true, documentRequired: false });
    const entry = host.querySelector<HTMLButtonElement>('[data-tool-id="watermark"]');
    expect(entry).not.toBeNull();
    expect(entry?.disabled).toBe(true);
    act((): void => {
      entry?.click();
    });
    expect(onWatermark).not.toHaveBeenCalled();
    host.remove();
  });
});