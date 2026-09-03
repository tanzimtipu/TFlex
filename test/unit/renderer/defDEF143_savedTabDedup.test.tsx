// @vitest-environment jsdom
// DEF-143 — typing + saving several signatures ("1","2","3","4") made
// the Saved tab show N duplicates of the FIRST signature, and delete
// was inconsistent (badge "Saved (3)" but 6 rows). Root cause: the
// modal took `next[0]` from `SignatureService.save`, which returns the
// FULL persisted list OLDEST-FIRST (the main service appends), so
// `next[0]` was always the first-ever signature.
//
// The fix: the modal adopts the service's returned list VERBATIM on
// save (and on delete), so the Saved tab renders exactly what was
// persisted and the count badge matches the rendered rows.
//
// This test drives the real modal against a FAKE service that mimics
// the main-process appending behavior, and asserts the Saved tab shows
// four DISTINCT signatures and delete removes exactly the clicked one.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { SignatureManagerModal } from "../../../src/renderer/signatures/SignatureManagerModal";
import { _resetSignatureServiceForTests } from "../../../src/renderer/signatures/service";
import type {
  SavedSignature,
  SignatureSource,
} from "../../../src/shared/types";

let fakeList: SavedSignature[] = [];

function installAppendingService(): void {
  fakeList = [];
  const svc = {
    list: async (): Promise<SavedSignature[]> => fakeList.slice(),
    save: async (source: SignatureSource, label?: string): Promise<SavedSignature[]> => {
      const entry: SavedSignature = {
        id: `sig-${fakeList.length + 1}`,
        label:
          label?.trim().length
            ? label!.trim()
            : source.kind === "typed"
              ? source.text.trim()
              : `Signature ${fakeList.length + 1}`,
        createdAt: new Date().toISOString(),
        source,
      };
      // APPEND oldest-first, exactly like the real main-process
      // SignatureService.save (the stub engine prepends instead —
      // which is why `next[0]` only "worked" in the stub path).
      fakeList = [...fakeList, entry];
      return fakeList.slice();
    },
    delete: async (id: string): Promise<SavedSignature[]> => {
      fakeList = fakeList.filter((s) => s.id !== id);
      return fakeList.slice();
    },
  };
  (window as unknown as { tflex?: { signatures?: typeof svc } }).tflex = { signatures: svc };
  _resetSignatureServiceForTests();
}

beforeEach(() => {
  installAppendingService();
});

afterEach(() => {
  delete (window as unknown as { tflex?: unknown }).tflex;
  _resetSignatureServiceForTests();
  fakeList = [];
});

function mountModal(saved: SavedSignature[] = []): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  function Harness(): ReactElement {
    return createElement(SignatureManagerModal, {
      open: true,
      onClose: (): void => undefined,
      onApply: (): void => undefined,
      savedSignatures: saved,
      onToast: (): void => undefined,
    });
  }
  act((): void => {
    root.render(createElement(Harness));
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function clickSigTab(host: HTMLElement, name: string): void {
  const tabs = host.querySelectorAll<HTMLElement>(".sig-tab");
  for (const t of tabs) {
    if (t.textContent?.trim().startsWith(name)) {
      act((): void => {
        t.click();
      });
      return;
    }
  }
  throw new Error(`tab ${name} not found`);
}

async function typeText(host: HTMLElement, value: string): Promise<void> {
  const input = host.querySelector<HTMLInputElement>(
    "[aria-label='Type your signature']",
  );
  expect(input).not.toBeNull();
  if (input === null) return;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async (): Promise<void> => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function clickSave(host: HTMLElement): Promise<void> {
  const btn = host.querySelector<HTMLButtonElement>(".sig-tab-actions .btn-primary");
  expect(btn).not.toBeNull();
  if (btn === null) return;
  await act(async (): Promise<void> => {
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function typeAndSave(host: HTMLElement, value: string): Promise<void> {
  clickSigTab(host, "Type");
  await typeText(host, value);
  await clickSave(host);
}

function savedRows(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>(".sig-saved-row"));
}

function tabBadgeText(host: HTMLElement, name: string): string {
  const tabs = host.querySelectorAll<HTMLElement>(".sig-tab");
  for (const t of tabs) {
    if (t.textContent?.trim().startsWith(name)) {
      return t.textContent?.trim() ?? "";
    }
  }
  return "";
}

describe("DEF-143 — Saved tab renders exactly what was saved, delete stays consistent", () => {
  it("four distinct typed signatures after typing+saving 1/2/3/4", async () => {
    const { host, unmount } = mountModal([]);
    try {
      await typeAndSave(host, "1");
      await typeAndSave(host, "2");
      await typeAndSave(host, "3");
      await typeAndSave(host, "4");

      const rows = savedRows(host);
      expect(rows.length).toBe(4);
      const labels = rows.map((r) =>
        r.querySelector(".sig-saved-label")?.textContent ?? "",
      );
      expect(labels).toEqual(["1", "2", "3", "4"]);
      // Thumbnails are distinct (each typed signature renders its own text).
      const thumbs = rows.map((r) =>
        r.querySelector(".sig-saved-pick .sig-thumb")?.textContent ?? "",
      );
      expect(thumbs).toEqual(["1", "2", "3", "4"]);
      // Badge matches the rendered row count.
      expect(tabBadgeText(host, "Saved")).toBe("Saved (4)");
    } finally {
      unmount();
    }
  });

  it("deleting the first row removes exactly it and the count matches", async () => {
    const { host, unmount } = mountModal([]);
    try {
      await typeAndSave(host, "1");
      await typeAndSave(host, "2");
      await typeAndSave(host, "3");
      await typeAndSave(host, "4");

      const firstDelete = host.querySelector<HTMLButtonElement>(
        ".sig-saved-row .sig-saved-delete",
      );
      expect(firstDelete).not.toBeNull();
      if (firstDelete === null) return;
      await act(async (): Promise<void> => {
        firstDelete.click();
        await new Promise((r) => setTimeout(r, 0));
      });

      // After one delete: 3 rows, badge "Saved (3)", the remaining are
      // the distinct 2/3/4 (no stale "1" duplicates).
      const rows = savedRows(host);
      const labels = rows.map((r) =>
        r.querySelector(".sig-saved-label")?.textContent ?? "",
      );
      expect(labels).toEqual(["2", "3", "4"]);
      expect(rows.length).toBe(3);
      expect(tabBadgeText(host, "Saved")).toBe("Saved (3)");

      // Delete the (new) first row again: 2 rows, "3"/"4".
      const secondDelete = host.querySelector<HTMLButtonElement>(
        ".sig-saved-row .sig-saved-delete",
      );
      expect(secondDelete).not.toBeNull();
      if (secondDelete === null) return;
      await act(async (): Promise<void> => {
        secondDelete.click();
        await new Promise((r) => setTimeout(r, 0));
      });
      const labels2 = savedRows(host).map((r) =>
        r.querySelector(".sig-saved-label")?.textContent ?? "",
      );
      expect(labels2).toEqual(["3", "4"]);
      expect(tabBadgeText(host, "Saved")).toBe("Saved (2)");
    } finally {
      unmount();
    }
  });
});
