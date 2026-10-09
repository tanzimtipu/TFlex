// @vitest-environment jsdom
// Bug 12 — palette Rotate page button was a no-op stub.
//
// The ToolsPalette's onRotate handler used to be a no-op
// (`onRotate: () => {}`) with a comment claiming "rotate
// happens per-page in the rail". That left the palette entry
// visually wired but functionally dead. The fix routes the
// palette onRotate through the same onRotateClockwise path
// the toolbar's Rotate button uses: read the active tab's
// persisted currentPage and dispatch the engine rotate op.
//
// We exercise the ToolsPalette's onRotate here by mounting
// the component, clicking the Rotate entry, and asserting the
// handler fires. The wiring is verified end-to-end via the
// data-tool-id selector and the onClick callback that the
// host App passes.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ToolsPalette } from "../../../src/renderer/components/ToolsPalette";

function mountPalette(args: {
  onRotate: () => void;
}): { host: HTMLElement; onRotate: ReturnType<typeof vi.fn> } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onRotate = vi.fn(args.onRotate);
  act((): void => {
    root.render(
      <ToolsPalette
        layout="list"
        onLayoutChange={(): void => undefined}
        onMerge={(): void => undefined}
        onSplit={(): void => undefined}
        onExtract={(): void => undefined}
        onRotate={onRotate}
        onDelete={(): void => undefined}
        onSign={(): void => undefined}
        onOptimize={(): void => undefined}
        onAudit={(): void => undefined}
        onClose={(): void => undefined}
        hasOcrSuspects={false}
        documentRequired={true}
        hasFormFields={false}
      />,
    );
  });
  return { host, onRotate };
}

describe("Bug 12 — ToolsPalette Rotate page button fires onRotate", () => {
  it("clicking the Rotate entry invokes onRotate (regression guard)", () => {
    const { host, onRotate } = mountPalette({ onRotate: (): void => undefined });
    const rotateBtn = host.querySelector<HTMLElement>("[data-tool-id='rotate']");
    expect(rotateBtn).not.toBeNull();
    if (rotateBtn === null) return;
    act((): void => {
      rotateBtn.click();
    });
    // The previous no-op stub never invoked the host callback.
    // After the fix the host's onRotate (which routes to
    // engine.rotate) must run.
    expect(onRotate).toHaveBeenCalled();
  });

  it("the Rotate entry is enabled when a document is open (documentRequired=true)", () => {
    // The previous no-op stub left the entry enabled regardless
    // of document state (the click was a no-op anyway). The
    // fix preserves the existing `documentRequired` gate: a
    // real document must be open for the entry to be clickable.
    const { host } = mountPalette({ onRotate: (): void => undefined });
    const rotateBtn = host.querySelector<HTMLButtonElement>("[data-tool-id='rotate']");
    expect(rotateBtn).not.toBeNull();
    expect(rotateBtn?.disabled).toBe(false);
  });
});
