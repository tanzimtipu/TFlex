// @vitest-environment jsdom
//
// TFL-873 (chunk C2a) — interaction-surface dialog primitives.
//
// Mounted with the same raw react-dom/client + act pattern and
// flushMicrotasks helper as test/unit/renderer/dialogShell.test.tsx.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { DialogShell, type DialogAction } from "../../../src/renderer/components/DialogShell";
import { TaskDialog } from "../../../src/renderer/components/TaskDialog";
import { PreviewTaskDialog } from "../../../src/renderer/components/PreviewTaskDialog";

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

// Flush the queueMicrotask the shell uses for initial focus.
async function flushMicrotasks(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
  });
}

function twoActions(): DialogAction[] {
  return [
    { key: "cancel", label: "Cancel", variant: "secondary", onClick: vi.fn() },
    { key: "confirm", label: "Confirm", variant: "primary", onClick: vi.fn(), default: true },
  ];
}

/** Controllable prefers-reduced-motion stub (same shape as
 *  useAnimations.test.tsx). A fresh function identity forces the shared
 *  subscription to rebuild so boot-time reduced motion is honoured. */
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

describe("TFL-873 C2a — TaskDialog width classes", () => {
  it("width='compact' renders .task-dialog-compact on the task root", async () => {
    const { container, cleanup } = mount(
      <TaskDialog open title="Extract" onClose={vi.fn()} width="compact" actions={twoActions()}>
        <p>body</p>
      </TaskDialog>,
    );
    await flushMicrotasks();
    const root = container.querySelector(".task-dialog");
    expect(root).not.toBeNull();
    expect(root?.classList.contains("task-dialog-compact")).toBe(true);
    expect(root?.classList.contains("task-dialog-standard")).toBe(false);
    cleanup();
  });

  it("width='standard' renders .task-dialog-standard on the task root", async () => {
    const { container, cleanup } = mount(
      <TaskDialog open title="Extract" onClose={vi.fn()} width="standard" actions={twoActions()}>
        <p>body</p>
      </TaskDialog>,
    );
    await flushMicrotasks();
    const root = container.querySelector(".task-dialog");
    expect(root?.classList.contains("task-dialog-standard")).toBe(true);
    expect(root?.classList.contains("task-dialog-compact")).toBe(false);
    cleanup();
  });
});

describe("TFL-873 C2a — headerContext", () => {
  it("renders the context line inside .modal-header as .modal-context", async () => {
    const { container, cleanup } = mount(
      <TaskDialog
        open
        title="Extract or split pages"
        onClose={vi.fn()}
        width="compact"
        headerContext={<span>Report.pdf - 12 pages</span>}
        actions={twoActions()}
      >
        <p>body</p>
      </TaskDialog>,
    );
    await flushMicrotasks();
    const header = container.querySelector(".modal-header");
    const context = header?.querySelector(".modal-context");
    expect(context).not.toBeNull();
    expect(context?.textContent).toContain("Report.pdf");
    expect(header?.classList.contains("has-header-context")).toBe(true);
    cleanup();
  });

  it("omits the context node and header modifier when headerContext is absent", async () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Plain" onClose={vi.fn()} actions={twoActions()}>
        <p>body</p>
      </DialogShell>,
    );
    await flushMicrotasks();
    expect(container.querySelector(".modal-context")).toBeNull();
    // The existing adopter header class list is byte-identical.
    expect(container.querySelector(".modal-header")?.className).toBe("modal-header");
    cleanup();
  });
});

describe("TFL-873 C2a — bounded body scroll", () => {
  it("bodyScroll pins the header/footer outside the single scrolling body", async () => {
    const { container, cleanup } = mount(
      <TaskDialog open title="Scroll" onClose={vi.fn()} width="standard" actions={twoActions()}>
        <p>long body</p>
      </TaskDialog>,
    );
    await flushMicrotasks();
    const root = container.querySelector(".modal-dialog");
    const body = container.querySelector(".modal-body");
    const header = container.querySelector(".modal-header");
    const footer = container.querySelector(".modal-footer");
    expect(root?.classList.contains("modal-dialog-body-scroll")).toBe(true);
    expect(body?.classList.contains("modal-body-scroll")).toBe(true);
    // The header/footer are siblings of the scroll region, never inside it.
    expect(header).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(body?.contains(header as Node)).toBe(false);
    expect(body?.contains(footer as Node)).toBe(false);
    cleanup();
  });

  it("omits the scroll classes when bodyScroll is not requested", async () => {
    const { container, cleanup } = mount(
      <DialogShell open title="Plain" onClose={vi.fn()} actions={twoActions()}>
        <p>body</p>
      </DialogShell>,
    );
    await flushMicrotasks();
    expect(container.querySelector(".modal-body-scroll")).toBeNull();
    expect(container.querySelector(".modal-dialog-body-scroll")).toBeNull();
    expect(container.querySelector(".modal-body")?.className).toBe("modal-body");
    cleanup();
  });
});

describe("TFL-873 C2a — PreviewTaskDialog", () => {
  it("always carries the preview width class", async () => {
    const { container, cleanup } = mount(
      <PreviewTaskDialog open title="Images" onClose={vi.fn()} actions={twoActions()} />,
    );
    await flushMicrotasks();
    expect(container.querySelector(".task-dialog-preview")).not.toBeNull();
    cleanup();
  });

  it("does not reserve a pre-sized blank body when empty", async () => {
    const { container, cleanup } = mount(
      <PreviewTaskDialog open title="Images" onClose={vi.fn()} actions={twoActions()} />,
    );
    await flushMicrotasks();
    // No content marker => no fixed-height preview body.
    expect(container.querySelector(".task-dialog-preview-grow")).toBeNull();
    cleanup();
  });

  it("emits the grow marker once content is present", async () => {
    const { container, cleanup } = mount(
      <PreviewTaskDialog open title="Images" onClose={vi.fn()} actions={twoActions()}>
        <p>image list</p>
      </PreviewTaskDialog>,
    );
    await flushMicrotasks();
    expect(container.querySelector(".task-dialog-preview-grow")).not.toBeNull();
    cleanup();
  });
});

describe("TFL-873 C2a — reduced motion", () => {
  it("still mounts the surface when the OS asks for reduced motion", async () => {
    installReducedMotionStub(true);
    const { container, cleanup } = mount(
      <TaskDialog open title="Reduced" onClose={vi.fn()} width="compact" actions={twoActions()}>
        <p>body</p>
      </TaskDialog>,
    );
    await flushMicrotasks();
    expect(container.querySelector(".task-dialog-compact")).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    cleanup();
  });
});

