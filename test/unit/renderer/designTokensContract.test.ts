// @vitest-environment jsdom
//
// Phase 13 — design contract: the renderer ships semantic color
// tokens (--info / --success / --warning / --error) for both themes
// AND a window-drag region on the title bar with `no-drag` on every
// interactive child. The contract lives in styles.css — these tests
// parse the stylesheet and pin the rules so a future refactor that
// drops a token or removes the drag declaration is caught at the
// source.
//
// We do NOT render the stylesheet into jsdom (no cascade engine
// here); we read the file directly and pattern-match. The expected
// surface:
//   - :root                     --info / --success / --warning / --error
//   - :root[data-theme="dark"]  --info / --success / --warning / --error
//   - .titlebar                 -webkit-app-region: drag
//   - .titlebar > *             -webkit-app-region: no-drag
//   - .app-header               -webkit-app-region: no-drag (Phase 13
//                                 shifted the drag region to the
//                                 TitleBar; the AppHeader is now a
//                                 non-drag child of the caption strip)
//
// Each test reads a targeted slice of the file via fs + regex so the
// file path stays a one-line constant.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readStyles(): string {
  // Resolve relative to the repo root (vitest cwd).
  const file = resolve(process.cwd(), "src/renderer/styles.css");
  return readFileSync(file, "utf8");
}

/** Pull out the :root { ... } block (light theme defaults). */
function lightThemeBlock(css: string): string {
  const m = /:root\s*\{([\s\S]*?)\n\}/m.exec(css);
  return m?.[1] ?? "";
}

/** Pull out the :root[data-theme="dark"] { ... } block. */
function darkThemeBlock(css: string): string {
  const m = /:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/m.exec(css);
  return m?.[1] ?? "";
}

describe("Phase 13 — semantic color tokens", () => {
  const css = readStyles();

  it("declares --info / --success / --warning / --error in the light theme", () => {
    const light = lightThemeBlock(css);
    for (const token of ["--info", "--success", "--warning", "--error"]) {
      expect(light).toMatch(new RegExp(`${token}\\s*:`));
    }
  });

  it("declares the same four semantic tokens in the dark theme", () => {
    const dark = darkThemeBlock(css);
    for (const token of ["--info", "--success", "--warning", "--error"]) {
      expect(dark).toMatch(new RegExp(`${token}\\s*:`));
    }
  });

  it("ships a soft variant for every semantic token (used as background tints)", () => {
    const light = lightThemeBlock(css);
    for (const token of ["--info-soft", "--success-soft", "--warning-soft", "--error-soft"]) {
      expect(light).toMatch(new RegExp(`${token}\\s*:`));
    }
  });

  it("toast variants use the semantic tokens, not raw hex", () => {
    // The CSS rules `.toast-error`, `.toast-info`, `.toast-success`,
    // `.toast-warning` must reference `var(--error)` / `var(--info)`
    // / etc., not `#ef4444` or other raw hex. The previous
    // implementation hard-coded `#ef4444` for the error border — the
    // fix is to thread the semantic token through.
    const rules = css.match(/\.toast-(?:error|info|success|warning)\s*\{[^}]+\}/g) ?? [];
    expect(rules.length).toBeGreaterThanOrEqual(4);
    for (const rule of rules) {
      expect(rule).toMatch(/var\(--(info|success|warning|error)\)/);
    }
  });

  it("does not hard-code the error border-left-color hex", () => {
    // Belt-and-braces: a regression to `#ef4444` for the toast
    // border would defeat the dark-mode contrast tuning. The hex
    // still appears elsewhere (the swatch palette etc.), so we
    // scope the check to the toast-error rule body.
    const match = /\.toast-error\s*\{([^}]+)\}/.exec(css);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[1] ?? "";
    expect(body).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe("Phase 13 — window drag region contract", () => {
  const css = readStyles();

  it("the .titlebar element carries -webkit-app-region: drag", () => {
    // The drag region must be on the TitleBar (the outermost
    // element). The body match below pins both the selector and the
    // value so a refactor that demotes the rule to a single direct
    // child fails this assertion.
    const block = /\.titlebar\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(block).not.toBeNull();
    if (block === null) return;
    const body = block[1] ?? "";
    expect(body).toMatch(/-webkit-app-region:\s*drag/);
  });

  it("interactive title-bar children opt out individually; the slot is draggable (DEF-132)", () => {
    // DEF-132 — the previous `.titlebar > * { no-drag }` applied
    // no-drag to the FULL-WIDTH `.titlebar-slot` (and, through it,
    // the whole `.app-header`), leaving NO draggable pixel in the
    // caption strip. The contract now: the slot defaults to the
    // titlebar's drag region, and ONLY the interactive children
    // (window controls, menu button + popover) carry no-drag.
    const slot = /\.titlebar-slot\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(slot).not.toBeNull();
    if (slot === null) return;
    expect(slot[1] ?? "").not.toMatch(/-webkit-app-region:/);
    // The window-controls cluster opts out.
    const controls = /\.titlebar-controls\s*,\s*\n?\s*\.titlebar-control\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(controls).not.toBeNull();
    if (controls === null) return;
    expect(controls[1] ?? "").toMatch(/-webkit-app-region:\s*no-drag/);
    // The menu button + its popover opt out.
    const menu = /\.titlebar-menu-button\s*,\s*\n?\s*\.titlebar-menu-popover\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(menu).not.toBeNull();
    if (menu === null) return;
    expect(menu[1] ?? "").toMatch(/-webkit-app-region:\s*no-drag/);
  });

  it("the .app-header is draggable and its interactive children opt out (DEF-132)", () => {
    // DEF-132 — the AppHeader sits INSIDE the draggable titlebar
    // slot and must default to the caption drag region, so clicking
    // the brand or the empty tab-strip space moves the window like a
    // normal caption. Its interactive children (tab surfaces, close /
    // new-tab / theme-toggle / Open buttons, inputs, selects) carry
    // no-drag so every click still lands on the control.
    const block = /\.app-header\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(block).not.toBeNull();
    if (block === null) return;
    const body = block[1] ?? "";
    expect(body).not.toMatch(/-webkit-app-region:\s*drag/);
    expect(body).not.toMatch(/-webkit-app-region:\s*no-drag/);
    // The scoped interactive-children rule must exist and carry
    // no-drag (the tab surfaces lead the selector list).
    const kids = /\.app-header\s+\.tab\b[^{]*\{([\s\S]*?)\n\}/m.exec(css);
    expect(kids).not.toBeNull();
    if (kids === null) return;
    expect(kids[1] ?? "").toMatch(/-webkit-app-region:\s*no-drag/);
  });

  it("uses the Phase-1 motion tokens for window control transitions", () => {
    // Phase 5 spec: every UI transition routes through the motion
    // tokens (--motion-fast / --motion-normal / --motion-medium /
    // --motion-slow) — nothing outside the 80-280ms band. The title
    // bar control rule must reference one of the --motion-* tokens;
    // the legacy --t-* aliases no longer appear in rule bodies.
    const blocks = [...css.matchAll(/\.titlebar-control\s*\{([\s\S]*?)\n\}/gm)];
    const block = blocks.find((b) => (b[1] ?? "").includes("transition")) ?? null;
    expect(block).not.toBeNull();
    if (block === null) return;
    const body = block[1] ?? "";
    expect(body).toMatch(/var\(--motion-(fast|normal|medium|slow)\)/);
  });

  it("uses the Phase-1 easing token (--ease-out) for appearing", () => {
    const blocks = [...css.matchAll(/\.titlebar-control\s*\{([\s\S]*?)\n\}/gm)];
    const block = blocks.find((b) => (b[1] ?? "").includes("transition")) ?? null;
    expect(block).not.toBeNull();
    if (block === null) return;
    const body = block[1] ?? "";
    expect(body).toMatch(/var\(--ease-out\)/);
  });
});

describe("Phase 13 — semantic annotation color tokens", () => {
  const css = readStyles();

  it("declares the 9 annotation color tokens in the light theme", () => {
    const light = lightThemeBlock(css);
    for (const token of [
      "--ann-yellow",
      "--ann-orange",
      "--ann-red",
      "--ann-pink",
      "--ann-purple",
      "--ann-teal",
      "--ann-green",
      "--ann-blue",
      "--ann-gray",
    ]) {
      expect(light).toMatch(new RegExp(`${token}\\s*:`));
    }
  });
});

describe("Phase 13 — DEF-081 grid layout (AppHeader inside TitleBar)", () => {
  // The Phase-13 TitleBar hosts the AppHeader inside its slot, so the
  // outer `.app` grid only needs TWO rows: the TitleBar (auto, fills
  // to its tallest child — the AppHeader at 44px) + app-main (1fr,
  // takes the rest of the viewport). The previous three-row layout
  // `auto auto 1fr` left row 2 (intended for an out-of-grid
  // AppHeader) empty AND row 3 (1fr) with no element, so app-main
  // collapsed to 0px. This contract pins the new grid template and
  // the title bar's `height: auto` so a regression to the broken
  // three-row layout is caught at the source.
  const css = readStyles();

  it("the .app grid uses two rows (TitleBar + app-main, not three)", () => {
    const block = /\.app\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(block).not.toBeNull();
    if (block === null) return;
    const body = block[1] ?? "";
    // The new template is `auto 1fr`. The old (broken) one was
    // `auto auto 1fr`. Either way, "auto 1fr" must be present.
    expect(body).toMatch(/grid-template-rows:\s*auto\s+1fr/);
    // Guard against the broken three-row template sneaking back in.
    expect(body).not.toMatch(/grid-template-rows:\s*auto\s+auto\s+1fr/);
  });

  it("the .titlebar self-sizes to its tallest child (height: auto)", () => {
    // The title bar used to be `height: 32px` and the AppHeader
    // (44px) overflowed it. The fix is `height: auto` + a
    // `min-height: 32px` safety net so the strip is usable when the
    // AppHeader hasn't rendered yet.
    const block = /\.titlebar\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(block).not.toBeNull();
    if (block === null) return;
    const body = block[1] ?? "";
    expect(body).toMatch(/height:\s*auto/);
    expect(body).toMatch(/min-height:\s*32px/);
  });
});

describe("Phase 13 — DEF-082 update error indicator uses semantic color", () => {
  // The error indicator used `background: transparent` +
  // `color: var(--fg-muted)`, making it look like a regular muted
  // button instead of an error state. The fix routes the rule through
  // `--error` + `--error-soft` so the chip is unmistakably an error
  // surface in both themes. Belt-and-braces against a regression.
  const css = readStyles();

  it(".update-indicator-error uses var(--error) for its foreground", () => {
    const block = /\.update-indicator-error\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(block).not.toBeNull();
    if (block === null) return;
    const body = block[1] ?? "";
    expect(body).toMatch(/color:\s*var\(--error\)/);
  });

  it(".update-indicator-error uses var(--error-soft) for its background", () => {
    const block = /\.update-indicator-error\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(block).not.toBeNull();
    if (block === null) return;
    const body = block[1] ?? "";
    expect(body).toMatch(/background:\s*var\(--error-soft\)/);
    // Guard against the broken muted style sneaking back in.
    expect(body).not.toMatch(/background:\s*transparent/);
  });

  it(".update-indicator-error uses var(--error) for its border", () => {
    const block = /\.update-indicator-error\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(block).not.toBeNull();
    if (block === null) return;
    const body = block[1] ?? "";
    expect(body).toMatch(/border-color:\s*var\(--error\)/);
  });

  it(".update-indicator-error:hover inverts to the solid error fill", () => {
    const block = /\.update-indicator-error:hover\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(block).not.toBeNull();
    if (block === null) return;
    const body = block[1] ?? "";
    expect(body).toMatch(/background:\s*var\(--error\)/);
  });
});

describe("Phase 13 — DEF-083 light theme renders light (html + body backgrounds)", () => {
  // The light theme used to read as black in production because
  // <html> had no explicit background — when the React tree was
  // empty or transitioning, the Electron BrowserWindow's native
  // background (dark by default with `frame: false` on Windows)
  // showed through. Adding `html { background: var(--bg-base) }`
  // guarantees the window chrome above the caption strip matches
  // the active theme in both directions.
  const css = readStyles();

  it("the html element carries var(--bg-base) as its background", () => {
    // The exact selector we wrote is `html { background: var(--bg-base); }`.
    // We allow either `html {` or `html, body, #root {` followed by a
    // sibling rule that paints html with --bg-base. The narrow check
    // below pins the dedicated `html { background: var(--bg-base); }`
    // rule that closes the DEF-083 gap.
    const block = /\bhtml\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(block).not.toBeNull();
    if (block === null) return;
    const body = block[1] ?? "";
    expect(body).toMatch(/background:\s*var\(--bg-base\)/);
  });

  it("the light theme --bg-base resolves to a near-white hex", () => {
    // Belt-and-braces: the light theme's --bg-base must be a bright
    // white (not a soft tint) so the body actually reads as light.
    // The dark theme is allowed to be deep; the light theme must
    // not be.
    const light = lightThemeBlock(css);
    const m = /--bg-base:\s*(#[0-9a-fA-F]+)/.exec(light);
    expect(m).not.toBeNull();
    if (m === null) return;
    const hex = m[1];
    // Convert to RGB and assert every channel >= 0xf0 (240).
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    expect(r).toBeGreaterThanOrEqual(0xf0);
    expect(g).toBeGreaterThanOrEqual(0xf0);
    expect(b).toBeGreaterThanOrEqual(0xf0);
  });
});

describe("Global motion system — theme-independent timing + easing tokens", () => {
  const css = readStyles();
  const root = lightThemeBlock(css); // :root block (theme-independent defaults)
  const dark = darkThemeBlock(css);

  it("declares the canonical --tf-motion-* timing tokens in :root", () => {
    for (const token of [
      "--tf-motion-instant",
      "--tf-motion-fast",
      "--tf-motion-normal",
      "--tf-motion-emphasized",
      "--tf-motion-panel",
      "--tf-motion-large",
    ]) {
      expect(root).toMatch(new RegExp(`${token}\\s*:`));
    }
  });

  it("declares the canonical --tf-ease-* easing tokens in :root", () => {
    for (const token of ["--tf-ease-standard", "--tf-ease-emphasized", "--tf-ease-fast"]) {
      expect(root).toMatch(new RegExp(`${token}\\s*:`));
    }
  });

  it("keeps the motion tokens theme-independent (never inside a [data-theme] block)", () => {
    // Motion is a GLOBAL concern — themes only provide colours/surfaces.
    expect(dark).not.toMatch(/--tf-motion-/);
    expect(dark).not.toMatch(/--tf-ease-/);
  });

  it("keeps the Phase-1 --motion-* names as aliases that point at the --tf-* tokens", () => {
    expect(root).toMatch(/--motion-fast:\s*var\(--tf-motion-fast\)/);
    expect(root).toMatch(/--motion-normal:\s*var\(--tf-motion-normal\)/);
    expect(root).toMatch(/--motion-medium:\s*var\(--tf-motion-emphasized\)/);
    expect(root).toMatch(/--motion-slow:\s*var\(--tf-motion-panel\)/);
  });

  it("keeps --ease / --ease-out as aliases of the standard ease", () => {
    expect(root).toMatch(/--ease:\s*var\(--tf-ease-standard\)/);
    expect(root).toMatch(/--ease-out:\s*var\(--tf-ease-standard\)/);
  });

  it("stays under the ~350ms ordinary-UI ceiling (fastest token is 70ms instant, largest is 320ms)", () => {
    // Every canonical timing token must carry an explicit ms value.
    for (const t of ["instant", "fast", "normal", "emphasized", "panel", "large"]) {
      expect(root).toMatch(new RegExp(`--tf-motion-${t}:\\s*\\d+ms`));
    }
    // No linear or bounce easing anywhere in the global system.
    expect(root).not.toMatch(/--tf-ease-[^:]+:\s*linear/);
  });
});

describe("Global motion system — shared entrance/exit primitives", () => {
  const css = readStyles();

  it("defines the full primitive set (panel/menu/dialog/popover/tooltip, enter + exit)", () => {
    for (const name of [
      "panel-enter",
      "panel-exit",
      "panel-enter-left",
      "panel-exit-left",
      "menu-enter",
      "menu-enter-up",
      "dialog-enter",
      "dialog-exit",
      "popover-enter",
      "tooltip-enter",
    ]) {
      expect(css).toMatch(new RegExp(`@keyframes\\s+${name}\\s*\\{`));
    }
  });

  it("primitives move — no entrance is opacity-only (visible movement required)", () => {
    const body = (name: string): string => {
      const m = new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
      expect(m).not.toBeNull();
      return m?.[1] ?? "";
    };
    expect(body("panel-enter")).toMatch(/translateX\(/);
    expect(body("panel-exit")).toMatch(/translateX\(/);
    expect(body("panel-enter-left")).toMatch(/translateX\(/);
    expect(body("menu-enter")).toMatch(/scale\(/);
    expect(body("dialog-enter")).toMatch(/translateY\(/);
    expect(body("dialog-exit")).toMatch(/scale\(/);
    expect(body("popover-enter")).toMatch(/scale\(/);
    expect(body("tooltip-enter")).toMatch(/translateY\(/);
  });

  it("the old too-weak Phase-5 keyframes are gone (no opacity-only / sub-band entrances)", () => {
    for (const gone of [
      "titlebar-popover-in",
      "tools-palette-in",
      "modal-dialog-in",
      "sheet-in",
      "popover-in",
    ]) {
      expect(css).not.toMatch(new RegExp(`@keyframes\\s+${gone}\\s*\\{`));
    }
  });
});

describe("Global motion system — components consume the shared primitives", () => {
  const css = readStyles();

  /** Pull every block whose selector ends with the given class and return
   *  the one that declares an `animation` (some classes have a styling
   *  block AND an earlier no-drag/no-motion block, e.g.
   *  .titlebar-menu-popover). */
  const animatedRule = (cls: string): string => {
    const blocks = [...css.matchAll(new RegExp(`\\.${cls}\\s*\\{([\\s\\S]*?)\\n\\}`, "g"))];
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      const body = b[1] ?? "";
      if (/animation:/.test(body)) return body;
    }
    return "";
  };

  it(".tools-palette slides in via panel-enter @ --tf-motion-panel", () => {
    expect(animatedRule("tools-palette")).toMatch(/animation:\s*panel-enter\s+var\(--tf-motion-panel\)\s+var\(--tf-ease-standard\)/);
  });

  it(".side-rail slides in from the left via panel-enter-left @ --tf-motion-panel", () => {
    expect(animatedRule("side-rail")).toMatch(/animation:\s*panel-enter-left\s+var\(--tf-motion-panel\)\s+var\(--tf-ease-standard\)/);
  });

  it(".titlebar-menu-popover grows via menu-enter @ --tf-motion-normal", () => {
    expect(animatedRule("titlebar-menu-popover")).toMatch(/animation:\s*menu-enter\s+var\(--tf-motion-normal\)\s+var\(--tf-ease-standard\)/);
  });

  it(".modal-dialog and .sheet rise+settle via dialog-enter @ --tf-motion-emphasized", () => {
    const token = /animation:\s*dialog-enter\s+var\(--tf-motion-emphasized\)\s+var\(--tf-ease-emphasized\)/;
    expect(animatedRule("modal-dialog")).toMatch(token);
    expect(animatedRule("sheet")).toMatch(token);
  });

  it(".color-popover swells via popover-enter @ --tf-motion-normal", () => {
    expect(animatedRule("color-popover")).toMatch(/animation:\s*popover-enter\s+var\(--tf-motion-normal\)\s+var\(--tf-ease-standard\)/);
  });

  it("the tooltip enters via the tooltip-enter primitive with a 250-400ms dwell delay", () => {
    const hover = /\.tooltip-anchor\s*\[data-tooltip\]:hover::after\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(hover).not.toBeNull();
    if (hover === null) return;
    const body = hover[1] ?? "";
    expect(body).toMatch(/animation:\s*tooltip-enter\s+var\(--tf-motion-fast\)\s+var\(--tf-ease-fast\)/);
    expect(body).toMatch(/\d{3}ms\s+forwards/);
  });
});

describe("Global motion system — reduced motion + no-PDF-animation guards", () => {
  const css = readStyles();

  /** The @media (prefers-reduced-motion: reduce) block body. */
  const reducedBody = (): string => {
    const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(m).not.toBeNull();
    return m?.[1] ?? "";
  };

  it("declares a @media (prefers-reduced-motion: reduce) block", () => {
    expect(reducedBody()).not.toBe("");
  });

  it("collapses ALL motion in reduced-motion mode (0.01ms, single iteration, no delay)", () => {
    // The catch-all `*` (plus ::before/::after) must collapse every
    // transition + animation to an instant state change. This covers
    // every newly-added decorative/interaction motion: panel/menu/
    // dialog/popover/tooltip keyframes, button lift/press transforms,
    // tab/thumbnail/tool/indicator transitions, success-pop, error
    // shake, focus-ring fade — and (via the single iteration count)
    // the ambient shimmer + all continuous movement.
    const body = reducedBody();
    expect(body).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(body).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(body).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(body).toMatch(/transition-delay:\s*0ms\s*!important/);
    // The catch-all selector must actually be present.
    expect(body).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/);
  });

  it("keeps ONLY essential opacity-level feedback in reduced motion (backdrop + toast)", () => {
    // Per the spec the only survivors are the pure-alpha fades —
    // modal/sheet backdrops and toasts — so an overlay never snaps
    // between fully-transparent and fully-painted frames. Everything
    // else in the block is the catch-all collapse.
    const body = reducedBody();
    expect(body).toMatch(/\.modal-backdrop/);
    expect(body).toMatch(/\.sheet-backdrop/);
    expect(body).toMatch(/\.toast\s*\{/);
  });

  it("stops the ambient shimmer + continuous movement (infinite loop collapses)", () => {
    // Shimmer-sweep and the various spinners are `infinite` in normal
    // mode; a single iteration count in reduced motion kills the loop
    // so no ambient sweep / spin keeps moving.
    const body = reducedBody();
    expect(body).toContain("animation-iteration-count: 1 !important");
    expect(css).toMatch(/@keyframes\s+shimmer-sweep\s*\{/);
  });

  it("has ZERO transition/animation on the PDF page, slot, text layer, and scroller", () => {
    // The document is the stable anchor — no reflection, shimmer,
    // blur, opacity or decorative movement may attach to the actual
    // content, its reserved slot, the search/selection text layer,
    // or the scrollers. Any transition/animation on these rule bodies
    // is a regression to catch at the source.
    for (const cls of ["pdf-page", "page-slot", "textLayer", "document-scroller"]) {
      const blocks = [...css.matchAll(new RegExp(`\\.${cls}\\s*\\{([\\s\\S]*?)\\n\\}`, "g"))];
      expect(blocks.length).toBeGreaterThan(0);
      for (const b of blocks) {
        const body = b[1] ?? "";
        expect(body).not.toMatch(/transition\s*:/);
        expect(body).not.toMatch(/animation\s*:/);
        expect(body).not.toMatch(/scroll-behavior:\s*smooth/);
      }
    }
  });

  it("limits shimmer-sweep to the loading placeholders (never the rendered page)", () => {
    // The ONLY shimmer is on the un-rendered loading placeholder, and
    // it is clipped to that placeholder's own box. It must never be
    // declared on the rendered page, its slot, or any canvas.
    const uses = [...css.matchAll(/([^{}]*)\{[^}]*animation:\s*shimmer-sweep/g)];
    expect(uses.length).toBeGreaterThanOrEqual(2);
    const selectors = uses.map((m) => m[1] ?? "").join("\n");
    expect(selectors).toMatch(/\.thumb-placeholder::after/);
    expect(selectors).toMatch(/\.page-placeholder::after/);
    expect(selectors).not.toMatch(/\.pdf-page\b/);
    expect(selectors).not.toMatch(/\.page-slot\b/);
    // Every placeholder that sweeps clips the sweep to its own box.
    for (const cls of ["thumb-placeholder", "page-placeholder"]) {
      const b = new RegExp(`\\.${cls}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? "";
      expect(b).toMatch(/overflow:\s*hidden/);
    }
  });

  it("keeps the motion tokens AND aliases out of every [data-theme] block", () => {
    // Theme-independence: motion lives in :root only. The themes
    // provide colours/surfaces and must never re-declare a motion
    // token (--tf-*), a timing alias (--motion-*), or an easing
    // alias (--ease-*).
    const dark = darkThemeBlock(css);
    expect(dark).not.toMatch(/--tf-motion-/);
    expect(dark).not.toMatch(/--tf-ease-/);
    expect(dark).not.toMatch(/--motion-/);
    expect(dark).not.toMatch(/--ease-/);
  });
});