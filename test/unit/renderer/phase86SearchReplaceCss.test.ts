// @vitest-environment node
// Static CSS guard for the Phase 86 Find/replace controls (DEF-500).
//
// The Find bar (.search-bar) is a full-width chrome row of .workspace-main.
// With the always-on Inspector open its right-hand controls
// ([data-search-replace-toggle], [data-search-replace-one],
// [data-search-replace-all]) sat UNDER the Inspector column, so
// document.elementFromPoint returned the Inspector header and a real pointer
// click timed out. The page-view scroller and .ocr-suspects-panel already
// reserve the SAME registered token (--tf-tools-inset, 0px closed / 264px
// open); the bar must do the same via the token, never a hardcoded width.
//
// jsdom applies no stylesheet, so the component spec cannot catch this. This
// test pins the load-bearing declarations textually, mirroring
// phase84_redactionCss.test.ts.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const VIEW_PATH = resolve(
  __dirname,
  "../../../src/renderer/components/DocumentView.tsx",
);
const INSET = "var(--tf-tools-inset, 0px)";

function readStyles(): string {
  return readFileSync(STYLES_PATH, "utf8");
}

/** Strip CSS comments so commented-out rules do not create false matches. */
function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

interface CssRule {
  selector: string;
  body: string;
}

/** Collect every flat rule (selector + body) in the stylesheet. Bodies here
 *  never nest braces, so the innermost-block regex is sufficient. */
function collectRules(src: string): CssRule[] {
  const rules: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (;;) {
    const m = re.exec(src);
    if (m === null) break;
    rules.push({ selector: (m[1] ?? "").trim(), body: m[2] ?? "" });
  }
  return rules;
}

function declarationValue(body: string, property: string): string | null {
  const re = new RegExp(`(?:^|;|\\n)\\s*${property}\\s*:\\s*([^;]+?)\\s*(?:;|$)`, "m");
  const m = body.match(re);
  if (m === null) return null;
  return (m[1] ?? "").trim();
}

describe("styles.css — Phase 86 Find/replace inset (DEF-500)", () => {
  const raw = stripCssComments(readStyles());

  it(".search-bar reserves the Tools inset via the registered token", () => {
    const base = collectRules(raw).find(
      (r) => r.selector === ".search-bar" && declarationValue(r.body, "margin-right") !== null,
    );
    expect(base).toBeDefined();
    expect(declarationValue(base?.body ?? "", "margin-right")).toBe(INSET);
  });

  it("no .search-bar rule overrides the inset with another value", () => {
    const barRules = collectRules(raw).filter(
      (r) => r.selector.includes(".search-bar") && !r.selector.includes("::after"),
    );
    expect(barRules.length).toBeGreaterThan(0);
    for (const rule of barRules) {
      const value = declarationValue(rule.body, "margin-right");
      if (value !== null) {
        expect(value).toBe(INSET);
      }
    }
  });

  it("the frosted .search-bar variants do not unset the reservation", () => {
    const frosted = collectRules(raw).filter(
      (r) =>
        r.selector.includes('[data-theme="frosted"]') &&
        r.selector.includes(".search-bar") &&
        !r.selector.includes("::after"),
    );
    expect(frosted.length).toBeGreaterThan(0);
    for (const rule of frosted) {
      expect(declarationValue(rule.body, "margin-right")).toBeNull();
    }
  });
});

// DEF-500 attempt 2 - the page-layout control overlaps the replace row, not
// because the bar is under-stacked, but because --tf-chrome-y went STALE: the
// search bar grows when the replace row and its report line wrap in, while the
// measurement only re-ran on row mount / window resize. The control therefore
// stayed at base-bar height and its z-index:3 painted over
// [data-search-replace-one]/[data-search-replace-all]. The chosen mechanism is
// to keep the control BELOW the real chrome (never hide or disable it), so
// these guards pin both halves: the control's top follows the token, and the
// token tracks every chrome-row size change.
describe("styles.css - chrome-aware page-layout placement (DEF-500)", () => {
  const raw = stripCssComments(readStyles());

  it(".canvas-page-layout anchors its top to the measured chrome stack", () => {
    const control = collectRules(raw).find(
      (r) => r.selector === ".canvas-page-layout",
    );
    expect(control).toBeDefined();
    expect(declarationValue(control?.body ?? "", "top")).toContain(
      "var(--tf-chrome-y, 0px)",
    );
  });

  it("the control is not forced above the bar (stays visible and hit-testable)", () => {
    const control = collectRules(raw).find(
      (r) => r.selector === ".canvas-page-layout",
    );
    // It keeps the pills' own surface z-index; the fix must not stack it
    // under an overlay. No other rule may zero its z-index.
    expect(declarationValue(control?.body ?? "", "z-index")).toBe("3");
  });

  it("DocumentView re-measures --tf-chrome-y on any chrome-row size change", () => {
    const src = readFileSync(VIEW_PATH, "utf8");
    const start = src.indexOf("const CHROME_SELECTOR");
    const end = src.indexOf(
      "}, [editModeOpen, searchOpen, themeName]);",
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const effect = src.slice(start, end);
    // The search bar is part of the measured stack...
    expect(effect).toContain('".toolbar, .search-bar"');
    // ...and a ResizeObserver re-publishes the token when the replace row
    // expands, not only on window resize or row mount.
    expect(effect).toContain("new ResizeObserver(recompute)");
    expect(effect).toContain("observer.observe(el)");
  });
});

// DEF-500 attempt 3 - the replace buttons overlapped EACH OTHER. They reused
// the icon-only .tool-btn (fixed 28px, no overflow clip) while carrying text
// labels ("Replace", "Replace all"); each label spilled past its 28px box and
// the later button captured the earlier button's centre, so a real click on
// Replace ran Replace-all. jsdom lays nothing out, so this pins the fix
// textually: a content-fitting class that overrides the fixed .tool-btn width,
// applied to BOTH labelled buttons, with .tool-btn itself left untouched.
describe("styles.css - content-fitting replace buttons (DEF-500)", () => {
  const raw = stripCssComments(readStyles());
  const SEARCHBAR_PATH = resolve(
    __dirname,
    "../../../src/renderer/components/SearchBar.tsx",
  );

  it(".search-replace-btn sizes to its content instead of a fixed 28px box", () => {
    const rule = collectRules(raw).find(
      (r) => r.selector === ".tool-btn.search-replace-btn",
    );
    expect(rule).toBeDefined();
    const body = rule?.body ?? "";
    // Auto width (not a bare pixel box) is what lets the label fit.
    expect(declarationValue(body, "width")).toBe("auto");
    // It still honours the shared 28px minimum and never wraps the label.
    expect(declarationValue(body, "min-width")).toBe("28px");
    expect(declarationValue(body, "white-space")).toBe("nowrap");
    // Horizontal padding comes from a spacing token, not a hardcoded value.
    expect(declarationValue(body, "padding")).toContain("var(--sp-2)");
  });

  it("retires the legacy bare .tool-btn fork (Phase 91 DEF-523)", () => {
    // Every control that used to ride the bare `.tool-btn` fork now carries
    // the canonical `btn btn-toolbar tool-btn` classes, so the fork rules are
    // gone and the canonical .btn / .btn-toolbar family owns geometry + state.
    const styles = readStyles();
    expect(styles).not.toContain(".tool-btn:not(.btn)");
    expect(styles).not.toContain(".tool-btn-active:not(.btn)");
  });

  it(".tool-btn.search-replace-btn out-specifies the canonical .btn-toolbar geometry", () => {
    // The two-class replace selector (0,2,0) beats the single-class
    // .btn-toolbar (0,1,0), so the labelled replace buttons keep their
    // content width without relying on source order.
    const replaceBtn = collectRules(raw).find(
      (r) => r.selector === ".tool-btn.search-replace-btn",
    );
    expect(replaceBtn).toBeDefined();
    expect(declarationValue(replaceBtn?.body ?? "", "width")).toBe("auto");
    expect(readStyles()).toContain(".btn-toolbar {");
  });

  it("keeps the .btn.tool-btn no-shrink layout alias", () => {
    const alias = collectRules(raw).find((r) => r.selector === ".btn.tool-btn");
    expect(alias).toBeDefined();
    // .btn-toolbar does not set flex-shrink; the alias stops the navigation
    // cluster from compressing into illegibility when the toolbar is narrow.
    expect(declarationValue(alias?.body ?? "", "flex-shrink")).toBe("0");
  });

  it("applies search-replace-btn to both labelled replace buttons", () => {
    const src = readFileSync(SEARCHBAR_PATH, "utf8");
    for (const attr of ["data-search-replace-one", "data-search-replace-all"]) {
      const className = src.match(
        new RegExp(`className="([^"]*)"\\s*${attr}`),
      )?.[1];
      expect(className).toBeDefined();
      expect(className).toContain("search-replace-btn");
    }
    // The labels stay verbatim - no relabel-into-ambiguity shortcut.
    expect(src).toContain("Replace");
    expect(src).toContain("Replace all");
  });
});
