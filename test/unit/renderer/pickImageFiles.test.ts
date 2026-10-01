// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pickImageFilesInRenderer,
  readFileBytes,
} from "../../../src/renderer/utils/pickImageFiles";

/**
 * Phase 9 — Renderer-side image picker tests.
 *
 * The picker builds a transient <input type="file"> in the DOM,
 * wires a change handler, and resolves with the picked File list.
 * jsdom has DataTransfer in modern versions but older Node + jsdom
 * combos omit it; we use Object.defineProperty to set input.files
 * directly because the change handler just reads input.files.
 */

function makeFile(name: string, type: string, bytes: number[] = [0x89, 0x50, 0x4e, 0x47]): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function setInputFiles(input: HTMLInputElement, files: File[]): void {
  // jsdom may not expose DataTransfer, but it does expose the
  // FileList constructor via the prototype's `files` setter. We
  // monkey-patch via defineProperty so React's input handler sees
  // the picked list.
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
}

const PICKER_SELECTOR = 'input[type="file"][accept^="image/"]';

/** The picker appends its transient <input> to document.body inside
 *  the Promise executor, synchronously, before
 *  pickImageFilesInRenderer() returns. So we can find and drive it
 *  without waiting on a real timer tick. */
function driveInputPicker(files: File[]): void {
  const input = document.querySelector<HTMLInputElement>(PICKER_SELECTOR);
  expect(input).not.toBeNull();
  if (input === null) throw new Error("picker input not found in document.body");
  setInputFiles(input, files);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => {
  // Restore real timers and drop any <input> a picker may have left in
  // the DOM so no test can leak state into the next one.
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("pickImageFilesInRenderer — file picker contract", () => {
  it("resolves with the picked File objects", async () => {
    const picker = pickImageFilesInRenderer();
    const files = [makeFile("a.png", "image/png"), makeFile("b.jpg", "image/jpeg")];
    driveInputPicker(files);
    const result = await picker;
    expect(result.files.length).toBe(2);
    expect(result.files[0]?.name).toBe("a.png");
    expect(result.files[1]?.name).toBe("b.jpg");
  });

  it("resolves with empty arrays when focus fires and no change ever lands (cancel fallback)", async () => {
    // jsdom has no native OS dialog. In production the dialog closing
    // refocuses the window, which fires the picker's focus-back poll.
    // We drive that exact path: dispatch focus, advance the poll
    // window with FAKE timers, and assert the picker resolves empty.
    // Using fake timers makes this deterministic (no real 800ms wait)
    // and, crucially, resolves the picker so its `window` focus
    // capture listener and <input> are cleaned up instead of leaking
    // into the next test (this was the root of the cross-test race).
    vi.useFakeTimers();
    const picker = pickImageFilesInRenderer();
    expect(document.querySelector(PICKER_SELECTOR)).not.toBeNull();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(800);
    const result = await picker;
    expect(result.files).toEqual([]);
    expect(result.paths).toEqual([]);
  });
});

describe("pickImageFilesInRenderer — focus-race regression (DEF-046)", () => {
  // DEF-046: the original implementation resolved the picker with
  // empty arrays 200ms after the `focus` event fired. In automated
  // environments (Playwright + Electron) the focus event can fire
  // BEFORE the `change` event on the input, so the picker resolved
  // with no files even when the user had picked some. The fix polls
  // the input's `files` after a longer window (CANCEL_POLL_MS = 800)
  // and resolves with whatever the input has at that point.

  it("resolves empty when focus fires and no change ever lands", async () => {
    // The fallback path: the user opened the picker, the OS dialog
    // closed (focus fired), and no change event ever arrived. With
    // FAKE timers we can prove the poll window is still open at the
    // old 200ms cancel mark and only resolves once CANCEL_POLL_MS
    // (800ms) has elapsed — deterministically, with no real wall-clock
    // wait racing the 5s test timeout.
    vi.useFakeTimers();
    const start = Date.now();
    const picker = pickImageFilesInRenderer();
    expect(document.querySelector(PICKER_SELECTOR)).not.toBeNull();
    window.dispatchEvent(new Event("focus"));

    let settled = false;
    void picker.then(() => {
      settled = true;
    });

    // Not resolved at the original 200ms window (the DEF-046 bug)...
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(false);
    // ...nor just before the configured 800ms poll completes.
    await vi.advanceTimersByTimeAsync(550);
    expect(settled).toBe(false);

    // Resolves once the full poll window elapses.
    await vi.advanceTimersByTimeAsync(50);
    const result = await picker;
    const elapsed = Date.now() - start;

    expect(result.files).toEqual([]);
    expect(result.paths).toEqual([]);
    // Sanity check: the poll window is the 800ms guard from DEF-046,
    // well above the 200ms path that caused the regression.
    expect(elapsed).toBeGreaterThanOrEqual(750);
  });
});

describe("readFileBytes — Uint8Array conversion", () => {
  it("returns the bytes of a File as a Uint8Array", async () => {
    const f = makeFile("a.png", "image/png", [1, 2, 3, 4, 5]);
    const bytes = await readFileBytes(f);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(5);
    expect(bytes[0]).toBe(1);
    expect(bytes[4]).toBe(5);
  });

  it("handles empty files", async () => {
    const f = makeFile("empty.png", "image/png", []);
    const bytes = await readFileBytes(f);
    expect(bytes.length).toBe(0);
  });
});
