// @vitest-environment jsdom
//
// DEF-331 — with the Command Palette open over a dialog, Escape closed the
// DIALOG and left the palette. Both surfaces are modal and both listen on
// `window`; the dialog registers first, so the palette's Escape has to be
// handled in the CAPTURE phase and stop there: the top-most surface closes on
// the first press and the surface beneath only sees the second.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CommandPalette } from '../../../src/renderer/components/CommandPalette';

describe('DEF-331 — Escape closes the palette before the dialog beneath it', () => {
  it('consumes the first Escape and lets the second through', () => {
    const onClose = vi.fn();
    const dialogEscapes = vi.fn();
    // The dialog opened BEFORE the palette, so its listener is registered first
    // (the exact order that made the lower surface close first).
    const dialogListener = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      dialogEscapes();
    };
    window.addEventListener('keydown', dialogListener);

    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    function Wrapper(): ReactElement {
      const [open, setOpen] = useState(true);
      return (
        <CommandPalette
          open={open}
          onClose={(): void => {
            setOpen(false);
            onClose();
          }}
          onRunTool={vi.fn()}
          onPinTool={vi.fn()}
        />
      );
    }
    act((): void => {
      root.render(<Wrapper />);
    });
    try {
      const input = host.querySelector<HTMLInputElement>('[data-command-palette-input]');
      expect(input).not.toBeNull();
      const press = (): KeyboardEvent => {
        const event = new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        });
        act((): void => {
          input?.dispatchEvent(event);
        });
        return event;
      };

      // First Escape: the palette is the top-most surface and consumes it.
      const first = press();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(first.defaultPrevented).toBe(true);
      expect(dialogEscapes).not.toHaveBeenCalled();

      // Second Escape: the palette is gone, so the press reaches the dialog.
      press();
      expect(dialogEscapes).toHaveBeenCalledTimes(1);
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
      window.removeEventListener('keydown', dialogListener);
    }
  });

  it('still lets Ctrl+P through to whatever else claims it', () => {
    const onClose = vi.fn();
    const keydowns: string[] = [];
    const listener = (event: KeyboardEvent): void => {
      keydowns.push(event.key);
    };
    window.addEventListener('keydown', listener);
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    act((): void => {
      root.render(
        <CommandPalette open onClose={onClose} onRunTool={vi.fn()} onPinTool={vi.fn()} />,
      );
    });
    try {
      const input = host.querySelector<HTMLInputElement>('[data-command-palette-input]');
      act((): void => {
        input?.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'p',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      expect(keydowns).toEqual(['p']);
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
      window.removeEventListener('keydown', listener);
    }
  });
});
