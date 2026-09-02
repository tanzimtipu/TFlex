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

  it("uses 150-250ms motion tokens for window control transitions", () => {
    // Phase 13 spec: smooth 150-250ms ease-out animations on
    // controls. The title bar control rule must reference one of
    // --t-quick / --t-base / --t-slow — anything outside this band
    // is a regression.
    const blocks = [...css.matchAll(/\.titlebar-control\s*\{([\s\S]*?)\n\}/gm)];
    const block = blocks.find((b) => (b[1] ?? "").includes("transition")) ?? null;
    expect(block).not.toBeNull();
    if (block === null) return;
    const body = block[1] ?? "";
    expect(body).toMatch(/var\(--t-(quick|base|slow)\)/);
  });

  it("uses the same cubic-bezier easing curve as the rest of the UI", () => {
    const blocks = [...css.matchAll(/\.titlebar-control\s*\{([\s\S]*?)\n\}/gm)];
    const block = blocks.find((b) => (b[1] ?? "").includes("transition")) ?? null;
    expect(block).not.toBeNull();
    if (block === null) return;
    const body = block[1] ?? "";
    expect(body).toMatch(/var\(--ease\)/);
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