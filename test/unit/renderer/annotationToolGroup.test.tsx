// @vitest-environment jsdom
//
// Phase 19 — the annotation tool GROUP (CommandBar capsule).
//
// The Phase 14.2 standalone `.ann-toolbar` row is retired. These tests
// pin the new group contract:
//   (a) exactly five visible tool buttons, MRU-first;
//   (b) a fresh profile yields the canonical default five;
//   (c) the dropdown lists all eleven tools;
//   (d) the colour swatch sits between the visible container and the
//       dropdown toggle in DOM order;
//   (e) aria-expanded reflects the menu state;
//   (f) selecting a menu row arms it AND promotes it in the MRU;
//   (g) the pen-width row lives in the menu, ink-only;
//   (h) edit mode disables every visible tool except Select;
//   (i) the group is the CommandBar's LAST `.toolbar-group` capsule.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { AnnotationToolbar } from "../../../src/renderer/annotations/AnnotationToolbar";
import { CommandBar } from "../../../src/renderer/components/CommandBar";
import {
  initialAnnotationToolState,
  type AnnotationToolAction,
  type AnnotationToolState,
} from "../../../src/renderer/annotations/model";
import type { ZoomMode } from "../../../src/renderer/state/zoom";
import {
  ANNOTATION_TOOL_ORDER,
  promoteAnnotationTool,
} from "../../../src/renderer/state/preferences";

const NOOP = (): void => undefined;

interface Mounted {
  host: HTMLElement;
  unmount: () => void;
}

function mount(element: ReactElement): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
      // The menu portals to document.body; clear any leftovers.
      document.body.innerHTML = "";
    },
  };
}

interface GroupOptions {
  state?: AnnotationToolState;
  recent?: string[];
  onAction?: (a: AnnotationToolAction) => void;
  onRecentChange?: (ids: string[]) => void;
  editModeOpen?: boolean;
}

function mountGroup(options: GroupOptions = {}): Mounted {
  return mount(
    <AnnotationToolbar
      state={options.state ?? initialAnnotationToolState}
      onAction={options.onAction ?? NOOP}
      annotationRecentTools={options.recent ?? []}
      onAnnotationRecentToolsChange={options.onRecentChange ?? NOOP}
      editModeOpen={options.editModeOpen ?? false}
    />,
  );
}

function visibleIds(host: HTMLElement): string[] {
  return Array.from(
    host.querySelectorAll<HTMLElement>("[data-ann-tools-visible] [data-tool]"),
  ).map((b) => b.getAttribute("data-tool") ?? "");
}

function openMenu(host: HTMLElement): HTMLElement {
  const toggle = host.querySelector<HTMLElement>("[data-ann-dropdown-toggle]");
  if (toggle === null) throw new Error("dropdown toggle missing");
  act((): void => {
    toggle.click();
  });
  const menu = document.body.querySelector<HTMLElement>("[data-ann-dropdown-menu]");
  if (menu === null) throw new Error("dropdown menu did not open");
  return menu;
}

describe("Phase 19 — five visible MRU tools", () => {
  it("(a) renders exactly five visible buttons in MRU order", () => {
    const m = mountGroup({ recent: ["rect", "note", "highlight", "ink", "arrow"] });
    try {
      const ids = visibleIds(m.host);
      expect(ids).toEqual(["rect", "note", "highlight", "ink", "arrow"]);
    } finally {
      m.unmount();
    }
  });

  it("(b) a fresh profile yields the canonical default five", () => {
    const m = mountGroup({ recent: [] });
    try {
      expect(visibleIds(m.host)).toEqual(
        ANNOTATION_TOOL_ORDER.slice(0, 5),
      );
    } finally {
      m.unmount();
    }
  });

  it("(c) the dropdown lists all eleven tools", () => {
    const m = mountGroup({ recent: [] });
    try {
      const menu = openMenu(m.host);
      const ids = Array.from(
        menu.querySelectorAll<HTMLElement>("[data-tool]"),
      ).map((b) => b.getAttribute("data-tool") ?? "");
      expect(ids).toHaveLength(11);
      expect(new Set(ids)).toEqual(new Set(ANNOTATION_TOOL_ORDER));
    } finally {
      m.unmount();
    }
  });

  it("(d) the colour swatch sits between the visible container and the toggle", () => {
    const m = mountGroup({
      state: { tool: "ink", color: "yellow", penWidth: 3 },
    });
    try {
      const visible = m.host.querySelector("[data-ann-tools-visible]");
      const swatch = m.host.querySelector("[data-ann-color]");
      const toggle = m.host.querySelector("[data-ann-dropdown-toggle]");
      expect(visible).not.toBeNull();
      expect(swatch).not.toBeNull();
      expect(toggle).not.toBeNull();
      if (visible === null || swatch === null || toggle === null) return;
      const pos = (a: Element, b: Element): number =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(pos(visible, swatch)).toBeTruthy();
      expect(pos(swatch, toggle)).toBeTruthy();
    } finally {
      m.unmount();
    }
  });
});

describe("Phase 19 — dropdown behaviour", () => {
  it("(e) aria-expanded flips true on open and false after selecting a row", () => {
    const m = mountGroup({ recent: [] });
    try {
      const toggle = m.host.querySelector<HTMLElement>("[data-ann-dropdown-toggle]");
      expect(toggle?.getAttribute("aria-expanded")).toBe("false");
      const menu = openMenu(m.host);
      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
      const row = menu.querySelector<HTMLElement>('[data-tool="rect"]');
      act((): void => {
        row?.click();
      });
      expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    } finally {
      m.unmount();
    }
  });

  it("(f) selecting a menu row arms the tool AND promotes it to the MRU front", () => {
    const onAction = vi.fn((_a: AnnotationToolAction): void => undefined);
    const onRecentChange = vi.fn((_ids: string[]): void => undefined);
    const m = mountGroup({ recent: ["note"], onAction, onRecentChange });
    try {
      const menu = openMenu(m.host);
      const row = menu.querySelector<HTMLElement>('[data-tool="rect"]');
      act((): void => {
        row?.click();
      });
      expect(onAction).toHaveBeenCalledWith({ type: "set-tool", tool: "rect" });
      expect(onRecentChange).toHaveBeenCalledWith(
        promoteAnnotationTool(["note"], "rect"),
      );
    } finally {
      m.unmount();
    }
  });

  it("(g) the pen-width row lives in the menu and only when Ink is armed", () => {
    const ink = mountGroup({
      state: { tool: "ink", color: "yellow", penWidth: 3 },
    });
    try {
      const menu = openMenu(ink.host);
      expect(menu.querySelectorAll("[data-pen-width]")).toHaveLength(3);
    } finally {
      ink.unmount();
    }
    const select = mountGroup({ state: initialAnnotationToolState });
    try {
      const menu = openMenu(select.host);
      expect(menu.querySelector("[data-pen-width]")).toBeNull();
    } finally {
      select.unmount();
    }
  });

  it("(h) edit mode disables every visible tool except Select", () => {
    const m = mountGroup({ recent: [], editModeOpen: true });
    try {
      const buttons = Array.from(
        m.host.querySelectorAll<HTMLButtonElement>("[data-ann-tools-visible] [data-tool]"),
      );
      expect(buttons).toHaveLength(5);
      for (const b of buttons) {
        const id = b.getAttribute("data-tool");
        if (id === "select") {
          expect(b.disabled).toBe(false);
        } else {
          expect(b.disabled, `${id} should be disabled in edit mode`).toBe(true);
        }
      }
    } finally {
      m.unmount();
    }
  });

  it("(j) Enter arms the menu row that has DOM focus, not the arrow highlight", () => {
    const onAction = vi.fn((_a: AnnotationToolAction): void => undefined);
    const m = mountGroup({ recent: [], onAction });
    try {
      const menu = openMenu(m.host);
      const row = menu.querySelector<HTMLButtonElement>('[data-tool="highlight"]');
      expect(row).not.toBeNull();
      if (row === null) return;
      // Tab focus lands on the Highlight row while the arrow-key
      // highlight still sits on Select (menuIndex 0).
      act((): void => {
        row.focus();
      });
      expect(document.activeElement).toBe(row);
      act((): void => {
        row.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      });
      expect(onAction).toHaveBeenCalledWith({ type: "set-tool", tool: "highlight" });
    } finally {
      m.unmount();
    }
  });

  it("(k) Space arms the menu row that has DOM focus", () => {
    const onAction = vi.fn((_a: AnnotationToolAction): void => undefined);
    const m = mountGroup({ recent: [], onAction });
    try {
      const menu = openMenu(m.host);
      const row = menu.querySelector<HTMLButtonElement>('[data-tool="rect"]');
      expect(row).not.toBeNull();
      if (row === null) return;
      act((): void => {
        row.focus();
      });
      act((): void => {
        row.dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
        );
      });
      expect(onAction).toHaveBeenCalledWith({ type: "set-tool", tool: "rect" });
    } finally {
      m.unmount();
    }
  });

  it("(l) ArrowDown then Enter on the container still arms the highlighted row", () => {
    const onAction = vi.fn((_a: AnnotationToolAction): void => undefined);
    const m = mountGroup({ recent: [], onAction });
    try {
      const menu = openMenu(m.host);
      // The menu container is focused on open; ArrowDown moves the
      // highlight from Select (0) to Highlight (1).
      act((): void => {
        menu.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
        );
      });
      act((): void => {
        menu.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      });
      expect(onAction).toHaveBeenCalledWith({ type: "set-tool", tool: "highlight" });
    } finally {
      m.unmount();
    }
  });
});

function mountBarWithGroup(annotationTools: ReactElement): Mounted {
  return mount(
    <CommandBar
      onOpenFile={NOOP}
      page={1}
      pageCount={3}
      zoomPercent={100}
      zoomMode={"fit-width" as ZoomMode}
      modified={false}
      saveInPlaceEnabled
      onJump={NOOP}
      onZoomIn={NOOP}
      onZoomOut={NOOP}
      onFitWidth={NOOP}
      onFitPage={NOOP}
      searchOpen={false}
      onToggleSearch={NOOP}
      onSave={NOOP}
      onSaveAs={NOOP}
      onMerge={NOOP}
      onSplit={NOOP}
      signToolActive={false}
      onSignClick={NOOP}
      hasFormFields={false}
      onFlattenClick={NOOP}
      onOptimize={NOOP}
      onAuditSpace={NOOP}
      annotationTools={annotationTools}
    />,
  );
}

describe("Phase 19 — the group is the CommandBar's last capsule", () => {
  it("(i) renders inside .toolbar as the trailing .toolbar-group", () => {
    const m = mountBarWithGroup(
      <AnnotationToolbar
        state={initialAnnotationToolState}
        onAction={NOOP}
        annotationRecentTools={[]}
      />,
    );
    try {
      const toolbar = m.host.querySelector(".toolbar");
      expect(toolbar).not.toBeNull();
      const groups = Array.from(
        toolbar?.querySelectorAll<HTMLElement>(":scope > .toolbar-group") ?? [],
      );
      expect(groups.length).toBeGreaterThanOrEqual(6);
      const last = groups.at(-1);
      expect(last?.hasAttribute("data-annotation-toolbar")).toBe(true);
      expect(last?.classList.contains("commandbar-group-annotate")).toBe(true);
      // The old row chrome must be gone.
      expect(last?.classList.contains("glass-chrome-command")).toBe(false);
      expect(last?.getAttribute("aria-label")).toBe("Annotate");
    } finally {
      m.unmount();
    }
  });
});

