// @vitest-environment jsdom
// Phase 113 (Quiet Actions) — migration wave C: Home, title bar and tabs.
//
// Pins the wave-C call sites onto the Phase 113 axes (`intent` / `kind` /
// `density`) via the chunk-B `Button` / `IconButton` primitive and the canonical
// class contract in docs/BUTTON-SYSTEM.md. Every assertion reads the shipped
// classes/ARIA the primitive emits; no behaviour (label, handler, data-* hook,
// disabled predicate, shortcut) is re-derived here.
//
// DELIBERATE EXCEPTION — the native caption controls in TitleBar.tsx
// (minimize / maximize / close, `[data-window-minimize]` etc.) are a frameless
// window's platform-native caption controls: their geometry plus IPC behaviour
// must not be forced into the generic button primitive, so they keep their
// current native markup and are intentionally NOT asserted here.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Welcome } from "../../../src/renderer/components/Welcome";
import { HOME_FIXED_TOOL_ID } from "../../../src/renderer/state/homeTools";
import { TitleBar, type MenuGroup } from "../../../src/renderer/components/TitleBar";
import { AppHeader } from "../../../src/renderer/components/AppHeader";
import { DocumentRail } from "../../../src/renderer/components/DocumentRail";
import { AnimatedTab } from "../../../src/renderer/components/AnimatedTab";
import type { SampleDocument } from "../../../src/shared/types";

const SAMPLES_RESOLVER = (): Promise<SampleDocument[]> => Promise.resolve([]);

let roots: Root[] = [];
let hosts: HTMLElement[] = [];

function mount(ui: React.ReactElement): HTMLElement {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act((): void => {
    root.render(ui);
  });
  roots.push(root);
  hosts.push(host);
  return host;
}

function click(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function cls(el: Element | null): string {
  if (el === null) throw new Error("expected element");
  return el.getAttribute("class") ?? "";
}

beforeEach((): void => {
  roots = [];
  hosts = [];
});

afterEach((): void => {
  const rs = roots;
  const hs = hosts;
  roots = [];
  hosts = [];
  for (const root of rs) {
    act((): void => {
      root.unmount();
    });
  }
  for (const h of hs) h.remove();
});

function renderWelcome(): HTMLElement {
  return mount(
    <Welcome
      recentFiles={[]}
      onOpenRecent={(): void => undefined}
      onRemoveRecent={(): void => undefined}
      onOpenFile={(): void => undefined}
      onSampleClick={(): void => undefined}
      onMergeClick={(): void => undefined}
      onCreateFromImages={(): void => undefined}
      samplesResolver={SAMPLES_RESOLVER}
      onSetHomeMotionPaused={(): void => undefined}
      onRunHomeTool={(): void => undefined}
      onSetHomeTools={(): void => undefined}
    />,
  );
}

function setEditModeTrue(host: HTMLElement): void {
  const pen = host.querySelector("[data-home-edit-toggle]");
  if (pen === null) throw new Error("no edit pen");
  click(pen);
}

describe("Phase 113 — Welcome (Home) call sites", () => {
  it("renders Open Files as the canonical primary action", () => {
    const host = renderWelcome();
    const open = host.querySelector(`[data-home-tool="${HOME_FIXED_TOOL_ID}"]`);
    expect(open).not.toBeNull();
    const classes = cls(open);
    expect(classes).toContain("btn");
    expect(classes).toContain("btn-primary");
  });

  it("renders the removable tiles as canonical secondary actions", () => {
    const host = renderWelcome();
    const merge = host.querySelector('[data-home-tool="merge"]');
    expect(cls(merge)).toContain("btn-secondary");
  });

  it("renders the Home motion pause as a tertiary toggle with aria-pressed", () => {
    const host = renderWelcome();
    const toggle = host.querySelector("[data-orbit-motion-toggle]");
    expect(toggle).not.toBeNull();
    expect(cls(toggle)).toContain("btn-ghost");
    expect(cls(toggle)).toContain("btn-toggle");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders the remove-entry badge as a destructive compact control and the add-tool as a secondary disclosure", () => {
    const host = renderWelcome();
    setEditModeTrue(host);
    const minus = host.querySelector("[data-home-minus]");
    expect(minus).not.toBeNull();
    expect(cls(minus)).toContain("btn-danger");
    expect(cls(minus)).toContain("btn-compact");

    const plus = host.querySelector("[data-home-plus]");
    expect(plus).not.toBeNull();
    expect(cls(plus)).toContain("btn-secondary");
    expect(cls(plus)).toContain("btn-disclosure");
    expect(cls(plus)).toContain("btn-compact");
    expect(plus?.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders the edit-home-tools pen as a tertiary compact toggle carrying aria-pressed", () => {
    const host = renderWelcome();
    const pen = host.querySelector("[data-home-edit-toggle]");
    expect(pen).not.toBeNull();
    expect(cls(pen)).toContain("btn-toggle");
    expect(cls(pen)).toContain("btn-compact");
    expect(pen?.getAttribute("aria-pressed")).toBe("false");
    setEditModeTrue(host);
    expect(
      host.querySelector("[data-home-edit-toggle]")?.getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

const TITLE_GROUPS: MenuGroup[] = [
  { id: "file", label: "File", entries: [{ id: "open", label: "Open", action: "open" }] },
];

describe("Phase 113 — TitleBar File disclosure", () => {
  it("renders the File trigger as a secondary compact disclosure", () => {
    const host = mount(<TitleBar menuGroups={TITLE_GROUPS} />);
    const btn = host.querySelector("[data-menu-button]");
    expect(btn).not.toBeNull();
    expect(cls(btn)).toContain("btn-secondary");
    expect(cls(btn)).toContain("btn-disclosure");
    expect(cls(btn)).toContain("btn-compact");
    expect(btn?.getAttribute("aria-expanded")).toBe("false");
    if (btn !== null) click(btn);
    expect(host.querySelector("[data-menu-button]")?.getAttribute("aria-expanded")).toBe(
      "true",
    );
  });
});

const noop = (): void => undefined;

describe("Phase 113 — AppHeader call sites", () => {
  it("renders Save and Save a copy as secondary compact actions", () => {
    const host = mount(<AppHeader activeId="t1" onOpenPreferences={noop} onThemeChange={noop} />);
    const save = host.querySelector("[data-toolbar-save]");
    const saveAs = host.querySelector("[data-toolbar-save-as]");
    expect(cls(save)).toContain("btn-secondary");
    expect(cls(save)).toContain("btn-compact");
    expect(cls(saveAs)).toContain("btn-secondary");
    expect(cls(saveAs)).toContain("btn-compact");
  });

  it("keeps Save disabled until the document is modified", () => {
    const clean = mount(<AppHeader activeId="t1" onOpenPreferences={noop} onThemeChange={noop} />);
    expect((clean.querySelector("[data-toolbar-save]") as HTMLButtonElement).disabled).toBe(
      true,
    );
    const dirty = mount(
      <AppHeader
        activeId="t1"
        onOpenPreferences={noop}
        onThemeChange={noop}
        saveModified
        saveInPlaceEnabled
      />,
    );
    expect((dirty.querySelector("[data-toolbar-save]") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("renders Search / Print as tertiary compact actions and the gear as a ghost compact disclosure", () => {
    const host = mount(
      <AppHeader
        activeId="t1"
        onOpenPreferences={noop}
        onThemeChange={noop}
        onOpenToolSearch={(): void => undefined}
      />,
    );
    const search = host.querySelector("[data-header-tool-search]");
    const print = host.querySelector("[data-print]");
    const gear = host.querySelector("[data-open-preferences]");
    expect(cls(search)).toContain("btn-ghost");
    expect(cls(search)).toContain("btn-compact");
    expect(cls(print)).toContain("btn-ghost");
    expect(cls(print)).toContain("btn-compact");
    expect(cls(gear)).toContain("btn-ghost");
    expect(cls(gear)).toContain("btn-icon");
    expect(gear?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(host.querySelector("[data-app-menu]")).toBeNull();
  });
});

function renderAnimatedTab(active: boolean): HTMLElement {
  return mount(
    <AnimatedTab
      id="t1"
      title="Doc One"
      active={active}
      modified={false}
      onActivate={(): void => undefined}
      onClose={(): void => undefined}
    />,
  );
}

describe("Phase 113 — AnimatedTab call sites", () => {
  it("renders the tab as an exclusive-selection item whose selected state reads app state", () => {
    const active = renderAnimatedTab(true);
    const tab = active.querySelector('[data-tab-id="t1"]');
    expect(cls(tab)).toContain("btn-segmented-item");
    expect(tab?.getAttribute("aria-selected")).toBe("true");
    const inactive = renderAnimatedTab(false);
    expect(
      inactive.querySelector('[data-tab-id="t1"]')?.getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("renders the close control as a secondary compact action", () => {
    const host = renderAnimatedTab(false);
    const close = host.querySelector(".tab-close");
    expect(cls(close)).toContain("btn-secondary");
    expect(cls(close)).toContain("btn-compact");
  });
});

function renderDocumentRail(): HTMLElement {
  return mount(
    <DocumentRail
      activeId="a"
      tabs={[{ id: "a", title: "a.pdf", modified: false }]}
      onActivate={(): void => undefined}
      onClose={(): void => undefined}
      onNewEmptyTab={(): void => undefined}
    />,
  );
}

describe("Phase 113 — DocumentRail call sites", () => {
  it("renders the new-tab control as a secondary compact action", () => {
    const host = renderDocumentRail();
    const newTab = host.querySelector("[data-new-tab]");
    expect(cls(newTab)).toContain("btn-secondary");
    expect(cls(newTab)).toContain("btn-compact");
  });

  it("renders the all-documents control as a tertiary compact disclosure", () => {
    const host = renderDocumentRail();
    const allTabs = host.querySelector("[data-all-tabs]");
    expect(cls(allTabs)).toContain("btn-ghost");
    expect(cls(allTabs)).toContain("btn-disclosure");
    expect(cls(allTabs)).toContain("btn-compact");
    expect(allTabs?.getAttribute("aria-expanded")).toBe("false");
  });
});
