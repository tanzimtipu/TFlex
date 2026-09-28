// @vitest-environment jsdom
//
// Phase 52 follow-up (operator bug 1) — a text box must NEVER show two
// outlines. Phase 51 gave every text-box surface a thicker, rounded frame;
// a SELECTED annotation textbox / callout then ALSO got the shared
// `.content-selection-bounds` ring from the selection chrome, painting a
// second, concentric outline. The single rounded frame now carries the
// selection by changing to the accent border + accent wash.
//
// One rule per state/kind:
//   - selected textbox: no bounds ring, single accent frame;
//   - selected callout: no bounds ring, single accent frame;
//   - selected SHAPE still uses the shared bounds ring (unchanged);
//   - the run editor's FOCUS state paints one border (no box-shadow ring);
//   - the selected text-run surface paints one border (no box-shadow ring).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type {
  Annotation,
  AnnotationToolState,
} from "../../../src/renderer/annotations/model";

const CSS = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first `selector { ... }` whose selector starts a line. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = CSS.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? "";
}

const RECT_ANN: Annotation = {
  id: "rect-1",
  kind: "rect",
  page: 1,
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 100, y: 100, width: 150, height: 80 },
};

const TEXTBOX_ANN: Annotation = {
  id: "tbx-1",
  kind: "textbox",
  page: 1,
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 200, y: 200, width: 160, height: 60 },
  text: "SOME BOX TEXT",
};

const CALLOUT_ANN: Annotation = {
  id: "cal-1",
  kind: "callout",
  page: 1,
  color: "green",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 260, y: 300, width: 150, height: 60 },
  at: { x: 200, y: 260 },
  text: "CALLOUT TEXT",
};

const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };

function mountOverlay(annotations: Annotation[]): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <AnnotationOverlay
        page={1}
        widthPt={612}
        heightPt={792}
        cssScale={1}
        annotations={annotations}
        tool={SELECT_TOOL}
        flashId={null}
        getTextItems={(): never[] => []}
        onCreate={(): void => undefined}
        onFinishedOneShot={undefined}
      />,
    );
  });
  return {
    host,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function clickEl(el: Element): void {
  act((): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("Phase 52 bug 1 — a selected text box shows exactly ONE rounded border", () => {
  it("selected textbox: the shared bounds ring is absent; its own frame turns accent", () => {
    const { host, cleanup } = mountOverlay([TEXTBOX_ANN]);
    try {
      const box = host.querySelector<HTMLElement>(".ann-textbox[data-annotation-id='tbx-1']");
      expect(box, "textbox renders").not.toBeNull();
      if (box === null) return;
      // Resting: the box's own frame carries the annotation colour.
      expect(box.style.borderColor, "resting frame = annotation colour").not.toBe("var(--accent)");
      clickEl(box);
      expect(host.querySelector("[data-content-selection-frame]"), "selection frame present").not.toBeNull();
      expect(
        host.querySelector("[data-content-selection-bounds]"),
        "no second outline on a selected textbox",
      ).toBeNull();
      expect(box.style.borderColor, "single frame indicates selection").toBe("var(--accent)");
      expect(box.style.background).toBe("var(--accent-soft)");
    } finally {
      cleanup();
    }
  });

  it("selected callout: the shared bounds ring is absent; its own frame turns accent", () => {
    const { host, cleanup } = mountOverlay([CALLOUT_ANN]);
    try {
      const box = host.querySelector<HTMLElement>(".ann-callout[data-annotation-id='cal-1']");
      expect(box, "callout renders").not.toBeNull();
      if (box === null) return;
      clickEl(box);
      expect(host.querySelector("[data-content-selection-frame]")).not.toBeNull();
      expect(host.querySelector("[data-content-selection-bounds]")).toBeNull();
      expect(box.style.borderColor).toBe("var(--accent)");
    } finally {
      cleanup();
    }
  });

  it("selected SHAPE keeps the shared bounds ring (selection chrome unchanged)", () => {
    const { host, cleanup } = mountOverlay([RECT_ANN]);
    try {
      const shape = host.querySelector<Element>(".ann-shape[data-annotation-id='rect-1']");
      expect(shape).not.toBeNull();
      if (shape === null) return;
      clickEl(shape);
      expect(host.querySelector("[data-content-selection-bounds]")).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("focus / selected states carry no second box-shadow ring", () => {
    // The on-canvas run editor: focused = accent border only.
    expect(ruleBody(".edit-run-editor:focus")).toMatch(/border-color:\s*var\(--accent\)/);
    expect(ruleBody(".edit-run-editor:focus"), "no focus ring on top of the border").not.toMatch(
      /box-shadow/,
    );
    // The selected text-run surface: one solid border only.
    const runSel = ruleBody(".edit-textrun-selection");
    expect(runSel).toMatch(/border:\s*1\.5px solid var\(--accent\)/);
    expect(runSel, "no second ring on the selection surface").not.toMatch(/box-shadow/);
    // The textbox editor focus keeps a single border (no second outline).
    expect(ruleBody(".ann-textbox-editor:focus")).toMatch(/border-color:\s*var\(--accent\)/);
    expect(ruleBody(".ann-textbox-editor:focus")).not.toMatch(/box-shadow|outline/);
  });
});
