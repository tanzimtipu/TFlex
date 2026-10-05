// @vitest-environment node
//
// TFL-61 (Phase 63) / Phase 103 (criterion 3) — THE DOCK EDIT PEN IS AN ICON.
//
// The pen arms EDIT mode. Phase 63 originally required its resting ink to carry
// the EDIT-stage hue (--tf-stage-edit). Phase 103 criterion 3 SUPERSEDES that:
// the pen is an icon, so it rides the shared icon ladder — graphite at rest
// (--tf-icon-rest) and the single accent violet only while armed
// (--tf-icon-active, aria-pressed='true'). This guard pins both ends so the
// identity survives the theme swap (light / dark / frosted) rather than
// freezing one theme's value, and still rejects any raw colour.
//
// Phase 91 (Feature C1) migrated the pen onto the canonical button chrome while
// keeping the legacy `.action-dock-edit` hook: the base ink now lives on the
// scoped canonical alias `.btn.action-dock-edit` (the retired
// `.action-dock-edit:not(.btn)` hook remains for the stale class). Both are
// checked here, and neither may freeze a theme with a raw colour.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const CSS = readFileSync(STYLES_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function ruleBodies(css: string, selector: string): string[] {
  return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter((m) => (m[1] ?? "").split(",").some((s) => s.trim() === selector))
    .map((m) => m[2] ?? "");
}

/** Every rule whose selector list mentions the `.action-dock-edit` class. */
function editBodies(css: string): string[] {
  return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter((m) => /\.action-dock-edit(?![\w-])/.test(m[1] ?? ""))
    .map((m) => m[2] ?? "");
}

/** The pen's two base-ink hooks: the C1 alias and the retired hook. */
function baseBodies(css: string): string[] {
  return [
    ...ruleBodies(css, ".btn.action-dock-edit"),
    ...ruleBodies(css, ".action-dock-edit:not(.btn)"),
  ];
}

const ICON_REST = /(^|;)\s*color:\s*var\(--tf-icon-rest\)\s*(;|$)/;
const ICON_ACTIVE = /(^|;)\s*color:\s*var\(--tf-icon-active\)\s*(;|$)/;

describe("TFL-61 / Phase 103 — the dock edit pen is an icon", () => {
  it("declares color: var(--tf-icon-rest) in the .action-dock-edit base rule", () => {
    const bodies = baseBodies(CSS);
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.some((b) => ICON_REST.test(b))).toBe(true);
  });

  it("declares color: var(--tf-icon-active) in the [aria-pressed='true'] rule", () => {
    const bodies = ruleBodies(CSS, ".action-dock-edit[aria-pressed='true']");
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.some((b) => ICON_ACTIVE.test(b))).toBe(true);
  });

  it("no longer rests in the superseded EDIT-stage hue", () => {
    const bodies = baseBodies(CSS);
    for (const body of bodies) {
      expect(body).not.toMatch(/color:\s*var\(--tf-stage-edit\)/);
    }
  });

  it("rejects a sibling token that only contains the substring", () => {
    const sibling = " color: var(--sem-neutral); border-color: var(--tf-icon-rest); ";
    expect(sibling.includes("color: var(--tf-icon-rest)")).toBe(true);
    expect(ICON_REST.test(sibling)).toBe(false);
  });

  it("declares no raw hex/rgb/hsl colour in any .action-dock-edit rule", () => {
    const bodies = editBodies(CSS);
    expect(bodies.length).toBeGreaterThan(0);
    const raw = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
    for (const body of bodies) {
      expect(body).not.toMatch(raw);
    }
  });
});
