// @vitest-environment jsdom
//
// DEF-433 (TFL-76) — REPOINTED by Phase 72 (item 8).
//
// The instant active-tab reveal existed because the tab strip was a horizontal
// scroll container whose active tab could sit clipped at the squeezed edge.
// Phase 72 (item 8) RETIRED the scroll container entirely: every tab is kept in
// ONE row by shrinking uniformly, so there is no `scrollLeft` and no reveal to
// schedule. This file now pins that retirement instead of the removed
// `activeTabScrollDelta` / settle-loop machinery.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import * as DocumentRailModule from "../../../src/renderer/components/DocumentRail";
import { DocumentRail } from "../../../src/renderer/components/DocumentRail";

const TAB_DEFS = [
  { id: "a", title: "a.pdf", modified: false },
  { id: "b", title: "b.pdf", modified: false },
  { id: "c", title: "c.pdf", modified: false },
];

describe("DEF-433 — the active-tab scroll reveal is retired by Phase 72", () => {
  it("no longer exports activeTabScrollDelta", () => {
    expect(
      (DocumentRailModule as Record<string, unknown>).activeTabScrollDelta,
      "the scroll reveal export must be gone",
    ).toBeUndefined();
  });

  it("the document-rail source never calls scrollIntoView / touches scrollLeft", () => {
    const source = readFileSync("src/renderer/components/DocumentRail.tsx", "utf8");
    expect(source).not.toContain("scrollIntoView");
    // The reorder's drop-slot math keeps `el.scrollLeft` as a byte-identical
    // term, but there is no reveal write (`list.scrollLeft +=`).
    expect(source).not.toContain("scrollLeft +=");
  });
});

describe("DEF-433 — the strip keeps every tab in one row (Phase 72 item 8)", () => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const hadOwnClientWidth = Object.prototype.hasOwnProperty.call(proto, "clientWidth");
  const originalClientWidth = hadOwnClientWidth
    ? Object.getOwnPropertyDescriptor(proto, "clientWidth")
    : undefined;

  beforeEach((): void => {
    Object.defineProperty(proto, "clientWidth", {
      configurable: true,
      get(this: HTMLElement): number {
        return this.classList?.contains("tab-list") ? 640 : 0;
      },
    });
  });

  afterEach((): void => {
    if (hadOwnClientWidth && originalClientWidth !== undefined) {
      Object.defineProperty(proto, "clientWidth", originalClientWidth);
    } else {
      delete proto.clientWidth;
    }
    document.body.innerHTML = "";
  });

  it("the active tab is not scrolled: every tab carries the same fit width", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(
        createElement(DocumentRail, {
          activeId: "c",
          tabs: TAB_DEFS,
          onActivate: (): void => undefined,
          onClose: (): void => undefined,
          onNewEmptyTab: (): void => undefined,
        }),
      );
    });
    const list = host.querySelector<HTMLElement>(".tab-list");
    expect(list).not.toBeNull();
    // 3 colorful tabs in 640px fit at their natural 180px, so no fit width is
    // written and the strip is not scroll-driven.
    expect(list?.style.getPropertyValue("--tf-tab-width")).toBe("");
    expect(host.querySelectorAll(".tab")).toHaveLength(3);
    act((): void => {
      root.unmount();
    });
    host.remove();
  });
});
