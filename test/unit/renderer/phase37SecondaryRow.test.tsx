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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnnotationFlyout } from '../../../src/renderer/components/AnnotationFlyout';
import { AnnotationToolbar } from '../../../src/renderer/annotations/AnnotationToolbar';
import { initialAnnotationToolState } from '../../../src/renderer/annotations/model';
import { EditToolbar } from '../../../src/renderer/edit/EditToolbar';
import { resolveDockLadder } from '../../../src/renderer/state/dockResponsive';
import { resolveSecondaryRowLadder } from '../../../src/renderer/state/secondaryRow';

const CSS = readFileSync(
  resolve(__dirname, '../../../src/renderer/styles.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bodies: string[] = [];
  const needle = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
  let m: RegExpExecArray | null;
  while ((m = needle.exec(CSS)) !== null) bodies.push(m[1]);
  return bodies.join('\n');
}

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

describe('Phase 37 item 3 — the EditToolbar single row', () => {
  function editToolbar(ladder: ReturnType<typeof resolveDockLadder> | undefined) {
    return mount(
      createElement(EditToolbar, {
        tool: 'off',
        onSelect: vi.fn(),
        defaultFont: 'Helvetica',
        onDefaultFontChange: vi.fn(),
        enabled: true,
        hint: 'Pick a tool',
        ladder,
      }),
    );
  }

  it('is one row and never wraps (labels rung hides the Font label + hint)', () => {
    const wide = editToolbar(resolveDockLadder(1600));
    try {
      expect(wide.host.querySelector('[data-edit-hint]')).not.toBeNull();
      expect(wide.host.querySelector('.edit-toolbar-font-label')).not.toBeNull();
      expect(wide.host.querySelector('[data-edit-arrow]')).toBeNull();
    } finally {
      wide.unmount();
    }

    const mid = editToolbar(resolveDockLadder(800));
    try {
      expect(mid.host.querySelector('[data-edit-toolbar]')?.getAttribute('data-edit-icon-only')).toBe('true');
      expect(mid.host.querySelector('[data-edit-hint]')).toBeNull();
      expect(mid.host.querySelector('.edit-toolbar-font-label')).toBeNull();
      // The controls themselves stay.
      expect(mid.host.querySelectorAll('[data-edit-tool]')).toHaveLength(4);
    } finally {
      mid.unmount();
    }
  });

  it('shows the scroll arrows at the last rung without dropping any control', () => {
    const narrow = editToolbar(resolveDockLadder(640));
    try {
      expect(narrow.host.querySelector('[data-edit-toolbar]')?.getAttribute('data-edit-arrows')).toBe('true');
      expect(narrow.host.querySelectorAll('[data-edit-arrow]')).toHaveLength(2);
      expect(narrow.host.querySelectorAll('[data-edit-tool]')).toHaveLength(4);
      // Clicking an arrow is a no-op in jsdom but must not throw.
      const left = narrow.host.querySelector<HTMLButtonElement>('[data-edit-arrow="left"]');
      act((): void => {
        left?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(narrow.host.querySelector('[data-edit-arrow="right"]')).not.toBeNull();
    } finally {
      narrow.unmount();
    }
  });

  it('the stylesheet keeps the row on one line and scrolls it', () => {
    expect(ruleBody('.edit-toolbar')).toMatch(/flex-wrap:\s*nowrap/);
    const scroll = ruleBody('.edit-toolbar-scroll');
    expect(scroll).toMatch(/overflow-x:\s*auto/);
    expect(scroll).toMatch(/flex:\s*1 1 auto/);
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

  it('the EditToolbar drops its arrows when the row fits', () => {
    const restore = stubScrollWidths('data-edit-toolbar-scroll', 195, 195);
    try {
      const { host, unmount } = mount(
        createElement(EditToolbar, {
          tool: 'off',
          onSelect: vi.fn(),
          defaultFont: 'Helvetica',
          onDefaultFontChange: vi.fn(),
          enabled: true,
          hint: 'Pick a tool',
          ladder: resolveDockLadder(640),
        }),
      );
      try {
        expect(host.querySelector('[data-edit-toolbar]')?.getAttribute('data-edit-arrows')).toBe('false');
        expect(host.querySelector('[data-edit-arrow]')).toBeNull();
      } finally {
        unmount();
      }
    } finally {
      restore();
    }
  });

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