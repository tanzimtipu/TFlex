// DEF-258 — the text-run commit must forward the panel's FULL style.
//
// The panel's Text-field session commits an edited run through
// `engine.editTextRun`. `EditTextRunPayload extends TextStyleFields`
// (Phase 21) plus `charSpacing` (Phase 27); the old handler built the
// payload from an explicit field list (`page`/`rect`/`newText`/`font`/
// `size`/`color`/`oldRect`) and silently dropped every style field, so a
// 6 pt character spacing (or bold / align / lineHeight / highlight /
// baselineShift / list / indent) never reached the engine and the saved
// stream had no `Tc`.
//
// `buildEditTextRunPayload` is what the host passes verbatim to
// `engine.editTextRun`, so these assertions pin the exact wire payload.
import { describe, expect, it } from "vitest";
import {
  buildEditTextRunPayload,
  defaultTextStyleValues,
  editTextStyleFromValues,
} from "../../../src/renderer/edit/textStyle";

const RECT = { x: 72, y: 60, width: 200, height: 14 };

describe("DEF-258 — editTextRun payload carries the full panel style", () => {
  it("forwards every Phase-21/27 field the panel holds, when set", () => {
    const style = editTextStyleFromValues({
      ...defaultTextStyleValues("Helvetica"),
      bold: true,
      italic: true,
      underline: true,
      align: "center",
      lineHeight: 1.6,
      highlight: { r: 1, g: 0.9, b: 0.2 },
      baselineShift: 6,
      list: "bullet",
      indent: 12,
      charSpacing: 6,
    });
    const payload = buildEditTextRunPayload({
      rect: { ...RECT },
      newText: "TFlex Technical Report X",
      style,
      page: 2,
    });
    // The legacy fields stay exactly as before.
    expect(payload.page).toBe(2);
    expect(payload.rect).toEqual(RECT);
    expect(payload.newText).toBe("TFlex Technical Report X");
    expect(payload.font).toBe("Helvetica");
    expect(payload.size).toBe(12);
    expect(payload.color).toEqual({ r: 0, g: 0, b: 0 });
    // Every set style field rides through — this is the DEF-258 fix.
    expect(payload.charSpacing).toBe(6);
    expect(payload.bold).toBe(true);
    expect(payload.italic).toBe(true);
    expect(payload.underline).toBe(true);
    expect(payload.align).toBe("center");
    expect(payload.lineHeight).toBe(1.6);
    expect(payload.highlight).toEqual({ r: 1, g: 0.9, b: 0.2 });
    expect(payload.baselineShift).toBe(6);
    expect(payload.list).toBe("bullet");
    expect(payload.indent).toBe(12);
    // No MOVE rect on a plain in-place edit.
    expect(payload.oldRect).toBeUndefined();
  });

  it("a default-style run still produces the legacy minimal payload", () => {
    const style = editTextStyleFromValues(defaultTextStyleValues("Times"));
    const payload = buildEditTextRunPayload({
      rect: { ...RECT },
      newText: "plain",
      style,
      page: 1,
    });
    // Byte-identical legacy shape: only the pre-Phase-21 fields, no style
    // key present (so the engine keeps its single-draw path).
    expect(payload).toEqual({
      page: 1,
      rect: RECT,
      newText: "plain",
      font: "Times",
      size: 12,
      color: { r: 0, g: 0, b: 0 },
    });
    expect(Object.keys(payload).sort()).toEqual(
      ["color", "font", "newText", "page", "rect", "size"].sort(),
    );
  });

  it("omits a zero charSpacing and a white-sentinel highlight (defaults)", () => {
    const style = editTextStyleFromValues({
      ...defaultTextStyleValues("Courier"),
      charSpacing: 0,
      highlight: { r: 1, g: 1, b: 1 },
    });
    const payload = buildEditTextRunPayload({
      rect: { ...RECT },
      newText: "noop",
      style,
      page: 1,
    });
    expect("charSpacing" in payload).toBe(false);
    expect("highlight" in payload).toBe(false);
  });

  it("carries oldRect only for a MOVE commit", () => {
    const style = editTextStyleFromValues({
      ...defaultTextStyleValues("Helvetica"),
      charSpacing: 3,
    });
    const payload = buildEditTextRunPayload({
      rect: { x: 300, y: 220, width: 200, height: 14 },
      newText: "moved",
      style,
      page: 3,
      oldRect: { ...RECT },
    });
    expect(payload.oldRect).toEqual(RECT);
    expect(payload.charSpacing).toBe(3);
    expect(payload.rect).toEqual({ x: 300, y: 220, width: 200, height: 14 });
  });

  it("clamps an out-of-range charSpacing to the engine's -5..20 window", () => {
    const style = editTextStyleFromValues({
      ...defaultTextStyleValues("Helvetica"),
      charSpacing: 999,
    });
    const payload = buildEditTextRunPayload({
      rect: { ...RECT },
      newText: "clamped",
      style,
      page: 1,
    });
    expect(payload.charSpacing).toBe(20);
  });
});
