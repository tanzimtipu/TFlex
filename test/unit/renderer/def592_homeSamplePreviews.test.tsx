// @vitest-environment jsdom
//
// DEF-592 (from ADV-223) — the Home sample cards must show a REAL first page of
// each bundled sample (via the existing readSample IPC + pdf.js), with an honest
// per-sample fallback that keeps form / long / report / scanned distinct.
//
// The exact defect: the old card rendered one per-TASK glyph on an identical
// gradient, so `long.pdf` and `report.pdf` were fully indistinguishable. These
// pins guard the honesty rules (classification, distinct fallbacks) and the
// component wiring (real preview element + per-sample fallback glyph). The
// pdf.js raster itself is not exercised in jsdom (no bridge, no canvas); the
// component settles to the "unavailable" fallback, which is exactly what these
// assertions inspect.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Welcome } from "../../../src/renderer/components/Welcome";
import {
  resetSamplePreviewCache,
  samplePreviewDataUrl,
  samplePreviewFallback,
  samplePreviewSize,
  samplePreviewTone,
} from "../../../src/renderer/components/home/samplePreview";
import type { SampleDocument } from "../../../src/shared/types";

const SAMPLES: SampleDocument[] = [
  { name: "form.pdf", path: "samples/form.pdf" },
  { name: "long.pdf", path: "samples/long.pdf" },
  { name: "report.pdf", path: "samples/report.pdf" },
  { name: "scanned.pdf", path: "samples/scanned.pdf" },
];

const RESOLVE_SAMPLES =
  (list: SampleDocument[]) =>
  (): Promise<SampleDocument[]> =>
    Promise.resolve(list);

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("DEF-592 — sample preview classification keeps form/long/report/scan distinct", () => {
  it("maps each bundled sample to its own honest tone", () => {
    expect(samplePreviewTone("form.pdf")).toBe("form");
    expect(samplePreviewTone("long.pdf")).toBe("reading");
    expect(samplePreviewTone("report.pdf")).toBe("report");
    expect(samplePreviewTone("scanned.pdf")).toBe("scan");
    expect(samplePreviewTone("mystery.pdf")).toBe("general");
  });

  it("DOES NOT collapse long and report (the DEF-592 gap)", () => {
    expect(samplePreviewTone("long.pdf")).not.toBe(samplePreviewTone("report.pdf"));
  });

  it("gives every bundled sample a distinct fallback glyph", () => {
    const icons = SAMPLES.map((s) => samplePreviewFallback(s.name).icon);
    expect(new Set(icons).size).toBe(SAMPLES.length);
    expect(samplePreviewFallback("long.pdf").icon).not.toBe(
      samplePreviewFallback("report.pdf").icon,
    );
  });

  it("sizes the raster by page aspect with a bounded width", () => {
    expect(samplePreviewSize(612, 792).width).toBe(480);
    expect(samplePreviewSize(612, 792).height).toBe(621);
    expect(samplePreviewSize(0, 0)).toEqual({ width: 1, height: 1 });
  });
});

describe("DEF-592 — raster cache", () => {
  beforeEach(() => {
    resetSamplePreviewCache();
  });

  it("shares one in-flight raster per sample name", () => {
    const first = samplePreviewDataUrl("form.pdf");
    const second = samplePreviewDataUrl("form.pdf");
    expect(first).toBe(second);
  });

  it("resolves to null (honest fallback) when the IPC bridge is absent", async () => {
    const url = await samplePreviewDataUrl("form.pdf");
    expect(url).toBeNull();
  });
});

describe("DEF-592 — the sample card renders a real preview or an honest fallback", () => {
  function render(host: HTMLElement): () => void {
    const root = createRoot(host);
    act((): void => {
      root.render(
        <Welcome
          recentFiles={[]}
          onOpenRecent={(): void => undefined}
          onRemoveRecent={(): void => undefined}
          onOpenFile={(): void => undefined}
          onSampleClick={(): void => undefined}
          samplesResolver={RESOLVE_SAMPLES(SAMPLES)}
        />,
      );
    });
    return (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    };
  }

  it("gives each of the four cards a distinct tone and fallback glyph", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const unmount = render(host);
    try {
      await flush();
      const cards = [...host.querySelectorAll("[data-sample-card]")];
      expect(cards.length).toBe(4);
      const tones = cards.map((c) => c.querySelector(".sample-thumb")?.getAttribute("data-sample-tone"));
      expect(new Set(tones).size).toBe(4);
      const glyphs = cards.map(
        (c) => c.querySelector(".sample-thumb-glyph")?.outerHTML ?? "",
      );
      expect(glyphs.every((g) => g.length > 0)).toBe(true);
      expect(new Set(glyphs).size).toBe(4);
    } finally {
      unmount();
    }
  });

  it("settles to the honest fallback when no real page can be produced", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const unmount = render(host);
    try {
      await flush();
      for (const thumb of host.querySelectorAll(".sample-thumb")) {
        expect(thumb.getAttribute("data-sample-preview")).toBe("unavailable");
        expect(thumb.querySelector(".sample-thumb-page")).toBeNull();
      }
    } finally {
      unmount();
    }
  });
});

describe("DEF-592 — HomeSampleCard source pins", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../src/renderer/components/home/HomeSampleCard.tsx"),
    "utf8",
  );
  const preview = readFileSync(
    resolve(__dirname, "../../../src/renderer/components/home/samplePreview.ts"),
    "utf8",
  );

  it("renders the real first-page image element", () => {
    expect(src).toContain("sample-thumb-page");
    expect(src).toContain("useSamplePreview");
    expect(src).toContain("samplePreviewFallback");
  });

  it("no longer renders a single per-task glyph for every sample", () => {
    expect(src).not.toContain("name={task.icon}");
  });

  it("rasterizes the bundled bytes through the existing readSample IPC", () => {
    expect(preview).toContain("readSample");
    expect(preview).toContain("getPage(1)");
  });
});
