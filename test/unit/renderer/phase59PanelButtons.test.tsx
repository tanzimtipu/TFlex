// @vitest-environment jsdom
//
// Phase 59 (items 5, 6, 9) — three small UI corrections, pinned here:
//
//   item 9  no rendered button/label in the ContextPanel or the Inspector ends
//           with the ellipsis character, and the interactive controls carry a
//           visible button identity (raised surface + border + hover state)
//           rather than reading as body text;
//   item 6  a NEW document's viewer seed is `fit-page` (the App open path), and
//           a LATER user change is preserved (never re-forced on re-render);
//   item 5  the expanded outline's scroll container has no bottom padding, so
//           the last row sits flush with the panel's bottom edge.
//
// The CSS half is a textual scan of styles.css (jsdom cannot apply the real
// stylesheet — the established formsCssStacking / phase36ContextPanel pattern).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import type { ContextPanelProps } from "../../../src/renderer/components/ContextPanel";
import { Inspector } from "../../../src/renderer/components/Inspector";
import type { InspectorProps } from "../../../src/renderer/components/Inspector";
import { zoomReducer } from "../../../src/renderer/state/zoom";
import type { EngineState } from "../../../src/renderer/engine/types";

const ELLIPSIS = "\u2026";

const REPO_ROOT = resolve(__dirname, "../../..");

function readSource(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

function readStyles(): string {
  return readSource("src/renderer/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
}

function ruleBody(css: string, selector: string): string {
  const m = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  return m?.[1] ?? "";
}

function stubObservers(): void {
  const g = globalThis as unknown as {
    IntersectionObserver?: unknown;
    ResizeObserver?: unknown;
  };
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

/** Every control on the screen: real buttons and ARIA buttons. */
function controls(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('button, [role="button"]')];
}

function ellipsisLabels(host: HTMLElement): string[] {
  return controls(host)
    .map((el) => (el.textContent ?? "").trim())
    .filter((text) => text.endsWith(ELLIPSIS));
}

function renderContextPanel(
  next: Partial<ContextPanelProps> & { stage: ContextPanelProps["stage"] },
): { host: HTMLElement; unmount: () => void } {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <ContextPanel
        doc={makeDocStub(3)}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        pageSizes={null}
        engineState={makeEngineState(3)}
        proxyVisibleOrder={false}
        canUndo={false}
        onUndo={(): void => undefined}
        onJump={(): void => undefined}
        outline={null}
        {...next}
      />,
    );
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

function mountInspector(props: InspectorProps): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(<Inspector {...props} />);
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

// ---------------------------------------------------------------------------
// Item 9 � labels carry no trailing ellipsis.
// ---------------------------------------------------------------------------

describe("Phase 59 item 9 - no rendered button label ends with an ellipsis", () => {
  const CONTEXT_STAGES: Array<ContextPanelProps["stage"]> = ["pages", "edit", "review", "deliver"];

  it.each(CONTEXT_STAGES)("ContextPanel [%s] has no ellipsis-terminated control", (stage) => {
    const { host, unmount } = renderContextPanel({
      stage,
      onRecognizeText: vi.fn(),
      onOpenOcrSuspects: vi.fn(),
      onManageSignatures: vi.fn(),
      onOptimize: vi.fn(),
      onCreateFromImages: vi.fn(),
      onMerge: vi.fn(),
    });
    try {
      expect(ellipsisLabels(host)).toEqual([]);
    } finally {
      unmount();
    }
  });

  it("ContextPanel exposes the bare action names (dialog-promising labels stripped)", () => {
    const pages = renderContextPanel({ stage: "pages" });
    try {
      expect(pages.host.querySelector("[data-context-panel-combine]")?.textContent?.trim()).toBe("Combine");
    } finally {
      pages.unmount();
    }
    const deliver = renderContextPanel({ stage: "deliver", onOptimize: vi.fn() });
    try {
      const text = deliver.host.textContent ?? "";
      expect(text).toContain("From images");
      expect(text).not.toContain("From images\u2026");
      expect(text).toContain("Optimize");
      expect(text).not.toContain("Optimize\u2026");
    } finally {
      deliver.unmount();
    }
    const edit = renderContextPanel({ stage: "edit", onRecognizeText: vi.fn() });
    try {
      expect(edit.host.textContent).toContain("Recognize text");
      expect(edit.host.textContent).not.toContain("Recognize text\u2026");
    } finally {
      edit.unmount();
    }
    const review = renderContextPanel({ stage: "review", onManageSignatures: vi.fn() });
    try {
      // Phase 90 re-pointed the review stage at the unified
      // `ReviewElementsPanel`: the legacy `Manage signatures` control is gone,
      // replaced by the Signatures category (empty text when none placed). The
      // case's intent still holds — the current review affordances carry no
      // dialog-promising (ellipsis) label.
      const text = review.host.textContent ?? "";
      expect(review.host.querySelector('[data-review-category="signatures"]')).not.toBeNull();
      expect(text).toContain("Signatures");
      expect(text).toContain("No signatures placed.");
      expect(text).not.toContain("Manage signatures");
    } finally {
      review.unmount();
    }
  });
});

describe("Phase 59 item 9 - Inspector labels carry no trailing ellipsis", () => {
  it.each([
    ["pages", { kind: "page", page: 1 }],
    ["review", { kind: "none" }],
    ["deliver", { kind: "none" }],
  ] as const)("Inspector [%s] has no ellipsis-terminated control", (stage, selection) => {
    const { host, unmount } = mountInspector({ stage, selection });
    try {
      expect(ellipsisLabels(host)).toEqual([]);
    } finally {
      unmount();
    }
  });

  it("shows the bare rename / Export FDF / Import FDF / Export labels", () => {
    const pages = mountInspector({
      stage: "pages",
      selection: { kind: "page", page: 1 },
      onRenumberPages: vi.fn(),
    });
    try {
      const renumber = pages.host.querySelector('[data-inspector-action="renumber"]');
      expect(renumber?.textContent ?? "").toContain("rename");
      expect(renumber?.textContent ?? "").not.toContain(ELLIPSIS);
    } finally {
      pages.unmount();
    }
    const review = mountInspector({
      stage: "review",
      selection: { kind: "none" },
      onExportComments: vi.fn(),
      onImportComments: vi.fn(),
    });
    try {
      const text = review.host.textContent ?? "";
      expect(text).toContain("Export FDF");
      expect(text).toContain("Import FDF");
      expect(text).not.toContain(`Export FDF${ELLIPSIS}`);
      expect(text).not.toContain(`Import FDF${ELLIPSIS}`);
    } finally {
      review.unmount();
    }
    const deliver = mountInspector({
      stage: "deliver",
      selection: { kind: "none" },
      onExport: vi.fn(),
    });
    try {
      expect(deliver.host.textContent).toContain("Export");
      expect(deliver.host.textContent).not.toContain(`Export${ELLIPSIS}`);
    } finally {
      deliver.unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Item 9 � interactive controls read as buttons, not body text.
// ---------------------------------------------------------------------------

describe("Phase 91 - panel controls compose the canonical button classes", () => {
  const css = readStyles();

  it("the canonical secondary variant is the visible button identity", () => {
    const body = ruleBody(css, "\\.btn-secondary");
    expect(body).not.toBe("");
    expect(body).toMatch(/background:\s*var\(--bg-raised\)/);
    expect(body).toMatch(/border-color:\s*var\(--border\)/);
  });

  it("the canonical secondary hover moves to a distinct surface tone", () => {
    expect(css).toMatch(
      /\.btn-secondary:hover:not\(\[disabled\]\):not\(\[aria-disabled="true"\]\)\s*\{[^}]*background:\s*var\(--bg-hover\)/,
    );
  });

  it("the ContextPanel controls add the canonical classes to the legacy hooks", () => {
    const pages = renderContextPanel({
      stage: "pages",
      onMerge: vi.fn(),
      onRemoveBlankPages: vi.fn(),
      outline: [],
    });
    try {
      const combine = pages.host.querySelector("[data-context-panel-combine]");
      expect(combine?.classList.contains("btn")).toBe(true);
      expect(combine?.classList.contains("btn-secondary")).toBe(true);
      const blank = pages.host.querySelector("[data-blank-scan-open]");
      expect(blank?.classList.contains("btn-secondary")).toBe(true);
      expect(blank?.classList.contains("btn-sm")).toBe(true);
      const toggle = pages.host.querySelector("[data-outline-toggle]");
      expect(toggle?.classList.contains("btn")).toBe(true);
      expect(toggle?.classList.contains("btn-ghost")).toBe(true);
      expect(toggle?.getAttribute("aria-expanded")).not.toBeNull();
    } finally {
      pages.unmount();
    }
    const edit = renderContextPanel({
      stage: "edit",
      onRecognizeText: vi.fn(),
      onOpenOcrSuspects: vi.fn(),
    });
    try {
      const recognize = edit.host.querySelector('[data-context-panel-action="recognize"]');
      expect(recognize?.classList.contains("btn-secondary")).toBe(true);
      expect(recognize?.classList.contains("btn-sm")).toBe(true);
      const suspects = edit.host.querySelector('[data-context-panel-action="suspects"]');
      expect(suspects?.classList.contains("btn-sm")).toBe(true);
    } finally {
      edit.unmount();
    }
  });

  it("the Inspector controls add the canonical classes to the legacy hooks", () => {
    const { host, unmount } = mountInspector({
      stage: "pages",
      selection: { kind: "page", page: 1 },
      onRenumberPages: vi.fn(),
      onJumpToReview: vi.fn(),
      onClose: vi.fn(),
    });
    try {
      const renumber = host.querySelector('[data-inspector-action="renumber"]');
      expect(renumber?.classList.contains("btn")).toBe(true);
      expect(renumber?.classList.contains("btn-secondary")).toBe(true);
      const jump = host.querySelector('[data-inspector-action="jump-to-review"]');
      expect(jump?.classList.contains("btn-ghost")).toBe(true);
      expect(jump?.classList.contains("btn-sm")).toBe(true);
      const collapse = host.querySelector("[data-inspector-collapse]");
      expect(collapse?.classList.contains("btn-ghost")).toBe(true);
      expect(collapse?.getAttribute("aria-expanded")).not.toBeNull();
      const close = host.querySelector("[data-inspector-close]");
      expect(close?.classList.contains("btn-ghost")).toBe(true);
      expect(close?.classList.contains("btn-icon")).toBe(true);
      expect(close?.getAttribute("aria-label")).toBe("Close inspector");
      expect(close?.getAttribute("title")).toBe("Close");
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Item 6 � a new document opens at fit-page; a later user change is honoured.
// ---------------------------------------------------------------------------

describe("Phase 59 item 6 - the new-document viewer seed is fit-page", () => {
  const appSrc = readSource("src/renderer/App.tsx");

  it("the open path seeds zoomMode fit-page", () => {
    const seed = /const persisted: PersistedViewer = \{([\s\S]*?)\n {6}\};/.exec(appSrc);
    expect(seed, "the new-document PersistedViewer seed must exist").not.toBeNull();
    expect(seed?.[1] ?? "").toMatch(/zoomMode:\s*"fit-page"/);
  });

  it("no new-document open path seeds fit-width any more", () => {
    expect(appSrc).not.toContain('zoomMode: "fit-width"');
  });

  it("the open path threads the seed to the viewer as `initial`", () => {
    expect(appSrc).toContain("initial={open.persisted}");
  });

  it("a later user zoom change is preserved, not re-forced", () => {
    // The seed is the initial state; the reducer remembers the user's later
    // choice (fit-width or a manual step) exactly as DocumentView applies it.
    expect(zoomReducer({ mode: "fit-page", manualScale: 1 }, { type: "set-mode", mode: "fit-width" }).mode).toBe(
      "fit-width",
    );
    const manual = zoomReducer({ mode: "fit-page", manualScale: 1 }, { type: "set-manual-scale", scale: 1.5 });
    expect(manual.mode).toBe("manual");
    expect(manual.manualScale).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// Item 5 (DEF-419) — the expanded outline HUGS its content: no dead space
// under the last row, and flush bottom padding all the way down.
// ---------------------------------------------------------------------------

/** Like `ruleBody`, but tolerates single-line rules (`.outline-list`). */
function cssBlock(css: string, selector: string): string {
  const m = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(css);
  return m?.[1] ?? "";
}

describe("Phase 59 item 5 - the expanded outline hugs its content (DEF-419)", () => {
  const css = readStyles();

  it("the section is content-sized with a max-height cap, not a fixed fraction", () => {
    const open = ruleBody(css, "\\.context-panel-outline\\[data-outline-open='true'\\]");
    expect(open).not.toBe("");
    // A bare `height: <n>%` is exactly what reserved the dead space DEF-419
    // measured (lastRowGap 294.59px); the share survives only as an upper
    // bound, so a short outline shrinks the section to its rows.
    expect(open).not.toMatch(/(?:^|[\s;{])height:\s*\d+(?:\.\d+)?%/);
    expect(open).toMatch(/max-height:\s*40%/);
    // The section can shrink to its content height (never a pinned basis).
    expect(open).not.toMatch(/flex:\s*0 0 40%/);
    expect(open).toMatch(/flex:\s*0 1 auto/);
  });

  it("the section body carries no trailing bottom padding", () => {
    const body = ruleBody(css, "\\.context-panel-outline-body");
    expect(body).not.toBe("");
    const paddingBottom = /padding-bottom:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? "";
    // Either absent or explicitly zero — never the old space token.
    expect(paddingBottom === "" || paddingBottom === "0").toBe(true);
  });

  it("the re-parented .outline-panel joins the flow and zeroes its bottom padding", () => {
    const scoped = ruleBody(css, "\\.context-panel-outline \\.outline-panel");
    expect(scoped).toMatch(/padding-bottom:\s*0/);
    // In flow the section can size to the tree's content; the cap keeps a
    // long outline scrolling inside the bounded body.
    expect(scoped).toMatch(/position:\s*static/);
    expect(scoped).toMatch(/max-height:\s*100%/);
  });

  it("the outline list and rows add no bottom padding under the last row", () => {
    const list = cssBlock(css, "\\.outline-list");
    expect(list).not.toBe("");
    expect(list).not.toMatch(/padding-bottom:\s*(?!0\b)[^;]+/);
    const row = cssBlock(css, "\\.outline-row");
    expect(row).not.toBe("");
    expect(row).not.toMatch(/padding-bottom:\s*(?!0\b)[^;]+/);
  });

  it("the shared .outline-panel rule (the rail's tab) is untouched", () => {
    const shared = ruleBody(css, "\\.outline-panel");
    expect(shared).toMatch(/position:\s*absolute/);
    expect(shared).toMatch(/inset:\s*0/);
    expect(shared).toMatch(/padding:\s*var\(--sp-2\) 0/);
  });
});
