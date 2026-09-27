// @vitest-environment jsdom
//
// DEF-311..DEF-314 â€” the Phase 36 (chunk 3) Action Dock defects:
//
//   DEF-313 the dock renders a CURATED concept set per stage, not every
//           registry entry, and never spans the canvas over the pills.
//   DEF-314 (superseded by Phase 37 item 13) the EDIT stage is the Edit-mode
//           switch; the dock no longer offers an `editMode` verb.
//   DEF-312 the Pin/Unpin menu renders against the viewport (portal) and
//           clamps inside it, so a verb can actually be pinned.
//   DEF-311 a disabled verb's tooltip is the availability reason, not the
//           tool's description.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ActionDock, clampDockMenu, type ActionDockProps } from "../../../src/renderer/components/ActionDock";
import {
  DOCK_AVAILABILITY_REASON,
} from "../../../src/renderer/state/dockModel";
import { editModeForStage } from "../../../src/renderer/state/stages";
import {
  DOCK_STAGE_IDS,
  TOOL_REGISTRY,
  dockToolsForStage,
  toolById,
} from "../../../src/renderer/state/toolsRegistry";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

interface Harness {
  host: HTMLElement;
  unmount: () => void;
}

function renderDock(options: Partial<ActionDockProps> = {}): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const props: ActionDockProps = {
    activeStage: "pages",
    pageSelection: [],
    onClearPageSelection: vi.fn(),
    bulk: { onRotate: vi.fn(), onExtract: vi.fn(), onDelete: vi.fn() },
    dockPins: [],
    onPinTool: vi.fn(),
    onUnpinTool: vi.fn(),
    onRunTool: vi.fn(),
    canvasWidth: 1400,
    ...options,
  };
  act((): void => {
    root.render(<ActionDock {...props} />);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

const verbIds = (host: HTMLElement): string[] =>
  [...host.querySelectorAll<HTMLElement>("[data-dock-verb]")].map(
    (el) => el.getAttribute("data-dock-verb") ?? "",
  );

describe("DEF-313 / Phase 37 item 21 — the dock's relevant set per stage", () => {
  it("returns exactly the relevant verbs, in order, per stage", () => {
    expect(dockToolsForStage("pages").map((e) => e.id)).toEqual([
      "rotate", "extract", "insertPages", "replacePages", "split", "delete", "merge", "cropPages",
    ]);
    expect(dockToolsForStage("edit").map((e) => e.id)).toEqual([
      "editToolOff", "editText", "editImage", "editTextBox", "recognizeText", "batchOcr", "ocrSuspects",
    ]);
    expect(dockToolsForStage("review").map((e) => e.id)).toEqual([
      "annotate", "sign", "stamp", "flatten", "forms", "watermark",
      "exportComments", "importComments",
    ]);
    expect(dockToolsForStage("deliver").map((e) => e.id)).toEqual([
      "optimize", "audit", "exportPages", "exportText", "exportDocx", "createFromImages",
    ]);
    // Every listed id is uniquely owned by its stage list.
    const all = Object.values(DOCK_STAGE_IDS).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("every dock-stage id resolves to a registered content command", () => {
    for (const ids of Object.values(DOCK_STAGE_IDS)) {
      for (const id of ids) {
        const entry = toolById(id);
        expect(entry, id).toBeDefined();
        // Phase 37 item 21 — the dock's set now includes palette dialog
        // commands; only the panel/navigation chrome and the flyout set stay out.
        expect(entry?.surface, id).not.toBe("panel");
        expect(entry?.surface, id).not.toBe("flyout");
      }
    }
  });

  it("leaves the panel/navigation verbs and the flyout set out of the dock", () => {
    const docked = Object.values(DOCK_STAGE_IDS).flat();
    for (const id of [
      "renumberPages", "rotateCounterClockwise", "pageThumbnails",
      "outlinePanel", "pageContextMenu", "clearPageSelection", "dragPage",
      "editMode", "editDefaultFont", "annotationsPanel",
      "annSelect", "annHighlight", "annInk", "annColor",
    ]) {
      expect(docked, id).not.toContain(id);
      expect(toolById(id), id).toBeDefined();
    }
  });

  it("marks EVERY registry entry with a surface (flyout for the annotation set)", () => {
    for (const entry of TOOL_REGISTRY) expect(entry.surface, entry.id).toBeDefined();
    const flyout = TOOL_REGISTRY.filter((e) => e.surface === "flyout").map((e) => e.id);
    expect(flyout).toHaveLength(13);
  });
});

describe("DEF-313 â€” the dock can never span the canvas over the pills", () => {
  it("renders the same relevant PAGES set wide and narrow (never a wrap)", () => {
    for (const canvasWidth of [900, 1400]) {
      const { host, unmount } = renderDock({ activeStage: "pages", canvasWidth });
      try {
        expect(verbIds(host)).toHaveLength(8);
        expect(verbIds(host)).toEqual([
          "rotate", "extract", "insertPages", "replacePages", "split", "delete", "merge", "cropPages",
        ]);
      } finally {
        unmount();
      }
    }
  });

  it("caps the dock width to the MEASURED pill reserve (DEF-315) and NEVER stacks (Phase 37 item 2)", () => {
    const css = readFileSync(STYLES_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // DEF-315 supersedes the hardcoded 380px reserve: the cap subtracts the
    // MEASURED pill band published as --dock-reserve (fallback 476px = the live
    // measurement of the widest pill), and `max(0px, ...)` keeps it valid at a
    // host narrower than the reserve.
    expect(css).toMatch(
      /\.action-dock\s*\{[^}]*max-width:\s*max\(0px,\s*calc\(100% - var\(--dock-reserve,\s*476px\)\)\)/s,
    );
    expect(css).not.toMatch(/max\(220px,\s*calc\(100% - 380px\)\)/);
    // Phase 37 (item 2) — the dock and its verb group are ONE ROW: `nowrap`
    // replaces the Phase-36 wrap in both rules.
    expect(css).toMatch(/\.action-dock\s*\{[^}]*flex-wrap:\s*nowrap/s);
    expect(css).toMatch(/\.action-dock-group\s*\{[^}]*flex-wrap:\s*nowrap/s);
    expect(css).not.toMatch(/\.action-dock-group\s*\{[^}]*flex-wrap:\s*wrap/s);
  });
});

describe("DEF-314 (Phase 37 item 13) — the EDIT stage is the Edit-mode switch, not a dock verb", () => {
  it("the EDIT dock no longer offers an editMode verb, and editMode is not dock-hosted", () => {
    expect(dockToolsForStage("edit").map((e) => e.id)).not.toContain("editMode");
    expect(toolById("editMode")?.surface).not.toBe("dock");
  });

  it("maps the stage to edit mode: EDIT enables it, every other stage disables it", () => {
    expect(editModeForStage("edit")).toBe(true);
    expect(editModeForStage("pages")).toBe(false);
    expect(editModeForStage("review")).toBe(false);
    expect(editModeForStage("deliver")).toBe(false);
  });
});

describe("DEF-312 â€” the Pin/Unpin menu is viewport-positioned and clampable", () => {
  it("portals the menu to the body, clamped inside the window, and pins through the UI", () => {
    const onPinTool = vi.fn();
    const { host, unmount } = renderDock({ activeStage: "deliver", onPinTool });
    try {
      const button = host.querySelector<HTMLElement>('[data-dock-verb="optimize"]');
      expect(button).not.toBeNull();
      const nearRight = window.innerWidth - 2;
      const nearBottom = window.innerHeight - 2;
      act((): void => {
        button?.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: nearRight,
            clientY: nearBottom,
          }),
        );
      });
      const menu = document.body.querySelector<HTMLElement>("[data-dock-menu]");
      expect(menu, "the menu is in the DOM").not.toBeNull();
      // It is NOT a descendant of the transformed dock (the DEF-312 cause).
      expect(host.contains(menu as Node)).toBe(false);
      const left = Number.parseFloat((menu as HTMLElement).style.left);
      const top = Number.parseFloat((menu as HTMLElement).style.top);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(window.innerWidth - 168);
      expect(top).toBeLessThanOrEqual(window.innerHeight - 76);
      // Pinning goes through the real menu item.
      act((): void => {
        menu
          ?.querySelector<HTMLElement>('[data-dock-menu-item="pin"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      expect(onPinTool).toHaveBeenCalledWith("optimize");
    } finally {
      unmount();
    }
  });

  it("clamps a pointer far outside the window back inside", () => {
    const vw = 1000;
    const vh = 700;
    const pos = clampDockMenu(2000, 2000, 168, 76, vw, vh);
    expect(pos.left).toBe(vw - 168 - 8);
    expect(pos.top).toBe(vh - 76 - 8);
  });
});

describe("DEF-311 â€” a disabled verb shows the availability reason", () => {
  it("prefers the registry's availability copy over the description", () => {
    const { host, unmount } = renderDock({
      activeStage: "deliver",
      isToolEnabled: (entry) => entry.id !== "audit",
    });
    try {
      const audit = host.querySelector<HTMLElement>('[data-dock-verb="audit"]');
      expect(audit?.hasAttribute("disabled")).toBe(true);
      expect(audit?.getAttribute("title")).toBe(DOCK_AVAILABILITY_REASON.document);
      expect(audit?.getAttribute("title")).not.toBe(toolById("audit")?.description);
    } finally {
      unmount();
    }
  });

  it("lets the host's live reason win when it supplies one", () => {
    const { host, unmount } = renderDock({
      activeStage: "edit",
      isToolEnabled: (entry) => entry.id !== "editText",
      disabledReasonFor: (entry) =>
        entry.id === "editText" ? "Turn on Edit content first" : undefined,
    });
    try {
      const text = host.querySelector<HTMLElement>('[data-dock-verb="editText"]');
      expect(text?.getAttribute("title")).toBe("Turn on Edit content first");
    } finally {
      unmount();
    }
  });
});

