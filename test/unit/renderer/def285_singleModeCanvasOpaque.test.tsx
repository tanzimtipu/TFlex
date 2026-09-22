// @vitest-environment jsdom
//
// DEF-285 — in SINGLE mode the frosted-theme canvas was see-through.
//
// In frosted the app frame, `.workspace-main` and the full-bleed
// `.document-scroller` all step aside so the wallpaper reads through the
// chrome (DEF-181); the document canvas must NOT, or the gutter beside a
// zoomed-out page shows the desktop through the app (qa sampled alpha 16 at a
// gutter pixel). The fix adds single-mode rules that mirror the Multi Mode
// pane rule and paint `--tf-canvas-opaque` (light `#f1f5f9`, dark `#0b0d0f`,
// frosted `--tf-bg`). These tests pin the static CSS contract (so removing the
// rule fails, the style of the def282_paneToolbarOffset guard) plus the token
// definitions in all three themes, and check the rendered single-mode stage
// carries the selector path the rule targets.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { DocumentStage, type StageTab } from "../../../src/renderer/components/MultiPane";
import type { MultiModeState } from "../../../src/renderer/state/multiMode";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

const NOOP = (): void => undefined;

const TABS: StageTab[] = [{ id: "a", title: "Alpha.pdf", pageCount: 3 }];

const SINGLE: MultiModeState = { enabled: false, paneA: null, paneB: null, focused: "A" };

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractRuleBody(src: string, selectorIndex: number): string {
  const braceOpen = src.indexOf("{", selectorIndex);
  if (braceOpen === -1) return "";
  let depth = 0;
  for (let i = braceOpen; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(braceOpen + 1, i);
    }
  }
  return "";
}

function findRuleBody(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
  const idx = stripped.indexOf(selector);
  if (idx === -1) return null;
  // A selector may sit in a comma-separated list, so the opening brace is the
  // NEXT `{` after the match (not necessarily immediately after the selector).
  // A declaration that merely mentions the string would close with `}`/`;`
  // before any `{`, so guard against that.
  const braceOpen = stripped.indexOf("{", idx);
  if (braceOpen === -1) return null;
  const braceClose = stripped.indexOf("}", idx);
  const semicolon = stripped.indexOf(";", idx);
  if (braceClose !== -1 && braceClose < braceOpen) return null;
  if (semicolon !== -1 && semicolon < braceOpen) return null;
  return extractRuleBody(stripped, idx);
}

describe("DEF-285 — single-mode canvas is opaque in every theme (static CSS guard)", () => {
  const src = readFileSync(STYLES_PATH, "utf8");

  it("paints the single-mode canvas surfaces with --tf-canvas-opaque", () => {
    const body = findRuleBody(src, '.tab-stage[data-multi-mode="false"] .workspace-main');
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/background:\s*var\(--tf-canvas-opaque\)/);
    // The scroller is the surface the page gutter exposes — it must be in the
    // same rule (mirroring the Multi Mode pane rule). Both selectors sit in
    // the rule's selector list, immediately before the body.
    const stripped = stripCssComments(src);
    const selectorPair =
      '.tab-stage[data-multi-mode="false"] .workspace-main,\n' +
      '.tab-stage[data-multi-mode="false"] .document-scroller {';
    expect(stripped.replace(/\r\n/g, "\n")).toContain(selectorPair);
  });

  it("mirrors the Multi Mode rule so both modes share one opaque token", () => {
    const multi = findRuleBody(
      src,
      '.tab-stage[data-multi-mode="true"] .tab-pane[data-pane] .document-scroller',
    );
    expect(multi).not.toBeNull();
    expect(multi ?? "").toMatch(/var\(--tf-canvas-opaque\)/);
  });

  it("defines --tf-canvas-opaque in all three themes (light / dark / frosted)", () => {
    const defs = stripCssComments(src).match(/--tf-canvas-opaque:/g) ?? [];
    expect(defs.length).toBeGreaterThanOrEqual(3);
    // Frosted must still define an OPAQUE canvas token (the theme's --tf-bg),
    // even though its chrome goes translucent.
    const frosted = src.slice(src.indexOf(':root[data-theme="frosted"] {'));
    expect(frosted).toMatch(/--tf-canvas-opaque:\s*var\(--tf-bg\)/);
  });

  it("the frosted transparency rule still exists (we overrode it, not removed it)", () => {
    // DEF-181 keeps html/body/.app/.workspace-main stepping aside in frosted;
    // the single-mode canvas rule must beat it by specificity, not by deleting
    // the ambient behaviour.
    expect(src).toMatch(/:root\[data-theme="frosted"\] \.app,\s*\n:root\[data-theme="frosted"\] \.workspace-main\s*\{\s*background:\s*transparent;/);
  });
});

describe("DEF-285 — the rendered single-mode stage carries the targeted selectors", () => {
  async function renderSingle(): Promise<{ host: HTMLElement; unmount: () => void }> {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async (): Promise<void> => {
      root.render(
        <DocumentStage
          tabs={TABS}
          activeId="a"
          showWelcome={false}
          welcomeKey="welcome"
          welcome={null}
          multiMode={SINGLE}
          splitFraction={0.5}
          onSplitChange={NOOP}
          onFocusPane={NOOP}
          onClearPane={NOOP}
          onPickPane={NOOP}
          onOpenIntoPane={NOOP}
          renderDocument={(): ReactElement => (
            <div className="workspace">
              <div className="workspace-main">
                <div className="document-scroller" data-testid="scroller" />
              </div>
            </div>
          )}
        />,
      );
      await Promise.resolve();
    });
    return {
      host,
      unmount: (): void => {
        act((): void => {
          root.unmount();
        });
        host.remove();
      },
    };
  }

  it("the single-mode stage is data-multi-mode=false and holds the canvas surfaces", async () => {
    const { host, unmount } = await renderSingle();
    try {
      const stage = host.querySelector(".tab-stage");
      expect(stage?.getAttribute("data-multi-mode")).toBe("false");
      expect(stage?.querySelector(".workspace-main")).not.toBeNull();
      expect(stage?.querySelector(".document-scroller")).not.toBeNull();
    } finally {
      unmount();
    }
  });
});