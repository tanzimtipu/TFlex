// @vitest-environment jsdom
//
// TFL-1244 (TFL-1230 chunk D) — Home + generic Open unification on the ONE
// Intake Tray.
//
// Pins the chunk-D contract:
//   1. Home renders the concise Intake Tray beside the hero (the shared
//      `src/renderer/intake` surface) as the primary intake; an empty Home
//      grows into an ordered queue as files are added.
//   2. The generic Open (App `onOpenClick`) is an INTAKE entry point: the
//      Phase 40 multi-select picker's picked paths are added to the model in
//      selection order and are never opened directly.
//   3. Every existing Home command id survives: the fixed Open tile and the
//      editable `homeTools` row keep their `data-home-tool` hooks.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Welcome } from "../../../src/renderer/components/Welcome";
import { App } from "../../../src/renderer/App";
import { DEFAULT_SETTINGS } from "../../../src/renderer/state/defaults";
import { createIntakeModel, type IntakeItem } from "../../../src/renderer/intake/model";
import type { SampleDocument } from "../../../src/shared/types";

const RESOLVE_SAMPLES = (): Promise<SampleDocument[]> => Promise.resolve([]);

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

interface Harness {
  host: HTMLElement;
  unmount: () => void;
}

function mountWelcome(props: {
  homeTools?: readonly string[];
  intakeItems?: readonly IntakeItem[];
  onOpenFile?: () => void;
  onIntakeRemove?: (id: string) => void;
  onIntakeMove?: (index: number, dir: -1 | 1) => void;
}): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <Welcome
        recentFiles={[]}
        onOpenRecent={(): void => undefined}
        onRemoveRecent={(): void => undefined}
        onOpenFile={props.onOpenFile ?? ((): void => undefined)}
        onSampleClick={(): void => undefined}
        onMergeClick={(): void => undefined}
        onCreateFromImages={(): void => undefined}
        homeTools={props.homeTools ?? ["createFromImages", "merge"]}
        homeCandidates={["createFromImages", "merge", "preferences"]}
        onRunHomeTool={(): void => undefined}
        onSetHomeTools={(): void => undefined}
        intakeItems={props.intakeItems}
        onIntakeRemove={props.onIntakeRemove}
        onIntakeMove={props.onIntakeMove}
        samplesResolver={RESOLVE_SAMPLES}
      />,
    );
  });
  return {
    host,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

function installAppStubs(paths: string[]): ReturnType<typeof vi.fn> {
  const openFilesDialog = vi.fn(async (): Promise<string[]> => paths);
  (window as unknown as { tflex: unknown }).tflex = {
    loadSettings: async (): Promise<unknown> => ({
      ok: true,
      value: structuredClone(DEFAULT_SETTINGS),
    }),
    saveSettings: async (): Promise<unknown> => ({ ok: true }),
    addRecentFile: async (): Promise<unknown> => ({ ok: true }),
    listSamples: async (): Promise<unknown[]> => [],
    openFilesDialog,
    openFileDialog: async (): Promise<string | null> => null,
    loadPdf: async (): Promise<unknown> => ({ ok: true, value: new Uint8Array([1, 2, 3]) }),
    listPrinters: async (): Promise<unknown[]> => [],
    showInFolder: async (): Promise<unknown> => ({ ok: true }),
    checkMissing: async (): Promise<string[]> => [],
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
  return openFilesDialog;
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

async function mountApp(): Promise<Harness> {
  installDomShims();
  const host = document.createElement("div");
  host.id = "root";
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(<App />);
  });
  await flush();
  return {
    host,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

afterEach((): void => {
  (window as unknown as { tflex?: unknown }).tflex = undefined;
  vi.restoreAllMocks();
});

describe("TFL-1244 — Home renders the Intake Tray as the primary intake", () => {
  it("renders the tray beside the hero on the Home empty state", async () => {
    installAppStubs([]);
    const { host, unmount } = await mountApp();
    try {
      const tray = host.querySelector("[data-intake-tray]");
      expect(tray).not.toBeNull();
      // Beside the hero: the tray lives inside the Home region next to the
      // hero actions, and starts as the designed empty state (an ordered
      // queue that grows as files are added).
      expect(host.querySelector("[data-home-intake] [data-intake-dropzone]")).not.toBeNull();
      expect(tray?.querySelector(".intake-empty")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("still fires the Open action from the fixed Open tile", () => {
    const onOpenFile = vi.fn();
    const { host, unmount } = mountWelcome({ onOpenFile });
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>('[data-home-tool="open"]')?.click();
      });
      expect(onOpenFile).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("keeps every homeTools tile's data-home-tool id", () => {
    const { host, unmount } = mountWelcome({
      homeTools: ["createFromImages", "merge"],
    });
    try {
      expect(host.querySelector('[data-home-tool="open"]')).not.toBeNull();
      expect(host.querySelector('[data-home-tool="createFromImages"]')).not.toBeNull();
      expect(host.querySelector('[data-home-tool="merge"]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("forwards tray remove / reorder intent to the host model", () => {
    let n = 0;
    const model = createIntakeModel({ mintId: (): string => `id-${(n += 1)}` });
    model.add({ pathOrFile: "C:\\docs\\a.pdf" });
    model.add({ pathOrFile: "C:\\docs\\b.pdf" });
    const onIntakeRemove = vi.fn();
    const onIntakeMove = vi.fn();
    const { host, unmount } = mountWelcome({
      intakeItems: model.items(),
      onIntakeRemove,
      onIntakeMove,
    });
    try {
      expect(host.querySelectorAll("[data-intake-row]").length).toBe(2);
      act((): void => {
        host.querySelector<HTMLButtonElement>('[data-intake-move-down="0"]')?.click();
        host.querySelector<HTMLButtonElement>('[data-intake-remove="1"]')?.click();
      });
      expect(onIntakeMove).toHaveBeenCalledWith(0, 1);
      expect(onIntakeRemove).toHaveBeenCalledWith("id-2");
    } finally {
      unmount();
    }
  });
});

describe("TFL-1244 — the generic Open routes through the intake model", () => {
  it("adds a single picked path to the queue in order (never opens directly)", async () => {
    const openFilesDialog = installAppStubs(["C:\\docs\\one.pdf"]);
    const { host, unmount } = await mountApp();
    try {
      await act(async (): Promise<void> => {
        host.querySelector<HTMLButtonElement>("[data-toolbar-open]")?.click();
      });
      await flush();
      expect(openFilesDialog).toHaveBeenCalledWith("document");
      const rows = host.querySelectorAll("[data-intake-row]");
      expect(rows.length).toBe(1);
      expect(rows[0]?.querySelector(".intake-name")?.textContent).toBe("one.pdf");
    } finally {
      unmount();
    }
  });

  it("adds N multi-selected paths in selection order", async () => {
    const openFilesDialog = installAppStubs([
      "C:\\docs\\alpha.pdf",
      "C:\\docs\\beta.pdf",
      "C:\\docs\\gamma.png",
    ]);
    const { host, unmount } = await mountApp();
    try {
      await act(async (): Promise<void> => {
        host.querySelector<HTMLButtonElement>("[data-toolbar-open]")?.click();
      });
      await flush();
      expect(openFilesDialog).toHaveBeenCalledWith("document");
      const names = Array.from(host.querySelectorAll("[data-intake-row] .intake-name")).map(
        (el) => el.textContent,
      );
      expect(names).toEqual(["alpha.pdf", "beta.pdf", "gamma.png"]);
    } finally {
      unmount();
    }
  });
});

