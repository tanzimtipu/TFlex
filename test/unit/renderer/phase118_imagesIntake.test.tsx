// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Phase 118 (TFL-1245 / TFL-1230 E) - the Create-from-images dialog is a
// CONSUMER of the ONE renderer intake model. The dialog-local `File[]` is
// gone: picker, clipboard and any compact intake layout feed the same
// ordered queue and the same add / remove / reorder handlers. These tests
// pin the observable contract through the rendered rows and the confirm
// payload (the File instances in queue order, byte-for-byte unchanged).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CreateFromImagesDialog } from "../../../src/renderer/components/CreateFromImagesDialog";
import { DEFAULT_CREATE_IMAGE_QUALITY } from "../../../src/renderer/state/preferences";

const { pickMock } = vi.hoisted(() => ({ pickMock: vi.fn() }));

vi.mock("../../../src/renderer/utils/pickImageFiles", () => ({
  pickImageFilesInRenderer: pickMock,
}));

function imgFile(name: string, size = 3): File {
  return new File([new Uint8Array(size).fill(1)], name, { type: "image/png" });
}

interface RenderArgs {
  onConfirm?: (c: { files: File[]; quality: number }) => void;
  onQualityChange?: (q: number) => void;
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
        initialQuality={DEFAULT_CREATE_IMAGE_QUALITY}
        onQualityChange={args.onQualityChange}
        onConfirm={args.onConfirm ?? ((): void => undefined)}
        onClose={(): void => undefined}
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

function rowNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".create-image-name")].map(
    (node) => node.textContent ?? "",
  );
}

function confirmButton(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>("[data-create-confirm]");
}

async function clickPick(container: HTMLElement): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>("[data-create-pick]");
  await act(async (): Promise<void> => {
    button?.click();
    await Promise.resolve();
  });
}

async function click(container: HTMLElement, selector: string): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>(selector);
  await act(async (): Promise<void> => {
    button?.click();
    await Promise.resolve();
  });
}

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

beforeEach((): void => {
  pickMock.mockReset();
  (URL as unknown as { createObjectURL: (f: Blob) => string }).createObjectURL = vi.fn(
    () => "blob:phase118",
  ) as unknown as (f: Blob) => string;
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
});

afterEach((): void => {
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = realCreate;
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = realRevoke;
});

describe("phase118 Create-from-images consumes the ONE intake queue", () => {
  it("adds picked images to the shared queue in order", async () => {
    const a = imgFile("a.png");
    const b = imgFile("b.png");
    const c = imgFile("c.png");
    pickMock.mockResolvedValue({ files: [a, b, c], paths: [] });
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({ onConfirm });
    await clickPick(container);
    expect(rowNames(container)).toEqual(["a.png", "b.png", "c.png"]);

    await click(container, "[data-create-confirm]");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const files = onConfirm.mock.calls[0][0].files as File[];
    expect(files.map((f) => f.name)).toEqual(["a.png", "b.png", "c.png"]);
    // Identity preserved: the model holds the exact File instances.
    expect(files[0]).toBe(a);
    expect(files[1]).toBe(b);
    expect(files[2]).toBe(c);
    cleanup();
  });

  it("reorders with the move button without touching the File bytes", async () => {
    const a = imgFile("a.png");
    const b = imgFile("b.png");
    pickMock.mockResolvedValue({ files: [a, b], paths: [] });
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({ onConfirm });
    await clickPick(container);

    await click(container, "[data-create-move-down='0']");
    expect(rowNames(container)).toEqual(["b.png", "a.png"]);

    await click(container, "[data-create-confirm]");
    const files = onConfirm.mock.calls[0][0].files as File[];
    expect(files).toEqual([b, a]);
    expect(files[0]).toBe(b);
    expect(files[1]).toBe(a);
    cleanup();
  });

  it("reorders a focused row with Alt+ArrowDown", async () => {
    pickMock.mockResolvedValue({ files: [imgFile("a.png"), imgFile("b.png")], paths: [] });
    const { container, cleanup } = renderDialog();
    await clickPick(container);
    const row = container.querySelector<HTMLLIElement>("[data-create-image-row='0']");
    await act(async (): Promise<void> => {
      row?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(rowNames(container)).toEqual(["b.png", "a.png"]);
    cleanup();
  });

  it("removes a row from the shared queue", async () => {
    pickMock.mockResolvedValue({ files: [imgFile("a.png"), imgFile("b.png")], paths: [] });
    const { container, cleanup } = renderDialog();
    await clickPick(container);
    await click(container, "[data-create-remove='0']");
    expect(rowNames(container)).toEqual(["b.png"]);
    await click(container, "[data-create-remove='0']");
    expect(rowNames(container)).toEqual([]);
    expect(confirmButton(container)?.disabled).toBe(true);
    cleanup();
  });

  it("de-dupes by name + size so re-picking the same file is a no-op", async () => {
    const a = imgFile("a.png");
    pickMock.mockResolvedValueOnce({ files: [a], paths: [] });
    pickMock.mockResolvedValueOnce({ files: [imgFile("a.png")], paths: [] });
    const { container, cleanup } = renderDialog();
    await clickPick(container);
    await clickPick(container);
    expect(rowNames(container)).toEqual(["a.png"]);
    cleanup();
  });

  it("keeps two distinct files that share a name (different size)", async () => {
    pickMock.mockResolvedValue({
      files: [imgFile("a.png", 3), imgFile("a.png", 4)],
      paths: [],
    });
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({ onConfirm });
    await clickPick(container);
    expect(container.querySelectorAll("[data-create-image-row]").length).toBe(2);
    await click(container, "[data-create-confirm]");
    const files = onConfirm.mock.calls[0][0].files as File[];
    expect(files.map((f) => f.name)).toEqual(["a.png", "a.png"]);
    expect(files[0]).not.toBe(files[1]);
    cleanup();
  });

  it("keeps Create disabled while empty and enables it with one image", async () => {
    const { container, cleanup } = renderDialog();
    expect(confirmButton(container)?.disabled).toBe(true);
    pickMock.mockResolvedValue({ files: [imgFile("a.png")], paths: [] });
    await clickPick(container);
    expect(confirmButton(container)?.disabled).toBe(false);
    cleanup();
  });

  it("keeps the queue and Create enabled when the host echoes the edited quality (DEF-646)", async () => {
    const onConfirm = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const renderAt = (quality: number): void => {
      act((): void => {
        root.render(
          <CreateFromImagesDialog
            open={true}
            initialQuality={quality}
            onConfirm={onConfirm}
            onClose={(): void => undefined}
          />,
        );
      });
    };
    renderAt(DEFAULT_CREATE_IMAGE_QUALITY);
    pickMock.mockResolvedValue({ files: [imgFile("a.png"), imgFile("b.png")], paths: [] });
    await clickPick(container);
    expect(container.querySelectorAll("[data-create-image-row]").length).toBe(2);
    expect(confirmButton(container)?.disabled).toBe(false);

    // The host writes the edited quality back through the SAME prop; the reset
    // must not fire again and clear the picked queue (the DEF-646 regression).
    renderAt(0.7);
    expect(container.querySelectorAll("[data-create-image-row]").length).toBe(2);
    expect(confirmButton(container)?.disabled).toBe(false);

    act((): void => {
      root.unmount();
    });
    container.remove();
  });

  it("emits the quality fraction to the host on change", async () => {
    const onQualityChange = vi.fn();
    const { container, cleanup } = renderDialog({ onQualityChange });
    const input = container.querySelector<HTMLInputElement>("[data-create-quality]");
    expect(input).not.toBeNull();
    if (input === null) return cleanup();
    await act(async (): Promise<void> => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "70");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // The host preferences pipeline receives the FRACTION (0..1).
    expect(onQualityChange).toHaveBeenLastCalledWith(0.7);
    expect(input.value).toBe("70");
    cleanup();
  });
});
