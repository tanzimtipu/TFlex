// @vitest-environment jsdom
//
// Phase 14.1 — the grouped COMMAND BAR.
//
// The reference's second top surface: a full-width glass band of
// GlassControlGroup capsules — [Open (accent)] [Navigation] [Save]
// [Zoom] [Tools] [Actions] — instead of a field of loose buttons.
// These tests pin:
//   1. The group structure (every capsule labelled, in reference order).
//   2. The Open accent button (the ONE labelled control): it fires
//      onOpenFile and keeps the primary treatment.
//   3. The Phase-13 icon-only a11y contract survives the regrouping:
//      no label spans, every button named by aria-label + title.
//   4. The stable data-* hooks (data-hand-toggle, data-toolbar-rotate-*,
//      page input commit) keep resolving. The Tools palette toggle
//      (data-tools-toggle) no longer lives in the bar — it is the
//      floating badge on the page view's right edge (DocumentView's
//      .tools-badge, data-tools-badge); the bar must NOT render it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { CommandBar } from "../../../src/renderer/components/CommandBar";
import type { ZoomMode } from "../../../src/renderer/state/zoom";

const NOOP = (): void => undefined;

interface MountOverrides {
  [key: string]: unknown;
}

function mountBar(overrides: MountOverrides = {}): HTMLElement {
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

describe("CommandBar — glass control groups", () => {
  it("renders the remaining reference groups in order, each a labelled capsule", () => {
    const host = mountBar({ onRotateClockwise: NOOP, onRotateCounterClockwise: NOOP, onDeletePage: NOOP });
    try {
      const groups = Array.from(host.querySelectorAll<HTMLElement>(".glass-control-group"));
      const labels = groups.map((g) => g.getAttribute("aria-label"));
      // Phase 22 — the File (Open) and Save groups left this bar: the
      // caption strip (AppHeader's .titlebar-file group) owns Open /
      // Save / Save As now. The working groups keep their reference
      // order.
      expect(labels).toEqual(["Navigation", "Zoom", "Tools", "Document actions"]);
      // Every capsule carries BOTH the glass class and the legacy
      // .toolbar-group class (the toolbar overflow contract rides it).
      for (const g of groups) {
        expect(g.classList.contains("glass-control-group")).toBe(true);
        expect(g.classList.contains("toolbar-group")).toBe(true);
      }
    } finally {
      unmount(host);
    }
  });

  it("renders no File / Save group (Phase 22: no duplicate controls)", () => {
    const host = mountBar({ onOpenFile: NOOP });
    try {
      const labels = Array.from(host.querySelectorAll<HTMLElement>(".glass-control-group"))
        .map((g) => g.getAttribute("aria-label"));
      expect(labels).not.toContain("File");
      expect(labels).not.toContain("Save");
      // And no relocated control's hook survives in the command bar.
      expect(host.querySelector("[data-toolbar-open]")).toBeNull();
      expect(host.querySelector("[data-toolbar-save]")).toBeNull();
      expect(host.querySelector("[data-toolbar-save-as]")).toBeNull();
      expect(host.querySelector(".commandbar-open")).toBeNull();
    } finally {
      unmount(host);
    }
  });

  it("the Navigation capsule holds prev / page input / next", () => {
    const host = mountBar();
    try {
      const nav = host.querySelector<HTMLElement>("div[aria-label='Navigation']");
      expect(nav).not.toBeNull();
      expect(nav?.querySelector("[aria-label='Previous page']")).not.toBeNull();
      expect(nav?.querySelector("[aria-label='Next page']")).not.toBeNull();
      expect(nav?.querySelector(".page-input")).not.toBeNull();
      expect(nav?.querySelector(".page-total")?.textContent).toContain("34");
    } finally {
      unmount(host);
    }
  });

  it("the Zoom capsule reads [- 372% +]", () => {
    const host = mountBar();
    try {
      const zoom = host.querySelector<HTMLElement>("div[aria-label='Zoom']");
      expect(zoom).not.toBeNull();
      expect(zoom?.querySelector("[aria-label='Zoom out']")).not.toBeNull();
      expect(zoom?.querySelector("[aria-label='Zoom in']")).not.toBeNull();
      expect(zoom?.querySelector(".zoom-percent")?.textContent).toContain("372%");
    } finally {
      unmount(host);
    }
  });

  it("every icon button keeps the Phase-13 a11y contract (aria-label + title, no label spans)", () => {
    const host = mountBar({ onRotateClockwise: NOOP, onRotateCounterClockwise: NOOP, onDeletePage: NOOP, hasFormFields: true });
    try {
      expect(host.querySelectorAll(".tool-btn-label").length).toBe(0);
      expect(host.querySelectorAll(".tool-btn-with-label").length).toBe(0);
      const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>("button.tool-btn"));
      expect(buttons.length).toBeGreaterThan(10);
      for (const btn of buttons) {
        expect(btn.getAttribute("aria-label")).toBeTruthy();
        expect(btn.getAttribute("title")).toBeTruthy();
      }
    } finally {
      unmount(host);
    }
  });

  it("keeps the stable control hooks (data-hand-toggle / rotate); the file actions moved to the title bar", () => {
    const host = mountBar({ onRotateClockwise: NOOP, onRotateCounterClockwise: NOOP, onDeletePage: NOOP });
    try {
      // The Tools palette toggle left the command bar: it is now the
      // floating badge on the page view's right edge (data-tools-badge
      // in DocumentView, keeping the data-tools-toggle e2e hook). The
      // bar itself must not render it.
      expect(host.querySelector("[data-tools-toggle]")).toBeNull();
      expect(host.querySelector("[data-tools-badge]")).toBeNull();
      expect(host.querySelector("[data-hand-toggle]")).not.toBeNull();
      expect(host.querySelector("[data-toolbar-rotate-cw]")).not.toBeNull();
      expect(host.querySelector("[data-toolbar-rotate-ccw]")).not.toBeNull();
      // Phase 22 — the file actions are NOT here any more.
      expect(host.querySelector("[data-toolbar-save-as]")).toBeNull();
      expect(host.querySelector("[data-toolbar-open]")).toBeNull();
    } finally {
      unmount(host);
    }
  });

  it("the page input commits through onJump (Enter)", () => {
    const onJump = vi.fn();
    const host = mountBar({ onJump });
    try {
      const input = host.querySelector<HTMLInputElement>(".page-input");
      act((): void => {
        input?.focus();
      });
      act((): void => {
        // jsdom + React controlled inputs: write through the native
        // value setter so React's value tracker registers the change
        // (a plain .value assignment is deduped away).
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, "7");
        input!.dispatchEvent(new Event("input", { bubbles: true }));
      });
      act((): void => {
        input!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      expect(onJump).toHaveBeenCalledWith("7");
    } finally {
      unmount(host);
    }
  });

  it("armed states reflect through aria-pressed + tool-btn-active (Sign / Hand)", () => {
    const host = mountBar({ signToolActive: true, handActive: true, onHandToggle: NOOP });
    try {
      const sign = host.querySelector<HTMLButtonElement>("[data-icon='sign']");
      expect(sign?.classList.contains("tool-btn-active")).toBe(true);
      expect(sign?.getAttribute("aria-pressed")).toBe("true");
      const hand = host.querySelector<HTMLButtonElement>("[data-hand-toggle]");
      expect(hand?.getAttribute("data-hand-active")).toBe("true");
      // The Tools palette toggle is no longer in the command bar — it
      // is the floating badge in DocumentView (data-tools-badge).
      expect(host.querySelector("[data-tools-toggle]")).toBeNull();
    } finally {
      unmount(host);
    }
  });

  it("Phase 91 — plain buttons carry the canonical btn + btn-toolbar classes", () => {
    const host = mountBar();
    try {
      const prev = host.querySelector<HTMLButtonElement>("[aria-label='Previous page']");
      expect(prev?.classList.contains("btn")).toBe(true);
      expect(prev?.classList.contains("btn-toolbar")).toBe(true);
      // The legacy hook stays a DOM alias (the toolbar CSS contract and
      // the e2e `button.tool-btn` selector keep resolving).
      expect(prev?.classList.contains("tool-btn")).toBe(true);
      // A plain control is NOT a toggle.
      expect(prev?.classList.contains("btn-toggle")).toBe(false);
      const merge = host.querySelector<HTMLButtonElement>("[data-icon='merge']");
      expect(merge?.classList.contains("btn")).toBe(true);
      expect(merge?.classList.contains("btn-toolbar")).toBe(true);
    } finally {
      unmount(host);
    }
  });

  it("Phase 91 — pressed toggles carry btn-toggle and keep aria-pressed=true", () => {
    const host = mountBar({ signToolActive: true, handActive: true, onHandToggle: NOOP });
    try {
      const sign = host.querySelector<HTMLButtonElement>("[data-icon='sign']");
      expect(sign?.classList.contains("btn-toggle")).toBe(true);
      expect(sign?.getAttribute("aria-pressed")).toBe("true");
      expect(sign?.classList.contains("tool-btn-active")).toBe(true);
      const hand = host.querySelector<HTMLButtonElement>("[data-hand-toggle]");
      expect(hand?.classList.contains("btn-toggle")).toBe(true);
      expect(hand?.getAttribute("aria-pressed")).toBe("true");
    } finally {
      unmount(host);
    }
  });
});