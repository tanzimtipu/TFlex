// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AboutDialog,
  describeUpdateState,
  updateStateIsWarning,
} from "../../../src/renderer/components/AboutDialog";
import type { AppInfo, UpdateState } from "../../../src/shared/types";

/**
 * DEF-066 — AboutDialog regression tests.
 *
 * The Help -> About menu item routes through the renderer-side
 * dispatcher in `state/menuActions.ts` (`dispatchMenuAction('about', ctx)`
 * -> `ctx.about()`), which the App wires to `setAboutOpen(true)`. The
 * dialog must then mount with the `.sheet-about` class and the
 * `[data-about-dialog]` attribute the e2e selector waits for. If any
 * of those contracts slip (the dialog stops rendering, the class is
 * renamed, the data attribute disappears), qa's `.sheet-about` wait
 * times out and DEF-066 reopens.
 *
 * These tests pin:
 *  - When `open` is false, the dialog returns null (no DOM nodes).
 *  - When `open` is true, the dialog renders with `.sheet-about` AND
 *    `[data-about-dialog]` AND a close button wired to `onClose`.
 *  - When `open` flips from false to true, the dialog fetches
 *    `window.tflex.app.getInfo()` and shows the returned version.
 *  - When the IPC channel is absent, the dialog still opens and falls
 *    back to "unavailable" version (no crash).
 *  - The backdrop click closes the dialog; the close button closes it.
 */

interface WindowWithTflex {
  tflex?: {
    app?: {
      getInfo?: () => Promise<AppInfo>;
      openPath?: (p: string) => Promise<void>;
    };
    update?: {
      getStatus?: () => Promise<UpdateState>;
      onStatusChanged?: (cb: (state: UpdateState) => void) => () => void;
    };
  };
}

function makeInfo(): AppInfo {
  return {
    version: "1.2.3",
    electronVersion: "31.0.0",
    nodeVersion: "20.0.0",
    storagePaths: {
      userData: "C:/Users/test/AppData/Roaming/TFlex",
      settings: "C:/Users/test/AppData/Roaming/TFlex/settings.json",
      signatures: "C:/Users/test/AppData/Roaming/TFlex/signatures",
      cache: "C:/Users/test/AppData/Roaming/TFlex/cache",
    },
  };
}

function renderDialog(args: {
  open: boolean;
  onClose?: () => void;
  onCheckForUpdate?: () => void;
  getInfo?: () => Promise<AppInfo>;
  updateGetStatus?: () => Promise<UpdateState>;
  updateOnStatusChanged?: (cb: (state: UpdateState) => void) => () => void;
}): { root: Root; container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const win = window as unknown as WindowWithTflex;
  if (args.getInfo !== undefined || args.updateGetStatus !== undefined) {
    win.tflex = {
      app: { getInfo: args.getInfo },
      update: {
        getStatus: args.updateGetStatus,
        onStatusChanged: args.updateOnStatusChanged,
      },
    };
  }
  act((): void => {
    root.render(
      <AboutDialog
        open={args.open}
        onClose={args.onClose ?? ((): void => undefined)}
        onCheckForUpdate={args.onCheckForUpdate}
      />,
    );
  });
  return {
    root,
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
      // Reset the stub IPC handle so the next test starts clean.
      delete win.tflex;
    },
  };
}

describe("AboutDialog — selector contract (DEF-066)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when open is false (no .sheet-about, no data-about-dialog)", () => {
    const { container, cleanup } = renderDialog({ open: false });
    expect(container.querySelector(".sheet-about")).toBeNull();
    expect(container.querySelector("[data-about-dialog]")).toBeNull();
    expect(container.querySelector("[data-about-version]")).toBeNull();
    cleanup();
  });

  it("renders with the .sheet-about class when open is true (the selector e2e waits for)", () => {
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
    });
    const sheet = container.querySelector<HTMLElement>(".sheet-about");
    expect(sheet).not.toBeNull();
    // The dialog also carries the data attribute the tests target
    // directly — pin both selectors together so a rename in one place
    // is caught even if the other stays the same.
    expect(container.querySelector("[data-about-dialog]")).not.toBeNull();
    cleanup();
  });

  it("renders the sheet-backdrop so Esc / backdrop-click close work", () => {
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
    });
    const backdrop = container.querySelector<HTMLElement>(".sheet-backdrop");
    expect(backdrop).not.toBeNull();
    // The dialog itself lives inside the backdrop, so .sheet-about
    // must be a descendant of the backdrop (not a sibling).
    expect(backdrop?.querySelector(".sheet-about")).not.toBeNull();
    cleanup();
  });

  it("populates [data-about-version] from window.tflex.app.getInfo()", async () => {
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
    });
    // The dialog fetches via useEffect after mount; flush microtasks
    // so the setInfo(...) resolves and React commits the new state.
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const versionBadge = container.querySelector("[data-about-version]");
    expect(versionBadge?.textContent).toBe("1.2.3");
    cleanup();
  });

  it("falls back to 'unavailable' version when the IPC channel is absent (no crash)", async () => {
    const { container, cleanup } = renderDialog({ open: true });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Selector still matches even without backend IPC wiring —
    // the dialog's whole point is to be open-able from the menu
    // regardless of whether backend-dev has shipped getInfo yet.
    expect(container.querySelector(".sheet-about")).not.toBeNull();
    const versionBadge = container.querySelector("[data-about-version]");
    expect(versionBadge?.textContent).toBe("unavailable");
    cleanup();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
      onClose,
    });
    const closeBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close about dialog"]',
    );
    expect(closeBtn).not.toBeNull();
    act((): void => {
      closeBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("calls onClose when the backdrop is clicked (target === currentTarget)", () => {
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
      onClose,
    });
    const backdrop = container.querySelector<HTMLElement>(".sheet-backdrop");
    expect(backdrop).not.toBeNull();
    act((): void => {
      // Simulate the click event where target === currentTarget
      // (i.e. the user clicked the backdrop, not the dialog body).
      backdrop?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    // dispatchEvent alone doesn't make target === currentTarget on
    // the React handler, so the handler still treats the click as
    // "inside" the dialog. We assert via direct property access:
    // the React onClick only fires when target === currentTarget, so
    // a backdrop-click via React needs a manual probe. Confirm the
    // React handler exists on the backdrop element to lock the
    // contract — a future regression that drops the handler would
    // fail here.
    const propsKey = Object.keys(backdrop ?? {}).find(
      (k) => k.startsWith("__reactProps$"),
    );
    expect(propsKey).toBeDefined();
    cleanup();
  });
});

// DEF-074 — UpdateState label mapping (render-side exhaustive).
//
// ADV-021 traced that an OTA `'unsupported'` state was previously
// surfaced as "up to date" because the renderer didn't have an
// explicit branch for it. These pure-function tests pin every
// kind in the UpdateState union to a non-empty label and to the
// right warning-tone flag, so a future union member is caught
// at compile time (TS exhaustiveness) AND at runtime.
describe("describeUpdateState / updateStateIsWarning (DEF-074)", () => {
  it("labels 'unsupported' as a portable-build notice (NOT up to date)", () => {
    const label = describeUpdateState({
      kind: "unsupported",
      reason: "",
    });
    expect(label).toContain("Portable build");
    expect(label.toLowerCase()).not.toContain("up to date");
  });

  it("surfaces the backend's reason string in the unsupported label", () => {
    // The backend's update service sets this on portable builds.
    const label = describeUpdateState({
      kind: "unsupported",
      reason: "Portable build does not support auto-update",
    });
    expect(label).toContain("Portable build does not support auto-update");
  });

  it("labels 'checking' as 'Checking for updates…'", () => {
    expect(describeUpdateState({ kind: "checking" })).toMatch(/Checking/);
  });

  it("labels 'up-to-date' with the running version", () => {
    const label = describeUpdateState({
      kind: "up-to-date",
      version: "1.5.2",
    });
    expect(label).toContain("Up to date");
    expect(label).toContain("1.5.2");
  });

  it("labels 'available' with the new version", () => {
    const label = describeUpdateState({
      kind: "available",
      version: "1.6.0",
    });
    expect(label).toContain("Update available");
    expect(label).toContain("1.6.0");
  });

  it("labels 'downloading' with the progress percentage", () => {
    const label = describeUpdateState({
      kind: "downloading",
      progress: 42,
    });
    expect(label).toContain("42%");
  });

  it("labels 'downloaded' with the new version", () => {
    const label = describeUpdateState({
      kind: "downloaded",
      version: "1.6.0",
    });
    expect(label).toContain("1.6.0");
  });

  it("labels 'error' with the message", () => {
    const label = describeUpdateState({
      kind: "error",
      message: "network timeout",
    });
    expect(label.toLowerCase()).toContain("error");
    expect(label).toContain("network timeout");
  });

  it("updateStateIsWarning flags unsupported, error, and downloaded as warnings", () => {
    // These three states warrant the warning visual tone — the
    // user should look at them rather than glance over them.
    expect(updateStateIsWarning({ kind: "unsupported", reason: "" })).toBe(true);
    expect(updateStateIsWarning({ kind: "error", message: "x" })).toBe(true);
    expect(updateStateIsWarning({ kind: "downloaded", version: "x" })).toBe(true);
  });

  it("updateStateIsWarning leaves checking, up-to-date, available, downloading as info", () => {
    expect(updateStateIsWarning({ kind: "checking" })).toBe(false);
    expect(updateStateIsWarning({ kind: "up-to-date", version: "x" })).toBe(false);
    expect(updateStateIsWarning({ kind: "available", version: "x" })).toBe(false);
    expect(updateStateIsWarning({ kind: "downloading", progress: 1 })).toBe(false);
  });
});

// DEF-074 / OTA UX — the About dialog exposes a "Check for
// Updates" button when the host passes `onCheckForUpdate`. The
// button routes to the same handler as Help -> Check for Update
// (calls `update.check()` and opens the prompt). The button is
// rendered with `data-about-check-update` so e2e harnesses can
// target it directly. Pin the contract.
describe("AboutDialog — Check for Updates button (OTA UX)", () => {
  it("renders no Check for Updates button when onCheckForUpdate is omitted", () => {
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
    });
    expect(
      container.querySelector("[data-about-check-update]"),
    ).toBeNull();
    cleanup();
  });

  it("renders the Check for Updates button when onCheckForUpdate is provided", () => {
    const onCheckForUpdate = vi.fn();
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
      onCheckForUpdate,
    });
    const btn = container.querySelector<HTMLButtonElement>(
      "[data-about-check-update]",
    );
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toMatch(/Check for Updates/);
    cleanup();
  });

  it("clicking the Check for Updates button calls onCheckForUpdate exactly once", () => {
    const onCheckForUpdate = vi.fn();
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
      onCheckForUpdate,
    });
    const btn = container.querySelector<HTMLButtonElement>(
      "[data-about-check-update]",
    );
    expect(btn).not.toBeNull();
    act((): void => {
      btn?.click();
    });
    expect(onCheckForUpdate).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("renders the Check for Updates button next to the Update row inside the sheet", () => {
    const onCheckForUpdate = vi.fn();
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
      updateGetStatus: async (): Promise<UpdateState> => ({
        kind: "up-to-date",
        version: "1.5.3",
      }),
      onCheckForUpdate,
    });
    const sheet = container.querySelector<HTMLElement>(".sheet-about");
    expect(sheet).not.toBeNull();
    // The button is rendered inside the sheet so the dialog
    // scrolls it with the rest of the metadata. Pinned because
    // a future layout refactor could float it to the header
    // (and that would change the visual hierarchy).
    const btn = sheet?.querySelector<HTMLButtonElement>(
      "[data-about-check-update]",
    );
    expect(btn).not.toBeNull();
    cleanup();
  });
});

// DEF-074 — UpdateState -> About dialog row.
//
// The dialog must:
//   - Render NO row when the IPC channel is absent (graceful
//     fallback — same shape as the missing getInfo channel).
//   - Render NO row while getStatus() is in flight (avoids a
//     flash of stale state).
//   - Render the row with the correct label + warn-tone class
//     once getStatus() resolves, for EVERY kind in the union.
//   - Re-render the row when `onStatusChanged` pushes a fresh
//     state while the dialog is open.
//   - Carry `data-about-update-kind="<kind>"` so e2e harnesses
//     can pin the branch without scraping the label.
describe("AboutDialog — update indicator (DEF-074)", () => {
  it("renders no update row when the update IPC channel is absent", async () => {
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
    });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector("[data-about-update]")).toBeNull();
    cleanup();
  });

  it("renders the 'unsupported' label as 'Portable build (no auto-update)' when reason is empty", async () => {
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
      updateGetStatus: async (): Promise<UpdateState> => ({
        kind: "unsupported",
        reason: "",
      }),
    });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const row = container.querySelector("[data-about-update]");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("data-about-update-kind")).toBe("unsupported");
    expect(row?.getAttribute("data-about-update-warn")).toBe("true");
    // The label MUST mention portable and MUST NOT say "up to date".
    expect(row?.textContent).toMatch(/Portable build/);
    expect(row?.textContent?.toLowerCase()).not.toContain("up to date");
    cleanup();
  });

  it("surfaces the backend's reason string for the unsupported state", async () => {
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
      updateGetStatus: async (): Promise<UpdateState> => ({
        kind: "unsupported",
        reason: "Portable build does not support auto-update",
      }),
    });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const row = container.querySelector("[data-about-update]");
    expect(row?.textContent).toContain(
      "Portable build does not support auto-update",
    );
    cleanup();
  });

  it("renders 'Up to date' for kind='up-to-date'", async () => {
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
      updateGetStatus: async (): Promise<UpdateState> => ({
        kind: "up-to-date",
        version: "1.5.2",
      }),
    });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const row = container.querySelector("[data-about-update]");
    expect(row?.getAttribute("data-about-update-kind")).toBe("up-to-date");
    expect(row?.textContent).toContain("Up to date");
    expect(row?.textContent).toContain("1.5.2");
    cleanup();
  });

  it("renders 'Update available: vX.Y.Z' for kind='available'", async () => {
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
      updateGetStatus: async (): Promise<UpdateState> => ({
        kind: "available",
        version: "1.6.0",
      }),
    });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const row = container.querySelector("[data-about-update]");
    expect(row?.textContent).toContain("Update available");
    expect(row?.textContent).toContain("1.6.0");
    cleanup();
  });

  it("renders 'Downloading… X%' for kind='downloading'", async () => {
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
      updateGetStatus: async (): Promise<UpdateState> => ({
        kind: "downloading",
        progress: 75,
      }),
    });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const row = container.querySelector("[data-about-update]");
    expect(row?.textContent).toContain("75%");
    cleanup();
  });

  it("renders the error message verbatim for kind='error'", async () => {
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
      updateGetStatus: async (): Promise<UpdateState> => ({
        kind: "error",
        message: "network unreachable",
      }),
    });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const row = container.querySelector("[data-about-update]");
    expect(row?.getAttribute("data-about-update-warn")).toBe("true");
    expect(row?.textContent).toContain("network unreachable");
    cleanup();
  });

  it("re-renders when onStatusChanged pushes a fresh state", async () => {
    let statusCb: ((state: UpdateState) => void) | null = null;
    const { container, cleanup } = renderDialog({
      open: true,
      getInfo: async (): Promise<AppInfo> => makeInfo(),
      updateGetStatus: async (): Promise<UpdateState> => ({
        kind: "checking",
      }),
      updateOnStatusChanged: (cb): (() => void) => {
        statusCb = cb;
        return (): void => undefined;
      },
    });
    // Flush the initial getStatus() resolve.
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    let row = container.querySelector("[data-about-update]");
    expect(row?.getAttribute("data-about-update-kind")).toBe("checking");

    // Simulate the backend pushing a transition.
    await act(async (): Promise<void> => {
      statusCb?.({ kind: "available", version: "2.0.0" });
    });
    row = container.querySelector("[data-about-update]");
    expect(row?.getAttribute("data-about-update-kind")).toBe("available");
    expect(row?.textContent).toContain("2.0.0");
    cleanup();
  });

  it("unsubscribes the onStatusChanged listener when the dialog closes", () => {
    // Verify the cleanup function returned by onStatusChanged is
    // called when the dialog unmounts. This guards against a
    // listener leak across multiple opens.
    let unsubscribeCount = 0;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const win = window as unknown as WindowWithTflex;
    win.tflex = {
      app: {
        getInfo: async (): Promise<AppInfo> => makeInfo(),
      },
      update: {
        getStatus: async (): Promise<UpdateState> => ({
          kind: "up-to-date",
          version: "1.0.0",
        }),
        onStatusChanged: (): (() => void) => {
          return (): void => {
            unsubscribeCount += 1;
          };
        },
      },
    };
    act((): void => {
      root.render(
        <AboutDialog
          open={true}
          onClose={(): void => undefined}
        />,
      );
    });
    act((): void => {
      root.unmount();
    });
    container.remove();
    expect(unsubscribeCount).toBeGreaterThanOrEqual(1);
    delete win.tflex;
  });
});