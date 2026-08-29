// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createIdleCleanupCoordinator } from "../../../src/renderer/utils/idleCleanup";

/** A minimal manual-timer harness: the unit tests drive the idle window
 *  by stepping a virtual clock instead of relying on real setTimeout.
 *  `advance(ms)` also drains pending microtasks before returning so any
 *  promise scheduled inside the timer's callback has run. */
function makeTimerHarness() {
  let now = 0;
  const tasks = new Map<unknown, { cb: () => void; fireAt: number; id: number }>();
  let nextId = 0;
  const fired: unknown[] = [];
  const setTimer = (cb: () => void, ms: number): unknown => {
    const id = nextId;
    nextId += 1;
    tasks.set(id, { cb, fireAt: now + ms, id });
    return id;
  };
  const clearTimer = (handle: unknown): void => {
    tasks.delete(handle);
  };
  const advance = async (ms: number): Promise<void> => {
    now += ms;
    // Fire every due task (sorted by fireAt so the order matches reality).
    const due = [...tasks.values()].sort((a, b) => a.fireAt - b.fireAt);
    for (const task of due) {
      if (task.fireAt <= now && tasks.has(task.id)) {
        tasks.delete(task.id);
        fired.push(task.id);
        task.cb();
      }
    }
    // Drain microtasks so any Promise.resolve().then(cleanup) the
    // coordinator scheduled inside the timer has a chance to run.
    await Promise.resolve();
    await Promise.resolve();
  };
  return { setTimer, clearTimer, advance, fired, now: (): number => now };
}

describe("createIdleCleanupCoordinator", () => {
  it("schedules a cleanup after the idle window and invokes the cleanup callback", async () => {
    const harness = makeTimerHarness();
    const cleanup = vi.fn(async () => undefined);
    const isBusy = vi.fn(() => false);
    const coord = createIdleCleanupCoordinator(cleanup, isBusy, {
      idleMs: 1000,
      setTimer: harness.setTimer,
      clearTimer: harness.clearTimer,
    });
    coord.requestCleanup();
    expect(coord.isPending()).toBe(true);
    await harness.advance(999);
    expect(cleanup).not.toHaveBeenCalled();
    await harness.advance(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(coord.isPending()).toBe(false);
  });

  it("coalesces repeat requestCleanup calls — at most one outstanding", async () => {
    const harness = makeTimerHarness();
    const cleanup = vi.fn(async () => undefined);
    const isBusy = vi.fn(() => false);
    const coord = createIdleCleanupCoordinator(cleanup, isBusy, {
      idleMs: 1000,
      setTimer: harness.setTimer,
      clearTimer: harness.clearTimer,
    });
    coord.requestCleanup();
    coord.requestCleanup();
    coord.requestCleanup();
    await harness.advance(1000);
    expect(cleanup).toHaveBeenCalledTimes(1);
    // Re-arming after a successful cleanup schedules a second fire.
    coord.requestCleanup();
    await harness.advance(1000);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("resets the idle window when noteActivity is called before fire", async () => {
    const harness = makeTimerHarness();
    const cleanup = vi.fn(async () => undefined);
    const isBusy = vi.fn(() => false);
    const coord = createIdleCleanupCoordinator(cleanup, isBusy, {
      idleMs: 1000,
      setTimer: harness.setTimer,
      clearTimer: harness.clearTimer,
    });
    coord.requestCleanup();
    await harness.advance(500);
    coord.noteActivity();
    await harness.advance(500);
    // 500ms after noteActivity — still within the new window.
    expect(cleanup).not.toHaveBeenCalled();
    await harness.advance(500);
    // 1000ms after noteActivity — fires.
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not fire cleanup while isBusy() reports true", async () => {
    const harness = makeTimerHarness();
    const cleanup = vi.fn(async () => undefined);
    const isBusy = vi.fn(() => true);
    const coord = createIdleCleanupCoordinator(cleanup, isBusy, {
      idleMs: 1000,
      setTimer: harness.setTimer,
      clearTimer: harness.clearTimer,
    });
    coord.requestCleanup();
    await harness.advance(1000);
    expect(cleanup).not.toHaveBeenCalled();
    expect(coord.isPending()).toBe(false);
  });

  it("cancel() drops a pending cleanup", async () => {
    const harness = makeTimerHarness();
    const cleanup = vi.fn(async () => undefined);
    const isBusy = vi.fn(() => false);
    const coord = createIdleCleanupCoordinator(cleanup, isBusy, {
      idleMs: 1000,
      setTimer: harness.setTimer,
      clearTimer: harness.clearTimer,
    });
    coord.requestCleanup();
    coord.cancel();
    await harness.advance(1000);
    expect(cleanup).not.toHaveBeenCalled();
    expect(coord.isPending()).toBe(false);
  });

  it("noteActivity is a no-op when no cleanup is armed", async () => {
    const harness = makeTimerHarness();
    const cleanup = vi.fn(async () => undefined);
    const isBusy = vi.fn(() => false);
    const coord = createIdleCleanupCoordinator(cleanup, isBusy, {
      idleMs: 1000,
      setTimer: harness.setTimer,
      clearTimer: harness.clearTimer,
    });
    // Never called requestCleanup — noteActivity must not somehow schedule.
    coord.noteActivity();
    await harness.advance(2000);
    expect(cleanup).not.toHaveBeenCalled();
    expect(coord.isPending()).toBe(false);
  });

  it("survives a cleanup that rejects", async () => {
    const harness = makeTimerHarness();
    const cleanup = vi.fn(async () => {
      throw new Error("boom");
    });
    const isBusy = vi.fn(() => false);
    const coord = createIdleCleanupCoordinator(cleanup, isBusy, {
      idleMs: 1000,
      setTimer: harness.setTimer,
      clearTimer: harness.clearTimer,
    });
    coord.requestCleanup();
    await harness.advance(1000);
    expect(cleanup).toHaveBeenCalledTimes(1);
    // The rejection must not leave the coordinator in a stuck state.
    // Drain an extra microtask so the rejection's .then(..., finalize)
    // has a chance to run.
    await Promise.resolve();
    expect(coord.isPending()).toBe(false);
  });

  it("uses the default idle window when none is supplied", async () => {
    const harness = makeTimerHarness();
    const cleanup = vi.fn(async () => undefined);
    const isBusy = vi.fn(() => false);
    // No idleMs option — default is 5000ms.
    const coord = createIdleCleanupCoordinator(cleanup, isBusy, {
      setTimer: harness.setTimer,
      clearTimer: harness.clearTimer,
    });
    coord.requestCleanup();
    await harness.advance(4999);
    expect(cleanup).not.toHaveBeenCalled();
    await harness.advance(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
