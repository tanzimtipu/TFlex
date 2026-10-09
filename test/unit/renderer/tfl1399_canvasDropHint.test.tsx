// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so that
// `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Phase 122 (TFL-1399) chunk A - the canvas persistent IntakeTray must NOT
// render the "Drop files to add them to the queue" hint (showDropzone={false}),
// while the default / Home surface keeps it. The queue rows and the Open
// control survive either way.

import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { IntakeItem } from "../../../src/renderer/intake/model";
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

let activeCleanup: (() => void) | null = null;

afterEach((): void => {
  activeCleanup?.();
  activeCleanup = null;
});

function renderTray(
  items: readonly IntakeItem[],
  props: { showDropzone?: boolean; onOpen?: () => void } = {},
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

describe("TFL-1399 canvas drop hint retirement", () => {
  it("omits the dropzone on the canvas surface but keeps queue + Open", () => {
    const { container, cleanup } = renderTray(
      [makeItem({ id: "one", name: "one.pdf", state: "ready" })],
      { showDropzone: false, onOpen: (): void => {} },
    );

    expect(container.querySelector("[data-intake-dropzone]")).toBeNull();
    expect(container.textContent).not.toContain(
      "Drop files to add them to the queue",
    );
    expect(container.querySelector("[data-intake-tray]")).not.toBeNull();
    expect(container.querySelector("[data-intake-row='0']")).not.toBeNull();
    expect(container.querySelector("[data-intake-open]")).not.toBeNull();
    cleanup();
  });

  it("preserves the dropzone by default (Home surface)", () => {
    const { container, cleanup } = renderTray([
      makeItem({ id: "one", name: "one.pdf", state: "ready" }),
    ]);

    expect(container.querySelector("[data-intake-dropzone]")).not.toBeNull();
    expect(container.textContent).toContain(
      "Drop files to add them to the queue",
    );
    cleanup();
  });
});
