// @vitest-environment jsdom
//
// DEF-641 / Phase 114 criterion 4 — the Settings Studio persistence-feedback
// line (`data-prefs-persist-status`).
//
// Pins the control that qa found to be a no-op: a `role="status"` element in
// the Studio body that is present whenever the sheet is open, states the honest
// at-rest outcome ("All changes saved."), and renders the actionable failure +
// rollback sentence when the host reports a failed settings write.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  PERSIST_STATUS_SAVED,
  PreferencesDialog,
} from "../../../src/renderer/components/PreferencesDialog";
import { DEFAULT_CONVERT_DEFAULTS } from "../../../src/shared/convert";

interface Mount {
  host: HTMLElement;
  unmount: () => void;
}

/** Mount the sheet with an optional persistence-status override. Absent means
 *  the production default (the at-rest success text). */
function mount(persistStatus?: ReactNode): Mount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const ui: ReactElement = (
    <PreferencesDialog
      open
      onClose={vi.fn((): void => undefined)}
      themeDefault="dark"
      recentsCap={10}
      onSetThemeDefault={vi.fn((): void => undefined)}
      onThemeChange={vi.fn((): void => undefined)}
      onSetRecentsCap={vi.fn((): void => undefined)}
      animationsEnabled
      onSetAnimationsEnabled={vi.fn((): void => undefined)}
      convertDefaults={DEFAULT_CONVERT_DEFAULTS}
      onSetConvertDefaults={vi.fn((): void => undefined)}
      tabStyle="colorful"
      onSetTabStyle={vi.fn((): void => undefined)}
      persistStatus={persistStatus}
    />
  );
  act((): void => {
    root.render(ui);
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

function statusLine(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>("[data-prefs-persist-status]");
}

describe("Settings Studio — persistence feedback (DEF-641)", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("renders a role=status line showing the at-rest success text by default", () => {
    const { host, unmount } = mount();
    const line = statusLine(host);
    expect(line).not.toBeNull();
    expect(line?.getAttribute("role")).toBe("status");
    expect(line?.textContent?.trim()).toBe(PERSIST_STATUS_SAVED);
    unmount();
  });

  it("shows the actionable failure + rollback sentence when the host reports one", () => {
    const failure =
      "Settings could not be saved: disk full. Your previous value was restored.";
    const { host, unmount } = mount(failure);
    const line = statusLine(host);
    expect(line).not.toBeNull();
    expect(line?.getAttribute("role")).toBe("status");
    const text = line?.textContent ?? "";
    expect(text).toContain("could not be saved");
    expect(text).toContain("restored");
    expect(text).not.toBe(PERSIST_STATUS_SAVED);
    unmount();
  });

  it("returns to the success state once the host clears the failure", () => {
    const { host, unmount } = mount();
    expect(statusLine(host)?.textContent?.trim()).toBe(PERSIST_STATUS_SAVED);
    unmount();
  });

  // TFL-1282 (adversary should-fix) — the honest failure sentence must stay
  // visible on the long General / Import panels, so the line is pinned OUTSIDE
  // the scrolling Studio body (`.settings-studio-body`, overflow-y:auto) as a
  // non-scrolling footer row of the shell. This static guard fails if the line
  // is ever moved back inside the scrolling groups column.
  it("TFL-1282 — the status line is not a descendant of the scrolling groups column", () => {
    const { host, unmount } = mount();
    const line = statusLine(host);
    expect(line).not.toBeNull();
    expect(line?.getAttribute("role")).toBe("status");
    expect(line?.closest(".settings-studio-body")).toBeNull();
    expect(line?.closest(".settings-studio-groups")).toBeNull();
    // Still inside the Preferences sheet, but on the pinned shell footer row.
    expect(line?.closest("[data-prefs-dialog]")).not.toBeNull();
    expect(line?.closest(".settings-studio-shell")).not.toBeNull();
    unmount();
  });
});
