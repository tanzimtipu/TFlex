// Phase 41 (operator items 1, 3, 4) — the Inspector surface, the professional
// selection treatment and the separators.
//
// These pin the CSS contracts by reading the real stylesheet:
//   - item 1: the Inspector is OPAQUE in every theme/stage (on frosted the
//     glass film is composited over an opaque base) and isolated above the
//     canvas; no per-stage override exists.
//   - item 3: the text panel's active option and the thumbnail's selected page
//     share ONE selection token trio (--select-fill / --select-edge /
//     --select-glyph); no solid accent slab remains.
//   - item 4: the side rail / ContextPanel boundary is the neutral --divider
//     hairline, and the Inspector's page-facing edge is a neutral glow, not the
//     Phase-40 --sem-primary line.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** All bodies of `selector { ... }`, in sheet order. */
function ruleBodies(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bodies: string[] = [];
  const needle = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g");
  let m: RegExpExecArray | null;
  while ((m = needle.exec(CSS)) !== null) bodies.push(m[1]);
  return bodies;
}

function ruleBody(selector: string): string {
  return ruleBodies(selector).join("\n");
}

/** Bodies of a theme-scoped selector. */
function themeRuleBodies(theme: string, selector: string): string[] {
  return ruleBodies(`:root[data-theme="${theme}"] ${selector}`);
}

/** `--name: value` declarations of a block. */
function vars(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of source.split(";")) {
    const m = decl.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/s);
    if (m !== null) out[m[1]] = m[2];
  }
  return out;
}

const BASE = vars(ruleBody(":root"));
const DARK = { ...BASE, ...vars(ruleBody(':root[data-theme="dark"]')) };
const FROST = { ...BASE, ...vars(ruleBody(':root[data-theme="frosted"]')) };

/** Resolve a token (following var() chains and fallbacks) in a theme map. */
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
  const resolved = resolveToken(m[1], theme, [...seen, name]);
  if (resolved !== undefined) return resolved;
  return m[2]?.trim();
}

/** Alpha of a colour literal (hex -> 1, rgba -> its 4th channel). */
function alphaOf(value: string | undefined): number {
  if (value === undefined) throw new Error("missing colour");
  const v = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return 1;
  const fn = v.match(/^rgba?\(([^)]+)\)$/i);
  if (fn === null) throw new Error(`unparseable colour: ${v}`);
  const parts = fn[1].split(",").map((p) => p.trim());
  return parts[3] === undefined ? 1 : Number(parts[3]);
}

describe("Phase 41 item 1 — the Inspector surface is opaque and isolated", () => {
  it("keeps the shared --panel-bg surface on the base rule", () => {
    const bodies = ruleBodies(".inspector");
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.some((b) => /background:\s*var\(--panel-bg\)/.test(b))).toBe(true);
  });

  it("light and dark --panel-bg are already opaque", () => {
    expect(alphaOf(resolveToken("--panel-bg", BASE))).toBe(1);
    expect(alphaOf(resolveToken("--panel-bg", DARK))).toBe(1);
  });

  it("frosted composites the glass film over an OPAQUE base (computed bg opaque)", () => {
    const bodies = themeRuleBodies("frosted", ".inspector");
    expect(bodies, "the frosted .inspector opaque rule is missing").not.toHaveLength(0);
    const rule = bodies.join("\n");
    // The shorthand's LAST layer is the colour: it must be the opaque base,
    // never the translucent --panel-bg alone.
    expect(rule).toMatch(
      /background:\s*linear-gradient\(var\(--panel-bg\),\s*var\(--panel-bg\)\),\s*var\(--tf-canvas-opaque\)/,
    );
    expect(alphaOf(resolveToken("--tf-canvas-opaque", FROST))).toBe(1);
  });

  it("isolates the panel's stacking context above the canvas", () => {
    const rule = ruleBody(".inspector");
    expect(rule).toMatch(/isolation:\s*isolate/);
    expect(rule).toMatch(/z-index:\s*30/);
  });

  it("declares NO per-stage Inspector surface override", () => {
    expect(CSS).not.toMatch(/\[data-inspector-stage=['"]?(edit|pages|review|deliver)['"]?\]\s*\{/);
  });
});

describe("Phase 41 item 3 — one professional selection trio", () => {
  it("declares the trio in every theme", () => {
    for (const [id, map] of Object.entries({ light: BASE, dark: DARK, frosted: FROST })) {
      expect(map["--select-fill"], `${id} --select-fill`).toBeTruthy();
      expect(map["--select-edge"], `${id} --select-edge`).toBeTruthy();
      expect(map["--select-glyph"], `${id} --select-glyph`).toBeTruthy();
    }
  });

  it("the text panel's active option consumes the trio (no accent slab)", () => {
    const active = ruleBody(".text-props-btn-active");
    expect(active).toMatch(/background:\s*var\(--select-fill\)/);
    expect(active).toMatch(/border-color:\s*var\(--select-edge\)/);
    expect(active).toMatch(/color:\s*var\(--select-glyph\)/);
    expect(active).not.toMatch(/background:\s*var\(--accent\)/);
    expect(active).not.toMatch(/border-color:\s*var\(--accent\)/);
  });

  it("the thumbnail's selected page consumes the same trio", () => {
    const selected = ruleBodies(".thumb-selected").join("\n");
    expect(selected).toMatch(/background:\s*var\(--select-fill\)/);
    expect(selected).toMatch(/border-color:\s*var\(--select-edge\)/);
    expect(selected).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--select-edge\)/);
    expect(selected).not.toMatch(/var\(--accent\)/);
  });

  it("the frosted selected thumb uses the SAME tokens and geometry", () => {
    const frosted = themeRuleBodies("frosted", ".thumb-selected").join("\n");
    expect(frosted).toMatch(/background:\s*var\(--select-fill\)/);
    expect(frosted).toMatch(/border-color:\s*var\(--select-edge\)/);
    expect(frosted).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--select-edge\)/);
  });

  it("reserves the accent for the glyphs (label + button ink)", () => {
    expect(ruleBody(".thumb-selected .thumb-label")).toMatch(/color:\s*var\(--select-glyph\)/);
  });
});

describe("Phase 41 item 4 — separators and the Inspector edge", () => {
  it("draws the rail / ContextPanel boundary with the neutral --divider", () => {
    const rail = ruleBody(".stage-rail");
    expect(rail).toMatch(/border-right:\s*1px solid var\(--divider\)/);
    expect(rail).not.toMatch(/border-right:\s*1px solid var\(--panel-border\)/);
  });

  it("gives the ContextPanel no double edge (single shared 1px separator)", () => {
    const panel = ruleBody(".context-panel");
    expect(panel).not.toMatch(/border-left:\s*1px/);
  });

  it("replaces the Inspector accent edge with a neutral glow", () => {
    const active = ruleBody(
      ".inspector[data-inspector-selection]:not([data-inspector-selection='none'])",
    );
    expect(active).toMatch(/border-left-color:\s*var\(--panel-border\)/);
    expect(active).not.toMatch(/var\(--sem-primary\)/);
    expect(active).toMatch(/box-shadow:/);
    // The resting panel stays shadow-free, so the glow is a real state change.
    expect(ruleBody(".inspector")).toMatch(/box-shadow:\s*none/);
  });
});
