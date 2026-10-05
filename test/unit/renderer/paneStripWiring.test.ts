// Phase 33 (chunk 3) — the per-pane strip wiring and the opaque canvas rule,
// source-scanned.
//
// The App composition itself is too large to mount in a unit test, so the
// wiring is asserted the same way the Phase-32 routing tests do it: read the
// real sources and check the seams exist, in order, and that the strips reuse
// the existing Thumb rules instead of forking them. The opaque-canvas
// requirement is a CSS rule contract: the Multi Mode style rules must give the
// pane and its scroller an OPAQUE theme colour (qa's e2e does the real pixel
// measurement).

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..", "..");
function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, "src", "renderer", relative), "utf8");
}

describe("DocumentView owns the rail side and the per-pane strip", () => {
  const view = read("components/DocumentView.tsx");

  it("defaults the rail side to the left and renders pane A on the right", () => {
    expect(view).toMatch(/railSide\?: "left" \| "right";/);
    expect(view).toMatch(/railSide = "left",/);
    expect(view).toMatch(/data-rail-side=\{showRail \? railSide : undefined\}/);
    // The rail node is placed BEFORE the page area on the left and AFTER it
    // on the right — the DOM order is the geometry.
    expect(view).toMatch(/\{showRail && railSide === "left" \? railNode : null\}/);
    expect(view).toMatch(/\{showRail && railSide === "right" \? railNode : null\}/);
    // The right-hand slot is the LAST child, after `.workspace-main`.
    const mainIdx = view.indexOf('className="workspace-main"');
    const rightIdx = view.indexOf('{showRail && railSide === "right" ? railNode : null}');
    expect(mainIdx).toBeGreaterThan(-1);
    expect(rightIdx).toBeGreaterThan(mainIdx);
  });

  it("renders the pane's OWN strip with its own document identity and drag seam", () => {
    expect(view).toMatch(/<PaneThumbStrip/);
    expect(view).toMatch(/tabId=\{multiRail\.tabId\}/);
    expect(view).toMatch(/crossDoc=\{\{ tabId: multiRail\.tabId, onDrop: multiRail\.onDrop \}\}/);
    expect(view).toMatch(/onJump=\{\(p\): void => jumpToPage\(p\)\}/);
    // Single mode still renders the unchanged SideRail (multiRail null).
    expect(view).toMatch(/multiRail === null \? \(/);
  });
});

describe("App wires one strip per pane, on the correct side", () => {
  const app = read("App.tsx");

  it("gives pane A 'right' and pane B 'left' and no shared rail remains", () => {
    expect(app).toMatch(/railSide=\{pane === "A" \? "right" : "left"\}/);
    expect(app).toMatch(/multiRail=\{/);
    expect(app).toMatch(/pane === null\s*\n?\s*\? null/);
    expect(app).toMatch(/onFocusPane: \(\): void => onFocusPane\(pane\)/);
    expect(app).toMatch(/onDrop: onPageDrop/);
    // The shared rail composition is retired.
    expect(app).not.toMatch(/<MultiRail/);
    expect(app).not.toMatch(/sharedRail=\{/);
  });

  it("hands the pane to the stage's document renderer", () => {
    expect(app).toMatch(/renderDocument=\{\(tabId, pane\) => \{/);
    const stage = read("components/MultiPane.tsx");
    expect(stage).toMatch(/renderDocument: \(tabId: string, pane: PaneId \| null\) => ReactNode;/);
    expect(stage).toMatch(/\{renderDocument\(tab\.id, pane\)\}/);
  });

  it("still reveals the landing page after a cross-document drop", () => {
    expect(app).toMatch(/setRailJump\(\{ tabId, page, seq: railJumpSeqRef\.current \}\)/);
    expect(app).toMatch(
      /jumpRequest=\{railJump !== null && railJump\.tabId === meta\.id \? railJump : null\}/,
    );
  });
});

describe("the stage no longer hosts a shared rail", () => {
  const stage = read("components/MultiPane.tsx");

  it("has no shared-rail prop, node or rail column", () => {
    expect(stage).not.toMatch(/sharedRail/);
    expect(stage).not.toMatch(/MultiRail/);
    expect(stage).not.toMatch(/data-shared-rail/);
    expect(stage).not.toMatch(/tf-shared-rail-w/);
  });

  it("keeps the divider 1:1 across the whole stage (the panes own it)", () => {
    expect(stage).toMatch(/"--tf-split-frac": String\(splitFraction\)/);
    // Phase 34 (chunk 3) — DEF-286/287: each pane gives up HALF the (capped)
    // All Tools inset, so the divider's centre is `W * frac - inset/2` and
    // the pointer fraction inverts to `(x + inset/2) / W`.
    expect(stage).toMatch(/getPropertyValue\("--tf-tools-inset"\)/);
    expect(stage).toMatch(
      /effectiveToolsInset\(rect\.width, requestedInset\)/,
    );
    expect(stage).toMatch(/const raw = \(clientX - rect\.left \+ inset \/ 2\) \/ rect\.width;/);
  });
});

describe("the strip reuses the existing Thumb rules, changing only the width", () => {
  const strip = read("components/PaneThumbStrip.tsx");
  const rail = read("components/SideRail.tsx");

  it("computes its width with computeThumbWidth and renders a real ThumbnailRail", () => {
    expect(strip).toMatch(/import \{ computeThumbWidth \} from "\.\/thumbGeometry";/);
    expect(strip).toMatch(/const thumbWidth = computeThumbWidth\(stripWidth, documentCount\);/);
    expect(strip).toMatch(/<ThumbnailRail/);
    expect(strip).toMatch(/crossDoc=\{crossDoc\}/);
  });

  it("re-measures its own width through a ResizeObserver", () => {
    expect(strip).toMatch(/new ResizeObserver\(read\)/);
    expect(strip).toMatch(/ro\.observe\(el\)/);
  });

  it("keeps the DEF-274 offscreen swap and the DEF-222 unmount-only cleanup", () => {
    // Offscreen scratch render + atomic blit.
    expect(rail).toMatch(/const scratch = document\.createElement\('canvas'\);/);
    expect(rail).toMatch(/ctx\.drawImage\(scratch, 0, 0\);/);
    // Release the bitmap only on a true unmount.
    expect(rail).toMatch(/if \(!mountedRef\.current\) \{/);
    // The width still participates in the render effect's deps.
    expect(rail).toMatch(/\}, \[shouldRender, doc, page, width\]\);/);
  });
});

describe("Multi Mode's canvas is opaque in every theme (Phase 33 / DEF-281)", () => {
  const css = read("styles.css");

  it("paints the pane surface and its scroller with the opaque canvas token", () => {
    expect(css).toMatch(
      /\.tab-stage\[data-multi-mode="true"\] \.tab-pane\[data-pane\] \{\s*background: var\(--tf-canvas-opaque\);/,
    );
    expect(css).toMatch(
      /\.tab-stage\[data-multi-mode="true"\] \.tab-pane\[data-pane\] \.document-scroller,[\s\S]{0,120}\.workspace-main \{\s*background: var\(--tf-canvas-opaque\);/,
    );
  });

  it("declares --tf-canvas-opaque as a solid colour in each theme", () => {
    // One declaration per theme block: light (root), dark, frosted.
    const declarations = [...css.matchAll(/--tf-canvas-opaque:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(declarations.length).toBe(3);
    // Opaque means: a hex literal, or another opaque hex-backed token —
    // never `transparent` and never an rgba()/hsla() with alpha < 1.
    for (const value of declarations) {
      expect(value).not.toMatch(/transparent/i);
      expect(value).not.toMatch(/rgba?\(|hsla?\(/);
    }
    expect(declarations).toContain("#ECEFF4");
    expect(declarations).toContain("#151820");
    expect(declarations).toContain("var(--tf-bg)");
    // The frosted theme's --tf-bg is a solid hex, so the frosted canvas
    // resolves opaque too.
    expect(css).toMatch(/:root\[data-theme="frosted"\] \{[\s\S]{0,4000}--tf-bg: #eef1f5;/);
  });

  it("does not repaint PDF content (the animation rule)", () => {
    expect(css).not.toMatch(/\.pdf-page\s*\{[^}]*background:\s*var\(--tf-canvas-opaque\)/);
    expect(css).not.toMatch(/\.page-slot\s*\{[^}]*background:\s*var\(--tf-canvas-opaque\)/);
  });
});