// @vitest-environment jsdom
//
// Phase 40 (item 8) — the Multi Mode toggle's tooltip names VIEW and EDIT.
// The operator's report: the hover tooltip said "view two documents side by
// side", which reads as read-only; each pane's canvas keeps its edit surfaces,
// so the tooltip (and the accessible name, kept consistent with it) must say
// "view/edit two documents side by side". Both the OFF and the ON tooltip carry
// the wording, so a hover never loses it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  AppHeader,
  MULTI_MODE_ACCESSIBLE_NAME,
} from "../../../src/renderer/components/AppHeader";

function renderHeader(multiModeEnabled: boolean): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <AppHeader
        activeId={null}
        tabs={[]}
        onActivate={(): void => undefined}
        onClose={(): void => undefined}
        theme="frosted"
        onThemeChange={(): void => undefined}
        onNewEmptyTab={(): void => undefined}
        onOpenPreferences={(): void => undefined}
        onPrint={(): void => undefined}
        onOpenFile={(): void => undefined}
        onSave={(): void => undefined}
        onSaveAs={(): void => undefined}
        multiModeEnabled={multiModeEnabled}
        onMultiModeToggle={(): void => undefined}
      />,
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

function toggleOf(container: HTMLElement): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>("[data-header-multi-mode]");
  if (el === null) throw new Error("Multi Mode toggle missing");
  return el;
}

describe("Phase 40 item 8 — the Multi Mode tooltip names view AND edit", () => {
  it("the resting (OFF) tooltip says view/edit two documents side by side", () => {
    const { container, cleanup } = renderHeader(false);
    try {
      const title = toggleOf(container).getAttribute("title") ?? "";
      expect(title).toContain("view/edit two");
      expect(title.toLowerCase()).toContain("side by side");
      // The word "edit" is present (the operator's criterion).
      expect(title).toContain("edit");
    } finally {
      cleanup();
    }
  });

  it("the ON tooltip keeps the same wording", () => {
    const { container, cleanup } = renderHeader(true);
    try {
      const title = toggleOf(container).getAttribute("title") ?? "";
      expect(title).toContain("view/edit two");
      expect(title).toContain("return to one document");
    } finally {
      cleanup();
    }
  });

  it("the accessible name stays consistent with the tooltip", () => {
    for (const enabled of [false, true]) {
      const { container, cleanup } = renderHeader(enabled);
      try {
        const el = toggleOf(container);
        expect(el.getAttribute("aria-label")).toBe(MULTI_MODE_ACCESSIBLE_NAME);
        expect(MULTI_MODE_ACCESSIBLE_NAME).toContain("view/edit two");
        expect(el.getAttribute("aria-pressed")).toBe(enabled ? "true" : "false");
      } finally {
        cleanup();
      }
    }
  });

  it("the retired wording is gone from the renderer's live toggle", () => {
    const { container, cleanup } = renderHeader(false);
    try {
      const title = toggleOf(container).getAttribute("title") ?? "";
      expect(title).not.toContain("Multi Mode: view two documents");
    } finally {
      cleanup();
    }
  });
});
