// @vitest-environment jsdom
//
// Phase 22 — the relocated FILE-ACTION group.
//
// Open / Save / Save As moved out of the CommandBar into the caption
// strip (AppHeader's .titlebar-file group), immediately right of the
// TFlex brand and left of the tab strip. These tests pin:
//   1. Placement + DOM order: brand -> group -> tab strip.
//   2. The stable e2e hooks move with the controls
//      ([data-toolbar-open] / [data-toolbar-save] / [data-toolbar-save-as])
//      and appear EXACTLY ONCE in the whole document (no duplicates).
//   3. The a11y contract: group role/aria-label, button aria-labels and
//      the accelerator-bearing tooltips.
//   4. The Save state ladder: disabled while clean, enabled while
//      modified, read-only keeps the warning tint but stays disabled,
//      and the modified dot shows only while modified.
//   5. The title-bar ladder at the CSS source (28px controls inside a
//      32px capsule — not the CommandBar's 36/32 ladder).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { AppHeader } from "../../../src/renderer/components/AppHeader";
import { CommandBar } from "../../../src/renderer/components/CommandBar";
import type { ZoomMode } from "../../../src/renderer/state/zoom";

const NOOP = (): void => undefined;

interface HeaderArgs {
  activeId?: string | null;
  tabs?: Array<{ id: string; title: string; modified: boolean }>;
  onOpenFile?: () => void;
  onSave?: () => void;
  onSaveAs?: () => void;
  saveModified?: boolean;
  saveInPlaceEnabled?: boolean;
}

function mount(element: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return host;
}

function headerElement(args: HeaderArgs = {}): ReactElement {
  return (
    <AppHeader
      activeId={args.activeId === undefined ? "a" : args.activeId}
      tabs={args.tabs ?? [{ id: "a", title: "a.pdf", modified: args.saveModified ?? false }]}
      onActivate={NOOP}
      onClose={NOOP}
      theme="frosted"
      onThemeChange={NOOP}
      onNewEmptyTab={NOOP}
      onOpenPreferences={NOOP}
      onOpenFile={args.onOpenFile ?? NOOP}
      onSave={args.onSave ?? NOOP}
      onSaveAs={args.onSaveAs ?? NOOP}
      saveModified={args.saveModified ?? false}
      saveInPlaceEnabled={args.saveInPlaceEnabled ?? true}
    />
  );
}

function renderHeader(args: HeaderArgs = {}): HTMLElement {
  return mount(headerElement(args));
}

describe("Phase 22 — title-bar file group placement", () => {
  it("sits between the brand and the tab strip, in that DOM order", () => {
    const host = renderHeader();
    try {
      const header = host.querySelector(".app-header");
      expect(header).not.toBeNull();
      const children = Array.from(header?.children ?? []);
      const order = children.map((c) => c.className);
      const brandIdx = order.findIndex((c) => c.includes("brand"));
      const groupIdx = order.findIndex((c) => c.includes("titlebar-file"));
      const tabIdx = order.findIndex((c) => c.includes("tab-area"));
      expect(brandIdx).toBeGreaterThanOrEqual(0);
      expect(groupIdx).toBe(brandIdx + 1);
      expect(tabIdx).toBe(groupIdx + 1);
    } finally {
      host.remove();
    }
  });

  it("renders ONE grouped capsule with an accessible name", () => {
    const host = renderHeader();
    try {
      const groups = host.querySelectorAll(".titlebar-file");
      expect(groups.length).toBe(1);
      const group = groups[0] as HTMLElement;
      expect(group.getAttribute("role")).toBe("group");
      expect(group.getAttribute("aria-label")).toBe("File actions");
      // Exactly three controls: Open, Save, Save As.
      expect(group.querySelectorAll("button").length).toBe(3);
    } finally {
      host.remove();
    }
  });

  it("keeps the stable hooks, exactly once each, and not in the CommandBar", () => {
    const host = renderHeader();
    const bar = mount(
      <CommandBar
        page={1}
        pageCount={3}
        zoomPercent={100}
        zoomMode={"fit-width" as ZoomMode}
        onJump={NOOP}
        onZoomIn={NOOP}
        onZoomOut={NOOP}
        onFitWidth={NOOP}
        onFitPage={NOOP}
        searchOpen={false}
        onToggleSearch={NOOP}
        onMerge={NOOP}
        onSplit={NOOP}
        signToolActive={false}
        onSignClick={NOOP}
        hasFormFields={false}
        onFlattenClick={NOOP}
        onOptimize={NOOP}
        onAuditSpace={NOOP}
      />,
    );
    try {
      // One instance of each hook across the whole header + bar.
      expect(host.querySelectorAll("[data-toolbar-open]").length).toBe(1);
      expect(host.querySelectorAll("[data-toolbar-save]").length).toBe(1);
      expect(host.querySelectorAll("[data-toolbar-save-as]").length).toBe(1);
      // The command bar no longer hosts any of them (no duplicates).
      expect(bar.querySelector("[data-toolbar-open]")).toBeNull();
      expect(bar.querySelector("[data-toolbar-save]")).toBeNull();
      expect(bar.querySelector("[data-toolbar-save-as]")).toBeNull();
    } finally {
      host.remove();
      bar.remove();
    }
  });

  it("keeps the aria-labels and accelerator tooltips", () => {
    const host = renderHeader({ saveModified: true });
    try {
      const open = host.querySelector<HTMLButtonElement>("[data-toolbar-open]");
      const save = host.querySelector<HTMLButtonElement>("[data-toolbar-save]");
      const saveAs = host.querySelector<HTMLButtonElement>("[data-toolbar-save-as]");
      expect(open?.getAttribute("aria-label")).toBe("Open PDF document");
      expect(open?.getAttribute("title")).toContain("Ctrl+O");
      expect(save?.getAttribute("aria-label")).toBe("Save");
      expect(save?.getAttribute("title")).toContain("Ctrl+S");
      expect(saveAs?.getAttribute("aria-label")).toBe("Save a copy");
      expect(saveAs?.getAttribute("title")).toContain("Ctrl+Shift+S");
      // Open stays the ONE accent primary in the strip.
      expect(open?.classList.contains("titlebar-file-open")).toBe(true);
    } finally {
      host.remove();
    }
  });

  it("fires onOpenFile / onSave / onSaveAs from the relocated controls", () => {
    const onOpenFile = vi.fn();
    const onSave = vi.fn();
    const onSaveAs = vi.fn();
    const host = renderHeader({ onOpenFile, onSave, onSaveAs, saveModified: true });
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-toolbar-open]")?.click();
        host.querySelector<HTMLButtonElement>("[data-toolbar-save]")?.click();
        host.querySelector<HTMLButtonElement>("[data-toolbar-save-as]")?.click();
      });
      expect(onOpenFile).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSaveAs).toHaveBeenCalledTimes(1);
    } finally {
      host.remove();
    }
  });
});

describe("Phase 22 — relocated Save state semantics (unchanged)", () => {
  it("disables Save while the document is clean, and shows no dot", () => {
    const host = renderHeader({ saveModified: false });
    try {
      const save = host.querySelector<HTMLButtonElement>("[data-toolbar-save]");
      expect(save?.disabled).toBe(true);
      expect(save?.getAttribute("title")).toBe("Saved — no changes to save");
      expect(save?.classList.contains("titlebar-file-btn-clean")).toBe(true);
      const dot = save?.querySelector(".titlebar-file-dot");
      expect(dot?.classList.contains("titlebar-file-dot-hidden")).toBe(true);
    } finally {
      host.remove();
    }
  });

  // DEF-246 — Save As is a COPY, so it is enabled whenever a document is
  // open, clean or modified. The old "Nothing to save" state made the
  // button disagree with the menu entry and Ctrl+Shift+S.
  it("keeps Save As enabled on a clean document and drops the 'Nothing to save' title", () => {
    const host = renderHeader({ saveModified: false });
    try {
      const saveAs = host.querySelector<HTMLButtonElement>("[data-toolbar-save-as]");
      expect(saveAs?.disabled).toBe(false);
      expect(saveAs?.getAttribute("title")).toBe("Save a copy (Ctrl+Shift+S)");
      expect(saveAs?.getAttribute("title")).not.toContain("Nothing to save");
    } finally {
      host.remove();
    }
  });

  it("enables Save + Save As while modified and shows the modified dot", () => {
    const host = renderHeader({ saveModified: true, saveInPlaceEnabled: true });
    try {
      const save = host.querySelector<HTMLButtonElement>("[data-toolbar-save]");
      const saveAs = host.querySelector<HTMLButtonElement>("[data-toolbar-save-as]");
      expect(save?.disabled).toBe(false);
      expect(saveAs?.disabled).toBe(false);
      expect(save?.getAttribute("title")).toContain("Ctrl+S");
      expect(save?.classList.contains("titlebar-file-btn-modified")).toBe(true);
      const dot = save?.querySelector(".titlebar-file-dot");
      expect(dot?.classList.contains("titlebar-file-dot-hidden")).toBe(false);
    } finally {
      host.remove();
    }
  });

  it("keeps Save disabled (warning tint) for read-only sources while Save As stays available", () => {
    const host = renderHeader({ saveModified: true, saveInPlaceEnabled: false });
    try {
      const save = host.querySelector<HTMLButtonElement>("[data-toolbar-save]");
      const saveAs = host.querySelector<HTMLButtonElement>("[data-toolbar-save-as]");
      expect(save?.disabled).toBe(true);
      expect(saveAs?.disabled).toBe(false);
      expect(save?.classList.contains("titlebar-file-btn-readonly")).toBe(true);
      expect(save?.getAttribute("title")).toContain("Read-only");
    } finally {
      host.remove();
    }
  });

  // DEF-246 — the welcome screen (no active document) is the only state
  // where Save As is disabled; both routes that reach the same action
  // (menu saveAs + Ctrl+Shift+S) are gated on an active document too.
  it("disables Save As only on the welcome screen (no active document)", () => {
    const host = renderHeader({ activeId: null, tabs: [] });
    try {
      const save = host.querySelector<HTMLButtonElement>("[data-toolbar-save]");
      const saveAs = host.querySelector<HTMLButtonElement>("[data-toolbar-save-as]");
      expect(save?.disabled).toBe(true);
      expect(saveAs?.disabled).toBe(true);
    } finally {
      host.remove();
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-245 — the active tab must be scrolled into view. At the 640px
// minimum width the strip is narrower than a couple of tabs, so opening a
// document (or switching to one) near the end used to leave its tab
// entirely off-screen with `.tab-list` still at scrollLeft 0.
// ---------------------------------------------------------------------------
describe("DEF-245 — the active tab is scrolled into view", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  const originalMatchMedia = window.matchMedia;

  function stubScrollIntoView(): ReturnType<typeof vi.fn> {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy as unknown as Element["scrollIntoView"];
    return spy;
  }

  afterEach(() => {
    if (originalScrollIntoView === undefined) {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    } else {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
    if (originalMatchMedia === undefined) {
      delete (window as { matchMedia?: unknown }).matchMedia;
    } else {
      window.matchMedia = originalMatchMedia;
    }
  });

  function stubReducedMotion(matches: boolean): void {
    const mql = {
      matches,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: NOOP,
      removeEventListener: NOOP,
      addListener: NOOP,
      removeListener: NOOP,
      dispatchEvent: (): boolean => false,
    };
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (): typeof mql => mql,
    });
  }

  const TABS = [
    { id: "a", title: "a.pdf", modified: false },
    { id: "b", title: "b.pdf", modified: false },
  ];

  it("scrolls the newly active tab on open, switch and close", () => {
    const spy = stubScrollIntoView();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      act((): void => {
        root.render(headerElement({ activeId: "b", tabs: TABS }));
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.instances[0]).toBe(host.querySelector('[data-tab-id="b"]'));
      expect(spy).toHaveBeenLastCalledWith({
        block: "nearest",
        inline: "nearest",
        behavior: "smooth",
      });

      // Switch back to the first tab — that one is brought into view.
      act((): void => {
        root.render(headerElement({ activeId: "a", tabs: TABS }));
      });
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.instances[1]).toBe(host.querySelector('[data-tab-id="a"]'));

      // Close the active tab — the new active id is re-scrolled.
      act((): void => {
        root.render(headerElement({ activeId: "b", tabs: [TABS[1]] }));
      });
      expect(spy).toHaveBeenCalledTimes(3);
      expect(spy.mock.instances[2]).toBe(host.querySelector('[data-tab-id="b"]'));
    } finally {
      host.remove();
    }
  });

  it("does not scroll on the welcome screen (no active document)", () => {
    const spy = stubScrollIntoView();
    const host = renderHeader({ activeId: null, tabs: [] });
    try {
      expect(spy).not.toHaveBeenCalled();
    } finally {
      host.remove();
    }
  });

  it("collapses the scroll to an instant jump under prefers-reduced-motion", () => {
    const spy = stubScrollIntoView();
    stubReducedMotion(true);
    const host = renderHeader({ activeId: "b", tabs: TABS });
    try {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenLastCalledWith({
        block: "nearest",
        inline: "nearest",
        behavior: "auto",
      });
    } finally {
      host.remove();
    }
  });

  it("targets the active tab by its data-tab-id inside .tab-list", () => {
    const spy = stubScrollIntoView();
    const host = renderHeader({ activeId: "b", tabs: TABS });
    try {
      const list = host.querySelector(".tab-list");
      expect(list).not.toBeNull();
      const target = host.querySelector('[data-tab-id="b"]');
      expect(target).not.toBeNull();
      expect(list?.contains(target)).toBe(true);
      expect(spy.mock.instances[0]).toBe(target);
    } finally {
      host.remove();
    }
  });
});

// ---------------------------------------------------------------------------
// CSS source contract — the group must be sized to the TITLE-BAR ladder
// and ride the shared motion system, not the CommandBar ladder.
// ---------------------------------------------------------------------------
const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const CSS_SRC = readFileSync(STYLES_PATH, "utf8");

function cssRuleBody(selector: string): string {
  const stripped = CSS_SRC.replace(/\/\*[\s\S]*?\*\//g, "");
  const idx = stripped.indexOf(selector);
  if (idx === -1) return "";
  const braceOpen = stripped.indexOf("{", idx);
  if (braceOpen === -1) return "";
  let depth = 0;
  for (let i = braceOpen; i < stripped.length; i += 1) {
    if (stripped[i] === "{") depth += 1;
    else if (stripped[i] === "}") {
      depth -= 1;
      if (depth === 0) return stripped.slice(braceOpen + 1, i);
    }
  }
  return "";
}

describe("Phase 22 — title-bar ladder + shared motion (CSS source)", () => {
  it("the capsule is 32px and its controls are 28px (title-bar ladder)", () => {
    expect(cssRuleBody(".titlebar-file {")).toContain("height: 32px");
    expect(cssRuleBody(".titlebar-file-btn {")).toContain("height: 28px");
    // Not the CommandBar ladder (36px capsule / 32px tool-btn).
    expect(cssRuleBody(".titlebar-file-btn {")).not.toContain("height: 32px");
  });

  it("uses the compact --radius-3 capsule corner, not the command bar's --radius-group", () => {
    const capsule = cssRuleBody(".titlebar-file {");
    expect(capsule).toContain("border-radius: var(--radius-3)");
    expect(cssRuleBody(".titlebar-file-btn {")).toContain("border-radius: var(--radius-2)");
  });

  it("rides the shared hover-lift / press lists and the motion tokens (no hardcoded timing)", () => {
    expect(CSS_SRC).toContain(".titlebar-file-btn:hover:not([disabled]),");
    expect(CSS_SRC).toContain(".titlebar-file-btn:active:not([disabled]),");
    const body = cssRuleBody(".titlebar-file-btn {");
    expect(body).toContain("var(--motion-fast)");
    expect(body).not.toMatch(/\d+ms/);
  });

  it("opts out of the window-drag region and drops motion under reduced-motion", () => {
    expect(cssRuleBody(".titlebar-file {")).toContain("-webkit-app-region: no-drag");
    // The reduced-motion block zeroes the lift/press transforms (the
    // file uses CRLF, so match on a whitespace-tolerant regex).
    expect(CSS_SRC).toMatch(
      /\.titlebar-file-btn:hover:not\(\[disabled\]\),\s+\.titlebar-file-btn:active:not\(\[disabled\]\)\s*\{\s*transform:\s*none\s*!important;/,
    );
  });
});

// ---------------------------------------------------------------------------
// DEF-243 — Ctrl+Shift+S must reach Save As, never Save. App.tsx is not
// mountable in a unit test (it bootstraps the whole workspace), so — like
// bug456 / bugB10B11 / welcomeSamplesResolver — this pins the exact wiring a
// dropped guard or a branch reorder could silently break again.
// ---------------------------------------------------------------------------
const APP_PATH = resolve(__dirname, "../../../src/renderer/App.tsx");
const APP_SRC = readFileSync(APP_PATH, "utf8");

function globalKeydownHandler(): string {
  const start = APP_SRC.indexOf("const onKey = (e: KeyboardEvent): void => {");
  expect(start, "the global keydown handler exists").toBeGreaterThan(-1);
  const end = APP_SRC.indexOf('window.addEventListener("keydown", onKey)', start);
  expect(end, "the handler is registered on window").toBeGreaterThan(start);
  return APP_SRC.slice(start, end);
}

describe("DEF-243 — Ctrl+Shift+S routes to Save As, Ctrl+S still saves in place", () => {
  it("the Ctrl+S branch excludes Shift, so the Shift variant cannot be swallowed", () => {
    const b = globalKeydownHandler();
    expect(b).toMatch(/e\.key\.toLowerCase\(\) === "s" &&\s+!e\.shiftKey/);
    // Same handler and same gate as before the guard: Save is untouched.
    expect(b).toMatch(/void onSave\(tabs\.activeId\)/);
  });

  it("a dedicated Ctrl+Shift+S branch opens the Save-As flow through onSaveAs", () => {
    const b = globalKeydownHandler();
    // Ctrl (or Cmd) + Shift + S, gated on an active document, preventDefault
    // then the same handler the menu's menuContext.saveAs entry calls.
    expect(b).toMatch(
      /e\.shiftKey &&\s+e\.key\.toLowerCase\(\) === "s" &&\s+tabs\.activeId !== null\s*\)\s*\{\s*e\.preventDefault\(\);\s*void onSaveAs\(tabs\.activeId\)/,
    );
  });

  it("orders the Save branch before the Save-As branch and keeps the Z/Y guards", () => {
    const b = globalKeydownHandler();
    expect(b.indexOf("void onSave(tabs.activeId)")).toBeGreaterThan(-1);
    expect(b.indexOf("void onSave(tabs.activeId)")).toBeLessThan(b.indexOf("void onSaveAs(tabs.activeId)"));
    // Undo/Redo routing is unchanged (plain Z/Y, Shift+Z redo).
    expect(b).toMatch(/e\.key\.toLowerCase\(\) === "z"[\s\S]{0,80}?!e\.shiftKey/);
    expect(b).toMatch(/e\.shiftKey &&\s+e\.key\.toLowerCase\(\) === "z"/);
  });

  it("re-subscribes when the onSaveAs identity changes (no stale accelerator)", () => {
    expect(APP_SRC).toMatch(
      /\[onOpenClick, closeTab, onSave, onSaveAs, onUndo, onRedo, onOcrClick, tabs\.activeId, disarmEditTools\]/,
    );
  });
});

// ---------------------------------------------------------------------------
// DEF-244 — at the 640px minimum window width the file group used to eat the
// tab strip's whole share (`.tab-area` measured 0px). The fix is a pair of
// width bands that compact the caption strip's TEXT only: no control moves,
// no handler changes, and the tab strip's own scrolling rules are untouched.
// ---------------------------------------------------------------------------
function mediaBlock(maxWidth: number): string {
  const marker = `@media (max-width: ${maxWidth}px)`;
  const idx = CSS_SRC.indexOf(marker);
  if (idx === -1) return "";
  const braceOpen = CSS_SRC.indexOf("{", idx);
  if (braceOpen === -1) return "";
  let depth = 0;
  for (let i = braceOpen; i < CSS_SRC.length; i += 1) {
    if (CSS_SRC[i] === "{") depth += 1;
    else if (CSS_SRC[i] === "}") {
      depth -= 1;
      if (depth === 0) return CSS_SRC.slice(braceOpen + 1, i);
    }
  }
  return "";
}

describe("DEF-244 — the caption strip keeps a usable tab strip at 640px", () => {
  it("below 900px the Open label goes icon-only but stays in the DOM", () => {
    const band = mediaBlock(900);
    expect(band, "the <=900px caption band exists").not.toBe("");
    expect(band).toMatch(/\.titlebar-file-label\s*\{\s*display:\s*none;/);
    // The label is HIDDEN, not unmounted: the button keeps its accessible
    // name and its accelerator tooltip (jsdom does not apply the media
    // query, so the DOM contract is asserted on the rendered header).
    const host = renderHeader();
    try {
      expect(host.querySelector(".titlebar-file-label")?.textContent).toBe("Open");
      const open = host.querySelector<HTMLButtonElement>("[data-toolbar-open]");
      expect(open?.getAttribute("aria-label")).toBe("Open PDF document");
      expect(open?.getAttribute("title")).toContain("Ctrl+O");
    } finally {
      host.remove();
    }
  });

  it("below 900px the group tightens its trailing margin so the strip gets the space", () => {
    const band = mediaBlock(900);
    expect(band).toMatch(/\.titlebar-file\s*\{\s*margin-right:\s*var\(--sp-2\);/);
  });

  it("below 700px the theme pill drops its label text only", () => {
    const band = mediaBlock(700);
    expect(band, "the <=700px caption band exists").not.toBe("");
    expect(band).toMatch(/\.theme-toggle-label\s*\{\s*display:\s*none;/);
    // The trigger itself is never hidden — it keeps its aria-label, its
    // "current theme" tooltip and its popover.
    expect(band).not.toContain("theme-toggle-trigger");
  });

  it("neither band touches the tab strip's scrolling rules or the window controls", () => {
    for (const width of [900, 700]) {
      const band = mediaBlock(width);
      expect(band).not.toContain(".tab-area");
      expect(band).not.toContain(".tab-list");
      expect(band).not.toContain(".titlebar-control");
    }
  });
});


// ---------------------------------------------------------------------------
// ADV-122 / DEF-422 — re-assert the DEF-244 guard at the 640px minimum.
//
// The Phase-59 overflow planner can only plan when the strip HAS width. At the
// app's minimum window width (640px) the fixed brand + file-action +
// header-action clusters had consumed the strip's whole share, so `.tab-area`
// measured 0px and every open tab (even one) was clipped and unreachable. The
// min-rung band gives the strip a real floor and compacts/sheds only the
// lowest-priority chrome, while every DEF-324 control stays mounted.
// ---------------------------------------------------------------------------
describe("DEF-422 — the caption strip keeps a usable tab strip at the 640px minimum", () => {
  it("the min-rung band gives .tab-area a floor wide enough for the active tab + close", () => {
    const band = mediaBlock(680);
    expect(band, "the <=680px min-rung band exists").not.toBe("");
    const floor = band.match(/\.tab-area\s*\{[^}]*min-width:\s*(\d+)px/);
    expect(floor, ".tab-area has a min-width in the min-rung band").not.toBeNull();
    // The colorful tab floor is 132px and the list adds 8px of padding; the
    // floor must clear that so the active tab + its close button fit.
    expect(Number(floor?.[1])).toBeGreaterThanOrEqual(140);
    // The clusters that yield the width compact at this rung.
    expect(band).toMatch(/\.app-header\s*\{[^}]*padding:\s*0 var\(--sp-1\)/);
    expect(band).toMatch(/\.header-actions\s*\{[^}]*gap:\s*0/);
    expect(band).toMatch(/\.titlebar-file\s*\{[^}]*gap:\s*0/);
  });

  it("sheds only the Ctrl+K / Ctrl+F icons and the account label, never a DEF-324 control", () => {
    const band = mediaBlock(680);
    // The two search icons (both keep their keyboard chord + palette/menu
    // routes) and the account pill's text label are the only surfaces shed.
    expect(band).toMatch(/\.header-tool-search[\s\S]*?header-find[^{]*\{[^}]*display:\s*none/);
    expect(band).toMatch(/\.account-signin-label\s*\{[^}]*display:\s*none/);
    // Every control the DEF-324 acceptance hit-tests at 640 stays mounted.
    for (const sel of [
      "\\.header-multi-mode",
      "\\.header-print",
      "\\.header-gear",
      "\\.theme-toggle",
      "\\.update-indicator",
      "\\.tab-new",
      "\\.tab-close",
    ]) {
      expect(band, `${sel} must never be display:none`).not.toMatch(
        new RegExp(`${sel}\\s*\\{[^}]*display:\\s*none`),
      );
    }
  });

  it("the min-rung band keeps the strip's own scroll contract (never clips, always scrolls)", () => {
    // The band must not touch the list's overflow/width rules; it only adds a
    // width floor to the area, so the DEF-324 scroll behaviour is unchanged.
    const band = mediaBlock(680);
    expect(band).not.toContain(".tab-list");
  });
});

// ---------------------------------------------------------------------------
// ADV-128 / DEF-428 — with many tabs, shrinking the window must bring the
// active tab back into view. The scroll into view used to fire on `activeId`
// change only; now the strip's measure/ResizeObserver path also re-asserts it
// when the measured width changes.
// ---------------------------------------------------------------------------
describe("DEF-428 — a strip width change re-brings the active tab into view", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  const originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  const hadResizeObserver = Object.prototype.hasOwnProperty.call(globalThis, "ResizeObserver");
  const originalResizeObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  const RESIZE_TABS = [
    { id: "a", title: "a.pdf", modified: false },
    { id: "b", title: "b.pdf", modified: false },
  ];
  let width = 700;
  let observed: (() => void) | null = null;

  beforeEach(() => {
    width = 700;
    observed = null;
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element["scrollIntoView"];
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement): number {
        return this.classList?.contains("tab-list") ? width : 0;
      },
    });
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(callback: () => void) {
        observed = callback;
      }
      observe(): void {}
      disconnect(): void {}
    };
  });

  afterEach(() => {
    if (originalScrollIntoView === undefined) {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    } else {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
    if (originalClientWidth !== undefined) {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
    if (hadResizeObserver) {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalResizeObserver;
    } else {
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    }
  });

  it("re-scrolls the active tab into view when the strip width changes", () => {
    const spy = Element.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>;
    const host = renderHeader({ activeId: "b", tabs: RESIZE_TABS });
    try {
      // Mount brought the active tab into view exactly once.
      expect(spy).toHaveBeenCalledTimes(1);
      width = 300;
      act((): void => {
        observed?.();
      });
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.instances[1]).toBe(host.querySelector('[data-tab-id="b"]'));
    } finally {
      host.remove();
    }
  });

  it("does not re-scroll when the measured width is unchanged", () => {
    const spy = Element.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>;
    const host = renderHeader({ activeId: "b", tabs: RESIZE_TABS });
    try {
      expect(spy).toHaveBeenCalledTimes(1);
      act((): void => {
        observed?.();
      });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      host.remove();
    }
  });
});
