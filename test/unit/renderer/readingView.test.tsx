// @vitest-environment jsdom
//
// Phase 56 (features A / C / D) — the shared Reading-view shell.
//
// Pins the contract qa's Phase 56 e2e drives:
//   - the exact aria-label handle set shipped by `ReadingView`,
//   - EPUB chapters render from a mocked `readingDocument`,
//   - font-size and theme changes both land on the reading surface,
//   - a HOSTILE chapter fragment renders with no script / no on* handler
//     (defence in depth — the mock simulates a compromised producer),
//   - a typed failure (drm-protected) surfaces readably and never crashes,
//   - comic single/double, RTL order, click and ArrowRight page turns,
//   - the two verbs are enabled only for their own formats.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

// `DocumentSurfaceColumn` lives in App.tsx; stub the modules App's import
// graph would otherwise drag into jsdom (the same harness as
// def299_emptyTabNewTab.test.tsx). The column component itself touches none
// of them.
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

// DEF-395 — the comic render loop (React #185).
//
// `ComicPage` used to hand `PageView` a fresh inline `onPageSize` on every
// render. `PageView`'s render effect lists `onPageSize` in its deps
// (PageView.tsx:825) and calls it back after resolving the page, so the
// sequence render -> effect -> setDims(new object even when unchanged) ->
// render never settled. This stub mirrors that exact contract (its effect is
// keyed on the `onPageSize` PROP identity, like the real one) and exposes the
// callback so the regression test can count invocations. `@testing-library/
// react` is not installed and the task forbids a new dependency, so
// `fireEventClick` below replicates RTL's `fireEvent.click` — a bubbling,
// cancelable MouseEvent through React's delegated event system — rather than
// calling a handler directly.
const comicPageSizeSpy = vi.hoisted(() => vi.fn());

vi.mock("../../../src/renderer/components/PageView", async () => {
  const React = await import("react");
  // The "intrinsic" size the real pdf.js page proxy reports, independent of
  // the fallback dims ComicPage hands in.
  const INTRINSIC_W = 800;
  const INTRINSIC_H = 1200;
  return {
    PageView: (props: {
      page: number;
      cssScale: number;
      widthPt: number;
      heightPt: number;
      onPageSize: (page: number, widthPt: number, heightPt: number) => void;
    }): unknown => {
      const { page, cssScale, widthPt, heightPt, onPageSize } = props;
      React.useEffect(() => {
        comicPageSizeSpy();
        onPageSize(page, INTRINSIC_W, INTRINSIC_H);
      }, [onPageSize, page, cssScale, widthPt, heightPt]);
      return React.createElement("div", { "data-page-view": page });
    },
  };
});

import { DocumentSurfaceColumn } from "../../../src/renderer/App";
import { ReadingView } from "../../../src/renderer/components/ReadingView";
import { ok, err } from "../../../src/shared/result";
import {
  DEFAULT_READING_DEFAULTS,
  type ReadingDefaults,
} from "../../../src/shared/types";
import { readingViewGate } from "../../../src/renderer/state/dockModel";
import { toolById } from "../../../src/renderer/state/toolsRegistry";
import type { ConvertNoticeState } from "../../../src/renderer/state/convert";
import type { EpubReadingDocument } from "../../../src/shared/convert";
import type { PDFDocumentProxy } from "pdfjs-dist";

const DEFAULTS: ReadingDefaults = DEFAULT_READING_DEFAULTS;

function mount(node: ReactElement): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(node);
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

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** RTL's `fireEvent.click` is unavailable (the package is not a dependency and
 *  adding one is forbidden); this replicates it exactly — a bubbling,
 *  cancelable MouseEvent dispatched through React's delegated listener, never
 *  a direct handler call. */
function fireEventClick(host: HTMLElement, label: string): void {
  const el = host.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  expect(el, label).not.toBeNull();
  act((): void => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function setBridge(readingDocument: unknown, present = true): void {
  const convert = present ? { readingDocument } : {};
  (window as unknown as { tflex: unknown }).tflex = { convert };
}

const TWO_CHAPTERS: EpubReadingDocument = {
  title: "A Book",
  chapters: [
    { id: "c1", href: "c1.xhtml", title: "Chapter One", xhtml: "<p>alpha body</p>" },
    { id: "c2", href: "c2.xhtml", title: "Chapter Two", xhtml: "<p>beta body</p>" },
  ],
  warnings: [],
};

function renderEpub(
  readingDocument: unknown,
  extra: Partial<Parameters<typeof ReadingView>[0]> = {},
): { host: HTMLElement; cleanup: () => void; onNotice: ReturnType<typeof vi.fn> } {
  setBridge(readingDocument);
  const onNotice = vi.fn();
  const view = mount(
    createElement(ReadingView, {
      open: true,
      mode: "epub",
      title: "A Book",
      sourcePath: "/books/a.epub",
      defaults: DEFAULTS,
      onNotice,
      onClose: (): void => undefined,
      ...extra,
    }),
  );
  return { ...view, onNotice };
}

const realTflex = (window as unknown as { tflex?: unknown }).tflex;
afterEach((): void => {
  (window as unknown as { tflex?: unknown }).tflex = realTflex;
});

describe("phase 56 reading view — EPUB chapters and controls", () => {
  it("renders both mocked chapters (titles and text)", async () => {
    const readingDocument = vi.fn(async (): Promise<unknown> => ok(TWO_CHAPTERS));
    const { host, cleanup } = renderEpub(readingDocument);
    try {
      await flush();
      expect(readingDocument).toHaveBeenCalledWith("/books/a.epub");
      const titles = [...host.querySelectorAll(".reading-chapter-title")].map(
        (el) => el.textContent,
      );
      expect(titles).toEqual(["Chapter One", "Chapter Two"]);
      const text = host.textContent ?? "";
      expect(text).toContain("alpha body");
      expect(text).toContain("beta body");
    } finally {
      cleanup();
    }
  });

  it("a font-size change updates the rendered content style", async () => {
    const { host, cleanup } = renderEpub(async () => ok(TWO_CHAPTERS));
    try {
      await flush();
      const range = host.querySelector<HTMLInputElement>('[aria-label="Reading font size"]');
      expect(range).not.toBeNull();
      await act(async (): Promise<void> => {
        if (range !== null) {
          // Bypass React's value tracker so the change reaches onChange.
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )?.set;
          setter?.call(range, "22");
          range.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      expect(
        host.querySelector<HTMLElement>("[data-reading-content]")?.style.fontSize,
      ).toBe("22pt");
    } finally {
      cleanup();
    }
  });

  it("a theme change updates the reading surface attribute AND class", async () => {
    const { host, cleanup } = renderEpub(async () => ok(TWO_CHAPTERS));
    try {
      await flush();
      const surface = host.querySelector<HTMLElement>("[data-reading-view]");
      expect(surface?.getAttribute("data-reading-theme")).toBe("light");
      const select = host.querySelector<HTMLSelectElement>('[aria-label="Reading theme"]');
      expect(select).not.toBeNull();
      await act(async (): Promise<void> => {
        if (select !== null) {
          select.value = "dark";
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      const after = host.querySelector<HTMLElement>("[data-reading-view]");
      expect(after?.getAttribute("data-reading-theme")).toBe("dark");
      expect(after?.className).toContain("reading-surface--dark");
    } finally {
      cleanup();
    }
  });
});

describe("phase 56 reading view — defence in depth", () => {
  it("renders a hostile fragment with NO script and NO on* handler", async () => {
    const hostile: EpubReadingDocument = {
      title: "Bad",
      chapters: [
        {
          id: "h1",
          href: "h1.xhtml",
          title: "Hostile",
          xhtml:
            '<p>safe text</p><script>window.pwned=1</script><img src="x" onerror="window.pwned=2">',
        },
      ],
      warnings: [],
    };
    const { host, cleanup } = renderEpub(async () => ok(hostile));
    try {
      await flush();
      expect(host.textContent ?? "").toContain("safe text");
      expect(host.querySelector("script")).toBeNull();
      expect(host.querySelector("[onerror]")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("surfaces a typed drm-protected failure readably, without crashing", async () => {
    const { host, cleanup, onNotice } = renderEpub(async () =>
      err("drm-protected", "drm"),
    );
    try {
      await flush();
      const alert = host.querySelector("[data-reading-error]");
      expect(alert).not.toBeNull();
      expect(alert?.textContent ?? "").toMatch(/DRM-protected/i);
      expect(onNotice).toHaveBeenCalledWith(
        "error",
        expect.stringMatching(/DRM-protected/i),
      );
    } finally {
      cleanup();
    }
  });

  it("degrades readably when the optional bridge member is absent", async () => {
    setBridge(undefined, false);
    const onNotice = vi.fn();
    const view = mount(
      createElement(ReadingView, {
        open: true,
        mode: "epub",
        title: "A Book",
        sourcePath: "/books/a.epub",
        defaults: DEFAULTS,
        onNotice,
        onClose: (): void => undefined,
      }),
    );
    try {
      await flush();
      expect(view.host.querySelector("[data-reading-error]")).not.toBeNull();
      expect(onNotice).toHaveBeenCalled();
    } finally {
      view.cleanup();
    }
  });
});

describe("phase 56 reading view — comic mode", () => {
  function renderComic(): {
    host: HTMLElement;
    cleanup: () => void;
  } {
    return mount(
      createElement(ReadingView, {
        open: true,
        mode: "comic",
        title: "A Comic",
        sourcePath: "/books/a.cbz",
        defaults: DEFAULTS,
        onNotice: (): void => undefined,
        onClose: (): void => undefined,
        comicPageCount: 4,
        renderComicPage: (pageIndex: number): ReactElement =>
          createElement("div", { "data-comic-render": pageIndex }),
      }),
    );
  }

  function pageOrder(host: HTMLElement): string[] {
    return [...host.querySelectorAll("[data-comic-page]")].map(
      (el) => el.getAttribute("data-comic-page") ?? "",
    );
  }

  async function click(host: HTMLElement, label: string): Promise<void> {
    await act(async (): Promise<void> => {
      host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click();
    });
  }

  it("single -> double changes the number of pages per view", async () => {
    const { host, cleanup } = renderComic();
    try {
      expect(pageOrder(host)).toEqual(["0"]);
      await click(host, "Comic double page");
      expect(pageOrder(host)).toEqual(["0", "1"]);
    } finally {
      cleanup();
    }
  });

  it("the RTL toggle reverses the spread order", async () => {
    const { host, cleanup } = renderComic();
    try {
      await click(host, "Comic double page");
      expect(pageOrder(host)).toEqual(["0", "1"]);
      await click(host, "Comic right to left");
      expect(pageOrder(host)).toEqual(["1", "0"]);
    } finally {
      cleanup();
    }
  });

  it("a Next click and an ArrowRight key both advance the page", async () => {
    const { host, cleanup } = renderComic();
    try {
      await click(host, "Comic single page");
      expect(pageOrder(host)).toEqual(["0"]);
      await click(host, "Next page");
      expect(pageOrder(host)).toEqual(["1"]);
      await act(async (): Promise<void> => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        );
      });
      expect(pageOrder(host)).toEqual(["2"]);
      await click(host, "Previous page");
      expect(pageOrder(host)).toEqual(["1"]);
    } finally {
      cleanup();
    }
  });

  it("exposes the exact comic aria-label set", () => {
    const { host, cleanup } = renderComic();
    try {
      for (const label of [
        "Comic single page",
        "Comic double page",
        "Comic fit width",
        "Comic fit height",
        "Comic right to left",
        "Previous page",
        "Next page",
        "Reading progress",
      ]) {
        expect(host.querySelector(`[aria-label="${label}"]`), label).not.toBeNull();
      }
    } finally {
      cleanup();
    }
  });
});

describe("phase 56 reading view — the two format-gated verbs", () => {
  it("registers openReadingView / openComicView with the reading-view gate", () => {
    for (const id of ["openReadingView", "openComicView"] as const) {
      const entry = toolById(id);
      expect(entry, id).toBeDefined();
      expect(entry?.action, id).toBe(id);
      expect(entry?.availability, id).toBe("reading-view");
      expect(entry?.surface, id).toBe("palette");
    }
  });

  it("enables each verb only for its own source format", () => {
    const epubOnEpub = readingViewGate({
      mode: "epub",
      hasDocument: true,
      sourceFormat: "epub",
      bridgePresent: true,
    });
    expect(epubOnEpub.enabled).toBe(true);
    expect(
      readingViewGate({
        mode: "epub",
        hasDocument: true,
        sourceFormat: "cbz",
        bridgePresent: true,
      }).enabled,
    ).toBe(false);
    // The EPUB reader needs the optional bridge member.
    expect(
      readingViewGate({
        mode: "epub",
        hasDocument: true,
        sourceFormat: "epub",
        bridgePresent: false,
      }).enabled,
    ).toBe(false);
    // The comic reader does not, and accepts cbz or cbt.
    for (const format of ["cbz", "cbt"] as const) {
      expect(
        readingViewGate({
          mode: "comic",
          hasDocument: true,
          sourceFormat: format,
          bridgePresent: false,
        }).enabled,
        format,
      ).toBe(true);
    }
    expect(
      readingViewGate({
        mode: "comic",
        hasDocument: true,
        sourceFormat: "epub",
        bridgePresent: true,
      }).enabled,
    ).toBe(false);
    // No document: both are disabled.
    expect(
      readingViewGate({
        mode: "comic",
        hasDocument: false,
        sourceFormat: "cbz",
        bridgePresent: true,
      }).enabled,
    ).toBe(false);
  });

  it("App wires the verbs, the live gate and the shared shell end to end", () => {
    const app = readFileSync(resolve(__dirname, "../../../src/renderer/App.tsx"), "utf8");
    expect(app).toMatch(/openReadingView,/);
    expect(app).toMatch(/openComicView,/);
    expect(app).toMatch(/case "reading-view":/);
    expect(app).toMatch(/readingViewGate\(\{/);
    expect(app).toMatch(/<ReadingView/);
    // The document-surface trigger is gated on the tab's NON-dismissible
    // source format, never on the dismissible conversion card.
    expect(app).toMatch(/aria-label=\{sourceFormat === "epub"/);
    expect(app).toMatch(/sourceFormatByTab\[meta\.id\]/);
  });
});

// ---------------------------------------------------------------------------
// Phase 56 follow-up — the document-surface reader trigger must survive
// dismissing the conversion card (standing rule 1). `DocumentSurfaceColumn`
// is the extracted surface App renders; these mount the REAL component with a
// harness that owns the dismissible notice, exactly as App does.
// ---------------------------------------------------------------------------

const EPUB_NOTICE: ConvertNoticeState = {
  sourceLabel: "E-book",
  sourceFormat: "epub",
  fidelity: "layout",
  warnings: [],
};

function renderColumn(
  sourceFormat: ConvertNoticeState["sourceFormat"] | undefined,
  initialNotice: ConvertNoticeState | undefined,
): {
  host: HTMLElement;
  cleanup: () => void;
  onOpenReadingView: ReturnType<typeof vi.fn>;
  onOpenComicView: ReturnType<typeof vi.fn>;
} {
  const onOpenReadingView = vi.fn();
  const onOpenComicView = vi.fn();
  function Harness(): ReactElement {
    const [conversion, setConversion] = useState(initialNotice);
    return createElement(DocumentSurfaceColumn, {
      document: createElement("div", { "data-doc": "1" }),
      sourceFormat,
      conversion,
      validation: undefined,
      protection: undefined,
      onDismissConversion: (): void => setConversion(undefined),
      onDismissValidation: (): void => undefined,
      onDismissProtection: (): void => undefined,
      onOpenReadingView,
      onOpenComicView,
    });
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(createElement(Harness));
  });
  return {
    host,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
    onOpenReadingView,
    onOpenComicView,
  };
}

describe("phase 56 follow-up — the reader trigger outlives the notice", () => {
  it("an epub tab keeps an ENABLED reading-view trigger after the notice is dismissed", () => {
    const view = renderColumn("epub", EPUB_NOTICE);
    try {
      const trigger = (): Element | null =>
        view.host.querySelector('[aria-label="Open reading view"]');
      expect(trigger()).not.toBeNull();
      expect((trigger() as HTMLButtonElement).disabled).toBe(false);

      // Dismiss the conversion card: the notice leaves, the capability stays.
      const dismiss = view.host.querySelector<HTMLButtonElement>(
        "[data-conversion-dismiss]",
      );
      expect(dismiss).not.toBeNull();
      act((): void => {
        dismiss?.click();
      });
      expect(view.host.querySelector("[data-conversion-notice]")).toBeNull();
      expect(trigger()).not.toBeNull();
      expect((trigger() as HTMLButtonElement).disabled).toBe(false);

      // And it is LIVE: clicking it reaches the open handler.
      act((): void => {
        (trigger() as HTMLButtonElement).click();
      });
      expect(view.onOpenReadingView).toHaveBeenCalledTimes(1);
    } finally {
      view.cleanup();
    }
  });

  it("a cbz tab keeps an ENABLED comic-view trigger after the notice is dismissed", () => {
    const view = renderColumn("cbz", { ...EPUB_NOTICE, sourceFormat: "cbz" });
    try {
      const dismiss = view.host.querySelector<HTMLButtonElement>(
        "[data-conversion-dismiss]",
      );
      act((): void => {
        dismiss?.click();
      });
      expect(view.host.querySelector("[data-conversion-notice]")).toBeNull();
      const trigger = view.host.querySelector<HTMLButtonElement>(
        '[aria-label="Open comic view"]',
      );
      expect(trigger).not.toBeNull();
      expect(trigger?.disabled).toBe(false);
      expect(view.host.querySelector('[aria-label="Open reading view"]')).toBeNull();
      act((): void => {
        trigger?.click();
      });
      expect(view.onOpenComicView).toHaveBeenCalledTimes(1);
    } finally {
      view.cleanup();
    }
  });

  it("a plain PDF/document tab renders NEITHER reader trigger", () => {
    const view = renderColumn(undefined, undefined);
    try {
      expect(view.host.querySelector("[data-reading-open]")).toBeNull();
      expect(view.host.querySelector('[aria-label="Open reading view"]')).toBeNull();
      expect(view.host.querySelector('[aria-label="Open comic view"]')).toBeNull();
    } finally {
      view.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-395 — the comic view must render STABLY (no React #185) and its
// single/double + Close controls must be operable by an ordinary click.
// These mount the REAL `ReadingView` -> `ComicBody` -> `ComicPage` path (a
// `comicDoc` is supplied, so the `PageView` used is the module stub above,
// which mirrors the real render-effect contract).
// ---------------------------------------------------------------------------
describe("phase 56 reading view — DEF-395 comic render loop", () => {
  const COMIC_DOC = { numPages: 4 } as unknown as PDFDocumentProxy;

  function renderComicDoc(): { host: HTMLElement; cleanup: () => void } {
    return mount(
      createElement(ReadingView, {
        open: true,
        mode: "comic",
        title: "A Comic",
        sourcePath: "/books/a.cbz",
        defaults: DEFAULTS,
        onNotice: (): void => undefined,
        onClose: (): void => undefined,
        comicPageCount: 4,
        comicDoc: COMIC_DOC,
      }),
    );
  }

  function pagesPerView(host: HTMLElement): number {
    return host.querySelectorAll("[data-comic-page]").length;
  }

  it("mounts and ticks with NO console error and a BOUNDED size-callback count", async () => {
    comicPageSizeSpy.mockClear();
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation((): void => undefined);
    let view: { host: HTMLElement; cleanup: () => void } | null = null;
    try {
      view = renderComicDoc();
      await flush();
      await flush(); // mount plus the two ticks the regression asserts over.
      // A #185 loop would have thrown out of the mount above. The callback
      // count is the direct assertion that the render -> effect -> setState
      // cycle is closed (the bug produced an unbounded call count).
      expect(comicPageSizeSpy.mock.calls.length).toBeGreaterThan(0);
      expect(comicPageSizeSpy.mock.calls.length).toBeLessThan(10);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(pagesPerView(view.host)).toBe(1);
    } finally {
      view?.cleanup();
      errorSpy.mockRestore();
    }
  });

  it("Comic double page / Comic single page toggle pages-per-view on a user click", async () => {
    const view = renderComicDoc();
    try {
      await flush();
      expect(pagesPerView(view.host)).toBe(1);
      fireEventClick(view.host, "Comic double page");
      expect(pagesPerView(view.host)).toBe(2);
      expect(
        view.host
          .querySelector('[aria-label="Comic double page"]')
          ?.getAttribute("aria-pressed"),
      ).toBe("true");
      fireEventClick(view.host, "Comic single page");
      expect(pagesPerView(view.host)).toBe(1);
    } finally {
      view.cleanup();
    }
  });

  it("Close reading view unmounts the reading region on a user click", async () => {
    function Harness(): ReactElement {
      const [open, setOpen] = useState(true);
      if (!open) return createElement("div", { "data-reading-closed": "1" });
      return createElement(ReadingView, {
        open: true,
        mode: "comic",
        title: "A Comic",
        sourcePath: "/books/a.cbz",
        defaults: DEFAULTS,
        onNotice: (): void => undefined,
        onClose: (): void => setOpen(false),
        comicPageCount: 4,
        comicDoc: COMIC_DOC,
      });
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(createElement(Harness));
    });
    try {
      await flush();
      expect(host.querySelector("[data-reading-view]")).not.toBeNull();
      fireEventClick(host, "Close reading view");
      await flush();
      expect(host.querySelector("[data-reading-view]")).toBeNull();
      expect(host.querySelector("[data-reading-closed]")).not.toBeNull();
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });
});
