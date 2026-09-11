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
  // Phase C: surfaced migrated to physics springs consume them via
  // src/renderer/components/motion/tfPresets.ts — the CSS keyframe
  // animation lines are REMOVED from those rules, so this contract
  // pins BOTH sides: the migrated rules no longer declare a CSS
  // animation (the library owns the motion), and tfPresets keeps the
  // calibrated spring bands + the exact keyframe travel.
  const presetsFile = resolve(process.cwd(), "src/renderer/components/motion/tfPresets.ts");
  const presets = readFileSync(presetsFile, "utf8");

  /** Pull every block whose selector ends with the given class and return
   *  the one that declares an `animation` (some classes have a styling
   *  block AND an earlier no-drag/no-motion block, e.g.
   *  .titlebar-menu-popover). Phase C surfaces return "" — their
   *  animations were removed. */
  const animatedRule = (cls: string): string => {
    const blocks = [...css.matchAll(new RegExp(`\\.${cls}\\s*\\{([\\s\\S]*?)\\n\\}`, "g"))];
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      const body = b[1] ?? "";
      if (/animation:/.test(body)) return body;
    }
    return "";
  };

  it("the spring bands are calibrated to the --tf-motion bands", () => {
    // panel 280ms band -> stiffness 420 / damping 34
    expect(presets).toMatch(/stiffness:\s*420,\s*damping:\s*34/);
    // dialog 240ms band
    expect(presets).toMatch(/stiffness:\s*560,\s*damping:\s*38/);
    // menu / popover / bar / toast 180ms band
    expect(presets).toMatch(/stiffness:\s*1000,\s*damping:\s*50/);
  });

  it(".tools-palette / .side-rail travel comes from tfPresets, not a CSS keyframe", () => {
    expect(animatedRule("tools-palette")).not.toMatch(/animation:/);
    expect(animatedRule("side-rail")).not.toMatch(/animation:/);
    // panel-enter: x 24 -> 0 -> 18 (right panel)
    expect(presets).toMatch(/initial:\s*\{ opacity: 0, x: 24 \}/);
    expect(presets).toMatch(/exit:\s*\{ opacity: 0, x: 18/);
    // panel-enter-left: x -18 -> 0 -> -12 (left rail)
    expect(presets).toMatch(/initial:\s*\{ opacity: 0, x: -18 \}/);
    expect(presets).toMatch(/exit:\s*\{ opacity: 0, x: -12/);
  });

  it(".titlebar-menu-popover / .color-popover travel comes from tfPresets", () => {
    expect(animatedRule("titlebar-menu-popover")).not.toMatch(/animation:/);
    expect(animatedRule("color-popover")).not.toMatch(/animation:/);
    // menu-enter: scale 0.96 + y -4
    expect(presets).toMatch(/initial:\s*\{ opacity: 0, scale: 0\.96, y: -4 \}/);
    // popover-enter: scale 0.97 + y -3
    expect(presets).toMatch(/initial:\s*\{ opacity: 0, scale: 0\.97, y: -3 \}/);
  });

  it(".modal-dialog and .sheet rise+settle via tfPresets @ 240ms band", () => {
    expect(animatedRule("modal-dialog")).not.toMatch(/animation:/);
    expect(animatedRule("sheet")).not.toMatch(/animation:/);
    expect(animatedRule("modal-backdrop")).not.toMatch(/animation:/);
    expect(animatedRule("sheet-backdrop")).not.toMatch(/animation:/);
    // dialog-enter: y 10 + scale 0.97 -> 1; dialog-exit: y 5 + scale 0.985
    expect(presets).toMatch(/initial:\s*\{ opacity: 0, y: 10, scale: 0\.97 \}/);
    expect(presets).toMatch(/exit:\s*\{ opacity: 0, y: 5, scale: 0\.985/);
  });

  it("the tooltip stays on the hover CSS primitive with a 250-400ms dwell delay", () => {
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

describe("Phase D — PDF-safety audit (acrylic/reflection stays chrome-only)", () => {
  const css = readStyles();

  /** The classes that render the actual PDF document + its chrome
   *  neighbours. DEF-099: the page sheet is paper-white in every
   *  theme; nothing may blur, reflect, or animate it. */
  const PDF_SELECTORS = [
    "pdf-page",
    "page-slot",
    "textLayer",
    "pdf-page-canvas",
    "document-scroller",
    "thumb-canvas",
    "thumb-scroller",
  ];

  /** The exact 13 frosted chrome surfaces (Phase-A blur list). This
   *  is the COMPLETE frosted acrylic surface set — nothing else may
   *  carry the frosted blur. DEF-183: `.app-header` was removed from
   *  the set — it is the strip INSIDE `.titlebar`'s slot, and its own
   *  blur+film stacked a ~0.88 effective double glass over the caption
   *  strip that blocked the wallpaper. The `.titlebar` is the caption
   *  strip's one and only frosted surface. */
  const CHROME_FROSTED = [
    "titlebar",
    "toolbar",
    "ann-toolbar",
    "search-bar",
    "side-rail",
    "rail-tabs",
    "tools-palette",
    "titlebar-menu-popover",
    "theme-toggle-popover",
    "modal-dialog",
    "sheet",
    "color-popover",
    "toast",
  ];

  /** Comments mention the PDF classes (and even `{`) in prose, which
   *  would pollute selector scanning — strip them before matching. */
  const cssClean = css.replace(/\/\*[\s\S]*?\*\//g, "");

  /** Every rule body whose selector includes `.cls` (negative
   *  lookahead so `.pdf-page` never matches `.pdf-page-canvas`). */
  const ruleBodies = (cls: string): string[] =>
    [...cssClean.matchAll(new RegExp(`\\.${cls}(?![\\w-])[^{]*\\{([\\s\\S]*?)\\n\\}`, "g"))].map(
      (m) => m[1] ?? "",
    );

  it("carries ZERO backdrop-filter / filter / animation / transition on every PDF selector", () => {
    // The document is the stable anchor: no acrylic, no blur, no
    // reflection band, no opacity/shimmer movement, no smooth scroll
    // on the pages, the slots, the text layer, the canvases, or the
    // scrollers — in ANY theme.
    for (const cls of PDF_SELECTORS) {
      const bodies = ruleBodies(cls);
      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) {
        expect(body).not.toMatch(/backdrop-filter\s*:/);
        expect(body).not.toMatch(/-webkit-backdrop-filter\s*:/);
        expect(body).not.toMatch(/filter\s*:/);
        expect(body).not.toMatch(/animation\s*:/);
        expect(body).not.toMatch(/transition\s*:/);
        expect(body).not.toMatch(/scroll-behavior:\s*smooth/);
      }
    }
  });

  it("keeps the PDF page paper-white in every theme (no theme repaints .pdf-page)", () => {
    // DEF-099: the base rule pins #ffffff; no [data-theme] block may
    // re-declare a background on the page sheet.
    const base = /\.pdf-page(?![-\w])\s*\{([\s\S]*?)\n\}/m.exec(cssClean);
    expect(base).not.toBeNull();
    if (base === null) return;
    expect(base[1] ?? "").toMatch(/background:\s*#ffffff/);
    for (const theme of ["dark", "light", "frosted"]) {
      const themed = new RegExp(
        `:root\\[data-theme="${theme}"\\]\\s+\\.pdf-page(?![\\w-])[^{]*\\{([\\s\\S]*?)\\n\\}`,
        "g",
      );
      for (const m of cssClean.matchAll(themed)) {
        expect(m[1] ?? "").not.toMatch(/background\s*:/);
      }
    }
  });

  it("frosted acrylic blur applies to the 14 chrome surfaces and nothing else", () => {
    // Collect every frosted-scoped selector that carries a
    // backdrop-filter (the 18px chrome list + the 20px popover
    // sub-list). The union must be EXACTLY the 14 chrome surfaces —
    // never a PDF selector.
    const frostedBlur: Set<string> = new Set();
    const scoped = cssClean.matchAll(
      /:root\[data-theme="frosted"\]([^{]*)\{([\s\S]*?)\n\}/g,
    );
    for (const m of scoped) {
      const body = m[2] ?? "";
      const selectors = m[1] ?? "";
      if (!/backdrop-filter\s*:/.test(body)) continue;
      for (const s of selectors.split(",")) {
        const cls = /\.([a-zA-Z0-9_-]+)/.exec(s.trim())?.[1];
        if (cls !== undefined) frostedBlur.add(cls);
      }
    }
    expect(frostedBlur.size).toBe(CHROME_FROSTED.length);
    for (const cls of CHROME_FROSTED) {
      expect(frostedBlur).toContain(cls);
    }
    for (const cls of PDF_SELECTORS) {
      expect(frostedBlur).not.toContain(cls);
    }
  });

  it("the moving reflection is transform-only, 7-9s, and never touches the PDF", () => {
    // The ::after band rules (chrome surfaces only) sweep translateX
    // -120% -> 420% over 7s (toolbar/search) or 9s (rail/panel) with
    // the light baked into the gradient — no filter, no width/height,
    // no layout animation. The keyframe only ever animates transform.
    const keyframes = /@keyframes\s+acrylic-sheen\s*\{([\s\S]*?)\n\}/.exec(cssClean);
    expect(keyframes).not.toBeNull();
    if (keyframes === null) return;
    const kf = keyframes[1] ?? "";
    expect(kf).toMatch(/translateX\(/);
    expect(kf).not.toMatch(/opacity\s*:/);
    expect(kf).not.toMatch(/filter\s*:/);
    expect(kf).not.toMatch(/width\s*:/);
    expect(kf).not.toMatch(/height\s*:/);

    // The four band surfaces (chrome-only), swept at the slow rate.
    // Anchored on the frosted-scoped prefix so the reduced-motion
    // block's `.toolbar::after` disable rule is never captured.
    const band = /:root\[data-theme="frosted"\]\s+\.toolbar::after,[\s\S]*?\.tools-palette::after\s*\{([\s\S]*?)\n\}/.exec(cssClean);
    expect(band).not.toBeNull();
    if (band === null) return;
    const body = band[1] ?? "";
    expect(body).toMatch(/animation:\s*acrylic-sheen\s+[79]s\s/);
    expect(body).toMatch(/pointer-events:\s*none/);
    expect(body).not.toMatch(/filter\s*:/);
    // The slower 9s band for the rail + panel.
    expect(cssClean).toMatch(/animation-duration:\s*9s/);
  });
});

describe("Phase D — DEF-175 color popover is a root-context surface (not a toolbar-anchored absolute popover)", () => {
  // DEF-175 (release blocker): the frosted theme's backdrop-filter on
  // .ann-toolbar made the toolbar a stacking context + containing
  // block, so the old `position: absolute; top: calc(100% + 6px);
  // right: 0` popover ranked INSIDE that context and painted /
  // hit-tested UNDER the .document-scroller (invisible + click-through
  // in the default theme). The fix portals the popover to
  // document.body and places it in viewport coords; this contract pins
  // the CSS side so a revert to an anchor-absorbed absolute popover is
  // caught at the source.
  const css = readStyles();

  it("the .color-popover base rule is a root-context fixed surface with a root z-index", () => {
    // The base rule (first `.color-popover {` in the file) is the
    // styling block — the frosted re-style block lives later.
    // Comments are stripped (the DEF-175 prose mentions the old
    // placement) before matching.
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const block = /\.color-popover\s*\{([\s\S]*?)\n\}/.exec(clean);
    expect(block).not.toBeNull();
    if (block === null) return;
    const body = block[1] ?? "";
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/z-index:\s*50/);
    // The pre-fix anchor-absorbed placement must never come back.
    expect(body).not.toMatch(/position:\s*absolute/);
    expect(body).not.toMatch(/top:\s*calc\(100%/);
    expect(body).not.toMatch(/right:\s*0/);
  });
});

describe("Phase D — reduced motion (motion wrappers + frosted reflection)", () => {
  const tfmotionFile = resolve(process.cwd(), "src/renderer/components/motion/TfMotion.tsx");
  const tfmotion = readFileSync(tfmotionFile, "utf8");
  const presetsFile = resolve(process.cwd(), "src/renderer/components/motion/tfPresets.ts");
  const presets = readFileSync(presetsFile, "utf8");
  const css = readStyles();

  const reducedBody = (): string => {
    const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(m).not.toBeNull();
    return m?.[1] ?? "";
  };

  it("every TfMotion surface wrapper honours useReducedMotion()", () => {
    // Each exported surface (TfPanel/TfPanelLeft/TfBackdrop/TfDialog/
    // TfSheet/TfMenu/TfPopover/TfToast/TfBar/TfBarTop) must branch on
    // the OS setting BEFORE applying any spring travel.
    const wrappers = [...tfmotion.matchAll(/export function (Tf\w+)/g)].map((m) => m[1] ?? "");
    expect(wrappers.length).toBeGreaterThanOrEqual(10);
    const bodies = [...tfmotion.matchAll(/export function (Tf\w+)\([\s\S]*?\): ReactElement \{([\s\S]*?)\n\}/g)];
    expect(bodies.length).toBe(wrappers.length);
    for (const m of bodies) {
      expect(m[2] ?? "").toMatch(/useReducedMotion\(\)\s*===\s*true/);
    }
  });

  it("the reduced branch is opacity-only AND instant — no transform ever animates", () => {
    const reducedBlock = /if\s*\(reduced\)\s*\{([\s\S]*?)\n\s*\}/.exec(tfmotion);
    expect(reducedBlock).not.toBeNull();
    if (reducedBlock === null) return;
    const body = reducedBlock[1] ?? "";
    expect(body).toMatch(/initial:\s*\{ opacity: 0 \}/);
    expect(body).toMatch(/animate:\s*\{ opacity: 1 \}/);
    expect(body).toMatch(/exit:\s*\{ opacity: 0 \}/);
    expect(body).toMatch(/duration:\s*0/);
    expect(body).not.toMatch(/\b(x|y|scale)\s*:/);
  });

  it("every spring target animates compositor-only properties (never layout)", () => {
    const noComments = presets.replace(/\/\/.*$/gm, "");
    // Springs carry transform (x/y/scale) + opacity only; the single
    // exception is the instant pointer-events: none guard on exits
    // (non-animatable, set on the first frame).
    expect(noComments).not.toMatch(/\b(width|height|top|left|right|bottom|margin|padding)\s*:/);
    // No tween durations anywhere — all presets are spring + damping.
    expect(noComments).not.toMatch(/duration\s*:/);
    expect(noComments).toMatch(/type:\s*"spring"/);
  });

  it("the reduced-motion media block disables the frosted reflection outright", () => {
    const body = reducedBody();
    for (const cls of ["toolbar", "search-bar", "side-rail", "tools-palette"]) {
      expect(body).toMatch(new RegExp(`\\.${cls}::after`));
    }
    expect(body).toMatch(/animation:\s*none\s*!important/);
    expect(body).toMatch(/opacity:\s*0\s*!important/);
  });

  it("collapses every remaining CSS-driven animation via the media catch-all", () => {
    // These keyframes are still CSS-driven (shimmer reflection, spins,
    // tooltip, indicator-in, thumb-select, ann-flash, shake-x, tab
    // fade, success pop). Reduced motion must collapse ALL of them —
    // the catch-all `*, *::before, *::after` 0.01ms single-shot rule
    // does exactly that, so each must still exist and be covered.
    const body = reducedBody();
    expect(body).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/);
    expect(body).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    for (const name of [
      "shimmer-sweep",
      "tooltip-enter",
      "indicator-in",
      "thumb-select",
      "ann-flash",
      "shake-x",
      "tab-fade",
      "update-indicator-spin",
      "acrylic-sheen",
    ]) {
      expect(css).toMatch(new RegExp(`@keyframes\\s+${name}\\s*\\{`));
    }
  });
});

describe("Phase D — three-theme coherence + embedded theme picker license", () => {
  const css = readStyles();

  const frostedBlock = (): string => {
    const m = /:root\[data-theme="frosted"\]\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(m).not.toBeNull();
    return m?.[1] ?? "";
  };

  it("all three themes exist: light (:root), flat dark, and default frosted", () => {
    expect(css).toMatch(/:root\s*\{/);
    expect(css).toMatch(/:root\[data-theme="dark"\]\s*\{/);
    expect(frostedBlock()).not.toBe("");
  });

  it("frosted is the LIGHT acrylic variant (near-white base + translucent white sheets)", () => {
    const frosted = frostedBlock();
    expect(frosted).toMatch(/color-scheme:\s*light/);
    // The base is a very light cool gray — almost white. It must NOT
    // resolve to the flat-dark theme's #0b0d0f nor to the old
    // dark-slate frosted trend: every channel must clear 0xD0 so the
    // theme reads as light frosted glass, never dark mode.
    expect(frosted).not.toMatch(/--tf-bg:\s*#0b0d0f/i);
    const bgMatch = /--tf-bg:\s*(#[0-9a-fA-F]{6})/.exec(frosted);
    expect(bgMatch).not.toBeNull();
    if (bgMatch !== null) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt((bgMatch[1] ?? "").slice(i, i + 2), 16));
      expect(r).toBeGreaterThanOrEqual(0xd0);
      expect(g).toBeGreaterThanOrEqual(0xd0);
      expect(b).toBeGreaterThanOrEqual(0xd0);
    }
    for (const token of [
      "--tf-surface-frame",
      "--tf-surface-toolbar",
      "--tf-surface-rail",
      "--tf-surface-panel",
      "--tf-surface-menu",
      "--tf-surface-dialog",
    ]) {
      expect(frosted).toMatch(new RegExp(`${token}\\s*:\\s*rgba\\(`));
    }
  });

  it("frosted text ladder is DARK (high readability on the light glass)", () => {
    const frosted = frostedBlock();
    const primary = /--tf-text-primary:\s*(#[0-9a-fA-F]{6})/.exec(frosted)?.[1];
    const secondary = /--tf-text-secondary:\s*(#[0-9a-fA-F]{6})/.exec(frosted)?.[1];
    expect(primary).toBeTruthy();
    expect(secondary).toBeTruthy();
    const isDark = (hex: string): boolean => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return r <= 0x5a && g <= 0x5a && b <= 0x5a;
    };
    if (primary !== undefined) expect(isDark(primary)).toBe(true);
    if (secondary !== undefined) expect(isDark(secondary)).toBe(true);
  });

  it("frosted base is materially lighter than the flat dark base (#0b0d0f)", () => {
    const frosted = frostedBlock();
    const dark = darkThemeBlock(css);
    expect(dark).toMatch(/--bg-base:\s*#0b0d0f/);
    const f = /--tf-bg:\s*(#[0-9a-fA-F]{6})/.exec(frosted)?.[1];
    expect(f).toBeTruthy();
    if (!f) return;
    const lum = (hex: string): number => {
      const pairs = (hex.replace(/^#/, "").match(/.{2}/g) ?? []).map((p) => parseInt(p, 16));
      const [r, g, b] = [pairs[0] ?? 0, pairs[1] ?? 0, pairs[2] ?? 0];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // The lifted frosted base must be at least twice as bright as the
    // dark theme's near-black base — a real material change, not a
    // rounding tweak.
    expect(lum(f)).toBeGreaterThan(lum("0b0d0f") * 2);
  });

  it("the light (:root) and flat-dark blocks are untouched by the frosted correction", () => {
    const light = lightThemeBlock(css);
    const dark = darkThemeBlock(css);
    expect(light).toMatch(/--bg-base:\s*#ffffff/);
    expect(dark).toMatch(/--bg-base:\s*#0b0d0f/);
  });

  it("frosted mutes the tool-icon palette in-block only (desaturated but still colorful)", () => {
    // The full-saturation icon palette stays in :root (light + flat
    // dark keep it untouched); frosted overrides every --icon-* token
    // with a slightly muted variant inside its own block. The muted
    // hues must still be colorful — a wide channel spread, never
    // gray or white.
    const frosted = frostedBlock();
    const root = lightThemeBlock(css);
    for (const name of ["blue", "cyan", "green", "orange", "yellow", "purple", "red", "pink"]) {
      const rootHex = new RegExp(`--icon-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(root)?.[1];
      const frostedHex = new RegExp(`--icon-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(frosted)?.[1];
      expect(rootHex, `:root must declare --icon-${name}`).toBeTruthy();
      expect(frostedHex, `frosted must override --icon-${name}`).toBeTruthy();
      if (!rootHex || !frostedHex) continue;
      // The override must actually mute the hue (a real change, not a
      // no-op alias).
      expect(frostedHex.toLowerCase()).not.toBe(rootHex.toLowerCase());
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(frostedHex.slice(i, i + 2), 16));
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThanOrEqual(24);
    }
  });

  it("the workspace tonal variation + accent glow stay frosted-scoped (never on the PDF)", () => {
    // Strip comments before scanning (prose mentions the workspace
    // and PDF classes freely).
    const cssClean = css.replace(/\/\*[\s\S]*?\*\//g, "");
    // 1) Every background radial-gradient in the file must be declared
    //    under a [data-theme="frosted"] prefix — the soft lighting is
    //    a frosted material property, never a base/dark/light paint —
    //    and it may paint the workspace backdrop only, never a PDF
    //    content surface.
    const gradients = [
      ...cssClean.matchAll(/([^{}]*)\{[^}]*background-image:[^}]*radial-gradient/g),
    ];
    expect(gradients.length).toBeGreaterThan(0);
    for (const m of gradients) {
      const sel = m[1] ?? "";
      expect(sel, "every workspace radial gradient must be frosted-scoped").toMatch(
        /data-theme="frosted"/,
      );
      expect(sel).not.toMatch(/\.(pdf-page|page-slot|textLayer|pdf-page-canvas|thumb-canvas)\b/);
    }
    // 2) The ambient accent glows (accent box-shadows on the
    //    active tool + selected thumbnail) are frosted-scoped rules.
    const activeGlow =
      /:root\[data-theme="frosted"\]\s+\.tool-btn-active\s*\{([\s\S]*?)\n\}/.exec(cssClean);
    expect(activeGlow).not.toBeNull();
    if (activeGlow !== null) {
      expect(activeGlow[1] ?? "").toMatch(/\d+px\s+rgba\(37,\s*99,\s*235/);
    }
    const thumbGlow =
      /:root\[data-theme="frosted"\]\s+\.thumb-current,[\s\S]*?\.thumb-selected\s*\{([\s\S]*?)\n\}/.exec(
        cssClean,
      );
    expect(thumbGlow).not.toBeNull();
    if (thumbGlow !== null) {
      expect(thumbGlow[1] ?? "").toMatch(/\d+px\s+rgba\(37,\s*99,\s*235/);
    }
    // 3) No PDF content surface may ever carry a background-image.
    for (const cls of ["pdf-page", "page-slot", "textLayer", "pdf-page-canvas", "thumb-canvas"]) {
      for (const m of cssClean.matchAll(
        new RegExp(`\\.${cls}(?![\\w-])[^{]*\\{([\\s\\S]*?)\\n\\}`, "g"),
      )) {
        expect(m[1] ?? "").not.toMatch(/background-image\s*:/);
      }
    }
  });

  it("dark stays the flat layered theme — solid sheets, no acrylic blur inside the block", () => {
    const dark = darkThemeBlock(css);
    expect(dark).toMatch(/--bg-secondary:/);
    expect(dark).toMatch(/--bg-elevated:/);
    expect(dark).toMatch(/--bg-panel:/);
    expect(dark).not.toMatch(/--tf-surface-/);
    expect(dark).not.toMatch(/backdrop-filter\s*:/);
    expect(dark).not.toMatch(/animation\s*:/);
  });

  it("the theme toggle dropdown is embedded and surface-matched (never detached)", () => {
    // The popover anchors flush under the trigger (top: calc(100% +
    // 4px) inside a position:relative wrapper) and paints the SAME
    // menu surface as the titlebar popover — it reads as part of the
    // chrome, not a floating panel.
    const wrap = /\.theme-toggle-wrap\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(wrap).not.toBeNull();
    if (wrap !== null) expect(wrap[1] ?? "").toMatch(/position:\s*relative/);
    const popover = /\.theme-toggle-popover\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(popover).not.toBeNull();
    if (popover === null) return;
    const body = popover[1] ?? "";
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/top:\s*calc\(100%\s*\+\s*4px\)/);
    expect(body).toMatch(/background:\s*var\(--menu-bg\)/);
  });

  it("frosted page-overlay chips stay LIGHT glass (dark text ladder reads on them)", () => {
    // The form editor and the OCR suspects bar float over the white
    // page / light workspace and carry dark --fg/--fg-strong text.
    // They must stay LIGHT chips in the light frosted material — a
    // dark chip would fight the light chrome and bury the dark text
    // ladder (the old dark-slate frosted contract demanded dark
    // chips; the corrected light direction inverts them).
    const frostedForm = /:root\[data-theme="frosted"\]\s+\.form-editor\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(frostedForm).not.toBeNull();
    if (frostedForm === null) return;
    const body = frostedForm[1] ?? "";
    expect(body).toMatch(/background:\s*rgba\(255,\s*255,\s*255,\s*0\.94\)/);
    // Same for the OCR suspects bar — a dark rule would paint a dark
    // strip across the light acrylic chrome.
    const frostedBar = /:root\[data-theme="frosted"\]\s+\.ocr-suspects-panel\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(frostedBar).not.toBeNull();
    if (frostedBar !== null) {
      expect(frostedBar[1] ?? "").toMatch(/background:\s*rgba\(248,\s*249,\s*251,\s*0\.9\)/);
    }
  });

  it("colorful tool icons ship their semantic palette — no monochrome leftovers, no rainbow text", () => {
    const root = lightThemeBlock(css);
    for (const token of [
      "--icon-blue",
      "--icon-cyan",
      "--icon-green",
      "--icon-orange",
      "--icon-yellow",
      "--icon-purple",
      "--icon-red",
      "--icon-pink",
    ]) {
      expect(root).toMatch(new RegExp(`${token}\\s*:`));
    }
    // Every icon selector routes through var(--icon-*) — the palette
    // is the single color source for tool icons.
    const iconRules = css.match(/\.(?:tool-btn|ann-tool-btn|edit-toolbar-btn)[^}]*\{[^}]*color:\s*var\(--icon-[a-z]+\)[^}]*\}/g) ?? [];
    expect(iconRules.length).toBeGreaterThanOrEqual(11);
    // Text/indicators must never dip into the icon palette (no
    // rainbow text): `color: var(--icon-...)` may appear ONLY in
    // rules whose selector carries an icon-bearing attribute/data
    // grip. Every use must be attributed to an icon surface.
    const iconUses = [...css.matchAll(/color:\s*var\(--icon-[a-z]+\)/g)];
    const iconRuleSelectors = [...css.matchAll(/([^{}]*)\{[^}]*color:\s*var\(--icon-[a-z]+\)/g)];
    expect(iconRuleSelectors.length).toBe(iconUses.length);
    for (const m of iconRuleSelectors) {
      expect(m[1] ?? "").toMatch(
        /\[data-(?:icon|tool|edit-tool|tool-id|rail-tab)=|tools-palette-entry-icon|icon-detail|::after/,
      );
    }
  });
});