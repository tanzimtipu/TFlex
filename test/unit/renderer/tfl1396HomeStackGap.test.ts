// @vitest-environment node
//
// TFL-1396 (Phase 121 chunk A) — minimum-stack-gap source contract.
//
// The Home hero stacks the editable tool row above the intake drop zone. The
// enforced minimum vertical gap between two stacked sibling regions is the one
// named token `--space-stack-min` (resolves to `--sp-4`, 16px), mirrored in TS
// as `STACK_GAP_MIN`. This suite parses the `:root` block of styles.css (the
// same read/parse pattern as foundationMirrors.test.ts) and fails if the token
// drifts to a literal, `--sp-4` moves off 16px, `.welcome-intake` stops
// consuming the token (or hardcodes a raw px gap), or the TS mirror diverges.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SPACING, STACK_GAP_MIN } from "../../../src/renderer/design";

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

describe("TFL-1396 — minimum-stack-gap token (styles.css)", () => {
  it("declares --space-stack-min in :root as a var(--sp-4) alias", () => {
    expect(root.get("--space-stack-min")).toBe("var(--sp-4)");
  });

  it("pins --sp-4 in :root to 16px", () => {
    expect(root.get("--sp-4")).toBe("16px");
  });

  it("makes .welcome-intake consume the token with no raw px gap", () => {
    const body = block("\\.welcome-intake");
    expect(body, ".welcome-intake rule missing from styles.css").not.toBe("");

    const margin = /margin-top\s*:\s*([^;]+);/.exec(body);
    expect(margin, ".welcome-intake must declare margin-top").not.toBeNull();
    const value = (margin?.[1] ?? "").trim();

    expect(value).toBe("var(--space-stack-min)");
    expect(value, ".welcome-intake gap must not hardcode a raw px value").not.toMatch(
      /\d+px/,
    );
  });
});

describe("TFL-1396 — STACK_GAP_MIN TS mirror (spacing.ts)", () => {
  it("mirrors the canonical --sp-4 step", () => {
    expect(STACK_GAP_MIN).toBe(SPACING[4]);
  });

  it("resolves to 16px", () => {
    expect(STACK_GAP_MIN).toBe(16);
  });
});
