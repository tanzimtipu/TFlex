// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  CreateFromImagesDialog,
  CLIPBOARD_NO_IMAGE_MESSAGE,
  CLIPBOARD_EMPTY_MESSAGE,
  CLIPBOARD_TOO_LARGE_MESSAGE,
  CLIPBOARD_UNREADABLE_MESSAGE,
  clipboardReasonMessage,
  DEFAULT_CREATE_IMAGE_QUALITY,
  clampCreateImageQuality,
} from "../../../src/renderer/components/CreateFromImagesDialog";
import {
  qualityFractionToPercent,
  qualityPercentToFraction,
} from "../../../src/renderer/state/preferences";

// TFL-951 — drive the OS file picker with controlled File objects so the
// reorder / page-count assertions can build a real multi-image list in jsdom.
const { pickMock } = vi.hoisted(() => ({ pickMock: vi.fn() }));

vi.mock("../../../src/renderer/utils/pickImageFiles", () => ({
  pickImageFilesInRenderer: pickMock,
}));

/**
 * Phase 9 — Create-from-images dialog rendering tests.
 *
 * The dialog's contract:
 *   - Renders the file picker (`data-create-pick`).
 *   - Lists picked files (one row per file) and exposes a remove
 *     button (`data-create-remove`).
 *   - Quality input displays as a percentage (10..100) for the user
 *     but the canonical persisted value is a FRACTION (0..1) so the
 *     wire shape matches the backend's `normalizeSettings`
 *     validation. `onQualityChange` receives the fraction; `onConfirm`
 *     receives the fraction. The display/input ranges are unit-
 *     tested in `preferences.test.ts` (clamp + percent↔fraction).
 *   - Confirm button is disabled until at least one file is picked.
 *   - On confirm, fires `onConfirm` with the picked files + quality
 *     (the fraction).
 *   - Esc + backdrop + close button all fire `onClose`.
 *
 * File-picker resolution is mocked here: jsdom can't drive the
 * native OS dialog. The dialog exposes the picked File objects via
 * a module-private path; tests poke the dialog by directly setting
 * the File[] state through the underlying React state... we cheat by
 * monkey-patching the dialog's button click to populate via a stub
 * picker. The cleanest way is to just verify the form/state contract
 * by checking the disabled / enabled states; the actual OS picker
 * integration is covered by the e2e harness.
 */

interface RenderArgs {
  initialQuality?: number;
  onConfirm?: (c: { files: File[]; quality: number }) => void;
  onQualityChange?: (q: number) => void;
  onClose?: () => void;
  readClipboard?: () => Promise<Uint8Array | string | null | { error: string }>;
}

function renderDialog(args: RenderArgs = {}): {
  root: Root;
  container: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <CreateFromImagesDialog
        open={true}
        initialQuality={args.initialQuality ?? DEFAULT_CREATE_IMAGE_QUALITY}
        onQualityChange={args.onQualityChange}
        onConfirm={args.onConfirm ?? ((): void => undefined)}
        readClipboard={args.readClipboard}
        onClose={args.onClose ?? ((): void => undefined)}
      />,
    );
  });
  return {
    root,
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** A PNG signature followed by filler; enough for the dialog (it only
 *  sniffs the magic bytes, never decodes in jsdom). */
function pngBytes(fill = 0): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, fill]);
}

/** Drive the dialog's clipboard button and flush the async handler. */
async function clickClipboard(container: HTMLElement): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>(
    "[data-create-from-clipboard]",
  );
  expect(button).not.toBeNull();
  await act(async (): Promise<void> => {
    button?.click();
    // Let the awaited readClipboard() + state commit settle.
    await Promise.resolve();
  });
}

describe("CreateFromImagesDialog — render contract", () => {
  it("renders the picker and confirm button", () => {
    const { container, cleanup } = renderDialog();
    expect(container.querySelector("[data-create-pick]")).not.toBeNull();
    expect(container.querySelector("[data-create-confirm]")).not.toBeNull();
    cleanup();
  });

  it("disables confirm when no files are picked", () => {
    const { container, cleanup } = renderDialog();
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-create-confirm]",
    );
    expect(confirm?.disabled).toBe(true);
    cleanup();
  });

  it("renders nothing when open=false", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        <CreateFromImagesDialog
          open={false}
          initialQuality={DEFAULT_CREATE_IMAGE_QUALITY}
          onConfirm={(): void => undefined}
          onClose={(): void => undefined}
        />,
      );
    });
    expect(container.querySelector("[data-create-from-images-dialog]")).toBeNull();
    act((): void => {
      root.unmount();
    });
    container.remove();
  });
});

describe("CreateFromImagesDialog — quality control", () => {
  it("seeds the quality input from the prop (fraction -> percent display)", () => {
    // Pass a fraction (the persisted shape). The dialog should
    // render the corresponding percentage (60).
    const { container, cleanup } = renderDialog({ initialQuality: 0.6 });
    const input = container.querySelector<HTMLInputElement>(
      "[data-create-quality]",
    );
    expect(input?.value).toBe(String(qualityFractionToPercent(0.6)));
    expect(input?.value).toBe("60");
    cleanup();
  });

  it("clamps out-of-range quality input on every change", () => {
    const onQualityChange = vi.fn();
    const { container, cleanup } = renderDialog({ onQualityChange });
    const input = container.querySelector<HTMLInputElement>(
      "[data-create-quality]",
    );
    expect(input).not.toBeNull();
    if (input === null) return cleanup();
    // React listens for the native `input` event on controlled
    // number inputs. Setting `.value` directly bypasses React's
    // value tracker; the React Testing Library approach is to use
    // the prototype's native value setter so React sees the new
    // value through its input event listener.
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "5");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Out-of-range "5" clamps to 10 percent on the display, and the
    // host callback receives the matching fraction (0.1).
    expect(input.value).toBe("10");
    expect(onQualityChange).toHaveBeenLastCalledWith(qualityPercentToFraction(10));
    cleanup();
  });

  it("clamps above-range quality input on every change", () => {
    const onQualityChange = vi.fn();
    const { container, cleanup } = renderDialog({ onQualityChange });
    const input = container.querySelector<HTMLInputElement>(
      "[data-create-quality]",
    );
    expect(input).not.toBeNull();
    if (input === null) return cleanup();
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "999");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Above-range clamps to 100 percent on display, fraction 1.0
    // surfaces via onQualityChange.
    expect(input.value).toBe("100");
    expect(onQualityChange).toHaveBeenLastCalledWith(qualityPercentToFraction(100));
    cleanup();
  });
});

describe("CreateFromImagesDialog — close paths", () => {
  it("fires onClose when the backdrop is clicked (genuine outside click)", () => {
    // B3/B6 — a REAL outside click (mousedown AND click both on the
    // backdrop) still closes; `backdrop.click()` alone dispatches
    // only the click, so the mousedown must fire first.
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({ onClose });
    const backdrop = container.querySelector<HTMLElement>(".modal-backdrop");
    expect(backdrop).not.toBeNull();
    if (backdrop === null) return cleanup();
    act((): void => {
      backdrop.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });
    act((): void => {
      backdrop.click();
    });
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });

  it("fires onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({ onClose });
    const close = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Close dialog']",
    );
    expect(close).not.toBeNull();
    if (close === null) return cleanup();
    act((): void => {
      close.click();
    });
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });
});

describe("clampCreateImageQuality — boundary clamp (0..1 fraction)", () => {
  it("clamps negative values up to 0", () => {
    expect(clampCreateImageQuality(-0.5)).toBe(0);
    expect(clampCreateImageQuality(-1)).toBe(0);
  });
  it("clamps above-1 values down to 1", () => {
    expect(clampCreateImageQuality(1.1)).toBe(1);
    expect(clampCreateImageQuality(9999)).toBe(1);
  });
  it("rounds fractional input to 3 decimal places", () => {
    expect(clampCreateImageQuality(0.1234)).toBe(0.123);
    expect(clampCreateImageQuality(0.85)).toBe(0.85);
    expect(clampCreateImageQuality(0.5)).toBe(0.5);
  });
  it("passes valid fractions through", () => {
    expect(clampCreateImageQuality(0)).toBe(0);
    expect(clampCreateImageQuality(1)).toBe(1);
    expect(clampCreateImageQuality(0.85)).toBe(0.85);
  });
});

// Phase 45 item 1 — the clipboard path. The dialog must INSERT a copied
// image into the same list the picker feeds (with a preview), and must
// refuse plain text with a clear, non-blocking message instead of
// synthesising a text PDF.
describe("CreateFromImagesDialog — clipboard image (Phase 45 item 1)", () => {
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;

  beforeEach((): void => {
    // jsdom lacks object URLs; stub them so ImageThumb takes its real
    // (non-empty) branch and we can assert the rendered src + revoke.
    (URL as unknown as { createObjectURL: (f: Blob) => string }).createObjectURL = vi.fn(
      () => "blob:clip-test",
    ) as unknown as (f: Blob) => string;
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
  });

  afterEach((): void => {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = realCreate;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = realRevoke;
  });

  it("renders the clipboard button only when the host supplies the reader", () => {
    const without = renderDialog();
    expect(without.container.querySelector("[data-create-from-clipboard]")).toBeNull();
    without.cleanup();

    const withReader = renderDialog({ readClipboard: async () => null });
    expect(
      withReader.container.querySelector("[data-create-from-clipboard]"),
    ).not.toBeNull();
    withReader.cleanup();
  });

  it("inserts a copied PNG as a list item with a rendered preview", async () => {
    const { container, cleanup } = renderDialog({
      readClipboard: async () => pngBytes(),
    });
    await clickClipboard(container);

    expect(container.querySelectorAll("[data-create-image-row]").length).toBe(1);
    const name = container.querySelector(".create-image-name");
    expect(name?.textContent).toBe("Clipboard image 1.png");
    // The actual preview element the operator said was missing.
    const thumb = container.querySelector<HTMLImageElement>("[data-create-thumb]");
    expect(thumb).not.toBeNull();
    expect(thumb?.src).toBe("blob:clip-test");
    // Confirm is now enabled (one image in the list).
    const confirm = container.querySelector<HTMLButtonElement>("[data-create-confirm]");
    expect(confirm?.disabled).toBe(false);
    cleanup();
  });

  it("labels a clipboard JPEG by its magic bytes, not always .png", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const { container, cleanup } = renderDialog({
      readClipboard: async () => jpeg,
    });
    await clickClipboard(container);
    expect(container.querySelector(".create-image-name")?.textContent).toBe(
      "Clipboard image 1.jpg",
    );
    cleanup();
  });

  it("numbers successive clipboard images so they do not collide", async () => {
    const { container, cleanup } = renderDialog({
      readClipboard: async () => pngBytes(),
    });
    await clickClipboard(container);
    await clickClipboard(container);
    const names = [...container.querySelectorAll(".create-image-name")].map(
      (n) => n.textContent,
    );
    expect(names).toEqual(["Clipboard image 1.png", "Clipboard image 2.png"]);
    expect(container.querySelectorAll("[data-create-image-row]").length).toBe(2);
    cleanup();
  });

  it("revokes the preview object URL when a row is removed", async () => {
    const { container, cleanup } = renderDialog({
      readClipboard: async () => pngBytes(),
    });
    await clickClipboard(container);
    const remove = container.querySelector<HTMLButtonElement>("[data-create-remove='0']");
    await act(async (): Promise<void> => {
      remove?.click();
      await Promise.resolve();
    });
    expect(container.querySelectorAll("[data-create-image-row]").length).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clip-test");
    cleanup();
  });

  it("refuses plain text with the clear message and creates nothing", async () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({
      onConfirm,
      readClipboard: async () => "just some copied text",
    });
    await clickClipboard(container);

    const alert = container.querySelector(".modal-status[role='alert']");
    expect(alert?.textContent).toBe(CLIPBOARD_NO_IMAGE_MESSAGE);
    expect(container.querySelectorAll("[data-create-image-row]").length).toBe(0);
    const confirm = container.querySelector<HTMLButtonElement>("[data-create-confirm]");
    expect(confirm?.disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    cleanup();
  });

  it("reports an empty clipboard without creating anything", async () => {
    const { container, cleanup } = renderDialog({ readClipboard: async () => null });
    await clickClipboard(container);
    expect(
      container.querySelector(".modal-status[role='alert']")?.textContent,
    ).toBe("Clipboard is empty.");
    expect(container.querySelectorAll("[data-create-image-row]").length).toBe(0);
    cleanup();
  });

  it("surfaces a reader error verbatim", async () => {
    const { container, cleanup } = renderDialog({
      readClipboard: async () => ({ error: "Could not read clipboard: denied" }),
    });
    await clickClipboard(container);
    expect(
      container.querySelector(".modal-status[role='alert']")?.textContent,
    ).toBe("Could not read clipboard: denied");
    cleanup();
  });
});

// Phase 45 item 2 — the main-side clipboard channel is the PRIMARY path (it
// also sees an image FILE copied in Explorer, which the async web clipboard
// cannot); the renderer reader is only the fallback for an older preload. Each
// of the channel's four failure reasons maps to a clear, non-blocking message.
describe("CreateFromImagesDialog — clipboard routing (Phase 45 item 2)", () => {
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  const globalWindow = window as unknown as { tflex?: unknown };

  type Reason = "empty" | "no-image" | "too-large" | "unreadable";
  type BridgeResult =
    | { ok: true; bytes: Uint8Array; mime: "image/png" | "image/jpeg" }
    | { ok: false; reason: Reason };

  function setClipboardBridge(readImage: () => Promise<BridgeResult>): void {
    globalWindow.tflex = { clipboard: { readImage } };
  }

  beforeEach((): void => {
    (URL as unknown as { createObjectURL: (f: Blob) => string }).createObjectURL = vi.fn(
      () => "blob:clip-test",
    ) as unknown as (f: Blob) => string;
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
  });

  afterEach((): void => {
    delete globalWindow.tflex;
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = realCreate;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = realRevoke;
  });

  it("offers the button from the channel alone, with no fallback reader", () => {
    setClipboardBridge(async () => ({ ok: false, reason: "empty" }));
    const { container, cleanup } = renderDialog();
    expect(container.querySelector("[data-create-from-clipboard]")).not.toBeNull();
    cleanup();
  });

  it("PRIMARY: inserts an image FILE read by the channel (JPEG magic bytes)", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    setClipboardBridge(async () => ({ ok: true, bytes: jpeg, mime: "image/jpeg" }));
    const fallback = vi.fn(async () => pngBytes());
    const { container, cleanup } = renderDialog({ readClipboard: fallback });
    await clickClipboard(container);

    expect(container.querySelectorAll("[data-create-image-row]").length).toBe(1);
    expect(container.querySelector(".create-image-name")?.textContent).toBe(
      "Clipboard image 1.jpg",
    );
    expect(container.querySelector("[data-create-thumb]")).not.toBeNull();
    // The channel covers the case, so the fallback is never consulted.
    expect(fallback).not.toHaveBeenCalled();
    cleanup();
  });

  it("FALLBACK: uses the renderer reader when no channel is exposed", async () => {
    const { container, cleanup } = renderDialog({ readClipboard: async () => pngBytes() });
    await clickClipboard(container);
    expect(container.querySelector(".create-image-name")?.textContent).toBe(
      "Clipboard image 1.png",
    );
    cleanup();
  });

  it("does NOT fall back when the channel answers no-image", async () => {
    setClipboardBridge(async () => ({ ok: false, reason: "no-image" }));
    const fallback = vi.fn(async () => pngBytes());
    const { container, cleanup } = renderDialog({ readClipboard: fallback });
    await clickClipboard(container);
    expect(container.querySelector(".modal-status[role='alert']")?.textContent).toBe(
      CLIPBOARD_NO_IMAGE_MESSAGE,
    );
    expect(container.querySelectorAll("[data-create-image-row]").length).toBe(0);
    expect(fallback).not.toHaveBeenCalled();
    cleanup();
  });

  it("maps all four channel reasons to their non-blocking messages", async () => {
    const cases: ReadonlyArray<readonly [Reason, string]> = [
      ["empty", CLIPBOARD_EMPTY_MESSAGE],
      ["no-image", CLIPBOARD_NO_IMAGE_MESSAGE],
      ["too-large", CLIPBOARD_TOO_LARGE_MESSAGE],
      ["unreadable", CLIPBOARD_UNREADABLE_MESSAGE],
    ];
    for (const [reason, message] of cases) {
      setClipboardBridge(async () => ({ ok: false, reason }));
      const { container, cleanup } = renderDialog();
      await clickClipboard(container);
      expect(container.querySelector(".modal-status[role='alert']")?.textContent).toBe(message);
      expect(container.querySelectorAll("[data-create-image-row]").length).toBe(0);
      expect(
        container.querySelector<HTMLButtonElement>("[data-create-confirm]")?.disabled,
      ).toBe(true);
      cleanup();
    }
  });

  it("clipboardReasonMessage covers every reason", () => {
    expect(clipboardReasonMessage("empty")).toBe(CLIPBOARD_EMPTY_MESSAGE);
    expect(clipboardReasonMessage("no-image")).toBe(CLIPBOARD_NO_IMAGE_MESSAGE);
    expect(clipboardReasonMessage("too-large")).toBe(CLIPBOARD_TOO_LARGE_MESSAGE);
    expect(clipboardReasonMessage("unreadable")).toBe(CLIPBOARD_UNREADABLE_MESSAGE);
  });
});

// TFL-951 — ordered reordering, page-count wording and the grouped encoding
// options. The picker is mocked so a real multi-image list can be driven.
describe("CreateFromImagesDialog — reorder + encoding (TFL-951)", () => {
  function imgFile(name: string): File {
    return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
  }

  function rowNames(container: HTMLElement): string[] {
    return [...container.querySelectorAll(".create-image-name")].map(
      (n) => n.textContent ?? "",
    );
  }

  async function clickPick(container: HTMLElement): Promise<void> {
    const button = container.querySelector<HTMLButtonElement>("[data-create-pick]");
    await act(async (): Promise<void> => {
      button?.click();
      await Promise.resolve();
    });
  }

  beforeEach((): void => {
    pickMock.mockReset();
  });

  it("moves a row down and keeps that order in the confirm payload", async () => {
    pickMock.mockResolvedValue({
      files: [imgFile("a.png"), imgFile("b.png")],
      paths: [],
    });
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({ onConfirm });
    await clickPick(container);
    expect(rowNames(container)).toEqual(["a.png", "b.png"]);

    const down = container.querySelector<HTMLButtonElement>(
      "[data-create-move-down='0']",
    );
    await act(async (): Promise<void> => {
      down?.click();
      await Promise.resolve();
    });
    expect(rowNames(container)).toEqual(["b.png", "a.png"]);

    const confirm = container.querySelector<HTMLButtonElement>("[data-create-confirm]");
    await act(async (): Promise<void> => {
      confirm?.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0].files.map((f: File) => f.name)).toEqual([
      "b.png",
      "a.png",
    ]);
    cleanup();
  });

  it("moves a row up with the explicit control", async () => {
    pickMock.mockResolvedValue({
      files: [imgFile("a.png"), imgFile("b.png")],
      paths: [],
    });
    const { container, cleanup } = renderDialog();
    await clickPick(container);
    const up = container.querySelector<HTMLButtonElement>("[data-create-move-up='1']");
    await act(async (): Promise<void> => {
      up?.click();
      await Promise.resolve();
    });
    expect(rowNames(container)).toEqual(["b.png", "a.png"]);
    cleanup();
  });

  it("disables move-up on the first row and move-down on the last", async () => {
    pickMock.mockResolvedValue({
      files: [imgFile("a.png"), imgFile("b.png")],
      paths: [],
    });
    const { container, cleanup } = renderDialog();
    await clickPick(container);
    expect(
      container.querySelector<HTMLButtonElement>("[data-create-move-up='0']")?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>("[data-create-move-down='0']")?.disabled,
    ).toBe(false);
    expect(
      container.querySelector<HTMLButtonElement>("[data-create-move-up='1']")?.disabled,
    ).toBe(false);
    expect(
      container.querySelector<HTMLButtonElement>("[data-create-move-down='1']")?.disabled,
    ).toBe(true);
    cleanup();
  });

  it("reorders with Alt+ArrowDown from a focused row", async () => {
    pickMock.mockResolvedValue({
      files: [imgFile("a.png"), imgFile("b.png")],
      paths: [],
    });
    const { container, cleanup } = renderDialog();
    await clickPick(container);
    const row = container.querySelector<HTMLLIElement>("[data-create-image-row='0']");
    await act(async (): Promise<void> => {
      row?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          altKey: true,
          bubbles: true,
        }),
      );
    });
    expect(rowNames(container)).toEqual(["b.png", "a.png"]);
    cleanup();
  });

  it("shows the real page count wording", async () => {
    pickMock.mockResolvedValue({
      files: [imgFile("a.png"), imgFile("b.png")],
      paths: [],
    });
    const { container, cleanup } = renderDialog();
    await clickPick(container);
    expect(container.querySelector(".modal-picked")?.textContent).toBe("2 pages");
    cleanup();
  });

  it("uses singular page for a single image", async () => {
    pickMock.mockResolvedValue({ files: [imgFile("a.png")], paths: [] });
    const { container, cleanup } = renderDialog();
    await clickPick(container);
    expect(container.querySelector(".modal-picked")?.textContent).toBe("1 page");
    cleanup();
  });

  it("groups the quality control under an Encoding options heading", () => {
    const { container, cleanup } = renderDialog();
    expect(container.querySelector("[data-create-encoding]")).not.toBeNull();
    expect(container.textContent).toContain("Encoding options");
    expect(container.querySelector("[data-create-quality]")).not.toBeNull();
    cleanup();
  });

  it("does not reserve a preview list in the empty state", () => {
    const { container, cleanup } = renderDialog();
    expect(container.querySelector("[data-create-list]")).toBeNull();
    expect(container.textContent).toContain("No images selected");
    cleanup();
  });
});
