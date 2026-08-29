// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createDebouncer } from "../../../src/renderer/utils/debounce";

describe("createDebouncer", () => {
  it("invokes the wrapped function after the wait window", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createDebouncer(fn, 200);
    debounced("a");
    debounced("b");
    debounced("c");
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
    vi.useRealTimers();
  });

  it("coalesces multiple rapid calls into one invocation with the latest args", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createDebouncer(fn, 100);
    debounced(1);
    vi.advanceTimersByTime(50);
    debounced(2);
    vi.advanceTimersByTime(50);
    debounced(3);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
    vi.useRealTimers();
  });

  it("does not invoke the function if no call was made", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    createDebouncer(fn, 100);
    vi.advanceTimersByTime(1_000);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("flush() invokes immediately and cancels the pending call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createDebouncer(fn, 200);
    debounced("first");
    debounced("second");
    debounced.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("second");
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("flush() is a no-op when no call is pending", () => {
    const fn = vi.fn();
    const debounced = createDebouncer(fn, 200);
    debounced.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it("flush() does not call twice if invoked again after the timer fired", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createDebouncer(fn, 200);
    debounced("a");
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    debounced.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("cancel() drops the pending call without invoking", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createDebouncer(fn, 200);
    debounced("x");
    debounced.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("forwards multiple arguments from the latest call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createDebouncer(fn, 50);
    debounced("a", 1, true);
    debounced("b", 2, false);
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledWith("b", 2, false);
    vi.useRealTimers();
  });

  it("a new call after the timer fired starts a fresh window", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = createDebouncer(fn, 100);
    debounced("a");
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    debounced("b");
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(99);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("b");
    vi.useRealTimers();
  });
});
