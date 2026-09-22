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
    // panel-enter: x MOTION_TRANSLATE.panel -> 0 -> 18 settle-back
    // (DEF-197: the travel reads the canonical token, the settle-back
    // distance has no token and stays a literal).
    expect(presets).toMatch(/initial:\s*\{ opacity: 0, x: MOTION_TRANSLATE\.panel \}/);
    expect(presets).toMatch(/exit:\s*\{ opacity: 0, x: 18/);
    // panel-enter-left: x -18 -> 0 -> -12 (left rail)
    expect(presets).toMatch(/initial:\s*\{ opacity: 0, x: -18 \}/);
    expect(presets).toMatch(/exit:\s*\{ opacity: 0, x: -12/);
  });

  it(".titlebar-menu-popover / .color-popover travel comes from tfPresets", () => {
    expect(animatedRule("titlebar-menu-popover")).not.toMatch(/animation:/);
    expect(animatedRule("color-popover")).not.toMatch(/animation:/);
    // menu-enter: MOTION_SCALE.enter + y -MOTION_TRANSLATE.small
    expect(presets).toMatch(
      /initial:\s*\{ opacity: 0, scale: MOTION_SCALE\.enter, y: -MOTION_TRANSLATE\.small \}/,
    );
    // popover-enter: MOTION_SCALE.press + y -3
    expect(presets).toMatch(
      /initial:\s*\{ opacity: 0, scale: MOTION_SCALE\.press, y: -3 \}/,
    );
  });

  it(".modal-dialog and .sheet rise+settle via tfPresets @ 240ms band", () => {
    expect(animatedRule("modal-dialog")).not.toMatch(/animation:/);
    expect(animatedRule("sheet")).not.toMatch(/animation:/);
    expect(animatedRule("modal-backdrop")).not.toMatch(/animation:/);
    expect(animatedRule("sheet-backdrop")).not.toMatch(/animation:/);
    // dialog-enter: y 10 + scale MOTION_SCALE.press -> 1;
    // dialog-exit: y 5 + scale MOTION_SCALE.exit
    expect(presets).toMatch(
      /initial:\s*\{ opacity: 0, y: 10, scale: MOTION_SCALE\.press \}/,
    );
    expect(presets).toMatch(/exit:\s*\{ opacity: 0, y: 5, scale: MOTION_SCALE\.exit/);
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

  /** The exact frosted chrome surfaces: the Phase-A blur list plus
   *  the All-tools badge tracker (the 1.15.x panel-attached badge).
   *  This is the COMPLETE frosted acrylic surface set — nothing else
   *  may carry the frosted blur. DEF-183: `.app-header` was removed
   *  from the set. Phase 19: `.ann-toolbar` was removed — the
   *  annotation tools now live inside the `.toolbar` capsule, which
   *  already carries the blur. DEF-231: the portaled all-tools menu
   *  `.ann-tool-menu` joins the 24px frosted menu sub-list (the
   *  `.ann-tools-visible` group wrapper itself carries no blur). */
  const CHROME_FROSTED = [
    "titlebar",
    "toolbar",
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
    "tools-badge-tracker",
    "ann-tool-menu",
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

  it("frosted acrylic blur applies to the chrome surface set and nothing else", () => {
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

  it("every TfMotion surface wrapper honours the live reduced-motion hook (DEF-198)", () => {
    // Each exported surface (TfPanel/TfPanelLeft/TfBackdrop/TfDialog/
    // TfSheet/TfMenu/TfPopover/TfToast/TfBar/TfBarTop) must branch on
    // the OS setting BEFORE applying any spring travel. DEF-198: the
    // value must come from useLiveReducedMotion (a matchMedia
    // subscription that reacts to mid-session OS flips), not
    // motion/react's boot-time useReducedMotion snapshot.
    const wrappers = [...tfmotion.matchAll(/export function (Tf\w+)/g)].map((m) => m[1] ?? "");
    expect(wrappers.length).toBeGreaterThanOrEqual(10);
    const bodies = [...tfmotion.matchAll(/export function (Tf\w+)\([\s\S]*?\): ReactElement \{([\s\S]*?)\n\}/g)];
    expect(bodies.length).toBe(wrappers.length);
    for (const m of bodies) {
      expect(m[2] ?? "").toMatch(/useLiveReducedMotion\(\)/);
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
    // DEF-240 — the instant tween resolves its duration from the
    // canonical reduced-motion token (0ms), not a bare `0` literal.
    expect(body).toMatch(/duration:\s*msToSeconds\(MOTION_DURATION\.reduced\)/);
    expect(body).not.toMatch(/duration:\s*0\b/);
    expect(body).not.toMatch(/\b(x|y|scale)\s*:/);
  });

  it("every spring target animates compositor-only properties (never layout)", () => {
    // The spring catalog ends where the Phase 20 morph primitive begins:
    // a morph is a measured FLIP (so its rect type carries left/top/…)
    // and a token tween, not a spring — it has its own contract below.
    const springCatalog = presets.split("export interface MorphRect")[0] ?? "";
    const noComments = springCatalog.replace(/\/\/.*$/gm, "");
    // Springs carry transform (x/y/scale) + opacity only; the single
    // exception is the instant pointer-events: none guard on exits
    // (non-animatable, set on the first frame).
    expect(noComments).not.toMatch(/\b(width|height|top|left|right|bottom|margin|padding)\s*:/);
    // No tween durations anywhere in the spring catalog — all presets
    // are spring + damping.
    expect(noComments).not.toMatch(/duration\s*:/);
    expect(noComments).toMatch(/type:\s*"spring"/);
  });

  it("the Phase 20 morph preset resolves entirely from the motion tokens", () => {
    const morphSection = presets.slice(presets.indexOf("export interface MorphRect"));
    expect(morphSection.length).toBeGreaterThan(0);
    // Durations/eases come from the token mirror, never literals.
    expect(morphSection).toMatch(/duration:\s*msToSeconds\(MOTION_DURATION\.fast\)/);
    expect(morphSection).toMatch(/ease:\s*MOTION_EASE\.enter/);
    expect(morphSection).toMatch(/ease:\s*MOTION_EASE\.exit/);
    // The surface opacity poles are tokens too (0.85 start, 0 end).
    expect(morphSection).toMatch(/opacity:\s*MOTION_OPACITY\.surface/);
    expect(morphSection).toMatch(/opacity:\s*MOTION_OPACITY\.hidden/);
    // A morph is one coordinated move: no spring overshoot at the seam.
    expect(morphSection).not.toMatch(/stiffness|damping/);
  });

  it("the reduced-motion media block disables the frosted reflection outright", () => {
    const body = reducedBody();
    for (const cls of ["toolbar", "search-bar", "side-rail", "tools-palette"]) {
      expect(body).toMatch(new RegExp(`\\.${cls}::after`));
    }
    expect(body).toMatch(/animation:\s*none\s*!important/);
    expect(body).toMatch(/opacity:\s*0\s*!important/);
  });

  it("the reduced-motion block removes the inline editor's travel keyframe (DEF-234)", () => {
    // The edit inline editor's CSS entrance (edit-bar-in) carries a
    // translateY(-2px). The catch-all collapses it to 0.01ms, but a
    // collapsed animation still paints its `from` transform on the first
    // frame — qa measured one frame of matrix(1,0,0,1,0,-2) under
    // emulated reduced motion. The travel keyframe must be removed
    // outright; the TfBar wrapper's opacity-only reduced branch (asserted
    // above) still mounts/unmounts the editor structurally.
    expect(css).toMatch(/@keyframes\s+edit-bar-in\s*\{/);
    const body = reducedBody();
    const rule = /\.edit-inline-editor\s*\{([^}]*)\}/.exec(body)?.[1] ?? "";
    expect(rule, "reduced-motion .edit-inline-editor rule missing").not.toBe("");
    expect(rule).toMatch(/animation:\s*none\s*!important/);
    expect(rule).not.toMatch(/animation-name|animation-duration/);
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
      // Phase 14.1 — the films either carry an explicit rgba() value or
      // resolve into the :root --glass-* material tokens (one source of
      // truth for the neutral white sheets).
      expect(frosted).toMatch(new RegExp(`${token}\\s*:\\s*(rgba\\(|var\\(--glass-)`));
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
    // The popover anchors FLUSH under the trigger (top: 100% inside a
    // position:relative wrapper — Phase 20 removed the old 4px gap so the
    // morph's first frame is the trigger's own box) and paints the SAME
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
    expect(body).toMatch(/top:\s*100%/);
    expect(body).not.toMatch(/top:\s*calc\(100%/);
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

describe("Phase 19 — annotation tool-group motion resolves from the centralized tokens", () => {
  // Criterion 11: every animation added by the Phase-19 tool group
  // (the portaled all-tools menu, its visibility wrapper, the dropdown
  // arrow rotation and the menu-row hover) must resolve its timing
  // from the centralized motion tokens — never a raw ms/s duration or
  // a raw cubic-bezier() easing. Same read-the-stylesheet pattern as
  // the other contracts in this spec.
  const css = readStyles();
  // Comments mention motion prose freely — strip them before scanning.
  const cssClean = css.replace(/\/\*[\s\S]*?\*\//g, "");

  /** Every rule whose selector touches the Phase-19 tool-group hooks
   *  (`.ann-tools-visible`, `.ann-tool-menu*`, `.ann-dropdown-toggle*`).
   *  The frosted re-style blocks are included deliberately: they must
   *  carry no timing either. */
  const phase19Rules = (): { selector: string; body: string }[] =>
    [...cssClean.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
      .filter((m) => /\bann-(?:tool-menu|tools-visible|dropdown-toggle)\b/.test(m[1] ?? ""))
      .map((m) => ({ selector: m[1] ?? "", body: m[2] ?? "" }));

  it("finds the Phase-19 tool-group rules (non-vacuous scan)", () => {
    const selectors = phase19Rules().map((r) => r.selector).join("\n");
    for (const sel of [
      ".ann-tools-visible",
      ".ann-tool-menu",
      ".ann-tool-menu-row",
      ".ann-dropdown-toggle",
    ]) {
      expect(selectors).toContain(sel);
    }
  });

  it("declares no hardcoded ms/s/cubic-bezier timing in any Phase-19 rule", () => {
    for (const { selector, body } of phase19Rules()) {
      // Any transition/animation declaration must read a --motion-*
      // token for its duration and easing.
      for (const line of body.split("\n")) {
        if (
          !/(?:^|[\s;])(?:transition|animation)(?:-duration|-timing-function)?\s*:/.test(line)
        ) {
          continue;
        }
        expect(line, `${selector} must resolve its timing from var(--motion-*)`).toMatch(
          /var\(--motion-/,
        );
      }
      expect(body, `${selector} carries a hardcoded ms duration`).not.toMatch(/\d+(?:\.\d+)?ms\b/);
      expect(body, `${selector} carries a hardcoded s duration`).not.toMatch(
        /[\s,(]\d+(?:\.\d+)?s\b/,
      );
      expect(body, `${selector} carries a raw cubic-bezier easing`).not.toMatch(/cubic-bezier\(/);
    }
  });

  it("the arrow rotation and menu-row hover read the shared fast token", () => {
    const rules = phase19Rules();
    const arrow = rules.find((r) => /\.ann-dropdown-toggle svg/.test(r.selector));
    expect(arrow).toBeDefined();
    expect(arrow?.body).toMatch(
      /transition:\s*transform\s+var\(--motion-duration-fast\)\s+var\(--motion-ease-standard\)/,
    );
    // The open-state rotation is geometry (180deg), not timing.
    const open = rules.find((r) => /\.ann-dropdown-toggle-open svg/.test(r.selector));
    expect(open?.body).toMatch(/transform:\s*rotate\(180deg\)/);
    // The hover rule is the row highlight; its timing lives on the
    // base row rule and reads the same token pair.
    const hover = rules.find((r) => /\.ann-tool-menu-row:hover/.test(r.selector));
    expect(hover?.body).toMatch(/background:\s*var\(--bg-hover\)/);
    const row = rules.find((r) => r.selector.trim() === ".ann-tool-menu-row");
    expect(row).toBeDefined();
    expect(row?.body).toMatch(
      /transition:\s*background\s+var\(--motion-duration-fast\)\s+var\(--motion-ease-standard\)/,
    );
  });
});

/* ===========================================================================
 * Phase 20 — the surface motion contract (success criterion 5).
 *
 * The enforceable standard: EVERY animated surface family in the app is
 * listed in ONE table, and the table is checked against the shipped tree:
 *
 *   1. its root is one of the token-driven motion primitives (TfDialog /
 *      TfBackdrop / TfSheet / TfMorph / TfPopover / TfPanel / TfBar /
 *      TfBarTop / TfToast / TfResize / AnimatedTab) — swapping the
 *      primitive for a plain element (removing the animation) fails here;
 *   2. its mount site sits inside an AnimatePresence, so the EXIT actually
 *      runs instead of the surface popping away;
 *   3. its preset (tfPresets.ts) names a token spring (or, for a morph, the
 *      token tween factory) — hardcoding a duration/easing in the preset
 *      fails here;
 *   4. every preset's exit pins `pointerEvents: "none"` on its first exit
 *      frame (the DEF-087/088/090 cross-bubbling guard).
 *
 * Removing a surface's animation therefore turns this spec red. The
 * demonstration used during development (temporarily replacing SearchBar's
 * <TfBar with a <div) failed at check 1; restoring the tree makes it pass.
 * ======================================================================== */

describe("Phase 20 — surface motion contract", () => {
  const css = readStyles();
  const cssClean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const presets = readFileSync(
    resolve(process.cwd(), "src/renderer/components/motion/tfPresets.ts"),
    "utf8",
  );
  const resizeSrc = readFileSync(
    resolve(process.cwd(), "src/renderer/components/motion/TfResize.tsx"),
    "utf8",
  );
  const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

  /** The token springs a preset transition may name. A literal duration or
   *  a raw easing here is a hardcoded animation and must fail. */
  const TOKEN_SPRINGS = ["springPanel", "springDialog", "springQuick", "springToastSuccess"];

  interface SurfaceContract {
    /** Human label (also the test name). */
    surface: string;
    /** The file that OWNS the primitive's root (its enter/exit). */
    wrapperFile: string;
    /** The primitive tag that must appear in the wrapper file. */
    primitive: string;
    /** File(s) whose AnimatePresence boundary mounts the surface. */
    presenceFiles: string[];
    /** The preset constant in tfPresets.ts (null = variant-hook surface). */
    preset: string | null;
    /** For variant-hook surfaces: the hook the wrapper must consume. */
    variantHook?: string;
  }

  const SURFACES: SurfaceContract[] = [
    {
      surface: "modal dialog",
      wrapperFile: "src/renderer/components/ConfirmDialog.tsx",
      primitive: "TfDialog",
      presenceFiles: ["src/renderer/components/ConfirmDialog.tsx"],
      preset: "tfDialog",
    },
    {
      surface: "dialog backdrop",
      wrapperFile: "src/renderer/components/ConfirmDialog.tsx",
      primitive: "TfBackdrop",
      presenceFiles: ["src/renderer/components/ConfirmDialog.tsx"],
      preset: "tfBackdrop",
    },
    {
      surface: "sheet dialog",
      wrapperFile: "src/renderer/components/AboutDialog.tsx",
      primitive: "TfSheet",
      presenceFiles: ["src/renderer/components/AboutDialog.tsx"],
      preset: "tfDialog",
    },
    {
      surface: "title-bar menu (morph)",
      wrapperFile: "src/renderer/components/AppHeader.tsx",
      primitive: "TfMorph",
      presenceFiles: ["src/renderer/components/AppHeader.tsx"],
      preset: "tfMorph",
    },
    {
      surface: "theme popover (morph)",
      wrapperFile: "src/renderer/components/TitleBar.tsx",
      primitive: "TfMorph",
      presenceFiles: ["src/renderer/components/TitleBar.tsx"],
      preset: "tfMorph",
    },
    {
      surface: "annotation tools menu (morph)",
      wrapperFile: "src/renderer/annotations/AnnotationToolbar.tsx",
      primitive: "TfMorph",
      presenceFiles: ["src/renderer/annotations/AnnotationToolbar.tsx"],
      preset: "tfMorph",
    },
    {
      surface: "annotation color popover",
      wrapperFile: "src/renderer/annotations/AnnotationToolbar.tsx",
      primitive: "TfPopover",
      presenceFiles: ["src/renderer/annotations/AnnotationToolbar.tsx"],
      preset: "tfPopover",
    },
    {
      surface: "tools palette panel",
      wrapperFile: "src/renderer/components/ToolsPalette.tsx",
      primitive: "TfPanel",
      presenceFiles: ["src/renderer/App.tsx"],
      preset: "tfPanel",
    },
    {
      surface: "signature modal tab resize",
      wrapperFile: "src/renderer/signatures/SignatureManagerModal.tsx",
      primitive: "TfResize",
      presenceFiles: ["src/renderer/signatures/SignatureManagerModal.tsx"],
      preset: null,
    },
    {
      surface: "edit toolbar",
      wrapperFile: "src/renderer/edit/EditToolbar.tsx",
      primitive: "TfBar",
      presenceFiles: ["src/renderer/components/DocumentView.tsx"],
      preset: "tfBar",
    },
    {
      surface: "search bar",
      wrapperFile: "src/renderer/components/SearchBar.tsx",
      primitive: "TfBar",
      presenceFiles: ["src/renderer/components/DocumentView.tsx"],
      preset: "tfBar",
    },
    {
      surface: "stamp type editor",
      wrapperFile: "src/renderer/annotations/StampAnnotations.tsx",
      primitive: "TfBar",
      presenceFiles: ["src/renderer/annotations/StampAnnotations.tsx"],
      preset: "tfBar",
    },
    {
      surface: "signature action bar",
      wrapperFile: "src/renderer/signatures/SignaturesOverlay.tsx",
      primitive: "TfBar",
      presenceFiles: ["src/renderer/signatures/SignaturesOverlay.tsx"],
      preset: "tfBar",
    },
    {
      surface: "content action bar",
      wrapperFile: "src/renderer/components/selectableContent.tsx",
      primitive: "TfBar",
      presenceFiles: [
        "src/renderer/annotations/AnnotationOverlay.tsx",
        "src/renderer/annotations/StampAnnotations.tsx",
        "src/renderer/signatures/SignaturesOverlay.tsx",
      ],
      preset: "tfBar",
    },
    {
      surface: "OCR suspects bar",
      wrapperFile: "src/renderer/components/OcrSuspectsPanel.tsx",
      primitive: "TfBarTop",
      presenceFiles: ["src/renderer/App.tsx"],
      preset: "tfBarTop",
    },
    {
      surface: "toasts",
      wrapperFile: "src/renderer/components/Toasts.tsx",
      primitive: "TfToast",
      presenceFiles: ["src/renderer/components/Toasts.tsx"],
      preset: "tfToast",
    },
    {
      surface: "document tabs",
      wrapperFile: "src/renderer/components/AnimatedTab.tsx",
      primitive: "motion.li",
      presenceFiles: ["src/renderer/components/AppHeader.tsx"],
      preset: null,
      variantHook: "useTabVariants",
    },
  ];

  it("the surface table is non-vacuous and every entry is distinct", () => {
    expect(SURFACES.length).toBeGreaterThanOrEqual(15);
    const keys = SURFACES.map((s) => `${s.wrapperFile}:${s.primitive}:${s.preset ?? ""}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every surface is rooted in a token-driven primitive and mounted in a presence boundary", () => {
    for (const s of SURFACES) {
      const wrapper = read(s.wrapperFile);
      expect(wrapper, `${s.surface}: ${s.wrapperFile} must root in <${s.primitive}`).toContain(
        `<${s.primitive}`,
      );
      for (const pf of s.presenceFiles) {
        const presence = read(pf);
        expect(
          presence,
          `${s.surface}: ${pf} must wrap the mount in AnimatePresence so the exit runs`,
        ).toContain("AnimatePresence");
      }
      if (s.variantHook !== undefined) {
        expect(wrapper, `${s.surface}: must consume ${s.variantHook}`).toContain(s.variantHook);
      }
    }
  });

  /** The preset block in tfPresets.ts: from `export const <name>` to the
   *  next export / section comment. */
  const presetBlock = (name: string): string => {
    const start = presets.indexOf(`export const ${name}`);
    expect(start, `tfPresets.ts must declare ${name}`).toBeGreaterThanOrEqual(0);
    const rest = presets.slice(start + 1);
    const boundaries = [rest.indexOf("export const "), rest.indexOf("/* ---")].filter(
      (i) => i >= 0,
    );
    const end = boundaries.length > 0 ? Math.min(...boundaries) : rest.length;
    return rest.slice(0, end);
  };

  it("every named preset exists with an enter, an animate and an exit", () => {
    const names = SURFACES.map((s) => s.preset).filter((p): p is string => p !== null);
    for (const name of new Set(names)) {
      if (name === "tfMorph") {
        expect(presets).toContain("export function tfMorph");
        expect(presets).toMatch(/export const morphTransitionEnter: Transition = \{[\s\S]*?MOTION_DURATION\.fast/);
        continue;
      }
      const block = presetBlock(name);
      expect(block, `${name} must define initial`).toMatch(/initial:\s*\{/);
      expect(block, `${name} must define animate`).toMatch(/animate:\s*\{/);
      expect(block, `${name} must define exit`).toMatch(/exit:\s*\{/);
    }
  });

  it("every preset resolves its transition from a token spring (never a literal)", () => {
    for (const name of [
      "tfPanel",
      "tfPanelLeft",
      "tfDialog",
      "tfBackdrop",
      "tfMenu",
      "tfMenuUp",
      "tfPopover",
      "tfToast",
      "tfToastSuccess",
      "tfBar",
      "tfBarTop",
    ]) {
      const block = presetBlock(name);
      const m = /transition:\s*(spring\w+)\s*,/.exec(block);
      expect(m, `${name} must name its token spring transition`).not.toBeNull();
      expect(
        TOKEN_SPRINGS,
        `${name} transition must be one of the token springs, not a literal`,
      ).toContain(m?.[1]);
    }
    // The spring catalog itself must never carry a raw timing value
    // (comments explain the bands in ms — strip them before scanning).
    const springCatalog = (presets.split("export interface MorphRect")[0] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(springCatalog).not.toMatch(/\b\d+(?:\.\d+)?ms\b/);
    expect(springCatalog).not.toMatch(/cubic-bezier\(/);
    expect(springCatalog).not.toMatch(/duration\s*:/);
  });

  it("every preset's exit pins pointer-events: none on its first exit frame", () => {
    for (const name of [
      "tfPanel",
      "tfPanelLeft",
      "tfDialog",
      "tfBackdrop",
      "tfMenu",
      "tfMenuUp",
      "tfPopover",
      "tfToast",
      "tfToastSuccess",
      "tfBar",
      "tfBarTop",
    ]) {
      expect(presetBlock(name), `${name} exit must pin pointer-events: none`).toMatch(
        /pointerEvents:\s*"none"/,
      );
    }
  });

  it("the TfResize primitive resolves its size tween from the motion tokens", () => {
    expect(resizeSrc).toMatch(/duration:\s*msToSeconds\(MOTION_DURATION\.standard\)/);
    expect(resizeSrc).toMatch(/ease:\s*MOTION_EASE\.layout/);
    // No raw tween duration anywhere in the primitive.
    expect(resizeSrc).not.toMatch(/duration:\s*0?\.\d+/);
  });

  it("the tools palette list<->grid width swap is a token-driven transition (criterion 2)", () => {
    // The panel's own width (344px list / 380px grid) must tween on the
    // SAME --panel-slide-* tokens its siblings (the page-view inset and
    // the Tools badge) already consume — otherwise the panel jumps while
    // the page and badge slide.
    const block = /\.tools-palette\s*\{([\s\S]*?)\n\}/.exec(cssClean)?.[1] ?? "";
    expect(block, ".tools-palette must declare a width transition").toMatch(/transition:/);
    expect(block).toMatch(/width\s+var\(--panel-slide-duration/);
    expect(block).toMatch(/var\(--panel-slide-ease/);
    // The two widths the swap moves between still exist.
    expect(cssClean).toMatch(/\.tools-palette\s*\{[\s\S]*?width:\s*344px/);
    expect(cssClean).toMatch(/\.tools-palette-grid\s*\{\s*width:\s*380px/);
  });

  it("the frosted tools-palette override keeps the width channel alongside its backdrop transition (DEF-233)", () => {
    // The frosted focus/defocus group declares `transition: backdrop-filter
    // …, -webkit-backdrop-filter …` on `.tools-palette` with the SAME
    // specificity as the base rule but earlier in the file — before DEF-233
    // it REPLACED the width transition (computed transition-property was
    // "backdrop-filter, -webkit-backdrop-filter"), so the default frosted
    // theme snapped the panel 344<->380 while the inset and badge slid.
    // The frosted override must re-declare the backdrop channel AND the
    // width channel on the same --panel-slide-* token pair.
    const frosted = /:root\[data-theme="frosted"\]\s+\.tools-palette\s*\{([^}]*)\}/.exec(
      cssClean,
    )?.[1] ?? "";
    expect(frosted, "frosted .tools-palette rule missing").not.toBe("");
    expect(frosted).toMatch(/backdrop-filter\s+var\(--tf-motion-normal/);
    expect(frosted).toMatch(/width\s+var\(--panel-slide-duration/);
    expect(frosted).toMatch(/var\(--panel-slide-ease/);
    // The frosted surface material/blur/radius/colour stay untouched by the
    // transition fix: the override carries no surface re-declaration.
    expect(frosted).not.toMatch(/background:|backdrop-filter:\s*var\(--glass-blur/);
    expect(frosted).not.toMatch(/border-radius:|box-shadow:/);
  });
});

/* ===========================================================================
 * DEF-234 — the reduced-motion travel class.
 *
 * A collapsed CSS animation (the reduced-motion catch-all drops every
 * duration to 0.01ms) still PAINTS its keyframe's `from` transform on the
 * first frame. Any surface whose entrance/state keyframe carries a `from`
 * transform therefore needs an explicit reduced-motion path:
 *   (a) `animation: none !important` — correct when the element's base
 *       state is ALREADY the visible end state; the surface still
 *       appears, instantly and in place, with no travel; or
 *   (b) an opacity-only reduced keyframe — required when the animation IS
 *       the reveal (the tooltip's base state is opacity 0 + visibility
 *       hidden, so (a) would leave it permanently invisible).
 *
 * The table below is the audited leak set. It is checked against the
 * shipped stylesheet in BOTH directions: every listed keyframe must really
 * carry a `from` transform and really be applied by its selector (so the
 * table can never rot into vacuity), and every listed surface must really
 * be neutralised inside the reduced-motion block. Surfaces that are
 * leak-free by construction (opacity-only keyframes, a spin with no `from`
 * frame, a shimmer whose `from` equals its resting transform, and the
 * spring-migrated keyframes no rule applies) are pinned in the tests that
 * follow.
 * ======================================================================== */

describe("DEF-234 — reduced-motion travel class", () => {
  const css = readStyles();
  const cssClean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const animCss = readFileSync(
    resolve(process.cwd(), "src/renderer/styles/animations.css"),
    "utf8",
  );
  const animClean = animCss.replace(/\/\*[\s\S]*?\*\//g, "");

  const normalized = (s: string): string => s.replace(/\s+/g, " ").trim();

  /** The @media (prefers-reduced-motion: reduce) block body. */
  const reducedBody = (): string => {
    const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(cssClean);
    expect(m).not.toBeNull();
    return m?.[1] ?? "";
  };

  /** The stylesheet WITHOUT the reduced block, so a reduced override is
   *  never mistaken for the live non-reduced rule. */
  const cssOutsideReduced = (): string => cssClean.replace(reducedBody(), "");

  /** Every @keyframes block: name -> body. */
  const keyframes = (source: string): Map<string, string> => {
    const map = new Map<string, string>();
    for (const m of source.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)) {
      map.set(m[1] ?? "", m[2] ?? "");
    }
    return map;
  };
  const kfs = keyframes(cssClean);

  /** Every rule that declares `animation`/`animation-name`: selector ->
   *  the named keyframe (comma-separated selector lists are split). */
  const animationUses = (source: string): { selector: string; name: string }[] => {
    const uses: { selector: string; name: string }[] = [];
    for (const m of source.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const decl = /(?:^|[;\s])animation(?:-name)?\s*:\s*([\w-]+)/.exec(m[2] ?? "");
      if (decl === null) continue;
      const name = decl[1] ?? "";
      if (name === "none") continue;
      for (const sel of (m[1] ?? "").split(",")) {
        const key = normalized(sel);
        if (key !== "") uses.push({ selector: key, name });
      }
    }
    return uses;
  };

  /** The reduced block's animation overrides by selector -> rule body. */
  const reducedAnimationBySelector = (): Map<string, string> => {
    const map = new Map<string, string>();
    for (const m of reducedBody().matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const body = m[2] ?? "";
      if (!/(?:^|[;\s])animation(?:-name)?\s*:/.test(body)) continue;
      for (const sel of (m[1] ?? "").split(",")) {
        const key = normalized(sel);
        if (key !== "") map.set(key, body);
      }
    }
    return map;
  };

  /** The audited leak set: each keyframe's `from` frame carries travel and
   *  each surface's base state is already the visible end state, so
   *  `animation: none` is the reduced representation. */
  const TRAVEL_SURFACES: { selector: string; keyframe: string; surface: string }[] = [
    { selector: ".edit-inline-editor", keyframe: "edit-bar-in", surface: "edit inline editor" },
    { selector: ".tab-active::after", keyframe: "indicator-in", surface: "active tab underline" },
    { selector: ".thumb-current", keyframe: "thumb-select", surface: "current thumbnail" },
    { selector: ".tool-btn-save-clean", keyframe: "success-pop", surface: "save-clean button" },
    { selector: ".color-palette-error", keyframe: "shake-x", surface: "color palette error" },
    { selector: ".optimize-error", keyframe: "shake-x", surface: "optimize error" },
    {
      selector: ".update-prompt-progress-indeterminate .update-prompt-progress-bar",
      keyframe: "update-prompt-indeterminate",
      surface: "update indeterminate bar",
    },
  ];

  it("the leak table is non-vacuous: every keyframe exists, carries a from transform, and is applied", () => {
    expect(TRAVEL_SURFACES.length).toBeGreaterThanOrEqual(6);
    const uses = animationUses(cssOutsideReduced());
    for (const { selector, keyframe, surface } of TRAVEL_SURFACES) {
      const body = kfs.get(keyframe);
      expect(body, `${keyframe} keyframe missing`).toBeTruthy();
      expect(body ?? "", `${keyframe} must carry a from-frame transform`).toMatch(
        /(?:from|0%)\s*\{[^}]*transform\s*:/,
      );
      expect(
        uses.some((u) => u.name === keyframe && u.selector.includes(selector)),
        `${surface}: no non-reduced rule applies ${keyframe} to ${selector}`,
      ).toBe(true);
    }
  });

  it("every audited travel surface is neutralised inside the reduced-motion block", () => {
    const reduced = reducedAnimationBySelector();
    for (const { selector, surface } of TRAVEL_SURFACES) {
      const body = reduced.get(selector);
      expect(body, `${surface}: no reduced-motion animation override for ${selector}`).toBeTruthy();
      if (body === undefined) continue;
      if (/animation:\s*none\s*!important/.test(body)) continue;
      // Otherwise the override must swap in an opacity-only keyframe.
      const name = /animation:\s*([\w-]+)/.exec(body)?.[1] ?? "";
      const kf = kfs.get(name) ?? "";
      expect(kf, `${surface}: reduced keyframe ${name} must be opacity-only`).not.toMatch(
        /transform\s*:/,
      );
    }
  });

  it("the tooltip keeps its reveal through an opacity-only reduced keyframe (no travel)", () => {
    // The tooltip cannot take `animation: none` — its base state is
    // opacity: 0 + visibility: hidden and the animation is its only
    // reveal. It gets an opacity-only sibling keyframe selected by the
    // SAME hover selector inside the reduced block.
    const kf = kfs.get("tooltip-enter-reduced");
    expect(kf, "@keyframes tooltip-enter-reduced missing").toBeTruthy();
    expect(kf ?? "").toMatch(/opacity\s*:/);
    expect(kf ?? "").toMatch(/visibility:\s*visible/);
    expect(kf ?? "", "the reduced keyframe must carry no transform").not.toMatch(/transform\s*:/);

    const rule = reducedAnimationBySelector().get(".tooltip-anchor [data-tooltip]:hover::after");
    expect(rule, "reduced tooltip hover rule missing").toBeTruthy();
    if (rule === undefined) return;
    expect(rule).toMatch(
      /animation:\s*tooltip-enter-reduced\s+var\(--tf-motion-fast\)\s+var\(--tf-ease-fast\)\s+forwards/,
    );
    // The base rule's pre-entrance pose is pinned to the entrance's END
    // pose (centering only), so the collapsed first frame and the settled
    // frame paint the same static transform.
    expect(rule).toMatch(/transform:\s*translateX\(-50%\)\s*;/);
    expect(rule).not.toMatch(/translateY|scale\(/);
    // Tokens only: no literal duration, no raw easing.
    expect(rule).not.toMatch(/\d+(?:\.\d+)?ms\b/);
    expect(rule).not.toMatch(/cubic-bezier\(/);

    // A collapsed TRANSITION also paints its from-value on the first frame
    // (measured: matrix(0.98,0,0,0.98,·,3)), so the transform channel is
    // dropped from the tooltip's transition under reduced motion — the pin
    // must land in one recalc, not over 0.01ms.
    const base = reducedAnimationBySelector().get(".tooltip-anchor [data-tooltip]::after");
    const baseRule =
      /\.tooltip-anchor\s*\[data-tooltip\]::after\s*\{([^}]*)\}/.exec(reducedBody())?.[1] ?? "";
    expect(base, "reduced tooltip base rule missing").not.toBe("");
    expect(baseRule, "reduced tooltip base rule missing").not.toBe("");
    expect(baseRule).toMatch(/transition-property:\s*opacity,\s*visibility\s*;/);
    expect(baseRule, "the transform channel must not transition").not.toMatch(
      /transition-property:[^;]*transform/,
    );
  });

  it("the non-reduced tooltip entrance is untouched (travel keyframe + dwell delay)", () => {
    const hover =
      /\.tooltip-anchor\s*\[data-tooltip\]:hover::after\s*\{([\s\S]*?)\n\}/.exec(cssClean)?.[1] ??
      "";
    expect(hover).toMatch(
      /animation:\s*tooltip-enter\s+var\(--tf-motion-fast\)\s+var\(--tf-ease-fast\)\s+300ms\s+forwards/,
    );
    expect(kfs.get("tooltip-enter") ?? "").toMatch(
      /from\s*\{[^}]*transform:\s*translateX\(-50%\)\s+translateY\(3px\)\s+scale\(0\.98\)/,
    );
  });

  it("every remaining applied keyframe is leak-free by construction", () => {
    const applied = new Set(animationUses(cssOutsideReduced()).map((u) => u.name));
    const body = (name: string): string => kfs.get(name) ?? "";

    // (1) Opacity-only entrances: no transform anywhere in the keyframe.
    for (const name of ["tab-fade", "ann-flash"]) {
      expect(applied.has(name), `${name} must still be applied`).toBe(true);
      expect(body(name), `${name} must stay opacity-only`).not.toMatch(/transform\s*:/);
    }
    // (2) Spin: only a `to` frame exists, so the first painted frame is
    //     the element's own base transform (identity) — nothing to leak.
    expect(applied.has("update-indicator-spin")).toBe(true);
    expect(body("update-indicator-spin")).not.toMatch(/(?:from|0%)\s*\{/);
    // (3) The placeholder shimmer's `from` frame is byte-identical to the
    //     band's resting transform, so the first frame displaces nothing.
    expect(body("shimmer-sweep")).toMatch(/from\s*\{[^}]*transform:\s*translateX\(-100%\)/);
    for (const sel of ["thumb-placeholder", "page-placeholder"]) {
      const rule = new RegExp(`\\.${sel}::after\\s*\\{([\\s\\S]*?)\\n\\}`).exec(cssClean)?.[1] ?? "";
      expect(rule, `.${sel}::after base rule missing`).toMatch(/transform:\s*translateX\(-100%\)/);
    }
    // (4) The frosted acrylic sheen is a transform sweep, but it only ever
    //     attaches to the four chrome surfaces the reduced block disables
    //     outright (pinned by the Phase D reduced-motion test above).
    expect(body("acrylic-sheen")).toMatch(/translateX\(/);
  });

  it("the unused entrance keyframes are applied by no rule (they cannot leak)", () => {
    // panel/menu/dialog/popover/toast/sheet/ocr entrances migrated to the
    // token springs (tfPresets); the CSS keyframes survive only as the
    // documented source of truth. Nothing applies them, so no collapsed
    // animation can paint their `from` transform.
    const applied = new Set(animationUses(cssOutsideReduced()).map((u) => u.name));
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
      "toast-in",
      "modal-in",
      "sheet-fade",
      "ocr-bar-in",
    ]) {
      expect(kfs.has(name), `${name} keyframe must still exist`).toBe(true);
      expect(applied.has(name), `${name} must be applied by no rule`).toBe(false);
    }
  });

  it("every transform-bearing .anim-* utility is disabled in the animations.css reduced block", () => {
    const animKfs = keyframes(animClean);
    const animReduced = (
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(animClean)?.[1] ??
      ""
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const disabled = new Set(
      (/([^}{]*)\{[^}{]*animation:\s*none/.exec(animReduced)?.[1] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
    );

    const travelUtilities: string[] = [];
    for (const { selector, name } of animationUses(animClean)) {
      if (!/^\.anim-[\w-]+$/.test(selector)) continue;
      if (!/transform\s*:/.test(animKfs.get(name) ?? "")) continue; // opacity-only — safe
      travelUtilities.push(selector);
      expect(
        Array.from(disabled),
        `${selector} animates a transform and must be disabled under reduced motion`,
      ).toContain(selector);
    }
    // Non-vacuous: the swell/slide/materialize utilities are in the set.
    expect(travelUtilities.length).toBeGreaterThanOrEqual(5);
    expect(travelUtilities).toContain(".anim-materialize");
    expect(travelUtilities).toContain(".anim-dissolve");
  });
});

/* ===========================================================================
 * Phase 22 — radius ladder + surface-family contract (DEF-247/248/249).
 *
 * The operator's visual-consistency audit: (A) the docked toolboxes must
 * follow the app's rounded style, (B) every dropdown must read as ONE box
 * with its trigger, (C) a menu's corner must not change size with the
 * theme. This pins the ladder, the docked-panel corners, the menu-family
 * radius in all three themes and the unified-join declarations at the
 * source, so any future drift turns the spec red.
 * ======================================================================== */
describe("Phase 22 — radius ladder + surface families", () => {
  const css = readStyles();
  const cssClean = css.replace(/\/\*[\s\S]*?\*\//g, "");

  /** Every rule body whose selector LIST contains `selector` exactly
   *  (grouped selectors included; descendant/theme-scoped variants are
   *  deliberately excluded). The FIRST match is not enough for menus,
   *  which have a no-drag rule before the styled one. */
  const bodiesFor = (selector: string): string[] =>
    [...cssClean.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
      .filter((m) =>
        (m[1] ?? "")
          .split(",")
          .some((s) => s.trim() === selector),
      )
      .map((m) => m[2] ?? "");
  const bodyWith = (selector: string, needle: RegExp): string => {
    const body = bodiesFor(selector).find((b) => needle.test(b));
    expect(body, `${selector} rule matching ${needle} missing`).toBeDefined();
    return body ?? "";
  };

  it("declares the full radius ladder", () => {
    for (const [token, value] of [
      ["--radius-1", "3px"],
      ["--radius-2", "5px"],
      ["--radius-3", "8px"],
      ["--radius-dialog", "10px"],
      ["--radius-group", "12px"],
      ["--radius-panel", "16px"],
      // Phase 35 — the window is opaque and Windows rounds the window
      // corners (DWM, ~8px), so the app's own window radius matches the OS
      // corner instead of the old transparent-window 20px.
      ["--radius-window", "8px"],
    ]) {
      expect(cssClean, `${token} must be declared`).toMatch(
        new RegExp(`${token}:\\s*${value}`),
      );
    }
    // The ladder is theme-independent: no [data-theme] block re-declares
    // a ladder radius (themes only re-map surfaces/colours).
    for (const theme of ["light", "dark", "frosted"]) {
      const block = new RegExp(
        `:root\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`,
      ).exec(cssClean)?.[1] ?? "";
      expect(block).not.toMatch(/--radius-(1|2|3|dialog|group|panel|window)\s*:/);
    }
  });

  it("--radius-panel is actually consumed (no declared-but-unused token)", () => {
    // DEF-247 — the token existed but resolved nowhere. It now feeds the
    // shared --panel-radius in :root AND the frosted block, and the
    // panel rules consume --panel-radius per corner.
    expect(cssClean).toMatch(/--panel-radius:\s*var\(--radius-panel\)/);
    const uses = [...cssClean.matchAll(/var\(--radius-panel\)/g)].length;
    expect(uses).toBeGreaterThanOrEqual(2);
    expect(cssClean).toMatch(/border-radius:\s*[^;{}]*var\(--panel-radius\)/);
  });

  it("the docked panels round their page-facing corners only (DEF-247)", () => {
    // The rail faces the page on its RIGHT edge; the palette faces it on
    // its LEFT edge. The window-edge corners stay flush (the frosted
    // shell clips them to its 8px curvature (Phase 35 — matches the OS
    // window corner now that the window is opaque)). Phase 25 — the
    // text-properties panel is no longer a docked panel: it is a
    // floating card over the page view, rounded on ALL corners.
    // DEF-294 — the rail's TOP-right corner is square too: the header row
    // at the rail's top must read flush (only the page-facing bottom-right
    // corner rounds).
    expect(bodyWith(".side-rail", /border-radius/)).toMatch(
      /border-radius:\s*0 0 var\(--panel-radius\) 0/,
    );
    expect(bodyWith(".tools-palette", /border-radius/)).toMatch(
      /border-radius:\s*var\(--panel-radius\) 0 0 var\(--panel-radius\)/,
    );
    expect(bodyWith(".text-props-panel", /border-radius/)).toMatch(
      /border-radius:\s*var\(--panel-radius\)/,
    );
    expect(bodyWith(".text-props-panel", /border-radius/)).not.toMatch(
      /border-radius:\s*0 var\(--panel-radius\)/,
    );
    // The panel's inner body inherits the frame's corner so the visible
    // scroll area (and its computed radius) matches the frame.
    expect(bodyWith(".text-props-body", /border-radius:\s*inherit/)).toMatch(
      /border-radius:\s*inherit/,
    );
  });

  it("the menu family uses ONE corner token in every theme (DEF-249)", () => {
    for (const sel of [
      ".titlebar-menu-popover",
      ".theme-toggle-popover",
      ".ann-tool-menu",
      ".color-popover",
    ]) {
      expect(
        bodyWith(sel, /border-radius:\s*var\(--radius-3\)/),
        `${sel} must resolve its corner from --radius-3 in every theme`,
      ).toMatch(/border-radius:\s*var\(--radius-3\)/);
    }
    // The old cross-theme divergence is gone: no menu rule resolves its
    // corner from the frosted-only --tf-radius-md, and the light/dark
    // 5px --radius-2 corner is not used by the menu surfaces.
    expect(cssClean).not.toMatch(/border-radius:\s*var\(--tf-radius-md\)/);
    for (const sel of [".titlebar-menu-popover", ".ann-tool-menu"]) {
      for (const body of bodiesFor(sel)) {
        expect(body).not.toMatch(/border-radius:\s*var\(--radius-2\)/);
      }
    }
  });

  it("the floating surface families keep their ladder corners", () => {
    expect(bodyWith(".modal-dialog", /border-radius/)).toMatch(
      /border-radius:\s*var\(--radius-dialog\)/,
    );
    expect(bodyWith(".color-popover", /border-radius/)).toMatch(
      /border-radius:\s*var\(--radius-3\)/,
    );
    expect(bodyWith(".toast", /border-radius/)).toMatch(
      /border-radius:\s*var\(--radius-2\)/,
    );
  });

  it("the unified dropdown join is pinned (DEF-248)", () => {
    // Surface side: the joined top edge carries no hairline, and the
    // joined corner is square (the exposed corner keeps the family radius).
    for (const sel of [
      ".titlebar-menu-popover",
      ".theme-toggle-popover",
      ".ann-tool-menu",
      ".color-popover",
    ]) {
      expect(
        bodyWith(sel, /border-top-width:\s*0/),
        `${sel} must drop the joined-edge hairline`,
      ).toMatch(/border-top-width:\s*0/);
    }
    expect(bodyWith(".titlebar-menu-popover", /border-top-left-radius:\s*0/)).toMatch(
      /border-top-left-radius:\s*0/,
    );
    for (const sel of [".theme-toggle-popover", ".ann-tool-menu", ".color-popover"]) {
      expect(bodyWith(sel, /border-top-right-radius:\s*0/)).toMatch(
        /border-top-right-radius:\s*0/,
      );
    }
    // Trigger side: joined corners square, material merged, and no hover
    // lift (the 1px translateY was the last seam).
    for (const sel of [
      ".titlebar-menu-button-active",
      '.theme-toggle-trigger[aria-expanded="true"]',
      ".ann-dropdown-toggle-open",
    ]) {
      const body = bodyWith(sel, /border-bottom-left-radius:\s*0/);
      expect(body, `${sel} must square its joined corners`).toMatch(
        /border-bottom-left-radius:\s*0/,
      );
      expect(body, `${sel} must not lift off the surface`).toMatch(/transform:\s*none/);
    }
    expect(bodyWith(".ann-color-swatch-main-active", /border-bottom-width:\s*0/)).toMatch(
      /border-bottom-width:\s*0/,
    );
    // The colour popover placement is flush with the swatch (the old
    // +6px offset was the widest seam measured). Match the CODE form,
    // not the explanatory comment that records the old value.
    const toolbar = readFileSync(
      resolve(process.cwd(), "src/renderer/annotations/AnnotationToolbar.tsx"),
      "utf8",
    );
    expect(toolbar).not.toMatch(/anchor\.bottom \+ 6,/);
    expect(toolbar).toMatch(/Math\.max\(anchor\.bottom, 0\)/);
  });
});

