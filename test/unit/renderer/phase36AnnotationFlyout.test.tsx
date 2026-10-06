// @vitest-environment jsdom
//
// Phase 36 (chunk 3b) — the annotations flyout.
//
// The REVIEW dock's Annotate primary opens ONE expandable surface that hosts
// the EXISTING AnnotationToolbar (re-parented, selectors/aria kept). These
// tests pin: closed renders nothing, open renders exactly ONE surface carrying
// the real toolbar, arming a tool runs the existing annotation action, and Esc
// closes. Phase 37 (item 3): the surface is ONE row with no header/close row.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AnnotationFlyout } from "../../../src/renderer/components/AnnotationFlyout";
import { AnnotationToolbar } from "../../../src/renderer/annotations/AnnotationToolbar";
import { initialAnnotationToolState } from "../../../src/renderer/annotations/model";

interface Harness {
  host: HTMLElement;
  setOpen: (open: boolean) => void;
  unmount: () => void;
}

function renderFlyout(initialOpen: boolean, onClose = vi.fn()): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let open = initialOpen;
  const onAction = vi.fn();
  const draw = (): void => {
    act((): void => {
      root.render(
        <AnnotationFlyout open={open} onClose={onClose}>
          <AnnotationToolbar state={initialAnnotationToolState} onAction={onAction} theme="dark" />
        </AnnotationFlyout>,
      );
    });
  };
  draw();
  return {
    host,
    setOpen: (next): void => {
      open = next;
      draw();
    },
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

describe("Phase 36 (chunk 3b) — the annotations flyout surface", () => {
  it("renders nothing while closed", () => {
    const { host, unmount } = renderFlyout(false);
    try {
      expect(host.querySelector("[data-annotation-flyout]")).toBeNull();
      expect(host.querySelector("[data-annotation-toolbar]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("opens exactly ONE surface hosting the existing AnnotationToolbar", () => {
    const { host, unmount } = renderFlyout(true);
    try {
      expect(host.querySelectorAll("[data-annotation-flyout]")).toHaveLength(1);
      // The re-parented toolbar keeps its own selector/aria contract.
      expect(host.querySelectorAll("[data-annotation-toolbar]")).toHaveLength(1);
      expect(host.querySelector("[data-ann-tools-visible]")).not.toBeNull();
      expect(host.querySelector("[data-ann-dropdown-toggle]")).not.toBeNull();
      expect(host.querySelector("[data-annotation-flyout]")?.getAttribute("role")).toBe("dialog");
      expect(host.querySelector("[data-annotation-flyout]")?.getAttribute("aria-label")).toBe("Annotations");
    } finally {
      unmount();
    }
  });

  it("arming a tool from the flyout runs the existing annotation action", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onAction = vi.fn();
    act((): void => {
      root.render(
        <AnnotationFlyout open onClose={vi.fn()}>
          <AnnotationToolbar state={initialAnnotationToolState} onAction={onAction} theme="dark" />
        </AnnotationFlyout>,
      );
    });
    try {
      const tool = host.querySelector<HTMLButtonElement>(".ann-tools-visible [data-tool]");
      expect(tool).not.toBeNull();
      const toolId = tool?.getAttribute("data-tool");
      clickOn(tool as Element);
      expect(onAction).toHaveBeenCalledWith({ type: "set-tool", tool: toolId });
      // Arming a tool keeps the surface open (mirrors the persistent toolbar).
      expect(host.querySelector("[data-annotation-flyout]")).not.toBeNull();
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });

  it("renders ONE row with NO header and closes on Escape (Phase 37 item 3)", () => {
    const onClose = vi.fn();
    const { host, unmount } = renderFlyout(true, onClose);
    try {
      // The header/close row is gone; the dock verb + Esc are the dismissal.
      expect(host.querySelector(".annotation-flyout-header")).toBeNull();
      expect(host.querySelector(".annotation-flyout-close")).toBeNull();
      expect(host.querySelector(".annotation-flyout-title")).toBeNull();
      expect(host.querySelector("[data-annotation-flyout-row]")).not.toBeNull();
      act((): void => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("does not listen for Escape while closed", () => {
    const onClose = vi.fn();
    const { unmount } = renderFlyout(false, onClose);
    try {
      act((): void => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  // TFL-1018 (chunk C12) — documented native exception. The flyout keeps its
  // own CSS dock-anchored chassis: `.annotation-flyout-anchor` is the
  // canvas-bound, horizontally-centred bottom-centre home (left/right 0,
  // bottom 72px) and the surface carries role="dialog" + data-annotation-flyout
  // + data-flyout-* plus the useRowOverflow arrow ladder around its scroll
  // body. ContextToolbox places through placeControlNearAnchor from a rect
  // anchor, hardcodes role="toolbar"/data-context-toolbox and has no
  // scroll-body/arrow slot; styles.css is outside this chunk's writable set, so
  // the dock anchor, the ladder and the data-* hooks cannot all survive
  // adoption. This pins the surface as unchanged (never rendered through
  // ContextToolbox).
  it("stays a native exception: unchanged chassis with no ContextToolbox", () => {
    const { host, unmount } = renderFlyout(true);
    try {
      expect(host.querySelector("[data-context-toolbox]")).toBeNull();
      const root = host.querySelector("[data-annotation-flyout]");
      expect(root).not.toBeNull();
      expect(root?.getAttribute("role")).toBe("dialog");
      expect(root?.getAttribute("data-flyout-icon-only")).toBe("false");
      expect(root?.getAttribute("data-flyout-arrows")).toBe("false");
      expect(host.querySelector("[data-annotation-flyout-row]")).not.toBeNull();
      expect(host.querySelector("[data-annotation-flyout-scroll]")).not.toBeNull();
    } finally {
      unmount();
    }
  });
});