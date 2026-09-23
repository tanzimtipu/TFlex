// DEF-303 — the renderer's minimised-window suspend state (pure module).
//
// `backgroundThrottling: false` was tried and reverted (Chromium still
// suspends a minimised window's frames), so the renderer cannot use
// `visibilitychange`/`document.hidden` to detect a minimise;
// main pushes `window:minimizedChanged` instead and this module is the one
// suspend state the render/raster entry points consult. These tests pin
// the state machine itself: work requested while suspended is parked (never
// dropped), flushed exactly once on resume, cancellable, and the
// subscription notifies on change only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deferWork,
  isRenderSuspended,
  resetRenderSuspendForTests,
  setRenderSuspended,
  subscribeRenderSuspend,
  waitForRenderActive,
} from "../../../src/renderer/state/renderSuspend";

beforeEach((): void => {
  resetRenderSuspendForTests();
});
afterEach((): void => {
  resetRenderSuspendForTests();
});

describe("DEF-303 — render suspend state", () => {
  it("starts active and runs work immediately when not suspended", () => {
    expect(isRenderSuspended()).toBe(false);
    const run = vi.fn();
    const cancel = deferWork(run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(typeof cancel).toBe("function");
    cancel();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("parks work while suspended and flushes it exactly once on resume, in order", () => {
    setRenderSuspended(true);
    expect(isRenderSuspended()).toBe(true);
    const order: string[] = [];
    deferWork((): void => {
      order.push("a");
    });
    deferWork((): void => {
      order.push("b");
    });
    // Parked, not dropped: nothing has run yet.
    expect(order).toEqual([]);
    setRenderSuspended(false);
    expect(order).toEqual(["a", "b"]);
    // A second resume must not re-run the already-flushed work.
    setRenderSuspended(false);
    expect(order).toEqual(["a", "b"]);
  });

  it("drops a parked callback when its cancel runs before resume", () => {
    setRenderSuspended(true);
    const run = vi.fn();
    const cancel = deferWork(run);
    cancel();
    setRenderSuspended(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs work immediately again after a resume", () => {
    setRenderSuspended(true);
    setRenderSuspended(false);
    const run = vi.fn();
    deferWork(run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("flushes parked work BEFORE notifying subscribers on resume", () => {
    setRenderSuspended(true);
    const calls: string[] = [];
    deferWork((): void => {
      calls.push("work");
    });
    subscribeRenderSuspend((): void => {
      calls.push("notify");
    });
    setRenderSuspended(false);
    expect(calls).toEqual(["work", "notify"]);
  });

  it("notifies subscribers on a change and stops after unsubscribe", () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeRenderSuspend((s): void => {
      seen.push(s);
    });
    setRenderSuspended(true);
    expect(seen).toEqual([true]);
    unsubscribe();
    setRenderSuspended(false);
    expect(seen).toEqual([true]);
  });

  it("does not notify or re-flush when set to its current value", () => {
    const listener = vi.fn();
    subscribeRenderSuspend(listener);
    setRenderSuspended(true);
    setRenderSuspended(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("DEF-303 — waitForRenderActive (chunked loops)", () => {
  it("resolves immediately while the window is active", async () => {
    await expect(waitForRenderActive()).resolves.toBeUndefined();
  });

  it("parks until resume and releases every waiter exactly once", async () => {
    setRenderSuspended(true);
    const seen: string[] = [];
    const a = waitForRenderActive().then((): void => {
      seen.push("a");
    });
    const b = waitForRenderActive().then((): void => {
      seen.push("b");
    });
    await Promise.resolve();
    expect(seen).toEqual([]);
    setRenderSuspended(false);
    await Promise.all([a, b]);
    expect(seen).toEqual(["a", "b"]);
    // A later suspend/resume must not re-release the finished waiters.
    setRenderSuspended(true);
    setRenderSuspended(false);
    await Promise.resolve();
    expect(seen).toEqual(["a", "b"]);
  });
});
