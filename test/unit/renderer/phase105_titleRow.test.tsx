// @vitest-environment jsdom
// Phase 105 (chunk C) — the structured title row + document rail.
//
// Pins the chunk-C layout contract:
//   - ONE 48px title row (the `.titlebar` / `.app-header` surfaces) with the
//     brand, the File trigger, the Open / Save / Save-a-copy controls, the
//     genuine drag region, Search tools, Print, the update/account slots and
//     the reserved caption controls;
//   - a separate 40px document rail (`.document-rail`) below it holding the
//     tab strip (`.tab-area` / `[data-tab-id]` / `[data-new-tab]`).
//
// Phase 127 retired the `[data-app-menu]` trigger the chunk-C work introduced;
// the assertion below pins its absence alongside the restored controls.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TitleBar, type MenuGroup } from "../../../src/renderer/components/TitleBar";
import { AppHeader } from "../../../src/renderer/components/AppHeader";
import { DocumentRail } from "../../../src/renderer/components/DocumentRail";
import type { MenuActionContext } from "../../../src/renderer/state/menuActions";

function noop(): void {
  return undefined;
}

function noopContext(): MenuActionContext {
  return {
    open: noop,
    merge: noop,
    save: noop,
    saveAs: noop,
    closeTab: noop,
    undo: noop,
    redo: noop,
    toggleTheme: noop,
    showToolsPalette: noop,
    about: noop,
    preferences: noop,
    optimize: noop,
    auditSpace: noop,
    createFromImages: noop,
    exportPages: noop,
    exportText: noop,
    exportDocx: noop,
    insertPages: noop,
    recognizeText: noop,
    checkForUpdate: noop,
  };
}

const FILE_GROUPS: MenuGroup[] = [
  {
    id: "file",
    label: "File",
    entries: [
      { id: "open", label: "Open...", accelerator: "Ctrl+O", action: "open" },
      { id: "save", label: "Save", accelerator: "Ctrl+S", action: "save" },
    ],
  },
];

interface TflexStub {
  minimizeWindow: ReturnType<typeof vi.fn>;
  maximizeWindow: ReturnType<typeof vi.fn>;
  closeWindow: ReturnType<typeof vi.fn>;
}

function installTflex(): TflexStub {
  const stub: TflexStub = {
    minimizeWindow: vi.fn(),
    maximizeWindow: vi.fn(),
    closeWindow: vi.fn(),
  };
  (window as unknown as { tflex: TflexStub }).tflex = stub;
  return stub;
}

function renderChrome(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <>
        <TitleBar menuGroups={FILE_GROUPS} menuContext={noopContext()} maximized={false}>
          <AppHeader
            activeId="a"
            onOpenFile={noop}
            onSave={noop}
            onSaveAs={noop}
            onPrint={noop}
            onOpenToolSearch={noop}
            onOpenFind={noop}
            findEnabled
            onOpenPreferences={noop}
            onThemeChange={noop}
            updateIndicator={<span data-update-indicator />}
            accountSlot={<span data-test-account-slot />}
          />
        </TitleBar>
        <DocumentRail
          activeId="a"
          tabs={[{ id: "a", title: "a.pdf", modified: false }]}
          onActivate={noop}
          onClose={noop}
          onNewEmptyTab={noop}
        />
      </>,
    );
  });
  return container;
}

describe("Phase 105 chunk C — structured title row", () => {
  it("renders the title row and the separate document-rail row", () => {
    installTflex();
    const container = renderChrome();
    const bar = container.querySelector<HTMLElement>("[data-titlebar]");
    expect(bar).not.toBeNull();
    expect(bar?.classList.contains("titlebar")).toBe(true);
    // The rail is a SEPARATE row below the title bar.
    const rail = container.querySelector<HTMLElement>("[data-document-rail]");
    expect(rail).not.toBeNull();
    expect(rail?.classList.contains("document-rail")).toBe(true);
    expect(bar?.contains(rail as Node)).toBe(false);
    (window as unknown as { tflex?: unknown }).tflex = undefined;
  });

  it("keeps the File trigger, the file actions, Search tools, Print and the caption controls", () => {
    const stub = installTflex();
    const container = renderChrome();
    expect(container.querySelector("[data-menu-button]")).not.toBeNull();
    expect(container.querySelector("[data-toolbar-open]")).not.toBeNull();
    expect(container.querySelector("[data-toolbar-save]")).not.toBeNull();
    expect(container.querySelector("[data-toolbar-save-as]")).not.toBeNull();
    expect(container.querySelector("[data-header-tool-search]")).not.toBeNull();
    expect(container.querySelector("[data-print]")).not.toBeNull();
    expect(container.querySelector("[data-window-minimize]")).not.toBeNull();
    expect(container.querySelector("[data-window-maximize]")).not.toBeNull();
    expect(container.querySelector("[data-window-close]")).not.toBeNull();
    act((): void => {
      container.querySelector<HTMLButtonElement>("[data-window-minimize]")?.click();
    });
    expect(stub.minimizeWindow).toHaveBeenCalledTimes(1);
    (window as unknown as { tflex?: unknown }).tflex = undefined;
  });

  it("keeps a genuine drag region in the title row", () => {
    installTflex();
    const container = renderChrome();
    expect(container.querySelector(".titlebar-drag")).not.toBeNull();
    (window as unknown as { tflex?: unknown }).tflex = undefined;
  });

  it("renders the document rail's tab strip and New-tab affordance", () => {
    installTflex();
    const container = renderChrome();
    expect(container.querySelector(".document-rail .tab-area")).not.toBeNull();
    expect(container.querySelector("[data-tab-id='a']")).not.toBeNull();
    expect(container.querySelector("[data-new-tab]")).not.toBeNull();
    (window as unknown as { tflex?: unknown }).tflex = undefined;
  });
});

describe("Phase 127 — the application-menu trigger is retired", () => {
  it("does not render [data-app-menu] or [data-app-menu-popover]", () => {
    installTflex();
    const container = renderChrome();
    expect(container.querySelector("[data-app-menu]")).toBeNull();
    expect(container.querySelector("[data-app-menu-popover]")).toBeNull();
    expect(container.querySelector(".app-menu")).toBeNull();
    (window as unknown as { tflex?: unknown }).tflex = undefined;
  });
});

describe("Phase 105 chunk C — chrome geometry (CSS source)", () => {
  it("declares a 48px title row and a 40px document rail", () => {
    const sheet = readFileSync("src/renderer/styles.css", "utf8");
    expect(sheet).toContain("--chrome-titlebar-h: 48px");
    expect(sheet).toContain(".document-rail {");
    const railAt = sheet.indexOf(".document-rail {");
    expect(sheet.slice(railAt, sheet.indexOf("}", railAt))).toContain("height: 40px");
  });

  it("gives the shell three rows: title, rail, workspace", () => {
    const sheet = readFileSync("src/renderer/styles.css", "utf8");
    const appAt = sheet.indexOf(".app {");
    expect(appAt).toBeGreaterThan(-1);
    expect(sheet.slice(appAt, sheet.indexOf("}", appAt))).toContain("grid-template-rows: auto auto 1fr");
  });
});
