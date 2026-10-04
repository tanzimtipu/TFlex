// @vitest-environment jsdom
//
// Phase 96 (chunk D) — the shared EmptyState contract: an optional hero mark
// rendered through the Phase-94 Icon wrapper, the headline, the optional help
// line, the `empty-state` root class and pass-through `data-*` forwarding.
// Mounted with the same raw react-dom/client + act pattern the other renderer
// tests use.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it } from "vitest";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileText } from "lucide-react";
import { EmptyState } from "../../../src/renderer/components/EmptyState";
import { ICON_SIZES } from "../../../src/renderer/icons/Icon";

function mount(node: ReactElement): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act((): void => {
    root.render(node);
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

describe("Phase 96-D — the EmptyState contract", () => {
  it("renders the headline and the optional help line", () => {
    const { container, cleanup } = mount(
      <EmptyState headline="Nothing here" help="Try again." />,
    );
    try {
      const root = container.querySelector(".empty-state");
      expect(root).not.toBeNull();
      expect(root?.querySelector(".empty-state-headline")?.textContent).toBe("Nothing here");
      expect(root?.querySelector(".empty-state-help")?.textContent).toBe("Try again.");
    } finally {
      cleanup();
    }
  });

  it("omits the help line when it is not given", () => {
    const { container, cleanup } = mount(<EmptyState headline="Nothing here" />);
    try {
      expect(container.querySelector(".empty-state-help")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("renders the optional hero mark through the Icon wrapper at the hero size", () => {
    const { container, cleanup } = mount(<EmptyState icon={FileText} headline="No files" />);
    try {
      const mark = container.querySelector(".empty-state-mark");
      expect(mark).not.toBeNull();
      expect(mark?.tagName.toLowerCase()).toBe("svg");
      expect(mark?.getAttribute("width")).toBe(String(ICON_SIZES.hero));
      expect(mark?.getAttribute("aria-hidden")).toBe("true");
    } finally {
      cleanup();
    }
  });

  it("renders no glyph when no icon is given", () => {
    const { container, cleanup } = mount(<EmptyState headline="No files" />);
    try {
      expect(container.querySelector("svg")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("keeps the `empty-state` root class and appends the given className", () => {
    const { container, cleanup } = mount(
      <EmptyState headline="No files" className="recent-empty" />,
    );
    try {
      const root = container.querySelector(".empty-state");
      expect(root).not.toBeNull();
      expect(root?.classList.contains("recent-empty")).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("forwards data-* props to the root unchanged", () => {
    const { container, cleanup } = mount(
      <EmptyState headline="No files" data-context-panel-thumbs-empty data-count="0" />,
    );
    try {
      const root = container.querySelector(".empty-state");
      expect(root?.hasAttribute("data-context-panel-thumbs-empty")).toBe(true);
      expect(root?.getAttribute("data-count")).toBe("0");
    } finally {
      cleanup();
    }
  });
});
