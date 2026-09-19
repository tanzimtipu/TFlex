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
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { CommandBar } from "../../../src/renderer/components/CommandBar";
import { AnnotationToolbar } from "../../../src/renderer/annotations/AnnotationToolbar";
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

describe("Phase 14.2 FIX 1 (Phase 19 supersession) — the annotation group is a CommandBar capsule", () => {
  it("renders as the GlassControlGroup primitive under the legacy .ann-toolbar hook", () => {
    const host = mount(
      <AnnotationToolbar state={initialAnnotationToolState} onAction={NOOP} />,
    );
    try {
      const group = host.querySelector<HTMLElement>(".ann-toolbar");
      expect(group).not.toBeNull();
      // Phase 19 — the group is the CommandBar's own group primitive.
      expect(group?.classList.contains("glass-control-group")).toBe(true);
      expect(group?.classList.contains("toolbar-group")).toBe(true);
      expect(group?.classList.contains("commandbar-group-annotate")).toBe(true);
      // The e2e data hook survives the move.
      expect(group?.hasAttribute("data-annotation-toolbar")).toBe(true);
      expect(group?.getAttribute("role")).toBe("group");
      expect(group?.getAttribute("aria-label")).toBe("Annotate");
      // The retired standalone row chrome is gone.
      expect(group?.classList.contains("glass-chrome-command")).toBe(false);
    } finally {
      unmount(host);
    }
  });

  it("keeps the five visible tools + the all-tools menu data-tool contract", () => {
    const host = mount(
      <AnnotationToolbar
        state={initialAnnotationToolState}
        onAction={NOOP}
        annotationRecentTools={[]}
      />,
    );
    try {
      const visible = Array.from(
        host.querySelectorAll<HTMLElement>("[data-ann-tools-visible] [data-tool]"),
      );
      expect(visible.map((t) => t.getAttribute("data-tool"))).toEqual([
        "select",
        "highlight",
        "underline",
        "strikeout",
        "ink",
      ]);
      const toggle = host.querySelector<HTMLElement>("[data-ann-dropdown-toggle]");
      act((): void => {
        toggle?.click();
      });
      const menu = document.body.querySelector<HTMLElement>("[data-ann-dropdown-menu]");
      expect(menu).not.toBeNull();
      const menuBtns = Array.from(menu?.querySelectorAll<HTMLElement>("[data-tool]") ?? []);
      const names = menuBtns.map((t) => t.getAttribute("data-tool"));
      for (const id of ["select", "highlight", "ink", "rect", "note"]) {
        expect(names).toContain(id);
      }
      for (const btn of [...visible, ...menuBtns]) {
        expect(btn.getAttribute("aria-label")).toBeTruthy();
      }
    } finally {
      unmount(host);
      document.body.innerHTML = "";
    }
  });
});

describe("Phase 14.2 FIX 3 / Phase 22 — the Open control is NOT in the command bar", () => {
  it("the File group is gone (Phase 22 relocated Open / Save / Save As to the title bar)", () => {
    const host = mountBar({});
    try {
      // Phase 22 — the operator moved the file actions into the caption
      // strip. The command bar must render no File capsule, no accent
      // Open button and no Save hook; the relocated contract (single
      // clean accent control, fires onOpenFile) is pinned in
      // phase22_titlebarFileGroup.test.tsx.
      expect(host.querySelector(".commandbar-group-open")).toBeNull();
      expect(host.querySelector(".commandbar-open")).toBeNull();
      expect(host.querySelector("[data-toolbar-open]")).toBeNull();
      expect(host.querySelector("[data-toolbar-save]")).toBeNull();
      expect(host.querySelector("[data-toolbar-save-as]")).toBeNull();
      const labels = Array.from(host.querySelectorAll<HTMLElement>(".glass-control-group"))
        .map((g) => g.getAttribute("aria-label"));
      expect(labels).not.toContain("File");
      expect(labels).not.toContain("Save");
    } finally {
      unmount(host);
    }
  });
});

describe("Phase 14.2 FIX 6 — the command-bar icon ladder is 20px minimum", () => {
  it("every icon button renders its glyph at 22px", () => {
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

describe("Phase 14.2 FIX 6 (Phase 19) — the annotation glyphs ride the CommandBar 22px ladder", () => {
  it("every visible annotation tool glyph renders at 22px", () => {
    const host = mount(
      <AnnotationToolbar
        state={initialAnnotationToolState}
        onAction={NOOP}
        annotationRecentTools={[]}
      />,
    );
    try {
      const svgs = Array.from(host.querySelectorAll<SVGSVGElement>(".ann-toolbar .tool-btn svg"));
      expect(svgs.length).toBeGreaterThanOrEqual(5);
      for (const svg of svgs) {
        expect(Number(svg.getAttribute("width"))).toBe(22);
        expect(Number(svg.getAttribute("height"))).toBe(22);
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
