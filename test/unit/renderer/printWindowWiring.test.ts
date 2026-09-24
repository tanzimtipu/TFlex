// Phase 35 item 8 / Phase 37 item 17 - source-wiring guards for the standalone
// print window.
//
// The renderer half spans three files whose wiring a render test cannot
// cheaply cover: the entry branch in `main.tsx` (it runs at import time),
// App's tab-close notification (inside a 300-line useCallback), and App's
// print entry points (the refusal toast needs the app's toast reducer). These
// are asserted against the source, mirroring the app's other wiring guards.
//
// Phase 37 item 17: the in-app print modal was removed, so the old "detach
// control wiring" guards became the "print entry-point wiring" guards below -
// the title-bar icon, File > Print and Ctrl+P all call the same
// `openPrintWindow` opener, which builds the active document's
// `PrintWindowContext` directly.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

function readRenderer(...parts: string[]): string {
  return fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "src", "renderer", ...parts),
    "utf8",
  );
}

const mainSource = readRenderer("main.tsx");
const appSource = readRenderer("App.tsx");

describe("main.tsx - the renderer entry branch", () => {
  it("resolves the entry once from the location search", () => {
    expect(mainSource).toMatch(/resolveRendererEntry\(window\.location\.search\)/);
  });

  it("renders the app for the normal entry and the print UI for the print entry", () => {
    expect(mainSource).toMatch(
      /entry\.kind === "app" \? <App \/> : <PrintWindowApp entry=\{entry\} \/>/,
    );
  });

  it("imports the print window from the print-window module", () => {
    expect(mainSource).toMatch(/from "\.\/print-window\/PrintWindowApp"/);
  });

  it("sets document.title for the print entry (DEF-298)", () => {
    expect(mainSource).toMatch(/rendererEntryTitle\(entry\)/);
    expect(mainSource).toMatch(/document\.title = entryTitle/);
  });
});

describe("App.tsx - document-gone wiring on tab close", () => {
  it("performCloseTab tells main the closed document is gone", () => {
    const match = appSource.match(
      /const performCloseTab = useCallback\([\s\S]*?^  \}, \[\]\);/m,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // The notification must use the closing tab's ENGINE doc id (the same id
    // the print window was opened for), not the tab id.
    expect(body).toMatch(
      /notifyDocumentGone\(open\.session\.engineDocId\)/,
    );
    expect(body).toMatch(/window\.tflex\.printWindow\?\./);
  });
});

describe("App.tsx - the print entry-point wiring (Phase 37 item 17)", () => {
  it("opens the standalone print window through the preload bridge", () => {
    expect(appSource).toMatch(/bridge\.open\(context\)/);
    expect(appSource).toMatch(/window\.tflex\.printWindow/);
  });

  it("surfaces a refusal through the existing error toast", () => {
    const match = appSource.match(
      /const openPrintWindow = useCallback\([\s\S]*?\[buildActivePrintContext, pushToast\]\);/,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toMatch(/printWindowOpenFailureMessage\(result\)/);
    expect(body).toMatch(/pushToast\("error", failure\)/);
  });

  it("builds the context from the active document and the default settings", () => {
    const match = appSource.match(
      /const buildActivePrintContext = useCallback\([\s\S]*?^  \}, \[\]\);/m,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toMatch(/docId: tab\.session\.engineDocId/);
    expect(body).toMatch(/documentName: tab\.displayName/);
    expect(body).toMatch(/pageCount: tab\.session\.doc\.numPages/);
    expect(body).toMatch(/settings: defaultPrintSettings\(\)/);
  });

  it("routes all three entry points at the same opener and mounts no modal", () => {
    // Title-bar Print icon.
    expect(appSource).toMatch(/onPrint=\{openPrintWindow\}/);
    // File > Print / Ctrl+P arrive on the main-process `print:request` channel.
    const sub = appSource.match(
      /window\.tflex\.onPrintRequest\(\(\) => \{[\s\S]*?\}\);/,
    );
    expect(sub).not.toBeNull();
    expect(sub?.[0]).toMatch(/openPrintWindowRef\.current\(\)/);
    // The in-app modal and its component are gone.
    expect(appSource).not.toMatch(/<PrintDialog/);
    expect(appSource).not.toMatch(/components\/PrintDialog/);
  });
});
