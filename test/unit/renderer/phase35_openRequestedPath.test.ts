// @vitest-environment node
// Phase 35 — the ONE shared renderer open path (`openRequestedPath`). Every
// "open this file" entry point (dialog, recent file, OS-open listener, OS
// file drop) routes through it, so a dropped PDF behaves exactly like one
// opened from the dialog: a normal tab in single mode, ASSIGNED to the
// focused pane in Multi Mode, refused when it is already the other pane's
// document.

import { describe, expect, it, vi } from "vitest";
import {
  openRequestedPath,
  type OpenRouting,
} from "../../../src/renderer/openRequestedPath";

function routing(overrides: Partial<OpenRouting> = {}): OpenRouting {
  return {
    refuseFocused: (): boolean => false,
    show: (): void => undefined,
    ...overrides,
  };
}

describe("Phase 35 — openRequestedPath (shared open path)", () => {
  it("single mode (no routing) opens and returns the tab id, no assignment", async () => {
    const openPdf = vi.fn(async (): Promise<string | null> => "tab-1");
    const show = vi.fn();
    const tabId = await openRequestedPath("C:\\docs\\a.pdf", openPdf, null);
    expect(openPdf).toHaveBeenCalledWith("C:\\docs\\a.pdf");
    expect(tabId).toBe("tab-1");
    expect(show).not.toHaveBeenCalled();
  });

  it("Multi Mode assigns the freshly opened tab to the focused pane", async () => {
    const openPdf = vi.fn(async (): Promise<string | null> => "tab-7");
    const show = vi.fn();
    const tabId = await openRequestedPath("C:\\docs\\a.pdf", openPdf, routing({ show }));
    expect(tabId).toBe("tab-7");
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith("tab-7");
  });

  it("refuses before any open when the file is already the other pane's document", async () => {
    const openPdf = vi.fn(async (): Promise<string | null> => "tab-1");
    const show = vi.fn();
    const refuseFocused = vi.fn((): boolean => true);
    const tabId = await openRequestedPath(
      "C:\\docs\\other.pdf",
      openPdf,
      routing({ refuseFocused, show }),
    );
    expect(refuseFocused).toHaveBeenCalledWith("C:\\docs\\other.pdf");
    expect(openPdf).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
    expect(tabId).toBeNull();
  });

  it("does not assign when the open failed (null tab id)", async () => {
    const openPdf = vi.fn(async (): Promise<string | null> => null);
    const show = vi.fn();
    const tabId = await openRequestedPath("C:\\docs\\bad.pdf", openPdf, routing({ show }));
    expect(tabId).toBeNull();
    expect(show).not.toHaveBeenCalled();
  });
});
