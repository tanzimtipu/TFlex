// @vitest-environment jsdom
//
// Phase 101 (chunk 2) - renderer error capture. Proves the React boundary and
// the two window-level handlers forward to `window.tflex.bugReport.capture`
// with the right categories, and that a missing bridge never throws.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BugReportErrorBoundary } from "../../../src/renderer/bug-report/BugReportErrorBoundary";
import { installBugReportGlobalHandlers } from "../../../src/renderer/bug-report/installGlobalHandlers";
import type { BugReportInput } from "../../../src/shared/bugReport";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  delete (window as unknown as { tflex?: unknown }).tflex;
});

function stubBridge(): ReturnType<typeof vi.fn> {
  const capture = vi.fn().mockResolvedValue({ ok: true, queued: 0 });
  (window as unknown as { tflex?: unknown }).tflex = { bugReport: { capture } };
  return capture;
}

function pushGlobalHandlers(): void {
  cleanups.push(installBugReportGlobalHandlers());
}

function renderBoundary(node: ReactNode): Root {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  act(() => {
    root.render(<BugReportErrorBoundary>{node}</BugReportErrorBoundary>);
  });
  return root;
}

function Boom(): ReactNode {
  throw new Error("render boom");
}

function dispatchRejection(reason: unknown): void {
  const event = new Event("unhandledrejection");
  Object.defineProperty(event, "reason", { value: reason });
  window.dispatchEvent(event);
}

describe("renderer bug capture", () => {
  it("forwards a React render crash once as renderer-boundary", () => {
    const capture = stubBridge();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderBoundary(<Boom />);
    errorSpy.mockRestore();

    expect(capture).toHaveBeenCalledTimes(1);
    const input = capture.mock.calls[0][0] as BugReportInput;
    expect(input.category).toBe("renderer-boundary");
    expect(input.component).toBe("renderer");
    expect(input.message).toBe("render boom");
    expect(input.errorName).toBe("Error");
    expect(input.handled).toBe(true);
  });

  it("forwards window error events as renderer-error", () => {
    const capture = stubBridge();
    pushGlobalHandlers();

    window.dispatchEvent(
      new ErrorEvent("error", { message: "boom", error: new Error("boom") }),
    );

    expect(capture).toHaveBeenCalledTimes(1);
    const input = capture.mock.calls[0][0] as BugReportInput;
    expect(input.category).toBe("renderer-error");
    expect(input.message).toBe("boom");
    expect(input.errorName).toBe("Error");
    expect(input.stackTrace).toContain("boom");
  });

  it("forwards unhandled rejections as renderer-rejection", () => {
    const capture = stubBridge();
    pushGlobalHandlers();

    dispatchRejection(new Error("nope"));

    expect(capture).toHaveBeenCalledTimes(1);
    const input = capture.mock.calls[0][0] as BugReportInput;
    expect(input.category).toBe("renderer-rejection");
    expect(input.message).toBe("nope");
    expect(input.errorName).toBe("Error");
  });

  it("stringifies a non-Error rejection reason", () => {
    const capture = stubBridge();
    pushGlobalHandlers();

    dispatchRejection("plain");

    expect(capture).toHaveBeenCalledTimes(1);
    const input = capture.mock.calls[0][0] as BugReportInput;
    expect(input.category).toBe("renderer-rejection");
    expect(input.message).toBe("plain");
    expect(input.errorName).toBeUndefined();
  });

  it("does not throw without a bridge", () => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderBoundary(<Boom />)).not.toThrow();
    errorSpy.mockRestore();

    pushGlobalHandlers();
    expect(() => {
      window.dispatchEvent(
        new ErrorEvent("error", { message: "boom", error: new Error("boom") }),
      );
      dispatchRejection(new Error("nope"));
    }).not.toThrow();
  });
});
