// @vitest-environment jsdom
//
// DEF-318 — the REVIEW annotations list must be CONTAINED by its own section,
// so it can never cover the sections below it.
//
// The defect: `[data-context-panel-annotations]` was a static wrapper, so the
// re-parented `AnnotationsPanel` (`.ann-panel { position: absolute; inset: 0 }`
// — the rail's own rule) escaped to the nearest positioned ancestor,
// `.glass-sidebar-body`, and painted its `.hint` over the Signatures action
// row. `elementFromPoint` at "Manage signatures..." resolved to `SPAN.hint`,
// so the primary action of the sibling section was unclickable. This is the
// same positioning-context class as DEF-310 (the outline escape).
//
// The fix mirrors DEF-310: the annotations SECTION owns a bounded share of the
// panel body and its wrapper is a `.rail-content`-style positioning context,
// so `.ann-panel-list`'s own `overflow-y: auto` scrolls INSIDE it.
//
// Phase 90 (TFL-509-C1) replaced the annotations-only section with the unified
// review-element list: the bounded region is now the annotations CATEGORY
// (`[data-review-category="annotations"]`), a sibling of the Bates / Watermarks
// / Signatures categories, and the `.context-panel-annotations` wrapper still
// lives inside it. The containment intent is unchanged — these tests are
// re-pointed to the new structure.
//
// jsdom has no layout engine, so the containment chain is pinned against the
// real stylesheet (the same static-CSS-guard pattern the DEF-310/DEF-315
// suites use) and the rendered REVIEW structure is asserted on the real
// ContextPanel.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextPanel } from '../../../src/renderer/components/ContextPanel';
import type { ContextPanelProps } from '../../../src/renderer/components/ContextPanel';
import type { EngineState } from '../../../src/renderer/engine/types';

const CSS = readFileSync(resolve(__dirname, '../../../src/renderer/styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rule(selector: string): string {
  const re = new RegExp(`(?:^|[},])\\s*${escapeRe(selector)}\\s*\\{([^}]*)\\}`, 'm');
  const match = re.exec(CSS);
  if (match === null) throw new Error(`no rule for ${selector}`);
  return match[1];
}

function decl(block: string, prop: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${escapeRe(prop)}\\s*:\\s*([^;]+)`, 'm');
  const match = re.exec(block);
  return match === null ? null : match[1].trim().replace(/\s+/g, ' ');
}

const ANN_CATEGORY = rule('.review-elements-category[data-review-category="annotations"]');
const ANN_CATEGORY_BASE = rule('.review-elements-category');
const ANN_WRAPPER = rule('.context-panel-annotations');
const ANN_PANEL = rule('.ann-panel');
const ANN_LIST = rule('.ann-panel-list');
const GLASS_BODY = rule('.glass-sidebar-body');
const OUTLINE_SECTION = rule('.context-panel-outline');

const engineStub = {
  pageCount: 3,
  pageOrder: [0, 1, 2],
  pageLabels: [],
  rotations: [0, 0, 0],
} as unknown as EngineState;

function mountReview(overrides: Partial<ContextPanelProps> = {}): {
  host: HTMLElement;
  unmount: () => void;
} {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const props = {
    stage: 'review',
    doc: {} as never,
    currentPage: 1,
    defaultWidthPt: 612,
    defaultHeightPt: 792,
    engineState: engineStub,
    canUndo: false,
    onJump: vi.fn(),
    annotations: [],
    onManageSignatures: vi.fn(),
    ...overrides,
  } as unknown as ContextPanelProps;
  act((): void => {
    root.render(createElement(ContextPanel, props));
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

// ---------------------------------------------------------------------------
// 1. The containment chain in the real stylesheet.
// ---------------------------------------------------------------------------

describe('DEF-318 — the annotations category owns a bounded, scrollable body', () => {
  it('bounds the category to the panel body (the outline section is the model)', () => {
    // The outline's DEF-310 treatment: flex-bounded, clipped, min-height 0.
    expect(decl(OUTLINE_SECTION, 'min-height')).toBe('0');
    expect(decl(OUTLINE_SECTION, 'overflow')).toBe('hidden');
    // Phase 90: the annotations CATEGORY is the bounded region inside the
    // unified list; it keeps a definite, clipped box so the list scrolls.
    expect(decl(ANN_CATEGORY, 'flex')).toBe('1 1 auto');
    expect(decl(ANN_CATEGORY, 'min-height')).toBe('240px');
    expect(decl(ANN_CATEGORY, 'overflow')).toBe('hidden');
    expect(decl(ANN_CATEGORY_BASE, 'flex-direction')).toBe('column');
  });

  it('makes the wrapper the positioning context (the .rail-content role)', () => {
    expect(decl(ANN_WRAPPER, 'position')).toBe('relative');
    expect(decl(ANN_WRAPPER, 'flex')).toBe('1 1 auto');
    expect(decl(ANN_WRAPPER, 'min-height')).toBe('0');
    expect(decl(ANN_WRAPPER, 'overflow')).toBe('hidden');
  });

  it('keeps the absolute panel and its scrolling list INSIDE that wrapper', () => {
    // The panel escapes to the nearest positioned ancestor; the wrapper is
    // now that ancestor, so its `inset: 0` is bounded by the wrapper box.
    expect(decl(ANN_PANEL, 'position')).toBe('absolute');
    expect(decl(ANN_PANEL, 'inset')).toBe('0');
    // The list is the scroller — the section itself never scrolls.
    expect(decl(ANN_LIST, 'overflow-y')).toBe('auto');
    expect(decl(ANN_LIST, 'flex')).toBe('1 1 auto');
    // And the panel's old escape target is no longer its containing block.
    expect(decl(GLASS_BODY, 'position')).toBe('relative');
  });
});

// ---------------------------------------------------------------------------
// 2. The rendered REVIEW structure: the wrapper exists inside the annotations
//    CATEGORY, which is a SIBLING of the other review categories, so the list
//    can never paint over them.
// ---------------------------------------------------------------------------

describe('DEF-318 — the rendered REVIEW body keeps the sibling categories reachable', () => {
  it('renders the annotations wrapper inside its category, a sibling of the others', () => {
    const { host, unmount } = mountReview();
    try {
      const wrapper = host.querySelector<HTMLElement>('[data-context-panel-annotations]');
      expect(wrapper).not.toBeNull();
      expect(wrapper?.className).toBe('context-panel-annotations');

      const annCategory = wrapper?.closest<HTMLElement>('[data-review-category="annotations"]');
      const list = host.querySelector<HTMLElement>('[data-review-elements]');
      expect(annCategory).not.toBeNull();
      expect(list).not.toBeNull();
      // The annotations category is a direct child of the unified list.
      expect(annCategory?.parentElement).toBe(list);

      // A following category is a SIBLING of the annotations category inside
      // the list — the bounded annotations category cannot be painted over it.
      const nextCategory = host.querySelector<HTMLElement>('[data-review-category="bates"]');
      expect(nextCategory).not.toBeNull();
      expect(nextCategory?.parentElement).toBe(list);
      const order = [...(list?.children ?? [])];
      expect(order.indexOf(annCategory as Element)).toBeLessThan(
        order.indexOf(nextCategory as Element),
      );
    } finally {
      unmount();
    }
  });

  it('re-parents the real AnnotationsPanel inside the bounded wrapper', () => {
    const { host, unmount } = mountReview();
    try {
      const wrapper = host.querySelector('[data-context-panel-annotations]');
      const panel = wrapper?.querySelector('[data-annotation-panel]');
      expect(panel, 'the annotations list is inside the wrapper, not the glass body').not.toBeNull();
      // The wrapper is the panel's nearest positioned ancestor.
      expect(wrapper?.contains(panel as Node)).toBe(true);
    } finally {
      unmount();
    }
  });

  it('renders the empty-state hint inside the wrapper, never over a sibling category', () => {
    const { host, unmount } = mountReview();
    try {
      const wrapper = host.querySelector('[data-context-panel-annotations]');
      // Phase 116 (TFL-1228 chunk D) migrated the empty-state hint onto the
      // shared Thread Stream `AnnotationEmptyState` (`.ann-empty`); the legacy
      // `.hint` node is gone. The containment intent is unchanged.
      const hint = wrapper?.querySelector('.ann-empty');
      expect(hint, 'the hint is inside the annotations wrapper').not.toBeNull();
      // The hint belongs to the annotations category, never another one.
      expect(
        wrapper?.closest('[data-review-category]')?.getAttribute('data-review-category'),
      ).toBe('annotations');
      const nextCategory = host.querySelector('[data-review-category="bates"]');
      expect(
        nextCategory?.contains(hint as Node),
        'the hint is NOT inside a sibling category',
      ).toBe(false);
    } finally {
      unmount();
    }
  });
});
