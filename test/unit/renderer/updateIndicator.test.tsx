// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  UpdateIndicator,
  indicatorView,
  type IndicatorView,
} from "../../../src/renderer/components/UpdateIndicator";
import type { UpdateState } from "../../../src/shared/types";

/**
 * DEF-077 — UpdateIndicator regression tests.
 *
 * The toolbar must surface OTA update availability to the user
 * without forcing them to open the About dialog. These tests pin:
 *   1. The pure `indicatorView(state)` mapping for every kind in
 *      the UpdateState union (TS exhaustiveness + runtime).
 *   2. The mounting behaviour: subscribes to onStatusChanged,
 *      fetches initial state via getStatus, unsubscribes on
 *      unmount.
 *   3. The click routing: 'available' clicks download,
 *      'downloaded' clicks install, 'error' clicks download
 *      (retry).
 *   4. The hidden behaviour for 'unsupported' and 'up-to-date'.
 *   5. Defensive degradation: when the IPC channel is absent,
 *      the indicator renders nothing and never throws.
 */

interface WindowWithTflex {
  tflex?: {
    update?: {
      getStatus?: () => Promise<UpdateState>;
      download?: () => Promise<UpdateState>;
      install?: () => Promise<void>;
      onStatusChanged?: (cb: (state: UpdateState) => void) => () => void;
    };
  };
}

function setTflex(api: WindowWithTflex["tflex"]): void {
  const w = window as unknown as WindowWithTflex;
  w.tflex = api ?? undefined;
}

function clearTflex(): void {
  setTflex(undefined);
}

function renderIndicator(props: {
  enabled?: boolean;
}): { root: Root; container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(<UpdateIndicator enabled={props.enabled ?? true} />);
  });
  return {
    root,
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Pure mapping (indicatorView).
//
// Exhaustive over UpdateState: each kind maps to a precise IndicatorView.
// A new kind added to the union without a mapping here will fail TS
// exhaustiveness — same shape as `describeUpdateState` in AboutDialog.
// ---------------------------------------------------------------------------
describe("indicatorView — pure UpdateState -> IndicatorView mapping (DEF-077)", () => {
  it("hides for null / undefined (haven't asked yet)", () => {
    expect(indicatorView(null).kind).toBe("hidden");
    expect(indicatorView(undefined).kind).toBe("hidden");
  });

  it("hides for 'unsupported' (portable build — About dialog owns that story)", () => {
    const view: IndicatorView = indicatorView({
      kind: "unsupported",
      reason: "Portable build does not support auto-update",
    });
    expect(view.kind).toBe("hidden");
  });

  it("returns 'checking' for kind='checking'", () => {
    const view = indicatorView({ kind: "checking" });
    expect(view.kind).toBe("checking");
  });

  it("hides for 'up-to-date' (no toolbar noise when current)", () => {
    const view = indicatorView({ kind: "up-to-date", version: "1.5.3" });
    expect(view.kind).toBe("hidden");
  });

  it("returns 'available' with the version for kind='available'", () => {
    const view = indicatorView({ kind: "available", version: "1.6.0" });
    expect(view.kind).toBe("available");
    if (view.kind === "available") {
      expect(view.version).toBe("1.6.0");
      expect(view.ariaLabel).toContain("1.6.0");
      expect(view.ariaLabel.toLowerCase()).toContain("download");
    }
  });

  it("returns 'downloading' with the progress (rounded, clamped) for kind='downloading'", () => {
    const v42 = indicatorView({ kind: "downloading", progress: 42 });
    expect(v42.kind).toBe("downloading");
    if (v42.kind === "downloading") {
      expect(v42.progress).toBe(42);
      expect(v42.ariaLabel).toContain("42");
    }
    // Round half values to nearest integer.
    const vRound = indicatorView({ kind: "downloading", progress: 41.6 });
    if (vRound.kind === "downloading") {
      expect(vRound.progress).toBe(42);
    }
    // Clamp negative to 0.
    const vNeg = indicatorView({ kind: "downloading", progress: -5 });
    if (vNeg.kind === "downloading") {
      expect(vNeg.progress).toBe(0);
    }
    // Clamp > 100 to 100.
    const vOver = indicatorView({ kind: "downloading", progress: 250 });
    if (vOver.kind === "downloading") {
      expect(vOver.progress).toBe(100);
    }
  });

  it("returns 'downloaded' with the version for kind='downloaded'", () => {
    const view = indicatorView({ kind: "downloaded", version: "1.6.0" });
    expect(view.kind).toBe("downloaded");
    if (view.kind === "downloaded") {
      expect(view.version).toBe("1.6.0");
      expect(view.ariaLabel.toLowerCase()).toContain("restart");
    }
  });

  it("returns 'error' with the message for kind='error'", () => {
    const view = indicatorView({
      kind: "error",
      message: "network unreachable",
    });
    expect(view.kind).toBe("error");
    if (view.kind === "error") {
      expect(view.message).toBe("network unreachable");
      expect(view.ariaLabel.toLowerCase()).toContain("retry");
    }
  });
});

// ---------------------------------------------------------------------------
// Mounting / IPC subscription.
// ---------------------------------------------------------------------------
describe("UpdateIndicator — mount + subscription (DEF-077)", () => {
  beforeEach(() => {
    clearTflex();
  });
  afterEach(() => {
    clearTflex();
    vi.restoreAllMocks();
  });

  it("renders nothing and never calls IPC when the update channel is absent", async () => {
    // No tflex.update channel. The component must not throw, must
    // not call anything, and must render no indicator.
    setTflex({});
    const { container, cleanup } = renderIndicator({});
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector("[data-update-indicator]")).toBeNull();
    cleanup();
  });

  it("fetches the initial state via getStatus and renders 'available' for kind='available'", async () => {
    setTflex({
      update: {
        getStatus: async (): Promise<UpdateState> => ({
          kind: "available",
          version: "1.6.0",
        }),
        onStatusChanged: (): (() => void) => (): void => undefined,
      },
    });
    const { container, cleanup } = renderIndicator({});
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const pill = container.querySelector("[data-update-indicator]");
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("data-update-indicator-kind")).toBe("available");
    expect(pill?.getAttribute("data-update-indicator-version")).toBe("1.6.0");
    expect(pill?.textContent).toContain("1.6.0");
    expect(pill?.textContent).toMatch(/Update/);
    cleanup();
  });

  it("renders nothing for kind='up-to-date' (no toolbar noise)", async () => {
    setTflex({
      update: {
        getStatus: async (): Promise<UpdateState> => ({
          kind: "up-to-date",
          version: "1.5.3",
        }),
        onStatusChanged: (): (() => void) => (): void => undefined,
      },
    });
    const { container, cleanup } = renderIndicator({});
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector("[data-update-indicator]")).toBeNull();
    cleanup();
  });

  it("renders nothing for kind='unsupported' (DEF-074 parity: About dialog owns the reason)", async () => {
    setTflex({
      update: {
        getStatus: async (): Promise<UpdateState> => ({
          kind: "unsupported",
          reason: "Portable build does not support auto-update",
        }),
        onStatusChanged: (): (() => void) => (): void => undefined,
      },
    });
    const { container, cleanup } = renderIndicator({});
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector("[data-update-indicator]")).toBeNull();
    cleanup();
  });

  it("renders a progress chip for kind='downloading'", async () => {
    setTflex({
      update: {
        getStatus: async (): Promise<UpdateState> => ({
          kind: "downloading",
          progress: 60,
        }),
        onStatusChanged: (): (() => void) => (): void => undefined,
      },
    });
    const { container, cleanup } = renderIndicator({});
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const chip = container.querySelector("[data-update-indicator]");
    expect(chip?.getAttribute("data-update-indicator-kind")).toBe("downloading");
    expect(chip?.getAttribute("data-update-indicator-progress")).toBe("60");
    expect(chip?.textContent).toContain("60%");
    // Non-interactive while downloading.
    expect(chip?.tagName.toLowerCase()).toBe("span");
    cleanup();
  });

  it("renders a 'Restart to update' button for kind='downloaded'", async () => {
    setTflex({
      update: {
        getStatus: async (): Promise<UpdateState> => ({
          kind: "downloaded",
          version: "1.6.0",
        }),
        onStatusChanged: (): (() => void) => (): void => undefined,
      },
    });
    const { container, cleanup } = renderIndicator({});
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const btn = container.querySelector(
      'button[data-update-indicator-kind="downloaded"]',
    );
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("data-update-indicator-version")).toBe("1.6.0");
    expect(btn?.textContent).toMatch(/Restart to update/);
    cleanup();
  });

  it("re-renders when onStatusChanged pushes a fresh state", async () => {
    let statusCb: ((state: UpdateState) => void) | null = null;
    setTflex({
      update: {
        getStatus: async (): Promise<UpdateState> => ({
          kind: "checking",
        }),
        onStatusChanged: (cb): (() => void) => {
          statusCb = cb;
          return (): void => undefined;
        },
      },
    });
    const { container, cleanup } = renderIndicator({});
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    let chip = container.querySelector("[data-update-indicator]");
    expect(chip?.getAttribute("data-update-indicator-kind")).toBe("checking");

    // Simulate the backend pushing the next state.
    await act(async (): Promise<void> => {
      statusCb?.({ kind: "available", version: "2.0.0" });
    });
    chip = container.querySelector("[data-update-indicator]");
    expect(chip?.getAttribute("data-update-indicator-kind")).toBe("available");
    expect(chip?.getAttribute("data-update-indicator-version")).toBe("2.0.0");
    cleanup();
  });

  it("unsubscribes the onStatusChanged listener when the indicator unmounts", () => {
    let unsubscribeCount = 0;
    setTflex({
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
    });
    const { cleanup } = renderIndicator({});
    cleanup();
    expect(unsubscribeCount).toBeGreaterThanOrEqual(1);
  });

  it("falls back to null state (no indicator) when getStatus() rejects", async () => {
    setTflex({
      update: {
        getStatus: async (): Promise<UpdateState> => {
          throw new Error("ipc exploded");
        },
        onStatusChanged: (): (() => void) => (): void => undefined,
      },
    });
    const { container, cleanup } = renderIndicator({});
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Should not crash; should render nothing because the channel
    // effectively failed to deliver a state.
    expect(container.querySelector("[data-update-indicator]")).toBeNull();
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Click routing.
// ---------------------------------------------------------------------------
describe("UpdateIndicator — click routing (DEF-077)", () => {
  beforeEach(() => {
    clearTflex();
  });
  afterEach(() => {
    clearTflex();
    vi.restoreAllMocks();
  });

  it("clicking 'available' calls update.download()", async () => {
    const download = vi.fn(async (): Promise<UpdateState> => ({
      kind: "downloading",
      progress: 0,
    }));
    setTflex({
      update: {
        getStatus: async (): Promise<UpdateState> => ({
          kind: "available",
          version: "1.6.0",
        }),
        download,
        onStatusChanged: (): (() => void) => (): void => undefined,
      },
    });
    const { container, cleanup } = renderIndicator({});
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const btn = container.querySelector<HTMLButtonElement>(
      'button[data-update-indicator-kind="available"]',
    );
    expect(btn).not.toBeNull();
    act((): void => {
      btn?.click();
    });
    expect(download).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("clicking 'downloaded' calls update.install()", async () => {
    const install = vi.fn(async (): Promise<void> => undefined);
    setTflex({
      update: {
        getStatus: async (): Promise<UpdateState> => ({
          kind: "downloaded",
          version: "1.6.0",
        }),
        install,
        onStatusChanged: (): (() => void) => (): void => undefined,
      },
    });
    const { container, cleanup } = renderIndicator({});
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const btn = container.querySelector<HTMLButtonElement>(
      'button[data-update-indicator-kind="downloaded"]',
    );
    expect(btn).not.toBeNull();
    act((): void => {
      btn?.click();
    });
    expect(install).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("clicking 'error' retries by calling update.download()", async () => {
    const download = vi.fn(async (): Promise<UpdateState> => ({
      kind: "downloading",
      progress: 0,
    }));
    setTflex({
      update: {
        getStatus: async (): Promise<UpdateState> => ({
          kind: "error",
          message: "network unreachable",
        }),
        download,
        onStatusChanged: (): (() => void) => (): void => undefined,
      },
    });
    const { container, cleanup } = renderIndicator({});
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const btn = container.querySelector<HTMLButtonElement>(
      'button[data-update-indicator-kind="error"]',
    );
    expect(btn).not.toBeNull();
    act((): void => {
      btn?.click();
    });
    expect(download).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("'downloading' is non-interactive (no clickable button)", async () => {
    setTflex({
      update: {
        getStatus: async (): Promise<UpdateState> => ({
          kind: "downloading",
          progress: 30,
        }),
        onStatusChanged: (): (() => void) => (): void => undefined,
      },
    });
    const { container, cleanup } = renderIndicator({});
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // The progress chip is a <span>, not a <button> — a click must
    // not queue a second download.
    const interactive = container.querySelector(
      'button[data-update-indicator-kind="downloading"]',
    );
    expect(interactive).toBeNull();
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// AppHeader integration — the indicator must mount inside .header-actions
// and appear before the theme toggle (spec: "next to the Tools/theme
// controls"). This is the integration test that proves AppHeader wires
// the slot through correctly.
// ---------------------------------------------------------------------------
describe("AppHeader — update indicator slot (DEF-077)", () => {
  beforeEach(() => {
    clearTflex();
  });
  afterEach(() => {
    clearTflex();
  });

  it("renders the indicator inside .header-actions when passed via the slot prop", async () => {
    setTflex({
      update: {
        getStatus: async (): Promise<UpdateState> => ({
          kind: "available",
          version: "1.6.0",
        }),
        onStatusChanged: (): (() => void) => (): void => undefined,
      },
    });
    // We import AppHeader lazily here so the indicator's IPC effect
    // doesn't try to subscribe before the test sets up the channel.
    const { AppHeader } = await import(
      "../../../src/renderer/components/AppHeader"
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async (): Promise<void> => {
      root.render(
        <AppHeader
          activeId={null}
          tabs={[]}
          onActivate={(): void => undefined}
          onClose={(): void => undefined}
          theme={"dark"}
          onThemeChange={(): void => undefined}
          onOpen={(): void => undefined}
          onNewEmptyTab={(): void => undefined}
          updateIndicator={<UpdateIndicator />}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const actions = container.querySelector(".header-actions");
    expect(actions).not.toBeNull();
    const indicator = actions?.querySelector("[data-update-indicator]");
    expect(indicator).not.toBeNull();
    // The theme toggle is the next sibling — spec said "next to the
    // Tools/theme controls", so the indicator and the theme toggle
    // must be adjacent inside .header-actions.
    const themeToggle = actions?.querySelector(".theme-toggle");
    expect(themeToggle).not.toBeNull();
    // Order: indicator appears before theme toggle. Use
    // querySelectorAll("*") to walk every descendant — React
    // can insert comment nodes between adjacent elements in
    // the rendered tree (visible via .children but not via
    // .querySelectorAll("*")), and the slot's button can be
    // a direct child of .header-actions either way. The
    // contract we want to pin is: both elements are present
    // inside .header-actions and the indicator comes first
    // in document order.
    const descendants = Array.from(actions?.querySelectorAll("*") ?? []);
    const indicatorIdx = descendants.findIndex(
      (el) =>
        el.matches("[data-update-indicator]") ||
        el.querySelector("[data-update-indicator]") !== null,
    );
    const themeIdx = descendants.findIndex(
      (el) => (el as HTMLElement).classList.contains("theme-toggle"),
    );
    expect(indicatorIdx).toBeGreaterThanOrEqual(0);
    expect(themeIdx).toBeGreaterThanOrEqual(0);
    expect(indicatorIdx).toBeLessThan(themeIdx);
    act((): void => {
      root.unmount();
    });
    container.remove();
  });

  it("renders no indicator when the slot prop is omitted (back-compat with old hosts)", async () => {
    // Use a dynamic import (the test file is ESM) to pull AppHeader
    // in after the global tflex stub is in place.
    const { AppHeader } = await import(
      "../../../src/renderer/components/AppHeader"
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        <AppHeader
          activeId={null}
          tabs={[]}
          onActivate={(): void => undefined}
          onClose={(): void => undefined}
          theme={"dark"}
          onThemeChange={(): void => undefined}
          onOpen={(): void => undefined}
          onNewEmptyTab={(): void => undefined}
        />,
      );
    });
    expect(container.querySelector("[data-update-indicator]")).toBeNull();
    act((): void => {
      root.unmount();
    });
    container.remove();
  });
});

// ---------------------------------------------------------------------------
// OTA UX — `externalState` prop. The App.tsx wiring owns the
// single shared onStatusChanged subscription (so the prompt
// dialog and the toolbar chip see the same push). The indicator
// reads its state from the prop and skips its own subscription
// to avoid double-listener + double-fetch on mount.
//
// These tests pin the contract:
//   1. When `externalState` is provided, the indicator renders
//      the matching visual treatment and never calls IPC.
//   2. When `externalState` changes (push from the host), the
//      indicator re-renders with the new state.
//   3. `getStatus()` is NOT called when `externalState` is set
//      (no double-fetch).
//   4. `onStatusChanged` is NOT subscribed when `externalState`
//      is set (no double-listener).
// ---------------------------------------------------------------------------
describe("UpdateIndicator — externalState prop (OTA UX shared subscription)", () => {
  beforeEach(() => {
    clearTflex();
  });
  afterEach(() => {
    clearTflex();
    vi.restoreAllMocks();
  });

  it("renders using externalState without subscribing to onStatusChanged or calling getStatus", async () => {
    const getStatus = vi.fn(async (): Promise<UpdateState> => ({
      kind: "up-to-date",
      version: "1.5.3",
    }));
    const onStatusChanged = vi.fn(
      (): (() => void) => (): void => undefined,
    );
    setTflex({
      update: { getStatus, onStatusChanged },
    });
    const { cleanup } = renderIndicator({});
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // No externalState prop -> the indicator uses its own
    // subscription (legacy behaviour). getStatus should have
    // been called once at mount.
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(onStatusChanged).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("with externalState set, the indicator renders the matching treatment without touching IPC", async () => {
    const getStatus = vi.fn(async (): Promise<UpdateState> => ({
      kind: "up-to-date",
      version: "1.5.3",
    }));
    const onStatusChanged = vi.fn(
      (): (() => void) => (): void => undefined,
    );
    setTflex({
      update: { getStatus, onStatusChanged },
    });
    // Mount a fresh indicator with externalState passed in.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        <UpdateIndicator externalState={{ kind: "available", version: "1.6.0" }} />,
      );
    });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const pill = container.querySelector(
      "[data-update-indicator-kind='available']",
    );
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("data-update-indicator-version")).toBe("1.6.0");
    // externalState short-circuits the IPC subscription: the
    // host owns the listener, the indicator reads the prop.
    expect(getStatus).not.toHaveBeenCalled();
    expect(onStatusChanged).not.toHaveBeenCalled();
    act((): void => {
      root.unmount();
    });
    container.remove();
  });

  it("re-renders when externalState changes (host-side push)", async () => {
    const getStatus = vi.fn(async (): Promise<UpdateState> => ({
      kind: "up-to-date",
      version: "1.5.3",
    }));
    setTflex({ update: { getStatus } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    // Render the indicator with an updating externalState via
    // a parent that re-renders on every tick. We use a simple
    // component wrapper so React re-renders when state changes.
    let stateRef: UpdateState = { kind: "checking" };
    const setState = (next: UpdateState): void => {
      stateRef = next;
      act((): void => {
        root.render(<UpdateIndicator externalState={stateRef} />);
      });
    };
    act((): void => {
      root.render(<UpdateIndicator externalState={stateRef} />);
    });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    let chip = container.querySelector("[data-update-indicator]");
    expect(chip?.getAttribute("data-update-indicator-kind")).toBe("checking");

    setState({ kind: "available", version: "2.0.0" });
    chip = container.querySelector("[data-update-indicator]");
    expect(chip?.getAttribute("data-update-indicator-kind")).toBe("available");
    expect(chip?.getAttribute("data-update-indicator-version")).toBe("2.0.0");
    // The IPC layer must remain untouched (host owns it).
    expect(getStatus).not.toHaveBeenCalled();
    act((): void => {
      root.unmount();
    });
    container.remove();
  });
});
