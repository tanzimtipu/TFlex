// DEF-664 — the dock's EDIT-mode remove badge must keep its red fill and
// on-accent glyph while HOVERED and PRESSED.
//
// The badge is a `<span class="btn btn-ghost btn-compact action-dock-minus"
// role="button">` (ActionDock.tsx:1376), so the canonical button family
// out-specifies the legacy `.action-dock-minus:hover { transform: scale(1.12) }`
// rule: `.btn-ghost:hover:not([disabled]):not([aria-disabled="true"])` (0,4,0)
// repaints `background: var(--bg-hover)` over the badge's red fill, hiding it.
// The DEF-664 block re-pins the badge paint at (0,5,0) — same pattern the Home
// remove badge uses. This is the no-browser static twin of that interaction.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SHIPPED_CSS = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  selectors: string[];
  body: string;
}

function rulesFor(css: string): Rule[] {
  return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({
    selectors: (m[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    body: m[2] ?? "",
  }));
}

/** A complete class token, so `.btn` never matches `.btn-ghost` and
 *  `.action-dock-minus` never matches a longer hyphenated class. */
function hasClass(selector: string, cls: string): boolean {
  return new RegExp(`\\.${cls}(?![\\w-])`).test(selector);
}

function decl(body: string, prop: string): string | null {
  const m = body.match(new RegExp(`(?:^|[\\s;])${prop}\\s*:\\s*([^;]+);`));
  return m ? (m[1] ?? "").trim() : null;
}

const HOVER_GUARDS = [":not([disabled])", ':not([aria-disabled="true"])'];

function isBadgeHover(selector: string): boolean {
  return (
    hasClass(selector, "action-dock-minus") &&
    hasClass(selector, "btn") &&
    /:hover/.test(selector) &&
    HOVER_GUARDS.every((g) => selector.includes(g))
  );
}

function hoverRule(css: string = SHIPPED_CSS): Rule | undefined {
  return rulesFor(css).find((r) => r.selectors.some(isBadgeHover));
}

function activeRule(css: string = SHIPPED_CSS): Rule | undefined {
  return rulesFor(css).find((r) =>
    r.selectors.some(
      (s) =>
        hasClass(s, "action-dock-minus") &&
        hasClass(s, "btn") &&
        /:active/.test(s) &&
        HOVER_GUARDS.every((g) => s.includes(g)),
    ),
  );
}

/** (id, class+attribute+pseudo-class, element) specificity of one selector.
 *  `:not()` adds nothing itself; its argument's own attributes count. */
function specificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+/g) ?? []).length;
  const attrs = (selector.match(/\[[^\]]*\]/g) ?? []).length;
  const pseudoClasses = (selector.match(/(?<!:):[\w-]+/g) ?? []).filter((p) => p !== ":not").length;
  const elements = (selector.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return [ids, classes + attrs + pseudoClasses, elements];
}

function gte(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

const CANONICAL_GHOST_HOVER = '.btn-ghost:hover:not([disabled]):not([aria-disabled="true"])';

const DEF664_HOVER_SELECTOR = '.action-dock-minus.btn:hover:not([disabled]):not([aria-disabled="true"])';
const DEF664_ACTIVE_SELECTOR = '.action-dock-minus.btn:active:not([disabled]):not([aria-disabled="true"])';

const DEF664_BLOCK = new RegExp(
  `${DEF664_HOVER_SELECTOR.replace(/[.()[\]="]/g, "\\$&")}\\s*\\{[^{}]*\\}\\s*` +
    `${DEF664_ACTIVE_SELECTOR.replace(/[.()[\]="]/g, "\\$&")}\\s*\\{[^{}]*\\}`,
);

describe("DEF-664 — dock minus badge hover/active keep the attention paint", () => {
  it("re-pins the fill, ink and scale on hover over the canonical .btn film", () => {
    const rule = hoverRule();
    expect(rule, "a .action-dock-minus.btn:hover guard rule exists").toBeDefined();
    const body = rule?.body ?? "";
    expect(decl(body, "background")).toContain("--sem-attention");
    expect(decl(body, "color")).toBe("var(--fg-on-accent)");
    expect(decl(body, "transform")).toBe("scale(1.12)");
  });

  it("re-pins the fill and neutralises the lift on active", () => {
    const rule = activeRule();
    expect(rule, "a .action-dock-minus.btn:active guard rule exists").toBeDefined();
    const body = rule?.body ?? "";
    expect(decl(body, "background")).toContain("--sem-attention");
    expect(decl(body, "color")).toBe("var(--fg-on-accent)");
    expect(decl(body, "transform")).toBe("none");
  });

  it("out-specifies the canonical ghost hover it must override", () => {
    const selector = hoverRule()?.selectors.find(isBadgeHover) ?? "";
    expect(selector).not.toBe("");
    expect(gte(specificity(selector), specificity(CANONICAL_GHOST_HOVER)), `${selector} >= ${CANONICAL_GHOST_HOVER}`).toBe(
      true,
    );
    expect(specificity(selector)).toEqual([0, 5, 0]);
    expect(specificity(CANONICAL_GHOST_HOVER)).toEqual([0, 4, 0]);
  });

  it("fails against the pre-fix sheet (guard catches the missing re-pin)", () => {
    const preFix = SHIPPED_CSS.replace(DEF664_BLOCK, "");
    expect(preFix, "the DEF-664 block is present and removable").not.toBe(SHIPPED_CSS);
    expect(hoverRule(preFix), "no hover guard before the fix").toBeUndefined();
  });
});
