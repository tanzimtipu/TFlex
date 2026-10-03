// @vitest-environment jsdom
//
// Phase 90 (TFL-509-B) — BatesDialog explicit placement, graphical preview
// and update mode.
//
// The dialog gains an optional explicit X/Y placement (checkbox + two number
// inputs) that disables the 3x3 grid and sends `settings.x`/`settings.y`, a
// page-shaped preview that places the composed label at the slot or the
// explicit coordinates, and an update mode seeded from an applied run
// (`editTarget`) that emits its id as the second `onConfirm` argument. These
// tests pin that behaviour and the existing apply-mode defaults.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  BatesDialog,
  parseBatesCoord,
  type BatesConfirmOutcome,
} from "../../../src/renderer/components/BatesDialog";
import { MAX_BATES_COORD } from "../../../src/shared/bates";
import type {
  BatesDefaults,
  BatesInfo,
  BatesSettings,
  EditFont,
} from "../../../src/shared/types";

const DEFAULTS: BatesDefaults = {
  prefix: "ABC",
  suffix: "",
  startNumber: 1,
  padding: 6,
  position: "bottom-right",
};

const PREVIEW_FRAME_W = 150;
const PT_TO_PREVIEW_PX = PREVIEW_FRAME_W / 612;

interface Mount {
  host: HTMLElement;
  unmount: () => void;
  onConfirm: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
}

function mountDialog(args: {
  confirm?: (
    settings: BatesSettings,
    editId?: string,
  ) => BatesConfirmOutcome | Promise<BatesConfirmOutcome>;
  totalPages?: number;
  currentPage?: number;
  initialDefaults?: BatesDefaults;
  defaultFont?: EditFont;
  busy?: boolean;
  editTarget?: BatesInfo;
}): Mount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onConfirm = vi.fn(
    args.confirm ?? ((): BatesConfirmOutcome => ({ stamped: [1], labels: ["ABC000001"] })),
  );
  const onClose = vi.fn((): void => undefined);
  act((): void => {
    root.render(
      <BatesDialog
        open
        totalPages={args.totalPages ?? 5}
        currentPage={args.currentPage ?? 2}
        initialDefaults={args.initialDefaults ?? DEFAULTS}
        defaultFont={args.defaultFont}
        editTarget={args.editTarget}
        onConfirm={onConfirm}
        onClose={onClose}
        busy={args.busy ?? false}
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
    onClose,
  };
}

function typeInto(host: HTMLElement, selector: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(selector);
  expect(input).not.toBeNull();
  if (input === null) return;
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  act((): void => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickApply(host: HTMLElement): Promise<void> {
  const apply = host.querySelector<HTMLButtonElement>("[data-bates-apply]");
  expect(apply).not.toBeNull();
  await act(async (): Promise<void> => {
    apply?.click();
  });
}

function toggleCustomXY(host: HTMLElement): void {
  const box = host.querySelector<HTMLInputElement>("[data-bates-custom-xy]");
  expect(box).not.toBeNull();
  act((): void => {
    box?.click();
  });
}

const EDIT_TARGET: BatesInfo = {
  id: "bates-1",
  prefix: "DOC",
  suffix: "-Z",
  startNumber: 3,
  padding: 4,
  position: "top-left",
  x: 100,
  y: 200,
  size: 10,
  pages: [1, 2],
  labels: ["DOC0003-Z", "DOC0004-Z"],
};

describe("Phase 90 — BatesDialog custom X/Y placement", () => {
  it("sends settings.x/settings.y when custom placement is ticked (0,0)", async () => {
    const m = mountDialog({});
    toggleCustomXY(m.host);
    typeInto(m.host, "[data-bates-x]", "0");
    typeInto(m.host, "[data-bates-y]", "0");
    await clickApply(m.host);
    expect(m.onConfirm).toHaveBeenCalledTimes(1);
    const settings = m.onConfirm.mock.calls[0]?.[0] as BatesSettings;
    expect(settings.x).toBe(0);
    expect(settings.y).toBe(0);
    m.unmount();
  });

  it("passes a gutter placement (20,400) straight through", async () => {
    const m = mountDialog({});
    toggleCustomXY(m.host);
    typeInto(m.host, "[data-bates-x]", "20");
    typeInto(m.host, "[data-bates-y]", "400");
    await clickApply(m.host);
    const settings = m.onConfirm.mock.calls[0]?.[0] as BatesSettings;
    expect(settings.x).toBe(20);
    expect(settings.y).toBe(400);
    m.unmount();
  });

  it("refuses an out-of-bounds X and reports the readable error", async () => {
    const m = mountDialog({});
    toggleCustomXY(m.host);
    typeInto(m.host, "[data-bates-x]", "-5");
    typeInto(m.host, "[data-bates-y]", "10");
    await clickApply(m.host);
    expect(m.onConfirm).not.toHaveBeenCalled();
    const report = m.host.querySelector("[data-bates-report]")?.textContent ?? "";
    expect(report).toContain(
      `The custom X and Y must be numbers between 0 and ${MAX_BATES_COORD} points.`,
    );
    m.unmount();
  });

  it("disables the 3x3 grid while custom placement is ticked", () => {
    const m = mountDialog({});
    const topLeft = m.host.querySelector<HTMLButtonElement>('[data-bates-position="top-left"]');
    expect(topLeft?.disabled).toBe(false);
    toggleCustomXY(m.host);
    const topLeftAfter = m.host.querySelector<HTMLButtonElement>(
      '[data-bates-position="top-left"]',
    );
    expect(topLeftAfter?.disabled).toBe(true);
    expect(topLeftAfter?.title).toBe(
      "Disabled while Custom position (X, Y) is ticked",
    );
    const x = m.host.querySelector<HTMLInputElement>("[data-bates-x]");
    expect(x?.disabled).toBe(false);
    m.unmount();
  });

  it("parses coordinates and rejects blank/invalid input", () => {
    expect(parseBatesCoord("")).toBeNull();
    expect(parseBatesCoord("   ")).toBeNull();
    expect(parseBatesCoord("nope")).toBeNull();
    expect(parseBatesCoord("-5")).toBeNull();
    expect(parseBatesCoord(String(MAX_BATES_COORD + 1))).toBeNull();
    expect(parseBatesCoord("0")).toBe(0);
    expect(parseBatesCoord(" 400 ")).toBe(400);
  });
});

describe("Phase 90 — BatesDialog graphical preview placement", () => {
  it("places the preview at the explicit coordinates when ticked", () => {
    const m = mountDialog({});
    toggleCustomXY(m.host);
    typeInto(m.host, "[data-bates-x]", "100");
    typeInto(m.host, "[data-bates-y]", "200");
    const span = m.host.querySelector<HTMLElement>("[data-bates-preview]");
    expect(span).not.toBeNull();
    expect(parseFloat(span?.style.left ?? "")).toBeCloseTo(100 * PT_TO_PREVIEW_PX, 6);
    expect(parseFloat(span?.style.top ?? "")).toBeCloseTo(200 * PT_TO_PREVIEW_PX, 6);
    m.unmount();
  });

  it("falls back to the slot placement in grid mode", () => {
    const m = mountDialog({});
    const span = m.host.querySelector<HTMLElement>("[data-bates-preview]");
    expect(span?.style.left).toBe("");
    expect(span?.style.bottom).toBe("8%");
    m.unmount();
  });

  it("still renders the series range hint", () => {
    const m = mountDialog({ totalPages: 5, currentPage: 2 });
    const range = m.host.querySelector("[data-bates-preview-range]")?.textContent ?? "";
    expect(range).toContain("First: ABC000001");
    expect(range).toContain("Last: ABC000005");
    m.unmount();
  });
});

describe("Phase 90 — BatesDialog update mode", () => {
  it("defaults to apply mode with no edit target", async () => {
    const m = mountDialog({});
    expect(m.host.querySelector('[data-bates-mode="apply"]')).not.toBeNull();
    const apply = m.host.querySelector<HTMLButtonElement>("[data-bates-apply]");
    expect(apply?.textContent).toContain("Apply numbering");
    await clickApply(m.host);
    expect(m.onConfirm).toHaveBeenCalledTimes(1);
    expect(m.onConfirm.mock.calls[0]?.[1]).toBeUndefined();
    m.unmount();
  });

  it("seeds from editTarget, labels the update, and emits its id", async () => {
    const m = mountDialog({ editTarget: EDIT_TARGET });
    expect(m.host.querySelector('[data-bates-mode="update"]')).not.toBeNull();
    const apply = m.host.querySelector<HTMLButtonElement>("[data-bates-apply]");
    expect(apply?.textContent).toContain("Update numbering");

    const prefix = m.host.querySelector<HTMLInputElement>("[data-bates-prefix]");
    const suffix = m.host.querySelector<HTMLInputElement>("[data-bates-suffix]");
    const start = m.host.querySelector<HTMLInputElement>("[data-bates-start]");
    const padding = m.host.querySelector<HTMLInputElement>("[data-bates-padding]");
    expect(prefix?.value).toBe("DOC");
    expect(suffix?.value).toBe("-Z");
    expect(start?.value).toBe("3");
    expect(padding?.value).toBe("4");

    const box = m.host.querySelector<HTMLInputElement>("[data-bates-custom-xy]");
    expect(box?.checked).toBe(true);
    expect(m.host.querySelector<HTMLInputElement>("[data-bates-x]")?.value).toBe("100");
    expect(m.host.querySelector<HTMLInputElement>("[data-bates-y]")?.value).toBe("200");

    await clickApply(m.host);
    expect(m.onConfirm).toHaveBeenCalledTimes(1);
    const settings = m.onConfirm.mock.calls[0]?.[0] as BatesSettings;
    expect(settings.x).toBe(100);
    expect(settings.y).toBe(200);
    expect(settings.pages).toEqual(EDIT_TARGET.pages);
    expect(settings.pages).not.toEqual([1, 2, 3, 4, 5]);
    expect(m.onConfirm.mock.calls[0]?.[1]).toBe("bates-1");
    m.unmount();
  });

  it("seeds grid mode when the edit target has no finite coords", () => {
    const m = mountDialog({
      editTarget: { ...EDIT_TARGET, x: undefined, y: undefined },
    });
    const box = m.host.querySelector<HTMLInputElement>("[data-bates-custom-xy]");
    expect(box?.checked).toBe(false);
    const topLeft = m.host.querySelector<HTMLButtonElement>(
      '[data-bates-position="top-left"]',
    );
    expect(topLeft?.disabled).toBe(false);
    m.unmount();
  });
});