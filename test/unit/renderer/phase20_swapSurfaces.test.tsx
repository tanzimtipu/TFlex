// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Phase 20 criterion 3 — window-to-window swaps.
//
// The Sign modal's tab switch is BOTH an animated resize (criterion 2,
// measured in the Electron harness) and a window-to-window swap: the
// outgoing tab body must cross-fade into the incoming one, never
// unmount-then-mount. This pins the swap structurally:
//   1. both panes are mounted for the whole swap (never a both-absent
//      frame), the outgoing one marked data-tf-pane="out",
//   2. the outgoing pane is popped out of flow by CSS so the frame's
//      measured target is always the incoming pane,
//   3. the swap resolves to exactly one pane when the ramps finish.
//
// The frame numbers themselves are measured in the Electron harness
// (screenshots/phase20-chunk2-sign-mid-*.png + the rAF rect trace), not
// here: jsdom runs no layout and no animation frames.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SignatureManagerModal } from "../../../src/renderer/signatures/SignatureManagerModal";
import { _resetSignatureServiceForTests } from "../../../src/renderer/signatures/service";
import type { SavedSignature, SignatureSource } from "../../../src/shared/types";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

function installService(): void {
  const list: SavedSignature[] = [];
  const svc = {
    list: async (): Promise<SavedSignature[]> => list.slice(),
    save: async (source: SignatureSource): Promise<SavedSignature[]> => {
      list.push({
        id: `sig-${list.length + 1}`,
        label: source.kind === "typed" ? source.text : "Signature",
        createdAt: new Date().toISOString(),
        source,
      });
      return list.slice();
    },
    delete: async (id: string): Promise<SavedSignature[]> => list.filter((s) => s.id !== id),
  };
  (window as unknown as { tflex?: { signatures?: typeof svc } }).tflex = { signatures: svc };
  _resetSignatureServiceForTests();
}

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach((): void => {
  installService();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach((): void => {
  act((): void => {
    root?.unmount();
  });
  host?.remove();
  delete (window as unknown as { tflex?: unknown }).tflex;
  _resetSignatureServiceForTests();
  root = null;
  host = null;
});

function mountModal(): HTMLElement {
  act((): void => {
    root?.render(
      <SignatureManagerModal
        open
        onClose={(): void => undefined}
        onApply={(): void => undefined}
        savedSignatures={[]}
        onToast={(): void => undefined}
      />,
    );
  });
  return host as HTMLElement;
}

function panes(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(".sig-tab-pane"));
}

function paneStates(el: HTMLElement): string[] {
  return panes(el).map((p) => p.getAttribute("data-tf-pane") ?? "");
}

function clickTab(el: HTMLElement, label: string): void {
  const tab = Array.from(el.querySelectorAll<HTMLElement>(".sig-tab")).find((t) =>
    (t.textContent ?? "").trim().startsWith(label),
  );
  if (tab === undefined) throw new Error(`tab ${label} not found`);
  act((): void => {
    tab.click();
  });
}

async function settleMotion(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

describe("Phase 20 — the Sign modal's tab swap is a cross-fade, not a pop", () => {
  it("keeps both panes mounted through the swap and settles to one", async () => {
    const el = mountModal();
    expect(paneStates(el)).toEqual(["in"]);
    expect(el.querySelector("[data-tf-resize]")).not.toBeNull();

    clickTab(el, "Type");
    // Same tick as the switch: the outgoing Draw pane is still mounted and
    // marked as exiting, so no frame can be both-absent.
    expect(paneStates(el).sort()).toEqual(["in", "out"]);
    expect(el.querySelector(".sig-canvas:not(.sig-typed-canvas)")).not.toBeNull();
    expect(el.querySelector(".sig-typed-canvas")).not.toBeNull();

    await settleMotion();
    expect(paneStates(el)).toEqual(["in"]);
    expect(el.querySelector(".sig-canvas:not(.sig-typed-canvas)")).toBeNull();
    expect(el.querySelector(".sig-typed-canvas")).not.toBeNull();
  });

  it("marks the outgoing pane with the out-of-flow hook the measurement relies on", () => {
    const css = readFileSync(join(REPO_ROOT, "src", "renderer", "styles.css"), "utf8");
    const rule = /\.sig-tab-pane\[data-tf-pane="out"\]\s*\{([^}]*)\}/.exec(css);
    expect(rule, "the outgoing pane rule must exist in styles.css").not.toBeNull();
    const body = rule?.[1] ?? "";
    // Out of flow + pinned to the stack's top-left: it keeps the geometry
    // it had while it fades, and contributes nothing to the frame's
    // measured height (which must always be the INCOMING pane).
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/top:\s*0/);
    expect(body).toMatch(/left:\s*0/);
    expect(body).toMatch(/right:\s*0/);
  });
});
