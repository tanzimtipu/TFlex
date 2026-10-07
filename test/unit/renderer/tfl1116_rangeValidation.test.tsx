// @vitest-environment jsdom
//
// TFL-1116 (C14, R22) — range validation explains the REAL reason.
//
// R22: entering `0,521` on a 520-page document disabled the action but the
// helper claimed the EMPTY reason ("Enter at least one page..."). The range
// field now distinguishes empty / malformed / out-of-bounds / valid, keeps the
// typed value, links the message to the field via aria-describedby and never
// runs the operation on an invalid range.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SplitDialog, type SplitConfirm } from "../../../src/renderer/components/SplitDialog";
import { validateExportRange } from "../../../src/renderer/components/exportConfig";
import { classifyPageRange, parsePageRange } from "../../../src/renderer/engine/types";

const EMPTY_MESSAGE = "Enter at least one page (e.g. 1-3).";
const MALFORMED_MESSAGE = "Enter pages like 1-3 or 2,4.";
const OOB_520_MESSAGE = "Pages 0, 521 are outside the document's 1-520 pages.";

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  act((): void => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function renderDialog(
  totalPages: number,
  onConfirm: (c: SplitConfirm) => void,
): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act((): void => {
    root.render(
      <SplitDialog
        open
        totalPages={totalPages}
        onClose={(): void => undefined}
        onConfirm={onConfirm}
      />,
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

function rangeInput(host: HTMLElement): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>("#split-page-range");
  if (el === null) throw new Error("no range input");
  return el;
}

function statusText(host: HTMLElement): string {
  return host.querySelector<HTMLElement>("#split-range-status")?.textContent?.trim() ?? "";
}

function confirmButton(host: HTMLElement): HTMLButtonElement {
  const el = host.querySelector<HTMLButtonElement>('[data-dialog-action="confirm"]');
  if (el === null) throw new Error("no confirm action");
  return el;
}

describe("classifyPageRange — the four states", () => {
  it("distinguishes empty, malformed, out-of-bounds and valid", () => {
    expect(classifyPageRange("", 520).state).toBe("empty");
    expect(classifyPageRange("   ", 520).state).toBe("empty");
    expect(classifyPageRange("abc", 520).state).toBe("malformed");
    expect(classifyPageRange("9-2", 520).state).toBe("malformed");
    expect(classifyPageRange("0,521", 520).state).toBe("out-of-bounds");
    expect(classifyPageRange("1-3", 520).state).toBe("valid");
  });

  it("keeps parsePageRange's null-only contract", () => {
    expect(parsePageRange("0,521", 520)).toBeNull();
    expect(parsePageRange("", 520)).toBeNull();
    expect(parsePageRange("1-3", 5)).toEqual([1, 2, 3]);
  });
});

describe("AR-07 — out-of-bounds names the offending token AND the bound", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["999", "Page 999 is outside the document's 1-34 pages."],
    ["0", "Page 0 is outside the document's 1-34 pages."],
    ["1-999", "Page 999 is outside the document's 1-34 pages."],
    ["1-3,999", "Page 999 is outside the document's 1-34 pages."],
  ];

  for (const [input, message] of cases) {
    it(`"${input}" on a 34-page doc names the token and the 1-34 bound`, () => {
      const check = classifyPageRange(input, 34);
      expect(check.state).toBe("out-of-bounds");
      expect(check.pages).toBeNull();
      expect(check.message).toBe(message);
    });
  }

  it("names every invalid token, in input order, when several are out of bounds", () => {
    const check = classifyPageRange("999,0", 34);
    expect(check.invalidTokens).toEqual([999, 0]);
    expect(check.message).toBe("Pages 999, 0 are outside the document's 1-34 pages.");
  });

  it("keeps the empty and malformed wording byte-for-byte", () => {
    expect(classifyPageRange("", 34).message).toBe(EMPTY_MESSAGE);
    expect(classifyPageRange("   ", 34).message).toBe(EMPTY_MESSAGE);
    expect(classifyPageRange("9-2", 34).message).toBe(MALFORMED_MESSAGE);
    expect(classifyPageRange("abc", 34).message).toBe(MALFORMED_MESSAGE);
  });

  it("DEF-630 — a wholly-above-range span names BOTH endpoints", () => {
    const above = classifyPageRange("50-60", 34);
    expect(above.state).toBe("out-of-bounds");
    expect(above.pages).toBeNull();
    expect(above.message).toBe("Pages 50, 60 are outside the document's 1-34 pages.");

    const higher = classifyPageRange("35-40", 34);
    expect(higher.state).toBe("out-of-bounds");
    expect(higher.message).toBe("Pages 35, 40 are outside the document's 1-34 pages.");
  });

  it("DEF-629 — a trailing-garbage token is malformed, not valid", () => {
    for (const token of ["1abc", "2-3x", "1.9", "12px"]) {
      const check = classifyPageRange(token, 34);
      expect(check.state).toBe("malformed");
      expect(check.pages).toBeNull();
      expect(check.message).toBe(MALFORMED_MESSAGE);
    }
  });
});

describe("validateExportRange — the shared range message path", () => {
  it("names the real bound for an out-of-bounds range", () => {
    const check = validateExportRange("0,521", 520);
    expect(check.valid).toBe(false);
    expect(check.error).toBe(OOB_520_MESSAGE);
  });

  it("keeps the empty wording and the no-document guard", () => {
    expect(validateExportRange("", 520).error).toBe(EMPTY_MESSAGE);
    expect(validateExportRange("1-3", 0).error).toBe("Open a document first.");
  });
});

describe("SplitDialog R22 — the field explains the real reason", () => {
  it("says out-of-bounds (not empty) for 0,521 on a 520-page doc", () => {
    const onConfirm = vi.fn();
    const { host, unmount } = renderDialog(520, onConfirm);
    try {
      const input = rangeInput(host);
      setInputValue(input, "0,521");
      expect(input.value).toBe("0,521");
      expect(input.getAttribute("aria-describedby")).toBe("split-range-status");
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(statusText(host)).toBe(OOB_520_MESSAGE);
      expect(statusText(host)).not.toBe(EMPTY_MESSAGE);
      expect(host.querySelector("#split-range-status")?.getAttribute("data-range-state")).toBe(
        "out-of-bounds",
      );
      expect(confirmButton(host).disabled).toBe(true);
      act((): void => {
        confirmButton(host).click();
      });
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("reports empty, malformed and valid states", () => {
    const onConfirm = vi.fn();
    const { host, unmount } = renderDialog(520, onConfirm);
    try {
      const input = rangeInput(host);
      setInputValue(input, "");
      expect(statusText(host)).toBe(EMPTY_MESSAGE);
      expect(confirmButton(host).disabled).toBe(true);

      setInputValue(input, "9-2");
      expect(statusText(host)).toBe(MALFORMED_MESSAGE);
      expect(confirmButton(host).disabled).toBe(true);

      setInputValue(input, "1-3");
      expect(input.getAttribute("aria-invalid")).toBe("false");
      expect(statusText(host)).toBe("3 pages selected");
      expect(confirmButton(host).disabled).toBe(false);
      act((): void => {
        confirmButton(host).click();
      });
      expect(onConfirm).toHaveBeenCalledWith({ range: [1, 2, 3], mode: "extract" });
    } finally {
      unmount();
    }
  });
});
