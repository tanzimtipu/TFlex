// @vitest-environment jsdom
//
// DEF-190 — the stamp-type editor was a click-through / Escape-dead
// surface when the edited stamp sits near the page's bottom edge.
//
// Root cause: the editor is anchored UNDER the selected stamp
// (`top = (rect.y + rect.height) * cssScale + 4`), so for a
// bottom-edge stamp it straddles the page boundary. Each `.pdf-page`
// is an ISOLATED stacking context (`isolation: isolate`), and page 2
// is a LATER sibling context — so page 2's bitmap + pointer-active
// textLayer painted (and hit-tested) OVER the editor's overflow: the
// Cancel button was unclickable and the editor had no Escape exit at
// all (same family as DEF-088's unclickable controls).
//
// Fix (two halves, both pinned here):
//   1. StampAnnotations reports its selection-chrome state to the
//      host page (`onSelectionChange`); PageView mirrors it into
//      `data-stamp-editor-open` on `.pdf-page`, and the stylesheet
//      lifts that page above its sibling pages while the attribute
//      is set.
//   2. StampTypeEditor closes on a window-level Escape keydown.
//
// Behavior coverage:
//   1. Selecting a stamp reports chrome-open to the host page.
//   2. The Cancel button click closes the editor (fires, not
//      swallowed).
//   3. Escape closes the editor (window-level, focus-independent).
//   4. Deleting the selected stamp reports chrome-closed.
//   5. Unmount reports chrome-closed (virtualized page never leaves
//      the lift attribute set).
// Source coverage:
//   6. The `.pdf-page[data-stamp-editor-open="true"]` lift rule
//      exists with a numeric z-index in the page band (> 1, < 100).
//   7. PageView actually sets the attribute and forwards the
//      callback.
//   8. The editor's inline z-index stays above every in-page layer
//      (60) so it also paints above page 1's own canvas/textLayer.
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  StampAnnotations,
  type PlacedStamp,
} from "../../../src/renderer/annotations/StampAnnotations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Phase 20 — the stamp-type editor is a TfBar inside an
 *  AnimatePresence (it swaps with the action bar), so its DOM removal
 *  completes after the exit animation. */
async function settleMotion(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function makePlaced(overrides: Partial<PlacedStamp>): PlacedStamp {
  return {
    id: "p-1",
    stampId: "APPROVED",
    page: 1,
    rect: { x: 50, y: 700, width: 200, height: 80 },
    pngBytes: PNG_1x1,
    pngWidth: 200,
    pngHeight: 80,
    ...overrides,
  };
}

function mount(
  items: PlacedStamp[],
): {
  host: HTMLElement;
  onSelectionChange: ReturnType<typeof vi.fn>;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  Element.prototype.setPointerCapture = function (): void { /* no-op */ };
  Element.prototype.releasePointerCapture = function (): void { /* no-op */ };
  const onSelectionChange = vi.fn();
  const root = createRoot(host);
  act((): void => {
    root.render(
      <StampAnnotations
        cssScale={2}
        items={items}
        pageWidthPt={612}
        pageHeightPt={792}
        onSelectionChange={onSelectionChange}
      />,
    );
  });
  return {
    host,
    onSelectionChange,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function clickEl(el: Element): void {
  act((): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function pressEscape(): void {
  act((): void => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

/** Select the first stamp, open its Edit toolbox, and return the
 *  editor node (throws if any step fails to render). */
function openStampTypeEditor(host: HTMLElement): HTMLElement {
  const node = host.querySelector<HTMLElement>(".stamp-annotation");
  if (node === null) throw new Error("stamp annotation not rendered");
  clickEl(node);
  const edit = host.querySelector<HTMLButtonElement>(
    "[data-content-action='stamp-edit']",
  );
  if (edit === null) throw new Error("stamp edit not found");
  clickEl(edit);
  const editor = host.querySelector<HTMLElement>("[data-stamp-type-editor]");
  if (editor === null) throw new Error("stamp type editor did not open");
  return editor;
}

describe("DEF-190 — stamp-type editor paints above sibling pages and closes via Cancel + Escape", () => {
  it("selecting a stamp reports the chrome state to the host page (open on select)", () => {
    const { host, onSelectionChange, cleanup } = mount([makePlaced({})]);
    try {
      // Mount reports "closed" first, selection flips it to "open".
      expect(onSelectionChange).toHaveBeenNthCalledWith(1, false);
      const node = host.querySelector<HTMLElement>(".stamp-annotation");
      if (node === null) throw new Error("stamp annotation not rendered");
      clickEl(node);
      expect(onSelectionChange).toHaveBeenLastCalledWith(true);
    } finally {
      cleanup();
    }
  });

  it("the Cancel button click closes the editor (fires, not swallowed by page 2's textLayer)", async () => {
    const { host, onSelectionChange, cleanup } = mount([makePlaced({})]);
    try {
      openStampTypeEditor(host);
      const cancel = host.querySelector<HTMLButtonElement>(
        "[data-stamp-type-cancel]",
      );
      if (cancel === null) throw new Error("Cancel button not found");
      clickEl(cancel);
      // Closing the editor returns to the action bar — chrome stays
      // open (the stamp is still selected). The incoming bar mounts
      // immediately; the outgoing editor finishes its exit first.
      expect(onSelectionChange).toHaveBeenLastCalledWith(true);
      expect(
        host.querySelector("[data-content-action-bar='stamp']"),
      ).not.toBeNull();
      await settleMotion();
      expect(
        host.querySelector("[data-stamp-type-editor]"),
        "the editor closes on Cancel",
      ).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("Escape closes the stamp-type editor (window-level, focus-independent)", async () => {
    const { host, cleanup } = mount([makePlaced({})]);
    try {
      openStampTypeEditor(host);
      pressEscape();
      await settleMotion();
      expect(
        host.querySelector("[data-stamp-type-editor]"),
        "the editor closes on Escape",
      ).toBeNull();
      // A second Escape with the editor already closed is a no-op
      // (listener removed on close; nothing throws).
      pressEscape();
      await settleMotion();
      expect(host.querySelector("[data-stamp-type-editor]")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("deleting the selected stamp reports chrome closed to the host page", () => {
    const { host, onSelectionChange, cleanup } = mount([makePlaced({})]);
    try {
      const node = host.querySelector<HTMLElement>(".stamp-annotation");
      if (node === null) throw new Error("stamp annotation not rendered");
      clickEl(node);
      expect(onSelectionChange).toHaveBeenLastCalledWith(true);
      const del = host.querySelector<HTMLButtonElement>(
        "[data-content-action='stamp-delete']",
      );
      if (del === null) throw new Error("stamp delete not found");
      clickEl(del);
      expect(onSelectionChange).toHaveBeenLastCalledWith(false);
    } finally {
      cleanup();
    }
  });

  it("unmounting a selected page reports chrome closed (virtualized lift can never stick)", () => {
    const { onSelectionChange, cleanup } = mount([makePlaced({})]);
    // The mount effect's cleanup must fire the false report even
    // though the component never re-rendered a "closed" state.
    cleanup();
    expect(onSelectionChange).toHaveBeenLastCalledWith(false);
  });
});

describe("DEF-190 — source-level stacking contracts", () => {
  const stylesPath = resolve(__dirname, "../../../src/renderer/styles.css");
  const pageViewPath = resolve(
    __dirname,
    "../../../src/renderer/components/PageView.tsx",
  );
  const stampAnnotationsPath = resolve(
    __dirname,
    "../../../src/renderer/annotations/StampAnnotations.tsx",
  );
  const styles = readFileSync(stylesPath, "utf8");
  const pageView = readFileSync(pageViewPath, "utf8");
  const stampAnnotations = readFileSync(stampAnnotationsPath, "utf8");

  it("styles.css lifts the page hosting the stamp editor above sibling pages", () => {
    const rule = styles.match(
      /\.pdf-page\[data-stamp-editor-open="true"\]\s*\{[^}]*\}/,
    );
    expect(rule, "the .pdf-page[data-stamp-editor-open] lift rule exists").not.toBeNull();
    if (rule === null) return;
    const z = Number(/z-index:\s*(\d+)/.exec(rule[0])?.[1]);
    expect(Number.isNaN(z)).toBe(false);
    // Above the sibling pages (z-index: auto -> DOM order) and below
    // the fixed surfaces (sheet 100 / modal 800 / toasts 1000).
    expect(z).toBeGreaterThan(1);
    expect(z).toBeLessThan(100);
  });

  it("PageView mirrors the chrome state into data-stamp-editor-open on .pdf-page", () => {
    expect(pageView).toMatch(/data-stamp-editor-open=/);
    expect(pageView).toMatch(/onSelectionChange=\{onStampChromeChange\}/);
  });

  it("StampTypeEditor closes on a window-level Escape keydown", () => {
    const editor = stampAnnotations.slice(
      stampAnnotations.indexOf("function StampTypeEditor"),
    );
    expect(editor).toMatch(/e\.key === "Escape"/);
    expect(editor).toMatch(/window\.addEventListener\("keydown", onKey\)/);
  });

  it("the stamp-type editor keeps an inline z-index above every in-page layer", () => {
    // The editor must paint above the page's own canvas / textLayer
    // (auto), annotation (2), signatures (3), forms (5) and stamp (6)
    // layers. The page lift handles the CROSS-page half; this inline
    // value is the WITHIN-page half.
    expect(stampAnnotations).toMatch(/data-stamp-type-editor[\s\S]{0,400}?zIndex:\s*60/);
  });

  it("the editor overlay keeps pointer-events enabled for its controls", () => {
    // The action row re-enables pointer events explicitly (the DEF-088
    // contract: overlay layer inert, action bar interactive).
    expect(stampAnnotations).toMatch(
      /data-annotation-action-bar="stamp-type"[\s\S]{0,200}?pointerEvents:\s*"auto"/,
    );
  });
});
