// @vitest-environment jsdom
//
// Phase 112 (TFL-854, chunk C6b) — the Home Recent + Samples surfaces.
//
// The Home screen's Recent-documents list and Sample cards consume the C6a
// recent-files contract and the shared panel vocabulary WITHOUT changing a
// command, handler, shortcut, selector, document operation or undo/redo
// behaviour. These tests pin the brief's exact contract:
//   RECENT — a row shows the real filename, the compact location, the TRUE
//            last-opened time and VERIFIED metadata only (the recorded
//            sourceLabel / sourceKind, a converted marker, otherwise an
//            extension HINT); Open / Pin / Show in folder / Locate missing /
//            Remove are present and wired (Remove calls the existing handler
//            and never deletes); a missing file renders its missing state and
//            the Locate action; every data-* hook is preserved.
//   SAMPLES — the real first-page preview (or the honest per-sample fallback),
//            the actual filenames and the verified task purpose stay intact.
//
// NOTE (empty state): the brief asked to port the empty state to
// PanelEmptyState, but phase106HomeOrbit and bugSweepWelcome pin the designed
// `.recent-empty.empty-state` / `.samples-empty.empty-state` markup (headline
// + help + mark) which the brief ALSO marks as no-regression. The shared
// designed EmptyState is therefore preserved and asserted here.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Welcome } from "../../../src/renderer/components/Welcome";
import type { RecentFile, SampleDocument } from "../../../src/shared/types";

interface RecentDisplay {
  entry: RecentFile;
  meta: { name: string; dir: string; isSample: boolean };
}

function recent(overrides: Partial<RecentFile> & Pick<RecentFile, "path" | "name">): RecentDisplay {
  const entry: RecentFile = {
    openedAt: new Date().toISOString(),
    ...overrides,
  };
  const parts = overrides.path.replace(/[\\/]+$/, "").split(/[\\/]+/);
  const name = parts[parts.length - 1];
  const dir = parts.slice(0, -1).join("\\");
  return { entry, meta: { name, dir, isSample: false } };
}

const RESOLVE_SAMPLES =
  (list: SampleDocument[]) =>
  (): Promise<SampleDocument[]> =>
    Promise.resolve(list);

interface MountArgs {
  recentFiles?: RecentDisplay[];
  samples?: SampleDocument[];
  missingRecentPaths?: string[];
  onOpenRecent?: (entry: RecentFile) => void;
  onRemoveRecent?: (entry: RecentFile) => void;
  onToggleRecentPin?: (entry: RecentFile) => void;
  onShowRecentInFolder?: (entry: RecentFile) => void;
  onLocateRecentMissing?: (entry: RecentFile) => void;
}

function mountWelcome(args: MountArgs): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <Welcome
        recentFiles={args.recentFiles ?? []}
        onOpenRecent={args.onOpenRecent ?? ((): void => undefined)}
        onRemoveRecent={args.onRemoveRecent ?? ((): void => undefined)}
        onOpenFile={(): void => undefined}
        onSampleClick={(): void => undefined}
        samplesResolver={RESOLVE_SAMPLES(args.samples ?? [])}
        missingRecentPaths={args.missingRecentPaths}
        onToggleRecentPin={args.onToggleRecentPin}
        onShowRecentInFolder={args.onShowRecentInFolder}
        onLocateRecentMissing={args.onLocateRecentMissing}
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

function clickOn(target: Element | null): void {
  if (target === null) throw new Error("clickOn: missing target");
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Phase 112 C6b — a recent row shows real, verified-honest data", () => {
  it("shows the real filename, compact location and last-opened time", () => {
    const row = recent({ path: "C:\\Users\\me\\Docs\\sheet.xlsx", name: "sheet.xlsx" });
    const { host, unmount } = mountWelcome({ recentFiles: [row] });
    try {
      const el = host.querySelector("[data-recent-row]");
      expect(el).not.toBeNull();
      expect(el?.querySelector(".doc-name")?.textContent).toBe("sheet.xlsx");
      expect(el?.querySelector(".doc-path")?.textContent).toBe("Docs");
      expect(el?.querySelector(".doc-when")?.textContent).toBe("Today");
    } finally {
      unmount();
    }
  });

  it("labels an extension-only format as an unverified HINT, never a verified type", () => {
    const row = recent({ path: "C:\\Docs\\memo.docx", name: "memo.docx" });
    const { host, unmount } = mountWelcome({ recentFiles: [row] });
    try {
      const chip = host.querySelector(".doc-format");
      expect(chip?.textContent).toBe("DOCX");
      expect(chip?.getAttribute("data-source-verified")).toBe("hint");
      expect(chip?.getAttribute("data-source-format")).toBe("document");
    } finally {
      unmount();
    }
  });

  it("shows the recorded source label / kind and a converted marker when verified", () => {
    const row = recent({
      path: "C:\\Docs\\memo.docx",
      name: "memo.docx",
      sourceLabel: "Word Document",
      sourceKind: "docx",
      converted: true,
    });
    const { host, unmount } = mountWelcome({ recentFiles: [row] });
    try {
      const chip = host.querySelector(".doc-format");
      expect(chip?.textContent).toBe("Word Document");
      expect(chip?.getAttribute("data-source-format")).toBe("docx");
      expect(chip?.getAttribute("data-source-verified")).toBe("verified");
      const converted = host.querySelector("[data-recent-converted]");
      expect(converted).not.toBeNull();
      expect(converted?.textContent).toBe("Converted");
    } finally {
      unmount();
    }
  });
});

describe("Phase 112 C6b — the recent-row actions are present and wired", () => {
  function rowWithAll(): RecentDisplay {
    return recent({ path: "C:\\Docs\\a.pdf", name: "a.pdf" });
  }

  it("renders Open, Pin, Show in folder and Remove and routes each to its handler", () => {
    const entry = rowWithAll();
    const onOpenRecent = vi.fn();
    const onRemoveRecent = vi.fn();
    const onToggleRecentPin = vi.fn();
    const onShowRecentInFolder = vi.fn();
    const { host, unmount } = mountWelcome({
      recentFiles: [entry],
      onOpenRecent,
      onRemoveRecent,
      onToggleRecentPin,
      onShowRecentInFolder,
    });
    try {
      clickOn(host.querySelector('[data-recent-action="open"]'));
      clickOn(host.querySelector('[data-recent-action="pin"]'));
      clickOn(host.querySelector('[data-recent-action="show"]'));
      clickOn(host.querySelector('[data-recent-action="remove"]'));
      expect(onOpenRecent).toHaveBeenCalledWith(entry.entry);
      expect(onToggleRecentPin).toHaveBeenCalledWith(entry.entry);
      expect(onShowRecentInFolder).toHaveBeenCalledWith(entry.entry);
      // Remove calls ONLY the existing handler: no other action fires, and no
      // file-deleting callback exists to fire.
      expect(onRemoveRecent).toHaveBeenCalledWith(entry.entry);
      expect(onRemoveRecent).toHaveBeenCalledTimes(1);
      expect(onToggleRecentPin).toHaveBeenCalledTimes(1);
      expect(onShowRecentInFolder).toHaveBeenCalledTimes(1);
      expect(entry.entry.path).toBe("C:\\Docs\\a.pdf");
    } finally {
      unmount();
    }
  });

  it("reflects the pinned flag on the Pin action", () => {
    const entry = recent({ path: "C:\\Docs\\p.pdf", name: "p.pdf", pinned: true });
    const { host, unmount } = mountWelcome({ recentFiles: [entry], onToggleRecentPin: vi.fn() });
    try {
      const pin = host.querySelector('[data-recent-action="pin"]');
      expect(pin?.getAttribute("aria-pressed")).toBe("true");
    } finally {
      unmount();
    }
  });
});

describe("Phase 112 C6b — the missing-file state", () => {
  it("renders the missing state and the Locate action only for a missing file", () => {
    const present = recent({ path: "C:\\Docs\\here.pdf", name: "here.pdf" });
    const gone = recent({ path: "C:\\Docs\\gone.pdf", name: "gone.pdf" });
    const onLocateRecentMissing = vi.fn();
    const { host, unmount } = mountWelcome({
      recentFiles: [present, gone],
      missingRecentPaths: ["C:\\Docs\\gone.pdf"],
      onLocateRecentMissing,
    });
    try {
      const missingRow = host.querySelector('[data-recent-row][data-recent-missing="true"]');
      expect(missingRow?.querySelector("[data-recent-missing-note]")?.textContent).toBe("Missing");
      expect(missingRow?.querySelector('[data-recent-action="locate"]')).not.toBeNull();
      const presentRow = host.querySelector('[data-recent-row][data-recent-missing="false"]');
      expect(presentRow?.querySelector("[data-recent-action='locate']")).toBeNull();

      clickOn(missingRow?.querySelector('[data-recent-action="locate"]') ?? null);
      expect(onLocateRecentMissing).toHaveBeenCalledWith(gone.entry);
    } finally {
      unmount();
    }
  });
});

describe("Phase 112 C6b — samples keep the real preview, fallback and verified purpose", () => {
  it("keeps the real first-page preview element or the honest per-sample fallback", async () => {
    const samples: SampleDocument[] = [
      { name: "form.pdf", path: "samples/form.pdf" },
      { name: "scanned.pdf", path: "samples/scanned.pdf" },
    ];
    const { host, unmount } = mountWelcome({ samples });
    try {
      await flush();
      const cards = [...host.querySelectorAll<HTMLElement>("[data-sample-card]")];
      expect(cards).toHaveLength(2);
      expect(cards.map((c) => c.getAttribute("data-sample-task"))).toEqual(["forms", "recognition"]);
      for (const card of cards) {
        const thumb = card.querySelector(".sample-thumb");
        expect(thumb).not.toBeNull();
        expect(thumb?.getAttribute("data-sample-preview")).toBe("unavailable");
        expect(thumb?.querySelector(".sample-thumb-glyph")).not.toBeNull();
      }
      expect(cards[0]?.querySelector(".sample-name")?.textContent).toBe("form.pdf");
      expect(cards[0]?.querySelector(".sample-sub")?.textContent).toContain("Try form fields");
      expect(cards[1]?.querySelector(".sample-sub")?.textContent).toContain("Explore recognition");
    } finally {
      unmount();
    }
  });
});

describe("Phase 112 C6b — the empty states and data-* hooks are preserved", () => {
  it("keeps the designed Recent empty state inside the preserved section hook", () => {
    const { host, unmount } = mountWelcome({ recentFiles: [] });
    try {
      const recents = host.querySelector("[data-home-recents]");
      expect(recents).not.toBeNull();
      const empty = recents?.querySelector(".recent-empty.empty-state");
      expect(empty).not.toBeNull();
      expect(empty?.querySelector(".empty-state-headline")?.textContent).toBe("No recent files yet.");
    } finally {
      unmount();
    }
  });

  it("preserves data-recent-row, data-source-format, data-home-recents and data-home-explore", () => {
    const row = recent({
      path: "C:\\Docs\\a.pdf",
      name: "a.pdf",
      sourceLabel: "PDF Document",
      sourceKind: "pdf",
    });
    const { host, unmount } = mountWelcome({ recentFiles: [row], samples: [] });
    try {
      expect(host.querySelector("[data-recent-row]")).not.toBeNull();
      expect(host.querySelector(".doc-format")?.getAttribute("data-source-format")).toBe("pdf");
      expect(host.querySelector("[data-home-recents]")).not.toBeNull();
      expect(host.querySelector("[data-home-explore]")).not.toBeNull();
    } finally {
      unmount();
    }
  });
});

