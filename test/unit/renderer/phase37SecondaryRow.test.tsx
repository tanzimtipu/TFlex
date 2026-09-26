// @vitest-environment jsdom
//
// Phase 37 chunk 4 (operator item 3) — the secondary tool surface is ONE ROW
// with NO header, and follows the dock's responsive ladder: labels hide first
// (rung 3), then left/right arrows scroll the row (rung 4). Neither the dock
// nor this row may stack.
//
// Both surfaces consume the ONE dock ladder the host resolved, so this suite
// pins the shared projection plus the two real components.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnnotationFlyout } from '../../../src/renderer/components/AnnotationFlyout';
import { AnnotationToolbar } from '../../../src/renderer/annotations/AnnotationToolbar';
import { initialAnnotationToolState } from '../../../src/renderer/annotations/model';
import { resolveDockLadder } from '../../../src/renderer/state/dockResponsive';
import { resolveSecondaryRowLadder } from '../../../src/renderer/state/secondaryRow';

function mount(el: ReturnType<typeof createElement>): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(el);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe('Phase 37 item 3 — the shared secondary-row ladder', () => {
  it('projects the dock rungs; a mount with no ladder stays full', () => {
    expect(resolveSecondaryRowLadder(undefined)).toEqual({ iconOnly: false, arrows: false });
    expect(resolveSecondaryRowLadder(resolveDockLadder(1600))).toEqual({
      iconOnly: false,
      arrows: false,
    });
    expect(resolveSecondaryRowLadder(resolveDockLadder(800))).toEqual({
      iconOnly: true,
      arrows: false,
    });
    expect(resolveSecondaryRowLadder(resolveDockLadder(640))).toEqual({
      iconOnly: true,
      arrows: true,
    });
  });
});

describe('DEF-337 — the secondary rows offer arrows only on a real overflow', () => {
  /** Force layout widths on the matching scroll container (jsdom has no
   *  layout). Returns a restore function. */
  function stubScrollWidths(attr: string, client: number, scroll: number): () => void {
    const hadClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const hadScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement): number {
        return this.hasAttribute(attr) ? client : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement): number {
        return this.hasAttribute(attr) ? scroll : 0;
      },
    });
    return (): void => {
      if (hadClient === undefined) {
        delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      } else {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', hadClient);
      }
      if (hadScroll === undefined) {
        delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
      } else {
        Object.defineProperty(HTMLElement.prototype, 'scrollWidth', hadScroll);
      }
    };
  }

  it('the AnnotationFlyout drops its arrows when the body fits (never dead at any width)', () => {
    const restore = stubScrollWidths('data-annotation-flyout-scroll', 195, 195);
    try {
const { host, unmount } = mount(
        <AnnotationFlyout open onClose={vi.fn()} ladder={resolveDockLadder(640)}>
          <AnnotationToolbar state={initialAnnotationToolState} onAction={vi.fn()} theme="dark" />
        </AnnotationFlyout>,
      );
      try {
        expect(host.querySelector('[data-annotation-flyout]')?.getAttribute('data-flyout-arrows')).toBe('false');
        expect(host.querySelector('[data-flyout-arrow]')).toBeNull();
      } finally {
        unmount();
      }
    } finally {
      restore();
    }
  });
});

describe('Phase 37 item 3 — the AnnotationFlyout single row', () => {
  function flyout(ladder: ReturnType<typeof resolveDockLadder> | undefined) {
    return mount(
      <AnnotationFlyout open onClose={vi.fn()} ladder={ladder}>
        <AnnotationToolbar state={initialAnnotationToolState} onAction={vi.fn()} theme="dark" />
      </AnnotationFlyout>,
    );
  }

  it('renders one row, no header, and keeps the real toolbar intact', () => {
    const { host, unmount } = flyout(undefined);
    try {
      expect(host.querySelector('.annotation-flyout-header')).toBeNull();
      expect(host.querySelector('.annotation-flyout-close')).toBeNull();
      expect(host.querySelector('[data-annotation-flyout-row]')).not.toBeNull();
      expect(host.querySelector('[data-annotation-toolbar]')).not.toBeNull();
      expect(host.querySelectorAll('[data-annotation-flyout]')).toHaveLength(1);
      expect(host.querySelector('[data-flyout-arrows]')?.getAttribute('data-flyout-arrows')).toBe('false');
    } finally {
      unmount();
    }
  });

  it('adds the scroll arrows at the last rung (never wraps)', () => {
    const { host, unmount } = flyout(resolveDockLadder(640));
    try {
      expect(host.querySelectorAll('[data-flyout-arrow]')).toHaveLength(2);
      const right = host.querySelector<HTMLButtonElement>('[data-flyout-arrow="right"]');
      act((): void => {
        right?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(host.querySelector('[data-annotation-flyout-scroll]')).not.toBeNull();
    } finally {
      unmount();
    }
  });
});