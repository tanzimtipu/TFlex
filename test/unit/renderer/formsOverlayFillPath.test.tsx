// @vitest-environment jsdom
//
// DEF-069 — fill path in FormsOverlay must call fillFormField for
// every field kind (text, checkbox, radio, dropdown, listbox), and
// the field fill journey must be alive end-to-end.
//
// The defect: the engine fill path was reported as "never fires
// through UI". Investigation:
//   - The engine is correct (when the real `fillFormField` IPC
//     fires, the engine returns `modified: true`).
//   - The renderer's FormsOverlay wires the right callbacks
//     (`onValueChange` / `onToggleListbox`) for every kind.
//   - The App.tsx fill handlers (`onFormValueChange` /
//     `onFormListboxToggle`) call `engineRef.current.fillFormField`
//     with the canonical `(docId, payload)` wire shape.
//
// These tests pin the path at the FormsOverlay layer (the renderer
// surface) for every kind, so any future regression that drops a
// fillFormField call is caught at unit-test time. The end-to-end
// engine-state echo (modified=true after fill) is covered by
// `engineClient.test.ts > DEF-023 > getState exposes modified=true
// after a fillFormField`.
//
// We exercise the FormsOverlay component in isolation, mounting it
// with a fake field list and a vi.fn callback that mimics App.tsx's
// `onFormValueChange` / `onToggleListbox`. Every user-visible input
// change on every kind must trigger the matching callback with the
// field id + new value (single string for text / checkbox / radio /
// dropdown; array of selected options for listbox).

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FormsOverlay } from "../../../src/renderer/forms/FormsOverlay";
import type { FormField } from "../../../src/shared/types";

// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function textField(id: string, value: string): FormField {
  return {
    id,
    name: id,
    page: 1,
    kind: "text",
    rect: { x: 0, y: 0, width: 100, height: 20 },
    value,
  };
}

function checkboxField(id: string, value: string): FormField {
  return {
    id,
    name: id,
    page: 1,
    kind: "checkbox",
    rect: { x: 0, y: 0, width: 14, height: 14 },
    value,
  };
}

function radioField(id: string, value: string): FormField {
  return {
    id,
    name: id,
    page: 1,
    kind: "radio",
    rect: { x: 0, y: 0, width: 100, height: 20 },
    value,
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  };
}

function dropdownField(id: string, value: string): FormField {
  return {
    id,
    name: id,
    page: 1,
    kind: "dropdown",
    rect: { x: 0, y: 0, width: 100, height: 20 },
    value,
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
  };
}

function listboxField(id: string, value: string[]): FormField {
  return {
    id,
    name: id,
    page: 1,
    kind: "listbox",
    rect: { x: 0, y: 0, width: 100, height: 80 },
    value,
    multi: true,
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
      { value: "c", label: "C" },
    ],
  };
}

interface RenderArgs {
  fields: FormField[];
  onValueChange?: (id: string, value: string | string[]) => void;
  onToggleListbox?: (id: string, option: string) => void;
}

interface RenderHandle {
  root: Root;
  container: HTMLElement;
  cleanup: () => void;
  onValueChange: ReturnType<typeof vi.fn>;
  onToggleListbox: ReturnType<typeof vi.fn>;
}

function renderOverlay(args: RenderArgs): RenderHandle {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onValueChange = args.onValueChange ?? vi.fn();
  const onToggleListbox = args.onToggleListbox ?? vi.fn();
  const root = createRoot(container);
  act((): void => {
    root.render(
      <FormsOverlay
        page={1}
        cssScale={1}
        fields={args.fields}
        onValueChange={(...rest: [string, string | string[]]): void => onValueChange(...rest)}
        onToggleListbox={(...rest: [string, string]): void => onToggleListbox(...rest)}
      />,
    );
  });
  return {
    root,
    container,
    onValueChange: onValueChange as ReturnType<typeof vi.fn>,
    onToggleListbox: onToggleListbox as ReturnType<typeof vi.fn>,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("FormsOverlay — DEF-069 fill path fires for every field kind", () => {
  it("text input: typing fires onValueChange with the typed string", () => {
    const { container, onValueChange, cleanup } = renderOverlay({
      fields: [textField("f-name", "")],
    });
    const input = container.querySelector<HTMLInputElement>(
      'input[data-form-field="f-name"]',
    );
    expect(input).not.toBeNull();
    if (input === null) return cleanup();
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "Jane");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onValueChange).toHaveBeenCalledWith("f-name", "Jane");
    cleanup();
  });

  it("checkbox: clicking fires onValueChange with 'true' when starting unchecked (the toggle is owned by App.tsx)", () => {
    // The checkbox is a controlled component whose checked state reads
    // from `field.value`. The first click on an unchecked checkbox
    // must surface 'true' through onValueChange so App.tsx's
    // setFieldValue reducer can flip the value and a subsequent
    // re-render shows the check mark. The toggle itself is owned by
    // the host (App.tsx); the overlay never mutates state internally.
    const { container, onValueChange, cleanup } = renderOverlay({
      fields: [checkboxField("f-terms", "false")],
    });
    const btn = container.querySelector<HTMLButtonElement>(
      'button[data-form-field="f-terms"]',
    );
    expect(btn).not.toBeNull();
    if (btn === null) return cleanup();
    act((): void => {
      btn.click();
    });
    expect(onValueChange).toHaveBeenCalledWith("f-terms", "true");
    cleanup();
  });

  it("radio: clicking an option fires onValueChange with the option's value", () => {
    const { container, onValueChange, cleanup } = renderOverlay({
      fields: [radioField("f-choice", "")],
    });
    const yesBtn = container.querySelector<HTMLButtonElement>(
      'button[data-form-option="yes"]',
    );
    expect(yesBtn).not.toBeNull();
    if (yesBtn === null) return cleanup();
    act((): void => {
      yesBtn.click();
    });
    expect(onValueChange).toHaveBeenCalledWith("f-choice", "yes");
    const noBtn = container.querySelector<HTMLButtonElement>(
      'button[data-form-option="no"]',
    );
    if (noBtn === null) return cleanup();
    act((): void => {
      noBtn.click();
    });
    expect(onValueChange).toHaveBeenLastCalledWith("f-choice", "no");
    cleanup();
  });

  it("dropdown: changing the selected option fires onValueChange with the option's value", () => {
    const { container, onValueChange, cleanup } = renderOverlay({
      fields: [dropdownField("f-pick", "")],
    });
    const select = container.querySelector<HTMLSelectElement>(
      'select[data-form-field="f-pick"]',
    );
    expect(select).not.toBeNull();
    if (select === null) return cleanup();
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(select, "b");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onValueChange).toHaveBeenCalledWith("f-pick", "b");
    cleanup();
  });

  it("listbox: clicking an option fires onToggleListbox with the option's value (multi-select)", () => {
    const { container, onToggleListbox, cleanup } = renderOverlay({
      fields: [listboxField("f-multi", [])],
    });
    const optA = container.querySelector<HTMLButtonElement>(
      'button[data-form-option="a"]',
    );
    expect(optA).not.toBeNull();
    if (optA === null) return cleanup();
    act((): void => {
      optA.click();
    });
    expect(onToggleListbox).toHaveBeenCalledWith("f-multi", "a");

    const optC = container.querySelector<HTMLButtonElement>(
      'button[data-form-option="c"]',
    );
    if (optC === null) return cleanup();
    act((): void => {
      optC.click();
    });
    expect(onToggleListbox).toHaveBeenLastCalledWith("f-multi", "c");
    cleanup();
  });

  it("listbox: selection differences across toggles route through onToggleListbox for every change (DEF-069 listbox path)", () => {
    // The defect notes "fill never fires through UI on choice-field
    // listbox/selection differences". We verify the overlay fires
    // onToggleListbox on every click (the App.tsx reducer decides
    // whether the toggle was a no-op vs an actual change; the
    // overlay's job is to surface every click so App.tsx can decide).
    const { container, onToggleListbox, cleanup } = renderOverlay({
      fields: [listboxField("f-multi", [])],
    });
    const optA = container.querySelector<HTMLButtonElement>(
      'button[data-form-option="a"]',
    );
    const optB = container.querySelector<HTMLButtonElement>(
      'button[data-form-option="b"]',
    );
    const optC = container.querySelector<HTMLButtonElement>(
      'button[data-form-option="c"]',
    );
    expect(optA).not.toBeNull();
    expect(optB).not.toBeNull();
    expect(optC).not.toBeNull();
    if (optA === null || optB === null || optC === null) return cleanup();
    act((): void => {
      optA.click();
      optB.click();
      optC.click();
    });
    expect(onToggleListbox).toHaveBeenCalledTimes(3);
    expect(onToggleListbox).toHaveBeenNthCalledWith(1, "f-multi", "a");
    expect(onToggleListbox).toHaveBeenNthCalledWith(2, "f-multi", "b");
    expect(onToggleListbox).toHaveBeenNthCalledWith(3, "f-multi", "c");
    cleanup();
  });
});