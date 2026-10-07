// @vitest-environment jsdom
//
// DEF-215 — the Phase-17 single-panel PreferencesDialog replaced the
// old category-navigation design (Appearance / General categories and
// their per-category props are gone). These tests pin the CURRENT
// shape of the dialog:
//
//   a. the sheet mounts open with the [data-prefs-dialog] root.
//   b. the sections render in order: Appearance, Recent files,
//      Default PDF app, Import and conversion, Storage locations.
//   c. the theme dropdown offers exactly the four ThemeDefault
//      options (Light, Dark, Frosted, System default).
//   d. changing the dropdown fires onSetThemeDefault AND
//      onThemeChange once each with the picked value (immediate
//      apply + persist).
//   e. committing the recents cap (Enter keydown) fires
//      onSetRecentsCap once with the parsed number.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { PreferencesDialog } from "../../../src/renderer/components/PreferencesDialog";
import type { ThemeDefault } from "../../../src/renderer/state/preferences";
import { DEFAULT_CONVERT_DEFAULTS } from "../../../src/shared/convert";

interface Mount {
  host: HTMLElement;
  unmount: () => void;
  onSetThemeDefault: ReturnType<typeof vi.fn>;
  onThemeChange: ReturnType<typeof vi.fn>;
  onSetRecentsCap: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
}

function mountPrefs(
  opts: { themeDefault?: ThemeDefault; recentsCap?: number } = {},
): Mount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onSetThemeDefault = vi.fn((): void => undefined);
  const onThemeChange = vi.fn((): void => undefined);
  const onSetRecentsCap = vi.fn((): void => undefined);
  const onClose = vi.fn((): void => undefined);
  act((): void => {
    root.render(
      <PreferencesDialog
        open
        onClose={onClose}
        themeDefault={opts.themeDefault ?? "dark"}
        recentsCap={opts.recentsCap ?? 10}
        onSetThemeDefault={onSetThemeDefault}
        onThemeChange={onThemeChange}
        onSetRecentsCap={onSetRecentsCap}
        animationsEnabled
        onSetAnimationsEnabled={vi.fn((): void => undefined)}
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
    onSetThemeDefault,
    onThemeChange,
    onSetRecentsCap,
    onClose,
  };
}

/** Drive a React controlled <select> the way a user's pick does:
 *  set the value through the NATIVE setter (React's controlled-value
 *  trap otherwise resets the node) and bubble a `change` event. */
function pickThemeOption(host: HTMLElement, value: string): void {
  const select = host.querySelector<HTMLSelectElement>("[data-prefs-theme-default]");
  expect(select).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  expect(setValue).toBeTypeOf("function");
  act((): void => {
    setValue?.call(select, value);
    select?.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** Drive a React controlled <input> the way a user's typing + Enter
 *  does: set the value through the NATIVE setter, bubble an `input`
 *  event (React's onChange for text inputs), then dispatch the Enter
 *  keydown the component's commit handler listens to. */
function typeAndCommitCap(host: HTMLElement, text: string): void {
  const input = host.querySelector<HTMLInputElement>("[data-prefs-recents-cap]");
  expect(input).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  expect(setValue).toBeTypeOf("function");
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

describe("PreferencesDialog single-panel redesign (DEF-215)", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("mounts open and the sheet root carries [data-prefs-dialog]", () => {
    const { host, unmount } = mountPrefs();
    expect(host.querySelector("[data-prefs-dialog]")).not.toBeNull();
    unmount();
  });

  it("renders the five sections in order: Appearance, Recent files, Default PDF app, Import and conversion, Storage locations", () => {
    const { host, unmount } = mountPrefs();
    const titles = Array.from(
      host.querySelectorAll<HTMLElement>("[data-prefs-dialog] .prefs-section-title"),
    ).map((el): string => el.textContent ?? "");
    expect(titles).toEqual([
      "Appearance",
      "Recent files",
      "Default PDF app",
      "Import and conversion",
      "Storage locations",
    ]);
    unmount();
  });

  it("the theme dropdown offers exactly the four ThemeDefault options", () => {
    const { host, unmount } = mountPrefs();
    const select = host.querySelector<HTMLSelectElement>("[data-prefs-theme-default]");
    expect(select).not.toBeNull();
    expect(select!.options.length).toBe(4);
    const options = Array.from(select!.options);
    expect(options.map((o): string => o.textContent ?? "")).toEqual([
      "Light",
      "Dark",
      "Frosted",
      "System default",
    ]);
    expect(options.map((o): string => o.value)).toEqual([
      "light",
      "dark",
      "frosted",
      "system",
    ]);
    unmount();
  });

  it("changing the dropdown fires onSetThemeDefault AND onThemeChange once each with the picked value", () => {
    const { host, onSetThemeDefault, onThemeChange, unmount } = mountPrefs({
      themeDefault: "dark",
    });
    pickThemeOption(host, "frosted");
    expect(onSetThemeDefault).toHaveBeenCalledTimes(1);
    expect(onSetThemeDefault).toHaveBeenCalledWith("frosted");
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith("frosted");
    unmount();
  });

  it("labels the motion toggle 'Enable animations' with unambiguous polarity (AR-09)", () => {
    const { host, unmount } = mountPrefs();
    const input = host.querySelector<HTMLInputElement>("[data-prefs-animations]");
    expect(input).not.toBeNull();
    const row = input?.closest(".prefs-row");
    const label = row?.querySelector<HTMLElement>(".prefs-row-label");
    expect(label?.textContent?.trim()).toBe("Enable animations");
    const hint = row?.querySelector<HTMLElement>(".prefs-hint");
    expect(hint?.textContent?.trim()).toBe(
      "When off, menus, panels, dialogs and page changes appear without transition animations.",
    );
    unmount();
  });

  it("committing the recents cap with Enter fires onSetRecentsCap once with the parsed number", () => {
    const { host, onSetRecentsCap, unmount } = mountPrefs({ recentsCap: 10 });
    typeAndCommitCap(host, "25");
    expect(onSetRecentsCap).toHaveBeenCalledTimes(1);
    expect(onSetRecentsCap).toHaveBeenCalledWith(25);
    unmount();
  });
});

/* ----------------------------------------------------------------------- */
/* Phase 59 (item 8) — the Adobe-style vertical category rail.             */
/* ----------------------------------------------------------------------- */

/** Every `data-prefs-*` hook that existed BEFORE this layout rebuild. The
 *  category rail may only change which panel is VISIBLE — never which
 *  controls exist (all four panels stay MOUNTED, hidden via `hidden`). */
const PRESERVED_PREFS_HOOKS = [
  "data-prefs-dialog",
  "data-prefs-theme-default",
  "data-prefs-animations",
  "data-prefs-tab-style",
  "data-prefs-recents-cap",
  "data-prefs-default-pdf-section",
  "data-prefs-default-pdf",
  "data-prefs-convert-section",
  "data-prefs-convert-page-size",
  "data-prefs-convert-margin",
  "data-prefs-convert-font",
  "data-prefs-convert-font-size",
  "data-prefs-convert-delimiter",
  "data-prefs-convert-csv-mapping",
  "data-prefs-convert-html-backgrounds",
] as const;

const CATEGORY_IDS = ["general", "documents", "import", "storage"] as const;

function mountFull(): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
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

/** The category whose panel is currently visible (not `hidden`). */
function visibleCategory(host: HTMLElement): string | undefined {
  const visible = Array.from(host.querySelectorAll<HTMLElement>("[data-prefs-panel]")).filter(
    (el): boolean => !el.hasAttribute("hidden"),
  );
  expect(visible.length).toBe(1);
  return visible[0]?.getAttribute("data-prefs-panel") ?? undefined;
}

function activeCategoryButton(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>('[data-prefs-category][aria-selected="true"]');
}

function clickCategory(host: HTMLElement, id: string): void {
  const btn = host.querySelector<HTMLButtonElement>(`[data-prefs-category="${id}"]`);
  expect(btn).not.toBeNull();
  act((): void => {
    btn?.click();
  });
}

function pressOnCategory(host: HTMLElement, id: string, key: string): void {
  const btn = host.querySelector<HTMLButtonElement>(`[data-prefs-category="${id}"]`);
  expect(btn).not.toBeNull();
  act((): void => {
    btn?.focus();
    btn?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("PreferencesDialog vertical category rail (Phase 59 item 8)", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("renders four vertical category tabs, one active, all panels mounted", () => {
    const { host, unmount } = mountFull();
    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-prefs-category]"));
    expect(tabs.map((t): string => t.getAttribute("data-prefs-category") ?? "")).toEqual([
      ...CATEGORY_IDS,
    ]);
    for (const tab of tabs) expect(tab.getAttribute("role")).toBe("tab");
    // Exactly one panel visible; the other category panels stay in the DOM
    // (hidden), so every hook exists from the moment the sheet opens.
    expect(visibleCategory(host)).toBe("general");
    expect(host.querySelectorAll("[data-prefs-panel]").length).toBe(CATEGORY_IDS.length);
    unmount();
  });

  it("clicking each category shows that category's controls and hides the others", () => {
    const { host, unmount } = mountFull();
    const expectVisible = (id: string): void => {
      expect(visibleCategory(host)).toBe(id);
      expect(host.querySelector(`[data-prefs-category="${id}"]`)?.getAttribute("aria-selected")).toBe("true");
    };
    clickCategory(host, "documents");
    expectVisible("documents");
    expect(host.querySelector("[data-prefs-default-pdf]")).not.toBeNull();
    clickCategory(host, "import");
    expectVisible("import");
    expect(host.querySelector("[data-prefs-convert-page-size]")).not.toBeNull();
    clickCategory(host, "storage");
    expectVisible("storage");
    clickCategory(host, "general");
    expectVisible("general");
    expect(host.querySelector("[data-prefs-theme-default]")).not.toBeNull();
    unmount();
  });

  it("keeps every hidden category's hooks mounted (nothing unmounts on switch)", () => {
    const { host, unmount } = mountFull();
    clickCategory(host, "storage");
    // The convert controls live in the hidden Import panel and still exist.
    expect(host.querySelector("[data-prefs-convert-page-size]")).not.toBeNull();
    expect(host.querySelector("[data-prefs-theme-default]")).not.toBeNull();
    expect(host.querySelector("[data-prefs-recents-cap]")).not.toBeNull();
    unmount();
  });

  it("DOM sweep — every pre-existing data-prefs-* hook still exists (nothing lost)", () => {
    const { host, unmount } = mountFull();
    for (const hook of PRESERVED_PREFS_HOOKS) {
      expect(host.querySelector(`[${hook}]`), hook).not.toBeNull();
    }
    // The conditional default-PDF-app status line still appears on click.
    act((): void => {
      host.querySelector<HTMLButtonElement>("[data-prefs-default-pdf]")?.click();
    });
    expect(host.querySelector("[data-prefs-default-pdf-status]")).not.toBeNull();
    unmount();
  });

  it("is keyboard-accessible: roving tabindex, arrow keys and Home/End switch category", () => {
    const { host, unmount } = mountFull();
    const general = host.querySelector<HTMLButtonElement>('[data-prefs-category="general"]');
    const documents = host.querySelector<HTMLButtonElement>('[data-prefs-category="documents"]');
    expect(general?.tabIndex).toBe(0);
    expect(documents?.tabIndex).toBe(-1);

    pressOnCategory(host, "general", "ArrowDown");
    expect(activeCategoryButton(host)?.getAttribute("data-prefs-category")).toBe("documents");
    expect(visibleCategory(host)).toBe("documents");
    // Roving tabindex follows the active tab, and focus moved with it.
    expect(document.activeElement).toBe(documents);
    expect(documents?.tabIndex).toBe(0);

    pressOnCategory(host, "documents", "ArrowUp");
    expect(activeCategoryButton(host)?.getAttribute("data-prefs-category")).toBe("general");
    pressOnCategory(host, "general", "End");
    expect(activeCategoryButton(host)?.getAttribute("data-prefs-category")).toBe("storage");
    pressOnCategory(host, "storage", "Home");
    expect(activeCategoryButton(host)?.getAttribute("data-prefs-category")).toBe("general");
    unmount();
  });

  it("category switching uses the shared motion utility (token durations, reduced-motion safe)", () => {
    const { host, unmount } = mountFull();
    const panel = host.querySelector<HTMLElement>('[data-prefs-panel="general"]');
    expect(panel?.className).toContain("anim-tab-in");
    clickCategory(host, "import");
    expect(host.querySelector<HTMLElement>('[data-prefs-panel="import"]')?.className).toContain("anim-tab-in");
    expect(host.querySelector<HTMLElement>('[data-prefs-panel="general"]')?.className).not.toContain("anim-tab-in");
    unmount();
  });

  it("wraps the category panels in a TfResize height frame inside the sheet (Phase 71)", () => {
    const { host, unmount } = mountFull();
    const frame = host.querySelector<HTMLElement>('[data-prefs-dialog] [data-tf-resize="height"]');
    expect(frame).not.toBeNull();
    // The frame is the animated sheet body: every category panel lives inside
    // it, so a category switch tweens the sheet height instead of jumping.
    const panels = frame?.querySelectorAll("[data-prefs-panel]") ?? [];
    expect(panels.length).toBe(CATEGORY_IDS.length);
    unmount();
  });
});

/* ----------------------------------------------------------------------- */
/* Phase 59 (item 8) — the two-column row CSS contract.                    */
/* jsdom cannot apply styles.css, so this is the established textual scan. */
/* ----------------------------------------------------------------------- */

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

describe("PreferencesDialog two-column layout CSS contract (Phase 59 item 8)", () => {
  it("a prefs row is a two-track grid whose label and control are separate tracks", () => {
    const css = readFileSync(STYLES_PATH, "utf8");
    const row = css.slice(css.indexOf(".prefs-row {"), css.indexOf(".prefs-row-label {"));
    expect(row).toMatch(/display:\s*grid;/);
    // TWO explicit tracks: a flexing text track + a bounded control track.
    expect(row).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(\d+px,\s*\d+px\)/);
    // Real gutter between the tracks, so text can never touch its control.
    expect(row).toMatch(/column-gap:\s*var\(--sp-\d+\)/);
    // No absolute/overlap positioning anywhere in the row.
    expect(row).not.toMatch(/position:\s*absolute/);

    // The text cell stacks the label and its hint in column 1.
    const text = css.slice(css.indexOf(".prefs-row-text {"), css.indexOf(".prefs-row-label {"));
    expect(text).toMatch(/grid-column:\s*1;/);
    expect(text).toMatch(/flex-direction:\s*column/);

    const label = css.slice(css.indexOf(".prefs-row-label {"), css.indexOf(".prefs-select,"));
    expect(label).toMatch(/grid-column:\s*1;/);
    expect(label).not.toMatch(/position:\s*absolute/);

    const control = css.slice(css.indexOf(".prefs-select,"), css.indexOf(".prefs-select:focus,"));
    expect(control).toMatch(/grid-column:\s*2;/);
    // The control fills its own column (bounded), never overlaps the label.
    expect(control).toMatch(/max-width:\s*\d+px/);
  });

  it("the sheet is widened for the rail and never overflows a small viewport", () => {
    const css = readFileSync(STYLES_PATH, "utf8");
    const sheet = css.slice(css.indexOf(".sheet-prefs {"), css.indexOf(".prefs-layout {"));
    expect(sheet).toMatch(/width:\s*min\(8\d\dpx,\s*calc\(100vw - \d+px\)\)/);
    expect(sheet).toMatch(/max-height:\s*min\(\d+px,\s*calc\(100vh - \d+px\)\)/);
    // The rail is fixed and the content pane scrolls independently, so the
    // tabs stay visible while a long category scrolls.
    const layout = css.slice(css.indexOf(".prefs-layout {"), css.indexOf(".prefs-section {"));
    expect(layout).toMatch(/\.prefs-rail\s*\{[\s\S]*?flex:\s*0 0 auto;/);
    expect(layout).toMatch(/\.prefs-content\s*\{[\s\S]*?overflow-y:\s*auto;/);
  });

  it("a hidden category panel is display-none (only the active one paints)", () => {
    const css = readFileSync(STYLES_PATH, "utf8");
    expect(css).toMatch(/\.prefs-panel\[data-active="false"\]\s*\{\s*display:\s*none;\s*\}/);
  });
});