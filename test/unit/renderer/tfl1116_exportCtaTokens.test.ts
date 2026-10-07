// @vitest-environment node
//
// TFL-1139 (TFL-1116 C6b) — R21 + R26.
//
// R21: the Deliver export primary action (`.export-config-action`) is a real
// primary CTA — a 40px minimum height, a 13px semibold label and a
// `currentColor` glyph (the Inspector's `.inspector svg` neutral rule would
// otherwise paint the glyph grey ON the violet fill), with an accessible,
// opacity-free disabled state.
//
// R26: the panel type roles resolve the shared Quiet Precision tokens — panel
// title 16 / body 14 / control 13 / helper 12 — and no enabled CTA content is
// faded through a parent opacity.
//
// This spec parses the real stylesheet and resolves the theme tokens with the
// Phase 40 `headerGhostContrast` method, then computes the WCAG 2.1 ratios.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const CSS = readFileSync(CSS_PATH, "utf8");
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

interface RGB {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): RGB {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex !== null) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = v.match(/^rgba?\(([^)]+)\)$/i);
  if (fn !== null) {
    const parts = fn[1].split(",").map((p) => p.trim());
    return {
      r: Number(parts[0]),
      g: Number(parts[1]),
      b: Number(parts[2]),
      a: parts[3] === undefined ? 1 : Number(parts[3]),
    };
  }
  throw new Error(`Unparseable colour: ${value}`);
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(c: RGB): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

function contrast(a: RGB, b: RGB): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** The declarations of the first rule whose selector block matches `selector`. */
function block(css: string, selector: RegExp): string {
  const m = selector.exec(css);
  if (m === null) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", m.index);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return "";
}

/** Read one declaration value out of a rule body. */
function decl(body: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = body.match(new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]+);`));
  return m === null ? null : m[1].trim();
}

function vars(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of source.split(";")) {
    const m = d.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/s);
    if (m !== null) out[m[1]] = m[2];
  }
  return out;
}

/** Resolve a token name OR a `var(...)` value through a chain of theme maps. */
function resolveToken(name: string, ...maps: ReadonlyArray<Record<string, string>>): string | undefined {
  const asVar = name.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/);
  if (asVar !== null) {
    const next = resolveToken(asVar[1], ...maps);
    return next ?? asVar[2]?.trim();
  }
  for (const map of maps) {
    const raw = map[name];
    if (raw === undefined) continue;
    const v = raw.match(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/);
    if (v === null) return raw;
    const next = resolveToken(v[1], ...maps);
    if (next !== undefined) return next;
    return v[2]?.trim();
  }
  return undefined;
}

/** Resolve a token to a px number, or null when it is not a px value. */
function px(name: string, ...maps: ReadonlyArray<Record<string, string>>): number | null {
  const raw = resolveToken(name, ...maps);
  if (raw === undefined) return null;
  const m = /^([\d.]+)px$/.exec(raw);
  return m === null ? null : Number.parseFloat(m[1]);
}

const BASE = vars(block(CSS_NO_COMMENTS, /:root\s*\{/));
const DARK = { ...BASE, ...vars(block(CSS_NO_COMMENTS, /:root\[data-theme="dark"\]\s*\{/)) };
const THEMES: ReadonlyArray<{ id: string; map: Record<string, string> }> = [
  { id: "light", map: BASE },
  { id: "dark", map: DARK },
];

const TEXT_FLOOR = 4.5;

describe("TFL-1139 R21 — the Deliver export primary CTA", () => {
  const action = block(CSS_NO_COMMENTS, /\.export-config-action\s*\{/);
  const actionSvg = block(CSS_NO_COMMENTS, /\.export-config-action svg\s*\{/);
  const actionDisabled = block(CSS_NO_COMMENTS, /\.export-config-action\[disabled\]/);
  const exportConfig = block(CSS_NO_COMMENTS, /\.export-config\s*\{/);

  it("is at least 40px tall", () => {
    const minHeight = decl(action, "min-height");
    expect(minHeight, "min-height declared on .export-config-action").not.toBeNull();
    const value = /^([\d.]+)px$/.exec(minHeight ?? "");
    const resolved = value !== null ? Number.parseFloat(value[1]) : px(minHeight ?? "", BASE);
    expect(resolved ?? 0).toBeGreaterThanOrEqual(40);
  });

  it("carries a 13-14px semibold label", () => {
    const size = px(decl(action, "font-size") ?? "", BASE);
    expect(size === 13 || size === 14, `label size ${String(size)}px`).toBe(true);
    expect(Number.parseInt(decl(action, "font-weight") ?? "0", 10)).toBe(600);
  });

  it("paints the label and the icon on the primary-surface ink", () => {
    // The label ink is the primary foreground, i.e. white in the light theme.
    expect(resolveToken(decl(action, "color") ?? "", BASE)).toBe(resolveToken("--btn-primary-fg", BASE));
    expect(resolveToken("--btn-primary-fg", BASE)?.toLowerCase()).toBe("#ffffff");
    // The glyph inherits the label ink instead of the Inspector's neutral icon ink.
    expect(decl(actionSvg, "color")).toBe("currentColor");
  });

  it("does not fade enabled content through a parent opacity", () => {
    for (const [name, body] of [["export-config", exportConfig], ["export-config-action", action]] as const) {
      const opacity = decl(body, "opacity");
      expect(opacity === null || opacity === "1", `${name} opacity=${String(opacity)}`).toBe(true);
    }
  });

  it("the label/icon contrast clears 4.5:1 in enabled and disabled states, both themes", () => {
    const measured: string[] = [];
    for (const { id, map } of THEMES) {
      const enabled = contrast(
        parseColor(resolveToken("--btn-primary-fg", map) ?? ""),
        parseColor(resolveToken("--btn-primary-bg", map) ?? ""),
      );
      const disabled = contrast(
        parseColor(resolveToken("--btn-primary-disabled-fg", map) ?? ""),
        parseColor(resolveToken("--btn-primary-disabled-bg", map) ?? ""),
      );
      measured.push(`${id} enabled ${enabled.toFixed(2)}:1 disabled ${disabled.toFixed(2)}:1`);
      expect(enabled, `${id} enabled label/icon`).toBeGreaterThanOrEqual(TEXT_FLOOR);
      expect(disabled, `${id} disabled label/icon`).toBeGreaterThanOrEqual(TEXT_FLOOR);
    }
    console.log(`[TFL-1139 R21] CTA contrast: ${measured.join(" | ")}`);
  });

  it("disables through an explicit muted pair, never opacity-only", () => {
    expect(decl(actionDisabled, "opacity")).toBe("1");
    expect(decl(actionDisabled, "background")).toContain("--btn-primary-disabled-bg");
    expect(decl(actionDisabled, "color")).toContain("--btn-primary-disabled-fg");
    // A disabled control is visually distinct from the enabled primary fill.
    expect(resolveToken("--btn-primary-disabled-bg", BASE)).not.toBe(
      resolveToken("--btn-primary-bg", BASE),
    );
  });
});

describe("TFL-1139 R26 — the panel type roles on the shared tokens", () => {
  const tfPanel = block(CSS_NO_COMMENTS, /\.tf-panel\s*\{/);
  const tfPanelVars = vars(tfPanel);
  const sectionTitle = block(CSS_NO_COMMENTS, /(?:^|\n)\.tf-panel-section-title\s*\{/);
  const sectionBody = block(CSS_NO_COMMENTS, /(?:^|\n)\.tf-panel-section-body\s*\{/);
  const rowLabel = block(CSS_NO_COMMENTS, /(?:^|\n)\.tf-panel-row-label\s*\{/);
  const sectionNote = block(CSS_NO_COMMENTS, /(?:^|\n)\.tf-panel-section-note\s*\{/);
  const inspectorNote = block(CSS_NO_COMMENTS, /(?:^|\n)\.inspector-note\s*\{/);
  const exportInput = block(CSS_NO_COMMENTS, /(?:^|\n)\.export-config-input\s*\{/);

  it("maps the four roles onto the shared Quiet Precision tokens (16/14/13/12)", () => {
    expect(decl(tfPanel, "--tf-panel-heading-size")).toBe("var(--type-panel-size)");
    expect(decl(tfPanel, "--tf-panel-body-size")).toBe("var(--type-body-size)");
    expect(decl(tfPanel, "--tf-panel-control-size")).toBe("var(--type-row-size)");
    expect(decl(tfPanel, "--tf-panel-helper-size")).toBe("var(--type-helper-size)");
    expect(px("--tf-panel-heading-size", tfPanelVars, BASE)).toBe(16);
    expect(px("--tf-panel-body-size", tfPanelVars, BASE)).toBe(14);
    expect(px("--tf-panel-control-size", tfPanelVars, BASE)).toBe(13);
    expect(px("--tf-panel-helper-size", tfPanelVars, BASE)).toBe(12);
  });

  it("applies the roles to the inspector section title / body / control / helper", () => {
    expect(decl(sectionTitle, "font-size")).toBe("var(--tf-panel-heading-size)");
    expect(decl(sectionBody, "font-size")).toBe("var(--tf-panel-body-size)");
    expect(decl(rowLabel, "font-size")).toBe("var(--tf-panel-control-size)");
    expect(decl(sectionNote, "font-size")).toBe("var(--tf-panel-helper-size)");
    // The export-config controls and the inspector helper also resolve their role.
    expect(px(decl(exportInput, "font-size") ?? "", tfPanelVars, BASE)).toBe(13);
    expect(px(decl(inspectorNote, "font-size") ?? "", BASE)).toBe(12);
  });

  it("keeps the shared token scale at 16/14/13/12", () => {
    expect(px("--type-panel-size", BASE)).toBe(16);
    expect(px("--type-body-size", BASE)).toBe(14);
    expect(px("--type-row-size", BASE)).toBe(13);
    expect(px("--type-helper-size", BASE)).toBe(12);
  });
});
