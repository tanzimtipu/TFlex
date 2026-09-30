// @vitest-environment jsdom
//
// Phase 67 (features A/B/C) — the conversion card and the 3D limitation bar
// adopt the Phase 59 protection behaviour: a rounded, animated box that
// auto-collapses into a floating "i" (info) icon at the canvas's top-left
// after a ~10 s reading pause, expandable/collapsible by the user with the
// dwell reset on every expand. Virtual time (`vi.useFakeTimers`) drives the
// dwell, exactly as in `phase59ProtectionNotice.test.tsx`. jsdom applies no
// stylesheet, so the placement contract (the three fixed horizontal slots) is
// asserted as a textual CSS scan while every state change is asserted against
// the rendered DOM.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { Pdf3dContent } from "../../../src/shared/types";
import { ConversionNotice } from "../../../src/renderer/components/ConversionNotice";
import { Pdf3dNotice } from "../../../src/renderer/components/Pdf3dNotice";
import { NOTICE_AUTO_COLLAPSE_MS } from "../../../src/renderer/hooks/useNoticeCollapse";
import type { ConvertNoticeState } from "../../../src/renderer/state/convert";
import { setAnimationsEnabledPreference } from "../../../src/renderer/hooks/motionPolicy";
import { MOTION_DURATION } from "../../../src/renderer/hooks/motionTokens";

const CSS = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first `selector { ... }` whose selector starts a line. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = CSS.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? "";
}

const WARNING = "Links are not clickable.";

const NOTICE: ConvertNoticeState = {
  sourceLabel: "Text document",
  sourceFormat: "text",
  fidelity: "layout",
  warnings: [
    { code: "generic-fallback", message: "Rendered with a generic layout." },
    { code: "links-not-live", message: WARNING, detail: "https://example.com/x" },
  ],
};

const ENTRIES: readonly Pdf3dContent[] = [{ page: 2, name: "Turbine" }];

function mount(node: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(node);
  });
  return {
    host,
    root,
    cleanup(): void {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const stateOf = (host: HTMLElement, attr: string): string =>
  host.querySelector(`[${attr}]`)?.getAttribute(attr) ?? "";

const click = (host: HTMLElement, selector: string): void => {
  act((): void => {
    host
      .querySelector<HTMLButtonElement>(selector)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const icon = (host: HTMLElement, attr: string): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>(`[${attr}]`);

describe("phase 67 — ConversionNotice: rounded box, auto-collapse, manual toggle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setAnimationsEnabledPreference(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    setAnimationsEnabledPreference(true);
  });

  it("starts expanded as the card with the Phase 53 content intact", () => {
    const view = mount(createElement(ConversionNotice, { notice: NOTICE }));
    try {
      expect(stateOf(view.host, "data-conversion-notice-state")).toBe("expanded");
      const card = view.host.querySelector(".conversion-notice");
      expect(card).not.toBeNull();
      expect(card?.getAttribute("role")).toBe("note");
      expect(view.host.textContent).toContain(WARNING);
      expect(view.host.textContent).toContain("https://example.com/x");
      // The collapsed icon is not present while expanded.
      expect(icon(view.host, "data-conversion-icon")).toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("auto-collapses after ~10 s into the accessible \"i\" button", () => {
    const view = mount(createElement(ConversionNotice, { notice: NOTICE }));
    try {
      act((): void => {
        vi.advanceTimersByTime(NOTICE_AUTO_COLLAPSE_MS - 1);
      });
      expect(stateOf(view.host, "data-conversion-notice-state")).toBe("expanded");
      expect(icon(view.host, "data-conversion-icon")).toBeNull();
      // The dwell fires: the card plays its exit...
      act((): void => {
        vi.advanceTimersByTime(1);
      });
      expect(stateOf(view.host, "data-conversion-notice-state")).toBe("closing");
      expect(view.host.querySelector(".conversion-notice--leaving")).not.toBeNull();
      // ...then is swapped for the icon.
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.standard);
      });
      expect(stateOf(view.host, "data-conversion-notice-state")).toBe("collapsed");
      expect(view.host.querySelector("[data-conversion-notice]")).toBeNull();
      const collapsed = icon(view.host, "data-conversion-icon");
      expect(collapsed).not.toBeNull();
      expect(collapsed?.tagName).toBe("BUTTON");
      expect(collapsed?.getAttribute("aria-label")).toBe("Show conversion notice");
    } finally {
      view.cleanup();
    }
  });

  it("expands from the icon (warnings again), then collapses from the control, resetting the dwell", () => {
    const view = mount(createElement(ConversionNotice, { notice: NOTICE }));
    try {
      act((): void => {
        vi.advanceTimersByTime(NOTICE_AUTO_COLLAPSE_MS);
      });
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.standard);
      });
      expect(stateOf(view.host, "data-conversion-notice-state")).toBe("collapsed");
      // Re-expand from the icon: the warning text is present again.
      click(view.host, "[data-conversion-icon]");
      expect(stateOf(view.host, "data-conversion-notice-state")).toBe("expanded");
      expect(view.host.textContent).toContain(WARNING);
      // 9.5 s later still expanded — the dwell was reset on expand...
      act((): void => {
        vi.advanceTimersByTime(NOTICE_AUTO_COLLAPSE_MS - 500);
      });
      expect(stateOf(view.host, "data-conversion-notice-state")).toBe("expanded");
      // ...the collapse control closes it now (not a wait for the dwell).
      click(view.host, "[data-conversion-collapse]");
      expect(stateOf(view.host, "data-conversion-notice-state")).toBe("closing");
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.standard);
      });
      expect(stateOf(view.host, "data-conversion-notice-state")).toBe("collapsed");
      expect(icon(view.host, "data-conversion-icon")).not.toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("the collapse control never invokes onDismiss", () => {
    const onDismiss = vi.fn();
    const view = mount(createElement(ConversionNotice, { notice: NOTICE, onDismiss }));
    try {
      click(view.host, "[data-conversion-collapse]");
      expect(onDismiss).not.toHaveBeenCalled();
    } finally {
      view.cleanup();
    }
  });

  it("collapses instantly on the instant path (Animations OFF / reduced motion)", () => {
    setAnimationsEnabledPreference(false);
    const view = mount(createElement(ConversionNotice, { notice: NOTICE }));
    try {
      expect(stateOf(view.host, "data-conversion-notice-state")).toBe("expanded");
      click(view.host, "[data-conversion-collapse]");
      // Immediate: no intermediate leaving card, no commit timer to wait on.
      expect(stateOf(view.host, "data-conversion-notice-state")).toBe("collapsed");
      expect(view.host.querySelector(".conversion-notice--leaving")).toBeNull();
      expect(icon(view.host, "data-conversion-icon")).not.toBeNull();
    } finally {
      view.cleanup();
    }
  });
});

describe("phase 67 — Pdf3dNotice: rounded box, auto-collapse, manual toggle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setAnimationsEnabledPreference(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    setAnimationsEnabledPreference(true);
  });

  it("starts expanded as the bar and keeps the Phase 57 text", () => {
    const view = mount(createElement(Pdf3dNotice, { entries: ENTRIES }));
    try {
      expect(stateOf(view.host, "data-pdf3d-notice-state")).toBe("expanded");
      const bar = view.host.querySelector("[data-testid='pdf3d-notice']");
      expect(bar).not.toBeNull();
      expect(bar?.getAttribute("role")).toBe("status");
      expect(bar?.hasAttribute("data-pdf3d-notice")).toBe(true);
      expect(view.host.textContent).toContain('Page 2 contains 3D content ("Turbine")');
      expect(icon(view.host, "data-pdf3d-icon")).toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("auto-collapses after ~10 s into the accessible \"i\" button", () => {
    const view = mount(createElement(Pdf3dNotice, { entries: ENTRIES }));
    try {
      act((): void => {
        vi.advanceTimersByTime(NOTICE_AUTO_COLLAPSE_MS - 1);
      });
      expect(stateOf(view.host, "data-pdf3d-notice-state")).toBe("expanded");
      act((): void => {
        vi.advanceTimersByTime(1);
      });
      expect(stateOf(view.host, "data-pdf3d-notice-state")).toBe("closing");
      expect(view.host.querySelector(".pdf3d-notice--leaving")).not.toBeNull();
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.standard);
      });
      expect(stateOf(view.host, "data-pdf3d-notice-state")).toBe("collapsed");
      expect(view.host.querySelector("[data-pdf3d-notice]")).toBeNull();
      const collapsed = icon(view.host, "data-pdf3d-icon");
      expect(collapsed).not.toBeNull();
      expect(collapsed?.tagName).toBe("BUTTON");
      expect(collapsed?.getAttribute("aria-label")).toBe("Show 3D content notice");
    } finally {
      view.cleanup();
    }
  });

  it("expands from the icon (text again), then collapses from the control", () => {
    const view = mount(createElement(Pdf3dNotice, { entries: ENTRIES }));
    try {
      act((): void => {
        vi.advanceTimersByTime(NOTICE_AUTO_COLLAPSE_MS);
      });
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.standard);
      });
      expect(stateOf(view.host, "data-pdf3d-notice-state")).toBe("collapsed");
      click(view.host, "[data-pdf3d-icon]");
      expect(stateOf(view.host, "data-pdf3d-notice-state")).toBe("expanded");
      expect(view.host.textContent).toContain('Page 2 contains 3D content ("Turbine")');
      click(view.host, "[data-pdf3d-collapse]");
      expect(stateOf(view.host, "data-pdf3d-notice-state")).toBe("closing");
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.standard);
      });
      expect(stateOf(view.host, "data-pdf3d-notice-state")).toBe("collapsed");
      expect(icon(view.host, "data-pdf3d-icon")).not.toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("collapses instantly on the instant path and still renders nothing for an empty list", () => {
    setAnimationsEnabledPreference(false);
    const view = mount(createElement(Pdf3dNotice, { entries: ENTRIES }));
    try {
      click(view.host, "[data-pdf3d-collapse]");
      expect(stateOf(view.host, "data-pdf3d-notice-state")).toBe("collapsed");
      expect(view.host.querySelector(".pdf3d-notice--leaving")).toBeNull();
      expect(icon(view.host, "data-pdf3d-icon")).not.toBeNull();
    } finally {
      view.cleanup();
    }
    const empty = mount(createElement(Pdf3dNotice, { entries: [] }));
    try {
      expect(empty.host.querySelector("[data-pdf3d-notice]")).toBeNull();
      expect(empty.host.querySelector("[data-pdf3d-icon]")).toBeNull();
    } finally {
      empty.cleanup();
    }
  });
});

describe("phase 67 — the three collapsed icons occupy distinct fixed slots", () => {
  const RAIL = String.raw`calc\(var\(--tf-rail-w,\s*184px\)\s*\+\s*var\(--space-standard\)`;

  it("keeps the protection icon in slot 0 (untouched)", () => {
    expect(ruleBody(".protection-notice-collapsed-toggle")).toMatch(
      new RegExp(`${RAIL}\\)`),
    );
  });

  it("puts the conversion icon in slot 1 (+36px) as an absolute overlay", () => {
    const iconRule = ruleBody(".conversion-notice-collapsed-toggle");
    expect(iconRule).toMatch(new RegExp(`${RAIL}\\s*\\+\\s*36px\\)`));
    expect(iconRule).toMatch(/position:\s*absolute/);
    expect(iconRule).toMatch(/top:/);
    const region = ruleBody(".conversion-notice-region");
    expect(region).toMatch(/position:\s*relative/);
  });

  it("puts the 3D icon in slot 2 (+72px) as an absolute overlay", () => {
    const iconRule = ruleBody(".pdf3d-notice-collapsed-toggle");
    expect(iconRule).toMatch(new RegExp(`${RAIL}\\s*\\+\\s*72px\\)`));
    expect(iconRule).toMatch(/position:\s*absolute/);
    expect(iconRule).toMatch(/top:/);
    const region = ruleBody(".pdf3d-notice-region");
    expect(region).toMatch(/position:\s*relative/);
  });

  it("gives both new notices the rounded-box treatment", () => {
    for (const selector of [".conversion-notice", ".pdf3d-notice"]) {
      const box = ruleBody(selector);
      expect(box, selector).toMatch(/border-radius:\s*var\(--radius-3\)/);
      expect(box, selector).toMatch(/border:\s*1px solid var\(--border\)/);
      expect(box, selector).not.toMatch(/position:\s*absolute/);
    }
  });
});


