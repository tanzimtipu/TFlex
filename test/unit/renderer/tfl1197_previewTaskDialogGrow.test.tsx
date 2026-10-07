// @vitest-environment jsdom
// TFL-1197 (DEF-632 / ER18) — PreviewTaskDialog's grow marker. The shipped
// default (grow iff any children exist) must be preserved for the other host
// (StampDialog); only a host that opts in with `grow` overrides it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PreviewTaskDialog } from "../../../src/renderer/components/PreviewTaskDialog";

function renderDialog(props: { children?: ReactNode; grow?: boolean }): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      createElement(PreviewTaskDialog, {
        open: true,
        title: "T",
        titleId: "tfl1197-title",
        onClose: (): void => undefined,
        ...props,
      }),
    );
  });
  return container;
}

function rootOf(container: HTMLElement): Element | null {
  return container.querySelector(".modal-dialog, .dialog-shell");
}

describe("TFL-1197 PreviewTaskDialog grow marker", () => {
  it("grows when children exist (default unchanged for other hosts)", () => {
    const c = renderDialog({ children: createElement("p", null, "content") });
    expect(rootOf(c)?.classList.contains("task-dialog-preview-grow")).toBe(true);
  });

  it("does not grow when empty (default unchanged)", () => {
    const c = renderDialog({});
    expect(rootOf(c)?.classList.contains("task-dialog-preview-grow")).toBe(false);
  });

  it("honours an explicit grow override even with children present", () => {
    const c = renderDialog({ children: createElement("p", null, "content"), grow: false });
    expect(rootOf(c)?.classList.contains("task-dialog-preview-grow")).toBe(false);
  });
});