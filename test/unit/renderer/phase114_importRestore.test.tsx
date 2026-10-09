// @vitest-environment jsdom
//
// Phase 114 (TFL-1267, chunk E) — the Import & conversion panel migrated onto
// the Settings Studio primitives, plus the capability-backed "Restore defaults"
// extension.
//
// Pins that the migrated Import panel keeps all seven `data-prefs-convert-*`
// hooks, their exact options, labels and handlers; that "Restore defaults"
// opens the shared ConfirmDialog carrying the exact scope promise and only
// invokes the host callback on confirm; and that `restoreDefaultSettings`
// resets exactly the Studio-surfaced appearance / tab / import fields while
// preserving documents, recent-files history (DEF-643: including a non-default
// `recentsCap`), window layout and every other field.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import {
  PreferencesDialog,
  RESTORE_DEFAULTS_SCOPE,
} from "../../../src/renderer/components/PreferencesDialog";
import { DEFAULT_CONVERT_DEFAULTS } from "../../../src/shared/convert";
import type { ConvertDefaults } from "../../../src/shared/convert";
import { restoreDefaultSettings } from "../../../src/renderer/state/defaults";
import {
  DEFAULT_RECENTS_CAP,
  DEFAULT_TAB_STYLE,
} from "../../../src/renderer/state/preferences";
import type { AppSettings, RecentFile } from "../../../src/shared/types";

interface Mount {
  host: HTMLElement;
  unmount: () => void;
  onSetConvertDefaults: ReturnType<typeof vi.fn>;
  onRestoreDefaults: ReturnType<typeof vi.fn>;
}

function mount(): Mount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onSetConvertDefaults = vi.fn((): void => undefined);
  const onRestoreDefaults = vi.fn((): void => undefined);
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
      onSetConvertDefaults={onSetConvertDefaults}
      tabStyle="colorful"
      onSetTabStyle={vi.fn((): void => undefined)}
      onRestoreDefaults={onRestoreDefaults}
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
    onSetConvertDefaults,
    onRestoreDefaults,
  };
}

function pickSelect(host: HTMLElement, selector: string, value: string): void {
  const select = host.querySelector<HTMLSelectElement>(selector);
  expect(select).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  act((): void => {
    setValue?.call(select, value);
    select?.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function typeAndCommit(host: HTMLElement, selector: string, text: string): void {
  const input = host.querySelector<HTMLInputElement>(selector);
  expect(input).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act((): void => {
    setValue?.call(input, text);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act((): void => {
    input?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
}

const CONVERT_HOOKS = [
  "data-prefs-convert-page-size",
  "data-prefs-convert-margin",
  "data-prefs-convert-font",
  "data-prefs-convert-font-size",
  "data-prefs-convert-delimiter",
  "data-prefs-convert-csv-mapping",
  "data-prefs-convert-html-backgrounds",
] as const;

describe("Settings Studio — Import & conversion panel (chunk E)", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("keeps every shipped control hook inside the migrated section", () => {
    const { host, unmount } = mount();
    expect(host.querySelector("[data-prefs-convert-section]")).not.toBeNull();
    for (const hook of CONVERT_HOOKS) {
      expect(host.querySelector(`[${hook}]`), hook).not.toBeNull();
    }
    unmount();
  });

  it("firing each Import hook calls the matching handler", () => {
    const m = mount();
    const last = (): ConvertDefaults =>
      m.onSetConvertDefaults.mock.calls.at(-1)?.[0] as ConvertDefaults;

    pickSelect(m.host, "[data-prefs-convert-page-size]", "letter");
    expect(last().pageSize).toBe("letter");

    typeAndCommit(m.host, "[data-prefs-convert-margin]", "30");
    expect(last().marginMm).toBe(30);

    pickSelect(m.host, "[data-prefs-convert-font]", "DejaVu Serif");
    expect(last().textFontFamily).toBe("DejaVu Serif");

    typeAndCommit(m.host, "[data-prefs-convert-font-size]", "14");
    expect(last().textFontSizePt).toBe(14);

    pickSelect(m.host, "[data-prefs-convert-delimiter]", ";");
    expect(last().csvDelimiter).toBe(";");

    const mapping = m.host.querySelector<HTMLInputElement>("[data-prefs-convert-csv-mapping]");
    act((): void => {
      mapping?.click();
    });
    expect(last().csvFormMapping).toBe(false);

    const backgrounds = m.host.querySelector<HTMLInputElement>(
      "[data-prefs-convert-html-backgrounds]",
    );
    act((): void => {
      backgrounds?.click();
    });
    expect(last().htmlPrintBackgrounds).toBe(false);
    m.unmount();
  });

  it("preserves the exact select options (A4/Letter, Auto-detect, tab)", () => {
    const { host, unmount } = mount();
    const pageSizeOptions = Array.from(
      host.querySelectorAll<HTMLOptionElement>("[data-prefs-convert-page-size] option"),
    );
    expect(pageSizeOptions.map((o): string => o.value)).toEqual(["a4", "letter"]);
    expect(pageSizeOptions.map((o): string => o.textContent)).toEqual(["A4", "Letter"]);

    const delimiterOptions = Array.from(
      host.querySelectorAll<HTMLOptionElement>("[data-prefs-convert-delimiter] option"),
    );
    expect(delimiterOptions.map((o): string => o.value)).toEqual(["auto", ",", ";", "\t"]);
    expect(delimiterOptions.map((o): string => o.textContent)).toEqual([
      "Auto-detect",
      "Comma (,)",
      "Semicolon (;)",
      "Tab",
    ]);

    const fonts = Array.from(
      host.querySelectorAll<HTMLOptionElement>("[data-prefs-convert-font] option"),
    ).map((o): string => o.value);
    expect(fonts).toEqual([
      "Helvetica",
      "Times",
      "Courier",
      "Liberation Sans",
      "DejaVu Serif",
      "DejaVu Sans Mono",
      "Inter",
    ]);
    unmount();
  });
});

describe("Restore defaults (chunk E)", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("opens the shared ConfirmDialog with the exact scope message", () => {
    const m = mount();
    expect(m.host.querySelector("[data-confirm-dialog]")).toBeNull();

    const button = m.host.querySelector<HTMLButtonElement>("[data-prefs-restore-defaults]");
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe("Restore defaults");

    act((): void => {
      button?.click();
    });

    expect(m.host.querySelector("[data-confirm-dialog]")).not.toBeNull();
    expect(m.host.querySelector("#confirm-dialog-title")?.textContent).toBe(
      "Restore default settings?",
    );
    expect(m.host.querySelector("#confirm-dialog-body")?.textContent).toBe(RESTORE_DEFAULTS_SCOPE);
    // The Studio row states the same scope promise.
    expect(m.host.textContent).toContain(RESTORE_DEFAULTS_SCOPE);
    expect(m.onRestoreDefaults).not.toHaveBeenCalled();
    m.unmount();
  });

  it("confirm invokes onRestoreDefaults exactly once", () => {
    const m = mount();
    act((): void => {
      m.host.querySelector<HTMLButtonElement>("[data-prefs-restore-defaults]")?.click();
    });
    const confirm = m.host.querySelector<HTMLButtonElement>(
      '[data-confirm-dialog-action="confirm"]',
    );
    expect(confirm).not.toBeNull();
    expect(confirm?.textContent).toBe("Restore defaults");
    act((): void => {
      confirm?.click();
    });
    expect(m.onRestoreDefaults).toHaveBeenCalledTimes(1);
    m.unmount();
  });

  it("cancel does not invoke onRestoreDefaults", () => {
    const m = mount();
    act((): void => {
      m.host.querySelector<HTMLButtonElement>("[data-prefs-restore-defaults]")?.click();
    });
    const cancel = m.host.querySelector<HTMLButtonElement>(
      '[data-confirm-dialog-action="cancel"]',
    );
    expect(cancel).not.toBeNull();
    expect(cancel?.textContent).toBe("Cancel");
    act((): void => {
      cancel?.click();
    });
    expect(m.onRestoreDefaults).not.toHaveBeenCalled();
    m.unmount();
  });
});

describe("restoreDefaultSettings (chunk E)", () => {
  const recentFiles: RecentFile[] = [
    {
      path: "C:/docs/report.pdf",
      name: "report.pdf",
      openedAt: "2024-01-01T00:00:00.000Z",
      pinned: true,
    },
    {
      path: "C:/docs/invoice.pdf",
      name: "invoice.pdf",
      openedAt: "2024-01-02T00:00:00.000Z",
    },
    {
      path: "C:/docs/notes.pdf",
      name: "notes.pdf",
      openedAt: "2024-01-03T00:00:00.000Z",
    },
  ];

  function currentSettings(): AppSettings {
    return {
      theme: "dark",
      geometry: { x: 12, y: 34, width: 800, height: 600, maximized: true },
      recentFiles: recentFiles.map((f): RecentFile => ({ ...f })),
      themeDefault: "light",
      recentsCap: 20,
      animationsEnabled: false,
      tabStyle: "standard",
      convertDefaults: {
        ...DEFAULT_CONVERT_DEFAULTS,
        pageSize: "letter",
        marginMm: 33,
        textFontSizePt: 20,
      },
      // Fields outside the Studio reset scope that must survive untouched.
      redactionColor: "#123456",
      saveAsLinearize: true,
      accountsEnabled: false,
    };
  }

  it("resets only the Studio-surfaced appearance, tab and import fields", () => {
    const out = restoreDefaultSettings(currentSettings());
    expect(out.theme).toBe("frosted");
    expect(out.themeDefault).toBe("frosted");
    expect(out.animationsEnabled).toBe(true);
    expect(out.tabStyle).toBe(DEFAULT_TAB_STYLE);
    expect(out.tabStyle).toBe("chrome");
    expect(out.convertDefaults).toEqual(DEFAULT_CONVERT_DEFAULTS);
  });

  // DEF-643 / TFL-1282 — the regression the old single-entry seed missed: the
  // backend trims `recentFiles` to `recentsCap` on every save (settings.ts
  // :1182-1190, :427-428), so a reset that lowered the cap silently truncated
  // history. The reset must leave BOTH the non-default cap AND the whole list
  // untouched.
  it("DEF-643 — preserves a non-default recentsCap and the whole recent-files history", () => {
    const current = currentSettings();
    expect(current.recentsCap).toBe(20);
    expect(current.recentsCap).not.toBe(DEFAULT_RECENTS_CAP);
    expect(current.recentFiles).toHaveLength(3);

    const out = restoreDefaultSettings(current);
    expect(out.recentsCap).toBe(20);
    expect(out.recentsCap).not.toBe(DEFAULT_RECENTS_CAP);
    expect(out.recentFiles).toHaveLength(3);
    expect(out.recentFiles).toBe(current.recentFiles);
    expect(out.recentFiles).toEqual(current.recentFiles);
  });

  it("preserves recentFiles, geometry and every other field", () => {
    const current = currentSettings();
    const out = restoreDefaultSettings(current);
    expect(out.recentFiles).toBe(current.recentFiles);
    expect(out.recentFiles).toHaveLength(3);
    expect(out.recentFiles[0]).toEqual(recentFiles[0]);
    expect(out.geometry).toBe(current.geometry);
    expect(out.geometry).toEqual({ x: 12, y: 34, width: 800, height: 600, maximized: true });
    expect(out.redactionColor).toBe("#123456");
    expect(out.saveAsLinearize).toBe(true);
    expect(out.accountsEnabled).toBe(false);
  });

  it("is pure: never mutates the argument and never aliases convertDefaults", () => {
    const current = currentSettings();
    const before = currentSettings();
    const out = restoreDefaultSettings(current);
    expect(current).toEqual(before);
    expect(current.convertDefaults?.pageSize).toBe("letter");
    expect(current.convertDefaults?.marginMm).toBe(33);
    expect(current.recentsCap).toBe(20);
    expect(current.theme).toBe("dark");
    expect(current.tabStyle).toBe("standard");
    expect(out.convertDefaults).not.toBe(current.convertDefaults);
    expect(out).not.toBe(current);
  });
});
