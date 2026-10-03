// @vitest-environment jsdom
//
// Phase 89 (FEA-033) — BatesDialog renderer completion.
//
// The dialog owns the form state and the live preview, builds the
// ascending 1-based `BatesSettings.pages` from its own scope state, and
// renders the host's honest outcome. These tests pin:
//
//   1. the label preview from the form state (buildBatesLabel +
//      formatBatesSeries),
//   2. the payload from the all-pages scope and from a from/to range,
//   3. the settings round-trip through normalizeBatesDefaults,
//   4. the report text on success and on an engine error.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  BatesDialog,
  batesPagesForScope,
  type BatesConfirmOutcome,
} from "../../../src/renderer/components/BatesDialog";
import {
  buildBatesLabel,
  formatBatesSeries,
  normalizeBatesDefaults,
  DEFAULT_BATES_DEFAULTS,
} from "../../../src/shared/bates";
import type { BatesDefaults, BatesSettings, EditFont } from "../../../src/shared/types";

const DEFAULTS: BatesDefaults = {
  prefix: "ABC",
  suffix: "",
  startNumber: 1,
  padding: 6,
  position: "bottom-right",
};

interface Mount {
  host: HTMLElement;
  unmount: () => void;
  onConfirm: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
}

function mountDialog(args: {
  confirm?: (settings: BatesSettings) => BatesConfirmOutcome | Promise<BatesConfirmOutcome>;
  totalPages?: number;
  currentPage?: number;
  initialDefaults?: BatesDefaults;
  defaultFont?: EditFont;
  busy?: boolean;
}): Mount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onConfirm = vi.fn(
    args.confirm ?? ((): BatesConfirmOutcome => ({ stamped: [1], labels: ["ABC000001"] })),
  );
  const onClose = vi.fn((): void => undefined);
  act((): void => {
    root.render(
      <BatesDialog
        open
        totalPages={args.totalPages ?? 5}
        currentPage={args.currentPage ?? 2}
        initialDefaults={args.initialDefaults ?? DEFAULTS}
        defaultFont={args.defaultFont}
        onConfirm={onConfirm}
        onClose={onClose}
        busy={args.busy ?? false}
      />,
    );
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
    onConfirm,
    onClose,
  };
}

function typeInto(host: HTMLElement, selector: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(selector);
  expect(input).not.toBeNull();
  if (input === null) return;
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  act((): void => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickApply(host: HTMLElement): Promise<void> {
  const apply = host.querySelector<HTMLButtonElement>("[data-bates-apply]");
  expect(apply).not.toBeNull();
  await act(async (): Promise<void> => {
    apply?.click();
  });
}

describe("Phase 89 — BatesDialog preview and payload", () => {
  it("previews the composed label from the seeded form state (buildBatesLabel + formatBatesSeries)", () => {
    const m = mountDialog({ totalPages: 5, currentPage: 2 });
    const preview = m.host.querySelector("[data-bates-preview]");
    expect(preview?.textContent).toBe(buildBatesLabel("ABC", 1, 6, ""));
    const range = m.host.querySelector("[data-bates-preview-range]");
    const series = formatBatesSeries({
      pages: [1, 2, 3, 4, 5],
      prefix: "ABC",
      suffix: "",
      startNumber: 1,
      padding: 6,
      position: "bottom-right",
    });
    expect(series[0]).toBe("ABC000001");
    expect(series[series.length - 1]).toBe("ABC000005");
    expect(range?.textContent).toContain("First: ABC000001");
    expect(range?.textContent).toContain("Last: ABC000005");
    m.unmount();
  });

  it("builds ascending 1-based pages for the all-pages scope", async () => {
    const m = mountDialog({ totalPages: 5, currentPage: 2 });
    await clickApply(m.host);
    expect(m.onConfirm).toHaveBeenCalledTimes(1);
    const settings = m.onConfirm.mock.calls[0]?.[0] as BatesSettings;
    expect(settings.pages).toEqual([1, 2, 3, 4, 5]);
    expect(settings.prefix).toBe("ABC");
    expect(settings.padding).toBe(6);
    expect(settings.position).toBe("bottom-right");
    m.unmount();
  });

  it("passes the host's persisted default font into the payload", async () => {
    const m = mountDialog({ totalPages: 5, currentPage: 2, defaultFont: "Times" });
    await clickApply(m.host);
    const settings = m.onConfirm.mock.calls[0]?.[0] as BatesSettings;
    expect(settings.font).toBe("Times");
    m.unmount();
  });

  it("builds the from/to range, ascending, and reflects the position chooser", async () => {
    const m = mountDialog({ totalPages: 5, currentPage: 2 });
    const all = m.host.querySelector<HTMLInputElement>("[data-bates-range-all]");
    act((): void => {
      all?.click();
    });
    typeInto(m.host, "[data-bates-range-from]", "4");
    typeInto(m.host, "[data-bates-range-to]", "2");
    await clickApply(m.host);
    expect(m.onConfirm).not.toHaveBeenCalled();
    typeInto(m.host, "[data-bates-range-to]", "5");
    const slot = m.host.querySelector<HTMLButtonElement>('[data-bates-position="top-left"]');
    act((): void => {
      slot?.click();
    });
    await clickApply(m.host);
    const settings = m.onConfirm.mock.calls[0]?.[0] as BatesSettings;
    expect(settings.pages).toEqual([4, 5]);
    expect(settings.position).toBe("top-left");
    m.unmount();
  });

  it("disables apply when the effective page list is empty/invalid", () => {
    const m = mountDialog({ totalPages: 0, currentPage: 1 });
    const apply = m.host.querySelector<HTMLButtonElement>("[data-bates-apply]");
    expect(apply?.disabled).toBe(true);
    m.unmount();
    expect(batesPagesForScope(false, 3, 2, 5)).toEqual([]);
    expect(batesPagesForScope(false, 1, 5, 5)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("Phase 89 — BatesDialog report and defaults round-trip", () => {
  it("reports the stamped count and labels on success", async () => {
    const m = mountDialog({
      confirm: (): BatesConfirmOutcome => ({
        stamped: [1, 2, 3],
        labels: ["ABC000001", "ABC000002", "ABC000003"],
      }),
    });
    await clickApply(m.host);
    const report = m.host.querySelector("[data-bates-report]")?.textContent ?? "";
    expect(report).toContain("3 pages stamped");
    expect(report).toContain("ABC000001");
    expect(report).toContain("ABC000003");
    m.unmount();
  });

  it("reports the engine error text when the host returns an error", async () => {
    const m = mountDialog({
      confirm: (): BatesConfirmOutcome => ({ error: "addBates: page 9 is out of range" }),
    });
    await clickApply(m.host);
    expect(m.host.querySelector("[data-bates-report]")?.textContent).toContain(
      "addBates: page 9 is out of range",
    );
    m.unmount();
  });

  it("keeps the report and page scope while open when initialDefaults identity changes", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onConfirm = vi.fn(
      (): BatesConfirmOutcome => ({
        stamped: [1, 2],
        labels: ["ABC000001", "ABC000002"],
      }),
    );
    const onClose = vi.fn((): void => undefined);
    const render = (open: boolean, defaults: BatesDefaults): void => {
      act((): void => {
        root.render(
          <BatesDialog
            open={open}
            totalPages={5}
            currentPage={2}
            initialDefaults={defaults}
            onConfirm={onConfirm}
            onClose={onClose}
          />,
        );
      });
    };

    render(true, { ...DEFAULTS });
    // Narrow the scope so a re-seed would visibly reset it.
    const all = host.querySelector<HTMLInputElement>("[data-bates-range-all]");
    act((): void => {
      all?.click();
    });
    typeInto(host, "[data-bates-range-from]", "1");
    typeInto(host, "[data-bates-range-to]", "5");
    await clickApply(host);
    expect(host.querySelector("[data-bates-report]")?.textContent).toContain(
      "2 pages stamped",
    );

    // A NEW initialDefaults object identity while `open` stays true must not
    // re-seed: the report survives and the user's range scope is preserved.
    render(true, { ...DEFAULTS });
    expect(host.querySelector("[data-bates-report]")?.textContent).toContain(
      "2 pages stamped",
    );
    expect(
      host.querySelector<HTMLInputElement>("[data-bates-range-from]")?.value,
    ).toBe("1");
    expect(
      host.querySelector<HTMLInputElement>("[data-bates-range-to]")?.value,
    ).toBe("5");

    // A close -> reopen IS a fresh rising edge: it re-seeds, clearing the
    // previous report and restoring the all-pages scope.
    render(false, { ...DEFAULTS });
    render(true, { ...DEFAULTS });
    expect(host.querySelector("[data-bates-report]")?.textContent).toBe(
      "Not applied yet.",
    );
    expect(
      (host.querySelector<HTMLInputElement>("[data-bates-range-all]") as HTMLInputElement)
        .checked,
    ).toBe(true);

    act((): void => {
      root.unmount();
    });
    host.remove();
  });

  it("round-trips the persisted defaults through normalizeBatesDefaults", () => {
    const raw = {
      prefix: "TF",
      suffix: "-X",
      startNumber: 7,
      padding: 4,
      position: "top-center",
    };
    const normalized = normalizeBatesDefaults(raw);
    expect(normalized).toEqual(raw);
    expect(normalizeBatesDefaults(undefined)).toEqual(DEFAULT_BATES_DEFAULTS);
    // An invalid key falls back to its default, preserved per key.
    const partial = normalizeBatesDefaults({ prefix: "Z", startNumber: 0, padding: -1 });
    expect(partial.prefix).toBe("Z");
    expect(partial.startNumber).toBe(DEFAULT_BATES_DEFAULTS.startNumber);
    expect(partial.padding).toBe(DEFAULT_BATES_DEFAULTS.padding);
  });
});
