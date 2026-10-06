// @vitest-environment jsdom
//
// Phase 40 (item 5) — the top bar's TWO distinct search affordances.
//
// Criterion 6: the header shows a Ctrl+K icon and a Ctrl+F icon that are
// visually different from each other, each carries an accessible name that
// names its shortcut, and each activates ITS OWN surface. This suite pins:
//   - both buttons exist (given the host wires them) with stable hooks,
//   - the glyphs differ (the command glyph vs the magnifier),
//   - each accessible name names its own shortcut,
//   - clicking each calls ONLY its own handler (different surfaces),
//   - the Ctrl+F control disables with a reason when no document is open.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  AppHeader,
  FIND_IN_DOCUMENT_ACCESSIBLE_NAME,
  TOOL_SEARCH_ACCESSIBLE_NAME,
} from "../../../src/renderer/components/AppHeader";
import type { MenuGroup } from "../../../src/renderer/components/TitleBar";

/** Phase 105 (chunk C) — Find relocated into the application menu; an empty
 *  View group is enough for the trigger plus the spliced Find row. */
const APP_MENU_GROUPS: MenuGroup[] = [{ id: "view", label: "View", entries: [] }];

interface Harness {
  container: HTMLElement;
  onOpenToolSearch: ReturnType<typeof vi.fn>;
  onOpenFind: ReturnType<typeof vi.fn>;
  cleanup: () => void;
}

function renderHeader(findEnabled: boolean): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onOpenToolSearch = vi.fn();
  const onOpenFind = vi.fn();
  act((): void => {
    root.render(
      <AppHeader
        activeId={null}
        appMenuGroups={APP_MENU_GROUPS}
        onPrint={(): void => undefined}
        onOpenFile={(): void => undefined}
        onSave={(): void => undefined}
        onSaveAs={(): void => undefined}
        onOpenToolSearch={onOpenToolSearch}
        onOpenFind={onOpenFind}
        findEnabled={findEnabled}
      />,
    );
  });
  return {
    container,
    onOpenToolSearch,
    onOpenFind,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function button(container: HTMLElement, selector: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(selector);
  if (el === null) throw new Error(`control ${selector} missing`);
  return el;
}

function click(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Open the application menu so its relocated Find row is queryable. */
function openAppMenu(container: HTMLElement): void {
  click(button(container, "[data-app-menu]"));
}

describe("Phase 40 item 5 — the header's two search affordances", () => {
  it("renders the Ctrl+K icon and the relocated Ctrl+F menu row", () => {
    const h = renderHeader(true);
    try {
      const k = button(h.container, "[data-header-tool-search]");
      expect(k.tagName).toBe("BUTTON");
      openAppMenu(h.container);
      const f = button(h.container, "[data-menu-action='find']");
      expect(f.tagName).toBe("BUTTON");
      expect(f).not.toBe(k);
    } finally {
      h.cleanup();
    }
  });

  it("uses visually different glyphs (palette field vs magnifier)", () => {
    const h = renderHeader(true);
    try {
      const kSvg = button(h.container, "[data-header-tool-search] svg");
      openAppMenu(h.container);
      const fSvg = button(h.container, "[data-menu-action='find'] svg");
      // Phase 103 — both glyphs are authored Quiet Precision shapes, so the
      // distinction is pinned by geometry, not by a Lucide class name: the
      // Ctrl+K command-palette glyph is a framed field, the Ctrl+F glyph is a
      // bare magnifier (lens circle, no frame).
      expect(kSvg.innerHTML).not.toBe(fSvg.innerHTML);
      expect(kSvg.querySelector("rect")).not.toBeNull();
      expect(fSvg.querySelector("rect")).toBeNull();
      expect(fSvg.querySelector("circle")).not.toBeNull();
    } finally {
      h.cleanup();
    }
  });

  it("names its own shortcut in each accessible name", () => {
    const h = renderHeader(true);
    try {
      const k = button(h.container, "[data-header-tool-search]");
      expect(k.getAttribute("aria-label")).toBe(TOOL_SEARCH_ACCESSIBLE_NAME);
      expect(TOOL_SEARCH_ACCESSIBLE_NAME).toContain("Ctrl+K");
      expect(k.getAttribute("title")).toContain("Ctrl+K");
      openAppMenu(h.container);
      const f = button(h.container, "[data-menu-action='find']");
      expect(f.textContent).toContain(FIND_IN_DOCUMENT_ACCESSIBLE_NAME);
      expect(FIND_IN_DOCUMENT_ACCESSIBLE_NAME).toContain("Ctrl+F");
      expect(f.textContent).toContain("Ctrl+F");
    } finally {
      h.cleanup();
    }
  });

  it("clicking each opens ONLY its own surface", () => {
    const h = renderHeader(true);
    try {
      click(button(h.container, "[data-header-tool-search]"));
      expect(h.onOpenToolSearch).toHaveBeenCalledTimes(1);
      expect(h.onOpenFind).not.toHaveBeenCalled();

      openAppMenu(h.container);
      click(button(h.container, "[data-menu-action='find']"));
      expect(h.onOpenFind).toHaveBeenCalledTimes(1);
      expect(h.onOpenToolSearch).toHaveBeenCalledTimes(1);
    } finally {
      h.cleanup();
    }
  });

  it("disables the Ctrl+F menu row with a reason when no document is open", () => {
    const h = renderHeader(false);
    try {
      openAppMenu(h.container);
      const f = button(h.container, "[data-menu-action='find']");
      expect(f.hasAttribute("disabled")).toBe(true);
      expect(f.getAttribute("title")).toContain("Open a document");
      click(f);
      expect(h.onOpenFind).not.toHaveBeenCalled();
      // The Ctrl+K palette works on the welcome screen: always enabled.
      expect(button(h.container, "[data-header-tool-search]").hasAttribute("disabled")).toBe(false);
    } finally {
      h.cleanup();
    }
  });
});