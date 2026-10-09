// @vitest-environment jsdom
// Phase 117 (chunk B) — shared selection controller primitives.
//
// Pins the ONE shared selection surface: `SelectionChrome` renders the
// boundary (`data-selection-boundary`) + four corner handles
// (`data-selection-handle`) and maps the `state` prop onto distinct
// `is-*` classes; `ContentActionBar` keeps Confirm + Cancel in the
// primary row and moves Delete behind a separated More control
// (`data-content-action="<prefix>-more"` / `"<prefix>-delete"`).
//
// Setup/teardown mirrors a sibling renderer spec (phase113_menusContextMenus):
// react-dom/client + `act` (the repo does not ship @testing-library/react).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import {
  ContentActionBar,
  SelectionChrome,
} from "../../../src/renderer/components/selectableContent";

const NOOP = (): void => undefined;

let roots: Root[] = [];
let hosts: HTMLElement[] = [];

function mount(ui: ReactElement): HTMLElement {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act((): void => {
    root.render(ui);
  });
  roots.push(root);
  hosts.push(host);
  return host;
}

function click(target: Element | null): void {
  if (target === null) throw new Error("expected clickable element");
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function clsof(el: Element | null): string {
  if (el === null) throw new Error("expected element");
  return el.getAttribute("class") ?? "";
}

beforeEach((): void => {
  roots = [];
  hosts = [];
});

afterEach((): void => {
  const rs = roots;
  const hs = hosts;
  roots = [];
  hosts = [];
  for (const root of rs) {
    act((): void => {
      root.unmount();
    });
  }
  for (const h of hs) h.remove();
  document.body.innerHTML = "";
});

const CHROME = { left: 10, top: 20, width: 120, height: 60, kind: "annotation" } as const;

describe("Phase 117 — SelectionChrome", () => {
  it("renders the boundary and four corner handles", () => {
    const host = mount(<SelectionChrome {...CHROME} state="selected" />);
    const boundary = host.querySelector("[data-selection-boundary]");
    expect(boundary).not.toBeNull();
    expect(boundary?.getAttribute("data-selection-kind")).toBe("annotation");
    const handles = Array.from(host.querySelectorAll("[data-selection-handle]"));
    expect(handles).toHaveLength(4);
    expect(handles.map((h) => h.getAttribute("data-selection-handle")).sort()).toEqual([
      "ne",
      "nw",
      "se",
      "sw",
    ]);
  });

  it("maps the state prop onto distinct is-* classes", () => {
    const selectedHost = mount(<SelectionChrome {...CHROME} state="selected" />);
    expect(clsof(selectedHost.querySelector("[data-selection-boundary]"))).toContain("is-selected");
    const hoverHost = mount(<SelectionChrome {...CHROME} state="hover" />);
    const hoverCls = clsof(hoverHost.querySelector("[data-selection-boundary]"));
    expect(hoverCls).toContain("is-hover");
    expect(hoverCls).not.toContain("is-selected");
  });
});

describe("Phase 117 — ContentActionBar", () => {
  it("keeps Confirm + Cancel primary and shows Delete inline", () => {
    const host = mount(
      <ContentActionBar
        left={0}
        top={0}
        dataActionPrefix="ann-rect"
        onConfirm={NOOP}
        onCancel={NOOP}
        onDelete={NOOP}
      />,
    );
    expect(host.querySelector('[data-content-action="ann-rect-confirm"]')).not.toBeNull();
    expect(host.querySelector('[data-content-action="ann-rect-cancel"]')).not.toBeNull();

    const del = host.querySelector('[data-content-action="ann-rect-delete"]');
    expect(del).not.toBeNull();
    expect(del?.closest(".content-action-more-menu")).toBeNull();
    expect(host.querySelector('[data-content-action="ann-rect-more"]')).toBeNull();
  });

  it("runs the Delete handler from the inline button", () => {
    let deletes = 0;
    const host = mount(
      <ContentActionBar
        left={0}
        top={0}
        dataActionPrefix="stamp"
        onConfirm={NOOP}
        onDelete={(): void => {
          deletes += 1;
        }}
      />,
    );
    click(host.querySelector('[data-content-action="stamp-delete"]'));
    expect(deletes).toBe(1);
  });
});
