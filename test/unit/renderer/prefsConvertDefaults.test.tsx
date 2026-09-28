// @vitest-environment jsdom
//
// Phase 53 — the conversion defaults surfaced in Preferences.
//
// The section must offer exactly the seven `convertDefaults` keys, must
// write only values the main-process validator accepts, and must clamp the
// two numeric fields to the documented bounds so the UI can never persist
// a value main would reject.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  PreferencesDialog,
  CONVERT_FONT_FAMILIES,
  CONVERT_MARGIN_MIN_MM,
  CONVERT_MARGIN_MAX_MM,
  CONVERT_FONT_SIZE_MIN_PT,
  CONVERT_FONT_SIZE_MAX_PT,
  clampMarginMm,
  clampFontSizePt,
} from "../../../src/renderer/components/PreferencesDialog";
import type { ConvertDefaults } from "../../../src/shared/convert";

/** The font allowlist `normalizeConvertDefaults` accepts in
 *  `src/main/services/settings.ts` (`[...EDIT_FONTS, 'Inter']`). Read from
 *  the validator; the UI may not offer anything outside it. */
const VALIDATOR_FONT_FAMILIES = [
  "Helvetica",
  "Times",
  "Courier",
  "Liberation Sans",
  "DejaVu Serif",
  "DejaVu Sans Mono",
  "Inter",
];

const DEFAULTS: ConvertDefaults = {
  pageSize: "a4",
  marginMm: 20,
  textFontFamily: "Inter",
  textFontSizePt: 11,
  csvDelimiter: "auto",
  csvFormMapping: true,
  htmlPrintBackgrounds: true,
};

function mount(convertDefaults: ConvertDefaults = DEFAULTS): {
  host: HTMLElement;
  onSet: ReturnType<typeof vi.fn>;
  unmount: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onSet = vi.fn();
  act((): void => {
    root.render(
      <PreferencesDialog
        open
        onClose={(): void => undefined}
        themeDefault="dark"
        recentsCap={10}
        onSetThemeDefault={(): void => undefined}
        onThemeChange={(): void => undefined}
        onSetRecentsCap={(): void => undefined}
        animationsEnabled
        onSetAnimationsEnabled={(): void => undefined}
        convertDefaults={convertDefaults}
        onSetConvertDefaults={onSet}
      />,
    );
  });
  return {
    host,
    onSet,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function pick(host: HTMLElement, selector: string, value: string): void {
  const select = host.querySelector<HTMLSelectElement>(selector);
  expect(select).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  act((): void => {
    setValue?.call(select, value);
    select?.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function typeAndCommit(host: HTMLElement, selector: string, text: string): void {
  const input = host.querySelector<HTMLInputElement>(selector);
  expect(input).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act((): void => {
    setValue?.call(input, text);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act((): void => {
    input?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
}

describe("PreferencesDialog — conversion defaults", () => {
  it("offers only font families the settings validator accepts", () => {
    for (const family of CONVERT_FONT_FAMILIES) {
      expect(VALIDATOR_FONT_FAMILIES, family).toContain(family);
    }
    const { host, unmount } = mount();
    const rendered = Array.from(
      host.querySelectorAll<HTMLOptionElement>("[data-prefs-convert-font] option"),
    ).map((o) => o.value);
    expect(rendered).toEqual([...CONVERT_FONT_FAMILIES]);
    unmount();
  });

  it("clamps margins to 5–50 mm and font sizes to 6–48 pt", () => {
    const { host, onSet, unmount } = mount();
    typeAndCommit(host, "[data-prefs-convert-margin]", "999");
    expect(onSet).toHaveBeenCalledTimes(1);
    expect((onSet.mock.calls[0]?.[0] as ConvertDefaults).marginMm).toBe(CONVERT_MARGIN_MAX_MM);

    onSet.mockClear();
    typeAndCommit(host, "[data-prefs-convert-margin]", "1");
    expect((onSet.mock.calls[0]?.[0] as ConvertDefaults).marginMm).toBe(CONVERT_MARGIN_MIN_MM);

    onSet.mockClear();
    typeAndCommit(host, "[data-prefs-convert-font-size]", "1");
    expect((onSet.mock.calls[0]?.[0] as ConvertDefaults).textFontSizePt).toBe(CONVERT_FONT_SIZE_MIN_PT);

    onSet.mockClear();
    typeAndCommit(host, "[data-prefs-convert-font-size]", "99");
    expect((onSet.mock.calls[0]?.[0] as ConvertDefaults).textFontSizePt).toBe(CONVERT_FONT_SIZE_MAX_PT);
    unmount();
  });

  it("exposes the clamps as pure helpers with the documented bounds", () => {
    expect(clampMarginMm(-100)).toBe(5);
    expect(clampMarginMm(1000)).toBe(50);
    expect(clampMarginMm(20)).toBe(20);
    expect(clampFontSizePt(0)).toBe(6);
    expect(clampFontSizePt(100)).toBe(48);
    expect(clampFontSizePt(11)).toBe(11);
  });

  it("writes every non-numeric control through the settings callback", () => {
    const { host, onSet, unmount } = mount();

    pick(host, "[data-prefs-convert-page-size]", "letter");
    expect((onSet.mock.calls.at(-1)?.[0] as ConvertDefaults).pageSize).toBe("letter");

    pick(host, "[data-prefs-convert-delimiter]", ";");
    expect((onSet.mock.calls.at(-1)?.[0] as ConvertDefaults).csvDelimiter).toBe(";");

    pick(host, "[data-prefs-convert-font]", "DejaVu Serif");
    expect((onSet.mock.calls.at(-1)?.[0] as ConvertDefaults).textFontFamily).toBe("DejaVu Serif");

    const mapping = host.querySelector<HTMLInputElement>("[data-prefs-convert-csv-mapping]");
    act((): void => {
      mapping?.click();
    });
    expect((onSet.mock.calls.at(-1)?.[0] as ConvertDefaults).csvFormMapping).toBe(false);

    const backgrounds = host.querySelector<HTMLInputElement>("[data-prefs-convert-html-backgrounds]");
    act((): void => {
      backgrounds?.click();
    });
    expect((onSet.mock.calls.at(-1)?.[0] as ConvertDefaults).htmlPrintBackgrounds).toBe(false);
    unmount();
  });

  it("renders the current effective values", () => {
    const { host, unmount } = mount({ ...DEFAULTS, pageSize: "letter", marginMm: 34, textFontSizePt: 18 });
    expect(host.querySelector<HTMLSelectElement>("[data-prefs-convert-page-size]")?.value).toBe("letter");
    expect(host.querySelector<HTMLInputElement>("[data-prefs-convert-margin]")?.value).toBe("34");
    expect(host.querySelector<HTMLInputElement>("[data-prefs-convert-font-size]")?.value).toBe("18");
    unmount();
  });
});
