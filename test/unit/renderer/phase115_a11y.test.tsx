// @vitest-environment jsdom
//
// Phase 115 H (TFL-1338) - Guided Fill accessibility + adaptation, and the
// document-switch staleness guard.
//
// (a) static CSS guard: the .guided-fill-* block must carry a forced-colors
//     rule, a reduced-motion rule and a narrow-width panel-host rule.
// (b) staleness: remounting the panel under a new React key discards its local
//     errors map (the App mount keys the panel on the active engine doc id).
// (c) long labels: the label text renders intact with no nowrap truncation.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GuidedFillPanel } from "../../../src/renderer/forms/GuidedFillPanel";
import type { FormField } from "../../../src/shared/types";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractBraceBody(src: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(openIndex + 1, i);
    }
  }
  return "";
}

/** Every body of an exact `@media <query> { ... }` block. */
function mediaBlocks(src: string, query: string): string[] {
  const needle = `@media ${query}`;
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const idx = src.indexOf(needle, from);
    if (idx === -1) break;
    let cursor = idx + needle.length;
    while (cursor < src.length && /\s/.test(src[cursor] ?? "")) cursor += 1;
    if (src[cursor] === "{") blocks.push(extractBraceBody(src, cursor));
    from = idx + needle.length;
  }
  return blocks;
}

const CSS = stripCssComments(readFileSync(STYLES_PATH, "utf8"));

describe("(a) styles.css - Guided Fill adaptation + accessibility guard", () => {
  it("a forced-colors block styles a .guided-fill- rule", () => {
    const blocks = mediaBlocks(CSS, "(forced-colors: active)");
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((b) => b.includes(".guided-fill-"))).toBe(true);
  });

  it("a prefers-reduced-motion block styles a .guided-fill- rule", () => {
    const blocks = mediaBlocks(CSS, "(prefers-reduced-motion: reduce)");
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((b) => b.includes(".guided-fill-"))).toBe(true);
  });

  it("a narrow-width block makes .guided-fill-panel-host full width", () => {
    const blocks = mediaBlocks(CSS, "(max-width: 900px)");
    expect(blocks.length).toBeGreaterThan(0);
    const hit = blocks.find((b) => b.includes(".guided-fill-panel-host"));
    expect(hit).toBeDefined();
    expect(hit ?? "").toMatch(/left\s*:\s*0/);
    expect(hit ?? "").toMatch(/width\s*:\s*auto/);
  });
});

function baseProps(field: FormField): Parameters<typeof GuidedFillPanel>[0] {
  return {
    fields: [field],
    currentPage: 1,
    totalPages: 1,
    onValueChange: (): void => {},
    onToggleListbox: (): void => {},
    onClose: (): void => {},
  };
}

function requiredField(): FormField {
  return {
    id: "f-required",
    name: "Full name",
    kind: "text",
    page: 1,
    rect: { x: 0, y: 0, width: 120, height: 20 },
    value: "",
    required: true,
  };
}

function mount(): { host: HTMLElement; root: Root } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return { host, root: createRoot(host) };
}

function teardown(host: HTMLElement, root: Root): void {
  act((): void => {
    root.unmount();
  });
  host.remove();
}

describe("(b) document switch discards the panel's local error state", () => {
  it("a new React key clears a previously shown validation error", () => {
    const { host, root } = mount();
    const props = baseProps(requiredField());
    try {
      act((): void => {
        root.render(<GuidedFillPanel key="doc-1" {...props} />);
      });
      const button = host.querySelector<HTMLButtonElement>("[data-form-validate]");
      expect(button).not.toBeNull();
      act((): void => {
        button?.click();
      });
      expect(host.querySelector("[data-form-error]")).not.toBeNull();

      act((): void => {
        root.render(<GuidedFillPanel key="doc-2" {...props} />);
      });
      expect(host.querySelector("[data-form-error]")).toBeNull();
    } finally {
      teardown(host, root);
    }
  });
});

describe("(c) long labels render intact", () => {
  it("a very long field name is present and not truncated", () => {
    const longName =
      "A very long field name that must wrap and never be truncated with an ellipsis";
    const field: FormField = {
      id: "f-long",
      name: longName,
      kind: "text",
      page: 1,
      rect: { x: 0, y: 0, width: 120, height: 20 },
      value: "",
    };
    const { host, root } = mount();
    try {
      act((): void => {
        root.render(<GuidedFillPanel {...baseProps(field)} />);
      });
      const label = host.querySelector<HTMLLabelElement>(".guided-fill-label");
      expect(label).not.toBeNull();
      expect(label?.textContent).toBe(longName);
      expect(label?.getAttribute("style") ?? "").not.toMatch(/nowrap/i);
    } finally {
      teardown(host, root);
    }
  });
});
