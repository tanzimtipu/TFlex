// @vitest-environment jsdom
// DEF-325 — the REVIEW annotations flyout must stay inside the CANVAS.
//
// At the 640px minimum the 264px Inspector overlays the canvas; the flyout's
// old fixed `min-width: 260px` won over its canvas-relative max-width, so the
// box centred and its right half (the "All annotation tools" dropdown toggle)
// landed under the Inspector and the click was swallowed.
//
// The fix keeps the flyout canvas-bound (`min-width: 0`, `overflow: hidden`);
// Phase 37 (item 3) keeps the annotation capsule on ONE row (no wrap) and
// scrolls it with the ladder's arrows, so the dropdown toggle stays inside the
// canvas at every width. These tests pin the CSS contract at 1440 / 1100 / 900
// / 760 / 640 and exercise the toggle itself.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AnnotationFlyout } from "../../../src/renderer/components/AnnotationFlyout";
import { AnnotationToolbar } from "../../../src/renderer/annotations/AnnotationToolbar";
import { initialAnnotationToolState } from "../../../src/renderer/annotations/model";

const CSS = readFileSync(
  path.resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
);

function ruleBody(selector: string): string | null {
  // Aggregate EVERY matching block (the flyout's contract is split across the
  // base rule and the DEF-325 rule that follow it).
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const needle = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g");
  const bodies: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = needle.exec(CSS)) !== null) bodies.push(m[1]);
  return bodies.length === 0 ? null : bodies.join("\n");
}

const WIDTHS = [1440, 1100, 900, 760, 640] as const;

describe("DEF-325 — the flyout is canvas-bound at every supported width", () => {
  it.each(WIDTHS)("flyout geometry stays canvas-relative at %ipx", () => {
    // Anchored to the canvas overlay (left/right 0), never the window; and it
    // can shrink to the canvas instead of holding a fixed floor.
    const anchor = ruleBody(".annotation-flyout-anchor");
    expect(anchor).not.toBeNull();
    expect(anchor).toMatch(/left:\s*0/);
    expect(anchor).toMatch(/right:\s*0/);

    const flyout = ruleBody(".annotation-flyout");
    expect(flyout).not.toBeNull();
    expect(flyout).toMatch(/max-width:\s*calc\(100% - 24px\)/);
    expect(flyout).toMatch(/min-width:\s*0/);
    expect(flyout).toMatch(/overflow:\s*hidden/);
    // The 260px floor that caused the Inspector overlay is gone.
    expect(flyout).not.toMatch(/min-width:\s*260px/);
  });

  it("the annotation capsule stays on ONE scrolling row inside the flyout (Phase 37 item 3)", () => {
    const group = ruleBody(".annotation-flyout .ann-toolbar");
    expect(group).not.toBeNull();
    // Phase 37 (item 3) supersedes the DEF-325 wrap: the row never wraps; the
    // ladder's arrows scroll the body instead.
    expect(group).toMatch(/flex-wrap:\s*nowrap/);
    expect(group).toMatch(/max-width:\s*100%/);

    const tools = ruleBody(".annotation-flyout .ann-tools-visible");
    expect(tools).not.toBeNull();
    expect(tools).toMatch(/flex-wrap:\s*nowrap/);

    const body = ruleBody(".annotation-flyout-body");
    expect(body).not.toBeNull();
    expect(body).toMatch(/min-width:\s*0/);
    expect(body).toMatch(/overflow-x:\s*auto/);

    const row = ruleBody(".annotation-flyout-row");
    expect(row).not.toBeNull();
    expect(row).toMatch(/display:\s*flex/);
  });

  it("renders the real dropdown toggle and opens its menu (the DEF-325 target)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(
        <AnnotationFlyout open onClose={vi.fn()}>
          <AnnotationToolbar
            state={initialAnnotationToolState}
            onAction={vi.fn()}
            theme="dark"
          />
        </AnnotationFlyout>,
      );
    });
    try {
      const toggle = host.querySelector("[data-ann-dropdown-toggle]");
      expect(toggle, "the all-tools dropdown toggle renders").not.toBeNull();
      expect(host.querySelectorAll("[data-ann-tools-visible]")).toHaveLength(1);
      expect(document.querySelector("[data-ann-dropdown-menu]")).toBeNull();
      act((): void => {
        (toggle as HTMLElement).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      // The menu portals to document.body and mounts (the toggle click is not
      // swallowed by the capsule or the flyout).
      const menu = document.querySelector("[data-ann-dropdown-menu]");
      expect(menu, "clicking the toggle opens the menu").not.toBeNull();
      expect(menu?.getAttribute("role")).toBe("menu");
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });
});
