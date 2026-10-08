// @vitest-environment node
//
// Phase 100 (feature A) — foundation mirrors contract.
//
// The CSS token layer in src/renderer/styles.css is the single source of truth
// for typography, spacing, radii and elevation; src/renderer/design/* are the
// typed mirrors a feature imports. This suite parses the :root block (the same
// read/parse pattern as animationsTokens.test.ts) and fails if any constant
// drifts, asserts the --space-* / --tf-radius-* aliases point at the canonical
// tokens, and asserts three-scope colour parity for every role in color.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  COLOR_ROLES,
  ELEVATION,
  FONT_FAMILIES,
  FONT_SIZES,
  RADII,
  RADIUS,
  SHADOW_ROLE,
  SPACE,
  SPACING,
  TYPE_ROLES,
} from "../../../src/renderer/design";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
// Comments are stripped first so a token name mentioned in prose can never be
// mistaken for a declaration.
const CSS = readFileSync(
  join(REPO_ROOT, "src", "renderer", "styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** Extract a top-level block body by selector (stops at the closing-brace line). */
function block(selector: string): string {
  const re = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`);
  return re.exec(CSS)?.[1] ?? "";
}

/** CSS custom-property name -> raw declaration value for a block body. */
function decls(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    map.set(`--${m[1]}`, m[2].trim());
  }
  return map;
}

const root = decls(block(":root"));
const dark = decls(block(':root\\[data-theme="dark"\\]'));
const frosted = decls(block(':root\\[data-theme="frosted"\\]'));

/** A required token value, or a loud failure naming the missing token. */
function token(map: Map<string, string>, name: string): string {
  const value = map.get(name);
  expect(value, `token ${name} missing from its block`).toBeDefined();
  return value as string;
}

const px = (value: string): number => Number(value.replace("px", ""));

/** Resolve one level of var(--x) against the :root map. */
function resolve(value: string): string {
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  return m ? token(root, m[1]) : value;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

describe("foundation mirrors — typography.ts", () => {
  it("mirrors the --font-* stacks exactly", () => {
    expect(FONT_FAMILIES.sans).toBe(token(root, "--font-sans"));
    expect(FONT_FAMILIES.mono).toBe(token(root, "--font-mono"));
    expect(FONT_FAMILIES.ui).toBe(token(root, "--font-ui"));
  });

  it("mirrors the --fs-* type scale in px (resolving the Phase 110 aliases)", () => {
    expect(FONT_SIZES.xs).toBe(px(resolve(token(root, "--fs-xs"))));
    expect(FONT_SIZES.sm).toBe(px(resolve(token(root, "--fs-sm"))));
    expect(FONT_SIZES.md).toBe(px(resolve(token(root, "--fs-md"))));
    expect(FONT_SIZES.lg).toBe(px(resolve(token(root, "--fs-lg"))));
    expect(FONT_SIZES.xl).toBe(px(resolve(token(root, "--fs-xl"))));
    expect(FONT_SIZES["2xl"]).toBe(px(resolve(token(root, "--fs-2xl"))));
  });

  it("mirrors the eight --type-* semantic roles (size / line-height / weight)", () => {
    for (const [role, spec] of Object.entries(TYPE_ROLES)) {
      expect(spec.size, `${role} size`).toBe(px(token(root, `--type-${role}-size`)));
      expect(spec.lineHeight, `${role} line-height`).toBe(
        px(token(root, `--type-${role}-line`)),
      );
      expect(spec.weight, `${role} weight`).toBe(
        Number(token(root, `--type-${role}-weight`)),
      );
    }
  });
});

describe("foundation mirrors — spacing.ts", () => {
  it("mirrors the canonical --sp-1..6 grid in px", () => {
    for (const step of [1, 2, 3, 4, 5, 6] as const) {
      expect(SPACING[step]).toBe(px(token(root, `--sp-${step}`)));
    }
  });

  it("maps the named rhythm onto the canonical grid", () => {
    expect(SPACE.micro).toBe(SPACING[1]);
    expect(SPACE.small).toBe(SPACING[2]);
    expect(SPACE.control).toBe(SPACING[3]);
    expect(SPACE.standard).toBe(SPACING[4]);
    expect(SPACE.section).toBe(SPACING[5]);
    expect(SPACE.major).toBe(SPACING[6]);
  });

  it("declares --space-* as aliases of the canonical --sp-* tokens", () => {
    const expected: Array<[string, Step]> = [
      ["micro", 1],
      ["small", 2],
      ["control", 3],
      ["standard", 4],
      ["section", 5],
      ["major", 6],
    ];
    for (const [name, step] of expected) {
      const raw = token(root, `--space-${name}`);
      expect(raw, `--space-${name} must be an alias, not a literal`).toBe(`var(--sp-${step})`);
      expect(px(resolve(raw)), `--space-${name} resolved value changed`).toBe(SPACING[step]);
    }
  });
});

describe("foundation mirrors — radii.ts", () => {
  it("mirrors the --radius-1..3 density ladder in px", () => {
    for (const step of [1, 2, 3] as const) {
      expect(RADII[step]).toBe(px(token(root, `--radius-${step}`)));
    }
  });

  it("mirrors the named hierarchy radii in px", () => {
    expect(RADIUS.window).toBe(px(token(root, "--radius-window")));
    expect(RADIUS.panel).toBe(px(token(root, "--radius-panel")));
    expect(RADIUS.group).toBe(px(token(root, "--radius-group")));
    expect(RADIUS.control).toBe(px(token(root, "--radius-control")));
    expect(RADIUS.pill).toBe(px(token(root, "--radius-pill")));
  });

  it("declares --tf-radius-* as aliases whose resolved values are unchanged", () => {
    // --tf-radius-lg was 10px and feeds the dialog/sheet corner, so its
    // canonical target is --radius-dialog (10px) — NOT --radius-3 (8px),
    // which would have changed the resolved value.
    const cases: Array<[string, string, number]> = [
      ["--tf-radius-sm", "--radius-2", RADII[2]],
      ["--tf-radius-md", "--radius-3", RADII[3]],
      ["--tf-radius-lg", "--radius-dialog", RADIUS.control],
    ];
    for (const [alias, target, value] of cases) {
      const raw = token(root, alias);
      expect(raw, `${alias} must be an alias, not a literal`).toBe(`var(${target})`);
      expect(px(resolve(raw)), `${alias} resolved value changed`).toBe(value);
    }
  });
});

describe("foundation mirrors — elevation.ts", () => {
  it("mirrors the four --elevation-* shadow strings exactly", () => {
    for (const step of [1, 2, 3, 4] as const) {
      expect(ELEVATION[step]).toBe(token(root, `--elevation-${step}`));
    }
  });

  it("maps every named --shadow-* role onto the ladder", () => {
    expect(SHADOW_ROLE.page).toBe(token(root, "--shadow-page"));
    expect(SHADOW_ROLE.menu).toBe(token(root, "--shadow-menu"));
    expect(SHADOW_ROLE.dialog).toBe(token(root, "--shadow-dialog"));
    expect(SHADOW_ROLE.popover).toBe(token(root, "--shadow-popover"));
    expect(SHADOW_ROLE.toast).toBe(token(root, "--shadow-toast"));
  });
});

describe("foundation mirrors — color.ts three-scope parity", () => {
  const roles = Object.values(COLOR_ROLES);

  it("names semantic roles as CSS custom properties (never values)", () => {
    for (const role of roles) {
      expect(role).toMatch(/^--[a-z0-9-]+$/);
    }
  });

  it("declares every role in :root, dark and frosted", () => {
    for (const role of roles) {
      for (const [scope, map] of [
        [":root", root],
        ['[data-theme="dark"]', dark],
        ['[data-theme="frosted"]', frosted],
      ] as const) {
        expect(map.has(role), `${role} missing from ${scope}`).toBe(true);
      }
    }
  });
});

// TFL-1241 (TFL-1216 chunk C8) - the general semantic FEEDBACK palette. Light
// and dark mirror the icon ink state signals; frosted (a light acrylic surface)
// mirrors the light values. The Activity Shelf's success / danger roles consume
// these WITHOUT touching the shared --success / --error tokens other categories
// still use.
describe("foundation mirrors — feedback palette (TFL-1241)", () => {
  const shelf = decls(block(".activity-shelf"));

  it("pins the feedback success / danger tokens in all three scopes", () => {
    expect(token(root, "--feedback-success")).toBe("#25754A");
    expect(token(root, "--feedback-danger")).toBe("#B82E43");
    expect(token(dark, "--feedback-success")).toBe("#85D3A6");
    expect(token(dark, "--feedback-danger")).toBe("#FF9AAD");
    expect(token(frosted, "--feedback-success")).toBe("#25754A");
    expect(token(frosted, "--feedback-danger")).toBe("#B82E43");
  });

  it("points the shelf success / danger roles at the feedback tokens", () => {
    expect(shelf.get("--activity-success")).toBe("var(--feedback-success)");
    expect(shelf.get("--activity-danger")).toBe("var(--feedback-danger)");
  });

  it("leaves the shared --success / --error values untouched", () => {
    expect(token(root, "--success")).toBe("#76a66a");
    expect(token(root, "--error")).toBe("#d96c63");
  });
});

describe("foundation barrel — re-export, never copy", () => {
  it("exposes the motion and icon single sources through src/renderer/design", async () => {
    const design = await import("../../../src/renderer/design");
    expect(design.MOTION_DURATION.micro).toBe(150);
    expect(design.MOTION_THEME_CROSSFADE).toBe(400);
    expect(design.ICON_SIZES.md).toBe(18);
    expect(design.ICON_SIZES.xxl).toBe(24);
    expect(design.ICON_STROKE).toBe(1.65);
    expect(design.ICON_STROKE_BOLD).toBe(3);
    expect(design.colorVar("primary")).toBe("var(--sem-primary)");
  });
});
