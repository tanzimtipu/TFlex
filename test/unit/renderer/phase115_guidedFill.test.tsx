// @vitest-environment jsdom
//
// Phase 115 (TFL-1227 chunk C) - Guided Fill shared field primitives.
//
// Pins the truthfulness + accessibility contract of GuidedFillPrimitives:
//   - the required marker renders ONLY for `field.required === true`;
//   - the error node is present and `aria-describedby` on the control resolves
//     to it (never colour alone);
//   - `validateFieldValue` asserts the required/empty rule and nothing else;
//   - `RequiredSummary` shows the DOCUMENT and PAGE totals as separate figures.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FormField } from "../../../src/shared/types";
import {
  FieldRow,
  RequiredSummary,
  validateFieldValue,
} from "../../../src/renderer/forms/GuidedFillPrimitives";

function field(overrides: Partial<FormField> = {}): FormField {
  return {
    id: "f1",
    name: "Full name",
    page: 1,
    kind: "text",
    rect: { x: 0, y: 0, width: 120, height: 14 },
    value: "",
    ...overrides,
  };
}

function render(node: ReactElement): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act((): void => {
    root.render(node);
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

describe("FieldRow - required marker", () => {
  it("renders the marker only when field.required === true", () => {
    const required = render(
      <FieldRow field={field({ required: true })} controlId="gf-req" control={<input />} />,
    );
    try {
      const marker = required.host.querySelector('[data-form-required="true"]');
      expect(marker).not.toBeNull();
      expect(marker?.closest(".guided-fill-label")).not.toBeNull();
    } finally {
      required.unmount();
    }

    const notRequired = render(
      <FieldRow field={field({ required: false })} controlId="gf-opt" control={<input />} />,
    );
    try {
      expect(notRequired.host.querySelector('[data-form-required="true"]')).toBeNull();
    } finally {
      notRequired.unmount();
    }

    const absent = render(
      <FieldRow field={field()} controlId="gf-none" control={<input />} />,
    );
    try {
      expect(absent.host.querySelector('[data-form-required="true"]')).toBeNull();
    } finally {
      absent.unmount();
    }
  });
});

describe("FieldRow - label, guidance and error association", () => {
  it("wires aria-describedby from the control to the error element", () => {
    const { host, unmount } = render(
      <FieldRow
        field={field({ required: true })}
        controlId="gf-name"
        control={<input type="text" />}
        guidance="Exactly as printed on your ID."
        error="This field is required."
      />,
    );
    try {
      const input = host.querySelector("input");
      expect(input).not.toBeNull();
      expect(input?.id).toBe("gf-name");
      expect(input?.getAttribute("aria-invalid")).toBe("true");
      expect(input?.getAttribute("aria-required")).toBe("true");

      const errorEl = host.querySelector("[data-form-error]");
      expect(errorEl).not.toBeNull();
      expect(errorEl?.textContent).toContain("This field is required.");

      const describedBy = input?.getAttribute("aria-describedby") ?? "";
      const ids = describedBy.split(/\s+/).filter((s) => s.length > 0);
      expect(errorEl?.id).not.toBe("");
      expect(ids).toContain(errorEl?.id);

      const guidanceEl = host.querySelector(".guided-fill-guidance");
      expect(guidanceEl).not.toBeNull();
      expect(ids).toContain(guidanceEl?.id);

      const label = host.querySelector("label.guided-fill-label");
      expect(label?.getAttribute("for")).toBe("gf-name");
    } finally {
      unmount();
    }
  });

  it("omits the error node and its description when there is no error", () => {
    const { host, unmount } = render(
      <FieldRow field={field()} controlId="gf-ok" control={<input type="text" />} />,
    );
    try {
      expect(host.querySelector("[data-form-error]")).toBeNull();
      const input = host.querySelector("input");
      expect(input?.getAttribute("aria-describedby")).toBeNull();
      expect(input?.getAttribute("aria-invalid")).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("validateFieldValue - the required/empty rule only", () => {
  it("is invalid with the required message for a required empty field", () => {
    expect(validateFieldValue(field({ required: true, value: "" }))).toEqual({
      valid: false,
      message: "This field is required.",
    });
    expect(validateFieldValue(field({ required: true, value: [] }))).toEqual({
      valid: false,
      message: "This field is required.",
    });
  });

  it("is valid for a non-required empty field", () => {
    expect(validateFieldValue(field({ value: "" }))).toEqual({
      valid: true,
      message: null,
    });
    expect(validateFieldValue(field({ required: false, value: [] }))).toEqual({
      valid: true,
      message: null,
    });
  });

  it("is valid for a filled field", () => {
    expect(validateFieldValue(field({ required: true, value: "Ada" }))).toEqual({
      valid: true,
      message: null,
    });
    expect(validateFieldValue(field({ required: true, value: ["Yes"] }))).toEqual({
      valid: true,
      message: null,
    });
  });
});

describe("RequiredSummary - document and page figures stay separate", () => {
  const fields: FormField[] = [
    field({ id: "a", page: 1, required: true, value: "Ada" }),
    field({ id: "b", page: 1, required: true, value: "" }),
    field({ id: "c", page: 2, required: true, value: "" }),
    field({ id: "d", page: 2, required: false, value: "" }),
  ];

  it("shows the document total and, given a page, the page total separately", () => {
    const { host, unmount } = render(<RequiredSummary fields={fields} page={1} />);
    try {
      const doc = host.querySelector('[data-form-required-scope="document"]');
      const pg = host.querySelector('[data-form-required-scope="page"]');
      expect(doc).not.toBeNull();
      expect(pg).not.toBeNull();

      const docFigure = doc?.querySelector(".guided-fill-summary-figure");
      const pgFigure = pg?.querySelector(".guided-fill-summary-figure");
      expect(docFigure).not.toBe(pgFigure);
      expect(docFigure?.getAttribute("data-form-required-completed")).toBe("1");
      expect(docFigure?.getAttribute("data-form-required-total")).toBe("3");
      expect(pgFigure?.getAttribute("data-form-required-completed")).toBe("1");
      expect(pgFigure?.getAttribute("data-form-required-total")).toBe("2");
    } finally {
      unmount();
    }
  });

  it("omits the page figure when no page is given", () => {
    const { host, unmount } = render(<RequiredSummary fields={fields} />);
    try {
      expect(host.querySelector('[data-form-required-summary]')).not.toBeNull();
      expect(host.querySelector('[data-form-required-scope="document"]')).not.toBeNull();
      expect(host.querySelector('[data-form-required-scope="page"]')).toBeNull();
    } finally {
      unmount();
    }
  });
});
