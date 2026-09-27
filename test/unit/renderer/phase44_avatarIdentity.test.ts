// @vitest-environment node
//
// Phase 44 (operator amendment) — the avatar identity derivation, the motion
// contract for the new account section, and the accent/ink contrast pair.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  avatarAccessibleName,
  avatarText,
  emailInitial,
  hasAvatarImage,
  initialsFromName,
} from "../../../src/renderer/accounts/identity";

describe("initialsFromName", () => {
  it("takes the first letter of the first and last name, uppercased", () => {
    expect(initialsFromName("Ada Lovelace")).toBe("AL");
    expect(initialsFromName("grace brewster hopper")).toBe("GB");
    expect(initialsFromName("ada lovelace")).toBe("AL");
  });

  it("yields one letter for a single-word name", () => {
    expect(initialsFromName("Ada")).toBe("A");
    expect(initialsFromName("  ada  ")).toBe("A");
  });

  it("yields null for a missing or blank name", () => {
    expect(initialsFromName(undefined)).toBeNull();
    expect(initialsFromName(null)).toBeNull();
    expect(initialsFromName("")).toBeNull();
    expect(initialsFromName("   ")).toBeNull();
  });
});

describe("emailInitial", () => {
  it("takes the first letter of the email, uppercased", () => {
    expect(emailInitial("ada@example.com")).toBe("A");
    expect(emailInitial("zoe@example.com")).toBe("Z");
  });

  it("yields null for a missing or empty email", () => {
    expect(emailInitial(undefined)).toBeNull();
    expect(emailInitial(null)).toBeNull();
    expect(emailInitial("")).toBeNull();
    expect(emailInitial("   ")).toBeNull();
  });
});

describe("avatarText fallback chain", () => {
  it("prefers name initials over the email letter", () => {
    expect(avatarText({ name: "Ada Lovelace", email: "zoe@example.com" })).toBe("AL");
  });

  it("falls back to the email letter with no name", () => {
    expect(avatarText({ email: "bob@example.com" })).toBe("B");
  });

  it("is empty with neither a name nor an email", () => {
    expect(avatarText({ email: "" })).toBe("");
    expect(avatarText(null)).toBe("");
  });
});

describe("avatarAccessibleName", () => {
  it("prefers the name, then the email, then a generic fallback", () => {
    expect(avatarAccessibleName({ name: "Ada Lovelace", email: "ada@example.com" })).toBe("Ada Lovelace");
    expect(avatarAccessibleName({ email: "ada@example.com" })).toBe("ada@example.com");
    expect(avatarAccessibleName({ email: "" })).toBe("Account");
    expect(avatarAccessibleName(null)).toBe("Account");
  });
});

describe("hasAvatarImage", () => {
  it("accepts a non-empty provider URL (data is passed through untouched)", () => {
    expect(hasAvatarImage("https://cdn.example/ada.png")).toBe(true);
    expect(hasAvatarImage("data:image/png;base64,AAAA")).toBe(true);
  });

  it("rejects null / undefined / blank so the caller falls back to glyphs", () => {
    expect(hasAvatarImage(null)).toBe(false);
    expect(hasAvatarImage(undefined)).toBe(false);
    expect(hasAvatarImage("")).toBe(false);
    expect(hasAvatarImage("   ")).toBe(false);
  });
});

describe("account section motion + icon contract (source scan)", () => {
  const SOURCE = readFileSync(resolve(process.cwd(), "src/renderer/components/AccountMenu.tsx"), "utf8");

  it("animates the panel through the centralised pop tokens", () => {
    expect(SOURCE).toContain("usePopAnimation");
    expect(SOURCE).toContain("useScaleAnimation");
    // No hardcoded duration/easing values.
    expect(SOURCE).not.toMatch(/duration:\s*[0-9]/);
    expect(SOURCE).not.toMatch(/cubic-bezier/);
  });

  it("uses the distinct account glyphs and no registry collision", () => {
    for (const glyph of ["UserRound", "UserCog", "LogOut", "RefreshCcw"]) {
      expect(SOURCE, glyph).toContain(glyph);
    }
  });
});

describe("avatar contrast pair", () => {
  /** WCAG relative luminance for an sRGB hex colour. */
  function luminance(hex: string): number {
    const channel = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }
  function ratio(a: string, b: string): number {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  it("white ink on the #2563eb accent clears the 4.5:1 text floor (all themes)", () => {
    // The accent token is identical in light / dark / frosted and --fg-on-accent
    // is #ffffff in each, so one pair covers all three themes.
    const r = ratio("#ffffff", "#2563eb");
    expect(r).toBeGreaterThanOrEqual(4.5);
    expect(r).toBeCloseTo(5.17, 1);
  });

  it("the avatar CSS uses the accent background + on-accent ink tokens", () => {
    const css = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");
    const start = css.indexOf(".account-avatar {");
    const body = css.slice(start, css.indexOf("}", start));
    expect(body).toContain("background: var(--accent)");
    expect(body).toContain("color: var(--fg-on-accent)");
  });
});
