// @vitest-environment jsdom
//
// Bug Sweep 1 — Home / Welcome start screen.
//
// Focused regression coverage for the sweep's pure-function and stylesheet
// fixes:
//   - `splitRecentPath` must not render a whole path as the file name when the
//     path ends in a separator (or is a bare drive root).
//   - `formatOpenedAt` boundaries (invalid / Today / Yesterday / Nd ago / date).
//   - `.welcome-actions` must wrap so the tool row is not clipped at the 640px
//     minimum window width (a source-level pin, since jsdom does no layout).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { formatOpenedAt, splitRecentPath } from "../../../src/renderer/utils/recentPath";
import { Welcome } from "../../../src/renderer/components/Welcome";
import type { SampleDocument } from "../../../src/shared/types";

describe("bugSweepWelcome — splitRecentPath", () => {
  it("keeps a sample path display-relative", () => {
    expect(splitRecentPath("samples/report.pdf")).toEqual({
      name: "report.pdf",
      dir: "samples",
      isSample: true,
    });
  });

  it("drops a trailing separator instead of returning the whole path as the name", () => {
    expect(splitRecentPath("C:\\Users\\me\\Documents\\")).toEqual({
      name: "Documents",
      dir: "C:\\Users\\me",
      isSample: false,
    });
  });

  it("resolves a bare drive root to the drive as the name", () => {
    expect(splitRecentPath("C:\\")).toEqual({ name: "C:", dir: "", isSample: false });
  });

  it("handles no-separator and empty paths", () => {
    expect(splitRecentPath("report.pdf")).toEqual({
      name: "report.pdf",
      dir: "",
      isSample: false,
    });
    expect(splitRecentPath("")).toEqual({ name: "", dir: "", isSample: false });
  });
});

describe("bugSweepWelcome — formatOpenedAt boundaries", () => {
  const now = Date.now();
  const isoAgo = (ms: number): string => new Date(now - ms).toISOString();
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;

  it("returns an em dash for an invalid date", () => {
    expect(formatOpenedAt("not-a-date")).toBe("\u2014");
  });

  it("labels each recent window at its boundary", () => {
    expect(formatOpenedAt(isoAgo(1000))).toBe("Today");
    expect(formatOpenedAt(isoAgo(25 * HOUR))).toBe("Yesterday");
    expect(formatOpenedAt(isoAgo(3 * DAY))).toBe("3d ago");
    expect(formatOpenedAt(isoAgo(10 * DAY))).toBe(
      new Date(now - 10 * DAY).toLocaleDateString(),
    );
  });
});

describe("bugSweepWelcome — Welcome tool row wraps at the 640px minimum", () => {
  it("styles.css lets .welcome-actions wrap instead of clipping the row", () => {
    const css = readFileSync(
      resolve(__dirname, "../../../src/renderer/styles.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.welcome-actions\s*\{[^}]*\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule?.[0]).toContain("flex-wrap: wrap");
  });
});

const RESOLVE_EMPTY = (): Promise<SampleDocument[]> => Promise.resolve([]);
const NEVER = (): Promise<SampleDocument[]> => new Promise<SampleDocument[]>(() => {});

const clickOn = (target: Element): void => {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
};

/** A viewport-space box for the plus's stubbed `getBoundingClientRect`. */
const boxOf = (right: number, bottom: number): DOMRect =>
  ({
    left: right - 36,
    top: bottom - 36,
    right,
    bottom,
    width: 36,
    height: 36,
    x: right - 36,
    y: bottom - 36,
    toJSON: () => ({}),
  }) as DOMRect;

function renderSweep(args: {
  samplesResolver: () => Promise<SampleDocument[]>;
  homeTools?: readonly string[];
  homeCandidates?: readonly string[];
}): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <Welcome
        recentFiles={[]}
        onOpenRecent={(): void => undefined}
        onRemoveRecent={(): void => undefined}
        onOpenFile={(): void => undefined}
        onSampleClick={(): void => undefined}
        samplesResolver={args.samplesResolver}
        homeTools={args.homeTools}
        homeCandidates={args.homeCandidates}
      />,
    );
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("bugSweepWelcome — DEF-473 picker resize re-clamp", () => {
  it("re-anchors and re-clamps the open picker on window resize", () => {
    const { host, unmount } = renderSweep({
      samplesResolver: RESOLVE_EMPTY,
      homeTools: ["merge"],
      homeCandidates: ["createFromImages", "merge", "preferences"],
    });
    try {
      clickOn(host.querySelector("[data-home-edit-toggle]") as Element);
      const plus = host.querySelector("[data-home-plus]") as HTMLButtonElement;
      let box = boxOf(50, 50);
      plus.getBoundingClientRect = (): DOMRect => box;
      clickOn(plus);

      let picker = document.querySelector("[data-home-picker]") as HTMLElement;
      expect(picker).not.toBeNull();
      // jsdom reports zero-size rects, so the HOME_PICKER_W/H fallback
      // (200x168) drives the clamp exactly as the placeHomePicker test does.
      expect(picker.style.left).toBe("8px");
      expect(picker.style.top).toBe("56px");

      // The window shrinks and the plus moves: the picker must follow.
      box = boxOf(1030, 760);
      act((): void => {
        window.dispatchEvent(new Event("resize"));
      });
      picker = document.querySelector("[data-home-picker]") as HTMLElement;
      expect(picker.style.left).toBe("816px");
      expect(picker.style.top).toBe("592px");
    } finally {
      unmount();
    }
  });
});

describe("bugSweepWelcome — DEF-472 samples loading ring spins", () => {
  it("carries the shared update-indicator-spin class while samples load", () => {
    const { host, unmount } = renderSweep({ samplesResolver: NEVER });
    try {
      const loader = host.querySelector("[data-brand-loader]");
      expect(loader).not.toBeNull();
      expect(loader?.classList.contains("update-indicator-spin")).toBe(true);
      expect(host.querySelector(".samples-empty")?.textContent).toContain("Loading");
    } finally {
      unmount();
    }
  });
});