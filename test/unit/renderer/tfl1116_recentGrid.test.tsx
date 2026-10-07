// @vitest-environment jsdom
//
// TFL-1143 (TFL-1116 C7b, R08) — the Home recent row is ONE shared CSS grid.
//
// Every row must resolve the SAME track definition (icon / minmax(0,1fr)
// filename / type / status / date / actions), so a row without a Missing badge
// (or with fewer actions) keeps the date and actions in the SAME tracks as a
// row that has them. The status cell is ALWAYS rendered; the date reads with
// tabular numerals; compact width moves type/status/date to a secondary line.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { HomeRecentRow } from "../../../src/renderer/components/home/HomeRecentRow";
import type { RecentFile } from "../../../src/shared/types";

interface Row {
  entry: RecentFile;
  meta: { name: string; dir: string; isSample: boolean };
}

function makeRow(overrides: Partial<RecentFile> & Pick<RecentFile, "path" | "name">): Row {
  const entry: RecentFile = { openedAt: new Date().toISOString(), ...overrides };
  const parts = overrides.path.replace(/[\\/]+$/, "").split(/[\\/]+/);
  const name = parts[parts.length - 1];
  const dir = parts.slice(0, -1).join("\\");
  return { entry, meta: { name, dir, isSample: false } };
}

const NOOP = (): void => undefined;

function mountRows(rows: Row[], missingPaths: readonly string[]): {
  host: HTMLElement;
  unmount: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const missing = new Set(missingPaths);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <>
        {rows.map((r) => (
          <HomeRecentRow
            key={r.entry.path}
            entry={r.entry}
            meta={r.meta}
            contextLabel={r.meta.dir}
            missing={missing.has(r.entry.path)}
            onOpen={NOOP}
            onRemove={NOOP}
            onTogglePin={NOOP}
            onShowInFolder={NOOP}
            onLocateMissing={NOOP}
          />
        ))}
      </>,
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

function classList(el: Element): string[] {
  return [...el.children].map((c) => c.getAttribute("class") ?? "");
}

describe("TFL-1143 R08 — every recent row resolves the SAME track cells", () => {
  const healthy = makeRow({ path: "C:\\Docs\\a.pdf", name: "a.pdf" });
  const gone = makeRow({ path: "C:\\Docs\\b.pdf", name: "b.pdf" });

  it("keeps the date and actions in the same tracks with or without Missing", () => {
    const { host, unmount } = mountRows([healthy, gone], ["C:\\Docs\\b.pdf"]);
    try {
      const rows = [...host.querySelectorAll<HTMLElement>("[data-recent-row]")];
      expect(rows).toHaveLength(2);
      // The two rows render the identical ordered cell list: nothing is
      // conditionally inserted or removed, so no track can shift.
      expect(classList(rows[0])).toEqual(classList(rows[1]));
      expect([...rows[0].children].map((c) => c.className)).toEqual([
        "btn btn-ghost recent-row-open",
        "recent-row-meta",
        "recent-row-actions",
      ]);
      // Both dates and both action clusters exist on both rows.
      for (const row of rows) {
        expect(row.querySelector(".doc-when")).not.toBeNull();
        expect(row.querySelector(".recent-row-actions")).not.toBeNull();
      }
    } finally {
      unmount();
    }
  });

  it("always renders the status cell; empty for a healthy row, badged when missing", () => {
    const { host, unmount } = mountRows([healthy, gone], ["C:\\Docs\\b.pdf"]);
    try {
      const healthyRow = host.querySelector<HTMLElement>('[data-recent-row][data-recent-missing="false"]');
      const goneRow = host.querySelector<HTMLElement>('[data-recent-row][data-recent-missing="true"]');
      const healthyStatus = healthyRow?.querySelector(".recent-row-status");
      expect(healthyStatus).not.toBeNull();
      expect(healthyStatus?.getAttribute("data-recent-status")).toBe("none");
      expect(healthyStatus?.textContent).toBe("");
      expect(goneRow?.querySelector("[data-recent-missing-note]")?.textContent).toBe("Missing");
      expect(goneRow?.querySelector(".recent-row-status")?.getAttribute("data-recent-status")).toBe(
        "present",
      );
      // The meta cell keeps the SAME three ordered children on both rows.
      for (const row of [healthyRow, goneRow]) {
        const meta = row?.querySelector(".recent-row-meta");
        expect([...(meta?.children ?? [])].map((c) => c.className)).toEqual([
          "doc-format",
          "recent-row-status",
          "doc-when",
        ]);
      }
    } finally {
      unmount();
    }
  });
});

describe("TFL-1143 R08 — stylesheet pins the ONE shared track definition", () => {
  const css = readFileSync(
    resolve(__dirname, "../../../src/renderer/styles.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  it("declares a six-track grid on .recent-row and reuses it", () => {
    const rule = /\.recent-row\s*\{[^}]*\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule?.[0]).toContain("--recent-row-grid: auto minmax(0, 1fr) 84px 92px 80px 116px");
    expect(rule?.[0]).toContain("grid-template-columns: var(--recent-row-grid)");
    expect(rule?.[0]).toContain("display: grid");
  });

  it("rides subgrid for the icon/name and type/status/date cells", () => {
    const open = /\.recent-row-open\s*\{[^}]*\}/.exec(css);
    expect(open?.[0]).toContain("grid-column: 1 / 3");
    expect(open?.[0]).toContain("grid-template-columns: subgrid");
    const meta = /\.recent-row-meta\s*\{[^}]*\}/.exec(css);
    expect(meta?.[0]).toContain("grid-column: 3 / 6");
    expect(meta?.[0]).toContain("grid-template-columns: subgrid");
    const actions = /\.recent-row-actions\s*\{[^}]*\}/.exec(css);
    expect(actions?.[0]).toContain("grid-column: 6");
  });

  it("dates read with tabular numerals in their own fixed track", () => {
    const when = /\.recent-row \.doc-when\s*\{[^}]*\}/.exec(css);
    expect(when?.[0]).toContain("font-variant-numeric: tabular-nums");
  });

  it("drops status/date to a designed secondary line at compact width", () => {
    const compactMeta = /\.recent-row-meta\s*\{[^}]*grid-row: 2[^}]*\}/.exec(css);
    expect(compactMeta).not.toBeNull();
    expect(css).toContain("grid-template-rows: auto auto");
  });
});
