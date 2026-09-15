// @vitest-environment jsdom
// UnifiedToolbar — the tabbed ribbon shell (base component chunk) and
// its host wiring: the armed Edit tool is host state (editMode /
// onEditModeChange) and each Document button calls the host callback
// its data-tool id maps to.
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  UnifiedToolbar,
  type ToolbarTab,
  type UnifiedToolbarProps,
} from "../../../src/renderer/components/UnifiedToolbar";
import { MOTION_DURATION } from "../../../src/renderer/hooks/motionTokens";

/** Render the presentational shell. `extra` carries the optional host
 *  callbacks (edit mode + document actions) the later chunks wire in. */
function renderToolbar(
  activeTab: ToolbarTab,
  onTabChange: (tab: ToolbarTab) => void,
  extra: Partial<UnifiedToolbarProps> = {},
): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <UnifiedToolbar activeTab={activeTab} onTabChange={onTabChange} {...extra} />,
    );
  });
  return {
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Mount the ribbon against a STATEFUL host stand-in (App.tsx's role):
 *  `editMode` starts at `initial`, every onEditModeChange applies the
 *  reported mode to the host variable. The component is presentational,
 *  so the test must call `repaint` to re-render with the host's new
 *  state — exactly like React re-rendering App after
 *  `setActiveEditMode` commits. */
function renderWithHost(initial: string | null): {
  container: HTMLElement;
  onEditModeChange: ReturnType<typeof vi.fn>;
  repaint: () => void;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let editMode = initial;
  const onEditModeChange = vi.fn((next: string | null): void => {
    editMode = next;
  });
  const paint = (): void => {
    root.render(
      <UnifiedToolbar
        activeTab="edit"
        onTabChange={(): void => undefined}
        editMode={editMode}
        onEditModeChange={onEditModeChange}
      />,
    );
  };
  act((): void => {
    paint();
  });
  const repaint = (): void => {
    act((): void => {
      paint();
    });
  };
  return {
    container,
    onEditModeChange,
    repaint,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("UnifiedToolbar — tab shell renders the three sections", () => {
  it("renders the three section tabs in display order (annotate / edit / document)", () => {
    const { container, cleanup } = renderToolbar("annotate", vi.fn());
    const list = container.querySelector<HTMLElement>('[role="tablist"]');
    expect(list).not.toBeNull();
    const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.length).toBe(3);
    expect(tabs.map((t) => t.dataset.tab)).toEqual(["annotate", "edit", "document"]);
    expect(tabs.map((t) => t.textContent)).toEqual(["Annotate", "Edit", "Document"]);
    cleanup();
  });

  it("carries the data-unified-toolbar hook for e2e + the tabpanel", () => {
    const { container, cleanup } = renderToolbar("annotate", vi.fn());
    const bar = container.querySelector<HTMLElement>("[data-unified-toolbar]");
    expect(bar).not.toBeNull();
    const panel = container.querySelector<HTMLElement>('[role="tabpanel"]');
    expect(panel).not.toBeNull();
    cleanup();
  });
});

describe("UnifiedToolbar — active tab state", () => {
  it("marks only the active tab as selected (aria-selected + class)", () => {
    const { container, cleanup } = renderToolbar("edit", vi.fn());
    const byId = new Map(
      [...container.querySelectorAll<HTMLElement>('[role="tab"]')].map((t) => [
        t.dataset.tab,
        t,
      ]),
    );
    expect(byId.get("edit")?.getAttribute("aria-selected")).toBe("true");
    expect(byId.get("annotate")?.getAttribute("aria-selected")).toBe("false");
    expect(byId.get("document")?.getAttribute("aria-selected")).toBe("false");
    expect(byId.get("edit")?.className).toContain("toolbar-tab-active");
    expect(byId.get("annotate")?.className).not.toContain("toolbar-tab-active");
    expect(byId.get("document")?.className).not.toContain("toolbar-tab-active");
    cleanup();
  });

  it("labels the tabpanel from the active tab's id (no dangling labelled-by)", () => {
    const { container, cleanup } = renderToolbar("document", vi.fn());
    const panel = container.querySelector<HTMLElement>('[role="tabpanel"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("aria-labelledby")).toBe("unified-toolbar-tab-document");
    const labelledBy = document.getElementById("unified-toolbar-tab-document");
    expect(labelledBy).not.toBeNull();
    cleanup();
  });
});

describe("UnifiedToolbar — annotate tool grid", () => {
  it("shows the five most-used tools in order, with no expanded row", () => {
    const { container, cleanup } = renderToolbar("annotate", vi.fn());
    const grid = container.querySelector<HTMLElement>(".annotation-tools");
    expect(grid).not.toBeNull();
    expect(grid?.querySelectorAll<HTMLElement>(".tools-row").length).toBe(1);
    const tools = [...(grid?.querySelectorAll<HTMLButtonElement>("button[data-tool]") ?? [])];
    expect(tools.map((b) => b.dataset.tool)).toEqual([
      "highlight",
      "comment",
      "text",
      "rect",
      "sign",
    ]);
    // Each button pairs its icon with a visible label.
    expect(tools[0]?.textContent).toContain("Highlight");
    expect(tools[4]?.textContent).toContain("Sign");
    cleanup();
  });

  it("shows the collapsed More pill (data-expanded=false, unrotated chevron)", () => {
    const { container, cleanup } = renderToolbar("annotate", vi.fn());
    const expand = container.querySelector<HTMLButtonElement>(".expand-btn");
    expect(expand).not.toBeNull();
    expect(expand?.dataset.expanded).toBe("false");
    expect(expand?.textContent).toContain("More");
    const chevron = expand?.querySelector("svg");
    expect(chevron?.getAttribute("class") ?? "").not.toContain("rotated");
    cleanup();
  });

  it("clicking More reveals the seven additional tools and flips the pill to Less", () => {
    const { container, cleanup } = renderToolbar("annotate", vi.fn());
    const expand = container.querySelector<HTMLButtonElement>(".expand-btn");
    expect(expand).not.toBeNull();
    if (expand !== null) {
      act((): void => {
        expand.click();
      });
    }
    const grid = container.querySelector<HTMLElement>(".annotation-tools");
    const rows = grid?.querySelectorAll<HTMLElement>(".tools-row") ?? [];
    expect(rows.length).toBe(2);
    expect(rows[1].classList.contains("expanded")).toBe(true);
    const tools = [...grid?.querySelectorAll<HTMLButtonElement>("button[data-tool]") ?? []];
    expect(tools.map((b) => b.dataset.tool)).toEqual([
      "highlight",
      "comment",
      "text",
      "rect",
      "sign",
      "underline",
      "strike",
      "oval",
      "line",
      "arrow",
      "stamp",
      "erase",
    ]);
    expect(expand?.dataset.expanded).toBe("true");
    expect(expand?.textContent).toContain("Less");
    expect(expand?.querySelector("svg")?.getAttribute("class") ?? "").toContain("rotated");
    cleanup();
  });

  it("clicking Less collapses back to the five most-used tools", () => {
    // The exit row animates out over the --motion-duration-fast band
    // before React unmounts it, so the test runs on fake timers and
    // advances past that band before asserting the row is gone.
    vi.useFakeTimers();
    const { container, cleanup } = renderToolbar("annotate", vi.fn());
    try {
      const expand = container.querySelector<HTMLButtonElement>(".expand-btn");
      expect(expand).not.toBeNull();
      if (expand !== null) {
        // Separate act blocks: real clicks are discrete events, each
        // flushed before the next — batching both into one act would
        // leave the second click with a stale closure.
        act((): void => {
          expand.click(); // More
        });
        act((): void => {
          expand.click(); // Less
        });
      }
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.fast + 50);
      });
      const grid = container.querySelector<HTMLElement>(".annotation-tools");
      const rows = grid?.querySelectorAll<HTMLElement>(".tools-row") ?? [];
      expect(rows.length).toBe(1);
      const tools = [...grid?.querySelectorAll<HTMLButtonElement>("button[data-tool]") ?? []];
      expect(tools.map((b) => b.dataset.tool)).toEqual([
        "highlight",
        "comment",
        "text",
        "rect",
        "sign",
      ]);
      expect(expand?.dataset.expanded).toBe("false");
      expect(expand?.textContent).toContain("More");
      expect(expand?.querySelector("svg")?.getAttribute("class") ?? "").not.toContain("rotated");
    } finally {
      vi.useRealTimers();
      cleanup();
    }
  });

  it("More/Less row motion: exit keeps the collapsing class during the band, then unmounts", () => {
    vi.useFakeTimers();
    const { container, cleanup } = renderToolbar("annotate", vi.fn());
    try {
      const expand = container.querySelector<HTMLButtonElement>(".expand-btn");
      expect(expand).not.toBeNull();
      if (expand !== null) {
        act((): void => {
          expand.click(); // More
        });
        act((): void => {
          expand.click(); // Less
        });
      }
      // Mid-exit: the row is still mounted, swapped from the enter to
      // the exit class, and the logical state (pill label + aria) is
      // unchanged until the band elapses.
      let rows = container.querySelectorAll<HTMLElement>(".tools-row");
      expect(rows.length).toBe(2);
      expect(rows[1]?.classList.contains("collapsing")).toBe(true);
      expect(rows[1]?.classList.contains("expanded")).toBe(false);
      expect(expand?.dataset.expanded).toBe("true");
      expect(expand?.textContent).toContain("Less");
      // The --motion-duration-fast band elapses: the row unmounts and
      // the pill flips back to More.
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.fast + 50);
      });
      rows = container.querySelectorAll<HTMLElement>(".tools-row");
      expect(rows.length).toBe(1);
      expect(expand?.dataset.expanded).toBe("false");
      expect(expand?.textContent).toContain("More");
    } finally {
      vi.useRealTimers();
      cleanup();
    }
  });
});

describe("UnifiedToolbar — edit tool grid", () => {
  it("shows the five most-used tools in order, with no expanded row", () => {
    const { container, cleanup } = renderToolbar("edit", vi.fn());
    const grid = container.querySelector<HTMLElement>(".edit-tools");
    expect(grid).not.toBeNull();
    expect(grid?.querySelectorAll<HTMLElement>(".tools-row").length).toBe(1);
    const tools = [...(grid?.querySelectorAll<HTMLButtonElement>("button[data-tool]") ?? [])];
    expect(tools.map((b) => b.dataset.tool)).toEqual([
      "move",
      "scale",
      "rotate",
      "crop",
      "delete",
    ]);
    // Each button pairs its icon with a visible label.
    expect(tools[0]?.textContent).toContain("Move");
    expect(tools[4]?.textContent).toContain("Delete");
    cleanup();
  });

  it("shows the collapsed More pill (data-expanded=false, unrotated chevron)", () => {
    const { container, cleanup } = renderToolbar("edit", vi.fn());
    const expand = container.querySelector<HTMLButtonElement>(".expand-btn");
    expect(expand).not.toBeNull();
    expect(expand?.dataset.expanded).toBe("false");
    expect(expand?.textContent).toContain("More");
    const chevron = expand?.querySelector("svg");
    expect(chevron?.getAttribute("class") ?? "").not.toContain("rotated");
    cleanup();
  });

  it("clicking More reveals the five additional tools and flips the pill to Less", () => {
    const { container, cleanup } = renderToolbar("edit", vi.fn());
    const expand = container.querySelector<HTMLButtonElement>(".expand-btn");
    expect(expand).not.toBeNull();
    if (expand !== null) {
      act((): void => {
        expand.click();
      });
    }
    const grid = container.querySelector<HTMLElement>(".edit-tools");
    const rows = grid?.querySelectorAll<HTMLElement>(".tools-row") ?? [];
    expect(rows.length).toBe(2);
    expect(rows[1].classList.contains("expanded")).toBe(true);
    const tools = [...grid?.querySelectorAll<HTMLButtonElement>("button[data-tool]") ?? []];
    expect(tools.map((b) => b.dataset.tool)).toEqual([
      "move",
      "scale",
      "rotate",
      "crop",
      "delete",
      "insert-text",
      "insert-image",
      "insert-link",
      "page-numbers",
      "headers",
    ]);
    expect(expand?.dataset.expanded).toBe("true");
    expect(expand?.textContent).toContain("Less");
    expect(expand?.querySelector("svg")?.getAttribute("class") ?? "").toContain("rotated");
    cleanup();
  });

  it("clicking a tool reports its id to the host (arm)", () => {
    const onEditModeChange = vi.fn();
    const { container, cleanup } = renderToolbar("edit", vi.fn(), { onEditModeChange });
    const tool = container.querySelector<HTMLButtonElement>('.edit-tools button[data-tool="crop"]');
    expect(tool).not.toBeNull();
    expect(tool?.getAttribute("aria-pressed")).toBe("false");
    if (tool !== null) {
      act((): void => {
        tool.click();
      });
    }
    expect(onEditModeChange).toHaveBeenCalledTimes(1);
    expect(onEditModeChange).toHaveBeenCalledWith("crop");
    cleanup();
  });

  it("the host's editMode arms the button; a re-click on the armed tool reports null", () => {
    // Full round-trip against a STATEFUL host: the test stands in for
    // App.tsx — it applies the reported mode and re-renders, exactly
    // like the App's activeEditMode state does. That is the only way
    // the armed class can appear (the component is presentational),
    // and it is what makes a second click on the armed tool report
    // null (disarm) instead of the id again.
    const { container, onEditModeChange, repaint, cleanup } = renderWithHost(null);
    try {
      const tool = container.querySelector<HTMLButtonElement>('.edit-tools button[data-tool="crop"]');
      expect(tool).not.toBeNull();
      if (tool === null) return;
      // Arm: the click reports the id, the host applies it.
      act((): void => {
        tool.click();
      });
      expect(onEditModeChange).toHaveBeenLastCalledWith("crop");
      repaint();
      expect(tool.classList.contains("active")).toBe(true);
      expect(tool.getAttribute("aria-pressed")).toBe("true");
      // Disarm: a re-click on the armed tool reports null.
      act((): void => {
        tool.click();
      });
      expect(onEditModeChange).toHaveBeenLastCalledWith(null);
      repaint();
      expect(tool.classList.contains("active")).toBe(false);
      expect(tool.getAttribute("aria-pressed")).toBe("false");
    } finally {
      cleanup();
    }
  });

  it("selection is single across both rows — the host applies the reported mode to one tool only", () => {
    // Single-selection is the host's property (it stores ONE mode).
    // The component must render exactly that mode as armed: the host
    // starts with "crop" armed, the user arms the expanded-row
    // "insert-link" instead, and after the host re-render only the
    // link is lit — crop is never double-armed.
    const { container, onEditModeChange, repaint, cleanup } = renderWithHost("crop");
    try {
      const crop = container.querySelector<HTMLButtonElement>('.edit-tools button[data-tool="crop"]');
      expect(crop?.classList.contains("active")).toBe(true);
      const expand = container.querySelector<HTMLButtonElement>(".edit-tools .expand-btn");
      expect(expand).not.toBeNull();
      if (expand !== null) {
        act((): void => {
          expand.click(); // More
        });
      }
      const link = container.querySelector<HTMLButtonElement>('.edit-tools button[data-tool="insert-link"]');
      expect(link).not.toBeNull();
      if (link !== null) {
        act((): void => {
          link.click();
        });
      }
      expect(onEditModeChange).toHaveBeenLastCalledWith("insert-link");
      repaint(); // host applied the new arm
      expect(crop?.classList.contains("active")).toBe(false);
      expect(link?.classList.contains("active")).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("UnifiedToolbar — document tools grid", () => {
  it("shows the five most-used tools in order, with no expanded row", () => {
    const { container, cleanup } = renderToolbar("document", vi.fn());
    const grid = container.querySelector<HTMLElement>(".document-tools");
    expect(grid).not.toBeNull();
    // The document tab renders only its own grid.
    expect(container.querySelector(".annotation-tools")).toBeNull();
    expect(container.querySelector(".edit-tools")).toBeNull();
    expect(grid?.querySelectorAll<HTMLElement>(".tools-row").length).toBe(1);
    const tools = [...(grid?.querySelectorAll<HTMLButtonElement>("button[data-tool]") ?? [])];
    expect(tools.map((b) => b.dataset.tool)).toEqual([
      "save",
      "saveas",
      "export",
      "print",
      "share",
    ]);
    // Each button pairs its icon with a visible label.
    expect(tools[0]?.textContent).toContain("Save");
    expect(tools[1]?.textContent).toContain("Save As");
    expect(tools[4]?.textContent).toContain("Share");
    cleanup();
  });

  it("shows the collapsed More pill (data-expanded=false, unrotated chevron)", () => {
    const { container, cleanup } = renderToolbar("document", vi.fn());
    const expand = container.querySelector<HTMLButtonElement>(".expand-btn");
    expect(expand).not.toBeNull();
    expect(expand?.dataset.expanded).toBe("false");
    expect(expand?.textContent).toContain("More");
    const chevron = expand?.querySelector("svg");
    expect(chevron?.getAttribute("class") ?? "").not.toContain("rotated");
    cleanup();
  });

  it("clicking More reveals the five additional tools and flips the pill to Less", () => {
    const { container, cleanup } = renderToolbar("document", vi.fn());
    const expand = container.querySelector<HTMLButtonElement>(".expand-btn");
    expect(expand).not.toBeNull();
    if (expand !== null) {
      act((): void => {
        expand.click();
      });
    }
    const grid = container.querySelector<HTMLElement>(".document-tools");
    const rows = grid?.querySelectorAll<HTMLElement>(".tools-row") ?? [];
    expect(rows.length).toBe(2);
    expect(rows[1].classList.contains("expanded")).toBe(true);
    const tools = [...grid?.querySelectorAll<HTMLButtonElement>("button[data-tool]") ?? []];
    expect(tools.map((b) => b.dataset.tool)).toEqual([
      "save",
      "saveas",
      "export",
      "print",
      "share",
      "merge",
      "split",
      "optimize",
      "flatten",
      "props",
    ]);
    expect(expand?.dataset.expanded).toBe("true");
    expect(expand?.textContent).toContain("Less");
    expect(expand?.querySelector("svg")?.getAttribute("class") ?? "").toContain("rotated");
    cleanup();
  });

  it("clicking Less collapses back to the five most-used tools", () => {
    // The exit row animates out over the --motion-duration-fast band
    // before React unmounts it (fake timers + advance, same as the
    // Annotate test above).
    vi.useFakeTimers();
    const { container, cleanup } = renderToolbar("document", vi.fn());
    try {
      const expand = container.querySelector<HTMLButtonElement>(".expand-btn");
      expect(expand).not.toBeNull();
      if (expand !== null) {
        // Separate act blocks, same as the Annotate test: each real
        // click is a discrete event flushed before the next.
        act((): void => {
          expand.click(); // More
        });
        act((): void => {
          expand.click(); // Less
        });
      }
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.fast + 50);
      });
      const grid = container.querySelector<HTMLElement>(".document-tools");
      const rows = grid?.querySelectorAll<HTMLElement>(".tools-row") ?? [];
      expect(rows.length).toBe(1);
      const tools = [...grid?.querySelectorAll<HTMLButtonElement>("button[data-tool]") ?? []];
      expect(tools.map((b) => b.dataset.tool)).toEqual([
        "save",
        "saveas",
        "export",
        "print",
        "share",
      ]);
      expect(expand?.dataset.expanded).toBe("false");
      expect(expand?.textContent).toContain("More");
      expect(expand?.querySelector("svg")?.getAttribute("class") ?? "").not.toContain("rotated");
    } finally {
      vi.useRealTimers();
      cleanup();
    }
  });

  it("clicking a wired document action fires its host callback (most-used + More row)", () => {
    const onSave = vi.fn();
    const onSaveAs = vi.fn();
    const onExport = vi.fn();
    const onMerge = vi.fn();
    const onSplit = vi.fn();
    const onOptimize = vi.fn();
    const onFlatten = vi.fn();
    const { container, cleanup } = renderToolbar("document", vi.fn(), {
      onSave,
      onSaveAs,
      onExport,
      onMerge,
      onSplit,
      onOptimize,
      onFlatten,
    });
    // Most-used row.
    for (const [tool, fn] of [
      ["save", onSave],
      ["saveas", onSaveAs],
      ["export", onExport],
    ] as const) {
      const btn = container.querySelector<HTMLButtonElement>(
        `.document-tools button[data-tool="${tool}"]`,
      );
      expect(btn).not.toBeNull();
      if (btn !== null) {
        act((): void => {
          btn.click();
        });
      }
      expect(fn).toHaveBeenCalledTimes(1);
    }
    // More row.
    const expand = container.querySelector<HTMLButtonElement>(".document-tools .expand-btn");
    expect(expand).not.toBeNull();
    if (expand !== null) {
      act((): void => {
        expand.click(); // More
      });
    }
    for (const [tool, fn] of [
      ["merge", onMerge],
      ["split", onSplit],
      ["optimize", onOptimize],
      ["flatten", onFlatten],
    ] as const) {
      const btn = container.querySelector<HTMLButtonElement>(
        `.document-tools button[data-tool="${tool}"]`,
      );
      expect(btn).not.toBeNull();
      if (btn !== null) {
        act((): void => {
          btn.click();
        });
      }
      expect(fn).toHaveBeenCalledTimes(1);
    }
    cleanup();
  });

  it("document buttons are inert actions (no aria-pressed, no active class on click)", () => {
    const { container, cleanup } = renderToolbar("document", vi.fn());
    const save = container.querySelector<HTMLButtonElement>(
      '.document-tools button[data-tool="save"]',
    );
    expect(save).not.toBeNull();
    if (save !== null) {
      act((): void => {
        save.click();
      });
    }
    expect(save?.getAttribute("aria-pressed")).toBeNull();
    expect(save?.classList.contains("active")).toBe(false);
    cleanup();
  });

  it("unwired document tools (print / share / props — no app action yet) stay inert", () => {
    // The host passes no callback for these ids; clicking must be a
    // no-op that neither throws nor flips any toggle state. `props`
    // lives in the More row, so reveal it first.
    const { container, cleanup } = renderToolbar("document", vi.fn(), { onSave: vi.fn() });
    const expand = container.querySelector<HTMLButtonElement>(".document-tools .expand-btn");
    expect(expand).not.toBeNull();
    if (expand !== null) {
      act((): void => {
        expand.click(); // More
      });
    }
    for (const tool of ["print", "share", "props"]) {
      const btn = container.querySelector<HTMLButtonElement>(
        `.document-tools button[data-tool="${tool}"]`,
      );
      expect(btn).not.toBeNull();
      if (btn !== null) {
        act((): void => {
          btn.click();
        });
      }
      expect(btn?.getAttribute("aria-pressed")).toBeNull();
      expect(btn?.classList.contains("active")).toBe(false);
    }
    cleanup();
  });
});

describe("UnifiedToolbar — tab switching", () => {
  it("clicking an inactive tab fires onTabChange with that tab's id", () => {
    const onTabChange = vi.fn();
    const { container, cleanup } = renderToolbar("annotate", onTabChange);
    const edit = container.querySelector<HTMLButtonElement>('[role="tab"][data-tab="edit"]');
    expect(edit).not.toBeNull();
    if (edit !== null) {
      act((): void => {
        edit.click();
      });
    }
    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith("edit");
    cleanup();
  });

  it("clicking the already-active tab still reports it (the host dedupes)", () => {
    const onTabChange = vi.fn();
    const { container, cleanup } = renderToolbar("edit", onTabChange);
    const edit = container.querySelector<HTMLButtonElement>('[role="tab"][data-tab="edit"]');
    expect(edit).not.toBeNull();
    if (edit !== null) {
      act((): void => {
        edit.click();
      });
    }
    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith("edit");
    cleanup();
  });
});