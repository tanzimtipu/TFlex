// @vitest-environment node
//
// Regression guard for DEF-097 — `tflexDiagnostics().activeTool`
// must return `null` after the active tab is closed, not the
// closed tab's stale tool. The DocumentView's per-tab `annTool`
// reducer unmounts with the tab (the tab-pane is keyed on
// `meta.id`), so the renderer's own tool state can't leak — but
// `diagnosticsRef.current` retained the last published value
// until a new DocumentView (or no DocumentView, on the welcome
// screen) overwrote it.
//
// Fix: `performCloseTab` clears the diagnostics mirror's
// `activeTool` field explicitly. This pins the wiring so a future
// refactor that drops the explicit reset reintroduces the silent
// stale-tool report against the next open tab.
//
// We exercise this as a structural / contract test: read the App
// source and verify the reset is in place inside `performCloseTab`.
// Direct render of App.tsx is impractical (it boots the full
// app + pdfjs + persistence + IPC).

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const APP_PATH = resolve(__dirname, "../../../src/renderer/App.tsx");

describe("DEF-097 — tab close clears activeTool from the diagnostics mirror", () => {
  it("performCloseTab explicitly resets diagnostics.activeTool to null", async () => {
    const text = await readFile(APP_PATH, "utf8");
    // Pull the performCloseTab body — same regex as the existing
    // B6 / DEF-093 guards so the assertion is anchored on the
    // exact function body and not on App-level surface shape.
    const match = text.match(/const performCloseTab[\s\S]*?^  \},\s*\[\]\);/m);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // The fix calls `setDiagnostics((prev) => ... activeTool: null ...)`
    // inside performCloseTab. We assert the wiring is present so a
    // future refactor that drops the explicit reset fails the test.
    expect(body).toMatch(/setDiagnostics\(/);
    expect(body).toMatch(/activeTool\s*:\s*null/);
  });

  it("performCloseTab's diagnostics reset fires after every other reset (covers all close paths)", async () => {
    // The reset must come AFTER every other state cleanup so it
    // runs regardless of which earlier setter was a no-op. We
    // assert the setDiagnostics call's line position is greater
    // than every other `set*` call inside the same function.
    const text = await readFile(APP_PATH, "utf8");
    const match = text.match(/const performCloseTab[\s\S]*?^  \},\s*\[\]\);/m);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    const setDiagnosticsIdx = body.indexOf("setDiagnostics(");
    expect(setDiagnosticsIdx).toBeGreaterThan(-1);
    // Every other `set*(false|null)` cleanup must appear BEFORE
    // the diagnostics reset (so the reset is the last write).
    // We only check a representative sample of the existing
    // resets — the full list is covered by bugB6_tabCloseClear.
    for (const setter of [
      "setArmedSignatureId(null)",
      "setArmedStamp(null)",
      "setFlattenOpen(false)",
      "setOptimizeOpen(false)",
      "setOcrSuspectsOpen(false)",
      "setPendingCloseTabId(null)",
    ]) {
      const idx = body.indexOf(setter);
      if (idx === -1) continue;
      expect(idx).toBeLessThan(setDiagnosticsIdx);
    }
  });

  it("App.tsx's tflexDiagnostics() reads activeTool with a null default", async () => {
    // Belt-and-braces: even if performCloseTab drops the
    // explicit reset, tflexDiagnostics itself must default to
    // null when no value is present. We re-assert the DEF-093
    // contract here so both ends of the pipe stay honest.
    const text = await readFile(APP_PATH, "utf8");
    expect(text).toMatch(
      /const\s+activeTool\s*:\s*string\s*\|\s*null\s*=[\s\S]*?typeof\s+rawActiveTool\s*===\s*["']string["']\s*\?\s*rawActiveTool\s*:\s*null\s*;/,
    );
  });
});