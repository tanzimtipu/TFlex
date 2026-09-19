// @vitest-environment jsdom
//
// Phase 20 chunk 4 â€” DEF-235..240 regression contracts:
//
//   1. every EXITING keyboard-bearing surface is `inert` (and therefore
//      leaves the focus order / keyboard path) for its whole exit window:
//      the edit inline editor, the signature pending view AND its action
//      bar, the stamp-type picker, the search bar, the morph menus;
//   2. the two duplicated commit paths carry a ONE-SHOT latch, so even a
//      key that reaches them cannot commit twice (ADV-051 / ADV-052);
//   3. the morph measurement reads the surface's FINAL LAYOUT rect, never
//      a rect taken while the node still carries a mid-exit transform
//      (ADV-053);
//   4. the first exit frame of a morph pins pointer-events:none (ADV-055).
//
// jsdom does not implement inert's interaction semantics, so the tests
// pin the attribute (the contract the browser acts on) plus the one-shot
// latches that hold even when a key does reach the handler.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AnimatePresence } from "motion/react";
import { EditInlineEditor } from "../../../src/renderer/edit/EditInlineEditor";
import { SearchBar } from "../../../src/renderer/components/SearchBar";
import { SignatureActionBar } from "../../../src/renderer/signatures/SignaturesOverlay";
import { SignaturesOverlay } from "../../../src/renderer/signatures/SignaturesOverlay";
import {
  StampAnnotations,
  type PlacedStamp,
} from "../../../src/renderer/annotations/StampAnnotations";
import { measureSurfaceLayoutRect } from "../../../src/renderer/components/motion/useMorphPreset";
import type { SavedSignature } from "../../../src/shared/types";

async function settleMotion(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

const roots: Array<{ root: Root; host: HTMLElement }> = [];

function mount(host: HTMLElement): Root {
  const root = createRoot(host);
  roots.push({ root, host });
  return root;
}

afterEach((): void => {
  for (const { root, host } of roots.splice(0)) {
    act((): void => {
      root.unmount();
    });
    host.remove();
  }
});

function newHost(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

describe("DEF-235 â€” the exiting edit inline editor", () => {
  it("is inert during its exit and a held Ctrl+Enter cannot commit twice", () => {
    const host = newHost();
    const root = mount(host);
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    function EditorHost(): ReactElement {
      const [open, setOpen] = useState(true);
      return (
        <AnimatePresence>
          {open && (
            <EditInlineEditor
              rect={{ x: 10, y: 10, width: 200, height: 60 }}
              cssScale={1}
              initialText="HELLO"
              initialStyle={{ font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } }}
              mode="box"
              onCommit={(text, style, options, offset): void => {
                onCommit(text, style, options, offset);
                setOpen(false);
              }}
              onCancel={onCancel}
            />
          )}
        </AnimatePresence>
      );
    }

    act((): void => {
      root.render(<EditorHost />);
    });
    const textarea = host.querySelector<HTMLTextAreaElement>("[data-edit-textarea]");
    expect(textarea).not.toBeNull();
    if (textarea === null) return;

    // Commit once via Ctrl+Enter.
    act((): void => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
    });
    expect(onCommit).toHaveBeenCalledTimes(1);

    // Exiting: still mounted, now inert (the keyboard-repeat guard).
    const exiting = host.querySelector<HTMLElement>("[data-edit-editor]");
    expect(exiting, "the editor exits through AnimatePresence, not a pop").not.toBeNull();
    expect(exiting?.hasAttribute("inert"), "the exiting editor must be inert").toBe(true);

    // Defence in depth: even if a key reaches the handler (jsdom has no
    // inert semantics), the one-shot latch blocks a second commit.
    for (let i = 0; i < 10; i += 1) {
      act((): void => {
        exiting?.querySelector("[data-edit-textarea]")?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
        );
      });
    }
    expect(onCommit, "one commit must stay one commit").toHaveBeenCalledTimes(1);
  });
});

describe("DEF-238 â€” the exiting search bar", () => {
  it("is inert while exiting and unmounts after", async () => {
    const host = newHost();
    const root = mount(host);
    const noop = (): void => undefined;

    function SearchHost(): ReactElement {
      const [open, setOpen] = useState(true);
      return (
        <AnimatePresence>
          {open && (
            <SearchBar
              query="AB"
              onQuery={noop}
              resultCount={0}
              activeIndex={0}
              searching={false}
              onNext={noop}
              onPrev={noop}
              onClose={(): void => setOpen(false)}
            />
          )}
        </AnimatePresence>
      );
    }

    act((): void => {
      root.render(<SearchHost />);
    });
    expect(host.querySelector(".search-bar")?.hasAttribute("inert")).toBe(false);

    // Close it: the exiting bar is still mounted and inert, so focus /
    // Tab cannot reach the pointer-disabled ghost window.
    const close = host.querySelector<HTMLButtonElement>(".search-bar .tool-btn:last-child");
    expect(close).not.toBeNull();
    if (close === null) return;
    act((): void => {
      close.click();
    });
    const exiting = host.querySelector<HTMLElement>(".search-bar");
    expect(exiting, "the search bar exits through AnimatePresence").not.toBeNull();
    expect(exiting?.hasAttribute("inert"), "the exiting search bar must be inert").toBe(true);

    // ...and it leaves the DOM once the exit completes.
    await settleMotion();
    expect(host.querySelector(".search-bar")).toBeNull();
  });
});

describe("DEF-236 — the exiting signature pending view and its action bar", () => {
  const TYPED_SIG: SavedSignature = {
    id: "sig-1",
    label: "J. Doe",
    source: { kind: "typed", text: "J. Doe", width: 200, height: 60 },
    createdAt: new Date(1700000000000).toISOString(),
  };

  function mountOverlay(): {
    host: HTMLElement;
    onPlace: ReturnType<typeof vi.fn>;
  } {
    const host = newHost();
    host.style.position = "absolute";
    host.style.left = "0px";
    host.style.top = "0px";
    host.style.width = "800px";
    host.style.height = "600px";
    Element.prototype.setPointerCapture = function (): void { /* no-op */ };
    Element.prototype.releasePointerCapture = function (): void { /* no-op */ };
    host.getBoundingClientRect = (): DOMRect => ({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
      toJSON: () => ({}),
    });
    const onPlace = vi.fn();
    const root = mount(host);
    act((): void => {
      root.render(
        <SignaturesOverlay
          page={1}
          pageWidthPt={612}
          pageHeightPt={792}
          cssScale={1}
          placements={[]}
          signatures={{ "sig-1": TYPED_SIG }}
          armedSignatureId="sig-1"
          onPlace={onPlace}
          onMove={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
    });
    return { host, onPlace };
  }

  function spawnPending(host: HTMLElement): void {
    const layer = host.querySelector<HTMLElement>("[data-page='1']");
    if (layer === null) throw new Error("signatures layer not rendered");
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }),
      );
    });
  }

  it("both exiting roots are inert and a held Enter cannot commit twice", async () => {
    const { host, onPlace } = mountOverlay();
    spawnPending(host);
    const confirm = host.querySelector<HTMLButtonElement>("[data-sig-action='confirm']");
    expect(confirm).not.toBeNull();
    if (confirm === null) return;

    act((): void => {
      confirm.click();
    });
    expect(onPlace).toHaveBeenCalledTimes(1);

    const exitingPending = host.querySelector<HTMLElement>("[data-sig-pending]");
    const exitingBar = host.querySelector<HTMLElement>("[data-sig-action-bar]");
    expect(exitingPending, "the pending view exits through AnimatePresence").not.toBeNull();
    expect(exitingBar).not.toBeNull();
    expect(exitingPending?.hasAttribute("inert"), "the exiting pending view must be inert").toBe(true);
    expect(exitingBar?.hasAttribute("inert"), "the exiting action bar must be inert").toBe(true);

    // Defence in depth: keys that somehow reach the handler cannot
    // re-fire the stale confirm closure (ADV-052: 11 placements).
    for (let i = 0; i < 10; i += 1) {
      act((): void => {
        host
          .querySelector("[data-sig-action='confirm']")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
    }
    expect(onPlace, "one Confirm must stay one placement").toHaveBeenCalledTimes(1);

    await settleMotion();
    expect(host.querySelector("[data-sig-pending]")).toBeNull();
  });
});

describe("DEF-235 class — the exiting signature action bar (selected placement)", () => {
  it("is inert while exiting", () => {
    const host = newHost();
    const root = mount(host);
    const noop = (): void => undefined;

    function BarHost(): ReactElement {
      const [open, setOpen] = useState(true);
      return (
        <AnimatePresence>
          {open && (
            <SignatureActionBar
              base={{ x: 10, y: 40, width: 120, height: 30 }}
              confirmTitle="Commit position changes"
              cancelTitle="Cancel"
              deleteTitle="Delete signature"
              onConfirm={noop}
              onCancel={(): void => setOpen(false)}
              onDelete={noop}
            />
          )}
        </AnimatePresence>
      );
    }

    act((): void => {
      root.render(<BarHost />);
    });
    expect(host.querySelector("[data-sig-action-bar]")?.hasAttribute("inert")).toBe(false);

    const cancel = host.querySelector<HTMLButtonElement>("[data-sig-action='cancel']");
    if (cancel === null) throw new Error("cancel not found");
    act((): void => {
      cancel.click();
    });
    const exiting = host.querySelector<HTMLElement>("[data-sig-action-bar]");
    expect(exiting, "the bar exits through AnimatePresence").not.toBeNull();
    expect(exiting?.hasAttribute("inert"), "the exiting action bar must be inert").toBe(true);
  });
});

describe("DEF-235 class — the exiting stamp-type picker", () => {
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

  const PLACED: PlacedStamp = {
    id: "p-1",
    stampId: "APPROVED",
    page: 1,
    rect: { x: 50, y: 700, width: 200, height: 80 },
    pngBytes: PNG_1x1,
    pngWidth: 200,
    pngHeight: 80,
  };

  it("is inert during its exit (the swap back to the action bar)", async () => {
    const host = newHost();
    Element.prototype.setPointerCapture = function (): void { /* no-op */ };
    Element.prototype.releasePointerCapture = function (): void { /* no-op */ };
    const root = mount(host);
    act((): void => {
      root.render(
        <StampAnnotations
          cssScale={2}
          items={[PLACED]}
          pageWidthPt={612}
          pageHeightPt={792}
          onSelectionChange={(): void => undefined}
        />,
      );
    });

    const click = (el: Element): void => {
      act((): void => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
    };
    const stamp = host.querySelector<HTMLElement>(".stamp-annotation");
    if (stamp === null) throw new Error("stamp not rendered");
    click(stamp);
    const edit = host.querySelector<HTMLButtonElement>("[data-content-action='stamp-edit']");
    if (edit === null) throw new Error("stamp edit not found");
    click(edit);
    const editor = host.querySelector<HTMLElement>("[data-stamp-type-editor]");
    expect(editor).not.toBeNull();
    expect(editor?.hasAttribute("inert")).toBe(false);

    const cancel = host.querySelector<HTMLButtonElement>("[data-stamp-type-cancel]");
    if (cancel === null) throw new Error("stamp cancel not found");
    click(cancel);
    const exiting = host.querySelector<HTMLElement>("[data-stamp-type-editor]");
    expect(exiting, "the picker exits through AnimatePresence").not.toBeNull();
    expect(exiting?.hasAttribute("inert"), "the exiting picker must be inert").toBe(true);

    await settleMotion();
    expect(host.querySelector("[data-stamp-type-editor]")).toBeNull();
  });
});

describe("DEF-237 — the morph measures the surface's FINAL LAYOUT rect", () => {
  it("resets an in-flight exit transform for the read and restores it", () => {
    const surface = document.createElement("div");
    document.body.appendChild(surface);
    const layoutRect = {
      x: 100, y: 200, left: 100, top: 200, right: 300, bottom: 260,
      width: 200, height: 60, toJSON: () => ({}),
    } as DOMRect;
    const transformedRect = {
      x: 130, y: 210, left: 130, top: 210, right: 230, bottom: 226,
      width: 100, height: 16, toJSON: () => ({}),
    } as DOMRect;
    surface.style.transform = "translateX(30px) scale(0.5, 0.5)";
    surface.getBoundingClientRect = (): DOMRect =>
      surface.style.transform === "none" ? layoutRect : transformedRect;

    const rect = measureSurfaceLayoutRect(surface);
    // The read is the LAYOUT rect (the transform was cleared for it)...
    expect(rect.left).toBe(100);
    expect(rect.top).toBe(200);
    expect(rect.width).toBe(200);
    expect(rect.height).toBe(60);
    // ...and the in-flight exit transform is restored (never painted off).
    expect(surface.style.transform).toBe("translateX(30px) scale(0.5, 0.5)");
    surface.remove();
  });

  it("reads straight through when no transform is applied", () => {
    const surface = document.createElement("div");
    document.body.appendChild(surface);
    const layoutRect = {
      x: 5, y: 6, left: 5, top: 6, right: 105, bottom: 66,
      width: 100, height: 60, toJSON: () => ({}),
    } as DOMRect;
    surface.getBoundingClientRect = (): DOMRect => layoutRect;
    const rect = measureSurfaceLayoutRect(surface);
    expect(rect.left).toBe(5);
    expect(rect.width).toBe(100);
    expect(surface.style.transform).toBe("");
    surface.remove();
  });
});
