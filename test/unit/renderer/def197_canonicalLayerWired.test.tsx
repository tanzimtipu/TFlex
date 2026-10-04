// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// DEF-197 — the canonical animation layer is wired, not dead code:
//   1. tfPresets reads every scale/translate that has a token from
//      motionTokens (the TS mirror of styles/animations.css) — no
//      hardcoded scale survives in the presets,
//   2. AnimatedDialog and AnimatedPanel are imported AND rendered by
//      production surfaces (FlattenConfirmDialog / SideRail),
//   3. both wrappers actually mount and animate through the token
//      variants (bloom/slide driven by MOTION_SCALE / MOTION_TRANSLATE).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AnimatedDialog } from "../../../src/renderer/components/AnimatedDialog";
import { AnimatedPanel } from "../../../src/renderer/components/AnimatedPanel";
import {
  springDialog,
  springPanel,
  springQuick,
  tfBackdrop,
  tfBar,
  tfBarTop,
  tfDialog,
  tfMenu,
  tfMenuUp,
  tfPanel,
  tfPopover,
  tfToast,
  tfToastSuccess,
} from "../../../src/renderer/components/motion/tfPresets";
import { MOTION_SCALE, MOTION_TRANSLATE } from "../../../src/renderer/hooks/motionTokens";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (p: string): string =>
  readFileSync(join(REPO_ROOT, "src", "renderer", p), "utf8");

describe("tfPresets consume the canonical tokens (DEF-197)", () => {
  it("dialog, popover and toast-success scales read the token values", () => {
    expect(tfDialog.initial.scale).toBe(MOTION_SCALE.press);
    expect(tfDialog.exit.scale).toBe(MOTION_SCALE.exit);
    expect(tfPopover.initial.scale).toBe(MOTION_SCALE.press);
    expect(tfPopover.exit.scale).toBe(MOTION_SCALE.press);
    expect(tfToastSuccess.initial.scale).toBe(MOTION_SCALE.enter);
    expect(tfToastSuccess.exit.scale).toBe(MOTION_SCALE.exit);
  });

  it("menu scales read the enter/exit tokens and travel the small token", () => {
    expect(tfMenu.initial.scale).toBe(MOTION_SCALE.enter);
    expect(tfMenu.exit.scale).toBe(MOTION_SCALE.exit);
    expect(tfMenu.initial.y).toBe(-MOTION_TRANSLATE.small);
    expect(tfMenuUp.initial.y).toBe(MOTION_TRANSLATE.small);
    expect(tfMenuUp.initial.scale).toBe(MOTION_SCALE.enter);
    expect(tfMenuUp.exit.scale).toBe(MOTION_SCALE.exit);
  });

  it("bar travel reads the micro token and the panel travel reads the panel token", () => {
    expect(tfPanel.initial.x).toBe(MOTION_TRANSLATE.panel);
    expect(tfBar.initial.y).toBe(-MOTION_TRANSLATE.micro);
    expect(tfBar.exit.y).toBe(-MOTION_TRANSLATE.micro);
    expect(tfBarTop.initial.y).toBe(-6);
  });

  it("no preset carries a hardcoded 0.96/0.97/0.985 scale literal", () => {
    for (const preset of [
      tfDialog, tfPopover, tfMenu, tfMenuUp, tfToast, tfToastSuccess,
    ]) {
      for (const variant of [preset.initial, preset.exit]) {
        for (const [key, value] of Object.entries(variant)) {
          if (key === "scale" && typeof value === "number") {
            expect(
              [MOTION_SCALE.press, MOTION_SCALE.enter, MOTION_SCALE.exit, 1],
              `scale ${value} is not a token value`,
            ).toContain(value);
          }
        }
      }
    }
  });

  it("spring transitions stay theme-independent (unchanged calibration)", () => {
    expect(springPanel).toEqual({ type: "spring", stiffness: 420, damping: 34 });
    expect(springDialog).toEqual({ type: "spring", stiffness: 560, damping: 38 });
    expect(springQuick).toEqual({ type: "spring", stiffness: 1000, damping: 50 });
  });
});

describe("canonical wrappers are imported by production surfaces (DEF-197)", () => {
  it("FlattenConfirmDialog renders DialogShell, which roots in the Tf pair", () => {
    // Phase 92 (TFL-513 chunk A): the shared DialogShell supersedes the
    // per-dialog AnimatedDialog wrapper. The canonical Tf primitives still own
    // the enter/exit — they just live one level down in DialogShell now.
    const src = read("forms/FlattenConfirmDialog.tsx");
    expect(src).toContain("from \"../components/DialogShell\"");
    expect(src).not.toContain("TfMotion");
    const shell = read("components/DialogShell.tsx");
    expect(shell).toContain("<TfDialog");
    expect(shell).toContain("<TfBackdrop");
  });

  it("SideRail renders AnimatedPanel, not TfPanelLeft", () => {
    const src = read("components/SideRail.tsx");
    expect(src).toContain("from './AnimatedPanel'");
    expect(src).not.toContain("from './motion/TfMotion'");
    expect(src).not.toContain('<TfPanelLeft');
  });
});

describe("AnimatedDialog / AnimatedPanel mount through the token variants", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach((): void => {
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  });

  afterEach((): void => {
    if (root !== null && container !== null) {
      act((): void => {
        root?.unmount();
      });
      container.remove();
      root = null;
      container = null;
    }
  });

  it("AnimatedDialog renders the backdrop + dialog box when open", () => {
    act((): void => {
      root?.render(
        <AnimatedDialog
          open
          onClose={(): void => undefined}
          className="modal-dialog"
          backdropClassName="modal-backdrop"
          labelledBy="t"
        >
          <span>body</span>
        </AnimatedDialog>
      );
    });
    const backdrop = document.querySelector(".modal-backdrop");
    const box = document.querySelector(".modal-dialog");
    expect(backdrop).not.toBeNull();
    expect(box).not.toBeNull();
    expect(box?.getAttribute("role")).toBe("dialog");
    expect(box?.getAttribute("aria-modal")).toBe("true");
  });

  it("AnimatedDialog unmounts on close via the presence boundary", () => {
    function Host() {
      return (
        <AnimatedDialog open={false} className="modal-dialog">
          <span>body</span>
        </AnimatedDialog>
      );
    }
    act((): void => {
      root?.render(<Host />);
    });
    expect(document.querySelector(".modal-dialog")).toBeNull();
  });

  it("AnimatedPanel renders a docked left rail and animates from the panel token", () => {
    act((): void => {
      root?.render(
        <AnimatedPanel open side="left" mode="docked" className="side-rail" testId="probe">
          <span>rail</span>
        </AnimatedPanel>,
      );
    });
    const rail = document.querySelector("aside.side-rail");
    expect(rail).not.toBeNull();
    expect(rail?.getAttribute("data-panel-side")).toBe("left");
  });

  it("preset backdrop exit pins pointer-events none on the first exit frame", () => {
    expect(tfBackdrop.exit.pointerEvents).toBe("none");
  });
});
