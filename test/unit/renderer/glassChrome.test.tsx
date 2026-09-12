// @vitest-environment jsdom
//
// Phase 14.1 — GlassChrome primitives.
//
// The corrected Liquid Glass material system shares THREE primitives:
// GlassChromeBar (standardized top-bar heights) and GlassControlGroup
// (the command bar's capsule). These tests pin the DOM shape + a11y
// contract so the grouped chrome can't silently regress:
//   1. The heights constants mirror the CSS chrome tokens.
//   2. GlassChromeBar emits the variant class + the height var and
//      forwards legacy attributes (data-titlebar and friends).
//   3. GlassControlGroup is a labelled group (role="group" +
//      aria-label) so the no-op sweep can name every capsule.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  GLASS_CHROME_HEIGHTS,
  GlassChromeBar,
  GlassControlGroup,
} from "../../../src/renderer/components/GlassChrome";

function mount(element: React.ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return host;
}

function unmount(host: HTMLElement): void {
  host.remove();
}

describe("GlassChrome — standardized chrome heights", () => {
  it("pins the three standardized top-bar heights (no arbitrary heights)", () => {
    expect(GLASS_CHROME_HEIGHTS.titleBar).toBe(44);
    expect(GLASS_CHROME_HEIGHTS.commandBar).toBe(52);
    expect(GLASS_CHROME_HEIGHTS.contextBar).toBe(40);
  });

  it("GlassChromeBar emits the variant class + the height token style", () => {
    const host = mount(<GlassChromeBar variant="commandBar" data-testid="bar" />);
    try {
      const bar = host.querySelector<HTMLElement>("[data-testid='bar']");
      expect(bar).not.toBeNull();
      expect(bar?.classList.contains("glass-chrome")).toBe(true);
      expect(bar?.classList.contains("glass-chrome-command")).toBe(true);
      expect(bar?.getAttribute("style")).toContain("--chrome-commandbar-h");
    } finally {
      unmount(host);
    }
  });

  it("the title variant keeps the legacy class + data attributes (drag contract)", () => {
    const host = mount(
      <GlassChromeBar variant="titleBar" className="titlebar" data-titlebar>
        <span>slot</span>
      </GlassChromeBar>,
    );
    try {
      const bar = host.querySelector<HTMLElement>("[data-titlebar]");
      expect(bar).not.toBeNull();
      expect(bar?.classList.contains("titlebar")).toBe(true);
      expect(bar?.classList.contains("glass-chrome-title")).toBe(true);
      expect(bar?.getAttribute("style")).toContain("--chrome-titlebar-h");
      // Children pass through — the caption strip's slot still mounts.
      expect(bar?.querySelector("span")?.textContent).toBe("slot");
    } finally {
      unmount(host);
    }
  });
});

describe("GlassControlGroup — the command bar capsule", () => {
  it("renders a labelled group with its children", () => {
    const host = mount(
      <GlassControlGroup label="Navigation">
        <button type="button" aria-label="Previous page">p</button>
      </GlassControlGroup>,
    );
    try {
      const group = host.querySelector<HTMLDivElement>("div[role='group']");
      expect(group).not.toBeNull();
      expect(group?.getAttribute("aria-label")).toBe("Navigation");
      expect(group?.querySelector("button")?.getAttribute("aria-label")).toBe(
        "Previous page",
      );
      // The capsule class is on the element (the CSS contract).
      expect(group?.classList.contains("glass-control-group")).toBe(true);
    } finally {
      unmount(host);
    }
  });

  it("keeps extra classes so the toolbar overflow contract applies", () => {
    const host = mount(
      <GlassControlGroup label="Save" className="toolbar-group">
        <span>children</span>
      </GlassControlGroup>,
    );
    try {
      const group = host.querySelector<HTMLElement>("[role='group']");
      expect(group?.classList.contains("toolbar-group")).toBe(true);
    } finally {
      unmount(host);
    }
  });
});