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
import type { MenuGroup } from "../../../src/renderer/components/TitleBar";

/** Phase 105 (chunk C) — an empty View group hosts the spliced Multi Mode row. */
const APP_MENU_GROUPS: MenuGroup[] = [{ id: "view", label: "View", entries: [] }];

function renderHeader(): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <AppHeader
        activeId={null}
        appMenuGroups={APP_MENU_GROUPS}
        onPrint={(): void => undefined}
        onOpenFile={(): void => undefined}
        onSave={(): void => undefined}
        onSaveAs={(): void => undefined}
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

function multiModeRow(container: HTMLElement): HTMLButtonElement {
  act((): void => {
    container.querySelector<HTMLButtonElement>("[data-app-menu]")?.click();
  });
  const el = container.querySelector<HTMLButtonElement>("[data-menu-action='multiMode']");
  if (el === null) throw new Error("Multi Mode menu row missing");
  return el;
}

describe("Phase 40 item 8 — the Multi Mode command names view AND edit", () => {
  it("the relocated row label says view/edit two documents side by side", () => {
    const { container, cleanup } = renderHeader();
    try {
      const label = multiModeRow(container).textContent ?? "";
      expect(label).toContain("view/edit two");
      expect(label.toLowerCase()).toContain("side by side");
      expect(label).toContain("edit");
    } finally {
      cleanup();
    }
  });

  it("the accessible name stays consistent with the row label", () => {
    const { container, cleanup } = renderHeader();
    try {
      expect(MULTI_MODE_ACCESSIBLE_NAME).toContain("view/edit two");
      expect(multiModeRow(container).textContent).toContain(MULTI_MODE_ACCESSIBLE_NAME);
    } finally {
      cleanup();
    }
  });

  it("the retired wording is gone", () => {
    expect(MULTI_MODE_ACCESSIBLE_NAME).not.toContain("Multi Mode: view two documents");
  });
});
