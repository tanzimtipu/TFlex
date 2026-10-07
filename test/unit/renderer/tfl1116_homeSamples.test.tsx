// @vitest-environment jsdom
//
// TFL-1143 (TFL-1116 C7b, R09) — the development sample fixtures are gated.
//
// PRODUCTION Home (showSamples={false}) renders NO `[data-home-explore]`
// section, no "Explore Jovrel" heading and no sample invitation copy, and it
// makes no sample-resolver call. A sample open never writes a production MRU
// entry. The fixtures remain available behind the development flag.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Welcome } from "../../../src/renderer/components/Welcome";
import { recordSampleRecent } from "../../../src/renderer/utils/sampleRecents";
import type { SampleDocument } from "../../../src/shared/types";

const SAMPLES: SampleDocument[] = [{ name: "report.pdf", path: "samples/report.pdf" }];

function renderWelcome(showSamples: boolean, resolver: () => Promise<SampleDocument[]>): {
  host: HTMLElement;
  unmount: () => void;
} {
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
        samplesResolver={resolver}
        showSamples={showSamples}
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

describe("TFL-1143 R09 — production Home hides the development sample fixtures", () => {
  it("renders no Explore section, no sample invite copy and no resolver call", () => {
    const resolver = vi.fn(async (): Promise<SampleDocument[]> => SAMPLES);
    const { host, unmount } = renderWelcome(false, resolver);
    try {
      expect(host.querySelector("[data-home-explore]")).toBeNull();
      expect(host.querySelectorAll(".sample-card")).toHaveLength(0);
      expect(host.textContent).not.toContain("Explore Jovrel");
      expect(host.textContent).not.toContain("pick a sample");
      expect(host.querySelector("[data-home-samples]")?.getAttribute("data-home-samples")).toBe(
        "false",
      );
      expect(resolver).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("keeps the fixtures behind the development flag", async () => {
    const { host, unmount } = renderWelcome(true, async (): Promise<SampleDocument[]> => SAMPLES);
    try {
      expect(host.querySelector("[data-home-explore]")).not.toBeNull();
      expect(host.querySelector("[data-home-samples]")?.getAttribute("data-home-samples")).toBe(
        "true",
      );
      expect(host.textContent).toContain("Explore Jovrel");
      await flush();
      expect(host.querySelectorAll(".sample-card")).toHaveLength(1);
    } finally {
      unmount();
    }
  });
});

describe("TFL-1143 R09 — a sample open never writes a production MRU entry", () => {
  it("suppresses the record in production and writes it in development", async () => {
    const addRecentFile = vi.fn(async (): Promise<void> => undefined);
    const bridge = { addRecentFile };

    const wrote = await recordSampleRecent("report.pdf", bridge, false, () => "2020-01-01T00:00:00.000Z");
    expect(wrote).toBe(false);
    expect(addRecentFile).not.toHaveBeenCalled();

    const wroteDev = await recordSampleRecent("report.pdf", bridge, true, () => "2020-01-01T00:00:00.000Z");
    expect(wroteDev).toBe(true);
    expect(addRecentFile).toHaveBeenCalledWith({
      path: "samples/report.pdf",
      name: "report.pdf",
      openedAt: "2020-01-01T00:00:00.000Z",
    });
  });
});

describe("TFL-1143 R09 — App wires the flag and the MRU gate", () => {
  const app = readFileSync(resolve(__dirname, "../../../src/renderer/App.tsx"), "utf8");

  it("passes the resolved showSamples flag to Welcome", () => {
    expect(app).toContain("showSamples={isDevelopmentBuild()}");
  });

  it("records a bundled sample open through the gated helper", () => {
    expect(app).toContain("recordSampleRecent(name, window.tflex)");
  });
});
