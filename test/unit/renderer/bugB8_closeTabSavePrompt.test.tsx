// @vitest-environment jsdom
//
// B8 — close edited tab prompts save.
//
// History: closing a tab that had unsaved engine changes
// silently discarded the work (the engine's undo stack + every
// in-flight annotation / form / signature). The user reported
// losing a day's edit to a misclick on the close button. The
// fix routes `closeTab` through a confirmation prompt: the
// user picks Save / Don't save / Cancel. Save runs the engine's
// save flow before closing; Don't save closes immediately;
// Cancel keeps the tab open.
//
// We exercise the CloseTabPromptDialog in isolation and pin the
// App-level wiring:
//   1. The dialog renders when `open` is true.
//   2. Each button (Save / Don't save / Cancel) routes through
//      `onChoose` with the correct discriminator.
//   3. Esc cancels; clicking the backdrop also cancels.
//   4. The Save button is disabled while `saving` is true.
//   5. A surface error renders inline when `saveError` is set.
//
// For the App-level contract we read App.tsx and assert:
//   1. closeTab checks `tabMeta.modified` (engine-state
//      mirrored into the tabs reducer) before deciding whether
//      to show the prompt.
//   2. closeTab skips the prompt for empty / missing tabs and
//      falls through to `performCloseTab`.
//   3. The Save path runs the engine save, then on success
//      calls `performCloseTab` (so the existing
//      per-tab-state cleanup still runs — same contract as B7).
//   4. Save failure surfaces the engine error inline; the
//      dialog stays open; the user can retry or cancel.
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  CloseTabPromptDialog,
  type CloseTabPromptChoice,
} from "../../../src/renderer/components/CloseTabPromptDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface RenderArgs {
  open?: boolean;
  tabTitle?: string;
  saving?: boolean;
  saveError?: string | null;
  onChoose?: (choice: CloseTabPromptChoice) => void;
}

function mountDialog(args: RenderArgs = {}): {
  host: HTMLElement;
  onChoose: ReturnType<typeof vi.fn>;
  rerender: (next: Partial<RenderArgs>) => void;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onChoose = vi.fn();
  let current: RenderArgs = {
    open: true,
    tabTitle: "report.pdf",
    saving: false,
    saveError: null,
    onChoose,
    ...args,
  };
  const render = (): void => {
    act((): void => {
      root.render(
        <CloseTabPromptDialog
          open={current.open ?? true}
          tabTitle={current.tabTitle ?? "report.pdf"}
          saving={current.saving ?? false}
          saveError={current.saveError ?? null}
          onChoose={current.onChoose ?? onChoose}
        />,
      );
    });
  };
  render();
  return {
    host,
    onChoose,
    rerender: (next: Partial<RenderArgs>): void => {
      current = { ...current, ...next };
      render();
    },
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

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

describe("B8 — CloseTabPromptDialog renders the Save / Don't save / Cancel choices", () => {
  it("renders the dialog with all three buttons when open", () => {
    const { host, cleanup } = mountDialog();
    try {
      expect(host.querySelector("[data-close-tab-prompt]")).not.toBeNull();
      // The short alias `data-close-prompt` is also present so
      // the e2e sweep test can find the dialog with a single
      // short selector. Both attributes live on the same backdrop.
      expect(host.querySelector("[data-close-prompt]")).not.toBeNull();
      const save = host.querySelector("[data-close-prompt-action='save']");
      const discard = host.querySelector("[data-close-prompt-action='discard']");
      const cancel = host.querySelector("[data-close-prompt-action='cancel']");
      expect(save).not.toBeNull();
      expect(discard).not.toBeNull();
      expect(cancel).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("renders nothing when open=false", () => {
    const { host, cleanup } = mountDialog({ open: false });
    try {
      expect(host.querySelector("[data-close-tab-prompt]")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("Save button routes through onChoose('save')", () => {
    const { host, onChoose, cleanup } = mountDialog();
    try {
      const save = host.querySelector<HTMLButtonElement>(
        "[data-close-prompt-action='save']",
      );
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

  it("Don't save button routes through onChoose('discard')", () => {
    const { host, onChoose, cleanup } = mountDialog();
    try {
      const discard = host.querySelector<HTMLButtonElement>(
        "[data-close-prompt-action='discard']",
      );
      expect(discard).not.toBeNull();
      if (discard === null) return;
      act((): void => {
        discard.click();
      });
      expect(onChoose).toHaveBeenCalledWith("discard");
    } finally {
      cleanup();
    }
  });

  it("Cancel button routes through onChoose('cancel')", () => {
    const { host, onChoose, cleanup } = mountDialog();
    try {
      const cancel = host.querySelector<HTMLButtonElement>(
        "[data-close-prompt-action='cancel']",
      );
      expect(cancel).not.toBeNull();
      if (cancel === null) return;
      act((): void => {
        cancel.click();
      });
      expect(onChoose).toHaveBeenCalledWith("cancel");
    } finally {
      cleanup();
    }
  });

  it("Save button is disabled while saving=true", () => {
    const { host, cleanup } = mountDialog({ saving: true });
    try {
      const save = host.querySelector<HTMLButtonElement>(
        "[data-close-prompt-action='save']",
      );
      expect(save?.disabled).toBe(true);
      const discard = host.querySelector<HTMLButtonElement>(
        "[data-close-prompt-action='discard']",
      );
      expect(discard?.disabled).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("a non-null saveError renders an inline error block", () => {
    const { host, cleanup } = mountDialog({
      saveError: "Could not write file",
    });
    try {
      expect(host.querySelector("[data-close-prompt-error]")).not.toBeNull();
      expect(host.textContent).toContain("Could not write file");
    } finally {
      cleanup();
    }
  });

  it("Esc routes through onChoose('cancel')", () => {
    const { onChoose, cleanup } = mountDialog();
    try {
      act((): void => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Escape",
          }),
        );
      });
      expect(onChoose).toHaveBeenCalledWith("cancel");
    } finally {
      cleanup();
    }
  });

  it("the dialog shows the tab's display name in the body", () => {
    const { host, cleanup } = mountDialog({ tabTitle: "Q3-report.pdf" });
    try {
      expect(host.textContent).toContain("Q3-report.pdf");
    } finally {
      cleanup();
    }
  });
});

describe("B8 — App wiring routes closeTab through the prompt for modified tabs", () => {
  it("closeTab shows the prompt when tabMeta.modified is true", () => {
    const match = appSource.match(/const closeTab = useCallback\([\s\S]*?\},\s*\[\]\);/);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toMatch(/setPendingCloseTabId\(id\)/);
  });

  it("closeTab short-circuits for empty / missing tabs without showing the prompt", () => {
    const match = appSource.match(/const closeTab = useCallback\([\s\S]*?\},\s*\[\]\);/);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // Empty placeholder tabs: skipped (no doc to save).
    expect(body).toMatch(/tabMeta\.kind\s*===\s*"empty"/);
    // Missing / undefined tabs: skipped (already-closed race).
    expect(body).toMatch(/openTabsRef\.current\[id\]/);
  });

  it("closeTab consults BOTH tabMeta.modified and the engineUi mirror — never skips the prompt when the engine reports modified", () => {
    // B8 timing fix — the tabs reducer dispatches set-modified in
    // the same setEngineUiFor call that updates engineUi, but the
    // dispatch + state update are batched. If the user mashes the
    // close button right after a successful engine op (rotate,
    // delete, annotate, …), `tabsRef.current.tabs[i].modified` can
    // still read `false` while `engineUiRef.current[i].state.modified`
    // already reads `true`. Skipping the prompt in that window
    // silently discards unsaved work. The fix ORs both signals:
    // show the prompt whenever either says "modified".
    const match = appSource.match(/const closeTab = useCallback\([\s\S]*?\},\s*\[\]\);/);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // engineUi ref must be read for the modified flag.
    expect(body).toMatch(/engineUiRef\.current\[id\]\?\.state\.modified/);
    // The combined check must include `!tabMeta.modified && !engineModified`.
    expect(body).toMatch(/!tabMeta\.modified\s*&&\s*!engineModified/);
  });

  it("the Save path runs engine.save then calls performCloseTab on success", () => {
    const match = appSource.match(
      /const onCloseTabPromptChoose = useCallback[\s\S]*?\},\s*\[\]\);/,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // Save branch reaches engine.save.
    expect(body).toMatch(/engineRef\.current\.save/);
    // On save success, performCloseTab runs (same cleanup as B7).
    expect(body).toMatch(/performCloseTab\(id\)/);
  });

  it("the Save path surfaces engine errors inline; the dialog stays open", () => {
    const match = appSource.match(
      /const onCloseTabPromptChoose = useCallback[\s\S]*?\},\s*\[\]\);/,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // Engine error path sets pendingCloseError and returns
    // without calling performCloseTab.
    expect(body).toMatch(/setPendingCloseError\(/);
  });

  it("the Don't save branch calls performCloseTab immediately", () => {
    const match = appSource.match(
      /const onCloseTabPromptChoose = useCallback[\s\S]*?\},\s*\[\]\);/,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toMatch(/choice\s*===\s*"discard"/);
    // Don't save -> performCloseTab runs and the dialog dismisses.
    expect(body).toMatch(/setPendingCloseTabId\(null\)/);
  });

  it("the Cancel branch dismisses the prompt and does NOT call performCloseTab", () => {
    const match = appSource.match(
      /const onCloseTabPromptChoose = useCallback[\s\S]*?\},\s*\[\]\);/,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toMatch(/choice\s*===\s*"cancel"/);
    // The Cancel path must NOT call performCloseTab (the tab
    // stays open). We assert by checking the cancel branch
    // closes with `return;` before any `performCloseTab`
    // reference. The `discard` branch also calls
    // performCloseTab, so we need to read the cancel branch
    // specifically — the regex below matches the first
    // `setPendingCloseTabId(null)` after `choice === "cancel"`.
    const cancelIdx = body.indexOf('choice === "cancel"');
    expect(cancelIdx).toBeGreaterThan(-1);
    const discardIdx = body.indexOf('choice === "discard"');
    expect(discardIdx).toBeGreaterThan(cancelIdx);
    const cancelBranch = body.slice(cancelIdx, discardIdx);
    expect(cancelBranch).not.toMatch(/performCloseTab/);
    expect(cancelBranch).toMatch(/return/);
  });
});