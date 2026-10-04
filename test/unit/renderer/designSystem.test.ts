// @vitest-environment jsdom
// Phase 96 (TFL-510 / chunk A) — the design-system contract.
//
// Pins docs/DESIGN-SYSTEM.md to the shipped CSS: every documented colour token
// family is declared in each of the three theme scopes (light `:root`, dark
// `:root[data-theme="dark"]`, frosted `:root[data-theme="frosted"]`) with its
// documented role, and the Phase-96 elevation ladder exists in every scope with
// the fixed surface -> depth mapping. Reads the stylesheet directly, mirroring
// test/unit/renderer/buttonTaxonomyContract.test.ts.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { FileText } from "lucide-react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "../../../src/renderer/components/EmptyState";

const REPO_ROOT = resolve(__dirname, "../../..");
const STYLES_PATH = resolve(REPO_ROOT, "src/renderer/styles.css");
const DOC_PATH = resolve(REPO_ROOT, "docs/DESIGN-SYSTEM.md");

const styles = readFileSync(STYLES_PATH, "utf8");
const doc = readFileSync(DOC_PATH, "utf8");
const clean = styles.replace(/\/\*[\s\S]*?\*\//g, "");

function themeBlock(source: string, selector: string): string {
  const start = source.indexOf(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

function vars(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of source.split(";")) {
    const m = decl.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/s);
    if (m !== null) out[m[1]] = m[2];
  }
  return out;
}

function resolveToken(
  name: string,
  theme: Record<string, string>,
  seen: readonly string[] = [],
): string | undefined {
  if (seen.includes(name)) return undefined;
  const raw = theme[name];
  if (raw === undefined) return undefined;
  const m = raw.match(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/);
  if (m === null) return raw;
  const resolved = resolveToken(m[1] ?? "", theme, [...seen, name]);
  return resolved ?? m[2]?.trim();
}

const LIGHT_BLOCK = themeBlock(clean, ":root {");
const DARK_BLOCK = themeBlock(clean, ':root[data-theme="dark"] {');
const FROST_BLOCK = themeBlock(clean, ':root[data-theme="frosted"] {');

const LIGHT = vars(LIGHT_BLOCK);
const DARK = { ...LIGHT, ...vars(DARK_BLOCK) };
const FROST = { ...LIGHT, ...vars(FROST_BLOCK) };

const ACCENT = [
  "--accent",
  "--accent-text",
  "--accent-hover",
  "--accent-pressed",
  "--accent-soft",
  "--accent-selected",
  "--accent-pressed-soft",
  "--accent-hover-bg",
  "--sem-primary",
] as const;

const SURFACES = [
  "--bg-base",
  "--bg-sunken",
  "--bg-raised",
  "--bg-toolbar",
  "--bg-rail",
  "--bg-canvas",
  "--bg-input",
  "--bg-secondary",
  "--bg-elevated",
  "--bg-panel",
  "--bg-hover",
  "--bg-active",
  "--bg-tab-active",
  "--menu-bg",
  "--panel-bg",
] as const;

const GLASS = [
  "--glass-bg",
  "--glass-border",
  "--glass-highlight",
  "--glass-shadow",
  "--glass-chrome-bg",
  "--glass-chrome-border",
  "--glass-sidebar-bg",
  "--glass-sidebar-border",
  "--glass-group-bg",
  "--glass-group-border",
  "--glass-hover-bg",
  "--glass-selected-bg",
  "--glass-selected-border",
] as const;

const TEXT = [
  "--fg-strong",
  "--fg",
  "--fg-soft",
  "--fg-muted",
  "--fg-faint",
  "--fg-disabled",
  "--fg-on-accent",
  "--fg-on-page",
] as const;

const BORDERS = ["--border", "--border-strong", "--border-subtle", "--divider"] as const;
const SEMANTIC = [
  "--info",
  "--info-soft",
  "--success",
  "--success-soft",
  "--warning",
  "--warning-soft",
  "--error",
  "--error-soft",
] as const;
const ROLES = ["--sem-neutral", "--sem-affirmative", "--sem-attention"] as const;
const INTERACTION = [
  "--select-fill",
  "--select-edge",
  "--select-glyph",
  "--focus-ring",
  "--hit",
  "--hit-active",
] as const;

const DOCUMENTED = Array.from(
  new Set<string>([
    ...ACCENT,
    ...SURFACES,
    ...GLASS,
    ...TEXT,
    ...BORDERS,
    ...SEMANTIC,
    ...ROLES,
    ...INTERACTION,
  ]),
);

const THEME_BLOCKS: ReadonlyArray<{ id: string; block: string }> = [
  { id: "light", block: LIGHT_BLOCK },
  { id: "dark", block: DARK_BLOCK },
  { id: "frosted", block: FROST_BLOCK },
];

describe("Phase 96 — the colour token families are declared in every theme scope", () => {
  for (const { id, block } of THEME_BLOCKS) {
    it(`declares every documented token in the ${id} block`, () => {
      const missing = DOCUMENTED.filter(
        (token) => !new RegExp(`${token}\\s*:`).test(block),
      );
      expect(missing, `${id} is missing: ${missing.join(", ")}`).toEqual([]);
    });
  }

  it("declares --glass-blur once, in the theme-independent :root scope", () => {
    expect(LIGHT_BLOCK).toMatch(/--glass-blur\s*:/);
    expect(DARK_BLOCK).not.toMatch(/--glass-blur\s*:/);
    expect(FROST_BLOCK).not.toMatch(/--glass-blur\s*:/);
  });

  it("names every documented token in the spec document", () => {
    const missing = DOCUMENTED.filter((token) => !doc.includes(token));
    expect(missing, `doc is missing: ${missing.join(", ")}`).toEqual([]);
    expect(doc).toContain("--glass-blur");
  });
});

describe("Phase 96 — documented roles resolve to their documented values", () => {
  it("keeps the one brand accent #7C3AED in light and frosted", () => {
    expect(resolveToken("--accent", LIGHT)).toBe("#7C3AED");
    expect(resolveToken("--accent", FROST)).toBe("#7C3AED");
  });

  it("keeps the dark accent INK the bright counterpart #A78BFA", () => {
    expect(resolveToken("--accent-text", DARK)).toBe("#A78BFA");
    expect(resolveToken("--sem-primary", DARK)).toBe("#A78BFA");
  });

  it("uses the deeper accent INK on the light frosted glass", () => {
    expect(resolveToken("--accent-text", FROST)).toBe("#6D28D9");
    expect(resolveToken("--sem-primary", FROST)).toBe("#6D28D9");
  });

  it("keeps the page-content ink theme-independent", () => {
    for (const map of [LIGHT, DARK, FROST]) {
      expect(resolveToken("--fg-on-page", map)).toBe("#0f172a");
    }
  });

  it("resolves the selection glyph to each theme's primary role", () => {
    for (const map of [LIGHT, DARK, FROST]) {
      expect(resolveToken("--select-glyph", map)).toBe(resolveToken("--sem-primary", map));
    }
  });
});

describe("Phase 96 — the elevation ladder and its surface mapping", () => {
  const LADDER = ["--elevation-1", "--elevation-2", "--elevation-3", "--elevation-4"] as const;
  const MAPPING: ReadonlyArray<readonly [string, string]> = [
    ["--shadow-page", "--elevation-1"],
    ["--shadow-menu", "--elevation-2"],
    ["--shadow-dialog", "--elevation-3"],
    ["--shadow-popover", "--elevation-2"],
    ["--shadow-toast", "--elevation-4"],
  ];

  for (const { id, block } of THEME_BLOCKS) {
    it(`declares the full ladder in the ${id} block`, () => {
      for (const step of LADDER) {
        expect(block, `${id} ${step}`).toMatch(new RegExp(`${step}\\s*:`));
      }
    });

    it(`re-points the named surface shadows onto the ladder in the ${id} block`, () => {
      const map = vars(block);
      for (const [shadow, step] of MAPPING) {
        expect(map[shadow], `${id} ${shadow}`).toBe(`var(${step})`);
      }
    });
  }

  it("maps chrome/toolbar/rail to flat (no shadow token)", () => {
    expect(clean).toMatch(/--panel-shadow:\s*none/);
    expect(doc).toContain("flat");
  });

  it("documents the ladder and the surface -> depth contract", () => {
    for (const step of LADDER) expect(doc).toContain(step);
    for (const phrase of ["level 1", "level 2", "level 3", "level 4", "popover", "dialog", "toast"]) {
      expect(doc).toContain(phrase);
    }
  });
});

describe("Phase 96 — the empty-state pattern is documented", () => {
  it("names the hero mark + headline + help pattern for chunk D", () => {
    for (const phrase of ["hero mark", "headline", "help"]) {
      expect(doc).toContain(phrase);
    }
    expect(doc).toContain("--tf-icon-size-hero");
  });
});

// DEF-528 — the durable source-contract guard. The prior oracle asserted the
// Icon SVG's `width` ATTRIBUTE (32), not the rendered CSS size, so it missed
// that the Phase-94 surface svg group (`.command-palette svg`,
// `.context-panel svg`, ... = 18px) overrode that attribute and the mark
// shipped at 17-18px. TFL-645 then added a stylesheet rule whose selector
// (`.empty-state .empty-state-mark svg`) matched nothing at all, because the
// Icon wrapper renders lucide's SVG root directly and `.empty-state-mark` IS
// that svg. This suite therefore (a) mounts the real EmptyState and asserts the
// hero selector actually matches the rendered DOM, and (b) reads the
// stylesheet to pin the override rule and its specificity over the chrome
// group.

/** The declaration block of the rule whose selector list includes `selector`
 *  (matched after normalizing whitespace, so list members compare equal). */
function cssRuleBody(source: string, selector: string): string | undefined {
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "")
      .split(",")
      .map((part) => part.replace(/\s+/g, " ").trim());
    if (selectors.includes(selector)) return match[2];
  }
  return undefined;
}

/** The (ids, classes+attrs+pseudo-classes, elements) specificity triple. */
function selectorSpecificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes =
    (selector.match(/\.[\w-]+/g) ?? []).length +
    (selector.match(/\[[^\]]+\]/g) ?? []).length +
    (selector.match(/:(?!:)[\w-]+/g) ?? []).length;
  const elements = (selector.match(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g) ?? []).length;
  return [ids, classes, elements];
}

/** True when `a` outranks `b` under the CSS specificity cascade. */
function outranks(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < 3; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

describe("Phase 96-D / DEF-528 — the empty-state hero mark overrides the chrome icon floor", () => {
  const HERO_SELECTOR = ".empty-state .empty-state-mark";
  const CHROME_SELECTORS = [".command-palette svg", ".context-panel svg"] as const;

  it("HERO_SELECTOR matches the rendered EmptyState root SVG, not a phantom descendant", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act((): void => {
        root.render(createElement(EmptyState, { icon: FileText, headline: "No files" }));
      });
      const mark = container.querySelector(".empty-state-mark");
      expect(mark, ".empty-state-mark is rendered").not.toBeNull();
      expect(mark?.tagName.toLowerCase(), "the Icon wrapper renders the SVG root").toBe("svg");
      expect(
        mark?.matches(HERO_SELECTOR),
        `${HERO_SELECTOR} must select the rendered mark`,
      ).toBe(true);
      // The dead TFL-645 selector `.empty-state .empty-state-mark svg` required a
      // descendant svg; the mark IS the svg, so it must not match. This guards
      // against silently regressing to the no-op that shipped in TFL-645.
      expect(
        mark?.matches(".empty-state .empty-state-mark svg"),
        "the descendant-svg selector is dead and must not match",
      ).toBe(false);
    } finally {
      act((): void => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("declares the hero override with all four dimensions on --tf-icon-size-hero", () => {
    const body = cssRuleBody(clean, HERO_SELECTOR);
    expect(body, `${HERO_SELECTOR} rule is missing`).toBeDefined();
    const rule = body ?? "";
    for (const prop of ["width", "height", "min-width", "min-height"]) {
      expect(rule, `${HERO_SELECTOR} ${prop}`).toMatch(
        new RegExp(`${prop}\\s*:\\s*var\\(--tf-icon-size-hero\\s*\\)`),
      );
    }
  });

  it("outranks every chrome surface selector that pins the glyph to 18px", () => {
    const hero = selectorSpecificity(HERO_SELECTOR);
    for (const chrome of CHROME_SELECTORS) {
      expect(cssRuleBody(clean, chrome), `${chrome} rule is missing`).toBeDefined();
      const chromeSpec = selectorSpecificity(chrome);
      expect(
        outranks(hero, chromeSpec),
        `${HERO_SELECTOR} (${hero.join(",")}) must outrank ${chrome} (${chromeSpec.join(",")})`,
      ).toBe(true);
    }
  });

  it("keeps the 18px chrome floor intact for normal icons", () => {
    for (const chrome of CHROME_SELECTORS) {
      expect(cssRuleBody(clean, chrome) ?? "").toMatch(
        /(?:^|[\s;])width\s*:\s*var\(--tf-icon-size\)\s*;/,
      );
    }
  });
});
