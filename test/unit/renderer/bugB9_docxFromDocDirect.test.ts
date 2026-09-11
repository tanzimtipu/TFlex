// @vitest-environment jsdom
//
// B9 + DEF-106 + Bug 7 + Phase-16 — DOCX assembly wiring.
//
// History: the original DOCX flow used `createDocxFromImages(entries)`
// exclusively — a one-image-per-page .docx with no editable text.
// The DEF-060 fix introduced `createDocxFromDoc(docId, entries)`
// which reuses the engine's `exportText` machinery to pull real
// per-page text and emit editable `w:p` / `w:r` / `w:t` runs — the
// text is selectable and re-editable in Word. Bug 7 reversed that
// preference ("look identical"), so the renderer host preferred
// `createDocxFromImages(entries)` (every page becomes one full-page
// lossless raster — visually identical but the text is painted-in,
// not editable) and demoted `createDocxFromDoc` to the fallback.
// Phase 16 reverses AGAIN: the product decision for Export to Word
// is EDITABLE TEXT FIRST — a .docx whose text you can select and
// edit is the point of Word export, and some layout fidelity loss
// is accepted. The host now prefers `createDocxFromDoc(docId,
// entries)`, and `createDocxFromImages` is the graceful fallback
// for backends that predate the DEF-060 channel or where the text
// pass errors.
//
// The bug (B12 / DEF-106) surfaced when a refactor extracted the
// method into a local then called the local: `const docxFn =
// engineRef.current.createDocxFromDoc; await docxFn(docId, ...)`.
// The engine client's `createDocxFromDoc` reads `this.inner`, and a
// detached call loses the `this` binding (undefined in strict
// mode), so every export threw "Cannot read properties of undefined
// (reading 'inner')". All engine-client invocations remain MEMBER
// calls on the client instance.
//
// We pin the App-level wiring:
//   1. The host's `runAssembleDocx` resolves the active tab's
//      `engineDocId` (not the entry count).
//   2. `engineRef.current.createDocxFromDoc` is called FIRST as a
//      MEMBER call with the docId + entries (Phase 16 — the
//      editable-text path).
//   3. No detached `docxFn(...)` extraction remains anywhere.
//   4. `createDocxFromImages` is the FALLBACK path (called as a
//      MEMBER with the entries when the text channel is missing or
//      fails).
//   5. The dialog's `runAssemble` prop routes through
//      `runAssembleDocx` (not a direct engine call).
//
// We also pin the engine-client / stub-engine contract so a
// future refactor that re-detaches the path fails the test:
//   - `createDocxFromDoc?` exists on `EngineApi`.
//   - The stub engine exposes the optional channel.
//   - The real-engine adapter forwards `createDocxFromDoc(docId,
//     entries)` to the preload IPC.
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
const engineClientPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "engine",
  "engineClient.ts",
);
const stubEnginePath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "engine",
  "stubEngine.ts",
);
const engineTypesPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "engine",
  "types.ts",
);
const appSource = fs.readFileSync(appPath, "utf8");
const engineClientSource = fs.readFileSync(engineClientPath, "utf8");
const stubEngineSource = fs.readFileSync(stubEnginePath, "utf8");
const engineTypesSource = fs.readFileSync(engineTypesPath, "utf8");

describe("B9 / DEF-106 / Bug 7 — DOCX assembly wiring", () => {
  it("runAssembleDocx calls engineRef.current.createDocxFromDoc(docId, entries) FIRST as a MEMBER call", () => {
    const match = appSource.match(
      /const runAssembleDocx = useCallback\([\s\S]*?\},\s*\[\]\);/,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // Phase 16 — the editable-text path (real w:p/w:r/w:t runs from
    // the loaded document's own text) must be the PRIMARY path and
    // must be invoked AS A MEMBER of the engine client (so
    // `this.inner` resolves).
    expect(body).toMatch(/const engine = engineRef\.current\s*;/);
    expect(body).toMatch(/engine\.createDocxFromDoc\(docId, entries\)/);
    // DEF-106 — the detached-extraction pattern must be GONE. The
    // `const docxFn = engineRef.current.createDocxFromDoc; await
    // docxFn(docId, entries)` form loses `this` (the client method
    // reads `this.inner`) and threw "reading 'inner'" on every
    // export (B12). A member call keeps the binding.
    expect(body).not.toMatch(/const docxFn\s*=/);
    expect(body).not.toMatch(/docxFn\(/);
    // The fallback path still routes through createDocxFromImages AS A
    // MEMBER call with the entries (graceful degradation).
    expect(body).toMatch(/engine\.createDocxFromImages\(entries\)/);
    // The doc-text path must precede the image path in the function
    // body so a future refactor that swaps the order (images-first
    // primary, text on failure) — the Bug 7 regression — fails.
    const primaryIdx = body.indexOf("engine.createDocxFromDoc(docId, entries)");
    const fallbackIdx = body.indexOf("engine.createDocxFromImages(entries)");
    expect(primaryIdx).toBeGreaterThan(-1);
    expect(fallbackIdx).toBeGreaterThan(-1);
    expect(primaryIdx).toBeLessThan(fallbackIdx);
  });

  it("runAssembleDocx resolves the active tab's engineDocId (not a stale / hard-coded id)", () => {
    const match = appSource.match(
      /const runAssembleDocx = useCallback\([\s\S]*?\},\s*\[\]\);/,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // The function reads the active id through the ref, then
    // looks up the openTabs entry and pulls the engineDocId.
    expect(body).toMatch(/activeTabIdRefLocal\.current/);
    expect(body).toMatch(/openTabsRef\.current\[activeId\]/);
    expect(body).toMatch(/open\.session\.engineDocId/);
    // The docId is what's passed to the fallback docx call.
    expect(body).toMatch(/const docId = open\.session\.engineDocId/);
  });

  it("the dialog's runAssemble prop is wired to runAssembleDocx (not a direct engine call)", () => {
    // The dialog component is `<DocxExportDialog runAssemble={runAssembleDocx} ... />`.
    // The host must NOT pass `engine.createDocxFromImages.bind(null)` or
    // any detached reference — only the host's runAssembleDocx
    // (which routes to createDocxFromImages first).
    const match = appSource.match(/<DocxExportDialog[\s\S]*?\/>/);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toMatch(/runAssemble=\{runAssembleDocx\}/);
    // Defensive: no direct engine.createDocxFromImages.bind or
    // detached reference passes through the dialog.
    expect(body).not.toMatch(/createDocxFromImages\.bind/);
    expect(body).not.toMatch(/engine\.createDocxFromImages/);
  });

  it("EngineApi declares createDocxFromDoc as an optional channel", () => {
    expect(engineTypesSource).toMatch(
      /createDocxFromDoc\?[\s\S]*?Promise<Result<Uint8Array, EngineError>>/,
    );
  });

  it("the stub engine exposes createDocxFromDoc so the renderer can talk to a no-op backend", () => {
    // The renderer detects `createDocxFromImages` first; a missing
    // method on the stub forces the fallback path even when the real
    // engine has the method — a regression we want to catch. The
    // stub's createDocxFromDoc surface is pinned here for the same
    // reason.
    expect(stubEngineSource).toMatch(/createDocxFromDoc/);
  });

  it("the engine-client adapter forwards createDocxFromDoc(docId, entries) verbatim", () => {
    // The adapter's `createDocxFromDoc` body must thread the
    // docId through to the inner engine's `createDocxFromDoc`
    // method (matching `EngineApi.createDocxFromDoc`). A refactor
    // that drops the docId argument re-introduces the
    // detached-method bug.
    expect(engineClientSource).toMatch(/createDocxFromDoc\(docId, entries\)/);
    // Defensive: the adapter has the missingPhase9Extended
    // fallback so a pre-DEF-060 backend degrades with engine-
    // error (NOT a hard throw), letting the host's runAssembleDocx
    // fall through to createDocxFromDoc gracefully.
    expect(engineClientSource).toMatch(/missingPhase9Extended/);
  });
});