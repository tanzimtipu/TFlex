// @vitest-environment jsdom
//
// Phase 14.2 — Liquid Glass polish: the top-bar + icon contracts.
//
// Pins the renderer half of the eight Phase-14.2 polish fixes that are
// expressible without a real browser:
//   FIX 1 — the annotation (context) bar renders as the SAME
//           GlassChromeBar primitive the command bar uses (variant
//           "command" -> the 52px --chrome-commandbar-h token), with
//           every legacy .ann-toolbar / data-tool contract intact.
//   FIX 3 — the Open control is a single clean button inside its
//           labelled File group (no duplicate/ghost layers).
//   FIX 6 — the icon ladder: command-bar glyphs at 22px (Open's inline
//           glyph 20px), annotation-bar glyphs at 24px (the top of the
//           ladder, in 32px buttons). The SIDEBAR ladder (Pages rail +
//           Tools palette, 22px) is pinned in glassSidebar.test.tsx.
//   FIX 7 — the Tools palette toggle moved off the command bar: it is
//           now the floating badge on the page view's right edge
//           (DocumentView's .tools-badge); the bar must not host it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { CommandBar } from "../../../src/renderer/components/CommandBar";
import { AnnotationToolbar } from "../../../src/renderer/annotations/AnnotationToolbar";
import { GLASS_CHROME_HEIGHTS } from "../../../src/renderer/components/GlassChrome";
import type { ZoomMode } from "../../../src/renderer/state/zoom";
import {
  initialAnnotationToolState,
  type AnnotationToolAction,
  type AnnotationToolState,
} from "../../../src/renderer/annotations/model";

const NOOP = (): void => undefined;

function mount(element: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return host;
}

function unmount(host: HTMLElement): void {
  host.remove();
}

interface BarOverrides {
  [key: string]: unknown;
}

function mountBar(overrides: BarOverrides = {}): HTMLElement {
  const props = {
    onOpenFile: NOOP,
    page: 1,
    pageCount: 34,
    zoomPercent: 372,
    zoomMode: "fit-width" as ZoomMode,
    modified: false,
    saveInPlaceEnabled: true,
    onJump: NOOP,
    onZoomIn: NOOP,
    onZoomOut: NOOP,
    onFitWidth: NOOP,
    onFitPage: NOOP,
    searchOpen: false,
    onToggleSearch: NOOP,
    onSave: NOOP,
    onSaveAs: NOOP,
    onMerge: NOOP,
    onSplit: NOOP,
    signToolActive: false,
    onSignClick: NOOP,
    hasFormFields: false,
    onFlattenClick: NOOP,
    onOptimize: NOOP,
    onAuditSpace: NOOP,
    handActive: false,
    ...overrides,
  };
  return mount(<CommandBar {...props} />);
}

describe("Phase 14.2 FIX 1 — the annotation bar is the standardized command-height bar", () => {
  it("renders the shared GlassChromeBar command variant under the legacy .ann-toolbar class", () => {
    const host = mount(
      <AnnotationToolbar state={initialAnnotationToolState} onAction={NOOP} />,
    );
    try {
      const bar = host.querySelector<HTMLElement>(".ann-toolbar");
      expect(bar).not.toBeNull();
      // The shared chrome primitive classes ride the legacy class.
      expect(bar?.classList.contains("glass-chrome")).toBe(true);
      expect(bar?.classList.contains("glass-chrome-command")).toBe(true);
      // The e2e data hook survives the primitive swap.
      expect(bar?.hasAttribute("data-annotation-toolbar")).toBe(true);
      // The variant carries the 52px command-bar height token (the
      // standardized height the annotation bar must match); the bar
      // itself stays wrappable (height auto, the min-height comes
      // from the class + token).
      expect(bar?.style.height).toBe("auto");
      expect(GLASS_CHROME_HEIGHTS.commandBar).toBe(52);
    } finally {
      unmount(host);
    }
  });

  it("keeps every annotation tool button + its data-tool contract", () => {
    const host = mount(
      <AnnotationToolbar state={initialAnnotationToolState} onAction={NOOP} />,
    );
    try {
      const tools = Array.from(host.querySelectorAll<HTMLElement>("[data-tool]"));
      const names = tools.map((t) => t.getAttribute("data-tool"));
      expect(names).toContain("select");
      expect(names).toContain("highlight");
      expect(names).toContain("ink");
      expect(names).toContain("rect");
      expect(names).toContain("note");
      for (const btn of tools) {
        expect(btn.getAttribute("aria-label")).toBeTruthy();
      }
    } finally {
      unmount(host);
    }
  });
});

describe("Phase 14.2 FIX 3 — the Open control is one clean single-layer button", () => {
  it("the File group holds exactly one interactive child (the accent button)", () => {
    const host = mountBar({});
    try {
      const group = host.querySelector<HTMLElement>(".commandbar-group-open");
      expect(group).not.toBeNull();
      // The labelled group keeps its a11y contract.
      expect(group?.getAttribute("role")).toBe("group");
      expect(group?.getAttribute("aria-label")).toBe("File");
      const buttons = group?.querySelectorAll("button") ?? [];
      expect(buttons.length).toBe(1);
      const open = buttons[0] as HTMLButtonElement;
      expect(open.classList.contains("btn-primary")).toBe(true);
      expect(open.classList.contains("commandbar-open")).toBe(true);
      expect(open.getAttribute("data-toolbar-open")).not.toBeNull();
      // No ghost/duplicate layers inside the button itself: exactly
      // one child element (the folder icon) + the "Open" text node.
      expect(open.children.length).toBe(1);
      expect(open.textContent).toContain("Open");
    } finally {
      unmount(host);
    }
  });

  it("the Open button fires onOpenFile", () => {
    const onOpenFile = vi.fn();
    const host = mountBar({ onOpenFile });
    try {
      const open = host.querySelector<HTMLButtonElement>("[data-toolbar-open]");
      act((): void => {
        open?.click();
      });
      expect(onOpenFile).toHaveBeenCalledTimes(1);
    } finally {
      unmount(host);
    }
  });
});

describe("Phase 14.2 FIX 6 — the command-bar icon ladder is 20px minimum", () => {
  it("every icon button renders its glyph at 22px (Open's inline icon 20px)", () => {
    const host = mountBar({
      onRotateClockwise: NOOP,
      onRotateCounterClockwise: NOOP,
      onDeletePage: NOOP,
    });
    try {
      const svgs = Array.from(host.querySelectorAll<SVGSVGElement>(".toolbar .tool-btn svg"));
      expect(svgs.length).toBeGreaterThan(10);
      for (const svg of svgs) {
        const w = Number(svg.getAttribute("width"));
        const h = Number(svg.getAttribute("height"));
        expect(w, `command bar glyph too small: ${svg.getAttribute("class")}`).toBeGreaterThanOrEqual(22);
        expect(h).toBe(22);
      }
      const openIcon = host.querySelector<SVGSVGElement>("[data-toolbar-open] svg");
      expect(Number(openIcon?.getAttribute("width"))).toBe(20);
    } finally {
      unmount(host);
    }
  });
});

describe("Phase 14.2 FIX 7 — the All tools toggle has moved off the command bar", () => {
  // The "All tools" toggle left the command bar: it is now the floating
  // badge on the page view's right edge (DocumentView's .tools-badge,
  // data-tools-badge, keeping the stable data-tools-toggle e2e hook).
  // The bar itself must not host the toggle — the badge coverage lives
  // in the DocumentView-level tests (bugDEF094).
  it("the command bar no longer renders the toggle (no data-tools-toggle / data-tools-badge)", () => {
    const host = mountBar();
    try {
      expect(host.querySelector("[data-tools-toggle]")).toBeNull();
      expect(host.querySelector("[data-tools-badge]")).toBeNull();
      // No ellipsis glyph anywhere in the command bar.
      expect(host.querySelector(".lucide-ellipsis")).toBeNull();
    } finally {
      unmount(host);
    }
  });
});

describe("Phase 14.2 FIX 6 — the annotation bar icons are 24px", () => {
  it("every annotation tool glyph renders at 24px", () => {
    const host = mount(
      <AnnotationToolbar state={initialAnnotationToolState} onAction={NOOP} />,
    );
    try {
      const svgs = Array.from(host.querySelectorAll<SVGSVGElement>(".ann-toolbar .tool-btn svg"));
      expect(svgs.length).toBeGreaterThanOrEqual(11);
      for (const svg of svgs) {
        expect(Number(svg.getAttribute("width"))).toBe(24);
        expect(Number(svg.getAttribute("height"))).toBe(24);
      }
    } finally {
      unmount(host);
    }
  });

  it("tool arming still dispatches through the same reducer contract", () => {
    const actions: AnnotationToolAction[] = [];
    const onAction = (a: AnnotationToolAction): void => {
      actions.push(a);
    };
    const state: AnnotationToolState = initialAnnotationToolState;
    const host = mount(<AnnotationToolbar state={state} onAction={onAction} />);
    try {
      const ink = host.querySelector<HTMLButtonElement>("[data-tool='ink']");
      act((): void => {
        ink?.click();
      });
      expect(actions).toEqual([{ type: "set-tool", tool: "ink" }]);
    } finally {
      unmount(host);
    }
  });
});
