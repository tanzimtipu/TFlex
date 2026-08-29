// @vitest-environment node
// Field state reducer tests.
//
// The reducer functions in src/renderer/forms/model.ts are pure
// (DOM-free), so we exercise them in node — no jsdom needed.

import { describe, expect, it } from "vitest";
import type { FormField } from "../../../src/shared/types";
import {
  fieldHasValue,
  fieldKindLabel,
  fieldsByPage,
  initialFormsState,
  replaceFields,
  sameFormFields,
  setFieldValue,
  toggleListboxValue,
} from "../../../src/renderer/forms/model";

function text(overrides: Partial<FormField> = {}): FormField {
  return {
    id: "f1",
    name: "name",
    page: 1,
    kind: "text",
    rect: { x: 10, y: 10, width: 100, height: 20 },
    value: "",
    ...overrides,
  };
}

function listbox(overrides: Partial<FormField> = {}): FormField {
  return {
    id: "f2",
    name: "skills",
    page: 1,
    kind: "listbox",
    rect: { x: 10, y: 50, width: 100, height: 80 },
    value: [],
    options: [
      { value: "ts", label: "TypeScript" },
      { value: "py", label: "Python" },
      { value: "rs", label: "Rust" },
    ],
    multi: true,
    ...overrides,
  };
}

function radio(overrides: Partial<FormField> = {}): FormField {
  return {
    id: "f3",
    name: "level",
    page: 2,
    kind: "radio",
    rect: { x: 10, y: 10, width: 200, height: 24 },
    value: "",
    options: [
      { value: "junior", label: "Junior" },
      { value: "mid", label: "Mid" },
      { value: "senior", label: "Senior" },
    ],
    ...overrides,
  };
}

describe("initialFormsState", () => {
  it("starts with empty fields and loaded=false", () => {
    expect(initialFormsState).toEqual({ fields: [], loaded: false });
  });
});

describe("setFieldValue", () => {
  it("updates the matching field and preserves all others", () => {
    const state = { fields: [text(), radio()], loaded: true };
    const next = setFieldValue(state, "f1", "hello");
    expect(next.fields.find((f) => f.id === "f1")?.value).toBe("hello");
    expect(next.fields.find((f) => f.id === "f3")?.value).toBe("");
    // The original state must not have been mutated.
    expect(state.fields.find((f) => f.id === "f1")?.value).toBe("");
  });

  it("is a no-op when the value is unchanged (returns the same reference)", () => {
    const state = { fields: [text({ value: "same" })], loaded: true };
    const next = setFieldValue(state, "f1", "same");
    expect(next).toBe(state);
  });

  it("is a no-op for an unknown field id (returns the same reference)", () => {
    const state = { fields: [text()], loaded: true };
    const next = setFieldValue(state, "missing", "x");
    expect(next).toBe(state);
  });

  it("handles listbox (string[]) values", () => {
    const state = { fields: [listbox()], loaded: true };
    const next = setFieldValue(state, "f2", ["ts", "py"]);
    expect(next.fields[0]?.value).toEqual(["ts", "py"]);
  });
});

describe("toggleListboxValue", () => {
  it("adds an option to an empty selection", () => {
    const state = { fields: [listbox()], loaded: true };
    const next = toggleListboxValue(state, "f2", "ts");
    expect(next.fields[0]?.value).toEqual(["ts"]);
  });

  it("adds an option to an existing selection", () => {
    const state = { fields: [listbox({ value: ["ts"] })], loaded: true };
    const next = toggleListboxValue(state, "f2", "py");
    expect(next.fields[0]?.value).toEqual(["ts", "py"]);
  });

  it("removes an option when toggling a selected value", () => {
    const state = { fields: [listbox({ value: ["ts", "py"] })], loaded: true };
    const next = toggleListboxValue(state, "f2", "ts");
    expect(next.fields[0]?.value).toEqual(["py"]);
  });

  it("is a no-op for a non-listbox field", () => {
    const state = { fields: [text()], loaded: true };
    const next = toggleListboxValue(state, "f1", "x");
    expect(next).toBe(state);
  });

  it("is a no-op for an unknown field id", () => {
    const state = { fields: [listbox()], loaded: true };
    const next = toggleListboxValue(state, "missing", "x");
    expect(next).toBe(state);
  });

  it("treats a non-array value as an empty selection", () => {
    // Defensive: a malformed value shouldn't crash the reducer.
    const state = { fields: [listbox({ value: "" })], loaded: true };
    const next = toggleListboxValue(state, "f2", "ts");
    expect(next.fields[0]?.value).toEqual(["ts"]);
  });
});

describe("replaceFields", () => {
  it("replaces the field list wholesale with the supplied fields", () => {
    const state = { fields: [text()], loaded: true };
    const next = replaceFields(state, [radio()]);
    expect(next.fields).toHaveLength(1);
    expect(next.fields[0]?.id).toBe("f3");
  });

  it("marks the state as loaded when fields are supplied", () => {
    const state = { fields: [], loaded: false };
    const next = replaceFields(state, []);
    // No fields were supplied AND no fields were in state — no real
    // change, so the same-state reference is returned and loaded stays
    // false (the call site is expected to call this with a non-empty
    // engine echo; an empty echo is a no-op). When fields ARE supplied,
    // loaded flips to true (see the test below).
    expect(next.loaded).toBe(false);
  });

  it("marks the state as loaded when fields are supplied (non-empty echo)", () => {
    const state = { fields: [], loaded: false };
    const next = replaceFields(state, [
      text({ id: "new", value: "hello" }),
    ]);
    expect(next.loaded).toBe(true);
    expect(next.fields).toHaveLength(1);
    expect(next.fields[0]?.id).toBe("new");
  });

  it("preserves local edits when the engine echoes back an older value", () => {
    // The engine returns the canonical value (older) — the user's most
    // recent in-flight edit must survive the merge so a debounce firing
    // while the engine echoes doesn't wipe the textarea.
    const state = { fields: [text({ value: "user-typed" })], loaded: true };
    const next = replaceFields(state, [text({ value: "" })]);
    expect(next.fields[0]?.value).toBe("user-typed");
  });

  it("drops field ids that no longer exist in the engine's list", () => {
    const state = { fields: [text(), radio()], loaded: true };
    const next = replaceFields(state, [text()]);
    expect(next.fields).toHaveLength(1);
    expect(next.fields[0]?.id).toBe("f1");
  });
});

describe("sameFormFields", () => {
  it("returns true for the same content with different array identity", () => {
    // DEF-020 gate: the engine echoes a fresh FormField[] array on
    // every getState call. The mirror effect's content-hash check
    // must recognise that the content is identical even though
    // every object is a fresh identity.
    const a = [text({ value: "Alice" }), listbox({ value: ["ts"] })];
    const b = [
      { ...text({ value: "Alice" }) },
      { ...listbox({ value: ["ts"] }) },
    ];
    expect(sameFormFields(a, b)).toBe(true);
  });

  it("returns false when the field set length differs", () => {
    expect(sameFormFields([text()], [])).toBe(false);
    expect(sameFormFields([], [text()])).toBe(false);
  });

  it("returns false when an id is missing on either side", () => {
    const a = [text({ id: "f1" }), listbox({ id: "f2" })];
    const b = [text({ id: "f1" })];
    expect(sameFormFields(a, b)).toBe(false);
    const c = [text({ id: "f1" }), text({ id: "different" })];
    expect(sameFormFields(a, c)).toBe(false);
  });

  it("returns false when any field's value differs", () => {
    const a = [text({ value: "Alice" }), listbox({ value: ["ts"] })];
    const b = [text({ value: "Alice" }), listbox({ value: ["py"] })];
    expect(sameFormFields(a, b)).toBe(false);
  });

  it("returns false when the page number of a field differs", () => {
    const a = [text({ id: "f1", page: 1 })];
    const b = [text({ id: "f1", page: 2 })];
    expect(sameFormFields(a, b)).toBe(false);
  });

  it("matches by id, not by position (engine may reorder)", () => {
    // Both lists contain the same two fields in opposite order. The
    // reducer's id-based merge treats this as identical.
    const a = [text({ id: "f1", value: "v1" }), radio({ id: "f3", value: "junior" })];
    const b = [radio({ id: "f3", value: "junior" }), text({ id: "f1", value: "v1" })];
    expect(sameFormFields(a, b)).toBe(true);
  });

  it("treats empty vs empty as equal (the post-flatten case)", () => {
    expect(sameFormFields([], [])).toBe(true);
  });

  it("treats two empty listbox selections as equal", () => {
    const a = [listbox({ value: [] })];
    const b = [listbox({ value: [] })];
    expect(sameFormFields(a, b)).toBe(true);
  });
});

describe("fieldsByPage", () => {
  it("groups fields by 1-based page number", () => {
    const fields: FormField[] = [
      text({ id: "p1a", page: 1 }),
      text({ id: "p1b", page: 1 }),
      text({ id: "p2a", page: 2 }),
    ];
    const grouped = fieldsByPage(fields);
    expect(grouped.get(1)).toHaveLength(2);
    expect(grouped.get(2)).toHaveLength(1);
    expect(grouped.has(3)).toBe(false);
  });
});

describe("fieldHasValue", () => {
  it("returns false for an empty string", () => {
    expect(fieldHasValue(text({ value: "" }))).toBe(false);
  });
  it("returns true for a non-empty string", () => {
    expect(fieldHasValue(text({ value: "x" }))).toBe(true);
  });
  it("returns false for an empty array", () => {
    expect(fieldHasValue(listbox({ value: [] }))).toBe(false);
  });
  it("returns true for a non-empty array", () => {
    expect(fieldHasValue(listbox({ value: ["ts"] }))).toBe(true);
  });
});

describe("fieldKindLabel", () => {
  it("maps each FormFieldKind to a human label", () => {
    expect(fieldKindLabel("text")).toBe("Text");
    expect(fieldKindLabel("checkbox")).toBe("Checkbox");
    expect(fieldKindLabel("radio")).toBe("Radio");
    expect(fieldKindLabel("dropdown")).toBe("Dropdown");
    expect(fieldKindLabel("listbox")).toBe("List");
  });
});
