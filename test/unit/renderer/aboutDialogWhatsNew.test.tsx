// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AboutDialog } from "../../../src/renderer/components/AboutDialog";
import { WHATS_NEW, whatsNewHistory } from "../../../src/shared/whatsNew";
import type { AppInfo, UpdateState } from "../../../src/shared/types";

/**
 * Phase 31 - "What's New" section in the About dialog.
 *
 * Contract (src/shared/whatsNew.ts, frozen):
 *   - whatsNewFor(version) is an EXACT match, null when absent.
 *   - WHATS_NEW is newest-first; whatsNewHistory(version, limit) returns
 *     only the entries OLDER than the running version (DEF-276).
 *
 * Pins:
 *   - the running version's bundled highlights render with the version label;
 *   - an unknown running version renders the explicit [data-whats-new-empty];
 *   - an `available` state with notes renders the incoming block labelled
 *     with the INCOMING version;
 *   - notes undefined / [] renders [data-whats-new-incoming-empty];
 *   - a note line carrying markup renders as literal text and creates no
 *     element (no dangerouslySetInnerHTML);
 *   - the history list renders older entries newest-first.
 */

interface WindowWithTflex {
  tflex?: {
    app?: {
      getInfo?: () => Promise<AppInfo>;
      openPath?: (p: string) => Promise<void>;
    };
    update?: {
      getStatus?: () => Promise<UpdateState>;
      onStatusChanged?: (cb: (state: UpdateState) => void) => () => void;
    };
  };
}

function makeInfo(version: string): AppInfo {
  return {
    version,
    electronVersion: "31.0.0",
    nodeVersion: "20.0.0",
    storagePaths: {
      userData: "C:/Users/test/AppData/Roaming/TFlex",
      settings: "C:/Users/test/AppData/Roaming/TFlex/settings.json",
      signatures: "C:/Users/test/AppData/Roaming/TFlex/signatures",
      cache: "C:/Users/test/AppData/Roaming/TFlex/cache",
    },
  };
}

function renderDialog(args: {
  getInfo?: () => Promise<AppInfo>;
  updateGetStatus?: () => Promise<UpdateState>;
}): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const win = window as unknown as WindowWithTflex;
  win.tflex = {
    app: { getInfo: args.getInfo },
    update: { getStatus: args.updateGetStatus },
  };
  act((): void => {
    root.render(<AboutDialog open={true} onClose={(): void => undefined} />);
  });
  return {
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
      delete win.tflex;
    },
  };
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AboutDialog - What's New (Phase 31)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the section container even before app info resolves", () => {
    const { container, cleanup } = renderDialog({});
    // The section is never conditionally absent - the version label is
    // simply backed by the fallback version until getInfo resolves.
    expect(container.querySelector("[data-whats-new]")).not.toBeNull();
    cleanup();
  });

  it("renders the running version's bundled highlights with the version label", async () => {
    const running = WHATS_NEW[0];
    const { container, cleanup } = renderDialog({
      getInfo: async (): Promise<AppInfo> => makeInfo(running.version),
    });
    await flush();
    const version = container.querySelector("[data-whats-new-version]");
    expect(version).not.toBeNull();
    expect(version?.textContent).toContain(running.version);

    const lines = container.querySelectorAll("[data-whats-new-highlight]");
    expect(lines.length).toBe(running.highlights.length);
    expect(lines[0]?.textContent).toBe(running.highlights[0]);
    // The offline entry means NO empty state is shown.
    expect(container.querySelector("[data-whats-new-empty]")).toBeNull();
    cleanup();
  });

  it("renders the explicit empty state for an unknown running version", async () => {
    const { container, cleanup } = renderDialog({
      getInfo: async (): Promise<AppInfo> => makeInfo("0.0.1-unknown"),
    });
    await flush();
    const empty = container.querySelector("[data-whats-new-empty]");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toMatch(/No release notes for this version/);
    expect(container.querySelector("[data-whats-new-highlight]")).toBeNull();
    expect(container.querySelector("[data-whats-new-version]")).toBeNull();
    cleanup();
  });

  it("renders the incoming block labelled with the incoming version when notes are present", async () => {
    const running = WHATS_NEW[0];
    const { container, cleanup } = renderDialog({
      getInfo: async (): Promise<AppInfo> => makeInfo(running.version),
      updateGetStatus: async (): Promise<UpdateState> => ({
        kind: "available",
        version: "9.9.9",
        notes: ["Faster rendering", "New export options"],
      }),
    });
    await flush();
    const block = container.querySelector("[data-whats-new-incoming]");
    expect(block).not.toBeNull();
    const label = container.querySelector("[data-whats-new-incoming-version]");
    expect(label?.textContent).toContain("9.9.9");
    const lines = container.querySelectorAll("[data-whats-new-incoming-highlight]");
    expect(lines.length).toBe(2);
    expect(lines[1]?.textContent).toBe("New export options");
    expect(container.querySelector("[data-whats-new-incoming-empty]")).toBeNull();
    cleanup();
  });

  it("renders the incoming empty state when notes are undefined", async () => {
    const { container, cleanup } = renderDialog({
      getInfo: async (): Promise<AppInfo> => makeInfo(WHATS_NEW[0].version),
      updateGetStatus: async (): Promise<UpdateState> => ({
        kind: "available",
        version: "9.9.9",
      }),
    });
    await flush();
    const empty = container.querySelector("[data-whats-new-incoming-empty]");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toMatch(/No release notes available for this update/);
    expect(container.querySelector("[data-whats-new-incoming-highlight]")).toBeNull();
    cleanup();
  });

  it("renders the incoming empty state when notes are present but empty", async () => {
    const { container, cleanup } = renderDialog({
      getInfo: async (): Promise<AppInfo> => makeInfo(WHATS_NEW[0].version),
      updateGetStatus: async (): Promise<UpdateState> => ({
        kind: "downloaded",
        version: "9.9.9",
        notes: [],
      }),
    });
    await flush();
    expect(container.querySelector("[data-whats-new-incoming]")).not.toBeNull();
    expect(container.querySelector("[data-whats-new-incoming-empty]")).not.toBeNull();
    cleanup();
  });

  it("does not render the incoming block for states without notes", async () => {
    const { container, cleanup } = renderDialog({
      getInfo: async (): Promise<AppInfo> => makeInfo(WHATS_NEW[0].version),
      updateGetStatus: async (): Promise<UpdateState> => ({
        kind: "up-to-date",
        version: "1.2.3",
      }),
    });
    await flush();
    expect(container.querySelector("[data-whats-new-incoming]")).toBeNull();
    expect(container.querySelector("[data-whats-new-incoming-empty]")).toBeNull();
    cleanup();
  });

  it("renders a note line containing markup as literal text with no element created", async () => {
    const { container, cleanup } = renderDialog({
      getInfo: async (): Promise<AppInfo> => makeInfo(WHATS_NEW[0].version),
      updateGetStatus: async (): Promise<UpdateState> => ({
        kind: "available",
        version: "9.9.9",
        notes: ["<b>bold</b> and <script>alert(1)</script>"],
      }),
    });
    await flush();
    const line = container.querySelector("[data-whats-new-incoming-highlight]");
    expect(line).not.toBeNull();
    expect(line?.textContent).toBe("<b>bold</b> and <script>alert(1)</script>");
    // The whole point: no element was parsed out of the note text.
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    cleanup();
  });

  it("renders the older entries in the compact history, newest-first", async () => {
    const running = WHATS_NEW[0].version;
    const { container, cleanup } = renderDialog({
      getInfo: async (): Promise<AppInfo> => makeInfo(running),
    });
    await flush();
    const history = container.querySelector("[data-whats-new-history]");
    expect(history).not.toBeNull();
    const items = history?.querySelectorAll("[data-whats-new-history-item]") ?? [];
    const expected = whatsNewHistory(running, 3);
    expect(items.length).toBe(expected.length);
    const versions = Array.from(items).map(
      (el) => el.querySelector(".about-whats-new-history-version")?.textContent ?? "",
    );
    expect(versions).toEqual(expected.map((entry) => `v${entry.version}`));
    // Newest-first: the first history entry must be newer than the second.
    expect(expected[0]?.version > expected[1]?.version).toBe(true);
    // DEF-276 — the running version is the boundary: it must never
    // appear in its own "Earlier releases" list.
    expect(versions).not.toContain(`v${running}`);
    cleanup();
  });

  it("lists only entries OLDER than the running version in the history (DEF-276)", async () => {
    // Running version 1.23.0 sits in the middle of the bundled list, so
    // the history must be exactly the entries after it (capped at 3) and
    // must not list the running version or anything newer.
    const running = WHATS_NEW[1].version;
    const expected = WHATS_NEW.slice(2, 5);
    const { container, cleanup } = renderDialog({
      getInfo: async (): Promise<AppInfo> => makeInfo(running),
    });
    await flush();
    const items = container.querySelectorAll("[data-whats-new-history-item]");
    const versions = Array.from(items).map(
      (el) => el.querySelector(".about-whats-new-history-version")?.textContent ?? "",
    );
    expect(versions).toEqual(expected.map((entry) => `v${entry.version}`));
    expect(versions).not.toContain(`v${running}`);
    expect(versions).not.toContain(`v${WHATS_NEW[0].version}`);
    cleanup();
  });

  it("renders no history section when the running version has no entry (DEF-276)", async () => {
    // No entry means no reliable "older than" boundary, so whatsNewHistory
    // returns [] and the whole history block is absent - never newer
    // releases mislabelled as "Earlier releases".
    const { container, cleanup } = renderDialog({
      getInfo: async (): Promise<AppInfo> => makeInfo("0.0.1-unknown"),
    });
    await flush();
    expect(container.querySelector("[data-whats-new-empty]")).not.toBeNull();
    expect(container.querySelector("[data-whats-new-history]")).toBeNull();
    expect(container.querySelector("[data-whats-new-history-item]")).toBeNull();
    cleanup();
  });

  // DEF-275 - a malformed `update:statusChanged` payload must degrade to
  // the existing empty states, never blank the renderer. The three lethal
  // shapes the adversary/qa reproduced are each pinned to a non-throwing
  // render with the About dialog still mounted.
  describe("malformed update payload hardening (DEF-275)", () => {
    function renderWithState(state: unknown): {
      container: HTMLElement;
      cleanup: () => void;
    } {
      return renderDialog({
        getInfo: async (): Promise<AppInfo> => makeInfo(WHATS_NEW[0].version),
        updateGetStatus: async (): Promise<UpdateState> => state as UpdateState,
      });
    }

    it("survives a notes array carrying non-string entries", async () => {
      const { container, cleanup } = renderWithState({
        kind: "available",
        version: "99.0.0",
        notes: [null, 123, { a: 1 }, "kept string"],
      });
      await flush();
      // The dialog is still mounted - not a blank root.
      expect(container.querySelector("[data-about-dialog]")).not.toBeNull();
      expect(container.querySelector(".sheet-about")).not.toBeNull();
      // Non-string entries are dropped; the one real string survives.
      const lines = container.querySelectorAll("[data-whats-new-incoming-highlight]");
      expect(lines.length).toBe(1);
      expect(lines[0]?.textContent).toBe("kept string");
      cleanup();
    });

    it("survives a non-array notes value and shows the incoming empty state", async () => {
      const { container, cleanup } = renderWithState({
        kind: "available",
        version: "99.0.0",
        notes: "just a string",
      });
      await flush();
      expect(container.querySelector("[data-about-dialog]")).not.toBeNull();
      expect(container.querySelector("[data-whats-new-incoming]")).not.toBeNull();
      expect(container.querySelector("[data-whats-new-incoming-empty]")).not.toBeNull();
      expect(container.querySelector("[data-whats-new-incoming-highlight]")).toBeNull();
      cleanup();
    });

    it("survives a non-primitive version and renders a text label", async () => {
      const { container, cleanup } = renderWithState({
        kind: "available",
        version: { a: 1 },
        notes: ["line"],
      });
      await flush();
      expect(container.querySelector("[data-about-dialog]")).not.toBeNull();
      const label = container.querySelector("[data-whats-new-incoming-version]");
      expect(label).not.toBeNull();
      // String coercion keeps it a text node - no React error #31.
      expect(label?.textContent).toContain("What's new in v");
      expect(label?.textContent).toContain("[object Object]");
      cleanup();
    });

    it("keeps the control shape notes:{note:'x'} on the incoming empty state", async () => {
      const { container, cleanup } = renderWithState({
        kind: "available",
        version: "99.0.0",
        notes: { note: "x" },
      });
      await flush();
      expect(container.querySelector("[data-about-dialog]")).not.toBeNull();
      expect(container.querySelector("[data-whats-new-incoming-empty]")).not.toBeNull();
      cleanup();
    });

    it("keeps the control shape version:123 rendering as text", async () => {
      const { container, cleanup } = renderWithState({
        kind: "available",
        version: 123,
        notes: ["line"],
      });
      await flush();
      expect(container.querySelector("[data-about-dialog]")).not.toBeNull();
      const label = container.querySelector("[data-whats-new-incoming-version]");
      expect(label?.textContent).toContain("123");
      expect(container.querySelector("[data-whats-new-incoming-highlight]")).not.toBeNull();
      cleanup();
    });
  });
});