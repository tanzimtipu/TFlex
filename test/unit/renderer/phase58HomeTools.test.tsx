// @vitest-environment jsdom
//
// Phase 58 (chunk 4) — the HOME (Welcome) page's editable tool row.
//
// The row's first tile is the FIXED Open action (never removable). The rest are
// the persisted `homeTools` registry ids. The pen arms EDIT mode: every
// removable tile grows a minus badge and a plus at the row's end opens the
// candidate picker. The minus is a span (never a nested button) that stops its
// OWN event so the tile's run does not fire. The plus refuses at the cap with a
// visible reason.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Welcome, HOME_PICKER_H, HOME_PICKER_W, placeHomePicker } from "../../../src/renderer/components/Welcome";
import {
  DEFAULT_HOME_TOOLS,
  HOME_FIXED_TOOL_ID,
  HOME_TOOLS_MAX,
  addHomeTool,
  removeHomeTool,
  sanitizeHomeTools,
} from "../../../src/renderer/state/homeTools";
import type { SampleDocument } from "../../../src/shared/types";

const SAMPLES_RESOLVER = (): Promise<SampleDocument[]> => Promise.resolve([]);

/** 15 real registry ids — enough to exercise the 14-item cap. */
const VALID_IDS: readonly string[] = [
  "merge",
  "createFromImages",
  "preferences",
  "toolsPalette",
  "toggleTheme",
  "checkForUpdate",
  "about",
  "sign",
  "stamp",
  "flatten",
  "optimize",
  "audit",
  "exportPages",
  "exportText",
  "exportDocx",
];

interface WelcomeOptions {
  homeTools?: readonly string[];
  homeCandidates?: readonly string[];
  onRunHomeTool?: (id: string) => void;
  onSetHomeTools?: (ids: string[]) => void;
  onOpenFile?: () => void;
}

function renderWelcome(options: WelcomeOptions = {}): {
  host: HTMLElement;
  unmount: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <Welcome
        recentFiles={[]}
        onOpenRecent={(): void => undefined}
        onRemoveRecent={(): void => undefined}
        onOpenFile={options.onOpenFile ?? ((): void => undefined)}
        onSampleClick={(): void => undefined}
        onMergeClick={(): void => undefined}
        onCreateFromImages={(): void => undefined}
        homeTools={options.homeTools}
        homeCandidates={options.homeCandidates}
        onRunHomeTool={options.onRunHomeTool}
        onSetHomeTools={options.onSetHomeTools}
        samplesResolver={SAMPLES_RESOLVER}
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
  };
}

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function pressEscape(): void {
  act((): void => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

/** A pointerdown that only needs the `target` the picker's dismissal reads. */
function pointerDownOn(target: EventTarget): void {
  act((): void => {
    target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
}

const row = (host: HTMLElement): HTMLElement => {
  const el = host.querySelector<HTMLElement>("[data-home-tools]");
  if (el === null) throw new Error("no home-tools row");
  return el;
};

describe("Phase 58 — homeTools model", () => {
  it("HOME_TOOLS_MAX mirrors the main-process cap of 14", () => {
    expect(HOME_TOOLS_MAX).toBe(14);
  });

  it("DEFAULT_HOME_TOOLS is the shipped removable row", () => {
    expect([...DEFAULT_HOME_TOOLS]).toEqual(["createFromImages", "merge"]);
  });

  it("sanitizeHomeTools drops unknown ids and the fixed open id", () => {
    expect(sanitizeHomeTools(["notATool", "open", "merge"])).toEqual(["merge"]);
  });

  it("sanitizeHomeTools dedupes first-wins and preserves order", () => {
    expect(sanitizeHomeTools(["merge", "merge", "createFromImages", "merge"])).toEqual([
      "merge",
      "createFromImages",
    ]);
  });

  it("sanitizeHomeTools caps at 14 and a non-array reads as []", () => {
    expect(sanitizeHomeTools([...VALID_IDS])).toEqual([...VALID_IDS].slice(0, HOME_TOOLS_MAX));
    expect(sanitizeHomeTools(null)).toEqual([]);
    expect(sanitizeHomeTools(undefined)).toEqual([]);
    expect(sanitizeHomeTools("merge")).toEqual([]);
    expect(sanitizeHomeTools(42)).toEqual([]);
  });

  it("addHomeTool refuses unknown ids, the fixed id, duplicates and the cap", () => {
    expect(addHomeTool(["merge"], "notATool")).toEqual(["merge"]);
    expect(addHomeTool(["merge"], HOME_FIXED_TOOL_ID)).toEqual(["merge"]);
    expect(addHomeTool(["merge"], "merge")).toEqual(["merge"]);
    const full = [...VALID_IDS].slice(0, HOME_TOOLS_MAX);
    expect(addHomeTool(full, "sign")).toEqual(full);
    expect(addHomeTool(full, "sign").length).toBe(HOME_TOOLS_MAX);
    expect(addHomeTool(["merge"], "sign")).toEqual(["merge", "sign"]);
  });

  it("removeHomeTool drops a present id and no-ops on the fixed id or an absent id", () => {
    expect(removeHomeTool(["merge", "sign"], "merge")).toEqual(["sign"]);
    expect(removeHomeTool(["merge"], HOME_FIXED_TOOL_ID)).toEqual(["merge"]);
    expect(removeHomeTool(["merge"], "sign")).toEqual(["merge"]);
  });
});

describe("Phase 58 — placeHomePicker (DEF-410)", () => {
  it("right-aligns under the plus then clamps into the viewport", () => {
    // Comfortably inside: right edge at the plus's right, 6px gap below.
    expect(placeHomePicker({ right: 330, bottom: 40 }, 200, 168, 1024, 768)).toEqual({
      left: 130,
      top: 46,
    });
    // Past the right/bottom edges: clamp to the 8px gutter.
    expect(placeHomePicker({ right: 1030, bottom: 760 }, 200, 168, 1024, 768)).toEqual({
      left: 816,
      top: 592,
    });
  });

  it("exposes the fallback box constants used before measurement", () => {
    expect(HOME_PICKER_W).toBeGreaterThan(0);
    expect(HOME_PICKER_H).toBeGreaterThan(0);
  });
});
describe("Phase 58 � Welcome home tool row", () => {
  it("renders the fixed Open tile (primary) with NO minus, even in EDIT mode", () => {
    const { host, unmount } = renderWelcome({
      homeTools: ["merge"],
      homeCandidates: ["merge", "sign"],
    });
    try {
      const openTile = host.querySelector('[data-home-tool="open"]');
      expect(openTile).not.toBeNull();
      expect(openTile?.classList.contains("btn-primary")).toBe(true);
      expect(host.querySelector('[data-home-minus="open"]')).toBeNull();
      clickOn(host.querySelector("[data-home-edit-toggle]") as Element);
      expect(host.querySelector('[data-home-minus="open"]')).toBeNull();
    } finally {
      unmount();
    }
  });

  it("the pen toggles EDIT mode and the vibrate entry class", () => {
    const { host, unmount } = renderWelcome({ homeTools: ["merge"], homeCandidates: ["merge", "sign"] });
    try {
      expect(row(host).getAttribute("data-home-edit")).toBe("false");
      clickOn(host.querySelector("[data-home-edit-toggle]") as Element);
      expect(row(host).getAttribute("data-home-edit")).toBe("true");
      expect(row(host).classList.contains("anim-vibrate")).toBe(true);
      pressEscape();
      expect(row(host).getAttribute("data-home-edit")).toBe("false");
      expect(row(host).classList.contains("anim-vibrate")).toBe(false);
    } finally {
      unmount();
    }
  });

  it("every non-fixed tile grows a minus in EDIT mode", () => {
    const { host, unmount } = renderWelcome({
      homeTools: ["merge", "sign"],
      homeCandidates: ["merge", "sign", "flatten"],
    });
    try {
      clickOn(host.querySelector("[data-home-edit-toggle]") as Element);
      expect(host.querySelector('[data-home-minus="merge"]')).not.toBeNull();
      expect(host.querySelector('[data-home-minus="sign"]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("clicking a minus removes the id and does NOT run the tile", () => {
    const onSetHomeTools = vi.fn();
    const onRunHomeTool = vi.fn();
    const { host, unmount } = renderWelcome({
      homeTools: ["merge", "sign"],
      homeCandidates: ["merge", "sign", "flatten"],
      onSetHomeTools,
      onRunHomeTool,
    });
    try {
      clickOn(host.querySelector("[data-home-edit-toggle]") as Element);
      clickOn(host.querySelector('[data-home-minus="merge"]') as Element);
      expect(onSetHomeTools).toHaveBeenCalledWith(["sign"]);
      expect(onRunHomeTool).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("the plus opens the picker; picking appends the id and the plus stays", () => {
    const onSetHomeTools = vi.fn();
    const { host, unmount } = renderWelcome({
      homeTools: ["merge"],
      homeCandidates: ["createFromImages", "merge", "preferences"],
      onSetHomeTools,
    });
    try {
      clickOn(host.querySelector("[data-home-edit-toggle]") as Element);
      const plus = host.querySelector("[data-home-plus]");
      expect(plus).not.toBeNull();
      clickOn(plus as Element);
      // DEF-410 — the picker is portaled to document.body, so it is queried on
      // the DOCUMENT (not `host`).
      const item = document.querySelector("[data-home-picker-item]");
      expect(item).not.toBeNull();
      expect(item?.getAttribute("data-home-picker-item")).toBe("createFromImages");
      clickOn(item as Element);
      expect(onSetHomeTools).toHaveBeenCalledWith(["merge", "createFromImages"]);
      expect(host.querySelector("[data-home-plus]")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("the picker offers only candidates not already shown", () => {
    const { host, unmount } = renderWelcome({
      homeTools: ["merge"],
      homeCandidates: ["createFromImages", "merge", "preferences"],
    });
    try {
      clickOn(host.querySelector("[data-home-edit-toggle]") as Element);
      clickOn(host.querySelector("[data-home-plus]") as Element);
      const ids = [...document.querySelectorAll("[data-home-picker-item]")].map((el) =>
        el.getAttribute("data-home-picker-item"),
      );
      expect(ids).toEqual(["createFromImages", "preferences"]);
    } finally {
      unmount();
    }
  });

  it("portals the picker to document.body, never inside the vibrating row", () => {
    const { host, unmount } = renderWelcome({
      homeTools: ["merge"],
      homeCandidates: ["createFromImages", "merge", "preferences"],
    });
    try {
      clickOn(host.querySelector("[data-home-edit-toggle]") as Element);
      clickOn(host.querySelector("[data-home-plus]") as Element);
      const picker = document.querySelector("[data-home-picker]");
      expect(picker).not.toBeNull();
      // DEF-410 — a transformed ancestor is the containing block for fixed
      // descendants, so the picker MUST NOT live inside the `anim-vibrate` row.
      expect(row(host).contains(picker as Node)).toBe(false);
      expect(host.contains(picker as Node)).toBe(false);
      expect(picker?.parentElement).toBe(document.body);
      // Its own class carries the surface/positioning; left/top are inline
      // viewport coordinates (jsdom reports zero-size rects, so they clamp to
      // the 8px gutter).
      expect(picker?.classList.contains("home-tools-picker")).toBe(true);
      const style = (picker as HTMLElement).style;
      expect(style.left).not.toBe("");
      expect(style.top).not.toBe("");
    } finally {
      unmount();
    }
  });

  it("an outside pointerdown closes the picker without swallowing the event", () => {
    const { host, unmount } = renderWelcome({
      homeTools: ["merge"],
      homeCandidates: ["merge", "sign"],
    });
    try {
      clickOn(host.querySelector("[data-home-edit-toggle]") as Element);
      clickOn(host.querySelector("[data-home-plus]") as Element);
      const picker = document.querySelector("[data-home-picker]") as HTMLElement;
      expect(picker).not.toBeNull();
      // A pointerdown inside the portaled picker keeps it open.
      pointerDownOn(picker);
      expect(document.querySelector("[data-home-picker]")).not.toBeNull();
      // A pointerdown elsewhere (the host is outside the portal) closes it.
      pointerDownOn(host);
      expect(document.querySelector("[data-home-picker]")).toBeNull();
      // The press was not swallowed: edit mode stays armed.
      expect(row(host).getAttribute("data-home-edit")).toBe("true");
    } finally {
      unmount();
    }
  });

  it("Escape closes the picker first, then a second Escape exits EDIT mode", () => {
    const { host, unmount } = renderWelcome({
      homeTools: ["merge"],
      homeCandidates: ["merge", "sign"],
    });
    try {
      clickOn(host.querySelector("[data-home-edit-toggle]") as Element);
      clickOn(host.querySelector("[data-home-plus]") as Element);
      expect(document.querySelector("[data-home-picker]")).not.toBeNull();
      pressEscape();
      expect(document.querySelector("[data-home-picker]")).toBeNull();
      expect(row(host).getAttribute("data-home-edit")).toBe("true");
      pressEscape();
      expect(row(host).getAttribute("data-home-edit")).toBe("false");
    } finally {
      unmount();
    }
  });

  it("clicking the plus again closes the picker", () => {
    const { host, unmount } = renderWelcome({
      homeTools: ["merge"],
      homeCandidates: ["merge", "sign"],
    });
    try {
      clickOn(host.querySelector("[data-home-edit-toggle]") as Element);
      clickOn(host.querySelector("[data-home-plus]") as Element);
      expect(document.querySelector("[data-home-picker]")).not.toBeNull();
      clickOn(host.querySelector("[data-home-plus]") as Element);
      expect(document.querySelector("[data-home-picker]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("at the cap the plus is disabled with a visible reason", () => {
    const full = [...VALID_IDS].slice(0, HOME_TOOLS_MAX);
    const { host, unmount } = renderWelcome({ homeTools: full, homeCandidates: VALID_IDS });
    try {
      clickOn(host.querySelector("[data-home-edit-toggle]") as Element);
      const plus = host.querySelector("[data-home-plus]") as HTMLButtonElement;
      expect(plus).not.toBeNull();
      expect(plus.disabled).toBe(true);
      expect(plus.getAttribute("title")).toContain("Home row is full (max 14 tools)");
      expect(host.querySelector("[data-home-full-hint]")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("a tile runs its registry id via onRunHomeTool", () => {
    const onRunHomeTool = vi.fn();
    const { host, unmount } = renderWelcome({
      homeTools: ["merge"],
      homeCandidates: ["merge", "sign"],
      onRunHomeTool,
    });
    try {
      clickOn(host.querySelector('[data-home-tool="merge"]') as Element);
      expect(onRunHomeTool).toHaveBeenCalledWith("merge");
    } finally {
      unmount();
    }
  });
});
