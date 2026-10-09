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
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import { AppHeader } from "../../../src/renderer/components/AppHeader";
import { DocumentRail } from "../../../src/renderer/components/DocumentRail";
import { TitleBar } from "../../../src/renderer/components/TitleBar";
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
      onOpenFile={args.onOpenFile ?? NOOP}
      onSave={args.onSave ?? NOOP}
      onSaveAs={args.onSaveAs ?? NOOP}
      saveModified={args.saveModified ?? false}
      saveInPlaceEnabled={args.saveInPlaceEnabled ?? true}
      onOpenPreferences={NOOP}
      onThemeChange={NOOP}
    />
  );
}

function renderHeader(args: HeaderArgs = {}): HTMLElement {
  return mount(headerElement(args));
}

/** Phase 105 (chunk C) — the tab strip now lives in the document rail. */
function railElement(args: HeaderArgs = {}): ReactElement {
  return (
    <DocumentRail
      activeId={args.activeId === undefined ? "a" : args.activeId}
      tabs={args.tabs ?? []}
      onActivate={NOOP}
      onClose={NOOP}
      onNewEmptyTab={NOOP}
    />
  );
}

function renderRail(args: HeaderArgs = {}): HTMLElement {
  return mount(railElement(args));
}

describe("Phase 22 — title-bar file group placement", () => {
  it("sits in the title row, with the tab strip in the separate document rail", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(
        <>
          <TitleBar menuGroups={[{ id: "file", label: "File", entries: [] }]}>
            <AppHeader
              activeId="a"
              onOpenFile={NOOP}
              onSave={NOOP}
              onSaveAs={NOOP}
              onOpenPreferences={NOOP}
              onThemeChange={NOOP}
            />
          </TitleBar>
          <DocumentRail
            activeId="a"
            tabs={[{ id: "a", title: "a.pdf", modified: false }]}
            onActivate={NOOP}
            onClose={NOOP}
            onNewEmptyTab={NOOP}
          />
        </>,
      );
    });
    try {
      const header = host.querySelector(".app-header");
      expect(header).not.toBeNull();
      // The file group renders inside the title row.
      expect(header?.querySelector(".titlebar-file")).not.toBeNull();
      // The rail is a separate surface below the title bar.
      const rail = host.querySelector(".document-rail .tab-area");
      expect(rail).not.toBeNull();
      expect(header?.contains(rail as Node)).toBe(false);
      // The brand leads the title row in TitleBar, before the file group.
      const bar = host.querySelector(".titlebar");
      const brand = bar?.querySelector(".brand");
      expect(brand).not.toBeNull();
      expect(brand?.compareDocumentPosition(header as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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
    const host = renderHeader({ activeId: null });
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
// DEF-245 (repointed by Phase 72) — the active tab is NOT scrolled into view.
//
// The original guard existed because `.tab-list` was a horizontal scroll
// container, so a tab opened near the end of the strip could sit clipped
// off-screen with the list still at scrollLeft 0. Phase 72 (commit 21b0922,
// item 8) RETIRED the scroll container: every tab is kept in ONE row by a
// uniform fit width (`--tf-tab-width`), so there is no `scrollLeft`, no
// `scrollIntoView`, and no reveal to schedule. The user-facing guarantee still
// matters — the active tab stays RENDERED and marked active inside the strip —
// so this block now pins that instead of the removed reveal.
// ---------------------------------------------------------------------------
describe("DEF-245 — the active tab stays in the strip (Phase 72 retired the reveal)", () => {
  const TABS = [
    { id: "a", title: "a.pdf", modified: false },
    { id: "b", title: "b.pdf", modified: false },
  ];

  it("the document rail source never calls scrollIntoView / writes scrollLeft", () => {
    const source = readFileSync("src/renderer/components/DocumentRail.tsx", "utf8");
    expect(source).not.toContain("scrollIntoView");
    // The reorder drop-slot math keeps `el.scrollLeft` as a read term, but
    // there is no reveal write (`list.scrollLeft +=`).
    expect(source).not.toContain("scrollLeft +=");
  });

  it("the active tab is not scrolled: every tab is rendered in the strip", () => {
    const host = renderRail({ activeId: "b", tabs: TABS });
    try {
      const list = host.querySelector<HTMLElement>(".tab-list");
      expect(list).not.toBeNull();
      // Both tabs fit, so no fit width is written and the strip is not
      // scroll-driven.
      expect(list?.style.getPropertyValue("--tf-tab-width")).toBe("");
      expect(host.querySelectorAll(".tab")).toHaveLength(2);
    } finally {
      host.remove();
    }
  });

  it("keeps the active marker on the active tab as it switches in place", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      act((): void => {
        root.render(railElement({ activeId: "b", tabs: TABS }));
      });
      expect(host.querySelectorAll(".tab-active")).toHaveLength(1);
      expect(host.querySelector(".tab-active")?.getAttribute("data-tab-id")).toBe("b");

      // Switch to the first tab — the marker moves, the strip does not.
      act((): void => {
        root.render(railElement({ activeId: "a", tabs: TABS }));
      });
      expect(host.querySelectorAll(".tab-active")).toHaveLength(1);
      expect(host.querySelector(".tab-active")?.getAttribute("data-tab-id")).toBe("a");
    } finally {
      host.remove();
    }
  });

  it("shows no active marker on the welcome screen (no document)", () => {
    const host = renderRail({ activeId: null, tabs: [] });
    try {
      expect(host.querySelector(".tab-list")).not.toBeNull();
      expect(host.querySelectorAll(".tab")).toHaveLength(0);
      expect(host.querySelector(".tab-active")).toBeNull();
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
    // Same handler and same gate as before the guard: Save is untouched. The
    // TFL-1116 C4 (R05) surface evaluator narrows the id to `activeDocId`
    // (the active id only on a real document surface), so the branch keys on it.
    expect(b).toMatch(/void onSave\(activeDocId\)/);
  });

  it("a dedicated Ctrl+Shift+S branch opens the Save-As flow through onSaveAs", () => {
    const b = globalKeydownHandler();
    // Ctrl (or Cmd) + Shift + S, gated on an active document, preventDefault
    // then the same handler the menu's menuContext.saveAs entry calls.
    expect(b).toMatch(
      /e\.shiftKey &&\s+e\.key\.toLowerCase\(\) === "s" &&\s+activeDocId !== null\s*\)\s*\{\s*e\.preventDefault\(\);\s*void onSaveAs\(activeDocId\)/,
    );
  });

  it("orders the Save branch before the Save-As branch and keeps the Z/Y guards", () => {
    const b = globalKeydownHandler();
    expect(b.indexOf("void onSave(activeDocId)")).toBeGreaterThan(-1);
    expect(b.indexOf("void onSave(activeDocId)")).toBeLessThan(b.indexOf("void onSaveAs(activeDocId)"));
    // Undo/Redo routing is unchanged (plain Z/Y, Shift+Z redo).
    expect(b).toMatch(/e\.key\.toLowerCase\(\) === "z"[\s\S]{0,80}?!e\.shiftKey/);
    expect(b).toMatch(/e\.shiftKey &&\s+e\.key\.toLowerCase\(\) === "z"/);
  });

  it("re-subscribes when the onSaveAs identity changes (no stale accelerator)", () => {
    expect(APP_SRC).toMatch(
      /\[onOpenClick, closeTab, onSave, onSaveAs, onUndo, onRedo, onOcrClick, tabs\.activeId, activeTabHasDocument, disarmEditTools\]/,
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
  // DEF-623 — a stylesheet comment can carry the marker text before the real
  // media rule (the R06 brand comment names the 900px band), so match on a
  // comment-stripped copy exactly like `cssRuleBody` above; the previous
  // comment-blind `indexOf` resolved to the comment's following rule body.
  const stripped = CSS_SRC.replace(/\/\*[\s\S]*?\*\//g, "");
  const idx = stripped.indexOf(marker);
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
// ADV-128 / DEF-428 (repointed by Phase 72) — with many tabs, shrinking the
// window used to re-trigger the active-tab reveal on the strip's measure /
// ResizeObserver path. Phase 72 (commit 21b0922, item 8) RETIRED that path:
// the ResizeObserver re-measures only to re-plan the uniform fit width
// (`--tf-tab-width`), never to scroll. A width change must NOT produce a
// reveal, and every tab — the active one included — stays rendered in the one
// row.
// ---------------------------------------------------------------------------
describe("DEF-428 — a strip width change does not reveal (Phase 72 retired the scroll)", () => {
  const RESIZE_TABS = [
    { id: "a", title: "a.pdf", modified: false },
    { id: "b", title: "b.pdf", modified: false },
  ];

  it("the measure path re-plans the fit width instead of scrolling", () => {
    const source = readFileSync("src/renderer/components/DocumentRail.tsx", "utf8");
    expect(source).not.toContain("scrollIntoView");
    expect(source).not.toContain("scrollLeft +=");
    // The ResizeObserver re-measure writes the uniform fit custom property,
    // never a scroll offset.
    expect(source).toContain("ResizeObserver");
    expect(source).toContain("--tf-tab-width");
  });

  it("keeps every tab (active included) rendered in the strip", () => {
    const host = renderRail({ activeId: "b", tabs: RESIZE_TABS });
    try {
      expect(host.querySelectorAll(".tab")).toHaveLength(2);
      expect(host.querySelector(".tab-active")?.getAttribute("data-tab-id")).toBe("b");

      // A width-stress re-render with more tabs still keeps the one row and
      // the same active marker — nothing is orphaned off-strip.
      const stressed = renderRail({
        activeId: "b",
        tabs: [...RESIZE_TABS, { id: "c", title: "c.pdf", modified: false }],
      });
      try {
        expect(stressed.querySelectorAll(".tab")).toHaveLength(3);
        expect(stressed.querySelector(".tab-active")?.getAttribute("data-tab-id")).toBe("b");
      } finally {
        stressed.remove();
      }
    } finally {
      host.remove();
    }
  });
});
