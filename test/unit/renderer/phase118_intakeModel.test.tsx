// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so that
// `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Phase 118 (Drag Drop and Import) - the ONE intake model and Tray contract.
//
// Covers chunk B's guarantees:
//   - classification routing for pdf / image / convertible / unknown (and no
//     bogus "Ready" before the caller supplies a real detection result),
//   - order preservation across add + reorder,
//   - remove is queue-only (never touches the file),
//   - duplicate basenames are disambiguated, never merged,
//   - dispatch opens each PDF once and the image set exactly once,
//   - the IntakeTray surface exposes the documented data-* hooks.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  basename,
  createIntakeModel,
  type IntakeItem,
} from "../../../src/renderer/intake/model";
import { IntakeTray } from "../../../src/renderer/intake/IntakeTray";

function makeItem(overrides: Partial<IntakeItem> = {}): IntakeItem {
  const base: IntakeItem = {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2)}`,
    name: overrides.name ?? "report.pdf",
    pathOrFile: overrides.pathOrFile ?? "/docs/report.pdf",
    kind: overrides.kind ?? "pdf",
    state: overrides.state ?? "ready",
  };
  if (overrides.error !== undefined) base.error = overrides.error;
  return base;
}

describe("phase118 intake model - classification", () => {
  it("starts every item validating/unknown and never fabricates Ready", () => {
    const model = createIntakeModel();
    model.add({ pathOrFile: "/docs/report.pdf" });
    for (const item of model.items()) {
      expect(item.state).toBe("validating");
      expect(item.kind).toBe("unknown");
    }
  });

  it("routes each real detection kind and keeps a truthful failure", () => {
    const model = createIntakeModel();
    const pdf = model.add({ pathOrFile: "C:\\docs\\report.pdf" });
    const image = model.add({ pathOrFile: "/pics/scan.png" });
    const convertible = model.add({ pathOrFile: "/docs/notes.docx" });
    const unknown = model.add({ pathOrFile: "/docs/mystery.xyz" });

    model.classify(pdf.id, { kind: "pdf" });
    model.classify(image.id, { kind: "image" });
    model.classify(convertible.id, { kind: "convertible" });
    model.classify(unknown.id, {
      kind: "unknown",
      error: '"mystery.xyz" is not a file type Jovrel can open.',
    });

    expect(pdf.kind).toBe("pdf");
    expect(pdf.state).toBe("ready");
    expect(image.kind).toBe("image");
    expect(image.state).toBe("ready");
    expect(convertible.kind).toBe("convertible");
    expect(convertible.state).toBe("ready");
    expect(unknown.kind).toBe("unknown");
    expect(unknown.state).toBe("failed");
    expect(unknown.error).toContain("mystery.xyz");
  });
});

describe("phase118 intake model - order and removal", () => {
  it("preserves order across add and one-slot reorder", () => {
    const model = createIntakeModel();
    model.add({ name: "a.pdf", pathOrFile: "/x/a.pdf" });
    model.add({ name: "b.pdf", pathOrFile: "/x/b.pdf" });
    model.add({ name: "c.pdf", pathOrFile: "/x/c.pdf" });

    expect(model.items().map((item) => item.name)).toEqual([
      "a.pdf",
      "b.pdf",
      "c.pdf",
    ]);
    expect(model.reorder(2, -1)).toBe(true);
    expect(model.items().map((item) => item.name)).toEqual([
      "a.pdf",
      "c.pdf",
      "b.pdf",
    ]);
    expect(model.reorder(0, 1)).toBe(true);
    expect(model.items().map((item) => item.name)).toEqual([
      "c.pdf",
      "a.pdf",
      "b.pdf",
    ]);
    expect(model.reorder(0, -1)).toBe(false);
    expect(model.reorder(2, 1)).toBe(false);
  });

  it("removes from the queue only and never deletes the file", () => {
    const model = createIntakeModel();
    const file = new File(["%PDF-1.7"], "report.pdf", {
      type: "application/pdf",
    });
    const item = model.add({ pathOrFile: file });

    const removed = model.remove(item.id);
    expect(model.size()).toBe(0);
    expect(removed?.pathOrFile).toBe(file);
    expect(file.name).toBe("report.pdf");
    expect(file.size).toBeGreaterThan(0);
    expect(model.remove(item.id)).toBeUndefined();
  });

  it("disambiguates duplicate basenames instead of merging them", () => {
    const model = createIntakeModel();
    model.add({ name: "report.pdf", pathOrFile: "/a/report.pdf" });
    model.add({ name: "report.pdf", pathOrFile: "/b/report.pdf" });
    model.add({ name: "report.pdf", pathOrFile: "/c/report.pdf" });

    expect(model.items().map((item) => item.name)).toEqual([
      "report.pdf",
      "report (2).pdf",
      "report (3).pdf",
    ]);
    expect(model.size()).toBe(3);
  });
});

describe("phase118 intake model - dispatch", () => {
  it("opens each PDF once and the image set exactly once", async () => {
    const model = createIntakeModel();
    const pdfOne = model.add({ pathOrFile: "/docs/one.pdf" });
    const pdfTwo = model.add({ pathOrFile: "/docs/two.pdf" });
    const imgOne = model.add({ pathOrFile: "/img/a.png" });
    const imgTwo = model.add({ pathOrFile: "/img/b.jpg" });
    model.classify(pdfOne.id, { kind: "pdf" });
    model.classify(pdfTwo.id, { kind: "pdf" });
    model.classify(imgOne.id, { kind: "image" });
    model.classify(imgTwo.id, { kind: "image" });

    const openPdf = vi.fn(async (_path: string): Promise<void> => undefined);
    const createFromImages = vi.fn(async (): Promise<unknown> => ({}));
    const result = await model.dispatch({ openPdf, createFromImages }, 0.8);

    expect(openPdf).toHaveBeenCalledTimes(2);
    expect(openPdf).toHaveBeenNthCalledWith(1, "/docs/one.pdf");
    expect(openPdf).toHaveBeenNthCalledWith(2, "/docs/two.pdf");
    expect(createFromImages).toHaveBeenCalledTimes(1);
    expect(createFromImages).toHaveBeenCalledWith(
      ["/img/a.png", "/img/b.jpg"],
      0.8,
    );
    expect(result.opened.map((item) => item.id)).toEqual([
      pdfOne.id,
      pdfTwo.id,
    ]);
    expect(result.images.map((item) => item.id)).toEqual([
      imgOne.id,
      imgTwo.id,
    ]);
    expect(pdfOne.state).toBe("done");
    expect(imgTwo.state).toBe("done");
  });

  it("keeps convertibles and unknowns out of dispatch and in the queue", async () => {
    const model = createIntakeModel();
    const convertible = model.add({ pathOrFile: "/docs/notes.docx" });
    const unknown = model.add({ pathOrFile: "/docs/x.xyz" });
    model.classify(convertible.id, { kind: "convertible" });
    model.classify(unknown.id, { kind: "unknown" });

    const openPdf = vi.fn(async (_path: string): Promise<void> => undefined);
    const createFromImages = vi.fn(async (): Promise<unknown> => ({}));
    const result = await model.dispatch({ openPdf, createFromImages });

    expect(openPdf).not.toHaveBeenCalled();
    expect(createFromImages).not.toHaveBeenCalled();
    expect(result.skipped.map((item) => item.id).sort()).toEqual(
      [convertible.id, unknown.id].sort(),
    );
    expect(model.size()).toBe(2);
  });

  it("fails a bad PDF with its error while the good PDF still opens", async () => {
    const model = createIntakeModel();
    const bad = model.add({ pathOrFile: "/docs/bad.pdf" });
    const good = model.add({ pathOrFile: "/docs/good.pdf" });
    model.classify(bad.id, { kind: "pdf" });
    model.classify(good.id, { kind: "pdf" });

    const openPdf = vi.fn(async (path: string): Promise<void> => {
      if (path.includes("bad")) throw new Error("corrupt");
    });
    const result = await model.dispatch({
      openPdf,
      createFromImages: vi.fn(async (): Promise<unknown> => ({})),
    });

    expect(bad.state).toBe("failed");
    expect(bad.error).toBe("corrupt");
    expect(good.state).toBe("done");
    expect(result.opened.map((item) => item.id)).toEqual([good.id]);
    expect(result.skipped.map((item) => item.id)).toEqual([bad.id]);
  });

  it("opens every remaining PDF in order when a row is removed mid-dispatch (DEF-655)", async () => {
    const model = createIntakeModel();
    const a = model.add({ pathOrFile: "/docs/a.pdf" });
    const b = model.add({ pathOrFile: "/docs/b.pdf" });
    const c = model.add({ pathOrFile: "/docs/c.pdf" });
    for (const item of [a, b, c]) model.classify(item.id, { kind: "pdf" });

    let release!: () => void;
    const gate = new Promise<void>((resolve): void => {
      release = resolve;
    });
    const openPdf = vi.fn(async (path: string): Promise<void> => {
      if (path.endsWith("a.pdf")) {
        // Remove the NEXT queued row while this open is pending: the live-array
        // iterator used to skip b's successor, c.
        model.remove(b.id);
        await gate;
      }
    });
    const running = model.dispatch({
      openPdf,
      createFromImages: vi.fn(async (): Promise<unknown> => ({})),
    });
    release();
    const result = await running;

    expect(openPdf.mock.calls.map((call) => call[0])).toEqual([
      "/docs/a.pdf",
      "/docs/c.pdf",
    ]);
    expect(result.opened.map((item) => item.id)).toEqual([a.id, c.id]);
    expect(result.skipped.map((item) => item.id)).not.toContain(b.id);
  });

  it("builds the images PDF exactly once when dispatch() is re-entered (DEF-656)", async () => {
    const model = createIntakeModel();
    // Image FIRST so it is collected (and marked converting) before the pending
    // PDF open, which is the window the old code re-collected it in.
    const img = model.add({ pathOrFile: "/img/a.png" });
    const pdf = model.add({ pathOrFile: "/docs/a.pdf" });
    model.classify(img.id, { kind: "image" });
    model.classify(pdf.id, { kind: "pdf" });

    let release!: () => void;
    const gate = new Promise<void>((resolve): void => {
      release = resolve;
    });
    const openPdf = vi.fn(async (_path: string): Promise<void> => {
      await gate;
    });
    const createFromImages = vi.fn(async (): Promise<unknown> => ({}));

    const first = model.dispatch({ openPdf, createFromImages });
    expect(img.state, "image enters converting at collection time").toBe("converting");

    const second = await model.dispatch({ openPdf, createFromImages });
    expect(second).toEqual({ opened: [], images: [], skipped: [] });

    release();
    const result = await first;

    expect(openPdf).toHaveBeenCalledTimes(1);
    expect(createFromImages).toHaveBeenCalledTimes(1);
    expect(result.images.map((item) => item.id)).toEqual([img.id]);
    expect(result.opened.map((item) => item.id)).toEqual([pdf.id]);
  });
});

describe("phase118 intake model - basename", () => {
  it("derives a short basename from Windows and POSIX paths", () => {
    expect(basename("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
    expect(basename("/home/me/img/scan.png")).toBe("scan.png");
    const file = new File([], "picked.png", { type: "image/png" });
    expect(basename(file)).toBe("picked.png");
  });
});

interface TrayRenderProps {
  active?: boolean;
  emptyHint?: string;
  onRemove?: (id: string) => void;
  onMove?: (index: number, dir: -1 | 1) => void;
}

let activeCleanup: (() => void) | null = null;

afterEach((): void => {
  activeCleanup?.();
  activeCleanup = null;
});

function renderTray(
  items: readonly IntakeItem[],
  props: TrayRenderProps = {},
): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act((): void => {
    root.render(<IntakeTray items={items} {...props} />);
  });
  const cleanup = (): void => {
    act((): void => {
      root.unmount();
    });
    container.remove();
  };
  activeCleanup = cleanup;
  return { container, cleanup };
}

describe("phase118 IntakeTray render contract", () => {
  it("renders the tray root, dropzone and concise empty state", () => {
    const { container, cleanup } = renderTray([]);
    expect(container.querySelector("[data-intake-tray]")).not.toBeNull();
    expect(container.querySelector("[data-intake-dropzone]")).not.toBeNull();
    expect(container.querySelectorAll("[data-intake-row]")).toHaveLength(0);
    cleanup();
  });

  it("renders one row per item with type, state and reorder/remove controls", () => {
    const items = [
      makeItem({ id: "one", name: "one.pdf" }),
      makeItem({ id: "two", name: "two.png", kind: "image" }),
    ];
    const { container, cleanup } = renderTray(items);

    expect(container.querySelectorAll("[data-intake-row]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-intake-state]")).toHaveLength(2);
    expect(container.querySelector("[data-intake-remove='0']")).not.toBeNull();
    expect(container.querySelector("[data-intake-remove='1']")).not.toBeNull();
    const up = container.querySelector<HTMLButtonElement>(
      "[data-intake-move-up='0']",
    );
    const down = container.querySelector<HTMLButtonElement>(
      "[data-intake-move-down='1']",
    );
    expect(up?.disabled).toBe(true);
    expect(down?.disabled).toBe(true);
    cleanup();
  });

  it("shows a truthful error node for a failed item", () => {
    const items = [
      makeItem({
        id: "bad",
        name: "bad.xyz",
        kind: "unknown",
        state: "failed",
        error: '"bad.xyz" is not a file type Jovrel can open.',
      }),
    ];
    const { container, cleanup } = renderTray(items);
    const error = container.querySelector("[data-intake-error='0']");
    expect(error?.textContent).toContain("bad.xyz");
    cleanup();
  });

  it("reflects the active drop indication only while active", () => {
    const on = renderTray([], { active: true });
    expect(
      on.container.querySelector("[data-intake-dropzone][data-intake-active]"),
    ).not.toBeNull();
    on.cleanup();

    const off = renderTray([], { active: false });
    expect(off.container.querySelector("[data-intake-active]")).toBeNull();
    off.cleanup();
  });

  it("forwards remove and reorder clicks to the host", () => {
    const items = [
      makeItem({ id: "one", name: "one.pdf" }),
      makeItem({ id: "two", name: "two.pdf" }),
    ];
    const onRemove = vi.fn();
    const onMove = vi.fn();
    const { container, cleanup } = renderTray(items, { onRemove, onMove });

    act((): void => {
      container.querySelector<HTMLButtonElement>("[data-intake-remove='1']")?.click();
    });
    expect(onRemove).toHaveBeenCalledWith("two");

    act((): void => {
      container.querySelector<HTMLButtonElement>("[data-intake-move-down='0']")?.click();
    });
    expect(onMove).toHaveBeenCalledWith(0, 1);
    cleanup();
  });

  it("reorders a focused row with Alt+Arrow and ignores IME composition", () => {
    const items = [
      makeItem({ id: "one", name: "one.pdf" }),
      makeItem({ id: "two", name: "two.pdf" }),
    ];
    const onMove = vi.fn();
    const { container, cleanup } = renderTray(items, { onMove });
    const row = container.querySelector<HTMLLIElement>("[data-intake-row='0']");

    act((): void => {
      row?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onMove).toHaveBeenCalledWith(0, 1);

    onMove.mockClear();
    act((): void => {
      row?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          altKey: true,
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onMove).not.toHaveBeenCalled();
    cleanup();
  });
});


