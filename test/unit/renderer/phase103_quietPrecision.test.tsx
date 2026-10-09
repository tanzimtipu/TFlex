// @vitest-environment node
//
// Phase 103 (TFL-829) — the Quiet Precision semantic registry contract.
//
// Pins the new single source of truth (`icons/quietPrecision.tsx`) and the two
// pilot adoptions:
//   (a) `QUIET_ICONS` has no missing and no duplicate keys, and every entry is a
//       well-formed glyph;
//   (b) completeness — every command id in `state/toolsRegistry.ts` plus every
//       chrome/affordance id from the Phase 103 inventory has a registry entry;
//   (c) the pilot surfaces (the Action Dock and the App Header) render through
//       the registry via `name=`;
//   (d) the geometry constants are 24 / 1.65 / 1.8.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  QUIET_ICONS,
  QUIET_ICON_STROKE,
  QUIET_ICON_STROKE_SMALL,
  QUIET_ICON_VIEWBOX,
  type QuietGlyph,
} from "../../../src/renderer/icons/quietPrecision";
import { ICON_SIZES } from "../../../src/renderer/icons/Icon";

const RENDERER = resolve(process.cwd(), "src/renderer");

/** The chrome/affordance ids from the inventory's Chrome table, plus the two
 *  Phase 103 chunk 3a chrome additions (`menuCheck`, `windowRestore`). */
const CHROME_IDS: readonly string[] = [
  "dialogClose",
  "tabClose (AnimatedTab)",
  "dockScrollLeft",
  "dockScrollRight",
  "dockOverflow",
  "dockRemove",
  "dockEditPencil",
  "headerCommand",
  "headerTheme",
  "headerMenuDisclosure",
  "layoutOnePage",
  "layoutTwoPage",
  "layoutFourPage",
  "menuCheck",
  "windowRestore",
];

/** The four palette GROUP ids in `toolsRegistry.ts`; not command ids. */
const PALETTE_GROUP_IDS: readonly string[] = ["organize", "document", "recognition", "export"];

/** Glyph ids still referenced by the UI outside the command / chrome union.
 *  TFL-1436 retired the `forms` command, but the Home sample-task framing
 *  (`utils/sampleTask.ts`) still uses the `forms` glyph for its "Try form
 *  fields" sample card, so the glyph survives as a non-command id. */
const NON_COMMAND_GLYPH_IDS: readonly string[] = ["forms"];

function commandIds(): string[] {
  const text = readFileSync(resolve(RENDERER, "state/toolsRegistry.ts"), "utf8");
  const all = [...text.matchAll(/^\s*id:\s*'([^']+)'/gm)].map((m) => m[1]);
  return all.filter((id) => !PALETTE_GROUP_IDS.includes(id));
}

const COMMAND_IDS = commandIds();
const ALL_IDS = [...COMMAND_IDS, ...CHROME_IDS, ...NON_COMMAND_GLYPH_IDS];

describe("Phase 103 — the Quiet Precision registry keys", () => {
  it("(b) extracts the 107 registry command ids plus the 15 chrome ids", () => {
    expect(COMMAND_IDS).toHaveLength(107);
    expect(CHROME_IDS).toHaveLength(15);
    expect(ALL_IDS).toHaveLength(123);
  });

  it("(a) has no missing key and no duplicate key", () => {
    const keys = Object.keys(QUIET_ICONS);
    expect(new Set(keys).size, "duplicate registry key").toBe(keys.length);
    for (const id of ALL_IDS) {
      expect(QUIET_ICONS[id as keyof typeof QUIET_ICONS], `missing glyph: ${id}`).toBeDefined();
    }
    // No phantom extra key beyond the union.
    expect(keys).toHaveLength(ALL_IDS.length);
  });

  it("(b) every id resolves to a well-formed glyph", () => {
    for (const id of ALL_IDS) {
      const glyph = QUIET_ICONS[id as keyof typeof QUIET_ICONS] as QuietGlyph | undefined;
      expect(glyph, id).toBeDefined();
      if (glyph?.kind === "shapes") {
        expect(glyph.shapes, `${id} shapes`).toBeTruthy();
      } else {
        expect(glyph?.kind, `${id} kind`).toBe("lucide");
        expect(glyph?.kind === "lucide" ? glyph.icon : undefined, `${id} lucide icon`).toBeTruthy();
      }
    }
  });
});

describe("Phase 103 — pilot surfaces render via the registry", () => {
  it("(c) the Action Dock renders verbs through `name=`", () => {
    const text = readFileSync(resolve(RENDERER, "components/ActionDock.tsx"), "utf8");
    expect(text).toMatch(/<Icon\s+name=\{verb\.id/);
  });

  it("(c) the App Header renders its utilities through `name=`", () => {
    const text = readFileSync(resolve(RENDERER, "components/AppHeader.tsx"), "utf8");
    // Phase 105 (chunk C) — the title row keeps the document actions, Search
    // tools, Print and the application-menu trigger; the relocated Theme /
    // Preferences / Find / Multi Mode commands render as application-menu rows
    // with their registry icon ids.
    for (const id of ["open", "save", "saveAs", "headerCommand", "print", "appMenu"]) {
      expect(text, `header renders name="${id}"`).toContain(`name="${id}"`);
    }
    for (const id of ["multi-mode", "find"]) {
      expect(text, `header app-menu row uses icon "${id}"`).toContain(`icon: "${id}"`);
    }
  });
});

describe("Phase 103 — geometry constants", () => {
  it("(d) pins the 24 / 1.65 / 1.8 baseline", () => {
    expect(QUIET_ICON_VIEWBOX).toBe(24);
    expect(QUIET_ICON_STROKE).toBe(1.65);
    expect(QUIET_ICON_STROKE_SMALL).toBe(1.8);
    expect(ICON_SIZES.xxl).toBe(24);
  });
});
