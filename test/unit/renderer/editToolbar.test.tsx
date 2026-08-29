// @vitest-environment jsdom
// Phase 10 — EditToolbar render tests.
//
// The EditToolbar is a small component; the test surface is mostly
// about wiring (correct prop plumbing, correct "active" class for
// the active tool, correct font selector with the persisted
// default). We mount it in jsdom and assert the resulting DOM so
// regressions in the markup are caught.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement, type ReactElement } from "react";
import { EditToolbar, defaultEditHint } from "../../../src/renderer/edit/EditToolbar";
import type { EditTool } from "../../../src/renderer/edit/model";

function mount(props: {
  tool: EditTool;
  defaultFont: "Helvetica" | "Times" | "Courier";
  onSelect?: (t: EditTool) => void;
}): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSelect = props.onSelect ?? ((): void => undefined);
  function Harness(): ReactElement {
    return createElement(EditToolbar, {
      tool: props.tool,
      onSelect,
      defaultFont: props.defaultFont,
      onDefaultFontChange: (): void => undefined,
      enabled: true,
      hint: defaultEditHint(props.tool),
    });
  }
  act((): void => {
    root.render(createElement(Harness));
  });
  return container;
}

describe("EditToolbar — render", () => {
  it("renders one button per Edit tool with the active treatment on the active one", () => {
    const host = mount({ tool: "text", defaultFont: "Helvetica" });
    // The toolbar surfaces four top-level modes: off / text /
    // box / image. Selecting "image" puts the page overlay into
    // image mode (select an existing image, or drag a rect to
    // place a new one). Pin the four-button shape — DEF-048.
    const buttons = host.querySelectorAll('[data-edit-tool]');
    expect(buttons).toHaveLength(4);
    const off = host.querySelector('[data-edit-tool="off"]');
    const text = host.querySelector('[data-edit-tool="text"]');
    const box = host.querySelector('[data-edit-tool="box"]');
    const image = host.querySelector('[data-edit-tool="image"]');
    expect(off).not.toBeNull();
    expect(text).not.toBeNull();
    expect(box).not.toBeNull();
    expect(image).not.toBeNull();
    expect(text?.classList.contains("edit-toolbar-btn-active")).toBe(true);
    expect(off?.classList.contains("edit-toolbar-btn-active")).toBe(false);
    expect(box?.classList.contains("edit-toolbar-btn-active")).toBe(false);
    expect(image?.classList.contains("edit-toolbar-btn-active")).toBe(false);
  });

  it("marks the image button active when the image tool is selected", () => {
    const host = mount({ tool: "image", defaultFont: "Helvetica" });
    const image = host.querySelector('[data-edit-tool="image"]');
    expect(image?.classList.contains("edit-toolbar-btn-active")).toBe(true);
    const off = host.querySelector('[data-edit-tool="off"]');
    expect(off?.classList.contains("edit-toolbar-btn-active")).toBe(false);
  });

  it("renders the image-tool hint when image is the active tool", () => {
    const host = mount({ tool: "image", defaultFont: "Helvetica" });
    const hint = host.querySelector('[data-edit-hint]');
    expect(hint?.textContent).toMatch(/image/i);
  });

  it("renders the default font in the font selector", () => {
    const host = mount({ tool: "text", defaultFont: "Times" });
    const select = host.querySelector("select") as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select?.value).toBe("Times");
  });

  it("renders a hint for the active tool", () => {
    const host = mount({ tool: "text", defaultFont: "Helvetica" });
    const hint = host.querySelector('[data-edit-hint]');
    expect(hint?.textContent).toContain("Click a text run");
  });

  it("dispatches onSelect when a tool button is clicked", () => {
    const onSelect = vi.fn<(t: EditTool) => void>();
    const host = mount({ tool: "off", defaultFont: "Helvetica", onSelect });
    const textBtn = host.querySelector('[data-edit-tool="text"]') as HTMLElement;
    act((): void => {
      textBtn.click();
    });
    expect(onSelect).toHaveBeenCalledWith("text");
  });

  it("dispatches onSelect('image') when the image tool button is clicked", () => {
    const onSelect = vi.fn<(t: EditTool) => void>();
    const host = mount({ tool: "off", defaultFont: "Helvetica", onSelect });
    const imageBtn = host.querySelector('[data-edit-tool="image"]') as HTMLElement;
    act((): void => {
      imageBtn.click();
    });
    expect(onSelect).toHaveBeenCalledWith("image");
  });
});

describe("defaultEditHint", () => {
  it("returns a sensible hint for every tool", () => {
    expect(defaultEditHint("off")).toMatch(/off/i);
    expect(defaultEditHint("text")).toMatch(/click/i);
    expect(defaultEditHint("box")).toMatch(/drag/i);
    expect(defaultEditHint("image")).toMatch(/image/i);
  });
});
