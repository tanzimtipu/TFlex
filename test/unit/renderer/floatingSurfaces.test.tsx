// @vitest-environment jsdom
//
// TFL-885 (chunk C2b) — floating interaction-surface primitives:
// ContextToolbox, PropertyPopover and Tooltip.
//
// Mounted with the raw react-dom/client + act pattern the sibling renderer
// tests use (dialogShell.test.tsx:15-50, interactionSurfaces.test.tsx:18-42).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ContextToolbox } from "../../../src/renderer/components/ContextToolbox";
import { PropertyPopover } from "../../../src/renderer/components/PropertyPopover";
import { Tooltip } from "../../../src/renderer/components/Tooltip";
import {
  CONTROL_BAR_HEIGHT,
  placeControlNearAnchor,
} from "../../../src/renderer/components/controlPlacement";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

/** Extract the balanced `{ ... }` body whose opening brace sits at `openBrace`. */
function balancedBlock(css: string, openBrace: number): string {
  let depth = 0;
  for (let i = openBrace; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(openBrace + 1, i);
    }
  }
  return css.slice(openBrace + 1);
}

function mount(node: ReactElement): { root: Root; container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(node);
  });
  return {
    root,
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Deterministic measured size: jsdom reports 0 for offset* by default, which
 *  would hide the clamping half of the placement maths. */
const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

function setBoxMetrics(width: number, height: number): void {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: (): number => width,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: (): number => height,
  });
}

function restoreBoxMetrics(): void {
  if (originalWidth !== undefined) {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalWidth);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth");
  }
  if (originalHeight !== undefined) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalHeight);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
  }
}

/** Controllable prefers-reduced-motion stub (same shape as
 *  interactionSurfaces.test.tsx). */
interface FakeMql {
  matches: boolean;
  media: string;
  addEventListener(_type: string, listener: (ev: { matches: boolean }) => void): void;
  removeEventListener(_type: string, listener: (ev: { matches: boolean }) => void): void;
}

function installReducedMotionStub(matches: boolean): void {
  const listeners = new Set<(ev: { matches: boolean }) => void>();
  const mql: FakeMql = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_type, listener): void => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener): void => {
      listeners.delete(listener);
    },
  };
  (window as unknown as { matchMedia: (query: string) => FakeMql }).matchMedia = (
    query: string,
  ): FakeMql => {
    mql.media = query;
    return mql;
  };
}

const originalMatchMedia = window.matchMedia;

function fire(target: EventTarget, type: string, init: EventInit = { bubbles: true }): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent(type, init));
  });
}

function keydown(target: EventTarget, key: string): void {
  act((): void => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

beforeEach((): void => {
  setBoxMetrics(200, 44);
});

afterEach((): void => {
  restoreBoxMetrics();
  if (originalMatchMedia === undefined) {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "matchMedia");
  } else {
    window.matchMedia = originalMatchMedia;
  }
});

describe("TFL-885 — ContextToolbox", () => {
  const anchor = { left: 900, top: 760, bottom: 800 };

  it("renders a nonmodal toolbar, flipped above and clamped near the edge", () => {
    const { container, cleanup } = mount(
      <ContextToolbox open anchor={anchor} ariaLabel="Selection actions" onClose={vi.fn()}>
        <button type="button" data-testid="tb-action">
          Delete
        </button>
      </ContextToolbox>,
    );
    const box = container.querySelector<HTMLElement>(".context-toolbox");
    expect(box).not.toBeNull();
    expect(box?.getAttribute("role")).not.toBe("dialog");
    expect(box?.getAttribute("aria-modal")).toBeNull();
    expect(box?.getAttribute("aria-label")).toBe("Selection actions");
    // Near the bottom/right edge the shared placement helper flips above and
    // clamps both axes (viewport 1024x768, size 200x44).
    expect(box?.classList.contains("context-toolbox--above")).toBe(true);
    expect(box?.getAttribute("data-placement")).toBe("above");
    expect(box?.style.left).toBe("820px");
    expect(box?.style.top).toBe("712px");
    cleanup();
  });

  it("does not trap focus: Tab is never swallowed", () => {
    const { container, cleanup } = mount(
      <ContextToolbox open anchor={anchor} ariaLabel="Selection actions" onClose={vi.fn()}>
        <button type="button" data-testid="tb-action">
          Delete
        </button>
      </ContextToolbox>,
    );
    const action = container.querySelector<HTMLButtonElement>('[data-testid="tb-action"]');
    expect(action).not.toBeNull();
    action?.focus();
    expect(document.activeElement).toBe(action);
    // jsdom does not implement Tab traversal, so the faithful proxy for "focus
    // can leave" is that no handler swallows the Tab keydown (a focus trap
    // would preventDefault and re-target focus).
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act((): void => {
      action?.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(false);
    cleanup();
  });

  it("stops pointerdown inside the toolbox so the canvas keeps its selection", () => {
    const onDocumentPointerDown = vi.fn();
    document.addEventListener("pointerdown", onDocumentPointerDown);
    const { container, cleanup } = mount(
      <ContextToolbox open anchor={anchor} ariaLabel="Selection actions" onClose={vi.fn()}>
        <button type="button" data-testid="tb-action">
          Delete
        </button>
      </ContextToolbox>,
    );
    const action = container.querySelector('[data-testid="tb-action"]') as Element;
    fire(action, "pointerdown");
    expect(onDocumentPointerDown).not.toHaveBeenCalled();
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    cleanup();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    const { cleanup } = mount(
      <ContextToolbox open anchor={anchor} ariaLabel="Selection actions" onClose={onClose}>
        <button type="button">Delete</button>
      </ContextToolbox>,
    );
    keydown(window, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("renders nothing while closed", () => {
    const { container, cleanup } = mount(
      <ContextToolbox open={false} anchor={anchor} ariaLabel="Selection actions">
        <button type="button">Delete</button>
      </ContextToolbox>,
    );
    expect(container.querySelector(".context-toolbox")).toBeNull();
    cleanup();
  });

  // TFL-987 — additive coordinate-space / data-hook options. Default behaviour
  // (window space, measured size) must stay byte-identical; the page-view path
  // must reproduce the legacy page-relative placement exactly.
  it("page-view coordinate space reproduces placeControlNearAnchor exactly (flip preserved at the page bottom)", () => {
    const pageAnchor = { left: 100, top: 760, bottom: 800 };
    const size = { width: 200, height: CONTROL_BAR_HEIGHT };
    const viewport = { width: 612, height: 792 };
    const expected = placeControlNearAnchor({
      anchor: pageAnchor,
      size,
      viewport,
    });
    const { container, cleanup } = mount(
      <ContextToolbox
        open
        anchor={pageAnchor}
        ariaLabel="Text box actions"
        coordinateSpace="page-view"
        size={size}
        viewport={viewport}
      >
        <button type="button">Confirm</button>
      </ContextToolbox>,
    );
    const box = container.querySelector<HTMLElement>(".context-toolbox");
    expect(box).not.toBeNull();
    expect(box?.classList.contains("context-toolbox--page-view")).toBe(true);
    // Same left/top as the direct shared-helper call, and the same flip.
    expect(box?.style.left).toBe(`${expected.left}px`);
    expect(box?.style.top).toBe(`${expected.top}px`);
    expect(expected.top).toBeLessThan(pageAnchor.top);
    expect(box?.getAttribute("data-placement")).toBe("above");
    cleanup();
  });

  it("ignores the page-view viewport in window space so the default is unchanged", () => {
    const { container, cleanup } = mount(
      <ContextToolbox
        open
        anchor={anchor}
        ariaLabel="Selection actions"
        viewport={{ width: 100, height: 100 }}
      >
        <button type="button">Delete</button>
      </ContextToolbox>,
    );
    const box = container.querySelector<HTMLElement>(".context-toolbox");
    // Measured 200x44 into the real jsdom window (1024x768): the same 820/712
    // the default test pins. A passed viewport must NOT leak into window space.
    expect(box?.style.left).toBe("820px");
    expect(box?.style.top).toBe("712px");
    expect(box?.classList.contains("context-toolbox--page-view")).toBe(false);
    cleanup();
  });

  it("forwards data-* hooks to the root and keeps role=toolbar", () => {
    const { container, cleanup } = mount(
      <ContextToolbox
        open
        anchor={anchor}
        ariaLabel="Text box actions"
        dataAttributes={{ "data-edit-box-id": "tb-1", "data-edit-box-toolbar": "true" }}
      >
        <button type="button">Confirm</button>
      </ContextToolbox>,
    );
    const box = container.querySelector<HTMLElement>("[data-context-toolbox]");
    expect(box).not.toBeNull();
    expect(box?.getAttribute("role")).toBe("toolbar");
    expect(box?.getAttribute("data-edit-box-id")).toBe("tb-1");
    expect(box?.getAttribute("data-edit-box-toolbar")).toBe("true");
    cleanup();
  });
});

// DEF-607 — the page-view bars (EditOverlay TextBoxToolbar / PlacementToolbar)
// compute `position: fixed` because `.context-toolbox--page-view` was nested
// inside `@media (pointer: coarse)` and so inert on a fine-pointer desktop,
// letting the equal-specificity base `.context-toolbox { position: fixed }` win.
// jsdom cannot compute the cascade, so this is a textual scan of styles.css (the
// pattern bug013 / def311 use).
describe("DEF-607 — the page-view ContextToolbox is ABSOLUTE on every pointer type", () => {
  it("declares .context-toolbox--page-view { position: absolute } at top level, outside the coarse-pointer block", () => {
    const css = readFileSync(STYLES_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // Non-page-view callers keep the window-fixed base rule.
    expect(css).toMatch(/\.context-toolbox\s*\{[^}]*position:\s*fixed/);
    // The page-view variant resolves to absolute...
    const rule = /\.context-toolbox--page-view\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toMatch(/position:\s*absolute/);
    // ...and lives at top level: no coarse-pointer block may contain it, or a
    // fine pointer never sees the rule (the DEF-607 defect).
    const coarseBodies: string[] = [];
    const coarseRe = /@media\s*\(pointer:\s*coarse\)\s*\{/g;
    for (let m = coarseRe.exec(css); m !== null; m = coarseRe.exec(css)) {
      coarseBodies.push(balancedBlock(css, css.indexOf("{", m.index)));
    }
    expect(coarseBodies.length).toBeGreaterThan(0);
    for (const body of coarseBodies) {
      expect(body).not.toMatch(/context-toolbox--page-view/);
    }
    // The toolbox's own block keeps its real intent: the 44px touch target floor.
    const toolboxBody = coarseBodies.find((body) => body.includes(".context-toolbox-actions"));
    expect(toolboxBody, "the coarse-pointer target sizing for the toolbox survives").toBeDefined();
    expect(toolboxBody).toMatch(
      /\.context-toolbox-actions\s*\{[^}]*min-height:\s*var\(--control-height-large\)/,
    );
  });
});

describe("TFL-885 — PropertyPopover", () => {
  it("renders a nonmodal labelled surface with body and footer slots", () => {
    const { container, cleanup } = mount(
      <PropertyPopover
        open
        label="Stroke width"
        onClose={vi.fn()}
        width={280}
        footer={<button type="button">Apply</button>}
      >
        <input data-testid="pp-input" />
      </PropertyPopover>,
    );
    const popover = container.querySelector<HTMLElement>(".property-popover");
    expect(popover).not.toBeNull();
    expect(popover?.getAttribute("aria-modal")).toBeNull();
    expect(popover?.getAttribute("aria-label")).toBe("Stroke width");
    expect(popover?.querySelector(".property-popover-title")?.textContent).toBe("Stroke width");
    expect(popover?.querySelector('[data-testid="pp-input"]')).not.toBeNull();
    expect(popover?.querySelector(".property-popover-footer")).not.toBeNull();
    expect(popover?.style.width).toBe("280px");
    cleanup();
  });

  it("dismisses on an outside pointerdown without swallowing it", () => {
    const onClose = vi.fn();
    const { cleanup } = mount(
      <PropertyPopover open label="Stroke width" onClose={onClose}>
        <input />
      </PropertyPopover>,
    );
    fire(document.body, "pointerdown");
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("does not dismiss on a pointerdown inside the popover", () => {
    const onClose = vi.fn();
    const { container, cleanup } = mount(
      <PropertyPopover open label="Stroke width" onClose={onClose}>
        <input />
      </PropertyPopover>,
    );
    fire(container.querySelector(".property-popover") as Element, "pointerdown");
    expect(onClose).not.toHaveBeenCalled();
    cleanup();
  });

  it("dismisses on Escape", () => {
    const onClose = vi.fn();
    const { cleanup } = mount(
      <PropertyPopover open label="Stroke width" onClose={onClose}>
        <input />
      </PropertyPopover>,
    );
    keydown(window, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("renders nothing while closed", () => {
    const { container, cleanup } = mount(
      <PropertyPopover open={false} label="Stroke width">
        <input />
      </PropertyPopover>,
    );
    expect(container.querySelector(".property-popover")).toBeNull();
    cleanup();
  });
});

describe("TFL-885 — Tooltip", () => {
  function renderTooltip(): { container: HTMLElement; cleanup: () => void } {
    return mount(
      <Tooltip label="Delete selection" shortcut="Del" testId="tt">
        <button type="button" data-testid="tt-control">
          Delete
        </button>
      </Tooltip>,
    );
  }

  it("shows a role=tooltip element on hover and wires aria-describedby to it", () => {
    const { container, cleanup } = renderTooltip();
    const control = container.querySelector('[data-testid="tt-control"]') as HTMLElement;
    const describedBy = control.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(container.querySelector('[role="tooltip"]')).toBeNull();

    fire(container.querySelector(".tooltip-control") as Element, "mouseover");
    const tip = container.querySelector<HTMLElement>('[role="tooltip"]');
    expect(tip).not.toBeNull();
    expect(tip?.id).toBe(describedBy);
    expect(tip?.textContent).toContain("Delete selection");
    expect(tip?.textContent).toContain("Del");
    cleanup();
  });

  it("also shows on focus and hides on blur / mouseleave / Escape", () => {
    const { container, cleanup } = renderTooltip();
    const control = container.querySelector('[data-testid="tt-control"]') as HTMLElement;
    const wrapper = container.querySelector(".tooltip-control") as Element;

    act((): void => {
      control.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(container.querySelector('[role="tooltip"]')).not.toBeNull();

    act((): void => {
      control.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(container.querySelector('[role="tooltip"]')).toBeNull();

    fire(wrapper, "mouseover");
    expect(container.querySelector('[role="tooltip"]')).not.toBeNull();
    fire(wrapper, "mouseout");
    expect(container.querySelector('[role="tooltip"]')).toBeNull();

    fire(wrapper, "mouseover");
    expect(container.querySelector('[role="tooltip"]')).not.toBeNull();
    keydown(control, "Escape");
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
    cleanup();
  });

  it("still shows under reduced motion, through the no-travel keyframe class", () => {
    installReducedMotionStub(true);
    const { container, cleanup } = renderTooltip();
    fire(container.querySelector(".tooltip-control") as Element, "mouseover");
    const tip = container.querySelector<HTMLElement>('[role="tooltip"]');
    expect(tip).not.toBeNull();
    expect(tip?.classList.contains("tooltip-element--instant")).toBe(true);
    expect(tip?.getAttribute("data-motion")).toBe("reduced");
    // The reduced path never travels: no inline transform is ever set.
    expect(tip?.style.transform).toBe("");
    cleanup();
  });
});