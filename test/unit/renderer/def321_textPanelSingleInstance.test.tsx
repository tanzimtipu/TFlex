// @vitest-environment jsdom
//
// DEF-321 — ONE TextPropertiesPanel visible per selection.
//
// The Phase-36 contract says the floating text panel "becomes an optional
// pop-out of the same Inspector component (one component, two mount points —
// never a second properties UI)". The chunk-6 wiring mounted BOTH at once for
// the SAME selection: a floating `.text-props-panel` over the canvas AND the
// Inspector's `.inspector-text-panel .text-props-panel`, each with its own
// `[data-txt-text]` field (qa measured 248x723 at x=232 and 216x722 at x=1195).
//
// THE RULE (implemented by the two pure predicates in Inspector.tsx):
//   * the Inspector's EDIT/text section is the CANONICAL mount;
//   * the DocumentView's floating card is a POP-OUT and opens only when the
//     host's panel state says so AND the Inspector is NOT showing that same
//     selection;
//   * the Inspector owns it exactly when the view publishes the selection
//     (single mode), the stage is one of the text flows (EDIT, or REVIEW's
//     annotate flow — Phase 37 item 1), and a text target exists;
//   * the pop-out therefore stays the only properties UI for an armed tool
//     with nothing selected, and in Multi Mode (where the host withdraws the
//     published selection).
//
// The count assertion below mounts both real mount points as DocumentView does
// and asserts exactly ONE `.text-props-panel` and ONE `[data-txt-text]`.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Inspector,
  floatingTextPanelOpen,
  inspectorOwnsTextPanel,
  inspectorSelectionFor,
  inspectorTextPanelFor,
} from '../../../src/renderer/components/Inspector';
import type { InspectorTextSelection } from '../../../src/renderer/components/Inspector';
import { TextPropertiesPanel } from '../../../src/renderer/edit/TextPropertiesPanel';
import { defaultTextStyleValues } from '../../../src/renderer/edit/textStyle';

const ROOT = resolve(__dirname, '../../..');

function snapshot(overrides: Partial<InspectorTextSelection> = {}): InspectorTextSelection {
  const values = defaultTextStyleValues('Helvetica');
  return {
    targetKey: 'box:box-1',
    name: 'Text object',
    values,
    defaults: values,
    mode: 'text',
    text: 'Hello world',
    onPatch: vi.fn(),
    onTextChange: vi.fn(),
    onTextCommit: vi.fn(),
    focusToken: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. The pure rule.
// ---------------------------------------------------------------------------

describe('DEF-321 — the single-instance rule (pure)', () => {
  it('the Inspector owns the panel only for a published EDIT text target', () => {
    expect(
      inspectorOwnsTextPanel({ publishesSelection: true, stage: 'edit', hasTextTarget: true }),
    ).toBe(true);
    // An armed tool with nothing selected: no target -> the pop-out stays.
    expect(
      inspectorOwnsTextPanel({ publishesSelection: true, stage: 'edit', hasTextTarget: false }),
    ).toBe(false);
    // A text annotation selected in REVIEW: Phase 37 (item 1) moved this into
    // the Inspector (the annotate flow), so the Inspector now owns it.
    expect(
      inspectorOwnsTextPanel({ publishesSelection: true, stage: 'review', hasTextTarget: true }),
    ).toBe(true);
    // Multi Mode withdraws the published selection.
    expect(
      inspectorOwnsTextPanel({ publishesSelection: false, stage: 'edit', hasTextTarget: true }),
    ).toBe(false);
    // No stage (a DocumentView with no stage prop) never claims it.
    expect(
      inspectorOwnsTextPanel({ publishesSelection: true, stage: undefined, hasTextTarget: true }),
    ).toBe(false);
  });

  it('the floating card is mutually exclusive with the Inspector copy', () => {
    expect(floatingTextPanelOpen({ textPanelOpen: true, inspectorOwns: true })).toBe(false);
    expect(floatingTextPanelOpen({ textPanelOpen: true, inspectorOwns: false })).toBe(true);
    expect(floatingTextPanelOpen({ textPanelOpen: false, inspectorOwns: false })).toBe(false);
    expect(floatingTextPanelOpen({ textPanelOpen: false, inspectorOwns: true })).toBe(false);
  });

  it('agrees with inspectorSelectionFor: EDIT + text is the Inspector text slot', () => {
    const text = snapshot();
    const selection = inspectorSelectionFor({
      stage: 'edit',
      text,
      signatureLabel: null,
      page: 1,
    });
    expect(selection.kind).toBe('text');
    expect(inspectorTextPanelFor(text)).not.toBeNull();
    expect(
      inspectorOwnsTextPanel({ publishesSelection: true, stage: 'edit', hasTextTarget: true }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. The count: both real mount points, one visible instance.
// ---------------------------------------------------------------------------

interface Harness {
  host: HTMLElement;
  unmount: () => void;
}

/** Mount the two real mount points exactly as DocumentView + App do. */
function mountBoth(args: {
  stage: 'edit' | 'review';
  publishesSelection: boolean;
  hasTextTarget: boolean;
  textPanelOpen: boolean;
}): Harness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const text = args.hasTextTarget ? snapshot() : null;
  const inspectorOwns = inspectorOwnsTextPanel({
    publishesSelection: args.publishesSelection,
    stage: args.stage,
    hasTextTarget: args.hasTextTarget,
  });
  const floatingOpen = floatingTextPanelOpen({
    textPanelOpen: args.textPanelOpen,
    inspectorOwns,
  });
  const values = defaultTextStyleValues('Helvetica');
  act((): void => {
    root.render(
      createElement(
        'div',
        null,
        // The DocumentView's floating pop-out (open is the resolved rule).
        createElement(TextPropertiesPanel, {
          open: floatingOpen,
          values,
          defaults: values,
          mode: text?.mode ?? 'text',
          text: text?.text ?? null,
          onPatch: vi.fn(),
          onTextChange: vi.fn(),
          onTextCommit: vi.fn(),
          focusToken: 1,
        } as never),
        // The Inspector (the canonical mount) — the host feeds it the mapped
        // snapshot only when the view publishes one.
        createElement(Inspector, {
          stage: args.stage,
          selection: inspectorSelectionFor({
            stage: args.stage,
            text: args.publishesSelection ? text : null,
            signatureLabel: null,
            page: 1,
          }),
          textPanel: args.publishesSelection ? inspectorTextPanelFor(text) : null,
        }),
      ),
    );
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

function counts(host: HTMLElement): { panels: number; fields: number; inInspector: number } {
  const panels = host.querySelectorAll('.text-props-panel');
  return {
    panels: panels.length,
    fields: host.querySelectorAll('[data-txt-text]').length,
    inInspector: host.querySelectorAll('.inspector-text-panel .text-props-panel').length,
  };
}

describe('DEF-321 — exactly one TextPropertiesPanel per selection', () => {
  it('EDIT + a selected text object renders ONE instance (the Inspector copy)', () => {
    const { host, unmount } = mountBoth({
      stage: 'edit',
      publishesSelection: true,
      hasTextTarget: true,
      textPanelOpen: true,
    });
    try {
      const c = counts(host);
      expect(c.panels, 'one .text-props-panel for the selection').toBe(1);
      expect(c.fields, 'one [data-txt-text] for the selection').toBe(1);
      expect(c.inInspector, 'the Inspector is the canonical mount').toBe(1);
      // The floating pop-out is absent, so no second properties UI is visible.
      expect(host.querySelector('[data-inspector-text-panel]')).not.toBeNull();
      expect(host.querySelector('.text-props-panel')?.closest('[data-inspector]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it('an armed tool with nothing selected keeps the floating pop-out as the only instance', () => {
    const { host, unmount } = mountBoth({
      stage: 'edit',
      publishesSelection: true,
      hasTextTarget: false,
      textPanelOpen: true,
    });
    try {
      const c = counts(host);
      expect(c.panels, 'the pop-out is the only instance').toBe(1);
      expect(c.fields).toBe(1);
      expect(c.inInspector, 'no Inspector copy without a target').toBe(0);
    } finally {
      unmount();
    }
  });

  it('a text annotation selected in REVIEW now renders ONE Inspector instance (annotate flow)', () => {
    const { host, unmount } = mountBoth({
      stage: 'review',
      publishesSelection: true,
      hasTextTarget: true,
      textPanelOpen: true,
    });
    try {
      const c = counts(host);
      // Phase 37 (item 1) — the annotate flow integrates the panel into the
      // Inspector, so the Inspector copy is the only instance.
      expect(c.panels, 'one instance in the annotate flow').toBe(1);
      expect(c.inInspector).toBe(1);
    } finally {
      unmount();
    }
  });

  it('Multi Mode (no published selection) keeps the pop-out', () => {
    const { host, unmount } = mountBoth({
      stage: 'edit',
      publishesSelection: false,
      hasTextTarget: true,
      textPanelOpen: true,
    });
    try {
      const c = counts(host);
      expect(c.panels).toBe(1);
      expect(c.inInspector).toBe(0);
    } finally {
      unmount();
    }
  });

  it('never mounts two instances across the whole matrix', () => {
    for (const stage of ['edit', 'review'] as const) {
      for (const publishesSelection of [true, false]) {
        for (const hasTextTarget of [true, false]) {
          for (const textPanelOpen of [true, false]) {
            const { host, unmount } = mountBoth({
              stage,
              publishesSelection,
              hasTextTarget,
              textPanelOpen,
            });
            try {
              const c = counts(host);
              expect(
                c.panels,
                `stage=${stage} published=${publishesSelection} target=${hasTextTarget} open=${textPanelOpen}`,
              ).toBeLessThanOrEqual(1);
            } finally {
              unmount();
            }
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The source seam: DocumentView feeds the pop-out the RESOLVED state.
// ---------------------------------------------------------------------------

describe('DEF-321 — the DocumentView seam', () => {
  const docView = readFileSync(
    resolve(ROOT, 'src/renderer/components/DocumentView.tsx'),
    'utf8',
  );

  it('resolves the pop-out from the two predicates and uses it as the open prop', () => {
    expect(docView).toContain('inspectorOwnsTextPanel({');
    expect(docView).toContain('resolveFloatingTextPanelOpen({');
    expect(docView).toContain('open={floatingTextPanelOpen}');
    // The old unconditional mount is gone.
    expect(docView).not.toContain('open={textPanelOpen}');
  });

  it('keys the pop-out on the published-selection seam (single mode only)', () => {
    expect(docView).toContain('publishesSelection: onTextSelectionChange !== undefined');
    expect(docView).toContain('hasTextTarget: textTarget !== null');
  });

  it('publishes the selection in a LAYOUT effect (no one-frame gap with no panel)', () => {
    // The pop-out closes on the same commit the target appears, so the
    // Inspector copy must mount in the same paint.
    const publish = docView.slice(
      docView.indexOf('lastTextSelectionKeyRef.current = textSelectionKey;') - 400,
      docView.indexOf('lastTextSelectionKeyRef.current = textSelectionKey;'),
    );
    expect(publish).toContain('useLayoutEffect');
    expect(publish).not.toContain('useEffect((): void => {');
  });
});
