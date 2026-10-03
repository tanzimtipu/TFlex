// Phase 6 — annotation color palette UI.
//
// Replaces the row of preset swatches in the annotation toolbar with a
// picker that opens to the side of an active color swatch. The user can
// pick one of the built-in presets (yellow / red / green / blue), one of
// their custom presets (per theme), or open the full visual picker with
// a saturation/value pad and a hue slider (Phase 7).
//
// Two affordances are deliberately kept separate:
//   - "Quick" swatches — single-click to apply.
//   - "Custom" presets — also single-click, but persist per-theme.
//
// The full picker (pad + slider) does NOT mutate state directly — the
// user picks a color, hits "Add", and only then does the palette
// reducer add a preset. This keeps accidental clicks into the pad
// from polluting the saved palette.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_HEX,
  type AnnotationColor,
} from './model';
import {
  EMPTY_ANNOTATION_COLORS,
  hexToHsl,
  hslToHex,
  normalizeHex,
  parseRgb,
  pickFromHueSlider,
  pickFromPad,
  reducer as paletteReducer,
  type AnnotationColorPreset,
  type AnnotationTheme,
  type AnnotationColors,
  type Hsl,
} from '../state/colorPalette';

export interface ColorPaletteHandle {
  /** Focus the hue slider. Used by the parent when the "Custom" button
   *  on the toolbar is clicked — the toolbar knows the popover is
   *  closed at that point but wants to land focus inside it. */
  focusPad(): void;
}

interface ColorPaletteProps {
  theme: AnnotationTheme;
  /** Currently-active built-in color. The matching preset swatch is
   *  marked active. */
  activeColor: AnnotationColor;
  /** Currently-applied custom color (if any). Used to mark the matching
   *  custom preset as active. */
  activeCustomHex: string | null;
  /** Custom preset list, keyed by theme. Mutated through `onChange`
   *  which receives the next palette state; the parent persists. */
  presets: AnnotationColors;
  onChange: (next: AnnotationColors) => void;
  /** Apply a color to the live annotation tool. The built-in swatches
   *  call this with one of `AnnotationColor`. Custom presets call it
   *  with the hex string and the matching built-in color for fallback
   *  shape (the renderer only stores AnnotationColor, but the
   *  AnnotationOverlay already accepts a hex override — see
   *  annotations/AnnotationOverlay). */
  onApplyBuiltIn: (color: AnnotationColor) => void;
  onApplyCustom: (hex: string) => void;
}

const ColorPalette = forwardRef<ColorPaletteHandle, ColorPaletteProps>(
  function ColorPalette(props, ref): ReactElement {
    const {
      theme,
      activeColor,
      activeCustomHex,
      presets,
      onChange,
      onApplyBuiltIn,
      onApplyCustom,
    } = props;

    // Initial seed: pick from the currently-applied color if it's a
    // custom hex, otherwise land on the matching built-in. When the
    // active color flips (the user picks a swatch outside the picker)
    // the picker should reflect that on the next render so the cursors
    // snap to the new color, not stay parked at the old one.
    const seedHex = useMemo((): string => {
      if (activeCustomHex !== null) return activeCustomHex;
      return ANNOTATION_COLOR_HEX[activeColor];
    }, [activeCustomHex, activeColor]);
    const seedHsl = useMemo<Hsl>(
      () => hexToHsl(seedHex) ?? { h: 0, s: 1, v: 1 },
      [seedHex],
    );

    // The pad picks saturation / value at the current hue; the slider
    // picks the hue. We hold them separately so dragging the slider
    // doesn't lose the user's pad position (and vice versa).
    const [hue, setHue] = useState<number>(seedHsl.h);
    const [sv, setSv] = useState<{ s: number; v: number }>({
      s: seedHsl.s,
      v: seedHsl.v,
    });
    const [inputError, setInputError] = useState<string | null>(null);
    // DEF-070 — controlled hex input. The picker renders an editable
    // `#rrggbb` field next to the pad so users can paste a hex from
    // elsewhere (the retest flow: `await window.fill('input[aria-
    // label="Custom color hex"]', '#0000ff')` then Enter). The
    // field's local string is held separately from the live preview
    // hex because the user may be mid-edit (an invalid partial hex
    // like `#aabbccd` should not yet overwrite the picker state).
    // On a successful Enter / blur, we parse and apply.
    const [hexDraft, setHexDraft] = useState<string>(seedHex);
    const padRef = useRef<HTMLDivElement | null>(null);
    const sliderRef = useRef<HTMLDivElement | null>(null);
    // Refs hold the active drag state without re-rendering. The pad /
    // slider cursors read from `sv` / `hue`; we only re-render the
    // cursor positions on pointermove, not on every pointerover.
    const draggingPadRef = useRef<boolean>(false);
    const draggingSliderRef = useRef<boolean>(false);

    useImperativeHandle(ref, () => ({
      focusPad: (): void => {
        padRef.current?.focus();
      },
    }), []);

    // Re-seed when the active color flips to a different built-in or
    // a different custom hex (e.g. via the toolbar's quick swatches).
    // Without this, dragging the pad would jump back to the old
    // location the next time the user touches it.
    //
    // DEF-070 — also keep `hexDraft` in sync with the seed so the
    // visible hex input reflects whatever the picker is showing.
    // We only overwrite the draft when the parsed preview actually
    // matches the seed (i.e. the user isn't mid-typing); mid-typing
    // edits stay in the draft and the preview is unaffected.
    useEffect(() => {
      const next = hexToHsl(seedHex);
      if (next === null) return;
      setHue(next.h);
      setSv({ s: next.s, v: next.v });
      setInputError(null);
      // Only reseed the draft when it isn't already showing a valid
      // parseable hex — a user typing "#0000" mid-edit shouldn't have
      // their input clobbered every time the active color changes.
      if (normalizeHex(hexDraft) === null) {
        setHexDraft(seedHex);
      }
    }, [seedHex]);

    const themePresets = presets[theme];

    // The live preview hex: hsl(hue, s, v) → lowercase #rrggbb.
    // Computed on every render — cheap (one trig per channel) and the
    // <input>'s value attribute is the only thing that reads it.
    const previewHex = useMemo<string>(
      () => hslToHex({ h: hue, s: sv.s, v: sv.v }),
      [hue, sv.s, sv.v],
    );

    // Update SV from a pad pointer. Clamps to the pad's content box
    // so dragging past either edge stays at the edge, not at 1.something.
    const onPadPointer = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
      const el = padRef.current;
      if (el === null) return;
      const rect = el.getBoundingClientRect();
      const next = pickFromPad(
        e.clientX - rect.left,
        e.clientY - rect.top,
        rect.width,
        rect.height,
      );
      setSv(next);
      if (inputError !== null) setInputError(null);
    }, [inputError]);

    const onPadPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
      e.preventDefault();
      draggingPadRef.current = true;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      onPadPointer(e);
    }, [onPadPointer]);

    const onPadPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
      if (!draggingPadRef.current) return;
      onPadPointer(e);
    }, [onPadPointer]);

    const onPadPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
      draggingPadRef.current = false;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }, []);

    const onSliderPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
      e.preventDefault();
      const el = sliderRef.current;
      if (el === null) return;
      draggingSliderRef.current = true;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const rect = el.getBoundingClientRect();
      setHue(pickFromHueSlider(e.clientX - rect.left, rect.width));
      if (inputError !== null) setInputError(null);
    }, [inputError]);

    const onSliderPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
      if (!draggingSliderRef.current) return;
      const el = sliderRef.current;
      if (el === null) return;
      const rect = el.getBoundingClientRect();
      setHue(pickFromHueSlider(e.clientX - rect.left, rect.width));
    }, []);

    const onSliderPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
      draggingSliderRef.current = false;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }, []);

    // Keyboard nudges for accessibility. Arrow keys move the cursor
    // one step; Shift+arrow jumps 8 steps; Home / End snap to the
    // edges. The pad is the only one with focus (the slider is a
    // styled div, not an interactive control — the slider handles
    // its own drag without needing focus).
    const onPadKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>): void => {
      const step = e.shiftKey ? 8 : 1;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else if (e.key === 'Home') { dx = -100; dy = -100; }
      else if (e.key === 'End') { dx = 100; dy = 100; }
      else return;
      e.preventDefault();
      setSv((prev) => {
        const ns = prev.s + dx / 100;
        const nv = prev.v + dy / 100;
        return {
          s: ns < 0 ? 0 : ns > 1 ? 1 : ns,
          v: nv < 0 ? 0 : nv > 1 ? 1 : nv,
        };
      });
    }, []);

    const onAdd = (): void => {
      const hex = normalizeHex(previewHex) ?? parseRgb(previewHex);
      if (hex === null) {
        setInputError('Pick a color from the pad before adding.');
        return;
      }
      const next = paletteReducer(presets, { type: 'add', theme, hex });
      if (next === presets) {
        setInputError('That color is already in your palette.');
        return;
      }
      onChange(next);
      setInputError(null);
    };

    // DEF-070 — parse the hex input draft through the same hex /
    // rgb parser the picker uses, applying the result to the live
    // picker state (hue / sv) without re-persisting through the
    // settings reducer. The user pressed Enter / blurred the field,
    // so they're done typing; partial / invalid input falls back
    // to the live preview hex so the picker is never left in a
    // half-applied state. The rgb form mirrors the same flow — it's
    // a separate input for accessibility (some users copy an `rgb(r,
    // g, b)` string out of a design tool and want to paste it).
    const parseDraftToHex = (raw: string): string | null =>
      normalizeHex(raw) ?? parseRgb(raw);

    const onHexDraftChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
      const next = e.target.value;
      setHexDraft(next);
      // Live preview: if the draft is parseable, update the picker
      // immediately so the pad / slider cursors track the typed
      // value. If the draft is mid-edit (empty / partial), the
      // existing hue / sv are preserved — the user sees the cursor
      // stay at the last valid position until they finish typing.
      const parsed = parseDraftToHex(next);
      if (parsed !== null) {
        const hsl = hexToHsl(parsed);
        if (hsl !== null) {
          setHue(hsl.h);
          setSv({ s: hsl.s, v: hsl.v });
          setInputError(null);
        }
      }
    };

    const onHexDraftCommit = (): void => {
      const parsed = parseDraftToHex(hexDraft);
      if (parsed === null) {
        // Invalid: snap the draft back to the live preview hex so
        // the visible field matches the picker. We surface a short
        // error to explain why the typed value was rejected.
        setHexDraft(previewHex);
        setInputError('Hex or rgb input not recognised. Expected #rrggbb, #rgb, or rgb(r, g, b).');
        return;
      }
      // Apply the committed hex through onApplyCustom so the
      // annotation tool picks up the colour immediately — pressing
      // Enter in the hex input is the e2e-visible affordance the
      // retest (retest_final.spec.cjs) waits on.
      onApplyCustom(parsed);
      setHexDraft(parsed);
      setInputError(null);
    };

    const onHexDraftKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onHexDraftCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // Snap back to the live preview WITHOUT re-applying through
        // onApplyCustom — the user's edit was a scratch buffer
        // and Escape means "leave the existing colour alone". The
        // `previewHex` here is computed from the current `hue` /
        // `sv`, which the change handler may have updated to match
        // the typed draft — so we restore the SEED hex instead,
        // which is what the picker was showing before the user
        // started typing. (Without this, typing `#abcdef` and then
        // pressing Escape would leave the input showing `#abcdef`
        // because the live preview already adopted it.)
        const restoreHex = ANNOTATION_COLOR_HEX[activeColor];
        const restoreFromCustom = activeCustomHex ?? restoreHex;
        setHue(0);
        setSv({ s: 1, v: 1 });
        setHexDraft(restoreFromCustom);
        const seedHslRestore = hexToHsl(restoreFromCustom) ?? { h: 0, s: 1, v: 1 };
        setHue(seedHslRestore.h);
        setSv({ s: seedHslRestore.s, v: seedHslRestore.v });
        setInputError(null);
      }
    };

    const onRemove = (id: string): void => {
      const next = paletteReducer(presets, { type: 'remove', theme, id });
      if (next !== presets) onChange(next);
    };

    const onPickBuiltIn = (c: AnnotationColor): void => {
      onApplyBuiltIn(c);
    };

    const onPickCustom = (preset: AnnotationColorPreset): void => {
      onApplyCustom(preset.hex);
    };

    const isCustomActive = (hex: string): boolean =>
      activeCustomHex !== null && activeCustomHex.toLowerCase() === hex.toLowerCase();

    // Cursor positions in percent. 0% = left/top edge of the pad's
    // content box; the cursor's own width is offset by 50% so it
    // sits centered on the pick.
    const padCursorStyle = {
      left: `${sv.s * 100}%`,
      top: `${(1 - sv.v) * 100}%`,
    };
    const sliderCursorStyle = {
      left: `${(hue / 360) * 100}%`,
    };

    return (
      <div className="color-palette" role="dialog" aria-label="Annotation color">
        <div className="color-palette-section">
          <div className="color-palette-label">Built-in</div>
          <div className="color-palette-grid" role="group" aria-label="Built-in colors">
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={
                  activeColor === c && activeCustomHex === null
                    ? 'color-swatch color-swatch-active'
                    : 'color-swatch'
                }
                style={{ background: ANNOTATION_COLOR_HEX[c] }}
                onClick={(): void => onPickBuiltIn(c)}
                aria-pressed={activeColor === c && activeCustomHex === null}
                aria-label={`Built-in ${c}`}
                title={`Built-in ${c}`}
                data-palette-built-in={c}
              />
            ))}
          </div>
        </div>
        <div className="color-palette-section">
          <div className="color-palette-label">
            <span>Your colors</span>
            <span className="color-palette-count">{themePresets.length}</span>
          </div>
          {themePresets.length === 0 ? (
            <div className="color-palette-empty">No saved colors yet.</div>
          ) : (
            <div className="color-palette-grid" role="group" aria-label="Saved colors">
              {themePresets.map((p) => (
                <div
                  key={p.id}
                  className={
                    isCustomActive(p.hex)
                      ? 'color-swatch-wrap color-swatch-wrap-active'
                      : 'color-swatch-wrap'
                  }
                >
                  <button
                    type="button"
                    className="color-swatch"
                    style={{ background: p.hex }}
                    onClick={(): void => onPickCustom(p)}
                    aria-pressed={isCustomActive(p.hex)}
                    aria-label={`Saved color ${p.hex}`}
                    title={p.hex}
                    data-palette-custom={p.hex}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm color-swatch-remove"
                    onClick={(): void => onRemove(p.id)}
                    aria-label={`Delete ${p.hex}`}
                    title="Delete color"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="color-palette-section">
          <div className="color-palette-label">
            <span>Custom</span>
            <span className="color-palette-hex" aria-live="polite">
              {previewHex}
            </span>
          </div>
          {/* The pad: 100% saturation along x (the leftmost gradient
              stop is the pure hue; the rightmost is fully desaturated
              white), 100% value along y (top is the pure hue; bottom
              is fully darkened black). The current hue is fed in via
              `background-color` so the user is always mixing from the
              hue they just picked on the slider. */}
          <div
            ref={padRef}
            className="color-pad"
            style={{ backgroundColor: hslToHex({ h: hue, s: 1, v: 1 }) }}
            tabIndex={0}
            role="slider"
            aria-label="Color picker"
            aria-valuetext={previewHex}
            onPointerDown={onPadPointerDown}
            onPointerMove={onPadPointerMove}
            onPointerUp={onPadPointerUp}
            onPointerCancel={onPadPointerUp}
            onKeyDown={onPadKeyDown}
            data-palette-pad
          >
            <div className="color-pad-shade color-pad-shade-white" />
            <div className="color-pad-shade color-pad-shade-black" />
            <div
              className="color-pad-cursor"
              style={{
                ...padCursorStyle,
                backgroundColor: previewHex,
              }}
              data-palette-pad-cursor
              aria-hidden
            />
          </div>
{/* The hue strip: pure spectrum left-to-right (red → yellow →
              green → cyan → blue → magenta → red). Same drag handler
              pattern as the pad. */}
          <div
            ref={sliderRef}
            className="color-hue-slider"
            role="slider"
            aria-label="Hue"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hue)}
            tabIndex={-1}
onPointerDown={onSliderPointerDown}
            onPointerMove={onSliderPointerMove}
            onPointerUp={onSliderPointerUp}
            onPointerCancel={onSliderPointerUp}
            data-palette-hue
          >
            <div
              className="color-hue-cursor"
              style={sliderCursorStyle}
              data-palette-hue-cursor
              aria-hidden
            />
          </div>
          {/* DEF-070 — controlled hex / rgb input. The retest
              spec fills this field with `#0000ff` then presses
              Enter and asserts the annotation tool picked up the
              colour. The grid lays out: [hex input][rgb
              input][Add]. Both inputs accept either `#rgb` /
              `#rrggbb` or `rgb(r, g, b)` text; the same
              normalizeHex / parseRgb parsers the pad uses feed
              into `onApplyCustom`. Pressing Enter in either
              commits the value; Escape cancels and snaps back
              to the live preview. */}
          <div className="color-palette-form" data-palette-form>
            <label className="color-palette-field">
              <span>Hex</span>
              <input
                type="text"
                inputMode="text"
                spellCheck={false}
                autoComplete="off"
                value={hexDraft}
                onChange={onHexDraftChange}
                onBlur={onHexDraftCommit}
                onKeyDown={onHexDraftKeyDown}
                aria-label="Custom color hex"
                placeholder="#rrggbb"
                data-palette-hex-input
              />
            </label>
            <label className="color-palette-field">
              <span>RGB</span>
              <input
                type="text"
                inputMode="text"
                spellCheck={false}
                autoComplete="off"
                value={(() => {
                  // Render the live preview as `rgb(r, g, b)` so
                  // the user sees the same colour in either
                  // format. The field is read-only by default; the
                  // user pastes into the hex field.
                  const hsl = hexToHsl(previewHex);
                  if (hsl === null) return '';
                  const rgb = hslToRgb(hsl.h, hsl.s, hsl.v);
                  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
                })()}
                aria-label="Custom color rgb (read only)"
                placeholder="rgb(r, g, b)"
                readOnly
                data-palette-rgb-input
                tabIndex={-1}
              />
            </label>
<button
              type="button"
              className="btn btn-ghost btn-icon color-palette-add"
              onClick={onAdd}
              title="Add to palette"
              aria-label="Add to palette"
              data-palette-add
            >
              <span>Add</span>
            </button>
          </div>
          {inputError !== null && (
            <div className="color-palette-error" role="alert">
              {inputError}
            </div>
          )}
        </div>
      </div>
    );
  },
);

/** Empty palette helper. Re-exported for tests. */
export const EMPTY_PALETTE = EMPTY_ANNOTATION_COLORS;

export default ColorPalette;

/** Pure helper: the toolbar needs to know whether a given hex is a
 *  normalised color the user can apply, without re-running the parser
 *  every render. Public for tests. */
export function tryParseColor(value: string): string | null {
  return normalizeHex(value) ?? parseRgb(value);
}

/** Pure helper: stable preset list equality, used by the App layer
 *  to skip a settings.json write when the palette didn't actually
 *  change. Public for tests. */
export function paletteEqual(a: AnnotationColors, b: AnnotationColors): boolean {
  if (a.light.length !== b.light.length || a.dark.length !== b.dark.length) return false;
  for (let i = 0; i < a.light.length; i += 1) {
    const ax = a.light[i];
    const bx = b.light[i];
    if (ax === undefined || bx === undefined) return false;
    if (ax.id !== bx.id || ax.hex !== bx.hex) return false;
  }
  for (let i = 0; i < a.dark.length; i += 1) {
    const ax = a.dark[i];
    const bx = b.dark[i];
    if (ax === undefined || bx === undefined) return false;
    if (ax.id !== bx.id || ax.hex !== bx.hex) return false;
  }
  return true;
}

/** Pure helper: render the live preview as a friendly `rgb(r, g, b)`
 *  string. Inverse of the `hexToHsl` round-trip; used by the rgb
 *  display input next to the hex field (DEF-070). All channels
 *  clamp into 0..255 and round to the nearest integer — the same
 *  bound the parser uses, so a copy of the field's text into
 *  `parseRgb` round-trips cleanly. */
export function hslToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hex = hslToHex({ h, s, v });
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

// useMemo-style identity helper removed — calling React hooks from a
// plain helper function violates the rules of hooks. Callers should
// useMemo the palette themselves at the call site if they want
// referential stability.