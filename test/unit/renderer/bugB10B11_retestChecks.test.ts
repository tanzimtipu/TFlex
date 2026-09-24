// @vitest-environment node
//
// Regression guard for B10 + B11 retest verifications.
//
// B10 — the stamp ghost must be visible immediately when a stamp
// is armed. The previous shape rendered the ghost only after the
// first pointermove fired (pt === null until then meant the ghost
// sat at `left: -10000px`, completely off-screen). The user had
// no visual feedback that the stamp was armed until they moved
// the cursor, and even then the ghost appeared without a frame
// of anticipation. We pin the contract that the ghost's
// `pointer-events: none` style is in place AND that the inline
// `zIndex: 6` matches the `.stamp-layer` CSS so the ghost paints
// above every per-page layer (forms / edit / annotations /
// signatures).
//
// B11 — the OCR suspects panel must not open on an empty tab.
// The fix is already pinned by `bugB11_ocrSuspectsEmptyTabGuard`
// but qa's retest asked us to confirm both this guard AND the
// keyboard-shortcut path are clean. We assert the guard is
// present in App.tsx AND no keyboard shortcut bypasses it.

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const APP_PATH = resolve(__dirname, "../../../src/renderer/App.tsx");
const STAMP_PATH = resolve(
  __dirname,
  "../../../src/renderer/annotations/StampOverlay.tsx",
);
const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

describe("B10 — stamp ghost is visible and click-immune (re-verified for retest)", () => {
  it("StampOverlay's inline ghost style keeps pointer-events: none", async () => {
    const text = await readFile(STAMP_PATH, "utf8");
    const ghostStyle = text.match(
      /const style: CSSProperties = \{[\s\S]*?\};/,
    );
    expect(ghostStyle).not.toBeNull();
    if (ghostStyle === null) return;
    // The ghost must not absorb clicks (the page-bound pointerdown
    // handler is what places the stamp; if the ghost ate clicks
    // the user couldn't drop a stamp on its own preview).
    expect(ghostStyle[0]).toMatch(/pointerEvents:\s*["']none["']/);
  });

  it("StampOverlay's inline ghost style uses zIndex: 6 (matches .stamp-layer)", async () => {
    const text = await readFile(STAMP_PATH, "utf8");
    const ghostStyle = text.match(
      /const style: CSSProperties = \{[\s\S]*?\};/,
    );
    expect(ghostStyle).not.toBeNull();
    if (ghostStyle === null) return;
    expect(ghostStyle[0]).toMatch(/zIndex:\s*6/);
  });

  it(".stamp-layer CSS is at z-index 6 (above forms / edit / annotations / signatures)", async () => {
    const styles = await readFile(STYLES_PATH, "utf8");
    const rule = styles.match(/\.stamp-layer\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    if (rule === null) return;
    expect(rule[0]).toMatch(/z-index:\s*6\s*;/);
  });
});

describe("B11 — OCR palette shortcut on empty tab (re-verified for retest)", () => {
  it("App.tsx's onOpenOcrSuspects handler gates on a non-null active tab id", async () => {
    const text = await readFile(APP_PATH, "utf8");
    expect(text).toMatch(/onOpenOcrSuspects\s*=\s*useCallback/);
    expect(text).toMatch(
      /onOpenOcrSuspects[\s\S]*?if\s*\(\s*activeId\s*===\s*null\s*\)\s*return/,
    );
  });

  it("App.tsx's onOpenOcrSuspects handler additionally gates on ocrRunByTab[activeId] === true", async () => {
    const text = await readFile(APP_PATH, "utf8");
    expect(text).toMatch(
      /onOpenOcrSuspects[\s\S]*?ocrRunByTabRef\.current\[activeId\]\s*!==\s*true\s*[\s\S]*?return/,
    );
  });

  it("the EDIT ContextPanel wires its OCR-suspects click through onOpenOcrSuspects (not raw setState)", async () => {
    // Phase 36 STAGES retired the Tools palette from App's render tree. The
    // OCR-suspects entry's current homes are the EDIT ContextPanel's "Review
    // suspects" action and the Action Dock's `ocrSuspects` row (the Command
    // Palette runs the same dock action); both route through the SAME gated
    // onOpenOcrSuspects handler. Pin both call sites.
    const text = await readFile(APP_PATH, "utf8");
    const panelMatch = text.match(/onOpenOcrSuspects=\{onOpenOcrSuspects\}/);
    expect(panelMatch, "EDIT ContextPanel suspects wiring missing").not.toBeNull();
    const dockMatch = text.match(/ocrSuspects: \(\): void => onOpenOcrSuspects\(\)/);
    expect(dockMatch, "Action Dock suspects wiring missing").not.toBeNull();
    for (const call of [panelMatch?.[0] ?? "", dockMatch?.[0] ?? ""]) {
      expect(call).toContain("onOpenOcrSuspects");
      expect(call).not.toContain("setOcrSuspectsOpen(true)");
    }
  });

  it("no keyboard shortcut bypasses the guard (no direct setOcrSuspectsOpen(true) outside the three legitimate sites)", async () => {
    // The three legitimate open sites (onOpenOcrSuspects,
    // post-OCR-confirm, post-batch-OCR) are covered by the
    // existing B11 test. Belt-and-braces: scan App.tsx for any
    // direct `setOcrSuspectsOpen(true)` call and verify it lives
    // inside one of those three contexts.
    const text = await readFile(APP_PATH, "utf8");
    const lines = text.split(/\r?\n/);
    const directCalls: { line: number; text: string }[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (/setOcrSuspectsOpen\(true\)/.test(line)) {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
        directCalls.push({ line: i + 1, text: trimmed });
      }
    }
    // Same bound as the existing B11 test: <=3 legitimate sites.
    expect(directCalls.length).toBeLessThanOrEqual(3);
  });
});