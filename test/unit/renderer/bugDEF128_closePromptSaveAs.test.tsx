// @vitest-environment jsdom
//
// DEF-128 — closing a tab that has unsaved changes but NO on-disk
// path (a bytes-loaded / sample tab) hard-blocked the Save choice:
// onCloseTabPromptChoose threw an inline "no on-disk path" error
// and the tab could never be saved-and-closed. The fix routes the
// Save choice through the engine's Save-As flow (which pops the OS
// save dialog) and only closes the tab after a successful Save-As;
// a user cancel or a write failure keeps the tab open so the user
// can retry or discard.
//
// We pin:
//   1. The dialog's Save button reads "Save As…" when the tab has
//      no on-disk path (saveAsMode).
//   2. App wiring scans (the established source-scan pattern):
//      the onDiskPath === null branch calls engineRef.current.saveAs
//      (not save), surfaces "cancelled" without closing, and only
//      calls performCloseTab after a successful save-as.
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  CloseTabPromptDialog,
  type CloseTabPromptChoice,
} from "../../../src/renderer/components/CloseTabPromptDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(args: {
  open?: boolean;
  saveAsMode?: boolean;
  onChoose?: (choice: CloseTabPromptChoice) => void;
}): { host: HTMLElement; onChoose: ReturnType<typeof vi.fn>; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onChoose = vi.fn(args.onChoose ?? ((): void => undefined));
  act((): void => {
    root.render(
      <CloseTabPromptDialog
        open={args.open ?? true}
        tabTitle="sample.pdf"
        saving={false}
        saveError={null}
        saveAsMode={args.saveAsMode ?? false}
        onChoose={onChoose}
      />,
    );
  });
  return {
    host,
    onChoose,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

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

describe("DEF-128 — dialog offers Save As for path-less tabs", () => {
  it("the Save button is labelled 'Save As…' when saveAsMode is true", () => {
    const { host, cleanup } = mount({ saveAsMode: true });
    try {
      const save = host.querySelector<HTMLButtonElement>("[data-close-prompt-action='save']");
      expect(save).not.toBeNull();
      expect(save?.textContent).toBe("Save As…");
    } finally {
      cleanup();
    }
  });

  it("the Save button keeps its normal label when the tab has an on-disk path", () => {
    const { host, cleanup } = mount({ saveAsMode: false });
    try {
      const save = host.querySelector<HTMLButtonElement>("[data-close-prompt-action='save']");
      expect(save?.textContent).toBe("Save");
    } finally {
      cleanup();
    }
  });

  it("Save As still routes through onChoose('save') so the host runs the save-as flow", () => {
    const { host, onChoose, cleanup } = mount({ saveAsMode: true });
    try {
      const save = host.querySelector<HTMLButtonElement>("[data-close-prompt-action='save']");
      expect(save).not.toBeNull();
      if (save === null) return;
      act((): void => {
        save.click();
      });
      expect(onChoose).toHaveBeenCalledWith("save");
    } finally {
      cleanup();
    }
  });
});

describe("DEF-128 — App wiring: the path-less Save branch routes through Save-As, never hard-blocks", () => {
  function handlerBody(): string {
    const match = appSource.match(
      /const onCloseTabPromptChoose = useCallback[\s\S]*?\},\s*\[\]\);/,
    );
    expect(match).not.toBeNull();
    return match === null ? "" : match[0];
  }

  it("the onDiskPath === null branch calls engineRef.current.saveAs (the Save-As flow)", () => {
    const body = handlerBody();
    const nullPathIdx = body.indexOf("tab.session.onDiskPath === null");
    expect(nullPathIdx).toBeGreaterThan(-1);
    const branch = body.slice(nullPathIdx);
    expect(branch).toMatch(/engineRef\.current\.saveAs\(/);
    // It must NOT be the in-place save path (saveAs, not save).
    expect(branch).not.toMatch(/engineRef\.current\.save\((?![A-Za-z])/);
  });

  it("the old 'no on-disk path' hard-block error is gone", () => {
    const body = handlerBody();
    // The old inline error's exact phrasing is gone.
    expect(body).not.toContain("Use Don't save to discard, or open Save As first");
  });

  it("a user-cancelled OS dialog keeps the tab open (no performCloseTab before the save resolves)", () => {
    const body = handlerBody();
    const nullPathIdx = body.indexOf("tab.session.onDiskPath === null");
    const branch = body.slice(nullPathIdx);
    const cancelledIdx = branch.indexOf('saved.error.code === "cancelled"');
    expect(cancelledIdx).toBeGreaterThan(-1);
    // Between the cancel branch and the success bookkeeping there
    // must be a return (no close), then the successful save-as
    // leads to performCloseTab.
    const cancelToClose = branch.slice(cancelledIdx, branch.indexOf("performCloseTab(id)"));
    expect(cancelToClose).toMatch(/return;/);
  });

  it("the tab only closes after a successful save-as (performCloseTab follows the ok branch)", () => {
    const body = handlerBody();
    const nullPathIdx = body.indexOf("tab.session.onDiskPath === null");
    const branch = body.slice(nullPathIdx);
    const performIdx = branch.indexOf("performCloseTab(id)");
    expect(performIdx).toBeGreaterThan(-1);
    const prefix = branch.slice(0, performIdx);
    // The engine's Save-As must run and report ok before the close
    // is allowed.
    expect(prefix).toMatch(/engineRef\.current\.saveAs\(/);
    expect(prefix).toMatch(/!saved\.ok/);
  });
});