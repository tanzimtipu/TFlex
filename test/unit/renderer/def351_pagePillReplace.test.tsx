// @vitest-environment jsdom
//
// DEF-351 — the page pill's replace-on-type contract.
//
// In TWO/FOUR the resting value is the row RANGE ("3-4"). The old onFocus
// swapped it to the bare page ("3") but did NOT select it, so a first keystroke
// APPENDED: typing 6 on "3" produced "63" (silently refused). This spec pins the
// fix: focus selects the numeric value (so typing replaces it) and commit sends
// the typed integer, not the old text + the new digit.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactElement } from 'react';
import { CanvasPills, type CanvasPillsProps } from '../../../src/renderer/components/CanvasPills';

function renderPills(overrides: Partial<CanvasPillsProps> = {}): {
  host: HTMLElement;
  onJump: ReturnType<typeof vi.fn>;
  unmount: () => void;
} {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const onJump = vi.fn();
  const props: CanvasPillsProps = {
    page: 3,
    pageCount: 34,
    pageReadout: '3-4',
    zoomPercent: 100,
    zoomMode: 'fit-page',
    onJump,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFitWidth: vi.fn(),
    onFitPage: vi.fn(),
    ...overrides,
  };
  const view = (): ReactElement => <CanvasPills {...props} />;
  act((): void => {
    root.render(view());
  });
  return {
    host,
    onJump,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/** Set an input's value through React's onChange pipeline. */
function typeInto(input: HTMLInputElement, value: string): void {
  act((): void => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function focus(input: HTMLInputElement): void {
  act((): void => {
    input.focus();
  });
}

beforeEach((): void => {
  document.body.innerHTML = '';
});
afterEach((): void => {
  document.body.innerHTML = '';
});

describe('DEF-351 — the page pill replaces on type instead of appending', () => {
  it('focusing the range readout selects the numeric page so a keystroke replaces it', () => {
    const h = renderPills();
    try {
      const input = h.host.querySelector<HTMLInputElement>('.page-input');
      expect(input).not.toBeNull();
      if (input === null) return;
      expect(input.value).toBe('3-4');

      focus(input);

      // The swap ran: the control now shows the editable page...
      expect(input.value).toBe('3');
      // ...and the WHOLE value is selected, so the browser would overwrite it.
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
      expect(input.selectionEnd).toBeGreaterThan(0);
    } finally {
      h.unmount();
    }
  });

  it('typing a replacement digit commits the typed page, never the old value appended', () => {
    const h = renderPills();
    try {
      const input = h.host.querySelector<HTMLInputElement>('.page-input');
      if (input === null) throw new Error('page input missing');
      focus(input);
      // A browser replaces the selected text; here the value becomes just "4".
      typeInto(input, '4');
      act((): void => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      expect(h.onJump).toHaveBeenCalledWith('4');
      expect(h.onJump).not.toHaveBeenCalledWith('14');
      expect(h.onJump).not.toHaveBeenCalledWith('34');
    } finally {
      h.unmount();
    }
  });

  it('the ONE-mode page (no range) also selects its value on focus', () => {
    const h = renderPills({ pageReadout: null, page: 7 });
    try {
      const input = h.host.querySelector<HTMLInputElement>('.page-input');
      if (input === null) throw new Error('page input missing');
      expect(input.value).toBe('7');
      focus(input);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(1);
    } finally {
      h.unmount();
    }
  });
});
