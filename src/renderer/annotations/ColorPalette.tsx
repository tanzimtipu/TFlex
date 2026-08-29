// Phase 6 — annotation color palette UI.
//
// Replaces the row of preset swatches in the annotation toolbar with a
// picker that opens to the side of an active color swatch. The user can
// pick one of the built-in presets (yellow / red / green / blue), one of
// their custom presets (per theme), or open the full picker with a hex
// input and an rgb() input.
//
// Two affordances are deliberately kept separate:
//   - "Quick" swatches — single-click to apply.
//   - "Custom" presets — also single-click, but persist per-theme.
//
// The full picker (hex + rgb) is the third affordance. It does NOT mutate
// state directly — the user types a value, hits "Add", and only then does
// the palette reducer add a preset. This keeps accidental "click into the
// field and walk away" states from polluting the saved palette.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { Plus, X } from 'lucide-react';
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_HEX,
  type AnnotationColor,
} from './model';
import {
  EMPTY_ANNOTATION_COLORS,
  normalizeHex,
  parseRgb,
  reducer as paletteReducer,
  type AnnotationColorPreset,
  type AnnotationTheme,
  type AnnotationColors,
} from '../state/colorPalette';

export interface ColorPaletteHandle {
  /** Focus the hex input. Used by the parent when the "Custom" button
   *  on the toolbar is clicked — the toolbar knows the popover is
   *  closed at that point but wants to land focus inside it. */
  focusHex(): void;
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

    const [hexInput, setHexInput] = useState('');
    const [rgbInput, setRgbInput] = useState('');
    const [inputError, setInputError] = useState<string | null>(null);
    const hexRef = useRef<HTMLInputElement | null>(null);

    useImperativeHandle(ref, () => ({
      focusHex: (): void => hexRef.current?.focus(),
    }), []);

    // Reset transient inputs when the active theme flips so the user
    // doesn't see a stale error from a different theme.
    useEffect(() => {
      setHexInput('');
      setRgbInput('');
      setInputError(null);
    }, [theme]);

    const themePresets = presets[theme];

    const onAdd = (): void => {
      const hex = normalizeHex(hexInput) ?? parseRgb(rgbInput);
      if (hex === null) {
        setInputError('Enter a hex like #aabbcc or rgb(r, g, b).');
        return;
      }
      const next = paletteReducer(presets, { type: 'add', theme, hex });
      if (next === presets) {
        setInputError('That color is already in your palette.');
        return;
      }
      onChange(next);
      setHexInput('');
      setRgbInput('');
      setInputError(null);
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

    // Compact layout: presets live in a 4-column grid so the picker
    // doesn't grow unbounded as the user adds more. The hex/rgb inputs
    // sit underneath.
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
                    className="color-swatch-remove"
                    onClick={(): void => onRemove(p.id)}
                    aria-label={`Remove ${p.hex}`}
                    title="Remove"
                  >
                    <X size={10} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="color-palette-section">
          <div className="color-palette-label">Custom</div>
          <div className="color-palette-form">
            <label className="color-palette-field">
              <span>Hex</span>
              <input
                ref={hexRef}
                type="text"
                inputMode="text"
                spellCheck={false}
                value={hexInput}
                placeholder="#aabbcc"
                onChange={(e): void => {
                  setHexInput(e.target.value);
                  if (inputError !== null) setInputError(null);
                }}
                onKeyDown={(e): void => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onAdd();
                  }
                }}
                aria-label="Hex color"
                data-palette-hex
              />
            </label>
            <label className="color-palette-field">
              <span>RGB</span>
              <input
                type="text"
                inputMode="text"
                spellCheck={false}
                value={rgbInput}
                placeholder="rgb(170, 187, 204)"
                onChange={(e): void => {
                  setRgbInput(e.target.value);
                  if (inputError !== null) setInputError(null);
                }}
                onKeyDown={(e): void => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onAdd();
                  }
                }}
                aria-label="RGB color"
                data-palette-rgb
              />
            </label>
            <button
              type="button"
              className="color-palette-add"
              onClick={onAdd}
              title="Add to palette"
              aria-label="Add to palette"
            >
              <Plus size={12} aria-hidden />
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

// useMemo-style identity helper removed — calling React hooks from a
// plain helper function violates the rules of hooks. Callers should
// useMemo the palette themselves at the call site if they want
// referential stability.