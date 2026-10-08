// @vitest-environment jsdom
//
// Phase 114 (TFL-1239, chunk C) — settings write-failure rollback hook.
//
// When a settings write fails the backend pushes `settings:writeError` with the
// failure message. `useSettingsWriteRollback` must report the failure (the
// toast) AND re-read the authoritative settings, handing them to `onRestore` so
// the UI drops the value it optimistically showed. A failed load still reports
// the error but restores nothing, and unmount tears the subscription down.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useSettingsWriteRollback } from "../../../src/renderer/hooks/useSettingsWriteRollback";
import { confirmedSnapshotAfterApply } from "../../../src/renderer/state/defaults";
import type { AppSettings, LoadSettingsResult } from "../../../src/shared/types";

const RESTORED: AppSettings = {
  theme: "light",
  geometry: { x: 10, y: 10, width: 1280, height: 800, maximized: false },
  recentFiles: [],
};

const LAST_CONFIRMED: AppSettings = {
  theme: "dark",
  geometry: { x: 0, y: 0, width: 1440, height: 900, maximized: false },
  recentFiles: [],
};

interface FakeBridge {
  fire: (message: string) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
  loadSettings: ReturnType<typeof vi.fn>;
}

function installTflex(loadResult: LoadSettingsResult, withWriteError = true): FakeBridge {
  let cb: ((message: string) => void) | null = null;
  const unsubscribe = vi.fn();
  const writeError = vi.fn((next: (message: string) => void): (() => void) => {
    cb = next;
    return unsubscribe;
  });
  const loadSettings = vi.fn((): Promise<LoadSettingsResult> => Promise.resolve(loadResult));
  const settings = withWriteError ? { writeError } : {};
  (window as unknown as { tflex: unknown }).tflex = { settings, loadSettings };
  return {
    fire: (message): void => cb?.(message),
    unsubscribe,
    loadSettings,
  };
}

function Harness(props: {
  onRestore: (s: AppSettings) => void;
  onError: (message: string) => void;
  getLastConfirmed: () => AppSettings | null;
}): null {
  useSettingsWriteRollback({
    onRestore: props.onRestore,
    onError: props.onError,
    getLastConfirmed: props.getLastConfirmed,
  });
  return null;
}

function mount(
  onRestore: (s: AppSettings) => void,
  onError: (message: string) => void,
  getLastConfirmed: () => AppSettings | null = (): AppSettings | null => null,
): { unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <Harness
        onRestore={onRestore}
        onError={onError}
        getLastConfirmed={getLastConfirmed}
      />,
    );
  });
  return {
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("useSettingsWriteRollback", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
    delete (window as unknown as { tflex?: unknown }).tflex;
  });

  it("reports the error AND restores the settings re-read from the backend", async () => {
    const bridge = installTflex({ ok: true, value: RESTORED });
    const onError = vi.fn((): void => undefined);
    const onRestore = vi.fn((): void => undefined);
    const { unmount } = mount(onRestore, onError);

    await act(async (): Promise<void> => {
      bridge.fire("disk full");
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("disk full");
    expect(bridge.loadSettings).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith(RESTORED);
    unmount();
  });

  it("falls back to the last confirmed settings when the re-read resolves ok:false", async () => {
    const bridge = installTflex({ ok: false, error: { code: "io", message: "io" } });
    const onError = vi.fn((): void => undefined);
    const onRestore = vi.fn((): void => undefined);
    const { unmount } = mount(onRestore, onError, (): AppSettings => LAST_CONFIRMED);

    await act(async (): Promise<void> => {
      bridge.fire("write failed");
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith("write failed");
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith(LAST_CONFIRMED);
    unmount();
  });

  it("falls back to the last confirmed settings when the re-read rejects", async () => {
    const bridge = installTflex({ ok: true, value: RESTORED });
    bridge.loadSettings.mockRejectedValue(new Error("io"));
    const onError = vi.fn((): void => undefined);
    const onRestore = vi.fn((): void => undefined);
    const { unmount } = mount(onRestore, onError, (): AppSettings => LAST_CONFIRMED);

    await act(async (): Promise<void> => {
      bridge.fire("write failed");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith("write failed");
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith(LAST_CONFIRMED);
    unmount();
  });

  it("restores nothing on a failed re-read when nothing is confirmed yet", async () => {
    const bridge = installTflex({ ok: false, error: { code: "io", message: "io" } });
    const onError = vi.fn((): void => undefined);
    const onRestore = vi.fn((): void => undefined);
    const { unmount } = mount(onRestore, onError, (): AppSettings | null => null);

    await act(async (): Promise<void> => {
      bridge.fire("write failed");
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith("write failed");
    expect(onRestore).not.toHaveBeenCalled();
    unmount();
  });

  it("unsubscribes from writeError on unmount", () => {
    const bridge = installTflex({ ok: true, value: RESTORED });
    const { unmount } = mount(vi.fn(), vi.fn());
    unmount();
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the writeError bridge is absent", () => {
    const bridge = installTflex({ ok: true, value: RESTORED }, false);
    const onError = vi.fn((): void => undefined);
    const { unmount } = mount(vi.fn(), onError);
    bridge.fire("ignored");
    expect(onError).not.toHaveBeenCalled();
    unmount();
  });
});

// DEF-644 / TFL-1282 — the optimistic Restore-defaults apply must not become
// the "last confirmed" snapshot. The regression models App.applySettings (the
// confirmed flag defaults to false; only the echo / restore path passes true)
// with the real `confirmedSnapshotAfterApply` rule, then drives the real
// rollback hook through the DEF-638 double failure (write fails AND the
// authoritative re-read fails). The fallback must restore the last CONFIRMED
// settings, never the reset that never reached disk.
describe("DEF-644 — optimistic Restore-defaults apply is not last-confirmed", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
    delete (window as unknown as { tflex?: unknown }).tflex;
  });

  const CONFIRMED: AppSettings = {
    theme: "dark",
    geometry: { x: 0, y: 0, width: 1440, height: 900, maximized: false },
    recentFiles: [],
    themeDefault: "dark",
    recentsCap: 20,
    animationsEnabled: false,
    tabStyle: "standard",
  };
  // The unpersisted reset: theme flipped to frosted and the cap lowered.
  const RESET: AppSettings = {
    ...CONFIRMED,
    theme: "frosted",
    themeDefault: "frosted",
    animationsEnabled: true,
    tabStyle: "colorful",
    recentsCap: 10,
  };

  it("a double failure restores the last confirmed settings, not the reset", async () => {
    const bridge = installTflex({ ok: false, error: { code: "io", message: "io" } });
    const onRestore = vi.fn((): void => undefined);
    const onError = vi.fn((): void => undefined);

    // Mirrors App.applySettings' confirmed-snapshot rule.
    const confirmedRef: { current: AppSettings | null } = { current: CONFIRMED };
    const applySettings = (s: AppSettings, confirmed = false): void => {
      confirmedRef.current = confirmedSnapshotAfterApply(confirmedRef.current, s, confirmed);
    };

    const { unmount } = mount(onRestore, onError, (): AppSettings | null => confirmedRef.current);

    // 1. Restore defaults applies optimistically (not confirmed).
    applySettings(RESET);
    expect(confirmedRef.current).toBe(CONFIRMED);

    // 2. The write fails AND the authoritative re-read fails.
    await act(async (): Promise<void> => {
      bridge.fire("disk full");
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith("disk full");
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith(CONFIRMED);
    expect(onRestore).not.toHaveBeenCalledWith(RESET);
    unmount();
  });

  it("only a confirmed apply advances the fallback snapshot", () => {
    // Optimistic apply leaves the snapshot alone; echo / restore advance it.
    expect(confirmedSnapshotAfterApply(CONFIRMED, RESET, false)).toBe(CONFIRMED);
    expect(confirmedSnapshotAfterApply(CONFIRMED, RESET, true)).toBe(RESET);
    // Nothing confirmed yet stays null on an optimistic apply.
    expect(confirmedSnapshotAfterApply(null, RESET, false)).toBeNull();
  });
});