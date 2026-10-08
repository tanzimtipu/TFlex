// @vitest-environment jsdom
//
// Phase 119 (TFL-1341 chunk F2) — the Adaptive Shell keyboard / focus contract.
//
// Pins the invariants the shell must keep no matter how the layout adapts:
//   (a) visible focus is INDEPENDENT of selected / hover and rides the shared
//       `--focus-ring` token through `:focus-visible`;
//   (b) focus order is natural — no positive `tabindex` in the shell sources;
//   (c) the attached panels (Inspector / ContextPanel) do NOT trap focus or
//       claim modal semantics while a DialogShell still DOES;
//   (d) the renderer's shortcut reference (App.tsx `menuGroups`) only lists
//       accelerators the main process actually registers;
//   (e) no interactive element is nested inside another in the ActionDock or the
//       document rail — the single Phase 105 tab-close-inside-tab pattern is the
//       one recorded exception.
//
// Source scans mirror test/unit/renderer/foundationGuards.test.ts (node:fs,
// explicit file list); the render harness mirrors
// test/unit/renderer/dialogShell.test.tsx:1-40.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ActionDock, type ActionDockProps, type DockBulkActions } from "../../../src/renderer/components/ActionDock";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import { DialogShell } from "../../../src/renderer/components/DialogShell";
import { DocumentRail } from "../../../src/renderer/components/DocumentRail";
import { Inspector } from "../../../src/renderer/components/Inspector";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { OutlineNode } from "../../../src/renderer/pdf/pdfjs";

const RENDERER = resolve(process.cwd(), "src/renderer");

function readRenderer(rel: string): string {
  return readFileSync(resolve(RENDERER, rel), "utf8");
}

function readRepo(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

function mount(node: React.ReactElement): { container: HTMLElement; root: Root; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(node);
  });
  return {
    container,
    root,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

afterEach((): void => {
  document.body.innerHTML = "";
});

// --- styles.css block parsing (comment-stripped, non-greedy rule blocks) -----

interface CssBlock {
  selector: string;
  body: string;
}

function cssBlocks(raw: string): CssBlock[] {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: CssBlock[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const selector = (m[1] ?? "").trim();
    if (selector === "" || selector.startsWith("@")) continue;
    out.push({ selector, body: m[2] ?? "" });
  }
  return out;
}

function ruleBodies(blocks: readonly CssBlock[], selector: string): string[] {
  return blocks
    .filter((b) => b.selector.split(",").map((s) => s.trim()).includes(selector))
    .map((b) => b.body);
}

/** Strip the state suffix so a `:hover` / `.active` rule maps back to its control. */
function baseSelector(selector: string): string {
  return selector
    .replace(/\[aria-selected[^\]]*\]/g, "")
    .replace(/\.active\b/g, "")
    .replace(/\.selected\b/g, "")
    .replace(/:hover\b/g, "")
    .replace(/:active\b/g, "")
    .trim();
}

// ---------------------------------------------------------------------------
// (a) VISIBLE FOCUS — the --focus-ring based :focus-visible contract holds.
// ---------------------------------------------------------------------------

describe("Phase 119 F2 — (a) visible focus is independent of selected / hover", () => {
  const blocks = cssBlocks(readRenderer("styles.css"));

  it("declares the --focus-ring token and a .btn:focus-visible ring that uses it", () => {
    expect(readRenderer("styles.css")).toMatch(/--focus-ring:\s*0 0 0 2px/);
    const bodies = ruleBodies(blocks, ".btn:focus-visible");
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.some((body) => body.includes("var(--focus-ring)"))).toBe(true);
  });

  it("never kills the focus outline from an active / selected / hover rule without a :focus-visible replacement", () => {
    const stateRule = /(:hover\b|:active\b|\.active\b|\.selected\b|\[aria-selected)/;
    const offenders = blocks.filter(
      (b) => stateRule.test(b.selector) && /outline:\s*none/.test(b.body),
    );
    const unreplaced = offenders.filter((b) => {
      const base = baseSelector(b.selector);
      return base === "" || !blocks.some(
        (c) => /:focus-visible/.test(c.selector) && c.selector.includes(base),
      );
    });
    expect(unreplaced.map((b) => b.selector)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (b) FOCUS ORDER — no positive tabindex anywhere in the shell sources.
// ---------------------------------------------------------------------------

describe("Phase 119 F2 — (b) natural focus order (no positive tabindex)", () => {
  const SHELL_FILES = [
    "App.tsx",
    "components/DocumentRail.tsx",
    "components/ActionDock.tsx",
    "components/Inspector.tsx",
    "components/ContextPanel.tsx",
    "components/ViewStrip.tsx",
    "components/SideRail.tsx",
  ] as const;
  // Positive integer only: `tabIndex={0}` / `tabIndex={-1}` are allowed.
  const POSITIVE = /\btabIndex\s*=\s*\{\s*([1-9]\d*)\s*\}|\btabindex\s*=\s*"([1-9]\d*)"/;

  it.each(SHELL_FILES)("%s declares no positive tabindex", (rel) => {
    expect(readRenderer(rel).match(POSITIVE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (c) ATTACHED PANELS DO NOT TRAP, DIALOGS DO.
// ---------------------------------------------------------------------------

function stubObservers(): void {
  const g = globalThis as unknown as { IntersectionObserver?: unknown; ResizeObserver?: unknown };
  if (g.IntersectionObserver === undefined) {
    class NoopIntersectionObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.IntersectionObserver = NoopIntersectionObserver;
  }
  if (g.ResizeObserver === undefined) {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = NoopResizeObserver;
  }
}

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, 612, 792],
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void>; cancel: () => void } => ({
          promise: Promise.resolve(),
          cancel: (): void => undefined,
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function makeEngineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
  };
}

const OUTLINE: OutlineNode[] = [];

describe("Phase 119 F2 — (c) attached panels do not trap, dialogs do", () => {
  it("Inspector (expanded) is a complementary region, never a modal dialog", () => {
    const { container, cleanup } = mount(<Inspector stage="pages" />);
    const root = container.querySelector<HTMLElement>("[data-inspector]");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("aria-modal")).toBeNull();
    expect(root?.hasAttribute("data-inspector-dialog")).toBe(false);
    expect(root?.getAttribute("role")).toBe("complementary");
    cleanup();
  });

  it("ContextPanel (expanded) carries no modal / inspector-dialog semantics", () => {
    stubObservers();
    const { container, cleanup } = mount(
      <ContextPanel
        doc={makeDocStub(1)}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        engineState={makeEngineState(1)}
        canUndo={false}
        onJump={(): void => undefined}
        outline={OUTLINE}
      />,
    );
    const root = container.querySelector<HTMLElement>("[data-context-panel]");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("aria-modal")).toBeNull();
    expect(root?.hasAttribute("data-inspector-dialog")).toBe(false);
    cleanup();
  });

  it("DialogShell is the modal surface (aria-modal present)", () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Modal">
        <p>body</p>
      </DialogShell>,
    );
    const shell = container.querySelector<HTMLElement>("[data-dialog-shell]");
    expect(shell).not.toBeNull();
    expect(shell?.getAttribute("aria-modal")).toBe("true");
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// (d) SHORTCUTS REFERENCE ACCURACY — menuGroups vs src/main/menu.ts.
// ---------------------------------------------------------------------------

function normalizeAccelerator(value: string): string {
  return value.replace(/^CmdOrCtrl\+/, "Ctrl+").replace(/^Cmd\+/, "Ctrl+");
}

function collectAccelerators(text: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1] ?? "");
  return out;
}

const REFERENCE_ACCELERATORS = [
  "Ctrl+O",
  "Ctrl+Shift+O",
  "Ctrl+S",
  "Ctrl+Shift+S",
  "Ctrl+W",
  "Ctrl+Z",
  "Ctrl+Shift+Z",
  "Ctrl+,",
  "Ctrl+Shift+T",
  "Ctrl+Shift+P",
  "Ctrl+Shift+R",
  "Ctrl+Shift+U",
].sort();

describe("Phase 119 F2 — (d) the shortcut reference matches the registered menu", () => {
  const app = readRenderer("App.tsx");
  const start = app.indexOf("const menuGroups");
  const end = app.indexOf("const filteredMenuGroups", start);
  const region = app.slice(start, end);
  const reference = collectAccelerators(region, /accelerator:\s*"([^"]+)"/g).map(normalizeAccelerator);
  const registered = new Set(
    collectAccelerators(readRepo("src/main/menu.ts"), /accelerator:\s*'([^']+)'/g).map(
      normalizeAccelerator,
    ),
  );

  it("collects the renderer reference from the menuGroups block", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(reference.length).toBe(REFERENCE_ACCELERATORS.length);
  });

  it("every reference accelerator is registered in the main process", () => {
    const missing = reference.filter((a) => !registered.has(a));
    expect(missing).toEqual([]);
  });

  it("pins the exact reference set (drift pin)", () => {
    expect([...reference].sort()).toEqual(REFERENCE_ACCELERATORS);
  });
});

// ---------------------------------------------------------------------------
// (e) NESTED INTERACTIVE (scoped).
// ---------------------------------------------------------------------------

const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="menuitem"]';

/** Interactive elements that have an interactive ANCESTOR. */
function nestedInteractives(root: Element): Element[] {
  const interactive = Array.from(root.querySelectorAll(INTERACTIVE));
  const set = new Set(interactive);
  return interactive.filter((el) => {
    let p = el.parentElement;
    while (p !== null) {
      if (set.has(p)) return true;
      p = p.parentElement;
    }
    return false;
  });
}

function bulkActions(): DockBulkActions {
  return { onRotate: vi.fn(), onExtract: vi.fn(), onDelete: vi.fn() };
}

function renderDock(options: Partial<ActionDockProps> = {}): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const props: ActionDockProps = {
    activeStage: "pages",
    pageSelection: [],
    onClearPageSelection: vi.fn(),
    bulk: bulkActions(),
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
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const RAIL_TABS = [
  { id: "a", title: "alpha.pdf", modified: false },
  { id: "b", title: "beta.pdf", modified: true },
  { id: "c", title: "gamma.pdf", modified: false },
];

describe("Phase 119 F2 — (e) no nested interactive controls", () => {
  it("ActionDock (standalone) nests no interactive inside another", () => {
    const { host, unmount } = renderDock();
    try {
      expect(nestedInteractives(host)).toEqual([]);
    } finally {
      unmount();
    }
  });

  describe("DocumentRail at a tight width", () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const hadOwn = Object.prototype.hasOwnProperty.call(proto, "clientWidth");
    const original = hadOwn ? Object.getOwnPropertyDescriptor(proto, "clientWidth") : undefined;

    beforeEach((): void => {
      Object.defineProperty(proto, "clientWidth", {
        configurable: true,
        get(this: HTMLElement): number {
          return this.classList?.contains("tab-list") ? 300 : 0;
        },
      });
    });

    afterEach((): void => {
      if (hadOwn && original !== undefined) {
        Object.defineProperty(proto, "clientWidth", original);
      } else {
        delete proto.clientWidth;
      }
    });

    function mountRail(): HTMLElement {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      act((): void => {
        root.render(
          <DocumentRail
            activeId="a"
            tabs={RAIL_TABS}
            onActivate={(): void => undefined}
            onClose={(): void => undefined}
            onNewEmptyTab={(): void => undefined}
          />,
        );
      });
      return host;
    }

    it("nests no interactive inside another (Phase 105 tab-close exception noted)", () => {
      const host = mountRail();
      // Phase 105 recorded exception: the `.tab-close` button lives inside the
      // `.tab` `role="tab"` element; that pattern is deliberate and excluded here.
      expect(host.querySelector('[data-rail-overflow="true"]')).not.toBeNull();
      expect(nestedInteractives(host)).toEqual([]);
      // ...and it is the ONLY tab-hosted control, so no new nesting was added.
      const tabButtons = Array.from(host.querySelectorAll<HTMLElement>('[role="tab"] button'));
      expect(tabButtons.length).toBeGreaterThan(0);
      for (const button of tabButtons) {
        expect(button.classList.contains("tab-close")).toBe(true);
      }
    });
  });
});
