// @vitest-environment jsdom
//
// Phase 94 (feature A) — the ONE central `Icon` wrapper contract.
//
// Pins the wrapper that every named-surface icon will render through:
//   - the `ICON_SIZES` token scale and the >= 18px chrome floor on md/lg/xl;
//   - the normalized visual language (round caps/joins, `currentColor` stroke,
//     no literal colour, `focusable="false"`);
//   - decorative-by-default accessibility (`aria-hidden` true) with the
//     `title`/`aria-hidden={false}` escape hatch;
//   - the size -> px mapping for every token;
//   - `variant="bold"` as the ONLY permitted stroke-width exception.
//
// jsdom has no layout, so this spec pins the SVG ATTRIBUTE contract (the
// stylesheet's token-box rules are pinned separately by def339_iconFloor).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Check } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ICON_SIZES, ICON_STROKE, Icon, type IconSize } from "../../../src/renderer/icons/Icon";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOSTS: HTMLElement[] = [];
const ROOTS: Root[] = [];

function mount(element: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  HOSTS.push(host);
  ROOTS.push(root);
  return host;
}

function theSvg(host: HTMLElement): SVGSVGElement {
  const svgs = host.querySelectorAll("svg");
  expect(svgs).toHaveLength(1);
  return svgs[0];
}

function attributesOf(el: Element): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const attr of Array.from(el.attributes)) out[attr.name] = attr.value;
  return out;
}

afterEach((): void => {
  for (const root of ROOTS.splice(0)) act((): void => root.unmount());
  for (const host of HOSTS.splice(0)) host.remove();
});

describe("Phase 94 — the icon token scale", () => {
  it("declares the exact seven-step scale", () => {
    expect(ICON_SIZES).toEqual({ xs: 14, sm: 16, md: 18, lg: 20, xl: 22, xxl: 24, hero: 32 });
  });

  it("keeps the chrome tokens at or above the 18px floor", () => {
    expect(ICON_SIZES.md).toBeGreaterThanOrEqual(18);
    expect(ICON_SIZES.lg).toBeGreaterThanOrEqual(18);
    expect(ICON_SIZES.xl).toBeGreaterThanOrEqual(18);
    // xs/sm are non-chrome marks and deliberately below the floor.
    expect(ICON_SIZES.xs).toBeLessThan(18);
    expect(ICON_SIZES.sm).toBeLessThan(18);
  });

  it("mirrors ICON_STROKE as --tf-icon-stroke in styles.css", () => {
    const css = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");
    const m = /--tf-icon-stroke:\s*([0-9.]+)/.exec(css);
    expect(m?.[1]).toBe(String(ICON_STROKE));
  });
});

describe("Phase 94 — the Icon wrapper renders exactly one SVG", () => {
  const SIZES = Object.entries(ICON_SIZES) as ReadonlyArray<[IconSize, number]>;

  it.each(SIZES)("size %s renders a %spx square", (token, px) => {
    const svg = theSvg(mount(<Icon icon={Check} size={token} />));
    expect(svg.getAttribute("width")).toBe(String(px));
    expect(svg.getAttribute("height")).toBe(String(px));
  });

  it("defaults to the md token (18px)", () => {
    const svg = theSvg(mount(<Icon icon={Check} />));
    expect(svg.getAttribute("width")).toBe("18");
    expect(svg.getAttribute("height")).toBe("18");
  });
});

describe("Phase 94 — one normalized visual language", () => {
  it("round caps/joins, currentColor, focusable=false, aria-hidden by default", () => {
    const svg = theSvg(mount(<Icon icon={Check} />));
    expect(svg.getAttribute("stroke-linecap")).toBe("round");
    expect(svg.getAttribute("stroke-linejoin")).toBe("round");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("stroke-width")).toBe(String(ICON_STROKE));
  });

  it("carries no literal stroke/fill colour", () => {
    const svg = theSvg(mount(<Icon icon={Check} />));
    for (const attr of ["stroke", "fill", "color"]) {
      expect(svg.getAttribute(attr) ?? "").not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/);
    }
  });

  it('variant="bold" changes ONLY the stroke width', () => {
    const plain = attributesOf(theSvg(mount(<Icon icon={Check} />)));
    const bold = attributesOf(theSvg(mount(<Icon icon={Check} variant="bold" />)));
    expect(Number(bold["stroke-width"])).toBeGreaterThan(Number(plain["stroke-width"]));
    delete plain["stroke-width"];
    delete bold["stroke-width"];
    expect(bold).toEqual(plain);
  });
});

describe("Phase 94 — accessibility passthrough", () => {
  it("renders a title and can expose the icon with aria-hidden={false}", () => {
    const host = mount(<Icon icon={Check} title="Confirm" aria-hidden={false} />);
    expect(host.querySelector("title")?.textContent).toBe("Confirm");
    expect(theSvg(host).getAttribute("aria-hidden")).toBe("false");
  });

  it("passes className through to the SVG root", () => {
    const svg = theSvg(mount(<Icon icon={Check} className="my-icon" />));
    expect(svg.classList.contains("my-icon")).toBe(true);
  });
});

describe("Phase 94A correction — the form-checkbox tick scales with its field", () => {
  /** Extract a rule body by exact selector prefix (mirrors def339_iconFloor). */
  function ruleBody(css: string, selector: string): string {
    const start = css.indexOf(selector);
    expect(start, `selector present: ${selector}`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf("{", start);
    const close = css.indexOf("}", open);
    return css.slice(open + 1, close);
  }

  it(".form-checkbox svg sizes the glyph as a percentage of the rendered button", () => {
    const css = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");
    const body = ruleBody(css, ".form-checkbox svg {");
    // The button is `CHECKBOX_BOX_PT * cssScale`; a percentage tracks zoom,
    // a px length would not (the regression this correction fixes).
    expect(body).toMatch(/width:\s*70%/);
    expect(body).toMatch(/height:\s*70%/);
    expect(body).not.toMatch(/width:\s*[0-9.]+px/);
    expect(body).not.toMatch(/height:\s*[0-9.]+px/);
  });
});
