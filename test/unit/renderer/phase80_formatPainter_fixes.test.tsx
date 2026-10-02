// @vitest-environment jsdom
// Phase 80 (F2) — Format Painter fixes DEF-474/475/476.
//
// The apply pass lives in DocumentView; its target resolution and apply
// decision are extracted as pure helpers (`resolvePainterTarget`,
// `resolveFormatPainterApply`, `textTargetKey`) so each defect is pinned
// without mounting the whole view. The observable hint element is pinned by
// mounting the real TextPropertiesPanel (the same style as
// phase80_formatPainter.test.tsx).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { TextPropertiesPanel } from "../../../src/renderer/edit/TextPropertiesPanel";
import {
  defaultTextStyleValues,
  type TextStyleValues,
} from "../../../src/renderer/edit/textStyle";
import {
  FORMAT_PAINTER_HINT,
  painterTargetIsTransientBox,
  resolveFormatPainterApply,
  resolvePainterTarget,
  textTargetKey,
} from "../../../src/renderer/components/DocumentView";

function base(): TextStyleValues {
  return defaultTextStyleValues("Helvetica");
}

/** The box id an Edit overlay reports (with page/rect/text), as the real
 *  overlay reports it. */
function reportedBox(
  id: string,
  page: number,
): {
  kind: "box";
  id: string;
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  text: string;
} {
  return {
    kind: "box",
    id,
    page,
    rect: { x: 0, y: 0, width: 100, height: 20 },
    text: id,
  };
}

describe("Phase 80 (F2) — DEF-474 cross-page target recognition", () => {
  it("the authoritative page-2 box wins over a stale page-1 report", () => {
    const armedKey = textTargetKey(
      resolvePainterTarget({
        selectedAnnText: false,
        selectedAnnotationId: null,
        boxToolActive: true,
        selectedBoxId: "box-page-1",
        reported: reportedBox("box-page-1", 1),
      }),
    );
    // Page 2 is clicked: the engine selection moves, the overlay report is
    // still the page-1 box (the DEF-474 clobber).
    const target = resolvePainterTarget({
      selectedAnnText: false,
      selectedAnnotationId: null,
      boxToolActive: true,
      selectedBoxId: "box-page-2",
      reported: reportedBox("box-page-1", 1),
    });
    const newKey = textTargetKey(target);
    expect(armedKey).toBe("box:box-page-1");
    expect(newKey).toBe("box:box-page-2");
    expect(newKey).not.toBe(armedKey);
    expect(
      resolveFormatPainterApply({
        armed: true,
        targetKey: newKey,
        armedKey,
        targetKind: "box",
        targetIsTransient: false,
      }).kind,
    ).toBe("apply");
  });

  it("a run reported by the text tool stays the target under a stale box selection", () => {
    const target = resolvePainterTarget({
      selectedAnnText: false,
      selectedAnnotationId: null,
      boxToolActive: false,
      selectedBoxId: "box-page-1",
      reported: {
        kind: "run",
        page: 1,
        rect: { x: 1, y: 2, width: 3, height: 4 },
        text: "raw",
      },
    });
    expect(target?.kind).toBe("run");
  });

  it("a selected annotation wins over any box selection", () => {
    const target = resolvePainterTarget({
      selectedAnnText: true,
      selectedAnnotationId: "ann-9",
      boxToolActive: true,
      selectedBoxId: "box-page-1",
      reported: reportedBox("box-page-1", 1),
    });
    expect(textTargetKey(target)).toBe("annotation:ann-9");
  });
});

describe("Phase 80 (F2) — DEF-475 hint clears back on an applicable source", () => {
  it("re-selecting the arming source clears the hint and never re-applies", () => {
    expect(
      resolveFormatPainterApply({
        armed: true,
        targetKey: "box:src",
        armedKey: "box:src",
        targetKind: "box",
        targetIsTransient: false,
      }),
    ).toEqual({ kind: "clear-hint" });
  });

  it("re-selecting an annotation source clears the hint too", () => {
    expect(
      resolveFormatPainterApply({
        armed: true,
        targetKey: "annotation:src",
        armedKey: "annotation:src",
        targetKind: "annotation",
        targetIsTransient: false,
      }),
    ).toEqual({ kind: "clear-hint" });
  });

  it("a raw run still shows the fail-loud hint and stays armed", () => {
    expect(
      resolveFormatPainterApply({
        armed: true,
        targetKey: "run:1:1:2:3:4",
        armedKey: "box:src",
        targetKind: "run",
        targetIsTransient: false,
      }),
    ).toEqual({ kind: "hint", hint: FORMAT_PAINTER_HINT });
  });
});

describe("Phase 80 (F2) — DEF-476 transient placement box does not consume", () => {
  it("a just-placed box shows the hint instead of applying", () => {
    expect(
      resolveFormatPainterApply({
        armed: true,
        targetKey: "box:new",
        armedKey: "box:src",
        targetKind: "box",
        targetIsTransient: true,
      }),
    ).toEqual({ kind: "hint", hint: FORMAT_PAINTER_HINT });
  });

  it("a committed different box still applies", () => {
    expect(
      resolveFormatPainterApply({
        armed: true,
        targetKey: "box:tgt",
        armedKey: "box:src",
        targetKind: "box",
        targetIsTransient: false,
      }).kind,
    ).toBe("apply");
  });

  it("a disarmed painter is idle regardless of the target", () => {
    expect(
      resolveFormatPainterApply({
        armed: false,
        targetKey: "box:tgt",
        armedKey: null,
        targetKind: "box",
        targetIsTransient: false,
      }),
    ).toEqual({ kind: "idle" });
  });
});

describe("Phase 80 (F2) — DEF-476 LIVE derivation with a lagging report", () => {
  it("the authoritative selected box marks a just-placed box transient even while the report still points at the source", () => {
    // The overlay's post-commit report lags the reducer by one render: the
    // authoritative selection has already moved to the just-placed box while
    // `reported` still holds the arming source.
    const target = resolvePainterTarget({
      selectedAnnText: false,
      selectedAnnotationId: null,
      boxToolActive: true,
      selectedBoxId: "box-new",
      reported: reportedBox("box-src", 1),
    });
    expect(target).toEqual({ kind: "box", id: "box-new" });
    const targetIsTransient = painterTargetIsTransientBox({
      target,
      selectedBoxId: "box-new",
      selectedBoxIsNew: true,
      reported: reportedBox("box-src", 1),
    });
    expect(targetIsTransient).toBe(true);
    expect(
      resolveFormatPainterApply({
        armed: true,
        targetKey: textTargetKey(target),
        armedKey: "box:box-src",
        targetKind: "box",
        targetIsTransient,
      }),
    ).toEqual({ kind: "hint", hint: FORMAT_PAINTER_HINT });
  });

  it("the authoritative marker wins even when the report is null (the first lagging render)", () => {
    const target = resolvePainterTarget({
      selectedAnnText: false,
      selectedAnnotationId: null,
      boxToolActive: true,
      selectedBoxId: "box-new",
      reported: null,
    });
    expect(
      painterTargetIsTransientBox({
        target,
        selectedBoxId: "box-new",
        selectedBoxIsNew: true,
        reported: null,
      }),
    ).toBe(true);
  });

  it("a different committed box derives as applicable and applies in one action", () => {
    const target = resolvePainterTarget({
      selectedAnnText: false,
      selectedAnnotationId: null,
      boxToolActive: true,
      selectedBoxId: "box-tgt",
      reported: reportedBox("box-src", 1),
    });
    const targetIsTransient = painterTargetIsTransientBox({
      target,
      selectedBoxId: "box-tgt",
      selectedBoxIsNew: false,
      reported: reportedBox("box-src", 1),
    });
    expect(targetIsTransient).toBe(false);
    expect(
      resolveFormatPainterApply({
        armed: true,
        targetKey: textTargetKey(target),
        armedKey: "box:box-src",
        targetKind: "box",
        targetIsTransient,
      }).kind,
    ).toBe("apply");
  });

  it("the report fallback still marks a transient box when the reducer entry is momentarily unavailable", () => {
    const target = resolvePainterTarget({
      selectedAnnText: false,
      selectedAnnotationId: null,
      boxToolActive: false,
      selectedBoxId: null,
      reported: { ...reportedBox("box-new", 1), isNew: true },
    });
    expect(
      painterTargetIsTransientBox({
        target,
        selectedBoxId: null,
        selectedBoxIsNew: false,
        reported: { ...reportedBox("box-new", 1), isNew: true },
      }),
    ).toBe(true);
  });
});

describe("Phase 80 (F2) — DEF-478 commit transition keeps the painter armed", () => {
  it("a box placed while armed stays transient after the engine echo clears isNew", () => {
    // Placement render: the reducer mirror marks the new box `isNew`. The
    // armed-session recorder captures its id.
    const createdWhileArmed = new Set<string>(["box-new"]);
    const target = resolvePainterTarget({
      selectedAnnText: false,
      selectedAnnotationId: null,
      boxToolActive: true,
      selectedBoxId: "box-new",
      reported: reportedBox("box-src", 1),
    });
    expect(target).toEqual({ kind: "box", id: "box-new" });
    // Commit render: `replace-text-boxes` rehydrated the mirror, `isNew` is
    // cleared and the report now points at the committed box. Without the
    // armed-session marker this would read as an applicable new target.
    const targetIsTransient = painterTargetIsTransientBox({
      target,
      selectedBoxId: "box-new",
      selectedBoxIsNew: false,
      reported: reportedBox("box-new", 1),
      createdWhileArmed,
    });
    expect(targetIsTransient).toBe(true);
    expect(
      resolveFormatPainterApply({
        armed: true,
        targetKey: textTargetKey(target),
        armedKey: "box:box-src",
        targetKind: "box",
        targetIsTransient,
      }),
    ).toEqual({ kind: "hint", hint: FORMAT_PAINTER_HINT });
  });

  it("a pre-existing committed box selected after placement still applies", () => {
    const createdWhileArmed = new Set<string>(["box-new"]);
    const target = resolvePainterTarget({
      selectedAnnText: false,
      selectedAnnotationId: null,
      boxToolActive: true,
      selectedBoxId: "box-tgt",
      reported: reportedBox("box-new", 1),
    });
    const targetIsTransient = painterTargetIsTransientBox({
      target,
      selectedBoxId: "box-tgt",
      selectedBoxIsNew: false,
      reported: reportedBox("box-new", 1),
      createdWhileArmed,
    });
    expect(targetIsTransient).toBe(false);
    expect(
      resolveFormatPainterApply({
        armed: true,
        targetKey: textTargetKey(target),
        armedKey: "box:box-src",
        targetKind: "box",
        targetIsTransient,
      }).kind,
    ).toBe("apply");
  });
});

describe("Phase 80 (F2) — the observable hint element", () => {
  function mount(hint: string | null): { host: HTMLElement; render: (h: string | null) => void; cleanup: () => void } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (h: string | null): void => {
      act((): void => {
        root.render(
          createElement(TextPropertiesPanel, {
            open: true,
            values: base(),
            defaults: base(),
            onPatch: (): void => undefined,
            painterHint: h,
          }),
        );
      });
    };
    render(hint);
    return {
      host: container,
      render,
      cleanup: (): void => {
        act((): void => root.unmount());
        container.remove();
      },
    };
  }

  it("shows the hint while armed and removes it when the hint clears", () => {
    const { host, render, cleanup } = mount(FORMAT_PAINTER_HINT);
    expect(host.querySelector("[data-txt-format-painter-hint]")?.textContent).toBe(
      FORMAT_PAINTER_HINT,
    );
    render(null);
    expect(host.querySelector("[data-txt-format-painter-hint]")).toBeNull();
    cleanup();
  });
});