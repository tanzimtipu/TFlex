// @vitest-environment jsdom
//
// TFL-1119 (TFL-1116 C2) - the document-scoped Deliver export draft.
//
// The Deliver export configuration used to live in local `useState` inside
// `ExportConfigSection`, so the collapse remount at a compact width reset the
// format/scope/range/DPI to the persisted default (R02). These specs pin the
// pure document-scoped store, the controlled Inspector surface's retention
// across unmount/remount and tab switch, and the rule that a resize never runs
// an export.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Inspector, type InspectorProps } from "../../../src/renderer/components/Inspector";
import {
  defaultExportDraft,
  exportDraftFor,
  withExportCustomRange,
  withExportDpi,
  withExportFormat,
  withExportScope,
  type ExportDraft,
} from "../../../src/renderer/state/exportDraft";

interface ControlledHarness {
  host: HTMLElement;
  draft: () => ExportDraft;
  change: (fn: () => void) => void;
  unmount: () => void;
}

/** Render the Inspector as App does - with a CONTROLLED draft whose patch
 *  handler feeds the next render - so an edit is observable as a stored value. */
function renderControlled(
  initialDraft: ExportDraft,
  extra: Partial<InspectorProps> = {},
): ControlledHarness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  let draft = initialDraft;
  // The config surface only renders in CONFIG mode (`onRun` wired), exactly as
  // App always wires it; a no-op default keeps the surface mounted otherwise.
  const { onExportRun, ...rest } = extra;
  const paint = (): void => {
    act((): void => {
      root.render(
        <Inspector
          stage="deliver"
          pageCount={5}
          exportDraft={draft}
          onExportDraftChange={(patch): void => {
            draft = { ...draft, ...patch };
          }}
          onExportRun={onExportRun ?? ((): void => undefined)}
          {...rest}
        />,
      );
    });
  };
  paint();
  return {
    host,
    draft: (): ExportDraft => draft,
    change: (fn: () => void): void => {
      act((): void => {
        fn();
      });
      paint();
    },
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

function query<T extends Element>(host: HTMLElement, selector: string): T {
  const found = host.querySelector<T>(selector);
  if (found === null) throw new Error(`missing ${selector}`);
  return found;
}

function typeRange(host: HTMLElement, value: string): void {
  const input = query<HTMLInputElement>(host, "[data-export-config-range]");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("TFL-1119 - the pure document-scoped export store", () => {
  it("opens on the shipped default with a clamped DPI", () => {
    expect(defaultExportDraft(9999)).toEqual({
      format: "png",
      scope: "all",
      customRange: "",
      dpi: 600,
    });
    expect(defaultExportDraft(10).dpi).toBe(72);
  });

  it("resolves a stored draft, and the default for unknown/null docs", () => {
    const stored: ExportDraft = {
      format: "docx",
      scope: "custom",
      customRange: "2-3",
      dpi: 300,
    };
    const drafts = { "doc-a": stored };
    expect(exportDraftFor(drafts, "doc-a", 150)).toEqual(stored);
    expect(exportDraftFor(drafts, "doc-b", 150)).toEqual(defaultExportDraft(150));
    expect(exportDraftFor(drafts, null, 150)).toEqual(defaultExportDraft(150));
  });

  it("patches immutably", () => {
    const base: ExportDraft = {
      format: "png",
      scope: "all",
      customRange: "",
      dpi: 150,
    };
    const snapshot = { ...base };
    expect(withExportFormat(base, "jpeg").format).toBe("jpeg");
    expect(withExportScope(base, "current").scope).toBe("current");
    expect(withExportCustomRange(base, "1-2").customRange).toBe("1-2");
    expect(withExportDpi(base, 9999).dpi).toBe(600);
    expect(base).toEqual(snapshot);
  });
});

describe("TFL-1119 - retention across unmount/remount", () => {
  it("re-renders format, scope and range from the SAME draft object", () => {
    const initial: ExportDraft = {
      format: "docx",
      scope: "all",
      customRange: "",
      dpi: 150,
    };
    const first = renderControlled(initial);
    let kept: ExportDraft = initial;
    try {
      expect(
        query<HTMLInputElement>(first.host, '[data-export-config-format-option="docx"]')
          .checked,
      ).toBe(true);
      // docx is text-only: the DPI control does not apply.
      expect(first.host.querySelector("[data-export-config-dpi]")).toBeNull();

      first.change((): void => {
        query<HTMLInputElement>(first.host, '[data-export-config-scope="custom"]').click();
      });
      first.change((): void => typeRange(first.host, "2-3"));
      kept = first.draft();
      expect(kept).toEqual({
        format: "docx",
        scope: "custom",
        customRange: "2-3",
        dpi: 150,
      });
    } finally {
      first.unmount();
    }

    // Remount with the SAME stored draft: the surface reads it, not a reset.
    const second = renderControlled(kept);
    try {
      expect(
        query<HTMLInputElement>(second.host, '[data-export-config-format-option="docx"]')
          .checked,
      ).toBe(true);
      expect(
        query<HTMLInputElement>(second.host, '[data-export-config-scope="custom"]')
          .checked,
      ).toBe(true);
      expect(query<HTMLInputElement>(second.host, "[data-export-config-range]").value).toBe(
        "2-3",
      );
      expect(second.host.querySelector("[data-export-config-dpi]")).toBeNull();
    } finally {
      second.unmount();
    }
  });
});

describe("TFL-1119 - tab switch resolves each document's own draft", () => {
  it("renders the stored format for each doc id", () => {
    const drafts: Record<string, ExportDraft> = {
      "doc-a": { format: "docx", scope: "all", customRange: "", dpi: 150 },
      "doc-b": { format: "jpeg", scope: "all", customRange: "", dpi: 150 },
    };
    const a = renderControlled(exportDraftFor(drafts, "doc-a", 150));
    try {
      expect(
        query<HTMLInputElement>(a.host, '[data-export-config-format-option="docx"]').checked,
      ).toBe(true);
    } finally {
      a.unmount();
    }
    const b = renderControlled(exportDraftFor(drafts, "doc-b", 150));
    try {
      expect(
        query<HTMLInputElement>(b.host, '[data-export-config-format-option="jpeg"]').checked,
      ).toBe(true);
      expect(
        query<HTMLInputElement>(b.host, '[data-export-config-format-option="docx"]').checked,
      ).toBe(false);
    } finally {
      b.unmount();
    }
  });
});

describe("TFL-1119 - a resize/rerender never runs an export", () => {
  it("only the Export button fires onExportRun", () => {
    const onExportRun = vi.fn();
    const draft: ExportDraft = {
      format: "png",
      scope: "all",
      customRange: "",
      dpi: 150,
    };
    const harness = renderControlled(draft, { onExportRun });
    try {
      act((): void => {
        window.dispatchEvent(new Event("resize"));
      });
      harness.change((): void => {
        query<HTMLInputElement>(harness.host, '[data-export-config-scope="current"]').click();
      });
      expect(onExportRun).not.toHaveBeenCalled();

      harness.change((): void => {
        query<HTMLElement>(harness.host, '[data-inspector-action="export"]').click();
      });
      expect(onExportRun).toHaveBeenCalledTimes(1);
    } finally {
      harness.unmount();
    }
  });
});