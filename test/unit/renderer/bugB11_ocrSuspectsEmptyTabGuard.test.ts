// @vitest-environment jsdom
//
// B11 — OCR suspects panel must not open on an empty tab.
//
// The previous wiring: the Tools palette's "OCR suspects" button
// fired `setOcrSuspectsOpen(true)` unconditionally. The panel's
// render was guarded on `activeTabIdRefLocal.current !== null`,
// so the panel never appeared on an empty tab — but the open
// flag flipped anyway. If the user then opened a document in a
// new tab the panel would surface against that tab even though
// they hadn't asked for it on the new doc, and OCR had never
// run there. From the user's perspective the click was a silent
// no-op (nothing visible happened), which is the bug report.
//
// Fix: gate `onOpenOcrSuspects` on BOTH an active document AND
// `ocrRunByTab[activeId] === true` (mirrors the Tools palette's
// existing `hasOcrSuspects` button gate). The open-flag never
// flips unless the panel can actually render. We pin the wiring
// here so a future regression that drops either guard fails the
// test rather than reintroducing the silent no-op.
//
// We exercise this as a structural / contract test: read the App
// source and verify the guard pattern is in place around
// `setOcrSuspectsOpen(true)`. Direct render of App.tsx is
// impractical (it boots the full app + pdfjs + persistence +
// IPC).
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const appPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "App.tsx",
);
const appSource = fs.readFileSync(appPath, "utf8");

describe("B11 — OCR suspects panel must not open on an empty tab", () => {
  it("the App exposes an onOpenOcrSuspects handler that gates on the active tab id", () => {
    // The handler must require a non-null active tab id before
    // calling setOcrSuspectsOpen(true). The Tools palette is the
    // only call site; the handler is the canonical entry point.
    expect(appSource).toMatch(/onOpenOcrSuspects\s*=\s*useCallback/);
    expect(appSource).toMatch(/onOpenOcrSuspects[\s\S]*?if\s*\(\s*activeId\s*===\s*null\s*\)\s*return/);
  });

  it("the handler additionally requires ocrRunByTab[activeId] === true", () => {
    // The handler must additionally check that the active tab has
    // had at least one OCR run, otherwise the panel would surface
    // an empty "no suspects" list against a tab the user never
    // ran OCR on. The Tools palette button is already gated by
    // `hasOcrSuspects`, but the handler's own guard is the source
    // of truth — keyboard / programmatic / future menu routes can
    // reach the open call without the button gate.
    expect(appSource).toMatch(
      /onOpenOcrSuspects[\s\S]*?ocrRunByTabRef\.current\[activeId\]\s*!==\s*true\s*[\s\S]*?return/,
    );
  });

  it("the EDIT ContextPanel / Action Dock call sites route through onOpenOcrSuspects (not a raw setState)", () => {
    // Phase 36 STAGES retired the Tools palette (the old raw-setState
    // wiring is gone with it). The suspects entry now lives in the EDIT
    // ContextPanel's "Review suspects" action and the Action Dock's
    // `ocrSuspects` row, which the Command Palette runs through the same
    // dock action. Both route through the guarded handler.
    const panelMatch = appSource.match(/onOpenOcrSuspects=\{onOpenOcrSuspects\}/);
    expect(panelMatch, "EDIT ContextPanel suspects wiring missing").not.toBeNull();
    const dockMatch = appSource.match(/ocrSuspects: \(\): void => onOpenOcrSuspects\(\)/);
    expect(dockMatch, "Action Dock suspects wiring missing").not.toBeNull();
    for (const call of [panelMatch?.[0] ?? "", dockMatch?.[0] ?? ""]) {
      expect(call).toContain("onOpenOcrSuspects");
      expect(call).not.toContain("setOcrSuspectsOpen(true)");
    }
  });

  it("the only direct setOcrSuspectsOpen(true) calls in App.tsx are inside the guarded onOpenOcrSuspects / OCR-confirm / batch paths", () => {
    // Three legitimate open sites are allowed:
    //   - onOpenOcrSuspects handler (this fix)
    //   - post-OCR-confirm flow (active doc, OCR just ran)
    //   - post-batch-OCR flow (active doc, batch just ran)
    // Anything else is a regression to the silent-no-op bug.
    // We verify the total count stays at <= 3 (the three
    // legitimate sites) AND each line's preceding context
    // matches one of the three legitimate patterns, so a future
    // regression that adds a fourth site — e.g. a re-introduction
    // of the raw `setOcrSuspectsOpen(true)` in the palette
    // wiring — fails the test.
    const lines = appSource.split(/\r?\n/);
    const directCalls: { line: number; text: string; context: string }[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (/setOcrSuspectsOpen\(true\)/.test(line)) {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
        const context = lines.slice(Math.max(0, i - 6), i + 1).join("\n");
        directCalls.push({ line: i + 1, text: trimmed, context });
      }
    }
    // The three legitimate sites are inside:
    //   - onOpenOcrSuspects (the fix)
    //   - post-OCR-confirm (active doc + just-ran-OCR)
    //   - post-batch-OCR (active doc + just-ran-batch)
    expect(directCalls.length).toBeLessThanOrEqual(3);
    for (const call of directCalls) {
      const widerCtx = lines
        .slice(Math.max(0, call.line - 25 - 1), call.line)
        .join("\n");
      const ctx = call.context;
      const legitimate =
        /onOpenOcrSuspects\s*=\s*useCallback/.test(ctx) ||
        /onOcrConfirm\b/.test(widerCtx) ||
        /onBatchOcr\s*=/.test(widerCtx) ||
        /batch\s+ocr/i.test(widerCtx) ||
        /post-OCR-confirm/i.test(widerCtx) ||
        /post-batch-ocr/i.test(widerCtx) ||
        /just ran OCR/i.test(widerCtx) ||
        /setOcrSuspectsByTab/.test(ctx) ||
        /setOcrRunByTab/.test(ctx);
      expect(
        legitimate,
        `line ${call.line}: ${call.text} must be inside one of the legitimate OCR-open contexts`,
      ).toBe(true);
    }
  });
});