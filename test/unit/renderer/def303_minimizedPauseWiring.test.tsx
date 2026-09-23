// @vitest-environment jsdom
//
// DEF-303 — the renderer subscribes to the main process's pause signal.
//
// Main pushes `window:minimizedChanged` (`{ minimized }`) on the window's
// `minimize`/`restore` events (the renderer cannot infer a minimise from
// `visibilitychange`: `backgroundThrottling: false` was tried and reverted,
// Chromium still suspends a minimised window's frames). The renderer's half
// is one subscription that drives the
// single suspend state. This test pins the wiring: subscribe on mount, the
// older-preload guard, the unsubscribe on unmount, and the App-level mount.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { useMinimizedPause } from "../../../src/renderer/hooks/useMinimizedPause";
import {
  deferWork,
  isRenderSuspended,
  resetRenderSuspendForTests,
} from "../../../src/renderer/state/renderSuspend";

interface Bridge {
  onMinimizedChanged?: (cb: (state: { minimized: boolean }) => void) => () => void;
}

function setBridge(bridge: Bridge | undefined): void {
  (window as unknown as { tflex?: Bridge }).tflex = bridge;
}

function mountHook(): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act((): void => {
    root.render(
      createElement(function PauseHarness(): ReactElement {
        useMinimizedPause();
        return createElement("div");
      }),
    );
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

beforeEach((): void => {
  resetRenderSuspendForTests();
});
afterEach((): void => {
  resetRenderSuspendForTests();
  setBridge(undefined);
});

describe("DEF-303 — useMinimizedPause wiring", () => {
  it("subscribes on mount and maps minimized true/false to the suspend state", () => {
    let emit: ((state: { minimized: boolean }) => void) | null = null;
    setBridge({
      onMinimizedChanged: (cb) => {
        emit = cb;
        return (): void => undefined;
      },
    });
    const { unmount } = mountHook();
    try {
      expect(typeof emit).toBe("function");
      act((): void => {
        emit?.({ minimized: true });
      });
      expect(isRenderSuspended()).toBe(true);
      // Work requested while minimised is parked...
      const run = vi.fn();
      deferWork(run);
      expect(run).not.toHaveBeenCalled();
      // ...and flushed the instant the window is restored.
      act((): void => {
        emit?.({ minimized: false });
      });
      expect(isRenderSuspended()).toBe(false);
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("degrades to a no-op when an older preload has no onMinimizedChanged", () => {
    setBridge({});
    const { unmount } = mountHook();
    try {
      expect(isRenderSuspended()).toBe(false);
    } finally {
      unmount();
    }
  });

  it("degrades to a no-op when the bridge itself is absent", () => {
    setBridge(undefined);
    const { unmount } = mountHook();
    try {
      expect(isRenderSuspended()).toBe(false);
    } finally {
      unmount();
    }
  });

  it("unsubscribes on unmount", () => {
    const unsubscribe = vi.fn();
    setBridge({ onMinimizedChanged: (): (() => void) => unsubscribe });
    const { unmount } = mountHook();
    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("DEF-303 — App mounts the subscription and the hook keeps the guard", () => {
  const hookSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "src", "renderer", "hooks", "useMinimizedPause.ts"),
    "utf8",
  );
  const appSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "src", "renderer", "App.tsx"),
    "utf8",
  );

  it("App.tsx imports and calls useMinimizedPause", () => {
    expect(appSource).toMatch(
      /import \{ useMinimizedPause \} from "\.\/hooks\/useMinimizedPause";/,
    );
    expect(appSource).toMatch(/useMinimizedPause\(\);/);
  });

  it("the hook keeps the typeof onMinimizedChanged !== 'function' older-preload guard", () => {
    expect(hookSource).toMatch(/typeof api\.onMinimizedChanged !== "function"/);
  });
});

describe("DEF-303 — the search-index walk parks at its chunk boundary", () => {
  const docViewSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "src", "renderer", "components", "DocumentView.tsx"),
    "utf8",
  );

  it("awaits waitForRenderActive before yielding between search chunks", () => {
    expect(docViewSource).toMatch(
      /await waitForRenderActive\(\);\s*\n\s*await new Promise<void>\(\(r\) => setTimeout\(r, 0\)\);/,
    );
  });
});
