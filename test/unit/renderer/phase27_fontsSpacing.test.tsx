// @vitest-environment jsdom
// Phase 27 chunk 3 — the text-properties panel's font dropdown and the
// now-LIVE character-spacing control.
//
// The engine landed `EditFont` with three bundled OFL families and emits
// `charSpacing` as the `Tc` operator, so the panel must (a) offer exactly
// the six families, (b) enable the character-spacing control with a
// tooltip that no longer claims it is unsupported, (c) emit `charSpacing`
// in the style patch, and (d) preview the tracking live.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { TextPropertiesPanel } from "../../../src/renderer/edit/TextPropertiesPanel";
import { annTextCss } from "../../../src/renderer/annotations/annTextStyle";
import { fontFamilyFor } from "../../../src/renderer/edit/editColor";
import { defaultTextStyleValues, type TextStyleValues } from "../../../src/renderer/edit/textStyle";

const SIX_FAMILIES = [
  "Helvetica",
  "Times",
  "Courier",
  "Liberation Sans",
  "DejaVu Serif",
  "DejaVu Sans Mono",
];

function base(): TextStyleValues {
  return defaultTextStyleValues("Helvetica");
}

function mount(values: TextStyleValues, onPatch: (patch: unknown) => void): {
  host: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      createElement(TextPropertiesPanel, {
        open: true,
        values,
        defaults: base(),
        onPatch: onPatch as never,
      }),
    );
  });
  return {
    host: container,
    cleanup: (): void => {
      act((): void => root.unmount());
      container.remove();
    },
  };
}

function fireChange(el: Element | null, value: string): void {
  const input = el as HTMLInputElement | HTMLSelectElement;
  const proto =
    input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  act((): void => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("Phase 27 — font dropdown", () => {
  it("offers exactly the six families, grouped Standard vs Bundled", () => {
    const { host, cleanup } = mount(base(), (): void => undefined);
    const select = host.querySelector<HTMLSelectElement>("[data-txt-font]");
    expect(select).not.toBeNull();
    const values = Array.from(select!.options).map((o) => o.value);
    expect(values).toEqual(SIX_FAMILIES);
    const groups = Array.from(select!.querySelectorAll("optgroup")).map((g) => g.label);
    expect(groups).toEqual(["Standard", "Bundled"]);
    cleanup();
  });

  it("the bundled families drive the style patch", () => {
    const onPatch = vi.fn();
    const { host, cleanup } = mount(base(), onPatch);
    fireChange(host.querySelector("[data-txt-font]"), "DejaVu Serif");
    expect(onPatch).toHaveBeenLastCalledWith({ font: "DejaVu Serif" });
    cleanup();
  });
});

describe("Phase 27 — character spacing", () => {
  it("is ENABLED and its tooltip no longer claims it is unsupported", () => {
    const { host, cleanup } = mount(base(), (): void => undefined);
    const cs = host.querySelector<HTMLInputElement>("[data-txt-character-spacing]");
    expect(cs).not.toBeNull();
    expect(cs!.disabled).toBe(false);
    const title = cs!.getAttribute("title") ?? "";
    expect(title).not.toMatch(/not available|not supported|no Tc/i);
    expect(title).toMatch(/Tc|spacing/i);
    // Bounded to the engine's -5..20.
    expect(cs!.min).toBe("-5");
    expect(cs!.max).toBe("20");
    cleanup();
  });

  it("changing it emits charSpacing in the patch (0 = default)", () => {
    const onPatch = vi.fn();
    const { host, cleanup } = mount(base(), onPatch);
    const cs = host.querySelector("[data-txt-character-spacing]");
    fireChange(cs, "6");
    expect(onPatch).toHaveBeenLastCalledWith({ charSpacing: 6 });
    fireChange(cs, "-2.5");
    expect(onPatch).toHaveBeenLastCalledWith({ charSpacing: -2.5 });
    cleanup();
    // 0 = the documented default; from a non-zero value the control still
    // reports the explicit 0 (the host's patch merge treats it as default).
    const second = mount({ ...base(), charSpacing: 6 }, onPatch);
    fireChange(second.host.querySelector("[data-txt-character-spacing]"), "0");
    expect(onPatch).toHaveBeenLastCalledWith({ charSpacing: 0 });
    second.cleanup();
  });

  it("clamps an out-of-range value to the engine bounds", () => {
    const onPatch = vi.fn();
    const { host, cleanup } = mount(base(), onPatch);
    const cs = host.querySelector("[data-txt-character-spacing]");
    fireChange(cs, "99");
    expect(onPatch).toHaveBeenLastCalledWith({ charSpacing: 20 });
    fireChange(cs, "-99");
    expect(onPatch).toHaveBeenLastCalledWith({ charSpacing: -5 });
    cleanup();
  });

  it("the preview's computed letter-spacing follows the value", () => {
    const { host, cleanup } = mount({ ...base(), charSpacing: 6 }, (): void => undefined);
    const preview = host.querySelector<HTMLElement>("[data-txt-preview]");
    expect(preview).not.toBeNull();
    expect(getComputedStyle(preview!).letterSpacing).toBe("6px");
    cleanup();
  });

  it("the preview mirrors the chosen family", () => {
    const { host, cleanup } = mount({ ...base(), font: "DejaVu Serif" }, (): void => undefined);
    const preview = host.querySelector<HTMLElement>("[data-txt-preview]");
    expect(preview!.style.fontFamily).toBe(fontFamilyFor("DejaVu Serif"));
    cleanup();
  });
});

describe("Phase 27 — overlay + font-stack helpers", () => {
  it("annTextCss carries a non-zero charSpacing as points (absent at 0)", () => {
    expect(annTextCss({ charSpacing: 6 }).charSpacingPt).toBe(6);
    expect(annTextCss({ charSpacing: 0 }).charSpacingPt).toBeUndefined();
    expect(annTextCss({}).charSpacingPt).toBeUndefined();
  });

  it("fontFamilyFor maps all six families to distinct stacks", () => {
    const stacks = SIX_FAMILIES.map((f) => fontFamilyFor(f as never));
    expect(new Set(stacks).size).toBe(6);
  });
});
