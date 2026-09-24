// @vitest-environment jsdom
//
// Phase 37 chunk 3 — the Action Dock (operator items 2, 6, 7, 20, 21).
//
//   item 2/6  ONE ROW, never stacked, and the responsive ladder in the exact
//             order: Inspector -> thumbnail panel -> labels -> shrink+arrows.
//   item 21   the full relevant tool set per stage by default, with a working
//             un-pin (persisted in `dockUnpinned`) and the Ctrl+K hint.
//   item 7    the dock's tokens resolve in all three themes.
//   item 20   the Watermark gate reflects the real document state.
//
// The pure ladder + curation models are pinned directly; the component is
// mounted for the DOM contracts (one row, arrows, hint, un-pin).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { ActionDock, type ActionDockProps } from "../../../src/renderer/components/ActionDock";
import { useRowOverflow } from "../../../src/renderer/hooks/useRowOverflow";
import {
  DOCK_AVAILABILITY_REASON,
  DOCK_MAX_UNPINNED,
  dockAvailabilityFor,
  dockEnabledWithFallback,
  pinDockTool,
  sanitizeDockUnpinned,
  unpinDockTool,
} from "../../../src/renderer/state/dockModel";
import {
  DOCK_LADDER_BREAKPOINTS,
  resolveDockLadder,
} from "../../../src/renderer/state/dockResponsive";
import {
  dockRelevantIdsForStage,
  dockToolsForStage,
  isDockHostedAction,
  toolById,
} from "../../../src/renderer/state/toolsRegistry";
import type { DockAvailabilityArgs } from "../../../src/renderer/state/dockModel";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const CSS = readFileSync(STYLES_PATH, "utf8");

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

const verbIds = (host: HTMLElement, group = "primary"): string[] =>
  [
    ...(host.querySelector(`[data-dock-group="${group}"]`) ?? host).querySelectorAll<HTMLElement>(
      "[data-dock-verb]",
    ),
  ].map((el) => el.getAttribute("data-dock-verb") ?? "");

// ---------------------------------------------------------------------------
// Item 2 + 6 � the responsive ladder (pure model)
// ---------------------------------------------------------------------------

describe("Phase 37 item 2/6 � the responsive ladder", () => {
  it("engages the rungs in the spec's exact order as the window shrinks, reversing when it grows", () => {
    // Wide: nothing shed.
    expect(resolveDockLadder(1920)).toEqual({
      inspectorCollapsed: false,
      panelCollapsed: false,
      iconOnly: false,
      arrows: false,
    });
    // Rung 1 only.
    expect(resolveDockLadder(1100)).toEqual({
      inspectorCollapsed: true,
      panelCollapsed: false,
      iconOnly: false,
      arrows: false,
    });
    // Rungs 1 + 2.
    expect(resolveDockLadder(950)).toEqual({
      inspectorCollapsed: true,
      panelCollapsed: true,
      iconOnly: false,
      arrows: false,
    });
    // Rungs 1 + 2 + 3.
    expect(resolveDockLadder(800)).toEqual({
      inspectorCollapsed: true,
      panelCollapsed: true,
      iconOnly: true,
      arrows: false,
    });
    // All four at the supported floor.
    expect(resolveDockLadder(640)).toEqual({
      inspectorCollapsed: true,
      panelCollapsed: true,
      iconOnly: true,
      arrows: true,
    });
  });

  it("growing reverses the ladder one rung at a time", () => {
    const widths = [640, 800, 950, 1100, 1920];
    const states = widths.map((w) => resolveDockLadder(w));
    // As width grows, each rung only ever turns OFF, and in reverse order.
    for (let i = 1; i < states.length; i += 1) {
      const prev = states[i - 1];
      const next = states[i];
      expect(prev.inspectorCollapsed >= next.inspectorCollapsed).toBe(true);
      expect(prev.panelCollapsed >= next.panelCollapsed).toBe(true);
      expect(prev.iconOnly >= next.iconOnly).toBe(true);
      expect(prev.arrows >= next.arrows).toBe(true);
    }
  });

  it("orders the thresholds widest first and strictly", () => {
    const b = DOCK_LADDER_BREAKPOINTS;
    expect(b.inspector).toBeGreaterThan(b.panel);
    expect(b.panel).toBeGreaterThan(b.labels);
    expect(b.labels).toBeGreaterThan(b.arrows);
  });
});

// ---------------------------------------------------------------------------
// Item 2 � ONE ROW, never stacked
// ---------------------------------------------------------------------------

describe("Phase 37 item 2 � the dock never stacks", () => {
  it("declares nowrap on the dock and every verb group (no wrap rule left)", () => {
    const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.action-dock\s*\{[^}]*flex-wrap:\s*nowrap/s);
    expect(css).toMatch(/\.action-dock-group\s*\{[^}]*flex-wrap:\s*nowrap/s);
    // No `flex-wrap: wrap` survives in the dock's rules.
    expect(css).not.toMatch(/\.action-dock[^{]*\{[^}]*flex-wrap:\s*wrap/s);
  });

  it("renders a single primary group and no wrapped row at every supported width", () => {
    for (const width of [640, 720, 800, 880, 1000, 1200, 1440, 1920]) {
      const ladder = resolveDockLadder(width);
      const { host, unmount } = renderDock({ activeStage: "pages", canvasWidth: width, ladder });
      try {
        expect(host.querySelectorAll('[data-dock-group="primary"]'), `w=${width}`).toHaveLength(1);
        // At most primary + pins groups: never more rows of verbs.
        expect(
          host.querySelectorAll("[data-dock-group]").length,
          `w=${width}`,
        ).toBeLessThanOrEqual(2);
// DEF-334 — the ladder's 880 rung is the icon-only authority.
        expect(
          host.querySelector("[data-action-dock]")?.getAttribute("data-dock-icon-only"),
          `w=${width}`,
        ).toBe(ladder.iconOnly ? "true" : "false");
        // The arrows rung always offers its arrows.
        if (ladder.arrows) {
          expect(
            host.querySelector("[data-action-dock]")?.getAttribute("data-dock-arrows"),
            `w=${width}`,
          ).toBe("true");
        }
      } finally {
        unmount();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Item 6 � the arrows scroll the verbs
// ---------------------------------------------------------------------------

describe("Phase 37 item 6 � the scroll arrows", () => {
  it("shows left/right arrows only at the last rung and scrolls the verb strip both ways", () => {
    const scrollBy = vi.fn();
    const { host, unmount } = renderDock({ activeStage: "review", canvasWidth: 640 });
    try {
      const root = host.querySelector("[data-action-dock]");
      expect(root?.getAttribute("data-dock-arrows")).toBe("true");
      // Every review verb is present (nothing hidden behind a `...` menu).
      expect(verbIds(host)).toEqual(dockToolsForStage("review").map((t) => t.id));
      expect(host.querySelector("[data-dock-overflow]")).toBeNull();
      const scroller = host.querySelector<HTMLElement>("[data-dock-scroll]");
      expect(scroller).not.toBeNull();
      scroller!.scrollBy = scrollBy;
      const left = host.querySelector<HTMLElement>('[data-dock-arrow="left"]');
      const right = host.querySelector<HTMLElement>('[data-dock-arrow="right"]');
      act((): void => {
        right?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 160 }));
      act((): void => {
        left?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: -160 }));
    } finally {
      unmount();
    }
  });

  it("hides the arrows above the last rung", () => {
    const { host, unmount } = renderDock({ activeStage: "deliver", canvasWidth: 1400 });
    try {
      expect(host.querySelector("[data-action-dock]")?.getAttribute("data-dock-arrows")).toBe("false");
      expect(host.querySelector("[data-dock-arrow]")).toBeNull();
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-334 — resolveDockLadder is the AUTHORITY for hiding the labels
// ---------------------------------------------------------------------------

describe('DEF-334 — the 880 rung decides the labels, the measured band does not', () => {
  it('keeps every PAGES label at the ladder-idle width even with an icon-only canvas host', () => {
    // The canvas host is 700 (icon-only zone) while the ladder is idle at
    // 1440: the labels must stay, routed into the arrows lane if they cannot
    // fit, instead of being silently dropped (the re-opened DEF-330).
    const { host, unmount } = renderDock({
      activeStage: 'pages',
      canvasWidth: 700,
      ladder: resolveDockLadder(1440),
    });
    try {
      expect(host.querySelector('[data-action-dock]')?.getAttribute('data-dock-icon-only')).toBe('false');
      expect(host.querySelectorAll('.action-dock-label')).toHaveLength(
        dockToolsForStage('pages').length,
      );
      expect(host.querySelectorAll('[data-dock-group="primary"]')).toHaveLength(1);
    } finally {
      unmount();
    }
  });

  it('hides the labels only below the 880 rung, whatever the measured width', () => {
    const { host, unmount } = renderDock({
      activeStage: 'pages',
      canvasWidth: 1440,
      ladder: resolveDockLadder(879),
    });
    try {
      expect(host.querySelector('[data-action-dock]')?.getAttribute('data-dock-icon-only')).toBe('true');
      expect(host.querySelectorAll('.action-dock-label')).toHaveLength(0);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-337 — the arrows render only when the row genuinely overflows
// ---------------------------------------------------------------------------

/** Force layout widths on the matching scroll containers (jsdom has no layout).
 *  Returns a restore function. */
function stubScrollWidths(attr: string, client: number, scroll: number): () => void {
  const hadClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const hadScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement): number {
      return this.hasAttribute(attr) ? client : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement): number {
      return this.hasAttribute(attr) ? scroll : 0;
    },
  });
  return (): void => {
    if (hadClient === undefined) {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    } else {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', hadClient);
    }
    if (hadScroll === undefined) {
      delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    } else {
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', hadScroll);
    }
  };
}

describe('DEF-337 — the arrows are gated on a real overflow', () => {
  it('omits the arrows when the icon-only row already fits (DELIVER at 700)', () => {
    const restore = stubScrollWidths('data-dock-scroll', 195, 195);
    const { host, unmount } = renderDock({ activeStage: 'deliver', canvasWidth: 700 });
    try {
      expect(host.querySelector('[data-action-dock]')?.getAttribute('data-dock-arrows')).toBe('false');
      expect(host.querySelector('[data-dock-arrow]')).toBeNull();
    } finally {
      unmount();
      restore();
    }
  });

  it('renders and wires the arrows when the row overflows', () => {
    const restore = stubScrollWidths('data-dock-scroll', 195, 420);
    const { host, unmount } = renderDock({ activeStage: 'deliver', canvasWidth: 700 });
    try {
      expect(host.querySelector('[data-action-dock]')?.getAttribute('data-dock-arrows')).toBe('true');
      expect(host.querySelectorAll('[data-dock-arrow]')).toHaveLength(2);
    } finally {
      unmount();
      restore();
    }
  });

  // -- the reopened DEF-337: the measurement must not depend on the arrows ---
  //
  // The dock's container used to collapse when the arrows were hidden, so the
  // hook's own "no overflow" verdict removed the box it had just measured
  // (0 -> overflow -> box -> fits -> no overflow -> no box -> 0 ...). These
  // tests pin the two rules that end that loop: a zero-width measurement is
  // UNKNOWN (never overflow), and a repeat at the same width cannot churn.

  /** A controllable ResizeObserver: capture the callbacks and fire them by
   *  hand so a test can deliver the second, post-layout measurement the real
   *  loop depends on. Restores the previous global on teardown. */
  function installResizeObserver(): { fireAll: () => void; restore: () => void } {
    const callbacks: ResizeObserverCallback[] = [];
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: FakeResizeObserver,
    });
    return {
      fireAll: (): void => {
        for (const callback of [...callbacks]) callback([], {} as ResizeObserver);
      },
      restore: (): void => {
        if (prior === undefined) {
          delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
        } else {
          Object.defineProperty(globalThis, 'ResizeObserver', prior);
        }
      },
    };
  }

  function OverflowProbe(props: { el: HTMLElement; enabled: boolean }): ReactElement {
    const overflows = useRowOverflow({ current: props.el }, props.enabled);
    return <div data-probe-overflow={overflows ? 'true' : 'false'} />;
  }

  function probeState(host: HTMLElement): string | null {
    return host.querySelector('[data-probe-overflow]')?.getAttribute('data-probe-overflow') ?? null;
  }

  function mountProbe(el: HTMLElement): { host: HTMLElement; unmount: () => void } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(<OverflowProbe el={el} enabled />);
    });
    return {
      host,
      unmount: (): void => {
        act((): void => root.unmount());
        host.remove();
      },
    };
  }

  it('treats a zero-width first measurement as unknown, then settles on a fitting row', () => {
    const ro = installResizeObserver();
    const el = document.createElement('div');
    let client = 0;
    let scroll = 0;
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: (): number => client });
    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: (): number => scroll });
    const { host, unmount } = mountProbe(el);
    try {
      // First measurement: the container has no box (display: contents). This
      // must read as unknown, NOT as overflow - this is the loop's first half
      // and the exact assertion the old hook fails.
      expect(probeState(host)).toBe('false');

      // The box appears and the row FITS: still no overflow.
      client = 195;
      scroll = 195;
      act((): void => ro.fireAll());
      expect(probeState(host)).toBe('false');

      // A repeat measurement at the same width must not churn the state.
      act((): void => ro.fireAll());
      expect(probeState(host)).toBe('false');
    } finally {
      unmount();
      ro.restore();
    }
  });

  it('reports overflow for a genuinely overflowing row, stable across measurements', () => {
    const ro = installResizeObserver();
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: (): number => 195 });
    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: (): number => 420 });
    const { host, unmount } = mountProbe(el);
    try {
      expect(probeState(host)).toBe('true');
      act((): void => ro.fireAll());
      expect(probeState(host)).toBe('true');
    } finally {
      unmount();
      ro.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Item 21 — the Ctrl+K hint
// ---------------------------------------------------------------------------

describe("Phase 37 item 21 � the Ctrl+K hint", () => {
  it("renders a small hint line above the dock at usable widths", () => {
    const { host, unmount } = renderDock({ canvasWidth: 1400 });
    try {
      const hint = host.querySelector<HTMLElement>("[data-dock-hint]");
      expect(hint).not.toBeNull();
      expect(hint?.textContent?.replace(/\s+/g, " ").trim()).toBe("Search all tools: Ctrl+K");
      expect(hint?.querySelector("kbd")?.textContent).toBe("Ctrl+K");
    } finally {
      unmount();
    }
  });

  it("hides the hint at the smallest rung with the rest of the ladder", () => {
    const { host, unmount } = renderDock({ activeStage: "pages", canvasWidth: 640 });
    try {
      expect(host.querySelector("[data-dock-arrow]")).not.toBeNull();
      expect(host.querySelector("[data-dock-hint]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("is keyed on the ladder rung, not the measured overflow lane (present at 1440, absent at 719)", () => {
    // 1440: the ladder is idle, but a narrow canvas host forces the measured
    // label-overflow LANE on. The hint must still show - it is gated on the
    // width rung (visible at every width >= 720), not the lane.
    const wide = renderDock({
      activeStage: "pages",
      canvasWidth: 700,
      ladder: resolveDockLadder(1440),
    });
    try {
      expect(wide.host.querySelector("[data-action-dock]")?.getAttribute("data-dock-arrows-lane")).toBe("true");
      expect(wide.host.querySelector("[data-dock-hint]")).not.toBeNull();
    } finally {
      wide.unmount();
    }
    // 719: the ladder's narrowest rung - the hint is shed.
    const narrow = renderDock({
      activeStage: "pages",
      canvasWidth: 719,
      ladder: resolveDockLadder(719),
    });
    try {
      expect(narrow.host.querySelector("[data-dock-hint]")).toBeNull();
    } finally {
      narrow.unmount();
    }
  });

  it("themes the hint from shared tokens (no hardcoded colour)", () => {
    const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const hintRule = /\.action-dock-hint\s*\{([^}]*)\}/s.exec(css);
    expect(hintRule).not.toBeNull();
    expect(hintRule?.[1]).toMatch(/color:\s*var\(--fg-faint\)/);
    expect(hintRule?.[1]).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});

// ---------------------------------------------------------------------------
// Item 21 � all relevant tools by default, un-pin / re-pin, unknown-id drop
// ---------------------------------------------------------------------------

describe("Phase 37 item 21 � the dock's default contents", () => {
  it("carries the full relevant set per stage (equal to the derived rule)", () => {
    for (const stage of ["pages", "edit", "review", "deliver"] as const) {
      expect(
        new Set(dockToolsForStage(stage).map((e) => e.id)),
        stage,
      ).toEqual(new Set(dockRelevantIdsForStage(stage)));
    }
    // Every panel/navigation-only entry stays out.
    const docked = Object.values(
      Object.fromEntries(
        (["pages", "edit", "review", "deliver"] as const).map((s) => [s, dockToolsForStage(s)]),
      ),
    ).flatMap((entries) => entries.map((e) => e.id));
    for (const id of ["renumberPages", "pageThumbnails", "outlinePanel", "clearPageSelection", "dragPage"]) {
      expect(docked, id).not.toContain(id);
    }
  });

  it("hides an un-pinned default verb from the dock", () => {
    const { host, unmount } = renderDock({ activeStage: "pages", dockUnpinned: ["split"] });
    try {
      expect(verbIds(host)).not.toContain("split");
      // Everything else survives.
      expect(verbIds(host)).toContain("rotate");
      expect(verbIds(host)).toContain("merge");
    } finally {
      unmount();
    }
  });

  it("drops unknown un-pin ids, de-dupes and caps (settings contract)", () => {
    expect(sanitizeDockUnpinned(["split", "split", "nope", "", 7, "rotate"])).toEqual([
      "split",
      "rotate",
    ]);
    expect(sanitizeDockUnpinned("split")).toEqual([]);
    const many = Array.from({ length: DOCK_MAX_UNPINNED + 25 }, () => "rotate");
    expect(sanitizeDockUnpinned(many).length).toBeLessThanOrEqual(DOCK_MAX_UNPINNED);
  });

  it("pin RESTORES an un-pinned default verb (no redundant pin) and pins a cross-stage tool", () => {
    const restored = pinDockTool(
      { pins: [], unpinned: ["split"] },
      "split",
      ["rotate", "split"],
    );
    expect(restored).toEqual({ pins: [], unpinned: [] });
    const crossStage = pinDockTool(
      { pins: [], unpinned: ["split"] },
      "watermark",
      ["rotate", "split"],
    );
    expect(crossStage.pins).toEqual(["watermark"]);
    expect(crossStage.unpinned).toEqual(["split"]);
  });

  it("unpin removes an explicit pin AND records a default verb as un-pinned", () => {
    expect(unpinDockTool({ pins: ["watermark"], unpinned: [] }, "watermark", ["rotate"])).toEqual({
      pins: [],
      unpinned: [],
    });
    expect(unpinDockTool({ pins: [], unpinned: [] }, "split", ["rotate", "split"])).toEqual({
      pins: [],
      unpinned: ["split"],
    });
  });

  it("keeps a cross-stage pin visible in a stage whose default set does not hold it", () => {
    const { host, unmount } = renderDock({
      activeStage: "pages",
      dockPins: ["watermark"],
      dockUnpinned: ["rotate"],
    });
    try {
      expect(verbIds(host, "pins")).toEqual(["watermark"]);
      expect(verbIds(host)).not.toContain("rotate");
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Item 7 � the dock's tokens resolve in all three themes
// ---------------------------------------------------------------------------

const ANIMATIONS_PATH = resolve(__dirname, "../../../src/renderer/styles/animations.css");

/** Every `--name: value` declaration inside the blocks whose selector matches. */
function declarations(css: string, selectorTest: (sel: string) => boolean): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    const selector = match[1].trim();
    if (!selectorTest(selector)) continue;
    const body = match[2];
    const re2 = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let m2: RegExpExecArray | null;
    while ((m2 = re2.exec(body)) !== null) {
      if (!out.has(m2[1])) out.set(m2[1], m2[2].trim());
    }
  }
  return out;
}

/** The `var(--x)` names a set of rule bodies consumes. */
function consumedTokens(bodies: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const body of bodies) {
    const re = /var\((--[a-z0-9-]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) out.add(m[1]);
  }
  return out;
}

/** Resolve a token through `scope` then the shared root, following nested
 *  `var()` chains. Returns null when any link is undefined. */
function resolveToken(
  token: string,
  scope: Map<string, string>,
  root: Map<string, string>,
  seen = new Set<string>(),
): string | null {
  if (seen.has(token)) return null;
  seen.add(token);
  const value = scope.get(token) ?? root.get(token);
  if (value === undefined) return null;
  const nested = /var\((--[a-z0-9-]+)/i.exec(value);
  if (nested === null) return value;
  return resolveToken(nested[1], scope, root, seen);
}

describe("Phase 37 item 7 � the dock's tokens resolve in every theme", () => {
  // Comments are stripped before parsing: a comment containing a brace would
  // otherwise corrupt the flat rule scanner.
  const CLEAN = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const root = declarations(CLEAN, (sel) => /:root\s*$/.test(sel) && !sel.includes("data-theme"));
  const animations = declarations(
    readFileSync(ANIMATIONS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""),
    (sel) => /:root\s*$/.test(sel) && !sel.includes("data-theme"),
  );
  animations.forEach((value, key) => {
    if (!root.has(key)) root.set(key, value);
  });
  const dark = declarations(CLEAN, (sel) => sel.includes('data-theme="dark"'));
  const frosted = declarations(CLEAN, (sel) => sel.includes('data-theme="frosted"'));

  const dockBodies = ((): string[] => {
    const out: string[] = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(CLEAN)) !== null) {
      if (match[1].includes(".action-dock")) out.push(match[2]);
    }
    return out;
  })();

  it("the dock has a real token surface (the sweep is not vacuous)", () => {
    const tokens = consumedTokens(dockBodies);
    expect(tokens.size).toBeGreaterThan(10);
    expect([...tokens]).toContain("--bg-elevated");
    expect([...tokens]).toContain("--glass-border");
    expect([...tokens]).toContain("--fg-muted");
    expect([...tokens]).toContain("--accent");
  });

  it("every dock token resolves in the root/light theme", () => {
    const tokens = consumedTokens(dockBodies);
    for (const token of tokens) {
      // The dock's own runtime geometry vars are published inline by the
      // component (with CSS fallbacks); they are not theme tokens.
      if (/^--dock-/.test(token)) continue;
      expect(resolveToken(token, root, root), `light: ${token}`).not.toBeNull();
    }
  });

  it("every dock token resolves in dark and frosted", () => {
    const tokens = consumedTokens(dockBodies);
    for (const token of tokens) {
      if (/^--dock-/.test(token)) continue;
      expect(resolveToken(token, dark, root), `dark: ${token}`).not.toBeNull();
      expect(resolveToken(token, frosted, root), `frosted: ${token}`).not.toBeNull();
    }
  });

  it("introduces no hardcoded colour in any dock rule", () => {
    for (const body of dockBodies) {
      expect(body, "hardcoded colour").not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// Item 20 � the watermark availability gate
// ---------------------------------------------------------------------------

const GATE_BASE: Omit<DockAvailabilityArgs, "appEnabled"> = {
  pageSelectionCount: 0,
  editModeOpen: false,
  canUndo: false,
  canRedo: false,
  viewActions: {},
};

describe("Phase 37 item 20 � Watermark reflects the real document state", () => {
  it("watermark is now a dock-hosted REVIEW verb", () => {
    expect(isDockHostedAction("watermark")).toBe(true);
    expect(dockToolsForStage("review").map((e) => e.id)).toContain("watermark");
  });

  it("enabled with a document open and disabled with none, with the right reason", () => {
    const entry = toolById("watermark");
    expect(entry).toBeDefined();
    expect(
      dockEnabledWithFallback(entry!, { ...GATE_BASE, appEnabled: () => true }),
      "document open",
    ).toBe(true);
    expect(
      dockEnabledWithFallback(entry!, { ...GATE_BASE, appEnabled: () => false }),
      "no document",
    ).toBe(false);
    expect(entry!.availability).toBe("document");
    expect(DOCK_AVAILABILITY_REASON[entry!.availability]).toBe("Open a document first");
  });

  it("a PINNED panel/palette verb the pane does not govern falls back to the app gate", () => {
    // `renumberPages` lives on the PAGES panel and is NOT dock-hosted, so
    // `dockAvailabilityFor` is tri-state `undefined`; the dock must still honour
    // the app gate for it (the old coercion to `false` was the item-20 cause).
    const entry = toolById("renumberPages");
    expect(entry).toBeDefined();
    expect(dockAvailabilityFor(entry!, { ...GATE_BASE, appEnabled: () => true })).toBeUndefined();
    expect(dockEnabledWithFallback(entry!, { ...GATE_BASE, appEnabled: () => true })).toBe(true);
    expect(dockEnabledWithFallback(entry!, { ...GATE_BASE, appEnabled: () => false })).toBe(false);
  });
});
