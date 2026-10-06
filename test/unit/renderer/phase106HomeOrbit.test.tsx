// @vitest-environment jsdom
//
// Phase 106 (chunk A) — the Orbit Desk Home composition.
//
// Pins the chunk-A deliverables:
//   - the pure source-format / sample-task / duplicate-context helpers;
//   - the Orbit Desk shell (centred region + asymmetric body) and its
//     preserved Phase-58 home-tool hooks;
//   - real source-format labels on recent rows (never a blanket "PDF");
//   - task-oriented sample cards with distinct per-task glyphs;
//   - the preserved empty/loading states.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Welcome } from "../../../src/renderer/components/Welcome";
import {
  pathExtension,
  sourceFormat,
  sourceFormatKind,
  sourceFormatLabel,
} from "../../../src/renderer/utils/sourceFormat";
import { sampleTaskFor, sampleTaskId } from "../../../src/renderer/utils/sampleTask";
import {
  folderShorthand,
  recentContextLabels,
} from "../../../src/renderer/utils/recentContext";
import type { RecentFile, SampleDocument } from "../../../src/shared/types";

interface RecentDisplay {
  entry: RecentFile;
  meta: { name: string; dir: string; isSample: boolean };
}

const recent = (path: string, name: string, dir: string, openedAt: string): RecentDisplay => ({
  entry: { path, name, openedAt },
  meta: { name, dir, isSample: false },
});

describe("Phase 106 — source-format truth helpers", () => {
  it("reads the real extension and maps the family", () => {
    expect(pathExtension("C:\\Docs\\sheet.xlsx")).toBe("xlsx");
    expect(pathExtension("samples/form.pdf")).toBe("pdf");
    expect(pathExtension("noext")).toBe("");
    expect(pathExtension(".hidden")).toBe("");
    expect(sourceFormat("a.PDF")).toEqual({ label: "PDF", kind: "pdf" });
    expect(sourceFormat("a.docx")).toEqual({ label: "DOCX", kind: "document" });
    expect(sourceFormat("a.xlsx")).toEqual({ label: "XLSX", kind: "spreadsheet" });
    expect(sourceFormat("a.png")).toEqual({ label: "PNG", kind: "image" });
    expect(sourceFormat("a.txt")).toEqual({ label: "TXT", kind: "text" });
  });

  it("never invents a format for an unknown or missing extension", () => {
    expect(sourceFormatLabel("a.weird")).toBe("WEIRD");
    expect(sourceFormatKind("a.weird")).toBe("other");
    expect(sourceFormat("report")).toEqual({ label: "File", kind: "other" });
  });
});

describe("Phase 106 — sample task framing helpers", () => {
  it("classifies the bundled samples by their real names", () => {
    expect(sampleTaskId("form.pdf")).toBe("forms");
    expect(sampleTaskId("scanned.pdf")).toBe("recognition");
    expect(sampleTaskId("long.pdf")).toBe("reading");
    expect(sampleTaskId("report.pdf")).toBe("reading");
    expect(sampleTaskId("mystery.pdf")).toBe("general");
  });

  it("gives every task a distinct label and a real registry glyph", () => {
    const form = sampleTaskFor({ name: "form.pdf" });
    const scan = sampleTaskFor({ name: "scanned.pdf" });
    const read = sampleTaskFor({ name: "long.pdf" });
    expect(form.label).toBe("Try form fields");
    expect(scan.label).toBe("Explore recognition");
    expect(read.label).toBe("Read and navigate");
    const icons = new Set([form.icon, scan.icon, read.icon]);
    expect(icons.size).toBe(3);
  });
});

describe("Phase 106 — recent folder context / duplicate disambiguation", () => {
  it("uses the last folder segment for a unique basename", () => {
    expect(folderShorthand("C:\\Users\\me\\Docs")).toBe("Docs");
    expect(
      recentContextLabels([{ name: "a.pdf", dir: "C:\\Users\\me\\Docs" }]),
    ).toEqual(["Docs"]);
  });

  it("widens duplicated basenames to the trailing folder segments", () => {
    const labels = recentContextLabels([
      { name: "report.pdf", dir: "C:\\Users\\me\\Work" },
      { name: "report.pdf", dir: "C:\\Users\\me\\Home" },
    ]);
    expect(labels[0]).not.toBe(labels[1]);
    expect(labels).toEqual(["me / Work", "me / Home"]);
  });

  it("falls back to the full folder when the trailing segments also collide", () => {
    const labels = recentContextLabels([
      { name: "report.pdf", dir: "C:\\A\\Docs" },
      { name: "report.pdf", dir: "D:\\A\\Docs" },
    ]);
    expect(labels).toEqual(["C:\\A\\Docs", "D:\\A\\Docs"]);
  });
});

const RESOLVE_SAMPLES =
  (list: SampleDocument[]) =>
  (): Promise<SampleDocument[]> =>
    Promise.resolve(list);

function renderWelcome(args: {
  recentFiles?: RecentDisplay[];
  samples?: SampleDocument[];
}): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <Welcome
        recentFiles={args.recentFiles ?? []}
        onOpenRecent={(): void => undefined}
        onRemoveRecent={(): void => undefined}
        onOpenFile={(): void => undefined}
        onSampleClick={(): void => undefined}
        onMergeClick={(): void => undefined}
        onCreateFromImages={(): void => undefined}
        homeTools={["createFromImages", "merge"]}
        homeCandidates={["createFromImages", "merge", "preferences"]}
        onRunHomeTool={(): void => undefined}
        onSetHomeTools={(): void => undefined}
        samplesResolver={RESOLVE_SAMPLES(args.samples ?? [])}
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

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Phase 106 — Orbit Desk shell", () => {
  it("renders the centred region and the asymmetric body split", () => {
    const { host, unmount } = renderWelcome({});
    try {
      expect(host.querySelector(".welcome.orbit-desk")).not.toBeNull();
      expect(host.querySelector(".orbit-desk-inner")).not.toBeNull();
      expect(host.querySelector(".welcome-body.orbit-desk-body")).not.toBeNull();
      expect(host.querySelector("[data-home-recents]")).not.toBeNull();
      expect(host.querySelector("[data-home-explore]")).not.toBeNull();
      expect(host.querySelector(".welcome-brand .brand-wordmark")?.textContent).toBe("Jovrel");
    } finally {
      unmount();
    }
  });

  it("preserves the Phase-58 home-tool row hooks", () => {
    const { host, unmount } = renderWelcome({});
    try {
      expect(host.querySelector("[data-home-tools]")).not.toBeNull();
      expect(host.querySelector("[data-home-edit-toggle]")).not.toBeNull();
      expect(
        host.querySelector('[data-home-tool="open"]')?.classList.contains("btn-primary"),
      ).toBe(true);
    } finally {
      unmount();
    }
  });
});

describe("Phase 106 — recent rows show source-format truth", () => {
  it("labels each row from its real extension, never a blanket PDF", () => {
    const { host, unmount } = renderWelcome({
      recentFiles: [
        recent("C:\\Docs\\sheet.xlsx", "sheet.xlsx", "C:\\Docs", "2026-10-05T10:00:00Z"),
        recent("C:\\Docs\\memo.docx", "memo.docx", "C:\\Docs", "2026-10-05T09:00:00Z"),
        recent("C:\\Docs\\report.pdf", "report.pdf", "C:\\Docs", "2026-10-05T08:00:00Z"),
      ],
    });
    try {
      const rows = [...host.querySelectorAll("[data-recent-row]")];
      expect(rows.length).toBe(3);
      const formats = rows.map((row) => row.querySelector(".doc-format")?.textContent);
      expect(formats).toEqual(["XLSX", "DOCX", "PDF"]);
    } finally {
      unmount();
    }
  });

  it("stacks the row name over its folder context (DEF-574)", () => {
    const styles = readFileSync(
      resolve(__dirname, "../../../src/renderer/styles.css"),
      "utf8",
    );
    const rule = /\.recent-row-text\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule).toMatch(/flex-direction:\s*column/);
  });

  it("disambiguates duplicate basenames with a wider folder context", () => {
    const { host, unmount } = renderWelcome({
      recentFiles: [
        recent(
          "C:\\Users\\me\\Work\\report.pdf",
          "report.pdf",
          "C:\\Users\\me\\Work",
          "2026-10-05T10:00:00Z",
        ),
        recent(
          "C:\\Users\\me\\Home\\report.pdf",
          "report.pdf",
          "C:\\Users\\me\\Home",
          "2026-10-05T09:00:00Z",
        ),
      ],
    });
    try {
      const paths = [...host.querySelectorAll("[data-recent-row] .doc-path")].map(
        (el) => el.textContent,
      );
      expect(paths).toEqual(["me / Work", "me / Home"]);
    } finally {
      unmount();
    }
  });
});

describe("Phase 106 — task-oriented sample cards", () => {
  it("renders a distinct task card per real sample", async () => {
    const samples: SampleDocument[] = [
      { name: "form.pdf", path: "samples/form.pdf" },
      { name: "long.pdf", path: "samples/long.pdf" },
      { name: "report.pdf", path: "samples/report.pdf" },
      { name: "scanned.pdf", path: "samples/scanned.pdf" },
    ];
    const { host, unmount } = renderWelcome({ samples });
    try {
      await flush();
      const cards = [...host.querySelectorAll("[data-sample-card]")];
      expect(cards.length).toBe(4);
      const tasks = cards.map((card) => card.getAttribute("data-sample-task"));
      expect(tasks).toEqual(["forms", "reading", "reading", "recognition"]);
      expect(cards[0]?.querySelector(".sample-sub")?.textContent).toContain("Try form fields");
      expect(cards[3]?.querySelector(".sample-sub")?.textContent).toContain("Explore recognition");
      const sub0 = cards[0]?.querySelector(".sample-sub")?.textContent ?? "";
      expect(sub0).toContain("\u00b7");
      expect(sub0).not.toContain("\\u00b7");
    } finally {
      unmount();
    }
  });

  it("keeps the designed empty states for recents and samples", async () => {
    const { host, unmount } = renderWelcome({ samples: [] });
    try {
      await flush();
      const recentEmpty = host.querySelector("[data-home-recents] .recent-empty.empty-state");
      expect(recentEmpty?.querySelector(".empty-state-headline")?.textContent).toBe(
        "No recent files yet.",
      );
      const sampleEmpty = host.querySelector("[data-home-explore] .samples-empty.empty-state");
      expect(sampleEmpty?.querySelector(".empty-state-headline")?.textContent).toBe(
        "No bundled samples",
      );
    } finally {
      unmount();
    }
  });
});

describe("Phase 106 — Welcome source pins", () => {
  it("scopes the Orbit Desk shell and drops the blanket PDF row label", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../src/renderer/components/Welcome.tsx"),
      "utf8",
    );
    expect(src).toContain("orbit-desk");
    expect(src).not.toContain(">PDF<");
    expect(src).toContain("see Jovrel");
  });
});