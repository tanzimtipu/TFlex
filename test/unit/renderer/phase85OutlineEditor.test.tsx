// @vitest-environment jsdom
//
// Phase 85 (chunk C2) — the editable outline / bookmark panel.
//
// Covers the pure model (seed + every edit outcome + the commit revert) and
// the rendered OutlinePanel hooks: selection, the verbs, the page badge, the
// inline rename, the retarget select, indent / outdent, delete, the empty
// tree add and the `[data-outline-error]` surface. Two rules matter most:
//   - an invalid edit (empty title / out-of-range target) makes NO engine
//     call and leaves the model untouched;
//   - a refused commit reverts to the last accepted tree, so the panel never
//     shows an edit the engine did not accept.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { err, ok } from "../../../src/shared/result";
import {
  commitOutlineEdit,
  editAdd,
  editDelete,
  editIndent,
  editOutdent,
  editRename,
  editRetarget,
  seedOutlineEntries,
  type OutlineEditOutcome,
  type OutlineEntry,
} from "../../../src/renderer/state/outlineEditor";
import { OutlinePanel } from "../../../src/renderer/components/SideRail";
import type { OutlineEditorConfig } from "../../../src/renderer/components/SideRail";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { OutlineNode } from "../../../src/renderer/pdf/pdfjs";

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

const SEED: OutlineEntry[] = [
  { title: "Chapter 1", page: 1, children: [] },
  {
    title: "Chapter 2",
    page: 3,
    children: [{ title: "Section", page: 4, children: [] }],
  },
];

function freshSeed(): OutlineEntry[] {
  return SEED.map((entry) => ({
    title: entry.title,
    page: entry.page,
    children: entry.children.map((child) => ({ ...child, children: [] })),
  }));
}

// ---------------------------------------------------------------------------
// Pure model

describe("outlineEditor — model seed", () => {
  it("seeds entries and resolves each destination to a visible page", async () => {
    const nodes: OutlineNode[] = [
      {
        title: "A",
        dest: "a",
        children: [{ title: "B", dest: "b", children: [] }],
      },
      { title: "C", dest: null, children: [] },
    ];
    const resolve = vi.fn(async (dest: unknown) => {
      if (dest === "a") return 2;
      if (dest === "b") return 5;
      return null;
    });
    const entries = await seedOutlineEntries(nodes, resolve);
    expect(entries).toEqual([
      { title: "A", page: 2, children: [{ title: "B", page: 5, children: [] }] },
      { title: "C", page: null, children: [] },
    ]);
    expect(resolve).toHaveBeenCalledTimes(3);
  });
});

describe("outlineEditor — edit outcomes", () => {
  it("adds the first entry to an empty tree", () => {
    const outcome = editAdd([], null);
    expect(outcome).toEqual({
      kind: "apply",
      entries: [{ title: "New bookmark", page: null, children: [] }],
      selection: [0],
    });
  });

  it("adds a sibling right after the selection", () => {
    const outcome = editAdd(freshSeed(), [0]);
    expect(outcome.kind).toBe("apply");
    if (outcome.kind !== "apply") return;
    expect(outcome.entries.map((e) => e.title)).toEqual([
      "Chapter 1",
      "New bookmark",
      "Chapter 2",
    ]);
    expect(outcome.selection).toEqual([1]);
  });

  it("rejects an empty trimmed title without touching the tree", () => {
    const outcome = editRename(freshSeed(), [0], "   ");
    expect(outcome).toEqual({ kind: "invalid", error: "A bookmark needs a title." });
  });

  it("rejects an out-of-range retarget", () => {
    expect(editRetarget(freshSeed(), [0], 99, 10).kind).toBe("invalid");
    expect(editRetarget(freshSeed(), [0], 0, 10).kind).toBe("invalid");
    expect(editRetarget(freshSeed(), [0], "nope", 10).kind).toBe("invalid");
  });

  it("retargets a valid page", () => {
    const outcome = editRetarget(freshSeed(), [1], 8, 10);
    expect(outcome.kind).toBe("apply");
    if (outcome.kind !== "apply") return;
    expect(outcome.entries[1].page).toBe(8);
  });

  it("refuses to indent a first child and to outdent a root row", () => {
    expect(editIndent(freshSeed(), [0]).kind).toBe("invalid");
    expect(editOutdent(freshSeed(), [0]).kind).toBe("invalid");
    // The nested Section is a first child (no previous sibling).
    expect(editIndent(freshSeed(), [1, 0]).kind).toBe("invalid");
    // Chapter 2 has a previous sibling, so it can nest.
    expect(editIndent(freshSeed(), [1]).kind).toBe("apply");
    // Section can outdent to Chapter 2's level.
    expect(editOutdent(freshSeed(), [1, 0]).kind).toBe("apply");
  });

  it("deletes an entry and its subtree", () => {
    const outcome = editDelete(freshSeed(), [1]);
    expect(outcome.kind).toBe("apply");
    if (outcome.kind !== "apply") return;
    expect(outcome.entries.map((e) => e.title)).toEqual(["Chapter 1"]);
  });
});

describe("outlineEditor — commit", () => {
  it("reverts to the current tree when the engine refuses", async () => {
    const current = freshSeed();
    const next: OutlineEntry[] = [{ title: "Renamed", page: 1, children: [] }];
    const outcome: OutlineEditOutcome = { kind: "apply", entries: next, selection: [0] };
    const setOutline = vi.fn(async () => err("out-of-range", "page 99 out of range"));
    const result = await commitOutlineEdit({
      docId: "doc-1",
      current,
      outcome,
      setOutline,
    });
    expect(setOutline).toHaveBeenCalledTimes(1);
    expect(result.error).toBe("page 99 out of range");
    expect(result.entries).toBe(current);
  });

  it("adopts the accepted tree on success", async () => {
    const current = freshSeed();
    const next: OutlineEntry[] = [{ title: "Renamed", page: 1, children: [] }];
    const setOutline = vi.fn(async () => ok(makeEngineState()));
    const result = await commitOutlineEdit({
      docId: "doc-1",
      current,
      outcome: { kind: "apply", entries: next, selection: [0] },
      setOutline,
    });
    expect(result.error).toBeNull();
    expect(result.entries).toBe(next);
  });

  it("never calls the engine for an invalid outcome", async () => {
    const setOutline = vi.fn(async () => ok(makeEngineState()));
    const result = await commitOutlineEdit({
      docId: "doc-1",
      current: freshSeed(),
      outcome: { kind: "invalid", error: "A bookmark needs a title." },
      setOutline,
    });
    expect(setOutline).not.toHaveBeenCalled();
    expect(result.error).toBe("A bookmark needs a title.");
  });
});

// ---------------------------------------------------------------------------
// Rendered panel

interface Harness {
  host: HTMLElement;
  commit: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function renderOutlinePanel(
  options: {
    entries?: OutlineEntry[];
    outline?: OutlineNode[];
    visiblePageCount?: number;
    commit?: OutlineEditorConfig["commit"];
    onJump?: (page: number) => void;
    onError?: (message: string) => void;
  } = {},
): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const commitImpl: OutlineEditorConfig["commit"] =
    options.commit ?? (async () => ok(makeEngineState()));
  const commit = vi.fn(commitImpl);
  const config: OutlineEditorConfig = {
    docId: "doc-1",
    entries: options.entries ?? freshSeed(),
    visiblePageCount: options.visiblePageCount ?? 10,
    commit,
  };
  act((): void => {
    root.render(
      <OutlinePanel
        doc={makeDocStub()}
        outline={options.outline ?? []}
        onJump={options.onJump ?? ((): void => undefined)}
        onError={options.onError}
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

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function rows(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("[data-outline-row]")];
}

// Phase 111 (chunk C) — the per-row verbs moved into an always-visible More
// popover. These helpers open a row's menu and resolve one of its commands.
function openRowMore(host: HTMLElement, index: number): void {
  const more = rows(host)[index].querySelector<HTMLElement>("[data-outline-more]");
  if (more === null) throw new Error(`no More on row ${index}`);
  clickOn(more);
}

function menuRow(host: HTMLElement, hook: string): HTMLElement {
  // TFL-1083 (DEF-615) — the row More menu is portalled to `document.body`, so
  // it is no longer a descendant of the test host; query the whole document.
  const menu = host.ownerDocument.querySelector<HTMLElement>("[data-outline-menu]");
  if (menu === null) throw new Error("no open outline menu");
  const row = menu.querySelector<HTMLElement>(`[data-outline-${hook}]`);
  if (row === null) throw new Error(`no menu row ${hook}`);
  return row;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressEnter(input: HTMLInputElement): void {
  act((): void => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
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

describe("OutlinePanel — editable", () => {
  it("renders a row per entry with the resolved page badge", () => {
    const h = renderOutlinePanel();
    try {
      expect(rows(h.host).length).toBe(3);
      const badges = [...h.host.querySelectorAll("[data-outline-page]")].map(
        (el) => el.textContent,
      );
      expect(badges).toEqual(["1", "3", "4"]);
    } finally {
      h.unmount();
    }
  });

  it("selects on a row click and exposes the verbs on the selected row", () => {
    const h = renderOutlinePanel();
    try {
      // The header always offers the add verb.
      expect(h.host.querySelector("[data-outline-add]")).not.toBeNull();
      clickOn(rows(h.host)[1]);
      const selected = h.host.querySelector(
        '[data-outline-row][data-outline-selected="true"]',
      );
      expect(selected?.getAttribute("data-outline-path")).toBe("1");
      // Phase 111 (chunk C) — the row verbs live in the selected row's More.
      openRowMore(h.host, 1);
      expect(menuRow(h.host, "delete")).not.toBeNull();
      expect(menuRow(h.host, "rename")).not.toBeNull();
    } finally {
      h.unmount();
    }
  });

  it("commits an add of a sibling with the right payload", async () => {
    const h = renderOutlinePanel();
    try {
      openRowMore(h.host, 0);
      clickOn(menuRow(h.host, "add"));
      await flush();
      expect(h.commit).toHaveBeenCalledTimes(1);
      const [, payload] = h.commit.mock.calls[0] as [string, OutlineEntry[]];
      expect(payload.map((entry) => entry.title)).toEqual([
        "Chapter 1",
        "New bookmark",
        "Chapter 2",
      ]);
    } finally {
      h.unmount();
    }
  });

  it("shows [data-outline-error] and calls no engine for an empty title", async () => {
    const h = renderOutlinePanel();
    try {
      openRowMore(h.host, 0);
      clickOn(menuRow(h.host, "rename"));
      const input = h.host.querySelector<HTMLInputElement>("[data-outline-rename-input]");
      expect(input).not.toBeNull();
      input?.focus();
      setInputValue(input as HTMLInputElement, "   ");
      pressEnter(input as HTMLInputElement);
      await flush();
      expect(h.commit).not.toHaveBeenCalled();
      const error = h.host.querySelector("[data-outline-error]");
      expect(error).not.toBeNull();
      expect(error?.textContent).toContain("title");
      expect(h.host.querySelector(".outline-link")?.textContent).toBe("Chapter 1");
    } finally {
      h.unmount();
    }
  });

  it("renames inline and commits the trimmed title", async () => {
    const h = renderOutlinePanel();
    try {
      openRowMore(h.host, 0);
      clickOn(menuRow(h.host, "rename"));
      const input = h.host.querySelector<HTMLInputElement>("[data-outline-rename-input]");
      input?.focus();
      setInputValue(input as HTMLInputElement, "  Intro  ");
      pressEnter(input as HTMLInputElement);
      await flush();
      expect(h.commit).toHaveBeenCalledTimes(1);
      const [, payload] = h.commit.mock.calls[0] as [string, OutlineEntry[]];
      expect(payload[0].title).toBe("Intro");
    } finally {
      h.unmount();
    }
  });

  it("rejects an out-of-range retarget without calling the engine", async () => {
    const h = renderOutlinePanel();
    try {
      openRowMore(h.host, 0);
      clickOn(menuRow(h.host, "retarget-open"));
      changeSelect(
        h.host.ownerDocument.querySelector("[data-outline-retarget]") as HTMLSelectElement,
        "99",
      );
      await flush();
      expect(h.commit).not.toHaveBeenCalled();
      expect(h.host.querySelector("[data-outline-error]")).not.toBeNull();
    } finally {
      h.unmount();
    }
  });

  it("commits a valid retarget with the selected page", async () => {
    const h = renderOutlinePanel();
    try {
      openRowMore(h.host, 0);
      clickOn(menuRow(h.host, "retarget-open"));
      changeSelect(
        h.host.ownerDocument.querySelector("[data-outline-retarget]") as HTMLSelectElement,
        "7",
      );
      await flush();
      expect(h.commit).toHaveBeenCalledTimes(1);
      const [, payload] = h.commit.mock.calls[0] as [string, OutlineEntry[]];
      expect(payload[0].page).toBe(7);
    } finally {
      h.unmount();
    }
  });

  it("disables indent on a first child and outdent on a root row, with tooltips", () => {
    const h = renderOutlinePanel();
    try {
      openRowMore(h.host, 0);
      const indent = menuRow(h.host, "indent") as HTMLButtonElement;
      const outdent = menuRow(h.host, "outdent") as HTMLButtonElement;
      expect(indent.disabled).toBe(true);
      expect(indent.getAttribute("title")).toContain("first");
      expect(outdent.disabled).toBe(true);
      expect(outdent.getAttribute("title")).toContain("top level");
    } finally {
      h.unmount();
    }
  });

  it("commits an indent of a non-first sibling", async () => {
    const h = renderOutlinePanel();
    try {
      openRowMore(h.host, 1);
      clickOn(menuRow(h.host, "indent"));
      await flush();
      expect(h.commit).toHaveBeenCalledTimes(1);
      const [, payload] = h.commit.mock.calls[0] as [string, OutlineEntry[]];
      expect(payload[0].children.map((child) => child.title)).toEqual(["Chapter 2"]);
    } finally {
      h.unmount();
    }
  });

  it("commits a delete of the entry and its subtree", async () => {
    const h = renderOutlinePanel();
    try {
      openRowMore(h.host, 1);
      clickOn(menuRow(h.host, "delete"));
      await flush();
      expect(h.commit).toHaveBeenCalledTimes(1);
      const [, payload] = h.commit.mock.calls[0] as [string, OutlineEntry[]];
      expect(payload.map((entry) => entry.title)).toEqual(["Chapter 1"]);
    } finally {
      h.unmount();
    }
  });

  it("adds the first entry when the tree is empty", async () => {
    const h = renderOutlinePanel({ entries: [] });
    try {
      expect(rows(h.host).length).toBe(0);
      const add = h.host.querySelector("[data-outline-add]");
      expect(add).not.toBeNull();
      clickOn(add as Element);
      await flush();
      expect(h.commit).toHaveBeenCalledTimes(1);
      const [, payload] = h.commit.mock.calls[0] as [string, OutlineEntry[]];
      expect(payload).toEqual([{ title: "New bookmark", page: null, children: [] }]);
    } finally {
      h.unmount();
    }
  });

  it("reverts to the last accepted tree and shows the error when the engine refuses", async () => {
    const commit = vi.fn(async () => err("out-of-range", "page 7 out of range"));
    const h = renderOutlinePanel({ commit });
    try {
      openRowMore(h.host, 0);
      clickOn(menuRow(h.host, "retarget-open"));
      changeSelect(
        h.host.ownerDocument.querySelector("[data-outline-retarget]") as HTMLSelectElement,
        "7",
      );
      await flush();
      expect(h.commit).toHaveBeenCalledTimes(1);
      expect(h.host.querySelector("[data-outline-error]")?.textContent).toContain(
        "out of range",
      );
      // Reverted: the badge still shows the accepted page 1.
      expect(h.host.querySelector("[data-outline-page]")?.textContent).toBe("1");
    } finally {
      h.unmount();
    }
  });
});

