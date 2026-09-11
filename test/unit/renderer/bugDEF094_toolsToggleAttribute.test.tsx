// @vitest-environment jsdom
//
// Regression guard for DEF-094 — the Tools palette toggle button in
// the toolbar must expose a stable `data-tools-toggle` attribute that
// e2e harnesses can target without scraping labels. The previous
// version of the toolbar rendered the button with only an
// `aria-label`, which broke every e2e spec that opened the Tools
// palette via `[data-tools-toggle]` (Merge / Export / OCR / Optimize
// dialogs). The fix adds the boolean attribute to the JSX; this test
// asserts the rendered DOM contains the attribute regardless of how
// React-19 chooses to encode it ("true" or empty string are both
// valid for the `[data-tools-toggle]` CSS selector).

import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Toolbar } from "../../../src/renderer/components/Toolbar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountToolbar(args: {
  toolsPaletteOpen: boolean;
}): { host: HTMLElement; root: ReturnType<typeof createRoot>; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <Toolbar
        page={1}
        pageCount={10}
        zoomPercent={100}
        zoomMode="fit-width"
        modified={false}
        saveInPlaceEnabled={true}
        onJump={(): void => undefined}
        onZoomIn={(): void => undefined}
        onZoomOut={(): void => undefined}
        onFitWidth={(): void => undefined}
        onFitPage={(): void => undefined}
        searchOpen={false}
        onToggleSearch={(): void => undefined}
        onSave={(): void => undefined}
        onSaveAs={(): void => undefined}
        onMerge={(): void => undefined}
        onSplit={(): void => undefined}
        signToolActive={false}
        onSignClick={(): void => undefined}
        onFlattenClick={(): void => undefined}
        hasFormFields={false}
        onOptimize={(): void => undefined}
        onAuditSpace={(): void => undefined}
        toolsPaletteOpen={args.toolsPaletteOpen}
        onToolsPaletteToggle={(): void => undefined}
      />,
    );
  });
  return {
    host,
    root,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("DEF-094 — Toolbar exposes data-tools-toggle for stable e2e selection", () => {
  it("renders the Tools button with the data-tools-toggle attribute", () => {
    const { host, cleanup } = mountToolbar({ toolsPaletteOpen: false });
    try {
      // The selector e2e harnesses rely on. CSS `[data-tools-toggle]`
      // matches as long as the attribute exists with any value, so we
      // assert the attribute node is present rather than a specific
      // value (React-19 may render boolean attrs as `=""` or
      // `="true"` depending on the attribute).
      const matches = host.querySelectorAll("[data-tools-toggle]");
      expect(matches.length).toBe(1);
      const btn = matches[0] as HTMLButtonElement;
      expect(btn.tagName.toLowerCase()).toBe("button");
      // Phase 13 — the button is the icon-only "More tools" ellipsis
      // (the Tools palette is the overflow surface); the accessible
      // name changed with the redesign, the stable attribute did not.
      expect(btn.getAttribute("aria-label")).toBe("More tools");
      // And the click handler is wired — clicking it doesn't throw.
      expect((): void => btn.click()).not.toThrow();
    } finally {
      cleanup();
    }
  });

  it("the data-tools-toggle attribute is present in both closed and open states", () => {
    for (const open of [false, true]) {
      const { host, cleanup } = mountToolbar({ toolsPaletteOpen: open });
      try {
        const matches = host.querySelectorAll("[data-tools-toggle]");
        expect(matches.length).toBe(1);
      } finally {
        cleanup();
      }
    }
  });
});
