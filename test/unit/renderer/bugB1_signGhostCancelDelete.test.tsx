// @vitest-environment jsdom
//
// B1 — sign ghost: Cancel must exit Sign mode (not just dismiss
// the pending placement); Delete must NOT show pre-placement
// (drops the pending placement but the Sign tool stays armed);
// post-placement click on sign re-enters sign mode with Delete
// shown (the host leaves `armedSignatureId` set after a
// successful placement so the next page click spawns a fresh
// pending placement).
//
// We exercise the SignaturesOverlay in isolation:
//   1. Cancel button: drops pending AND fires onCancelArm.
//   2. Delete button: drops pending but does NOT fire
//      onCancelArm (sign mode stays armed).
//   3. Esc on a pending placement: same as Cancel — drops
//      pending AND fires onCancelArm.
//   4. Confirm: fires onPlace (no onCancelArm — the user
//      explicitly committed and wants to keep placing).
//   5. Action bar shows all three buttons (Confirm, Cancel,
//      Delete) — the original bug was that Delete was hidden
//      after the first placement.
//
// Structural contract test: the App-side `placeSignatureFull`
// no longer calls `setArmedSignatureId(null)` after a
// successful placement (so post-placement clicks re-enter the
// pending flow without re-clicking the Sign toolbar button).
import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { SignaturesOverlay } from "../../../src/renderer/signatures/SignaturesOverlay";
import type { SavedSignature } from "../../../src/shared/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TYPED_SIG: SavedSignature = {
  id: "sig-typed",
  label: "Jane Doe",
  source: { kind: "typed", text: "Jane Doe", width: 200, height: 60 },
  createdAt: new Date(1700000000000).toISOString(),
};

function mountOverlay(args: {
  signatures: Record<string, SavedSignature>;
  armedSignatureId: string | null;
  onPlace?: (sigId: string, rect: { x: number; y: number; width: number; height: number }) => void;
  onMove?: (id: string, rect: { x: number; y: number; width: number; height: number }) => void;
  onDelete?: (id: string) => void;
  onCancelArm?: () => void;
}): {
  host: HTMLElement;
  onPlace: ReturnType<typeof vi.fn>;
  onMove: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
  onCancelArm: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  Element.prototype.setPointerCapture = function (): void {
    /* no-op */
  };
  Element.prototype.releasePointerCapture = function (): void {
    /* no-op */
  };
  const root = createRoot(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  const onPlace = vi.fn(args.onPlace ?? ((): void => undefined));
  const onMove = vi.fn(args.onMove ?? ((): void => undefined));
  const onDelete = vi.fn(args.onDelete ?? ((): void => undefined));
  const onCancelArm = vi.fn(args.onCancelArm ?? ((): void => undefined));
  act((): void => {
    root.render(
      <SignaturesOverlay
        page={1}
        pageWidthPt={612}
        pageHeightPt={792}
        cssScale={1}
        placements={[]}
        signatures={args.signatures}
        armedSignatureId={args.armedSignatureId}
        onPlace={onPlace}
        onMove={onMove}
        onDelete={onDelete}
        onCancelArm={onCancelArm}
      />,
    );
  });
  return { host, onPlace, onMove, onDelete, onCancelArm };
}

function clickOnLayer(host: HTMLElement, x: number, y: number): void {
  const layer = host.querySelector("[data-page='1']") as HTMLElement | null;
  if (layer === null) throw new Error("layer not found");
  act((): void => {
    layer.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: x,
        clientY: y,
      }),
    );
  });
}

const appPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "App.tsx",
);
const appSource = fs.readFileSync(appPath, "utf8");

describe("B1 — sign ghost Cancel/Delete/Confirm action bar contract", () => {
  it("Cancel button drops the pending placement AND fires onCancelArm (exits Sign mode)", () => {
    const { host, onCancelArm } = mountOverlay({
      signatures: { "sig-typed": TYPED_SIG },
      armedSignatureId: "sig-typed",
    });
    // Click the page to create a pending placement.
    clickOnLayer(host, 100, 100);
    const cancelBtn = host.querySelector<HTMLButtonElement>(
      "[data-sig-action='cancel']",
    );
    expect(cancelBtn).not.toBeNull();
    if (cancelBtn === null) return;
    act((): void => {
      cancelBtn.click();
    });
    // Pending is gone AND the host was told to exit Sign mode.
    expect(host.querySelector("[data-sig-pending]")).toBeNull();
    expect(onCancelArm).toHaveBeenCalledTimes(1);
  });

  it("Delete button drops the pending placement but does NOT fire onCancelArm (stays armed)", () => {
    const { host, onCancelArm } = mountOverlay({
      signatures: { "sig-typed": TYPED_SIG },
      armedSignatureId: "sig-typed",
    });
    clickOnLayer(host, 100, 100);
    const delBtn = host.querySelector<HTMLButtonElement>(
      "[data-sig-action='delete']",
    );
    expect(delBtn).not.toBeNull();
    if (delBtn === null) return;
    act((): void => {
      delBtn.click();
    });
    // Pending is gone but onCancelArm did NOT fire.
    expect(host.querySelector("[data-sig-pending]")).toBeNull();
    expect(onCancelArm).not.toHaveBeenCalled();
  });

  it("Confirm button fires onPlace but does NOT fire onCancelArm", () => {
    const { host, onPlace, onCancelArm } = mountOverlay({
      signatures: { "sig-typed": TYPED_SIG },
      armedSignatureId: "sig-typed",
    });
    clickOnLayer(host, 100, 100);
    const confirmBtn = host.querySelector<HTMLButtonElement>(
      "[data-sig-action='confirm']",
    );
    expect(confirmBtn).not.toBeNull();
    if (confirmBtn === null) return;
    act((): void => {
      confirmBtn.click();
    });
    expect(onPlace).toHaveBeenCalledTimes(1);
    // Confirming does NOT exit Sign mode — the next page click
    // should spawn a fresh pending placement.
    expect(onCancelArm).not.toHaveBeenCalled();
  });

  it("Esc on a pending placement fires onCancelArm (exits Sign mode)", () => {
    const { host, onCancelArm } = mountOverlay({
      signatures: { "sig-typed": TYPED_SIG },
      armedSignatureId: "sig-typed",
    });
    clickOnLayer(host, 100, 100);
    expect(host.querySelector("[data-sig-pending]")).not.toBeNull();
    act((): void => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(host.querySelector("[data-sig-pending]")).toBeNull();
    expect(onCancelArm).toHaveBeenCalledTimes(1);
  });

  it("the action bar shows Confirm / Cancel / Delete (Delete visible after placement)", () => {
    // The original bug: "Delete must NOT show pre-placement" —
    // the action bar omitted the Delete button on every render.
    // We assert all three are present after the user clicks the
    // page (i.e. the action bar that appears post-placement).
    const { host } = mountOverlay({
      signatures: { "sig-typed": TYPED_SIG },
      armedSignatureId: "sig-typed",
    });
    clickOnLayer(host, 100, 100);
    const confirm = host.querySelector("[data-sig-action='confirm']");
    const del = host.querySelector("[data-sig-action='delete']");
    const cancel = host.querySelector("[data-sig-action='cancel']");
    expect(confirm).not.toBeNull();
    expect(del).not.toBeNull();
    expect(cancel).not.toBeNull();
  });

  it("after Confirm the next page click spawns a fresh pending placement (post-placement re-enter)", () => {
    // B1 — "post-placement click on sign re-enters sign mode
    // with Delete shown". After Confirm, the Sign tool stays
    // armed. The next click on the page spawns a fresh pending
    // placement (with the action bar visible). We simulate by
    // rendering with the same armedSignatureId throughout the
    // Confirm -> next click sequence and asserting that the
    // second click produces a new [data-sig-pending].
    const { host, onPlace } = mountOverlay({
      signatures: { "sig-typed": TYPED_SIG },
      armedSignatureId: "sig-typed",
    });
    clickOnLayer(host, 100, 100);
    const confirmBtn = host.querySelector<HTMLButtonElement>(
      "[data-sig-action='confirm']",
    );
    expect(confirmBtn).not.toBeNull();
    if (confirmBtn === null) return;
    act((): void => {
      confirmBtn.click();
    });
    expect(onPlace).toHaveBeenCalledTimes(1);
    // First pending is gone.
    expect(host.querySelector("[data-sig-pending]")).toBeNull();
    // The next page click re-enters Sign mode (overlay still
    // armed) and spawns a fresh pending placement.
    clickOnLayer(host, 200, 200);
    expect(host.querySelector("[data-sig-pending]")).not.toBeNull();
    const delAfter = host.querySelector("[data-sig-action='delete']");
    expect(delAfter).not.toBeNull();
  });
});

describe("B1 — App leaves armedSignatureId set after a successful placement", () => {
  // Structural contract: the host-side `placeSignatureFull`
  // no longer calls `setArmedSignatureId(null)` at the end of a
  // successful placement. The previous implementation cleared
  // the armed state immediately after the engine confirmed the
  // placement, forcing the user to re-click the Sign toolbar
  // button before the next placement. The fix leaves the tool
  // armed so the next page click spawns a fresh pending
  // placement automatically.
  it("placeSignatureFull does NOT call setArmedSignatureId(null) on success", () => {
    const match = appSource.match(
      /const placeSignatureFull = useCallback\([\s\S]*?\},\s*\[/,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    // The closure body must NOT contain a `setArmedSignatureId(null)`
    // call inside the success branch (between `noteOpApplied` and
    // the closing `}` of the useCallback). Other defensive null
    // resets (e.g. on a missing saved signature) are allowed and
    // sit BEFORE the success branch.
    const body = match[0];
    const noteOpIdx = body.indexOf("noteOpApplied(tabId, result.value)");
    expect(noteOpIdx).toBeGreaterThan(-1);
    if (noteOpIdx === -1) return;
    // Scan from noteOpApplied forward for the next `setArmedSignatureId`
    // call. If one exists in the success branch, that's the bug.
    // Strip block / line comments so the test doesn't trip on a
    // `setArmedSignatureId(null)` mentioned in the comment.
    const tail = body
      .slice(noteOpIdx)
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    expect(tail).not.toMatch(/setArmedSignatureId\(null\)/);
  });

  it("placeSignatureFull does still call setArmedSignatureId(null) on a missing-saved-signature guard", () => {
    // Defensive: the early-return branch when the saved
    // signature id can't be resolved must still clear the
    // armed state, otherwise the ghost preview would stay on
    // forever after an invalid id (the user can't escape it).
    const match = appSource.match(
      /const placeSignatureFull = useCallback\([\s\S]*?\},\s*\[/,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toMatch(
      /if\s*\(\s*saved\s*===\s*undefined\s*\)\s*\{[\s\S]*?setArmedSignatureId\(null\)[\s\S]*?\}/,
    );
  });
});