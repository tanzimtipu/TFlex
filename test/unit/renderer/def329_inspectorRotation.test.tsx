// @vitest-environment jsdom
//
// DEF-329 — the Inspector's PAGES "Rotation" row reads the engine's QUARTER-TURN
// index, not degrees (PageView/SideRail multiply by 90 for the same value). It
// used to print the index with a degree sign ("1°" for a 90° page), i.e. wrong
// read-only data. These tests pin the real angle for every index.
//
// The same suite pins the two 3A dead-code cleanups: the Inspector no longer
// mounts the OCR-suspects view (the EDIT panel is its only host) and no longer
// accepts per-annotation callbacks (the annotations section is the reference
// count + the REVIEW jump).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Inspector, rotationDegreesText } from '../../../src/renderer/components/Inspector';

function renderInspector(props: Record<string, unknown>): {
  host: HTMLElement;
  unmount: () => void;
} {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(createElement(Inspector, props as never));
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

const rotationValue = (host: HTMLElement): string | null | undefined =>
  host.querySelector('[data-inspector-value="rotation"]')?.textContent;

describe('DEF-329 — the Rotation value is the real angle', () => {
  it('maps every quarter-turn index to degrees', () => {
    expect(rotationDegreesText(0)).toBe('0\u00b0');
    expect(rotationDegreesText(1)).toBe('90\u00b0');
    expect(rotationDegreesText(2)).toBe('180\u00b0');
    expect(rotationDegreesText(3)).toBe('270\u00b0');
    // The engine's counter wraps and can arrive from either direction.
    expect(rotationDegreesText(4)).toBe('0\u00b0');
    expect(rotationDegreesText(-1)).toBe('270\u00b0');
    expect(rotationDegreesText(7)).toBe('270\u00b0');
    // Absent/unknown state stays the em dash, never a fabricated angle.
    expect(rotationDegreesText(null)).toBe('\u2014');
    expect(rotationDegreesText(Number.NaN)).toBe('\u2014');
  });

  it('renders the angle for each index in the PAGES inspector', () => {
    for (const [index, expected] of [
      [0, '0\u00b0'],
      [1, '90\u00b0'],
      [2, '180\u00b0'],
      [3, '270\u00b0'],
    ] as const) {
      const { host, unmount } = renderInspector({
        stage: 'pages',
        selection: { kind: 'page', page: 1 },
        pageRotation: index,
      });
      try {
        expect(rotationValue(host), `index ${index}`).toBe(expected);
      } finally {
        unmount();
      }
    }
  });

  it('has no rotation row value when the engine has no state', () => {
    const { host, unmount } = renderInspector({
      stage: 'pages',
      selection: { kind: 'page', page: 1 },
      pageRotation: null,
    });
    try {
      expect(rotationValue(host)).toBe('\u2014');
    } finally {
      unmount();
    }
  });
});

describe('the two 3A cleanups', () => {
  it('mounts no OCR-suspects view in any stage', () => {
    for (const stage of ['pages', 'edit', 'review', 'deliver'] as const) {
      const { host, unmount } = renderInspector({
        stage,
        selection: { kind: 'page', page: 1 },
      });
      try {
        expect(host.querySelector('[data-ocr-suspects-panel]'), stage).toBeNull();
        expect(host.querySelector('[data-inspector-slot="ocr-suspects"]'), stage).toBeNull();
      } finally {
        unmount();
      }
    }
  });

  it('accepts no per-annotation callbacks (the section is the count + the jump)', () => {
    // Each directive is an assertion in itself: the prop it names must NOT be
    // part of InspectorProps any more (the annotations list lives in REVIEW).
    // @ts-expect-error the per-annotation jump callback is gone.
    const withJump = createElement(Inspector, { stage: 'review', onAnnotationJump: (): void => undefined });
    // @ts-expect-error the per-annotation edit callback is gone too.
    const withEdit = createElement(Inspector, { stage: 'review', onAnnotationEdit: (): void => undefined });
    // @ts-expect-error ...and so is the per-annotation delete callback.
    const withDelete = createElement(Inspector, { stage: 'review', onAnnotationDelete: (): void => undefined });
    expect([withJump, withEdit, withDelete].length).toBe(3);
  });
});
