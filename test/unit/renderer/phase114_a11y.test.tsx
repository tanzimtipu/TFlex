// @vitest-environment jsdom
//
// Phase 114 (TFL-1269, chunk F) — accessibility, responsive and forced-colors
// contract for the Preferences sheet built on the Settings Studio primitives.
//
// This spec proves the sheet-level requirements the primitives already carry:
// tablist/tab/tabpanel wiring, roving tabindex + Arrow/Home/End, row
// label -> control association, the "Restore defaults" accessible name with its
// exact scope promise, Escape closing the sheet and returning focus to
// `[data-app-menu]` (DEF-611 preserved), and the static CSS guards for the
// 720px stacked layout, the forced-colors remap and the absence of glass fill
// inside the `.settings-*` block.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import {
  PreferencesDialog,
  RESTORE_DEFAULTS_SCOPE,
} from "../../../src/renderer/components/PreferencesDialog";
import { DEFAULT_CONVERT_DEFAULTS } from "../../../src/shared/convert";

const CATEGORY_IDS = ["general", "documents", "import", "storage"] as const;

interface Mount {
  host: HTMLElement;
  setOpen: (next: boolean) => void;
  onClose: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

/** Mount the real sheet with an app-menu trigger present so the DEF-611
 *  return-focus target resolves, and expose an open toggle. */
function mount(open = true): Mount {
  const appMenu = document.createElement("button");
  appMenu.type = "button";
  appMenu.setAttribute("data-app-menu", "");
  document.body.appendChild(appMenu);

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onClose = vi.fn((): void => undefined);
  let current = { open };

  const render = (): void => {
    const ui: ReactElement = (
      <PreferencesDialog
        open={current.open}
        onClose={onClose}
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
        onRestoreDefaults={vi.fn((): void => undefined)}
      />
    );
    act((): void => {
      root.render(ui);
    });
  };
  render();

  return {
    host,
    setOpen: (next: boolean): void => {
      current = { ...current, open: next };
      render();
    },
    onClose,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
      appMenu.remove();
    },
  };
}

function tab(host: HTMLElement, id: string): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(`[data-prefs-category="${id}"]`);
}

function panel(host: HTMLElement, id: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[data-prefs-panel="${id}"]`);
}

function press(host: HTMLElement, id: string, key: string): void {
  const btn = tab(host, id);
  expect(btn).not.toBeNull();
  act((): void => {
    btn?.focus();
    btn?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function pressEscape(): void {
  act((): void => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
}

describe("Preferences sheet — roles and ARIA (chunk F)", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("names the navigator as a tablist and wires every tab to its panel", () => {
    const { host, unmount } = mount();
    const nav = host.querySelector("[data-settings-nav]");
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute("role")).toBe("tablist");
    expect(nav?.getAttribute("aria-label")).toBe("Preferences categories");

    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-prefs-category]"));
    expect(tabs.map((t): string => t.getAttribute("data-prefs-category") ?? "")).toEqual([
      ...CATEGORY_IDS,
    ]);
    for (const t of tabs) {
      const id = t.getAttribute("data-prefs-category") ?? "";
      expect(t.getAttribute("role")).toBe("tab");
      expect(t.id).toBe(`prefs-cat-${id}`);
      const controls = t.getAttribute("aria-controls");
      expect(controls).toBe(`prefs-panel-${id}`);
      expect(document.getElementById(controls ?? "")).not.toBeNull();
    }
    unmount();
  });

  it("labels every tabpanel by its owning tab and selects exactly one", () => {
    const { host, unmount } = mount();
    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-prefs-category]"));
    expect(tabs.filter((t): boolean => t.getAttribute("aria-selected") === "true").length).toBe(1);
    expect(tab(host, "general")?.getAttribute("aria-selected")).toBe("true");

    const panels = Array.from(host.querySelectorAll<HTMLElement>("[data-prefs-panel]"));
    expect(panels.map((p): string => p.getAttribute("data-prefs-panel") ?? "")).toEqual([
      ...CATEGORY_IDS,
    ]);
    for (const p of panels) {
      const id = p.getAttribute("data-prefs-panel") ?? "";
      expect(p.getAttribute("role")).toBe("tabpanel");
      expect(p.id).toBe(`prefs-panel-${id}`);
      expect(p.getAttribute("aria-labelledby")).toBe(`prefs-cat-${id}`);
    }
    expect(panel(host, "general")?.hasAttribute("hidden")).toBe(false);
    expect(panel(host, "storage")?.hasAttribute("hidden")).toBe(true);
    unmount();
  });
});

describe("Preferences sheet — roving keyboard selection (chunk F)", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("keeps a single tabbable tab and moves it with ArrowDown plus Home/End", () => {
    const { host, unmount } = mount();
    expect(tab(host, "general")?.tabIndex).toBe(0);
    for (const id of ["documents", "import", "storage"]) {
      expect(tab(host, id)?.tabIndex).toBe(-1);
    }

    press(host, "general", "ArrowDown");
    expect(tab(host, "documents")?.getAttribute("aria-selected")).toBe("true");
    expect(tab(host, "documents")?.tabIndex).toBe(0);
    expect(tab(host, "general")?.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(tab(host, "documents"));
    expect(panel(host, "documents")?.hasAttribute("hidden")).toBe(false);

    press(host, "documents", "ArrowUp");
    expect(tab(host, "general")?.getAttribute("aria-selected")).toBe("true");

    press(host, "general", "End");
    expect(tab(host, "storage")?.getAttribute("aria-selected")).toBe("true");
    expect(tab(host, "storage")?.tabIndex).toBe(0);

    press(host, "storage", "Home");
    expect(tab(host, "general")?.getAttribute("aria-selected")).toBe("true");
    unmount();
  });
});

describe("Preferences sheet — label/control association (chunk F)", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("points every row label at the control id inside the same row", () => {
    const { host, unmount } = mount();
    const labels = Array.from(
      host.querySelectorAll<HTMLLabelElement>("label.settings-row-label[for]"),
    );
    expect(labels.length).toBeGreaterThanOrEqual(6);
    for (const label of labels) {
      const control = document.getElementById(label.htmlFor);
      expect(control).not.toBeNull();
      expect(control?.closest(".settings-row")).toBe(label.closest(".settings-row"));
    }
    expect(labels.some((l): boolean => l.htmlFor === "prefs-theme-default")).toBe(true);
    unmount();
  });

  it("exposes the Restore-defaults button's name and exact scope promise", () => {
    const { host, unmount } = mount();
    const button = host.querySelector<HTMLButtonElement>("[data-prefs-restore-defaults]");
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe("Restore defaults");
    const row = host.querySelector<HTMLElement>('[data-settings-row="restore-defaults"]');
    expect(row?.textContent).toContain(RESTORE_DEFAULTS_SCOPE);
    unmount();
  });
});

describe("Preferences sheet — Escape and focus return (chunk F)", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("Escape calls onClose, and closing returns focus to [data-app-menu] (DEF-611)", () => {
    const m = mount(true);
    const appMenu = document.querySelector<HTMLButtonElement>("[data-app-menu]");
    expect(appMenu).not.toBeNull();

    pressEscape();
    expect(m.onClose).toHaveBeenCalledTimes(1);

    // The host flips `open` false; the sheet's useLayoutEffect restores focus.
    m.setOpen(false);
    expect(document.activeElement).toBe(appMenu);
    m.unmount();
  });

  it("titles the Restore-defaults confirm dialog and repeats the scope promise", () => {
    const m = mount();
    act((): void => {
      m.host.querySelector<HTMLButtonElement>("[data-prefs-restore-defaults]")?.click();
    });
    expect(m.host.querySelector("#confirm-dialog-title")?.textContent).toBe(
      "Restore default settings?",
    );
    expect(m.host.querySelector("#confirm-dialog-body")?.textContent).toBe(
      RESTORE_DEFAULTS_SCOPE,
    );
    m.unmount();
  });
});

/* ----------------------------------------------------------------------- */
/* Static CSS guards (jsdom does not apply styles.css).                     */
/* ----------------------------------------------------------------------- */

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

/** The `.settings-*` source block: from `.settings-studio {` to the next
 *  top-level section marker, so the guards below inspect only this block. */
function settingsCss(): string {
  const css = readFileSync(STYLES_PATH, "utf8");
  const start = css.indexOf(".settings-studio {");
  expect(start).toBeGreaterThan(-1);
  const end = css.indexOf("TFL-1216", start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe("Settings Studio CSS — responsive, forced-colors, no glass (chunk F)", () => {
  it("stacks the studio at 720px with the navigator above the body", () => {
    const css = settingsCss();
    const narrow = css.slice(
      css.indexOf("@media (max-width: 720px)"),
      css.indexOf("@media (forced-colors"),
    );
    expect(narrow).toMatch(/\.settings-studio\s*{[^}]*flex-direction:\s*column/);
    expect(narrow).toMatch(/\.settings-studio-nav\s*{[^}]*width:\s*100%/);
  });

  it("keeps forced-colors selected, boundary and focus-ring roles legible", () => {
    const css = settingsCss();
    const forced = css.slice(css.indexOf("@media (forced-colors"));
    expect(forced).toMatch(
      /\.settings-nav-item\[aria-selected="true"\]\s*{[^}]*background:\s*Highlight[^}]*color:\s*HighlightText/,
    );
    expect(forced).toMatch(/\.settings-nav-item:focus-visible\s*{[^}]*outline:\s*2px solid Highlight/);
    expect(forced).toMatch(/\.settings-studio-nav\s*{[^}]*border-color:\s*CanvasText/);
  });

  it("lets long labels wrap without overflowing (min-width: 0 tracks)", () => {
    const css = settingsCss();
    expect(css).toMatch(/\.settings-nav-label\s*{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.settings-row-text\s*{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.settings-row-label\s*{[^}]*min-width:\s*0/);
  });

  it("uses no translucent or glass fill under the dense settings nav/rows", () => {
    const css = settingsCss();
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/rgba\(/);
    expect(css).not.toMatch(/linear-gradient/);
  });

  // DEF-646 — the shell must not collapse the Studio. The regression was a
  // `flex: 1 1 0` Studio inside a shell whose `height: 100%` resolved against
  // an indefinite parent, yielding a 0px Studio (overlapping the navigator).
  // The fix makes the sheet body a flex column (definite height for the shell)
  // and gives the shell/Studio a non-zero flex-basis so they fill it.
  it("DEF-646 — the Studio shell establishes a definite height and cannot collapse", () => {
    const css = settingsCss();
    // The Studio sheet body bounds the shell instead of leaving an indefinite height.
    expect(css).toMatch(
      /\.sheet-body-prefs:has\(>\s*\.settings-studio-shell\)\s*{[^}]*display:\s*flex[^}]*flex-direction:\s*column/,
    );
    expect(css).toMatch(/\.settings-studio-shell\s*{[^}]*flex:\s*1\s+1\s+auto/);
    expect(css).toMatch(/\.settings-studio-shell\s*{[^}]*min-height:\s*0/);
    // The Studio fills the shell with a NON-ZERO flex-basis (the DEF-646 regression was `1 1 0`).
    const start = css.indexOf(".settings-studio-shell > .settings-studio");
    expect(start).toBeGreaterThan(-1);
    const studio = css.slice(start, css.indexOf("}", start));
    expect(studio).toMatch(/flex:\s*1\s+1\s+auto/);
    expect(studio).not.toMatch(/flex:\s*1\s+1\s+0\b/);
    expect(studio).toMatch(/min-height:\s*0/);
  });
});
