// @vitest-environment jsdom
//
// TFL-1520 (chunk A) — the Intake Tray is ONE shared box: the drop zone and
// the queued file rows sit inside a single container, separated by hairline
// `.intake-sep` dividers. Empty state is just the drop zone (plus the kept
// `intake-empty` hook); the last row never carries a trailing separator.
//
// Separator count follows docs/TFL-1520-plan.md: for the default (Home)
// surface, one divider sits between the drop zone and the first row and one
// between each adjacent pair, so separators === items.length. With the drop
// zone hidden (canvas surface) there are only inter-row dividers (N - 1).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { IntakeItem } from "../../../src/renderer/intake/model";
import { IntakeTray } from "../../../src/renderer/intake/IntakeTray";

function makeItem(overrides: Partial<IntakeItem> = {}): IntakeItem {
  const base: IntakeItem = {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2)}`,
    name: overrides.name ?? "report.pdf",
    pathOrFile: overrides.pathOrFile ?? "/docs/report.pdf",
    kind: overrides.kind ?? "pdf",
    state: overrides.state ?? "ready",
  };
  if (overrides.error !== undefined) base.error = overrides.error;
  return base;
}

let activeCleanup: (() => void) | null = null;

afterEach((): void => {
  activeCleanup?.();
  activeCleanup = null;
});

function renderTray(
  items: readonly IntakeItem[],
  props: { showDropzone?: boolean } = {},
): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act((): void => {
    root.render(<IntakeTray items={items} {...props} />);
  });
  const cleanup = (): void => {
    act((): void => {
      root.unmount();
    });
    container.remove();
  };
  activeCleanup = cleanup;
  return { container, cleanup };
}

describe("TFL-1520 chunk A — Intake Tray as one box with separators", () => {
  it("empty state: exactly one drop zone, no list rows, no separators", () => {
    const { container, cleanup } = renderTray([]);

    expect(container.querySelectorAll("[data-intake-tray]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-intake-dropzone]")).toHaveLength(1);
    expect(container.querySelector(".intake-empty")).not.toBeNull();
    expect(container.querySelectorAll("[data-intake-row]")).toHaveLength(0);
    expect(container.querySelectorAll(".intake-sep")).toHaveLength(0);
    cleanup();
  });

  it("one file: drop zone + one row + one divider between them", () => {
    const { container, cleanup } = renderTray([
      makeItem({ id: "one", name: "one.pdf" }),
    ]);

    expect(container.querySelectorAll("[data-intake-dropzone]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-intake-row]")).toHaveLength(1);
    expect(container.querySelectorAll(".intake-sep")).toHaveLength(1);
    expect(container.querySelector(".intake-empty")).toBeNull();
    // The single divider sits between the drop zone and the row.
    const list = container.querySelector(".intake-list");
    expect(list?.firstElementChild?.classList.contains("intake-sep")).toBe(true);
    cleanup();
  });

  it("two files: drop zone + N rows + N dividers, no trailing divider", () => {
    const { container, cleanup } = renderTray([
      makeItem({ id: "one", name: "one.pdf" }),
      makeItem({ id: "two", name: "two.png", kind: "image" }),
    ]);

    const tray = container.querySelector("[data-intake-tray]");
    expect(tray?.getAttribute("data-intake-count")).toBe("2");
    expect(container.querySelectorAll("[data-intake-dropzone]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-intake-row]")).toHaveLength(2);
    expect(container.querySelectorAll(".intake-sep")).toHaveLength(2);

    // Structure is sep, row, sep, row — dividers between, never trailing.
    const list = container.querySelector(".intake-list");
    const kids = Array.from(list?.children ?? []).map((el) =>
      el.classList.contains("intake-sep") ? "sep" : "row",
    );
    expect(kids).toEqual(["sep", "row", "sep", "row"]);
    cleanup();
  });

  it("dropped drop zone (canvas surface): only inter-row dividers", () => {
    const { container, cleanup } = renderTray(
      [makeItem({ id: "one" }), makeItem({ id: "two" })],
      { showDropzone: false },
    );

    expect(container.querySelector("[data-intake-dropzone]")).toBeNull();
    expect(container.querySelectorAll("[data-intake-row]")).toHaveLength(2);
    expect(container.querySelectorAll(".intake-sep")).toHaveLength(1);
    cleanup();
  });

  it("keeps every data-intake-* hook on a populated default (Home) tray", () => {
    const { container, cleanup } = renderTray([
      makeItem({ id: "one", name: "one.pdf" }),
      makeItem({ id: "two", name: "two.pdf" }),
    ]);

    for (const hook of [
      "[data-intake-tray]",
      "[data-intake-dropzone]",
      "[data-intake-row='0']",
      "[data-intake-row='1']",
      "[data-intake-move-up='1']",
      "[data-intake-move-down='0']",
      "[data-intake-remove='0']",
      "[data-intake-open]",
      "[data-intake-state]",
    ]) {
      expect(container.querySelector(hook), hook).not.toBeNull();
    }
    cleanup();
  });
});
