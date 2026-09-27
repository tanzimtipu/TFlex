// @vitest-environment jsdom
//
// Phase 45 — three operator-reported UI corrections:
//   item 4 (E): the EDIT dock highlight + "Edit mode off" as the leftmost verb;
//   item 5 (F): the thumbnail/Undo non-intersection geometry rule;
//   item 7 (H): the Watermark custom-position tick + applied coordinates.
//
// Item 4's no-false-highlight work is pinned two ways: the rendered dock (exactly
// the ARMED verb carries aria-pressed, and the LEAD verb no longer carries the
// selected accent wash) and the stylesheet (the lead rule is ink-only, the
// pressed rule keeps the wash + inset ring).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ActionDock,
  type ActionDockProps,
  type DockBulkActions,
} from "../../../src/renderer/components/ActionDock";
import {
  DOCK_STAGE_IDS,
  dockToolsForStage,
} from "../../../src/renderer/state/toolsRegistry";
import {
  WatermarkDialog,
  parseWatermarkCoord,
  MIN_WATERMARK_COORD,
  MAX_WATERMARK_COORD,
} from "../../../src/renderer/components/WatermarkDialog";
import type { WatermarkSettings } from "../../../src/shared/types";

const CSS = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** Extract a rule block by a selector regex, without comments. */
function cssBlock(selector: RegExp): string {
  const m = selector.exec(CSS_NO_COMMENTS);
  expect(m, `rule ${selector} not found`).not.toBeNull();
  return m?.[0] ?? "";
}

// ---------------------------------------------------------------------------
// Item 4 — the EDIT dock: order + no false highlight
// ---------------------------------------------------------------------------
describe("Phase 45 item 4 — the EDIT dock order and highlight", () => {
  it("lists 'Edit mode off' FIRST in the edit dock group and in DOCK_STAGE_IDS", () => {
    expect(dockToolsForStage("edit").map((e) => e.id)).toEqual([
      "editToolOff",
      "editText",
      "editImage",
      "editTextBox",
      "recognizeText",
      "batchOcr",
      "ocrSuspects",
    ]);
    expect(DOCK_STAGE_IDS.edit[0]).toBe("editToolOff");
  });

  function bulk(): DockBulkActions {
    return { onRotate: vi.fn(), onExtract: vi.fn(), onDelete: vi.fn() };
  }
  interface Sampled {
    id: string;
    pressed: boolean;
    primary: boolean;
  }
  function renderEditDock(activeToolIds: readonly string[]): {
    sampled: Sampled[];
    unmount: () => void;
  } {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const props: ActionDockProps = {
      activeStage: "edit",
      pageSelection: [],
      onClearPageSelection: vi.fn(),
      bulk: bulk(),
      dockPins: [],
      onPinTool: vi.fn(),
      onUnpinTool: vi.fn(),
      onRunTool: vi.fn(),
      canvasWidth: 1400,
      activeToolIds,
    };
    act((): void => {
      root.render(<ActionDock {...props} />);
    });
    const sampled: Sampled[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>("[data-action-dock] [data-dock-verb]"),
    ).map((el) => ({
      id: el.getAttribute("data-dock-verb") ?? "",
      pressed: el.getAttribute("aria-pressed") === "true",
      primary: el.classList.contains("action-dock-verb-primary"),
    }));
    return {
      sampled,
      unmount: (): void => {
        act((): void => root.unmount());
        host.remove();
      },
    };
  }

  it("with editToolOff armed, ONLY editToolOff is pressed and it is the lead verb", () => {
    const { sampled, unmount } = renderEditDock(["editToolOff"]);
    try {
      const pressed = sampled.filter((v) => v.pressed);
      expect(pressed.map((v) => v.id)).toEqual(["editToolOff"]);
      expect(sampled[0]?.id).toBe("editToolOff");
      expect(sampled[0]?.primary).toBe(true);
      expect(sampled.filter((v) => v.primary).map((v) => v.id)).toEqual([
        "editToolOff",
      ]);
    } finally {
      unmount();
    }
  });

  it("with editText armed, ONLY editText is pressed (editToolOff is the lead but not selected)", () => {
    const { sampled, unmount } = renderEditDock(["editText"]);
    try {
      const pressed = sampled.filter((v) => v.pressed);
      expect(pressed.map((v) => v.id)).toEqual(["editText"]);
      const off = sampled.find((v) => v.id === "editToolOff");
      expect(off?.pressed).toBe(false);
      // The lead verb is still first, but the lead class is not a selected state.
      expect(sampled[0]?.id).toBe("editToolOff");
      expect(off?.primary).toBe(true);
    } finally {
      unmount();
    }
  });

  it("the lead-verb class is ink-only and no longer carries the selected accent wash", () => {
    const primary = cssBlock(/\.action-dock-verb-primary\s*\{[^}]*\}/);
    expect(primary).toMatch(/background:\s*transparent/);
    expect(primary).toMatch(/color:\s*var\(--fg-strong\)/);
    expect(primary).not.toMatch(/--accent-soft/);
    expect(primary).not.toMatch(/--dock-primary-fg/);
  });

  it("the pressed/selected treatment still owns the accent wash + inset ring", () => {
    const pressed = cssBlock(
      /\.action-dock-verb\[aria-pressed='true'\]\s*:not\(:disabled\)\s*\{[^}]*\}/,
    );
    expect(pressed).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(pressed).toMatch(/box-shadow:\s*inset/);
  });
});

// ---------------------------------------------------------------------------
// Item 5 — the thumbnail/Undo non-intersection geometry rule
//
// jsdom cannot lay out flex boxes, so the rule that GUARANTEES the separation is
// pinned in the stylesheet: the Undo row is a non-shrinking, fixed band; the
// scroller below it owns all the vertical give; and the label can never wrap
// (the wrapped two-line label in the 150px Multi Mode strip was what reached
// down over the first thumbnail's preview).
// ---------------------------------------------------------------------------
describe("Phase 45 item 5 — the rail Undo row cannot reach the first thumbnail", () => {
  it("keeps the Undo row a non-shrinking band with a bottom gutter", () => {
    const actions = cssBlock(/\.rail-actions\s*\{[^}]*\}/);
    expect(actions).toMatch(/flex:\s*0 0 auto/);
    expect(actions).toMatch(/padding:\s*0 var\(--sp-2\) 8px/);
  });

  it("lets only the scroller below take the vertical give", () => {
    const inner = cssBlock(/\.thumb-scroller-inner\s*\{[^}]*\}/);
    expect(inner).toMatch(/flex:\s*1 1 auto/);
    expect(inner).toMatch(/min-height:\s*0/);
  });

  it("never lets the Undo label wrap or overflow its 24px control", () => {
    const btn = cssBlock(/\.rail-action-btn\s*\{[^}]*\}/);
    expect(btn).toMatch(/white-space:\s*nowrap/);
    expect(btn).toMatch(/overflow:\s*hidden/);
    const span = cssBlock(/\.rail-action-btn\s*>\s*span\s*\{[^}]*\}/);
    expect(span).toMatch(/text-overflow:\s*ellipsis/);
    expect(span).toMatch(/white-space:\s*nowrap/);
  });
});

// ---------------------------------------------------------------------------
// Item 7 — the Watermark custom-position tick and the applied coordinates
// ---------------------------------------------------------------------------
describe("Phase 45 item 7 — parseWatermarkCoord bounds", () => {
  it("accepts finite in-bounds points and rejects blank / NaN / out-of-range", () => {
    expect(parseWatermarkCoord("72")).toBe(72);
    expect(parseWatermarkCoord(" 0 ")).toBe(0);
    expect(parseWatermarkCoord(String(MAX_WATERMARK_COORD))).toBe(MAX_WATERMARK_COORD);
    expect(parseWatermarkCoord("")).toBeNull();
    expect(parseWatermarkCoord("   ")).toBeNull();
    expect(parseWatermarkCoord("abc")).toBeNull();
    expect(parseWatermarkCoord("-1")).toBeNull();
    expect(parseWatermarkCoord(String(MAX_WATERMARK_COORD + 1))).toBeNull();
    expect(parseWatermarkCoord("NaN")).toBeNull();
  });
});

interface WmMount {
  host: HTMLElement;
  onConfirm: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function mountWatermark(): WmMount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onConfirm = vi.fn((): void => undefined);
  act((): void => {
    root.render(
      <WatermarkDialog
        open
        totalPages={5}
        currentPage={1}
        onConfirm={onConfirm}
        onClose={vi.fn()}
        watermarks={[]}
        onDeleteWatermark={vi.fn()}
      />,
    );
  });
  return {
    host,
    onConfirm,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

function setValue(host: HTMLElement, selector: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(selector);
  expect(input, selector).not.toBeNull();
  if (input === null) return;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  act((): void => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(host: HTMLElement, selector: string): void {
  const el = host.querySelector<HTMLElement>(selector);
  expect(el, selector).not.toBeNull();
  act((): void => {
    el?.click();
  });
}

describe("Phase 45 item 7 — WatermarkDialog custom position", () => {
  it("starts with the grid enabled and the X/Y inputs disabled, and the tick flips it", () => {
    const m = mountWatermark();
    try {
      const x = m.host.querySelector<HTMLInputElement>("[data-watermark-x]");
      const y = m.host.querySelector<HTMLInputElement>("[data-watermark-y]");
      const slot = m.host.querySelector<HTMLButtonElement>(
        '[data-watermark-position="center"]',
      );
      const tick = m.host.querySelector<HTMLInputElement>("[data-watermark-custom-xy]");
      expect(x?.disabled).toBe(true);
      expect(y?.disabled).toBe(true);
      expect(slot?.disabled).toBe(false);

      click(m.host, "[data-watermark-custom-xy]");
      expect(tick?.checked).toBe(true);
      const xAfter = m.host.querySelector<HTMLInputElement>("[data-watermark-x]");
      const yAfter = m.host.querySelector<HTMLInputElement>("[data-watermark-y]");
      const slotAfter = m.host.querySelector<HTMLButtonElement>(
        '[data-watermark-position="center"]',
      );
      // Slots visibly disabled (not removed), inputs enabled and seeded.
      expect(slotAfter?.disabled).toBe(true);
      expect(m.host.querySelectorAll("[data-watermark-position]").length).toBe(9);
      expect(xAfter?.disabled).toBe(false);
      expect(yAfter?.disabled).toBe(false);
      expect(xAfter?.value).toBe("72");
      expect(yAfter?.value).toBe("72");
      expect(
        m.host.querySelector("[data-watermark-custom-hint]"),
      ).not.toBeNull();
    } finally {
      m.unmount();
    }
  });

  it("unticking restores the grid and its previous selection, and clears nothing", () => {
    const m = mountWatermark();
    try {
      // Pick a non-default slot first.
      click(m.host, '[data-watermark-position="bottom-right"]');
      click(m.host, "[data-watermark-custom-xy]");
      click(m.host, "[data-watermark-custom-xy]");
      const slot = m.host.querySelector<HTMLButtonElement>(
        '[data-watermark-position="bottom-right"]',
      );
      expect(slot?.disabled).toBe(false);
      expect(slot?.getAttribute("aria-pressed")).toBe("true");
      const x = m.host.querySelector<HTMLInputElement>("[data-watermark-x]");
      expect(x?.disabled).toBe(true);
    } finally {
      m.unmount();
    }
  });

  it("confirming with the tick applies the typed X/Y as settings.x / settings.y", () => {
    const m = mountWatermark();
    try {
      click(m.host, "[data-watermark-custom-xy]");
      setValue(m.host, "[data-watermark-x]", "120");
      setValue(m.host, "[data-watermark-y]", "340");
      click(m.host, "[data-watermark-confirm]");
      expect(m.onConfirm).toHaveBeenCalledTimes(1);
      const settings = m.onConfirm.mock.calls[0]?.[0] as WatermarkSettings;
      expect(settings.x).toBe(120);
      expect(settings.y).toBe(340);
      // The explicit coordinates REPLACE the grid slot on the wire.
      expect(settings.position).toBeUndefined();
      expect(settings.tile).toBeUndefined();
    } finally {
      m.unmount();
    }
  });

  it("confirming without the tick sends the grid slot and never an x/y", () => {
    const m = mountWatermark();
    try {
      click(m.host, '[data-watermark-position="top-left"]');
      click(m.host, "[data-watermark-confirm]");
      const settings = m.onConfirm.mock.calls[0]?.[0] as WatermarkSettings;
      expect(settings.position).toBe("top-left");
      expect(settings.x).toBeUndefined();
      expect(settings.y).toBeUndefined();
    } finally {
      m.unmount();
    }
  });

  it("rejects an out-of-bounds custom coordinate in-dialog without calling onConfirm", () => {
    const m = mountWatermark();
    try {
      click(m.host, "[data-watermark-custom-xy]");
      setValue(m.host, "[data-watermark-x]", String(MAX_WATERMARK_COORD + 5));
      click(m.host, "[data-watermark-confirm]");
      expect(m.onConfirm).not.toHaveBeenCalled();
      const alert = m.host.querySelector('[role="alert"]')?.textContent ?? "";
      expect(alert).toContain(`${MIN_WATERMARK_COORD} and ${MAX_WATERMARK_COORD}`);
    } finally {
      m.unmount();
    }
  });
});