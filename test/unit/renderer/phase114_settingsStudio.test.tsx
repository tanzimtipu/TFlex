// @vitest-environment jsdom
//
// Phase 114 (TFL-1234, chunk B) — Settings Studio primitives contract.
//
// Pins the section navigator, settings group, setting row / support text and
// the Studio layout added by chunk B, plus the geometry contract in
// src/renderer/styles.css that carries the category spec (160-180px navigator,
// 24px body padding, 20px group gaps, 9px control radius, 36px height floor, a
// 44px coarse target, the stacked constrained-width layout and forced colours).
// jsdom cannot apply styles.css, so the CSS checks use the established textual
// scan pattern (see prefsDialogRedesign.test.tsx).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot } from "react-dom/client";
import { act, useState, type ReactElement } from "react";
import {
  SettingsNav,
  SettingsRow,
  SettingsSection,
  SettingsStudio,
  SettingsSupport,
  settingsNavId,
  settingsPanelId,
} from "../../../src/renderer/components/SettingsStudio";
import type { SettingsSectionDef } from "../../../src/renderer/components/SettingsStudio";

const SECTIONS: readonly SettingsSectionDef[] = [
  { id: "general", label: "General" },
  { id: "documents", label: "Documents" },
  { id: "import", label: "Import & conversion" },
  { id: "storage", label: "Storage" },
];

interface Mount {
  host: HTMLElement;
  unmount: () => void;
}

function mount(ui: ReactElement): Mount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
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

/** A controlled navigator so selection round-trips like the real Studio. */
function NavHarness(props: { onSelect?: (id: string) => void }): ReactElement {
  const [active, setActive] = useState("general");
  return (
    <SettingsNav
      sections={SECTIONS}
      activeId={active}
      onSelect={(id): void => {
        setActive(id);
        props.onSelect?.(id);
      }}
    />
  );
}

function activeTab(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>('[data-settings-nav-item][aria-selected="true"]');
}

function clickSection(host: HTMLElement, id: string): void {
  const btn = host.querySelector<HTMLButtonElement>(`[data-settings-nav-item="${id}"]`);
  expect(btn).not.toBeNull();
  act((): void => {
    btn?.click();
  });
}

function pressSection(host: HTMLElement, id: string, key: string): void {
  const btn = host.querySelector<HTMLButtonElement>(`[data-settings-nav-item="${id}"]`);
  expect(btn).not.toBeNull();
  act((): void => {
    btn?.focus();
    btn?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("Settings Studio — section navigator (chunk B)", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("renders one role=tab per section with the active one selected and roving tabindex", () => {
    const { host, unmount } = mount(<NavHarness />);
    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-settings-nav-item]"));
    expect(tabs.map((t): string => t.getAttribute("data-settings-nav-item") ?? "")).toEqual([
      "general",
      "documents",
      "import",
      "storage",
    ]);
    for (const tab of tabs) expect(tab.getAttribute("role")).toBe("tab");
    expect(host.querySelector("[data-settings-nav]")?.getAttribute("role")).toBe("tablist");
    expect(host.querySelector("[data-settings-nav]")?.getAttribute("aria-orientation")).toBe("vertical");
    expect(host.querySelector('[data-settings-nav-item="general"]')?.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector<HTMLButtonElement>('[data-settings-nav-item="general"]')?.tabIndex).toBe(0);
    expect(host.querySelector<HTMLButtonElement>('[data-settings-nav-item="documents"]')?.tabIndex).toBe(-1);
    unmount();
  });

  it("wires aria-controls and stable ids through the shared id helpers", () => {
    const { host, unmount } = mount(<NavHarness />);
    const general = host.querySelector<HTMLButtonElement>('[data-settings-nav-item="general"]');
    expect(general?.id).toBe(settingsNavId("general"));
    expect(general?.getAttribute("aria-controls")).toBe(settingsPanelId("general"));
    expect(settingsPanelId("import")).toBe("settings-panel-import");
    unmount();
  });

  it("forwards caller-supplied nav ids and data hooks (migration pass-through)", () => {
    const sections: SettingsSectionDef[] = [
      {
        id: "general",
        label: "General",
        navId: "prefs-cat-general",
        panelId: "prefs-panel-general",
        navDataAttrs: { "data-prefs-category": "general" },
      },
    ];
    const { host, unmount } = mount(
      <SettingsNav sections={sections} activeId="general" onSelect={(): void => undefined} />,
    );
    const btn = host.querySelector<HTMLButtonElement>('[data-prefs-category="general"]');
    expect(btn).not.toBeNull();
    expect(btn?.id).toBe("prefs-cat-general");
    expect(btn?.getAttribute("aria-controls")).toBe("prefs-panel-general");
    // The generic hook survives alongside the caller's legacy hook.
    expect(btn?.getAttribute("data-settings-nav-item")).toBe("general");
    expect(btn?.getAttribute("role")).toBe("tab");
    unmount();
  });

  it("clicking a section calls onSelect and moves the selection", () => {
    const onSelect = vi.fn((): void => undefined);
    const { host, unmount } = mount(<NavHarness onSelect={onSelect} />);
    clickSection(host, "storage");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("storage");
    expect(activeTab(host)?.getAttribute("data-settings-nav-item")).toBe("storage");
    unmount();
  });

  it("arrow keys plus Home/End move the roving selection and follow with focus", () => {
    const { host, unmount } = mount(<NavHarness />);
    pressSection(host, "general", "ArrowDown");
    expect(activeTab(host)?.getAttribute("data-settings-nav-item")).toBe("documents");
    expect(document.activeElement).toBe(host.querySelector('[data-settings-nav-item="documents"]'));

    pressSection(host, "documents", "ArrowUp");
    expect(activeTab(host)?.getAttribute("data-settings-nav-item")).toBe("general");

    pressSection(host, "general", "End");
    expect(activeTab(host)?.getAttribute("data-settings-nav-item")).toBe("storage");

    pressSection(host, "storage", "Home");
    expect(activeTab(host)?.getAttribute("data-settings-nav-item")).toBe("general");
    unmount();
  });
});

describe("Settings Studio — group, row and support text (chunk B)", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("SettingsSection renders a labelled group with title, description and rows", () => {
    const { host, unmount } = mount(
      <SettingsSection id="appearance" title="Appearance" description="Look and motion.">
        <SettingsRow label="Theme" htmlFor="theme" control={<select id="theme" />} />
      </SettingsSection>,
    );
    const group = host.querySelector<HTMLElement>("[data-settings-group]");
    expect(group?.getAttribute("data-settings-group")).toBe("appearance");
    expect(group?.getAttribute("role")).toBe("group");
    const title = host.querySelector<HTMLElement>(".settings-group-title");
    expect(title?.textContent).toBe("Appearance");
    expect(group?.getAttribute("aria-labelledby")).toBe(title?.id);
    expect(host.querySelector(".settings-support")?.textContent).toBe("Look and motion.");
    expect(host.querySelector(".settings-group-body .settings-row")).not.toBeNull();
    unmount();
  });

  it("SettingsSection forwards caller-supplied data hooks (migration pass-through)", () => {
    const { host, unmount } = mount(
      <SettingsSection id="documents" dataAttrs={{ "data-prefs-default-pdf-section": "" }}>
        <SettingsRow label="Default PDF app" control={<button type="button">Open</button>} />
      </SettingsSection>,
    );
    expect(host.querySelector("[data-prefs-default-pdf-section]")).not.toBeNull();
    expect(
      host.querySelector("[data-settings-group]")?.getAttribute("data-settings-group"),
    ).toBe("documents");
    unmount();
  });

  it("SettingsRow links its label to the control id and renders hint plus current value", () => {
    const { host, unmount } = mount(
      <SettingsRow
        id="theme-default"
        label="Theme default"
        htmlFor="theme-default"
        hint="Applies immediately and is the theme the app starts in next launch."
        value="Frosted"
        control={<select id="theme-default" />}
      />,
    );
    const row = host.querySelector<HTMLElement>("[data-settings-row]");
    expect(row?.getAttribute("data-settings-row")).toBe("theme-default");
    const label = host.querySelector<HTMLLabelElement>("label.settings-row-label");
    expect(label?.htmlFor).toBe("theme-default");
    expect(label?.textContent).toBe("Theme default");
    expect(host.querySelector(".settings-support")?.textContent).toBe(
      "Applies immediately and is the theme the app starts in next launch.",
    );
    expect(host.querySelector(".settings-row-value")?.textContent).toBe("Frosted");
    expect(host.querySelector(".settings-row-control select")?.id).toBe("theme-default");
    unmount();
  });

  it("SettingsRow renders a non-label element when no control id is associateable", () => {
    const { host, unmount } = mount(
      <SettingsRow label="Storage locations" control={<button type="button">Open</button>} />,
    );
    expect(host.querySelector("label.settings-row-label")).toBeNull();
    expect(host.querySelector("span.settings-row-label")?.textContent).toBe("Storage locations");
    unmount();
  });

  it("SettingsSupport renders the shared supporting-text element", () => {
    const { host, unmount } = mount(<SettingsSupport>Used by the next import.</SettingsSupport>);
    const p = host.querySelector<HTMLParagraphElement>("p.settings-support");
    expect(p?.textContent).toBe("Used by the next import.");
    unmount();
  });
});

describe("Settings Studio — layout composition (chunk B)", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("SettingsStudio composes the navigator, scrolling body and group stack", () => {
    const { host, unmount } = mount(
      <SettingsStudio sections={SECTIONS} activeId="general" onSelect={(): void => undefined}>
        <SettingsSection id="appearance" title="Appearance">
          <SettingsRow label="Theme default" htmlFor="theme" control={<select id="theme" />} />
        </SettingsSection>
      </SettingsStudio>,
    );
    const studio = host.querySelector<HTMLElement>("[data-settings-studio]");
    expect(studio).not.toBeNull();
    expect(studio?.querySelector("[data-settings-nav]")).not.toBeNull();
    expect(studio?.querySelector(".settings-studio-body")).not.toBeNull();
    expect(studio?.querySelector(".settings-studio-groups [data-settings-group]")).not.toBeNull();
    // No TfResize frame unless the caller opts in.
    expect(studio?.querySelector('[data-tf-resize="height"]')).toBeNull();
    unmount();
  });

  it("SettingsStudio opts into the shared TfResize height frame", () => {
    const { host, unmount } = mount(
      <SettingsStudio
        sections={SECTIONS}
        activeId="general"
        onSelect={(): void => undefined}
        resizeAxis="height"
      >
        <SettingsSection id="appearance" title="Appearance">
          <SettingsRow label="Theme default" htmlFor="theme" control={<select id="theme" />} />
        </SettingsSection>
      </SettingsStudio>,
    );
    const frame = host.querySelector<HTMLElement>('[data-settings-studio] [data-tf-resize="height"]');
    expect(frame).not.toBeNull();
    expect(frame?.querySelector("[data-settings-group]")).not.toBeNull();
    unmount();
  });
});

/* ----------------------------------------------------------------------- */
/* Geometry + token contract (styles.css is not applied by jsdom).          */
/* ----------------------------------------------------------------------- */

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function studioCss(): string {
  const css = readFileSync(STYLES_PATH, "utf8");
  const start = css.indexOf(".settings-studio {");
  expect(start).toBeGreaterThan(-1);
  return css.slice(start);
}

describe("Settings Studio CSS geometry contract (chunk B)", () => {
  it("uses a 160-180px section navigator and 24px body padding", () => {
    const css = studioCss();
    const nav = css.slice(
      css.indexOf(".settings-studio-nav {"),
      css.indexOf(".settings-nav-item {"),
    );
    const width = Number(/width:\s*(\d+)px/.exec(nav)?.[1]);
    expect(width).toBeGreaterThanOrEqual(160);
    expect(width).toBeLessThanOrEqual(180);

    const body = css.slice(
      css.indexOf(".settings-studio-body {"),
      css.indexOf(".settings-studio-groups {"),
    );
    expect(body).toMatch(/padding:\s*var\(--sp-5\)/);
  });

  it("keeps the 20px group gap on the 4px grid (16 + 4)", () => {
    const css = studioCss();
    const groups = css.slice(
      css.indexOf(".settings-studio-groups {"),
      css.indexOf(".settings-group {"),
    );
    expect(groups).toMatch(/gap:\s*calc\(var\(--sp-4\)\s*\+\s*var\(--sp-1\)\)/);
  });

  it("rides the shared 9px control radius and the 36px height floor", () => {
    const css = studioCss();
    const item = css.slice(
      css.indexOf(".settings-nav-item {"),
      css.indexOf(".settings-nav-item:hover"),
    );
    expect(item).toMatch(/border-radius:\s*var\(--btn-radius\)/);
    expect(item).toMatch(/min-height:\s*var\(--control-height\)/);
    const rowControl = css.slice(
      css.indexOf(".settings-row-control {"),
      css.indexOf(".settings-row-value {"),
    );
    expect(rowControl).toMatch(/min-height:\s*var\(--control-height\)/);
  });

  it("keeps the two-track row grid so the label and control cannot collide", () => {
    const css = studioCss();
    const row = css.slice(css.indexOf(".settings-row {"), css.indexOf(".settings-row-text {"));
    expect(row).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(\d+px,\s*\d+px\)/,
    );
    expect(row).toMatch(/column-gap:\s*var\(--sp-5\)/);
  });

  it("supports 44px coarse targets, a stacked constrained-width layout and forced colours", () => {
    const css = studioCss();
    expect(css).toMatch(/@media\s*\(pointer:\s*coarse\)[\s\S]*?--control-height-large/);
    expect(css).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*?flex-direction:\s*column/);
    expect(css).toMatch(/@media\s*\(forced-colors:\s*active\)[\s\S]*?Highlight/);
  });

  it("uses semantic tokens only — no raw colour literal in the Studio section", () => {
    expect(studioCss()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

