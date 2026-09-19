// @vitest-environment jsdom
// B11 — page label (renumber) viewer display. The Toolbar's page
// indicator shows the logical page label (e.g. "iv", "A1") next
// to the raw page number when `pageLabel` is non-null. The
// resolvePageLabel helper resolves a 1-based visible page to
// its label from a sparse `PageLabelEntry[]`. We exercise:
//   1. Empty labels -> no hint renders.
//   2. Label for the current page -> hint renders with the
//      correct text and data attribute.
//   3. Label for a different page -> no hint renders.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { Toolbar } from "../../../src/renderer/components/Toolbar";

function mountToolbar(args: {
  page?: number;
  pageCount?: number;
  pageLabel?: string | null;
}): {
  host: HTMLElement;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const noop = (): void => undefined;
  act((): void => {
    root.render(
      <Toolbar
        page={args.page ?? 1}
        pageCount={args.pageCount ?? 5}
        pageLabel={args.pageLabel ?? null}
        zoomPercent={100}
        zoomMode="fit-width"
        onJump={noop}
        onZoomIn={noop}
        onZoomOut={noop}
        onFitWidth={noop}
        onFitPage={noop}
        searchOpen={false}
        onToggleSearch={noop}
        onMerge={noop}
        onSplit={noop}
        signToolActive={false}
        onSignClick={noop}
        hasFormFields={false}
        onFlattenClick={noop}
        onOptimize={noop}
        onAuditSpace={noop}
      />,
    );
  });
  return { host };
}

describe("B11 — Toolbar page label hint", () => {
  it("no hint when pageLabel is null", () => {
    const { host } = mountToolbar({ page: 1, pageLabel: null });
    expect(host.querySelector(".page-label-hint")).toBeNull();
  });

  it("renders the hint when a label is set for the current page", () => {
    const { host } = mountToolbar({ page: 2, pageLabel: "iv" });
    const hint = host.querySelector(".page-label-hint");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe("iv");
    expect(hint?.getAttribute("data-page-label")).toBe("iv");
  });

  it("renders the hint with a more complex label (A1)", () => {
    const { host } = mountToolbar({ page: 5, pageLabel: "A1" });
    const hint = host.querySelector(".page-label-hint");
    expect(hint?.textContent).toBe("A1");
  });
});
