// @vitest-environment jsdom
//
// Phase 116 (TFL-1228 chunk G) - the list-level FDF comment import / export
// actions on the AnnotationsPanel header. The two compact buttons live beside
// the count, dispatch the host's existing dialog handlers, and render disabled
// when their handler is absent.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AnnotationsPanel } from "../../../src/renderer/annotations/AnnotationsPanel";

const NOOP = (): void => undefined;

interface Mounted {
  host: HTMLElement;
  root: Root;
  unmount: () => void;
}

function mount(element: ReactElement): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return {
    host,
    root,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function button(host: HTMLElement, action: "export" | "import"): HTMLButtonElement {
  const el = host.querySelector<HTMLButtonElement>(`[data-ann-io="${action}"]`);
  if (el === null) throw new Error(`missing data-ann-io=${action} button`);
  return el;
}

function click(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("Phase 116 - AnnotationsPanel list-level FDF actions", () => {
  it("renders both FDF buttons enabled when the handlers are wired", () => {
    const m = mount(
      <AnnotationsPanel
        annotations={[]}
        onJumpTo={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
        onExportComments={NOOP}
        onImportComments={NOOP}
      />,
    );
    try {
      expect(button(m.host, "export")).not.toBeNull();
      expect(button(m.host, "import")).not.toBeNull();
      expect(button(m.host, "export").disabled).toBe(false);
      expect(button(m.host, "import").disabled).toBe(false);
    } finally {
      m.unmount();
    }
  });

  it("dispatches the right handler for each button", () => {
    const onExportComments = vi.fn();
    const onImportComments = vi.fn();
    const m = mount(
      <AnnotationsPanel
        annotations={[]}
        onJumpTo={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
        onExportComments={onExportComments}
        onImportComments={onImportComments}
      />,
    );
    try {
      click(button(m.host, "export"));
      expect(onExportComments).toHaveBeenCalledTimes(1);
      expect(onImportComments).not.toHaveBeenCalled();

      click(button(m.host, "import"));
      expect(onImportComments).toHaveBeenCalledTimes(1);
      expect(onExportComments).toHaveBeenCalledTimes(1);
    } finally {
      m.unmount();
    }
  });

  it("disables a button whose handler is absent", () => {
    const m = mount(
      <AnnotationsPanel
        annotations={[]}
        onJumpTo={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
        onExportComments={NOOP}
      />,
    );
    try {
      expect(button(m.host, "export").disabled).toBe(false);
      expect(button(m.host, "import").disabled).toBe(true);
    } finally {
      m.unmount();
    }
  });

  it("disables export when only import is wired", () => {
    const m = mount(
      <AnnotationsPanel
        annotations={[]}
        onJumpTo={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
        onImportComments={NOOP}
      />,
    );
    try {
      expect(button(m.host, "export").disabled).toBe(true);
      expect(button(m.host, "import").disabled).toBe(false);
    } finally {
      m.unmount();
    }
  });
});
