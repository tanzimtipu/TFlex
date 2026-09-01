// @vitest-environment jsdom
//
// Regression guard for DEF-100 — the Flatten confirm dialog's
// buttons must not be intercepted by the modal backdrop, and the
// "click outside to close" affordance must keep working.
//
// Correct approach (per the verified defect): the backdrop keeps
// `pointer-events: auto` (it IS a real modal hit surface) with an
// onClick that closes ONLY when `e.target === e.currentTarget` —
// i.e. the click landed on the backdrop itself, outside
// `.modal-dialog`. Clicks on dialog descendants (Flatten, Cancel)
// have a target inside the dialog, never the backdrop, so their
// handlers fire unchanged.
//
// The previous shape disabled the backdrop's hit-testing entirely
// (`pointer-events: none` + a window-level click listener), which
// let clicks pass through to whatever was underneath the modal and
// made outside-click-close unreliable in the real app.
//
// Coverage:
//   1. Clicking Flatten calls onConfirm, never onCancel.
//   2. Clicking Cancel calls onCancel, never onConfirm.
//   3. Clicking the backdrop itself (target === backdrop) calls
//      onCancel (outside-click-close still works).
//   4. The backdrop CSS does NOT disable hit-testing
//      (no `pointer-events: none`), so clicks are targeted
//      normally.
//   5. The component gates the close on `target === currentTarget`.

import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { FlattenConfirmDialog } from "../../../src/renderer/forms/FlattenConfirmDialog";
import * as fs from "node:fs";
import * as path from "node:path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountDialog(args: {
  open: boolean;
  onCancel?: () => void;
  onConfirm?: () => void;
}): {
  host: HTMLElement;
  root: ReturnType<typeof createRoot>;
  onCancel: ReturnType<typeof vi.fn>;
  onConfirm: ReturnType<typeof vi.fn>;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onCancel = vi.fn(args.onCancel ?? ((): void => undefined));
  const onConfirm = vi.fn(args.onConfirm ?? ((): void => undefined));
  act((): void => {
    root.render(
      <FlattenConfirmDialog
        open={args.open}
        fieldCount={3}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
  });
  return {
    host,
    root,
    onCancel,
    onConfirm,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const stylesPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "styles.css",
);
const stylesSource = fs.readFileSync(stylesPath, "utf8");

const dialogPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "forms",
  "FlattenConfirmDialog.tsx",
);
const dialogSource = fs.readFileSync(dialogPath, "utf8");

describe("DEF-100 — Flatten confirm dialog buttons are not blocked by the backdrop", () => {
  it("clicking the Flatten button inside the dialog calls onConfirm (not onCancel)", () => {
    const { host, onCancel, onConfirm, cleanup } = mountDialog({
      open: true,
    });
    try {
      const flattenBtn = host.querySelector<HTMLButtonElement>(
        "button.btn-primary",
      );
      expect(flattenBtn).not.toBeNull();
      if (flattenBtn === null) return;
      act((): void => {
        flattenBtn.click();
      });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      // The backdrop must not close the dialog off the bubbled
      // click: the click target is the button, not the backdrop.
      expect(onCancel).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("clicking the Cancel button inside the dialog calls onCancel (not onConfirm)", () => {
    const { host, onCancel, onConfirm, cleanup } = mountDialog({
      open: true,
    });
    try {
      const cancelBtn = host.querySelector<HTMLButtonElement>(
        "button.btn-secondary",
      );
      expect(cancelBtn).not.toBeNull();
      if (cancelBtn === null) return;
      act((): void => {
        cancelBtn.click();
      });
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("clicking the backdrop itself (target === backdrop) calls onCancel", () => {
    // The "click outside the dialog to close" affordance must work:
    // a click whose target IS the backdrop (nothing above it) closes
    // the dialog. The backdrop's onClick gates on
    // `e.target === e.currentTarget`.
    const { host, onCancel, cleanup } = mountDialog({
      open: true,
    });
    try {
      const backdrop = host.querySelector<HTMLElement>(".modal-backdrop");
      expect(backdrop).not.toBeNull();
      if (backdrop === null) return;
      act((): void => {
        backdrop.click();
      });
      expect(onCancel).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("the modal-backdrop CSS does NOT set pointer-events: none (real hit surface)", () => {
    // The previous fix disabled backdrop hit-testing with
    // `pointer-events: none`. That broke outside-click-close in the
    // installed app. The backdrop must remain a hit surface so a
    // click on the backdrop area targets the backdrop and its onClick
    // (gated on target === currentTarget) can close the dialog.
    const raw = stylesSource.match(/\.modal-backdrop\s*\{[^}]*\}/);
    expect(raw).not.toBeNull();
    if (raw === null) return;
    // Strip comment blocks first — the historical note describes the
    // previous shape (which used pointer-events: none); only the
    // actual declarations matter.
    const rule = raw[0].replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rule).not.toMatch(/pointer-events:\s*none/);
  });

  it("FlattenConfirmDialog source gates backdrop close on target === currentTarget", () => {
    // The load-bearing check. The backdrop's onClick must close ONLY
    // when the click target IS the backdrop — never for a click on a
    // dialog descendant. We assert the wiring is present instead of
    // a window-level listener or an unguarded onClick.
    expect(dialogSource).toMatch(/e\.target === e\.currentTarget/);
    // And there is no window-level click listener any more (the
    // previous none-backdrop approach installed one) — the backdrop
    // handles its own clicks.
    expect(dialogSource).not.toMatch(/window\.addEventListener\(["']click["']/);
  });
});