// @vitest-environment jsdom
//
// Regression guard for DEF-095 — the textbox editor's floating
// action bar must unmount as soon as Confirm is clicked. The
// previous DEF-092 fix verified the editor's wrapper unmounted,
// but the action bar was rendered as inline JSX inside the same
// conditional — a future refactor that extracted the bar into a
// separate component or pinned it to its own state slot could
// silently leave it visible after Confirm while the textarea
// unmounted. This test pins the contract: the action bar must
// be its own component (so its lifecycle is independent of any
// inline-JSX coupling) AND it must unmount when `textboxEditor`
// flips to null.
//
// Coverage:
//   1. The action bar is rendered through a dedicated component
//      (TextBoxActionBar), not as inline JSX inside TextBoxEditor.
//   2. After Confirm, both the textarea AND the action bar are
//      gone from the DOM (full unmount, not just hidden).
//   3. The action bar's pointer-events are explicitly "auto" so
//      a future refactor that disables pointer-events on the bar's
//      parent doesn't silently swallow Confirm clicks.
//   4. The bar's component identity is hoisted (not redefined
//      inside TextBoxEditor's render) so React doesn't re-mount
//      it on every parent render.

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type {
  Annotation,
  AnnotationToolState,
} from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountOverlay(args: {
  onCreate: (a: Annotation) => void;
  onFinishedOneShot?: () => void;
  tool?: AnnotationToolState;
}): {
  host: HTMLElement;
  root: ReturnType<typeof createRoot>;
  onCreate: ReturnType<typeof vi.fn>;
  onFinishedOneShot: ReturnType<typeof vi.fn>;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  Element.prototype.setPointerCapture = function (): void { /* no-op */ };
  Element.prototype.releasePointerCapture = function (): void { /* no-op */ };
  const root = createRoot(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  const onCreate = vi.fn(args.onCreate);
  const onFinishedOneShot = vi.fn(args.onFinishedOneShot ?? ((): void => undefined));
  const tool: AnnotationToolState = args.tool ?? {
    tool: "textbox",
    color: "yellow",
    penWidth: 2,
  };
  act((): void => {
    root.render(
      <AnnotationOverlay
        page={1}
        widthPt={612}
        heightPt={792}
        cssScale={1}
        annotations={[]}
        tool={tool}
        flashId={null}
        getTextItems={(): never[] => []}
        onCreate={onCreate}
        onFinishedOneShot={onFinishedOneShot}
      />,
    );
  });
  return {
    host,
    root,
    onCreate,
    onFinishedOneShot,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function placeEditor(host: HTMLElement): void {
  const layer = host.querySelector<HTMLElement>("[data-annotation-layer='1']");
  if (layer === null) throw new Error("layer not found");
  act((): void => {
    layer.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: 100,
        clientY: 100,
      }),
    );
  });
}

function typeIntoTextarea(host: HTMLElement, text: string): void {
  const textarea = host.querySelector<HTMLTextAreaElement>(
    "textarea[data-annotation-editor='textbox']",
  );
  if (textarea === null) throw new Error("textbox textarea not found");
  act((): void => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("DEF-095 — textbox floating action bar is a separate component that unmounts on Confirm", () => {
  it("after Confirm, both the textarea AND the action bar are gone from the DOM", () => {
    const { host, onCreate, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
    });
    try {
      placeEditor(host);
      // Pre-condition: bar AND textarea both rendered.
      expect(
        host.querySelector("[data-annotation-action-bar='textbox']"),
      ).not.toBeNull();
      expect(
        host.querySelector("[data-annotation-editor='textbox']"),
      ).not.toBeNull();

      typeIntoTextarea(host, "hello");

      const confirmBtn = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='textbox-confirm']",
      );
      if (confirmBtn === null) throw new Error("Confirm not found");
      act((): void => {
        confirmBtn.click();
      });

      expect(onCreate).toHaveBeenCalledTimes(1);

      // Post-condition: bar AND textarea BOTH unmounted. The bug
      // was the bar outliving the textarea on Confirm; this
      // assertion catches that regression.
      expect(
        host.querySelector("[data-annotation-action-bar='textbox']"),
      ).toBeNull();
      expect(
        host.querySelector("[data-annotation-editor='textbox']"),
      ).toBeNull();
      expect(
        host.querySelector("[data-annotation-editor-wrap='textbox']"),
      ).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("the action bar's Confirm button still receives clicks while armed (pointer-events: auto)", () => {
    // A regression that disabled pointer-events on the bar's
    // parent (or on the bar itself) would swallow Confirm clicks.
    // This test asserts the inline `pointer-events: auto` style is
    // applied directly to the action bar so a future refactor of
    // the parent doesn't silently disable hit-testing.
    const { host, onCreate, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
    });
    try {
      placeEditor(host);
      const bar = host.querySelector<HTMLElement>(
        "[data-annotation-action-bar='textbox']",
      );
      if (bar === null) throw new Error("action bar not found");
      // The inline style on the bar must keep pointer-events
      // enabled. jsdom normalizes inline styles into the element's
      // `style` property; we read it back to confirm the rule is
      // in place.
      expect(bar.style.pointerEvents).toBe("auto");

      typeIntoTextarea(host, "check me");
      const confirmBtn = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='textbox-confirm']",
      );
      if (confirmBtn === null) throw new Error("Confirm not found");
      act((): void => {
        confirmBtn.click();
      });
      expect(onCreate).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("the action bar renders three buttons (Confirm / Cancel / Delete)", () => {
    const { host, cleanup } = mountOverlay({
      onCreate: (): void => undefined,
    });
    try {
      placeEditor(host);
      const confirm = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='textbox-confirm']",
      );
      const cancel = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='textbox-cancel']",
      );
      const del = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='textbox-delete']",
      );
      expect(confirm).not.toBeNull();
      expect(cancel).not.toBeNull();
      expect(del).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("the action bar's source-level definition is hoisted (not redefined inside TextBoxEditor)", () => {
    // The textbox action bar must be its own component function
    // declared at module top level. If it were defined inline
    // inside TextBoxEditor (e.g. a function declaration in the
    // render body), React would treat it as a new component type
    // on every render and re-mount it — the editor would lose
    // state on every keystroke. We assert the source shape
    // instead of mounting twice to keep the test deterministic.
    //
    // We read the AnnotationOverlay source and look for a
    // top-level `function TextBoxActionBar(` declaration; its
    // presence confirms the bar is hoisted. The companion
    // assertion (the bar is invoked via `<TextBoxActionBar` in
    // TextBoxEditor's render) confirms it is used, not just
    // declared-but-dead.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const sourcePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "src",
      "renderer",
      "annotations",
      "AnnotationOverlay.tsx",
    );
    const source = fs.readFileSync(sourcePath, "utf8");
    expect(source).toMatch(/function\s+TextBoxActionBar\s*\(/);
    expect(source).toMatch(/<TextBoxActionBar\b/);
    // The action bar's `<div className="ann-textbox-actions"
    // data-annotation-action-bar="textbox">` opening tag must be
    // inside the `TextBoxActionBar` function, NOT inline in
    // `TextBoxEditor`. We slice the source into the TextBoxEditor
    // function body and assert the textbox-bar opening tag is
    // absent there. (The callout editor still has its own inline
    // `.ann-textbox-actions` div, but with action-bar="callout",
    // which is fine — only the textbox variant was the bug.)
    const tbEditorMatch = source.match(
      /function\s+TextBoxEditor\([\s\S]*?function\s+TextBoxActionBar\s*\(/,
    );
    expect(tbEditorMatch).not.toBeNull();
    if (tbEditorMatch === null) return;
    const tbEditorBody = tbEditorMatch[0];
    expect(tbEditorBody).not.toMatch(
      /<div\s+className="ann-textbox-actions"\s+data-annotation-action-bar="textbox"/,
    );
  });
});