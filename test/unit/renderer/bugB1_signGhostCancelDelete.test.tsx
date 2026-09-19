// @vitest-environment jsdom
//
// B1/B2 — sign ghost: Cancel must exit Sign mode (not just dismiss
// the pending placement); Delete must NOT show pre-placement
// (drops the pending placement but the Sign tool stays armed);
// Confirm must ALSO exit Sign mode (the operator's explicit
// requirement: "after confirming a sign, exit Sign mode, no
// ghost"). Previously Confirm left the host armed, so the next
// Text Box / Rect / Ellipse click landed on the still-armed Sign
// overlay and a sig-pending appeared where the annotation should
// have been (B1/B2).
//
// We exercise the SignaturesOverlay in isolation:
//   1. Cancel button: drops pending AND fires onCancelArm.
//   2. Delete button: drops pending but does NOT fire
//      onCancelArm (sign mode stays armed).
//   3. Esc on a pending placement: same as Cancel — drops
//      pending AND fires onCancelArm.
//   4. Confirm: fires onPlace AND fires onCancelArm (Sign
//      session over, ghost gone — B1/B2).
//   5. Action bar shows all three buttons (Confirm, Cancel,
//      Delete) — the original bug was that Delete was hidden
//      after the first placement.
//   6. After Confirm the host is disarmed; a re-render with
//      armedSignatureId=null renders no ghost and the next page
//      click spawns no pending placement.
//
// Structural contract test: the App-side `placeSignatureFull`
// does NOT clear the armed state itself — the overlay's Confirm /
// Cancel bar owns the disarm so the placement commit and the
// Sign-mode exit happen in one gesture.
import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { SignaturesOverlay } from "../../../src/renderer/signatures/SignaturesOverlay";
import type { SavedSignature } from "../../../src/shared/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Phase 20 — the signature pending surface is a TfBar inside an
 *  AnimatePresence, so its DOM removal completes after the exit. */
async function settleMotion(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

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
  it("Cancel button drops the pending placement AND fires onCancelArm (exits Sign mode)", async () => {
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
    await settleMotion();
    expect(host.querySelector("[data-sig-pending]")).toBeNull();
    expect(onCancelArm).toHaveBeenCalledTimes(1);
  });

  it("Delete button drops the pending placement but does NOT fire onCancelArm (stays armed)", async () => {
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
    await settleMotion();
    expect(host.querySelector("[data-sig-pending]")).toBeNull();
    expect(onCancelArm).not.toHaveBeenCalled();
  });

  it("Confirm button fires onPlace AND fires onCancelArm (exits Sign mode — B1/B2)", () => {
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
    // Confirming EXITS Sign mode — the operator's explicit
    // requirement. The host clears the armed signature id so
    // the ghost disappears and the next page click is a plain
    // annotation-tool click (B1/B2: the still-armed overlay
    // used to swallow the Text Box / Rect / Ellipse click).
    expect(onCancelArm).toHaveBeenCalledTimes(1);
  });

  it("Esc on a pending placement fires onCancelArm (exits Sign mode)", async () => {
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
    await settleMotion();
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

  it("after Confirm the host is disarmed: no ghost, and no pending on a re-rendered non-armed layer", async () => {
    // B1/B2 — "after confirming a sign, exit Sign mode, no
    // ghost". Confirm fires onPlace + onCancelArm; when the host
    // honours the disarm (armedSignatureId becomes null) the
    // layer renders without a ghost and the next page click does
    // NOT spawn a pending placement (the armed overlay that used
    // to swallow the following Text Box / Rect / Ellipse click is
    // gone).
    const host = document.createElement("div");
    host.style.position = "absolute";
    host.style.left = "0px";
    host.style.top = "0px";
    host.style.width = "800px";
    host.style.height = "600px";
    document.body.appendChild(host);
    host.getBoundingClientRect = (): DOMRect => ({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
      toJSON: () => ({}),
    });
    const root = createRoot(host);
    const onPlace = vi.fn();
    const onCancelArm = vi.fn();
    const render = (armed: string | null): void => {
      act((): void => {
        root.render(
          <SignaturesOverlay
            page={1}
            pageWidthPt={612}
            pageHeightPt={792}
            cssScale={1}
            placements={[]}
            signatures={{ "sig-typed": TYPED_SIG }}
            armedSignatureId={armed}
            onPlace={onPlace}
            onMove={(): void => undefined}
            onDelete={(): void => undefined}
            onCancelArm={onCancelArm}
          />,
        );
      });
    };
    const clickPage = (x: number, y: number): void => {
      const layer = host.querySelector("[data-page='1']") as HTMLElement | null;
      if (layer === null) throw new Error("layer not found");
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }),
        );
      });
    };
    try {
      render("sig-typed");
      clickPage(100, 100);
      const confirmBtn = host.querySelector<HTMLButtonElement>(
        "[data-sig-action='confirm']",
      );
      expect(confirmBtn).not.toBeNull();
      if (confirmBtn === null) return;
      act((): void => {
        confirmBtn.click();
      });
      expect(onPlace).toHaveBeenCalledTimes(1);
      expect(onCancelArm).toHaveBeenCalledTimes(1);
      // The Confirm handler cleared the local ghost point: no
      // ghost surface while the host still holds the (now-stale)
      // armed id in this harness.
      expect(host.querySelector("[data-sig-ghost]")).toBeNull();
      await settleMotion();
      expect(host.querySelector("[data-sig-pending]")).toBeNull();
      // Host honours the disarm (the real App does: Confirm ->
      // onCancelArm -> setArmedSignatureId(null)). Re-render with
      // armedSignatureId=null: the layer must not create pending
      // placements on the next page click.
      render(null);
      clickPage(200, 200);
      await settleMotion();
      expect(host.querySelector("[data-sig-pending]")).toBeNull();
      expect(onPlace).toHaveBeenCalledTimes(1);
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });
});

describe("B1/B2 — App leaves armed state to the overlay's action bar (no clear inside placeSignatureFull)", () => {
  // Structural contract: the host-side `placeSignatureFull`
  // does NOT call `setArmedSignatureId(null)` on a successful
  // placement. The disarm belongs to the overlay's Confirm /
  // Cancel action-bar buttons (`onCancelSignatureArm`), which
  // fire AFTER `onPlace` returns — so confirming a sign exits
  // Sign mode in the same gesture (B1/B2). Clearing here would
  // either race the pending-bar unmount or leave the tool armed
  // on engine failure; the overlay owns the exit.
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