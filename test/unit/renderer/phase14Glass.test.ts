// @vitest-environment node
//
// Phase 14 + Phase 14.1 — Liquid Glass static CSS contract. Pins the
// glass theme's structural guarantees the way the existing bug/design-
// token guards do: ambient backdrop, focus/defocus blur var, panel
// radii and widths, wrapping tool descriptions (never truncated), the
// spring hover curve, and the reduced-motion collapse of the hover
// lift.
//
// Phase 14.1 (the CORRECTION) re-pins the material itself: the glass
// films are NEUTRAL white/gray translucent sheets (never the Phase-14
// blue films), the chrome heights are tokenized (title 44 / command
// 52), and both side panels DOCK like light/dark (square corners, the
// shared panel contract — no floating card geometry).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function readStyles(): string {
  return readFileSync(STYLES_PATH, "utf8");
}

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractRuleBody(src: string, selectorIndex: number): string {
  const braceOpen = src.indexOf("{", selectorIndex);
  if (braceOpen === -1) return "";
  let depth = 0;
  for (let i = braceOpen; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(braceOpen + 1, i);
    }
  }
  return "";
}

/** Every rule body whose stripped selector text contains `selector`
 *  directly before its `{` (works for single- and multi-selector
 *  rules; later overrides appear after earlier ones). */
function findRuleBodies(src: string, selector: string): string[] {
  const stripped = stripCssComments(src);
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(selector, from);
    if (idx === -1) return bodies;
    let cursor = idx + selector.length;
    while (cursor < stripped.length && /\s/.test(stripped[cursor] ?? "")) cursor += 1;
    if (stripped[cursor] === "{") bodies.push(extractRuleBody(stripped, idx));
    from = idx + selector.length;
  }
}

function findRuleBody(src: string, selector: string): string | null {
  const bodies = findRuleBodies(src, selector);
  return bodies.length > 0 ? bodies[0] : null;
}

describe("Phase 14 — liquid glass tokens and ambient backdrop", () => {
  const css = readStyles();

  it("defines the iOS spring curve (the panels are docked — no panel radius token)", () => {
    expect(css).toMatch(/--tf-ease-spring:\s*cubic-bezier\(0\.34,\s*1\.56,\s*0\.64,\s*1\)/);
    // The floating-card panel radius is retired: the panels dock with
    // square corners like light/dark, so no --tf-radius-panel token.
    expect(css).not.toMatch(/--tf-radius-panel/);
  });

  it("defocusing the window relaxes the frosted blur (20px -> 12px)", () => {
    const body = findRuleBody(css, ':root[data-window-focus="blurred"]');
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/--tf-acrylic-blur:\s*12px/);
  });

  it("the chrome blur rule tweens backdrop-filter (fluid focus change)", () => {
    const stripped = stripCssComments(css);
    const rule = /-webkit-backdrop-filter:\s*var\(--glass-blur\)[\s\S]{0,300}?transition:[\s\S]{0,300}?backdrop-filter\s+var\(--tf-motion-normal\)/.exec(
      stripped,
    );
    expect(rule, "the Phase-A blur rule must tween backdrop-filter").not.toBeNull();
  });

  it("the ambient layer exists, never intercepts pointers, and reads the parallax vars", () => {
    const body = findRuleBody(css, ".tf-ambient");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/pointer-events:\s*none/);
    expect(body ?? "").toMatch(/var\(--tf-parallax-x/);
    expect(body ?? "").toMatch(/var\(--tf-parallax-y/);
    expect(body ?? "").toMatch(/scale\(1\.06\)/);
  });

  it("the frosted ambient paints the wallpaper aurora the glass diffuses", () => {
    const body = findRuleBody(css, ':root[data-theme="frosted"] .tf-ambient');
    expect(body).not.toBeNull();
    const aurora = body ?? "";
    expect(aurora.match(/radial-gradient\(/g)?.length).toBe(4);
    // Phase 14.1 — the hints are NEUTRAL (zinc/slate/sky): the glass
    // must read neutral over every backdrop, so the in-app backdrop
    // tint may not push it blue/violet/pink.
    expect(aurora).toMatch(/rgba\(148,\s*163,\s*184,\s*0\.1\)/);
    expect(aurora).toMatch(/rgba\(203,\s*213,\s*225,\s*0\.09\)/);
    expect(aurora).toMatch(/rgba\(100,\s*116,\s*139,\s*0\.08\)/);
    expect(aurora).toMatch(/rgba\(125,\s*211,\s*252,\s*0\.06\)/);
  });

  it("the frosted workspace steps aside so the ambient shows through the glass", () => {
    const stripped = stripCssComments(css);
    const rule = /:root\[data-theme="frosted"\]\s+\.app,\s*:root\[data-theme="frosted"\]\s+\.workspace-main\s*\{([^}]*)\}/.exec(
      stripped,
    );
    expect(rule, "frosted .app/.workspace-main transparency rule missing").not.toBeNull();
    expect(rule?.[1] ?? "").toMatch(/background:\s*transparent/);
    // The scroller's transparency rides the Phase-C full-bleed rule.
    const scroller = findRuleBodies(css, ':root[data-theme="frosted"] .document-scroller').at(-1);
    expect(scroller ?? "").toMatch(/position:\s*absolute/);
    expect(scroller ?? "").toMatch(/background:\s*transparent/);
  });

  it("the glass panels DOCK with square corners (no floating card radius)", () => {
    const stripped = stripCssComments(css);
    // No frosted-scoped panel rule may declare a border-radius: the
    // panels keep the base docked geometry (square corners like
    // light/dark); only the surface is glass.
    expect(stripped).not.toMatch(
      /:root\[data-theme="frosted"\]\s+\.tools-palette\s*\{[^}]*border-radius/,
    );
    expect(stripped).not.toMatch(
      /:root\[data-theme="frosted"\]\s+\.side-rail\s*\{[^}]*border-radius/,
    );
    // The shared panel contract resolves to the docked geometry.
    expect(stripped).toMatch(/--panel-radius:\s*0px/);
  });
});

describe("Phase 14 — docked glass shell (the panels behave like light/dark)", () => {
  const css = readStyles();

  it("the frosted workspace carries NO gutters (the docked grid like light/dark)", () => {
    // The floating-shell wallpaper gutters are gone: .workspace keeps
    // its base grid (rail column via the registered --tf-rail-w token —
    // 220px at rest — + 1fr) with no padding and no column gap, so the
    // rail sits flush at the window edge and the columns touch — the
    // same docked structure as light/dark. Phase 16 turned the static
    // 220px column into the token so the collapse/expand can tween it;
    // Phase 21 inserted the docked text-properties track (--tf-text-w)
    // between the rail and the 1fr page column (0px while closed).
    const workspace = findRuleBody(css, ':root[data-theme="frosted"] .workspace');
    expect(workspace, "no frosted .workspace layout override").toBeNull();
    const base = findRuleBody(css, ".workspace");
    expect(base ?? "").toMatch(
      /grid-template-columns:\s*var\(--tf-rail-w\)\s+var\(--tf-text-w\)\s+1fr/,
    );
    expect(base ?? "").not.toMatch(/padding:/);
    expect(base ?? "").not.toMatch(/column-gap:/);
  });

  it("the chrome rows stay in column 2 (no full-width negative-margin bands)", () => {
    const stripped = stripCssComments(css);
    // The command + annotation bars no longer stretch over the rail
    // column: that full-width band OVERLAPPED the docked rail card
    // (the chrome stack is two 52px rows; the floating cards only
    // cleared the first). Docked = the base in-flow rows of
    // .workspace-main, exactly like light/dark.
    expect(stripped).not.toMatch(/margin-left:\s*calc\(-1\s*\*\s*\(220px/);
    const toolbarFrosted = findRuleBodies(css, ':root[data-theme="frosted"] .toolbar');
    for (const body of toolbarFrosted) {
      expect(body).not.toMatch(/margin-left:/);
      expect(body).not.toMatch(/margin-right:/);
    }
    const annFrosted = findRuleBodies(css, ':root[data-theme="frosted"] .ann-toolbar');
    for (const body of annFrosted) {
      expect(body).not.toMatch(/margin-left:/);
      expect(body).not.toMatch(/margin-right:/);
    }
  });

  it("the pages rail is docked — no floating margin, no all-side card border", () => {
    // The floating margin-top (band height + 16px) is gone: the rail
    // owns grid column 1 of .workspace from the workspace's top edge
    // down, exactly like light/dark. The base rule carries the docked
    // contract: panel surface + right docking hairline, no radius,
    // no elevation shadow.
    const frosted = findRuleBodies(css, ':root[data-theme="frosted"] .side-rail');
    for (const body of frosted) {
      expect(body).not.toMatch(/margin-top:/);
      expect(body).not.toMatch(/border:\s*1px solid/);
      expect(body).not.toMatch(/border-radius:/);
      expect(body).not.toMatch(/box-shadow:/);
    }
    const base = findRuleBody(css, ".side-rail");
    expect(base ?? "").toMatch(/background:\s*var\(--panel-bg\)/);
    expect(base ?? "").toMatch(/border-right:\s*1px solid var\(--panel-border\)/);
  });

  it("the tools panel is docked on the base geometry (below both chrome rows, flush right)", () => {
    // The floating window-edge insets are gone: the palette anchors
    // below BOTH chrome rows (--toolbar-h + --ann-toolbar-h), flush
    // right and bottom — the light theme's docked geometry. No
    // frosted rule may override top/right/bottom with the floating
    // insets, and no all-side card border survives.
    const frosted = findRuleBodies(css, ':root[data-theme="frosted"] .tools-palette');
    for (const body of frosted) {
      expect(body).not.toMatch(/top:\s*calc\(var\(--tf-band-h/);
      expect(body).not.toMatch(/right:\s*var\(--panel-margin/);
      expect(body).not.toMatch(/bottom:\s*var\(--panel-margin/);
      expect(body).not.toMatch(/border:\s*1px solid/);
      expect(body).not.toMatch(/border-radius:/);
      expect(body).not.toMatch(/box-shadow:/);
    }
    // The base docked geometry stays the single source of truth.
    // Phase 19 retired the second annotation row, so the palette
    // clears the single CommandBar row.
    const base = findRuleBody(css, ".tools-palette");
    expect(base ?? "").toMatch(/top:\s*var\(--toolbar-h,\s*52px\)/);
    expect(base ?? "").not.toMatch(/--ann-toolbar-h/);
    expect(base ?? "").toMatch(/right:\s*0/);
    expect(base ?? "").toMatch(/bottom:\s*0/);
  });

  it("the open tools panel drives the page-view inset (state-driven, every theme)", () => {
    // Phase 14.2 FIX 4/5 — the inset is state-driven: .app-main
    // carries data-tools-open (the same React state that mounts the
    // palette) and the scroller consumes the animated --tf-tools-inset
    // as its right margin, in EVERY theme. The inset equals the panel
    // width (list 344px / grid 380px) exactly — the page view ends
    // flush against the panel's left edge, no breathing gap — so the
    // docked panel and the page move together.
    const stripped = stripCssComments(css);
    const driver = stripped.match(
      /\.app-main\[data-tools-open="true"\]\s*\{([^}]*)\}/,
    );
    expect(driver, "the tools-inset driver rule missing").not.toBeNull();
    expect(driver?.[1] ?? "").toMatch(
      /--tf-tools-inset:\s*var\(--tools-panel-w,\s*344px\);/,
    );
    // The gap token is gone: the page content must sit flush against
    // the panel (a 12px breathing gap used to leave a visible empty
    // band between the scrollbar and the panel).
    expect(stripped).not.toMatch(/--tools-panel-gap/);
    // The grid layout mode widens the panel token to 380px.
    const gridDriver = stripped.match(
      /\.app-main\[data-tools-open="true"\]\[data-tools-mode="grid"\]\s*\{([^}]*)\}/,
    );
    expect(gridDriver, "the grid-mode panel width rule missing").not.toBeNull();
    expect(gridDriver?.[1] ?? "").toMatch(/--tools-panel-w:\s*380px/);
    // The scroller consumes the inset as a margin (transition-free —
    // the PDF-safety audit keeps motion off the document surfaces).
    const scroller = findRuleBody(css, ".document-scroller");
    expect(scroller ?? "").toMatch(/margin-right:\s*var\(--tf-tools-inset,\s*0px\)/);
  });

  it("panel and page animate TOGETHER (the inset token is transitioned on the chrome, not the scroller)", () => {
    const stripped = stripCssComments(css);
    // The registered @property makes the length interpolate.
    expect(stripped).toMatch(
      /@property\s+--tf-tools-inset\s*\{[^}]*syntax:\s*"<length>"[^}]*\}/,
    );
    // The transition lives on .workspace-main (chrome level) with the
    // shared 150ms ease-out tokens (DEF-240: alias of the canonical
    // motion tokens, no literal fallback).
    const main = findRuleBody(css, ".workspace-main");
    expect(main ?? "").toMatch(/transition:[\s\S]*--tf-tools-inset/);
    expect(main ?? "").toMatch(/var\(--panel-slide-duration\)/);
    // ...and NEVER on the scroller itself (the PDF-safety contract).
    const scroller = findRuleBody(css, ".document-scroller");
    expect(scroller ?? "").not.toMatch(/transition\s*:/);
  });

  it("the window shell rounds at the window radius and squares when maximized", () => {
    const body = findRuleBody(css, ':root[data-theme="frosted"] .app');
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/border-radius:\s*var\(--radius-window,\s*20px\)/);
    // Phase 14.2 — clip, not hidden: the box must stay NON-scrollable
    // (overflow: hidden boxes are programmatically scrollable, and
    // the ambient parallax pad created a scroll area that focus-driven
    // scroll-into-view used to shift the whole shell with).
    expect(body ?? "").toMatch(/overflow:\s*clip/);
    const maximized = findRuleBody(css, ':root[data-theme="frosted"] .app-maximized');
    expect(maximized).not.toBeNull();
    expect(maximized ?? "").toMatch(/border-radius:\s*0/);
  });

  it("the glass films are NEUTRAL, never blue (Phase 14.1 correction)", () => {
    const m = /:root\[data-theme="frosted"\]\s*\{([\s\S]*?)\n\}/m.exec(css);
    expect(m).not.toBeNull();
    const frosted = m?.[1] ?? "";
    // The corrected material resolves into the :root --glass-* tokens:
    // translucent WHITE sheets (r=g=b=255) in the 0.55-0.80 band, so the
    // wallpaper behind the window supplies the tint (DEF-182's mock read
    // blue because of the blue WALLPAPER, not a blue paint).
    for (const token of [
      "--tf-surface-frame",
      "--tf-surface-rail",
      "--tf-surface-panel",
    ]) {
      expect(frosted).toMatch(new RegExp(`${token}\\s*:\\s*var\\(--glass-`));
    }
    // The toolbar film is an explicit white sheet.
    const toolbar = /--tf-surface-toolbar:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(frosted);
    expect(toolbar).not.toBeNull();
    if (toolbar !== null) {
      const [r, g, b] = [Number(toolbar[1]), Number(toolbar[2]), Number(toolbar[3])];
      const alpha = Number(toolbar[4]);
      expect(r).toBe(255);
      expect(g).toBe(255);
      expect(b).toBe(255);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(0.8);
    }
    // The glass material tokens themselves are neutral white films
    // (equal RGB channels — no hue tint) in the translucent band.
    for (const token of ["--glass-bg", "--glass-chrome-bg", "--glass-sidebar-bg"]) {
      const film = new RegExp(`${token}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)`).exec(frosted);
      expect(film, `${token} must be an explicit rgba film in the frosted block`).not.toBeNull();
      if (film !== null) {
        const [r, g, b] = [Number(film[1]), Number(film[2]), Number(film[3])];
        expect(r).toBe(255);
        expect(g).toBe(255);
        expect(b).toBe(255);
        expect(Number(film[4])).toBeGreaterThan(0.5);
        expect(Number(film[4])).toBeLessThan(0.9);
      }
    }
    // The B-R spread that made the Phase-14 films read BLUE is gone:
    // rgba(126,178,250) (B-R +124) appears in no rule body (comments
    // documenting the old defect are allowed to mention it).
    expect(stripCssComments(css)).not.toMatch(/rgba\(126,\s*178,\s*250/);
    // The blue accent survives ONLY as the accent (selected/active/
    // focus/primary): the accent tokens stay blue.
    expect(css).toMatch(/--accent:\s*#2563eb/);
  });
});

describe("DEF-181 — the desktop wallpaper composites through the frosted glass", () => {
  // The main process opens the window with `transparent: true` +
  // `backgroundMaterial: 'acrylic'` (src/main/window.ts). The renderer
  // then defeated it by painting an opaque base UNDER every glass
  // sheet: html, body (--bg-base) and the ambient layer (--tf-bg)
  // each covered the whole window at alpha 1, so the frosted panels
  // diffused the app's own base instead of the wallpaper behind the
  // window. These contracts keep every window-level base transparent
  // in frosted — light/dark keep theirs.
  const css = readStyles();

  it("the frosted ambient no longer paints an opaque base under the glass", () => {
    const body = findRuleBody(css, ':root[data-theme="frosted"] .tf-ambient');
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/background-color:\s*transparent/);
    expect(body ?? "").not.toMatch(/--tf-bg/);
    // The aurora survives as low-alpha gradient hints only (the glass
    // tints the wallpaper; it does not repaint it).
    const aurora = body ?? "";
    expect(aurora.match(/radial-gradient\(/g)?.length).toBe(4);
  });

  it("html steps aside in frosted (light/dark keep the --bg-base paint)", () => {
    const rule = findRuleBodies(css, ':root[data-theme="frosted"]').find((b) =>
      /background:\s*transparent/.test(b),
    );
    expect(rule, "frosted html must be transparent so the wallpaper composites through")
      .toBeDefined();
    // The theme-independent window paint is untouched: bare `html` still
    // carries the --bg-base guard for light/dark.
    expect(findRuleBody(css, "html")).toMatch(/background:\s*var\(--bg-base\)/);
  });

  it("body steps aside in frosted", () => {
    const body = findRuleBody(css, ':root[data-theme="frosted"] body');
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/background:\s*transparent/);
  });

  it("the welcome launch surface is a translucent wash, never a solid sheet", () => {
    const welcome = findRuleBody(css, ':root[data-theme="frosted"] .welcome');
    expect(welcome ?? "").toMatch(/background:\s*rgba\(255,\s*255,\s*255,\s*0\.42\)/);
    const hero = findRuleBody(css, ':root[data-theme="frosted"] .welcome-hero');
    expect(hero ?? "").toMatch(/background:\s*rgba\(255,\s*255,\s*255,\s*0\.62\)/);
    // Deliberately no backdrop-filter here: the wallpaper blur is the OS
    // acrylic material's job and the 14-surface chrome blur contract
    // (design tokens) stays exact.
    expect(welcome ?? "").not.toMatch(/backdrop-filter/);
    expect(hero ?? "").not.toMatch(/backdrop-filter/);
  });
});

describe("Phase 14 — tools panel sizing and descriptions", () => {
  const css = readStyles();

  it("the panel widens into the spec band: 344px list, 380px grid, bounded", () => {
    const base = findRuleBody(css, ".tools-palette");
    expect(base ?? "").toMatch(/width:\s*344px/);
    expect(base ?? "").not.toMatch(/width:\s*280px/);
    const grid = findRuleBody(css, ".tools-palette-grid");
    expect(grid ?? "").toMatch(/width:\s*380px/);
    const bounds = findRuleBodies(css, ".tools-palette").find((b) => /min-width/.test(b));
    expect(bounds).toBeDefined();
    expect(bounds ?? "").toMatch(/min-width:\s*320px/);
    expect(bounds ?? "").toMatch(/max-width:\s*calc\(100vw\s*-\s*24px\)/);
  });

  it("descriptions wrap fully — the old ellipsis truncation is gone", () => {
    const desc = findRuleBody(css, ".tools-palette-entry-desc");
    expect(desc).not.toBeNull();
    expect(desc ?? "").toMatch(/white-space:\s*normal/);
    expect(desc ?? "").not.toMatch(/text-overflow:\s*ellipsis/);
    // Grid card titles wrap too; the Phase-14 override carries it (the
    // shared label rule keeps its ellipsis for list rows — the B21
    // contract reads that first rule, not this override).
    const gridLabel = findRuleBodies(css, ".tools-palette-entry-grid .tools-palette-entry-label")
      .find((b) => /white-space:\s*normal/.test(b));
    expect(gridLabel).toBeDefined();
    expect(gridLabel ?? "").toMatch(/font-size:\s*var\(--fs-sm\)/);
  });

  it("tool titles are bold (600/700) in BOTH layouts — DEF-180", () => {
    // The shared label rule is the only weight source: the grid
    // override retunes the font-size but must never reset the weight
    // back down. Accept the spec's 600 or 700, reject the old 500.
    const label = findRuleBody(css, ".tools-palette-entry-label");
    expect(label).not.toBeNull();
    expect(label ?? "").toMatch(/font-weight:\s*(600|700)\s*;/);
    expect(label ?? "").not.toMatch(/font-weight:\s*500\s*;/);
    for (const body of findRuleBodies(css, ".tools-palette-entry-grid .tools-palette-entry-label")) {
      if (/font-weight/.test(body)) {
        expect(body).toMatch(/font-weight:\s*(600|700)\s*;/);
      }
    }
    // Descriptions stay normal weight — no bold inheritance on the
    // desc span itself.
    const desc = findRuleBody(css, ".tools-palette-entry-desc");
    expect(desc).not.toBeNull();
    expect(desc ?? "").not.toMatch(/font-weight:\s*(5|6|7|8|9)00\s*;/);
  });

  it("the grid card layout stacks icon chip, title and description", () => {
    const card = findRuleBodies(css, ".tools-palette-entry-grid")
      .find((b) => /border-radius:\s*12px/.test(b));
    expect(card).toBeDefined();
    expect(card ?? "").toMatch(/flex-direction:\s*column/);
    const chip = findRuleBody(css, ".tools-palette-entry-grid .tools-palette-entry-icon");
    expect(chip ?? "").toMatch(/width:\s*30px/);
    expect(chip ?? "").toMatch(/border-radius:\s*9px/);
    // Two-column card rhythm: the 64px tile grid is overridden so a
    // 380px panel lands two ~170px cards (no one-word-per-line wraps).
    const columns = findRuleBodies(css, ".tools-palette-group-grid")
      .find((b) => /minmax\(150px/.test(b));
    expect(columns).toBeDefined();
    expect(columns ?? "").toMatch(
      /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(150px,\s*1fr\)\)/,
    );
  });

  it("list entries keep the full-width affordance with an auto height", () => {
    const body = findRuleBody(css, ".tools-palette-entry-list");
    expect(body ?? "").toMatch(/width:\s*100%/);
    expect(body ?? "").toMatch(/min-height:\s*56px/);
    // Fixed height must be gone (a bare height would clip two-line
    // descriptions). The lookbehind keeps `min-height` from matching.
    expect(body ?? "").not.toMatch(/(?<!min-)\bheight:\s*56px/);
    expect(body ?? "").toMatch(/height:\s*auto/);
  });
});

describe("Phase 14 — spring tool motion", () => {
  const css = readStyles();

  it("tool entries lift 1.02x with an accent glow on the spring curve", () => {
    const hover = findRuleBodies(css, ".tools-palette-entry:hover:not(:disabled)")
      .find((b) => /transform:\s*scale\(1\.02\)/.test(b));
    expect(hover).toBeDefined();
    expect(hover ?? "").toMatch(/rgba\(37,\s*99,\s*235,\s*0\.14\)/);
    // The transition rides the iOS overshoot curve, 220ms (inside the
    // spec's 200-400ms band), transform + box-shadow only.
    const transition = findRuleBodies(css, ".tools-palette-entry")
      .find((b) => /transform 220ms var\(--tf-ease-spring\)/.test(b));
    expect(transition).toBeDefined();
    expect(transition ?? "").toMatch(/box-shadow 220ms var\(--tf-ease-spring\)/);
  });

  it("pressing compresses the card instead of lifting it", () => {
    const active = findRuleBodies(css, ".tools-palette-entry:active:not(:disabled)")
      .find((b) => /transform:\s*scale\(0\.99\)/.test(b));
    expect(active).toBeDefined();
  });

  it("reduced motion removes the hover lift outright (wash and glow stay)", () => {
    const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(
      stripCssComments(css),
    );
    expect(block).not.toBeNull();
    const body = block?.[1] ?? "";
    expect(body).toMatch(/\.tools-palette-entry/);
    expect(body).toMatch(/transform:\s*none\s*!important/);
  });
});

describe("Phase 14.1 — standardized chrome heights + glass material components", () => {
  const css = readStyles();

  it("the THREE top-bar heights are tokenized (44 / 52 / 40)", () => {
    expect(css).toMatch(/--chrome-titlebar-h:\s*44px/);
    expect(css).toMatch(/--chrome-commandbar-h:\s*52px/);
    expect(css).toMatch(/--chrome-contextbar-h:\s*40px/);
    // The legacy --toolbar-h alias resolves into the command-bar token.
    expect(css).toMatch(/--toolbar-h:\s*var\(--chrome-commandbar-h\)/);
  });

  it("the caption strip renders at the standardized 44px height", () => {
    const header = findRuleBody(css, ".app-header");
    expect(header ?? "").toMatch(/height:\s*var\(--chrome-titlebar-h\)/);
  });

  it("the command bar renders at the standardized 52px height", () => {
    const toolbar = findRuleBody(css, ".toolbar");
    expect(toolbar ?? "").toMatch(/min-height:\s*var\(--chrome-commandbar-h\)/);
    // 16px horizontal padding + the 8px grid spacing tokens.
    expect(toolbar ?? "").toMatch(/padding:\s*var\(--space-small\)\s+var\(--space-standard\)/);
  });

  it("the GlassControlGroup capsule exists at the control-group radius", () => {
    const group = findRuleBody(css, ".glass-control-group");
    expect(group).not.toBeNull();
    expect(group ?? "").toMatch(/height:\s*var\(--control-height\)/);
    expect(group ?? "").toMatch(/border-radius:\s*var\(--radius-group\)/);
    expect(group ?? "").toMatch(/background:\s*var\(--glass-group-bg\)/);
    expect(group ?? "").toMatch(/border:\s*1px solid var\(--glass-group-border\)/);
    // Edge characteristics: the luminous top highlight + soft shadow.
    expect(group ?? "").toMatch(/inset 0 1px 0 var\(--glass-highlight\)/);
    expect(group ?? "").toMatch(/0 1px 2px rgba\(0,\s*0,\s*0,\s*0\.08\)/);
  });

  it("the frosted capsule floats on the band's own glass (lightest film)", () => {
    const frosted = findRuleBodies(css, ':root[data-theme="frosted"] .glass-control-group')
      .find((b) => /background:\s*var\(--glass-group-bg\)/.test(b));
    expect(frosted).toBeDefined();
    expect(frosted ?? "").toMatch(/border-color:\s*var\(--glass-group-border\)/);
  });

  it("the GlassSidebar header is one shared 44px row for both panels", () => {
    const header = findRuleBody(css, ".glass-sidebar-header");
    expect(header).not.toBeNull();
    expect(header ?? "").toMatch(/height:\s*var\(--glass-sidebar-header-h\)/);
    expect(header ?? "").toMatch(/justify-content:\s*space-between/);
    const title = findRuleBody(css, ".glass-sidebar-title");
    expect(title ?? "").toMatch(/font-weight:\s*600/);
  });

  it("both side panels share ONE docked glass material (left = right)", () => {
    // The base rules carry the shared --panel-* contract in every
    // theme; frosted re-points the tokens at the glass material while
    // keeping the docked geometry (no floating card elevation).
    const rail = findRuleBody(css, ".side-rail");
    const panel = findRuleBody(css, ".tools-palette");
    expect(rail ?? "").toMatch(/background:\s*var\(--panel-bg\)/);
    expect(rail ?? "").toMatch(/border-right:\s*1px solid var\(--panel-border\)/);
    expect(panel ?? "").toMatch(/background:\s*var\(--panel-bg\)/);
    expect(panel ?? "").toMatch(/border-left:\s*1px solid var\(--panel-border\)/);
    expect(panel ?? "").toMatch(/box-shadow:\s*var\(--panel-shadow\)/);
    // Frosted: the SAME glass surface for both panels, DOCKED (square
    // corners, no elevation shadow — --panel-shadow resolves to none).
    expect(css).toMatch(/--panel-bg:\s*var\(--glass-sidebar-bg\)/);
    expect(css).toMatch(/--tf-surface-rail:\s*var\(--glass-sidebar-bg\)/);
    expect(css).toMatch(/--tf-surface-panel:\s*var\(--glass-sidebar-bg\)/);
    expect(css).toMatch(/--panel-shadow:\s*none/);
  });

  it("the command bar's Open button is the accent primary at control height", () => {
    const open = findRuleBody(css, ".commandbar-open");
    expect(open).not.toBeNull();
    expect(open ?? "").toMatch(/height:\s*var\(--control-height\)/);
    expect(open ?? "").toMatch(/border-radius:\s*var\(--radius-control\)/);
  });

  it("the selected thumbnail is a thin accent outline + halo, not a blue rectangle", () => {
    const selected = findRuleBodies(css, ':root[data-theme="frosted"] .thumb-selected')
      .find((b) => /box-shadow:/.test(b));
    expect(selected).toBeDefined();
    expect(selected ?? "").toMatch(/0 0 0 2px var\(--glass-selected-border\)/);
    expect(selected ?? "").toMatch(/0 0 0 4px rgba\(37,\s*99,\s*235,\s*0\.15\)/);
    expect(selected ?? "").not.toMatch(/background:\s*rgba\(37,\s*99,\s*235,\s*0\.14\)/);
  });

  it("the design-token ladder (spacing / radii / control sizes) is declared", () => {
    for (const token of [
      "--space-micro",
      "--space-small",
      "--space-control",
      "--space-standard",
      "--space-section",
      "--space-major",
      "--radius-window",
      "--radius-panel",
      "--radius-group",
      "--radius-control",
      "--radius-pill",
      "--control-height",
      "--control-height-large",
      "--hit-target",
      "--panel-margin",
    ]) {
      expect(css).toMatch(new RegExp(`${token}\\s*:`));
    }
  });
});
