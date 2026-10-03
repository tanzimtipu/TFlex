// Phase 95 (chunk B) — the dock's EDIT-mode remove badge must be STRUCTURALLY
// contained inside its verb's border box, so no clipping ancestor (the dock
// itself, or the lane's `[data-dock-scroll]`) can ever cut it.
//
// The pre-fix stylesheet parked the 16x16 badge at `top:-5px; right:-5px`,
// overhanging its verb by 5px on the top and the right. In the arrows lane the
// scroller's computed `overflow-y:auto` then clipped that 5px strip off EVERY
// badge (qa measured `stripEscape.top=+5`). The fix removes the negative
// overhang (Phase 95 ruling 2): the badge now lives inside the verb's padding
// box at `top:0; right:0`, so the verb — already a contained flex item — carries
// the badge with it.
//
// DEF-517 hardening — the first cut of this guard read only the FIRST
// `.action-dock-minus` rule and only the `top`/`right` longhands, so a later
// duplicate rule, an EDIT-scoped override, the `inset` shorthand, `!important`
// or a `var()`-resolved value could smuggle the negative overhang back while all
// four tests stayed green (adversary probe adv546_guard_defeat.cjs, mutations
// M1-M5). This suite now scans EVERY rule that targets `.action-dock-minus`
// (all matches, never the first) and resolves shorthands, `!important` and
// custom properties before asserting that no offset is negative.
//
// DEF-518 — the same suite also pins the hover headroom: `overflow-x:auto`
// forces the lane scroller's computed `overflow-y:auto`, so a hovered verb
// (lift 2px) plus its badge's `:hover` scale (~1px) must not re-clip the badge.
//
// The runtime geometry oracle is `e2e/phase95_dock_edit_overflow.spec.cjs`
// (qa-owned). This test is the no-browser static twin.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SHIPPED_CSS = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** The shipped sheet under its historical name: the four pre-existing tests pin
 *  specific blocks and stay untouched. */
const CSS = SHIPPED_CSS;

interface Rule {
  selectors: string[];
  body: string;
}

/** Every rule of an arbitrary sheet, flattened. An `@media` wrapper is
 *  harmless: the inner rule's own comma-separated selector list is what gets
 *  captured, so a grouped rule is still matched by its individual selectors. */
function rulesFor(css: string): Rule[] {
  return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({
    selectors: (m[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    body: m[2] ?? "",
  }));
}

/** The shipped sheet's rules, flattened once for the structural assertions. */
const RULES: Rule[] = rulesFor(CSS);

/** Matches `.action-dock-minus` as a complete class token inside a selector:
 *  the bare class, a pseudo variant (`.action-dock-minus:hover`) or a
 *  descendant/compound selector (`.action-dock[...] .action-dock-minus`). */
const MINUS_CLASS = /(^|[^\w-])\.action-dock-minus(?![\w-])/;

/** ALL rules that target `.action-dock-minus` in `css` — never just the first.
 *  Defaults to the shipped sheet; the DEF-517 mutation test feeds a hostile
 *  `SHIPPED_CSS + mutation` string. */
function minusRules(css: string = CSS): Rule[] {
  return rulesFor(css).filter((r) => r.selectors.some((s) => MINUS_CLASS.test(s)));
}

/** The FIRST rule body whose selector matches EXACTLY `selector` (used by the
 *  structural tests that pin one specific block). */
function ruleBody(selector: string): string {
  const start = CSS.indexOf(selector);
  expect(start, `selector present: ${selector}`).toBeGreaterThanOrEqual(0);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open + 1, close);
}

/** Every rule body whose selector list contains `selector` exactly. */
function allBodies(selector: string): string[] {
  return RULES.filter((r) => r.selectors.includes(selector)).map((r) => r.body);
}

interface Decl {
  prop: string;
  value: string;
  important: boolean;
}

/** Declarations of a rule body, with `!important` stripped and flagged. */
function decls(body: string): Decl[] {
  return body
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s): Decl | null => {
      const i = s.indexOf(":");
      if (i < 0) return null;
      const prop = s.slice(0, i).trim().toLowerCase();
      let value = s.slice(i + 1).trim();
      let important = false;
      const bang = value.match(/!\s*important\s*$/i);
      if (bang !== null && bang.index !== undefined) {
        important = true;
        value = value.slice(0, bang.index).trim();
      }
      return { prop, value, important };
    })
    .filter((d): d is Decl => d !== null);
}

/** The value of `prop` in a declaration body (null when absent). `prop` is
 *  anchored so `top` never matches `padding-top` and `right` never matches
 *  `padding-right`. */
function decl(body: string, prop: string): string | null {
  const m = body.match(new RegExp(`(?:^|[\\s;])${prop}\\s*:\\s*([^;]+);`));
  return m ? (m[1] ?? "").trim() : null;
}

/** Custom properties declared anywhere in `css`, for `var()` resolution. The
 *  badge's own offsets must not be able to hide a negative overhang behind a
 *  token, so every declared `--x` in the scanned sheet is available to the
 *  resolver. */
function varsFor(css: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const rule of rulesFor(css)) {
    for (const d of decls(rule.body)) {
      if (d.prop.startsWith("--")) vars.set(d.prop, d.value);
    }
  }
  return vars;
}

/** Resolve `var()` references (with fallbacks) recursively against `css`, the
 *  sheet the value was pulled from. An unresolvable reference resolves to
 *  `auto`, the initial inset value, which is not a negative length. */
function resolveVarsFor(css: string, value: string, depth = 0, vars = varsFor(css)): string {
  if (depth > 12) return value;
  return value.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g,
    (_all, name: string, fallback: string | undefined) => {
      const raw = vars.get(name);
      if (raw !== undefined) return resolveVarsFor(css, raw, depth + 1, vars);
      if (fallback !== undefined) return resolveVarsFor(css, fallback.trim(), depth + 1, vars);
      return "auto";
    },
  );
}

/** A length in px (sign optional), or null when the value is not an arithmetic
 *  combination of px lengths (e.g. `auto`). `calc()` supports `+`/`-` sums of
 *  px terms, enough for a token-derived offset. `var()` tokens resolve against
 *  the same `css` sheet the value came from. */
function px(value: string, css: string = CSS): number | null {
  const v = resolveVarsFor(css, value).trim();
  const calc = v.match(/^calc\((.+)\)$/);
  if (calc !== null) {
    const expr = calc[1] ?? "";
    if (!/^[\s\d.+\-px]*$/.test(expr)) return null;
    const terms = expr.match(/[-+]?\s*\d*\.?\d+px/g);
    if (terms === null) return null;
    return terms.reduce((sum, t) => sum + Number.parseFloat(t.replace(/\s+/g, "")), 0);
  }
  const plain = v.match(/^(-?\d*\.?\d+)(?:px)?$/);
  return plain ? Number.parseFloat(plain[1] ?? "NaN") : null;
}

/** Expand a CSS box shorthand's 1-4 values to [top, right, bottom, left]. */
function expandBox(values: readonly string[]): string[] {
  const v = [...values];
  if (v.length === 1) return [v[0] ?? "", v[0] ?? "", v[0] ?? "", v[0] ?? ""];
  if (v.length === 2) return [v[0] ?? "", v[1] ?? "", v[0] ?? "", v[1] ?? ""];
  if (v.length === 3) return [v[0] ?? "", v[1] ?? "", v[2] ?? "", v[1] ?? ""];
  return [v[0] ?? "", v[1] ?? "", v[2] ?? "", v[3] ?? ""];
}

const INSET_LONGHANDS = new Set([
  "top",
  "right",
  "bottom",
  "left",
  "inset-block-start",
  "inset-block-end",
  "inset-inline-start",
  "inset-inline-end",
]);
const INSET_SHORTHANDS = new Set(["inset", "inset-block", "inset-inline"]);

/** Every numeric inset a `.action-dock-minus` rule declares in `css`, resolved
 *  through `var()`, `!important` and the `inset` family of shorthands. */
function badgeInsets(css: string = CSS): number[] {
  const nums: number[] = [];
  for (const rule of minusRules(css)) {
    for (const d of decls(rule.body)) {
      if (INSET_LONGHANDS.has(d.prop)) {
        const n = px(d.value, css);
        if (n !== null) nums.push(n);
      } else if (INSET_SHORTHANDS.has(d.prop)) {
        const parts = d.value.split(/\s+/).filter((p) => p.length > 0);
        const expanded =
          d.prop === "inset" ? expandBox(parts) : parts.length === 1 ? [parts[0] ?? "", parts[0] ?? ""] : parts.slice(0, 2);
        for (const part of expanded) {
          const n = px(part, css);
          if (n !== null) nums.push(n);
        }
      }
    }
  }
  return nums;
}

describe("Phase 95-B — the minus badge cannot overhang its verb", () => {
  it("declares NO negative inset on ANY matching rule (all rules, not just the first)", () => {
    // The badge is still an absolutely positioned, positively sized corner box.
    const base = ruleBody(".action-dock-minus {");
    expect(base).toMatch(/position:\s*absolute/);
    const width = decl(base, "width");
    expect(Number.parseFloat(width ?? "NaN")).toBeGreaterThan(0);
    expect(minusRules().length, "at least one .action-dock-minus rule").toBeGreaterThan(0);
    // Every offset from EVERY matching rule — longhand, `inset` shorthand,
    // `!important`, `var()`-resolved — must be non-negative. The pre-fix `-5px`
    // overhang is exactly what the lane clipped; ANY negative inset re-opens it.
    const insets = badgeInsets();
    expect(insets.length, "the badge declares an explicit inset").toBeGreaterThan(0);
    for (const n of insets) {
      expect(n, `badge inset must not be negative (got ${n}px)`).toBeGreaterThanOrEqual(0);
    }
  });

  it("is positioned against a verb that reserves the badge's box", () => {
    const minus = ruleBody(".action-dock-minus {");
    const verb = ruleBody(".action-dock-verb {");
    // The badge's containing block is the verb; it must be a positioned box and
    // must not itself clip (a `hidden`/`clip` verb would cut a corner badge).
    expect(verb).toMatch(/position:\s*relative/);
    expect(verb).not.toMatch(/overflow\s*:\s*(?:hidden|clip)/);
    const size = decl(minus, "width");
    expect(Number.parseFloat(size ?? "NaN")).toBeGreaterThan(0);
  });

  it("declares no clipping overflow on any EXPANDED dock ancestor", () => {
    // The dock root must not clip its own row (the badge rides inside a verb).
    const dock = ruleBody(".action-dock {");
    expect(dock).not.toMatch(/overflow\s*:\s*(?:hidden|clip)/);
    // No EDIT-mode-scoped dock rule may introduce a clipping box around the
    // verbs: that would be hiding the overhang by widening/disabling a clipper
    // rather than fixing the badge geometry (the explicit Phase 95 DO NOT).
    for (const body of allBodies(".action-dock[data-dock-edit='true'] .action-dock-verb")) {
      expect(body).not.toMatch(/overflow\s*:\s*(?:hidden|clip|auto|scroll)/);
    }
  });

  it("keeps the lane scroller's clip legitimate and gives the hovered badge headroom (DEF-518)", () => {
    // DEF-341 requires the lane to own the overflow; Phase 95 must not touch it.
    const lane = ruleBody(".action-dock[data-dock-arrows-lane='true'] .action-dock-scroll {");
    expect(lane).toMatch(/overflow-x:\s*auto/);
    const item = ruleBody(".action-dock[data-dock-arrows-lane='true'] .action-dock-scroll > * {");
    expect(item).toMatch(/flex:\s*0 0 auto/);
    expect(lane).toMatch(/justify-content:\s*flex-start/);
    // DEF-518 — `overflow-x:auto` forces computed `overflow-y:auto`, so this
    // scroller clips vertically. A hovered verb lifts the badge and the badge's
    // own `:hover` scale grows it, so the scroller must either reserve positive
    // top padding (headroom) or the edit-lane verb hover lift must be
    // suppressed. One of the two must hold; a bare clip is the defect.
    const headroom = px(decl(lane, "padding-top") ?? "");
    const suppressed = RULES.some(
      (r) =>
        r.selectors.some(
          (s) =>
            /data-dock-edit/.test(s) && /data-dock-arrows-lane/.test(s) && /\.action-dock-verb:hover/.test(s),
        ) && /transform\s*:\s*none/.test(r.body),
    );
    expect(
      headroom !== null && headroom > 0 ? true : suppressed,
      "DEF-518: the lane scroller needs positive top headroom or a suppressed edit-lane hover lift",
    ).toBe(true);
  });

  it("catches each hostile mutation that re-introduces a negative badge inset (DEF-517)", () => {
    // DEF-517 evidence gap: the guard is hardened in this file, but nothing
    // committed proved it CATCHES a re-introduced overhang. These six inputs are
    // copied VERBATIM from test-fixtures/phase95-adversary/adv546_guard_defeat.cjs
    // (shipped baseline plus M1-M5) and fed through the guard's OWN inset
    // predicate, `badgeInsets`, as `SHIPPED_CSS + mutation`. The pristine sheet
    // must NOT trip the predicate (no false positive); every mutation must.
    const mutations: ReadonlyArray<readonly [string, string]> = [
      ["M1 duplicate unscoped rule", ".action-dock-minus { top: -5px; right: -5px; }"],
      [
        "M2 EDIT-scoped override",
        ".action-dock[data-dock-edit='true'] .action-dock-minus { top: -5px; right: -5px; }",
      ],
      ["M3 inset shorthand", ".action-dock-minus { inset: -5px -5px auto auto; }"],
      ["M4 !important offset", ".action-dock-minus { top: -5px !important; right: -5px !important; }"],
      [
        "M5 negative custom property",
        ":root { --adv-badge-overhang: -5px; } .action-dock-minus { top: var(--adv-badge-overhang); }",
      ],
    ];

    const baseline = badgeInsets(SHIPPED_CSS);
    expect(baseline.length, "the shipped badge declares an explicit inset").toBeGreaterThan(0);
    for (const n of baseline) {
      expect(n, `shipped baseline must have no negative inset (got ${n}px)`).toBeGreaterThanOrEqual(0);
    }
    expect(baseline.some((n) => n < 0), "baseline must not be a false positive").toBe(false);

    for (const [name, mutation] of mutations) {
      const insets = badgeInsets(`${SHIPPED_CSS}\n${mutation}`);
      expect(
        insets.some((n) => n < 0),
        `DEF-517 guard must catch ${name} as a negative .action-dock-minus inset`,
      ).toBe(true);
    }
  });
});

