// @vitest-environment jsdom
// Phase 40 item 3 — the Create-from-images dialog must resize with the
// application window: it fits inside a small (900x600) viewport with no
// clipped control and uses the space at large (1920x1080) sizes.
//
// jsdom does not resolve the cascade or compute layout, so the
// responsive contract is pinned two ways, mirroring the existing CSS
// guard tests:
//   1. Static: the scoped rules in styles.css use viewport-relative
//      sizing and move the vertical scroll onto the dialog body /
//      file list (so the header and footer stay reachable).
//   2. DOM: the dialog still exposes the backdrop hook the scoped
//      rules select on (`data-create-from-images-dialog`).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CreateFromImagesDialog } from "../../../src/renderer/components/CreateFromImagesDialog";
import { DEFAULT_CREATE_IMAGE_QUALITY } from "../../../src/renderer/state/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const SRC = readFileSync(STYLES_PATH, "utf8");

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractRuleBody(src: string, selectorIndex: number): string {
  const braceOpen = src.indexOf("{", selectorIndex);
  if (braceOpen === -1) return "";
  let depth = 0;
  for (let i = braceOpen; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(braceOpen + 1, i);
    }
  }
  return "";
}

function findRuleBody(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(selector, from);
    if (idx === -1) return null;
    let cursor = idx + selector.length;
    while (cursor < stripped.length && /\s/.test(stripped[cursor] ?? "")) cursor += 1;
    if (stripped[cursor] === "{") return extractRuleBody(stripped, idx);
    from = idx + selector.length;
  }
}

describe("Phase 40 item 3 — CreateFromImagesDialog responsive CSS", () => {
  it("scopes the responsive rules to the dialog's backdrop hook", () => {
    const stripped = stripCssComments(SRC);
    expect(stripped).toContain("[data-create-from-images-dialog].modal-dialog");
    expect(stripped).toContain("[data-create-from-images-dialog] .modal-body");
    expect(stripped).toContain(
      "[data-create-from-images-dialog] .create-image-list",
    );
  });

  it("sizes the dialog from the viewport (fits small, grows large)", () => {
    const body = findRuleBody(SRC, "[data-create-from-images-dialog].modal-dialog");
    expect(body).not.toBeNull();
    // Width tracks the viewport between a small floor and a large cap.
    expect(body).toMatch(/width:\s*clamp\(\s*320px\s*,\s*62vw\s*,\s*760px\s*\)/);
    // TFL-1197 (DEF-632 / ER18) — while empty the box is CONTENT-DRIVEN: an
    // auto height capped by the viewport, so no large blank body is reserved.
    expect(body).toMatch(/height:\s*auto/);
    expect(body).toMatch(/max-height:\s*min\(\s*72vh\s*,\s*760px\s*\)/);
    // minmax(0, 1fr) stops the body from forcing the dialog to scroll
    // as a whole (which would carry the footer out of the viewport).
    expect(body).toMatch(/grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
  });

  it("applies the tall preview height only once files exist (DEF-632)", () => {
    const body = findRuleBody(
      SRC,
      "[data-create-from-images-dialog][data-create-has-files].modal-dialog",
    );
    expect(body).not.toBeNull();
    expect(body).toMatch(/height:\s*min\(\s*72vh\s*,\s*760px\s*\)/);
  });

  it("moves the vertical scroll onto the body so header/footer stay reachable", () => {
    const body = findRuleBody(SRC, "[data-create-from-images-dialog] .modal-body");
    expect(body).not.toBeNull();
    expect(body).toMatch(/min-height:\s*0/);
    expect(body).toMatch(/overflow-y:\s*auto/);
  });

  it("lets the file list take the leftover space and scroll internally", () => {
    const body = findRuleBody(
      SRC,
      "[data-create-from-images-dialog] .create-image-list",
    );
    expect(body).not.toBeNull();
    expect(body).toMatch(/flex:\s*1\s+1\s+auto/);
    expect(body).toMatch(/min-height:\s*0/);
    // The base fixed 160px cap must be lifted so large windows can use
    // the space; the global base rule keeps its own cap for other uses.
    expect(body).toMatch(/max-height:\s*none/);
  });

  it("wraps the picker button row at the smallest widths", () => {
    const body = findRuleBody(SRC, "[data-create-from-images-dialog] .modal-row");
    expect(body).not.toBeNull();
    expect(body).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe("Phase 40 item 3 — CreateFromImagesDialog DOM hook", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach((): void => {
    if (root !== null) {
      act((): void => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
  });

  it("exposes the backdrop hook the scoped responsive rules select on", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act((): void => {
      root?.render(
        <CreateFromImagesDialog
          open={true}
          initialQuality={DEFAULT_CREATE_IMAGE_QUALITY}
          onConfirm={(): void => undefined}
          onClose={(): void => undefined}
        />,
      );
    });
    const dialog = container.querySelector("[data-create-from-images-dialog]");
    expect(dialog).not.toBeNull();
    expect(dialog?.classList.contains("modal-dialog")).toBe(true);
    expect(dialog?.querySelector(".modal-body")).not.toBeNull();
  });

  it("is content-sized when empty: no grow marker and no has-files hook (DEF-632)", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act((): void => {
      root?.render(
        <CreateFromImagesDialog
          open={true}
          initialQuality={DEFAULT_CREATE_IMAGE_QUALITY}
          onConfirm={(): void => undefined}
          onClose={(): void => undefined}
        />,
      );
    });
    const dialog = container.querySelector("[data-create-from-images-dialog]");
    expect(dialog).not.toBeNull();
    // Empty dialog: no tall preview body is reserved.
    expect(dialog?.classList.contains("task-dialog-preview-grow")).toBe(false);
    expect(dialog?.hasAttribute("data-create-has-files")).toBe(false);
    expect(dialog?.querySelector("[data-create-list]")).toBeNull();
  });
});