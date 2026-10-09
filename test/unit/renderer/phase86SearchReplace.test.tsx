// @vitest-environment jsdom
//
// Phase 86 (FEA-038) — renderer replace-over-Find.
// Covers the pieces this chunk owns: the hit -> occurrence mapping, the
// replace-one / replace-all payloads, the readable report, and the Find bar's
// replace toggle / input / disabled branches.
import { describe, expect, it, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  buildReplacePayload,
  formatReplaceReport,
  hitToOccurrence,
  occurrencesForHits,
  textItemsToGeomAligned,
} from "../../../src/renderer/components/DocumentView";
import {
  buildPageIndex,
  findPageHits,
  type SearchHit,
} from "../../../src/renderer/search/searchIndex";
import { SearchBar } from "../../../src/renderer/components/SearchBar";
import type { ReplaceOccurrence } from "../../../src/shared/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface SearchBarOptions {
  query?: string;
  resultCount?: number;
  replaceMode?: boolean;
  replacement?: string;
  replaceReport?: string;
  onToggleReplace?: () => void;
  onReplacement?: (s: string) => void;
  onReplaceOne?: () => void;
  onReplaceAll?: () => void;
}

function mountSearchBar(options: SearchBarOptions = {}): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <SearchBar
        query={options.query ?? ""}
        onQuery={(): void => undefined}
        resultCount={options.resultCount ?? 0}
        activeIndex={0}
        searching={false}
        onNext={(): void => undefined}
        onPrev={(): void => undefined}
        onClose={(): void => undefined}
        replaceMode={options.replaceMode ?? false}
        replacement={options.replacement ?? ""}
        replaceReport={options.replaceReport ?? ""}
        onToggleReplace={options.onToggleReplace ?? ((): void => undefined)}
        onReplacement={options.onReplacement ?? ((): void => undefined)}
        onReplaceOne={options.onReplaceOne ?? ((): void => undefined)}
        onReplaceAll={options.onReplaceAll ?? ((): void => undefined)}
      />,
    );
  });
  return host;
}

afterEach((): void => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("Phase 86 — hit to occurrence mapping", () => {
  it("maps a single-item hit to a page-space rect and the exact matched text", () => {
    const index = buildPageIndex(["Hello world"]);
    const geom = textItemsToGeomAligned(
      [{ str: "Hello world", transform: [1, 0, 0, 1, 10, 700], width: 110, height: 10 }],
      792,
    );
    const hit = findPageHits(index, 1, "world")[0];
    const occ = hitToOccurrence(hit, index, geom);
    expect(occ).not.toBeNull();
    expect(occ?.page).toBe(1);
    expect(occ?.find).toBe("world");
    // per-char width = 110 / 11 = 10; start offset 6 -> x 70; 5 chars -> 50.
    expect(occ?.rect).toEqual({ x: 70, y: 82, width: 50, height: 10 });
  });

  it("returns null when the page geometry is unavailable", () => {
    const index = buildPageIndex(["Hello world"]);
    const hit = findPageHits(index, 1, "world")[0];
    expect(hitToOccurrence(hit, index, undefined)).toBeNull();
    expect(hitToOccurrence(hit, undefined, [])).toBeNull();
  });

  it("keeps item alignment for empty / non-text pdf.js items", () => {
    const geom = textItemsToGeomAligned(
      [
        { str: "ab", transform: [1, 0, 0, 1, 0, 700], width: 20, height: 10 },
        { type: "beginMarkedContent" } as unknown as { str?: string },
        { str: "cd", transform: [1, 0, 0, 1, 20, 700], width: 20, height: 10 },
      ],
      792,
    );
    expect(geom.length).toBe(3);
    expect(geom[1]).toBeUndefined();
    expect(geom[2]?.text).toBe("cd");
  });
});

describe("Phase 86 — replace payloads", () => {
  it("builds the replace-one payload from the active occurrence", () => {
    const index = buildPageIndex(["foo bar"]);
    const geom = textItemsToGeomAligned(
      [{ str: "foo bar", transform: [1, 0, 0, 1, 0, 700], width: 70, height: 10 }],
      792,
    );
    const hit = findPageHits(index, 1, "bar")[0];
    const occ = hitToOccurrence(hit, index, geom) as ReplaceOccurrence;
    const payload = buildReplacePayload([occ], "baz");
    expect(payload).toEqual({ occurrences: [occ], replacement: "baz" });
    expect(payload.occurrences[0].find).toBe("bar");
  });

  it("builds a replace-all payload covering every hit in ONE call", () => {
    const indexes = new Map([
      [1, buildPageIndex(["foo one"])],
      [2, buildPageIndex(["foo two"])],
    ]);
    const geoms = new Map([
      [1, textItemsToGeomAligned([{ str: "foo one", transform: [1, 0, 0, 1, 0, 700], width: 70, height: 10 }], 792)],
      [2, textItemsToGeomAligned([{ str: "foo two", transform: [1, 0, 0, 1, 0, 700], width: 70, height: 10 }], 792)],
    ]);
    const hits: SearchHit[] = [
      ...findPageHits(indexes.get(1)!, 1, "foo"),
      ...findPageHits(indexes.get(2)!, 2, "foo"),
    ];
    const occurrences = occurrencesForHits(hits, indexes, geoms);
    expect(occurrences.length).toBe(2);
    const payload = buildReplacePayload(occurrences, "qux");
    expect(payload.replacement).toBe("qux");
    expect(payload.occurrences.map((o) => o.page)).toEqual([1, 2]);
    expect(payload.occurrences.every((o) => o.find === "foo")).toBe(true);
  });
});

describe("Phase 86 — report text", () => {
  it("always names the replaced / skipped counts", () => {
    expect(formatReplaceReport(2, [])).toBe("2 replaced, 0 skipped.");
  });

  it("names the first skip reason when an occurrence was skipped", () => {
    const skipped = [
      { page: 2, rect: { x: 0, y: 0, width: 10, height: 10 }, find: "x", reason: "page 2: covered glyphs do not spell the match" },
    ];
    const report = formatReplaceReport(1, skipped, []);
    expect(report).toContain("1 replaced, 1 skipped");
    expect(report).toContain("page 2: covered glyphs do not spell the match");
  });

  it("mentions substituted fonts when the engine had to substitute", () => {
    const report = formatReplaceReport(3, [], ["Helvetica-Bold"]);
    expect(report).toContain("3 replaced, 0 skipped");
    expect(report).toContain("substituted font: Helvetica-Bold");
  });
});

describe("Phase 86 — Find bar replace row", () => {
  it("renders the replace toggle and keeps the query untouched", () => {
    const onToggleReplace = vi.fn<() => void>();
    const onQuery = vi.fn<(q: string) => void>();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(
        <SearchBar
          query="keep me"
          onQuery={onQuery}
          resultCount={0}
          activeIndex={0}
          searching={false}
          onNext={(): void => undefined}
          onPrev={(): void => undefined}
          onClose={(): void => undefined}
          replaceMode={false}
          replacement=""
          replaceReport=""
          onToggleReplace={onToggleReplace}
          onReplacement={(): void => undefined}
          onReplaceOne={(): void => undefined}
          onReplaceAll={(): void => undefined}
        />,
      );
    });
    const toggle = host.querySelector<HTMLButtonElement>("[data-search-replace-toggle]");
    if (toggle === null) throw new Error("missing replace toggle");
    act((): void => {
      toggle.click();
    });
    expect(onToggleReplace).toHaveBeenCalledTimes(1);
    expect(onQuery).not.toHaveBeenCalled();
    // Not expanded -> no replace input.
    expect(host.querySelector("[data-search-replace-input]")).toBeNull();
  });

  it("hides the replace input until replaceMode is on", () => {
    const off = mountSearchBar({ replaceMode: false });
    expect(off.querySelector("[data-search-replace-input]")).toBeNull();
    const on = mountSearchBar({ replaceMode: true });
    expect(on.querySelector("[data-search-replace-input]")).not.toBeNull();
  });

  it("disables replace-one and replace-all when there are no hits", () => {
    const host = mountSearchBar({ replaceMode: true, resultCount: 0 });
    const one = host.querySelector<HTMLButtonElement>("[data-search-replace-one]");
    const all = host.querySelector<HTMLButtonElement>("[data-search-replace-all]");
    if (one === null || all === null) throw new Error("missing replace buttons");
    expect(one.disabled).toBe(true);
    expect(all.disabled).toBe(true);
  });

  it("enables the replace buttons once there are hits and routes the clicks", () => {
    const onReplaceOne = vi.fn<() => void>();
    const onReplaceAll = vi.fn<() => void>();
    const host = mountSearchBar({
      replaceMode: true,
      resultCount: 3,
      onReplaceOne,
      onReplaceAll,
    });
    const one = host.querySelector<HTMLButtonElement>("[data-search-replace-one]");
    const all = host.querySelector<HTMLButtonElement>("[data-search-replace-all]");
    if (one === null || all === null) throw new Error("missing replace buttons");
    expect(one.disabled).toBe(false);
    expect(all.disabled).toBe(false);
    act((): void => {
      one.click();
      all.click();
    });
    expect(onReplaceOne).toHaveBeenCalledTimes(1);
    expect(onReplaceAll).toHaveBeenCalledTimes(1);
  });

  it("renders the replaceReport line", () => {
    const host = mountSearchBar({
      replaceMode: true,
      resultCount: 1,
      replaceReport: "2 replaced, 1 skipped. page 2: covered glyphs do not spell the match.",
    });
    const line = host.querySelector("[data-search-replace-report]");
    expect(line?.textContent).toContain("2 replaced, 1 skipped");
  });
});

// TFL-1569 (B) — the Find input and the Replace input must render as one
// coherent two-row control: the same class (identical height / padding /
// radius / border token treatment) and no per-row inline size fork. jsdom
// lays nothing out, so the pixel-identical WIDTH that makes both edges line
// up is pinned statically in phase86SearchReplaceCss.test.ts.
describe("Phase 86 / TFL-1569 — the Find and Replace inputs are one control", () => {
  it("renders exactly the two shared-class inputs in replace mode", () => {
    const host = mountSearchBar({ replaceMode: true });
    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>(".search-input"));
    expect(inputs.length).toBe(2);
    expect(inputs[0].classList.contains("search-input")).toBe(true);
    expect(inputs[1].classList.contains("search-input")).toBe(true);
    // One shared class -> one height / padding / radius / border token set.
    expect(inputs[0].className).toBe(inputs[1].className);
  });

  it("carries no per-row inline height or width on either input", () => {
    const host = mountSearchBar({ replaceMode: true });
    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>(".search-input"));
    // Both measure the same (0 in jsdom); the real guard is that neither
    // input sets an inline size that would fork the shared .search-input rule.
    expect(inputs[0].offsetHeight).toBe(inputs[1].offsetHeight);
    expect(inputs[0].offsetWidth).toBe(inputs[1].offsetWidth);
    for (const input of inputs) {
      expect(input.style.height).toBe("");
      expect(input.style.width).toBe("");
    }
  });

  it("does not render the second input when the replace row is closed", () => {
    const host = mountSearchBar({ replaceMode: false });
    expect(host.querySelectorAll(".search-input").length).toBe(1);
  });
});
