// @vitest-environment jsdom
// Phase 25 / Phase 38 — the text-properties panel has no header chrome.
//
// Phase 38 (feature C) SUPERSEDES the Phase-25 floating-card contract: the
// panel's drag-to-move wrapper, its float attribute and its ContentGrip handle
// are retired. The panel's one home is the Inspector, fixed in place. Pins:
//   1. no header / title AND no grip / float / drag affordance remains;
//   2. the control surface + its stable hooks survive unchanged;
//   3. the host still no longer drives a page-reflow column: styles.css has
//      no --tf-text-w grid track or @property (static source scan), and the
//      DocumentView mounts no text panel at all.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { TextPropertiesPanel } from "../../../src/renderer/edit/TextPropertiesPanel";
import { defaultTextStyleValues, type TextStyleValues } from "../../../src/renderer/edit/textStyle";

function base(): TextStyleValues {
  return defaultTextStyleValues("Helvetica");
}

function mount(): { host: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      createElement(TextPropertiesPanel, {
        open: true,
        values: base(),
        defaults: base(),
        onPatch: (): void => undefined,
      }),
    );
  });
  return {
    host: container,
    cleanup: (): void => {
      act((): void => root.unmount());
      container.remove();
    },
  };
}

describe("Phase 38 — the panel is fixed, with no drag chrome", () => {
  it("renders no header / title and no grip / float / drag affordance", () => {
    const { host, cleanup } = mount();
    expect(host.querySelector(".text-props-header")).toBeNull();
    expect(host.querySelector(".text-props-title")).toBeNull();
    // Phase 38 — the floating wrapper, grip and drag handle are gone.
    expect(host.querySelector("[data-text-panel-float]")).toBeNull();
    expect(host.querySelector("[data-text-panel-grip]")).toBeNull();
    expect(host.querySelector(".text-props-grip")).toBeNull();
    expect(host.querySelector("[data-drag-grip='text-props']")).toBeNull();
    // The control surface + its stable hooks survive.
    expect(host.querySelector("[data-text-panel]")).not.toBeNull();
    expect(host.querySelector("[data-txt-font]")).not.toBeNull();
    expect(host.querySelector("[data-txt-bold]")).not.toBeNull();
    cleanup();
  });
});

describe("Phase 25 — the page-reflow column is retired", () => {
  const STYLES = readFileSync(resolve(__dirname, "../../../src/renderer/styles.css"), "utf8");
  const DOCVIEW = readFileSync(
    resolve(__dirname, "../../../src/renderer/components/DocumentView.tsx"),
    "utf8",
  );
  const CLEAN = STYLES.replace(/\/\*[\s\S]*?\*\//g, "");

  it("styles.css declares no --tf-text-w track, @property or open rule", () => {
    expect(CLEAN).not.toMatch(/@property\s+--tf-text-w/);
    expect(CLEAN).not.toMatch(/--tf-text-w\s*:/);
    expect(CLEAN).not.toMatch(/var\(--tf-text-w/);
    // The workspace grid is rail + page only.
    expect(CLEAN).toMatch(/grid-template-columns:\s*var\(--tf-rail-w\)\s+1fr/);
  });

  it("styles.css has no text-props header / title rules", () => {
    expect(CLEAN).not.toMatch(/\.text-props-header\s*\{/);
    expect(CLEAN).not.toMatch(/\.text-props-title\s*\{/);
  });

  it("DocumentView mounts no text-properties panel (Inspector-only)", () => {
    // Strip comments: the retirement note may name the retired surface.
    const docCode = DOCVIEW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(docCode).not.toMatch(/--tf-text-w/);
    expect(docCode).not.toContain("<TextPropertiesPanel");
    expect(docCode).not.toContain("data-text-panel-float");
    expect(docCode).not.toContain("resolveFloatingTextPanelOpen");
  });
});
