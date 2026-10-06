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

// The App-mount follow-up (TFL-1006) renders the REAL App; the document
// renderer and the PDF.js parse are irrelevant to the Home path, so they are
// stubbed exactly as the DEF-299 harness does to keep jsdom out of canvas.
vi.mock("../../../src/renderer/components/DocumentView", () => ({
  DocumentView: (): unknown => null,
}));
vi.mock("../../../src/renderer/pdf/pdfjs", () => ({
  openPdfDocument: async (): Promise<unknown> => ({
    doc: {
      numPages: 3,
      getPage: async (): Promise<unknown> => ({}),
      destroy: async (): Promise<unknown> => undefined,
    },
  }),
  readOutline: async (): Promise<null> => null,
}));
vi.mock("../../../src/renderer/pdf/printRaster", () => ({
  PRINT_DPI: 200,
  MAX_PRINT_PIXELS: 12000000,
  rasterizePagesForPrint: async (): Promise<unknown[]> => [],
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Welcome } from "../../../src/renderer/components/Welcome";
import { App } from "../../../src/renderer/App";
import { DEFAULT_SETTINGS } from "../../../src/renderer/state/defaults";
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

// TFL-1006 (chunk C2) — the REAL App seeds the missing set PROACTIVELY on
// mount, so a Recent row whose file vanished renders Missing / Locate on the
// first paint of Home, with no open attempt and no click. This mounts the real
// App and asserts the C1 `checkMissing` bridge is consulted and unioned.
describe("Phase 112 follow-up (TFL-1006) - proactive missing detection", () => {
  const PRESENT_PATH = "C:\\Docs\\here.pdf";
  const GONE_PATH = "C:\\Docs\\gone.pdf";

  function installStubs(): ReturnType<typeof vi.fn> {
    const checkMissing = vi.fn(async (): Promise<string[]> => [GONE_PATH]);
    const tflex = {
      loadSettings: async (): Promise<unknown> => ({
        ok: true,
        value: {
          ...structuredClone(DEFAULT_SETTINGS),
          recentFiles: [
            { path: PRESENT_PATH, name: "here.pdf", openedAt: new Date().toISOString() },
            { path: GONE_PATH, name: "gone.pdf", openedAt: new Date().toISOString() },
          ],
        },
      }),
      saveSettings: async (): Promise<unknown> => ({ ok: true }),
      addRecentFile: async (): Promise<unknown> => ({ ok: true }),
      listSamples: async (): Promise<unknown[]> => [],
      openFileDialog: async (): Promise<string> => PRESENT_PATH,
      loadPdf: async (): Promise<unknown> => ({ ok: true, value: new Uint8Array([1, 2, 3]) }),
      listPrinters: async (): Promise<unknown[]> => [],
      showInFolder: async (): Promise<unknown> => ({ ok: true }),
      checkMissing,
      closeWindow: (): void => undefined,
      minimizeWindow: (): void => undefined,
      maximizeWindow: (): void => undefined,
      confirmClose: async (): Promise<void> => undefined,
      settings: { changed: (): (() => void) => (): void => undefined },
      menu: {
        onAction: (): (() => void) => (): void => undefined,
        setEnabled: (): void => undefined,
      },
    };
    (window as unknown as { tflex: unknown }).tflex = tflex;
    return checkMissing;
  }

  function installDomShims(): void {
    if (typeof window.matchMedia !== "function") {
      (window as unknown as { matchMedia: unknown }).matchMedia = (
        query: string,
      ): MediaQueryList =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addListener: (): void => undefined,
          removeListener: (): void => undefined,
          addEventListener: (): void => undefined,
          removeEventListener: (): void => undefined,
          dispatchEvent: (): boolean => false,
        }) as unknown as MediaQueryList;
    }
    if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver !== "function") {
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      };
    }
  }

  async function flushAsync(): Promise<void> {
    await act(async (): Promise<void> => {
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
      await new Promise<void>((r) => setTimeout(r, 0));
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });
  }

  let container: HTMLElement;
  let root: Root;

  beforeEach((): void => {
    installDomShims();
    container = document.createElement("div");
    container.id = "root";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach((): void => {
    act((): void => {
      root.unmount();
    });
    container.remove();
  });

  it("flags a vanished recent row Missing on first paint, with no click", async () => {
    const checkMissing = installStubs();
    act((): void => {
      root.render(<App />);
    });
    await flushAsync();

    const goneRow = container.querySelector<HTMLElement>(
      '[data-recent-row][data-recent-missing="true"]',
    );
    expect(goneRow).not.toBeNull();
    expect(goneRow?.querySelector(".doc-name")?.textContent).toBe("gone.pdf");
    expect(goneRow?.querySelector("[data-recent-missing-note]")?.textContent).toBe("Missing");
    expect(goneRow?.querySelector('[data-recent-action="locate"]')).not.toBeNull();

    const presentRow = container.querySelector<HTMLElement>(
      '[data-recent-row][data-recent-missing="false"]',
    );
    expect(presentRow).not.toBeNull();
    expect(presentRow?.querySelector(".doc-name")?.textContent).toBe("here.pdf");
    expect(presentRow?.querySelector('[data-recent-action="locate"]')).toBeNull();

    expect(checkMissing).toHaveBeenCalledWith(
      expect.arrayContaining([PRESENT_PATH, GONE_PATH]),
    );
  });
});

