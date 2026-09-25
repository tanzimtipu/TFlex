// DEF-339 — no icon glyph may flex-shrink below the 18px legibility floor.
//
// qa measured the rendered glyph boxes at 1440: the tab Close `lucide-x` was
// 6x18, Multi Mode / Print / Open-preferences 14.7x18 and the Inspector's
// `Collapse inspector` 16x18. The height held at the `--tf-icon-size` token
// while the WIDTH collapsed, because the SVGs are flex items
// (`flex: 0 1 auto`) inside flex-row buttons under pressure. The fix pins the
// glyph box (`flex: none` + explicit min dimensions) so it renders at the token
// in every theme.
//
// jsdom has no layout, so the collapse itself is measured in e2e (qa's P38-1
// `icon-details-*`). This spec pins the SOURCE contract that makes the measured
// result hold: every icon-size rule declares a non-shrinkable, token-sized box.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8").replace(
  /\r\n/g,
  "\n",
);

/** The `:root` token block (light defaults). */
const BASE = ((): string => {
  const m = /:root\s*\{([\s\S]*?)\n\}/m.exec(CSS);
  return m?.[1] ?? "";
})();

function tokenPx(name: string): number {
  const m = new RegExp(`${name}\\s*:\\s*([0-9.]+)px`).exec(BASE);
  return m === null ? NaN : Number.parseFloat(m[1]);
}

/** Extract a rule body by exact selector prefix. */
function ruleBody(selector: string): string {
  const start = CSS.indexOf(selector);
  expect(start, `selector present: ${selector}`).toBeGreaterThanOrEqual(0);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open + 1, close);
}

describe("DEF-339 — the icon-size rules pin a non-shrinkable glyph box", () => {
  const RULES: ReadonlyArray<{ selector: string; token: string; floor: number }> = [
    {
      selector:
        ".app-header svg,\n.titlebar svg,\n.context-panel svg,\n.side-rail svg,\n.inspector svg,\n.command-palette svg,\n.annotation-flyout svg,\n.ann-toolbar svg {",
      token: "--tf-icon-size",
      floor: 18,
    },
    {
      selector: ".action-dock svg,\n.canvas-pill svg {",
      token: "--tf-icon-size-md",
      floor: 18,
    },
    {
      selector: ".stage-rail svg,\n.side-rail .rail-tab svg,\n.side-rail .rail-action-btn svg {",
      token: "--tf-icon-size-lg",
      floor: 18,
    },
  ];

  it("the header/Inspector rule (the measured surfaces) never shrinks", () => {
    const body = ruleBody(RULES[0].selector);
    expect(body).toMatch(/flex:\s*none/);
    expect(body).toMatch(/min-width:\s*var\(--tf-icon-size\)/);
    expect(body).toMatch(/min-height:\s*var\(--tf-icon-size\)/);
    expect(body).not.toMatch(/flex-shrink:\s*1/);
  });

  it("every icon-size rule declares flex: none and matching min dimensions", () => {
    for (const rule of RULES) {
      const body = ruleBody(rule.selector);
      expect(body, `${rule.token} flex`).toMatch(/flex:\s*none/);
      expect(body, `${rule.token} min-width`).toMatch(new RegExp(`min-width:\\s*var\\(${rule.token}\\)`));
      expect(body, `${rule.token} min-height`).toMatch(new RegExp(`min-height:\\s*var\\(${rule.token}\\)`));
    }
  });

  it("every icon-size token clears the 18px floor", () => {
    for (const rule of RULES) {
      const px = tokenPx(rule.token);
      expect(Number.isFinite(px), `${rule.token} resolves to px`).toBe(true);
      expect(px, `${rule.token} >= ${rule.floor}`).toBeGreaterThanOrEqual(rule.floor);
    }
  });
});
