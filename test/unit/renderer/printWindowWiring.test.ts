// Phase 35 item 8 - source-wiring guards for the standalone print window.
//
// The renderer half spans three files whose wiring a render test cannot
// cheaply cover: the entry branch in `main.tsx` (it runs at import time),
// App's tab-close notification (inside a 300-line useCallback), and App's
// detach handler (the refusal toast needs the app's toast reducer). These are
// asserted against the source, mirroring the app's other wiring guards.
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

describe("App.tsx - the detach control wiring", () => {
  it("opens the print window through the preload bridge", () => {
    expect(appSource).toMatch(/bridge\.open\(context\)/);
    expect(appSource).toMatch(/window\.tflex\.printWindow/);
  });

  it("surfaces a refusal through the existing error toast", () => {
    const match = appSource.match(
      /const onDetachPrint = useCallback\([\s\S]*?\[pushToast\],\r?\n  \);/,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toMatch(/printWindowOpenFailureMessage\(result\)/);
    expect(body).toMatch(/pushToast\("error", failure\)/);
  });

  it("hands the dialog the active document and the handler", () => {
    expect(appSource).toMatch(/onDetach=\{onDetachPrint\}/);
    expect(appSource).toMatch(/docId: activeTab\.session\.engineDocId/);
    expect(appSource).toMatch(/documentName: activeTab\.displayName/);
  });
});
