// @vitest-environment jsdom
//
// Phase 109 (chunk A) — the unified View Strip footer.
//
// The single-mode viewing controls (page nav, zoom/fit, pan, page layout and the
// Book View entry) moved off the floating CanvasPills and the top-right cluster
// into ONE footer. These tests pin the re-homed contract exactly: every control
// keeps its aria-labels / data-* hooks and its existing handler, the page input
// keeps its DEF-351 replace-on-type behaviour, and the footer geometry is a
// real grid row 6 with the canvas overlay inset by the footer height.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { ViewStrip, type ViewStripProps } from "../../../src/renderer/components/ViewStrip";
import { MULTI_DOCK_BAND_BASE_PX } from "../../../src/renderer/components/multiPaneLayout";

function renderStrip(options: Partial<ViewStripProps> = {}): {
  host: HTMLElement;
  rerender: (next: Partial<ViewStripProps>) => void;
  unmount: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let current: ViewStripProps = {
    page: 3,
    pageCount: 10,
    zoomPercent: 171,
    zoomMode: "manual",
    pageLayout: "one",
    onJump: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFitWidth: vi.fn(),
    onFitPage: vi.fn(),
    onChangePageLayout: vi.fn(),
    ...options,
  };
  const draw = (): void => {
    act((): void => {
      root.render(createElement(ViewStrip, { ...current }));
    });
  };
  draw();
  return {
    host,
    rerender: (next): void => {
      current = { ...current, ...next };
      draw();
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function byLabel(host: HTMLElement, label: string): HTMLButtonElement {
  const el = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (el === null) throw new Error(`no button labelled ${label}`);
  return el;
}

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("Phase 109 (chunk A) — the View Strip footer shell", () => {
  it("(a) renders every control with its exact aria-label", () => {
    const { host, unmount } = renderStrip({
      onOpenBookView: (): void => undefined,
      onHandToggle: (): void => undefined,
    });
    try {
      expect(host.querySelector("[data-view-strip]")).not.toBeNull();
      expect(host.querySelector(".view-strip")?.getAttribute("role")).toBe("group");
      expect(
        host.querySelector(".view-strip")?.getAttribute("aria-label"),
      ).toBe("Viewing controls");
      // Page group (left) and view group (right).
      expect(host.querySelector(".view-strip-page")?.getAttribute("aria-label")).toBe(
        "Page navigation",
      );
      expect(host.querySelector(".view-strip-view")?.getAttribute("aria-label")).toBe(
        "View and zoom",
      );
      expect(host.querySelector(".view-strip-space")).not.toBeNull();
      for (const label of [
        "Previous page",
        "Current page",
        "Next page",
        "Zoom out",
        "Zoom in",
        "Fit width",
        "Fit page",
        "Pan mode",
        "Page layout",
        "Book View",
      ]) {
        expect(host.querySelector(`[aria-label="${label}"]`), label).not.toBeNull();
      }
      // The page number keeps its INPUT contract (aria-label on the input).
      expect(host.querySelector('input.page-input[aria-label="Current page"]')).not.toBeNull();
      // The three layout options keep their exact accessible names.
      expect(host.querySelector(".view-strip-layout")?.getAttribute("aria-label")).toBe(
        "Page layout",
      );
      const options = Array.from(host.querySelectorAll("[data-page-layout-option]"));
      expect(options.map((o) => o.getAttribute("data-page-layout-option"))).toEqual([
        "one",
        "two",
        "four",
      ]);
      expect(options.map((o) => o.getAttribute("aria-label"))).toEqual([
        "One page",
        "Two pages side by side",
        "Four pages in two rows",
      ]);
    } finally {
      unmount();
    }
  });

  it("(b) disables Previous on page 1 and Next on the last page", () => {
    const { host, rerender, unmount } = renderStrip({ page: 1, pageCount: 3 });
    try {
      expect(byLabel(host, "Previous page").hasAttribute("disabled")).toBe(true);
      expect(byLabel(host, "Next page").hasAttribute("disabled")).toBe(false);
      rerender({ page: 3 });
      expect(byLabel(host, "Previous page").hasAttribute("disabled")).toBe(false);
      expect(byLabel(host, "Next page").hasAttribute("disabled")).toBe(true);
    } finally {
      unmount();
    }
  });

  it("(b) steps backward / forward through onJump", () => {
    const onJump = vi.fn();
    const { host, unmount } = renderStrip({ onJump });
    try {
      clickOn(byLabel(host, "Previous page"));
      expect(onJump).toHaveBeenCalledWith("2");
      clickOn(byLabel(host, "Next page"));
      expect(onJump).toHaveBeenCalledWith("4");
    } finally {
      unmount();
    }
  });
});

describe("Phase 109 (chunk A) — the page input keeps its DEF-351 contract", () => {
  it("(c) typing + Enter in .page-input calls onJump with the typed value", () => {
    const onJump = vi.fn();
    const { host, unmount } = renderStrip({ onJump, page: 3, pageCount: 10 });
    try {
      const input = host.querySelector<HTMLInputElement>('input[aria-label="Current page"]');
      expect(input).not.toBeNull();
      // React's controlled input needs the native value setter + an input event.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      act((): void => {
        if (input !== null && setter !== undefined) {
          setter.call(input, "7");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      act((): void => {
        input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      expect(onJump).toHaveBeenCalledWith("7");
    } finally {
      unmount();
    }
  });

  it("(c) onFocus swaps a range readout to the numeric page", () => {
    const { host, unmount } = renderStrip({ page: 3, pageReadout: "3-4" });
    try {
      const input = host.querySelector<HTMLInputElement>('input[aria-label="Current page"]');
      expect(input?.value).toBe("3-4");
      act((): void => {
        // React's onFocus is delegated from `focusin` (focus does not bubble).
        input?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      });
      expect(input?.value).toBe("3");
    } finally {
      unmount();
    }
  });
});

describe("Phase 109 (chunk A) — the view group handlers and pressed state", () => {
  it("(d) zoom / fit / pan / layout fire their handlers", () => {
    const onZoomOut = vi.fn();
    const onZoomIn = vi.fn();
    const onFitWidth = vi.fn();
    const onFitPage = vi.fn();
    const onHandToggle = vi.fn();
    const onChangePageLayout = vi.fn();
    const { host, unmount } = renderStrip({
      onZoomOut,
      onZoomIn,
      onFitWidth,
      onFitPage,
      onHandToggle,
      onChangePageLayout,
    });
    try {
      clickOn(byLabel(host, "Zoom out"));
      clickOn(byLabel(host, "Zoom in"));
      clickOn(byLabel(host, "Fit width"));
      clickOn(byLabel(host, "Fit page"));
      clickOn(byLabel(host, "Pan mode"));
      expect(onZoomOut).toHaveBeenCalledTimes(1);
      expect(onZoomIn).toHaveBeenCalledTimes(1);
      expect(onFitWidth).toHaveBeenCalledTimes(1);
      expect(onFitPage).toHaveBeenCalledTimes(1);
      expect(onHandToggle).toHaveBeenCalledTimes(1);
      clickOn(byLabel(host, "One page"));
      clickOn(byLabel(host, "Two pages side by side"));
      clickOn(byLabel(host, "Four pages in two rows"));
      expect(onChangePageLayout).toHaveBeenNthCalledWith(1, "one");
      expect(onChangePageLayout).toHaveBeenNthCalledWith(2, "two");
      expect(onChangePageLayout).toHaveBeenNthCalledWith(3, "four");
    } finally {
      unmount();
    }
  });

  it("(d) aria-pressed tracks zoomMode / handActive / pageLayout", () => {
    const { host, rerender, unmount } = renderStrip({
      zoomMode: "fit-width",
      handActive: false,
      pageLayout: "one",
      onHandToggle: (): void => undefined,
    });
    try {
      expect(byLabel(host, "Fit width").getAttribute("aria-pressed")).toBe("true");
      expect(byLabel(host, "Fit page").getAttribute("aria-pressed")).toBe("false");
      expect(byLabel(host, "Pan mode").getAttribute("aria-pressed")).toBe("false");
      expect(byLabel(host, "One page").getAttribute("aria-pressed")).toBe("true");
      expect(byLabel(host, "Two pages side by side").getAttribute("aria-pressed")).toBe("false");
      expect(byLabel(host, "Four pages in two rows").getAttribute("aria-pressed")).toBe("false");

      rerender({ zoomMode: "fit-page" });
      expect(byLabel(host, "Fit width").getAttribute("aria-pressed")).toBe("false");
      expect(byLabel(host, "Fit page").getAttribute("aria-pressed")).toBe("true");

      rerender({ handActive: true });
      expect(byLabel(host, "Pan mode").getAttribute("aria-pressed")).toBe("true");
      expect(byLabel(host, "Pan mode").getAttribute("data-hand-active")).toBe("true");

      rerender({ pageLayout: "two" });
      expect(byLabel(host, "One page").getAttribute("aria-pressed")).toBe("false");
      expect(byLabel(host, "Two pages side by side").getAttribute("aria-pressed")).toBe("true");
    } finally {
      unmount();
    }
  });
});

describe("Phase 109 (chunk A) — the Book View entry is single-view only", () => {
  it("(e) renders only when onOpenBookView is provided and not in a pane", () => {
    const bare = renderStrip();
    try {
      expect(bare.host.querySelector('[aria-label="Book View"]')).toBeNull();
    } finally {
      bare.unmount();
    }

    const wired = renderStrip({ onOpenBookView: (): void => undefined });
    try {
      const entry = wired.host.querySelector('[aria-label="Book View"]');
      expect(entry).not.toBeNull();
      expect(entry?.getAttribute("data-book-view-open")).not.toBeNull();
      wired.rerender({ inMultiPane: true });
      expect(wired.host.querySelector('[aria-label="Book View"]')).toBeNull();
      // The layout group is single-view only too (CTO ruling 6).
      expect(wired.host.querySelector("[data-page-layout-option]")).toBeNull();
    } finally {
      wired.unmount();
    }
  });
});

describe("Phase 109 (chunk B) — the footer renders in a Multi Mode pane", () => {
  it("(g) renders in a pane and omits the layout group + Book View entry", () => {
    const { host, unmount } = renderStrip({
      inMultiPane: true,
      onOpenBookView: (): void => undefined,
      onHandToggle: (): void => undefined,
    });
    try {
      expect(host.querySelector("[data-view-strip]")).not.toBeNull();
      // The pane-targeted page / zoom / pan controls are all present.
      for (const label of [
        "Previous page",
        "Current page",
        "Next page",
        "Zoom out",
        "Zoom in",
        "Fit width",
        "Fit page",
        "Pan mode",
      ]) {
        expect(host.querySelector(`[aria-label="${label}"]`), label).not.toBeNull();
      }
      // Single-view-only chrome is omitted in a pane (CTO ruling 6).
      expect(host.querySelector("[data-page-layout-option]")).toBeNull();
      expect(host.querySelector(".view-strip-layout")).toBeNull();
      expect(host.querySelector("[data-book-view-open]")).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("Phase 109 (chunk A/B) — footer geometry (source scan)", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/renderer/styles.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const view = readFileSync(
    resolve(process.cwd(), "src/renderer/components/DocumentView.tsx"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  it("(f) .workspace-main declares six grid rows", () => {
    const body = /^\.workspace-main\s*\{([^}]*)\}/m.exec(css)?.[1];
    expect(body).toBeDefined();
    expect(body).toMatch(/grid-template-rows:\s*auto auto auto auto 1fr auto\s*;/);
  });

  it("(f) .canvas-overlay is inset by the footer height", () => {
    const body = /^\.canvas-overlay\s*\{([^}]*)\}/m.exec(css)?.[1];
    expect(body).toBeDefined();
    expect(body).toMatch(/bottom:\s*var\(--view-strip-h/);
  });

  it("(h) DocumentView no longer renders (or imports) CanvasPills", () => {
    expect(view).not.toMatch(/<CanvasPills\b/);
    expect(view).not.toMatch(/from\s+["']\.\/CanvasPills["']/);
    // ...and the unified footer IS the single page / zoom / pan surface.
    expect(view).toContain("<ViewStrip");
  });

  it("(i) keeps the pane footer at least 16px clear of the shared dock", () => {
    // The pane stops `MULTI_DOCK_BAND_BASE_PX` above the stage bottom, so its
    // footer's lower edge sits exactly that far up. Against the LIVE dock tokens
    // `--dock-bottom-inset: 16px` + `--dock-min-height: 68px`, the dock's top
    // edge is `16 + 68 = 84px` above the stage bottom, so the reserved band must
    // leave at least the 16px `dockSeparation` token between the footer and that
    // edge. Chunk B2 corrected the base 96 -> 100 (100 - (16 + 68) = 16).
    const DOCK_BOTTOM_INSET = 16;
    const DOCK_MAX_HEIGHT = 68;
    const DOCK_TOP = DOCK_BOTTOM_INSET + DOCK_MAX_HEIGHT;
    expect(MULTI_DOCK_BAND_BASE_PX - DOCK_TOP).toBeGreaterThanOrEqual(16);
    // Both CSS fallbacks use the live base, not the retired 96.
    const fallbacks = css.match(/var\(--tf-multi-dock-band,\s*\d+px\)/g) ?? [];
    expect(fallbacks.length).toBeGreaterThanOrEqual(2);
    expect(fallbacks.every((f): boolean => f.includes("100px"))).toBe(true);
  });

  it("(i) makes the pane footer an inline-size container with the two tiers", () => {
    expect(css).toMatch(
      /\.tab-stage\[data-multi-mode="true"\]\s+\.view-strip\s*\{[^}]*container-type:\s*inline-size;[^}]*container-name:\s*multi-view-strip;/,
    );
    expect(css).toContain("@container multi-view-strip (max-width: 407px)");
    expect(css).toContain("@container multi-view-strip (max-width: 311px)");
    const micro = css.slice(css.indexOf("@container multi-view-strip (max-width: 311px)"));
    expect(micro).toMatch(/\.view-strip \.btn-toolbar\s*\{\s*width:\s*24px;\s*height:\s*28px;/);
  });

  it("(j) declares the single-mode container and its yield tiers (source scan)", () => {
    expect(css).toMatch(
      /\.tab-stage\[data-multi-mode="false"\]\s+\.view-strip\s*\{[^}]*container-type:\s*inline-size;[^}]*container-name:\s*single-view-strip;/,
    );

    // The multi pane container is left untouched.
    expect(css).toContain("container-name: multi-view-strip;");

    // compact rung: readouts yield, the page input narrows, Book View goes
    // icon-only (its text label leaves the flow).
    const compactStart = css.indexOf("@container single-view-strip (max-width: 667px)");
    const microStart = css.indexOf("@container single-view-strip (max-width: 459px)");
    const overflowStart = css.indexOf("@container single-view-strip (max-width: 419px)");
    expect(compactStart).toBeGreaterThan(-1);
    expect(microStart).toBeGreaterThan(compactStart);
    expect(overflowStart).toBeGreaterThan(microStart);
    const compact = css.slice(compactStart, microStart);
    expect(compact).toContain(".view-strip .zoom-percent");
    expect(compact).toContain(".view-strip .page-total");
    expect(compact).toContain(".view-strip .page-label-hint");
    expect(compact).toMatch(/\.view-strip \.page-input\s*\{\s*width:\s*20px;/);
    expect(compact).toContain(".view-strip .view-strip-book-label");

    // micro rung: the dense 24x28 controls + tightened group chrome. DEF-591:
    // `min-width` must be relaxed alongside `width`, or the base 32px target
    // keeps the control at full width and the row never shrinks.
    const micro = css.slice(microStart, overflowStart);
    expect(micro).toMatch(
      /\.view-strip \.btn-toolbar\s*\{\s*width:\s*24px;\s*min-width:\s*0;\s*height:\s*28px;/,
    );
    expect(micro).toMatch(/\.view-strip-page,\s*\.view-strip-view,\s*\.view-strip-layout\s*\{\s*gap:\s*2px;/);

    // overflow rung: the layout group + Book View leave the flow and the More
    // surface appears, so the footer stays ONE 48px row (no wrap, no clip).
    const overflow = css.slice(overflowStart);
    expect(overflow).toMatch(/\.view-strip-layout,\s*\.view-strip-book\s*\{\s*display:\s*none;/);
    expect(overflow).toMatch(/\.view-strip-more\s*\{\s*display:\s*inline-flex;/);
  });

  it("(m) the single-mode footer consumes the Inspector inset; the base rule does not", () => {
    // DEF-577: grid row 6 does not inherit the surface inset that
    // `.document-scroller` / `.canvas-overlay` consume, so the open Inspector
    // covers the footer's right-hand controls unless the SINGLE-mode rule
    // applies the registered token itself.
    const single = /\.tab-stage\[data-multi-mode="false"\]\s+\.view-strip\s*\{([^}]*)\}/.exec(
      css,
    )?.[1];
    expect(single).toBeDefined();
    expect(single).toMatch(/margin-right:\s*var\(--tf-tools-inset,\s*0px\)\s*;/);

    // The base rule stays un-inset so a Multi Mode pane footer can never
    // double-consume the inset (DEF-323 - pane geometry already does).
    const base = /^\.view-strip\s*\{([^}]*)\}/m.exec(css)?.[1];
    expect(base).toBeDefined();
    expect(base).not.toMatch(/margin-right/);
  });

  it("(k) pins the dock-separation invariant to the LIVE dock tokens", () => {
    // Mirrors the (i) rule exactly: the base must clear `16px + 68px` by 16px.
    expect(MULTI_DOCK_BAND_BASE_PX).toBe(100);
    expect(MULTI_DOCK_BAND_BASE_PX - (16 + 68)).toBeGreaterThanOrEqual(16);
  });

  it("(n) the frosted .document-scroller stops at the View Strip footer (DEF-587)", () => {
    // The frosted scroller is `position: absolute` inside `.workspace-main`;
    // its bottom inset must consume the footer height token so the full-bleed
    // box can never cover grid row 6 (the 48px View Strip footer). Only the
    // frosted rule may change; light/dark keep their grid-row-5 box.
    const body = /:root\[data-theme="frosted"\]\s+\.document-scroller\s*\{([^}]*)\}/.exec(
      css,
    )?.[1];
    expect(body).toBeDefined();
    expect(body).toMatch(/top:\s*0\s*;/);
    expect(body).toMatch(/bottom:\s*var\(--view-strip-h/);
  });

  it("(o) the <=419px .view-strip-more reveal wins the base display:none (DEF-588)", () => {
    // The base `.view-strip-more { display: none; }` is declared AFTER the
    // overflow container block, so at equal specificity `display: none` would
    // win and the More trigger (the only route to layout + Book View in the
    // <=419px tier) would never display. Assert the REAL cascade: the reveal
    // selector must either out-specify the base or be declared after it.
    const overflowStart = css.indexOf("@container single-view-strip (max-width: 419px)");
    expect(overflowStart).toBeGreaterThan(-1);

    // Balanced-brace slice of the overflow container block.
    const open = css.indexOf("{", overflowStart);
    let depth = 0;
    let end = open;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const overflow = css.slice(open + 1, end);
    const revealSelector = /([^{}]*\.view-strip-more[^{}]*)\{\s*display:\s*inline-flex/.exec(
      overflow,
    )?.[1].trim();
    expect(revealSelector).toBeDefined();

    const baseMatch = /(?:^|\n)\.view-strip-more\s*\{([^}]*)\}/.exec(css);
    expect(baseMatch?.[1]).toBeDefined();
    expect(baseMatch?.[1]).toMatch(/display:\s*none/);

    const score = (sel: string): [number, number] => [
      (sel.match(/#[A-Za-z0-9_-]+/g) ?? []).length,
      (sel.match(/\.[A-Za-z0-9_-]+/g) ?? []).length +
        (sel.match(/\[[^\]]+\]/g) ?? []).length +
        (sel.match(/:(?!:)[A-Za-z-]+/g) ?? []).length,
    ];
    const reveal = score(revealSelector ?? "");
    const base = score(".view-strip-more");
    const outSpecifies =
      reveal[0] > base[0] || (reveal[0] === base[0] && reveal[1] > base[1]);
    const followsBase = (baseMatch?.index ?? 0) < overflowStart;
    expect(
      outSpecifies || followsBase,
      `reveal "${revealSelector}" must out-specify or be declared after ".view-strip-more"`,
    ).toBe(true);
  });

  it("(p) the <=419px tier tightens the row so its content fits its own box (DEF-591)", () => {
    // The qa retest measured a 263px footer whose flex content overflowed by
    // 35px: the More trigger's right edge landed past `.view-strip` and under
    // the collapsed Inspector rail. The overflow tier must therefore shrink
    // the row's OWN metrics one rung below the micro tier and relax the base
    // 32px `min-width` that would otherwise pin every control full-width.
    const overflowStart = css.indexOf("@container single-view-strip (max-width: 419px)");
    expect(overflowStart).toBeGreaterThan(-1);

    // Balanced-brace slice of the overflow container block.
    const open = css.indexOf("{", overflowStart);
    let depth = 0;
    let end = open;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const overflow = css.slice(open + 1, end);

    // The controls shrink below the micro 24px target and release min-width.
    const btn = /\.view-strip \.btn-toolbar\s*\{([^}]*)\}/.exec(overflow)?.[1];
    expect(btn).toBeDefined();
    const width = Number(/width:\s*(\d+)px/.exec(btn ?? "")?.[1]);
    expect(width).toBeLessThan(24);
    expect(btn).toMatch(/min-width:\s*0\s*;/);

    // The row's own gaps tighten too (footer + group), so the content fits.
    const strip = /(?:^|\n)\s*\.view-strip\s*\{([^}]*)\}/.exec(overflow)?.[1];
    expect(strip).toBeDefined();
    expect(strip).toMatch(/gap:\s*3px/);

    // Sanity of the fit at the qa-measured 263px footer: page group + view
    // group + padding + one inter-group gap must be <= the box inline-size.
    // page: prev + input(20) + next + 2 gaps(2) ; view: six 22px controls
    // (zoom out/in, fit width/page, pan, More) + 5 gaps(2).
    const pageGroup = width + 20 + width + 2 * 2;
    const viewGroup = 6 * width + 5 * 2;
    // Footer padding (0 5px) + the two 3px gaps around `.view-strip-space`.
    const rowMin = pageGroup + viewGroup + 2 * 5 + 2 * 3;
    expect(rowMin).toBeLessThanOrEqual(263);
  });
});

describe("Phase 109 (chunk B2) — single-mode overflow routing", () => {
  it("(l) the More surface exposes the moved layout + Book View hooks with menu ARIA", () => {
    const onChangePageLayout = vi.fn();
    const onOpenBookView = vi.fn();
    const { host, unmount } = renderStrip({
      onOpenBookView,
      onChangePageLayout,
      onHandToggle: (): void => undefined,
    });
    try {
      const toggle = host.querySelector<HTMLButtonElement>("[data-view-strip-more-toggle]");
      expect(toggle).not.toBeNull();
      expect(toggle?.getAttribute("aria-haspopup")).toBe("menu");
      expect(toggle?.getAttribute("aria-expanded")).toBe("false");
      // Closed: the moved controls are NOT duplicated in the DOM.
      expect(host.querySelector("[data-view-strip-more-menu]")).toBeNull();

      clickOn(toggle as Element);
      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
      const menu = host.querySelector("[data-view-strip-more-menu]");
      expect(menu).not.toBeNull();
      expect(menu?.getAttribute("role")).toBe("menu");
      expect(menu?.getAttribute("aria-label")).toBe("More viewing controls");

      // The moved layout options keep their exact accessible names + hooks.
      const moved = Array.from(menu!.querySelectorAll("[data-page-layout-option]"));
      expect(moved.map((o) => o.getAttribute("data-page-layout-option"))).toEqual([
        "one",
        "two",
        "four",
      ]);
      expect(moved.map((o) => o.getAttribute("aria-label"))).toEqual([
        "One page",
        "Two pages side by side",
        "Four pages in two rows",
      ]);
      const book = menu!.querySelector("[data-book-view-open]");
      expect(book).not.toBeNull();
      expect(book?.getAttribute("aria-label")).toBe("Book View");

      // Activating a moved layout option routes to the handler and closes.
      clickOn(moved[1] as Element);
      expect(onChangePageLayout).toHaveBeenCalledWith("two");
      expect(host.querySelector("[data-view-strip-more-menu]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("(l) Escape closes the More menu and returns focus to the trigger", () => {
    const { host, unmount } = renderStrip({ onOpenBookView: (): void => undefined });
    try {
      const toggle = host.querySelector<HTMLButtonElement>("[data-view-strip-more-toggle]");
      expect(toggle).not.toBeNull();
      clickOn(toggle as Element);
      expect(host.querySelector("[data-view-strip-more-menu]")).not.toBeNull();
      act((): void => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(host.querySelector("[data-view-strip-more-menu]")).toBeNull();
      expect(document.activeElement).toBe(toggle);
    } finally {
      unmount();
    }
  });

  it("(l) keeps every control's exact accessible name and omits the More surface in a pane", () => {
    const { host, unmount } = renderStrip({
      onOpenBookView: (): void => undefined,
      onHandToggle: (): void => undefined,
    });
    try {
      // The width tiers are CSS-only, so the DOM always carries the full inline
      // set with its exact names; the container query swaps which set is
      // displayed, never the names.
      for (const label of [
        "Previous page",
        "Current page",
        "Next page",
        "Zoom out",
        "Zoom in",
        "Fit width",
        "Fit page",
        "Pan mode",
        "Page layout",
        "Book View",
        "More viewing controls",
      ]) {
        expect(host.querySelector(`[aria-label="${label}"]`), label).not.toBeNull();
      }
    } finally {
      unmount();
    }

    const pane = renderStrip({ inMultiPane: true, onOpenBookView: (): void => undefined });
    try {
      // A Multi Mode pane has no layout / Book View chrome to overflow.
      expect(pane.host.querySelector("[data-view-strip-more-toggle]")).toBeNull();
    } finally {
      pane.unmount();
    }
  });
});

