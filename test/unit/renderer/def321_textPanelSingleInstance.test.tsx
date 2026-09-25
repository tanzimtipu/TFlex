// @vitest-environment jsdom
//
// DEF-321 — ONE TextPropertiesPanel visible per selection.
//
// Phase 38 feature C SUPERSEDES the two-mount-point rule: the floating
// DocumentView pop-out is RETIRED, so the Inspector's text block is the ONLY
// text-manipulation surface. The historical pure predicates below are kept as
// the record of the DEF-321 rule (and its unit coverage); the live seam is now
// the source assertions in section 3: the DocumentView renders no pop-out and
// publishes the text surface (with the armed-tool defaults) upward.
//
// NOTE — `inspectorOwnsTextPanel` / `floatingTextPanelOpen` are no longer
// referenced by product code after the Phase-38 retirement.

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
// 3. The source seam: Phase 38 feature C retires the DocumentView pop-out.
// ---------------------------------------------------------------------------

describe('Phase 38 — the DocumentView no longer mounts a text-properties pop-out', () => {
  const docView = readFileSync(
    resolve(ROOT, 'src/renderer/components/DocumentView.tsx'),
    'utf8',
  );

  it('renders no TextPropertiesPanel, no float attribute and no drag plumbing', () => {
    const code = docView.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('<TextPropertiesPanel');
    expect(code).not.toContain('data-text-panel-float');
    expect(code).not.toContain('resolveFloatingTextPanelOpen');
    expect(code).not.toContain('inspectorOwnsTextPanel');
  });

  it('publishes the text surface (including the armed-tool defaults) upward', () => {
    // The Inspector is the ONLY surface, so the view publishes whenever a text
    // surface is engaged — a selected target OR an armed tool with nothing
    // selected yet.
    expect(docView).toContain('textPanelSelectionActive');
    expect(docView).toContain('if (!textPanelSelectionActive) return null;');
    expect(docView).toContain('onTextSelectionChangeRef.current?.(textSelection)');
  });

  it('still publishes through a LAYOUT effect (no one-frame gap with no panel)', () => {
    const publish = docView.slice(
      docView.indexOf('lastTextSelectionKeyRef.current = textSelectionKey;') - 400,
      docView.indexOf('lastTextSelectionKeyRef.current = textSelectionKey;'),
    );
    expect(publish).toContain('useLayoutEffect');
    expect(publish).not.toContain('useEffect((): void => {');
  });
});
