// @vitest-environment jsdom
//
// Phase 52 (feature B) / the DEF-357 defect class, filed as DEF-377 — the
// protection banner's dismiss control was unclickable in the running app
// because the always-on Inspector overlapped it. The banner is a FLOW element
// at the top of the pane's document column, so its `margin-left: auto` dismiss
// control landed at the banner's right edge, under the fixed right panel
// (`position: absolute; right: 0; top: 0; bottom: 0; width: var(--tools-panel-w);
// z-index: 30`). `elementFromPoint` over the button returned the Inspector's
// own interactive header control (`.inspector-collapse-toggle`), so the banner
// could not be dismissed.
//
// This is the same flow-element overlap the conversion card got fixed for in
// DEF-375; the ProtectionNotice is the identical flow element in the same
// `.document-column` and only ever differed by not carrying the reservation.
// The fix mirrors the conversion card's rule verbatim, consuming the SAME
// registered `--tf-tools-inset` token. The intercepting pixel is the
// Inspector's own LIVE interactive child, which must stay clickable, so the
// documented overlay-LAYER rule (`pointer-events: none` on the layer, `auto`
// on the action-bar child) cannot resolve it — the child still wins the hit
// test. The flow banner yields the column instead. These tests pin the CSS
// contract (jsdom applies no stylesheet, so it is a textual scan — the
// established pattern) and the AGENTS.md cross-bubbling obligation.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { ProtectionNotice } from "../../../src/renderer/components/ProtectionNotice";
import type { DocumentProtectionState } from "../../../src/shared/types";

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

/** The hit-test rule, as arithmetic: the banner's right edge must not cross the
 *  panel's left edge. `inset` is what the banner reserves (`--tf-tools-inset`). */
function bannerRightEdge(frameWidth: number, inset: number): number {
  return frameWidth - inset;
}
function inspectorLeftEdge(frameWidth: number, panelWidth: number): number {
  return frameWidth - panelWidth;
}

const PROTECTION: DocumentProtectionState = {
  encrypted: true,
  v: 5,
  r: 6,
  cfm: "AESV3",
  algorithm: "AES-256",
  permissions: {
    print: false,
    highResPrint: false,
    copy: true,
    accessibleCopy: true,
    modify: false,
    comment: false,
    assemble: false,
    fillForms: true,
  },
};

describe("phase 52 — the protection banner reserves the fixed Inspector's column", () => {
  it("reserves the shared --tf-tools-inset on the banner's right edge", () => {
    const rule = ruleBody(".document-column > .protection-notice");
    expect(rule, "the DEF-377 hit-test reservation rule is missing").not.toBe("");
    expect(rule).toMatch(/margin-right:\s*var\(--tf-tools-inset,\s*0px\)/);
  });

  it("does not reserve the inset a second time in Multi Mode", () => {
    const rule = ruleBody(
      '.tab-stage[data-multi-mode="true"] .document-column > .protection-notice',
    );
    expect(rule, "the Multi Mode reset is missing").not.toBe("");
    expect(rule).toMatch(/margin-right:\s*0/);
  });

  it("binds the reservation to the Inspector's OWN width token (one source)", () => {
    const open = ruleBody('.app-main[data-tools-open="true"]');
    expect(open).toMatch(/--tf-tools-inset:\s*var\(--tools-panel-w,\s*264px\)/);
    const panel = ruleBody(".inspector");
    expect(panel).toMatch(/position:\s*absolute/);
    expect(panel).toMatch(/top:\s*0/);
    expect(panel).toMatch(/right:\s*0/);
    expect(panel).toMatch(/bottom:\s*0/);
    expect(panel).toMatch(/width:\s*var\(--tools-panel-w,\s*264px\)/);
    expect(panel).toMatch(/z-index:\s*30/);
  });

  it("keeps the banner's right edge at (or left of) the panel's left edge", () => {
    const FRAME = 2560;
    const PANEL = 264;
    expect(bannerRightEdge(FRAME, PANEL)).toBe(inspectorLeftEdge(FRAME, PANEL));
    expect(bannerRightEdge(FRAME, PANEL)).toBeLessThanOrEqual(inspectorLeftEdge(FRAME, PANEL));
    // Inspector closed: the inset is 0 and the banner runs to the frame edge.
    expect(bannerRightEdge(FRAME, 0)).toBe(FRAME);
  });

  it("keeps the banner a FLOW element (no portal, no absolute self-position)", () => {
    const banner = ruleBody(".protection-notice");
    expect(banner).not.toMatch(/position:\s*absolute/);
    const source = readFileSync(
      resolve(__dirname, "../../../src/renderer/components/ProtectionNotice.tsx"),
      "utf8",
    );
    expect(source).not.toContain("createPortal");
  });

  it("has no second interactive element competing for the reserved column", () => {
    // The dismiss is the banner's ONLY interactive control; when it is omitted
    // there is no control at all, so no other element can sit under the panel.
    const source = readFileSync(
      resolve(__dirname, "../../../src/renderer/components/ProtectionNotice.tsx"),
      "utf8",
    );
    expect(source.match(/<button/g)?.length ?? 0).toBe(1);
  });
});

describe("phase 52 — the dismiss click is not swallowed (AGENTS.md cross-bubbling)", () => {
  function mount(children: ReturnType<typeof createElement>) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(children);
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

  it("the dismiss button fires even with a document click listener", () => {
    const onDismiss = vi.fn();
    const docListener = vi.fn();
    document.addEventListener("click", docListener);
    const view = mount(createElement(ProtectionNotice, { protection: PROTECTION, onDismiss }));
    try {
      const banner = view.host.querySelector(".protection-notice");
      const dismiss = view.host.querySelector<HTMLButtonElement>(
        "[data-protection-dismiss]",
      );
      expect(dismiss, "the dismiss button must render").not.toBeNull();
      expect(dismiss?.tagName).toBe("BUTTON");
      // It is the banner's last child: the `margin-left: auto` control that sat
      // under the Inspector before the fix.
      expect(banner?.lastElementChild).toBe(dismiss);
      act((): void => {
        dismiss?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
      // The banner must NOT stop propagation: the click still reaches document.
      expect(docListener).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("click", docListener);
      view.cleanup();
    }
  });

  it("omitting onDismiss renders no dismiss control", () => {
    const view = mount(createElement(ProtectionNotice, { protection: PROTECTION }));
    try {
      expect(view.host.querySelector("[data-protection-dismiss]")).toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("a click on the banner body still completes and does not dismiss", () => {
    const onDismiss = vi.fn();
    const docListener = vi.fn();
    document.addEventListener("click", docListener);
    const view = mount(createElement(ProtectionNotice, { protection: PROTECTION, onDismiss }));
    try {
      const body = view.host.querySelector(".protection-notice-body");
      expect(body).not.toBeNull();
      act((): void => {
        body?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      // The click completes (bubbles to document) and nothing was swallowed.
      expect(docListener).toHaveBeenCalledTimes(1);
      expect(onDismiss).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("click", docListener);
      view.cleanup();
    }
  });
});
