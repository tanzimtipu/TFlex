// @vitest-environment jsdom
//
// B9 — DOCX assembly must call engine.createDocxFromDoc(docId,
// entries) directly, not via the older detached createDocxFromImages
// path.
//
// History: the original DOCX flow used `createDocxFromImages(entries)`
// exclusively — a one-image-per-page .docx with no editable
// text. The DEF-060 fix introduced `createDocxFromDoc(docId,
// entries)` which reuses the engine's `exportText` machinery to
// pull real per-page text from the pdfDoc and emits editable
// `w:p` / `w:r` / `w:t` runs for text-bearing pages; text-free
// pages fall back to an inline image. The renderer host must
// route through `createDocxFromDoc(docId, entries)` for the
// loaded-doc flow so the result has editable text.
//
// The bug surfaced when a refactor accidentally re-introduced
// the detached path: the host called `createDocxFromImages`
// first and only fell back to `createDocxFromDoc` when the
// fallback failed. The user got an image-only DOCX with no
// editable text — exactly the bug we want to prevent.
//
// We pin the App-level wiring:
//   1. The host's `runAssembleDocx` resolves the active tab's
//      `engineDocId` (not the entry count).
//   2. `engineRef.current.createDocxFromDoc` is called FIRST
//      with the docId.
//   3. `createDocxFromImages` is only the FALLBACK path (when
//      `createDocxFromDoc` is undefined or returns engine-error).
//   4. The dialog's `runAssemble` prop routes through
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

describe("B9 — DOCX assembly is wired through createDocxFromDoc, not detached", () => {
  it("runAssembleDocx calls engineRef.current.createDocxFromDoc(docId, entries) FIRST", () => {
    const match = appSource.match(
      /const runAssembleDocx = useCallback\([\s\S]*?\},\s*\[\]\);/,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // The body must reference createDocxFromDoc with the docId
    // argument (not detached) and createDocxFromImages only as
    // a fallback (when createDocxFromDoc is undefined).
    expect(body).toMatch(/engineRef\.current\.createDocxFromDoc/);
    expect(body).toMatch(/docxFn\(docId, entries\)/);
    expect(body).toMatch(/engineRef\.current\.createDocxFromImages\(entries\)/);
    // The text-first path must precede the fallback path in the
    // function body so a future refactor that swaps the order
    // (fallback first, primary on failure) fails this test.
    const primaryIdx = body.indexOf("docxFn(docId, entries)");
    const fallbackIdx = body.indexOf(
      "engineRef.current.createDocxFromImages(entries)",
    );
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
    // The docId is what's passed to docxFn.
    expect(body).toMatch(/const docId = open\.session\.engineDocId/);
  });

  it("the dialog's runAssemble prop is wired to runAssembleDocx (not a direct engine call)", () => {
    // The dialog component is `<DocxExportDialog runAssemble={runAssembleDocx} ... />`.
    // The host must NOT pass `engine.createDocxFromImages.bind(null)` or
    // any detached reference — only the host's runAssembleDocx
    // (which routes to createDocxFromDoc first).
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
    // The renderer always reads `engine.createDocxFromDoc` first;
    // a missing method on the stub forces the fallback path even
    // when the real engine has the method — a regression we want
    // to catch.
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
    // fall through to createDocxFromImages gracefully.
    expect(engineClientSource).toMatch(/missingPhase9Extended/);
  });
});