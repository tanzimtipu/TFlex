// @vitest-environment jsdom
//
// Phase 111 (chunk C) — the OUTLINE view of the document navigator.
//
// The horizontal renderVerbs strip is gone. Every editable row now carries a
// fixed 32px destination column and an always-visible 32px More button that
// opens a CommandMenu (Rename / Set destination... / Add bookmark / Indent /
// Outdent / separator / Delete bookmark), plus a single header Add control and
// a "No bookmarks" empty state. These tests pin:
//   (a) row metrics (16px indent, 44px min-height, two-line 13px title);
//   (b) child-only disclosure + aria-expanded;
//   (c) the 32px destination column;
//   (d) every row's More menu and its six commands in order;
//   (e) the preserved restrictions + separated danger Delete;
//   (f) the header Add and the empty state;
//   (g) rename and retarget routed through the More menu.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ok } from "../../../src/shared/result";
import type { OutlineEntry } from "../../../src/renderer/state/outlineEditor";
import type { OutlineNode } from "../../../src/renderer/pdf/pdfjs";
import { OutlinePanel } from "../../../src/renderer/components/SideRail";
import type { OutlineEditorConfig } from "../../../src/renderer/components/SideRail";
import type { EngineState } from "../../../src/renderer/engine/types";

const STYLES = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
);
const ANIMATIONS_CSS = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles/animations.css"),
  "utf8",
);

function makeEngineState(pageCount = 10): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: true,
    annotations: [],
  };
}

function makeDocStub(): PDFDocumentProxy {
  return {
    numPages: 10,
    async getPage(n: number): Promise<unknown> {
      return { pageNumber: n };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function freshSeed(): OutlineEntry[] {
  return [
    { title: "Chapter 1", page: 1, children: [] },
    { title: "Chapter 2", page: 3, children: [{ title: "Section", page: 4, children: [] }] },
    { title: "Appendix", page: null, children: [] },
  ];
}

interface Harness {
  host: HTMLElement;
  commit: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function renderPanel(entries: OutlineEntry[] = freshSeed()): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const commit = vi.fn(async () => ok(makeEngineState()));
  const config: OutlineEditorConfig = {
    docId: "doc-1",
    entries,
    visiblePageCount: 10,
    commit,
  };
  act((): void => {
    root.render(
      <OutlinePanel
        doc={makeDocStub()}
        outline={[]}
        onJump={(): void => undefined}
        editor={config}
      />,
    );
  });
  return {
    host,
    commit,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

function renderViewOnly(outline: OutlineNode[] = VIEW_OUTLINE): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <OutlinePanel doc={makeDocStub()} outline={outline} onJump={(): void => undefined} />,
    );
  });
  return {
    host,
    commit: vi.fn(),
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

/** A single chain of `levels` nested entries; the deepest row sits at depth
 *  `levels - 1` (path "0/0/..."). */
function deepSeed(levels: number): OutlineEntry[] {
  let node: OutlineEntry = { title: `Level ${levels - 1}`, page: null, children: [] };
  for (let d = levels - 2; d >= 0; d -= 1) {
    node = { title: `Level ${d}`, page: null, children: [node] };
  }
  return [node];
}

const VIEW_OUTLINE: OutlineNode[] = [
  { title: "Chapter 1", dest: [1], children: [] },
  { title: "Chapter 2", dest: [3], children: [{ title: "Section", dest: [4], children: [] }] },
];

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function pressEscape(): void {
  act((): void => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
}

/** Dispatch a cancelable pointerdown and hand back the event so a spec can
 *  assert whether the handler cancelled the browser's default focus move. */
function pointerDownEvent(target: EventTarget): Event {
  const event = new Event("pointerdown", { bubbles: true, cancelable: true });
  act((): void => {
    target.dispatchEvent(event);
  });
  return event;
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function row(host: HTMLElement, path: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(`[data-outline-row][data-outline-path="${path}"]`);
  if (el === null) throw new Error(`no outline row at ${path}`);
  return el;
}

function openMore(host: HTMLElement, path: string): void {
  const more = row(host, path).querySelector<HTMLElement>("[data-outline-more]");
  if (more === null) throw new Error(`no More on row ${path}`);
  clickOn(more);
}

function menu(host: HTMLElement): HTMLElement {
  // TFL-1083 (DEF-615) — the row More menu is portalled to `document.body`, so
  // it is no longer a descendant of the test host; query the whole document.
  const el = host.ownerDocument.querySelector<HTMLElement>("[data-outline-menu]");
  if (el === null) throw new Error("no open outline menu");
  return el;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function changeSelect(select: HTMLSelectElement, value: string): void {
  act((): void => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

afterEach((): void => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Phase 111 chunk C — outline row metrics", () => {
  it("indents 8 + 16*depth and clamps the title to two 13px lines", () => {
    const { host, unmount } = renderPanel();
    try {
      expect(row(host, "0").style.paddingLeft).toBe("8px");
      expect(row(host, "1/0").style.paddingLeft).toBe("24px");
      expect(STYLES).toMatch(/\.outline-row\s*\{[^}]*min-height:\s*44px/);
      // The 13px title rides the row-type token (--fs-md -> --type-row-size).
      expect(STYLES).toMatch(/\.outline-link\s*\{[^}]*font-size:\s*var\(--fs-md\)/);
      expect(STYLES).toMatch(/--type-row-size:\s*13px/);
      expect(STYLES).toMatch(/\.outline-link\s*\{[^}]*-webkit-line-clamp:\s*2/);
    } finally {
      unmount();
    }
  });

  it("shows a disclosure only on rows with children", () => {
    const { host, unmount } = renderPanel();
    try {
      expect(row(host, "0").querySelector("button.outline-toggle")).toBeNull();
      const toggle = row(host, "1").querySelector<HTMLElement>("button.outline-toggle");
      expect(toggle).not.toBeNull();
      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    } finally {
      unmount();
    }
  });

  it("renders a fixed 32px destination column with a page or a dash", () => {
    const { host, unmount } = renderPanel();
    try {
      const sectionPage = row(host, "1/0").querySelector<HTMLElement>(".outline-page");
      expect(sectionPage?.textContent).toBe("4");
      expect(sectionPage?.getAttribute("title")).toBe("Page 4");
      const nonePage = row(host, "2").querySelector<HTMLElement>(".outline-page");
      expect(nonePage?.textContent).toBe("\u2013");
      expect(nonePage?.getAttribute("title")).toBe("No page target");
      expect(STYLES).toMatch(/\.outline-page\s*\{[^}]*flex:\s*0 0 32px/);
      expect(STYLES).toMatch(/\.outline-page\s*\{[^}]*width:\s*32px/);
    } finally {
      unmount();
    }
  });
});

describe("Phase 111 chunk C — the row More menu", () => {
  const HOOKS = [
    "rename",
    "retarget-open",
    "add",
    "indent",
    "outdent",
    "delete",
  ] as const;

  it("gives every row a 32px More and the six commands in order", () => {
    const { host, unmount } = renderPanel();
    try {
      const rows = [...host.querySelectorAll("[data-outline-row]")];
      expect(rows).toHaveLength(4);
      for (const r of rows) {
        expect(r.querySelector("[data-outline-more]")).not.toBeNull();
      }
      expect(host.querySelector("[data-outline-toolbar]")).toBeNull();
      expect(host.querySelector(".outline-verbs")).toBeNull();

      openMore(host, "1/0");
      const selector = HOOKS.map((h) => `[data-outline-${h}]`).join(",");
      const ids = [...menu(host).querySelectorAll<HTMLElement>(selector)].map((el) =>
        HOOKS.find((h) => el.hasAttribute(`data-outline-${h}`)),
      );
      expect(ids).toEqual([...HOOKS]);
      expect(STYLES).toMatch(/\.outline-more\s*\{[^}]*width:\s*32px/);
      expect(STYLES).toMatch(
        /@media \(pointer: coarse\)\s*\{[\s\S]*?\.outline-more\s*\{[^}]*width:\s*44px/,
      );
    } finally {
      unmount();
    }
  });

  it("preserves the restrictions and separates the danger Delete", () => {
    const { host, unmount } = renderPanel();
    try {
      openMore(host, "0");
      const indent = menu(host).querySelector<HTMLButtonElement>("[data-outline-indent]");
      const outdent = menu(host).querySelector<HTMLButtonElement>("[data-outline-outdent]");
      expect(indent?.disabled).toBe(true);
      expect(outdent?.disabled).toBe(true);
      expect(menu(host).querySelector(".titlebar-menu-sep")).not.toBeNull();
      const del = menu(host).querySelector<HTMLElement>("[data-outline-delete]");
      expect(del?.classList.contains("context-menu-item-danger")).toBe(true);
      expect(del?.getAttribute("data-menu-variant")).toBe("danger");
    } finally {
      unmount();
    }
  });
});

describe("Phase 111 chunk C — header Add and empty state", () => {
  it("adds a root bookmark from the header Add", async () => {
    const { host, commit, unmount } = renderPanel();
    try {
      const add = host.querySelector("[data-outline-add]");
      expect(add).not.toBeNull();
      clickOn(add as Element);
      await flush();
      expect(commit).toHaveBeenCalledTimes(1);
      const [, entries] = commit.mock.calls[0] as [string, OutlineEntry[]];
      expect(entries).toHaveLength(4);
      expect(entries[entries.length - 1].title).toBe("New bookmark");
      expect(STYLES).toMatch(/\.outline-head-add\s*\{[^}]*width:\s*32px/);
    } finally {
      unmount();
    }
  });

  it("renders No bookmarks with the Add control for an empty model", () => {
    const { host, unmount } = renderPanel([]);
    try {
      expect(host.querySelector(".outline-empty")?.textContent).toBe("No bookmarks");
      expect(host.querySelector("[data-outline-add]")).not.toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("Phase 111 chunk C — rename and retarget through the More menu", () => {
  it("reveals the inline rename input and commits the renamed tree", async () => {
    const { host, commit, unmount } = renderPanel();
    try {
      openMore(host, "0");
      clickOn(menu(host).querySelector("[data-outline-rename]") as Element);
      const input = host.querySelector<HTMLInputElement>("[data-outline-rename-input]");
      expect(input).not.toBeNull();
      setInputValue(input as HTMLInputElement, "Intro");
      act((): void => {
        (input as HTMLInputElement).dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      });
      await flush();
      const [, entries] = commit.mock.calls[0] as [string, OutlineEntry[]];
      expect(entries[0].title).toBe("Intro");
    } finally {
      unmount();
    }
  });

  it("reveals the destination select and retargets the row", async () => {
    const { host, commit, unmount } = renderPanel();
    try {
      openMore(host, "0");
      clickOn(menu(host).querySelector("[data-outline-retarget-open]") as Element);
      const select = host.ownerDocument.querySelector<HTMLSelectElement>("[data-outline-retarget]");
      expect(select).not.toBeNull();
      changeSelect(select as HTMLSelectElement, "5");
      await flush();
      const [, entries] = commit.mock.calls[0] as [string, OutlineEntry[]];
      expect(entries[0].page).toBe(5);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 111 fix (TFL-1078) — ADV-238 / ADV-239 / ADV-240.
// ---------------------------------------------------------------------------

describe("Phase 111 fix — outline tree semantics (ADV-240)", () => {
  it("exposes role=tree, treeitem rows with aria-level and nested groups", () => {
    const { host, unmount } = renderPanel();
    try {
      expect(host.querySelector('[role="tree"]')).not.toBeNull();
      const items = [...host.querySelectorAll('[role="treeitem"]')];
      expect(items).toHaveLength(4);
      for (const item of items) expect(item.getAttribute("aria-level")).not.toBeNull();
      expect(items.filter((i) => i.getAttribute("aria-level") === "1")).toHaveLength(3);
      const nested = items.filter((i) => i.getAttribute("aria-level") === "2");
      expect(nested).toHaveLength(1);
      expect(nested[0].textContent).toContain("Section");
      // Parents carry aria-expanded; leaves do not.
      const parent = items.find((i) => i.textContent?.includes("Chapter 2"));
      expect(parent?.getAttribute("aria-expanded")).toBe("true");
      expect(items.find((i) => i.textContent?.includes("Chapter 1"))?.getAttribute("aria-expanded")).toBeNull();
      // The nested list is a role=group owned under the parent row.
      const group = host.querySelector('[role="group"]');
      expect(group).not.toBeNull();
      expect(group?.querySelector('[role="treeitem"]')?.textContent).toContain("Section");
    } finally {
      unmount();
    }
  });

  it("marks the selected row with aria-selected and clears the rest", () => {
    const { host, unmount } = renderPanel();
    try {
      expect(row(host, "0").closest('[role="treeitem"]')?.getAttribute("aria-selected")).toBe("false");
      clickOn(row(host, "1"));
      expect(row(host, "1").closest('[role="treeitem"]')?.getAttribute("aria-selected")).toBe("true");
      expect(row(host, "0").closest('[role="treeitem"]')?.getAttribute("aria-selected")).toBe("false");
    } finally {
      unmount();
    }
  });

  it("exposes the same tree roles on the view-only outline", () => {
    const { host, unmount } = renderViewOnly();
    try {
      expect(host.querySelector('[role="tree"]')).not.toBeNull();
      const items = [...host.querySelectorAll('[role="treeitem"]')];
      expect(items).toHaveLength(3);
      expect(host.querySelector('[role="group"]')).not.toBeNull();
      const parent = items.find((i) => i.textContent?.includes("Chapter 2"));
      expect(parent?.getAttribute("aria-expanded")).toBe("true");
      expect(parent?.querySelector("button.outline-toggle")?.getAttribute("aria-expanded")).toBe("true");
    } finally {
      unmount();
    }
  });
});

describe("Phase 111 re-fix (TFL-1080) — DEF-615 / DEF-616 positioning and fit", () => {
  it("makes tf-anim-materialize transform-free so the outline body is never a containing block (DEF-615)", () => {
    const kf = /@keyframes tf-anim-materialize\s*\{[\s\S]*?\n\}/.exec(ANIMATIONS_CSS);
    expect(kf).not.toBeNull();
    // A `fill-mode: both` transform animation computes the identity matrix and
    // stays a containing block even when it ends at `transform: none`, so the
    // keyframe must not animate transform at all.
    expect(kf?.[0]).not.toMatch(/transform\s*:/);
    // The outline body still rides the (now opacity-only) keyframe.
    expect(STYLES).toMatch(
      /\.context-panel-outline-body\s*\{[^}]*animation:\s*tf-anim-materialize/,
    );
  });

  it("keeps the scale entrance for the free-standing .anim-materialize utility (DEF-615)", () => {
    const scale = /@keyframes tf-anim-scale-in\s*\{[\s\S]*?\n\}/.exec(ANIMATIONS_CSS);
    expect(scale).not.toBeNull();
    expect(scale?.[0]).toMatch(/transform:\s*scale\(var\(--motion-scale-enter\)\)/);
    expect(ANIMATIONS_CSS).toMatch(/\.anim-materialize\s*\{[^}]*animation:\s*tf-anim-scale-in/);
  });

  it("keeps .outline-panel horizontally unscrollable", () => {
    expect(STYLES).toMatch(/\.outline-panel\s*\{[^}]*overflow-x:\s*hidden/);
    expect(STYLES).toMatch(/\.outline-panel\s*\{[^}]*overflow-y:\s*auto/);
  });

  it("lets the title shrink so the fixed columns never overflow the row (DEF-616)", () => {
    expect(STYLES).toMatch(/\.outline-row\s*\{[^}]*min-width:\s*0/);
    expect(STYLES).toMatch(/\.outline-link\s*\{[^}]*min-width:\s*0/);
  });

  it("caps the indent so a depth-10 row fits the 240px floor (DEF-616)", () => {
    const { host, unmount } = renderPanel(deepSeed(12));
    try {
      const deepest = row(host, "0/0/0/0/0/0/0/0/0/0/0");
      expect(deepest.style.paddingLeft).toBe("104px");
      expect(deepest.querySelector("[data-outline-more]")).not.toBeNull();
      // Budget: 240px floor minus a thin (~11px) scrollbar = 229px usable.
      // Fixed columns are the 18px disclosure + 32px destination + the 44px
      // COARSE More = 94px, plus 3 * 2px flex gap = 6px, plus the row's 8px
      // trailing pad, plus the title control's 14px padding + border floor.
      const cap = 104;
      const fixed = 18 + 32 + 44 + 3 * 2 + 8 + 14;
      expect(cap + fixed).toBeLessThanOrEqual(229);
    } finally {
      unmount();
    }
  });
});

describe("Phase 111 fix — retarget popover dismissal (ADV-240)", () => {
  function openRetarget(host: HTMLElement): void {
    openMore(host, "0");
    clickOn(menu(host).querySelector("[data-outline-retarget-open]") as Element);
  }

  it("closes on Escape and returns focus to the row More", () => {
    const { host, unmount } = renderPanel();
    try {
      openRetarget(host);
      expect(host.ownerDocument.querySelector("[data-outline-retarget-popover]")).not.toBeNull();
      const more = row(host, "0").querySelector<HTMLElement>("[data-outline-more]");
      pressEscape();
      expect(host.ownerDocument.querySelector("[data-outline-retarget-popover]")).toBeNull();
      expect(document.activeElement).toBe(more);
    } finally {
      unmount();
    }
  });

  it("closes on an outside pointerdown, cancels its default focus move, and returns focus to the row More", () => {
    const { host, unmount } = renderPanel();
    try {
      openRetarget(host);
      expect(host.ownerDocument.querySelector("[data-outline-retarget-popover]")).not.toBeNull();
      const more = row(host, "0").querySelector<HTMLElement>("[data-outline-more]");
      // DEF-617: the browser moves focus to the pressed target on pointerdown's
      // default action AFTER the listener, so the handler must cancel it for the
      // synchronous focus return to stick (otherwise focus lands on BODY).
      const event = pointerDownEvent(document.body);
      expect(event.defaultPrevented).toBe(true);
      expect(host.ownerDocument.querySelector("[data-outline-retarget-popover]")).toBeNull();
      expect(document.activeElement).toBe(more);
    } finally {
      unmount();
    }
  });

  it("stays open on a pointerdown inside the popover and leaves its default alone", () => {
    const { host, unmount } = renderPanel();
    try {
      openRetarget(host);
      const select = host.ownerDocument.querySelector<HTMLElement>("[data-outline-retarget]");
      expect(select).not.toBeNull();
      const event = pointerDownEvent(select as HTMLElement);
      expect(event.defaultPrevented).toBe(false);
      expect(host.ownerDocument.querySelector("[data-outline-retarget-popover]")).not.toBeNull();
    } finally {
      unmount();
    }
  });
});

