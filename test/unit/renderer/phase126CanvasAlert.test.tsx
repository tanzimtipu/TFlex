// @vitest-environment jsdom
//
// Phase 126 (chunk A) — the in-canvas warning/error notice.
//
// `CanvasAlertNotice` adopts the Phase 67 `useNoticeCollapse` behaviour: a
// rounded, animated box that auto-collapses into a floating "i" (info) icon
// after a ~10 s reading pause, expandable/collapsible by the user with the
// dwell reset on every expand. Virtual time (`vi.useFakeTimers`) drives the
// dwell, exactly as in `phase67NoticeCollapse.test.tsx`; jsdom applies no
// stylesheet, so every state change is asserted against the rendered DOM. The
// component is ADDITIVE ONLY here — it is not wired anywhere yet (chunk B owns
// the call site).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { CanvasAlertNotice } from "../../../src/renderer/components/CanvasAlertNotice";
import { NOTICE_AUTO_COLLAPSE_MS } from "../../../src/renderer/hooks/useNoticeCollapse";
import { setAnimationsEnabledPreference } from "../../../src/renderer/hooks/motionPolicy";
import { MOTION_DURATION } from "../../../src/renderer/hooks/motionTokens";

const MESSAGES = ["Message one.", "Message two."] as const;

function mount(node: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(node);
  });
  // Phase 78 (DEF-465): the icon-first enter commits on a double rAF. Advance
  // both entrance frames so these state-machine tests start from `expanded`
  // (they assert the collapse dwell, not the enter paint).
  act((): void => {
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
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

/** The state attribute is named differently on the region (`...-notice-state`)
 *  and the box (`...-state`); read whichever is mounted. */
const stateOf = (host: HTMLElement): string => {
  const el = host.querySelector<HTMLElement>(
    "[data-canvas-alert-state], [data-canvas-alert-notice-state]",
  );
  return (
    el?.getAttribute("data-canvas-alert-state") ??
    el?.getAttribute("data-canvas-alert-notice-state") ??
    ""
  );
};

const click = (host: HTMLElement, selector: string): void => {
  act((): void => {
    host
      .querySelector<HTMLButtonElement>(selector)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const icon = (host: HTMLElement): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>("[data-canvas-alert-icon]");

describe("phase 126 — CanvasAlertNotice: tone, rounded box, auto-collapse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setAnimationsEnabledPreference(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    setAnimationsEnabledPreference(true);
  });

  it("warning tone renders expanded with every message", () => {
    const view = mount(
      createElement(CanvasAlertNotice, { warning: MESSAGES, error: [] }),
    );
    try {
      expect(stateOf(view.host)).toBe("expanded");
      const box = view.host.querySelector("[data-canvas-alert-notice]");
      expect(box).not.toBeNull();
      expect(box?.getAttribute("role")).toBe("note");
      expect(box?.getAttribute("aria-label")).toBe("Warning notice");
      expect(box?.getAttribute("data-canvas-alert-tone")).toBe("warning");
      expect(
        view.host.querySelector('[data-canvas-alert-group="warning"]'),
      ).not.toBeNull();
      expect(view.host.textContent).toContain("Message one.");
      expect(view.host.textContent).toContain("Message two.");
      expect(icon(view.host)).toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("error tone renders the error tone attribute and label", () => {
    const view = mount(
      createElement(CanvasAlertNotice, { warning: [], error: MESSAGES }),
    );
    try {
      const box = view.host.querySelector("[data-canvas-alert-notice]");
      expect(box?.getAttribute("data-canvas-alert-tone")).toBe("error");
      expect(box?.getAttribute("aria-label")).toBe("Error notice");
      expect(
        view.host.querySelector('[data-canvas-alert-group="error"]'),
      ).not.toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("consolidates both tones into ONE box with ONE icon, grouped by tone", () => {
    const view = mount(
      createElement(CanvasAlertNotice, {
        warning: ["Careful."],
        error: ["Broken."],
      }),
    );
    try {
      // Exactly one box and (while expanded) no second "i" icon.
      expect(view.host.querySelectorAll("[data-canvas-alert-notice]").length).toBe(1);
      expect(icon(view.host)).toBeNull();
      // An error outranks a warning: the box carries the error tone/label...
      const box = view.host.querySelector("[data-canvas-alert-notice]");
      expect(box?.getAttribute("data-canvas-alert-tone")).toBe("error");
      expect(box?.getAttribute("aria-label")).toBe("Error notice");
      // ...and both groups are present, each labelled, errors before warnings.
      const groups = view.host.querySelectorAll("[data-canvas-alert-group]");
      expect(groups.length).toBe(2);
      expect(groups[0]?.getAttribute("data-canvas-alert-group")).toBe("error");
      expect(groups[1]?.getAttribute("data-canvas-alert-group")).toBe("warning");
      const labels = view.host.querySelectorAll(".canvas-alert-notice-group-label");
      expect(labels.length).toBe(2);
      expect(labels[0]?.textContent).toBe("Errors");
      expect(labels[1]?.textContent).toBe("Warnings");
      expect(view.host.textContent).toContain("Broken.");
      expect(view.host.textContent).toContain("Careful.");
    } finally {
      view.cleanup();
    }
  });

  it("auto-collapses after ~10 s into the accessible \"i\" button", () => {
    const view = mount(
      createElement(CanvasAlertNotice, { warning: MESSAGES, error: [] }),
    );
    try {
      act((): void => {
        vi.advanceTimersByTime(NOTICE_AUTO_COLLAPSE_MS - 1);
      });
      expect(stateOf(view.host)).toBe("expanded");
      expect(icon(view.host)).toBeNull();
      // The dwell fires: the box plays its exit...
      act((): void => {
        vi.advanceTimersByTime(1);
      });
      expect(stateOf(view.host)).toBe("closing");
      expect(
        view.host.querySelector(".canvas-alert-notice--leaving"),
      ).not.toBeNull();
      // ...then is swapped for the icon.
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.standard);
      });
      expect(stateOf(view.host)).toBe("collapsed");
      expect(view.host.querySelector("[data-canvas-alert-notice]")).toBeNull();
      const collapsed = icon(view.host);
      expect(collapsed).not.toBeNull();
      expect(collapsed?.tagName).toBe("BUTTON");
      expect(collapsed?.getAttribute("aria-label")).toBe("Show notice");
    } finally {
      view.cleanup();
    }
  });

  it("re-expands from the icon (messages again), then collapses from the control", () => {
    const view = mount(
      createElement(CanvasAlertNotice, { warning: MESSAGES, error: [] }),
    );
    try {
      act((): void => {
        vi.advanceTimersByTime(NOTICE_AUTO_COLLAPSE_MS);
      });
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.standard);
      });
      expect(stateOf(view.host)).toBe("collapsed");
      // Re-expand from the icon: the messages are present again.
      click(view.host, "[data-canvas-alert-icon]");
      expect(stateOf(view.host)).toBe("expanded");
      expect(view.host.textContent).toContain("Message one.");
      expect(view.host.textContent).toContain("Message two.");
      // The collapse control closes it now.
      click(view.host, "[data-canvas-alert-collapse]");
      expect(stateOf(view.host)).toBe("closing");
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.standard);
      });
      expect(stateOf(view.host)).toBe("collapsed");
      expect(icon(view.host)).not.toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("renders every message of a multi-entry notice", () => {
    const many = ["First.", "Second.", "Third."] as const;
    const view = mount(
      createElement(CanvasAlertNotice, { warning: [], error: many }),
    );
    try {
      const items = view.host.querySelectorAll("[data-canvas-alert-message]");
      expect(items.length).toBe(3);
      expect(view.host.textContent).toContain("First.");
      expect(view.host.textContent).toContain("Second.");
      expect(view.host.textContent).toContain("Third.");
    } finally {
      view.cleanup();
    }
  });

  it("collapses instantly on the instant path (Animations OFF / reduced motion)", () => {
    setAnimationsEnabledPreference(false);
    const view = mount(
      createElement(CanvasAlertNotice, { warning: MESSAGES, error: [] }),
    );
    try {
      expect(stateOf(view.host)).toBe("expanded");
      click(view.host, "[data-canvas-alert-collapse]");
      // Immediate: no intermediate leaving box, no commit timer to wait on.
      expect(stateOf(view.host)).toBe("collapsed");
      expect(
        view.host.querySelector(".canvas-alert-notice--leaving"),
      ).toBeNull();
      expect(icon(view.host)).not.toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("renders nothing when there are no messages", () => {
    const view = mount(
      createElement(CanvasAlertNotice, { warning: [], error: [] }),
    );
    try {
      expect(view.host.querySelector("[data-canvas-alert-notice]")).toBeNull();
      expect(icon(view.host)).toBeNull();
    } finally {
      view.cleanup();
    }
  });
});
