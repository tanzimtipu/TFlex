// @vitest-environment jsdom
// Phase 45 item 6 — dialog proportions.
//
// The operator: tool windows (Watermark named) are "too long in height";
// they should be as square as practical. The rule is one shared class,
// `.modal-dialog-tool`, whose CSS widens the box and caps its height so
// the body scrolls (never the whole dialog), plus the Watermark dialog's
// two-column body. These assertions pin the class/sizing contract rather
// than a pixel measurement (the e2e gate measures the live boxes).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { OptimizeDialog } from "../../../src/renderer/components/OptimizeDialog";
import { SaveAsDialog } from "../../../src/renderer/components/SaveAsDialog";

const RENDERER = resolve(process.cwd(), "src/renderer");

function read(rel: string): string {
  return readFileSync(resolve(RENDERER, rel), "utf8");
}

/** Every tool dialog the Phase-45 item-6 spec names, minus the `.sheet`
 *  surfaces (Preferences / About / Accounts) which already ship a
 *  560x640 box and are deliberately untouched. */
const TOOL_DIALOG_FILES = [
  "components/WatermarkDialog.tsx",
  "components/MergeDialog.tsx",
  "components/SplitDialog.tsx",
  "components/CropPagesDialog.tsx",
  "components/OcrDialog.tsx",
  "components/ExportDialog.tsx",
  "components/OptimizeDialog.tsx",
  "components/StampDialog.tsx",
  "components/RenumberPagesDialog.tsx",
  "components/AuditSpaceDialog.tsx",
  "components/DocxExportDialog.tsx",
  "components/TextExportDialog.tsx",
  "components/InsertPagesDialog.tsx",
  "components/ReplacePagesDialog.tsx",
  "components/SaveAsDialog.tsx",
];

describe("Phase 45 item 6 — the square tool-dialog rule", () => {
  const css = read("styles.css");

  it("declares the shared tool-dialog box with a width and a matching height cap", () => {
    expect(css).toContain(".modal-dialog.modal-dialog-tool {");
    // Width floor of 620 and height capped at the same 620 -> square.
    // Phase 92 (TFL-513-A) — the values now resolve from the --dlg-* tokens
    // (--dlg-w-tool / --dlg-h-tool, both 620px).
    expect(css).toMatch(
      /\.modal-dialog\.modal-dialog-tool \{[\s\S]*?width: min\(var\(--dlg-w-tool\),[\s\S]*?max-height: min\(var\(--dlg-max-h\), var\(--dlg-h-tool\)\)/,
    );
  });

  it("lets the tool-dialog body own the vertical scroll (containment)", () => {
    expect(css).toMatch(
      /\.modal-dialog\.modal-dialog-tool > \.modal-body \{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/,
    );
  });

  it("keeps wide-by-design tools (Crop / Renumber) at 720 but capped", () => {
    // Phase 92 (TFL-513-A) — token form: --dlg-w-lg (720px) with the taller
    // --dlg-h-tool-wide (680px) cap.
    expect(css).toMatch(
      /\.modal-dialog\.modal-dialog-tool\.modal-dialog-wide \{[\s\S]*?width: min\(var\(--dlg-w-lg\),[\s\S]*?max-height: min\(var\(--dlg-max-h\), var\(--dlg-h-tool-wide\)\)/,
    );
  });

  it("re-lays the Watermark body into two columns", () => {
    const watermark = read("components/WatermarkDialog.tsx");
    expect(watermark).toContain("watermark-cols");
    expect(watermark).toContain("watermark-col-fields");
    expect(watermark).toContain("watermark-col-side");
    expect(css).toMatch(
      /\.watermark-cols \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 176px;/,
    );
    // Collapses to one column on narrow boxes.
    expect(css).toMatch(/@media \(max-width: 700px\) \{[\s\S]*?\.watermark-cols/);
  });

  it("leaves the .sheet surfaces (Preferences / About / Accounts) unchanged", () => {
    expect(css).toMatch(/\.sheet \{[\s\S]*?width: min\(560px[\s\S]*?max-height: min\(640px/);
  });

  it("leaves the Create-from-images dialog's own responsive sizing in place", () => {
    expect(css).toContain("[data-create-from-images-dialog].modal-dialog {");
  });

  it.each(TOOL_DIALOG_FILES)("%s carries the modal-dialog-tool class", (rel) => {
    const source = read(rel);
    // The class may be applied directly, or delegated to the shared
    // DialogShell via its `size="tool"` prop, which maps to
    // `.modal-dialog-tool` at render time (DialogShell SIZE_CLASS.tool).
    const ownsClass = source.includes("modal-dialog-tool");
    const optsIntoToolSize = /size\s*=\s*["'{]+tool["'}]+/.test(source);
    expect(ownsClass || optsIntoToolSize).toBe(true);
  });});

describe("Phase 45 item 6 — the class actually renders", () => {
  it("OptimizeDialog's box carries modal-dialog-tool", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        <OptimizeDialog
          open={true}
          initialPreset="compact"
          originalBytes={1000}
          runOptimize={async () => ({ error: "engine-error" })}
          onConfirm={(): void => undefined}
          onClose={(): void => undefined}
        />,
      );
    });
    expect(container.querySelector(".modal-dialog.modal-dialog-tool")).not.toBeNull();
    act((): void => {
      root.unmount();
    });
    container.remove();
  });

  it("SaveAsDialog's box carries modal-dialog-tool via the shell size prop", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        <SaveAsDialog
          open={true}
          saveAsLinearize={false}
          onSaveAsLinearizeChange={(): void => undefined}
          onConfirm={(): void => undefined}
          onClose={(): void => undefined}
        />,
      );
    });
    expect(container.querySelector(".modal-dialog.modal-dialog-tool")).not.toBeNull();
    act((): void => {
      root.unmount();
    });
    container.remove();
  });
});
