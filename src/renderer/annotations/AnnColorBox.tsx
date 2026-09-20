// Phase 28 — the in-canvas action bar's COLOUR BOX.
//
// Replaces the old "Edit" text button on the annotation selection bar
// (Confirm | [colour box] | Delete). The box is a swatch showing the
// selected annotation's current colour; a SINGLE click expands the
// existing annotation colour picker (`ColorPalette` — the same
// component the annotation toolbar's dropdown uses, not a new picker)
// and picking a colour applies it to the selected annotation live.
//
// The popover is PORTALED to document.body and placed in viewport
// coordinates: the annotation layer sits inside the page's stacking
// context, so an in-tree popover would be painted under the page
// chrome (the DEF-175 lesson). It is a draggable floating window like
// every other DEF-147 popover.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import { useDragWindow } from '../components/useDragWindow';
import { TfPopover } from '../components/motion/TfMotion';
import ColorPalette, { paletteEqual } from './ColorPalette';
import { annotationColorToCss, isAnnotationColor } from './model';
import type { AnnotationColor, AnnotationColorValue } from './model';
import {
  EMPTY_ANNOTATION_COLORS,
  type AnnotationColors,
  type AnnotationTheme,
} from '../state/colorPalette';

export interface AnnColorBoxProps {
  /** The selected annotation's current colour (built-in name or hex). */
  color: AnnotationColorValue;
  /** Which preset bucket the picker edits ('light' | 'dark'). */
  theme: AnnotationTheme;
  /** Saved custom presets (per theme). */
  presets?: AnnotationColors;
  /** Persist a palette change (add / remove a saved preset). */
  onPaletteChange?: (next: AnnotationColors) => void;
  /** Apply a colour to the selected annotation immediately. */
  onApply: (color: AnnotationColorValue) => void;
}

export default function AnnColorBox(props: AnnColorBoxProps): ReactElement {
  const { color, theme, presets, onPaletteChange, onApply } = props;
  const [open, setOpen] = useState(false);
  const swatchRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const palette = presets ?? EMPTY_ANNOTATION_COLORS;
  const paletteDrag = useDragWindow({
    controlsSelector:
      "button, input, select, textarea, .color-pad, .color-hue-slider, [role='slider'], [role='button']",
  });

  // Click-outside dismissal + Escape. The picker owns no global handler
  // while closed.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (t === null) return;
      if (swatchRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return (): void => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Place the portaled popover under the swatch, clamped to the
  // viewport, re-placed on resize while it is open (mirrors the
  // annotation toolbar's picker).
  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const el = popoverRef.current;
      const swatch = swatchRef.current;
      if (el === null || swatch === null) return;
      const anchor = swatch.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const maxLeft = Math.max(0, window.innerWidth - w);
      const maxTop = Math.max(0, window.innerHeight - h);
      el.style.position = 'fixed';
      el.style.left = `${Math.min(Math.max(anchor.right - w, 0), maxLeft)}px`;
      el.style.top = `${Math.min(Math.max(anchor.bottom, 0), maxTop)}px`;
    };
    place();
    window.addEventListener('resize', place);
    return (): void => window.removeEventListener('resize', place);
  }, [open]);

  const builtIn = isAnnotationColor(color);
  const activeColor: AnnotationColor = builtIn ? color : 'yellow';
  const activeCustomHex = builtIn ? null : color;

  return (
    <span className="ann-color-box-anchor">
      <button
        ref={swatchRef}
        type="button"
        className="ann-color-box"
        style={{ background: annotationColorToCss(color) }}
        onClick={(): void => setOpen((v) => !v)}
        aria-pressed={open}
        aria-haspopup="dialog"
        aria-label={`Annotation color: ${annotationColorToCss(color)}. Open color picker.`}
        title={`Color: ${annotationColorToCss(color)}`}
        data-ann-color-box
        data-color-current={annotationColorToCss(color)}
      />
      {createPortal(
        <AnimatePresence>
          {open && (
            <TfPopover
              ref={(el): void => {
                popoverRef.current = el;
                paletteDrag.windowRef(el);
              }}
              className={
                paletteDrag.dragging ? 'color-popover color-popover-dragging' : 'color-popover'
              }
              role="presentation"
              data-color-popover
              animate={{ x: paletteDrag.offset.x, y: paletteDrag.offset.y }}
              exit={{ x: paletteDrag.offset.x, y: paletteDrag.offset.y - 3 }}
              {...paletteDrag.handleProps}
            >
              <ColorPalette
                theme={theme}
                activeColor={activeColor}
                activeCustomHex={activeCustomHex}
                presets={palette}
                onChange={(next): void => {
                  if (!paletteEqual(palette, next)) onPaletteChange?.(next);
                }}
                onApplyBuiltIn={(c): void => onApply(c)}
                onApplyCustom={(hex): void => onApply(hex)}
              />
            </TfPopover>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  );
}
