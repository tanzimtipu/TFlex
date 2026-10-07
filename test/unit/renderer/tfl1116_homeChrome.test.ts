// @vitest-environment node
//
// TFL-1141 (TFL-1116 C7) — R06 + R07 Home chrome.
//
// R06: the title-bar product brand (`.titlebar > .brand`) keeps a 16px leading
// inset (`--space-standard`) at EVERY width. The rule used to live inside the
// `@media (max-width: 900px)` band, so at the default wide window the brand had
// no leading padding and touched the native left edge. This spec parses the
// real stylesheet, resolves the spacing token, and proves the rule is GLOBAL.
//
// R07: the document rail (`.document-rail` / `.tab-area`) is mounted only when
// at least one document session exists. `isDocumentRailVisible` is the pure
// decision App keys the mount off; this spec pins its truth table and asserts
// App actually consults it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isDocumentRailVisible } from "../../../src/renderer/components/DocumentRail";

const CSS_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const APP_PATH = resolve(__dirname, "../../../src/renderer/App.tsx");
const CSS = readFileSync(CSS_PATH, "utf8");
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const APP_SRC = readFileSync(APP_PATH, "utf8");

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
function resolveToken(
  name: string,
  ...maps: ReadonlyArray<Record<string, string>>
): string | undefined {
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

/** Remove every `@media (...) { ... }` block (balanced), leaving global rules. */
function stripMedia(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@media", i);
    if (at === -1) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, at);
    const open = css.indexOf("{", at);
    if (open === -1) break;
    let depth = 0;
    let j = open;
    for (; j < css.length; j += 1) {
      if (css[j] === "{") depth += 1;
      else if (css[j] === "}") {
        depth -= 1;
        if (depth === 0) {
          j += 1;
          break;
        }
      }
    }
    i = j;
  }
  return out;
}

const BASE = vars(block(CSS_NO_COMMENTS, /:root\s*\{/));
const GLOBAL = stripMedia(CSS_NO_COMMENTS);

describe("TFL-1141 R06 — the title-bar brand keeps a 16px leading inset", () => {
  it("declares the inset on `.titlebar > .brand` through the spacing token", () => {
    const rule = block(GLOBAL, /\.titlebar\s*>\s*\.brand\s*\{/);
    expect(decl(rule, "padding-left")).toBe("var(--space-standard)");
    // `--space-standard` is an alias of the canonical `--sp-4` grid step (16px).
    expect(px("var(--space-standard)", BASE)).toBe(16);
  });

  it("keeps the rule global (not scoped to a narrow-width media band)", () => {
    // `stripMedia` removed every @media body; the rule must still resolve, which
    // proves it is no longer hidden inside `@media (max-width: 900px)`.
    expect(() => block(GLOBAL, /\.titlebar\s*>\s*\.brand\s*\{/)).not.toThrow();
    // And the same selector is indeed present in the raw sheet too.
    expect(() => block(CSS_NO_COMMENTS, /\.titlebar\s*>\s*\.brand\s*\{/)).not.toThrow();
  });

  it("is not neutralised by a later brand rule that zeroes the padding", () => {
    const baseRule = block(CSS_NO_COMMENTS, /(?:^|\n)\.brand\s*\{/);
    expect(decl(baseRule, "padding-left")).toBeNull();
    // The compact band (max-width: 680px) keeps the gap/padding-right overrides
    // but must NOT reset padding-left.
    const compactRule = block(CSS_NO_COMMENTS, /\.brand\s*\{\s*gap:\s*0\s*;/);
    expect(decl(compactRule, "padding-left")).toBeNull();
  });
});

describe("TFL-1141 R07 — the document rail mounts only with a session", () => {
  it("returns hidden for zero tabs and shown for one or more", () => {
    expect(isDocumentRailVisible(0)).toBe(false);
    expect(isDocumentRailVisible(1)).toBe(true);
    expect(isDocumentRailVisible(2)).toBe(true);
    expect(isDocumentRailVisible(8)).toBe(true);
  });

  it("stays hidden for a defensive non-positive count", () => {
    expect(isDocumentRailVisible(-1)).toBe(false);
  });

  it("is wired into App: the rail mounts behind the helper on stripTabs", () => {
    expect(APP_SRC).toContain(
      'import { DocumentRail, isDocumentRailVisible } from "./components/DocumentRail";',
    );
    expect(APP_SRC).toContain("{isDocumentRailVisible(stripTabs.length) && (");
    expect(APP_SRC).toContain("<DocumentRail");
  });
});
