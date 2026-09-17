// @vitest-environment jsdom
//
// Phase 18 — WatermarkDialog renderer completion: the Underline
// typography control and the applied-watermarks list (DEF-216
// renderer half). The host calls `engine.getWatermarks` when the
// dialog opens and `engine.deleteWatermark` on each row's Delete
// click; the dialog only surfaces both through props.
//
//   1. Ticking Underline and confirming sends `underline: true` in
//      the WatermarkSettings payload alongside the typed text.
//   2. A non-empty `watermarks` prop renders one row per applied
//      watermark — text records show their text, image records show
//      'Image' — with a Delete button per row.
//   3. Clicking a row's Delete button fires `onDeleteWatermark`
//      with that record's id, exactly once.
//   4. DEF-219: a `busyWatermarkId` disables only that row's Delete.
//   5. DEF-217 (dialog half): a size outside the dialog's 4..2000
//      bounds is rejected in-dialog without calling `onConfirm`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { WatermarkDialog } from "../../../src/renderer/components/WatermarkDialog";
import type { WatermarkInfo, WatermarkSettings } from "../../../src/shared/types";

interface Mount {
  host: HTMLElement;
  unmount: () => void;
  onConfirm: ReturnType<typeof vi.fn>;
  onDeleteWatermark: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
}

const APPLIED: WatermarkInfo[] = [
  { id: "wm-1", type: "text", text: "CONFIDENTIAL", pages: [1, 2] },
  { id: "wm-2", type: "image", text: "", pages: [3] },
];

function mountDialog(args: {
  watermarks?: WatermarkInfo[];
  busyWatermarkId?: string | null;
}): Mount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onConfirm = vi.fn((): void => undefined);
  const onDeleteWatermark = vi.fn((): void => undefined);
  const onClose = vi.fn((): void => undefined);
  act((): void => {
    root.render(
      <WatermarkDialog
        open
        totalPages={5}
        currentPage={1}
        onConfirm={onConfirm}
        onClose={onClose}
        watermarks={args.watermarks ?? []}
        busyWatermarkId={args.busyWatermarkId ?? null}
        onDeleteWatermark={onDeleteWatermark}
      />,
    );
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
    onConfirm,
    onDeleteWatermark,
    onClose,
  };
}

/** Drive a React controlled <input type="text"> the way a user's
 *  keystrokes do: set the value through the NATIVE setter (React's
 *  controlled-value trap otherwise resets the node) and bubble an
 *  `input` event so React sees the change. */
function typeText(host: HTMLElement, selector: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(selector);
  expect(input).not.toBeNull();
  if (input === null) return;
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  expect(setValue).toBeTypeOf("function");
  act((): void => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Phase 18 — WatermarkDialog underline + applied watermarks", () => {
  it("confirm sends the typed text with underline true when the box is ticked", () => {
    const m = mountDialog({ watermarks: [] });
    typeText(m.host, "[data-watermark-text]", "CONFIDENTIAL");
    const underline = m.host.querySelector<HTMLInputElement>("[data-watermark-underline]");
    expect(underline).not.toBeNull();
    act((): void => {
      underline?.click();
    });
    expect(underline?.checked).toBe(true);
    const confirm = m.host.querySelector<HTMLButtonElement>("[data-watermark-confirm]");
    expect(confirm).not.toBeNull();
    act((): void => {
      confirm?.click();
    });
    expect(m.onConfirm).toHaveBeenCalledTimes(1);
    const settings = m.onConfirm.mock.calls[0]?.[0] as WatermarkSettings;
    expect(settings.text).toBe("CONFIDENTIAL");
    expect(settings.underline).toBe(true);
    m.unmount();
  });

  it("renders one row per applied watermark (text shows text, image shows 'Image'), each with a delete button", () => {
    const m = mountDialog({ watermarks: APPLIED });
    const row1 = m.host.querySelector('[data-watermark-applied="wm-1"]');
    const row2 = m.host.querySelector('[data-watermark-applied="wm-2"]');
    expect(row1).not.toBeNull();
    expect(row2).not.toBeNull();
    expect(row1?.textContent).toContain("wm-1");
    expect(row1?.textContent).toContain("CONFIDENTIAL");
    expect(row1?.textContent).toContain("Pages 1, 2");
    expect(row2?.textContent).toContain("wm-2");
    expect(row2?.textContent).toContain("Image");
    expect(row2?.textContent).toContain("Pages 3");
    expect(row1?.querySelector('[data-watermark-delete="wm-1"]')).not.toBeNull();
    expect(row2?.querySelector('[data-watermark-delete="wm-2"]')).not.toBeNull();
    m.unmount();
  });

  it("clicking a row's Delete fires onDeleteWatermark with that id, exactly once", () => {
    const m = mountDialog({ watermarks: APPLIED });
    const del = m.host.querySelector<HTMLButtonElement>('[data-watermark-delete="wm-1"]');
    expect(del).not.toBeNull();
    act((): void => {
      del?.click();
    });
    expect(m.onDeleteWatermark).toHaveBeenCalledTimes(1);
    expect(m.onDeleteWatermark).toHaveBeenCalledWith("wm-1");
    m.unmount();
  });

  it("rejects size 2001 with the in-dialog error and does not call onConfirm", () => {
    const m = mountDialog({ watermarks: [] });
    typeText(m.host, "[data-watermark-size]", "2001");
    const confirm = m.host.querySelector<HTMLButtonElement>("[data-watermark-confirm]");
    expect(confirm).not.toBeNull();
    act((): void => {
      confirm?.click();
    });
    expect(m.onConfirm).not.toHaveBeenCalled();
    expect(m.host.querySelector('[role="alert"]')?.textContent).toContain(
      "The watermark size must be between 4 and 2000 points.",
    );
    m.unmount();
  });

  it("rejects size 0 with the in-dialog error and does not call onConfirm", () => {
    const m = mountDialog({ watermarks: [] });
    typeText(m.host, "[data-watermark-size]", "0");
    const confirm = m.host.querySelector<HTMLButtonElement>("[data-watermark-confirm]");
    expect(confirm).not.toBeNull();
    act((): void => {
      confirm?.click();
    });
    expect(m.onConfirm).not.toHaveBeenCalled();
    expect(m.host.querySelector('[role="alert"]')?.textContent).toContain(
      "The watermark size must be between 4 and 2000 points.",
    );
    m.unmount();
  });

  it("disables only the busy row's Delete button while a delete is in flight", () => {
    const m = mountDialog({ watermarks: APPLIED, busyWatermarkId: "wm-1" });
    const busy = m.host.querySelector<HTMLButtonElement>('[data-watermark-delete="wm-1"]');
    const idle = m.host.querySelector<HTMLButtonElement>('[data-watermark-delete="wm-2"]');
    expect(busy).not.toBeNull();
    expect(idle).not.toBeNull();
    expect(busy?.disabled).toBe(true);
    expect(busy?.getAttribute("aria-busy")).toBe("true");
    expect(idle?.disabled).toBe(false);
    m.unmount();
  });

  // DEF-219 (residual) structure pin: the scoped layout rules in
  // styles.css hang off the `data-watermark-dialog` hook on the dialog
  // root, and every applied row must live inside the internal
  // `.watermark-applied-list` scroll area. Layout proof is the
  // adv041_layout.cjs harness; this only pins the DOM contract.
  it("roots the dialog at the [data-watermark-dialog] hook and nests applied rows in .watermark-applied-list", () => {
    const m = mountDialog({ watermarks: APPLIED });
    const root = m.host.querySelector("[data-watermark-dialog]");
    expect(root).not.toBeNull();
    const list = root?.querySelector(".watermark-applied-list");
    expect(list).not.toBeNull();
    const rows = list?.querySelectorAll("[data-watermark-applied]") ?? [];
    expect(rows.length).toBe(APPLIED.length);
    expect(rows[0]?.getAttribute("data-watermark-applied")).toBe("wm-1");
    expect(rows[1]?.getAttribute("data-watermark-applied")).toBe("wm-2");
    m.unmount();
  });
});