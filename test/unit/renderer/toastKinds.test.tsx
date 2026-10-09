// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Phase 13 — toast kinds + icons. Phase 126 (chunk B1) retired the
// `warning` / `error` toast SURFACE: those tones now render as the
// in-canvas `CanvasAlertNotice`, so only `info` / `success` survive here.
//
// The contract under test:
//   1. `toastIcon(kind)` is a pure mapping from kind to Lucide icon
//      component. Adding a new kind to the union without a mapping
//      here fails TS exhaustiveness.
//   2. The surviving CSS variants (info / success) each use the
//      matching semantic color token, NOT a raw hex. The stylesheet is
//      the contract — these tests assert the class names exist on the
//      rendered DOM so a stylesheet refactor doesn't silently drop a
//      variant.
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CheckCircle, Info } from "lucide-react";
import {
  Toasts,
  toastAutoDismissMs,
  toastIcon,
  type Toast,
} from "../../../src/renderer/components/Toasts";

function makeToasts(): Toast[] {
  return [
    { id: 1, kind: "info", text: "Info message" },
    { id: 2, kind: "success", text: "Success message" },
  ];
}

function renderToasts(items: Toast[]): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(<Toasts items={items} onDismiss={(): void => undefined} />);
  });
  return {
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("toastIcon — kind -> icon mapping (pure, exhaustive)", () => {
  it("maps info -> Info", () => {
    expect(toastIcon("info")).toBe(Info);
  });
  it("maps success -> CheckCircle", () => {
    expect(toastIcon("success")).toBe(CheckCircle);
  });
});

describe("toastAutoDismissMs — durability contract (pure)", () => {
  it("auto-dismisses success after 5000 ms", () => {
    expect(toastAutoDismissMs("success")).toBe(5000);
  });
  it("auto-dismisses info after 5000 ms", () => {
    expect(toastAutoDismissMs("info")).toBe(5000);
  });
});

describe("ToastItem — timer honours toastAutoDismissMs", () => {
  it("dismisses info/success after 5000 ms", () => {
    const cases = [
      { id: 1, kind: "success" },
      { id: 2, kind: "info" },
    ] as const;
    vi.useFakeTimers();
    try {
      for (const { id, kind } of cases) {
        const onDismiss = vi.fn();
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        act((): void => {
          root.render(
            <Toasts
              items={[{ id, kind, text: `${kind} message` }]}
              onDismiss={onDismiss}
            />,
          );
        });
        act((): void => {
          vi.advanceTimersByTime(5000);
        });
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(onDismiss).toHaveBeenCalledWith(id);
        act((): void => {
          root.unmount();
        });
        container.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Toasts — semantic class names per kind", () => {
  it("renders one .toast-{kind} class per entry", () => {
    const { container, cleanup } = renderToasts(makeToasts());
    const items = container.querySelectorAll<HTMLElement>(".toast");
    expect(items.length).toBe(2);
    expect(items[0]?.classList.contains("toast-info")).toBe(true);
    expect(items[1]?.classList.contains("toast-success")).toBe(true);
    cleanup();
  });

  it("every toast renders the dismiss-X button", () => {
    const { container, cleanup } = renderToasts(makeToasts());
    const closes = container.querySelectorAll<HTMLButtonElement>(".toast-close");
    expect(closes.length).toBe(2);
    cleanup();
  });

  it("does not render an emoji icon — uses Lucide only", () => {
    // Belt-and-braces: a future contributor adding an emoji inside
    // a toast is a defect, not polish (per AGENTS.md no-emoji rule).
    // We check the rendered text nodes contain only the message body
    // plus no emoji glyphs.
    const { container, cleanup } = renderToasts(makeToasts());
    const texts = container.querySelectorAll<HTMLElement>(".toast-text");
    for (const el of texts) {
      // Unicode emoji ranges — if any of these chars appear, fail.
      // The regex intentionally matches emoji "Presentation" forms
      // (U+1F300..U+1FAFF etc.) but NOT basic Latin punctuation.
      // eslint-disable-next-line no-misleading-character-class
      expect(el.textContent ?? "").not.toMatch(
        /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
      );
    }
    cleanup();
  });

  it("renders the X icon component, never a string glyph", () => {
    // Lucide-react X is imported; if the toast component regresses
    // to a text "<-X-" instead of the icon, this test catches it.
    const { container, cleanup } = renderToasts(makeToasts());
    const svgs = container.querySelectorAll<SVGElement>(".toast-close svg");
    expect(svgs.length).toBe(2);
    cleanup();
  });
});