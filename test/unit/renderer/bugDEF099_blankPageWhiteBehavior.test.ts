// @vitest-environment jsdom
//
// DEF-099 — a blank page must render paper-white regardless of
// theme. Root cause: blank pages have NO canvas (no pdf.js
// operators), so the renderer paints nothing; the visible area is
// the page-slot / pdf-page surfaces, which previously inherited the
// themed canvas background (`--bg-raised`: near-black in dark
// mode).
//
// The fix hard-codes BOTH surfaces to `#ffffff`: `.pdf-page` (the
// PageView wrapper around the canvas/textLayer/overlays) and
// `.page-slot` (the always-mounted scroll-space placeholder that
// shows while the PageView is virtualized off-screen or still
// rendering).
//
// Coverage (behavior): this test injects the REAL stylesheet rules
// into a jsdom document, mounts the same slot > page structure the
// app renders, and asserts the COMPUTED background color is white —
// the exact value the browser would hit-test/repaint. It exercises
// the dark theme (the reported failure mode) and an empty slot
// (no PageView mounted = no canvas).
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const stylesPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "styles.css",
);
const stylesSource = fs.readFileSync(stylesPath, "utf8");

function ruleFor(selector: string): string {
  const raw = stylesSource.match(new RegExp(`${selector}\\s*\\{[^}]*\\}`));
  if (raw === null) throw new Error(`rule not found: ${selector}`);
  // Strip comment blocks so historical notes can't leak in.
  return raw[0].replace(/\/\*[\s\S]*?\*\//g, "");
}

function mountSlotAndPage(theme: "dark" | "light"): void {
  document.documentElement.setAttribute("data-theme", theme);
  const style = document.createElement("style");
  style.textContent = [
    ruleFor("\\.pdf-page"),
    ruleFor("\\.page-slot"),
    ":root[data-theme='dark'] .pdf-page { box-shadow: none; }",
  ].join("\n");
  document.head.appendChild(style);
  const slot = document.createElement("div");
  slot.className = "page-slot";
  const page = document.createElement("div");
  page.className = "pdf-page";
  slot.appendChild(page);
  document.body.appendChild(slot);
}

describe("DEF-099 — blank page surface is paper-white in both themes (computed style)", () => {
  it("the page-slot and pdf-page compute to rgb(255, 255, 255) in dark theme", () => {
    mountSlotAndPage("dark");
    const slot = document.querySelector<HTMLElement>(".page-slot");
    const page = document.querySelector<HTMLElement>(".pdf-page");
    if (slot === null || page === null) throw new Error("structure not mounted");
    expect(window.getComputedStyle(slot).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(window.getComputedStyle(page).backgroundColor).toBe("rgb(255, 255, 255)");
  });

  it("the page-slot and pdf-page compute to rgb(255, 255, 255) in light theme", () => {
    mountSlotAndPage("light");
    const slot = document.querySelector<HTMLElement>(".page-slot");
    const page = document.querySelector<HTMLElement>(".pdf-page");
    if (slot === null || page === null) throw new Error("structure not mounted");
    expect(window.getComputedStyle(slot).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(window.getComputedStyle(page).backgroundColor).toBe("rgb(255, 255, 255)");
  });

  it("an EMPTY slot (no PageView mounted, no canvas) is still paper-white", () => {
    // The exact "blank page has NO canvas" case: the slot is
    // present but contains no .pdf-page (virtualized / not yet
    // mounted). The slot's own white background covers the page.
    document.documentElement.setAttribute("data-theme", "dark");
    const style = document.createElement("style");
    style.textContent = ruleFor("\\.page-slot");
    document.head.appendChild(style);
    const slot = document.createElement("div");
    slot.className = "page-slot";
    document.body.appendChild(slot);
    expect(window.getComputedStyle(slot).backgroundColor).toBe("rgb(255, 255, 255)");
  });
});